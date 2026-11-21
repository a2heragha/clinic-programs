# -*- coding: utf-8 -*-
"""Adds newer data from the old Echo program to the EXISTING database (nothing is replaced).
Files are put in app/incoming/*.json; each file is imported once, automatically, when the program starts
(or by hand:  py -3 app\\import_add.py).  Patients are matched by name (and phone) — new ones are created;
a visit is skipped if it was imported before (same old number) or the patient already has a visit that day."""
import os, sys, json, glob, re, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import connect, init_schema, norm_name, norm_phone
from import_echo import extract_vitals
from apply_conversion import merge, smoke

IN_DIR = os.path.join(HERE, 'incoming')


def lines_of(s):
    return '\n'.join(x.strip() for x in (s or '').split(',') if x.strip()) or None


def import_file(conn, path):
    data = json.load(open(path, encoding='utf-8'))
    year = datetime.date.today().year
    stats = {'patients': 0, 'visits': 0, 'skipped': 0}
    for p in data.get('patients') or []:
        nn = norm_name(p['name'])
        if conn.execute('SELECT 1 FROM patients WHERE name_norm=?', (nn,)).fetchone():
            continue
        g = {'ذكر': 'M', 'أنثى': 'F', 'انثى': 'F'}.get((p.get('gender') or '').strip())
        by = year - int(p['age']) if str(p.get('age') or '').isdigit() else None
        conn.execute('''INSERT INTO patients(legacy_id,name,name_norm,gender,birth_year,phone,phone_norm,address,chronic,allergies,created_by)
                        VALUES(?,?,?,?,?,?,?,?,?,?,'import')''',
                     ('echo:%s' % p.get('echo_id', ''), p['name'], nn, g, by, p.get('phone') or None, norm_phone(p.get('phone')),
                      p.get('address') or None, lines_of(p.get('chronic')), lines_of(p.get('allergy'))))
        if p.get('address'):
            conn.execute("INSERT OR IGNORE INTO vocab(kind,name,uses) VALUES('area',?,0)", (p['address'].strip(),))
            conn.execute("UPDATE vocab SET uses=uses+1 WHERE kind='area' AND name=?", (p['address'].strip(),))
        stats['patients'] += 1
    for v in sorted(data.get('visits') or [], key=lambda x: (x['date'], int(x.get('old_id') or 0))):
        if conn.execute('SELECT 1 FROM visits WHERE legacy_id=?', (str(v['old_id']),)).fetchone():
            stats['skipped'] += 1
            continue
        pr = conn.execute('SELECT id FROM patients WHERE name_norm=? ORDER BY id LIMIT 1', (norm_name(v['patient']),)).fetchone()
        if not pr:
            stats['skipped'] += 1
            continue
        pid = pr['id']
        if conn.execute('SELECT 1 FROM visits WHERE patient_id=? AND date=?', (pid, v['date'])).fetchone():
            stats['skipped'] += 1      # already entered in the new program that day
            continue
        c = v.get('conv') or {}
        vit = extract_vitals(v.get('notes'))
        bp = c.get('bp') or [vit.get('bp_sys'), vit.get('bp_dia')]
        try:
            w = float(v['weight']) if v.get('weight') else None
        except ValueError:
            w = None
        plan = c.get('P') or v.get('plan') or None
        vid = conn.execute('''INSERT INTO visits(patient_id,legacy_id,date,complaint,exam,diagnosis,plan,notes,weight,price,bp_sys,bp_dia,hr,spo2,legacy)
                              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)''',
                           (pid, str(v['old_id']), v['date'], c.get('S'), c.get('O'), '\n'.join(c.get('A') or []) or v.get('dx'), plan,
                            v.get('notes'), w, float(v['cost']) / 1000 if v.get('cost') else None, bp[0], bp[1],
                            c.get('hr') or vit.get('hr'), c.get('spo2') or vit.get('spo2'))).lastrowid
        for i, m in enumerate(v.get('meds') or []):
            line = re.sub(r'\s+', ' ', m if isinstance(m, str) else m.get('name', '')).strip()
            if line:
                conn.execute('INSERT INTO visit_meds(visit_id,seq,line) VALUES(?,?,?)', (vid, i, line))
                conn.execute('INSERT OR IGNORE INTO drugs(line,uses) VALUES(?,0)', (line,))
                conn.execute('UPDATE drugs SET uses=uses+1 WHERE line=?', (line,))
        for d in c.get('A') or []:
            conn.execute('INSERT OR IGNORE INTO diagnoses(name,uses) VALUES(?,0)', (d,))
            conn.execute('UPDATE diagnoses SET uses=uses+1 WHERE name=?', (d,))
        for code, val in (c.get('labs') or {}).items():
            if conn.execute('SELECT 1 FROM lab_tests WHERE code=?', (code,)).fetchone() and \
                    not conn.execute('SELECT 1 FROM labs WHERE patient_id=? AND date=? AND code=?', (pid, v['date'], code)).fetchone():
                conn.execute("INSERT INTO labs(patient_id,visit_id,date,code,value,source) VALUES(?,?,?,?,?,'imported')", (pid, vid, v['date'], code, val))
        pt = c.get('pt') or {}
        if pt:
            p = conn.execute('SELECT chronic,allergies,long_meds,smoking FROM patients WHERE id=?', (pid,)).fetchone()
            conn.execute('UPDATE patients SET chronic=?, allergies=?, long_meds=?, smoking=COALESCE(smoking,?) WHERE id=?',
                         (merge(p['chronic'], pt.get('c')), merge(p['allergies'], pt.get('al')), merge(p['long_meds'], pt.get('lm')), smoke(pt.get('sm')), pid))
        conn.execute("UPDATE patients SET updated_at=datetime('now','localtime') WHERE id=?", (pid,))
        stats['visits'] += 1
    return stats


