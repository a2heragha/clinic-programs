# -*- coding: utf-8 -*-
"""Changes a PC never uploaded are added to the newer data automatically.

Every upload / download keeps a copy of what Google Drive has (data/sync-base.db).
When this PC starts later and Google Drive has newer data from another PC, the program compares this PC's
database with that copy: what was added or changed HERE since then is re-applied on top of the newer data
(import_add.import_recover), then uploaded. A field changed on both PCs keeps the other PC's value.
Without the copy (first time after the update) only the last 3 days are looked at, and only empty fields are filled."""
import datetime, os, sqlite3

VF = ('complaint', 'exam', 'diagnosis', 'plan', 'notes', 'bp_sys', 'bp_dia', 'hr', 'rr', 'temp', 'spo2', 'weight', 'height',
      'rbs', 'follow_up', 'waist', 'imaging')
PF = ('gender', 'birth_year', 'dob', 'phone', 'address', 'occupation', 'marital', 'smoking', 'alcohol', 'chronic', 'allergies',
      'long_meds', 'past_history', 'personal_note', 'height')
AF = ('date', 'time', 'seq', 'name', 'phone', 'age', 'note', 'status', 'created_by', 'created_at', 'weight', 'kind')


def base_path(db_path):
    return os.path.join(os.path.dirname(db_path), 'sync-base.db')


def save_base(db_path, raw):
    """raw: the bytes of the database exactly as it is now on Google Drive"""
    p = base_path(db_path)
    with open(p + '.part', 'wb') as f:
        f.write(raw)
    os.replace(p + '.part', p)


def _open(path):
    c = sqlite3.connect('file:%s?mode=ro' % path.replace('\\', '/'), uri=True)
    c.row_factory = sqlite3.Row
    return c


def _cols(c, table):
    return {r[1] for r in c.execute('PRAGMA table_info(%s)' % table)}


def _rows(c, sql, *a):
    try:
        return [dict(r) for r in c.execute(sql, a)]
    except sqlite3.Error:
        return []


def _meds(c, vid):
    return [r[0] for r in c.execute('SELECT line FROM visit_meds WHERE visit_id=? ORDER BY seq, id', (vid,))]


def build(local_path, base=None):
    """rows added / changed on this PC since `base` (path of sync-base.db, or None)"""
    L = _open(local_path)
    B = _open(base) if base and os.path.exists(base) else None
    out = {'kind': 'recover', 'patients': [], 'patient_fill': [], 'visits': [], 'visit_fill': [], 'labs': [],
           'lab_remove': [], 'appointments': []}
    since = (datetime.date.today() - datetime.timedelta(days=3)).isoformat()
    P = {r['id']: r for r in _rows(L, 'SELECT * FROM patients')}
    BP = {r['id']: r for r in _rows(B, 'SELECT * FROM patients')} if B else {}
    pf = [k for k in PF if k in _cols(L, 'patients')]
    vf = [k for k in VF if k in _cols(L, 'visits')]
    for p in P.values():
        b = BP.get(p['id']) if B else None
        if B and (not b or b['name_norm'] != p['name_norm']):
            out['patients'].append({k: p.get(k) for k in ['name', 'name_norm', 'created_at'] + pf})
        elif not B and (p.get('created_at') or '') >= since:
            out['patients'].append({k: p.get(k) for k in ['name', 'name_norm', 'created_at'] + pf})
        if B and b and b['name_norm'] == p['name_norm']:
            ch = {k: p[k] for k in pf if p[k] != b[k]}
            if ch:
                out['patient_fill'].append({'name_norm': p['name_norm'], 'set': ch, 'base': {k: b[k] for k in ch}})
    BV = {r['id']: r for r in _rows(B, 'SELECT * FROM visits')} if B else {}
    for v in _rows(L, 'SELECT * FROM visits'):
        p = P.get(v['patient_id'])
        if not p:
            continue
        b = BV.get(v['id'])
        same = b is not None and b['patient_id'] == v['patient_id'] and b['date'] == v['date'] and \
            BP.get(b['patient_id'], {}).get('name_norm') == p['name_norm']
        meds = _meds(L, v['id'])
        if B and not same:
            out['visits'].append(dict({k: v.get(k) for k in vf + ['price', 'fee_type', 'created_at']},
                                      name_norm=p['name_norm'], date=v['date'], meds=meds))
        elif B:
            ch = {k: v[k] for k in vf if v[k] != b[k]}
            base = {k: b[k] for k in ch}
            bm = _meds(B, b['id'])
            if meds != bm:
                ch['_meds'], base['_meds'] = meds, bm
            if ch:
                out['visit_fill'].append({'name_norm': p['name_norm'], 'date': v['date'], 'set': ch, 'base': base})
        elif v['date'] >= since or (v.get('updated_at') or '') >= since:
            out['visits'].append(dict({k: v.get(k) for k in vf + ['price', 'fee_type', 'created_at']},
                                      name_norm=p['name_norm'], date=v['date'], meds=meds))
            out['visit_fill'].append({'name_norm': p['name_norm'], 'date': v['date'],
                                      'set': dict({k: v[k] for k in vf if v[k] not in (None, '')}, _meds=meds)})
    BL = {r['id']: r for r in _rows(B, 'SELECT * FROM labs')} if B else {}
    LV = {r['id']: r for r in _rows(L, 'SELECT id FROM visits')}
    lab_ids = set()
    for lb in _rows(L, 'SELECT * FROM labs'):
        lab_ids.add(lb['id'])
        p = P.get(lb['patient_id'])
        b = BL.get(lb['id'])
        if not p:
            continue
        new = (not b or (b['code'], b['value'], b['date'], b['patient_id']) != (lb['code'], lb['value'], lb['date'], lb['patient_id'])) \
            if B else (lb.get('created_at') or '') >= since
        if new:
            item = {'name_norm': p['name_norm'], 'date': lb['date'], 'code': lb['code'], 'value': lb['value'], 'text': lb['text'],
                    'source': lb.get('source'), 'with_visit': lb['visit_id'] in LV}
            if b and (b['code'], b['date'], b['patient_id']) == (lb['code'], lb['date'], lb['patient_id']):
                item['replaces'] = b['value']
            out['labs'].append(item)
    for i, b in BL.items():                     # labs deleted on this PC
        if i not in lab_ids and BP.get(b['patient_id']):
            out['lab_remove'].append({'name_norm': BP[b['patient_id']]['name_norm'], 'date': b['date'], 'code': b['code'],
                                      'value': b['value']})
    BA = {r['id']: r for r in _rows(B, 'SELECT * FROM appointments')} if B else {}
    af = [k for k in AF if k in _cols(L, 'appointments')]
    for a in _rows(L, 'SELECT * FROM appointments'):
        b = BA.get(a['id'])
        if (B and (not b or (b['date'], b['name']) != (a['date'], a['name']))) or (not B and a['date'] >= since):
            if not a.get('deleted'):
                out['appointments'].append(dict({k: a.get(k) for k in af},
                                                name_norm=P[a['patient_id']]['name_norm'] if a.get('patient_id') in P else None))
    L.close()
    if B:
        B.close()
    return out


def count(rec):
    return sum(len(v) for k, v in rec.items() if isinstance(v, list))


def merge_into(target_db, old_copy, base):
    """re-apply this PC's unsent changes (old_copy, compared with base) to the newly downloaded target_db"""
    import import_add
    from common import connect, init_schema
    rec = build(old_copy, base)
    if not count(rec):
        return None
    conn = connect(target_db)
    try:
        init_schema(conn)
        st = import_add.import_recover(conn, rec)
        conn.commit()
    finally:
        conn.close()
    return st
