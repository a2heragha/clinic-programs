# -*- coding: utf-8 -*-
"""
مزامنة المواعيد مع النسخة الأونلاين (Google Sheets + Apps Script)، ورفع نسخة احتياطية يومية.
بايثون القياسي فقط. يعمل في خيط خلفي داخل الخادم؛ إن لم يتوفر الإنترنت ينتظر ويعيد المحاولة.

البروتوكول (طلبات POST بصيغة JSON إلى رابط Apps Script):
  {token, action:'push',     rows:[...]}                -> {ok, accepted}
  {token, action:'pull',     since:<srv_ts>}            -> {ok, rows:[...], cursor}
  {token, action:'patients', rows:[[id,name,age,phone,area],...]} -> {ok}
  {token, action:'backup',   name, data:<base64>}       -> {ok}
  {token, action:'ping'}                                -> {ok}
  {token, action:'config',   doctors:[[code,label,bg,fg],...]} -> {ok}   (doctor colours/order for the phone page)
  + the hand-over actions used by handoff.py (lease / claim / beat / release / db_push / db_pull)
"""
import json, time, uuid, base64, hashlib, os, tempfile, threading, datetime, sqlite3, urllib.request, urllib.error

from common import norm_phone, doc_styles, prayers_for, prayer_cfg

APPT_SYNC_FIELDS = ['uid', 'date', 'time', 'doctor', 'name', 'age', 'phone', 'area', 'work', 'note', 'status', 'patient_id', 'updated_at', 'deleted']
STATE = {'enabled': False, 'last_ok': None, 'last_try': None, 'error': None, 'pushed': 0, 'pulled': 0,
         'backup_last': None, 'running': False}
GATE = None          # set by the server: the appointment sync runs only on the device that holds the program (handoff.can_sync)
_lock = threading.Lock()


def now_ms():
    return int(time.time() * 1000)


def new_uid():
    return uuid.uuid4().hex


def meta_get(conn, k, default=None):
    r = conn.execute('SELECT v FROM meta WHERE k=?', (k,)).fetchone()
    return r[0] if r else default


def meta_set(conn, k, v):
    conn.execute('INSERT OR REPLACE INTO meta VALUES(?,?)', (k, None if v is None else str(v)))


def config(conn):
    return meta_get(conn, 'sync_url', '') or '', meta_get(conn, 'sync_token', '') or ''


def age_of(dob):
    t = str(dob or '').strip()
    y = None
    if len(t) == 4 and t.isdigit():
        y = int(t)
    elif len(t) >= 10 and t[:4].isdigit() and t[4] in '-/.':
        y = int(t[:4])
    elif len(t) >= 8 and t[-4:].isdigit() and t[-5] in '-/.':
        y = int(t[-4:])
    if not y or y < 1900 or y > datetime.date.today().year:
        return ''
    return str(datetime.date.today().year - y)


def call(url, token, action, timeout=40, **payload):
    payload.update({'token': token, 'action': action})
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'text/plain;charset=utf-8'}, method='POST')
    with urllib.request.urlopen(req, timeout=timeout) as r:   # Apps Script answers with a redirect; urllib follows it
        body = r.read().decode('utf-8')
    try:
        res = json.loads(body)
    except ValueError:
        raise RuntimeError('رد غير متوقع من Google — تأكد من الرابط ومن نشر السكربت (Deploy) كـ Anyone')
    if not res.get('ok'):
        raise RuntimeError(res.get('error') or 'خطأ من Google')
    return res


# ------------------------------------------------------------------ push / pull
def push(conn, url, token, write_lock):
    rows = conn.execute('SELECT * FROM appointments WHERE uid IS NOT NULL AND updated_at > COALESCE(synced_at, 0) ORDER BY updated_at LIMIT 500').fetchall()
    if not rows:
        return 0
    out = []
    for r in rows:
        d = {k: r[k] for k in APPT_SYNC_FIELDS}
        if r['patient_id'] and not (d['name'] or '').strip():
            p = conn.execute('SELECT name FROM patients WHERE id=?', (r['patient_id'],)).fetchone()
            d['name'] = p[0] if p else ''
        out.append(d)
    call(url, token, 'push', rows=out)          # network: no lock held
    with write_lock:
        for r in rows:   # mark as synced unless edited again meanwhile
            conn.execute('UPDATE appointments SET synced_at=? WHERE id=? AND updated_at=?', (r['updated_at'], r['id'], r['updated_at']))
        conn.commit()
    return len(rows)


