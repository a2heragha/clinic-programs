# -*- coding: utf-8 -*-
"""
Several clinic PCs taking turns — one at a time — through Google Drive (Python standard library only).

  * The PC that runs the program holds the "lease" (kept by the Apps Script, one holder at a time).
  * While it runs it uploads the whole database (gzip, ≈2 MB) every 2 minutes when something changed,
    plus every new attached file (scans, PDFs).
  * When another PC starts, it asks for the lease. If the first PC is still on, it is asked to hand over:
    it uploads a final copy, becomes read-only, and the new PC downloads the newest copy + missing files.
  * The closing PC uploads a last copy (Close button in the program, or closing the black window).

Nothing changes on a PC with no online link configured: the program works exactly as before.
"""
import base64, datetime, gzip, hashlib, json, os, shutil, socket, sqlite3, sys, tempfile, threading, time, urllib.error, uuid

import cloudsync

PUSH_EVERY = 120          # seconds between uploads (only when the database changed)
ALIVE_MS = 90 * 1000      # a holder silent for longer than this is considered switched off
HANDOVER_WAIT = 180       # seconds a starting PC waits for the other PC to upload and hand over (while that PC is still alive)
POLL = 4                  # seconds between lease checks while waiting
STATE = {'enabled': False, 'holder': False, 'readonly': False, 'offline': False, 'conflict': False,
         'other': '', 'seq': 0, 'last_push': None, 'error': None, 'files_up': 0, 'files_down': 0}
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
    """link + token: config.json first (travels with the folder), otherwise the database of this PC"""
    url, token = (cfg.get('sync_url') or '').strip(), (cfg.get('sync_token') or '').strip()
    if (not url or not token) and os.path.exists(db_path):
        try:
            c = sqlite3.connect(db_path)
            r = dict(c.execute("SELECT k, v FROM meta WHERE k IN ('sync_url','sync_token')").fetchall())
            c.close()
            url, token = url or (r.get('sync_url') or ''), token or (r.get('sync_token') or '')
        except Exception:
            pass
    if cfg.get('handoff') is False:
        return None
    return (url, token) if url and token else None


def remember_link(config_path, url, token):
    """keep the online link in config.json too, so a copied folder knows where to fetch the data"""
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


def patient_count(db_path):
    try:
        c = sqlite3.connect(db_path)
        try:
            return c.execute('SELECT COUNT(*) FROM patients').fetchone()[0]
        finally:
            c.close()
    except Exception:
        return 0


def push_db(force=False, final=False):
    """upload the database if it changed since the last upload/download.
    final: this PC is read-only from now on (hand-over / Close), so its copy is complete on Google —
    closing the program changes the file stamp afterwards, which must not look like unsent changes next time"""
    db_path = CTX['db']
    if patient_count(db_path) == 0:            # never let an empty database replace the clinic's data on Google
        STATE['error'] = 'Empty database - not uploaded'
        return False
    with _push_lock:
        st = load_local(db_path)
        sig = db_sig(db_path)
        if not force and sig == st.get('sig'):
            if final and not st.get('clean'):
                st['clean'] = True
                save_local(db_path, st)
            return False
        t0 = time.time()
        with CTX['write_lock']:                 # a consistent copy: no write in the middle
            data = snapshot(db_path)
        if time.time() - t0 > 3:
            try:
                import errlog
                errlog.log('slow', 'copying the database for upload held saving for %.1f s' % (time.time() - t0))
            except Exception:
                pass
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
    if patient_count(part) == 0 and patient_count(db_path) > 0:      # an empty copy never replaces real data
        os.remove(part)
        raise RuntimeError('the copy on Google Drive is empty - kept the data of this device')
    if os.path.exists(db_path):                 # keep this PC's old copy, just in case
        keep = os.path.join(os.path.dirname(db_path), 'before-download')
        os.makedirs(keep, exist_ok=True)
        c = sqlite3.connect(db_path)
        d = sqlite3.connect(os.path.join(keep, 'clinic_%s.db' % datetime.datetime.now().strftime('%Y-%m-%d_%H%M%S')))
        c.backup(d)
        d.close()
        c.close()
        olds = sorted(os.listdir(keep))
        for o in olds[:-5]:
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
    print(' Downloaded the newest data (saved by %s)' % (r.get('by') or 'another PC'))
    return True


def _remote_name(rel):
    return rel.replace('\\', '/').replace('/', '__')


def local_files(files_dir):
    local = {}
    if os.path.isdir(files_dir):
        for dp, _, fns in os.walk(files_dir):
            for fn in fns:
                if fn.endswith('.part'):
                    continue
                full = os.path.join(dp, fn)
                local[_remote_name(os.path.relpath(full, files_dir))] = full
    return local


def sync_files(files_dir, up=True, down=True, limit=None):
    names = set(_call('files_list').get('names') or [])
    CTX['remote'] = names                       # what Google holds — so the 20-second tick can skip the listing
    local = local_files(files_dir)
    n = 0
    if up:
        for name, full in local.items():
            if name not in names:
                with open(full, 'rb') as f:
                    _call('file_put', timeout=300, fname=name, data=base64.b64encode(f.read()).decode('ascii'))
                names.add(name)
                STATE['files_up'] += 1
                n += 1
                if limit and n >= limit:
                    break
    if down:
        for name in list(names):
            if name not in local:
                rel = name.replace('__', os.sep)
                dst = os.path.normpath(os.path.join(files_dir, rel))
                if not dst.startswith(os.path.normpath(files_dir)):
                    continue
                r = _call('file_get', timeout=300, fname=name)
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                with open(dst + '.part', 'wb') as f:
                    f.write(base64.b64decode(r['data']))
                os.replace(dst + '.part', dst)
                STATE['files_down'] += 1


