# -*- coding: utf-8 -*-
"""
Two (or more) clinic PCs and the phone app working at the same time, each on its own copy, with or without internet.

Every change made on a device is written by SQLite triggers into the table `oplog` (the row as it is now, and as it was).
About every 20 seconds the device
  1. sends its changes to the online script (ops_push): the script numbers them (one order for every device) and
     gives a new number to a new row whose number another device has already used (the device renumbers its row);
  2. fetches the changes of the other devices (ops_pull) and applies them.

Rules when the changes of two devices meet
  * a new patient / visit / lab / file / medicine line from any device is simply added — nothing is overwritten;
  * a changed field is copied to the other devices; different fields of the same row merge;
  * the same field changed on two devices before either of them received the other's change: the change that
    reached the script last is kept everywhere, the other value is written to the error log (src 'conflict');
  * a deletion is copied (and wins over a later change of the deleted row).

Not copied this way: appointments (they have their own sync through the Google sheet, by uid), log-ins,
the error log, AI summary cache and the local sync bookkeeping.
"""
import json, sqlite3, time, uuid

# tables whose rows are identified by their number (id), and the columns that point to another of them
ID_TABLES = ['patients', 'visits', 'visit_meds', 'labs', 'files', 'links', 'rx_templates', 'users']
FK = {'visits': {'patient_id': 'patients'}, 'visit_meds': {'visit_id': 'visits'},
      'labs': {'patient_id': 'patients', 'visit_id': 'visits'}, 'files': {'patient_id': 'patients', 'visit_id': 'visits'},
      'links': {'a_id': 'patients', 'b_id': 'patients'}}
# rows referring to a renumbered row that are not copied by this module (kept consistent locally)
LOCAL_REFS = {'patients': [('appointments', 'patient_id'), ('ai_summaries', 'patient_id'), ('sync_clinical', 'patient_id')],
              'visits': [('appointments', 'visit_id')], 'users': [('sessions', 'user_id')]}
# tables identified by a natural key (the same on every device)
KEY_TABLES = {'lab_tests': ['code'], 'drugs': ['line'], 'diagnoses': ['name'], 'vocab': ['kind', 'name'], 'meta': ['k']}
SKIP_COLS = {'drugs': {'id'}, 'diagnoses': {'id'}}       # local numbers of suggestion lists are not copied
PUSH_MAX = 400


def _cols(conn, t):
    return [r[1] for r in conn.execute('PRAGMA table_info(%s)' % t)]


def _tables(conn):
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def install(conn, meta_keys=()):
    """bookkeeping tables + triggers (made again at every start, so new columns are included)"""
    conn.execute('CREATE TABLE IF NOT EXISTS oplog (lid INTEGER PRIMARY KEY, tbl TEXT NOT NULL, k TEXT NOT NULL, op TEXT NOT NULL, '
                 'new TEXT, old TEXT, t INTEGER)')
    conn.execute('CREATE TABLE IF NOT EXISTS sync_ctl (v INTEGER NOT NULL)')
    # the place in the change list of this device's own latest value of a field: an older change of another device
    # that arrives later must not overwrite it
    conn.execute('CREATE TABLE IF NOT EXISTS sync_mine (tbl TEXT, k TEXT, col TEXT, seq INTEGER, PRIMARY KEY (tbl, k, col))')
    if not conn.execute('SELECT 1 FROM sync_ctl').fetchone():
        conn.execute('INSERT INTO sync_ctl VALUES(0)')
    conn.execute('UPDATE sync_ctl SET v=0')
    have = _tables(conn)
    for (name,) in conn.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'ol\\_%' ESCAPE '\\'").fetchall():
        conn.execute('DROP TRIGGER IF EXISTS %s' % name)
    when = '(SELECT v FROM sync_ctl) = 0'
    for t in ID_TABLES + list(KEY_TABLES):
        if t not in have:
            continue
        cols = _cols(conn, t)
        js = lambda R: 'json_object(%s)' % ', '.join("'%s', %s.%s" % (c, R, c) for c in cols)
        if t in KEY_TABLES:
            kc = KEY_TABLES[t]
            key = lambda R: ('%s.%s' % (R, kc[0])) if len(kc) == 1 else 'json_array(%s)' % ', '.join('%s.%s' % (R, c) for c in kc)
        else:
            key = lambda R: 'CAST(%s.id AS TEXT)' % R
        w = when
        if t == 'meta':
            keys = "'" + "','".join(k.replace("'", "''") for k in meta_keys) + "'" if meta_keys else "''"
            w_new, w_old = '%s AND NEW.k IN (%s)' % (when, keys), '%s AND OLD.k IN (%s)' % (when, keys)
        else:
            w_new = w_old = w
        stamp = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)"
        conn.execute('CREATE TRIGGER ol_%s_i AFTER INSERT ON %s WHEN %s BEGIN INSERT INTO oplog(tbl,k,op,new,t) '
                     "VALUES('%s', %s, 'i', %s, %s); END" % (t, t, w_new, t, key('NEW'), js('NEW'), stamp))
        conn.execute('CREATE TRIGGER ol_%s_u AFTER UPDATE ON %s WHEN %s BEGIN INSERT INTO oplog(tbl,k,op,new,old,t) '
                     "VALUES('%s', %s, 'u', %s, %s, %s); END" % (t, t, w_new, t, key('NEW'), js('NEW'), js('OLD'), stamp))
        conn.execute('CREATE TRIGGER ol_%s_d AFTER DELETE ON %s WHEN %s BEGIN INSERT INTO oplog(tbl,k,op,old,t) '
                     "VALUES('%s', %s, 'd', %s, %s); END" % (t, t, w_old, t, key('OLD'), js('OLD'), stamp))


