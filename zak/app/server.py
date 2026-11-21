# -*- coding: utf-8 -*-
"""
Internal-medicine clinic server — Python standard library only (3.8+).
Runs on the clinic PC; other devices open it in the browser over the local network.
"""
import hashlib, os, sys, json, re, threading, time, datetime, socket, sqlite3, traceback, secrets, shutil
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import errlog         # error log in data/logs and in the database
errlog.setup(ROOT)
import updater          # silent update from GitHub before the program's own modules load
if updater.boot(HERE, os.path.join(ROOT, 'config.json')) and __name__ == '__main__' and not os.environ.get('CLINIC_PHONE'):
    import subprocess
    sys.exit(subprocess.call([sys.executable] + sys.argv))      # run the updated program
import relink
from common import norm_name, norm_phone, connect, init_schema, hash_pin, check_pin, drug_caps
import cloudsync
import features
import handoff

CONFIG_PATH = os.path.join(ROOT, 'config.json')
DEFAULT_CONFIG = {'port': 8080, 'db': 'data/clinic.db', 'backup_dir': 'backups', 'backup_dir2': '', 'backup_keep': 30}


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, encoding='utf-8') as f:
            cfg.update(json.load(f))
    else:
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    return cfg


CFG = load_config()
DB_PATH = CFG['db'] if os.path.isabs(CFG['db']) else os.path.join(ROOT, CFG['db'])
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)


def db():
    return connect(DB_PATH)


def today():
    return datetime.date.today().isoformat()


class ApiError(Exception):
    def __init__(self, msg, code=400):
        super().__init__(msg)
        self.code = code


# ------------------------------------------------------------------ backups
BACKUP_STATE = {'last': None, 'error': None}


def do_backup(tag='auto'):
    stamp = datetime.datetime.now().strftime('%Y-%m-%d_%H%M')
    made = []
    try:
        src = db()
        for d in (CFG['backup_dir'], CFG.get('backup_dir2') or ''):
            if not d:
                continue
            d = d if os.path.isabs(d) else os.path.join(ROOT, d)
            try:
                os.makedirs(d, exist_ok=True)
                path = os.path.join(d, 'clinic_%s_%s.db' % (stamp, tag))
                part = path + '.part'                   # written under a temporary name: a power cut never leaves a broken backup
                dst = sqlite3.connect(part)
                src.backup(dst)
                dst.execute('PRAGMA journal_mode=DELETE')   # one self-contained file
                dst.close()
                os.replace(part, path)
                made.append(path)
                if os.path.isdir(FILES_DIR):              # attached files: copy the ones not yet in the backup folder
                    for dp, _, fns in os.walk(FILES_DIR):
                        for fn in fns:
                            src_f = os.path.join(dp, fn)
                            dst_f = os.path.join(d, 'files', os.path.relpath(src_f, FILES_DIR))
                            if not os.path.exists(dst_f):
                                os.makedirs(os.path.dirname(dst_f), exist_ok=True)
                                shutil.copy2(src_f, dst_f)
                files = sorted(f for f in os.listdir(d) if f.startswith('clinic_') and f.endswith('.db'))
                for old in files[:-int(CFG.get('backup_keep', 30))]:
                    os.remove(os.path.join(d, old))
                BACKUP_STATE['error'] = None
            except Exception as e:
                BACKUP_STATE['error'] = '%s: %s' % (d, e)
        src.close()
        BACKUP_STATE['last'] = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    except Exception as e:
        BACKUP_STATE['error'] = str(e)
    return made


def backup_loop():
    do_backup('start')
    while True:
        time.sleep(6 * 3600)
        do_backup('auto')


# ------------------------------------------------------------------ helpers
def meta(conn):
    return dict(conn.execute('SELECT k, v FROM meta').fetchall())


