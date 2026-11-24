# -*- coding: utf-8 -*-
"""
Online version (Google Sheets + Apps Script): sync between the clinic PC and the phone page.
Python standard library only. Runs in a background thread inside the server; without internet it waits and retries.

The database stays on the clinic PC. Google holds a working copy for the phone:
  - appointments            both ways (secretary books from the phone, the clinic marks arrived/done …)
  - new patients            phone → PC (secretary registers a patient; the PC creates the file and answers with its number)
  - patient list            PC → Google (name, birth year, phone, address — for the secretary's search)
  - clinical summaries      PC → Google (doctor's read-only English view: flags, last visits, meds, key labs)
  - users / PIN hashes      PC → Google (the phone page asks for the same PINs as the program)
  - daily full backup       PC → Google Drive

Protocol: POST JSON {token, action, ...} to the Apps Script web-app URL → {ok, ...}
"""
import json, time, uuid, base64, hashlib, os, tempfile, threading, datetime, sqlite3, urllib.request, urllib.error, http.client, socket

APPT_FIELDS = ['uid', 'date', 'time', 'seq', 'patient_id', 'name', 'phone', 'note', 'status', 'updated_at', 'deleted', 'weight', 'kind', 'call', 'hold', 'reminded']
STATE = {'enabled': False, 'last_ok': None, 'last_try': None, 'error': None, 'pushed': 0, 'pulled': 0,
         'new_patients': 0, 'clinical_last': None, 'backup_last': None, 'running': False}
_lock = threading.Lock()
GATE = None        # set by the server: only the PC holding the hand-over lease syncs (handoff.py)
KEY_LABS = ['HBA1C', 'FBS', 'RBS', 'LDL', 'TC', 'HDL', 'TG', 'CREAT', 'UREA', 'TSH', 'HB', 'FERRITIN', 'VITD', 'ALT', 'AST', 'CRP', 'UACR', 'K', 'NA', 'INR']


def now_ms():
    return int(time.time() * 1000)


def new_uid():
    return uuid.uuid4().hex


def meta_get(conn, k, default=None):
    r = conn.execute('SELECT v FROM meta WHERE k=?', (k,)).fetchone()
    return r[0] if r and r[0] is not None else default


def meta_set(conn, k, v):
    conn.execute('INSERT OR REPLACE INTO meta VALUES(?,?)', (k, None if v is None else str(v)))


def config(conn):
    return meta_get(conn, 'sync_url', '') or '', meta_get(conn, 'sync_token', '') or ''


MOVED = {}        # old link → new link: the old script answered "moved" (the clinic was moved to another Google account)
PATHS = {}        # set by the server: {'config': config.json, 'db': clinic.db}
_SCRIPT = 'https://script.google.com/macros/s/'
RESET_META = ('sync_cursor', 'sync_patients_hash', 'sync_patients_t', 'sync_config_hash', 'sync_backup_t', 'sync_clinical_t')


