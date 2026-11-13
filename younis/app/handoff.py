# -*- coding: utf-8 -*-
"""
الحاسبة والهاتف بالتناوب — جهاز واحد في كل مرة — عبر Google Drive (بايثون القياسي فقط).

  * الجهاز الذي يشغّل البرنامج يحمل "القفل" (يحفظه سكربت Google، جهاز واحد في كل مرة).
  * أثناء العمل يرفع قاعدة البيانات كاملة (مضغوطة) كل دقيقتين إذا تغيّر فيها شيء.
  * عند تشغيل الجهاز الآخر يطلب القفل: إن كان الأول ما زال يعمل يُطلب منه التسليم،
    فيرفع آخر نسخة ويصبح للقراءة فقط، ثم ينزّل الجهاز الجديد أحدث نسخة.
  * الجهاز الذي يُغلق يرفع آخر نسخة (زر الإغلاق في البرنامج، أو إغلاق النافذة السوداء).

جهاز بلا رابط مزامنة يعمل كما كان تماماً.
Same design as Dr. Zakaria's program (zak-clinic/app/handoff.py), without attached files.
"""
import base64, datetime, gzip, hashlib, json, os, socket, sqlite3, sys, tempfile, threading, time, urllib.error, uuid

import cloudsync

TITLE = 'عيادة د. مهند يونس'
PUSH_EVERY = 120          # seconds between uploads (only when the database changed)
ALIVE_MS = 90 * 1000      # a holder silent for longer than this is considered switched off
HANDOVER_WAIT = 180       # seconds a starting device waits for the other one to upload and hand over
POLL = 4                  # seconds between lease checks while waiting
STATE = {'why': '', 'enabled': False, 'holder': False, 'readonly': False, 'offline': False, 'conflict': False,
         'other': '', 'seq': 0, 'last_push': None, 'error': None}
_push_lock = threading.Lock()
CTX = {}


def pc_id():
    if os.environ.get('CLINIC_PC_ID'):
        return os.environ['CLINIC_PC_ID']
    return hashlib.sha1(('%s|%s' % (socket.gethostname(), uuid.getnode())).encode()).hexdigest()[:16]


def pc_name():
    return os.environ.get('CLINIC_PC_NAME') or socket.gethostname()


# ------------------------------------------------------------------ settings + local state
def settings(cfg, db_path):
    """link + token: config.json first (travels with the folder), otherwise the database of this device"""
    if cfg.get('handoff') is False:
        return None
    url, token = (cfg.get('sync_url') or '').strip(), (cfg.get('sync_token') or '').strip()
    if (not url or not token) and os.path.exists(db_path):
        try:
            c = sqlite3.connect(db_path)
            r = dict(c.execute("SELECT k, v FROM meta WHERE k IN ('sync_url','sync_token')").fetchall())
            c.close()
            url, token = url or (r.get('sync_url') or ''), token or (r.get('sync_token') or '')
        except Exception:
            pass
    return (url, token) if url and token else None


def remember_link(config_path, url, token):
    """keep the online link in config.json too, so a copied folder (or the phone) knows where to fetch the data"""
    try:
        with open(config_path, encoding='utf-8') as f:
            c = json.load(f)
    except Exception:
        c = {}
    if c.get('sync_url') == url and c.get('sync_token') == token:
        return
    c['sync_url'], c['sync_token'] = url, token
    with open(config_path, 'w', encoding='utf-8') as f:
        json.dump(c, f, ensure_ascii=False, indent=2)


def _state_path(db_path):
    return os.path.join(os.path.dirname(db_path), 'handoff.json')