def upload_new_files(limit=3):
    """while running: upload attached files Google does not have yet — no Drive listing when nothing is new"""
    if 'remote' in CTX and not (set(local_files(CTX['files'])) - CTX['remote']):
        return
    sync_files(CTX['files'], up=True, down=False, limit=limit)


# ------------------------------------------------------------------ asking the person at the PC
def ask(text, title='عيادة الدكتور زكريا'):
    if os.name == 'nt':
        try:
            import ctypes
            return ctypes.windll.user32.MessageBoxW(0, text, title, 0x04 | 0x30 | 0x40000 | 0x100000) == 6   # Yes/No, warning, topmost, RTL
        except Exception:
            pass
    try:
        # phone (Termux): the terminal cannot join Arabic letters, so the question is repeated in English
        return input(text + '\n\nThe program is running on another PC. Move it to this device? (that PC saves its data and stops) [y/n] ').strip().lower().startswith('y')
    except EOFError:
        return True


def tell(text, title='عيادة الدكتور زكريا'):
    if os.name == 'nt':
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, text, title, 0x40 | 0x40000 | 0x100000)
            return
        except Exception:
            pass
    print(' ' + text)


def wait_handover(L):
    """the other PC was asked to hand over: wait while it uploads its last data.
    Waits as long as that PC is still alive (it beats every 20 s; uploading 2 MB on a slow line can take a minute),
    up to HANDOVER_WAIT seconds; takes over by force only when the other PC is silent (switched off / no internet)."""
    other = L.get('name') or 'the other PC'
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
def startup(cfg, db_path, files_dir, write_lock):
    link = settings(cfg, db_path)
    CTX.update(db=db_path, files=files_dir, write_lock=write_lock, link=link)
    if not link:
        return
    STATE['enabled'] = True
    print(' Checking for newer data on Google Drive ...')
    try:
        L = _call('lease', timeout=25)          # weak internet: give up quickly and open on this PC's data
        if alive_other(L):
            if not ask('البرنامج يعمل الآن على الحاسبة: %s\n\nهل تريد نقله إلى هذه الحاسبة؟\n'
                       'ستحفظ تلك الحاسبة آخر بياناتها ثم تتوقف عن التعديل.' % (L.get('name') or '?')):
                print(' Not taken over - closing.')
                sys.exit(0)
            L2 = _call('claim', force=False)
            L = L2 if L2.get('holder') == pc_id() else wait_handover(L)
        if L.get('holder') != pc_id():
            L = _call('claim', timeout=25, force=True)
        STATE['holder'] = True
        st = load_local(db_path)
        if int(L.get('seq') or 0) > int(st.get('seq') or 0) or (int(L.get('seq') or 0) and not os.path.exists(db_path)):
            if st.get('sig') and not st.get('clean') and db_sig(db_path) != st['sig']:
                print(' Note: this PC had changes that were never uploaded - its copy is kept in data/before-download.')
            pull_db(L)
        else:
            STATE['seq'] = int(st.get('seq') or 0)
        try:
            sync_files(files_dir, up=False, down=True)
        except Exception as e:
            print(' Attached files: download failed (%s) - will retry later' % e)
    except SystemExit:
        raise
    except (urllib.error.URLError, OSError) as e:
        STATE['offline'] = True
        STATE['error'] = 'No internet'
        print(' No internet - working on the data already on this PC.')
        tell('لا يوجد إنترنت الآن.\nسيعمل البرنامج على البيانات الموجودة في هذه الحاسبة.\n\n'
             'تأكد أن الحاسبة الأخرى لم تُستخدم منذ آخر مرة عُملت هنا، وإلا ستنقسم البيانات.')
    except Exception as e:
        if 'Unknown action' in str(e):          # the online script is older than this program: work as a single PC
            STATE['enabled'] = False
            print(' Hand-over between PCs is off: update Code.gs in the online version first.')
            return
        STATE['error'] = str(e)
        print(' Hand-over check failed: %s' % e)


# ------------------------------------------------------------------ while running
def can_sync():
    """the appointment/phone sync may only run on the PC holding the lease"""
    return not STATE['enabled'] or (STATE['holder'] and not STATE['readonly'])


def hand_over():
    """another PC asked for the program: freeze, upload the last copy, release"""
    STATE['readonly'] = True
    push_db(force=True, final=True)         # if this fails the other PC takes over by itself once this PC is silent
    try:
        sync_files(CTX['files'], up=True, down=False)
    except Exception:
        pass
    _call('release')
    STATE['holder'] = False
    print(' Handed over to %s - this PC is now read-only. Restart the program here to take it back.' % STATE['other'])


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
                STATE['error'] = 'The other PC saved newer data while this PC was offline'
                return
            _call('claim', force=True)
            STATE['holder'] = True
            return
        if L.get('holder') != pc_id():          # taken over by force (this PC was silent too long)
            STATE.update(readonly=True, holder=False, other=L.get('name') or '')
            return
        if L.get('pending'):
            STATE['other'] = L.get('pending_name') or ''
            hand_over()
            return
        if time.time() - CTX.get('pushed_t', 0) >= PUSH_EVERY:
            CTX['pushed_t'] = time.time()
            push_db()
        upload_new_files(limit=3)
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
    """on closing: last upload + let the next PC start at once"""
    if not STATE['enabled'] or not STATE['holder'] or STATE['readonly']:
        return
    STATE['readonly'] = True
    try:
        push_db(final=True)
        sync_files(CTX['files'], up=True, down=False)
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