def moved_to(old, new):
    """remember the new link (same token) in config.json and the database, and send everything to it again.
    The hand-over count is kept: the new script starts from the same database copy."""
    print(' The online version moved to a new link — switching to it.')
    cp, dbp = PATHS.get('config'), PATHS.get('db')
    try:
        if cp and os.path.exists(cp):
            with open(cp, encoding='utf-8') as f:
                c = json.load(f)
            if c.get('sync_url') in (None, '', old):
                c['sync_url'] = new
                with open(cp, 'w', encoding='utf-8') as f:
                    json.dump(c, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(' config.json not updated: %s' % e)
    try:
        if dbp and os.path.exists(dbp):
            c = sqlite3.connect(dbp, timeout=30)
            try:
                if (meta_get(c, 'sync_url', '') or '') in ('', old):
                    meta_set(c, 'sync_url', new)
                    c.executemany('DELETE FROM meta WHERE k=?', [(k,) for k in RESET_META])
                    for q in ('UPDATE appointments SET synced_at=NULL', 'DELETE FROM sync_clinical'):
                        try:
                            c.execute(q)
                        except sqlite3.Error:
                            pass
                    c.commit()
            finally:
                c.close()
    except Exception as e:
        print(' Database link not updated: %s' % e)
    try:   # the new link counts its copies on its own: the next start downloads its data (changes of this PC are added on top)
        import handoff
        if dbp:
            st = handoff.load_local(dbp)
            if st.get('seq'):
                st['seq'] = 0
                handoff.save_local(dbp, st)
        if handoff.STATE.get('holder'):          # moved while running: stop writing until the program is started again
            handoff.STATE.update(readonly=True, holder=False, other='new link - restart the program')
    except Exception as e:
        print(' Hand-over count not reset: %s' % e)
    try:
        import errlog
        errlog.log('sync', 'Moved to the new online link')
    except Exception:
        pass


def _multi():
    try:
        import handoff
        return handoff.STATE.get('multi'), handoff.pc_id()
    except Exception:
        return False, ''


# On the phone the requests go through Android's own connection code (the one the browser uses):
# Python's own connections there were very slow with Google (about a minute for each 150 KB part)
ANDROID = bool(os.environ.get('ANDROID_ROOT') and os.environ.get('ANDROID_DATA'))


def _android_post(url, data, timeout):
    from java import jclass
    URL = jclass('java.net.URL')
    BOS = jclass('java.io.ByteArrayOutputStream')
    u, method, body = url, 'POST', data
    for _ in range(6):
        c = URL(u).openConnection()
        try:
            c.setInstanceFollowRedirects(False)
            c.setConnectTimeout(int(min(timeout, 20) * 1000))
            c.setReadTimeout(int(timeout * 1000))
            c.setRequestMethod(method)
            c.setRequestProperty('Content-Type', 'text/plain;charset=utf-8')
            if body is not None:
                c.setDoOutput(True)
                o = c.getOutputStream()
                o.write(body)
                o.close()
            code = c.getResponseCode()
            if code in (301, 302, 303, 307, 308):
                u = str(URL(URL(u), c.getHeaderField('Location')).toString())
                if code not in (307, 308):
                    method, body = 'GET', None          # Google answers the POST with a redirect to the result
                continue
            st = c.getInputStream() if code < 400 else c.getErrorStream()
            bos = BOS()
            if st is not None:
                from java import jarray
                buf = jarray('B')(65536)
                while True:
                    n = st.read(buf)
                    if n < 0:
                        break
                    bos.write(buf, 0, n)
                st.close()
            return bytes(bos.toByteArray()).decode('utf-8')
        finally:
            c.disconnect()
    raise ConnectionError('too many redirects')


def _post(url, data, timeout):
    global ANDROID
    if ANDROID:
        try:
            return _android_post(url, data, timeout)
        except (ImportError, TypeError, AttributeError, NameError, ValueError) as e:    # a mistake of this code, not the network:
            ANDROID = False                                                             # Python's own connections from now on
            print(' Android connection not usable (%s) - using the usual one' % e)
        except Exception as e:                       # Java errors in the shape the retries understand
            name = type(e).__name__ + ' ' + str(e)
            if 'Timeout' in name:
                raise socket.timeout(str(e))
            if 'UnknownHost' in name or 'NoRouteToHost' in name or 'ENETUNREACH' in name:
                raise urllib.error.URLError('No internet connection (%s)' % e)
            raise ConnectionError(str(e))
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'text/plain;charset=utf-8'}, method='POST')
    with urllib.request.urlopen(req, timeout=timeout) as r:    # Apps Script answers with a redirect; urllib follows it
        return r.read().decode('utf-8')


READ_ONLY = ('db_pull', 'ops_pull', 'pull', 'file_get', 'files_list', 'ping', 'lease_get')


def call(url, token, action, timeout=60, **payload):
    url = MOVED.get(url, url)
    if action in ('push', 'pull') and 'multi' not in payload:     # several devices: each one is told apart on the sheet
        m, pc = _multi()
        if m:
            payload.update(multi=1, pc=pc)
    extra = dict(payload)
    payload.update({'token': token, 'action': action, 'v': 2})     # v: the script refuses programs too old for several devices
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    # answers cut half way (mobile data) are asked again — only for questions that change nothing on Google
    tries = 6 if action in READ_ONLY else 1
    for n in range(tries):
        try:
            body = _post(url, data, timeout)
            break
        except (http.client.IncompleteRead, ConnectionError, TimeoutError, socket.timeout, urllib.error.URLError) as e:
            if n == tries - 1 or (isinstance(e, urllib.error.URLError) and not isinstance(getattr(e, 'reason', None), (socket.timeout, TimeoutError, ConnectionError))):
                raise
            print(' (answer from Google cut - asking again %d/%d)' % (n + 1, tries - 1))
            time.sleep(2 + 3 * n)
    try:
        res = json.loads(body)
    except ValueError:
        raise RuntimeError('Unexpected answer from Google — check the link and that the script is deployed with access "Anyone"')
    mv = res.get('moved')
    if isinstance(mv, str) and mv.startswith(_SCRIPT) and mv != url and url not in MOVED.values():
        MOVED[url] = mv
        moved_to(url, mv)
        return call(mv, token, action, timeout, **extra)
    if not res.get('ok'):
        raise RuntimeError(res.get('error') or 'Error from Google')
    return res