VF = ('complaint', 'exam', 'diagnosis', 'plan', 'notes', 'bp_sys', 'bp_dia', 'hr', 'rr', 'temp', 'spo2', 'weight', 'height',
      'rbs', 'follow_up', 'waist', 'imaging')
PF = ('gender', 'birth_year', 'dob', 'phone', 'address', 'occupation', 'marital', 'smoking', 'alcohol', 'chronic', 'allergies',
      'long_meds', 'past_history', 'personal_note', 'height')


def _pid(conn, nn):
    r = conn.execute('SELECT id FROM patients WHERE name_norm=? ORDER BY id LIMIT 1', (nn,)).fetchone()
    return r['id'] if r else None


def _meds(conn, vid, meds):
    for i, line in enumerate(meds or []):
        conn.execute('INSERT INTO visit_meds(visit_id,seq,line) VALUES(?,?,?)', (vid, i, line))
        conn.execute('INSERT OR IGNORE INTO drugs(line,uses) VALUES(?,0)', (line,))
        conn.execute('UPDATE drugs SET uses=uses+1 WHERE line=?', (line,))


def _touch(conn, pid):
    conn.execute("UPDATE patients SET updated_at=datetime('now','localtime') WHERE id=?", (pid,))


def _longer(cur, val):
    """the old text is the same text as the current one, only longer"""
    if not (isinstance(cur, str) and isinstance(val, str)) or len(val) <= len(cur):
        return False
    c = cur.strip()
    return val.startswith(c[:max(10, len(c) - 5)])


