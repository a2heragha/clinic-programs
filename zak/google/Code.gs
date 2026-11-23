/*******************************************************************
 *  عيادة الدكتور زكريا — النسخة الأونلاين (Google) على حساب zak.clinic90
 *    - رابط واحد (/exec): برنامج العيادة يزامن عليه، والموبايل يفتحه في المتصفح
 *    - السكرتير: المواعيد + تسجيل مريض جديد (عربي)
 *    - الطبيب: ملخص ملفات المرضى للقراءة فقط (English)
 *  الدخول بنفس الرقم السري المستخدم في برنامج العيادة.
 *  أول مرة: شغّل setup (ينشئ «العيادات/عيادة د. زكريا» والجدول والنسخ الاحتياطية).
 *  التحديث لاحقاً: Deploy ← Manage deployments ← Edit ← New version (الرابط يبقى نفسه).
 *******************************************************************/
const CLINIC_NAME = 'عيادة الدكتور زكريا';
const FOLDER_NAME = 'عيادة د. زكريا';
const ROOT_FOLDER = 'العيادات';
const VIEWERS = [];                                // مشاهدة مجلد العيادة فقط (الحساب نفسه هو المالك)
const KEEP_BACKUPS = 30;
/******************************************************************/

const A_COLS = ['uid', 'date', 'time', 'seq', 'patient_id', 'name', 'phone', 'note', 'status', 'updated_at', 'deleted', 'age', 'srv_ts', 'by', 'weight', 'kind', 'call', 'hold', 'reminded'];
const P_COLS = ['id', 'name', 'birth_year', 'phone', 'address', 'last'];
const N_COLS = ['uid', 'name', 'gender', 'birth_year', 'phone', 'address', 'occupation', 'by', 'created', 'pc_id', 'claim', 'claim_t'];
const F_COLS = ['uid', 'patient_id', 'name', 'mime', 'fname', 'date', 'by', 'created', 'pc_id', 'claim', 'claim_t'];   // results photographed by the secretary
const O_COLS = ['seq', 't', 'dev', 'tbl', 'k', 'op', 'data'];                                                          // changes of every device, in one order
const ID_TABLES = ['patients', 'visits', 'visit_meds', 'labs', 'files', 'links', 'rx_templates', 'users'];
const FK = { visits: { patient_id: 'patients' }, visit_meds: { visit_id: 'visits' }, labs: { patient_id: 'patients', visit_id: 'visits' },
  files: { patient_id: 'patients', visit_id: 'visits' }, links: { a_id: 'patients', b_id: 'patients' } };
const CLAIM_MS = 10 * 60 * 1000;
const C_COLS = ['id', 'json'];
const SESSION_H = 12;

