# -*- coding: utf-8 -*-
"""
Imports the export of the old Echo Clinics System (zakariya_migration.json) into a NEW database.
    py -3 app\\import_echo.py zakariya_migration.json
The current database (if any) is backed up first, then replaced.
Lab values written inside the old free-text notes (e.g. "hba1c is 10.5, ldl 151") are extracted into the
lab table with source='imported', so the charts include the old history.
"""
import os, sys, json, re, datetime, shutil, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from common import connect, init_schema, norm_name, norm_phone

NUM = r'(\d{1,4}(?:\.\d{1,3})?)'
SEP = r'\s*(?:level\s*)?(?:is|=|:|,|-|of)?\s*'
# code: (regex for the test name, plausible min, max, mmol→mg/dL factor applied when the value is below `mmol_below`)
LAB_RX = {
    'HBA1C': (r'\b(?:hb\s?a1c|a1c|hba1|glycated\s+h[ae]moglobin)', 3, 20, None),
    'FBS': (r'\b(?:fbs|fasting\s+(?:blood\s+)?sugar|fbg)', 40, 600, None),
    'RBS': (r'\b(?:rbs|random\s+(?:blood\s+)?sugar|rbg)', 40, 900, None),
    'TC': (r'\b(?:total\s+chol[a-z]*|t\.?\s?chol[a-z]*|cholest[a-z]*|tc)', 50, 600, (15, 38.67)),
    'LDL': (r'\bldl(?:-?c)?', 10, 400, (10, 38.67)),
    'HDL': (r'\bhdl(?:-?c)?', 10, 150, None),
    'TG': (r'\b(?:tri(?:glyc[a-z]*)?|tg)', 20, 3000, (15, 88.57)),
    'CREAT': (r'\b(?:s\.?\s?)?(?:creat[a-z]*\.?|crat[a-z]*|creatinie|cr)', 0.2, 15, None),
    'UREA': (r'\b(?:bl(?:ood)?\.?\s+)?urea', 5, 300, None),
    'TSH': (r'\btsh', 0.001, 150, None),
    'FT4': (r'\b(?:free\s+t4|ft4)', 0.1, 8, None),
    'HB': (r'\b(?:hb|h\.b|ha?emoglobin)(?!\s?a1c)(?!a1)', 3, 22, None),
    'WBC': (r'\bwbcs?', 0.5, 100, None),
    'PLT': (r'\b(?:plt|platelets?)', 10, 1500, None),
    'FERRITIN': (r'\bferr?itin', 1, 5000, None),
    'VITD': (r'\b(?:vit(?:amin)?\.?\s?d3?|d3)', 2, 200, None),
    'B12': (r'\b(?:vit(?:amin)?\.?\s?)?b12', 50, 3000, None),
    'ALT': (r'\b(?:alt|sgpt)', 3, 3000, None),
    'AST': (r'\b(?:ast|sgot)', 3, 3000, None),
    'ALP': (r'\balp', 10, 2000, None),
    'CRP': (r'\bcrp', 0, 500, None),
    'ESR': (r'\besr', 1, 150, None),
    'INR': (r'\binr', 0.5, 10, None),
    'UA': (r'\buric\s+acid', 1, 20, None),
    'CA': (r'\b(?:calcium|cacium|s\.?\s?ca)', 5, 15, None),
    'UACR': (r'\b(?:uacr|microalbumin[a-z]*)', 0, 5000, None),
    'PSA': (r'\bpsa', 0, 1000, None),
}
COMPILED = {k: re.compile(v[0] + SEP + NUM + r'(?!\s*(?:yrs?|years?|days?|months?|weeks?|mm\b))', re.I) for k, v in LAB_RX.items()}
BP_RX = re.compile(r'\b(?:bp|b\.p)\s*(?:is|=|:|was)?\s*(?:on\s+average\s*)?(\d{2,3})\s*/\s*(\d{2,3})', re.I)
PR_RX = re.compile(r'\b(?:pr|hr|pulse(?:\s+rate)?)\s*(?:is|=|:)?\s*(\d{2,3})\b', re.I)
SPO2_RX = re.compile(r'\bspo2\s*(?:is|=|:)?\s*(\d{2,3})\b', re.I)


def extract_labs(text):
    out = {}
    if not text:
        return out
    t = text.replace('\r', ' ')
    for code, rx in COMPILED.items():
        lo, hi, mm = LAB_RX[code][1], LAB_RX[code][2], LAB_RX[code][3]
        for m in rx.finditer(t):
            pre = t[max(0, m.start() - 12):m.start()].lower()
            if re.search(r'\b(?:was|prev(?:ious)?\.?|before|ago)\s*$', pre):
                continue                       # a past value quoted in the history
            v = float(m.group(1))
            if mm and v < mm[0]:
                continue                       # probably mmol/L or a typo — not converted, left in the notes only
            if lo <= v <= hi:
                out.setdefault(code, v)        # first mention wins
                break
    return out


def extract_vitals(text):
    v = {}
    if not text:
        return v
    m = BP_RX.search(text)
    if m:
        s, d = int(m.group(1)), int(m.group(2))
        if 70 <= s <= 260 and 40 <= d <= 160 and s > d:
            v['bp_sys'], v['bp_dia'] = s, d
    m = PR_RX.search(text)
    if m and 35 <= int(m.group(1)) <= 200:
        v['hr'] = int(m.group(1))
    m = SPO2_RX.search(text)
    if m and 70 <= int(m.group(1)) <= 100:
        v['spo2'] = int(m.group(1))
    return v


def lines(s):
    return [x.strip() for x in re.split(r'[\n,،]+', s or '') if x.strip()]


