/*******************************************************************
 *  عيادة أزهر وعلي — سكربت واحد على حساب a2her.agha:
 *    - doPost: مزامنة برنامج العيادة + النسخ الاحتياطية + التناوب بين الحاسبة والهاتف
 *    - doGet : صفحة المواعيد على الموبايل (مفتوحة لمن لديه الرابط، المواعيد فقط)
 *  النشر: Execute as = Me ، Who has access = Anyone
 *  أول مرة: شغّل setup (ينشئ «العيادات/عيادة أزهر وعلي» والجدول والنسخ الاحتياطية).
 *  التحديث لاحقاً: Deploy ← Manage deployments ← Edit ← New version (الرابط يبقى نفسه).
 *******************************************************************/
const CLINIC_NAME = 'عيادة أزهر وعلي';
const ROOT_FOLDER = 'العيادات';
const VIEWERS = ['alidhahi1987@gmail.com', 'a2her.agha.dent@gmail.com'];   // مشاهدة مجلد العيادة فقط
/******************************************************************/

const A_COLS = ['uid', 'date', 'time', 'name', 'age', 'phone', 'area', 'work', 'note', 'status', 'patient_id', 'updated_at', 'deleted', 'srv_ts', 'by', 'doctor'];  // new columns go at the end only
const P_COLS = ['id', 'name', 'age', 'phone', 'area'];
const KEEP_BACKUPS = 30;
const KEEP_LIVE = 5;          // newest copies of the live database kept for the hand-over

