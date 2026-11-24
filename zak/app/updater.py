# -*- coding: utf-8 -*-
"""
Silent self-update of the clinic program from a private GitHub repo (Python standard library only).

config.json (next to the app folder):
  "update": {"repo": "OWNER/clinic-programs", "path": "zak/app", "branch": "main", "token": "github_pat_..."}
  token is optional: only for a private repo (fine-grained, Contents: Read). A public repo needs none and never expires.

  boot()     at program start, before the other modules are imported:
             applies a staged update (or downloads + applies one), rolls back a version that failed to start twice.
  healthy()  called by the server once it has run for a minute: the new version is kept.
  loop()     background thread: every 6 hours downloads + stages a newer version; it is applied at the next start.

Never touched by an update: data/, backups/, files/, incoming/*.json, *.db, config.json, prayer_times.json.
"""
import io, json, os, py_compile, shutil, sys, tarfile, tempfile, threading, time, urllib.request

API = 'https://api.github.com'
CHECK_EVERY = 30 * 60        # a new version is downloaded within half an hour; it is used from the next start
KEEP = ('data', 'backups', 'files', 'before-download', '__pycache__')
KEEP_FILES = ('config.json', 'handoff.json', 'prayer_times.json', '.version', '.update_pending', '.update_bad')
STATE = {'version': None, 'staged': None, 'last_check': None, 'error': None, 'applied': None, 'rolled_back': None}
CTX = {}


def _keep(rel):
    p = rel.replace('\\', '/').split('/')
    if p[0] in KEEP or p[-1] in KEEP_FILES or p[-1].endswith(('.db', '.db-wal', '.db-shm', '.pyc')):
        return True
    return p[0] == 'incoming' and p[-1].endswith('.json')