def load_local(db_path):
    try:
        with open(_state_path(db_path), encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {'seq': 0, 'sig': None}


def save_local(db_path, st):
    with open(_state_path(db_path), 'w', encoding='utf-8') as f:
        json.dump(st, f)


def db_sig(db_path):
    out = []
    for p in (db_path, db_path + '-wal'):
        try:
            s = os.stat(p)
            out.append([int(s.st_mtime * 1000), s.st_size])
        except OSError:
            out.append(None)
    return out


def count_patients(path):
    """patients in a database file (None = no file / unreadable)"""
    if not path or not os.path.exists(path):
        return None
    try:
        c = sqlite3.connect('file:%s?mode=ro' % path, uri=True)
        n = c.execute('SELECT COUNT(*) FROM patients').fetchone()[0]
        c.close()
        return n
    except Exception:
        return 0


NO_DATA = ('لا توجد بيانات المرضى على Google Drive بعد.\n\n'
           'شغّل البرنامج المحدَّث على حاسبة العيادة أولاً (بعد نشر Code.gs الجديد) حتى يرفع قاعدة البيانات، '
           'ثم افتح البرنامج هنا من جديد.')
OLD_SCRIPT = ('سكربت Google «مزامنة عيادة د. مهند» قديم ولا يدعم نقل البيانات بين الحاسبة والهاتف.\n\n'
              'انشر Code.gs الجديد (Deploy ← Manage deployments ← Edit ← New version)، ثم شغّل البرنامج على الحاسبة، ثم افتحه هنا.')


# ------------------------------------------------------------------ talking to Google
def _call(action, timeout=120, **kw):
    url, token = CTX['link']
    return cloudsync.call(url, token, action, timeout=timeout, pc=pc_id(), name=pc_name(), **kw)


def alive_other(L):
    return bool(L.get('holder')) and L['holder'] != pc_id() and cloudsync.now_ms() - int(L.get('beat') or 0) < ALIVE_MS


def snapshot(db_path):
    fd, tmp = tempfile.mkstemp(suffix='.db')
    os.close(fd)
    try:
        src, dst = sqlite3.connect(db_path), sqlite3.connect(tmp)
        src.backup(dst)
        dst.execute('PRAGMA journal_mode=DELETE')
        dst.close()
        src.close()
        with open(tmp, 'rb') as f:
            return gzip.compress(f.read(), 6)
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def push_db(force=False, final=False):
    """upload the database if it changed since the last upload/download.
    final: this device is read-only from now on (hand-over / Close), so its copy on Google is complete —
    closing the program changes the file stamp afterwards, which must not look like unsent changes next time"""
    db_path = CTX['db']
    with _push_lock:
        st = load_local(db_path)
        sig = db_sig(db_path)
        if not force and sig == st.get('sig'):
            if final and not st.get('clean'):
                st['clean'] = True
                save_local(db_path, st)
            return False
        if not count_patients(db_path):         # never upload an empty database over the real one
            return False
        with CTX['write_lock']:                 # a consistent copy: no write in the middle
            data = snapshot(db_path)
        r = _call('db_push', timeout=300, data=base64.b64encode(data).decode('ascii'))
        st.update(seq=int(r['seq']), sig=sig, clean=final)
        save_local(db_path, st)
        STATE.update(seq=st['seq'], last_push=datetime.datetime.now().strftime('%H:%M'))
        return True


def pull_db(L):
    db_path = CTX['db']
    r = _call('db_pull', timeout=300)
    if not r.get('data'):
        return False
    raw = gzip.decompress(base64.b64decode(r['data']))
    part = db_path + '.part'
    with open(part, 'wb') as f:
        f.write(raw)
    c = sqlite3.connect(part)
    ok = c.execute('PRAGMA quick_check').fetchone()[0]
    c.close()
    if ok != 'ok':
        os.remove(part)
        raise RuntimeError('downloaded database is damaged (%s)' % ok)
    if not count_patients(part) and count_patients(db_path):
        os.remove(part)                         # an empty copy on Drive: keep this device's data and upload it instead
        print(' The copy on Google Drive is empty - keeping the data of this device.')
        CTX['force_push'] = True
        return False
    if os.path.exists(db_path):                 # keep this device's old copy, just in case
        keep = os.path.join(os.path.dirname(db_path), 'before-download')
        os.makedirs(keep, exist_ok=True)
        c = sqlite3.connect(db_path)
        d = sqlite3.connect(os.path.join(keep, 'clinic_%s.db' % datetime.datetime.now().strftime('%Y-%m-%d_%H%M%S')))
        c.backup(d)
        d.close()
        c.close()
        for o in sorted(os.listdir(keep))[:-5]:
            try:
                os.remove(os.path.join(keep, o))
            except OSError:
                pass
    for x in (db_path + '-wal', db_path + '-shm'):
        if os.path.exists(x):
            os.remove(x)
    os.replace(part, db_path)
    save_local(db_path, {'seq': int(r['seq']), 'sig': db_sig(db_path)})
    STATE['seq'] = int(r['seq'])
    print(' Downloaded the newest data (saved by %s)' % (r.get('by') or 'the other device'))
    return True


# ------------------------------------------------------------------ asking the person at the device
def ask(text):
    if os.environ.get('CLINIC_TAKEOVER') == '1':        # the phone app: opening it means "work here now"
        return True
    if os.name == 'nt':
        try:
            import ctypes
            return ctypes.windll.user32.MessageBoxW(0, text, TITLE, 0x04 | 0x30 | 0x40000 | 0x100000) == 6   # Yes/No, warning, topmost, RTL
        except Exception:
            pass
    try:
        return input(text + '\n\nThe program is running on the other device. Move it here? [y/n] ').strip().lower().startswith('y')
    except (EOFError, OSError, RuntimeError):
        return True


def tell(text):
    if os.name == 'nt':
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, text, TITLE, 0x40 | 0x40000 | 0x100000)
            return
        except Exception:
            pass
    print(' ' + text)