def import_recover(conn, data):
    """Rows recovered from an old copy of a PC's database (data/before-download).
    Only what is missing is added; an existing field is filled only when it is empty, or when the old text is the same text, longer."""
    import cloudsync
    st = {'patients': 0, 'visits': 0, 'filled': 0, 'labs': 0, 'appointments': 0, 'skipped': 0}
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    for p in data.get('patients') or []:
        if _pid(conn, p['name_norm']):
            st['skipped'] += 1
            continue
        cols = ['name', 'name_norm'] + [k for k in PF if p.get(k) not in (None, '')]
        vals = [p[k] for k in cols]
        if p.get('phone'):
            cols.append('phone_norm')
            vals.append(norm_phone(p['phone']))
        cols += ['created_by', 'created_at', 'updated_at']
        vals += ['recover', p.get('created_at') or now, now]
        conn.execute('INSERT INTO patients(%s) VALUES(%s)' % (','.join(cols), ','.join('?' * len(cols))), vals)
        st['patients'] += 1
    for v in data.get('visits') or []:
        pid = _pid(conn, v['name_norm'])
        if not pid or conn.execute('SELECT 1 FROM visits WHERE patient_id=? AND date=?', (pid, v['date'])).fetchone():
            st['skipped'] += 1
            continue
        extra = [k for k in VF + ('price', 'fee_type', 'created_at') if v.get(k) not in (None, '')]
        cols = ['patient_id', 'date'] + extra
        vals = [pid, v['date']] + [v[k] for k in extra]
        vid = conn.execute('INSERT INTO visits(%s) VALUES(%s)' % (','.join(cols), ','.join('?' * len(cols))), vals).lastrowid
        _meds(conn, vid, v.get('meds'))
        _touch(conn, pid)
        st['visits'] += 1
    for f in data.get('visit_fill') or []:
        pid = _pid(conn, f['name_norm'])
        rows = conn.execute('SELECT * FROM visits WHERE patient_id=? AND date=?', (pid, f['date'])).fetchall() if pid else []
        if len(rows) != 1:
            st['skipped'] += 1
            continue
        cur = rows[0]
        base = f.get('base') or {}
        for k, val in f['set'].items():
            if k == '_meds':
                now_m = [r[0] for r in conn.execute('SELECT line FROM visit_meds WHERE visit_id=? ORDER BY seq, id', (cur['id'],))]
                if now_m != val and (not now_m or ('_meds' in base and now_m == base['_meds'])):
                    conn.execute('DELETE FROM visit_meds WHERE visit_id=?', (cur['id'],))
                    _meds(conn, cur['id'], val)
                    st['filled'] += 1
            elif k in VF and cur[k] != val and (cur[k] in (None, '') or _longer(cur[k], val) or (k in base and cur[k] == base[k])):
                conn.execute('UPDATE visits SET %s=? WHERE id=?' % k, (val, cur['id']))
                st['filled'] += 1
        _touch(conn, pid)
    for f in data.get('patient_fill') or []:
        rows = conn.execute('SELECT * FROM patients WHERE name_norm=?', (f['name_norm'],)).fetchall()
        if len(rows) != 1:
            st['skipped'] += 1
            continue
        cur, base = rows[0], f.get('base') or {}
        for k, val in f['set'].items():
            if k in PF and cur[k] != val and (cur[k] in (None, '') or _longer(cur[k], val) or (k in base and cur[k] == base[k])):
                conn.execute('UPDATE patients SET %s=? WHERE id=?' % k, (val, cur['id']))
                if k == 'phone':
                    conn.execute('UPDATE patients SET phone_norm=? WHERE id=?', (norm_phone(val), cur['id']))
                st['filled'] += 1
        _touch(conn, cur['id'])
    for lb in data.get('lab_remove') or []:
        pid = _pid(conn, lb['name_norm'])
        r = conn.execute('SELECT id FROM labs WHERE patient_id=? AND date=? AND code=? AND value IS ? LIMIT 1',
                         (pid, lb['date'], lb['code'], lb['value'])).fetchone() if pid else None
        if r:
            conn.execute('DELETE FROM labs WHERE id=?', (r['id'],))
            _touch(conn, pid)
            st['labs'] += 1
    for lb in data.get('labs') or []:
        pid = _pid(conn, lb['name_norm'])
        if not pid or conn.execute('SELECT 1 FROM labs WHERE patient_id=? AND date=? AND code=? AND value IS ?',
                                   (pid, lb['date'], lb['code'], lb['value'])).fetchone():
            st['skipped'] += 1
            continue
        if 'replaces' in lb:            # a value corrected on the old copy (the wrong one was deleted there)
            r = conn.execute('SELECT id FROM labs WHERE patient_id=? AND date=? AND code=? AND value IS ?',
                             (pid, lb['date'], lb['code'], lb['replaces'])).fetchone()
            if r:
                conn.execute('UPDATE labs SET value=?, text=? WHERE id=?', (lb['value'], lb['text'], r['id']))
                _touch(conn, pid)
                st['labs'] += 1
                continue
        vr = conn.execute('SELECT id FROM visits WHERE patient_id=? AND date=? ORDER BY id LIMIT 1',
                          (pid, lb['date'])).fetchone() if lb.get('with_visit') else None
        conn.execute('INSERT INTO labs(patient_id,visit_id,date,code,value,text,source) VALUES(?,?,?,?,?,?,?)',
                     (pid, vr['id'] if vr else None, lb['date'], lb['code'], lb['value'], lb['text'], lb.get('source') or 'recover'))
        _touch(conn, pid)
        st['labs'] += 1
    for a in data.get('appointments') or []:
        if conn.execute('SELECT 1 FROM appointments WHERE date=? AND name=?', (a['date'], a['name'])).fetchone():
            st['skipped'] += 1
            continue
        pid = _pid(conn, a['name_norm']) if a.get('name_norm') else None
        vr = conn.execute('SELECT id FROM visits WHERE patient_id=? AND date=?', (pid, a['date'])).fetchone() if pid else None
        conn.execute('INSERT INTO appointments(date,time,seq,patient_id,name,phone,age,note,status,created_by,created_at,weight,kind,'
                     'visit_id,uid,deleted,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)',
                     (a['date'], a.get('time'), a.get('seq'), pid, a['name'], a.get('phone'), a.get('age'), a.get('note'),
                      a.get('status'), a.get('created_by'), a.get('created_at'), a.get('weight'), a.get('kind'),
                      vr['id'] if vr else None, cloudsync.new_uid(), cloudsync.now_ms()))
        st['appointments'] += 1
    return st


def run(conn, may_write=True):
    """import every file in app/incoming that was not imported before.
    Recovered rows (kind "recover") are added only on the PC that holds the data; elsewhere they wait for a later start."""
    done = set(json.loads((conn.execute("SELECT v FROM meta WHERE k='imported_files'").fetchone() or ['[]'])[0] or '[]'))
    out = []
    for f in sorted(glob.glob(os.path.join(IN_DIR, '*.json'))):
        name = os.path.basename(f)
        if name in done:
            continue
        data = json.load(open(f, encoding='utf-8'))
        if data.get('kind') == 'recover':
            if not may_write:
                continue
            st = import_recover(conn, data)
        else:
            st = import_file(conn, f)
        done.add(name)
        conn.execute("INSERT OR REPLACE INTO meta(k,v) VALUES('imported_files',?)", (json.dumps(sorted(done)),))
        conn.commit()
        out.append((name, st))
    return out


if __name__ == '__main__':
    dbp = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', 'data', 'clinic.db')
    conn = connect(dbp)
    init_schema(conn)
    for name, st in run(conn):
        print(name, st)
