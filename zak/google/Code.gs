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
const N_COLS = ['uid', 'name', 'gender', 'birth_year', 'phone', 'address', 'occupation', 'by', 'created', 'pc_id'];
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
  [['appointments', A_COLS], ['patients', P_COLS], ['new_patients', N_COLS], ['clinical', C_COLS], ['config', ['k', 'v']]].forEach(([n, c]) => {
    const sh = sheet_(ss, n, c);
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');   // everything as text (phones keep their 0)
  });
  const s1 = ss.getSheets().filter(s => ['appointments', 'patients', 'new_patients', 'clinical', 'config'].indexOf(s.getName()) < 0);
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
        return json_({ ok: true, accepted: upsertAppts_(req.rows || [], 'clinic') });
      case 'pull': {
        // the last 2 minutes are sent again: phone writes may land just behind the cursor
        const since = Number(req.since || 0);
        let cursor = since;
        const all = readAll_(ss.getSheetByName('appointments'), A_COLS);
        all.forEach(o => { cursor = Math.max(cursor, Number(o.srv_ts || 0)); });
        const rows = all.filter(o => Number(o.srv_ts || 0) > since - 120000 && o.by !== 'clinic').map(o => { delete o._row; return o; });
        const np = readAll_(ss.getSheetByName('new_patients'), N_COLS).filter(o => !o.pc_id).map(o => { delete o._row; return o; });
        return json_({ ok: true, rows: rows, cursor: cursor, new_patients: np });
      }
      case 'ack_patients': {      // [[uid, pc file number]]
        const sh = ss.getSheetByName('new_patients');
        const all = readAll_(sh, N_COLS), map = {};
        (req.rows || []).forEach(r => { map[r[0]] = r[1]; });
        all.forEach(o => { if (map[o.uid] !== undefined && !o.pc_id) sh.getRange(o._row, N_COLS.indexOf('pc_id') + 1).setValue(String(map[o.uid])); });
        return json_({ ok: true });
      }
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
        if (L.holder !== req.pc) return json_({ ok: false, error: 'not holder', holder: L.holder, name: L.name });
        const f = sub_('live').createFile(Utilities.newBlob(Utilities.base64Decode(req.data), 'application/gzip', 'clinic_live_' + (L.seq + 1) + '.db.gz'));
        Object.assign(L, { seq: L.seq + 1, t: Date.now(), file: f.getId(), beat: Date.now(), by: L.name });
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
        return json_({ ok: true, seq: L.seq, t: L.t, by: L.by || '', data: Utilities.base64Encode(DriveApp.getFileById(L.file).getBlob().getBytes()) });
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
    const f = { apiLogin, apiBoot, apiDay, apiSaveAppt, apiNewPatient, apiClinical, apiRecall }[fn];
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