def pending(conn):
    try:
        return conn.execute('SELECT COUNT(*) FROM oplog').fetchone()[0]
    except sqlite3.Error:
        return 0


def id_max(conn, synced_only=False):
    """highest row number per table. synced_only: leave out this device's new rows not sent yet (the floor for the script)"""
    have, out = _tables(conn), {}
    for t in ID_TABLES:
        if t not in have:
            continue
        q = 'SELECT COALESCE(MAX(id),0) FROM %s' % t
        if synced_only:
            q += " WHERE id NOT IN (SELECT CAST(k AS INTEGER) FROM oplog WHERE tbl='%s' AND op='i')" % t
        out[t] = conn.execute(q).fetchone()[0]
    return out


# ------------------------------------------------------------------ sending
def _diff(new, old):
    return {c: v for c, v in new.items() if old.get(c) != v}


def outgoing(conn, limit=PUSH_MAX):
    """the waiting changes, ready to send: [{lid, tbl, k, op, data}] — an update carries only the changed columns"""
    out = []
    for r in conn.execute('SELECT * FROM oplog ORDER BY lid LIMIT ?', (limit,)).fetchall():
        new = json.loads(r['new']) if r['new'] else None
        old = json.loads(r['old']) if r['old'] else None
        t, op, k = r['tbl'], r['op'], r['k']
        if op == 'u':
            if t in KEY_TABLES and old is not None:
                ok = _key_of(t, old)
                if ok != k:                                   # the key itself changed: old row gone, new row made
                    out.append({'lid': r['lid'], 'tbl': t, 'k': ok, 'op': 'd', 'data': None})
                    out.append({'lid': r['lid'], 'tbl': t, 'k': k, 'op': 'i', 'data': _strip(t, new)})
                    continue
            d = _strip(t, _diff(new, old or {}))
            if not d:
                out.append({'lid': r['lid'], 'tbl': t, 'k': k, 'op': 'n', 'data': None})     # nothing really changed
                continue
            out.append({'lid': r['lid'], 'tbl': t, 'k': k, 'op': 'u', 'data': d})
        elif op == 'i':
            out.append({'lid': r['lid'], 'tbl': t, 'k': k, 'op': 'i', 'data': _strip(t, new)})
        else:
            out.append({'lid': r['lid'], 'tbl': t, 'k': k, 'op': 'd', 'data': None})
    return out


def _strip(t, d):
    s = SKIP_COLS.get(t)
    return {c: v for c, v in d.items() if c not in s} if s else d


def _key_of(t, row):
    kc = KEY_TABLES[t]
    return str(row.get(kc[0])) if len(kc) == 1 else json.dumps([row.get(c) for c in kc], ensure_ascii=False, separators=(',', ':'))


