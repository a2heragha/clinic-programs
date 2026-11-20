# -*- coding: utf-8 -*-
"""
Error log of the clinic program (standard library only).

  data/logs/console.log   everything the black window shows, with time stamps (2 MB, then console.1.log)
  data/logs/errors.log    one JSON line per error: server, sync, hand-over, update, backup, browser (1 MB, then errors.1.log)
  errlog table            the same errors inside the database, so they travel to Google Drive with the
                          hand-over copy and the backups and can be read later without visiting the PC.
"""
import json, os, socket, sys, threading, time, traceback

DIR = None
PC = os.environ.get('CLINIC_PC_NAME') or socket.gethostname()
VER = ''
QUEUE = []
LAST = {}
_lock = threading.Lock()


def _rotate(path, limit):
    try:
        if os.path.getsize(path) > limit:
            os.replace(path, path[:-4] + '.1.log')
    except OSError:
        pass


class _Tee:
    def __init__(self, orig):
        self.orig, self.bol = orig, True

    def write(self, s):
        try:
            if self.orig:
                self.orig.write(s)
        except Exception:
            pass
        try:
            p = os.path.join(DIR, 'console.log')
            out = []
            for ch in s.splitlines(True):
                out.append((time.strftime('%m-%d %H:%M:%S ') if self.bol else '') + ch)
                self.bol = ch.endswith('\n')
            with _lock:
                with open(p, 'a', encoding='utf-8', errors='replace') as f:
                    f.write(''.join(out))
                _rotate(p, 2_000_000)
        except Exception:
            pass
        return len(s)

    def flush(self):
        try:
            self.orig and self.orig.flush()
        except Exception:
            pass

    def __getattr__(self, k):
        return getattr(self.orig, k)


def setup(root):
    global DIR, VER
    try:
        DIR = os.path.join(root, 'data', 'logs')
        os.makedirs(DIR, exist_ok=True)
        try:
            VER = (json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.version'), encoding='utf-8')).get('sha') or '')[:7]
        except Exception:
            VER = ''
        sys.stdout, sys.stderr = _Tee(sys.stdout), _Tee(sys.stderr)
        sys.excepthook = lambda t, v, tb: log('crash', '%s: %s' % (t.__name__, v), ''.join(traceback.format_exception(t, v, tb)))
        if hasattr(threading, 'excepthook'):
            threading.excepthook = lambda a: log('thread', '%s: %s' % (a.exc_type.__name__, a.exc_value),
                                                 ''.join(traceback.format_exception(a.exc_type, a.exc_value, a.exc_traceback)))
        print(' ---- program started on %s, version %s ----' % (PC, VER or '?'))
    except Exception:
        DIR = None


def log(src, msg, detail=''):
    """record one error (never raises)"""
    try:
        row = {'t': time.strftime('%Y-%m-%d %H:%M:%S'), 'pc': PC, 'ver': VER, 'src': src, 'msg': str(msg)[:500], 'detail': str(detail or '')[:4000]}
        with _lock:
            QUEUE.append(row)
            del QUEUE[:-500]
            if DIR:
                p = os.path.join(DIR, 'errors.log')
                with open(p, 'a', encoding='utf-8') as f:
                    f.write(json.dumps(row, ensure_ascii=False) + '\n')
                _rotate(p, 1_000_000)
    except Exception:
        pass


def recent(n=300):
    rows = []
    if not DIR:
        return rows
    for name in ('errors.1.log', 'errors.log'):
        try:
            with open(os.path.join(DIR, name), encoding='utf-8') as f:
                for line in f:
                    try:
                        rows.append(json.loads(line))
                    except Exception:
                        pass
        except OSError:
            pass
    return rows[-n:][::-1]


def watch(states, connect=None, db_path=None, write_lock=None, can_write=None, every=15):
    """background thread: logs every new error message that appears in the status dicts of the
    sync / hand-over / update / backup modules, and copies queued errors into the database"""
    def run():
        flushed_t = 0
        while True:
            try:
                for name, st in states.items():
                    e = st.get('error') if isinstance(st, dict) else None
                    if e and e != LAST.get(name):
                        log(name, e)
                    LAST[name] = e
                if connect and time.time() - flushed_t > 60 and QUEUE and (not can_write or can_write()):
                    flushed_t = time.time()
                    flush_db(connect, db_path, write_lock)
            except Exception:
                pass
            time.sleep(every)
    threading.Thread(target=run, name='errlog', daemon=True).start()


def flush_db(connect, db_path, write_lock):
    with _lock:
        rows = QUEUE[:]
    if not rows:
        return
    conn = connect(db_path)
    try:
        with write_lock:
            conn.execute('CREATE TABLE IF NOT EXISTS errlog (id INTEGER PRIMARY KEY, t TEXT, pc TEXT, ver TEXT, src TEXT, msg TEXT, detail TEXT)')
            conn.executemany('INSERT INTO errlog (t, pc, ver, src, msg, detail) VALUES (?,?,?,?,?,?)',
                             [(r['t'], r['pc'], r['ver'], r['src'], r['msg'], r['detail']) for r in rows])
            conn.execute('DELETE FROM errlog WHERE id <= (SELECT MAX(id) FROM errlog) - 3000')
            conn.commit()
        with _lock:
            del QUEUE[:len(rows)]
    finally:
        conn.close()