def _read(path, default=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def _write(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f)
    os.replace(tmp, path)


def _get(url, raw=False, timeout=60):
    cfg = CTX['cfg']
    h = {'User-Agent': 'clinic-updater', 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
    if cfg.get('token'):                    # only needed when the repo is private
        h['Authorization'] = 'Bearer ' + cfg['token']
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
    return data if raw else json.loads(data.decode('utf-8'))


def _p(name):
    return os.path.join(CTX['app'], name)


def local_version():
    return (_read(_p('.version'), {}) or {}).get('sha')


# ------------------------------------------------------------------ download + stage
def latest():
    c = CTX['cfg']
    res = _get('%s/repos/%s/commits?path=%s&sha=%s&per_page=1' % (API, c['repo'], c['path'], c.get('branch', 'main')))
    if not res:
        return None
    try:
        CTX['latest_when'] = res[0]['commit']['committer']['date']          # ISO time (UTC) of the change
        CTX['latest_date'] = CTX['latest_when'][:10]
    except Exception:
        CTX['latest_date'] = CTX['latest_when'] = None
    return res[0]['sha']


def stage(sha):
    """download the repo at <sha>, keep only <path>/, check every .py compiles → <app>.staged/"""
    c = CTX['cfg']
    blob = _get('%s/repos/%s/tarball/%s' % (API, c['repo'], sha), raw=True, timeout=300)
    dst = CTX['app'] + '.staged'
    shutil.rmtree(dst, ignore_errors=True)
    os.makedirs(dst)
    prefix = c['path'].strip('/') + '/'
    n = 0
    with tarfile.open(fileobj=io.BytesIO(blob), mode='r:gz') as t:
        for m in t.getmembers():
            if not m.isfile():
                continue
            rel = m.name.split('/', 1)[1] if '/' in m.name else ''
            if not rel.startswith(prefix):
                continue
            rel = rel[len(prefix):]
            if not rel or '..' in rel.split('/') or _keep(rel):
                continue
            out = os.path.join(dst, *rel.split('/'))
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with t.extractfile(m) as src, open(out, 'wb') as f:
                shutil.copyfileobj(src, f)
            n += 1
    if not os.path.exists(os.path.join(dst, 'server.py')):
        raise RuntimeError('update has no server.py - ignored')
    for dp, _, fns in os.walk(dst):
        for fn in fns:
            if fn.endswith('.py'):
                py_compile.compile(os.path.join(dp, fn), cfile=os.path.join(tempfile.gettempdir(), 'upd_check.pyc'), doraise=True)
    ver = {'sha': sha, 'when': CTX.get('latest_when'), 'date': CTX.get('latest_date') or time.strftime('%Y-%m-%d'), 'files': n, 'at': time.strftime('%Y-%m-%d %H:%M')}
    _write(os.path.join(dst, '.version'), ver)
    STATE['staged'] = label(ver)
    return dst


def check(stage_only=True):
    STATE['last_check'] = time.strftime('%Y-%m-%d %H:%M')
    sha = latest()
    bad = (_read(_p('.update_bad'), {}) or {}).get('sha')
    if not sha or sha == local_version() or sha == bad:
        return False
    staged = _read(os.path.join(CTX['app'] + '.staged', '.version'), {}) or {}
    if staged.get('sha') != sha:
        try:
            stage(sha)
        except Exception:
            shutil.rmtree(CTX['app'] + '.staged', ignore_errors=True)
            raise
    return True


# ------------------------------------------------------------------ apply / roll back
def _copy_tree(src, dst):
    for dp, _, fns in os.walk(src):
        for fn in fns:
            s = os.path.join(dp, fn)
            rel = os.path.relpath(s, src)
            if _keep(rel) and fn != '.version':
                continue
            d = os.path.join(dst, rel)
            os.makedirs(os.path.dirname(d), exist_ok=True)
            shutil.copy2(s, d + '.part')
            os.replace(d + '.part', d)


def _snapshot_current():
    prev = CTX['app'] + '.prev'
    shutil.rmtree(prev, ignore_errors=True)
    os.makedirs(prev)
    for dp, dns, fns in os.walk(CTX['app']):
        rel_dir = os.path.relpath(dp, CTX['app'])
        if rel_dir != '.' and _keep(rel_dir):
            dns[:] = []
            continue
        for fn in fns:
            rel = os.path.normpath(os.path.join(rel_dir, fn))
            if _keep(rel) and fn != '.version':
                continue
            d = os.path.join(prev, rel)
            os.makedirs(os.path.dirname(d), exist_ok=True)
            shutil.copy2(os.path.join(dp, fn), d)


def merge_remote_config(src):
    """config.remote.json in the update: new keys for config.json (e.g. a new Google link after moving accounts)"""
    rc = _read(os.path.join(src, 'config.remote.json'))
    if not isinstance(rc, dict) or not rc:
        return
    cfg = _read(CTX['config'], {}) or {}
    changed = False
    for k, v in rc.items():
        if k == 'update' and isinstance(v, dict):
            u = dict(cfg.get('update') or {})
            for kk, vv in v.items():
                if vv and u.get(kk) != vv:
                    u[kk] = vv
                    changed = True
            cfg['update'] = u
        elif cfg.get(k) != v:
            cfg[k] = v
            changed = True
    if changed:
        _write(CTX['config'], cfg)


def apply_staged():
    src = CTX['app'] + '.staged'
    ver = _read(os.path.join(src, '.version'), {}) or {}
    if not ver.get('sha'):
        return False
    old = local_version()
    _snapshot_current()
    merge_remote_config(src)
    try:
        os.remove(os.path.join(src, 'config.remote.json'))
    except OSError:
        pass
    _copy_tree(src, CTX['app'])
    shutil.rmtree(src, ignore_errors=True)
    _write(_p('.update_pending'), {'sha': ver['sha'], 'prev': old, 'starts': 0})
    STATE['applied'] = label(ver)
    print(' Program updated to version %s' % label(ver))
    return True


def rollback(pending):
    prev = CTX['app'] + '.prev'
    if not os.path.isdir(prev):
        return False
    _copy_tree(prev, CTX['app'])
    _write(_p('.update_bad'), {'sha': pending.get('sha')})
    os.remove(_p('.update_pending'))
    STATE['rolled_back'] = (pending.get('sha') or '')[:7]
    print(' The new version did not start - went back to the previous one.')
    return True


# ------------------------------------------------------------------ entry points
def setup(app_dir, config_path):
    cfg = (_read(config_path, {}) or {}).get('update') or \
        _read(os.path.join(os.path.abspath(app_dir), 'update_source.json'), {}) or {}     # shipped with the program
    CTX.update(app=os.path.abspath(app_dir), cfg=cfg, config=config_path)
    STATE['version'] = (local_version() or '')[:7] or None
    return bool(cfg.get('repo') and cfg.get('path'))


def boot(app_dir, config_path, online=True):
    """returns True when the program files changed (the caller restarts / imports fresh). Runs once per process."""
    if CTX.get('booted'):
        return False
    CTX['booted'] = True
    try:
        if not setup(app_dir, config_path):
            return False
        pending = _read(_p('.update_pending'))
        if pending:                                     # previous update not confirmed healthy yet
            pending['starts'] = int(pending.get('starts') or 0) + 1
            newer = False
            if online:                                  # a newer version replaces the unconfirmed one directly
                try:
                    newer = check() and (_read(os.path.join(CTX['app'] + '.staged', '.version'), {}) or {}).get('sha') != pending.get('sha')
                except Exception as e:
                    STATE['error'] = str(e)
            if newer:
                return apply_staged()
            if pending['starts'] >= 3:
                return rollback(pending)
            _write(_p('.update_pending'), pending)
            return False
        if online:
            try:
                check()
            except Exception as e:                      # no internet / GitHub down: start the current version
                STATE['error'] = str(e)
        if os.path.isdir(CTX['app'] + '.staged'):
            return apply_staged()
    except Exception as e:
        STATE['error'] = str(e)
        print(' Update check failed: %s' % e)
    return False


def label(v):
    """the version number people see: date and time of the change, local time — 2026-11-24 10:45:12
    (an older .version without the time: its short code)"""
    w = (v or {}).get('when')
    if w:
        try:
            import datetime
            t = datetime.datetime.strptime(w[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=datetime.timezone.utc)
            return t.astimezone(datetime.timezone(datetime.timedelta(hours=3))).strftime('%Y-%m-%d %H:%M:%S')   # Iraq time
        except Exception:
            pass
    return ((v or {}).get('sha') or '')[:7]


def version_info(app_dir=None):
    """{'version': date and time of the change, 'sha': short code} of the program files now in use — shown at the top of the screen"""
    d = os.path.abspath(app_dir) if app_dir else CTX.get('app') or os.path.dirname(os.path.abspath(__file__))
    v = _read(os.path.join(d, '.version'), {}) or {}
    return {'version': label(v), 'sha': (v.get('sha') or '')[:7], 'date': '' if v.get('when') else (v.get('date') or v.get('at') or '')[:10]}


def healthy():
    try:
        if CTX and os.path.exists(_p('.update_pending')):
            os.remove(_p('.update_pending'))
            STATE['version'] = (local_version() or '')[:7]
    except Exception:
        pass


def loop():
    def run():
        time.sleep(20)
        healthy()
        while True:
            try:
                check()
                STATE['error'] = None
            except Exception as e:
                STATE['error'] = str(e)
            time.sleep(CHECK_EVERY)
    if CTX.get('cfg', {}).get('repo'):
        threading.Thread(target=run, name='updater', daemon=True).start()