def age(by):
    try:
        return datetime.date.today().year - int(by) if by else ''
    except (TypeError, ValueError):
        return ''


# ------------------------------------------------------------------ appointments
def push_appts(conn, url, token, write_lock):
    rows = conn.execute('SELECT * FROM appointments WHERE uid IS NOT NULL AND updated_at > COALESCE(synced_at,0) ORDER BY updated_at LIMIT 500').fetchall()
    if not rows:
        return 0
    out = []
    for r in rows:
        d = {k: r[k] for k in APPT_FIELDS}
        if r['patient_id']:
            p = conn.execute('SELECT name, phone, birth_year FROM patients WHERE id=?', (r['patient_id'],)).fetchone()
            if p:
                d['name'] = p['name']
                d['phone'] = d['phone'] or p['phone'] or ''
                d['age'] = age(p['birth_year'])
        out.append(d)
    call(url, token, 'push', rows=out)
    with write_lock:
        for r in rows:          # mark as synced unless edited again meanwhile
            conn.execute('UPDATE appointments SET synced_at=? WHERE id=? AND updated_at=?', (r['updated_at'], r['id'], r['updated_at']))
        conn.commit()
    return len(rows)


def local_patient_id(conn, pid):
    """phone rows may point to a patient registered on the phone: 'n:<uid>' → the PC file number"""
    pid = str(pid or '').strip()
    if not pid:
        return None
    if pid.startswith('n:'):
        r = conn.execute('SELECT id FROM patients WHERE online_uid=?', (pid[2:],)).fetchone()
        return r[0] if r else None
    try:
        pid = int(float(pid))
    except ValueError:
        return None
    return pid if conn.execute('SELECT 1 FROM patients WHERE id=?', (pid,)).fetchone() else None


def dup_of(conn, date, pid, name, exclude=None):
    """the other appointment of the same patient on the same day (one per patient per day)"""
    if not date:
        return None
    if pid:
        q, a = 'patient_id=?', [pid]
    elif str(name or '').strip():
        q, a = "patient_id IS NULL AND TRIM(name)=?", [str(name).strip()]
    else:
        return None
    return conn.execute('SELECT * FROM appointments WHERE date=? AND %s AND COALESCE(deleted,0)=0 AND COALESCE(hold,0)=0 AND id IS NOT ?'
                        ' ORDER BY id LIMIT 1' % q, [date] + a + [exclude]).fetchone()


ST_RANK = {'done': 5, 'in': 4, 'waiting': 3, 'noshow': 2, '': 1}


def dedupe(conn):
    """old duplicates (same patient, same day): the most advanced one is kept, it takes the missing details
    (time, weight, note) of the others, which are deleted — on Google too, with the next upload"""
    n = 0
    groups = conn.execute("""SELECT date, COALESCE(CAST(patient_id AS TEXT), 'n:' || TRIM(name)) k, GROUP_CONCAT(id) ids
                             FROM appointments WHERE COALESCE(deleted,0)=0 AND COALESCE(hold,0)=0 AND (patient_id IS NOT NULL OR TRIM(COALESCE(name,''))<>'')
                             GROUP BY date, k HAVING COUNT(*) > 1""").fetchall()
    for g in groups:
        rows = [dict(r) for r in conn.execute('SELECT * FROM appointments WHERE id IN (%s)' % g['ids'])]
        rows.sort(key=lambda r: (-ST_RANK.get(r.get('status') or '', 1), 0 if r.get('visit_id') else 1, r['id']))
        keep, rest = rows[0], rows[1:]
        fill = {}
        for k in ('time', 'weight', 'note', 'phone', 'call', 'reminded'):
            if keep.get(k) in (None, ''):
                v = next((r[k] for r in rest if r.get(k) not in (None, '')), None)
                if v is not None:
                    fill[k] = v
        now = now_ms()
        if fill:
            fill['updated_at'] = now
            conn.execute('UPDATE appointments SET %s WHERE id=?' % ', '.join('%s=?' % k for k in fill), list(fill.values()) + [keep['id']])
        for r in rest:
            conn.execute('UPDATE appointments SET deleted=1, updated_at=? WHERE id=?', (now, r['id']))
            n += 1
    return n


