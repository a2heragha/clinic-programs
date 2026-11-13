# -*- coding: utf-8 -*-
"""
The Google link in config.json changed (e.g. after moving the clinic to another Google account, sent with an update):
copy it into the database and start the online sync from zero, so everything is uploaded to the new script.
Runs before the hand-over check. Python standard library only.
"""
import os, sqlite3

RESET_META = ('sync_cursor', 'sync_patients_hash', 'sync_patients_t', 'sync_config_hash', 'sync_backup_t', 'sync_clinical_t')


def check(cfg, db_path):
    url, token = (cfg.get('sync_url') or '').strip(), (cfg.get('sync_token') or '').strip()
    if not url or not token or not os.path.exists(db_path):
        return False
    c = sqlite3.connect(db_path)
    try:
        try:
            m = dict(c.execute("SELECT k, v FROM meta WHERE k IN ('sync_url','sync_token')").fetchall())
        except sqlite3.Error:
            return False
        if not m.get('sync_url') or (m.get('sync_url') == url and m.get('sync_token') == token):
            return False
        c.execute('INSERT OR REPLACE INTO meta VALUES(?,?)', ('sync_url', url))
        c.execute('INSERT OR REPLACE INTO meta VALUES(?,?)', ('sync_token', token))
        c.executemany('DELETE FROM meta WHERE k=?', [(k,) for k in RESET_META])
        try:
            c.execute('UPDATE appointments SET synced_at=NULL')
        except sqlite3.Error:
            pass
        try:
            c.execute('DELETE FROM sync_clinical')
        except sqlite3.Error:
            pass
        c.commit()
    finally:
        c.close()
    hs = os.path.join(os.path.dirname(db_path), 'handoff.json')     # the new script starts its own hand-over count
    if os.path.exists(hs):
        os.remove(hs)
    print(' New online link: everything will be uploaded to it again.')
    return True
