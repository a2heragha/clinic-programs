# -*- coding: utf-8 -*-
"""Shared helpers (server + import script). Python standard library only."""
import os, re, sqlite3, hashlib, secrets

HERE = os.path.dirname(os.path.abspath(__file__))
_AR_DIAC = re.compile(r'[ً-ْـ]')
_AR_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')


def norm_name(s):
    s = str(s or '').strip()
    s = re.sub('[أإآٱ]', 'ا', s)
    s = s.replace('ة', 'ه').replace('ى', 'ي').replace('ؤ', 'و').replace('ئ', 'ي')
    s = _AR_DIAC.sub('', s)
    s = re.sub(r'\s+', ' ', s)
    return s.lower()


def norm_phone(p):
    d = re.sub(r'\D', '', str(p or '').translate(_AR_DIGITS))
    return d[-10:] if len(d) >= 9 else ''


def connect(path):
    conn = sqlite3.connect(path, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    conn.execute('PRAGMA synchronous=NORMAL')
    return conn


# code, name, unit, low, high, target, group
LAB_TESTS = [
    ('HBA1C', 'HbA1c', '%', None, 5.7, 7.0, 'Diabetes'),
    ('FBS', 'Fasting blood sugar', 'mg/dL', 70, 100, None, 'Diabetes'),
    ('RBS', 'Random blood sugar', 'mg/dL', 70, 140, None, 'Diabetes'),
    ('TC', 'Total cholesterol', 'mg/dL', None, 200, None, 'Lipids'),
    ('LDL', 'LDL-C', 'mg/dL', None, 100, 70, 'Lipids'),
    ('HDL', 'HDL-C', 'mg/dL', 40, None, None, 'Lipids'),
    ('TG', 'Triglycerides', 'mg/dL', None, 150, None, 'Lipids'),
    ('CREAT', 'Creatinine', 'mg/dL', 0.6, 1.3, None, 'Renal'),
    ('UREA', 'Blood urea', 'mg/dL', 15, 45, None, 'Renal'),
    ('EGFR', 'eGFR (CKD-EPI 2021)', 'mL/min/1.73m²', 60, None, None, 'Renal'),
    ('UACR', 'Urine albumin/creatinine', 'mg/g', None, 30, None, 'Renal'),
    ('NA', 'Sodium', 'mmol/L', 135, 145, None, 'Electrolytes'),
    ('K', 'Potassium', 'mmol/L', 3.5, 5.1, None, 'Electrolytes'),
    ('CA', 'Calcium', 'mg/dL', 8.5, 10.5, None, 'Electrolytes'),
    ('UA', 'Uric acid', 'mg/dL', 3.5, 7.2, None, 'Electrolytes'),
    ('TSH', 'TSH', 'mIU/L', 0.4, 4.0, None, 'Thyroid'),
    ('FT4', 'Free T4', 'ng/dL', 0.8, 1.8, None, 'Thyroid'),
    ('HB', 'Haemoglobin', 'g/dL', 12, 16.5, None, 'CBC'),
    ('WBC', 'WBC', '×10⁹/L', 4, 11, None, 'CBC'),
    ('PLT', 'Platelets', '×10⁹/L', 150, 450, None, 'CBC'),
    ('EOS', 'Eosinophil count', 'cells/µL', None, 500, None, 'CBC'),
    ('FERRITIN', 'Ferritin', 'ng/mL', 15, 300, None, 'Haematinics'),
    ('VITD', 'Vitamin D', 'ng/mL', 30, 100, None, 'Haematinics'),
    ('B12', 'Vitamin B12', 'pg/mL', 200, 900, None, 'Haematinics'),
    ('ALT', 'ALT', 'U/L', None, 40, None, 'Liver'),
    ('AST', 'AST', 'U/L', None, 40, None, 'Liver'),
    ('ALP', 'ALP', 'U/L', 40, 130, None, 'Liver'),
    ('TBIL', 'Total bilirubin', 'mg/dL', 0.2, 1.2, None, 'Liver'),
    ('ALB', 'Albumin', 'g/dL', 3.5, 5.0, None, 'Liver'),
    ('CRP', 'CRP', 'mg/L', None, 5, None, 'Inflammation'),
    ('ESR', 'ESR', 'mm/h', None, 20, None, 'Inflammation'),
    ('INR', 'INR', '', 0.8, 1.2, None, 'Coagulation'),
    ('PSA', 'PSA', 'ng/mL', None, 4, None, 'Other'),
]

DEFAULT_META = {
    'clinic_name': 'عيادة الدكتور زكريا سمير العزو',
    'doctor_name': 'د. زكريا سمير العزو',
    'doctor_degree': 'دكتوراه (بورد) في الطب الباطني — زميل المجلس العربي للاختصاصات الطبية',
    'clinic_address': 'موصل - شارع المصارف - مجاور صيدلية رؤية',
    'clinic_phone': '0776 942 8730 - 0750 022 7803',
    'visit_price': '15',        # in thousands IQD (15 = 15,000)
    # A5 paper with a pre-printed header / patient line / footer (positions measured from the clinic's sheet)
    'rx_header': '0',           # 0 = paper is pre-printed, 1 = plain paper (the program prints the header)
    'rx_line_mm': '55',         # height of the dotted patient line (name / date / age) from the top edge
    'rx_top_mm': '80',          # where the medications start (below the printed Rx sign)
    'rx_bottom_mm': '27',       # stop above the printed footer
    'rx_side_mm': '14',
    'rx_off_x': '0',            # printer calibration: shift everything right (+) / left (−) in mm
    'rx_off_y': '0',            # shift down (+) / up (−) in mm
    'rx_font_pt': '12',
}


VISIT_TPLS = [
    ('Follow-up · Diabetes', '[]', 'Type 2 diabetes mellitus',
     'HbA1c, FBS, lipid profile, creatinine/eGFR, urine ACR every 3-6 mo; yearly fundus & foot exam. Diet, walking 30 min/day.',
     'DM follow-up. Hypoglycaemia: no. Compliance: good. Home glucose readings: ',
     'Feet: pulses +, no ulcer, monofilament intact.', 90),
    ('Follow-up · Hypertension', '[]', 'Essential hypertension',
     'Target BP <130/80. Low salt diet. Home BP log. Creatinine, K+, urine ACR, lipids yearly.',
     'HTN follow-up. Headache / chest pain / dyspnoea: no. Home BP: ', 'CVS: S1 S2 normal, no oedema.', 60),
    ('Follow-up · Thyroid', '[]', 'Hypothyroidism',
     'TSH (± FT4) after 6-8 weeks of any dose change, then every 6-12 mo. Take levothyroxine fasting, 30-60 min before breakfast.',
     'Thyroid follow-up. Fatigue / weight change / palpitations: ', 'Thyroid: no goitre. Pulse regular.', 60),
]


_LATIN = re.compile(r'(?<![µμ])[a-z]+')     # µg stays µg


def drug_caps(s):
    """drug lines in capitals: only the Latin letters change (Arabic instructions, numbers and µ stay as they are)"""
    return _LATIN.sub(lambda m: m.group(0).upper(), str(s or ''))


def caps_all_drugs(conn):
    """one time: every drug already in the database in capitals (prescriptions, suggestions, ready prescriptions, regular medicines)"""
    import json
    for vid, seq, line in conn.execute('SELECT id, seq, line FROM visit_meds').fetchall():
        if line and drug_caps(line) != line:
            conn.execute('UPDATE visit_meds SET line=? WHERE id=?', (drug_caps(line), vid))
    for did, line, uses in conn.execute('SELECT id, line, uses FROM drugs').fetchall():
        up = drug_caps(line)
        if up == line:
            continue
        ex = conn.execute('SELECT id FROM drugs WHERE line=? AND id<>?', (up, did)).fetchone()
        if ex:                                   # the capital form exists already: merge the use counts
            conn.execute('UPDATE drugs SET uses=uses+? WHERE id=?', (uses or 0, ex[0]))
            conn.execute('DELETE FROM drugs WHERE id=?', (did,))
        else:
            conn.execute('UPDATE drugs SET line=? WHERE id=?', (up, did))
    for tid, lines in conn.execute('SELECT id, lines FROM rx_templates').fetchall():
        try:
            ls = json.loads(lines or '[]')
        except ValueError:
            continue
        up = [drug_caps(x) for x in ls]
        if up != ls:
            conn.execute('UPDATE rx_templates SET lines=? WHERE id=?', (json.dumps(up, ensure_ascii=False), tid))
    for pid, lm in conn.execute("SELECT id, long_meds FROM patients WHERE COALESCE(long_meds,'')<>''").fetchall():
        if drug_caps(lm) != lm:
            conn.execute('UPDATE patients SET long_meds=? WHERE id=?', (drug_caps(lm), pid))


def init_schema(conn):
    with open(os.path.join(HERE, 'schema.sql'), encoding='utf-8') as f:
        conn.executescript(f.read())
    # columns added for the online version (older databases are upgraded in place)
    def add(table, col, decl):
        if col not in [r[1] for r in conn.execute('PRAGMA table_info(%s)' % table)]:
            conn.execute('ALTER TABLE %s ADD COLUMN %s %s' % (table, col, decl))
    add('appointments', 'uid', 'TEXT')
    add('appointments', 'updated_at', 'INTEGER DEFAULT 0')
    add('appointments', 'synced_at', 'INTEGER')
    add('appointments', 'deleted', 'INTEGER DEFAULT 0')
    add('patients', 'online_uid', 'TEXT')
    add('appointments', 'weight', 'REAL')
    add('appointments', 'kind', "TEXT DEFAULT ''")         # 'auto' = made from the follow-up date of a visit
    add('appointments', 'call', "TEXT DEFAULT ''")         # secretary's phone call: yes / no / noans
    add('appointments', 'hold', 'INTEGER DEFAULT 0')        # 1 = moved to the waiting (recall) list, no date yet
    add('appointments', 'visit_id', 'INTEGER')
    add('appointments', 'reminded', 'INTEGER')               # WhatsApp reminder sent (ms)
    add('visits', 'waist', 'REAL')
    add('visits', 'imaging', 'TEXT')                       # X-ray / US / CT / MRI / echo findings
    add('visits', 'fee_type', "TEXT DEFAULT ''")            # '' paid · review · free
    add('rx_templates', 'complaint', 'TEXT')
    add('rx_templates', 'exam', 'TEXT')
    add('rx_templates', 'follow_days', 'INTEGER')
    conn.execute('CREATE INDEX IF NOT EXISTS ix_appt_visit ON appointments(visit_id)')
    conn.execute('CREATE TABLE IF NOT EXISTS ai_summaries (patient_id INTEGER PRIMARY KEY, h TEXT, text TEXT, at TEXT)')
    if not conn.execute("SELECT 1 FROM meta WHERE k='visit_tpl_seeded'").fetchone():
        for t in VISIT_TPLS:
            if not conn.execute('SELECT 1 FROM rx_templates WHERE name=?', (t[0],)).fetchone():
                conn.execute('INSERT INTO rx_templates(name,lines,diagnosis,plan,complaint,exam,follow_days) VALUES(?,?,?,?,?,?,?)', t)
        conn.execute("INSERT INTO meta(k,v) VALUES('visit_tpl_seeded','1')")
    conn.execute('''CREATE TABLE IF NOT EXISTS links (id INTEGER PRIMARY KEY, a_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
                    b_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE, relation TEXT, created_at TEXT DEFAULT (datetime('now','localtime')))''')
    conn.execute('CREATE INDEX IF NOT EXISTS ix_links_a ON links(a_id)')
    conn.execute('CREATE INDEX IF NOT EXISTS ix_links_b ON links(b_id)')
    conn.execute('CREATE UNIQUE INDEX IF NOT EXISTS ux_appt_uid ON appointments(uid)')
    conn.execute('CREATE INDEX IF NOT EXISTS ix_pat_online ON patients(online_uid)')
    conn.execute('CREATE TABLE IF NOT EXISTS sync_clinical (patient_id INTEGER PRIMARY KEY, h TEXT)')
    import uuid, time
    for (aid,) in conn.execute('SELECT id FROM appointments WHERE uid IS NULL').fetchall():
        conn.execute('UPDATE appointments SET uid=?, updated_at=? WHERE id=?', (uuid.uuid4().hex, int(time.time() * 1000), aid))
    for i, t in enumerate(LAB_TESTS):
        conn.execute('INSERT OR IGNORE INTO lab_tests(code,name,unit,low,high,target,grp,seq) VALUES(?,?,?,?,?,?,?,?)', t + (i,))
    for k, v in DEFAULT_META.items():
        conn.execute('INSERT OR IGNORE INTO meta(k,v) VALUES(?,?)', (k, v))
    if not conn.execute("SELECT 1 FROM meta WHERE k='drugs_caps_done'").fetchone():
        caps_all_drugs(conn)
        conn.execute("INSERT INTO meta(k,v) VALUES('drugs_caps_done','1')")
    conn.commit()


def hash_pin(pin, salt=None):
    salt = salt or secrets.token_hex(8)
    return salt + '$' + hashlib.sha256((salt + str(pin)).encode()).hexdigest()


def check_pin(stored, pin):
    if not stored or '$' not in stored:
        return False
    salt = stored.split('$', 1)[0]
    return secrets.compare_digest(hash_pin(pin, salt), stored)