def wait_handover(L):
    """the other device was asked to hand over: wait while it uploads its last data (while it is still alive),
    up to HANDOVER_WAIT seconds; take over by force only when it is silent (switched off / no internet)."""
    other = L.get('name') or 'the other device'
    print(' Waiting for %s to upload its last data ...' % other)
    t0 = time.time()
    while time.time() - t0 < HANDOVER_WAIT:
        time.sleep(POLL)
        L = _call('lease')
        if L.get('holder') == pc_id():
            return L
        if not alive_other(L):
            print(' %s stopped answering - taking over.' % other)
            break
    else:
        print(' %s did not finish in %d seconds - taking over anyway.' % (other, HANDOVER_WAIT))
    return _call('claim', force=True)


# ------------------------------------------------------------------ start-up (before the database is opened)
def startup(cfg, db_path, write_lock):
    link = settings(cfg, db_path)
    CTX.update(db=db_path, write_lock=write_lock, link=link)
    if not link:
        STATE['why'] = 'no_link'
        return
    STATE['enabled'] = True
    print(' Checking for newer data on Google Drive ...')
    try:
        L = _call('lease')
        if alive_other(L):
            if not ask('البرنامج يعمل الآن على: %s\n\nهل تريد نقله إلى هذا الجهاز؟\n'
                       'سيحفظ ذلك الجهاز آخر بياناته ثم يتوقف عن التعديل.' % (L.get('name') or '?')):
                print(' Not taken over - closing.')
                sys.exit(0)
            L2 = _call('claim', force=False)
            L = L2 if L2.get('holder') == pc_id() else wait_handover(L)
        if L.get('holder') != pc_id():
            L = _call('claim', force=True)
        STATE['holder'] = True
        st = load_local(db_path)
        if int(L.get('seq') or 0) > int(st.get('seq') or 0) or (int(L.get('seq') or 0) and not os.path.exists(db_path)):
            if st.get('sig') and not st.get('clean') and db_sig(db_path) != st['sig']:
                print(' Note: this device had changes that were never uploaded - its copy is kept in data/before-download.')
            pull_db(L)
        else:
            STATE['seq'] = int(st.get('seq') or 0)
        if not count_patients(db_path):         # nothing to work on: Drive has no data yet
            try:
                _call('release')
            except Exception:
                pass
            tell(NO_DATA)
            sys.exit(0)
        if CTX.pop('force_push', False):
            push_db(force=True)
    except SystemExit:
        raise
    except (urllib.error.URLError, OSError) as e:
        STATE['offline'] = True
        STATE['error'] = 'No internet'
        print(' No internet - working on the data already on this device.')
        tell('لا يوجد إنترنت الآن.\nسيعمل البرنامج على البيانات الموجودة في هذا الجهاز.\n\n'
             'تأكد أن الجهاز الآخر لم يُستخدم منذ آخر مرة عُمل هنا، وإلا ستنقسم البيانات.')
    except Exception as e:
        if 'Unknown action' in str(e) or 'غير معروف' in str(e):   # the online script is older than this program
            STATE['enabled'] = False
            STATE['why'] = 'old_script'
            print(' Hand-over between devices is off: update Code.gs in the online version first.')
            if not count_patients(db_path):     # the phone has no data of its own: say why instead of opening an empty program
                tell(OLD_SCRIPT)
                sys.exit(0)
            return
        STATE['error'] = str(e)
        print(' Hand-over check failed: %s' % e)


