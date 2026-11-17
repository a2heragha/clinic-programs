"""Clinic add-ons: chronic-disease registries, clinic statistics, backup list/restore,
and the optional AI helpers (lab-sheet reading, visit summary) that need an Anthropic API key."""
import os, re, json, base64, datetime, sqlite3, urllib.request, urllib.error

# ------------------------------------------------------------------ conditions recognised from chronic list + diagnoses
COND = {
    'dm':      ('Diabetes', r'diabet|\bt[12]?dm\b|\bdm\b|\bniddm\b|\biddm\b|gestational dm'),
    'htn':     ('Hypertension', r'hypertens|\bhtn\b|\bht\b'),
    'ckd':     ('Chronic kidney disease', r'\bckd\b|chronic kidney|renal impairment|renal failure|nephropathy|\besrd\b|\beskd\b|dialysis'),
    'lipid':   ('Dyslipidaemia', r'lipid|cholesterol|hypertriglycerid'),
    'ihd':     ('Ischaemic heart disease', r'\bihd\b|ischaemic heart|ischemic heart|angina|\bcad\b|\bmi\b|myocardial infarction|\bpci\b|cabg|\bacs\b'),
    'hf':      ('Heart failure', r'heart failure|\bhf\b|hfref|hfpef|cardiomyopathy'),
    'af':      ('Atrial fibrillation', r'atrial fibrillation|\baf\b'),
    'thyroid': ('Hypothyroidism', r'hypothyroid|hashimoto|thyroidectomy'),
    'asthma':  ('Asthma / COPD', r'asthma|\bcopd\b|bronchiectasis'),
}


NOT_DM = re.compile(r'gestational|\bgdm\b|pre-?diabet|insulin resistance|impaired (fasting|glucose)', re.I)


def cond_regex(key):
    rx = re.compile(COND[key][1], re.I)
    if key != 'dm':
        return rx

    class _DM:   # diabetes, but not gestational diabetes / prediabetes
        @staticmethod
        def search(text):
            return any(rx.search(l) and not NOT_DM.search(l) for l in (text or '').split('\n'))
    return _DM


def lab_latest(conn, pids):
    """{pid: {code: (date, value)}} for the latest numeric value of every code."""
    out = {}
    q = 'SELECT patient_id, code, date, value FROM labs WHERE value IS NOT NULL ORDER BY date, id'
    for r in conn.execute(q):
        if r[0] in pids:
            out.setdefault(r[0], {})[r[1]] = (r[2], r[3])
    return out


def egfr(cr, age, sex):
    if not cr or not age or sex not in ('M', 'F'):
        return None
    f = sex == 'F'
    k, a = (0.7, -0.241) if f else (0.9, -0.302)
    return 142 * min(cr / k, 1) ** a * max(cr / k, 1) ** -1.2 * 0.9938 ** age * (1.012 if f else 1)


def days_since(iso, today):
    try:
        return (today - datetime.date.fromisoformat(iso[:10])).days
    except Exception:
        return None


