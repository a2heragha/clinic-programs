# -*- coding: utf-8 -*-
"""دوال مشتركة بين الخادم وسكربت النقل. مكتبة بايثون القياسية فقط."""
import re
import colorsys
import sqlite3
import os

HERE = os.path.dirname(os.path.abspath(__file__))

_AR_DIAC = re.compile(r'[ً-ْـ]')


def norm_name(s):
    """توحيد الكتابة العربية للبحث والمقارنة."""
    s = str(s or '').strip()
    s = re.sub('[أإآٱ]', 'ا', s)
    s = s.replace('ة', 'ه').replace('ى', 'ي').replace('ؤ', 'و').replace('ئ', 'ي')
    s = _AR_DIAC.sub('', s)
    s = re.sub(r'\s+', ' ', s)
    return s.lower()


_AR_DIGITS = str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')


def norm_phone(p):
    d = re.sub(r'\D', '', str(p or '').translate(_AR_DIGITS))
    if len(d) >= 9:
        return d[-10:]
    return ''


def connect(path):
    conn = sqlite3.connect(path, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    conn.execute('PRAGMA synchronous=NORMAL')
    return conn


def init_schema(conn):
    with open(os.path.join(HERE, 'schema.sql'), encoding='utf-8') as f:
        conn.executescript(f.read())
    cols = [r[1] for r in conn.execute('PRAGMA table_info(patients)')]
    if 'private_note' not in cols:
        conn.execute('ALTER TABLE patients ADD COLUMN private_note TEXT')
    if 'xray' not in cols:
        conn.execute('ALTER TABLE patients ADD COLUMN xray INTEGER DEFAULT 0')
    acols = [r[1] for r in conn.execute('PRAGMA table_info(appointments)')]
    for c, t in (('phone', 'TEXT'), ('age', 'TEXT'), ('area', 'TEXT'), ('uid', 'TEXT'), ('updated_at', 'INTEGER'),
                 ('synced_at', 'INTEGER'), ('deleted', 'INTEGER DEFAULT 0'), ('doctor', 'TEXT')):
        if c not in acols:
            conn.execute('ALTER TABLE appointments ADD COLUMN %s %s' % (c, t))
    import uuid, time
    for (aid,) in conn.execute('SELECT id FROM appointments WHERE uid IS NULL').fetchall():
        conn.execute('UPDATE appointments SET uid=?, updated_at=COALESCE(updated_at, ?), deleted=COALESCE(deleted,0) WHERE id=?',
                     (uuid.uuid4().hex, int(time.time() * 1000), aid))
    conn.execute('CREATE UNIQUE INDEX IF NOT EXISTS ix_appt_uid ON appointments(uid)')
    dcols = [r[1] for r in conn.execute('PRAGMA table_info(doctors)')]
    for c in ('full_name', 'deg1', 'deg2', 'color'):
        if c not in dcols:
            conn.execute('ALTER TABLE doctors ADD COLUMN %s TEXT' % c)
    seed_rx(conn)
    ecols = [r[1] for r in conn.execute('PRAGMA table_info(expenses)')]
    if 'paid' not in ecols:   # NULL = paid in full (all older rows)
        conn.execute('ALTER TABLE expenses ADD COLUMN paid REAL')
    # appointment statuses: "انتهى" (done) was removed — such appointments count as "حضر" (arrived)
    conn.execute("UPDATE appointments SET status='arrived', updated_at=? WHERE status='done'", (int(time.time() * 1000),))
    pcols = [r[1] for r in conn.execute('PRAGMA table_info(payments)')]
    if 'work_id' not in pcols:
        conn.execute('ALTER TABLE payments ADD COLUMN work_id INTEGER REFERENCES works(id) ON DELETE CASCADE')
    conn.commit()


# نسخة د. مهند يونس — عيادات اونيكس لطب الاسنان
DOCTOR_INFO = {
    'Younis': ('مهند يونس حامد', 'بكالوريوس طب وجراحة الفم والاسنان', 'ماجستير جراحة الفم والوجه والفكين'),
}
EXTRACTION = 'استمر بالضغط على القطنة لنصف ساعة، لا تستخدم قطنة اخرى، تجنب المضمضة والتدخين في اليوم الاول، وجود لون دم في اللعاب امر طبيعي في اليوم الاول'
RX_TEMPLATES = [
    ('بعد القلع — شراب', ['Amoxiclav syr 1×3', 'Metronidazole syr 1×3', 'Ibuprofen syr 1×3'], EXTRACTION),
    ('بعد القلع — حبوب', ['Amoxiclav tab 625 mg 1×3', 'Metronidazole tab 500 mg 1×3', 'Potafast sachet عند الحاجة'], EXTRACTION),
    ('بعد الحشوة', ['Potafast sachet عند الحاجة'],
     'قد يشعر المريض بألم عند تعرض سنه المحشو حديثا للبرودة، وذلك يعتمد على عمق التسوس، يزول الالم تدريجيا، تناول المسكنات الموصوفة حسب الجرعة المحددة'),
    ('بعد حشوة الجذر', ['Voltfast sachet (عند الحاجة)'],
     'من الطبيعي حدوث الم بعد جلسة حشوة الجذر، يزول الالم تدريجيا بعد بضعة ايام، راجع الطبيب في حال الاحساس بارتفاع في الحشوة او في حال التأكد من سقوط الحشوة المؤقتة بالكامل'),
]
CLINIC_FOOTER = 'عيادة اونيكس\nالحي الزراعي، قرب مرطبات ميلكي\nرقم الهاتف : 07707431176'
CLINIC_TITLE = 'عيادات اونيكس لطب الاسنان'


def seed_rx(conn):
    """Prescription data — only on first run."""
    for code, (full, d1, d2) in DOCTOR_INFO.items():
        conn.execute("UPDATE doctors SET full_name=?, deg1=?, deg2=? WHERE name=? AND (full_name IS NULL OR full_name='')", (full, d1, d2, code))
    if conn.execute("SELECT 1 FROM meta WHERE k='rx_seeded'").fetchone():
        return
    import json
    for name, drugs, note in RX_TEMPLATES:
        conn.execute('INSERT INTO rx_templates(name,drugs,note) VALUES(?,?,?)', (name, json.dumps(drugs, ensure_ascii=False), note))
        for d in drugs:
            conn.execute('INSERT OR IGNORE INTO rx_drugs(name) VALUES(?)', (d,))
        conn.execute('INSERT OR IGNORE INTO rx_notes(name) VALUES(?)', (note,))
    conn.execute("INSERT OR REPLACE INTO meta VALUES('clinic_footer', ?)", (CLINIC_FOOTER,))
    conn.execute("INSERT OR REPLACE INTO meta VALUES('clinic_title', ?)", (CLINIC_TITLE,))
    conn.execute("INSERT OR REPLACE INTO meta VALUES('rx_seeded', '1')")


PAT_FIELDS = ['form_no', 'name', 'dob', 'phone', 'area', 'medical', 'p_factor', 'private_note']


def merge_patients(conn, keep_id, drop_id):
    """دمج drop في keep: تعبئة الحقول الفارغة، نقل الأعمال والدفعات والروابط."""
    if keep_id == drop_id:
        return
    k = conn.execute('SELECT * FROM patients WHERE id=?', (keep_id,)).fetchone()
    d = conn.execute('SELECT * FROM patients WHERE id=?', (drop_id,)).fetchone()
    if not k or not d:
        return
    order = eff_keys(conn, keep_id) + eff_keys(conn, drop_id)
    upd = {}
    for f in PAT_FIELDS:
        kv, dv = k[f], d[f]
        if (kv is None or str(kv).strip() == '') and dv not in (None, ''):
            upd[f] = dv
        elif f in ('medical', 'private_note') and dv and kv and norm_name(dv) not in norm_name(kv):
            upd[f] = kv + ' | ' + dv
        elif f == 'phone' and dv and kv and norm_phone(dv) and norm_phone(dv) != norm_phone(kv):
            upd[f] = kv + ' / ' + dv
    if (d['xray'] if 'xray' in d.keys() else 0) and not (k['xray'] if 'xray' in k.keys() else 0):
        upd['xray'] = 1
    ids = [x for x in (k['legacy_ids'] or '').split(',') + (d['legacy_ids'] or '').split(',') if x]
    upd['legacy_ids'] = ','.join(ids)
    if 'phone' in upd:
        upd['phone_norm'] = norm_phone(upd['phone'])
    sets = ', '.join('%s=?' % c for c in upd)
    conn.execute('UPDATE patients SET %s, updated_at=datetime(\'now\',\'localtime\') WHERE id=?' % sets,
                 list(upd.values()) + [keep_id])

    # الأعمال: نقل مع حذف المكرر حرفياً
    seen = set()
    for w in conn.execute('SELECT date,tooth,work_type,doctor,details,legacy_cost,legacy_paid FROM works WHERE patient_id=?', (keep_id,)):
        seen.add(tuple(w))
    for w in conn.execute('SELECT * FROM works WHERE patient_id=?', (drop_id,)).fetchall():
        key = (w['date'], w['tooth'], w['work_type'], w['doctor'], w['details'], w['legacy_cost'], w['legacy_paid'])
        if key in seen:
            conn.execute('DELETE FROM works WHERE id=?', (w['id'],))
        else:
            seen.add(key)
            conn.execute('UPDATE works SET patient_id=? WHERE id=?', (keep_id, w['id']))
    conn.execute('UPDATE payments SET patient_id=? WHERE patient_id=?', (keep_id, drop_id))
    conn.execute('UPDATE payments SET payer_id=? WHERE payer_id=?', (keep_id, drop_id))
    for l in conn.execute('SELECT * FROM links WHERE a_id=? OR b_id=?', (drop_id, drop_id)).fetchall():
        a = keep_id if l['a_id'] == drop_id else l['a_id']
        b = keep_id if l['b_id'] == drop_id else l['b_id']
        conn.execute('DELETE FROM links WHERE id=?', (l['id'],))
        if a != b:
            conn.execute('INSERT OR IGNORE INTO links(a_id,b_id,relation) VALUES(?,?,?)', (a, b, l['relation']))
    conn.execute('UPDATE dup_candidates SET a_id=? WHERE a_id=?', (keep_id, drop_id))
    conn.execute('UPDATE dup_candidates SET b_id=? WHERE b_id=?', (keep_id, drop_id))
    conn.execute("UPDATE dup_candidates SET status='merged' WHERE a_id=b_id")
    conn.execute('DELETE FROM patients WHERE id=?', (drop_id,))
    alive = set(r[0] for r in conn.execute('SELECT id FROM works WHERE patient_id=?', (keep_id,)))
    order = [o for o in order if o[2] in alive]
    order.sort(key=lambda o: (o[0], o[1]))
    for i, o in enumerate(order, 1):
        conn.execute('UPDATE works SET seq=? WHERE id=?', (i, o[2]))


def eff_keys(conn, pid):
    """مفاتيح ترتيب: الزيارة بلا تاريخ تأخذ تاريخ الزيارة التي قبلها كي تبقى في مكانها."""
    out, last = [], '0000-00-00'
    for r in conn.execute('SELECT id,date,seq FROM works WHERE patient_id=? ORDER BY seq, id', (pid,)):
        if r['date']:
            last = r['date']
        out.append((last, r['seq'] or 0, r['id']))
    return out


# ------------------------------------------------------------------ doctor colours (appointments: desktop, LAN phone page, Google phone page)
DOC_MAIN_COLORS = [('#ece3fb', '#6b3fbf'), ('#fde5cc', '#c2620f'), ('#cfefe9', '#0f8a78')]
DOC_EXTRA_COLORS = [('#dfe9f6', '#3d6390'), ('#f7dfea', '#9c3f69'), ('#eaf0d2', '#6d7d1b'), ('#f3e9d9', '#86622a')]


def text_color(bg):
    """a dark, readable text colour of the same hue as the (light) row colour chosen in Settings"""
    try:
        r, g, b = (int(bg.lstrip('#')[i:i + 2], 16) / 255 for i in (0, 2, 4))
    except Exception:
        return '#333333'
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    r, g, b = colorsys.hls_to_rgb(h, 0.32, max(s, 0.55) if s > 0.04 else 0)
    return '#%02x%02x%02x' % (round(r * 255), round(g * 255), round(b * 255))


def doc_styles(conn):
    """[[code, label, row colour, text colour], ...] in the order used to sort appointments:
    the first three active doctors (in the order they were added), then the other active doctors."""
    out = []
    docs = conn.execute('SELECT * FROM doctors WHERE active=1 ORDER BY id').fetchall()
    for i, d in enumerate(docs):
        first = (d['full_name'] or '').strip().split(' ')[0] if (d['full_name'] or '').strip() else ''
        label = 'د. ' + first if first else d['name']
        dflt = DOC_MAIN_COLORS[i] if i < 3 else DOC_EXTRA_COLORS[(i - 3) % len(DOC_EXTRA_COLORS)]
        c = (d['color'] or '').strip()
        bg, fg = (c, text_color(c)) if re.match(r'^#[0-9a-fA-F]{6}$', c) else dflt
        out.append([d['name'], label, bg, fg])
    return out


# ------------------------------------------------------------------ prayer times
# app/prayer_times.json ships with the program (Mosul, 2026-11 … 2027-10); a year imported from Settings is saved
# in data/prayer_times.json (next to the database) and takes priority, so program updates never overwrite it.
import json as _json
import datetime as _dt
PRAYER_DEFAULTS = {'asr': ('صلاة العصر', 0), 'maghrib': ('صلاة المغرب', 1), 'isha': ('صلاة العشاء', 2)}
_PT = {'t': None, 'mtime': None}


def _user_prayer_file():
    return os.path.join(os.path.dirname(HERE), 'data', 'prayer_times.json')


def prayer_table():
    paths = [os.path.join(HERE, 'prayer_times.json'), _user_prayer_file()]
    mt = tuple(os.path.getmtime(p) if os.path.exists(p) else 0 for p in paths)
    if _PT['mtime'] != mt:
        t = {}
        for p in paths:
            if os.path.exists(p):
                try:
                    with open(p, encoding='utf-8') as f:
                        t.update(_json.load(f))
                except Exception:
                    pass
        _PT.update(t=t, mtime=mt)
    return _PT['t']


def save_prayer_table(table):
    p = _user_prayer_file()
    old = {}
    if os.path.exists(p):
        try:
            with open(p, encoding='utf-8') as f:
                old = _json.load(f)
        except Exception:
            old = {}
    old.update(table)
    with open(p, 'w', encoding='utf-8') as f:
        _json.dump(old, f, separators=(',', ':'))
    _PT['mtime'] = None


def prayer_cfg(conn):
    r = conn.execute("SELECT v FROM meta WHERE k='prayer_cfg'").fetchone()
    cfg = {k: {'on': True, 'before': 15, 'after': 15} for k in PRAYER_DEFAULTS}
    if r and r[0]:
        try:
            for k, v in _json.loads(r[0]).items():
                if k in cfg:
                    cfg[k].update(v)
        except ValueError:
            pass
    return cfg


def prayers_for(conn, date, cfg=None):
    """[{key, label, time (start: 'before' minutes ahead of the prayer), at (the prayer), end ('after' minutes after it)}]"""
    cfg = cfg or prayer_cfg(conn)
    day = prayer_table().get(date)
    out = []
    if not day:
        return out
    for k, (label, i) in PRAYER_DEFAULTS.items():
        c = cfg.get(k) or {}
        if not c.get('on') or i >= len(day) or not day[i]:
            continue
        h, m = map(int, day[i].split(':'))
        p = _dt.datetime(2000, 1, 1, h, m)
        t = p - _dt.timedelta(minutes=int(c.get('before') or 0))
        e = p + _dt.timedelta(minutes=int(c.get('after') or 0))
        out.append({'key': k, 'label': label, 'time': t.strftime('%H:%M'), 'at': day[i], 'end': e.strftime('%H:%M')})
    return out


def parse_prayer_xlsx(data):
    """{'YYYY-MM-DD': [asr, maghrib, isha] (24h)} from an Excel file with columns التاريخ … العصر، المغرب، العشاء.
    Standard library only (zipfile + xml). Afternoon/evening times written as 02:52 are read as 14:52."""
    import zipfile, io, re as _re
    import xml.etree.ElementTree as ET
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    z = zipfile.ZipFile(io.BytesIO(data))
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', ns):
            shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % ns['m'])))

    def col(ref):
        n = 0
        for ch in _re.match(r'[A-Z]+', ref).group(0):
            n = n * 26 + ord(ch) - 64
        return n - 1

    def val(c):
        t = c.get('t')
        if t == 's':
            v = c.find('m:v', ns)
            return shared[int(v.text)] if v is not None else ''
        if t == 'inlineStr':
            return ''.join(x.text or '' for x in c.iter('{%s}t' % ns['m']))
        v = c.find('m:v', ns)
        return v.text if v is not None else ''

    def as_time(v, add12):
        v = str(v or '').strip()
        m = _re.match(r'^(\d{1,2})[:.](\d{2})', v)
        if m:
            h, mi = int(m.group(1)), int(m.group(2))
        else:
            try:
                f = float(v)
            except ValueError:
                return None
            if not 0 <= f < 1:
                return None
            mins = round(f * 1440)
            h, mi = divmod(mins, 60)
        if add12 and h < 12:
            h += 12
        return '%02d:%02d' % (h, mi)

    def as_date(v):
        v = str(v or '').strip()
        m = _re.match(r'^(\d{4})[/-](\d{1,2})[/-](\d{1,2})', v)
        if m:
            return '%s-%02d-%02d' % (m.group(1), int(m.group(2)), int(m.group(3)))
        m = _re.match(r'^(\d{1,2})[/-](\d{1,2})[/-](\d{4})', v)
        if m:
            return '%s-%02d-%02d' % (m.group(3), int(m.group(2)), int(m.group(1)))
        try:
            f = float(v)
            if 30000 < f < 80000:
                return (_dt.date(1899, 12, 30) + _dt.timedelta(days=int(f))).isoformat()
        except ValueError:
            pass
        return None

    out = {}
    for name in sorted(n for n in z.namelist() if _re.match(r'xl/worksheets/sheet\d+\.xml$', n)):
        root = ET.fromstring(z.read(name))
        cols = None
        for row in root.iter('{%s}row' % ns['m']):
            cells = {}
            for c in row.findall('m:c', ns):
                cells[col(c.get('r'))] = val(c)
            texts = {i: str(v).strip() for i, v in cells.items()}
            if cols is None or 'التاريخ' in texts.values():
                found = {}
                for i, v in texts.items():
                    for key, word in (('date', 'التاريخ'), ('asr', 'العصر'), ('maghrib', 'المغرب'), ('isha', 'العشاء')):
                        if v == word or (word in v and key != 'date' and len(v) < 12):
                            found.setdefault(key, i)
                if len(found) == 4:
                    cols = found
                    continue
            if not cols:
                continue
            d = as_date(cells.get(cols['date']))
            if not d:
                continue
            ts = [as_time(cells.get(cols[k]), True) for k in ('asr', 'maghrib', 'isha')]
            if all(ts):
                out[d] = ts
    return out
