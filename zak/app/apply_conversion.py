# -*- coding: utf-8 -*-
"""Apply the structured conversion of old Echo notes (conv/*.json) to the clinic database.
Usage: python apply_conversion.py <conv_dir> [db_path]
Original note text stays in visits.notes. Fills complaint/exam/diagnosis/plan only when they are empty
(plan: old plan text is already merged into the converted plan), merges patient-level facts."""
import sys, os, glob, json, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import connect, init_schema

def lines(s): return [x.strip() for x in (s or '').replace('\r', '').split('\n') if x.strip()]
def merge(old, new):
    out = lines(old); seen = {re.sub(r'\W+', '', x.lower()) for x in out}
    for item in re.split(r'[;\n]', new or ''):
        item = item.strip()
        key = re.sub(r'\W+', '', item.lower())
        if item and key and key not in seen and not any(key in s or s in key for s in seen if len(s) > 3 and len(key) > 3):
            out.append(item); seen.add(key)
    return '\n'.join(out) or None
def smoke(t):
    t = (t or '').lower()
    if not t: return None
    if t.startswith('non') or 'never' in t: return 'never'
    if t.startswith('ex') or 'stopped' in t or 'quit' in t: return 'ex'
    return 'current'

def main():
    cdir = sys.argv[1]
    dbp = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'clinic.db')
    conn = connect(dbp); init_schema(conn)
    todo = json.load(open(os.path.join(cdir, 'todo.json'), encoding='utf-8'))
    oid = {v['_k']: v['old_id'] for v in todo}
    recs = []
    for r in json.load(open(os.path.join(cdir, 'converted100.json'), encoding='utf-8')):
        recs.append((str(r['old_id']), r))
    for f in sorted(glob.glob(os.path.join(cdir, 'out_*.json'))):
        for r in json.load(open(f, encoding='utf-8')):
            recs.append((str(oid[r['k']]), r))
    n = 0
    for old_id, r in recs:
        if r.get('junk'): continue
        row = conn.execute('SELECT id,patient_id,date FROM visits WHERE legacy_id=?', (old_id,)).fetchone()
        if not row: continue
        vid, pid, date = row['id'], row['patient_id'], row['date']
        dx = '\n'.join(r.get('A') or [])
        conn.execute('''UPDATE visits SET complaint=?, exam=?, diagnosis=?, plan=? WHERE id=?''',
                     (r.get('S') or None, r.get('O') or None, dx or None, r.get('P') or None, vid))
        for fld, col in (('bp', None),):
            pass
        if r.get('bp'): conn.execute('UPDATE visits SET bp_sys=COALESCE(bp_sys,?), bp_dia=COALESCE(bp_dia,?) WHERE id=?', (r['bp'][0], r['bp'][1], vid))
        if r.get('hr'): conn.execute('UPDATE visits SET hr=COALESCE(hr,?) WHERE id=?', (r['hr'], vid))
        if r.get('spo2'): conn.execute('UPDATE visits SET spo2=COALESCE(spo2,?) WHERE id=?', (r['spo2'], vid))
        for code, val in (r.get('labs') or {}).items():
            if not conn.execute('SELECT 1 FROM labs WHERE patient_id=? AND date=? AND code=?', (pid, date, code)).fetchone():
                conn.execute("INSERT INTO labs(patient_id,visit_id,date,code,value,source) VALUES(?,?,?,?,?,'imported')", (pid, vid, date, code, val))
        pt = r.get('pt') or {}
        if pt:
            p = conn.execute('SELECT chronic,allergies,long_meds,smoking FROM patients WHERE id=?', (pid,)).fetchone()
            conn.execute('UPDATE patients SET chronic=?, allergies=?, long_meds=?, smoking=COALESCE(smoking,?) WHERE id=?',
                         (merge(p['chronic'], pt.get('c') or pt.get('chronic')), merge(p['allergies'], pt.get('al') or pt.get('allergies')),
                          merge(p['long_meds'], pt.get('lm')), smoke(pt.get('sm')), pid))
        n += 1
    conn.commit()
    print('converted visits applied:', n)

if __name__ == '__main__':
    main()