def main(src, db_path=None, export_date='2026-11-07'):
    db_path = db_path or os.path.join(ROOT, 'data', 'clinic.db')
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    if os.path.exists(db_path):
        bk = db_path + '.before_import_' + datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        shutil.copy2(db_path, bk)
        print('Old database backed up to', bk)
        keep_users = connect(db_path).execute('SELECT name, role, pin, active FROM users').fetchall()
        keep_meta = connect(db_path).execute('SELECT k, v FROM meta').fetchall()
        for ext in ('', '-wal', '-shm'):
            if os.path.exists(db_path + ext):
                os.remove(db_path + ext)
    else:
        keep_users, keep_meta = [], []
    data = json.load(open(src, encoding='utf-8'))
    conn = connect(db_path)
    init_schema(conn)
    for u in keep_users:
        conn.execute('INSERT OR REPLACE INTO users(name,role,pin,active) VALUES(?,?,?,?)', tuple(u))
    for k, v in keep_meta:
        conn.execute('INSERT OR REPLACE INTO meta VALUES(?,?)', (k, v))
    year = int(export_date[:4])
    by_name = {}
    dup_names = []
    for p in data['patients']:
        g = {'ذكر': 'M', 'أنثى': 'F', 'انثى': 'F'}.get((p.get('gender') or '').strip())
        by = year - int(p['age']) if str(p.get('age') or '').isdigit() else None
        chronic = '\n'.join(x.strip() for x in (p.get('chronic') or '').split(',') if x.strip()) or None
        allergy = '\n'.join(x.strip() for x in (p.get('allergy') or '').split(',') if x.strip()) or None
        pid = conn.execute('''INSERT INTO patients(legacy_id,name,name_norm,gender,birth_year,phone,phone_norm,address,chronic,allergies,created_by)
                              VALUES(?,?,?,?,?,?,?,?,?,?,'import')''',
                           (str(p['id']), p['name'], norm_name(p['name']), g, by, p.get('phone') or None,
                            norm_phone(p.get('phone')), p.get('address') or None, chronic, allergy)).lastrowid
        if p['name'] in by_name:
            dup_names.append(p['name'])
        else:
            by_name[p['name']] = pid
    nlab = collections.Counter()
    drugs = collections.Counter()
    dxs = collections.Counter()
    last_weight = {}
    for v in sorted(data['visits'], key=lambda x: (x['date'], int(x.get('old_id') or 0))):
        pid = by_name.get(v['patient'])
        if not pid:
            continue
        notes = v.get('notes')
        vit = extract_vitals(notes)
        w = None
        try:
            w = float(v['weight']) if v.get('weight') else None
        except ValueError:
            pass
        vid = conn.execute('''INSERT INTO visits(patient_id,legacy_id,date,diagnosis,plan,notes,weight,price,bp_sys,bp_dia,hr,spo2,legacy)
                              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)''',
                           (pid, v.get('old_id'), v['date'], v.get('dx'), v.get('plan'), notes, w,
                            float(v['cost']) / 1000 if v.get('cost') else None, vit.get('bp_sys'), vit.get('bp_dia'), vit.get('hr'), vit.get('spo2'))).lastrowid
        for i, m in enumerate(v.get('meds') or []):
            line = re.sub(r'\s+', ' ', m['name']).strip()
            conn.execute('INSERT INTO visit_meds(visit_id,seq,line) VALUES(?,?,?)', (vid, i, line))
            drugs[line] += 1
        if v.get('dx'):
            dxs[re.sub(r'\s+', ' ', v['dx']).strip()] += 1
        for code, val in extract_labs((notes or '') + '\n' + (v.get('plan') or '')).items():
            conn.execute("INSERT INTO labs(patient_id,visit_id,date,code,value,source) VALUES(?,?,?,?,?,'imported')", (pid, vid, v['date'], code, val))
            nlab[code] += 1
        conn.execute('UPDATE patients SET updated_at=? WHERE id=?', (v['date'] + ' 12:00:00', pid))
    for line, n in drugs.items():
        conn.execute('INSERT OR IGNORE INTO drugs(line,uses) VALUES(?,?)', (line, n))
    for d, n in dxs.items():
        conn.execute('INSERT OR IGNORE INTO diagnoses(name,uses) VALUES(?,?)', (d, n))
    areas = collections.Counter(re.sub(r'\s+', ' ', p['address']).strip() for p in data['patients'] if p.get('address'))
    for a, n in areas.items():
        conn.execute("INSERT OR IGNORE INTO vocab(kind,name,uses) VALUES('area',?,?)", (a, n))
    conn.execute("INSERT OR REPLACE INTO meta VALUES('import_date', ?)", (export_date,))
    conn.execute("INSERT OR REPLACE INTO meta VALUES('dup_names', ?)", (json.dumps(sorted(set(dup_names)), ensure_ascii=False),))
    conn.commit()
    c = lambda q: conn.execute(q).fetchone()[0]
    print('Patients:', c('SELECT COUNT(*) FROM patients'))
    print('Visits:', c('SELECT COUNT(*) FROM visits'), '| medication lines:', c('SELECT COUNT(*) FROM visit_meds'))
    print('Saved addresses:', c("SELECT COUNT(*) FROM vocab WHERE kind='area'"))
    print('Drug catalogue:', c('SELECT COUNT(*) FROM drugs'), '| diagnoses:', c('SELECT COUNT(*) FROM diagnoses'))
    print('Lab values extracted from notes:', sum(nlab.values()), dict(nlab.most_common()))
    print('Visits with BP from notes:', c('SELECT COUNT(*) FROM visits WHERE bp_sys IS NOT NULL'))
    print('Duplicate names (visits attached to the first record):', len(set(dup_names)))
    conn.close()


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
