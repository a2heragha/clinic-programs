# -*- coding: utf-8 -*-
"""
خادم برنامج العيادة — بايثون القياسي فقط (3.8+)، بدون أي مكتبات إضافية.
عيادة أزهر وعلي: تعمل على حاسبة العيادة أو على الهاتف (تطبيق Android) بالتناوب،
وقاعدة البيانات تنتقل بينهما عبر Google Drive (handoff.py).
"""
import os, sys, json, re, threading, time, datetime, shutil, socket, sqlite3, traceback
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get('CLINIC_ROOT') or os.path.dirname(HERE)      # the phone app keeps its data outside the program folder
sys.path.insert(0, HERE)
import updater          # silent update from GitHub before the program's own modules load
if updater.boot(HERE, os.path.join(ROOT, 'config.json')) and __name__ == '__main__' and not os.environ.get('CLINIC_PHONE'):
    import subprocess
    sys.exit(subprocess.call([sys.executable] + sys.argv))      # run the updated program
import relink
from common import norm_name, norm_phone, connect, init_schema, merge_patients, doc_styles
import cloudsync
import handoff

CONFIG_PATH = os.path.join(ROOT, 'config.json')
DEFAULT_CONFIG = {
    'port': 8080,
    'db': 'data/clinic.db',
    'backup_dir': 'backups',
    'backup_dir2': '',          # مجلد احتياطي ثانٍ (فلاش أو قرص آخر) — اختياري
    'backup_keep': 30,
}


def load_config():
    cfg = dict(DEFAULT_CONFIG)
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, encoding='utf-8') as f:
            cfg.update(json.load(f))
    else:
        os.makedirs(ROOT, exist_ok=True)
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
    if os.environ.get('CLINIC_PORT'):
        cfg['port'] = int(os.environ['CLINIC_PORT'])
    return cfg


CFG = load_config()
DB_PATH = CFG['db'] if os.path.isabs(CFG['db']) else os.path.join(ROOT, CFG['db'])
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
IS_PHONE = bool(os.environ.get('CLINIC_PHONE'))


def db():
    return connect(DB_PATH)


def today():
    return datetime.date.today().isoformat()


# ---------------------------------------------------------------- النسخ الاحتياطي
BACKUP_STATE = {'last': None, 'error': None}


def do_backup(tag='auto'):
    stamp = datetime.datetime.now().strftime('%Y-%m-%d_%H%M')
    dirs = [CFG['backup_dir'], CFG.get('backup_dir2') or '']
    made = []
    try:
        src = db()
        for d in dirs:
            if not d:
                continue
            d = d if os.path.isabs(d) else os.path.join(ROOT, d)
            try:
                os.makedirs(d, exist_ok=True)
                path = os.path.join(d, 'clinic_%s_%s.db' % (stamp, tag))
                part = path + '.part'
                dst = sqlite3.connect(part)
                src.backup(dst)
                dst.execute('PRAGMA journal_mode=DELETE')
                dst.close()
                os.replace(part, path)
                made.append(path)
                files = sorted(f for f in os.listdir(d) if f.startswith('clinic_') and f.endswith('.db'))
                for old in files[:-int(CFG.get('backup_keep', 30))]:
                    os.remove(os.path.join(d, old))
            except Exception as e:
                BACKUP_STATE['error'] = '%s: %s' % (d, e)
        src.close()
        BACKUP_STATE['last'] = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
        if made and not BACKUP_STATE['error']:
            BACKUP_STATE['error'] = None
    except Exception as e:
        BACKUP_STATE['error'] = str(e)
    return made


def backup_loop():
    do_backup('start')
    while True:
        time.sleep(6 * 3600)
        do_backup('auto')


# ---------------------------------------------------------------- منطق البيانات
def balance(conn, pid):
    w = conn.execute("SELECT COALESCE(SUM(price_final),0) FROM works WHERE patient_id=? AND legacy=0 AND status='done'", (pid,)).fetchone()[0]
    p = conn.execute('SELECT COALESCE(SUM(amount),0) FROM payments WHERE patient_id=?', (pid,)).fetchone()[0]
    return round(w - p, 3)


def family(conn, pid):
    """كل المرتبطين بالمريض (مباشرة أو عبر غيره)، مع صلة كل منهم."""
    seen = {pid}
    queue = [pid]
    while queue:
        cur = queue.pop()
        for l in conn.execute('SELECT a_id,b_id FROM links WHERE a_id=? OR b_id=?', (cur, cur)):
            o = l['b_id'] if l['a_id'] == cur else l['a_id']
            if o not in seen:
                seen.add(o)
                queue.append(o)
    seen.discard(pid)
    out = []
    for o in seen:
        p = conn.execute('SELECT id,name,dob,phone FROM patients WHERE id=?', (o,)).fetchone()
        if not p:
            continue
        rel = conn.execute('SELECT id,relation,a_id FROM links WHERE (a_id=? AND b_id=?) OR (a_id=? AND b_id=?)', (o, pid, pid, o)).fetchone()
        relation, link_id = '', None
        if rel:
            link_id = rel['id']
            relation = rel['relation'] or ''
        d = dict(p)
        d['relation'] = relation
        d['link_id'] = link_id
        d['direct'] = bool(rel)
        d['reverse'] = bool(rel) and rel['a_id'] == pid   # الصلة مكتوبة من جهة المريض الحالي
        d['balance'] = balance(conn, o)
        out.append(d)
    out.sort(key=lambda x: (not x['direct'], x['name']))
    return out


def patient_full(conn, pid):
    p = conn.execute('SELECT * FROM patients WHERE id=?', (pid,)).fetchone()
    if not p:
        return None
    works = [dict(r) for r in conn.execute('''SELECT w.*, (SELECT SUM(amount) FROM payments m WHERE m.work_id=w.id) paid
                                              FROM works w WHERE patient_id=? ORDER BY seq, id''', (pid,))]
    pays = [dict(r) for r in conn.execute(
        '''SELECT pm.*, pp.name payer FROM payments pm LEFT JOIN patients pp ON pp.id=pm.payer_id
           WHERE pm.patient_id=? ORDER BY pm.date, pm.id''', (pid,))]
    # دفعات قام بها هذا المريض لحساب غيره
    paid_for = [dict(r) for r in conn.execute(
        '''SELECT pm.*, pp.name account FROM payments pm JOIN patients pp ON pp.id=pm.patient_id
           WHERE pm.payer_id=? AND pm.patient_id<>? ORDER BY pm.date''', (pid, pid))]
    fam = family(conn, pid)
    tot_orig = sum((w['price_orig'] or 0) for w in works if not w['legacy'] and w['status'] == 'done')
    tot_final = sum((w['price_final'] or 0) for w in works if not w['legacy'] and w['status'] == 'done')
    tot_paid = sum(x['amount'] for x in pays)
    return {
        'patient': dict(p), 'works': works, 'payments': pays, 'paid_for_others': paid_for,
        'family': fam,
        'totals': {'orig': tot_orig, 'final': tot_final, 'discount': tot_orig - tot_final,
                   'paid': tot_paid, 'balance': round(tot_final - tot_paid, 3)},
    }