// ------------------------------------------------------------------ one-time setup (run from the editor)
function folderIn_(parent, name) {
  const it = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

function setup() {
  const props = PropertiesService.getScriptProperties();
  const root = folderIn_(null, ROOT_FOLDER), clinic = folderIn_(root, FOLDER_NAME);
  props.setProperty('CLINIC_FOLDER', clinic.getId());
  let ss;
  const sid = props.getProperty('SHEET_ID');
  try { ss = sid ? SpreadsheetApp.openById(sid) : null; } catch (e) { ss = null; }
  if (!ss) {
    ss = SpreadsheetApp.create('Zak Clinic — online data (do not edit by hand)');
    DriveApp.getFileById(ss.getId()).moveTo(clinic);
    props.setProperty('SHEET_ID', ss.getId());
  }
  [['appointments', A_COLS], ['patients', P_COLS], ['new_patients', N_COLS], ['clinical', C_COLS], ['config', ['k', 'v']], ['phone_files', F_COLS], ['ops', O_COLS]].forEach(([n, c]) => {
    const sh = sheet_(ss, n, c);
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');   // everything as text (phones keep their 0)
  });
  const s1 = ss.getSheets().filter(s => ['appointments', 'patients', 'new_patients', 'clinical', 'config', 'phone_files', 'ops'].indexOf(s.getName()) < 0);
  s1.forEach(s => { if (s.getLastRow() === 0) ss.deleteSheet(s); });

  let token = props.getProperty('TOKEN');
  if (!token) {
    token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('TOKEN', token);
  }
  let folder;
  const fid = props.getProperty('BACKUP_FOLDER');
  try { folder = fid ? DriveApp.getFolderById(fid) : null; } catch (e) { folder = null; }
  if (!folder) {
    folder = folderIn_(clinic, 'النسخ الاحتياطية');
    props.setProperty('BACKUP_FOLDER', folder.getId());
  }
  try { DriveApp.getFileById(ScriptApp.getScriptId()).moveTo(root); } catch (e) { }   // the script itself stays outside the shared folder
  VIEWERS.filter(v => v.indexOf('@') > 0).forEach(v => { try { clinic.addViewer(v); } catch (e) { Logger.log('مشاركة ' + v + ': ' + e); } });
  Logger.log('تم الإعداد ✓');
  Logger.log('رمز المزامنة: ' + token);
}

function sheet_(ss, name, cols) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

// run this from the editor to see the sync token again
function showToken() { Logger.log('رمز المزامنة: ' + prop_('TOKEN')); }

// ------------------------------------------------------------------ helpers
/* delete a file for good (Drive advanced service); without the service it goes to the bin as before */
function drop_(f) {
  try { Drive.Files.remove(f.getId()); } catch (e) { try { f.setTrashed(true); } catch (e2) { } }
}
/* the old link shows where the page moved */
function movedPage_(mv) {
  return HtmlService.createHtmlOutput('<div style="font:18px Tahoma,Arial;text-align:center;margin-top:20vh" dir="rtl">انتقلت الصفحة إلى رابط جديد<br><br>'
    + '<a href="' + mv + '" target="_top" style="font-size:20px">اضغط هنا لفتحها</a><br><br><small>واحفظ الرابط الجديد بدل القديم</small></div>')
    .setTitle('انتقلت الصفحة').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function ss_() { return SpreadsheetApp.openById(prop_('SHEET_ID')); }
function sh_(n) { return ss_().getSheetByName(n); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function str_(x) { return x === null || x === undefined ? '' : String(x); }
function cell_(x, col) {
  if (x instanceof Date) return Utilities.formatDate(x, 'Asia/Baghdad', col === 'time' ? 'HH:mm' : 'yyyy-MM-dd');
  return str_(x);
}
function readAll_(sh, cols) {
  const n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, cols.length).getValues().map((r, i) => {
    const o = { _row: i + 2 };
    cols.forEach((c, j) => { o[c] = cell_(r[j], c); });
    return o;
  });
}
function writeRow_(sh, row, cols, o) {
  sh.getRange(row, 1, 1, cols.length).setNumberFormat('@').setValues([cols.map(c => str_(o[c]))]);
}
function nextTs_() {   // strictly increasing server time stamp (the pull cursor)
  const props = PropertiesService.getScriptProperties();
  const t = Math.max(Date.now(), Number(props.getProperty('LAST_TS') || 0) + 1);
  props.setProperty('LAST_TS', String(t));
  return t;
}
function sheetOf_(name, cols) {   // the sheet, made (or its header extended) when this version meets an older spreadsheet
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@'); }
  if (sh.getRange(1, cols.length).getValue() !== cols[cols.length - 1]) {
    if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
/* rows nobody (else) is handling: each phone registration / photographed result is taken by one device only */
function claim_(sh, cols, rows, pc) {
  const now = Date.now(), out = [];
  rows.forEach(o => {
    if (o.pc_id) return;
    if (o.claim && o.claim !== pc && now - Number(o.claim_t || 0) < CLAIM_MS) return;
    sh.getRange(o._row, cols.indexOf('claim') + 1, 1, 2).setNumberFormat('@').setValues([[pc, String(now)]]);
    const x = Object.assign({}, o); delete x._row; out.push(x);
  });
  return out;
}
function cfg_() {
  const sh = sh_('config');
  const n = sh.getLastRow();
  if (n < 2) return {};
  const o = {};
  sh.getRange(2, 1, n - 1, 2).getValues().forEach(r => { try { o[r[0]] = JSON.parse(r[1]); } catch (e) { } });
  return o;
}

// appointments: upsert by uid, the newer updated_at wins
function upsertAppts_(rows, by) {
  const sh = sh_('appointments');
  if (sh.getRange(1, A_COLS.length).getValue() !== A_COLS[A_COLS.length - 1]) sh.getRange(1, 1, 1, A_COLS.length).setValues([A_COLS]).setFontWeight('bold');
  const all = readAll_(sh, A_COLS), idx = {};
  all.forEach(o => { if (o.uid) idx[o.uid] = o; });
  let last = Math.max(sh.getLastRow(), 1), n = 0;
  rows.forEach(r => {
    if (!r || !r.uid) return;
    const ex = idx[r.uid];
    if (ex && Number(ex.updated_at || 0) >= Number(r.updated_at || 0)) return;
    const o = {};
    A_COLS.forEach(c => { o[c] = r[c] === undefined ? (ex ? ex[c] : '') : r[c]; });
    o.srv_ts = nextTs_();
    o.by = by;
    if (ex) { writeRow_(sh, ex._row, A_COLS, o); o._row = ex._row; }
    else { last++; writeRow_(sh, last, A_COLS, o); o._row = last; }
    idx[r.uid] = o;
    n++;
  });
  return n;
}

// ------------------------------------------------------------------ API for the clinic computer (token)
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Invalid request' }); }
  if (req.action === 'rpc') {              // the clinic's phone app: the same calls as the phone page (each checks the PIN session itself)
    const mv0 = prop_('MOVED_TO');
    if (mv0) return json_({ ok: false, moved: mv0, error: 'moved' });
    return json_(call(String(req.fn || ''), req.args || []));
  }
  if (!req.token || req.token !== prop_('TOKEN')) return json_({ ok: false, error: 'Wrong sync token' });
  const mv = prop_('MOVED_TO');            // the clinic moved to another Google account: tell the program the new link
  if (mv) return json_({ ok: false, moved: mv, error: 'moved' });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = ss_();
    switch (req.action) {
      case 'ping':
        return json_({ ok: true, clinic: CLINIC_NAME });
      case 'push':
        return json_({ ok: true, accepted: upsertAppts_(req.rows || [], req.multi ? 'pc:' + (req.pc || '') : 'clinic') });
      case 'pull': {
        // the last 2 minutes are sent again: phone writes may land just behind the cursor
        const since = Number(req.since || 0);
        let cursor = since;
        const all = readAll_(ss.getSheetByName('appointments'), A_COLS);
        all.forEach(o => { cursor = Math.max(cursor, Number(o.srv_ts || 0)); });
        const me = 'pc:' + (req.pc || ''), old = req.multi ? '' : 'clinic';
        const rows = all.filter(o => Number(o.srv_ts || 0) > since - 120000 && o.by !== me && o.by !== old).map(o => { delete o._row; return o; });
        const nsh = sheetOf_('new_patients', N_COLS);
        const np = req.multi ? claim_(nsh, N_COLS, readAll_(nsh, N_COLS), req.pc || '')
          : readAll_(nsh, N_COLS).filter(o => !o.pc_id).map(o => { delete o._row; return o; });
        const fsh = sheetOf_('phone_files', F_COLS);
        const nf = req.multi ? claim_(fsh, F_COLS, readAll_(fsh, F_COLS), req.pc || '') : [];
        return json_({ ok: true, rows: rows, cursor: cursor, new_patients: np, new_files: nf });
      }
      case 'ack_patients': {      // [[uid, pc file number]]
        const sh = ss.getSheetByName('new_patients');
        const all = readAll_(sh, N_COLS), map = {};
        (req.rows || []).forEach(r => { map[r[0]] = r[1]; });
        all.forEach(o => { if (map[o.uid] !== undefined && !o.pc_id) sh.getRange(o._row, N_COLS.indexOf('pc_id') + 1).setValue(String(map[o.uid])); });
        return json_({ ok: true });
      }
      case 'ack_files': {         // [[uid, pc file id]]
        const sh = sheetOf_('phone_files', F_COLS);
        const all = readAll_(sh, F_COLS), map = {};
        (req.rows || []).forEach(r => { map[r[0]] = r[1]; });
        all.forEach(o => { if (map[o.uid] !== undefined && !o.pc_id) sh.getRange(o._row, F_COLS.indexOf('pc_id') + 1).setValue(String(map[o.uid])); });
        return json_({ ok: true });
      }
      // ---------------------------------------------------------- several devices at the same time (opsync.py)
      case 'ops_init': {          // the first device on the new way: the numbers already used, and the start of the change list
        const L = lease_();
        if (L.ops_on) return json_(Object.assign({ ok: true, already: true }, L));
        const mx = {};
        Object.keys(req.floor || {}).forEach(t => { mx[t] = Number(req.floor[t]) || 0; });
        PropertiesService.getScriptProperties().setProperty('IDMAX', JSON.stringify(mx));
        sheetOf_('ops', O_COLS);
        Object.assign(L, { ops_on: true, opseq: 0, holder: '', name: '', pending: '', pending_name: '', pending_t: 0 });
        saveLease_(L);
        return json_(Object.assign({ ok: true }, L));
      }
      case 'ops_push':
        return json_(opsPush_(req));
      case 'ops_pull':
        return json_(opsPull_(req));
      case 'patients': {
        const ps = ss.getSheetByName('patients');
        const rows = (req.rows || []).map(r => P_COLS.map((c, i) => str_(r[i])));
        if (ps.getLastRow() > 1) ps.getRange(2, 1, ps.getLastRow() - 1, P_COLS.length).clearContent();
        if (rows.length) {
          if (ps.getMaxRows() < rows.length + 1) ps.insertRowsAfter(ps.getMaxRows(), rows.length + 1 - ps.getMaxRows());
          ps.getRange(2, 1, rows.length, P_COLS.length).setNumberFormat('@').setValues(rows);
        }
        CacheService.getScriptCache().remove('plist');
        return json_({ ok: true, count: rows.length });
      }
      case 'clinical': {         // [[patient id, summary json]] — doctor's read-only view
        const cs = ss.getSheetByName('clinical');
        const n = cs.getLastRow();
        const ids = n > 1 ? cs.getRange(2, 1, n - 1, 1).getValues().map(r => String(r[0])) : [];
        const at = {};
        ids.forEach((id, i) => { at[id] = i + 2; });
        const add = [];
        (req.rows || []).forEach(r => {
          let js = String(r[1]);
          if (js.length > 49000) {               // one cell holds 50,000 characters: drop the oldest visits
            const o = JSON.parse(js);
            while (JSON.stringify(o).length > 49000 && o.v.length > 1) o.v.pop();
            js = JSON.stringify(o).slice(0, 49000);
          }
          const row = at[String(r[0])];
          if (row) cs.getRange(row, 2).setValue(js);
          else add.push([String(r[0]), js]);
        });
        if (add.length) cs.getRange(cs.getLastRow() + 1, 1, add.length, 2).setNumberFormat('@').setValues(add);
        (req.remove || []).map(String).filter(id => at[id]).map(id => at[id]).sort((a, b) => b - a).forEach(row => cs.deleteRow(row));
        return json_({ ok: true, count: (req.rows || []).length });
      }
      case 'config': {
        const cs = ss.getSheetByName('config');
        const c = req.config || {};
        const rows = Object.keys(c).map(k => [k, JSON.stringify(c[k])]);
        if (cs.getLastRow() > 1) cs.getRange(2, 1, cs.getLastRow() - 1, 2).clearContent();
        if (rows.length) cs.getRange(2, 1, rows.length, 2).setNumberFormat('@').setValues(rows);
        return json_({ ok: true });
      }
      // ---------------------------------------------------------- PC hand-over (one clinic PC at a time, see handoff.py)
      case 'lease':
        return json_(Object.assign({ ok: true }, lease_()));
      case 'claim': {
        const L = lease_(), now = Date.now();
        if (req.force || !L.holder || L.holder === req.pc || now - L.beat > 90000) {
          Object.assign(L, { holder: req.pc, name: req.name || '', beat: now, pending: '', pending_name: '', pending_t: 0 });
        } else {
          Object.assign(L, { pending: req.pc, pending_name: req.name || '', pending_t: now });
        }
        saveLease_(L);
        return json_(Object.assign({ ok: true }, L));
      }
      case 'beat': {
        const L = lease_(), now = Date.now();
        if (L.holder === req.pc) L.beat = now;
        if (L.pending && now - L.pending_t > 180000) Object.assign(L, { pending: '', pending_name: '', pending_t: 0 });
        saveLease_(L);
        return json_(Object.assign({ ok: true }, L));
      }
      case 'release': {
        const L = lease_();
        if (L.holder === req.pc) {
          Object.assign(L, { holder: L.pending || '', name: L.pending_name || '', beat: Date.now(), pending: '', pending_name: '', pending_t: 0 });
          saveLease_(L);
        }
        return json_(Object.assign({ ok: true }, L));
      }
      case 'db_push': {
        const L = lease_();
        if (L.ops_on) {           // several devices: a full copy for new devices / safety, with the change it includes
          if (req.opseq === undefined || req.opseq === null) return json_({ ok: false, error: 'This program is too old for this clinic — restart it to update' });
          if (Number(req.opseq) < Number(L.opseq || 0)) return json_({ ok: true, seq: L.seq, t: L.t, skipped: true });
          L.opseq = Number(req.opseq);
        } else if (L.holder !== req.pc) return json_({ ok: false, error: 'not holder', holder: L.holder, name: L.name });
        const f = sub_('live').createFile(Utilities.newBlob(Utilities.base64Decode(req.data), 'application/gzip', 'clinic_live_' + (L.seq + 1) + '.db.gz'));
        Object.assign(L, { seq: L.seq + 1, t: Date.now(), file: f.getId(), beat: Date.now(), by: req.name || L.name });
        saveLease_(L);
        const files = [], it = sub_('live').getFiles();
        while (it.hasNext()) files.push(it.next());
        files.sort((x, y) => y.getDateCreated() - x.getDateCreated());
        files.slice(5).forEach(x => drop_(x));        // old copies are deleted for good, not kept in the bin
        return json_({ ok: true, seq: L.seq, t: L.t });
      }
      case 'db_pull': {
        const L = lease_();
        if (!L.file) return json_({ ok: true, seq: 0 });
        return json_({ ok: true, seq: L.seq, t: L.t, by: L.by || '', opseq: L.opseq, ops_on: !!L.ops_on, data: Utilities.base64Encode(DriveApp.getFileById(L.file).getBlob().getBytes()) });
      }
      case 'files_list': {
        const names = [], it = sub_('files').getFiles();
        while (it.hasNext()) names.push(it.next().getName());
        return json_({ ok: true, names: names });
      }
      case 'file_put': {
        const d = sub_('files');
        if (!d.getFilesByName(req.fname).hasNext()) d.createFile(Utilities.newBlob(Utilities.base64Decode(req.data), 'application/octet-stream', req.fname));
        return json_({ ok: true });
      }
      case 'file_get': {
        const it = sub_('files').getFilesByName(req.fname);
        if (!it.hasNext()) return json_({ ok: false, error: 'missing file' });
        return json_({ ok: true, data: Utilities.base64Encode(it.next().getBlob().getBytes()) });
      }
      case 'backup': {
        const folder = DriveApp.getFolderById(prop_('BACKUP_FOLDER'));
        folder.createFile(Utilities.newBlob(Utilities.base64Decode(req.data), 'application/octet-stream', req.name || 'clinic.db'));
        const files = [];
        const it = folder.getFiles();
        while (it.hasNext()) files.push(it.next());
        files.sort((x, y) => y.getDateCreated() - x.getDateCreated());
        files.slice(KEEP_BACKUPS).forEach(f => drop_(f));
        return json_({ ok: true, name: req.name });
      }
      default:
        return json_({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------ the phone page
function doGet() {
  const mv = prop_('MOVED_TO');
  if (mv) return movedPage_(mv);
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(CLINIC_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* PIN check — same hashing as the clinic program: salt$sha256(salt+pin) */
function sha256hex_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}
function session_(tok) {
  if (!tok) throw new Error('LOGIN');
  const s = CacheService.getScriptCache().get('s_' + tok);
  if (!s) throw new Error('LOGIN');
  return JSON.parse(s);
}

function apiLogin(pin) {
  pin = String(pin || '');
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('fails') || 0);
  if (fails >= 40) return { ok: false, error: 'محاولات كثيرة — انتظر 10 دقائق / Too many attempts, wait 10 minutes' };
  const users = cfg_().users || [];
  for (const u of users) {
    const st = String(u[2] || ''), salt = st.split('$')[0];
    if (st.indexOf('$') > 0 && salt + '$' + sha256hex_(salt + pin) === st) {
      const tok = Utilities.getUuid().replace(/-/g, '');
      cache.put('s_' + tok, JSON.stringify({ name: u[0], role: u[1] }), SESSION_H * 3600);
      return { ok: true, token: tok, user: { name: u[0], role: u[1] } };
    }
  }
  if (pin.length >= 4) cache.put('fails', String(fails + 1), 600);
  return { ok: false, error: users.length ? 'WRONG' : 'لم تتم المزامنة مع برنامج العيادة بعد' };
}

// everything the page needs at start: user, settings, patient list
function apiBoot(tok) {
  const u = session_(tok), c = cfg_();
  const cache = CacheService.getScriptCache();
  let plist = cache.get('plist');
  if (!plist) {
    plist = JSON.stringify(readAll_(sh_('patients'), P_COLS).map(o => [o.id, o.name, o.birth_year, o.phone, o.address, o.last]));
    if (plist.length < 95000) cache.put('plist', plist, 600);
  }
  const pend = readAll_(sh_('new_patients'), N_COLS).filter(o => !o.pc_id).map(o => ['n:' + o.uid, o.name, o.birth_year, o.phone, o.address, '']);
  return { ok: true, user: u, clinic: c.clinic || CLINIC_NAME, work: c.work || ['13:00', '21:00'], wa: c.wa || '', areas: c.areas || [], occupations: c.occupations || [],
           labs: c.labs || [], patients: JSON.parse(plist).concat(pend), now: Date.now() };
}

function apiDay(tok, date) {
  session_(tok);
  const rows = readAll_(sh_('appointments'), A_COLS).filter(o => o.date === date && o.deleted !== '1' && o.hold !== '1').map(o => { delete o._row; return o; });
  rows.sort((a, b) => (Number(a.seq) || 999) - (Number(b.seq) || 999) || String(a.time).localeCompare(String(b.time)));
  return { ok: true, rows: rows };
}

// secretary: book / change status / delete. Doctor: read only.
function apiSaveAppt(tok, a) {
  const u = session_(tok);
  if (u.role !== 'secretary' && u.role !== 'doctor') throw new Error('Not allowed');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sh_('appointments');
    const all = readAll_(sh, A_COLS);
    let ex = a.uid ? all.find(o => o.uid === a.uid) : null;
    if (!ex && a.date && a.hold !== '1') {   // one appointment per patient per day: a second booking updates the first
      const pid = String(a.patient_id || '').trim(), nm = String(a.name || '').trim();
      ex = all.find(o => o.date === a.date && o.deleted !== '1' && o.hold !== '1' &&
        (pid ? String(o.patient_id || '').trim() === pid : (nm && !String(o.patient_id || '').trim() && String(o.name || '').trim() === nm))) || null;
      if (ex && a.status === '' ) delete a.status;   // never turn an arrived patient back into "booked"
    }
    if (u.role === 'doctor' && !ex) throw new Error('Read only');
    const o = ex ? Object.assign({}, ex) : { uid: Utilities.getUuid().replace(/-/g, ''), deleted: '0', status: '' };
    if (a.weight !== undefined && a.weight !== '' && !(Number(a.weight) >= 2 && Number(a.weight) <= 300)) throw new Error('الوزن بين 2 و 300 كغم');
    ['date', 'time', 'patient_id', 'name', 'phone', 'note', 'status', 'deleted', 'age', 'weight', 'kind', 'call', 'hold', 'reminded'].forEach(k => { if (a[k] !== undefined) o[k] = a[k]; });
    if (u.role === 'doctor') { const st = a.status; Object.assign(o, ex); if (st !== undefined) o.status = st; }
    if (o.hold !== '1') o.hold = '0';   // the doctor may only change the status
    if (!o.date) throw new Error('No date');
    if (!ex) o.seq = String(all.filter(x => x.date === o.date).reduce((m, x) => Math.max(m, Number(x.seq) || 0), 0) + 1);
    o.updated_at = Date.now();
    upsertAppts_([o], 'phone:' + u.name);
    return { ok: true, uid: o.uid };
  } finally { lock.releaseLock(); }
}

// ------------------------------------------------------------------ the change list (several devices at the same time)
function opsPush_(req) {
  const cache = CacheService.getScriptCache(), ck = 'ob_' + req.batch;
  const done = req.batch && cache.get(ck);
  if (done) return JSON.parse(done);                       // the same batch sent again (the answer was lost): same answer
  const props = PropertiesService.getScriptProperties();
  const mx = JSON.parse(props.getProperty('IDMAX') || '{}');
  Object.keys(req.floor || {}).forEach(t => { mx[t] = Math.max(mx[t] || 0, Number(req.floor[t]) || 0); });
  const sh = sheetOf_('ops', O_COLS), map = {}, remap = [], now = Date.now();
  let seq = Math.max(sh.getLastRow() - 1, 0);
  const first = seq + 1;
  const rows = (req.ops || []).map(o => {
    const t = o.tbl, isId = ID_TABLES.indexOf(t) >= 0;
    let k = String(o.k), d = o.data || null;
    if (isId) {
      map[t] = map[t] || {};
      if (map[t][k]) k = map[t][k];
      if (o.op === 'i') {
        // a number is new only when no device has used it before (the floor of a device leaves out its own new rows)
        if (Number(k) <= (mx[t] || 0)) {
          const nid = (mx[t] || 0) + 1;
          map[t][String(o.k)] = String(nid); remap.push({ tbl: t, old: Number(o.k), new: nid });
          k = String(nid);
        }
        mx[t] = Math.max(mx[t] || 0, Number(k));
      }
      if (d) {
        d = Object.assign({}, d);
        if (d.id !== undefined) d.id = Number(k);
        Object.keys(FK[t] || {}).forEach(c => { const pt = FK[t][c]; if (d[c] !== undefined && d[c] !== null && map[pt] && map[pt][String(d[c])]) d[c] = Number(map[pt][String(d[c])]); });
      }
    }
    seq++;
    let js = d ? JSON.stringify(d) : '';
    if (js.length > 45000) {                               // a cell holds 50,000 characters: a very long row goes to a file
      const f = sub_('ops').createFile(Utilities.newBlob(js, 'application/json', 'op_' + seq + '.json'));
      js = '@file:' + f.getId();
    }
    return [String(seq), String(now), String(req.device || ''), t, k, o.op, js];
  });
  if (rows.length) {
    if (sh.getMaxRows() < first + rows.length) sh.insertRowsAfter(sh.getMaxRows(), first + rows.length - sh.getMaxRows() + 100);
    sh.getRange(first + 1, 1, rows.length, O_COLS.length).setNumberFormat('@').setValues(rows);
  }
  props.setProperty('IDMAX', JSON.stringify(mx));
  const out = { ok: true, from: first, last: seq, remap: remap };
  if (req.batch) cache.put(ck, JSON.stringify(out), 21600);
  return out;
}
function opsPull_(req) {
  const sh = sheetOf_('ops', O_COLS), since = Math.max(Number(req.since || 0), 0), last = Math.max(sh.getLastRow() - 1, 0);
  const n = Math.min(last - since, 1000);
  const ops = n > 0 ? sh.getRange(since + 2, 1, n, O_COLS.length).getValues().map(r => {
    let js = String(r[6] || '');
    if (js.indexOf('@file:') === 0) js = DriveApp.getFileById(js.slice(6)).getBlob().getDataAsString();
    return { seq: Number(r[0]), dev: String(r[2]), tbl: String(r[3]), k: String(r[4]), op: String(r[5]), data: js ? JSON.parse(js) : null };
  }) : [];
  return { ok: true, ops: ops, last: since + Math.max(n, 0), more: since + n < last, top: last };
}

// secretary: photograph / upload a result sheet → the patient's investigation files on the clinic PCs
function apiUploadFile(tok, a) {
  const u = session_(tok);
  if (u.role !== 'secretary' && u.role !== 'doctor') throw new Error('Not allowed');
  const pid = String(a.patient_id || '').trim();
  if (!pid) throw new Error('No patient');
  const mime = String(a.mime || 'image/jpeg');
  if (!(mime.indexOf('image/') === 0 || mime === 'application/pdf')) throw new Error('صورة أو PDF فقط');
  const bytes = Utilities.base64Decode(String(a.data || ''));
  if (!bytes.length) throw new Error('الملف فارغ');
  if (bytes.length > 15 * 1024 * 1024) throw new Error('الملف أكبر من 15 MB');
  const uid = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg';
  const fname = pid.replace(/[^0-9a-zA-Z]/g, '_') + '__phone_' + uid + '.' + ext;
  sub_('files').createFile(Utilities.newBlob(bytes, 'application/octet-stream', fname));
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheetOf_('phone_files', F_COLS);
    writeRow_(sh, sh.getLastRow() + 1, F_COLS, { uid: uid, patient_id: pid, name: String(a.name || '').slice(0, 120), mime: mime, fname: fname,
      date: String(a.date || '').slice(0, 10), by: 'phone:' + u.name, created: String(Date.now()) });
  } finally { lock.releaseLock(); }
  return { ok: true, uid: uid };
}

function apiNewPatient(tok, p) {
  const u = session_(tok);
  if (u.role !== 'secretary' && u.role !== 'doctor') throw new Error('Not allowed');
  if (!String(p.name || '').trim()) throw new Error('اكتب الاسم');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sh_('new_patients');
    const o = { uid: Utilities.getUuid().replace(/-/g, ''), name: String(p.name).trim(), gender: p.gender || '', birth_year: p.birth_year || '', phone: p.phone || '',
                address: p.address || '', occupation: p.occupation || '', by: 'phone:' + u.name, created: new Date().toISOString(), pc_id: '' };
    writeRow_(sh, Math.max(sh.getLastRow(), 1) + 1, N_COLS, o);
    return { ok: true, id: 'n:' + o.uid };
  } finally { lock.releaseLock(); }
}

// doctor: read-only summary of one file
function apiClinical(tok, pid) {
  const u = session_(tok);
  if (u.role !== 'doctor') throw new Error('Doctor only');
  const cs = sh_('clinical');
  const f = cs.getRange(1, 1, Math.max(cs.getLastRow(), 1), 1).createTextFinder(String(pid)).matchEntireCell(true).findNext();
  if (!f || f.getRow() < 2) return { ok: true, c: null };
  return { ok: true, c: JSON.parse(cs.getRange(f.getRow(), 2).getValue()) };
}

// waiting list (no date yet) + automatic follow-up appointments of the coming week still to be phoned
function apiRecall(tok) {
  session_(tok);
  const all = readAll_(sh_('appointments'), A_COLS).filter(o => o.deleted !== '1').map(o => { delete o._row; return o; });
  const t = Utilities.formatDate(new Date(), 'Asia/Baghdad', 'yyyy-MM-dd'), d7 = Utilities.formatDate(new Date(Date.now() + 7 * 864e5), 'Asia/Baghdad', 'yyyy-MM-dd');
  const by = (a, b) => String(a.date).localeCompare(String(b.date));
  return { ok: true, hold: all.filter(o => o.hold === '1').sort(by),
           calls: all.filter(o => o.kind === 'auto' && o.hold !== '1' && (!o.call || o.call === 'noans') && !o.status && o.date >= t && o.date <= d7).sort(by) };
}

// for the page: everything returns {ok:false,error} instead of throwing, except LOGIN
function call(fn, args) {
  try {
    const f = { apiLogin, apiBoot, apiDay, apiSaveAppt, apiNewPatient, apiClinical, apiRecall, apiUploadFile }[fn];
    if (!f) throw new Error('Unknown');
    return f.apply(null, args || []);
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

// ------------------------------------------------------------------ PC hand-over helpers
function lease_() {
  const L = JSON.parse(PropertiesService.getScriptProperties().getProperty('LEASE') || '{}');
  return Object.assign({ holder: '', name: '', beat: 0, pending: '', pending_name: '', pending_t: 0, seq: 0, t: 0, file: '', by: '' }, L);
}
function saveLease_(L) { PropertiesService.getScriptProperties().setProperty('LEASE', JSON.stringify(L)); }
function sub_(name) {     // sub-folder of the backup folder: 'live' (newest database) and 'files' (attached scans)
  const props = PropertiesService.getScriptProperties(), key = 'FOLDER_' + name.toUpperCase();
  const id = props.getProperty(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { } }
  const f = DriveApp.getFolderById(prop_('BACKUP_FOLDER')).createFolder(name);
  props.setProperty(key, f.getId());
  return f;
}

/* ------------------------------------------------------------------ one-time move from the old account
   Run importOld from the editor once, after setup: copies the newest database, the attached files and the
   online sheet from the old script's folders (shared with this account), and continues its hand-over count. */
const OLD = { live: '1z8Oun-bjmk-B6PLA-Hv7x2935l48pjp6', files: '1YThAtVibGdIhT6CF4fuvNqVgdlM9PiM3', sheet: '1vLaABEgUdSg2r68zK9uHXMqBcPKaGyQ2512YtYbFjaw' };
function importOld() {
  const props = PropertiesService.getScriptProperties();
  // 1. newest database copy
  const it = DriveApp.getFolderById(OLD.live).getFiles(), all = [];
  while (it.hasNext()) all.push(it.next());
  all.sort((x, y) => seqOf_(y) - seqOf_(x));
  const top = all[0], seq = seqOf_(top);
  const copy = top.makeCopy(top.getName(), sub_('live'));
  const L = lease_();
  Object.assign(L, { holder: '', name: '', beat: 0, pending: '', pending_name: '', pending_t: 0, seq: seq, t: Date.now(), file: copy.getId(), by: 'moved from the old account' });
  saveLease_(L);
  // 2. attached files
  const have = {}, f2 = sub_('files').getFiles();
  while (f2.hasNext()) have[f2.next().getName()] = 1;
  let n = 0;
  const fi = DriveApp.getFolderById(OLD.files).getFiles();
  while (fi.hasNext()) { const f = fi.next(); if (!have[f.getName()]) { f.makeCopy(f.getName(), sub_('files')); n++; } }
  // 3. online sheet (appointments, patients, phone registrations, doctor's view, config)
  const src = SpreadsheetApp.openById(OLD.sheet), dst = ss_();
  ['appointments', 'patients', 'new_patients', 'clinical', 'config'].forEach(name => {
    const a = src.getSheetByName(name), b = dst.getSheetByName(name);
    if (!a || !b) return;
    const v = a.getDataRange().getValues();
    b.clear();
    if (v.length) b.getRange(1, 1, v.length, v[0].length).setNumberFormat('@').setValues(v);
  });
  Logger.log('Database copy ' + top.getName() + ' (seq ' + seq + '), ' + n + ' attached files, sheet copied ✓');
}
function seqOf_(f) { const m = f.getName().match(/_(\d+)\.db\.gz$/); return m ? Number(m[1]) : 0; }