def apply_remote(conn, rem):
    uid = rem.get('uid')
    if not uid:
        return False
    rem_upd = int(rem.get('updated_at') or 0)
    loc = conn.execute('SELECT * FROM appointments WHERE uid=?', (uid,)).fetchone()
    if loc and int(loc['updated_at'] or 0) >= rem_upd:
        return False
    pid = rem.get('patient_id')
    try:
        pid = int(pid) if pid not in (None, '', 0, '0') else None
    except (TypeError, ValueError):
        pid = None
    if pid and not conn.execute('SELECT 1 FROM patients WHERE id=?', (pid,)).fetchone():
        pid = None
    vals = {k: (str(rem.get(k)) if rem.get(k) not in (None,) else '') for k in ('date', 'time', 'doctor', 'name', 'age', 'phone', 'area', 'work', 'note', 'status')}
    if 'doctor' not in rem:   # older Google script without the doctor column: keep the local choice
        vals.pop('doctor')
    vals['patient_id'] = pid
    vals['deleted'] = 1 if str(rem.get('deleted') or '0') in ('1', 'true', 'True') else 0
    vals['updated_at'] = rem_upd
    vals['synced_at'] = rem_upd
    if not vals['date']:
        return False
    if loc:
        conn.execute('UPDATE appointments SET %s WHERE id=?' % ', '.join('%s=?' % k for k in vals), list(vals.values()) + [loc['id']])
    else:
        if vals['deleted']:
            return False
        vals['uid'] = uid
        conn.execute('INSERT INTO appointments(%s) VALUES(%s)' % (', '.join(vals), ', '.join('?' * len(vals))), list(vals.values()))
    # a phone written on the phone app for a registered patient updates his file
    if pid and vals['phone'].strip() and not vals['deleted']:
        conn.execute("UPDATE patients SET phone=?, phone_norm=?, updated_at=datetime('now','localtime') WHERE id=? AND COALESCE(phone,'')<>?",
                     (vals['phone'].strip(), norm_phone(vals['phone']), pid, vals['phone'].strip()))
    return True


def pull(conn, url, token, write_lock):
    since = int(meta_get(conn, 'sync_cursor', '0') or 0)
    res = call(url, token, 'pull', since=since)  # network: no lock held
    n = 0
    with write_lock:
        for rem in res.get('rows') or []:
            if apply_remote(conn, rem):
                n += 1
        meta_set(conn, 'sync_cursor', int(res.get('cursor') or since))
        conn.commit()
    return n


def push_patients(conn, url, token, write_lock, force=False):
    rows = [[r['id'], r['name'] or '', age_of(r['dob']), r['phone'] or '', r['area'] or '']
            for r in conn.execute('SELECT id, name, dob, phone, area FROM patients ORDER BY name_norm')]
    h = hashlib.md5(json.dumps(rows, ensure_ascii=False).encode('utf-8')).hexdigest()
    last = meta_get(conn, 'sync_patients_hash')
    last_t = int(meta_get(conn, 'sync_patients_t', '0') or 0)
    # also refresh once a day so ages stay right
    if not force and h == last and now_ms() - last_t < 24 * 3600 * 1000:
        return False
    call(url, token, 'patients', timeout=90, rows=rows)
    with write_lock:
        meta_set(conn, 'sync_patients_hash', h)
        meta_set(conn, 'sync_patients_t', now_ms())
        conn.commit()
    return True


def push_config(conn, url, token, write_lock):
    """doctor colours and order (Settings) → the Google phone page. Ignored by an older Code.gs."""
    # prayer rows for the phone page: today … +45 days (refreshed as the days go by)
    today = datetime.date.today()
    pcfg = prayer_cfg(conn)
    prayers = {}
    for i in range(46):
        d = (today + datetime.timedelta(days=i)).isoformat()
        rows = prayers_for(conn, d, pcfg)
        if rows:
            prayers[d] = [[r['label'], r['time'], r['end']] for r in rows]
    cfg = {'doctors': doc_styles(conn), 'default_doctor': meta_get(conn, 'default_doctor', '') or '', 'prayers': prayers}
    h = hashlib.md5(json.dumps(cfg, ensure_ascii=False).encode('utf-8')).hexdigest()
    last = meta_get(conn, 'sync_config_hash')
    if last == h or last == 'old-script-%d' % (now_ms() // 3600000):
        return False
    try:
        call(url, token, 'config', **cfg)
    except RuntimeError as e:
        if 'غير معروف' in str(e):   # Code.gs not updated yet: try again in an hour
            with write_lock:
                meta_set(conn, 'sync_config_hash', 'old-script-%d' % (now_ms() // 3600000))
                conn.commit()
            return False
        raise
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


# ------------------------------------------------------------------ one full round
def sync_once(connect, db_path, write_lock, backup=False, force_patients=False):
    """push → pull → patients → (backup). Returns a short summary."""
    if GATE and not GATE():
        return {'enabled': False, 'readonly': True}
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
            pushed = push(conn, url, token, write_lock)
            pulled = pull(conn, url, token, write_lock)
            pat = push_patients(conn, url, token, write_lock, force=force_patients)
            res = {'pushed': pushed, 'pulled': pulled, 'patients': pat, 'config': push_config(conn, url, token, write_lock)}
            last_b = int(meta_get(conn, 'sync_backup_t', '0') or 0)
            if backup or now_ms() - last_b > 20 * 3600 * 1000:
                res['backup'] = upload_backup(db_path, url, token)
                with write_lock:
                    meta_set(conn, 'sync_backup_t', now_ms())
                    meta_set(conn, 'sync_backup_name', res['backup'])
                    conn.commit()
            STATE.update(last_ok=datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'), error=None,
                         pushed=STATE['pushed'] + pushed, pulled=STATE['pulled'] + pulled,
                         backup_last=meta_get(conn, 'sync_backup_name'))
            return res
        finally:
            conn.close()
    except urllib.error.URLError as e:
        STATE['error'] = 'لا يوجد اتصال بالإنترنت (%s)' % getattr(e, 'reason', e)
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
        except Exception as e:  # never let the thread die
            STATE['error'] = str(e)
        time.sleep(every)
