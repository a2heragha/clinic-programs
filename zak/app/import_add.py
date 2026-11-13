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


def run(conn):
    """import every file in app/incoming that was not imported before"""
    done = set(json.loads((conn.execute("SELECT v FROM meta WHERE k='imported_files'").fetchone() or ['[]'])[0] or '[]'))
    out = []
    for f in sorted(glob.glob(os.path.join(IN_DIR, '*.json'))):
        name = os.path.basename(f)
        if name in done:
            continue
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