def push(conn, call, write_lock, device):
    """send the waiting changes. Returns the number sent."""
    with write_lock:
        ops = outgoing(conn)
        floor = id_max(conn, synced_only=True)
    if not ops:
        return 0
    batch = uuid.uuid4().hex
    sent = [o for o in ops if o['op'] != 'n']
    r = call('ops_push', timeout=180, batch=batch, device=device, floor=floor,
             ops=[{'tbl': o['tbl'], 'k': o['k'], 'op': o['op'], 'data': o['data']} for o in sent]) if sent else {'remap': []}
    last = max(o['lid'] for o in ops)
    with write_lock:
        _ctl(conn, 1)
        try:
            conn.execute('PRAGMA defer_foreign_keys=ON')
            conn.execute('DELETE FROM oplog WHERE lid<=?', (last,))
            seq = int(r.get('from') or 0)
            remap = {(m['tbl'], str(m['old'])): str(m['new']) for m in r.get('remap') or []}
            for o in sent:                                  # remember where our values stand in the change list
                k = remap.get((o['tbl'], o['k']), o['k'])
                if seq and o['data']:
                    conn.executemany('INSERT OR REPLACE INTO sync_mine(tbl,k,col,seq) VALUES(?,?,?,?)',
                                     [(o['tbl'], k, c, seq) for c in o['data']])
                seq += 1
            for m in r.get('remap') or []:                  # another device used that number first: ours gets the new one
                renumber(conn, m['tbl'], int(m['old']), int(m['new']))
        finally:
            _ctl(conn, 0)
        conn.commit()
    return len(sent)


# ------------------------------------------------------------------ receiving
def pull(conn, call, write_lock, device, get_cursor, set_cursor, log=None):
    """fetch and apply the changes of the other devices. Returns the number applied."""
    n = 0
    for _ in range(20):                                   # up to 20 × 1000 changes per round
        since = get_cursor()
        r = call('ops_pull', timeout=180, since=since, device=device)
        ops = r.get('ops') or []
        with write_lock:
            _ctl(conn, 1)
            try:
                conn.execute('PRAGMA defer_foreign_keys=ON')
                for o in ops:
                    if o.get('dev') != device:
                        try:
                            if apply(conn, o, log):
                                n += 1
                        except sqlite3.Error as e:
                            if log:
                                log('sync', 'change %s %s %s not applied: %s' % (o.get('seq'), o.get('tbl'), o.get('k'), e))
                last = int(r.get('last') or since)
                set_cursor(conn, last)
                conn.execute('DELETE FROM sync_mine WHERE seq<=?', (last,))      # every older change is applied now
            finally:
                _ctl(conn, 0)
            conn.commit()
        if not r.get('more'):
            break
    return n


def _ctl(conn, v):
    conn.execute('UPDATE sync_ctl SET v=?', (v,))


def _pending_cols(conn, t, k):
    """columns of this row changed here and not sent yet (they win over an incoming change)"""
    cols = set()
    for r in conn.execute('SELECT op, new, old FROM oplog WHERE tbl=? AND k=?', (t, k)):
        if r['op'] == 'i':
            cols |= set(json.loads(r['new']))
        elif r['op'] == 'u':
            cols |= set(_diff(json.loads(r['new']), json.loads(r['old'] or '{}')))
        else:
            cols.add('*deleted*')
    return cols


def _own_insert(conn, t, k):
    return conn.execute("SELECT 1 FROM oplog WHERE tbl=? AND k=? AND op='i'", (t, k)).fetchone() is not None


def _where(t, k):
    if t in KEY_TABLES:
        kc = KEY_TABLES[t]
        vals = [k] if len(kc) == 1 else json.loads(k)
        return ' AND '.join('%s IS ?' % c for c in kc), vals
    return 'id=?', [int(k)]