def apply_appt(conn, rem):
    uid = rem.get('uid')
    if not uid or not rem.get('date'):
        return False
    rem_upd = int(float(rem.get('updated_at') or 0))
    loc = conn.execute('SELECT * FROM appointments WHERE uid=?', (uid,)).fetchone()
    if loc and int(loc['updated_at'] or 0) >= rem_upd:
        return False
    raw_pid = str(rem.get('patient_id') or '')
    pid = local_patient_id(conn, raw_pid)
    vals = {k: str(rem.get(k) if rem.get(k) is not None else '') for k in ('date', 'time', 'name', 'phone', 'note', 'status')}
    try:
        vals['seq'] = int(float(rem['seq'])) if str(rem.get('seq') or '').strip() else None
    except ValueError:
        vals['seq'] = None
    try:
        w = float(str(rem.get('weight') or '').strip() or 'x')
        vals['weight'] = w if 2 <= w <= 300 else None
    except ValueError:
        vals['weight'] = None
    old_w = loc['weight'] if loc else None
    vals['kind'] = 'auto' if rem.get('kind') == 'auto' else ''
    vals['call'] = rem.get('call') if rem.get('call') in ('yes', 'no', 'noans') else ''
    vals['hold'] = 1 if str(rem.get('hold') or '0') in ('1', 'true', 'True') else 0
    try:
        vals['reminded'] = int(float(rem['reminded'])) if str(rem.get('reminded') or '').strip() else None
    except ValueError:
        vals['reminded'] = None
    vals['patient_id'] = pid
    vals['deleted'] = 1 if str(rem.get('deleted') or '0') in ('1', 'true', 'True') else 0
    vals['updated_at'] = rem_upd
    vals['synced_at'] = rem_upd
    if raw_pid.startswith('n:') and pid:             # send the real file number back to the phone
        vals['updated_at'] = now_ms()
        vals['synced_at'] = rem_upd
    if loc:
        conn.execute('UPDATE appointments SET %s WHERE id=?' % ', '.join('%s=?' % k for k in vals), list(vals.values()) + [loc['id']])
    else:
        if vals['deleted']:
            return False
        if not vals.get('hold') and dup_of(conn, vals['date'], pid, vals['name']):
            vals['deleted'] = 1                 # a second booking of the same patient that day: kept as deleted,
            vals['updated_at'] = now_ms()       # and the deletion goes back to the phone with the next upload
        vals['uid'] = uid
        vals['created_by'] = str(rem.get('by') or 'phone')
        if vals['seq'] is None:
            vals['seq'] = conn.execute('SELECT COALESCE(MAX(seq),0)+1 FROM appointments WHERE date=?', (vals['date'],)).fetchone()[0]
        conn.execute('INSERT INTO appointments(%s) VALUES(%s)' % (', '.join(vals), ', '.join('?' * len(vals))), list(vals.values()))
    if vals['weight'] and pid:      # weight typed on the phone → that day's visit (unless the doctor wrote another)
        conn.execute('UPDATE visits SET weight=? WHERE patient_id=? AND date=? AND (weight IS NULL OR weight=?)',
                     (vals['weight'], pid, vals['date'], old_w if old_w is not None else vals['weight']))
    return True