def search(conn, q, limit=40):
    q = (q or '').strip()
    if not q:
        rows = conn.execute('SELECT id,name,dob,phone,area,form_no FROM patients ORDER BY updated_at DESC, id DESC LIMIT ?', (limit,)).fetchall()
        return [dict(r) for r in rows]
    qn = norm_name(q)
    digits = re.sub(r'\D', '', q.translate(str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')))
    where, args = [], []
    words = [w for w in qn.split(' ') if w]
    if words:
        where.append('(' + ' AND '.join(['name_norm LIKE ?'] * len(words)) + ')')
        args += ['%' + w + '%' for w in words]
    if digits and len(digits) >= 3:
        where.append('phone_norm LIKE ?')
        args.append('%' + digits + '%')
    if digits:
        where.append('form_no = ?')
        args.append(digits)
    sql = ('SELECT id,name,dob,phone,area,form_no, '
           'CASE WHEN name_norm LIKE ? THEN 0 ELSE 1 END rk '
           'FROM patients WHERE ' + ' OR '.join(where) + ' ORDER BY rk, name_norm LIMIT ?')
    rows = conn.execute(sql, [qn + '%'] + args + [limit]).fetchall()
    return [dict(r) for r in rows]


def num(v):
    if v is None or v == '':
        return None
    try:
        return float(str(v).replace(',', '').translate(str.maketrans('٠١٢٣٤٥٦٧٨٩', '0123456789')))
    except ValueError:
        raise ApiError('Invalid number: %s' % v)


class ApiError(Exception):
    def __init__(self, msg, code=400):
        super().__init__(msg)
        self.code = code


PAT_EDITABLE = ['form_no', 'name', 'dob', 'phone', 'area', 'medical', 'p_factor', 'private_note', 'xray']
WORK_EDITABLE = ['date', 'tooth', 'work_type', 'doctor', 'price_orig', 'price_final', 'details', 'status']
PAY_EDITABLE = ['date', 'amount', 'payer_id', 'payer_name', 'note']
LIST_TABLES = {'doctors': 'doctor', 'work_types': 'work_type', 'areas': 'area', 'p_factors': 'p_factor', 'labs': 'lab'}


def remember_value(conn, table, value):
    value = (value or '').strip()
    if value:
        conn.execute('INSERT OR IGNORE INTO %s(name) VALUES(?)' % table, (value,))


def save_patient(conn, pid, data):
    fields = {k: (str(data[k]).strip() if data[k] is not None else '') for k in PAT_EDITABLE if k in data}
    if 'xray' in fields:
        fields['xray'] = 1 if fields['xray'] in ('1', 'true', 'True') else 0
    if 'name' in fields and not fields['name']:
        raise ApiError('Patient name is required')
    if pid is None:
        if not fields.get('name'):
            raise ApiError('Patient name is required')
        cur = conn.execute('INSERT INTO patients(name,name_norm) VALUES(?,?)', (fields['name'], norm_name(fields['name'])))
        pid = cur.lastrowid
    if fields:
        extra = {}
        if 'name' in fields:
            extra['name_norm'] = norm_name(fields['name'])
        if 'phone' in fields:
            extra['phone_norm'] = norm_phone(fields['phone'])
        allf = dict(fields, **extra)
        conn.execute('UPDATE patients SET %s, updated_at=datetime(\'now\',\'localtime\') WHERE id=?' %
                     ', '.join('%s=?' % k for k in allf), list(allf.values()) + [pid])
        if fields.get('area'):
            remember_value(conn, 'areas', fields['area'])
        if fields.get('p_factor'):
            remember_value(conn, 'p_factors', fields['p_factor'])
    return pid


def save_work(conn, wid, data):
    f = {}
    for k in WORK_EDITABLE:
        if k in data:
            v = data[k]
            if k in ('price_orig', 'price_final'):
                v = num(v)
            elif k == 'status':
                v = 'plan' if v == 'plan' else 'done'
            elif k == 'date':
                v = (v or '').strip() or None
                if v and not re.match(r'^\d{4}-\d{2}-\d{2}$', v):
                    raise ApiError('Invalid date')
            else:
                v = (v or '').strip() if isinstance(v, str) else v
                if k == 'tooth' and v:
                    m = re.match(r'^\s*(UR|UL|LR|LL)\s*[-_.]?\s*([1-8A-E])\s*$', v, re.I)
                    if m:
                        v = (m.group(1) + m.group(2)).upper()
            f[k] = v
    if wid is None:
        pid = int(data['patient_id'])
        seq = conn.execute('SELECT COALESCE(MAX(seq),0)+1 FROM works WHERE patient_id=?', (pid,)).fetchone()[0]
        cur = conn.execute("INSERT INTO works(patient_id,seq,status) VALUES(?,?,'done')", (pid, seq))
        wid = cur.lastrowid
    else:
        row = conn.execute('SELECT legacy FROM works WHERE id=?', (wid,)).fetchone()
        if not row:
            raise ApiError('Work not found')
    if f:
        conn.execute('UPDATE works SET %s WHERE id=?' % ', '.join('%s=?' % k for k in f), list(f.values()) + [wid])
    if f.get('work_type') and (conn.execute("SELECT v FROM meta WHERE k='free_work_types'").fetchone() or [''])[0] == '1':
        remember_value(conn, 'work_types', f['work_type'])   # free list: a new work type is added to the list
    # السعر بعد التخفيض يساوي الأصلي ما لم يُحدد
    conn.execute('UPDATE works SET price_final=price_orig WHERE id=? AND price_final IS NULL AND price_orig IS NOT NULL AND legacy=0', (wid,))
    w = conn.execute('SELECT patient_id, date FROM works WHERE id=?', (wid,)).fetchone()
    if 'paid' in data:
        amt = num(data['paid'])
        ex = conn.execute('SELECT id FROM payments WHERE work_id=?', (wid,)).fetchone()
        if amt is None or amt == 0:
            conn.execute('DELETE FROM payments WHERE work_id=?', (wid,))
        elif ex:
            conn.execute('UPDATE payments SET amount=? WHERE id=?', (amt, ex['id']))
        else:
            conn.execute('INSERT INTO payments(patient_id,payer_id,date,amount,work_id,note) VALUES(?,?,?,?,?,?)',
                         (w['patient_id'], w['patient_id'], w['date'] or today(), amt, wid, 'with work'))
    if 'date' in data and w['date']:
        conn.execute('UPDATE payments SET date=? WHERE work_id=?', (w['date'], wid))
    conn.execute("UPDATE patients SET updated_at=datetime('now','localtime') WHERE id=?", (w['patient_id'],))
    return wid


def save_payment(conn, pmid, data):
    f = {}
    for k in PAY_EDITABLE:
        if k in data:
            v = data[k]
            if k in ('amount', 'paid'):
                v = num(v)
            elif k == 'payer_id':
                v = int(v) if v not in (None, '') else None
            elif isinstance(v, str):
                v = v.strip()
            f[k] = v
    if pmid is None:
        if f.get('amount') is None:
            raise ApiError('Amount is required')
        pid = int(data['patient_id'])
        cur = conn.execute('INSERT INTO payments(patient_id,amount,date,payer_id) VALUES(?,?,?,?)',
                           (pid, f['amount'], f.get('date') or today(), f.get('payer_id') or pid))
        pmid = cur.lastrowid
    if f:
        conn.execute('UPDATE payments SET %s WHERE id=?' % ', '.join('%s=?' % k for k in f), list(f.values()) + [pmid])
    return pmid


def rename_list_item(conn, table, item_id, new_name, active):
    row = conn.execute('SELECT * FROM %s WHERE id=?' % table, (item_id,)).fetchone()
    if not row:
        raise ApiError('Not found')
    old = row['name']
    if new_name is not None and new_name.strip() and new_name.strip() != old:
        new = new_name.strip()
        kind = LIST_TABLES[table]
        exists = conn.execute('SELECT id FROM %s WHERE name=?' % table, (new,)).fetchone()
        if kind == 'doctor':
            conn.execute('UPDATE works SET doctor=? WHERE doctor=?', (new, old))
        elif kind == 'work_type':
            conn.execute('UPDATE works SET work_type=? WHERE work_type=?', (new, old))
        elif kind == 'area':
            conn.execute('UPDATE patients SET area=? WHERE area=?', (new, old))
        elif kind == 'p_factor':
            conn.execute('UPDATE patients SET p_factor=? WHERE p_factor=?', (new, old))
        elif kind == 'lab':
            conn.execute('UPDATE lab_works SET lab=? WHERE lab=?', (new, old))
        if kind == 'doctor':
            conn.execute('UPDATE appointments SET doctor=?, updated_at=? WHERE doctor=?', (new, int(time.time() * 1000), old))
            conn.execute('UPDATE lab_works SET doctor=? WHERE doctor=?', (new, old))
        if exists:
            conn.execute('DELETE FROM %s WHERE id=?' % table, (item_id,))
        else:
            conn.execute('UPDATE %s SET name=? WHERE id=?' % table, (new, item_id))
        conn.execute('INSERT INTO renames(kind,old,new) VALUES(?,?,?)', (kind, old, new))
    if active is not None and table in ('doctors', 'work_types'):
        conn.execute('UPDATE %s SET active=? WHERE name=?' % table, (1 if active else 0, (new_name or old).strip()))


def lists(conn):
    out = {}
    for t in ('doctors', 'work_types'):
        out[t] = [dict(r) for r in conn.execute('SELECT * FROM %s ORDER BY active DESC, name' % t)]
        if t == 'doctors':
            cnt = dict(conn.execute('SELECT doctor, COUNT(*) FROM works GROUP BY doctor').fetchall())
        else:
            cnt = dict(conn.execute('SELECT work_type, COUNT(*) FROM works GROUP BY work_type').fetchall())
        for r in out[t]:
            r['count'] = cnt.get(r['name'], 0)
    cnt = dict(conn.execute('SELECT area, COUNT(*) FROM patients GROUP BY area').fetchall())
    out['areas'] = [dict(r, count=cnt.get(r['name'], 0)) for r in conn.execute('SELECT * FROM areas')]
    out['areas'].sort(key=lambda r: -r['count'])
    cnt = dict(conn.execute('SELECT p_factor, COUNT(*) FROM patients GROUP BY p_factor').fetchall())
    out['p_factors'] = [dict(r, count=cnt.get(r['name'], 0)) for r in conn.execute('SELECT * FROM p_factors')]
    out['p_factors'].sort(key=lambda r: -r['count'])
    cnt = dict(conn.execute('SELECT lab, COUNT(*) FROM lab_works GROUP BY lab').fetchall())
    out['labs'] = [dict(r, count=cnt.get(r['name'], 0)) for r in conn.execute('SELECT * FROM labs ORDER BY name')]
    out['doc_styles'] = doc_styles(conn)
    # per-clinic settings (empty = the defaults of the original clinic)
    meta = dict(conn.execute("SELECT k, v FROM meta WHERE k IN ('app_title','free_work_types','cloud','xray_path','default_doctor')").fetchall())
    out['profile'] = {'app_title': meta.get('app_title') or '', 'free_work_types': meta.get('free_work_types') == '1',
                      'cloud': meta.get('cloud', '1') != '0', 'xray_path': meta.get('xray_path') or '',
                      'default_doctor': meta.get('default_doctor') or '', 'phone': IS_PHONE,
                      'handoff': handoff.STATE['enabled']}
    return out


def appt_sort_key(order):
    """appointments: by doctor (in the doctors' order; no doctor last), then by time"""
    idx = {c: i for i, c in enumerate(order)}
    return lambda a: (idx.get(a.get('doctor') or '', 900 if a.get('doctor') else 999), a.get('doctor') or '',
                      a.get('time') or '99:99', a.get('id') or 0)


def debts(conn):
    rows = conn.execute('''
      SELECT p.id, p.name, p.phone,
        COALESCE((SELECT SUM(price_final) FROM works w WHERE w.patient_id=p.id AND legacy=0 AND status='done'),0)
        - COALESCE((SELECT SUM(amount) FROM payments m WHERE m.patient_id=p.id),0) AS bal,
        (SELECT MAX(date) FROM works w WHERE w.patient_id=p.id) last_visit
      FROM patients p WHERE p.id IN (SELECT patient_id FROM works WHERE legacy=0 UNION SELECT patient_id FROM payments)
    ''').fetchall()
    out = [dict(r) for r in rows if abs(r['bal']) > 0.0001]
    out.sort(key=lambda r: -r['bal'])
    return out


APPT_FIELDS = ['date', 'time', 'doctor', 'patient_id', 'name', 'age', 'phone', 'area', 'work', 'note', 'status']


def appts(conn, date):
    rows = conn.execute('''SELECT a.*, p.name pname, p.phone pphone FROM appointments a LEFT JOIN patients p ON p.id=a.patient_id
                           WHERE a.date=? AND COALESCE(a.deleted,0)=0 ORDER BY COALESCE(NULLIF(a.time,''),'99:99'), a.id''', (date,)).fetchall()
    out = [dict(r) for r in rows]
    out.sort(key=appt_sort_key([d[0] for d in doc_styles(conn)]))
    return out


def save_appt(conn, aid, b):
    f = {}
    for k in APPT_FIELDS:
        if k in b:
            v = b[k]
            if k == 'patient_id':
                v = int(v) if v not in (None, '', 0, '0') else None
            elif isinstance(v, str):
                v = v.strip()
            f[k] = v
    if aid is None:
        cur = conn.execute('INSERT INTO appointments(date, uid, deleted) VALUES(?,?,0)', (f.get('date') or today(), cloudsync.new_uid()))
        aid = cur.lastrowid
    f['updated_at'] = cloudsync.now_ms()          # every change is stamped for the cloud sync
    conn.execute('UPDATE appointments SET %s WHERE id=?' % ', '.join('%s=?' % k for k in f), list(f.values()) + [aid])
    # a phone typed for a registered patient also updates his file
    a = conn.execute('SELECT patient_id, phone FROM appointments WHERE id=?', (aid,)).fetchone()
    if 'phone' in f and a['patient_id'] and (a['phone'] or '').strip():
        conn.execute("UPDATE patients SET phone=?, phone_norm=?, updated_at=datetime('now','localtime') WHERE id=?",
                     (a['phone'].strip(), norm_phone(a['phone']), a['patient_id']))
    return aid


def income(conn, date_from, date_to):
    rows = [dict(r) for r in conn.execute('''
      SELECT m.id, m.date, m.amount, m.note, p.id patient_id, p.name, w.work_type, w.tooth, w.doctor, w.details
      FROM payments m JOIN patients p ON p.id=m.patient_id LEFT JOIN works w ON w.id=m.work_id
      WHERE m.date BETWEEN ? AND ? AND COALESCE(w.status,'done')<>'plan' ORDER BY m.date, m.id''', (date_from, date_to))]
    by_doc = {}
    for r in rows:
        k = r['doctor'] or ''
        by_doc[k] = by_doc.get(k, 0) + (r['amount'] or 0)
    return {'rows': rows, 'by_doctor': by_doc, 'total': sum(r['amount'] or 0 for r in rows)}


EXP_FIELDS = ['date', 'item', 'office', 'amount', 'paid', 'doctor', 'source', 'note']


def expenses(conn, date_from, date_to):
    rows = [dict(r) for r in conn.execute('SELECT * FROM expenses WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC', (date_from, date_to))]
    by = {}
    for r in rows:
        # paid empty = paid in full; "source" totals count only the money that actually went out
        r['paid_eff'] = r['amount'] if r['paid'] is None else r['paid']
        r['remaining'] = max(0, (r['amount'] or 0) - (r['paid_eff'] or 0))
        k = (r['doctor'] or '—') + ('|' + (r['source'] or 'income'))
        by[k] = by.get(k, 0) + (r['paid_eff'] or 0)
    # what the clinic still owes each office (all dates, not only this period)
    owed = [dict(r) for r in conn.execute('''SELECT COALESCE(NULLIF(office,''),'—') office, SUM(amount - paid) remaining, COUNT(*) n, MIN(date) since
        FROM expenses WHERE paid IS NOT NULL AND amount IS NOT NULL AND paid < amount GROUP BY 1 ORDER BY 2 DESC''')]
    return {'rows': rows, 'total': sum(r['amount'] or 0 for r in rows), 'total_paid': sum(r['paid_eff'] or 0 for r in rows),
            'total_remaining': sum(r['remaining'] for r in rows), 'owed': owed, 'by_source': by,
            'items': [r[0] for r in conn.execute('SELECT name FROM exp_items ORDER BY name')],
            'offices': [r[0] for r in conn.execute('SELECT name FROM exp_offices ORDER BY name')]}


def save_expense(conn, eid, b):
    f = {}
    for k in EXP_FIELDS:
        if k in b:
            v = b[k]
            if k in ('amount', 'paid'):
                v = num(v)
            elif k == 'source':
                v = 'pocket' if v == 'pocket' else 'income'
            elif isinstance(v, str):
                v = v.strip()
            f[k] = v
    if eid is None:
        cur = conn.execute('INSERT INTO expenses(date) VALUES(?)', (f.get('date') or today(),))
        eid = cur.lastrowid
    if f:
        conn.execute('UPDATE expenses SET %s WHERE id=?' % ', '.join('%s=?' % k for k in f), list(f.values()) + [eid])
    if f.get('item'):
        remember_value(conn, 'exp_items', f['item'])
    if f.get('office'):
        remember_value(conn, 'exp_offices', f['office'])
    return eid


# ------------------------------------------------------------------ prayer times (shown as rows on the appointments page)
from common import prayers_for, PRAYER_DEFAULTS, prayer_cfg, save_prayer_table, parse_prayer_xlsx


LAB_FIELDS = ['date', 'patient', 'patient_id', 'doctor', 'teeth', 'work_type', 'lab', 'amount', 'paid', 'source', 'note']


def labworks(conn, date_from, date_to):
    rows = [dict(r) for r in conn.execute('SELECT * FROM lab_works WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC', (date_from, date_to))]
    by_lab = {}
    by_src = {}
    for r in rows:
        r['paid_eff'] = r['amount'] if r['paid'] is None else r['paid']
        r['remaining'] = max(0, (r['amount'] or 0) - (r['paid_eff'] or 0))
        k = r['lab'] or '—'
        by_lab[k] = by_lab.get(k, 0) + (r['amount'] or 0)
        k = (r['doctor'] or '—') + '|' + (r['source'] or 'income')
        by_src[k] = by_src.get(k, 0) + (r['paid_eff'] or 0)
    # what the clinic still owes each lab (all dates, not only this period)
    owed = [dict(r) for r in conn.execute('''SELECT COALESCE(NULLIF(lab,''),'—') lab, SUM(amount - paid) remaining, COUNT(*) n, MIN(date) since
        FROM lab_works WHERE paid IS NOT NULL AND amount IS NOT NULL AND paid < amount GROUP BY 1 ORDER BY 2 DESC''')]
    return {'rows': rows, 'total': sum(r['amount'] or 0 for r in rows), 'total_paid': sum(r['paid_eff'] or 0 for r in rows),
            'total_remaining': sum(r['remaining'] for r in rows), 'owed': owed, 'by_lab': by_lab, 'by_source': by_src,
            'labs': [r[0] for r in conn.execute('SELECT name FROM labs ORDER BY name')]}


def save_labwork(conn, lid, b):
    f = {}
    for k in LAB_FIELDS:
        if k in b:
            v = b[k]
            if k in ('amount', 'paid'):
                v = num(v)
            elif k == 'patient_id':
                v = int(v) if str(v or '').isdigit() else None
            elif k == 'source':
                v = 'pocket' if v == 'pocket' else 'income'
            elif isinstance(v, str):
                v = v.strip()
            f[k] = v
    if lid is None:
        lid = conn.execute('INSERT INTO lab_works(date) VALUES(?)', (f.get('date') or today(),)).lastrowid
    if f:
        conn.execute('UPDATE lab_works SET %s WHERE id=?' % ', '.join('%s=?' % k for k in f), list(f.values()) + [lid])
    if f.get('lab'):
        remember_value(conn, 'labs', f['lab'])
    if f.get('work_type') and is_free_work_types(conn):
        remember_value(conn, 'work_types', f['work_type'])
    return lid


def is_free_work_types(conn):
    r = conn.execute("SELECT v FROM meta WHERE k='free_work_types'").fetchone()
    return bool(r and r[0] == '1')


# ------------------------------------------------------------------ X-ray program (runs on the clinic PC, next to this server)
def xray_browse():
    """opens a Windows "Open file" dialog on the clinic PC and returns the chosen program ('' = cancelled)"""
    if IS_PHONE:
        raise ApiError('برنامج الأشعة يُختار من حاسبة العيادة فقط')
    try:
        import tkinter
        from tkinter import filedialog
        root = tkinter.Tk()
        root.withdraw()
        root.attributes('-topmost', True)
        path = filedialog.askopenfilename(parent=root, title='اختر برنامج الأشعة',
                                          filetypes=[('Programs', '*.exe *.lnk *.bat *.cmd'), ('All files', '*.*')])
        root.destroy()
        return os.path.normpath(path) if path else ''
    except Exception:
        pass
    if os.name == 'nt':   # fallback without tkinter: the PowerShell dialog
        import subprocess
        ps = ('Add-Type -AssemblyName System.Windows.Forms;$d=New-Object System.Windows.Forms.OpenFileDialog;'
              '$d.Filter="Programs|*.exe;*.lnk;*.bat;*.cmd|All files|*.*";$d.Title="X-ray program";'
              '$f=New-Object System.Windows.Forms.Form;$f.TopMost=$true;'
              'if($d.ShowDialog($f) -eq "OK"){[Console]::Out.Write($d.FileName)}')
        r = subprocess.run(['powershell', '-NoProfile', '-STA', '-Command', ps], capture_output=True, text=True,
                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        return r.stdout.strip()
    raise ApiError('نافذة اختيار الملف غير متاحة على هذا الجهاز — اكتب المسار يدوياً')


def xray_launch(conn):
    """starts the X-ray program; if it is already open, brings its window to the front instead"""
    if IS_PHONE:
        return {'ok': False, 'error': 'برنامج الأشعة يعمل على حاسبة العيادة فقط'}
    r = conn.execute("SELECT v FROM meta WHERE k='xray_path'").fetchone()
    path = (r[0] if r else '') or ''
    if not path:
        return {'ok': False, 'error': 'لم يُحدد برنامج الأشعة — اختره من Settings'}
    if not os.path.exists(path):
        return {'ok': False, 'error': 'برنامج الأشعة غير موجود في: ' + path}
    if os.name != 'nt':
        return {'ok': False, 'error': 'التشغيل متاح على ويندوز فقط'}
    import subprocess
    exe = os.path.basename(path)
    if exe.lower().endswith('.exe'):
        try:
            out = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq ' + exe, '/FO', 'CSV', '/NH'], capture_output=True, text=True,
                                 creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)).stdout
            m = re.search(r'"%s","(\d+)"' % re.escape(exe), out, re.I)
            if m:   # already running: bring it to the front
                subprocess.Popen(['powershell', '-NoProfile', '-Command',
                                  '(New-Object -ComObject WScript.Shell).AppActivate(%s) | Out-Null' % m.group(1)],
                                 creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                return {'ok': True, 'running': True}
        except Exception:
            pass
    os.startfile(path, cwd=os.path.dirname(path)) if sys.version_info >= (3, 10) else os.startfile(path)
    return {'ok': True}


# post-extraction instructions sheet (from the clinic's Word template). "# " = heading, "= " = centred closing line
EXTRACT_TEXT = """# تعليمات يجب على المريض اتباعها بعد قلع السن
1. التحلي بالصبر وتذكر فضله واحتساب الاجر.
2. العض على قطعة القطن لمدة نصف ساعة.
3. عدم وضع قطنة أخرى بعد أزاله الأولى.
4. عدم التدخين في الأيام الأولى من القلع.
5. تجنب الطعام والشراب الساخن وتناول الطعام اللين كالشوربة.
6. تناول الادوية الموصوفة بعد الاكل بساعة.
7. عدم المضمضة في اليوم الأول.
8. لا تبصق بشدة لان ذلك يؤدي الى النزيف.
9. رفع الرأس عند النوم بوسادة وتغطية الوسادة لتجنب حدوث بقع الدم عليها.
10. المضمضة في اليوم الثاني بكوب ماء مضافا اليه ملعقة شاي من الملح ثلاث مرات في اليوم لمدة 3 أيام.
# أمور طبيعية ممكن حدوثها بعد القلع
1. الألم بعد القلع: تناول المسكن الموصوف.
2. ظهور لون الدم مع اللعاب في اليوم الأول والثاني.
3. حدوث ورم قرب موقع القلع: ضع كمادات باردة على الموقع المتورم لمدة دقيقة ثم قم بإزالتها لمدة دقيقة (وكرر العملية).
4. الإحساس بوجود نتوءات عظمية في مكان القلع: تذوب تلقائيا بمرور الوقت.
= نتمنى لكم الشفاء العاجل"""


def rx_meta(conn, pid):
    docs = [dict(r) for r in conn.execute('SELECT name, full_name, deg1, deg2, active FROM doctors ORDER BY active DESC, name')]
    out = {'doctors': docs,
           'drugs': [r[0] for r in conn.execute('SELECT name FROM rx_drugs ORDER BY name')],
           'notes': [r[0] for r in conn.execute('SELECT name FROM rx_notes ORDER BY id')],
           'templates': [dict(r, drugs=json.loads(r['drugs'] or '[]')) for r in conn.execute('SELECT * FROM rx_templates ORDER BY id')],
           'footer': (conn.execute("SELECT v FROM meta WHERE k='clinic_footer'").fetchone() or [''])[0],
           'title': (conn.execute("SELECT v FROM meta WHERE k='clinic_title'").fetchone() or [''])[0],
           'extract': (conn.execute("SELECT v FROM meta WHERE k='extract_text'").fetchone() or [EXTRACT_TEXT])[0] or EXTRACT_TEXT}
    if pid:
        last = conn.execute("SELECT doctor FROM works WHERE patient_id=? AND doctor<>'' ORDER BY COALESCE(date,'0000') DESC, seq DESC LIMIT 1", (pid,)).fetchone()
        out['last_doctor'] = last[0] if last else ''
        out['history'] = [dict(r) for r in conn.execute('SELECT * FROM prescriptions WHERE patient_id=? ORDER BY id DESC', (pid,))]
    return out


def save_template(conn, tid, b):
    name = (b.get('name') or '').strip() or 'نموذج'
    drugs = json.dumps([d.strip() for d in (b.get('drugs') or []) if d.strip()], ensure_ascii=False)
    note = (b.get('note') or '').strip()
    if tid is None:
        tid = conn.execute('INSERT INTO rx_templates(name,drugs,note) VALUES(?,?,?)', (name, drugs, note)).lastrowid
    else:
        conn.execute('UPDATE rx_templates SET name=?, drugs=?, note=? WHERE id=?', (name, drugs, note, tid))
    remember_rx(conn, b)
    return tid


def remember_rx(conn, b):
    for d in (b.get('drugs') or []):
        if d.strip():
            conn.execute('INSERT OR IGNORE INTO rx_drugs(name) VALUES(?)', (d.strip(),))
    if (b.get('note') or '').strip():
        conn.execute('INSERT OR IGNORE INTO rx_notes(name) VALUES(?)', (b['note'].strip(),))


def similar(conn, name, phone):
    out = {}
    qn = norm_name(name)
    if qn:
        words = [w for w in qn.split(' ') if w]
        if words:
            sql = 'SELECT id,name,dob,phone,area FROM patients WHERE ' + ' AND '.join(['name_norm LIKE ?'] * len(words)) + ' LIMIT 15'
            for r in conn.execute(sql, ['%' + w + '%' for w in words]):
                out[r['id']] = dict(r, why='similar name')
    pn = norm_phone(phone)
    if pn:
        for r in conn.execute('SELECT id,name,dob,phone,area FROM patients WHERE phone_norm=? LIMIT 10', (pn,)):
            out[r['id']] = dict(r, why='same mobile')
    return list(out.values())


def day_report(conn, date_from, date_to):
    rows = [dict(r) for r in conn.execute('''
      SELECT w.*, p.name FROM works w JOIN patients p ON p.id=w.patient_id
      WHERE w.legacy=0 AND w.date BETWEEN ? AND ? ORDER BY w.date, w.id''', (date_from, date_to))]
    pays = [dict(r) for r in conn.execute('''
      SELECT m.*, p.name, w.doctor wdoctor FROM payments m JOIN patients p ON p.id=m.patient_id LEFT JOIN works w ON w.id=m.work_id
      WHERE m.date BETWEEN ? AND ? ORDER BY m.date, m.id''', (date_from, date_to))]
    by_doc = {}
    for w in rows:
        if w['status'] != 'done':
            continue
        d = by_doc.setdefault(w['doctor'] or '—', {'count': 0, 'final': 0, 'paid': 0})
        d['count'] += 1
        d['final'] += w['price_final'] or 0
    for m in pays:   # money received, per doctor of the work it was paid for
        d = by_doc.setdefault(m['wdoctor'] or '—', {'count': 0, 'final': 0, 'paid': 0})
        d['paid'] += m['amount'] or 0
    return {'works': rows, 'payments': pays, 'by_doctor': by_doc,
            'total_final': sum(v['final'] for v in by_doc.values()),
            'total_paid': sum(p['amount'] for p in pays)}


def dup_list(conn):
    out = []
    for c in conn.execute("SELECT * FROM dup_candidates WHERE status='pending' ORDER BY id").fetchall():
        a = patient_full(conn, c['a_id'])
        b = patient_full(conn, c['b_id'])
        if not a or not b:
            conn.execute("UPDATE dup_candidates SET status='merged' WHERE id=?", (c['id'],))
            continue
        out.append({'id': c['id'], 'reason': c['reason'], 'a': a, 'b': b})
    return out


def dup_decide(conn, cid, action, keep):
    c = conn.execute('SELECT * FROM dup_candidates WHERE id=?', (cid,)).fetchone()
    if not c:
        raise ApiError('Not found')
    la = conn.execute('SELECT legacy_ids FROM patients WHERE id=?', (c['a_id'],)).fetchone()
    lb = conn.execute('SELECT legacy_ids FROM patients WHERE id=?', (c['b_id'],)).fetchone()
    la = (la[0] if la else '') or ''
    lb = (lb[0] if lb else '') or ''
    if action == 'different':
        conn.execute("UPDATE dup_candidates SET status='different' WHERE id=?", (cid,))
        for x in la.split(','):
            for y in lb.split(','):
                if x and y:
                    conn.execute('INSERT OR REPLACE INTO decisions VALUES(?,?,?)', (x, y, 'different'))
        return c['a_id']
    keep = int(keep) if keep else c['a_id']
    drop = c['b_id'] if keep == c['a_id'] else c['a_id']
    merge_patients(conn, keep, drop)
    conn.execute("UPDATE dup_candidates SET status='merged' WHERE id=?", (cid,))
    for x in la.split(','):
        for y in lb.split(','):
            if x and y:
                conn.execute('INSERT OR REPLACE INTO decisions VALUES(?,?,?)', (x, y, 'merge'))
    return keep


def family_suggestions(conn, pid):
    """مرضى يشتركون مع هذا المريض في رقم الهاتف أو اسم الأب/اللقب — كاقتراح فقط."""
    p = conn.execute('SELECT * FROM patients WHERE id=?', (pid,)).fetchone()
    linked = set(x['id'] for x in family(conn, pid)) | {pid}
    out = {}
    if p['phone_norm']:
        for r in conn.execute('SELECT id,name,dob,phone FROM patients WHERE phone_norm=? AND id<>?', (p['phone_norm'], pid)):
            if r['id'] not in linked:
                out[r['id']] = dict(r, why='same phone')
    return list(out.values())[:10]


# ---------------------------------------------------------------- HTTP
STATIC = os.path.join(HERE, 'static')
MIME = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png'}
WRITE_LOCK = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    server_version = 'Clinic/1.0'

    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype='application/json; charset=utf-8'):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False, default=str).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if not n:
            return {}
        return json.loads(self.rfile.read(n).decode('utf-8'))

    def do_GET(self):
        self._route('GET')

    def do_POST(self):
        self._route('POST')

    def do_PUT(self):
        self._route('PUT')

    def do_DELETE(self):
        self._route('DELETE')

    def _route(self, method):
        u = urlparse(self.path)
        path = u.path
        qs = {k: v[0] for k, v in parse_qs(u.query).items()}
        if not path.startswith('/api/'):
            return self._static(path)
        parts = [p for p in path[5:].split('/') if p]
        p0 = parts[0] if parts else ''
        try:
            body = self._body() if method in ('POST', 'PUT', 'DELETE') else {}
            # the program moved to the other device: this one only shows the data
            if handoff.STATE['readonly'] and method != 'GET' and p0 not in ('shutdown', 'xray_launch'):
                raise ApiError('البرنامج انتقل إلى %s — هذا الجهاز للقراءة فقط. أغلق البرنامج وأعد تشغيله هنا لاستلامه.'
                               % (handoff.STATE.get('other') or 'الجهاز الآخر'), 423)
            if method == 'POST' and p0 == 'shutdown':
                threading.Thread(target=shutdown_now, daemon=True).start()
                res = {'ok': True, 'handoff': handoff.STATE['enabled']}
            elif method == 'POST' and p0 in ('xray_browse', 'xray_launch'):
                # outside the write lock: the file dialog waits for the user
                if p0 == 'xray_browse':
                    res = {'path': xray_browse()}
                else:
                    conn = db()
                    try:
                        res = xray_launch(conn)
                    finally:
                        conn.close()
            elif method == 'GET':
                conn = db()
                try:
                    res = self._get(conn, parts, qs)
                    conn.commit()
                finally:
                    conn.close()
            else:
                with WRITE_LOCK:
                    conn = db()
                    try:
                        conn.execute('BEGIN IMMEDIATE')
                        res = self._write(conn, method, parts, body)
                        conn.commit()
                    except Exception:
                        conn.rollback()
                        raise
                    finally:
                        conn.close()
            if res is None:
                return self._send(404, {'error': 'Not found'})
            self._send(200, res)
        except ApiError as e:
            self._send(e.code, {'error': str(e)})
        except Exception as e:
            traceback.print_exc()
            self._send(500, {'error': 'Server error: %s' % e})

    def _get(self, conn, parts, qs):
        p0 = parts[0] if parts else ''
        if p0 == 'search':
            return search(conn, qs.get('q', ''))
        if p0 == 'patient' and len(parts) == 2:
            return patient_full(conn, int(parts[1]))
        if p0 == 'lists':
            return lists(conn)
        if p0 == 'debts':
            return debts(conn)
        if p0 == 'report':
            return day_report(conn, qs.get('from') or today(), qs.get('to') or qs.get('from') or today())
        if p0 == 'dups':
            return dup_list(conn)
        if p0 == 'family_suggest' and len(parts) == 2:
            return family_suggestions(conn, int(parts[1]))
        if p0 == 'income':
            return income(conn, qs.get('from') or today(), qs.get('to') or qs.get('from') or today())
        if p0 == 'prayers':
            return prayers_for(conn, qs.get('date') or today())
        if p0 == 'prayer_cfg':
            return prayer_cfg(conn)
        if p0 == 'labworks':
            return labworks(conn, qs.get('from') or today()[:8] + '01', qs.get('to') or today())
        if p0 == 'expenses':
            return expenses(conn, qs.get('from') or today()[:8] + '01', qs.get('to') or today())
        if p0 == 'rx':
            return rx_meta(conn, int(qs['patient']) if qs.get('patient') else None)
        if p0 == 'sync':
            url, token = cloudsync.config(conn)
            return dict(cloudsync.STATE, url=url, has_token=bool(token),
                        pending=conn.execute('SELECT COUNT(*) FROM appointments WHERE uid IS NOT NULL AND updated_at > COALESCE(synced_at,0)').fetchone()[0])
        if p0 == 'pc':           # which device holds the program (hand-over through Google Drive)
            return dict(handoff.STATE, me=handoff.pc_name(), phone=IS_PHONE)
        if p0 == 'phone_link':   # link + code typed once into the phone app — shown only on the clinic PC itself
            if self.client_address[0] not in ('127.0.0.1', '::1'):
                raise ApiError('يُعرض الرمز على حاسبة العيادة نفسها فقط', 403)
            url, token = cloudsync.config(conn)
            return {'url': url, 'token': token}
        if p0 == 'appts':
            return appts(conn, qs.get('date') or today())
        if p0 == 'similar':
            return similar(conn, qs.get('name', ''), qs.get('phone', ''))
        if p0 == 'next_form_no':
            mx = 0
            for (f,) in conn.execute("SELECT form_no FROM patients WHERE form_no<>''"):
                if f and str(f).isdigit():
                    mx = max(mx, int(f))
            return {'next': mx + 1}
        if p0 == 'status':
            return {'backup': BACKUP_STATE, 'db': DB_PATH,
                    'patients': conn.execute('SELECT COUNT(*) FROM patients').fetchone()[0],
                    'works': conn.execute('SELECT COUNT(*) FROM works').fetchone()[0],
                    'meta': {k: v for k, v in conn.execute('SELECT k,v FROM meta').fetchall() if k != 'sync_token'},
                    'pending_dups': conn.execute("SELECT COUNT(*) FROM dup_candidates WHERE status='pending'").fetchone()[0]}
        return None

    def _write(self, conn, method, parts, b):
        p0 = parts[0] if parts else ''
        pid = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else None
        if p0 == 'patient':
            if method == 'POST':
                return {'id': save_patient(conn, None, b)}
            if method == 'PUT':
                save_patient(conn, pid, b)
                return {'id': pid}
            if method == 'DELETE':
                conn.execute('DELETE FROM patients WHERE id=?', (pid,))
                return {'ok': True}
        if p0 == 'work':
            if method == 'POST':
                return {'id': save_work(conn, None, b)}
            if method == 'PUT':
                return {'id': save_work(conn, pid, b)}
            if method == 'DELETE':
                conn.execute('DELETE FROM works WHERE id=?', (pid,))
                return {'ok': True}
        if p0 == 'payment':
            if method == 'POST':
                return {'id': save_payment(conn, None, b)}
            if method == 'PUT':
                return {'id': save_payment(conn, pid, b)}
            if method == 'DELETE':
                conn.execute('DELETE FROM payments WHERE id=?', (pid,))
                return {'ok': True}
        if p0 == 'link':
            if method == 'POST':
                a, c = int(b['a_id']), int(b['b_id'])
                if a == c:
                    raise ApiError('Cannot link a patient to himself')
                if conn.execute('SELECT 1 FROM links WHERE (a_id=? AND b_id=?) OR (a_id=? AND b_id=?)', (a, c, c, a)).fetchone():
                    raise ApiError('Already linked')
                cur = conn.execute('INSERT INTO links(a_id,b_id,relation) VALUES(?,?,?)', (a, c, (b.get('relation') or '').strip()))
                return {'id': cur.lastrowid}
            if method == 'PUT':
                conn.execute('UPDATE links SET relation=? WHERE id=?', ((b.get('relation') or '').strip(), pid))
                return {'ok': True}
            if method == 'DELETE':
                conn.execute('DELETE FROM links WHERE id=?', (pid,))
                return {'ok': True}
        if p0 in LIST_TABLES:
            t = p0
            if method == 'POST':
                name = (b.get('name') or '').strip()
                if not name:
                    raise ApiError('Name is required')
                conn.execute('INSERT OR IGNORE INTO %s(name) VALUES(?)' % t, (name,))
                if t in ('doctors', 'work_types'):
                    conn.execute('UPDATE %s SET active=1 WHERE name=?' % t, (name,))
                return {'ok': True}
            if method == 'PUT':
                rename_list_item(conn, t, pid, b.get('name'), b.get('active'))
                return {'ok': True}
            if method == 'DELETE':
                conn.execute('DELETE FROM %s WHERE id=?' % t, (pid,))
                return {'ok': True}
        if p0 == 'labwork':
            if method == 'POST':
                return {'id': save_labwork(conn, None, b)}
            if method == 'PUT':
                return {'id': save_labwork(conn, pid, b)}
            if method == 'DELETE':
                conn.execute('DELETE FROM lab_works WHERE id=?', (pid,))
                return {'ok': True}
        if p0 == 'prayer_cfg' and method == 'PUT':
            cfg = prayer_cfg(conn)
            for k in PRAYER_DEFAULTS:
                if k in (b or {}):
                    v = b[k]
                    cfg[k] = {'on': bool(v.get('on')), 'before': max(0, min(120, int(v.get('before') or 0))), 'after': max(0, min(180, int(v.get('after') or 0)))}
            conn.execute("INSERT OR REPLACE INTO meta VALUES('prayer_cfg', ?)", (json.dumps(cfg),))
            return cfg
        if p0 == 'prayer_import' and method == 'POST':
            import base64
            table = parse_prayer_xlsx(base64.b64decode(b.get('data') or ''))
            if len(table) < 7:
                raise ApiError('لم أجد أوقات صلاة في الملف — يجب أن يحوي: التاريخ، العصر، المغرب، العشاء')
            save_prayer_table(table)
            k = sorted(table)
            return {'ok': True, 'days': len(table), 'from': k[0], 'to': k[-1]}
        if p0 == 'doctor_color' and method == 'PUT':
            c = (b.get('color') or '').strip()
            if c and not re.match(r'^#[0-9a-fA-F]{6}$', c):
                raise ApiError('لون غير صالح')
            conn.execute('UPDATE doctors SET color=? WHERE name=?', (c or None, b.get('name')))
            return {'ok': True, 'doc_styles': doc_styles(conn)}
        if p0 == 'expense':
            if method == 'POST':
                return {'id': save_expense(conn, None, b)}
            if method == 'PUT':
                return {'id': save_expense(conn, pid, b)}
            if method == 'DELETE':
                conn.execute('DELETE FROM expenses WHERE id=?', (pid,))
                return {'ok': True}
        if p0 == 'rx_template':
            if method == 'POST':
                return {'id': save_template(conn, None, b)}
            if method == 'PUT':
                return {'id': save_template(conn, pid, b)}
            if method == 'DELETE':
                conn.execute('DELETE FROM rx_templates WHERE id=?', (pid,))
                return {'ok': True}
        if p0 == 'prescription':
            if method == 'POST':
                remember_rx(conn, b)
                cur = conn.execute('INSERT INTO prescriptions(patient_id,date,doctor,name,age,drugs,note) VALUES(?,?,?,?,?,?,?)',
                                   (b.get('patient_id') or None, b.get('date') or today(), b.get('doctor'), b.get('name'), b.get('age'),
                                    '\n'.join(d.strip() for d in (b.get('drugs') or []) if d.strip()), (b.get('note') or '').strip()))
                return {'id': cur.lastrowid}
            if method == 'DELETE':
                conn.execute('DELETE FROM prescriptions WHERE id=?', (pid,))
                return {'ok': True}
        if p0 == 'rx_item' and method == 'DELETE':      # remove a saved drug line or instruction from the lists
            t = 'rx_drugs' if b.get('kind') == 'drug' else 'rx_notes'
            conn.execute('DELETE FROM %s WHERE name=?' % t, (b.get('name'),))
            return {'ok': True}
        if p0 == 'doctor_info' and method == 'PUT':
            conn.execute('UPDATE doctors SET full_name=?, deg1=?, deg2=? WHERE name=?',
                         (b.get('full_name', ''), b.get('deg1', ''), b.get('deg2', ''), b.get('name')))
            return {'ok': True}
        if p0 == 'meta' and method == 'PUT':
            for k in ('clinic_footer', 'clinic_title', 'extract_text', 'xray_path', 'default_doctor'):
                if k in b:
                    conn.execute('INSERT OR REPLACE INTO meta VALUES(?,?)', (k, b[k]))
            return {'ok': True}
        if p0 == 'appt':
            if method == 'POST':
                return {'id': save_appt(conn, None, b)}
            if method == 'PUT':
                return {'id': save_appt(conn, pid, b)}
            if method == 'DELETE':   # kept as "deleted" so the deletion reaches the online copy too
                conn.execute('UPDATE appointments SET deleted=1, updated_at=? WHERE id=?', (cloudsync.now_ms(), pid))
                return {'ok': True}
        if p0 == 'sync_config' and method == 'PUT':
            if (b.get('url') or '').strip() != (cloudsync.meta_get(conn, 'sync_url', '') or ''):
                try:        # another Google script: its hand-over count starts again, so this device uploads its data there
                    os.remove(os.path.join(os.path.dirname(DB_PATH), 'handoff.json'))
                except OSError:
                    pass
            cloudsync.meta_set(conn, 'sync_url', (b.get('url') or '').strip())
            if b.get('token') is not None:
                cloudsync.meta_set(conn, 'sync_token', (b.get('token') or '').strip())
            cloudsync.meta_set(conn, 'sync_cursor', 0)          # new destination: start from scratch
            conn.execute('UPDATE appointments SET synced_at=NULL')
            cloudsync.meta_set(conn, 'sync_patients_hash', '')
            try:
                u, t = cloudsync.config(conn)
                if u and t:
                    handoff.remember_link(CONFIG_PATH, u, t)
            except Exception:
                pass
            return {'ok': True}
        if p0 == 'sync_now' and method == 'POST':
            conn.commit()
            threading.Thread(target=cloudsync.sync_once, args=(lambda p: connect(p), DB_PATH, WRITE_LOCK),
                             kwargs={'backup': bool(b.get('backup')), 'force_patients': bool(b.get('backup'))}, daemon=True).start()
            if handoff.STATE['enabled'] and handoff.STATE['holder']:
                threading.Thread(target=lambda: handoff.push_db(force=False), daemon=True).start()
            return {'ok': True}
        if p0 == 'dups' and method == 'POST':
            return {'id': dup_decide(conn, pid, b.get('action'), b.get('keep'))}
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


