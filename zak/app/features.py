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


def _post(body, key):
    req = urllib.request.Request(API_URL, data=json.dumps(body).encode('utf-8'), method='POST',
                                 headers={'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read().decode('utf-8')).get('error', {}).get('message')
        except Exception:
            msg = None
        raise RuntimeError('AI service error %s: %s' % (e.code, msg or e.reason))
    except urllib.error.URLError as e:
        raise RuntimeError('No internet connection to the AI service (%s)' % e.reason)


NO_FORCED_TOOL = set()     # models that refused tool_choice "tool" (asked with "auto" from then on)


def ai_tool(key, model, content, schema, max_tokens=4000, system=None):
    """ask for an answer in a fixed structure (tool use): it comes back already parsed, so no JSON text can be malformed.
    Models that cannot be forced to use a tool get tool_choice "auto" + an instruction; a text answer is still read as JSON."""
    if not key:
        raise RuntimeError('No AI key — add it in Settings → AI features')
    body = {'model': model or DEFAULT_MODEL, 'max_tokens': max_tokens, 'messages': [{'role': 'user', 'content': content}],
            'tools': [{'name': 'answer', 'description': 'Give the complete answer in this structure. Always use this tool to answer.', 'input_schema': schema}],
            'tool_choice': {'type': 'tool', 'name': 'answer'}}
    if system:
        body['system'] = system
    try:
        if body['model'] in NO_FORCED_TOOL:
            raise RuntimeError('tool_choice')
        res = _post(body, key)
    except RuntimeError as e:
        if 'tool_choice' not in str(e):
            raise
        NO_FORCED_TOOL.add(body['model'])
        body['tool_choice'] = {'type': 'auto'}
        body['system'] = (system + ' ' if system else '') + 'Answer only by calling the "answer" tool once, with every field filled.'
        res = _post(body, key)
    for b in res.get('content', []):
        if b.get('type') == 'tool_use' and isinstance(b.get('input'), dict):
            return b['input']
    txt = ''.join(b.get('text', '') for b in res.get('content', []) if b.get('type') == 'text')
    if txt.strip():
        return parse_json(txt, key, model)
    if res.get('stop_reason') == 'max_tokens':
        raise RuntimeError('The AI answer was too long — try again')
    raise RuntimeError('The AI gave no answer (%s) — try again' % (res.get('stop_reason') or '?'))


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


def ai_read_labs(key, model, data, mime, tests, extra=''):
    codes = '\n'.join('%s = %s (%s)' % (t['code'], t['name'], t['unit'] or '') for t in tests)
    block = ({'type': 'document', 'source': {'type': 'base64', 'media_type': 'application/pdf', 'data': base64.b64encode(data).decode()}}
             if mime == 'application/pdf' else
             {'type': 'image', 'source': {'type': 'base64', 'media_type': mime if mime in ('image/jpeg', 'image/png', 'image/gif', 'image/webp') else 'image/jpeg',
                                           'data': base64.b64encode(data).decode()}})
    prompt = ('This is a laboratory report from Iraq. Extract every result that matches one of these test codes:\n' + codes +
              '\n\nConvert to the unit shown when the report uses another unit (e.g. creatinine µmol/L ÷ 88.4 → mg/dL, glucose mmol/L × 18 → mg/dL, '
              'cholesterol mmol/L × 38.67, TG mmol/L × 88.57, urea mmol/L × 6.006, Hb g/L ÷ 10). '
              'Give the answer with the answer tool: {"date":"YYYY-MM-DD or null","items":[{"code":"CODE","value":number,"as_written":"text on the sheet"}],'
              '"other":["results that have no code, as written"]}') + doctor_says(extra)
    schema = {'type': 'object', 'properties': {
        'date': {'type': ['string', 'null'], 'description': 'YYYY-MM-DD or null'},
        'items': {'type': 'array', 'items': {'type': 'object', 'properties': {'code': {'type': 'string'}, 'value': {'type': 'number'}, 'as_written': {'type': 'string'}},
                                             'required': ['code', 'value']}},
        'other': {'type': 'array', 'items': {'type': 'string'}}}, 'required': ['items']}
    out = ai_tool(key, model, [block, {'type': 'text', 'text': prompt}], schema, 3000)
    valid = {t['code'] for t in tests}
    out['items'] = [i for i in out.get('items', []) if i.get('code') in valid and isinstance(i.get('value'), (int, float))]
    return out


def ai_summary(key, model, pdata, prompt=None):
    return ai_call(key, model, prompt or summary_prompt(pdata), 900, system='You are assisting an internal-medicine physician. Be factual; only use the data given.')


def summary_prompt(pdata, extra=''):
    return patient_context(pdata) + '\n\nWrite a concise clinical summary for the treating internist before today\'s visit, in English, max 180 words: ' \
        'main problems with course and control, current treatment and recent changes, important trends in labs/BP, ' \
        'and pending items (tests due, plans not yet done). Plain text, short paragraphs, no headings, no advice to see a doctor.' + doctor_says(extra)


def doctor_says(extra):
    """the doctor's own instructions for this service (Settings → AI features); they come last and win over the defaults"""
    extra = (extra or '').strip()
    return ('\n\nINSTRUCTIONS FROM THE DOCTOR (follow them; where they differ from the instructions above, the doctor\'s win; '
            'never invent data that is not given):\n' + extra[:4000]) if extra else ''


def patient_context(pdata):
    p = pdata['patient']
    lines = ['Patient: %s, %s, age %s. Smoking: %s.' % (p.get('gender') or '?', p.get('occupation') or '', p.get('age'), p.get('smoking') or '?'),
             'Chronic: ' + (p.get('chronic') or '').replace('\n', '; '), 'Allergies: ' + (p.get('allergies') or 'none recorded').replace('\n', '; '),
             'Regular meds: ' + (p.get('long_meds') or '').replace('\n', '; ')]
    for v in pdata['visits'][:15][::-1]:
        parts = ['VISIT %s' % v['date']]
        for k, lab in (('complaint', 'S'), ('exam', 'O'), ('diagnosis', 'A'), ('plan', 'P'), ('imaging', 'Imaging')):
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
    return '\n'.join(lines)


PLAN_MODEL = 'claude-sonnet-5-5'
PLAN_SCHEMA = {'type': 'object', 'properties': {
    'focus': {'type': 'string'}, 'red_flags': {'type': 'array', 'items': {'type': 'string'}}, 'questions': {'type': 'array', 'items': {'type': 'string'}}, 'exam': {'type': 'array', 'items': {'type': 'string'}},
    'ddx': {'type': 'array', 'items': {'type': 'object', 'properties': {'dx': {'type': 'string'}, 'for': {'type': 'string'}, 'against': {'type': 'string'}}, 'required': ['dx']}},
    'tests': {'type': 'array', 'items': {'type': 'object', 'properties': {'test': {'type': 'string'}, 'why': {'type': 'string'}}, 'required': ['test']}},
    'meds': {'type': 'array', 'items': {'type': 'object', 'properties': {'action': {'type': 'string', 'enum': ['start', 'continue', 'adjust', 'stop']},
                                                                          'line': {'type': 'string'}, 'why': {'type': 'string'}}, 'required': ['action', 'line']}},
    'plan': {'type': 'array', 'items': {'type': 'string'}}, 'follow_up_days': {'type': ['integer', 'null']}},
    'required': ['focus', 'red_flags', 'questions', 'exam', 'ddx', 'tests', 'meds', 'plan']}



def plan_context(pdata, visit, family=None):
    """the patient's file + today's entries, as text for the AI"""
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
        for k, lab in (('complaint', 'S'), ('exam', 'O'), ('diagnosis', 'A'), ('plan', 'P'), ('imaging', 'Imaging')):
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
    for k, lab in (('complaint', 'Complaint'), ('exam', 'Exam'), ('diagnosis', 'Diagnosis so far'), ('plan', 'Plan so far'), ('imaging', 'Imaging')):
        if (visit.get(k) or '').strip():
            cur.append('%s: %s' % (lab, visit[k].strip().replace('\n', '; ')))
    if visit.get('meds'):
        cur.append('Medicines written today: ' + '; '.join(visit['meds']))
    L.append(' | '.join(cur))
    return '\n'.join(L)


def ai_plan(key, model, pdata, visit, family=None, extra=''):
    """Suggestions for today's visit (questions, exam, differential, tests, medicines) from the history + what is typed now."""
    L = [plan_context(pdata, visit, family)]
    prompt = ('\n'.join(L) + '\n\n'
              'You support an experienced internist in Mosul, Iraq, during today\'s visit. Using the history and what is typed for today, suggest what to do NOW. '
              'Be specific to this patient (doses adjusted to eGFR, allergies and interactions respected, drugs available in Iraq by generic name). '
              'If today\'s complaint is empty, base it on follow-up of the known problems. Do not repeat things already done today. '
              'Give the answer with the answer tool, in English. Fields:\n'
              '{"focus":"one-line summary of today\'s main issue",'
              '"red_flags":["urgent warnings, or empty"],'
              '"questions":["targeted history questions to ask today"],'
              '"exam":["examination points to check today"],'
              '"ddx":[{"dx":"diagnosis","for":"supporting findings","against":"or what to check"}],'
              '"tests":[{"test":"short lab/imaging name as written on a request","why":"reason"}],'
              '"meds":[{"action":"start|continue|adjust|stop","line":"prescription line: DRUG form strength + dose/frequency","why":"reason"}],'
              '"plan":["short plan / advice items"],'
              '"follow_up_days":number or null}\n'
              'Max 6 items per list, most important first.') + doctor_says(extra)
    schema = PLAN_SCHEMA
    out = ai_tool(key, model or PLAN_MODEL, prompt, schema, 4000,
                  system='You are a careful internal-medicine decision-support assistant. Suggestions are reviewed by the physician before use. Use only the given data; say when data is missing.')
    for k in ('red_flags', 'questions', 'exam', 'ddx', 'tests', 'meds', 'plan'):
        if not isinstance(out.get(k), list):
            out[k] = []
    return out


# ------------------------------------------------------------------ letters filled by AI (referral, medical report, echo request, lab request)
DOC_TASK = {
    'ref': ('a referral letter from the treating internist to a colleague', 'Start with a greeting to the colleague, then: who the patient is, '
            'the presenting problem, relevant background, examination / vital signs, key results, current treatment, allergies, '
            'and a clear "reason for referral" with the specific question. End with thanks. 120–220 words.'),
    'rep': ('a medical report "to whom it may concern", given at the patient\'s request', 'Factual: since when the patient is followed in the clinic, '
            'the diagnoses, the course, current medications as a numbered list, and recommendations if any. No speculation. 100–200 words.'),
    'echo': ('a request for transthoracic echocardiography', 'Brief: patient, indication (symptoms, findings, diagnoses that justify the echo), '
             'relevant background and medicines, then the specific questions for the echo doctor (e.g. LV size and EF, diastolic function, LVH, '
             'valves, pulmonary pressure, pericardium) adapted to this patient. 60–140 words.'),
}


def visit_context(visit):
    cur = ['TODAY\'S VISIT (%s)' % (visit.get('date') or '')]
    for k, lab in (('bp_sys', 'BP sys'), ('bp_dia', 'BP dia'), ('hr', 'Pulse'), ('temp', 'Temp'), ('spo2', 'SpO2'), ('rbs', 'RBS'), ('weight', 'Weight kg')):
        if visit.get(k) not in (None, ''):
            cur.append('%s %s' % (lab, visit[k]))
    for k, lab in (('complaint', 'Complaint'), ('exam', 'Exam'), ('diagnosis', 'Diagnosis'), ('plan', 'Plan'), ('imaging', 'Imaging')):
        if (visit.get(k) or '').strip():
            cur.append('%s: %s' % (lab, visit[k].strip().replace('\n', '; ')))
    if visit.get('meds'):
        cur.append('Medicines written today: ' + '; '.join(visit['meds']))
    return ' | '.join(cur)


def ai_doc(key, model, pdata, visit, kind, lang='en', to='', extra=''):
    """the text of a letter (ref / rep / echo) for the physician to edit, or the tests of a lab request (lab)"""
    p = pdata['patient']
    ctx = patient_context(pdata) + '\n' + visit_context(visit) + '\nPatient name: %s. Sex: %s.' % (p.get('name') or '', p.get('gender') or '?')
    sysm = 'You write clinical documents for an internist in Mosul, Iraq. Use only the data given; leave a clear blank "…" where something needed is missing.'
    if kind == 'lab':
        prompt = (ctx + '\n\nSuggest the laboratory tests to request today for this patient (monitoring of the known problems, today\'s complaint, '
                  'medicine safety such as renal function / potassium / LFT, and tests that are due). Short names as written on a lab request '
                  '(e.g. "CBC", "HbA1c", "S. creatinine", "Lipid profile"). Max 12, most important first. Give the answer with the answer tool.' + doctor_says(extra))
        schema = {'type': 'object', 'properties': {'tests': {'type': 'array', 'items': {'type': 'object', 'properties': {
            'test': {'type': 'string'}, 'why': {'type': 'string'}}, 'required': ['test']}}, 'clinical_info': {'type': 'string'}}, 'required': ['tests']}
        out = ai_tool(key, model or DEFAULT_MODEL, prompt, schema, 1500, system=sysm)
        out['tests'] = [t for t in out.get('tests') or [] if isinstance(t, dict) and (t.get('test') or '').strip()][:15]
        return out
    if kind not in DOC_TASK:
        raise RuntimeError('Unknown document')
    what, how = DOC_TASK[kind]
    language = ('Arabic (formal Iraqi medical style; keep drug names, test names and diagnoses in English inside the Arabic text)'
                if lang == 'ar' else 'English')
    prompt = (ctx + '\n\nWrite %s, in %s. %s%s Do not write the clinic header, the date or the signature — they are printed by the program. '
              'Plain text only (no markdown), ready to print.' % (what, language, how, (' Addressed to: %s.' % to) if to else '')) + doctor_says(extra)
    return {'text': ai_call(key, model or DEFAULT_MODEL, prompt, 1500, system=sysm).strip()}


# ------------------------------------------------------------------ chat with the AI about this patient (doctor)
CHAT_MODEL = PLAN_MODEL


def _clean_msgs(messages):
    out = []
    for m in messages or []:
        r, c = m.get('role'), str(m.get('content') or '').strip()
        if r in ('user', 'assistant') and c:
            if out and out[-1]['role'] == r:
                out[-1]['content'] += '\n\n' + c
            else:
                out.append({'role': r, 'content': c[:8000]})
    while out and out[0]['role'] != 'user':
        out.pop(0)
    return out[-30:]


def _chat_system(pdata, visit, family, plan, extra):
    return ('You are discussing one patient with the treating internist in Mosul, Iraq, during today\'s visit. '
            'Answer in English, concise and clinical (short paragraphs or bullet points), specific to this patient: doses adjusted to renal '
            'function, allergies and interactions respected, drugs available in Iraq by generic name. Use only the data given and say '
            'when something needed is missing. The physician decides; you advise.\n\n'
            'PATIENT FILE AND TODAY\'S ENTRIES:\n' + plan_context(pdata, visit, family) +
            ('\n\nCURRENT "AI SUGGESTIONS FOR TODAY" BOX (JSON):\n' + json.dumps(plan, ensure_ascii=False)[:12000] if plan else '') +
            doctor_says(extra))


def ai_chat(key, model, pdata, visit, family, messages, plan=None, extra=''):
    if not key:
        raise RuntimeError('No AI key — add it in Settings → AI features')
    msgs = _clean_msgs(messages)
    if not msgs or msgs[-1]['role'] != 'user':
        raise RuntimeError('Write a message first')
    res = _post({'model': model or CHAT_MODEL, 'max_tokens': 1500, 'system': _chat_system(pdata, visit, family, plan, extra),
                 'messages': msgs}, key)
    return ''.join(b.get('text', '') for b in res.get('content', []) if b.get('type') == 'text').strip()


def ai_chat_apply(key, model, pdata, visit, family, messages, plan=None, extra=''):
    """the suggestions box, changed as agreed in the conversation"""
    msgs = _clean_msgs(messages)
    if not msgs:
        raise RuntimeError('The conversation is empty')
    talk = '\n\n'.join(('DOCTOR: ' if m['role'] == 'user' else 'AI: ') + m['content'] for m in msgs)
    prompt = ('CONVERSATION BETWEEN THE DOCTOR AND YOU ABOUT THIS PATIENT:\n' + talk + '\n\n'
              'Now give the "AI suggestions for today" box with the answer tool, changed exactly as agreed in the conversation: '
              'add what was agreed, remove or change what the doctor rejected or corrected, and keep the other items of the current box '
              'as they are (if there is no current box, build it from the conversation and the file). In English. Max 6 items per list.')
    out = ai_tool(key, model or CHAT_MODEL, prompt, PLAN_SCHEMA, 4000, system=_chat_system(pdata, visit, family, plan, extra))
    for k in ('red_flags', 'questions', 'exam', 'ddx', 'tests', 'meds', 'plan'):
        if not isinstance(out.get(k), list):
            out[k] = []
    return out