def create_new_patients(conn, rows):
    """patients registered on the phone → files on the PC. Returns [[uid, id]] to confirm to Google."""
    from common import norm_name, norm_phone
    done = []
    for r in rows:
        uid = str(r.get('uid') or '')
        if not uid or not str(r.get('name') or '').strip():
            continue
        ex = conn.execute('SELECT id FROM patients WHERE online_uid=?', (uid,)).fetchone()
        if ex:
            done.append([uid, ex[0]])
            continue
        try:
            by = int(float(r.get('birth_year'))) if str(r.get('birth_year') or '').strip() else None
            if by and not 1900 < by <= datetime.date.today().year:
                by = None
        except ValueError:
            by = None
        g = str(r.get('gender') or '')
        pid = conn.execute('''INSERT INTO patients(name,name_norm,gender,birth_year,phone,phone_norm,address,occupation,created_by,online_uid)
                              VALUES(?,?,?,?,?,?,?,?,?,?)''',
                           (str(r['name']).strip(), norm_name(r['name']), g if g in ('M', 'F') else None, by, str(r.get('phone') or '').strip() or None,
                            norm_phone(r.get('phone')), str(r.get('address') or '').strip() or None, str(r.get('occupation') or '').strip() or None,
                            str(r.get('by') or 'phone'), uid)).lastrowid
        for kind, col in (('area', 'address'), ('occupation', 'occupation')):
            v = str(r.get(col) or '').strip()
            if v:
                conn.execute('INSERT OR IGNORE INTO vocab(kind,name) VALUES(?,?)', (kind, v))
                conn.execute('UPDATE vocab SET uses=uses+1 WHERE kind=? AND name=?', (kind, v))
        done.append([uid, pid])
    return done


def pull(conn, url, token, write_lock):
    since = int(float(meta_get(conn, 'sync_cursor', '0') or 0))
    res = call(url, token, 'pull', since=since)
    n = 0
    with write_lock:
        done = create_new_patients(conn, res.get('new_patients') or [])
        for rem in res.get('rows') or []:
            if apply_appt(conn, rem):
                n += 1
        if n:
            dedupe(conn)
        meta_set(conn, 'sync_cursor', int(float(res.get('cursor') or since)))
        conn.commit()
    if done:
        call(url, token, 'ack_patients', rows=done)
        STATE['new_patients'] += len(done)
    got = []
    for f in res.get('new_files') or []:              # result sheets photographed by the secretary on the phone
        try:
            r = import_phone_file(conn, url, token, write_lock, f)
            if r:
                got.append([f['uid'], r])
        except Exception as e:
            STATE['error'] = 'Result from the phone not received yet: %s' % e
    if got:
        call(url, token, 'ack_files', rows=got)
        STATE['phone_files'] = STATE.get('phone_files', 0) + len(got)
    return n


def import_phone_file(conn, url, token, write_lock, f):
    """one photographed result → the patient's investigation files (marked new for the doctor). Returns the file row id."""
    pid = local_patient_id(conn, f.get('patient_id'))
    files_dir = PATHS.get('files')
    fname = str(f.get('fname') or '')
    if not pid or not files_dir or '__' not in fname or '..' in fname:
        return None                                   # patient not on this PC yet: taken again in a few minutes
    rel = fname.replace('__', '/')
    with write_lock:
        ex = conn.execute('SELECT id FROM files WHERE path=?', (rel,)).fetchone()
    if ex:
        return ex[0]
    r = call(url, token, 'file_get', timeout=300, fname=fname)
    data = base64.b64decode(r['data'])
    dst = os.path.normpath(os.path.join(files_dir, rel))
    if not dst.startswith(os.path.normpath(files_dir)):
        return None
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with open(dst + '.part', 'wb') as fh:
        fh.write(data)
    os.replace(dst + '.part', dst)
    d = str(f.get('date') or '')[:10] or datetime.date.today().isoformat()
    with write_lock:
        fid = conn.execute('INSERT INTO files(patient_id,date,name,title,mime,path,size,created_by,seen) VALUES(?,?,?,?,?,?,?,?,0)',
                           (pid, d, str(f.get('name') or '') or 'result', 'Result from the secretary', str(f.get('mime') or ''), rel,
                            len(data), str(f.get('by') or 'phone'))).lastrowid
        conn.commit()
    return fid


# ------------------------------------------------------------------ patient list, clinical summaries, config
def push_patients(conn, url, token, write_lock, force=False):
    rows = [[r['id'], r['name'] or '', r['birth_year'] or '', r['phone'] or '', r['address'] or '', r['last'] or '']
            for r in conn.execute('''SELECT p.id, p.name, p.birth_year, p.phone, p.address,
                                            (SELECT MAX(date) FROM visits v WHERE v.patient_id=p.id) last
                                     FROM patients p ORDER BY p.name_norm''')]
    h = hashlib.md5(json.dumps(rows, ensure_ascii=False).encode('utf-8')).hexdigest()
    if not force and h == meta_get(conn, 'sync_patients_hash'):
        return False
    call(url, token, 'patients', timeout=120, rows=rows)
    with write_lock:
        meta_set(conn, 'sync_patients_hash', h)
        conn.commit()
    return True