# ------------------------------------------------------------------ while running
def can_sync():
    """the appointment sync may only run on the device holding the program"""
    return not STATE['enabled'] or (STATE['holder'] and not STATE['readonly'])


def hand_over():
    """the other device asked for the program: freeze, upload the last copy, release"""
    STATE['readonly'] = True
    push_db(force=True, final=True)         # if this fails the other device takes over by itself once this one is silent
    _call('release')
    STATE['holder'] = False
    print(' Handed over to %s - this device is now read-only. Restart the program here to take it back.' % STATE['other'])


def tick():
    if not STATE['enabled'] or STATE['readonly'] or STATE['conflict']:
        return
    try:
        L = _call('beat', timeout=60)
        STATE['offline'] = False
        if not STATE['holder']:                 # started without internet
            st = load_local(CTX['db'])
            if alive_other(L) or int(L.get('seq') or 0) > int(st.get('seq') or 0):
                STATE['conflict'] = True
                STATE['other'] = L.get('name') or ''
                STATE['error'] = 'The other device saved newer data while this one was offline'
                return
            _call('claim', force=True)
            STATE['holder'] = True
            return
        if L.get('holder') != pc_id():          # taken over by force (this device was silent too long)
            STATE.update(readonly=True, holder=False, other=L.get('name') or '')
            return
        if L.get('pending'):
            STATE['other'] = L.get('pending_name') or ''
            hand_over()
            return
        if time.time() - CTX.get('pushed_t', 0) >= PUSH_EVERY:
            CTX['pushed_t'] = time.time()
            push_db()
        STATE['error'] = None
    except (urllib.error.URLError, OSError):
        STATE['offline'] = True
        STATE['error'] = 'No internet'
    except Exception as e:
        if STATE['error'] != str(e):
            print(' Hand-over: %s' % e)
        STATE['error'] = str(e)


def loop(every=20):
    while True:
        tick()
        time.sleep(every)


def final_push():
    """on closing: last upload + let the other device start at once"""
    if not STATE['enabled'] or not STATE['holder'] or STATE['readonly']:
        return
    STATE['readonly'] = True
    try:
        push_db(final=True)
        _call('release', timeout=30)
        STATE['holder'] = False
        print(' Last data uploaded.')
    except Exception as e:
        print(' Last upload failed: %s' % e)


def install_close_handler():
    """closing the black window (or Windows shutting down) → final_push (Windows gives a few seconds)"""
    if os.name != 'nt':
        return
    try:
        import ctypes

        @ctypes.WINFUNCTYPE(ctypes.c_int, ctypes.c_uint)
        def handler(ev):
            if ev in (0, 1, 2, 5, 6):
                final_push()
            return 0
        CTX['handler'] = handler            # keep a reference
        ctypes.windll.kernel32.SetConsoleCtrlHandler(handler, True)
    except Exception:
        pass