def num(v, kind=float):
    if v is None or v == '':
        return None
    try:
        x = float(str(v).replace(',', '').strip().translate(str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')))
        return int(round(x)) if kind is int else x
    except ValueError:
        raise ApiError('Invalid number: %s' % v)


def s(v):
    return (str(v).strip() if v is not None else '') or None


def iso(v):
    v = (v or '').strip()
    if v and not re.match(r'^\d{4}-\d{2}-\d{2}$', v):
        raise ApiError('Invalid date: ' + v)
    return v or None


# ------------------------------------------------------------------ patients
PAT_BASIC = ['name', 'gender', 'birth_year', 'dob', 'phone', 'address', 'occupation', 'marital']
PAT_CLINICAL = ['smoking', 'alcohol', 'chronic', 'allergies', 'long_meds', 'past_history', 'personal_note', 'height']


def age_of(p):
    if p.get('dob'):
        try:
            d = datetime.date.fromisoformat(p['dob'])
            t = datetime.date.today()
            return t.year - d.year - ((t.month, t.day) < (d.month, d.day))
        except ValueError:
            pass
    if p.get('birth_year'):
        return datetime.date.today().year - int(p['birth_year'])
    return None


def search(conn, q, limit=40):
    q = (q or '').strip()
    cols = 'id,name,gender,birth_year,dob,phone,address'
    if not q:
        rows = conn.execute('SELECT %s FROM patients ORDER BY updated_at DESC, id DESC LIMIT ?' % cols, (limit,)).fetchall()
    else:
        qn = norm_name(q)
        digits = re.sub(r'\D', '', q.translate(str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')))
        where, args = [], []
        words = [w for w in qn.split(' ') if w and not w.isdigit()]
        if words:
            where.append('(' + ' AND '.join(['name_norm LIKE ?'] * len(words)) + ')')
            args += ['%' + w + '%' for w in words]
        if len(digits) >= 3:
            where.append('phone_norm LIKE ?')
            args.append('%' + digits + '%')
        if digits and len(digits) < 6:
            where.append('id = ?')
            args.append(int(digits))
        if not where:
            return []
        rows = conn.execute('SELECT %s, CASE WHEN name_norm LIKE ? THEN 0 ELSE 1 END rk FROM patients WHERE %s ORDER BY rk, name_norm LIMIT ?'
                            % (cols, ' OR '.join(where)), [qn + '%'] + args + [limit]).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d['age'] = age_of(d)
        lv = conn.execute('SELECT MAX(date) FROM visits WHERE patient_id=?', (d['id'],)).fetchone()[0]
        d['last_visit'] = lv
        out.append(d)
    return out


def similar(conn, name, phone, exclude=None):
    out = {}
    words = [w for w in norm_name(name).split(' ') if w]
    if len(words) >= 2:
        sql = 'SELECT id,name,birth_year,dob,phone,address FROM patients WHERE ' + ' AND '.join(['name_norm LIKE ?'] * len(words)) + ' LIMIT 10'
        for r in conn.execute(sql, ['%' + w + '%' for w in words]):
            out[r['id']] = dict(r, why='similar name')
    pn = norm_phone(phone)
    if pn:
        for r in conn.execute('SELECT id,name,birth_year,dob,phone,address FROM patients WHERE phone_norm=? LIMIT 10', (pn,)):
            out[r['id']] = dict(r, why='same phone')
    out.pop(exclude, None)
    res = list(out.values())
    for d in res:
        d['age'] = age_of(d)
    return res


def save_patient(conn, pid, b, user):
    allowed = PAT_BASIC + (PAT_CLINICAL if user['role'] == 'doctor' else [])
    f = {}
    for k in allowed:
        if k not in b:
            continue
        v = b[k]
        if k == 'birth_year':
            v = num(v, int)
        elif k == 'height':
            v = num(v)
        elif k == 'dob':
            v = iso(v)
        elif k == 'long_meds':
            v = drug_caps(v)
        elif k == 'gender':
            v = v if v in ('M', 'F') else None
        else:
            v = s(v)
        f[k] = v
    if 'age' in b and b.get('age') not in (None, '') and not f.get('dob'):
        f['birth_year'] = datetime.date.today().year - num(b['age'], int)
    if f.get('dob'):
        f['birth_year'] = int(f['dob'][:4])
    if f.get('birth_year') is not None:
        if not 1900 < f['birth_year'] <= datetime.date.today().year:
            raise ApiError('Birth year must be 4 digits, e.g. 1975')
        if pid and 'dob' not in f:
            conn.execute('UPDATE patients SET dob=NULL WHERE id=? AND substr(COALESCE(dob,""),1,4)<>?', (pid, str(f['birth_year'])))
    if pid is None:
        if not f.get('name'):
            raise ApiError('Patient name is required')
        pid = conn.execute('INSERT INTO patients(name,name_norm,created_by) VALUES(?,?,?)',
                           (f['name'], norm_name(f['name']), user['name'])).lastrowid
    elif 'name' in f and not f['name']:
        raise ApiError('Patient name is required')
    if 'name' in f:
        f['name_norm'] = norm_name(f['name'])
    if 'phone' in f:
        f['phone_norm'] = norm_phone(f['phone'])
    if f:
        conn.execute("UPDATE patients SET %s, updated_at=datetime('now','localtime') WHERE id=?" % ', '.join('%s=?' % k for k in f),
                     list(f.values()) + [pid])
    if f.get('occupation'):
        remember_vocab(conn, 'occupation', f['occupation'])
    if f.get('address'):
        remember_vocab(conn, 'area', f['address'])
    return pid


def remember_vocab(conn, kind, name):
    name = re.sub(r'\s+', ' ', (name or '')).strip()
    if name:
        conn.execute('INSERT OR IGNORE INTO vocab(kind,name) VALUES(?,?)', (kind, name))
        conn.execute('UPDATE vocab SET uses=uses+1 WHERE kind=? AND name=?', (kind, name))


def vocab(conn, kind):
    return [r[0] for r in conn.execute('SELECT name FROM vocab WHERE kind=? ORDER BY uses DESC, name', (kind,))]


# ------------------------------------------------------------------ attached files
FILES_DIR = os.path.join(os.path.dirname(DB_PATH), 'files')
MAX_FILE = 25 * 1024 * 1024


def save_file(conn, b, user):
    import base64
    pid = int(b['patient_id'])
    if not conn.execute('SELECT 1 FROM patients WHERE id=?', (pid,)).fetchone():
        raise ApiError('Patient not found')
    data = base64.b64decode(b.get('data') or '')
    if not data:
        raise ApiError('Empty file')
    if len(data) > MAX_FILE:
        raise ApiError('File is larger than 25 MB')
    mime = (b.get('mime') or '').lower()
    if not (mime.startswith('image/') or mime == 'application/pdf'):
        raise ApiError('Only images or PDF files')
    ext = {'application/pdf': '.pdf', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic'}.get(mime, '.jpg')
    rel = os.path.join(str(pid), '%s_%s%s' % (datetime.datetime.now().strftime('%Y%m%d_%H%M%S'), secrets.token_hex(3), ext))
    full = os.path.join(FILES_DIR, rel)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, 'wb') as fh:
        fh.write(data)
    return conn.execute('INSERT INTO files(patient_id,visit_id,date,name,title,mime,path,size,created_by) VALUES(?,?,?,?,?,?,?,?,?)',
                        (pid, b.get('visit_id') or None, iso(b.get('date')) or today(), s(b.get('name')), s(b.get('title')), mime,
                         rel.replace('\\', '/'), len(data), user['name'])).lastrowid


class Raw:
    def __init__(self, data, mime, name=None):
        self.data, self.mime, self.name = data, mime, name


def visit_dict(conn, r):
    v = dict(r)
    v['meds'] = [m['line'] for m in conn.execute('SELECT line FROM visit_meds WHERE visit_id=? ORDER BY seq, id', (v['id'],))]
    return v


def patient_full(conn, pid, user):
    p = conn.execute('SELECT * FROM patients WHERE id=?', (pid,)).fetchone()
    if not p:
        return None
    p = dict(p)
    p['age'] = age_of(p)
    appts = [dict(r) for r in conn.execute("SELECT * FROM appointments WHERE patient_id=? AND date>=? AND COALESCE(deleted,0)=0 ORDER BY date, time", (pid, today()))]
    if user['role'] != 'doctor':
        basic = {k: p.get(k) for k in ['id', 'name', 'gender', 'birth_year', 'dob', 'phone', 'address', 'occupation', 'marital', 'age']}
        n = conn.execute('SELECT COUNT(*), MAX(date) FROM visits WHERE patient_id=?', (pid,)).fetchone()
        nf = conn.execute('SELECT COUNT(*) FROM files WHERE patient_id=?', (pid,)).fetchone()[0]
        fam = [{k: f[k] for k in ('id', 'name', 'relation', 'direct', 'link_id', 'phone')} for f in family(conn, pid)]
        wts = [list(r) for r in conn.execute('SELECT date, weight FROM visits WHERE patient_id=? AND weight IS NOT NULL ORDER BY date DESC LIMIT 8', (pid,))]
        tw = conn.execute('SELECT weight FROM appointments WHERE patient_id=? AND date=? AND weight IS NOT NULL AND COALESCE(deleted,0)=0 ORDER BY id DESC', (pid, today())).fetchone()
        return {'patient': basic, 'visit_count': n[0], 'last_visit': n[1], 'appointments': appts, 'file_count': nf, 'family': fam,
                'weights': wts, 'today_weight': tw[0] if tw else None}
    visits = [visit_dict(conn, r) for r in conn.execute('SELECT * FROM visits WHERE patient_id=? ORDER BY date DESC, id DESC', (pid,))]
    labs = [dict(r) for r in conn.execute('SELECT * FROM labs WHERE patient_id=? ORDER BY date, id', (pid,))]
    files = [dict(r) for r in conn.execute('SELECT id,visit_id,date,name,title,mime,size,created_by FROM files WHERE patient_id=? ORDER BY date DESC, id DESC', (pid,))]
    return {'patient': p, 'visits': visits, 'labs': labs, 'files': files, 'appointments': appts, 'family': family(conn, pid)}


# ------------------------------------------------------------------ visits
VISIT_TEXT = ['complaint', 'exam', 'diagnosis', 'plan', 'imaging', 'notes']
VISIT_INT = ['bp_sys', 'bp_dia', 'hr', 'rr', 'spo2']
VISIT_REAL = ['temp', 'weight', 'height', 'rbs', 'price', 'waist']


def remember(conn, table, col, value):
    value = (value or '').strip()
    if value:
        conn.execute('INSERT OR IGNORE INTO %s(%s) VALUES(?)' % (table, col), (value,))
        conn.execute('UPDATE %s SET uses=uses+1 WHERE %s=?' % (table, col), (value,))


def save_visit(conn, vid, b):
    if vid is None and not b.get('weight') and b.get('patient_id'):
        w = conn.execute('SELECT weight FROM appointments WHERE patient_id=? AND date=? AND weight IS NOT NULL AND COALESCE(deleted,0)=0 ORDER BY id DESC',
                         (int(b['patient_id']), iso(b.get('date')) or today())).fetchone()
        if w:
            b = dict(b, weight=w[0])
    f = {}
    for k in VISIT_TEXT:
        if k in b:
            f[k] = s(b[k])
    for k in VISIT_INT:
        if k in b:
            f[k] = num(b[k], int)
    for k in VISIT_REAL:
        if k in b:
            f[k] = num(b[k])
    for k in ('date', 'follow_up'):
        if k in b:
            f[k] = iso(b[k])
    if 'fee_type' in b:
        f['fee_type'] = b['fee_type'] if b['fee_type'] in ('review', 'free') else ''
        if f['fee_type'] == 'free':
            f['price'] = 0
    if vid is None:
        pid = int(b['patient_id'])
        price = num(meta(conn).get('visit_price'))
        last_h = conn.execute('SELECT height FROM patients WHERE id=?', (pid,)).fetchone()
        m = meta(conn)
        fee = ''
        rd = num(m.get('review_days'), int) if str(m.get('review_days') or '').strip() else 0
        if rd:      # a visit soon after the last one counts as a review (مراجعة)
            prev = conn.execute('SELECT MAX(date) FROM visits WHERE patient_id=? AND COALESCE(fee_type,"")<>"review"', (pid,)).fetchone()[0]
            d0 = f.get('date') or today()
            if prev and (datetime.date.fromisoformat(d0) - datetime.date.fromisoformat(prev)).days <= rd:
                fee = 'review'
                price = num(m.get('review_price')) if str(m.get('review_price') or '').strip() else 0
        vid = conn.execute('INSERT INTO visits(patient_id,date,price,height,fee_type) VALUES(?,?,?,?,?)',
                           (pid, f.get('date') or today(), price, last_h[0] if last_h else None, fee)).lastrowid
        f.pop('date', None) if not f.get('date') else None
    if f:
        conn.execute("UPDATE visits SET %s, updated_at=datetime('now','localtime') WHERE id=?" % ', '.join('%s=?' % k for k in f),
                     list(f.values()) + [vid])
    v = conn.execute('SELECT * FROM visits WHERE id=?', (vid,)).fetchone()
    if 'meds' in b:
        old = set(r[0] for r in conn.execute('SELECT line FROM visit_meds WHERE visit_id=?', (vid,)))
        conn.execute('DELETE FROM visit_meds WHERE visit_id=?', (vid,))
        for i, line in enumerate(drug_caps(x).strip() for x in (b.get('meds') or [])):
            if line:
                conn.execute('INSERT INTO visit_meds(visit_id,seq,line) VALUES(?,?,?)', (vid, i, line))
                if line not in old:
                    remember(conn, 'drugs', 'line', line)
    if b.get('diagnosis') is not None and b.get('commit_dx'):
        for d in (b.get('diagnosis') or '').split('\n'):
            remember(conn, 'diagnoses', 'name', d)
    if 'height' in f and f['height']:
        conn.execute('UPDATE patients SET height=? WHERE id=?', (f['height'], v['patient_id']))
    # random sugar typed in the vitals is also kept in the lab chart
    if 'rbs' in f:
        conn.execute("DELETE FROM labs WHERE visit_id=? AND code='RBS' AND source='vitals'", (vid,))
        if f['rbs']:
            conn.execute("INSERT INTO labs(patient_id,visit_id,date,code,value,source) VALUES(?,?,?,?,?,'vitals')",
                         (v['patient_id'], vid, v['date'], 'RBS', f['rbs']))
    conn.execute("UPDATE patients SET updated_at=datetime('now','localtime') WHERE id=?", (v['patient_id'],))
    if 'follow_up' in f:
        auto_appt(conn, vid)
    return vid


def auto_appt(conn, vid):
    """The follow-up date of a visit becomes an appointment marked 'auto' for the secretary to confirm by phone."""
    v = conn.execute('SELECT v.id, v.patient_id, v.follow_up, p.name, p.phone FROM visits v JOIN patients p ON p.id=v.patient_id WHERE v.id=?', (vid,)).fetchone()
    if not v:
        return
    ex = conn.execute("SELECT * FROM appointments WHERE visit_id=? AND kind='auto' AND COALESCE(deleted,0)=0", (vid,)).fetchone()
    fu = v['follow_up']
    now = cloudsync.now_ms()
    if not fu or fu < today():
        if ex and not ex['call'] and not ex['status']:
            conn.execute('UPDATE appointments SET deleted=1, updated_at=? WHERE id=?', (now, ex['id']))
        return
    if ex:
        if ex['date'] != fu and not ex['status']:
            conn.execute("UPDATE appointments SET date=?, call='', hold=0, updated_at=? WHERE id=?", (fu, now, ex['id']))
        return
    if conn.execute("SELECT 1 FROM appointments WHERE patient_id=? AND date=? AND COALESCE(deleted,0)=0", (v['patient_id'], fu)).fetchone():
        return          # already booked that day
    seq = conn.execute('SELECT COALESCE(MAX(seq),0)+1 FROM appointments WHERE date=?', (fu,)).fetchone()[0]
    conn.execute('''INSERT INTO appointments(date,seq,patient_id,name,phone,note,status,kind,call,hold,visit_id,created_by,uid,deleted,updated_at)
                    VALUES(?,?,?,?,?,?,'','auto','',0,?,'auto',?,0,?)''', (fu, seq, v['patient_id'], v['name'], v['phone'], 'موعد تلقائي', vid, cloudsync.new_uid(), now))


def recall(conn):
    """Waiting list (no date yet) + automatic appointments of the coming week still to be phoned."""
    q = '''SELECT a.*, p.name pname, p.phone pphone, p.birth_year, p.dob FROM appointments a LEFT JOIN patients p ON p.id=a.patient_id
           WHERE COALESCE(a.deleted,0)=0 AND %s ORDER BY a.date, a.id'''
    out = {}
    d7 = (datetime.date.today() + datetime.timedelta(days=7)).isoformat()
    for key, where, args in (('hold', 'COALESCE(a.hold,0)=1', ()),
                             ('calls', "a.kind='auto' AND COALESCE(a.hold,0)=0 AND COALESCE(a.call,'') IN ('','noans') AND COALESCE(a.status,'')='' AND a.date BETWEEN ? AND ?", (today(), d7))):
        out[key] = [mrow(dict(r)) for r in conn.execute(q % where, args)]
    return out


def mrow(r):
    """one appointment in the shape used by the phone / online page"""
    if r.get('birth_year') or r.get('dob'):
        r['age'] = age_of(r)
    return {'uid': str(r['id']), 'date': r['date'], 'time': r.get('time') or '', 'seq': r.get('seq'), 'patient_id': r.get('patient_id') or '',
            'name': r.get('pname') or r.get('name') or '', 'phone': r.get('pphone') or r.get('phone') or '', 'note': r.get('note') or '',
            'status': r.get('status') or '', 'age': r['age'] if r.get('age') not in (None, '') else '', 'weight': r['weight'] if r.get('weight') is not None else '',
            'kind': r.get('kind') or '', 'call': r.get('call') or '', 'hold': str(r.get('hold') or 0), 'reminded': r.get('reminded') or ''}


def money(conn, d1, d2):
    rows = [dict(r) for r in conn.execute('''SELECT date, COUNT(*) n, SUM(CASE WHEN COALESCE(fee_type,'')='' AND COALESCE(price,0)>0 THEN 1 ELSE 0 END) paid,
            SUM(CASE WHEN fee_type='review' THEN 1 ELSE 0 END) review, SUM(CASE WHEN fee_type='free' OR (COALESCE(fee_type,'')='' AND COALESCE(price,0)=0) THEN 1 ELSE 0 END) free,
            SUM(COALESCE(price,0)) total FROM visits WHERE COALESCE(legacy,0)=0 AND date BETWEEN ? AND ? GROUP BY date ORDER BY date''', (d1, d2))]
    months = [dict(r) for r in conn.execute('''SELECT substr(date,1,7) m, COUNT(*) n, SUM(COALESCE(price,0)) total,
            SUM(CASE WHEN fee_type='review' THEN 1 ELSE 0 END) review FROM visits WHERE COALESCE(legacy,0)=0 AND date >= ? GROUP BY m ORDER BY m''',
            ((datetime.date.today().replace(day=1) - datetime.timedelta(days=330)).replace(day=1).isoformat(),))]
    return {'days': rows, 'months': months}


# ------------------------------------------------------------------ labs
def save_lab(conn, lid, b):
    f = {}
    if 'date' in b:
        f['date'] = iso(b['date']) or today()
    if 'code' in b:
        f['code'] = (b['code'] or '').strip().upper()
        if not conn.execute('SELECT 1 FROM lab_tests WHERE code=?', (f['code'],)).fetchone():
            raise ApiError('Unknown test: ' + f['code'])
    if 'value' in b:
        raw = str(b['value'] or '').strip()
        try:
            f['value'], f['text'] = num(raw), None
        except ApiError:
            f['value'], f['text'] = None, raw
    if lid is None:
        pid = int(b['patient_id'])
        lid = conn.execute("INSERT INTO labs(patient_id,visit_id,date,code,source) VALUES(?,?,?,?,?)",
                           (pid, b.get('visit_id') or None, f.get('date') or today(), f.get('code'), b.get('source') or 'manual')).lastrowid
    if f:
        conn.execute('UPDATE labs SET %s WHERE id=?' % ', '.join('%s=?' % k for k in f), list(f.values()) + [lid])
    return lid


# ------------------------------------------------------------------ appointments
APPT_FIELDS = ['date', 'time', 'patient_id', 'name', 'phone', 'age', 'note', 'status', 'seq', 'weight', 'kind', 'call', 'hold', 'reminded']


def appts(conn, date):
    rows = conn.execute('''SELECT a.*, p.name pname, p.phone pphone, p.birth_year, p.dob,
                             (SELECT COUNT(*) FROM visits v WHERE v.patient_id=a.patient_id) nvisits
                           FROM appointments a LEFT JOIN patients p ON p.id=a.patient_id
                           WHERE a.date=? AND COALESCE(a.deleted,0)=0 AND COALESCE(a.hold,0)=0 ORDER BY COALESCE(a.seq, 9999), COALESCE(NULLIF(a.time,''),'99:99'), a.id''', (date,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        if d['patient_id']:
            d['age'] = age_of(d) if (d.get('dob') or d.get('birth_year')) else d['age']
        out.append(d)
    return out


def save_appt(conn, aid, b, user):
    f = {}
    for k in APPT_FIELDS:
        if k in b:
            v = b[k]
            if k in ('patient_id', 'seq', 'reminded'):
                v = int(v) if v not in (None, '', 0, '0') else None
            elif k == 'hold':
                v = 1 if str(v) in ('1', 'true', 'True') else 0
            elif k == 'call':
                v = v if v in ('yes', 'no', 'noans') else ''
            elif k == 'kind':
                v = 'auto' if v == 'auto' else ''
            elif k == 'date':
                v = iso(v)
            elif k == 'weight':
                v = num(v)
                if v is not None and not 2 <= v <= 300:
                    raise ApiError('Weight must be between 2 and 300 kg')
            else:
                v = s(v)
            f[k] = v
    old_w = conn.execute('SELECT weight FROM appointments WHERE id=?', (aid,)).fetchone()[0] if aid is not None and 'weight' in f else None
    if aid is None:
        d = f.get('date') or today()
        seq = conn.execute('SELECT COALESCE(MAX(seq),0)+1 FROM appointments WHERE date=?', (d,)).fetchone()[0]
        aid = conn.execute('INSERT INTO appointments(date,seq,created_by,uid,deleted) VALUES(?,?,?,?,0)', (d, seq, user['name'], cloudsync.new_uid())).lastrowid
        f.pop('date', None)
        f.pop('seq', None)
    f['updated_at'] = cloudsync.now_ms()        # every change is stamped for the online sync
    if f:
        conn.execute('UPDATE appointments SET %s WHERE id=?' % ', '.join('%s=?' % k for k in f), list(f.values()) + [aid])
    if f.get('weight') or 'patient_id' in f:
        weight_to_visit(conn, aid, old_w)
    return aid


def weight_to_visit(conn, aid, old_w=None):
    """Weight taken by the secretary goes into that day's visit — unless the doctor typed a different one there."""
    a = conn.execute('SELECT patient_id, date, weight FROM appointments WHERE id=?', (aid,)).fetchone()
    if a and a['patient_id'] and a['weight']:
        conn.execute('UPDATE visits SET weight=? WHERE patient_id=? AND date=? AND (weight IS NULL OR weight=?)',
                     (a['weight'], a['patient_id'], a['date'], old_w if old_w is not None else a['weight']))


# ------------------------------------------------------------------ family links (same idea as the dental program)
FAM_INV = {'Father': ('Son', 'Daughter'), 'Mother': ('Son', 'Daughter'), 'Son': ('Father', 'Mother'), 'Daughter': ('Father', 'Mother'),
           'Husband': ('Wife', 'Wife'), 'Wife': ('Husband', 'Husband'), 'Brother': ('Brother', 'Sister'), 'Sister': ('Brother', 'Sister'),
           'Grandfather': ('Grandson', 'Granddaughter'), 'Grandmother': ('Grandson', 'Granddaughter'), 'Grandson': ('Grandfather', 'Grandmother'),
           'Granddaughter': ('Grandfather', 'Grandmother'), 'Uncle': ('Nephew', 'Niece'), 'Aunt': ('Nephew', 'Niece'), 'Nephew': ('Uncle', 'Aunt'),
           'Niece': ('Uncle', 'Aunt'), 'Cousin': ('Cousin', 'Cousin')}


def family(conn, pid):
    """Everyone linked to the patient, directly or through another member, with the relation as seen from this patient."""
    seen, queue = {pid}, [pid]
    while queue:
        cur = queue.pop()
        for l in conn.execute('SELECT a_id, b_id FROM links WHERE a_id=? OR b_id=?', (cur, cur)):
            o = l['b_id'] if l['a_id'] == cur else l['a_id']
            if o not in seen:
                seen.add(o)
                queue.append(o)
    seen.discard(pid)
    out = []
    for o in seen:
        p = conn.execute('SELECT id, name, gender, birth_year, phone, chronic FROM patients WHERE id=?', (o,)).fetchone()
        if not p:
            continue
        d = dict(p)
        rel = conn.execute('SELECT id, relation, a_id FROM links WHERE (a_id=? AND b_id=?) OR (a_id=? AND b_id=?)', (o, pid, pid, o)).fetchone()
        d['link_id'] = rel['id'] if rel else None
        d['direct'] = bool(rel)
        if not rel:
            d['relation'] = 'Family'
        elif rel['a_id'] == o:        # stored as "o is <relation> of pid"
            d['relation'] = rel['relation'] or 'Linked'
        else:                         # stored from the other side: turn it round, using the gender of o
            inv = FAM_INV.get(rel['relation'] or '')
            d['relation'] = (inv[1] if p['gender'] == 'F' else inv[0]) if inv else ('↔ ' + rel['relation'] if rel['relation'] else 'Linked')
        out.append(d)
    out.sort(key=lambda x: (not x['direct'], x['name']))
    return out


def family_suggest(conn, pid):
    """Unlinked patients sharing the phone number."""
    p = conn.execute('SELECT phone FROM patients WHERE id=?', (pid,)).fetchone()
    ph = re.sub(r'\D', '', (p['phone'] or '') if p else '')[-10:]
    if len(ph) < 9:
        return []
    linked = {f['id'] for f in family(conn, pid)} | {pid}
    out = []
    for r in conn.execute('SELECT id, name, phone FROM patients WHERE phone LIKE ?', ('%' + ph[-7:] + '%',)):
        if r['id'] not in linked and re.sub(r'\D', '', r['phone'] or '')[-10:] == ph:
            out.append({'id': r['id'], 'name': r['name'], 'why': 'same phone'})
    return out[:5]


def day_list(conn, date_from, date_to):
    rows = [dict(r) for r in conn.execute('''SELECT v.id, v.date, v.diagnosis, v.price, p.id patient_id, p.name
        FROM visits v JOIN patients p ON p.id=v.patient_id WHERE v.date BETWEEN ? AND ? ORDER BY v.date DESC, v.id DESC''', (date_from, date_to))]
    return {'rows': rows, 'count': len(rows)}


# ------------------------------------------------------------------ lists / settings
def lists(conn, user):
    out = {'meta': meta(conn), 'user': user}
    out['meta']['ai_has_key'] = '1' if out['meta'].get('ai_key') else ''
    for k in ('ai_key', 'sync_token'):
        out['meta'].pop(k, None)
    out['occupations'] = vocab(conn, 'occupation')
    out['areas'] = vocab(conn, 'area')
    if user['role'] == 'doctor':
        out['lab_tests'] = [dict(r) for r in conn.execute('SELECT * FROM lab_tests ORDER BY seq, code')]
        out['drugs'] = [r[0] for r in conn.execute('SELECT line FROM drugs ORDER BY uses DESC, line')]
        out['diagnoses'] = [r[0] for r in conn.execute('SELECT name FROM diagnoses ORDER BY uses DESC, name')]
        out['templates'] = [dict(r, lines=json.loads(r['lines'] or '[]')) for r in conn.execute('SELECT * FROM rx_templates ORDER BY name')]
        out['labreq'] = vocab(conn, 'labreq')
        out['users'] = [dict(id=r['id'], name=r['name'], role=r['role'], active=r['active']) for r in conn.execute('SELECT * FROM users ORDER BY role, name')]
    return out


META_KEYS = ['clinic_name', 'doctor_name', 'doctor_degree', 'clinic_address', 'clinic_phone', 'visit_price',
             'work_from', 'work_to', 'review_days', 'review_price', 'labreq_seeded', 'rx_layout_pre', 'rx_layout_plain', 'ai_key', 'ai_model', 'ai_model_ocr', 'ai_model_sum', 'ai_model_plan', 'theme', 'wa_template', 'hdr_title', 'hdr_name', 'hdr_degree_en', 'hdr_lines', 'hdr_reg', 'hdr_phones', 'hdr_address',
             'rx_header', 'rx_line_mm', 'rx_top_mm', 'rx_bottom_mm', 'rx_side_mm', 'rx_off_x', 'rx_off_y', 'rx_font_pt']


# ------------------------------------------------------------------ auth
SESS_DAYS = 30


def user_from_token(conn, token):
    if not token:
        return None
    r = conn.execute('''SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.active=1''', (token,)).fetchone()
    return dict(id=r['id'], name=r['name'], role=r['role']) if r else None


# ------------------------------------------------------------------ HTTP
STATIC = os.path.join(HERE, 'static')
MIME = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.woff2': 'font/woff2', '.jpg': 'image/jpeg'}
WRITE_LOCK = threading.Lock()
LOGIN_FAILS = {}


def pin_taken(conn, pin, except_id=None):
    for row in conn.execute('SELECT id, pin FROM users WHERE pin IS NOT NULL'):
        if row['id'] != except_id and check_pin(row['pin'], str(pin)):
            return True
    return False


PUBLIC = {('POST', 'clienterror'), ('GET', 'me'), ('GET', 'users'), ('POST', 'login'), ('POST', 'setup'), ('POST', 'logout')}
SECRETARY = {('POST', 'weight'), ('GET', 'daycounts'), ('GET', 'recall'), ('GET', 'mboot'), ('GET', 'mday'), ('GET', 'search'), ('GET', 'patient'), ('GET', 'similar'), ('GET', 'appts'), ('GET', 'lists'),
             ('POST', 'patient'), ('PUT', 'patient'), ('GET', 'family_suggest'), ('POST', 'link'), ('DELETE', 'link'), ('POST', 'appt'), ('PUT', 'appt'), ('DELETE', 'appt'), ('PUT', 'my_pin'), ('POST', 'file'), ('GET', 'pc'), ('POST', 'shutdown')}


class Handler(BaseHTTPRequestHandler):
    server_version = 'Clinic/1.0'

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype='application/json; charset=utf-8', cookie=None):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False, default=str).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        if cookie is not None:
            self.send_header('Set-Cookie', 'zk=%s; Path=/; HttpOnly; SameSite=Strict; Max-Age=%d' % (cookie, SESS_DAYS * 86400 if cookie else 0))
        self.end_headers()
        self.wfile.write(body)

    def _token(self):
        for part in (self.headers.get('Cookie') or '').split(';'):
            k, _, v = part.strip().partition('=')
            if k == 'zk':
                return v
        return None

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n).decode('utf-8')) if n else {}

    def do_GET(self):
        self._route('GET')

    def do_POST(self):
        self._route('POST')

    def do_PUT(self):
        self._route('PUT')

    def do_DELETE(self):
        self._route('DELETE')

    def _route(self, method):
        t0 = time.time()
        try:
            return self._route2(method)
        finally:
            dt = time.time() - t0
            if dt > 4 and '/api/ai_' not in self.path and '/api/restore' not in self.path:     # slow answers: what makes the program "freeze"
                errlog.log('slow', '%s %s took %.1f s' % (method, self.path.split('?')[0], dt), 'write lock busy: %s' % WRITE_LOCK.locked())

    def _route2(self, method):
        u = urlparse(self.path)
        qs = {k: v[0] for k, v in parse_qs(u.query).items()}
        if u.path == '/api/version':        # program version for the top bar (no sign-in needed)
            return self._send(200, updater.version_info(HERE))
        if not u.path.startswith('/api/'):
            return self._static(u.path)
        parts = [p for p in u.path[5:].split('/') if p]
        p0 = parts[0] if parts else ''
        self._cookie = None
        try:
            body = self._body() if method != 'GET' else {}
            conn = db()
            try:
                user = user_from_token(conn, self._token())
                if (method, p0) not in PUBLIC:
                    if not user:
                        raise ApiError('Please sign in', 401)
                    if user['role'] != 'doctor' and (method, p0) not in SECRETARY:
                        raise ApiError('Doctor only', 403)
                if p0 == 'clienterror' and method == 'POST':      # an error in the browser
                    errlog.log('browser', str(body.get('msg') or '')[:300], '%s\n%s\n%s' % (body.get('where') or '', body.get('stack') or '', (user or {}).get('name') or ''))
                    return self._send(200, {'ok': True})
                if p0 == 'errors' and method == 'GET':
                    return self._send(200, {'pc': errlog.PC, 'ver': errlog.VER, 'rows': errlog.recent(int(qs.get('n') or 300)),
                                            'state': {k: (v or {}).get('error') for k, v in (('sync', cloudsync.STATE), ('handoff', handoff.STATE), ('update', updater.STATE), ('backup', BACKUP_STATE))}})
                if handoff.STATE['readonly'] and method != 'GET' and p0 not in ('login', 'logout', 'shutdown') and p0 not in ('ai_ocr', 'ai_summary', 'ai_test', 'ai_plan'):
                    raise ApiError('البرنامج انتقل إلى الحاسبة %s — هذه الحاسبة للقراءة فقط. أعد تشغيل البرنامج هنا لاستلامه. '
                                   '(The program moved to another PC — read-only here.)' % (handoff.STATE.get('other') or 'الأخرى'), 423)
                if p0 == 'shutdown' and method == 'POST':
                    # Close button: the program closes only after the last data is on Google Drive
                    # (or when the user chooses "close anyway" after a failed upload)
                    ok, err = handoff.final_push() if handoff.STATE['enabled'] else (True, None)
                    if not ok and not body.get('force'):
                        errlog.log('handoff', 'Close: last upload failed — ' + str(err))
                        res = {'ok': False, 'uploaded': False, 'error': err}
                    else:
                        threading.Thread(target=shutdown_now, daemon=True).start()
                        res = {'ok': True, 'uploaded': ok, 'handoff': handoff.STATE['enabled']}
                elif p0 in ('restore', 'ai_ocr', 'ai_summary', 'ai_test', 'ai_plan') and method == 'POST':
                    res = self._special(conn, p0, body, user)
                elif method == 'GET':
                    res = self._get(conn, parts, qs, user)
                else:
                    with WRITE_LOCK:
                        conn.execute('BEGIN IMMEDIATE')
                        try:
                            res = self._write(conn, method, parts, body, user)
                            conn.commit()
                        except Exception:
                            conn.rollback()
                            raise
            finally:
                conn.close()
            if res is None:
                return self._send(404, {'error': 'Not found'})
            if isinstance(res, Raw):
                return self._send(200, res.data, res.mime)
            self._send(200, res, cookie=self._cookie)
        except ApiError as e:
            if e.code >= 500 or p0.startswith('ai_'):
                errlog.log('api', '%s /api/%s → %s' % (method, '/'.join(parts), e))
            self._send(e.code, {'error': str(e)})
        except Exception as e:
            traceback.print_exc()
            errlog.log('server', '%s /api/%s → %s: %s' % (method, '/'.join(parts), type(e).__name__, e), traceback.format_exc())
            self._send(500, {'error': 'Server error: %s' % e})

    # ---------------------------------------------------------------- long jobs (no write lock held)
    def _special(self, conn, p0, b, user):
        m = meta(conn)
        if p0 == 'restore':
            conn.close()
            with WRITE_LOCK:
                try:
                    features.restore_backup(CFG, ROOT, b.get('name'), DB_PATH, connect, do_backup)
                except ValueError as e:
                    raise ApiError(str(e))
            return {'ok': True}
        try:
            if p0 == 'ai_ocr':
                r = conn.execute('SELECT * FROM files WHERE id=?', (int(b.get('file_id') or 0),)).fetchone()
                if not r:
                    raise ApiError('File not found', 404)
                full = os.path.normpath(os.path.join(FILES_DIR, r['path']))
                if not full.startswith(FILES_DIR) or not os.path.isfile(full):
                    raise ApiError('File is missing on disk', 404)
                if not (r['mime'] or '').startswith('image/') and r['mime'] != 'application/pdf':
                    raise ApiError('Only images or PDF can be read')
                with open(full, 'rb') as fh:
                    data = fh.read()
                tests = [dict(t) for t in conn.execute('SELECT code, name, unit FROM lab_tests WHERE code != "EGFR"')]
                out = features.ai_read_labs(m.get('ai_key'), m.get('ai_model_ocr') or m.get('ai_model'), data, r['mime'], tests)
                out['file_date'] = r['date']
                return out
            if p0 == 'ai_test':
                return {'text': features.ai_call(m.get('ai_key'), m.get('ai_model'), 'Reply with the single word OK.', 10)}
            if p0 == 'ai_plan':
                if user['role'] != 'doctor':
                    raise ApiError('Doctor only', 403)
                d = patient_full(conn, int(b.get('patient_id') or 0), user)
                if not d:
                    raise ApiError('Patient not found', 404)
                v = dict(next((x for x in d['visits'] if x['id'] == int(b.get('visit_id') or 0)), {}))
                v.update({k: b[k] for k in ('complaint', 'exam', 'diagnosis', 'plan', 'imaging', 'bp_sys', 'bp_dia', 'hr', 'temp', 'spo2', 'rbs', 'weight', 'waist', 'meds') if k in b})
                return features.ai_plan(m.get('ai_key'), m.get('ai_model_plan') or features.PLAN_MODEL, d, v, d.get('family'))
            if p0 == 'ai_summary':
                d = patient_full(conn, int(b.get('patient_id') or 0), user)
                if not d:
                    raise ApiError('Patient not found', 404)
                # the summary is kept and reused until the file changes (new visit, lab, medicine …) — no second payment for the same data
                prompt = features.summary_prompt(d)
                h = hashlib.md5(((m.get('ai_model_sum') or m.get('ai_model') or features.DEFAULT_MODEL) + prompt).encode('utf-8')).hexdigest()
                pid = d['patient']['id']
                old = conn.execute('SELECT h, text, at FROM ai_summaries WHERE patient_id=?', (pid,)).fetchone()
                if old and old['h'] == h and not b.get('force'):
                    return {'text': old['text'], 'at': old['at'], 'cached': True}
                text = features.ai_summary(m.get('ai_key'), m.get('ai_model_sum') or m.get('ai_model'), d, prompt)
                at = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
                with WRITE_LOCK:
                    conn.execute('INSERT OR REPLACE INTO ai_summaries(patient_id, h, text, at) VALUES(?,?,?,?)', (pid, h, text, at))
                    conn.commit()
                return {'text': text, 'at': at}
        except RuntimeError as e:
            raise ApiError(str(e))

    # ---------------------------------------------------------------- GET
    def _get(self, conn, parts, qs, user):
        p0 = parts[0] if parts else ''
        arg = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
        if p0 == 'me':
            m = meta(conn)
            return {'user': user, 'setup': not conn.execute("SELECT 1 FROM users WHERE pin IS NOT NULL").fetchone(),
                    'clinic_name': m.get('clinic_name')}
        if p0 == 'users':
            return [dict(name=r['name'], role=r['role']) for r in conn.execute('SELECT name, role FROM users WHERE active=1 ORDER BY role, name')]
        if p0 == 'mboot':           # phone page: same data shape as the online (Google) version
            m = meta(conn)
            pl = [[r['id'], r['name'] or '', r['birth_year'] or '', r['phone'] or '', r['address'] or '', r['last'] or '']
                  for r in conn.execute('''SELECT p.id, p.name, p.birth_year, p.phone, p.address, (SELECT MAX(date) FROM visits v WHERE v.patient_id=p.id) last
                                           FROM patients p ORDER BY p.name_norm''')]
            return {'user': user, 'clinic': m.get('clinic_name') or '', 'work': [m.get('work_from') or '13:00', m.get('work_to') or '21:00'],
                    'wa': m.get('wa_template') or '', 'theme': m.get('theme') or '', 'patients': pl,
                    'areas': [r[0] for r in conn.execute("SELECT name FROM vocab WHERE kind='area' ORDER BY uses DESC LIMIT 400")],
                    'occupations': [r[0] for r in conn.execute("SELECT name FROM vocab WHERE kind='occupation' ORDER BY uses DESC LIMIT 200")],
                    'labs': [[r['code'], r['name'], r['unit'] or '', r['low'], r['high']] for r in conn.execute('SELECT * FROM lab_tests ORDER BY seq')]}
        if p0 == 'mday':
            return [mrow(r) for r in appts(conn, qs.get('date') or today())]
        if p0 == 'daycounts':      # how many appointments / visits on each day (for the day bar)
            d1, d2 = iso(qs.get('from')) or today(), iso(qs.get('to')) or today()
            if qs.get('kind') == 'visit':
                if user['role'] != 'doctor':
                    raise ApiError('Doctor only', 403)
                q = 'SELECT date, COUNT(*) FROM visits WHERE COALESCE(legacy,0)=0 AND date BETWEEN ? AND ? GROUP BY date'
            else:
                q = 'SELECT date, COUNT(*) FROM appointments WHERE COALESCE(deleted,0)=0 AND COALESCE(hold,0)=0 AND date BETWEEN ? AND ? GROUP BY date'
            return dict(conn.execute(q, (d1, d2)).fetchall())
        if p0 == 'recall':
            return recall(conn)
        if p0 == 'money':
            if user['role'] != 'doctor':
                raise ApiError('Doctor only', 403)
            return money(conn, qs.get('from') or today()[:8] + '01', qs.get('to') or today())
        if p0 == 'mclin' and arg:
            if user['role'] != 'doctor':
                raise ApiError('Doctor only', 403)
            return cloudsync.clinical(conn, arg)
        if p0 == 'search':
            return search(conn, qs.get('q', ''))
        if p0 == 'similar':
            return similar(conn, qs.get('name', ''), qs.get('phone', ''), int(qs['exclude']) if qs.get('exclude') else None)
        if p0 == 'patient' and arg:
            return patient_full(conn, arg, user)
        if p0 == 'lists':
            return lists(conn, user)
        if p0 == 'appts':
            return appts(conn, qs.get('date') or today())
        if p0 == 'family_suggest' and arg:
            return family_suggest(conn, arg)
        if p0 == 'file' and arg:
            r = conn.execute('SELECT * FROM files WHERE id=?', (arg,)).fetchone()
            if not r:
                return None
            full = os.path.normpath(os.path.join(FILES_DIR, r['path']))
            if not full.startswith(FILES_DIR) or not os.path.isfile(full):
                raise ApiError('File is missing on disk', 404)
            with open(full, 'rb') as fh:
                return Raw(fh.read(), r['mime'] or 'application/octet-stream')
        if p0 == 'visits':
            return day_list(conn, qs.get('from') or today(), qs.get('to') or qs.get('from') or today())
        if p0 == 'sync':
            url, token = cloudsync.config(conn)
            return dict(cloudsync.STATE, url=url, has_token=bool(token),
                        pending=conn.execute('SELECT COUNT(*) FROM appointments WHERE uid IS NOT NULL AND updated_at > COALESCE(synced_at,0)').fetchone()[0])
        if p0 == 'registry':
            return features.registry(conn, qs.get('cond') or 'dm')
        if p0 == 'registry_counts':
            return features.registry_counts(conn)
        if p0 == 'stats':
            t = datetime.date.today()
            return features.stats(conn, qs.get('from') or (t - datetime.timedelta(days=30)).isoformat(), qs.get('to') or t.isoformat())
        if p0 == 'backups':
            return features.list_backups(CFG, ROOT)
        if p0 == 'health':                       # backup monitor for the top bar
            url, token = cloudsync.config(conn)
            return {'local_last': BACKUP_STATE.get('last'), 'local_error': BACKUP_STATE.get('error'),
                    'drive': bool(url and token), 'drive_last_ms': int(float(meta(conn).get('sync_backup_t') or 0)), 'sync_error': cloudsync.STATE.get('error')}
        if p0 == 'pc':
            return dict(handoff.STATE, me=handoff.pc_name(), unsent=handoff.unsent())
        if p0 == 'status':
            return {'backup': BACKUP_STATE, 'db': DB_PATH,
                    'patients': conn.execute('SELECT COUNT(*) FROM patients').fetchone()[0],
                    'visits': conn.execute('SELECT COUNT(*) FROM visits').fetchone()[0],
                    'labs': conn.execute('SELECT COUNT(*) FROM labs').fetchone()[0],
                    'ips': local_ips(), 'port': CFG['port']}
        return None

    # ---------------------------------------------------------------- writes
    def _write(self, conn, method, parts, b, user):
        p0 = parts[0] if parts else ''
        arg = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None

        if p0 == 'setup' and method == 'POST':
            if conn.execute('SELECT 1 FROM users WHERE pin IS NOT NULL').fetchone():
                raise ApiError('Already set up')
            dpin, spin = str(b.get('doctor_pin') or ''), str(b.get('secretary_pin') or '')
            if len(dpin) < 4 or len(spin) < 4:
                raise ApiError('PIN must be at least 4 digits')
            if dpin == spin:
                raise ApiError('The two PINs must be different — the PIN alone decides who signs in')
            conn.execute('INSERT OR REPLACE INTO users(name,role,pin) VALUES(?,?,?)', ((b.get('doctor_name') or 'Doctor').strip(), 'doctor', hash_pin(dpin)))
            conn.execute('INSERT OR REPLACE INTO users(name,role,pin) VALUES(?,?,?)', ((b.get('secretary_name') or 'Secretary').strip(), 'secretary', hash_pin(spin)))
            return {'ok': True}
        if p0 == 'login' and method == 'POST':
            # The PIN alone identifies the user (PINs are unique); a name is still honoured if sent.
            ip = self.client_address[0]
            now = time.time()
            fails = [t for t in LOGIN_FAILS.get(ip, []) if now - t < 60]
            if len(fails) >= 40:
                raise ApiError('Too many attempts — wait a minute', 429)
            pin = str(b.get('pin') or '')
            r = None
            if len(pin) >= 4:
                q = 'SELECT * FROM users WHERE active=1 AND pin IS NOT NULL' + (' AND name=?' if b.get('name') else '')
                for row in conn.execute(q, (b.get('name'),) if b.get('name') else ()):
                    if check_pin(row['pin'], pin):
                        r = row
                        break
            if not r:
                fails.append(now)
                LOGIN_FAILS[ip] = fails
                raise ApiError('Wrong PIN', 401)
            LOGIN_FAILS.pop(ip, None)
            tok = secrets.token_urlsafe(24)
            conn.execute('INSERT INTO sessions VALUES(?,?,?)', (tok, r['id'], int(time.time())))
            conn.execute('DELETE FROM sessions WHERE created < ?', (int(time.time()) - SESS_DAYS * 86400,))
            self._cookie = tok
            return {'ok': True, 'user': dict(name=r['name'], role=r['role'])}
        if p0 == 'logout':
            conn.execute('DELETE FROM sessions WHERE token=?', (self._token(),))
            self._cookie = ''
            return {'ok': True}
        if p0 == 'my_pin' and method == 'PUT':
            r = conn.execute('SELECT pin FROM users WHERE id=?', (user['id'],)).fetchone()
            if not check_pin(r['pin'], b.get('old') or ''):
                raise ApiError('Current PIN is wrong')
            if len(str(b.get('new') or '')) < 4:
                raise ApiError('PIN must be at least 4 digits')
            if pin_taken(conn, b['new'], user['id']):
                raise ApiError('This PIN is used by another user — choose a different one')
            conn.execute('UPDATE users SET pin=? WHERE id=?', (hash_pin(b['new']), user['id']))
            return {'ok': True}

        if p0 == 'patient':
            if method == 'POST':
                return {'id': save_patient(conn, None, b, user)}
            if method == 'PUT':
                return {'id': save_patient(conn, arg, b, user)}
            if method == 'DELETE':
                if user['role'] != 'doctor':
                    raise ApiError('Doctor only', 403)
                conn.execute('DELETE FROM patients WHERE id=?', (arg,))
                return {'ok': True}
        if p0 == 'merge' and method == 'POST':          # keep ← drop
            keep, drop = int(b['keep']), int(b['drop'])
            if keep == drop:
                raise ApiError('Same patient')
            for t in ('visits', 'labs', 'appointments', 'files'):
                conn.execute('UPDATE %s SET patient_id=? WHERE patient_id=?' % t, (keep, drop))
            conn.execute('UPDATE links SET a_id=? WHERE a_id=?', (keep, drop))
            conn.execute('UPDATE links SET b_id=? WHERE b_id=?', (keep, drop))
            conn.execute('DELETE FROM links WHERE a_id=b_id')
            conn.execute('DELETE FROM links WHERE id NOT IN (SELECT MIN(id) FROM links GROUP BY MIN(a_id,b_id), MAX(a_id,b_id))')
            k = dict(conn.execute('SELECT * FROM patients WHERE id=?', (keep,)).fetchone())
            d = dict(conn.execute('SELECT * FROM patients WHERE id=?', (drop,)).fetchone())
            fill = {c: d[c] for c in PAT_BASIC + PAT_CLINICAL + ['phone_norm'] if not k.get(c) and d.get(c)}
            if fill:
                conn.execute('UPDATE patients SET %s WHERE id=?' % ', '.join('%s=?' % c for c in fill), list(fill.values()) + [keep])
            conn.execute('DELETE FROM patients WHERE id=?', (drop,))
            return {'id': keep}
        if p0 == 'visit':
            if method == 'POST':
                return {'id': save_visit(conn, None, b)}
            if method == 'PUT':
                return {'id': save_visit(conn, arg, b)}
            if method == 'DELETE':
                conn.execute('DELETE FROM visits WHERE id=?', (arg,))
                return {'ok': True}
        if p0 == 'lab':
            if method == 'POST':
                ids = []
                for it in (b.get('items') or [b]):
                    if str(it.get('value') or '').strip() == '':
                        continue
                    ids.append(save_lab(conn, None, dict(it, patient_id=b.get('patient_id') or it.get('patient_id'),
                                                         date=it.get('date') or b.get('date'), visit_id=b.get('visit_id'))))
                return {'ids': ids}
            if method == 'PUT':
                return {'id': save_lab(conn, arg, b)}
            if method == 'DELETE':
                conn.execute('DELETE FROM labs WHERE id=?', (arg,))
                return {'ok': True}
        if p0 == 'lab_test' and method == 'DELETE':
            code = parts[1].upper()
            n = conn.execute('SELECT COUNT(*) FROM labs WHERE code=?', (code,)).fetchone()[0]
            if n:
                raise ApiError('%d result(s) of this test are saved in patient files - it cannot be deleted' % n)
            conn.execute('DELETE FROM lab_tests WHERE code=?', (code,))
            return {'ok': True}
        if p0 == 'lab_test' and method == 'PUT':
            code = parts[1].upper()
            f = {k: num(b[k]) for k in ('low', 'high', 'target') if k in b}
            for k in ('name', 'unit', 'grp'):
                if k in b:
                    f[k] = s(b[k])
            if not conn.execute('SELECT 1 FROM lab_tests WHERE code=?', (code,)).fetchone():
                conn.execute('INSERT INTO lab_tests(code,name,seq) VALUES(?,?,999)', (code, b.get('name') or code))
            if f:
                conn.execute('UPDATE lab_tests SET %s WHERE code=?' % ', '.join('%s=?' % k for k in f), list(f.values()) + [code])
            return {'ok': True}
        if p0 == 'appt':
            if method == 'POST':
                return {'id': save_appt(conn, None, b, user)}
            if method == 'PUT':
                return {'id': save_appt(conn, arg, b, user)}
            if method == 'DELETE':
                conn.execute('UPDATE appointments SET deleted=1, updated_at=? WHERE id=?', (cloudsync.now_ms(), arg))
                return {'ok': True}
        if p0 == 'link':
            if method == 'POST':
                a, c = int(b['a_id']), int(b['b_id'])
                if a == c:
                    raise ApiError('Cannot link a patient to himself')
                if conn.execute('SELECT 1 FROM links WHERE (a_id=? AND b_id=?) OR (a_id=? AND b_id=?)', (a, c, c, a)).fetchone():
                    raise ApiError('Already linked')
                return {'id': conn.execute('INSERT INTO links(a_id, b_id, relation) VALUES(?,?,?)', (a, c, s(b.get('relation')) or '')).lastrowid}
            if method == 'DELETE':
                conn.execute('DELETE FROM links WHERE id=?', (arg,))
                return {'ok': True}
        if p0 == 'weight' and method == 'POST':      # secretary weighed the patient: goes on today's appointment (and visit)
            pid, d = int(b['patient_id']), iso(b.get('date')) or today()
            w = num(b.get('weight'))
            if w is None or not 2 <= w <= 300:
                raise ApiError('Weight must be between 2 and 300 kg')
            a = conn.execute('SELECT id FROM appointments WHERE patient_id=? AND date=? AND COALESCE(deleted,0)=0 AND COALESCE(hold,0)=0 ORDER BY id DESC', (pid, d)).fetchone()
            if a:
                save_appt(conn, a['id'], {'weight': w}, user)
                return {'appt': a['id']}
            if conn.execute('SELECT 1 FROM visits WHERE patient_id=? AND date=?', (pid, d)).fetchone():
                conn.execute('UPDATE visits SET weight=? WHERE patient_id=? AND date=?', (w, pid, d))
                return {'visit': True}
            p = conn.execute('SELECT name, phone FROM patients WHERE id=?', (pid,)).fetchone()
            return {'appt': save_appt(conn, None, {'date': d, 'patient_id': pid, 'name': p['name'], 'phone': p['phone'], 'status': 'waiting', 'weight': w}, user), 'created': True}
        if p0 == 'appt_order' and method == 'PUT':
            for i, aid in enumerate(b.get('ids') or []):
                conn.execute('UPDATE appointments SET seq=?, updated_at=? WHERE id=?', (i + 1, cloudsync.now_ms(), int(aid)))
            return {'ok': True}
        if p0 == 'template':
            if method in ('POST', 'PUT'):
                lines = json.dumps([drug_caps(x).strip() for x in (b.get('lines') or []) if x.strip()], ensure_ascii=False)
                fd = num(b.get('follow_days'), int) if str(b.get('follow_days') or '').strip() else None
                vals = ((b.get('name') or 'Template').strip(), lines, s(b.get('diagnosis')), s(b.get('plan')), s(b.get('complaint')), s(b.get('exam')), fd)
                if method == 'POST':
                    return {'id': conn.execute('INSERT INTO rx_templates(name,lines,diagnosis,plan,complaint,exam,follow_days) VALUES(?,?,?,?,?,?,?)', vals).lastrowid}
                conn.execute('UPDATE rx_templates SET name=?, lines=?, diagnosis=?, plan=?, complaint=?, exam=?, follow_days=? WHERE id=?', vals + (arg,))
                return {'id': arg}
            if method == 'DELETE':
                conn.execute('DELETE FROM rx_templates WHERE id=?', (arg,))
                return {'ok': True}
        if p0 == 'list_item' and method == 'POST':       # add a drug line / diagnosis to the suggestions
            v = re.sub(r'\s+', ' ', str(b.get('value') or '')).strip()
            if v:
                if b.get('kind') == 'drug':
                    conn.execute('INSERT OR IGNORE INTO drugs(line) VALUES(?)', (drug_caps(v),))
                else:
                    conn.execute('INSERT OR IGNORE INTO diagnoses(name) VALUES(?)', (v,))
            return {'ok': True}
        if p0 == 'list_item' and method == 'DELETE':     # remove a drug line / diagnosis from the suggestions
            if b.get('kind') == 'drug':
                conn.execute('DELETE FROM drugs WHERE line=?', (b.get('value'),))
            else:
                conn.execute('DELETE FROM diagnoses WHERE name=?', (b.get('value'),))
            return {'ok': True}
        if p0 == 'meta' and method == 'PUT':
            for k in META_KEYS:
                if k in b:
                    conn.execute('INSERT OR REPLACE INTO meta VALUES(?,?)', (k, str(b[k] if b[k] is not None else '')))
            return {'ok': True}
        if p0 == 'user':
            if method == 'POST':
                if len(str(b.get('pin') or '')) < 4:
                    raise ApiError('PIN must be at least 4 digits')
                if pin_taken(conn, b['pin']):
                    raise ApiError('This PIN is used by another user — choose a different one')
                conn.execute('INSERT INTO users(name,role,pin) VALUES(?,?,?)',
                             ((b.get('name') or '').strip(), 'doctor' if b.get('role') == 'doctor' else 'secretary', hash_pin(b['pin'])))
                return {'ok': True}
            if method == 'PUT':
                if b.get('pin'):
                    if len(str(b['pin'])) < 4:
                        raise ApiError('PIN must be at least 4 digits')
                    if pin_taken(conn, b['pin'], arg):
                        raise ApiError('This PIN is used by another user — choose a different one')
                    conn.execute('UPDATE users SET pin=? WHERE id=?', (hash_pin(b['pin']), arg))
                if 'active' in b:
                    if arg == user['id'] and not b['active']:
                        raise ApiError('You cannot disable yourself')
                    conn.execute('UPDATE users SET active=? WHERE id=?', (1 if b['active'] else 0, arg))
                    conn.execute('DELETE FROM sessions WHERE user_id=?', (arg,)) if not b['active'] else None
                return {'ok': True}
        if p0 == 'file':
            if method == 'POST':
                return {'id': save_file(conn, b, user)}
            if method == 'PUT':
                conn.execute('UPDATE files SET title=?, date=COALESCE(?,date) WHERE id=?', (s(b.get('title')), iso(b.get('date')), arg))
                return {'ok': True}
            if method == 'DELETE':
                r = conn.execute('SELECT path FROM files WHERE id=?', (arg,)).fetchone()
                conn.execute('DELETE FROM files WHERE id=?', (arg,))
                if r:
                    try:
                        os.remove(os.path.join(FILES_DIR, r['path']))
                    except OSError:
                        pass
                return {'ok': True}
        if p0 == 'vocab':
            kind = b.get('kind')
            if kind not in ('occupation', 'area', 'labreq'):
                raise ApiError('Unknown list')
            if method == 'POST':
                for x in (b.get('items') or []):
                    remember_vocab(conn, kind, x)
                return {'ok': True}
            if method == 'DELETE':
                conn.execute('DELETE FROM vocab WHERE kind=? AND name=?', (kind, b.get('name')))
                return {'ok': True}
        if p0 == 'sync_config' and method == 'PUT':
            if (b.get('url') or '').strip() != (cloudsync.meta_get(conn, 'sync_url', '') or ''):
                try:        # another Google script: its hand-over count starts again, so this device uploads its data there
                    os.remove(os.path.join(os.path.dirname(DB_PATH), 'handoff.json'))
                except OSError:
                    pass
            cloudsync.meta_set(conn, 'sync_url', (b.get('url') or '').strip())
            if b.get('token') is not None and str(b.get('token')).strip():
                cloudsync.meta_set(conn, 'sync_token', str(b['token']).strip())
            cloudsync.meta_set(conn, 'sync_cursor', 0)          # new destination: start from scratch
            try:
                u, t = cloudsync.config(conn)
                handoff.remember_link(CONFIG_PATH, u, t)
            except Exception:
                pass
            conn.execute('UPDATE appointments SET synced_at=NULL')
            conn.execute('DELETE FROM sync_clinical')
            for k in ('sync_patients_hash', 'sync_config_hash', 'sync_clinical_t'):
                cloudsync.meta_set(conn, k, '')
            return {'ok': True}
        if p0 == 'sync_now' and method == 'POST':
            conn.commit()
            threading.Thread(target=cloudsync.sync_once, args=(connect, DB_PATH, WRITE_LOCK),
                             kwargs={'backup': bool(b.get('backup'))}, daemon=True).start()
            return {'ok': True}
        if p0 == 'backup' and method == 'POST':
            conn.commit()
            threading.Thread(target=do_backup, args=('manual',), daemon=True).start()
            return {'ok': True}
        return None

    def _static(self, path):
        if path in ('', '/'):
            path = '/index.html'
        elif path in ('/m', '/m/'):
            path = '/m.html'
        full = os.path.normpath(os.path.join(STATIC, path.lstrip('/')))
        if not full.startswith(STATIC) or not os.path.isfile(full):
            return self._send(404, b'not found', 'text/plain')
        with open(full, 'rb') as f:
            self._send(200, f.read(), MIME.get(os.path.splitext(full)[1], 'application/octet-stream'))


def open_browser(url):
    """Opens the program in Chrome (or Edge) as a full-screen window without tabs or address bar.
    F11 leaves full screen. "fullscreen": false in config.json opens the normal browser instead.
    A separate browser profile in data/ makes Chrome honour the full-screen switch even when
    Chrome is already open for other things."""
    import webbrowser, subprocess
    if CFG.get('fullscreen', True) is False or os.name != 'nt':
        return webbrowser.open(url)
    cands = []
    for env in ('PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'):
        b = os.environ.get(env)
        if b:
            cands += [os.path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                      os.path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe')]
    exe = next((c for c in cands if os.path.isfile(c)), None)
    if not exe:
        return webbrowser.open(url)
    prof = os.path.join(ROOT, 'data', 'browser-profile')
    try:
        os.makedirs(prof, exist_ok=True)
        subprocess.Popen([exe, '--app=' + url, '--start-fullscreen', '--user-data-dir=' + prof,
                          '--no-first-run', '--no-default-browser-check', '--disable-features=Translate'],
                         close_fds=True)
    except Exception:
        webbrowser.open(url)


def local_ips():
    ips = set()
    try:
        sk = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sk.connect(('10.255.255.255', 1))
        ips.add(sk.getsockname()[0])
        sk.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except Exception:
        pass
    return sorted(i for i in ips if not i.startswith('127.'))


def shutdown_now():
    """Close button: the last upload was already done by the request — stop the server"""
    time.sleep(0.5)
    os._exit(0)


def main():
    cloudsync.PATHS.update(config=CONFIG_PATH, db=DB_PATH)
    relink.check(CFG, DB_PATH)
    handoff.startup(CFG, DB_PATH, FILES_DIR, WRITE_LOCK)     # several PCs: fetch the newest data before opening it
    conn = db()
    init_schema(conn)
    try:
        u, t = cloudsync.config(conn)
        if u and t:
            handoff.remember_link(CONFIG_PATH, u, t)
    except Exception as e:
        print(' ', e)
    try:            # newer data from the old program (app/incoming/*.json), each file once
        import import_add
        for name, st in import_add.run(conn, handoff.can_sync()):
            print(' Imported', name, st)
    except Exception as e:
        print(' Import of app/incoming failed:', e)
    conn.close()
    port = int(CFG['port'])
    try:
        srv = ThreadingHTTPServer((os.environ.get('CLINIC_BIND') or '0.0.0.0', port), Handler)
    except OSError:
        try:
            import urllib.request, webbrowser
            urllib.request.urlopen('http://127.0.0.1:%d/api/me' % port, timeout=3)
            print(' Clinic server is already running - opening it in the browser.')
            open_browser('http://localhost:%d' % port)
            sys.exit(3)
        except SystemExit:
            raise
        except Exception:
            print(' Port %d is used by another program. Change "port" in config.json.' % port)
            sys.exit(1)
    threading.Thread(target=backup_loop, daemon=True).start()
    cloudsync.GATE = handoff.can_sync
    threading.Thread(target=cloudsync.loop, args=(connect, DB_PATH, WRITE_LOCK), daemon=True).start()
    errlog.watch({'sync': cloudsync.STATE, 'handoff': handoff.STATE, 'update': updater.STATE, 'backup': BACKUP_STATE},
                 connect, DB_PATH, WRITE_LOCK, can_write=lambda: not handoff.STATE['readonly'])
    if handoff.STATE['enabled']:
        threading.Thread(target=handoff.loop, daemon=True).start()
        handoff.install_close_handler()
    print('=' * 60)
    print(' Clinic server is running - do not close this window')
    print(' On this computer:     http://localhost:%d' % port)
    for ip in local_ips():
        print(' From other devices:   http://%s:%d' % (ip, port))
    print(' Database: %s' % DB_PATH)
    print('=' * 60)
    if '--no-browser' not in sys.argv:
        try:
            open_browser('http://localhost:%d' % port)
        except Exception:
            pass
    try:
        updater.loop()
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