def lines(s):
    return [x.strip() for x in (s or '').split('\n') if x.strip()]


def clinical(conn, pid):
    """compact summary for the doctor's English phone view"""
    p = conn.execute('SELECT * FROM patients WHERE id=?', (pid,)).fetchone()
    vs = []
    for v in conn.execute('SELECT * FROM visits WHERE patient_id=? ORDER BY date DESC, id DESC LIMIT 12', (pid,)):
        d = {'d': v['date']}
        for k, col in (('dx', 'diagnosis'), ('c', 'complaint'), ('e', 'exam'), ('pl', 'plan')):
            if v[col]:
                d[k] = v[col][:600]
        if v['notes'] and not (v['complaint'] or v['exam']):
            d['n'] = v['notes'][:700]
        if v['bp_sys']:
            d['bp'] = '%s/%s' % (v['bp_sys'], v['bp_dia'] or '')
        for k in ('weight', 'hr', 'spo2', 'rbs'):
            if v[k]:
                d[k[:2]] = round(v[k], 1)
        if v['follow_up']:
            d['fu'] = v['follow_up']
        m = [r[0] for r in conn.execute('SELECT line FROM visit_meds WHERE visit_id=? ORDER BY seq, id', (v['id'],))]
        if m:
            d['m'] = m
        vs.append(d)
    labs = {}
    for r in conn.execute("SELECT code, date, value, source FROM labs WHERE patient_id=? AND value IS NOT NULL AND code IN (%s) ORDER BY date" % ','.join('?' * len(KEY_LABS)),
                          [pid] + KEY_LABS):
        labs.setdefault(r['code'], []).append([r['date'], r['value'], 1 if r['source'] == 'imported' else 0])
    labs = {k: v[-6:] for k, v in labs.items()}
    nv = conn.execute('SELECT COUNT(*), MIN(date) FROM visits WHERE patient_id=?', (pid,)).fetchone()
    nf = conn.execute('SELECT COUNT(*) FROM files WHERE patient_id=?', (pid,)).fetchone()[0]
    return {'g': p['gender'] or '', 'by': p['birth_year'] or '', 'oc': p['occupation'] or '', 'al': lines(p['allergies']), 'ch': lines(p['chronic']),
            'lm': lines(p['long_meds']), 'sm': p['smoking'] or '', 'ht': p['height'] or '', 'nv': nv[0], 'first': nv[1] or '', 'nf': nf, 'v': vs, 'l': labs}


def push_clinical(conn, url, token, write_lock, force=False):
    """only patients whose summary changed since the last upload (hash per patient)"""
    last = dict(conn.execute('SELECT patient_id, h FROM sync_clinical').fetchall())
    changed, hashes = [], {}
    for (pid,) in conn.execute('SELECT id FROM patients'):
        js = json.dumps(clinical(conn, pid), ensure_ascii=False, separators=(',', ':'))
        h = hashlib.md5(js.encode('utf-8')).hexdigest()[:16]
        if force or last.get(pid) != h:
            changed.append([pid, js])
            hashes[pid] = h
    gone = [pid for pid in last if pid not in set(r[0] for r in conn.execute('SELECT id FROM patients'))]
    if not changed and not gone:
        return 0
    for i in range(0, len(changed), 250):                       # batches keep each request small
        batch = changed[i:i + 250]
        call(url, token, 'clinical', timeout=180, rows=batch, remove=gone if i == 0 else [])
        with write_lock:
            for pid, _ in batch:
                conn.execute('INSERT OR REPLACE INTO sync_clinical(patient_id,h) VALUES(?,?)', (pid, hashes[pid]))
            conn.commit()
    if gone and not changed:
        call(url, token, 'clinical', rows=[], remove=gone)
    with write_lock:
        for pid in gone:
            conn.execute('DELETE FROM sync_clinical WHERE patient_id=?', (pid,))
        conn.commit()
    STATE['clinical_last'] = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    return len(changed)