def registry(conn, cond):
    if cond not in COND:
        cond = 'dm'
    rx = cond_regex(cond)
    today = datetime.date.today()
    # patients with the condition: chronic list, or any visit diagnosis
    pids = set()
    for r in conn.execute('SELECT id, chronic FROM patients'):
        if r[1] and rx.search(r[1]):
            pids.add(r[0])
    for r in conn.execute("SELECT DISTINCT patient_id, diagnosis FROM visits WHERE diagnosis IS NOT NULL AND diagnosis != ''"):
        if rx.search(r[1]):
            pids.add(r[0])
    if not pids:
        return {'cond': cond, 'label': COND[cond][0], 'rows': []}
    labs = lab_latest(conn, pids)
    lastv, bp = {}, {}
    for r in conn.execute('SELECT patient_id, date, follow_up, bp_sys, bp_dia FROM visits ORDER BY date, id'):
        if r[0] in pids:
            lastv[r[0]] = (r[1], r[2])
            if r[3]:
                bp[r[0]] = (r[1], r[3], r[4])
    ihd = cond_regex('ihd')
    rows = []
    for p in conn.execute('SELECT id, name, phone, gender, birth_year, chronic FROM patients WHERE id IN (%s)' % ','.join(map(str, pids))):
        pid = p['id']
        L = labs.get(pid, {})
        age = today.year - p['birth_year'] if p['birth_year'] else None
        lv = lastv.get(pid, (None, None))
        row = {'id': pid, 'name': p['name'], 'phone': p['phone'], 'age': age, 'last_visit': lv[0], 'follow_up': lv[1],
               'hba1c': L.get('HBA1C'), 'ldl': L.get('LDL'), 'creat': L.get('CREAT'), 'uacr': L.get('UACR'), 'tsh': L.get('TSH'), 'k': L.get('K'),
               'bp': bp.get(pid), 'flags': [], 'due': []}
        cr = L.get('CREAT')
        if cr and age:
            e = egfr(cr[1], age, p['gender'])
            row['egfr'] = (cr[0], round(e)) if e else None
        ldl_target = 70 if (p['chronic'] and ihd.search(p['chronic'])) or cond in ('ihd', 'dm') else 100
        # targets
        if cond == 'dm' and row['hba1c'] and row['hba1c'][1] > 7:
            row['flags'].append('HbA1c %.1f > 7' % row['hba1c'][1])
        if cond in ('dm', 'lipid', 'ihd') and row['ldl'] and row['ldl'][1] > ldl_target:
            row['flags'].append('LDL %d > %d' % (row['ldl'][1], ldl_target))
        if cond in ('htn', 'dm', 'ckd', 'ihd', 'hf') and row['bp'] and (row['bp'][1] >= 140 or (row['bp'][2] or 0) >= 90):
            row['flags'].append('BP %s/%s' % (row['bp'][1], row['bp'][2] or '?'))
        if cond == 'thyroid' and row['tsh'] and not (0.4 <= row['tsh'][1] <= 4.5):
            row['flags'].append('TSH %.2f' % row['tsh'][1])
        if cond == 'ckd' and row.get('egfr') and row['egfr'][1] < 30:
            row['flags'].append('eGFR %d' % row['egfr'][1])
        # tests due
        def due(key, code, days, label):
            v = L.get(code)
            d = days_since(v[0], today) if v else None
            if d is None or d > days:
                row['due'].append(label + (' (never)' if d is None else ' (%d mo)' % (d // 30)))
        if cond == 'dm':
            due('a1c', 'HBA1C', 100, 'HbA1c'); due('uacr', 'UACR', 400, 'UACR'); due('ldl', 'LDL', 400, 'Lipids'); due('cr', 'CREAT', 400, 'Creatinine')
        elif cond == 'htn':
            due('cr', 'CREAT', 400, 'Creatinine'); due('k', 'K', 400, 'Potassium')
        elif cond == 'ckd':
            due('cr', 'CREAT', 190, 'Creatinine'); due('uacr', 'UACR', 400, 'UACR'); due('hb', 'HB', 400, 'Hb')
        elif cond in ('lipid', 'ihd'):
            due('ldl', 'LDL', 400, 'Lipids')
        elif cond == 'thyroid':
            due('tsh', 'TSH', 400, 'TSH')
        dv = days_since(lv[0], today) if lv[0] else None
        row['lost'] = dv is not None and dv > 180
        row['missed_fu'] = bool(lv[1] and lv[1] < today.isoformat())
        rows.append(row)
    rows.sort(key=lambda r: (r['last_visit'] or ''), reverse=True)
    return {'cond': cond, 'label': COND[cond][0], 'rows': rows}


def registry_counts(conn):
    out = {}
    chronic = [(r[0], r[1] or '') for r in conn.execute('SELECT id, chronic FROM patients')]
    dx = [(r[0], r[1]) for r in conn.execute("SELECT DISTINCT patient_id, diagnosis FROM visits WHERE diagnosis IS NOT NULL AND diagnosis != ''")]
    for k in COND:
        rx = cond_regex(k)
        out[k] = len({i for i, c in chronic if rx.search(c)} | {i for i, d in dx if rx.search(d)})
    return out


# ------------------------------------------------------------------ statistics
def stats(conn, frm, to):
    q = lambda sql, *a: conn.execute(sql, a).fetchall()
    visits = q('SELECT date, patient_id FROM visits WHERE date BETWEEN ? AND ?', frm, to)
    first = dict(q('SELECT patient_id, MIN(date) FROM visits GROUP BY patient_id'))
    per_day, per_month, wd = {}, {}, [0] * 7
    new = 0
    for d, pid in visits:
        per_day[d] = per_day.get(d, 0) + 1
        per_month[d[:7]] = per_month.get(d[:7], 0) + 1
        try:
            wd[datetime.date.fromisoformat(d).weekday()] += 1
        except Exception:
            pass
        if first.get(pid) == d:
            new += 1
    dx = {}
    for (t,) in q("SELECT diagnosis FROM visits WHERE date BETWEEN ? AND ? AND diagnosis != ''", frm, to):
        for line in (t or '').split('\n'):
            k = line.strip()
            if k:
                dx[k.lower()] = (dx.get(k.lower(), (k, 0))[0], dx.get(k.lower(), (k, 0))[1] + 1)
    meds = {}
    for (line,) in q('SELECT m.line FROM visit_meds m JOIN visits v ON v.id=m.visit_id WHERE v.date BETWEEN ? AND ?', frm, to):
        w = re.split(r'\s+\d|\s+(tab|cap|amp|vial|syrup|inhaler|cream)\b', (line or '').strip(), 1, flags=re.I)[0].strip().upper()
        if w:
            meds[w] = meds.get(w, 0) + 1
    ap = q('SELECT status, COUNT(*) FROM appointments WHERE date BETWEEN ? AND ? AND COALESCE(deleted,0)=0 GROUP BY status', frm, to)
    apd = {(k or ''): n for k, n in ap}
    total_ap = sum(apd.values())
    return {'from': frm, 'to': to, 'visits': len(visits), 'patients': len({p for _, p in visits}), 'new': new,
            'per_day': sorted(per_day.items()), 'per_month': sorted(per_month.items()), 'weekday': wd,
            'top_dx': sorted(dx.values(), key=lambda x: -x[1])[:15], 'top_meds': sorted(meds.items(), key=lambda x: -x[1])[:15],
            'appts': {'total': total_ap, 'noshow': apd.get('noshow', 0), 'done': apd.get('done', 0) + apd.get('in', 0) + apd.get('waiting', 0)},
            'all_patients': conn.execute('SELECT COUNT(*) FROM patients').fetchone()[0]}


# ------------------------------------------------------------------ backups: list + restore
def backup_dirs(cfg, root):
    out = []
    for d in (cfg.get('backup_dir'), cfg.get('backup_dir2')):
        if d:
            out.append(d if os.path.isabs(d) else os.path.join(root, d))
    return out


def list_backups(cfg, root):
    items = []
    for d in backup_dirs(cfg, root):
        if os.path.isdir(d):
            for f in os.listdir(d):
                if f.startswith('clinic_') and f.endswith('.db') and os.path.getsize(os.path.join(d, f)) > 0:
                    p = os.path.join(d, f)
                    items.append({'name': f, 'dir': d, 'size': os.path.getsize(p),
                                  'time': datetime.datetime.fromtimestamp(os.path.getmtime(p)).strftime('%Y-%m-%d %H:%M')})
    items.sort(key=lambda x: x['time'], reverse=True)
    return items


def restore_backup(cfg, root, name, db_path, connect, do_backup):
    """Copy a backup over the live database (a safety copy of the current one is made first)."""
    if not re.fullmatch(r'clinic_[\w\-]+\.db', name or ''):
        raise ValueError('Bad backup name')
    src = None
    for d in backup_dirs(cfg, root):
        p = os.path.join(d, name)
        if os.path.isfile(p):
            src = p
            break
    if not src:
        raise ValueError('Backup not found')
    # read the backup once into a temporary file and check that copy (never the original)
    tmp = db_path + '.restore-tmp'
    for x in (tmp, tmp + '-wal', tmp + '-shm'):
        if os.path.exists(x):
            os.remove(x)
    s = sqlite3.connect('file:%s?mode=ro' % src.replace('\\', '/'), uri=True)
    t = sqlite3.connect(tmp)
    try:
        s.backup(t)
        t.execute('PRAGMA journal_mode=DELETE')
        if t.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('This backup file is damaged')
        try:
            n = t.execute('SELECT COUNT(*) FROM patients').fetchone()[0]
        except sqlite3.Error:
            raise ValueError('This backup file is empty or not a clinic database')
        if not n:
            raise ValueError('This backup has no patients — choose another one')
        do_backup('before-restore')
        dst = connect(db_path)
        try:
            t.backup(dst)
        finally:
            dst.close()
    finally:
        s.close()
        t.close()
        for x in (tmp, tmp + '-wal', tmp + '-shm'):
            if os.path.exists(x):
                os.remove(x)
    return True


# ------------------------------------------------------------------ AI (Anthropic API) — optional, needs a key in Settings
API_URL = os.environ.get('CLINIC_AI_URL') or 'https://api.anthropic.com/v1/messages'
DEFAULT_MODEL = 'claude-haiku-5-5'   # lab sheets are printed: the light model reads them well at ~1/20 of the price


def ai_call(key, model, content, max_tokens=2000, system=None):
    if not key:
        raise RuntimeError('No AI key — add it in Settings → AI features')
    body = {'model': model or DEFAULT_MODEL, 'max_tokens': max_tokens, 'messages': [{'role': 'user', 'content': content}]}
    if system:
        body['system'] = system
    req = urllib.request.Request(API_URL, data=json.dumps(body).encode('utf-8'), method='POST',
                                 headers={'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            res = json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode('utf-8')).get('error', {}).get('message')
        except Exception:
            msg = None
        raise RuntimeError('AI service error %s: %s' % (e.code, msg or e.reason))
    except urllib.error.URLError as e:
        raise RuntimeError('No internet connection to the AI service (%s)' % e.reason)
    return ''.join(b.get('text', '') for b in res.get('content', []) if b.get('type') == 'text')


def _close_json(t):
    """close a JSON text cut off at the token limit: an open string, then open [ and {"""
    stack, ins, esc = [], False, False
    for ch in t:
        if ins:
            if esc:
                esc = False
            elif ch == '\\':
                esc = True
            elif ch == '"':
                ins = False
        elif ch == '"':
            ins = True
        elif ch in '[{':
            stack.append(ch)
        elif ch in ']}' and stack:
            stack.pop()
    t = t + ('"' if ins else '')
    t = re.sub(r',\s*$', '', t.rstrip())
    return t + ''.join(']' if c == '[' else '}' for c in reversed(stack))


def parse_json(txt, key=None, model=None):
    """the JSON object in an AI answer — tolerant of trailing commas, smart quotes and a cut-off end;
    as a last resort the model is asked once to repair its own JSON"""
    i = txt.find('{')
    if i < 0:
        raise RuntimeError('The AI answer could not be read — try again')
    raw = txt[i:]
    j = raw.rfind('}')
    tries = [raw[:j + 1] if j >= 0 else raw]
    t = tries[0].replace('\u201c', '"').replace('\u201d', '"')
    t = re.sub(r',\s*([\]}])', r'\1', t)
    tries += [t, _close_json(re.sub(r',\s*([\]}])', r'\1', raw))]
    for t in tries:
        try:
            return json.loads(t)
        except ValueError as e:
            err = e
    if key:
        fixed = ai_call(key, model, 'The following JSON is invalid (%s). Return the same content as valid JSON only, nothing else:\n\n%s' % (err, raw[:12000]), 4000)
        k = fixed.find('{')
        if k >= 0:
            try:
                return json.loads(fixed[k:fixed.rfind('}') + 1])
            except ValueError:
                pass
    raise RuntimeError('The AI answer could not be read — try again')


def ai_read_labs(key, model, data, mime, tests):
    codes = '\n'.join('%s = %s (%s)' % (t['code'], t['name'], t['unit'] or '') for t in tests)
    block = ({'type': 'document', 'source': {'type': 'base64', 'media_type': 'application/pdf', 'data': base64.b64encode(data).decode()}}
             if mime == 'application/pdf' else
             {'type': 'image', 'source': {'type': 'base64', 'media_type': mime if mime in ('image/jpeg', 'image/png', 'image/gif', 'image/webp') else 'image/jpeg',
                                           'data': base64.b64encode(data).decode()}})
    prompt = ('This is a laboratory report from Iraq. Extract every result that matches one of these test codes:\n' + codes +
              '\n\nConvert to the unit shown when the report uses another unit (e.g. creatinine µmol/L ÷ 88.4 → mg/dL, glucose mmol/L × 18 → mg/dL, '
              'cholesterol mmol/L × 38.67, TG mmol/L × 88.57, urea mmol/L × 6.006, Hb g/L ÷ 10). '
              'Reply with JSON only, no prose: {"date":"YYYY-MM-DD or null","items":[{"code":"CODE","value":number,"as_written":"text on the sheet"}],'
              '"other":["results that have no code, as written"]}')
    txt = ai_call(key, model, [block, {'type': 'text', 'text': prompt}], 3000)
    out = parse_json(txt, key, model)
    valid = {t['code'] for t in tests}
    out['items'] = [i for i in out.get('items', []) if i.get('code') in valid and isinstance(i.get('value'), (int, float))]
    return out


def ai_summary(key, model, pdata, prompt=None):
    return ai_call(key, model, prompt or summary_prompt(pdata), 900, system='You are assisting an internal-medicine physician. Be factual; only use the data given.')


def summary_prompt(pdata):
    p = pdata['patient']
    lines = ['Patient: %s, %s, age %s. Smoking: %s.' % (p.get('gender') or '?', p.get('occupation') or '', p.get('age'), p.get('smoking') or '?'),
             'Chronic: ' + (p.get('chronic') or '').replace('\n', '; '), 'Allergies: ' + (p.get('allergies') or 'none recorded').replace('\n', '; '),
             'Regular meds: ' + (p.get('long_meds') or '').replace('\n', '; ')]
    for v in pdata['visits'][:15][::-1]:
        parts = ['VISIT %s' % v['date']]
        for k, lab in (('complaint', 'S'), ('exam', 'O'), ('diagnosis', 'A'), ('plan', 'P')):
            if v.get(k):
                parts.append('%s: %s' % (lab, v[k].replace('\n', '; ')[:700]))
        if v.get('bp_sys'):
            parts.append('BP %s/%s' % (v['bp_sys'], v.get('bp_dia')))
        if v.get('meds'):
            parts.append('Rx: ' + '; '.join(v['meds']))
        if not v.get('complaint') and v.get('notes'):
            parts.append('Notes: ' + v['notes'][:900])
        lines.append(' | '.join(parts))
    labs = {}
    for l in pdata['labs']:
        if l.get('value') is not None:
            labs.setdefault(l['code'], []).append('%s %s' % (l['date'][:7], l['value']))
    lines.append('Labs: ' + '; '.join('%s: %s' % (k, ', '.join(v[-5:])) for k, v in labs.items()))
    prompt = ('\n'.join(lines) + '\n\nWrite a concise clinical summary for the treating internist before today\'s visit, in English, max 180 words: '
              'main problems with course and control, current treatment and recent changes, important trends in labs/BP, '
              'and pending items (tests due, plans not yet done). Plain text, short paragraphs, no headings, no advice to see a doctor.')
    return prompt


PLAN_MODEL = 'claude-sonnet-5-5'


def ai_plan(key, model, pdata, visit, family=None):
    """Suggestions for today's visit (questions, exam, differential, tests, medicines) from the history + what is typed now."""
    p = pdata['patient']
    L = ['PATIENT: %s, age %s, %s. Smoking: %s. Height %s cm.' % (p.get('gender') or '?', p.get('age'), p.get('occupation') or '', p.get('smoking') or '?', p.get('height') or '?'),
         'Chronic conditions: ' + (p.get('chronic') or 'none recorded').replace('\n', '; '),
         'ALLERGIES: ' + (p.get('allergies') or 'none recorded').replace('\n', '; '),
         'Regular medicines: ' + (p.get('long_meds') or 'none recorded').replace('\n', '; '),
         'Past history: ' + (p.get('past_history') or '').replace('\n', '; ')]
    if family:
        L.append('Family (linked files): ' + '; '.join('%s: %s' % (f.get('relation'), (f.get('chronic') or '').replace('\n', ', ')) for f in family if f.get('chronic')))
    labs = {}
    for l in sorted(pdata['labs'], key=lambda x: x['date']):
        if l.get('value') is not None:
            labs.setdefault(l['code'], []).append('%s %s' % (l['date'], l['value']))
    cr = labs.get('CREAT')
    if cr and p.get('age') and p.get('gender'):
        try:
            L.append('Latest eGFR (CKD-EPI 2021): %.0f' % egfr(float(cr[-1].split()[1]), int(p['age']), p['gender']))
        except Exception:
            pass
    L.append('LABS (date value, latest last): ' + '; '.join('%s: %s' % (k, ', '.join(v[-4:])) for k, v in labs.items()))
    prev = [v for v in pdata['visits'] if v['id'] != visit.get('id')][:6]
    for v in prev[::-1]:
        parts = ['PREVIOUS VISIT %s' % v['date']]
        for k, lab in (('complaint', 'S'), ('exam', 'O'), ('diagnosis', 'A'), ('plan', 'P')):
            if v.get(k):
                parts.append('%s: %s' % (lab, v[k].replace('\n', '; ')[:500]))
        if not v.get('complaint') and v.get('notes'):
            parts.append('Notes: ' + v['notes'][:600])
        if v.get('bp_sys'):
            parts.append('BP %s/%s' % (v['bp_sys'], v.get('bp_dia')))
        if v.get('meds'):
            parts.append('Rx: ' + '; '.join(v['meds']))
        L.append(' | '.join(parts))
    cur = ['TODAY (%s)' % (visit.get('date') or '')]
    for k, lab in (('bp_sys', 'BP sys'), ('bp_dia', 'BP dia'), ('hr', 'Pulse'), ('temp', 'Temp'), ('spo2', 'SpO2'), ('rbs', 'RBS'), ('weight', 'Weight kg'), ('waist', 'Waist cm')):
        if visit.get(k) not in (None, ''):
            cur.append('%s %s' % (lab, visit[k]))
    for k, lab in (('complaint', 'Complaint'), ('exam', 'Exam'), ('diagnosis', 'Diagnosis so far'), ('plan', 'Plan so far')):
        if (visit.get(k) or '').strip():
            cur.append('%s: %s' % (lab, visit[k].strip().replace('\n', '; ')))
    if visit.get('meds'):
        cur.append('Medicines written today: ' + '; '.join(visit['meds']))
    L.append(' | '.join(cur))
    prompt = ('\n'.join(L) + '\n\n'
              'You support an experienced internist in Mosul, Iraq, during today\'s visit. Using the history and what is typed for today, suggest what to do NOW. '
              'Be specific to this patient (doses adjusted to eGFR, allergies and interactions respected, drugs available in Iraq by generic name). '
              'If today\'s complaint is empty, base it on follow-up of the known problems. Do not repeat things already done today. '
              'Reply with JSON only, no prose, in English:\n'
              '{"focus":"one-line summary of today\'s main issue",'
              '"red_flags":["urgent warnings, or empty"],'
              '"questions":["targeted history questions to ask today"],'
              '"exam":["examination points to check today"],'
              '"ddx":[{"dx":"diagnosis","for":"supporting findings","against":"or what to check"}],'
              '"tests":[{"test":"short lab/imaging name as written on a request","why":"reason"}],'
              '"meds":[{"action":"start|continue|adjust|stop","line":"prescription line: DRUG form strength + dose/frequency","why":"reason"}],'
              '"plan":["short plan / advice items"],'
              '"follow_up_days":number or null}\n'
              'Max 6 items per list, most important first.')
    txt = ai_call(key, model or PLAN_MODEL, prompt, 4000,
                  system='You are a careful internal-medicine decision-support assistant. Suggestions are reviewed by the physician before use. Use only the given data; say when data is missing.')
    out = parse_json(txt, key, model or PLAN_MODEL)
    for k in ('red_flags', 'questions', 'exam', 'ddx', 'tests', 'meds', 'plan'):
        if not isinstance(out.get(k), list):
            out[k] = []
    return out