def local_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except Exception:
        pass
    return sorted(i for i in ips if not i.startswith('127.'))


SERVER = {}


def shutdown_now():
    """Close button: last upload to Google Drive, then stop the server (the phone app closes itself)"""
    time.sleep(0.5)
    handoff.final_push()
    if IS_PHONE and SERVER.get('srv'):      # inside the Android app: stop serving, the app process stays in charge
        SERVER['srv'].shutdown()
        return
    os._exit(0)


def prepare():
    """everything before serving: hand-over check (newest data from Google Drive), schema, saved link"""
    relink.check(CFG, DB_PATH)
    handoff.startup(CFG, DB_PATH, WRITE_LOCK)     # two devices in turn: fetch the newest data before opening it
    conn = db()
    init_schema(conn)
    try:
        u, t = cloudsync.config(conn)
        if u and t:
            handoff.remember_link(CONFIG_PATH, u, t)
    except Exception as e:
        print(' ', e)
    conn.close()


def serve(open_browser=True):
    port = int(CFG['port'])
    host = os.environ.get('CLINIC_BIND') or '0.0.0.0'
    try:
        srv = ThreadingHTTPServer((host, port), Handler)
    except OSError:
        # already running (e.g. started with Windows) -> just open the program in the browser
        try:
            import urllib.request, webbrowser
            urllib.request.urlopen('http://127.0.0.1:%d/api/status' % port, timeout=3)
            print(' Clinic server is already running - opening it in the browser.')
            if open_browser:
                webbrowser.open('http://localhost:%d' % port)
            sys.exit(3)
        except SystemExit:
            raise
        except Exception:
            print(' Port %d is used by another program. Change "port" in config.json.' % port)
            sys.exit(1)
    SERVER['srv'] = srv
    threading.Thread(target=backup_loop, daemon=True).start()
    cloudsync.GATE = handoff.can_sync
    threading.Thread(target=cloudsync.loop, args=(lambda p: connect(p), DB_PATH, WRITE_LOCK), daemon=True).start()
    if handoff.STATE['enabled']:
        threading.Thread(target=handoff.loop, daemon=True).start()
        handoff.install_close_handler()
    print('=' * 60)
    print(' Clinic server is running - do not close this window')
    print(' On this computer:     http://localhost:%d' % port)
    for ip in local_ips():
        print(' From other computers: http://%s:%d' % (ip, port))
    print(' Database: %s' % DB_PATH)
    if handoff.STATE['enabled']:
        print(' Hand-over with the phone: ON (Google Drive)')
    print('=' * 60)
    if open_browser and '--no-browser' not in sys.argv:
        try:
            import webbrowser
            webbrowser.open('http://localhost:%d' % port)
        except Exception:
            pass
    try:
        updater.loop()
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


def main():
    prepare()
    serve(open_browser=not IS_PHONE)


if __name__ == '__main__':
    main()