// ------------------------------------------------------------------ one-time setup (run from the editor)
function folderIn_(parent, name) {
  const it = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

function setup() {
  const props = PropertiesService.getScriptProperties();
  const clinic = folderIn_(folderIn_(null, ROOT_FOLDER), CLINIC_NAME);
  props.setProperty('CLINIC_FOLDER', clinic.getId());
  let ss = null;
  try { ss = props.getProperty('SHEET_ID') ? SpreadsheetApp.openById(props.getProperty('SHEET_ID')) : null; } catch (e) { ss = null; }
  if (!ss) {
    ss = SpreadsheetApp.create('مواعيد ' + CLINIC_NAME + ' (لا تعدّل يدوياً)');
    DriveApp.getFileById(ss.getId()).moveTo(clinic);
    props.setProperty('SHEET_ID', ss.getId());
  }
  const a = sheet_(ss, 'appointments', A_COLS);
  const p = sheet_(ss, 'patients', P_COLS);
  [a, p].forEach(sh => sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@'));  // keep everything as text (phones keep their 0)
  ss.getSheets().forEach(s => { if (['appointments', 'patients', 'config'].indexOf(s.getName()) < 0 && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s); });
  let token = props.getProperty('TOKEN');
  if (!token) {
    token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    props.setProperty('TOKEN', token);
  }
  let folder = null;
  try { folder = props.getProperty('BACKUP_FOLDER') ? DriveApp.getFolderById(props.getProperty('BACKUP_FOLDER')) : null; } catch (e) { folder = null; }
  if (!folder) {
    folder = folderIn_(clinic, 'النسخ الاحتياطية');
    props.setProperty('BACKUP_FOLDER', folder.getId());
  }
  try { DriveApp.getFileById(ScriptApp.getScriptId()).moveTo(folderIn_(null, ROOT_FOLDER)); } catch (e) { }   // the script itself stays outside the shared folder
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
function showToken() {
  Logger.log('رمز المزامنة: ' + PropertiesService.getScriptProperties().getProperty('TOKEN'));
}

// ------------------------------------------------------------------ helpers
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function ss_() { return SpreadsheetApp.openById(prop_('SHEET_ID')); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function cell_(x, col) {
  if (x instanceof Date) return Utilities.formatDate(x, 'Asia/Baghdad', col === 'time' ? 'HH:mm' : 'yyyy-MM-dd');
  return x === null || x === undefined ? '' : String(x);
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
function writeRow_(sh, row, o) {
  sh.getRange(row, 1, 1, A_COLS.length).setNumberFormat('@').setValues([A_COLS.map(c => (o[c] === null || o[c] === undefined) ? '' : String(o[c]))]);
}
function nextTs_() {   // strictly increasing server time stamp (used as the pull cursor)
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty('LAST_TS') || 0);
  const t = Math.max(Date.now(), last + 1);
  props.setProperty('LAST_TS', String(t));
  return t;
}
function clean_(o) { const r = {}; A_COLS.forEach(c => { r[c] = o[c] === undefined ? '' : o[c]; }); return r; }

// upsert by uid; the newer updated_at wins
function upsert_(sh, rows, by) {
  if (sh.getLastColumn() < A_COLS.length || sh.getRange(1, A_COLS.length).getValue() !== A_COLS[A_COLS.length - 1]) sh.getRange(1, 1, 1, A_COLS.length).setValues([A_COLS]);
  const all = readAll_(sh, A_COLS);
  const idx = {};
  all.forEach(o => { if (o.uid) idx[o.uid] = o; });
  let last = Math.max(sh.getLastRow(), 1);
  let n = 0;
  rows.forEach(r => {
    if (!r || !r.uid) return;
    const ex = idx[r.uid];
    if (ex && Number(ex.updated_at || 0) >= Number(r.updated_at || 0)) return;
    const o = clean_(r);
    o.srv_ts = nextTs_();
    o.by = by;
    if (ex) writeRow_(sh, ex._row, o);
    else { last++; writeRow_(sh, last, o); o._row = last; idx[r.uid] = o; }
    n++;
  });
  return n;
}

// ------------------------------------------------------------------ hand-over: one device (clinic PC or phone) at a time
function lease_() {
  const L = JSON.parse(prop_('LEASE') || '{}');
  return Object.assign({ holder: '', name: '', beat: 0, pending: '', pending_name: '', pending_t: 0, seq: 0, t: 0, file: '', by: '' }, L);
}
function saveLease_(L) { PropertiesService.getScriptProperties().setProperty('LEASE', JSON.stringify(L)); }
function liveFolder_() {      // sub-folder «live» of the backup folder: the newest database, gzip
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_LIVE');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { } }
  const f = DriveApp.getFolderById(prop_('BACKUP_FOLDER')).createFolder('live');
  props.setProperty('FOLDER_LIVE', f.getId());
  return f;
}
function handoff_(req) {
  switch (req.action) {
    case 'lease':
      return Object.assign({ ok: true }, lease_());
    case 'claim': {
      const L = lease_(), now = Date.now();
      if (req.force || !L.holder || L.holder === req.pc || now - L.beat > 90000) {
        Object.assign(L, { holder: req.pc, name: req.name || '', beat: now, pending: '', pending_name: '', pending_t: 0 });
      } else {
        Object.assign(L, { pending: req.pc, pending_name: req.name || '', pending_t: now });
      }
      saveLease_(L);
      return Object.assign({ ok: true }, L);
    }
    case 'beat': {
      const L = lease_(), now = Date.now();
      if (L.holder === req.pc) L.beat = now;
      if (L.pending && now - L.pending_t > 180000) Object.assign(L, { pending: '', pending_name: '', pending_t: 0 });
      saveLease_(L);
      return Object.assign({ ok: true }, L);
    }
    case 'release': {
      const L = lease_();
      if (L.holder === req.pc) {
        Object.assign(L, { holder: L.pending || '', name: L.pending_name || '', beat: Date.now(), pending: '', pending_name: '', pending_t: 0 });
        saveLease_(L);
      }
      return Object.assign({ ok: true }, L);
    }
    case 'db_push': {
      const L = lease_();
      if (L.holder !== req.pc) return { ok: false, error: 'not holder', holder: L.holder, name: L.name };
      const dir = liveFolder_();
      const f = dir.createFile(Utilities.newBlob(Utilities.base64Decode(req.data), 'application/gzip', 'clinic_live_' + (L.seq + 1) + '.db.gz'));
      Object.assign(L, { seq: L.seq + 1, t: Date.now(), file: f.getId(), beat: Date.now(), by: L.name });
      saveLease_(L);
      const files = [], it = dir.getFiles();
      while (it.hasNext()) files.push(it.next());
      files.sort((x, y) => y.getDateCreated() - x.getDateCreated());
      files.slice(KEEP_LIVE).forEach(x => x.setTrashed(true));
      return { ok: true, seq: L.seq, t: L.t };
    }
    case 'db_pull': {
      const L = lease_();
      if (!L.file) return { ok: true, seq: 0 };
      return { ok: true, seq: L.seq, t: L.t, by: L.by || '', data: Utilities.base64Encode(DriveApp.getFileById(L.file).getBlob().getBytes()) };
    }
  }
  return null;
}

// ------------------------------------------------------------------ API for the clinic program (token)
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'طلب غير صالح' }); }
  if (!req.token || req.token !== prop_('TOKEN')) return json_({ ok: false, error: 'رمز المزامنة غير صحيح' });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const h = handoff_(req);
    if (h) return json_(h);
    const ss = ss_();
    const sh = ss.getSheetByName('appointments');
    switch (req.action) {
      case 'ping':
        return json_({ ok: true, clinic: CLINIC_NAME });
      case 'push':
        return json_({ ok: true, accepted: upsert_(sh, req.rows || [], 'clinic') });
      case 'pull': {
        // re-send the last 2 minutes as well: the phone page writes under its own lock
        const since = Number(req.since || 0);
        let cursor = since;
        const rows = readAll_(sh, A_COLS).filter(o => Number(o.srv_ts || 0) > since - 120000).map(o => {
          cursor = Math.max(cursor, Number(o.srv_ts));
          delete o._row;
          return o;
        });
        return json_({ ok: true, rows: rows, cursor: cursor });
      }
      case 'patients': {
        const ps = ss.getSheetByName('patients');
        const rows = (req.rows || []).map(r => P_COLS.map((c, i) => r[i] === null || r[i] === undefined ? '' : String(r[i])));
        if (ps.getLastRow() > 1) ps.getRange(2, 1, ps.getLastRow() - 1, P_COLS.length).clearContent();
        if (rows.length) {
          if (ps.getMaxRows() < rows.length + 1) ps.insertRowsAfter(ps.getMaxRows(), rows.length + 1 - ps.getMaxRows());
          ps.getRange(2, 1, rows.length, P_COLS.length).setNumberFormat('@').setValues(rows);
        }
        return json_({ ok: true, count: rows.length });
      }
      case 'config': {   // doctor colours / order for the phone page (from the clinic program's Settings)
        let cs = ss.getSheetByName('config');
        if (!cs) cs = ss.insertSheet('config');
        cs.getRange(1, 1, 3, 2).setNumberFormat('@').setValues([['doctors', JSON.stringify(req.doctors || [])], ['default', req.default_doctor || ''], ['prayers', JSON.stringify(req.prayers || {})]]);
        return json_({ ok: true });
      }
      case 'backup': {
        const folder = DriveApp.getFolderById(prop_('BACKUP_FOLDER'));
        const blob = Utilities.newBlob(Utilities.base64Decode(req.data), 'application/octet-stream', req.name || 'clinic.db');
        folder.createFile(blob);
        const files = [];
        const it = folder.getFiles();
        while (it.hasNext()) files.push(it.next());
        files.sort((x, y) => y.getDateCreated() - x.getDateCreated());
        files.slice(KEEP_BACKUPS).forEach(f => f.setTrashed(true));
        return json_({ ok: true, name: req.name });
      }
      default:
        return json_({ ok: false, error: 'إجراء غير معروف' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// ------------------------------------------------------------------ mobile page (open to anyone who has the link; appointments only)
function doGet(e) {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('مواعيد العيادة')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function role_() {
  if (!prop_('SHEET_ID')) throw new Error('لم يُشغَّل setup بعد');
  let me = '';
  try { me = (Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) { }
  return { me: me || 'mobile', edit: true, ss: ss_() };
}

// doctors [code, label, row colour, text colour] in the clinic program's order (sent by the program, sheet "config")
function docs_(ss) {
  try {
    const cs = ss.getSheetByName('config');
    if (cs) { const v = cs.getRange(1, 2).getValue(); const d = JSON.parse(v || '[]'); if (d.length) return d; }
  } catch (e) { }
  return null;
}
// prayer rows of one day, sent by the clinic program (sheet "config", row 3): [{label, time, end}]
function prayers_(ss, date) {
  try {
    const cs = ss.getSheetByName('config');
    if (!cs || cs.getLastRow() < 3) return [];
    const all = JSON.parse(cs.getRange(3, 2).getValue() || '{}');
    return (all[date] || []).map(p => ({ label: p[0], time: p[1], end: p[2] }));
  } catch (e) { return []; }
}
function apiPrayers(date) { return prayers_(role_().ss, date); }
function defDoc_(ss) {   // default doctor for a new appointment
  try { const cs = ss.getSheetByName('config'); return cs && cs.getLastRow() >= 2 ? String(cs.getRange(2, 2).getValue() || '') : ''; } catch (e) { return ''; }
}
// by doctor (in the doctors' order; no doctor last), then by time
function listFor_(ss, date, docs) {
  const order = (docs || docs_(ss) || []).map(d => d[0]);
  const idx = c => !c ? 999 : (order.indexOf(c) < 0 ? 900 : order.indexOf(c));
  return readAll_(ss.getSheetByName('appointments'), A_COLS)
    .filter(o => o.date === date && String(o.deleted) !== '1')
    .map(o => { delete o._row; return o; })
    .sort((x, y) => (idx(x.doctor) - idx(y.doctor)) || String(x.doctor || '').localeCompare(String(y.doctor || ''))
      || (x.time || '99:99').localeCompare(y.time || '99:99'));
}

function apiInit(date) {
  const r = role_();
  const docs = docs_(r.ss);
  return { me: r.me, edit: r.edit, clinic: CLINIC_NAME, docs: docs, def_doc: defDoc_(r.ss), prayers: prayers_(r.ss, date), appts: listFor_(r.ss, date, docs) };
}
function apiList(date) {
  const r = role_();
  return listFor_(r.ss, date);
}
// name suggestions: searched on the server, at most 7 matches (the full patient list never leaves Google)
function norm_(s) { return String(s || '').trim().replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' '); }
function apiSearch(q) {
  q = norm_(q);
  if (q.length < 2) return [];
  const r = role_();
  const ps = r.ss.getSheetByName('patients');
  const n = ps.getLastRow();
  if (n < 2) return [];
  const words = q.split(' ');
  const out = [];
  const rows = ps.getRange(2, 1, n - 1, P_COLS.length).getValues();
  for (let i = 0; i < rows.length && out.length < 7; i++) {
    const nm = norm_(rows[i][1]);
    if (words.every(w => nm.indexOf(w) >= 0)) out.push(rows[i].map(x => cell_(x)));
  }
  return out;
}
function apiSave(o) {
  const r = role_();
  if (!r.edit) throw new Error('حسابك للمشاهدة فقط');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const row = clean_(o);
    if (!row.uid) row.uid = Utilities.getUuid().replace(/-/g, '');
    row.updated_at = Date.now();
    row.deleted = row.deleted === 1 || row.deleted === '1' ? '1' : '0';
    upsert_(r.ss.getSheetByName('appointments'), [row], r.me);
  } finally { lock.releaseLock(); }
  return listFor_(r.ss, o.date);
}
function apiDelete(uid, date) {
  const r = role_();
  if (!r.edit) throw new Error('حسابك للمشاهدة فقط');
  const sh = r.ss.getSheetByName('appointments');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ex = readAll_(sh, A_COLS).filter(x => x.uid === uid)[0];
    if (ex) {
      ex.deleted = '1';
      ex.updated_at = Date.now();
      upsert_(sh, [ex], r.me);
    }
  } finally { lock.releaseLock(); }
  return listFor_(r.ss, date);
}