def apply(conn, o, log=None):
    t, k, op, data = o['tbl'], str(o['k']), o['op'], o.get('data')
    if t not in _tables(conn):
        return False
    if isinstance(data, str):
        data = json.loads(data) if data else None
    cols = set(_cols(conn, t))
    if t in ID_TABLES and _own_insert(conn, t, k):
        # a new row of this device has the same number as the incoming one: ours moves aside (it gets its final number
        # from the script when it is sent)
        free = max(id_max(conn).get(t, 0), int(k)) + 1
        renumber(conn, t, int(k), free)
    where, args = _where(t, k)
    ex = conn.execute('SELECT * FROM %s WHERE %s' % (t, where), args).fetchone()
    if op == 'd':
        if ex:
            conn.execute('DELETE FROM %s WHERE %s' % (t, where), args)
            conn.execute('DELETE FROM oplog WHERE tbl=? AND k=?', (t, k))     # our changes of a deleted row are void
            return True
        return False
    if not data:
        return False
    d = {c: v for c, v in data.items() if c in cols and not (t in SKIP_COLS and c in SKIP_COLS[t])}
    if op == 'i' and not ex:
        if t in ID_TABLES:
            d['id'] = int(k)
        if t in FK:                                              # its patient / visit was deleted here meanwhile
            for c, pt in FK[t].items():
                if d.get(c) is not None and not conn.execute('SELECT 1 FROM %s WHERE id=?' % pt, (d[c],)).fetchone():
                    if c == 'visit_id' and t != 'visit_meds':
                        d[c] = None
                    else:
                        return False
        conn.execute('INSERT OR REPLACE INTO %s(%s) VALUES(%s)' % (t, ','.join(d), ','.join('?' * len(d))), list(d.values()))
        return True
    if not ex:
        if t in KEY_TABLES:                                      # an update of a list item this device never had
            conn.execute('INSERT OR REPLACE INTO %s(%s) VALUES(%s)' % (t, ','.join(d), ','.join('?' * len(d))), list(d.values()))
            return True
        return False
    mine = _pending_cols(conn, t, k)
    if '*deleted*' in mine:
        return False
    seq = int(o.get('seq') or 0)
    mine |= {r[0] for r in conn.execute('SELECT col FROM sync_mine WHERE tbl=? AND k=? AND seq>?', (t, k, seq))}
    earlier = {r[0] for r in conn.execute('SELECT col FROM sync_mine WHERE tbl=? AND k=? AND seq<=?', (t, k, seq))}
    keep = {}
    for c in list(d):
        if c in earlier and c not in mine and ex[c] != d[c] and log:
            log('conflict', '%s %s: "%s" changed on two devices — the other device\'s "%s" replaced "%s" written here'
                % (t, k, c, _short(d[c]), _short(ex[c])))
        if c in mine and ex[c] != d[c]:
            keep[c] = d.pop(c)
            if log:
                log('conflict', '%s %s: "%s" changed on two devices — kept "%s" (this device), the other device wrote "%s"'
                    % (t, k, c, _short(ex[c]), _short(keep[c])))
        elif ex[c] == d[c]:
            d.pop(c)
    if 'id' in d:
        d.pop('id')
    if not d:
        return False
    conn.execute('UPDATE %s SET %s WHERE %s' % (t, ', '.join('%s=?' % c for c in d), where), list(d.values()) + args)
    return True


def _short(v):
    s = '' if v is None else str(v)
    return s if len(s) <= 80 else s[:77] + '…'


# ------------------------------------------------------------------ renumbering a row (its number was taken)
def renumber(conn, t, old, new):
    if old == new:
        return
    if conn.execute('SELECT 1 FROM %s WHERE id=?' % t, (new,)).fetchone():        # also taken here: move that one aside first
        renumber(conn, t, new, max(id_max(conn).get(t, 0), new) + 1)
    conn.execute('UPDATE %s SET id=? WHERE id=?' % t, (new, old))
    for ct, m in FK.items():
        for c, pt in m.items():
            if pt == t:
                conn.execute('UPDATE %s SET %s=? WHERE %s=?' % (ct, c, c), (new, old))
                for col in ('new', 'old'):        # waiting changes that point to it
                    conn.execute("UPDATE oplog SET %s=json_set(%s, '$.%s', ?) WHERE tbl=? AND json_extract(%s, '$.%s')=?"
                                 % (col, col, c, col, c), (new, ct, old))
    now = int(time.time() * 1000)
    for lt, c in LOCAL_REFS.get(t, []):
        try:
            if lt == 'appointments':
                conn.execute('UPDATE appointments SET %s=?, updated_at=? WHERE %s=?' % (c, c), (new, now, old))
            else:
                conn.execute('UPDATE %s SET %s=? WHERE %s=?' % (lt, c, c), (new, old))
        except sqlite3.Error:
            pass
    for col in ('new', 'old'):
        conn.execute("UPDATE oplog SET %s=json_set(%s, '$.id', ?) WHERE tbl=? AND k=? AND %s IS NOT NULL" % (col, col, col), (new, t, str(old)))
    conn.execute('UPDATE oplog SET k=? WHERE tbl=? AND k=?', (str(new), t, str(old)))
    conn.execute('UPDATE OR REPLACE sync_mine SET k=? WHERE tbl=? AND k=?', (str(new), t, str(old)))