def push_config(conn, url, token, write_lock):
    m = dict(conn.execute('SELECT k, v FROM meta').fetchall())
    cfg = {'clinic': m.get('clinic_name') or '', 'work': [m.get('work_from') or '13:00', m.get('work_to') or '21:00'], 'wa': m.get('wa_template') or '',
           'users': [[r['name'], r['role'], r['pin']] for r in conn.execute('SELECT name, role, pin FROM users WHERE active=1 AND pin IS NOT NULL ORDER BY role, name')],
           'areas': [r[0] for r in conn.execute("SELECT name FROM vocab WHERE kind='area' ORDER BY uses DESC LIMIT 400")],
           'occupations': [r[0] for r in conn.execute("SELECT name FROM vocab WHERE kind='occupation' ORDER BY uses DESC LIMIT 200")],
           'labs': [[r['code'], r['name'], r['unit'] or '', r['low'], r['high']] for r in conn.execute('SELECT * FROM lab_tests ORDER BY seq')]}
    h = hashlib.md5(json.dumps(cfg, ensure_ascii=False).encode('utf-8')).hexdigest()
    if h == meta_get(conn, 'sync_config_hash'):
        return False
    call(url, token, 'config', config=cfg)
    with write_lock:
        meta_set(conn, 'sync_config_hash', h)
        conn.commit()
    return True


def upload_backup(db_path, url, token):
    fd, tmp = tempfile.mkstemp(suffix='.db')
    os.close(fd)
    try:
        src = sqlite3.connect(db_path)
        dst = sqlite3.connect(tmp)
        src.backup(dst)
        dst.close()
        src.close()
        with open(tmp, 'rb') as f:
            data = base64.b64encode(f.read()).decode('ascii')
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    name = 'clinic_%s.db' % datetime.datetime.now().strftime('%Y-%m-%d_%H%M')
    call(url, token, 'backup', timeout=300, name=name, data=data)
    return name


# ------------------------------------------------------------------ one round
def sync_once(connect, db_path, write_lock, backup=False, full=False):
    """appointments every round (≈20 s); patient list + config when changed; clinical summaries every 3 min; backup daily"""
    if GATE and not GATE():
        return {'paused': True}
    if not _lock.acquire(blocking=False):
        return {'busy': True}
    STATE['running'] = True
    STATE['last_try'] = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    try:
        conn = connect(db_path)
        try:
            url, token = config(conn)
            STATE['enabled'] = bool(url and token)
            if not STATE['enabled']:
                return {'enabled': False}
            res = {'pushed': push_appts(conn, url, token, write_lock), 'pulled': pull(conn, url, token, write_lock)}
            res['patients'] = push_patients(conn, url, token, write_lock, force=full)
            res['config'] = push_config(conn, url, token, write_lock)
            last_c = int(float(meta_get(conn, 'sync_clinical_t', '0') or 0))
            if full or now_ms() - last_c > 3 * 60 * 1000:
                res['clinical'] = push_clinical(conn, url, token, write_lock, force=full)
                with write_lock:
                    meta_set(conn, 'sync_clinical_t', now_ms())
                    conn.commit()
            last_b = int(float(meta_get(conn, 'sync_backup_t', '0') or 0))
            if backup or now_ms() - last_b > 20 * 3600 * 1000:
                res['backup'] = upload_backup(db_path, url, token)
                with write_lock:
                    meta_set(conn, 'sync_backup_t', now_ms())
                    meta_set(conn, 'sync_backup_name', res['backup'])
                    conn.commit()
            STATE.update(last_ok=datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'), error=None,
                         pushed=STATE['pushed'] + res['pushed'], pulled=STATE['pulled'] + res['pulled'],
                         backup_last=meta_get(conn, 'sync_backup_name'))
            return res
        finally:
            conn.close()
    except urllib.error.URLError as e:
        STATE['error'] = 'No internet connection (%s)' % getattr(e, 'reason', e)
        return {'error': STATE['error']}
    except Exception as e:
        STATE['error'] = str(e)
        return {'error': STATE['error']}
    finally:
        STATE['running'] = False
        _lock.release()


def loop(connect, db_path, write_lock, every=20):
    time.sleep(5)
    while True:
        try:
            sync_once(connect, db_path, write_lock)
        except Exception as e:      # never let the thread die
            STATE['error'] = str(e)
        time.sleep(every)
