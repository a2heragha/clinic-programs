'use strict';
/* Clinic app — browser UI. No external libraries; works offline.
   Dr. Muhannad Younis copy: runs on the clinic PC or inside the phone app (Android), in turn. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const norm = s => String(s || '').trim().replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/[ً-ْـ]/g, '').replace(/\s+/g, ' ').toLowerCase();
// amounts are typed and shown in thousands, exactly as entered (50 = fifty thousand) — no extra zeros
const money = v => (v == null || v === '' || isNaN(v)) ? '' : (Math.round(Number(v) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
const moneyD = v => money(v || 0);
const numOrEmpty = v => (v == null ? '' : (Number.isInteger(v) ? String(v) : String(+Number(v).toFixed(3))));
// amounts with a separator every 3 digits (expenses, labs): 1250 → 1,250 ; the commas are removed before saving
const numSep = v => { const t = cleanNum(v); if (t === '' || isNaN(Number(t))) return String(v == null ? '' : v); const [i, d] = t.split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : ''); };
const cleanNum = v => String(v || '').trim().replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/,/g, '');

// inside the Android app the page gets window.ClinicApp (print, close, open links)
const IS_APP = !!window.ClinicApp;
if (IS_APP) document.body.classList.add('phone');

let LISTS = { doctors: [], work_types: [], areas: [], p_factors: [] };
let EXP_LISTS = { items: [], offices: [] };
let LAB_LISTS = [];
let RX = {};
const TEETH = (() => { const o = []; for (const q of ['UR', 'UL', 'LR', 'LL']) { for (let i = 1; i <= 8; i++) o.push(q + i); for (const c of 'ABCDE') o.push(q + c); } return o; })();
const RELATIONS = ['Father', 'Mother', 'Son', 'Daughter', 'Husband', 'Wife', 'Brother', 'Sister', 'Grandfather', 'Grandmother', 'Grandchild', 'Relative'];
const INVERSE = { Father: 'Child', Mother: 'Child', Son: 'Parent', Daughter: 'Parent', Husband: 'Wife', Wife: 'Husband', Brother: 'Sibling', Sister: 'Sibling',
  Grandfather: 'Grandchild', Grandmother: 'Grandchild', Grandchild: 'Grandparent', Relative: 'Relative' };

/* ------------------------------------------------------------ keyboard language per field
   Windows does not let a web page switch the keyboard language, so the program converts
   the physical key pressed into the right character: data-lang="ar" fields always type
   Arabic (Arabic 101 layout), data-lang="en" fields always type English (US layout).
   data-lang="en+" fields start in English and Alt+Shift (or Ctrl+Shift) switches them to Arabic and back.
   On the phone the on-screen keyboard sends no key codes, so nothing is converted there. */
const AR = {
  Backquote: ['ذ', 'ّ'], KeyQ: ['ض', 'َ'], KeyW: ['ص', 'ً'], KeyE: ['ث', 'ُ'], KeyR: ['ق', 'ٌ'], KeyT: ['ف', 'لإ'], KeyY: ['غ', 'إ'],
  KeyU: ['ع', '‘'], KeyI: ['ه', '÷'], KeyO: ['خ', '×'], KeyP: ['ح', '؛'], BracketLeft: ['ج', '<'], BracketRight: ['د', '>'], Backslash: ['\\', '|'],
  KeyA: ['ش', 'ِ'], KeyS: ['س', 'ٍ'], KeyD: ['ي', ']'], KeyF: ['ب', '['], KeyG: ['ل', 'لأ'], KeyH: ['ا', 'أ'], KeyJ: ['ت', 'ـ'],
  KeyK: ['ن', '،'], KeyL: ['م', '/'], Semicolon: ['ك', ':'], Quote: ['ط', '"'],
  KeyZ: ['ئ', '~'], KeyX: ['ء', 'ْ'], KeyC: ['ؤ', '}'], KeyV: ['ر', '{'], KeyB: ['لا', 'لآ'], KeyN: ['ى', 'آ'], KeyM: ['ة', '’'],
  Comma: ['و', ','], Period: ['ز', '.'], Slash: ['ظ', '؟'],
};
const EN = { Backquote: ['`', '~'], Minus: ['-', '_'], Equal: ['=', '+'], BracketLeft: ['[', '{'], BracketRight: [']', '}'], Backslash: ['\\', '|'],
  Semicolon: [';', ':'], Quote: ["'", '"'], Comma: [',', '<'], Period: ['.', '>'], Slash: ['/', '?'] };
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') EN['Key' + c] = [c.toLowerCase(), c];

function langBadge(t) {
  t.classList.toggle('lang-ar', t.dataset.cur === 'ar');
  toast(t.dataset.cur === 'ar' ? 'الكتابة: عربي' : 'الكتابة: إنكليزي');
}
document.addEventListener('focusin', e => { const t = e.target; if (t && t.dataset && t.dataset.lang === 'en+') { delete t.dataset.cur; t.classList.remove('lang-ar'); } }, true);
document.addEventListener('keydown', e => {
  const t0 = e.target;
  // Alt+Shift / Ctrl+Shift in a switchable field: English ⇄ Arabic
  if (t0 && t0.dataset && t0.dataset.lang === 'en+' && ((e.key === 'Shift' && (e.altKey || e.ctrlKey)) || ((e.key === 'Alt' || e.key === 'Control') && e.shiftKey))) {
    t0.dataset.cur = t0.dataset.cur === 'ar' ? 'en' : 'ar'; langBadge(t0); return;
  }
}, true);
document.addEventListener('keydown', e => {
  const t = e.target;
  let lang = t && t.dataset && t.dataset.lang;
  if (lang === 'en+') lang = t.dataset.cur === 'ar' ? 'ar' : 'en';
  if (!lang || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
  const map = lang === 'ar' ? AR : EN;
  const pair = map[e.code];
  if (!pair) return;
  let shift = e.shiftKey;
  if (lang === 'en' && e.code.startsWith('Key') && e.getModifierState && e.getModifierState('CapsLock')) shift = !shift;
  const ch = pair[shift ? 1 : 0];
  if (e.key === ch) return;                 // keyboard already in the right language
  e.preventDefault();
  if (!document.execCommand('insertText', false, ch)) {
    const s = t.selectionStart, en = t.selectionEnd;
    t.setRangeText(ch, s, en, 'end');
    t.dispatchEvent(new Event('input', { bubbles: true }));
  }
}, true);

/* ------------------------------------------------------------ API + save queue */
class HttpError extends Error { }
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json(); } catch (e) { }
  if (!r.ok) { const e = new HttpError((data && data.error) || ('Error ' + r.status)); e.status = r.status; if (r.status === 423) pcPoll(); throw e; }
  return data;
}

const Q = { items: [], running: false, failing: false, after: [] };
function enqueue(fn, onDone) {
  Q.items.push({ fn, onDone });
  netState();
  runQueue();
}
async function runQueue() {
  if (Q.running) return;
  Q.running = true;
  while (Q.items.length) {
    const it = Q.items[0];
    try {
      await it.fn();
      Q.items.shift();
      Q.failing = false;
      if (it.onDone) try { it.onDone(); } catch (e) { console.error(e); }
    } catch (e) {
      if (e instanceof HttpError) { Q.items.shift(); toast(e.message, true); }
      else { Q.failing = true; netState(); await sleep(3000); }
    }
    netState();
  }
  Q.running = false;
  netState();
  const cbs = Q.after.splice(0);
  cbs.forEach(f => f());
}
function whenSaved(fn) { if (!Q.items.length && !Q.running) fn(); else Q.after.push(fn); }
function netState() {
  const el = $('#net');
  if (Q.failing) { el.className = 'net bad'; el.textContent = '● انقطع الاتصال — ' + Q.items.length + ' غير محفوظ — إعادة المحاولة'; }
  else if (Q.items.length) { el.className = 'net busy'; el.textContent = '● جارٍ الحفظ…'; }
  else { el.className = 'net ok'; el.textContent = '● محفوظ'; }
}
window.addEventListener('beforeunload', e => { if (Q.items.length) { e.preventDefault(); e.returnValue = ''; } });

let toastT;
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), err ? 5000 : 2500);
}

async function loadLists() { LISTS = await api('GET', '/api/lists'); buildDocStyle(); applyProfile(); }
// per-clinic look: title in the top bar, Google sync on/off
function applyProfile() {
  const pr = LISTS.profile || {};
  let br = $('.top .brand');
  if (pr.app_title) {
    if (!br) { br = document.createElement('div'); br.className = 'brand'; $('.top').prepend(br); }
    br.textContent = '🦷 ' + pr.app_title; document.title = pr.app_title;
  } else if (br) br.remove();
  document.body.classList.toggle('no-cloud', pr.cloud === false);
}
async function refreshBadge() {
  try { const s = await api('GET', '/api/status'); const b = $('#dupBadge'); if (s.pending_dups) { b.textContent = s.pending_dups; b.classList.remove('hidden'); } else b.classList.add('hidden'); } catch (e) { }
}

/* ------------------------------------------------------------ combobox (search + autocomplete) */
const COMBO = { input: null, items: [], sel: -1 };
function comboOptions(kind) {
  if (kind === 'doctor') return LISTS.doctors.filter(d => d.active).map(d => d.name);
  if (kind === 'work_type') return LISTS.work_types.filter(d => d.active).map(d => d.name);
  if (kind === 'area') return LISTS.areas.map(d => d.name);
  if (kind === 'p_factor') return LISTS.p_factors.map(d => d.name);
  if (kind === 'tooth') return TEETH;
  if (kind === 'relation') return RELATIONS;
  if (kind === 'exp_item') return EXP_LISTS.items;
  if (kind === 'exp_office') return EXP_LISTS.offices;
  if (kind === 'lab') return LAB_LISTS;
  if (kind === 'rx_drug') return RX.drugs || [];
  return [];
}
function comboAllKnown(kind) {
  if (kind === 'doctor') return LISTS.doctors.map(d => d.name);
  if (kind === 'work_type') return LISTS.work_types.map(d => d.name);
  return comboOptions(kind);
}
function comboFilter(kind, text) {
  const opts = comboOptions(kind), t = norm(text);
  if (!t) return opts.slice(0, 60);
  const a = [], b = [];
  for (const o of opts) { const n = norm(o); if (n.startsWith(t)) a.push(o); else if (n.includes(t)) b.push(o); }
  return a.concat(b).slice(0, 60);
}
function comboShow(input) {
  const kind = input.dataset.combo;
  COMBO.input = input;
  COMBO.items = comboFilter(kind, input.value);
  COMBO.sel = input.value.trim() && COMBO.items.length ? 0 : -1;
  const box = $('#combo');
  if (!COMBO.items.length) { box.classList.add('hidden'); return; }
  box.innerHTML = COMBO.items.map((o, i) => `<div class="it${i === COMBO.sel ? ' sel' : ''}" data-i="${i}" dir="auto">${esc(o)}</div>`).join('');
  const r = input.getBoundingClientRect();
  box.style.top = (r.bottom + 2) + 'px';
  box.style.left = r.left + 'px';
  box.style.minWidth = Math.max(r.width, 140) + 'px';
  box.classList.remove('hidden');
  const selEl = box.querySelector('.sel'); if (selEl) selEl.scrollIntoView({ block: 'nearest' });
}
function comboHide() { $('#combo').classList.add('hidden'); COMBO.input = null; }
function comboChoose(i) {
  const input = COMBO.input; if (!input || i < 0) return;
  input.value = COMBO.items[i];
  comboHide();
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
$('#combo').addEventListener('mousedown', e => { e.preventDefault(); const it = e.target.closest('.it'); if (it) comboChoose(+it.dataset.i); });
// the list opens only when typing (or ArrowDown), not on focus — so it never covers the screen
document.addEventListener('focusin', e => { const t = e.target; if (t.dataset && t.dataset.combo) { t.dataset.prev = t.value; comboHide(); } });
document.addEventListener('focusout', e => { if (e.target === COMBO.input) comboHide(); });
document.addEventListener('input', e => { const t = e.target; if (t.dataset && t.dataset.combo) comboShow(t); }, true);
document.addEventListener('keydown', e => {
  const t = e.target; if (!(t.dataset && t.dataset.combo)) return;
  const box = $('#combo'), open = !box.classList.contains('hidden') && COMBO.input === t;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!open) { comboShow(t); e.preventDefault(); return; }
    e.preventDefault();
    COMBO.sel = Math.max(0, Math.min(COMBO.items.length - 1, COMBO.sel + (e.key === 'ArrowDown' ? 1 : -1)));
    $$('.it', box).forEach((el, i) => el.classList.toggle('sel', i === COMBO.sel));
    const s = box.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    if (open && COMBO.sel >= 0) { e.preventDefault(); comboChoose(COMBO.sel); }
  } else if (e.key === 'Tab') {
    if (open && COMBO.sel >= 0 && t.value.trim() && norm(t.value) !== norm(COMBO.items[COMBO.sel]) &&
      !comboOptions(t.dataset.combo).some(o => norm(o) === norm(t.value))) {
      t.value = COMBO.items[COMBO.sel];
    }
    comboHide();
  } else if (e.key === 'Escape') { comboHide(); }
}, true);
// Managed lists (doctors, work types): the value must come from the list
document.addEventListener('change', e => {
  const t = e.target; if (!(t.dataset && t.dataset.combo && t.dataset.strict)) return;
  const v = t.value.trim(); if (!v) return;
  const kind = t.dataset.combo;
  const exact = comboAllKnown(kind).find(o => norm(o) === norm(v));
  if (exact) { t.value = exact; return; }
  const m = comboFilter(kind, v);
  if (m.length) { t.value = m[0]; return; }
  toast('"' + v + '" is not in the list — add it from Settings', true);
  t.value = t.dataset.prev || '';
  if (t.value === (t.dataset.prev || '')) e.stopImmediatePropagation();
}, true);

/* ------------------------------------------------------------ top search */
const qi = $('#q'), qres = $('#qres');
let qT, qSel = -1, qItems = [];
async function doSearch() {
  const q = qi.value;
  try {
    qItems = await api('GET', '/api/search?q=' + encodeURIComponent(q));
  } catch (e) { return; }
  qSel = qItems.length ? 0 : -1;
  // fixed right-to-left columns: name · age · area (same place on every row)
  qres.innerHTML = qItems.length ? qItems.map((p, i) => { const ag = ageOf(p.dob); return `<div class="it qrow${i === qSel ? ' sel' : ''}" data-id="${p.id}">
      <b class="qn">${esc(p.name)}</b><span class="qa">${ag != null ? ag + ' سنة' : ''}</span><span class="qr">${esc(p.area || '')}</span></div>`; }).join('')
    : '<div class="empty" dir="rtl">لا توجد نتائج</div>';
  qres.classList.remove('hidden');
}
qi.addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(doSearch, 120); });
qi.addEventListener('focus', () => doSearch());
qi.addEventListener('blur', () => setTimeout(() => qres.classList.add('hidden'), 150));
qi.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); qSel = Math.max(0, Math.min(qItems.length - 1, qSel + (e.key === 'ArrowDown' ? 1 : -1)));
    $$('.it', qres).forEach((el, i) => el.classList.toggle('sel', i === qSel));
    const s = qres.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && qSel >= 0) {
    e.preventDefault(); openPatient(qItems[qSel].id);
  } else if (e.key === 'Escape') { qi.blur(); }
});
qres.addEventListener('mousedown', e => { const it = e.target.closest('.it'); if (it) { e.preventDefault(); openPatient(+it.dataset.id); } });
function openPatient(id) { qi.value = ''; qres.classList.add('hidden'); qi.blur(); location.hash = '#/p/' + id; }
document.addEventListener('keydown', e => {
  if (e.key === 'F2' || (e.ctrlKey && (e.key === 'k' || e.key === 'K' || e.key === 'f' || e.key === 'F'))) { e.preventDefault(); qi.focus(); qi.select(); }
});
$$('[data-go]').forEach(b => b.addEventListener('click', () => { if (location.hash === b.dataset.go) route(); else location.hash = b.dataset.go; }));

/* ------------------------------------------------------------ router */
const view = $('#view');
async function route() {
  closePrivateNote(true);
  if (typeof endTour === 'function') endTour();
  const h = location.hash || '#/';
  const m = h.match(/^#\/p\/(\d+)/);
  try {
    if (m) await renderPatient(+m[1]);
    else if (h.startsWith('#/new')) await renderNew();
    else if (h === '#/debts') await renderDebts();
    else if (h.startsWith('#/report')) await renderReport();
    else if (h === '#/review') await renderReview();
    else if (h === '#/settings') await renderSettings();
    else if (h.startsWith('#/income')) { location.hash = '#/report'; return; }
    else if (h.startsWith('#/expenses')) await renderExpenses();
    else if (h.startsWith('#/labs')) await renderLabs();
    else if (/^#\/rx\/\d+/.test(h)) await renderRx(+h.match(/^#\/rx\/(\d+)/)[1]);
    else await renderToday();
  } catch (e) {
    view.innerHTML = `<div class="card"><b>تعذر التحميل:</b> ${esc(e.message)}<br><button onclick="route()">إعادة المحاولة</button></div>`;
  }
}
window.addEventListener('hashchange', route);

/* ------------------------------------------------------------ today: appointments (entered by the secretary) */
let APPT_T;
async function renderToday() {
  clearInterval(APPT_T);
  const prm = new URLSearchParams((location.hash.split('?')[1]) || '');
  const date = prm.get('date') || todayISO();
  const [rows, prs] = await Promise.all([api('GET', '/api/appts?date=' + date), api('GET', '/api/prayers?date=' + date).catch(() => [])]);
  PRAYERS = prs || [];
  const isToday = date === todayISO();
  view.innerHTML = `<div class="card ar" dir="rtl">
    <div class="whead">
      <b>${isToday ? 'مواعيد اليوم' : 'المواعيد'}</b>
      <button class="small" id="dPrev" title="اليوم السابق">▶</button>
      <input type="date" id="dSel" value="${date}" class="dsel">
      <button class="small primary" id="dPick" title="اختر تاريخاً لحجز المواعيد">📅 اختيار تاريخ</button>
      <button class="small" id="dNext" title="اليوم التالي">◀</button>
      ${isToday ? '' : '<button class="small" id="dToday">اليوم</button>'}
      <span class="muted">${new Date(date + 'T00:00').toLocaleDateString('ar-IQ', { weekday: 'long' })}</span>
      <div class="totals" id="apCount"></div>
      <button class="small" id="apSave" title="تُحفظ المواعيد تلقائياً، وهذا الزر يؤكد الحفظ">💾 حفظ</button>
      <button class="small primary" id="apCloud" title="رفع المواعيد ونسخة كاملة إلى Google قبل إطفاء الجهاز">☁ مزامنة قبل المغادرة</button>
    </div>
    <div class="appt-scroll"><table class="grid appt" id="appts">
      <colgroup><col style="width:34px"><col style="width:108px"><col style="width:92px"><col><col style="width:52px"><col style="width:200px"><col style="width:9%"><col style="width:9%"><col style="width:11%"><col style="width:186px"><col style="width:28px"></colgroup>
      <thead><tr><th>#</th><th>الوقت</th><th>الطبيب</th><th>اسم المريض</th><th>العمر</th><th>الهاتف</th><th>السكن</th><th>نوع العمل</th><th>ملاحظة</th><th>الحالة</th><th></th></tr></thead>
      <tbody></tbody>
    </table></div>
  </div>`;
  const go = d => { location.hash = '#/today?date=' + d; };
  const shift = n => { const d = new Date(date + 'T00:00'); d.setDate(d.getDate() + n); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); go(d.toISOString().slice(0, 10)); };
  $('#dPrev').addEventListener('click', () => shift(-1));
  $('#dNext').addEventListener('click', () => shift(1));
  $('#dSel').addEventListener('change', e => e.target.value && go(e.target.value));
  if ($('#dToday')) $('#dToday').addEventListener('click', () => go(todayISO()));
  $('#dPick').addEventListener('click', () => { const d = $('#dSel'); try { d.showPicker(); } catch (e) { d.focus(); d.click(); } });
  $('#apCloud').addEventListener('click', () => cloudNow(true));
  $('#apSave').addEventListener('click', () => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // commit the field being typed
    whenSaved(() => toast('تم حفظ المواعيد ✓'));
    if (Q.failing) toast('الشبكة مقطوعة — ستُحفظ تلقائياً عند عودتها', true);
  });
  const tb = $('#appts tbody');
  rows.forEach((a, k) => tb.appendChild(apptRow(a, date, k + 1)));
  tb.appendChild(apptRow(null, date));
  apptResort(tb);
  apptCount();
  // the doctor's PC sees what the secretary adds
  // merges in place: new / changed / deleted rows (from the other PC or the phone) appear even while
  // the cursor is in the table; only the row being edited is left untouched
  const refresh = async () => {
    if (!$('#appts')) { clearInterval(APPT_T); return; }
    if (Q.items.length) return;   // unsaved local edits first
    try {
      const fresh = await api('GET', '/api/appts?date=' + date);
      if (!$('#appts') || JSON.stringify(fresh) === JSON.stringify(rows)) return;
      const ae = document.activeElement;
      const busyTr = ae && ae.closest ? ae.closest('#appts tbody tr') : null;
      const byId = new Map(fresh.map(x => [x.id, x]));
      $$('tr', tb).forEach(t => { if (t._a && t._a.id && !byId.has(t._a.id) && t !== busyTr) t.remove(); });
      const have = new Map($$('tr', tb).filter(t => t._a && t._a.id).map(t => [t._a.id, t]));
      const nr = tb.querySelector('tr.newrow');
      fresh.forEach(x => {
        const t = have.get(x.id);
        if (!t) tb.insertBefore(apptRow(x, date), nr);
        else if (t !== busyTr && (String(t._a.updated_at) !== String(x.updated_at) || t._a.status !== x.status)) tb.replaceChild(apptRow(x, date), t);
      });
      rows.length = 0; fresh.forEach(x => rows.push(x));
      apptResort(tb);
      apptCount();
    } catch (e) { }
  };
  APPT_T = setInterval(refresh, 10000);
}
// prayer times of the shown day (Settings → أوقات الصلاة): each one is a row in every doctor's list, at its time
let PRAYERS = [];
const t12 = t => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return (h > 12 ? h - 12 : h) + ':' + String(m).padStart(2, '0'); };
const prayerAt = time => time ? PRAYERS.find(p => time >= p.time && time < p.end) : null;
function prayerRow(p) {
  const tr = document.createElement('tr');
  tr.className = 'prayer-row'; tr._p = p;
  tr.innerHTML = `<td class="num-col">🕌</td><td colspan="10"><b>${esc(p.label)}</b> <span dir="ltr">${t12(p.time)} – ${t12(p.end)}</span> <small>(الأذان ${t12(p.at)})</small></td>`;
  return tr;
}
function apptResort(tb) {
  if (!tb) return;
  const cur = $$('tr', tb).filter(t => (t._a && t._a.id) || t._p);
  const appts = cur.filter(t => t._a).sort((x, y) => apptCmp(x._a, y._a));
  // the prayer rows go into each doctor's group (or once, when the day has no appointments yet)
  const old = new Map(cur.filter(t => t._p).map(t => [t._pk, t]));
  const want = [];
  const groups = [];
  appts.forEach(t => { const g = t._a.doctor || ''; if (!groups.length || groups[groups.length - 1].g !== g) groups.push({ g, rows: [] }); groups[groups.length - 1].rows.push(t); });
  if (!groups.length) groups.push({ g: '', rows: [] });
  // a prayer shows in a doctor's list only when it falls inside his working span (an appointment before its end
  // and one after its start), so a day with several doctors is not filled with prayer rows
  const single = groups.length === 1 && !groups[0].rows.some(t => t._a.time);
  groups.forEach(({ g, rows }) => {
    const times = rows.map(t => t._a.time).filter(Boolean);
    const inSpan = p => single || (times.some(t => t < p.end) && times.some(t => t >= p.time));
    const ps = PRAYERS.filter(inSpan).map(p => { const k = g + '|' + p.key; const r = old.get(k) || prayerRow(p); r._pk = k; old.delete(k); return r; });
    let i = 0;
    rows.forEach(t => { const tm = t._a.time || '99:99'; while (i < ps.length && ps[i]._p.time <= tm) want.push(ps[i++]); want.push(t); });
    while (i < ps.length) want.push(ps[i++]);
  });
  old.forEach(r => r.remove());
  const nr = tb.querySelector('tr.newrow');
  const now = $$('tr', tb).filter(t => (t._a && t._a.id) || t._p);
  if (want.some((t, i) => t !== now[i])) want.forEach(t => tb.insertBefore(t, nr));
  appts.forEach((t, i) => { const c = $('td.num-col', t); if (c) c.textContent = i + 1; });
}
function apptCount() {
  const trs = $$('#appts tbody tr').filter(t => t._a && t._a.id);
  const c = st => trs.filter(t => t._a.status === st).length;
  $('#apCount').innerHTML = `<span>المجموع <b>${trs.length - c('cancelled')}</b></span><span>حضر <b>${c('arrived') + c('done')}</b></span><span>تأجيل <b>${c('noshow')}</b></span><span>ألغى <b>${c('cancelled')}</b></span>` +
    apptDoctors().map(n => { const k = trs.filter(t => t._a.doctor === n && t._a.status !== 'cancelled').length; const ds = docStyle(n); return k ? `<span class="doc-chip" style="background:${ds.bg};color:${ds.fg}">${esc(ds.label)} <b>${k}</b></span>` : ''; }).join('');
}
// statuses: حضر / تأجيل (code noshow) / ألغى — any of them turns the row the same "closed" colour for every doctor
const APPT_ST = [['arrived', 'حضر'], ['noshow', 'تأجيل'], ['cancelled', 'ألغى']];
const stOf = s => s === 'done' ? 'arrived' : (s || '');
// each doctor has his own row colour on the appointments page (same colours on both phone pages).
// the server sends [code, label, row colour, text colour] for the active doctors, in the order used to sort
// the appointments; the row colour can be changed per doctor in Settings
let DOC_STYLE = {}, DOC_ORDER = [];
function buildDocStyle() {
  DOC_STYLE = {}; DOC_ORDER = [];
  (LISTS.doc_styles || []).forEach(([c, label, bg, fg]) => { DOC_STYLE[c] = [label, bg, fg]; DOC_ORDER.push(c); });
}
function docStyle(name) {
  if (!name) return null;
  if (DOC_STYLE[name]) return { label: DOC_STYLE[name][0], bg: DOC_STYLE[name][1], fg: DOC_STYLE[name][2] };
  return { label: name, bg: '#e6ebf1', fg: '#3d4b5c' };   // a doctor no longer active
}
function apptDoctors() { return DOC_ORDER.slice(); }
// default doctor (Settings → Doctors → Default): filled in every new work, appointment, lab work and expense
const defDoc = () => { const d = (LISTS.profile || {}).default_doctor || ''; return LISTS.doctors.some(x => x.name === d && x.active) ? d : ''; };
// appointments: by doctor (in the doctors' order; no doctor last), then by time
function apptCmp(x, y) {
  const i = d => d ? (DOC_ORDER.includes(d) ? DOC_ORDER.indexOf(d) : 900) : 999;
  return (i(x.doctor) - i(y.doctor)) || String(x.doctor || '').localeCompare(String(y.doctor || ''))
    || (x.time || '99:99').localeCompare(y.time || '99:99') || ((x.id || 0) - (y.id || 0));
}
// phone → call / WhatsApp (Iraqi 07xx… becomes 9647xx… for WhatsApp)
function intlPhone(p) {
  let d = String(p || '').replace(/[^\d]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 11) d = '964' + d.slice(1);
  else if (d.length === 10 && d.startsWith('7')) d = '964' + d;
  return d;
}
function phonesOf(p) {   // one or more numbers in one field ("0770… 0750…", "0770…/0750…", "0770 123 4567")
  const out = []; let cur = '';
  const need = d => d.startsWith('00964') ? 15 : d.startsWith('964') ? 13 : d.startsWith('07') ? 11 : 99;
  for (const t of String(p || '').match(/\+?\d+/g) || []) {
    cur += t;
    let d = cur.replace(/\D/g, '');
    while (d.length >= need(d)) { const n = need(d); out.push((cur.startsWith('+') ? '+' : '') + d.slice(0, n)); d = d.slice(n); cur = d; }
  }
  if (cur.replace(/\D/g, '').length >= 6) out.push(cur);
  return out;
}
function phoneMenu(phone, anchor) {
  $$('.ph-menu').forEach(x => x.remove());
  const nums = phonesOf(phone);
  if (!nums.length) { toast('لا يوجد رقم هاتف صحيح', true); return; }
  const m = document.createElement('div'); m.className = 'dropdown ph-menu'; m.dir = 'rtl';
  m.innerHTML = nums.map(n => { const intl = intlPhone(n); return `${nums.length > 1 ? `<div class="ph-num">${esc(n)}</div>` : ''}<a class="it" href="tel:${esc(n)}">📞 اتصال</a>
    <a class="it wa" href="https://wa.me/${esc(intl)}" target="_blank" rel="noopener">💬 رسالة واتساب</a>
    <a class="it wa" href="https://wa.me/${esc(intl)}" target="_blank" rel="noopener">📹 اتصال واتساب <small>(من داخل المحادثة)</small></a>`; }).join('');
  const r = anchor.getBoundingClientRect();
  m.style.top = (r.bottom + 2) + 'px'; m.style.left = Math.max(4, r.left - 120) + 'px';
  document.body.appendChild(m);
  const off = e => { if (!m.contains(e.target) || e.target.closest('a')) { setTimeout(() => m.remove(), 100); document.removeEventListener('mousedown', off, true); } };
  setTimeout(() => document.addEventListener('mousedown', off, true), 0);
}
function doctorOptions(cur) {
  const list = apptDoctors();
  if (cur && !list.includes(cur)) list.push(cur);
  return '<option value="">—</option>' + list.map(n => `<option value="${esc(n)}" ${n === cur ? 'selected' : ''}>${esc(docStyle(n).label)}</option>`).join('');
}
// time = hour (afternoon, 12…11) + quarter (00/15/30/45); stored as 24h "HH:MM"
function hourOptions(cur) {
  const h24 = cur ? parseInt(cur.split(':')[0], 10) : null;
  const hs = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
  if (h24 != null && !hs.includes(h24)) hs.unshift(h24);
  return '<option value=""></option>' + hs.map(h => `<option value="${h}" ${h === h24 ? 'selected' : ''}>${h > 12 ? h - 12 : h}</option>`).join('');
}
function quarterOptions(cur) {
  const m = cur ? cur.split(':')[1] : '00';
  const qs = ['00', '15', '30', '45'];
  if (m && !qs.includes(m)) qs.push(m);
  return qs.map(q => `<option value="${q}" ${q === m ? 'selected' : ''}>${q}</option>`).join('');
}
function apptRow(a, date, n) {
  const isNew = !a;
  a = a || { id: null, date, time: '', doctor: defDoc(), patient_id: null, name: '', work: '', note: '', status: '' };
  const tr = document.createElement('tr');
  tr._a = a;
  const paint = () => {
    const ds = docStyle(a.doctor), st = stOf(a.status), pr = prayerAt(a.time);
    tr.className = (isNew && !a.id ? 'newrow ' : '') + (st ? 'ap-' + st + ' ap-closed' : '') + (ds ? ' has-doc' : '') + (pr ? ' in-prayer' : '');
    tr.title = pr ? 'ضمن وقت ' + pr.label + ' (' + t12(pr.time) + ' – ' + t12(pr.end) + ')' : '';
    tr.style.setProperty('--docbg', ds ? ds.bg : '');
    tr.style.setProperty('--docfg', ds ? ds.fg : '');
  };
  paint();
  tr.innerHTML = `
    <td class="num-col">${isNew ? '+' : n}</td>
    <td><div class="tcell" dir="ltr"><select data-th class="tsel" title="الساعة">${hourOptions(a.time || '')}</select><span>:</span><select data-tm class="tsel tq" title="الدقائق">${quarterOptions(a.time || '')}</select><i class="pr-mark" title="ضمن وقت الصلاة">🕌</i></div></td>
    <td class="ap-doc"><select data-a="doctor" title="الطبيب">${doctorOptions(a.doctor || '')}</select></td>
    <td class="ap-name"><input data-a="name" data-lang="ar" dir="auto" autocomplete="off" value="${esc(a.name || a.pname || '')}"><span class="ap-link"></span></td>
    <td><input data-a="age" data-lang="en" inputmode="numeric" value="${esc(a.age || '')}" style="text-align:center"></td>
    <td class="ap-phone"><input data-a="phone" data-lang="en" dir="ltr" inputmode="tel" value="${esc(a.phone || a.pphone || '')}"><button class="ph-btn" tabindex="-1" title="اتصال / واتساب">📞</button></td>
    <td><input data-a="area" data-lang="ar" data-combo="area" dir="auto" value="${esc(a.area || '')}"></td>
    <td><input data-a="work" data-lang="en+" dir="auto" title="English — Alt+Shift للعربي" value="${esc(a.work || '')}"></td>
    <td><input data-a="note" data-lang="ar" dir="auto" value="${esc(a.note || '')}"></td>
    <td class="ap-stc"><div class="ap-st">${APPT_ST.map(([k, ar]) => `<button tabindex="-1" data-st="${k}" class="${stOf(a.status) === k ? 'on' : ''}">${ar}</button>`).join('')}</div></td>
    <td><button class="del" tabindex="-1" title="حذف">✕</button></td>`;
  const link = $('.ap-link', tr);
  const drawLink = () => {
    if (a.patient_id) link.innerHTML = `<a href="#/p/${a.patient_id}" title="فتح الملف" tabindex="-1">↗ الملف</a>`;
    else if ((a.name || '').trim()) link.innerHTML = `<a href="#/new?name=${encodeURIComponent(a.name)}&phone=${encodeURIComponent(a.phone || '')}&age=${encodeURIComponent(a.age || '')}&area=${encodeURIComponent(a.area || '')}&appt=${a.id || ''}" title="إنشاء ملف جديد لهذا المريض" tabindex="-1" class="newf">+ ملف جديد</a>`;
    else link.innerHTML = '';
  };
  drawLink();
  const save = fields => {
    if (!a.id && tr.classList.contains('newrow')) {
      tr.classList.remove('newrow');
      $('td.num-col', tr).textContent = '…';
      tr.parentNode.appendChild(apptRow(null, date));
    }
    tr.classList.add('unsaved');
    enqueue(async () => {
      if (!a.id) {
        const r = await api('POST', '/api/appt', { date, time: a.time, doctor: a.doctor || '', name: a.name, age: a.age, phone: a.phone, area: a.area, work: a.work, note: a.note, status: a.status, patient_id: a.patient_id });
        a.id = r.id;
      } else await api('PUT', '/api/appt/' + a.id, fields);
    }, () => { tr.classList.remove('unsaved'); drawLink(); apptCount(); if (tr.parentNode) { if (!tr.contains(document.activeElement)) apptResort(tr.parentNode); else $('td.num-col', tr).textContent = Array.from(tr.parentNode.children).indexOf(tr) + 1; } });
  };
  tr.addEventListener('change', e => {
    const t = e.target, k = t.dataset.a; if (!k) return;
    a[k] = t.value;
    if (k === 'doctor') paint();
    if (!a.id && !['time', 'doctor', 'name', 'age', 'phone', 'area', 'work', 'note'].some(f => (a[f] || '').trim())) return;
    const f = { [k]: t.value };
    if (k === 'name' && a._picked !== t.value) { a.patient_id = null; f.patient_id = null; }
    save(f);
    drawLink();
  });
  // time pickers
  const th = $('[data-th]', tr), tm = $('[data-tm]', tr);
  const timeChanged = () => {
    const h = th.value;
    a.time = h ? String(h).padStart(2, '0') + ':' + tm.value : '';
    paint();
    const pr = prayerAt(a.time);
    if (pr) toast('🕌 تنبيه: هذا الموعد ضمن وقت ' + pr.label + ' (' + t12(pr.time) + ' – ' + t12(pr.end) + ')', true);
    save({ time: a.time });
  };
  th.addEventListener('change', timeChanged);
  tm.addEventListener('change', () => { if (th.value) timeChanged(); });
  // patient name: suggestions from existing patients
  const ni = $('[data-a=name]', tr);
  let box = null, items = [], sel = 0, tmr;
  const close = () => { if (box) { box.remove(); box = null; } };
  const pick = p => {
    ni.value = p.name; a.name = p.name; a.patient_id = p.id; a._picked = p.name;
    const pi = $('[data-a=phone]', tr);
    if (p.phone && !pi.value.trim()) { pi.value = p.phone; a.phone = p.phone; }
    const ag = ageOf(p.dob), ai = $('[data-a=age]', tr), ri = $('[data-a=area]', tr);
    if (ag != null && !ai.value.trim()) { ai.value = ag; a.age = String(ag); }
    if (p.area && !ri.value.trim()) { ri.value = p.area; a.area = p.area; }
    close(); drawLink();
    save({ name: p.name, patient_id: p.id, phone: a.phone || '', age: a.age || '', area: a.area || '' });
  };
  // re-order (doctor, then time) as soon as the user leaves the row
  tr.addEventListener('focusout', e => {
    if (e.relatedTarget && tr.contains(e.relatedTarget)) return;
    setTimeout(() => apptResort(tr.parentNode), 0);
  });
  ni.addEventListener('input', () => {
    clearTimeout(tmr);
    tmr = setTimeout(async () => {
      const q = ni.value.trim(); if (q.length < 2) { close(); return; }
      items = await api('GET', '/api/search?q=' + encodeURIComponent(q));
      close(); if (!items.length) return;
      sel = 0;
      box = document.createElement('div'); box.className = 'dropdown combo';
      box.innerHTML = items.slice(0, 12).map((p, i) => `<div class="it${i === 0 ? ' sel' : ''}" data-i="${i}"><b dir="auto">${esc(p.name)}</b><small>${esc(p.dob || '')} · ${esc(p.phone || '')}</small></div>`).join('');
      const r = ni.getBoundingClientRect();
      box.style.top = (r.bottom + 2) + 'px'; box.style.left = r.left + 'px'; box.style.minWidth = r.width + 'px';
      box.addEventListener('mousedown', e => { e.preventDefault(); const it = e.target.closest('.it'); if (it) pick(items[+it.dataset.i]); });
      document.body.appendChild(box);
    }, 150);
  });
  ni.addEventListener('keydown', e => {
    if (!box) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); sel = Math.max(0, Math.min(Math.min(items.length, 12) - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
      $$('.it', box).forEach((el, i) => el.classList.toggle('sel', i === sel));
    } else if (e.key === 'Enter') { e.preventDefault(); pick(items[sel]); }
    else if (e.key === 'Escape') close();
  });
  ni.addEventListener('blur', () => setTimeout(close, 150));
  $$('[data-st]', tr).forEach(b => b.addEventListener('click', () => {
    a.status = stOf(a.status) === b.dataset.st ? '' : b.dataset.st;
    $$('[data-st]', tr).forEach(x => x.classList.toggle('on', x.dataset.st === a.status));
    paint();
    if (a.id) save({ status: a.status });
    apptCount();
  }));
  $('.ph-btn', tr).addEventListener('click', e => phoneMenu($('[data-a=phone]', tr).value, e.currentTarget));
  $('.del', tr).addEventListener('click', () => {
    if (!a.id) { $$('input', tr).forEach(i => i.value = ''); return; }
    if (!confirm('حذف هذا الموعد؟')) return;
    const id = a.id; tr.remove(); apptCount();
    enqueue(() => api('DELETE', '/api/appt/' + id));
  });
  return tr;
}

/* ------------------------------------------------------------ patient page */
let CUR = null;   // { patient, works, payments, family, totals }

const PAT_FIELDS = [
  // key, label, css class, attributes
  ['name', 'الاسم', 'w-name', 'data-lang="ar" dir="auto" class="pname"'],
  ['form_no', 'رقم الاستمارة', 'w-s', 'data-lang="en"'],
  ['dob', 'المواليد', 'w-s', 'data-lang="en"'],
  ['phone', 'الهاتف', 'w-m', 'data-lang="en"'],
  ['area', 'العنوان', 'w-m', 'data-lang="ar" dir="auto" data-combo="area"'],
  ['p_factor', 'P Factor', 'w-s', 'data-lang="en" data-combo="p_factor"'],
];

function patientHeaderHTML(p, isNew) {
  return `
  <div class="card pcard">
    <div class="prow">
      ${PAT_FIELDS.map(([k, label, cls, attr]) => `<label class="${cls}">${label}<input data-f="${k}" value="${esc(p[k] || '')}" ${attr}></label>`).join('')}
      ${isNew ? '' : `<button class="xray ${p.xray ? 'on' : ''}" id="xrayBtn" title="مسجّل في برنامج الأشعة؟">الأشعة ${p.xray ? '✓' : '✗'}</button>
      <button class="icon rxbtn" id="rxBtn" title="كتابة وصفة">℞</button>
      <button class="icon" id="exBtn" title="طباعة تعليمات ما بعد القلع">🦷</button>
      <button class="icon" id="copyNA" title="نسخ الاسم والعمر (ويفتح برنامج الأشعة)">📋</button>
      <button class="icon pn-btn" id="pnBtn" title="ملاحظة خاصة">🔒${p.private_note ? '<span class="dot"></span>' : ''}</button>
      <button class="icon danger" id="delPat" title="حذف المريض">🗑</button>`}
    </div>
    <div class="prow2">
      <label class="w-med">الامراض والحساسية والصعوبات<input data-f="medical" value="${esc(p.medical || '')}" data-lang="en+" dir="auto" title="English — Alt+Shift للعربي"></label>
      ${isNew ? '' : '<div class="famline" id="famLine"></div>'}
    </div>
    ${isNew ? '' : '<div id="linker" class="linker hidden"></div>'}
  </div>`;
}

async function renderNew() {
  CUR = null;
  const prm = new URLSearchParams((location.hash.split('?')[1]) || '');
  const preName = prm.get('name') || '', fromAppt = prm.get('appt') || '', prePhone = prm.get('phone') || '', preAge = prm.get('age') || '', preArea = prm.get('area') || '';
  const preDob = /^\d{1,3}$/.test(preAge) ? String(new Date().getFullYear() - +preAge) : '';
  let next = '';
  try { next = (await api('GET', '/api/next_form_no')).next; } catch (e) { }
  view.innerHTML = `<div class="card slim"><b>مريض جديد</b> <span class="muted">— اكتب الاسم ثم اضغط <kbd>Tab</kbd>، ويُنشأ الملف تلقائياً.</span></div>
    <div id="dupWarn"></div>` + patientHeaderHTML({ form_no: next, name: preName, phone: prePhone, dob: preDob, area: preArea }, true);
  const nameI = $('[data-f=name]', view);
  let creating = false, allowDup = false;
  const create = async focusAfter => {
    creating = true;
    const body = {}; $$('[data-f]', view).forEach(i => body[i.dataset.f] = i.value);
    try {
      const r = await api('POST', '/api/patient', body);
      if (fromAppt) await api('PUT', '/api/appt/' + fromAppt, { patient_id: r.id, name: body.name });
      history.replaceState(null, '', '#/p/' + r.id);
      await renderPatient(r.id, focusAfter);
      toast('أُنشئ ملف المريض');
    } catch (err) { creating = false; toast(err.message, true); }
  };
  const check = async () => {
    const name = nameI.value.trim(), phone = $('[data-f=phone]', view).value;
    if (!name) return true;
    const sim = await api('GET', '/api/similar?name=' + encodeURIComponent(name) + '&phone=' + encodeURIComponent(phone));
    if (!sim.length) { $('#dupWarn').innerHTML = ''; return true; }
    $('#dupWarn').innerHTML = `<div class="dupwarn"><b>⚠ قد يكون هذا المريض مسجّلاً:</b>
      <table class="list">${sim.map(p => `<tr class="click" data-id="${p.id}"><td dir="auto"><b>${esc(p.name)}</b></td><td>${esc(p.dob || '')}</td><td>${esc(p.phone || '')}</td><td dir="auto">${esc(p.area || '')}</td><td class="muted small">${esc(p.why)}</td><td><button class="small primary">فتح هذا الملف</button></td></tr>`).join('')}</table>
      <button id="dupNew" class="small">ليس أحدهم — أنشئ ملفاً جديداً</button></div>`;
    $$('#dupWarn tr.click').forEach(tr => tr.addEventListener('click', async () => {
      const id = tr.dataset.id;
      if (fromAppt) await api('PUT', '/api/appt/' + fromAppt, { patient_id: +id });
      location.hash = '#/p/' + id;
    }));
    $('#dupNew').addEventListener('click', () => { allowDup = true; $('#dupWarn').innerHTML = ''; create('dob'); });
    return false;
  };
  $('.pcard', view).addEventListener('change', async e => {
    const t = e.target; if (!t.dataset.f || creating) return;
    if (!nameI.value.trim()) return;
    if (!allowDup && !(await check())) return;
    create(t.dataset.f === 'name' ? 'dob' : t.dataset.f);
  });
  nameI.focus();
  if (preName && (await check())) create('dob');
}

async function renderPatient(id, focusField) {
  const d = await api('GET', '/api/patient/' + id);
  if (!d) { view.innerHTML = '<div class="card">المريض غير موجود</div>'; return; }
  CUR = d;
  const p = d.patient;
  view.innerHTML = `
    <div id="alerts"></div>
    ${patientHeaderHTML(p, false)}
    <div class="card">
      <div class="whead">
        <b>الأعمال</b>
        <span class="muted small">المبالغ بالآلاف · <kbd>Ctrl+D</kbd> تكرار آخر عمل</span>
        <div class="totals" id="totals"></div>
        <label class="muted small"><input type="checkbox" id="showLegacy" checked> Archive</label>
      </div>
      <div class="wscroll"><table class="grid" id="works">
        <colgroup><col style="width:34px"><col style="width:128px"><col style="width:120px"><col style="width:80px"><col style="width:72px"><col style="width:82px"><col style="width:72px"><col><col style="width:110px"><col style="width:52px"><col style="width:28px"></colgroup>
        <thead><tr><th>#</th><th>التاريخ</th><th>العمل</th><th>السن</th><th>السعر</th><th>بعد الخصم</th><th>المدفوع</th><th>التفاصيل</th><th>الطبيب</th><th>الحالة</th><th></th></tr></thead>
        <tbody></tbody>
      </table></div>
    </div>
    ${p.legacy_ids ? `<div class="muted small" style="text-align:right">Access ID: ${esc(p.legacy_ids)}</div>` : ''}`;

  // patient header
  $('.pcard', view).addEventListener('change', e => {
    const t = e.target; if (!t.dataset.f) return;
    const f = t.dataset.f, v = t.value;
    if (f === 'name' && !v.trim()) { toast('الاسم مطلوب', true); t.value = CUR.patient.name; return; }
    if (f === 'phone' && v.trim()) api('GET', '/api/similar?phone=' + encodeURIComponent(v)).then(r => {
      r = r.filter(x => x.id !== id);
      if (r.length) toast('نفس الهاتف عند: ' + r.map(x => x.name).join('، ') + ' — اربطهم كعائلة إن كانوا أقارب', true);
    }).catch(() => { });
    CUR.patient[f] = v;
    enqueue(() => api('PUT', '/api/patient/' + id, { [f]: v }), () => {
      if (f === 'area' && v && !LISTS.areas.some(a => a.name === v)) LISTS.areas.push({ name: v, count: 1 });
      if (f === 'p_factor' && v && !LISTS.p_factors.some(a => a.name === v)) LISTS.p_factors.push({ name: v, count: 1 });
    });
  });
  $('#pnBtn').addEventListener('click', e => { e.stopPropagation(); openPrivateNote(); });
  $('#xrayBtn').addEventListener('click', () => {
    const b = $('#xrayBtn');
    CUR.patient.xray = CUR.patient.xray ? 0 : 1;
    const v = CUR.patient.xray;
    b.classList.toggle('on', !!v); b.textContent = 'الأشعة ' + (v ? '✓' : '✗');
    enqueue(() => api('PUT', '/api/patient/' + id, { xray: v ? '1' : '0' }));
  });
  $('#rxBtn').addEventListener('click', () => { location.hash = '#/rx/' + id; });
  $('#exBtn').addEventListener('click', async () => { const m = await api('GET', '/api/rx'); printRx(extractHTML(m.extract)); });
  $('#copyNA').addEventListener('click', () => {
    const name = ($('[data-f=name]', view).value || '').trim();
    const age = ageOf($('[data-f=dob]', view).value);
    copyText(age != null ? name + '    ' + age : name);
    toast(age != null ? 'نُسخ: ' + name + ' — ' + age : 'نُسخ الاسم فقط (المواليد غير صحيحة)', age == null);
    openXray();
  });
  showAge();
  $('[data-f=dob]', view).addEventListener('input', showAge);
  pfColor();
  $('[data-f=p_factor]', view).addEventListener('input', pfColor);
  $('[data-f=p_factor]', view).addEventListener('change', pfColor);
  $('#delPat').addEventListener('click', async () => {
    if (!confirm('Permanently delete "' + p.name + '" with all works and payments?')) return;
    if (!confirm('Final confirmation: this cannot be undone.')) return;
    await api('DELETE', '/api/patient/' + id); toast('حُذف'); location.hash = '#/';
  });

  // works: entry row on top, newest first
  const tb = $('#works tbody');
  tb.appendChild(workRow(null));
  d.works.slice().reverse().forEach(w => tb.appendChild(workRow(w)));
  $('#showLegacy').addEventListener('change', e => $$('tr.legacy', tb).forEach(r => r.classList.toggle('hidden', !e.target.checked)));

  renderSummary();
  if (focusField) { const el = $(`[data-f="${focusField}"]`, view); if (el) el.focus(); }
  else if (!IS_APP) { const nr = $('#works tr.newrow [data-w="work_type"]'); if (nr) nr.focus(); }   // on the phone: no keyboard popping up on opening a file
}

// colour group of a work type (by abbreviation)
function wtClass(v) {
  const t = String(v || '').toLowerCase();
  if (!t) return '';
  if (/endo|pulp|obt/.test(t)) return 'wt-endo';
  if (/exo|ext|implant|imp\.|surg/.test(t)) return 'wt-surg';
  if (/s&p|scal|polish|perio/.test(t)) return 'wt-perio';
  if (/crown|bridge|rpd|denture|veneer|post|prost/.test(t)) return 'wt-pros';
  if (/ortho/.test(t)) return 'wt-ortho';
  if (/^dx|plan|consult|check/.test(t)) return 'wt-dx';
  if (/cf|af|fill|build|caries|cl ?i|gic|tf/.test(t)) return 'wt-fill';
  return 'wt-other';
}
// age from DOB: a year (1985) or a full date (1985-03-20 / 20/3/1985)
function ageOf(dob) {
  const t = cleanNum(dob);
  const now = new Date();
  let y, m = 0, d = 1, mm;
  if (/^\d{4}$/.test(t)) y = +t;
  else if ((mm = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) { y = +mm[1]; m = mm[2] - 1; d = +mm[3]; }
  else if ((mm = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) { y = +mm[3]; m = mm[2] - 1; d = +mm[1]; }
  else return null;
  if (y < 1900 || y > now.getFullYear()) return null;
  if (/^\d{4}$/.test(t)) return now.getFullYear() - y;
  let a = now.getFullYear() - y;
  if (now.getMonth() < m || (now.getMonth() === m && now.getDate() < d)) a--;
  return Math.max(a, 0);
}
// header background by P Factor: A green, B yellow, C orange, Nego / Debt / X red
function pfColor() {
  const card = $('.pcard', view), i = $('[data-f=p_factor]', view); if (!card || !i) return;
  const v = i.value.trim().toLowerCase();
  let c = '';
  if (/nego|debt|دين/.test(v) || v === 'x') c = 'pf-r';
  else if (/^a\b|^a\+?$/.test(v)) c = 'pf-a';
  else if (v === 'b') c = 'pf-b';
  else if (v === 'c') c = 'pf-c';
  card.classList.remove('pf-a', 'pf-b', 'pf-c', 'pf-r');
  if (c) card.classList.add(c);
}
function showAge() {
  const i = $('[data-f=dob]', view); if (!i) return;
  const lab = i.parentNode.firstChild;
  const a = ageOf(i.value);
  lab.textContent = a != null ? 'المواليد · العمر ' + a : 'المواليد';
}
// X-ray program (chosen once in Settings): opened — or brought to the front — after copying the name
async function openXray() {
  if (IS_APP || !(LISTS.profile || {}).xray_path) return;
  try {
    const r = await api('POST', '/api/xray_launch');
    if (!r.ok) toast(r.error, true);
  } catch (e) { toast('تعذر فتح برنامج الأشعة: ' + e.message, true); }
}
function copyText(text) {
  if (IS_APP && window.ClinicApp.copy) { try { window.ClinicApp.copy(text); return; } catch (e) { } }
  // works on the server PC and over the network (http)
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { }
  ta.remove();
  if (!ok && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => { });
}

function workRow(w) {
  const isNew = !w;
  w = w || { id: null, date: '', work_type: '', tooth: '', price_orig: null, price_final: null, paid: null, details: '', doctor: defDoc(), status: 'done', legacy: 0 };
  const tr = document.createElement('tr');
  tr._w = w;
  const legacy = !!w.legacy;
  tr.className = (legacy ? 'legacy' : '') + (w.status === 'plan' ? ' plan' : '') + (isNew ? ' newrow' : '');
  const inp = (k, extra = '') => `<input data-w="${k}" value="${esc(w[k] == null ? '' : w[k])}" ${extra}>`;
  tr.innerHTML = `
    <td class="num-col">${isNew ? '+' : (w.seq || '')}</td>
    <td><input data-w="date" type="date" value="${esc(w.date || '')}"></td>
    <td class="wt ${wtClass(w.work_type)}">${inp('work_type', 'data-combo="work_type"' + ((LISTS.profile || {}).free_work_types ? '' : ' data-strict="1"') + ' data-lang="en"')}</td>
    <td>${inp('tooth', 'data-combo="tooth" data-lang="en"')}</td>
    ${legacy
      ? `<td><div class="ro" title="الكلفة في Access">${esc(w.legacy_cost || '')}</div></td>
         <td><div class="ro"><span class="tag">أرشيف</span></div></td>
         <td><div class="ro" title="المدفوع في Access">${esc(w.legacy_paid || '')}</div></td>`
      : `<td><input data-w="price_orig" inputmode="decimal" data-lang="en" value="${numOrEmpty(w.price_orig)}"></td>
         <td><input data-w="price_final" inputmode="decimal" data-lang="en" value="${numOrEmpty(w.price_final)}"></td>
         <td><input data-w="paid" inputmode="decimal" data-lang="en" value="${numOrEmpty(w.paid)}"></td>`}
    <td>${inp('details', 'data-lang="en+" dir="auto" title="English — Alt+Shift للعربي"')}</td>
    <td>${inp('doctor', 'data-combo="doctor" data-strict="1" data-lang="en"')}</td>
    <td>${legacy ? '' : `<button class="status-btn ${w.status}" tabindex="-1" title="منجز / مخطط">${w.status === 'plan' ? 'مخطط' : 'منجز'}</button>`}</td>
    <td><button class="del" tabindex="-1" title="حذف السطر">✕</button></td>`;

  const save = (fields) => {
    const wasNew = !w.id;
    if (wasNew && tr.classList.contains('newrow')) {
      tr.classList.remove('newrow');
      $('td.num-col', tr).textContent = '…';
      tr.parentNode.insertBefore(workRow(null), tr);
    }
    tr.classList.add('unsaved');
    enqueue(async () => {
      if (!w.id) {
        const body = { patient_id: CUR.patient.id };
        $$('[data-w]', tr).forEach(i => body[i.dataset.w] = i.value);
        body.status = w.status;
        const r = await api('POST', '/api/work', body);
        w.id = r.id;
      } else {
        await api('PUT', '/api/work/' + w.id, fields);
      }
    }, () => { tr.classList.remove('unsaved'); scheduleSummary(); });
  };

  // typing in any field fills today's date
  tr.addEventListener('input', e => {
    const t = e.target; if (!t.dataset.w || t.dataset.w === 'date' || legacy) return;
    const di = $('[data-w=date]', tr);
    if (!di.value && t.value.trim()) { di.value = todayISO(); if (w.id) save({ date: di.value }); }
  });
  tr.addEventListener('change', e => {
    const t = e.target; if (!t.dataset.w) return;
    const k = t.dataset.w;
    if (k === 'work_type') { const td = t.parentNode; td.className = 'wt ' + wtClass(t.value); }
    if (k === 'tooth') { const m = t.value.match(/^\s*(ur|ul|lr|ll)\s*[-_.]?\s*([1-8a-e])\s*$/i); if (m) t.value = (m[1] + m[2]).toUpperCase(); }
    let v = t.value;
    if (['price_orig', 'price_final', 'paid'].includes(k)) {
      v = cleanNum(v);
      if (v && isNaN(Number(v))) { t.classList.add('bad'); toast('أدخل رقماً (بالآلاف)', true); return; }
      t.classList.remove('bad');
      t.value = v;
      // discounted price follows the price automatically
      if (k === 'price_orig') {
        const pf = $('[data-w=price_final]', tr);
        if (!pf.value || pf.dataset.auto === '1') { pf.value = v; pf.dataset.auto = '1'; if (w.id) { save({ price_orig: v, price_final: v }); return; } }
      }
      if (k === 'price_final') t.dataset.auto = '';
    }
    if (!w.id && !Array.from($$('[data-w]', tr)).some(i => i.dataset.w !== 'date' && i.value.trim())) return;
    save({ [k]: v });
  });
  // Ctrl+D (or clicking +) in the entry row: repeat the latest work, then type the tooth
  const repeat = () => {
    if (!tr.classList.contains('newrow')) return;
    let src = tr.nextElementSibling;   // latest row that has a work type
    while (src && !(src._w && (($('[data-w=work_type]', src) || {}).value || src._w.work_type))) src = src.nextElementSibling;
    if (!src) { toast('لا يوجد عمل سابق لتكراره', true); return; }
    const get = k => { const i = $(`[data-w=${k}]`, src); return i ? i.value : (src._w[k] == null ? '' : String(src._w[k])); };
    const set = (k, v) => { const i = $(`[data-w=${k}]`, tr); if (i) i.value = v; };
    set('date', todayISO());
    ['work_type', 'doctor'].forEach(k => set(k, get(k)));
    if (!src._w.legacy) { set('price_orig', get('price_orig')); set('price_final', get('price_final')); }
    const wt = $('[data-w=work_type]', tr); wt.parentNode.className = 'wt ' + wtClass(wt.value);
    save({});
    const ti = $('[data-w=tooth]', tr); ti.focus(); ti.select();
    toast('كُرر العمل — اكتب السن');
  };
  tr.addEventListener('keydown', e => { if (e.ctrlKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); repeat(); } });
  if (isNew) { const c = $('td.num-col', tr); c.title = 'تكرار آخر عمل (Ctrl+D)'; c.style.cursor = 'pointer'; c.addEventListener('click', repeat); }
  // always remind to write the doctor of a work
  const docCheck = () => {
    if (legacy || !tr.isConnected) return false;
    const di = $('[data-w=doctor]', tr), filled = ['work_type', 'price_orig', 'paid'].some(k => { const i = $(`[data-w=${k}]`, tr); return i && i.value.trim(); });
    const missing = filled && !di.value.trim() && !!(w.id || !tr.classList.contains('newrow'));
    di.parentNode.classList.toggle('nodoc', missing);
    return missing;
  };
  tr.addEventListener('focusout', e => {
    if (e.relatedTarget && tr.contains(e.relatedTarget)) return;
    setTimeout(() => { if (docCheck()) toast('⚠ لم يُكتب اسم الطبيب لهذا العمل', true); }, 50);
  });
  setTimeout(docCheck, 0);
  // after Doctor: Tab or Enter goes to a new work row on top
  tr.addEventListener('keydown', e => {
    if (e.target.dataset.w !== 'doctor' || e.shiftKey || (e.key !== 'Tab' && e.key !== 'Enter')) return;
    e.preventDefault();
    e.target.blur();
    const tb = tr.parentNode; if (!tb) return;
    const nr = tb.querySelector('tr.newrow');
    if (nr && nr !== tr) { $('[data-w=work_type]', nr).focus(); nr.scrollIntoView({ block: 'nearest' }); }
  });
  const sb = $('.status-btn', tr);
  if (sb) sb.addEventListener('click', () => {
    w.status = w.status === 'plan' ? 'done' : 'plan';
    sb.className = 'status-btn ' + w.status; sb.textContent = w.status === 'plan' ? 'مخطط' : 'منجز';
    tr.classList.toggle('plan', w.status === 'plan');
    if (w.id) save({ status: w.status });
  });
  $('.del', tr).addEventListener('click', () => {
    if (!w.id) { if (!tr.classList.contains('newrow')) tr.remove(); else $$('input', tr).forEach(i => i.value = ''); return; }
    if (!confirm('Delete this work?')) return;
    const id = w.id;
    tr.remove();
    enqueue(() => api('DELETE', '/api/work/' + id), scheduleSummary);
  });
  return tr;
}

let sumT;
function scheduleSummary() {
  clearTimeout(sumT);
  sumT = setTimeout(() => whenSaved(async () => {
    if (!CUR) return;
    try {
      const d = await api('GET', '/api/patient/' + CUR.patient.id);
      CUR.totals = d.totals; CUR.family = d.family; CUR.payments = d.payments; CUR.paid_for_others = d.paid_for_others;
      const tb = $('#works tbody');
      if (tb) { $$('tr', tb).forEach(tr => { if (tr._w && tr._w.id) { const w = d.works.find(x => x.id === tr._w.id); if (w) { tr._w.seq = w.seq; const c = $('td.num-col', tr); if (c && c.textContent !== '+') c.textContent = w.seq; } } }); }
      renderSummary();
    } catch (e) { }
  }), 300);
}

function renderSummary() {
  const d = CUR, t = d.totals;
  $('#totals').innerHTML = `
    <span>المجموع <b>${money(t.orig) || 0}</b></span>
    <span>الخصم <b>${money(t.discount) || 0}</b></span>
    <span>الصافي <b>${money(t.final) || 0}</b></span>
    <span>المدفوع <b>${money(t.paid) || 0}</b></span>
    <span class="bal ${t.balance > 0 ? '' : 'zero'}">${t.balance < 0 ? 'رصيد له' : 'المتبقي'} <b>${moneyD(Math.abs(t.balance))}</b></span>`;
  $('#totals').title = 'Only new works marked "Done" count. Archive and Plan rows are excluded.';
  // debt alerts
  const parts = [];
  if (t.balance > 0) parts.push(`This patient owes ${moneyD(t.balance)}`);
  d.family.filter(f => f.balance > 0).forEach(f => parts.push(`<a data-open="${f.id}" dir="auto">${esc(f.name)}</a> (${esc(relLabel(f))}) owes ${moneyD(f.balance)}`));
  const credit = t.balance < 0 ? `<div class="alert credit">⚠ This patient paid more than his works — credit ${moneyD(-t.balance)}</div>` : '';
  $('#alerts').innerHTML = (parts.length ? `<div class="alert">⚠ ${parts.join(' &nbsp;·&nbsp; ')}</div>` : '') + credit;
  $$('#alerts [data-open]').forEach(a => a.addEventListener('click', () => location.hash = '#/p/' + a.dataset.open));
  renderFamily();
}

function relLabel(f) {
  if (!f.direct) return 'Family';
  if (!f.relation) return 'Linked';
  return f.reverse ? (INVERSE[f.relation] || ('↔ ' + f.relation)) : f.relation;
}

async function renderFamily() {
  const c = $('#famLine'); if (!c) return;
  const fam = CUR.family;
  c.innerHTML = `<span class="muted small">العائلة:</span>
    ${fam.map(f => `<span class="chip ${f.balance > 0 ? 'debt' : ''}" data-open="${f.id}">
        <b dir="auto">${esc(f.name)}</b><span class="rel">${esc(relLabel(f))}</span>
        ${f.balance > 0 ? `<span class="bal">${money(f.balance)}</span>` : ''}
        ${f.direct ? `<span class="x" data-unlink="${f.link_id}" title="إلغاء الربط">✕</span>` : ''}</span>`).join('')}
    <button class="small" id="linkBtn" dir="rtl">+ ربط</button><span id="famSug"></span>`;
  $$('.chip[data-open]', c).forEach(ch => ch.addEventListener('click', e => {
    if (e.target.dataset.unlink) return;
    location.hash = '#/p/' + ch.dataset.open;
  }));
  $$('[data-unlink]', c).forEach(x => x.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm('Unlink?')) return;
    await api('DELETE', '/api/link/' + x.dataset.unlink); scheduleSummary();
  }));
  $('#linkBtn').addEventListener('click', () => openLinker());
  try {
    const sug = (await api('GET', '/api/family_suggest/' + CUR.patient.id)).slice(0, 3);
    $('#famSug').innerHTML = sug.map(s =>
      `<span class="chip sug" data-sug="${s.id}" data-name="${esc(s.name)}" title="اقتراح: ${esc(s.why)}">+ <span dir="auto">${esc(s.name)}</span> <span class="rel">نفس الهاتف</span></span>`).join('');
    $$('[data-sug]', c).forEach(s => s.addEventListener('click', () => openLinker({ id: +s.dataset.sug, name: s.dataset.name })));
  } catch (e) { }
}

function openLinker(pre) {
  const l = $('#linker'); l.classList.remove('hidden');
  l.innerHTML = `<span>ربط بـ</span>
    <span style="position:relative"><input id="lkQ" data-lang="ar" dir="auto" placeholder="search patient…" style="width:260px" value="${pre ? esc(pre.name) : ''}"><div id="lkRes" class="dropdown hidden"></div></span>
    <span>صلته بهذا المريض</span><input id="lkRel" data-combo="relation" data-lang="en" placeholder="Father, Wife, Son…" style="width:130px">
    <button class="primary small" id="lkOk">Link</button><button class="small" id="lkCancel">Cancel</button>`;
  let chosen = pre || null, items = [], sel = 0, t;
  const q = $('#lkQ'), res = $('#lkRes');
  const show = async () => {
    items = (await api('GET', '/api/search?q=' + encodeURIComponent(q.value))).filter(x => x.id !== CUR.patient.id);
    sel = 0;
    res.innerHTML = items.map((p, i) => `<div class="it${i === sel ? ' sel' : ''}" data-i="${i}"><b dir="auto">${esc(p.name)}</b><small>${esc(p.dob || '')} · ${esc(p.phone || '')}</small></div>`).join('') || '<div class="empty">لا توجد نتائج</div>';
    res.classList.remove('hidden');
  };
  q.addEventListener('input', () => { chosen = null; clearTimeout(t); t = setTimeout(show, 120); });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))); $$('.it', res).forEach((el, i) => el.classList.toggle('sel', i === sel)); }
    else if ((e.key === 'Enter' || e.key === 'Tab') && !res.classList.contains('hidden') && items[sel]) { if (e.key === 'Enter') e.preventDefault(); chosen = items[sel]; q.value = chosen.name; res.classList.add('hidden'); if (e.key === 'Enter') $('#lkRel').focus(); }
  });
  q.addEventListener('blur', () => setTimeout(() => res.classList.add('hidden'), 150));
  res.addEventListener('mousedown', e => { const it = e.target.closest('.it'); if (it) { e.preventDefault(); chosen = items[+it.dataset.i]; q.value = chosen.name; res.classList.add('hidden'); $('#lkRel').focus(); } });
  const ok = async () => {
    if (!chosen) { toast('اختر المريض من القائمة', true); return; }
    try {
      await api('POST', '/api/link', { a_id: chosen.id, b_id: CUR.patient.id, relation: $('#lkRel').value });
      toast('رُبط'); l.classList.add('hidden'); scheduleSummary();
    } catch (e) { toast(e.message, true); }
  };
  $('#lkOk').addEventListener('click', ok);
  $('#lkRel').addEventListener('keydown', e => { if (e.key === 'Enter' && $('#combo').classList.contains('hidden')) { e.preventDefault(); ok(); } });
  $('#lkCancel').addEventListener('click', () => l.classList.add('hidden'));
  (pre ? $('#lkRel') : q).focus();
}

/* ------------------------------------------------------------ private note */
let PN = null;
function openPrivateNote() {
  if (PN) { closePrivateNote(); return; }
  const btn = $('#pnBtn'); const r = btn.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'pn-pop';
  pop.innerHTML = `<header><span>🔒</span><button class="small" id="pnClose" title="إغلاق">✕</button></header>
    <textarea id="pnText" dir="auto">${esc(CUR.patient.private_note || '')}</textarea>
    <div class="st" id="pnSt">تُحفظ تلقائياً. اضغط خارجها أو Esc للإغلاق.</div>`;
  document.body.appendChild(pop);
  pop.style.top = (r.bottom + 6) + 'px';
  pop.style.left = Math.max(8, Math.min(window.innerWidth - 400, r.right - 380)) + 'px';
  const ta = $('#pnText', pop); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  const pid = CUR.patient.id;
  let t;
  const flush = () => {
    clearTimeout(t);
    const v = ta.value;
    if (v === (PN && PN.saved)) return;
    PN.saved = v;
    CUR.patient.private_note = v;
    enqueue(() => api('PUT', '/api/patient/' + pid, { private_note: v }), () => {
      const st = $('#pnSt'); if (st) st.textContent = 'حُفظت ✓';
      const b = $('#pnBtn'); if (b) { const dot = $('.dot', b); if (v.trim() && !dot) b.insertAdjacentHTML('beforeend', '<span class="dot"></span>'); if (!v.trim() && dot) dot.remove(); }
    });
  };
  ta.addEventListener('input', () => { $('#pnSt').textContent = '…'; clearTimeout(t); t = setTimeout(flush, 500); });
  $('#pnClose', pop).addEventListener('click', () => closePrivateNote());
  PN = { pop, flush, saved: ta.value };
}
function closePrivateNote() {
  if (!PN) return;
  PN.flush(); PN.pop.remove(); PN = null;
}
document.addEventListener('mousedown', e => {
  if (PN && !PN.pop.contains(e.target) && !(e.target.closest && e.target.closest('#pnBtn'))) closePrivateNote();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && PN) closePrivateNote(); });

/* ------------------------------------------------------------ debts */
async function renderDebts() {
  const rows = await api('GET', '/api/debts');
  const tot = rows.filter(r => r.bal > 0).reduce((a, r) => a + r.bal, 0);
  view.innerHTML = `<div class="card ar" dir="rtl"><h3>الديون <span class="sp"></span><span class="muted">${rows.filter(r => r.bal > 0).length} مريض · المجموع ${moneyD(tot)}</span><button class="small no-print" onclick="print()">🖨 طباعة</button></h3>
  <table class="list"><thead><tr><th>المريض</th><th>الهاتف</th><th>المتبقي</th><th>آخر زيارة</th></tr></thead><tbody>
  ${rows.map(r => `<tr class="click" data-id="${r.id}"><td dir="auto">${esc(r.name)}</td><td>${esc(r.phone || '')}</td>
    <td style="color:${r.bal > 0 ? 'var(--warn)' : 'var(--ok)'};font-weight:700">${r.bal < 0 ? 'رصيد له ' : ''}${moneyD(Math.abs(r.bal))}</td><td>${esc(r.last_visit || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">لا توجد ديون</td></tr>'}
  </tbody></table></div>`;
  $$('tr.click', view).forEach(tr => tr.addEventListener('click', () => location.hash = '#/p/' + tr.dataset.id));
}

/* ------------------------------------------------------------ report */
async function renderReport() {
  const prm = new URLSearchParams((location.hash.split('?')[1]) || '');
  const from = prm.get('from') || todayISO(), to = prm.get('to') || from;
  const d = await api('GET', `/api/income?from=${from}&to=${to}`);
  const groups = incGroups(d);   // received money of done works, one group per doctor
  // doctor filter: remembered between visits; every doctor is shown on its own (never summed together)
  let pick = null; try { pick = JSON.parse(localStorage.getItem('repDocs') || 'null'); } catch (e) { }
  const allKeys = [...new Set([...apptDoctors(), ...groups.map(g => g.key)])];
  const shown = k => !pick || pick.includes(k);
  const label = k => k ? (DOC_STYLE[k] ? `${k} — ${docStyle(k).label}` : k) : 'بدون طبيب';
  const go = (f, t) => { location.hash = `#/report?from=${f}&to=${t || f}`; };
  view.innerHTML = `<div class="card ar" dir="rtl"><h3>التقرير — الوارد <span class="sp"></span>
      <span class="no-print row">من <input type="date" id="rf" value="${from}"> إلى <input type="date" id="rt" value="${to}">
        <button class="small" id="rToday">اليوم</button> <button class="small" onclick="print()">🖨 طباعة</button></span></h3>
    <div class="rep-docs no-print">${allKeys.map(k => { const ds = k && docStyle(k); return `<label class="rep-doc" style="${ds ? `background:${ds.bg};color:${ds.fg}` : ''}"><input type="checkbox" data-doc="${esc(k)}" ${shown(k) ? 'checked' : ''}> ${esc(label(k))}</label>`; }).join('')}
      <button class="small" id="rAll">الكل</button></div>
    <div class="print-only"><b>${from === to ? fmtDMY(from) : fmtDMY(from) + ' → ' + fmtDMY(to)}</b></div>
    <div class="rep-sum">${groups.filter(g => shown(g.key)).map(g => `<div class="rep-tot" style="${g.ds ? `background:${g.ds.bg};color:${g.ds.fg}` : ''}"><span>${esc(label(g.key))}</span><b>${moneyD(g.total)}</b><small>${g.rows.length} دفعة</small></div>`).join('') || '<div class="muted">لا يوجد وارد للأطباء المختارين في هذه الفترة.</div>'}</div>
    ${groups.filter(g => shown(g.key)).map(g => `<table class="list rep-tab">
      <thead><tr class="doc-head" style="${g.ds ? `background:${g.ds.bg};color:${g.ds.fg}` : ''}"><th colspan="${from === to ? 4 : 5}">${esc(label(g.key))}</th><th class="amt">${moneyD(g.total)}</th></tr>
        <tr>${from === to ? '' : '<th>التاريخ</th>'}<th>المريض</th><th>العمل</th><th>السن</th><th>التفاصيل</th><th class="amt">الوارد</th></tr></thead>
      <tbody>${g.rows.map(r => `<tr class="click" data-id="${r.patient_id}">${from === to ? '' : `<td>${fmtDMY(r.date)}</td>`}<td dir="auto">${esc(r.name)}</td>
        <td class="wt ${wtClass(r.work_type || '')}"><span class="wtv">${esc(r.work_type || '')}</span></td><td>${esc(r.tooth || '')}</td><td dir="auto">${esc(r.details || r.note || '')}</td><td class="amt">${money(r.amount)}</td></tr>`).join('')}</tbody>
    </table>`).join('')}</div>`;
  $('#rf').addEventListener('change', e => e.target.value && go(e.target.value, $('#rt').value < e.target.value ? e.target.value : $('#rt').value));
  $('#rt').addEventListener('change', e => e.target.value && go(from, e.target.value));
  $('#rToday').addEventListener('click', () => go(todayISO(), todayISO()));
  const savePick = () => { const on = $$('[data-doc]', view).filter(c => c.checked).map(c => c.dataset.doc); try { localStorage.setItem('repDocs', JSON.stringify(on.length === allKeys.length ? null : on)); } catch (e) { } renderReport(); };
  $$('[data-doc]', view).forEach(c => c.addEventListener('change', savePick));
  $('#rAll').addEventListener('click', () => { try { localStorage.removeItem('repDocs'); } catch (e) { } renderReport(); });
  $$('tr.click', view).forEach(tr => tr.addEventListener('click', () => location.hash = '#/p/' + tr.dataset.id));
}

/* ------------------------------------------------------------ duplicate review */
let DUPS = [], DI = 0;
async function renderReview() {
  view.innerHTML = '<div class="card">جارٍ التحميل…</div>';
  DUPS = await api('GET', '/api/dups');
  // continue where the review stopped last time (the list is ordered by id; reviewed pairs leave it)
  let last = 0; try { last = +localStorage.getItem('dupPos') || 0; } catch (e) { }
  const at = DUPS.findIndex(c => c.id >= last);
  DI = at >= 0 ? at : (last ? DUPS.length : 0);
  showDup();
}
function saveDupPos() { try { if (DUPS[DI]) localStorage.setItem('dupPos', DUPS[DI].id); else localStorage.removeItem('dupPos'); } catch (e) { } }
function sideHTML(x, bigger, label) {
  const p = x.patient;
  return `<div class="side ${bigger ? 'bigger' : ''}"><h3>${label}: <span dir="auto">${esc(p.name)}</span> ${bigger ? '<span class="tag">الأكبر</span>' : ''} <span class="sp"></span><a href="#/p/${p.id}" target="_blank" class="muted small">فتح</a></h3>
    <dl><dt>المواليد</dt><dd>${esc(p.dob || '—')}</dd><dt>الهاتف</dt><dd>${esc(p.phone || '—')}</dd><dt>العنوان</dt><dd dir="auto">${esc(p.area || '—')}</dd>
    <dt>رقم الاستمارة</dt><dd>${esc(p.form_no || '—')}</dd><dt>الأمراض</dt><dd dir="auto">${esc(p.medical || '—')}</dd><dt>الأعمال</dt><dd>${x.works.length}</dd></dl>
    <div class="wl"><table class="list"><tbody>${x.works.map(w => `<tr><td>${esc(w.date || '')}</td><td>${esc(w.work_type || '')}</td><td>${esc(w.tooth || '')}</td><td dir="auto">${esc(w.details || '')}</td><td>${esc(w.doctor || '')}</td></tr>`).join('')}</tbody></table></div></div>`;
}
const REASONS = {};
function showDup() {
  refreshBadge();
  if (DUPS.length && DI >= DUPS.length) {   // reached the end but some pairs were skipped
    view.innerHTML = `<div class="card ar" dir="rtl"><h3>مراجعة التكرار</h3>وصلت إلى النهاية ✓ — بقيت ${DUPS.length} حالة متروكة. <button class="small primary" id="dupRestart">مراجعة المتروكة</button></div>`;
    $('#dupRestart').addEventListener('click', () => { DI = 0; saveDupPos(); showDup(); });
    return;
  }
  if (!DUPS.length) { view.innerHTML = '<div class="card ar" dir="rtl"><h3>مراجعة التكرار</h3>لا يوجد شيء للمراجعة ✓</div>'; try { localStorage.removeItem('dupPos'); } catch (e) { } return; }
  saveDupPos();
  const c = DUPS[DI];
  const aBig = c.a.works.length >= c.b.works.length;
  const reason = String(c.reason || '').split('، ').map(r => REASONS[r] || r).join('، ');
  view.innerHTML = `<div class="card"><h3>مراجعة التكرار <span class="muted" style="font-weight:400">${DI + 1} من ${DUPS.length}${DI ? ` · ${DI} متروكة قبلها <a href="#" id="dupFirst" class="small">(العودة للأولى)</a>` : ''}</span><span class="sp"></span><span class="tag">${esc(reason)}</span></h3>
    <div class="pair">${sideHTML(c.a, aBig, 'A')}${sideHTML(c.b, !aBig, 'B')}</div>
    <div class="actions">
      <button class="primary" data-act="merge" data-keep="${aBig ? c.a.patient.id : c.b.patient.id}">دمج (يبقى الأكبر)</button>
      <button data-act="different">شخصان مختلفان</button>
      <button data-act="skip">تخطٍّ الآن</button>
      <span class="muted small" style="align-self:center">الدمج يملأ الحقول الفارغة من الملف الآخر، ويجمع الأعمال حسب التاريخ، ويحذف الأعمال المتطابقة.</span>
    </div></div>`;
  if ($('#dupFirst')) $('#dupFirst').addEventListener('click', e => { e.preventDefault(); DI = 0; showDup(); });
  $$('[data-act]', view).forEach(b => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    if (act === 'skip') { DI++; saveDupPos(); showDup(); return; }
    b.disabled = true;
    try {
      await api('POST', '/api/dups/' + c.id, { action: act, keep: b.dataset.keep });
      toast(act === 'merge' ? 'دُمج' : 'سُجّل: شخصان مختلفان');
      DUPS.splice(DI, 1);
      if (act === 'merge') { DUPS = await api('GET', '/api/dups'); DI = Math.min(DI, DUPS.length); }
      showDup();
    } catch (e) { toast(e.message, true); b.disabled = false; }
  }));
}

/* ------------------------------------------------------------ settings */
async function renderSettings() {
  await loadLists();
  const st = await api('GET', '/api/status');
  const listCard = (key, title, hasActive, note) => `<div class="card"><h3>${title} <span class="sp"></span><span class="muted small" style="font-weight:400">${LISTS[key].length}</span></h3>
    <div class="row" style="margin-bottom:8px"><input id="add_${key}" placeholder="إضافة جديد…" dir="auto" style="flex:1;padding:5px 8px;border:1px solid var(--line);border-radius:5px"><button class="small primary" data-add="${key}">إضافة</button></div>
    ${note ? `<p class="muted small" style="margin:0 0 6px">${note}</p>` : ''}
    <table class="list"><thead><tr><th>الاسم</th><th>الاستعمال</th>${hasActive ? '<th>مفعّل</th>' : '<th></th>'}${key === 'doctors' ? '<th title="يُكتب تلقائياً في كل عمل وموعد جديد">الافتراضي</th>' : ''}</tr></thead><tbody>
    ${LISTS[key].map(it => `<tr><td><input data-ren="${key}" data-id="${it.id}" value="${esc(it.name)}" data-old="${esc(it.name)}" dir="auto"></td><td class="muted">${it.count || 0}</td>
      <td>${hasActive ? `<input type="checkbox" data-act="${key}" data-id="${it.id}" data-name="${esc(it.name)}" ${it.active ? 'checked' : ''} style="width:auto">` : (it.count ? '' : `<button class="small danger" data-delitem="${key}" data-id="${it.id}">حذف</button>`)}</td>${key === 'doctors' ? `<td><input type="radio" name="defDoc" data-defdoc="${esc(it.name)}" ${it.name === defDoc() ? 'checked' : ''} ${it.active ? '' : 'disabled'} style="width:auto"></td>` : ''}</tr>`).join('')}
    </tbody></table>${key === 'doctors' ? `<button class="small" id="defDocNone" style="margin-top:6px">بدون طبيب افتراضي</button>` : ''}</div>`;
  view.innerHTML = `
    <div class="card ar" dir="rtl"><h3>النظام</h3>
      <div class="row"><span>المرضى: <b>${st.patients}</b></span> · <span>الأعمال: <b>${st.works}</b></span> · <span>آخر نسخة احتياطية: <b>${esc(st.backup.last || '—')}</b></span>
      ${st.backup.error ? `<span style="color:var(--warn)">خطأ في النسخ الاحتياطي: ${esc(st.backup.error)}</span>` : ''}
      <button class="small primary" id="bkNow">نسخة احتياطية الآن</button></div>
      <p class="muted small">قاعدة البيانات: ${esc(st.db)} · نُقلت من ${esc((st.meta || {}).source || '—')} بتاريخ ${esc((st.meta || {}).migrated_at || '—')}</p>
      <div id="pcSet" class="small" style="line-height:1.8"></div></div>
    <div class="settings" dir="rtl">
      ${listCard('doctors', 'الأطباء', true, 'تغيير الاسم يحدّث كل الأعمال السابقة. إزالة علامة «مفعّل» تخفي الاسم من القائمة دون حذف تاريخه.')}
      ${listCard('work_types', 'أنواع العمل', true, 'كتابة اسم موجود تدمج الاثنين (مثلاً تغيير "Re endo" إلى "Re-Endo").')}
      ${listCard('areas', 'المناطق', false, 'تُضاف المناطق الجديدة تلقائياً عند كتابتها في ملف المريض.')}
      ${listCard('p_factors', 'P Factor', false, '')}
      ${listCard('labs', 'المختبرات', false, 'تُضاف المختبرات الجديدة تلقائياً عند كتابتها في صفحة المختبرات.')}
      <div class="card ar" dir="rtl" id="docColors"><h3>ألوان الأطباء في المواعيد</h3>
        <p class="muted small" style="margin:0 0 6px">لون سطر المريض في صفحة المواعيد وصفحتي الموبايل. ترتيب المواعيد: حسب الطبيب بهذا الترتيب، ثم الوقت.</p>
        <table class="list"><tbody>${(LISTS.doc_styles || []).map(([c, label, bg, fg]) => `<tr data-dc="${esc(c)}">
          <td><span class="doc-chip" style="background:${bg};color:${fg}">${esc(label)}</span> <span class="muted small">${esc(c)}</span></td>
          <td><input type="color" value="${bg}" style="width:56px;height:30px;padding:0 2px"></td>
          <td><button class="small" data-dcreset title="اللون الافتراضي">↺</button></td></tr>`).join('')}</tbody></table></div>
      <div class="card ar" dir="rtl" id="prayerSet"><h3>أوقات الصلاة في المواعيد</h3>
        <p class="muted small" style="margin:0 0 6px">تظهر الصلاة سطراً في المواعيد من «قبل» الأذان إلى «بعد» الأذان، وأي موعد يقع داخل هذا الوقت يُعلَّم بـ 🕌.</p>
        <div id="prayerBody" class="muted">…</div></div>
      <div class="card ar" dir="rtl" id="xraySet"><h3>برنامج الأشعة</h3>
        <p class="muted small" style="margin:0 0 6px">اختره مرة واحدة: بعدها زر النسخ 📋 في ملف المريض ينسخ الاسم والعمر ويفتح برنامج الأشعة (أو يعرضه إن كان مفتوحاً).</p>
        <div class="row"><input id="xrPath" dir="ltr" value="${esc((LISTS.profile || {}).xray_path || '')}" placeholder="C:\\Program Files\\…\\xray.exe" style="flex:1">
          <button class="small primary" id="xrBrowse">📂 استعراض…</button><button class="small" id="xrTest">تجربة</button><button class="small danger" id="xrClear">✕</button></div></div>
      <div class="card ar" dir="rtl" id="cloudSet"><h3>المزامنة السحابية (Google)</h3><div id="cloudBody" class="muted">…</div></div>
      <div class="card ar" dir="rtl" id="rxSet"><h3>الوصفة — أسماء الأطباء وعنوان العيادة</h3><div id="rxSetBody" class="muted">…</div></div>
    </div>`;
  drawCloudSettings();
  drawPcSettings();
  if (IS_APP) $('#xraySet').classList.add('hidden');
  // default doctor
  const setDef = async v => { await api('PUT', '/api/meta', { default_doctor: v }); await loadLists(); toast(v ? 'الطبيب الافتراضي: ' + v : 'لا يوجد طبيب افتراضي'); renderSettings(); };
  $$('[data-defdoc]').forEach(r => r.addEventListener('change', () => setDef(r.dataset.defdoc)));
  $('#defDocNone').addEventListener('click', () => setDef(''));
  // doctor colours
  $$('#docColors tr[data-dc]').forEach(tr => {
    const setC = async c => { await api('PUT', '/api/doctor_color', { name: tr.dataset.dc, color: c }); toast('حُفظ اللون'); renderSettings(); };
    $('input[type=color]', tr).addEventListener('change', e => setC(e.target.value));
    $('[data-dcreset]', tr).addEventListener('click', () => setC(''));
  });
  // prayer times
  (async () => {
    const cfg = await api('GET', '/api/prayer_cfg');
    const today = await api('GET', '/api/prayers?date=' + todayISO()).catch(() => []);
    const names = { asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };
    $('#prayerBody').innerHTML = `<table class="list"><thead><tr><th></th><th>قبل الأذان (دقيقة)</th><th>بعد الأذان (دقيقة)</th><th>اليوم</th></tr></thead><tbody>
      ${Object.keys(names).map(k => { const c = cfg[k], t = today.find(x => x.key === k); return `<tr data-pk="${k}"><td><label><input type="checkbox" data-pon ${c.on ? 'checked' : ''} style="width:auto"> ${names[k]}</label></td>
        <td><input data-pb type="number" min="0" max="120" value="${c.before}" style="width:70px"></td><td><input data-pa type="number" min="0" max="180" value="${c.after}" style="width:70px"></td>
        <td class="muted" dir="ltr">${t ? t12(t.time) + ' – ' + t12(t.end) : '—'}</td></tr>`; }).join('')}</tbody></table>
      <div class="row" style="margin-top:8px"><label class="small">استيراد أوقات سنة جديدة (ملف Excel بأعمدة: التاريخ، العصر، المغرب، العشاء) <input type="file" id="prayerFile" accept=".xlsx"></label></div>`;
    $$('#prayerBody tr[data-pk]').forEach(tr => tr.addEventListener('change', async () => {
      await api('PUT', '/api/prayer_cfg', { [tr.dataset.pk]: { on: $('[data-pon]', tr).checked, before: +$('[data-pb]', tr).value || 0, after: +$('[data-pa]', tr).value || 0 } });
      toast('حُفظ'); renderSettings();
    }));
    $('#prayerFile').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      const buf = new Uint8Array(await f.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
      try { const r = await api('POST', '/api/prayer_import', { data: btoa(bin) }); toast(`استُورد ${r.days} يوماً (${fmtDMY(r.from)} – ${fmtDMY(r.to)})`); renderSettings(); }
      catch (err) { toast(err.message, true); }
    });
  })();
  // X-ray program
  const xrSave = async v => { await api('PUT', '/api/meta', { xray_path: v }); await loadLists(); $('#xrPath').value = v; toast(v ? 'حُفظ برنامج الأشعة ✓' : 'أُلغي الربط'); };
  $('#xrBrowse').addEventListener('click', async () => {
    toast('اختر برنامج الأشعة من النافذة التي فُتحت على حاسبة العيادة…');
    try { const r = await api('POST', '/api/xray_browse'); if (r.path) await xrSave(r.path); }
    catch (e) { toast(e.message, true); }
  });
  $('#xrPath').addEventListener('change', e => xrSave(e.target.value.trim().replace(/^"|"$/g, '')));
  $('#xrClear').addEventListener('click', () => xrSave(''));
  $('#xrTest').addEventListener('click', openXray);
  (async () => {
    const m = await api('GET', '/api/rx');
    const docs = m.doctors.filter(d => d.active || d.full_name);
    $('#rxSetBody').innerHTML = `<table class="list"><thead><tr><th>الرمز</th><th>الاسم الكامل</th><th>الشهادة 1</th><th>الشهادة 2</th></tr></thead><tbody>
      ${docs.map(d => `<tr data-doc="${esc(d.name)}"><td>${esc(d.name)}</td><td><input data-k="full_name" dir="auto" value="${esc(d.full_name || '')}"></td>
        <td><input data-k="deg1" dir="auto" value="${esc(d.deg1 || '')}"></td><td><input data-k="deg2" dir="auto" value="${esc(d.deg2 || '')}"></td></tr>`).join('')}</tbody></table>
      <label class="small" style="display:block;margin-top:8px">عنوان أعلى الوصفة<input id="rxTitle" dir="auto" value="${esc(m.title || '')}" style="width:100%"></label>
      <label class="small" style="display:block;margin-top:6px">أسفل الوصفة (العنوان والهاتف)<textarea id="rxFooter" rows="3" dir="auto" style="width:100%">${esc(m.footer || '')}</textarea></label>
      <label class="small" style="display:block;margin-top:6px">تعليمات بعد القلع <span class="muted">— السطر الذي يبدأ بـ # عنوان، وبـ = سطر ختامي في الوسط</span><textarea id="rxExtract" rows="8" dir="auto" style="width:100%">${esc(m.extract || '')}</textarea></label>`;
    $$('#rxSetBody tr[data-doc]').forEach(tr => tr.addEventListener('change', async () => {
      const b = { name: tr.dataset.doc }; $$('[data-k]', tr).forEach(i => b[i.dataset.k] = i.value);
      await api('PUT', '/api/doctor_info', b); toast('حُفظ');
    }));
    $('#rxTitle').addEventListener('change', async e => { await api('PUT', '/api/meta', { clinic_title: e.target.value }); toast('حُفظ'); });
    $('#rxFooter').addEventListener('change', async e => { await api('PUT', '/api/meta', { clinic_footer: e.target.value }); toast('حُفظ'); });
    $('#rxExtract').addEventListener('change', async e => { await api('PUT', '/api/meta', { extract_text: e.target.value }); toast('حُفظ'); });
  })();
  $('#bkNow').addEventListener('click', async () => { await api('POST', '/api/backup'); toast('بدأ النسخ الاحتياطي'); setTimeout(renderSettings, 1500); });
  $$('[data-add]', view).forEach(b => b.addEventListener('click', async () => {
    const k = b.dataset.add, i = $('#add_' + k); if (!i.value.trim()) return;
    await api('POST', '/api/' + k, { name: i.value }); toast('أُضيف'); renderSettings();
  }));
  $$('[id^=add_]', view).forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') view.querySelector(`[data-add="${i.id.slice(4)}"]`).click(); }));
  $$('[data-ren]', view).forEach(i => i.addEventListener('change', async () => {
    const v = i.value.trim(); if (!v || v === i.dataset.old) { i.value = i.dataset.old; return; }
    const exists = LISTS[i.dataset.ren].some(x => x.name === v);
    if (!confirm(exists ? `"${v}" موجود. دمج "${i.dataset.old}" فيه وتحديث كل السجلات؟` : `تغيير "${i.dataset.old}" إلى "${v}" في كل السجلات؟`)) { i.value = i.dataset.old; return; }
    await api('PUT', `/api/${i.dataset.ren}/${i.dataset.id}`, { name: v }); toast('عُدّل'); renderSettings();
  }));
  $$('[data-act]', view).forEach(c => c.addEventListener('change', async () => {
    await api('PUT', `/api/${c.dataset.act}/${c.dataset.id}`, { active: c.checked }); await loadLists();
  }));
  $$('[data-delitem]', view).forEach(b => b.addEventListener('click', async () => {
    await api('DELETE', `/api/${b.dataset.delitem}/${b.dataset.id}`); renderSettings();
  }));
}

/* ------------------------------------------------------------ shared date helpers */
const fmtDMY = iso => iso ? iso.split('-').reverse().join('/') : '';
const shiftDay = (iso, n) => { const d = new Date(iso + 'T00:00'); d.setDate(d.getDate() + n); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const monthStart = iso => iso.slice(0, 8) + '01';
const prevMonth = iso => { const d = new Date(iso.slice(0, 8) + '01T00:00'); d.setMonth(d.getMonth() - 1); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); const a = d.toISOString().slice(0, 10); const e = new Date(iso.slice(0, 8) + '01T00:00'); e.setDate(0); e.setMinutes(e.getMinutes() - e.getTimezoneOffset()); return [a, e.toISOString().slice(0, 10)]; };
const docLabel = code => { const d = LISTS.doctors.find(x => x.name === code); return d && d.full_name ? 'د. ' + d.full_name : (code || ''); };

/* ------------------------------------------------------------ income (الواردات) */
// income split per doctor: the doctors first, then others, then payments without a doctor
function incGroups(d) {
  const m = new Map();
  d.rows.forEach(r => { const k = r.doctor || ''; if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  const order = [...Object.keys(DOC_STYLE), ...[...m.keys()].filter(k => k && !DOC_STYLE[k]).sort(), ''];
  return order.filter(k => m.has(k)).map(k => { const rows = m.get(k), ds = k ? docStyle(k) : null;
    return { key: k, label: ds ? (DOC_STYLE[k] ? ds.label : k) : 'بدون طبيب', ds, rows, total: rows.reduce((t, r) => t + (r.amount || 0), 0) }; });
}

/* ------------------------------------------------------------ expenses (المصاريف) */
async function renderExpenses() {
  await loadLists();
  const prm = new URLSearchParams((location.hash.split('?')[1]) || '');
  const from = prm.get('from') || monthStart(todayISO()), to = prm.get('to') || todayISO();
  const d = await api('GET', `/api/expenses?from=${from}&to=${to}`);
  EXP_LISTS = { items: d.items, offices: d.offices };
  const go = (f, t) => { location.hash = `#/expenses?from=${f}&to=${t}`; };
  const srcSum = Object.entries(d.by_source).map(([k, v]) => { const [doc, src] = k.split('|'); return `<span>${src === 'pocket' ? 'من جيب ' + esc(doc) : 'من الدخل' + (doc && doc !== '—' ? ' (' + esc(doc) + ')' : '')} <b>${money(v)}</b></span>`; }).join('');
  view.innerHTML = `<div class="card ar" dir="rtl">
    <div class="whead no-print">
      <b>المصاريف</b>
      من <input type="date" id="eFrom" value="${from}" class="dsel"> إلى <input type="date" id="eTo" value="${to}" class="dsel">
      <button class="small" id="eThis">هذا الشهر</button><button class="small" id="ePrev">الشهر الماضي</button>
      <button class="small" onclick="print()">🖨 طباعة</button>
      <div class="totals"><span>المجموع <b id="eTotal">${moneyD(d.total)}</b></span><span>المسدد <b id="ePaid">${moneyD(d.total_paid)}</b></span><span>المتبقي <b id="eRem" class="${d.total_remaining > 0 ? 'neg' : ''}">${moneyD(d.total_remaining)}</b></span>
        <label class="small"><input type="checkbox" id="eUnpaid"> غير المسدد فقط</label></div>
    </div>
    ${d.owed.length ? `<div class="owed"><b>الديون للمكاتب (كل الفترات):</b> ${d.owed.map(o => `<span>${esc(o.office)} <b>${money(o.remaining)}</b> <small>(${o.n} ${o.n === 1 ? 'فاتورة' : 'فواتير'} · منذ ${fmtDMY(o.since)})</small></span>`).join('')}</div>` : ''}
    <h3 class="print-only">المصاريف من ${fmtDMY(from)} إلى ${fmtDMY(to)} — المجموع ${moneyD(d.total)}</h3>
    <div class="totals srcsum">${srcSum}</div>
    <div class="wscroll"><table class="grid exp" id="exps">
      <colgroup><col style="width:130px"><col><col style="width:16%"><col style="width:88px"><col style="width:88px"><col style="width:96px"><col style="width:110px"><col style="width:100px"><col style="width:15%"><col style="width:28px"></colgroup>
      <thead><tr><th>التاريخ</th><th>المادة</th><th>المكتب</th><th>المبلغ الكلي</th><th>المسدد</th><th>المتبقي</th><th>مصدر الدفع</th><th>من</th><th>ملاحظة</th><th></th></tr></thead>
      <tbody></tbody>
    </table></div>
    <div class="muted small no-print" style="margin-top:6px">المبالغ بالآلاف · المادة والمكتب يُضافان للقائمة تلقائياً · إذا تُرك «المسدد» فارغاً يُعتبر المبلغ مسدداً بالكامل، وزر ✓ يسدد المتبقي</div></div>`;
  $('#eUnpaid').addEventListener('change', e => $$('#exps tbody tr').forEach(tr => { if (!tr.classList.contains('newrow')) tr.classList.toggle('hidden', e.target.checked && !(tr._rem > 0)); }));
  $('#eFrom').addEventListener('change', e => e.target.value && go(e.target.value, to));
  $('#eTo').addEventListener('change', e => e.target.value && go(from, e.target.value));
  $('#eThis').addEventListener('click', () => go(monthStart(todayISO()), todayISO()));
  $('#ePrev').addEventListener('click', () => { const [a, b] = prevMonth(todayISO()); go(a, b); });
  const tb = $('#exps tbody');
  tb.appendChild(expRow(null));
  d.rows.forEach(r => tb.appendChild(expRow(r)));
  const first = $('#exps tr.newrow [data-e=item]'); if (first && !IS_APP) first.focus();
}
function expRow(x) {
  const isNew = !x;
  x = x || { id: null, date: todayISO(), item: '', office: '', amount: null, paid: null, doctor: defDoc(), source: 'income', note: '' };
  const tr = document.createElement('tr');
  tr.className = isNew ? 'newrow' : '';
  const docs = LISTS.doctors.filter(d => d.active || d.name === x.doctor);
  tr.innerHTML = `
    <td><input data-e="date" type="date" value="${esc(x.date || '')}"></td>
    <td><input data-e="item" data-combo="exp_item" dir="auto" value="${esc(x.item || '')}"></td>
    <td><input data-e="office" data-combo="exp_office" data-lang="ar" dir="auto" value="${esc(x.office || '')}"></td>
    <td><input data-e="amount" inputmode="decimal" data-lang="en" value="${numSep(numOrEmpty(x.amount))}"></td>
    <td><input data-e="paid" inputmode="decimal" data-lang="en" placeholder="كامل" value="${numSep(numOrEmpty(x.paid))}"></td>
    <td class="exp-rem"><span></span><button class="small pay-rest hidden" tabindex="-1" title="تسديد المتبقي بالكامل">✓</button></td>
    <td><select data-e="doctor"><option value=""></option>${docs.map(d => `<option value="${esc(d.name)}" ${d.name === x.doctor ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></td>
    <td><select data-e="source"><option value="income" ${x.source !== 'pocket' ? 'selected' : ''}>من الدخل</option><option value="pocket" ${x.source === 'pocket' ? 'selected' : ''}>من جيبه</option></select></td>
    <td><input data-e="note" dir="auto" value="${esc(x.note || '')}"></td>
    <td><button class="del" tabindex="-1" title="حذف">✕</button></td>`;
  const drawRem = () => {
    const amt = Number(x.amount) || 0, paid = (x.paid === null || x.paid === undefined || x.paid === '') ? amt : Number(x.paid) || 0;
    tr._rem = Math.max(0, amt - paid);
    $('.exp-rem span', tr).textContent = tr._rem > 0 ? money(tr._rem) : (amt ? '✓' : '');
    $('.exp-rem', tr).classList.toggle('owe', tr._rem > 0);
    $('.pay-rest', tr).classList.toggle('hidden', !(tr._rem > 0));
  };
  drawRem();
  $('.pay-rest', tr).addEventListener('click', () => { const pi = $('[data-e=paid]', tr); pi.value = x.amount; pi.dispatchEvent(new Event('change', { bubbles: true })); });
  tr.addEventListener('change', e => {
    const t = e.target, k = t.dataset.e; if (!k) return;
    let v = t.value;
    if (k === 'paid' || k === 'amount') { v = cleanNum(v); if (v && isNaN(Number(v))) { t.classList.add('bad'); toast('أدخل رقماً (بالآلاف)', true); return; } t.classList.remove('bad'); t.value = numSep(v); }
    x[k] = v;
    if (k === 'amount' || k === 'paid') drawRem();
    if (!x.id && !['item', 'office', 'amount', 'paid', 'note'].some(f => String(x[f] || '').trim())) return;
    if (!x.id && tr.classList.contains('newrow')) { tr.classList.remove('newrow'); tr.parentNode.insertBefore(expRow(null), tr); }
    tr.classList.add('unsaved');
    enqueue(async () => {
      if (!x.id) {
        const body = {}; $$('[data-e]', tr).forEach(i => body[i.dataset.e] = (i.dataset.e === 'amount' || i.dataset.e === 'paid') ? cleanNum(i.value) : i.value);
        x.id = (await api('POST', '/api/expense', body)).id;
      } else await api('PUT', '/api/expense/' + x.id, { [k]: v });
    }, () => {
      tr.classList.remove('unsaved');
      if (k === 'item' && v && !EXP_LISTS.items.includes(v)) EXP_LISTS.items.push(v);
      if (k === 'office' && v && !EXP_LISTS.offices.includes(v)) EXP_LISTS.offices.push(v);
      expTotal();
    });
  });
  // after the note: Tab goes back to a new line on top
  tr.addEventListener('keydown', e => {
    if (e.target.dataset.e !== 'note' || e.shiftKey || (e.key !== 'Tab' && e.key !== 'Enter')) return;
    e.preventDefault(); e.target.blur();
    const nr = tr.parentNode && tr.parentNode.querySelector('tr.newrow');
    if (nr && nr !== tr) $('[data-e=item]', nr).focus();
  });
  $('.del', tr).addEventListener('click', () => {
    if (!x.id) { $$('input', tr).forEach(i => { if (i.dataset.e !== 'date') i.value = ''; }); return; }
    if (!confirm('حذف هذا المصروف؟')) return;
    const id = x.id; tr.remove();
    enqueue(() => api('DELETE', '/api/expense/' + id), expTotal);
  });
  return tr;
}
function expTotal() {
  let sum = 0, rem = 0;
  $$('#exps tbody tr').forEach(tr => { const i = $('[data-e=amount]', tr); if (!i || tr.classList.contains('newrow')) return; sum += Number(cleanNum(i.value)) || 0; rem += tr._rem || 0; });
  const el = $('#eTotal'); if (el) el.textContent = moneyD(sum);
  const p = $('#ePaid'); if (p) p.textContent = moneyD(sum - rem);
  const r = $('#eRem'); if (r) { r.textContent = moneyD(rem); r.classList.toggle('neg', rem > 0); }
}

/* ------------------------------------------------------------ labs (المختبرات): lab works, what was paid and what is still owed */
async function renderLabs() {
  await loadLists();
  const prm = new URLSearchParams((location.hash.split('?')[1]) || '');
  const from = prm.get('from') || monthStart(todayISO()), to = prm.get('to') || todayISO();
  const d = await api('GET', `/api/labworks?from=${from}&to=${to}`);
  LAB_LISTS = d.labs;
  const go = (f, t) => { location.hash = `#/labs?from=${f}&to=${t}`; };
  const byLab = Object.entries(d.by_lab).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span>${esc(k)} <b>${money(v)}</b></span>`).join('');
  view.innerHTML = `<div class="card ar" dir="rtl">
    <div class="whead no-print">
      <b>المختبرات</b>
      من <input type="date" id="lFrom" value="${from}" class="dsel"> إلى <input type="date" id="lTo" value="${to}" class="dsel">
      <button class="small" id="lThis">هذا الشهر</button><button class="small" id="lPrev">الشهر الماضي</button>
      <button class="small" onclick="print()">🖨 طباعة</button>
      <div class="totals"><span>المجموع <b id="lTotal">${moneyD(d.total)}</b></span><span>المسدد <b id="lPaid">${moneyD(d.total_paid)}</b></span><span>المتبقي <b id="lRem" class="${d.total_remaining > 0 ? 'neg' : ''}">${moneyD(d.total_remaining)}</b></span>
        <label class="small"><input type="checkbox" id="lUnpaid"> غير المسدد فقط</label></div>
    </div>
    ${d.owed.length ? `<div class="owed"><b>الديون للمختبرات (كل الفترات):</b> ${d.owed.map(o => `<span>${esc(o.lab)} <b>${money(o.remaining)}</b> <small>(${o.n} ${o.n === 1 ? 'عمل' : 'أعمال'} · منذ ${fmtDMY(o.since)})</small></span>`).join('')}</div>` : ''}
    <h3 class="print-only">المختبرات من ${fmtDMY(from)} إلى ${fmtDMY(to)} — المجموع ${moneyD(d.total)}</h3>
    ${byLab ? `<div class="totals srcsum"><span class="muted">حسب المختبر:</span>${byLab}</div>` : ''}
    <div class="wscroll"><table class="grid exp lab" id="labs">
      <colgroup><col style="width:124px"><col><col style="width:96px"><col style="width:9%"><col style="width:10%"><col style="width:12%"><col style="width:80px"><col style="width:80px"><col style="width:84px"><col style="width:96px"><col style="width:12%"><col style="width:28px"></colgroup>
      <thead><tr><th>التاريخ</th><th>المريض</th><th>الطبيب</th><th>الأسنان</th><th>نوع العمل</th><th>المختبر</th><th>المبلغ الكلي</th><th>المسدد</th><th>المتبقي</th><th>مصدر الدفع</th><th>ملاحظة</th><th></th></tr></thead>
      <tbody></tbody>
    </table></div>
    <div class="muted small no-print" style="margin-top:6px">المبالغ بالآلاف · المختبر يُضاف للقائمة تلقائياً (وتُعدّل القائمة من Settings) · إذا تُرك «المسدد» فارغاً يُعتبر مسدداً بالكامل، وزر ✓ يسدد المتبقي</div></div>`;
  $('#lUnpaid').addEventListener('change', e => $$('#labs tbody tr').forEach(tr => { if (!tr.classList.contains('newrow')) tr.classList.toggle('hidden', e.target.checked && !(tr._rem > 0)); }));
  $('#lFrom').addEventListener('change', e => e.target.value && go(e.target.value, to));
  $('#lTo').addEventListener('change', e => e.target.value && go(from, e.target.value));
  $('#lThis').addEventListener('click', () => go(monthStart(todayISO()), todayISO()));
  $('#lPrev').addEventListener('click', () => { const [a, b] = prevMonth(todayISO()); go(a, b); });
  const tb = $('#labs tbody');
  tb.appendChild(labRow(null));
  d.rows.forEach(r => tb.appendChild(labRow(r)));
  const first = $('#labs tr.newrow [data-l=patient]'); if (first && !IS_APP) first.focus();
}
function labRow(x) {
  const isNew = !x;
  x = x || { id: null, date: todayISO(), patient: '', patient_id: null, doctor: defDoc(), teeth: '', work_type: '', lab: '', amount: null, paid: null, source: 'income', note: '' };
  const tr = document.createElement('tr');
  tr.className = isNew ? 'newrow' : '';
  const docs = apptDoctors(); if (x.doctor && !docs.includes(x.doctor)) docs.push(x.doctor);
  tr.innerHTML = `
    <td><input data-l="date" type="date" value="${esc(x.date || '')}"></td>
    <td class="ap-name"><input data-l="patient" data-lang="ar" dir="auto" autocomplete="off" value="${esc(x.patient || '')}"><span class="ap-link"></span></td>
    <td><input data-l="doctor" data-combo="doctor" data-lang="en" dir="ltr" autocomplete="off" title="اكتب أول حرف من اسم الطبيب" value="${esc(x.doctor || '')}"></td>
    <td><input data-l="teeth" data-lang="en" dir="ltr" value="${esc(x.teeth || '')}"></td>
    <td><input data-l="work_type" data-combo="work_type" data-lang="en+" dir="auto" title="English — Alt+Shift للعربي" value="${esc(x.work_type || '')}"></td>
    <td><input data-l="lab" data-combo="lab" data-lang="ar" dir="auto" value="${esc(x.lab || '')}"></td>
    <td><input data-l="amount" inputmode="decimal" data-lang="en" value="${numSep(numOrEmpty(x.amount))}"></td>
    <td><input data-l="paid" inputmode="decimal" data-lang="en" placeholder="كامل" value="${numSep(numOrEmpty(x.paid))}"></td>
    <td class="exp-rem"><span></span><button class="small pay-rest hidden" tabindex="-1" title="تسديد المتبقي بالكامل">✓</button></td>
    <td><select data-l="source"><option value="income" ${x.source !== 'pocket' ? 'selected' : ''}>من الدخل</option><option value="pocket" ${x.source === 'pocket' ? 'selected' : ''}>من جيبه</option></select></td>
    <td><input data-l="note" dir="auto" value="${esc(x.note || '')}"></td>
    <td><button class="del" tabindex="-1" title="حذف">✕</button></td>`;
  const paintDoc = () => { const ds = docStyle(x.doctor); const s = $('[data-l=doctor]', tr); s.style.background = ds ? ds.bg : ''; s.style.color = ds ? ds.fg : ''; };
  paintDoc();
  const link = $('.ap-link', tr);
  const drawLink = () => { link.innerHTML = x.patient_id ? `<a href="#/p/${x.patient_id}" title="فتح الملف" tabindex="-1">↗ الملف</a>` : ''; };
  drawLink();
  const drawRem = () => {
    const amt = Number(x.amount) || 0, paid = (x.paid === null || x.paid === undefined || x.paid === '') ? amt : Number(x.paid) || 0;
    tr._rem = Math.max(0, amt - paid);
    $('.exp-rem span', tr).textContent = tr._rem > 0 ? money(tr._rem) : (amt ? '✓' : '');
    $('.exp-rem', tr).classList.toggle('owe', tr._rem > 0);
    $('.pay-rest', tr).classList.toggle('hidden', !(tr._rem > 0));
  };
  drawRem();
  const save = fields => {
    if (!x.id && !['patient', 'teeth', 'work_type', 'lab', 'amount', 'paid', 'note'].some(f => String(x[f] || '').trim())) return;
    if (!x.id && tr.classList.contains('newrow')) { tr.classList.remove('newrow'); tr.parentNode.insertBefore(labRow(null), tr); }
    tr.classList.add('unsaved');
    enqueue(async () => {
      if (!x.id) {
        const body = { patient_id: x.patient_id }; $$('[data-l]', tr).forEach(i => body[i.dataset.l] = (i.dataset.l === 'amount' || i.dataset.l === 'paid') ? cleanNum(i.value) : i.value);
        x.id = (await api('POST', '/api/labwork', body)).id;
      } else await api('PUT', '/api/labwork/' + x.id, fields);
    }, () => {
      tr.classList.remove('unsaved');
      if (x.lab && !LAB_LISTS.includes(x.lab)) LAB_LISTS.push(x.lab);
      labTotal();
    });
  };
  $('.pay-rest', tr).addEventListener('click', () => { const pi = $('[data-l=paid]', tr); pi.value = x.amount; pi.dispatchEvent(new Event('change', { bubbles: true })); });
  tr.addEventListener('change', e => {
    const t = e.target, k = t.dataset.l; if (!k) return;
    let v = t.value;
    if (k === 'amount' || k === 'paid') { v = cleanNum(v); if (v && isNaN(Number(v))) { t.classList.add('bad'); toast('أدخل رقماً (بالآلاف)', true); return; } t.classList.remove('bad'); t.value = numSep(v); }
    if (k === 'doctor' && v && !DOC_STYLE[v]) { const m = apptDoctors().find(n => n.toLowerCase() === v.toLowerCase()); if (m) { v = m; t.value = m; } else { t.classList.add('bad'); toast('اختر الطبيب من القائمة', true); return; } }
    t.classList.remove('bad');
    x[k] = v;
    const f = { [k]: v };
    if (k === 'patient' && x._picked !== v) { x.patient_id = null; f.patient_id = null; drawLink(); }
    if (k === 'amount' || k === 'paid') drawRem();
    if (k === 'doctor') paintDoc();
    save(f);
  });
  // patient: suggestions from the patient files (fills the doctor of the last visit when empty)
  const ni = $('[data-l=patient]', tr);
  let box = null, items = [], sel = 0, tmr;
  const close = () => { if (box) { box.remove(); box = null; } };
  const pick = async p => {
    ni.value = p.name; x.patient = p.name; x.patient_id = p.id; x._picked = p.name; close(); drawLink();
    const f = { patient: p.name, patient_id: p.id };
    if (!x.doctor) {
      try {
        const full = await api('GET', '/api/patient/' + p.id);
        const w = (full.works || []).filter(w => w.doctor).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
        if (w && DOC_STYLE[w.doctor]) { x.doctor = w.doctor; $('[data-l=doctor]', tr).value = w.doctor; paintDoc(); f.doctor = w.doctor; }
      } catch (e) { }
    }
    save(f);
  };
  ni.addEventListener('input', () => {
    clearTimeout(tmr);
    tmr = setTimeout(async () => {
      const q = ni.value.trim(); if (q.length < 2) { close(); return; }
      items = await api('GET', '/api/search?q=' + encodeURIComponent(q));
      close(); if (!items.length) return;
      sel = 0;
      box = document.createElement('div'); box.className = 'dropdown combo';
      box.innerHTML = items.slice(0, 12).map((p, i) => `<div class="it${i === 0 ? ' sel' : ''}" data-i="${i}"><b dir="auto">${esc(p.name)}</b><small>${esc(p.dob || '')} · ${esc(p.phone || '')}</small></div>`).join('');
      const r = ni.getBoundingClientRect();
      box.style.top = (r.bottom + 2) + 'px'; box.style.left = r.left + 'px'; box.style.minWidth = r.width + 'px';
      box.addEventListener('mousedown', e => { e.preventDefault(); const it = e.target.closest('.it'); if (it) pick(items[+it.dataset.i]); });
      document.body.appendChild(box);
    }, 150);
  });
  ni.addEventListener('keydown', e => {
    if (!box) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); sel = Math.max(0, Math.min(Math.min(items.length, 12) - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
      $$('.it', box).forEach((el, i) => el.classList.toggle('sel', i === sel));
    } else if (e.key === 'Enter') { e.preventDefault(); pick(items[sel]); }
    else if (e.key === 'Escape') close();
  });
  ni.addEventListener('blur', () => setTimeout(close, 150));
  // after the note: Tab goes back to a new line on top
  tr.addEventListener('keydown', e => {
    if (e.target.dataset.l !== 'note' || e.shiftKey || (e.key !== 'Tab' && e.key !== 'Enter')) return;
    e.preventDefault(); e.target.blur();
    const nr = tr.parentNode && tr.parentNode.querySelector('tr.newrow');
    if (nr && nr !== tr) $('[data-l=patient]', nr).focus();
  });
  $('.del', tr).addEventListener('click', () => {
    if (!x.id) { $$('input', tr).forEach(i => { if (i.dataset.l !== 'date') i.value = ''; }); return; }
    if (!confirm('حذف عمل المختبر هذا؟')) return;
    const id = x.id; tr.remove();
    enqueue(() => api('DELETE', '/api/labwork/' + id), labTotal);
  });
  return tr;
}
function labTotal() {
  let sum = 0, rem = 0;
  $$('#labs tbody tr').forEach(tr => { const i = $('[data-l=amount]', tr); if (!i || tr.classList.contains('newrow')) return; sum += Number(cleanNum(i.value)) || 0; rem += tr._rem || 0; });
  const el = $('#lTotal'); if (el) el.textContent = moneyD(sum);
  const p = $('#lPaid'); if (p) p.textContent = moneyD(sum - rem);
  const r = $('#lRem'); if (r) { r.textContent = moneyD(rem); r.classList.toggle('neg', rem > 0); }
}

/* ------------------------------------------------------------ prescription (الوصفة) */
async function renderRx(pid) {
  await loadLists();
  const [pd, meta] = await Promise.all([api('GET', '/api/patient/' + pid), api('GET', '/api/rx?patient=' + pid)]);
  RX = meta;
  const p = pd.patient;
  const docsWithInfo = meta.doctors.filter(d => d.active || d.full_name);
  const st = {
    doctor: meta.last_doctor && docsWithInfo.some(d => d.name === meta.last_doctor) ? meta.last_doctor : (defDoc() || (docsWithInfo[0] || {}).name),
    name: p.name, age: ageOf(p.dob) != null ? String(ageOf(p.dob)) : '', date: todayISO(), drugs: [''], note: '', tpl: null,
  };
  view.innerHTML = `<div class="rxwrap" dir="rtl">
    <div class="card ar rxed">
      <div class="whead"><b>℞ وصفة — <span dir="auto">${esc(p.name)}</span></b><span class="sp"></span><a href="#/p/${pid}" class="small">↩ رجوع للملف</a></div>
      <div class="rxsec"><div class="lab">النماذج</div>
        <div id="tpls" class="tpls"></div>
        <div class="row small" style="margin-top:6px">
          <button class="small" id="tNew">💾 حفظ الوصفة الحالية كنموذج جديد</button>
          <button class="small" id="tUpd" disabled>✎ حفظ التعديل على النموذج</button>
          <button class="small" id="tCopy" disabled>⧉ نسخة من النموذج</button>
          <button class="small danger" id="tDel" disabled>🗑 حذف النموذج</button>
        </div></div>
      <div class="rxgrid">
        <label>الطبيب<select id="rDoc">${docsWithInfo.map(d => `<option value="${esc(d.name)}" ${d.name === st.doctor ? 'selected' : ''}>${esc(d.full_name ? 'د. ' + d.full_name : d.name)}</option>`).join('')}</select></label>
        <label>التاريخ<input type="date" id="rDate" value="${st.date}"></label>
        <label class="w2">الاسم<input id="rName" data-lang="ar" dir="auto" value="${esc(st.name)}"></label>
        <label>العمر<input id="rAge" data-lang="en" value="${esc(st.age)}"></label>
      </div>
      <div class="rxsec"><div class="lab">الأدوية <span class="muted small">— اكتب أول الأحرف لتظهر الأسطر المحفوظة، Enter لسطر جديد</span></div>
        <div id="drugs"></div><button class="small" id="addDrug">+ سطر دواء</button></div>
      <div class="rxsec"><div class="lab">التعليمات</div>
        <select id="noteSel"><option value="">— اختر تعليمات محفوظة —</option>${meta.notes.map((n, i) => `<option value="${i}">${esc(n.slice(0, 80))}${n.length > 80 ? '…' : ''}</option>`).join('')}</select>
        <textarea id="rNote" rows="4" dir="auto"></textarea></div>
      <div class="row" style="margin-top:10px">
        <button class="primary" id="rPrint">🖨 طباعة الوصفة</button>
        <button id="rExtract" title="طباعة ورقة تعليمات ما بعد قلع السن">🦷 تعليمات بعد القلع</button>
        <span class="muted small">تُحفظ الوصفة في سجل المريض عند الطباعة · A5</span>
      </div>
      <div class="rxsec"><div class="lab">وصفات سابقة لهذا المريض</div><div id="rxHist"></div></div>
      <div class="muted small" style="margin-top:8px">أسماء الأطباء وشهاداتهم وعنوان العيادة تُعدّل من Settings ← الوصفة.</div>
    </div>
    <div class="rxprev"><div class="a5" id="a5"></div></div>
  </div>`;
  const drugsBox = $('#drugs');
  const drawDrugs = () => {
    drugsBox.innerHTML = st.drugs.map((d, i) => `<div class="drow"><input data-di="${i}" data-combo="rx_drug" dir="ltr" value="${esc(d)}"><button class="del" data-dx="${i}" tabindex="-1" title="حذف السطر">✕</button></div>`).join('');
  };
  const preview = () => { $('#a5').innerHTML = rxHTML(rxData()); };
  const rxData = () => ({
    doctor: meta.doctors.find(d => d.name === $('#rDoc').value) || {}, name: $('#rName').value, age: $('#rAge').value,
    date: $('#rDate').value, drugs: st.drugs.filter(x => x.trim()), note: $('#rNote').value, title: meta.title, footer: meta.footer,
  });
  const drawTpls = () => {
    $('#tpls').innerHTML = meta.templates.map(t => `<button class="chip tpl ${st.tpl === t.id ? 'on' : ''}" data-t="${t.id}">${esc(t.name)}</button>`).join('') || '<span class="muted small">لا توجد نماذج</span>';
    $$('#tpls [data-t]').forEach(b => b.addEventListener('click', () => {
      const t = meta.templates.find(x => x.id === +b.dataset.t);
      st.tpl = t.id; st.drugs = t.drugs.length ? t.drugs.slice() : ['']; $('#rNote').value = t.note || '';
      drawDrugs(); drawTpls(); preview();
    }));
    ['tUpd', 'tCopy', 'tDel'].forEach(id => $('#' + id).disabled = !st.tpl);
  };
  drawDrugs(); drawTpls(); preview();
  drugsBox.addEventListener('input', e => { const i = e.target.dataset.di; if (i != null) { st.drugs[+i] = e.target.value; preview(); } });
  drugsBox.addEventListener('change', e => { const i = e.target.dataset.di; if (i != null) { st.drugs[+i] = e.target.value; preview(); } });
  drugsBox.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.dataset.di != null && $('#combo').classList.contains('hidden')) {
      e.preventDefault(); st.drugs.splice(+e.target.dataset.di + 1, 0, ''); drawDrugs(); $(`[data-di="${+e.target.dataset.di + 1}"]`).focus();
    }
  });
  drugsBox.addEventListener('click', e => { const x = e.target.dataset.dx; if (x != null) { st.drugs.splice(+x, 1); if (!st.drugs.length) st.drugs = ['']; drawDrugs(); preview(); } });
  $('#addDrug').addEventListener('click', () => { st.drugs.push(''); drawDrugs(); $(`[data-di="${st.drugs.length - 1}"]`).focus(); });
  ['rDoc', 'rName', 'rAge', 'rDate', 'rNote'].forEach(id => { $('#' + id).addEventListener('input', preview); $('#' + id).addEventListener('change', preview); });
  $('#noteSel').addEventListener('change', e => { if (e.target.value !== '') { $('#rNote').value = meta.notes[+e.target.value]; e.target.value = ''; preview(); } });
  const reloadMeta = async () => { const m = await api('GET', '/api/rx?patient=' + pid); Object.assign(meta, m); RX = meta; drawTpls(); drawHist(); };
  $('#tNew').addEventListener('click', async () => {
    const name = prompt('اسم النموذج الجديد:', ''); if (!name) return;
    const r = await api('POST', '/api/rx_template', { name, drugs: st.drugs, note: $('#rNote').value });
    st.tpl = r.id; await reloadMeta(); toast('حُفظ النموذج');
  });
  $('#tUpd').addEventListener('click', async () => {
    const t = meta.templates.find(x => x.id === st.tpl); if (!t) return;
    if (!confirm('حفظ الأدوية والتعليمات الحالية في النموذج «' + t.name + '»؟')) return;
    await api('PUT', '/api/rx_template/' + t.id, { name: t.name, drugs: st.drugs, note: $('#rNote').value }); await reloadMeta(); toast('تم تعديل النموذج');
  });
  $('#tCopy').addEventListener('click', async () => {
    const t = meta.templates.find(x => x.id === st.tpl); if (!t) return;
    const name = prompt('اسم النسخة:', t.name + ' (نسخة)'); if (!name) return;
    const r = await api('POST', '/api/rx_template', { name, drugs: t.drugs, note: t.note }); st.tpl = r.id; await reloadMeta(); toast('أُنشئت نسخة — عدّلها ثم اضغط حفظ التعديل');
  });
  $('#tDel').addEventListener('click', async () => {
    const t = meta.templates.find(x => x.id === st.tpl); if (!t || !confirm('حذف النموذج «' + t.name + '»؟')) return;
    await api('DELETE', '/api/rx_template/' + t.id); st.tpl = null; await reloadMeta(); toast('حُذف النموذج');
  });
  const drawHist = () => {
    $('#rxHist').innerHTML = (meta.history || []).map(h => `<div class="hrow"><span>${fmtDMY(h.date)}</span><span>${esc(docLabel(h.doctor))}</span>
      <span class="muted" dir="ltr">${esc((h.drugs || '').split('\n')[0] || '')}${(h.drugs || '').includes('\n') ? ' …' : ''}</span><span class="sp"></span>
      <button class="small" data-hload="${h.id}">نسخ إلى الوصفة</button><button class="small" data-hprint="${h.id}">🖨</button><button class="small danger" data-hdel="${h.id}">✕</button></div>`).join('') || '<span class="muted small">لا توجد</span>';
    $$('[data-hload]').forEach(b => b.addEventListener('click', () => { const h = meta.history.find(x => x.id === +b.dataset.hload); st.drugs = (h.drugs || '').split('\n'); $('#rNote').value = h.note || ''; st.tpl = null; drawDrugs(); drawTpls(); preview(); }));
    $$('[data-hprint]').forEach(b => b.addEventListener('click', () => { const h = meta.history.find(x => x.id === +b.dataset.hprint); printRx(rxHTML({ doctor: meta.doctors.find(d => d.name === h.doctor) || {}, name: h.name, age: h.age, date: h.date, drugs: (h.drugs || '').split('\n'), note: h.note, title: meta.title, footer: meta.footer })); }));
    $$('[data-hdel]').forEach(b => b.addEventListener('click', async () => { if (!confirm('حذف هذه الوصفة من السجل؟')) return; await api('DELETE', '/api/prescription/' + b.dataset.hdel); await reloadMeta(); }));
  };
  drawHist();
  $('#rExtract').addEventListener('click', () => printRx(extractHTML(RX.extract)));
  $('#rExtract').addEventListener('mouseenter', () => { $('#a5').innerHTML = extractHTML(RX.extract); });
  $('#rExtract').addEventListener('mouseleave', () => preview());
  $('#rPrint').addEventListener('click', async () => {
    const dd = rxData();
    if (!dd.drugs.length && !dd.note.trim()) { toast('الوصفة فارغة', true); return; }
    printRx(rxHTML(dd));
    try {
      await api('POST', '/api/prescription', { patient_id: pid, date: dd.date, doctor: $('#rDoc').value, name: dd.name, age: dd.age, drugs: dd.drugs, note: dd.note });
      await reloadMeta();
    } catch (e) { toast('طُبعت، لكن لم تُحفظ في السجل: ' + e.message, true); }
  });
}
const RX_ORNAMENT = `<svg viewBox="0 0 400 20" preserveAspectRatio="none"><line x1="0" y1="10" x2="186" y2="10" stroke="#000" stroke-width="1.2"/><line x1="214" y1="10" x2="400" y2="10" stroke="#000" stroke-width="1.2"/><path d="M200 3 L207 10 L200 17 L193 10 Z M186 10 L190 7 L190 13 Z M214 10 L210 7 L210 13 Z" fill="#000"/></svg>`;
function rxHTML(d) {
  const doc = d.doctor || {};
  return `<div class="rx" dir="rtl"><div class="rx-frame"><i></i></div>
    <div class="rx-h">
      ${d.title ? `<div class="t1">${esc(d.title)}</div>` : ''}
      <div class="t2">الدكتور</div>
      <div class="t3">${esc(doc.full_name || doc.name || '')}</div>
      ${doc.deg1 ? `<div class="t4">${esc(doc.deg1)}</div>` : ''}
      ${doc.deg2 ? `<div class="t4">${esc(doc.deg2)}</div>` : ''}
      <div class="orn">${RX_ORNAMENT}</div>
    </div>
    <div class="rx-pt"><span><b>الاسم:</b> ${esc(d.name || '')}</span><span><b>العمر:</b> ${esc(d.age || '')}</span><span><b>التاريخ:</b> ${fmtDMY(d.date)}</span></div>
    <div class="rx-r" dir="ltr">R<small>x</small></div>
    <div class="rx-d" dir="ltr">${(d.drugs || []).filter(x => x && x.trim()).map(x => `<div dir="auto">${esc(x)}</div>`).join('')}</div>
    ${d.note ? `<div class="rx-n">${esc(d.note)}</div>` : ''}
    <div class="rx-f">${esc(d.footer || '').replace(/\n/g, '<br>')}</div>
  </div>`;
}
// post-extraction instructions: "# " heading, "= " centred closing line, other lines = items
function extractHTML(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean);
  return `<div class="rx rx-ex" dir="rtl"><div class="rx-frame"><i></i></div>${lines.map(l =>
    l.startsWith('#') ? `<div class="exh">${esc(l.replace(/^#\s*/, ''))}</div>`
      : l.startsWith('=') ? `<div class="exc">${esc(l.replace(/^=\s*/, ''))}</div>`
        : `<div class="exl">${esc(l)}</div>`).join('')}</div>`;
}
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
function rxCss() {
  return Array.from(document.styleSheets).map(ss => { try { return Array.from(ss.cssRules).map(r => r.cssText).filter(t => /\.rx|@page|rx-/.test(t)).join('\n'); } catch (e) { return ''; } }).join('\n');
}
function printRx(html) {
  if (IS_APP && window.ClinicApp.printHtml) {   // the phone app: Android printing (A5), any printer the phone can reach
    window.ClinicApp.printHtml(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>وصفة</title><style>@page{size:A5;margin:0}html,body{margin:0;background:#fff}${rxCss()}</style></head><body>${html}</body></html>`, 'A5');
    return;
  }
  if (IS_IOS) {   // Safari on iPad prints the page itself reliably (AirPrint), not a hidden frame
    let pa = $('#printArea'); if (pa) pa.remove();
    pa = document.createElement('div'); pa.id = 'printArea'; pa.innerHTML = html; document.body.appendChild(pa);
    let st = $('#printStyle'); if (!st) { st = document.createElement('style'); st.id = 'printStyle'; document.head.appendChild(st); }
    st.textContent = '@page{size:A5;margin:0}@media print{body>*:not(#printArea){display:none!important}html,body{margin:0!important;padding:0!important;background:#fff}#printArea{display:block!important}}#printArea{display:none}';
    const done = () => { pa.remove(); st.textContent = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 150);
    return;
  }
  let f = $('#rxFrame');
  if (f) f.remove();
  f = document.createElement('iframe'); f.id = 'rxFrame'; f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(f);
  f.contentDocument.open();
  f.contentDocument.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>وصفة</title><style>@page{size:A5;margin:0}html,body{margin:0;background:#fff}${rxCss()}</style></head><body>${html}</body></html>`);
  f.contentDocument.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); }, 250);
}
// report / debts / expenses "Print" buttons inside the phone app: Android printing of the page (A4)
if (IS_APP && window.ClinicApp.printPage) window.print = () => window.ClinicApp.printPage();

/* ------------------------------------------------------------ cloud sync (Google) */
let CLOUD = null;
async function cloudPoll() {
  try { CLOUD = await api('GET', '/api/sync'); } catch (e) { return; }
  const el = $('#cloud'); if (!el) return;
  let cls = 'off', txt = '☁', tip = 'المزامنة السحابية غير مفعّلة — من Settings';
  if (CLOUD.url && CLOUD.has_token) {
    if (CLOUD.running) { cls = 'busy'; tip = 'جارٍ المزامنة…'; }
    else if (CLOUD.error) { cls = 'bad'; tip = 'لم تنجح آخر مزامنة: ' + CLOUD.error + (CLOUD.last_ok ? '\nآخر نجاح: ' + CLOUD.last_ok : ''); }
    else { cls = CLOUD.pending ? 'busy' : 'ok'; tip = 'آخر مزامنة: ' + (CLOUD.last_ok || '—') + (CLOUD.pending ? '\nبانتظار الرفع: ' + CLOUD.pending : '') + (CLOUD.backup_last ? '\nآخر نسخة كاملة: ' + CLOUD.backup_last : ''); }
    if (CLOUD.pending) txt = '☁ ' + CLOUD.pending;
  }
  el.className = 'cloud ' + cls; el.textContent = txt; el.title = tip;
}
async function cloudNow(backup) {
  if (!CLOUD || !CLOUD.url || !CLOUD.has_token) { toast('المزامنة غير مفعّلة — اضبطها من Settings', true); return; }
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  whenSaved(async () => {
    try { await api('POST', '/api/sync_now', { backup: !!backup }); } catch (e) { toast(e.message, true); return; }
    toast(backup ? 'جارٍ رفع المواعيد ونسخة كاملة…' : 'جارٍ المزامنة…');
    const t0 = Date.now();
    const iv = setInterval(async () => {
      await cloudPoll();
      if (CLOUD && !CLOUD.running && Date.now() - t0 > 1500) {
        clearInterval(iv);
        if (CLOUD.error) toast('لم تنجح المزامنة: ' + CLOUD.error, true);
        else toast(backup ? '✓ تمت المزامنة ورفع النسخة الكاملة — يمكنك إطفاء الجهاز' : '✓ تمت المزامنة');
        if (location.hash === '' || location.hash.startsWith('#/today') || location.hash === '#/') route();
      }
    }, 1000);
  });
}
async function drawCloudSettings() {
  await cloudPoll();
  const c = CLOUD || {};
  $('#cloudBody').innerHTML = `
    <label class="small" style="display:block">رابط السكربت (Web app URL — نشر المزامنة)<input id="cUrl" dir="ltr" value="${esc(c.url || '')}" style="width:100%" placeholder="https://script.google.com/macros/s/…/exec"></label>
    <label class="small" style="display:block;margin-top:6px">رمز المزامنة<input id="cTok" dir="ltr" type="password" placeholder="${c.has_token ? '•••••••• (محفوظ — اكتب رمزاً جديداً لتغييره)' : 'الصق الرمز من سجل setup'}" style="width:100%"></label>
    <div class="row" style="margin-top:8px"><button class="small primary" id="cSave">حفظ</button><button class="small" id="cNow">مزامنة الآن</button><button class="small" id="cBk">مزامنة + نسخة كاملة</button></div>
    <div class="small" style="margin-top:8px;line-height:1.8">
      الحالة: <b>${!c.url || !c.has_token ? 'غير مفعّلة' : c.error ? '<span style="color:var(--warn)">' + esc(c.error) + '</span>' : 'تعمل ✓'}</b><br>
      آخر مزامنة ناجحة: ${esc(c.last_ok || '—')} · بانتظار الرفع: ${c.pending || 0}<br>
      آخر نسخة كاملة على Drive: ${esc(c.backup_last || '—')}</div>`;
  $('#cSave').addEventListener('click', async () => {
    const b = { url: $('#cUrl').value.trim() };
    if ($('#cTok').value.trim()) b.token = $('#cTok').value.trim();
    await api('PUT', '/api/sync_config', b); toast('حُفظ — تبدأ المزامنة خلال دقيقة'); await cloudNow(false); setTimeout(drawCloudSettings, 4000);
  });
  $('#cNow').addEventListener('click', () => { cloudNow(false); setTimeout(drawCloudSettings, 5000); });
  $('#cBk').addEventListener('click', () => { cloudNow(true); setTimeout(drawCloudSettings, 15000); });
}
setInterval(cloudPoll, 30000);

/* ------------------------------------------------------------ the clinic PC and the phone in turn (Google Drive hand-over) */
let PC = null;
async function pcPoll() {
  try { PC = await api('GET', '/api/pc'); } catch (e) { return; }
  const b = $('#pcBadge'), cb = $('#closeBtn'), bar = $('#roBar');
  if (!PC.enabled) { b.classList.add('hidden'); cb.classList.toggle('hidden', !IS_APP); bar.classList.add('hidden'); document.body.classList.remove('readonly'); return; }
  cb.classList.remove('hidden');
  b.classList.remove('hidden');
  const ro = PC.readonly || PC.conflict;
  b.className = 'pcb' + (ro ? ' ro' : PC.offline ? ' off' : '');
  b.textContent = ro ? '🔒 للقراءة فقط' : (PC.phone ? '📱 يعمل على الهاتف' : '💻 يعمل على الحاسبة') + (PC.offline ? ' · بلا إنترنت' : '');
  b.title = 'رقم النسخة على Drive: ' + (PC.seq || 0) + (PC.last_push ? ' · آخر رفع ' + PC.last_push : '') + (PC.error ? '\n' + PC.error : '');
  document.body.classList.toggle('readonly', !!ro);
  bar.classList.toggle('hidden', !ro);
  if (PC.conflict) bar.textContent = '⚠ الجهاز الآخر حفظ بيانات أحدث بينما كان هذا الجهاز بلا إنترنت — أغلق البرنامج هنا وافتحه من جديد لتنزيل أحدث نسخة.';
  else if (PC.readonly) bar.textContent = '🔒 البرنامج انتقل إلى ' + (PC.other || 'الجهاز الآخر') + ' — هذا الجهاز للقراءة فقط. أغلقه وأعد فتحه هنا لاستلام البرنامج.';
}
async function drawPcSettings() {
  await pcPoll();
  const el = $('#pcSet'); if (!el) return;
  if (!PC || !PC.enabled) {
    el.innerHTML = PC && PC.why === 'old_script'
      ? '<span style="color:var(--warn)"><b>التناوب بين الحاسبة والهاتف: غير مفعّل</b> — سكربت Google «مزامنة عيادة د. مهند» ما زال بالنسخة القديمة. انشر Code.gs الجديد (Deploy ← Manage deployments ← Edit ← New version)، ثم أغلق البرنامج وأعد تشغيله.</span>'
      : '<span class="muted">التناوب بين الحاسبة والهاتف: غير مفعّل — يحتاج رابط المزامنة ورمزها في «المزامنة السحابية»، ثم إعادة تشغيل البرنامج.</span>';
    return;
  }
  el.innerHTML = `<b>التناوب بين الحاسبة والهاتف:</b> مفعّل ✓ — هذا الجهاز: <b dir="auto">${esc(PC.me || '')}</b> ${PC.phone ? '(الهاتف)' : '(الحاسبة)'}
    · نسخة Drive رقم <b>${PC.seq || 0}</b>${PC.last_push ? ' · آخر رفع ' + esc(PC.last_push) : ''}${PC.error ? ` · <span style="color:var(--warn)">${esc(PC.error)}</span>` : ''}<br>
    <span class="muted">يرفع البرنامج قاعدة البيانات إلى Google Drive كل دقيقتين وعند الإغلاق. عند فتحه على الجهاز الآخر يستلم أحدث نسخة ويصبح هذا الجهاز للقراءة فقط.</span>
    ${PC.phone ? '' : '<div style="margin-top:4px"><button class="small" id="phLink">📱 ربط تطبيق الهاتف — عرض الرابط والرمز</button> <span id="phLinkBox"></span></div>'}`;
  const b = $('#phLink');
  if (b) b.addEventListener('click', async () => {
    try {
      const r = await api('GET', '/api/phone_link');
      $('#phLinkBox').innerHTML = `<div class="card" style="margin-top:6px;direction:ltr;text-align:left;font-family:monospace;font-size:12px;word-break:break-all">${esc(r.url)}<br><b>${esc(r.token)}</b></div>
        <button class="small" id="phCopy">نسخ الرمز</button> <span class="muted">— أرسله لنفسك بالواتساب والصقه في التطبيق عند أول تشغيل.</span>`;
      $('#phCopy').addEventListener('click', () => { copyText(r.token); toast('نُسخ الرمز'); });
    } catch (e) { toast(e.message, true); }
  });
}
async function closeProgram() {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  if (!confirm('رفع آخر البيانات إلى Google Drive ثم إغلاق البرنامج؟\nبعدها يمكن فتحه على الجهاز الآخر.')) return;
  whenSaved(async () => {
    const ov = document.createElement('div'); ov.className = 'closing'; ov.textContent = '⏳ جارٍ رفع آخر البيانات إلى Google Drive…'; document.body.appendChild(ov);
    try { await api('POST', '/api/shutdown'); } catch (e) { }
    // wait until the server has stopped answering (= the last copy is on Drive)
    for (let i = 0; i < 120; i++) {
      await sleep(1000);
      try { await fetch('/api/pc', { cache: 'no-store' }); } catch (e) { break; }
    }
    ov.innerHTML = '✓ رُفعت البيانات وأُغلق البرنامج.<br>يمكنك فتحه الآن على الجهاز الآخر.';
    if (IS_APP && window.ClinicApp.closeApp) setTimeout(() => window.ClinicApp.closeApp(), 1200);
    else setTimeout(() => { try { window.close(); } catch (e) { } }, 1500);
  });
}
$('#closeBtn').addEventListener('click', closeProgram);
setInterval(pcPoll, 15000);

/* ------------------------------------------------------------ help: guided tour with pointers */
const TOURS = {
  common: [
    ['#q', 'خانة البحث', 'اكتب جزءاً من اسم المريض أو رقم هاتفه أو رقم استمارته، ثم اختر من القائمة بالأسهم و Enter. اختصار: F2 من أي مكان.'],
    ['[data-go="#/today"]', 'مواعيد اليوم', 'جدول المرضى المحجوزين، يدخله السكرتير: الوقت، الاسم، نوع العمل.'],
    ['[data-go="#/new"]', 'اضافة مريض', 'يفتح ملفاً جديداً. اكتب الاسم ثم Tab، وإن وُجد اسم مشابه ينبّهك قبل الإنشاء.'],
    ['[data-go="#/expenses"]', 'المصاريف', 'تسجيل مصاريف العيادة ومجموعها لأي فترة.'],
    ['[data-go="#/labs"]', 'المختبرات', 'أعمال المختبر لكل مريض: الطبيب والأسنان ونوع العمل والمختبر، والمسدد والمتبقي لكل مختبر.'],
    ['[data-go="#/debts"]', 'Debts — الديون', 'قائمة كل من عليه مبلغ، مرتبة من الأكبر.'],
    ['[data-go="#/report"]', 'Report — الوارد', 'المبالغ المستلمة عن الأعمال المنجزة، لكل طبيب على حدة. اختر الأطباء بالمربعات.'],
    ['[data-go="#/review"]', 'Duplicates — التكرار', 'مراجعة المرضى المحتمل تكرارهم: دمج أو شخصان مختلفان.'],
    ['[data-go="#/settings"]', 'Settings — الإعدادات', 'الأطباء، أنواع العمل، المناطق، والنسخ الاحتياطي.'],
    ['#pcBadge', 'الحاسبة أو الهاتف', 'يبيّن الجهاز الذي يعمل عليه البرنامج الآن. البيانات تنتقل بين الحاسبة والهاتف عبر Google Drive.'],
    ['#closeBtn', 'إغلاق', 'يرفع آخر البيانات إلى Google Drive ثم يغلق البرنامج، فيفتح على الجهاز الآخر بأحدث نسخة.'],
    ['#cloud', 'المزامنة السحابية', 'أخضر: المواعيد متزامنة مع Google. أصفر مع رقم: مواعيد بانتظار الرفع. أحمر: لا يوجد إنترنت أو خطأ — العمل يستمر عادياً وتكمل المزامنة وحدها.'],
    ['#net', 'مؤشر الحفظ', 'أخضر: محفوظ. أصفر: جارٍ الحفظ. أحمر: انقطعت الشبكة — لا تغلق الصفحة، يعيد المحاولة تلقائياً.'],
  ],
  patient: [
    ['#alerts .alert', 'تنبيه الحساب', 'يظهر إذا كان على المريض أو أحد أفراد عائلته دين (أحمر)، أو دفع أكثر من أعماله (برتقالي).'],
    ['[data-f=name]', 'الاسم', 'يُكتب بالعربي تلقائياً مهما كانت لغة لوحة المفاتيح.'],
    ['[data-f=form_no]', 'رقم الاستمارة', 'رقم الاستمارة الورقية.'],
    ['[data-f=dob]', 'المواليد', 'سنة الميلاد أو التاريخ الكامل، والعمر يُحسب ويظهر فوقها.'],
    ['[data-f=phone]', 'الهاتف', 'إن كان الرقم مسجلاً لمريض آخر يظهر تنبيه.'],
    ['[data-f=area]', 'العنوان', 'اكتب أول الأحرف واختر من المقترحات، والمنطقة الجديدة تُضاف تلقائياً.'],
    ['[data-f=p_factor]', 'P Factor', 'يلوّن هذا الجزء: A أخضر، B أصفر، C برتقالي، Nego و Debt و X أحمر.'],
    ['#xrayBtn', 'الأشعة', 'أخضر ON: المريض مسجل في برنامج الأشعة. رمادي OFF: غير مسجل. نقرة واحدة للتغيير.'],
    ['#rxBtn', 'الوصفة', 'يفتح صفحة كتابة الوصفة وطباعتها، مع الاسم والعمر والطبيب جاهزة.'],
    ['#copyNA', 'نسخ الاسم والعمر', 'ينسخهما لتلصقهما في الراشيتة بـ Ctrl+V.'],
    ['#pnBtn', 'الملاحظة الخاصة', 'ملاحظة لا تظهر إلا بالضغط على القفل، وتُحفظ أثناء الكتابة.'],
    ['#delPat', 'حذف المريض', 'يحذف الملف كله نهائياً بعد تأكيدين.'],
    ['[data-f=medical]', 'الأمراض والحساسية', 'الأمراض المزمنة والحساسية وصعوبات العلاج. الكتابة بالإنكليزي، و Alt+Shift يحوّلها للعربي.'],
    ['#famLine', 'العائلة', 'زر "+ ربط" يربط المريض بأفراد عائلته، فتظهر ديونهم هنا وفي التنبيه، والضغط على الاسم يفتح ملفه.'],
    ['#totals', 'الحساب', 'مجموع الأسعار، التخفيض، الصافي، المدفوع، والمتبقي. الأرشيف والخطة خارج الحساب.'],
    ['#works tr.newrow', 'سطر الإدخال', 'اكتب هنا العمل الجديد. التاريخ يُملأ تلقائياً، وبعد خانة الطبيب ينتقل لسطر جديد. Ctrl+D أو الضغط على + يكرر آخر عمل.'],
    ['#works thead th:nth-child(5)', 'السعر والتخفيض', 'بالآلاف. "بعد الخصم" يأخذ السعر تلقائياً، عدّله عند التخفيض. المدفوع هو ما دفعه المريض.'],
    ['#works thead th:nth-child(10)', 'الحالة', 'منجز يدخل في الحساب، مخطط (خطة) لا يدخل حتى يُنجز. نقرة للتبديل.'],
    ['#showLegacy', 'الأرشيف', 'إظهار أو إخفاء أعمال الأرشيف القديمة (المالية فيها للاطلاع فقط).'],
  ],
  today: [
    ['#dPrev', 'التنقل بين الأيام', 'السهمان للانتقال يوماً للأمام أو للخلف.'],
    ['#dPick', 'اختيار تاريخ', 'اختر أي يوم من التقويم لحجز مواعيده أو عرضها.'],
    ['#appts thead th:nth-child(2)', 'الوقت', 'الساعة (بعد الظهر) ثم الدقائق بأرباع الساعة.'],
    ['#appts thead th:nth-child(3)', 'الطبيب', 'اختر الطبيب الذي حُجز عنده المريض. لون السطر كله يتبع الطبيب.'],
    ['#appts thead th:nth-child(4)', 'اسم المريض', 'اكتب أول حرفين لتظهر أسماء المرضى المسجلين. "↗ الملف" يفتح ملفه، و"+ ملف جديد" ينشئ ملفاً لمريض جديد.'],
    ['#appts thead th:nth-child(8)', 'نوع العمل والملاحظة', 'نوع العمل بالإنكليزي (Alt+Shift للعربي)، والملاحظة بالعربي.'],
    ['#appts thead th:nth-child(10)', 'الحالة', 'حضر، تأجيل، ألغى. نقرة ثانية تلغي الاختيار.'],
    ['#apCount', 'العدّاد', 'عدد المواعيد والحاضرين والملغاة.'],
    ['#apCloud', 'المزامنة قبل المغادرة', 'يرفع آخر المواعيد ونسخة كاملة من البيانات إلى Google.'],
    ['#apSave', 'الحفظ', 'المواعيد تُحفظ تلقائياً عند كل تغيير، وهذا الزر للتأكيد فقط.'],
  ],
  labs: [['#lFrom', 'الفترة', 'من … إلى، والافتراضي الشهر الحالي.'], ['#labs tr.newrow', 'سطر جديد', 'اكتب اسم المريض واختره من القائمة (يُملأ طبيبه تلقائياً)، ثم الأسنان ونوع العمل والمختبر والمبلغ. المسدد فارغ = مسدد بالكامل.'], ['.owed', 'ديون المختبرات', 'ما بقي لكل مختبر من كل الفترات.']],
  expenses: [['#eFrom', 'الفترة', 'من … إلى، والافتراضي الشهر الحالي. زرّا هذا الشهر والشهر الماضي للاختيار السريع.'], ['#exps tr.newrow', 'سطر جديد', 'التاريخ تلقائي، المادة والمكتب من القائمة أو كتابة جديدة تُحفظ، المبلغ بالآلاف، ومصدر الدفع: الطبيب ومن الدخل أو من جيبه.'], ['.srcsum', 'المجاميع', 'مجموع ما دُفع من الدخل ومن جيب كل طبيب.']],
  rx: [['#tpls', 'النماذج', 'اضغط نموذجاً فيملأ الأدوية والتعليمات. يمكن حفظ وصفة كنموذج جديد، أو تعديل النموذج، أو نسخه، أو حذفه.'], ['#rDoc', 'الطبيب', 'يختار طبيب آخر زيارة تلقائياً، ويمكن تغييره.'], ['#drugs', 'الأدوية', 'كل سطر دواء يُحفظ تلقائياً ويظهر في القائمة عند كتابة أول أحرفه.'], ['#noteSel', 'التعليمات', 'اختر تعليمات محفوظة أو اكتب جديدة.'], ['#a5', 'المعاينة', 'شكل الوصفة كما ستُطبع على ورق A5.'], ['#rPrint', 'الطباعة', 'تطبع الوصفة وتحفظها في سجل المريض.'], ['#rExtract', 'تعليمات بعد القلع', 'تطبع ورقة التعليمات بنفس الإطار. نصّها يُعدّل من Settings ← الوصفة.']],
  debts: [['table.list', 'الديون', 'كل مريض عليه مبلغ، اضغط الاسم لفتح ملفه.']],
  report: [['#rf', 'الفترة', 'اختر من وإلى، فيظهر الوارد لكل طبيب.']],
  review: [['.pair', 'المقارنة', 'السجلان جنباً إلى جنب مع أعمالهما.'], ['.actions', 'القرار', 'دمج (يبقي الأكبر ويضيف إليه)، أو شخصان مختلفان، أو تخطٍّ لاحقاً.']],
  settings: [['.settings', 'القوائم', 'تعديل اسم يغيّره في كل السجلات، وكتابة اسم موجود تدمج الاثنين. "مفعّل" يخفي الاسم من القائمة دون حذف تاريخه.'], ['#bkNow', 'النسخ الاحتياطي', 'نسخة فورية، إضافة للنسخ التلقائي كل 6 ساعات.'], ['#pcSet', 'التناوب', 'حالة انتقال البرنامج بين الحاسبة والهاتف عبر Google Drive.']],
};
function pageKey() {
  const h = location.hash || '#/';
  if (/^#\/p\//.test(h)) return 'patient';
  if (h.startsWith('#/debts')) return 'debts';
  if (h.startsWith('#/report')) return 'report';
  if (h.startsWith('#/review')) return 'review';
  if (h.startsWith('#/settings')) return 'settings';
  if (h.startsWith('#/expenses')) return 'expenses';
  if (h.startsWith('#/labs')) return 'labs';
  if (h.startsWith('#/rx')) return 'rx';
  if (h.startsWith('#/new')) return 'patient';
  return 'today';
}
let TOUR = null;
function startTour(steps) {
  endTour();
  steps = steps.filter(s => !s[0] || ($(s[0]) && $(s[0]).offsetParent !== null));
  if (!steps.length) return;
  const ov = document.createElement('div'); ov.className = 'tour-ov';
  const hl = document.createElement('div'); hl.className = 'tour-hl';
  const tip = document.createElement('div'); tip.className = 'tour-tip'; tip.dir = 'rtl';
  document.body.append(ov, hl, tip);
  TOUR = { ov, hl, tip, steps, i: 0 };
  ov.addEventListener('click', endTour);
  showStep();
}
function showStep() {
  const { hl, tip, steps, i } = TOUR;
  const [sel, title, text, extra] = steps[i];
  const el = sel ? $(sel) : null;
  tip.innerHTML = `<div class="tt">${title}</div><div class="tx">${text}</div>${extra || ''}
    <div class="tb"><span class="muted small">${i + 1} / ${steps.length}</span><span class="sp"></span>
    ${i > 0 ? '<button class="small" data-t="prev">السابق</button>' : ''}
    ${i < steps.length - 1 ? '<button class="small primary" data-t="next">التالي</button>' : '<button class="small primary" data-t="end">إنهاء</button>'}
    ${i < steps.length - 1 ? '<button class="small" data-t="end">إغلاق</button>' : ''}</div>`;
  tip.querySelectorAll('[data-t]').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.t;
    if (t === 'end') return endTour();
    TOUR.i += t === 'next' ? 1 : -1; showStep();
  }));
  tip.className = 'tour-tip';
  if (!el) {
    hl.style.display = 'none';
    tip.classList.add('center');
    tip.style.top = ''; tip.style.left = '';
  } else {
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect(), pad = 5;
    hl.style.display = 'block';
    Object.assign(hl.style, { top: (r.top - pad) + 'px', left: (r.left - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px' });
    const tw = tip.offsetWidth || 340, below = r.bottom + 14 + 170 < window.innerHeight;
    const left = Math.max(10, Math.min(window.innerWidth - tw - 10, r.left + r.width / 2 - tw / 2));
    tip.style.left = left + 'px';
    tip.style.top = (below ? r.bottom + 14 : Math.max(10, r.top - 14 - tip.offsetHeight)) + 'px';
    tip.classList.add(below ? 'below' : 'above');
    tip.style.setProperty('--ax', Math.max(16, Math.min(tw - 16, r.left + r.width / 2 - left)) + 'px');
  }
  const nb = tip.querySelector('[data-t=next],[data-t=end]'); if (nb) nb.focus();
}
function endTour() {
  if (!TOUR) return;
  TOUR.ov.remove(); TOUR.hl.remove(); TOUR.tip.remove(); TOUR = null;
}
document.addEventListener('keydown', e => {
  if (!TOUR) return;
  if (e.key === 'Escape') endTour();
  else if (e.key === 'ArrowLeft' && TOUR.i < TOUR.steps.length - 1) { TOUR.i++; showStep(); }
  else if (e.key === 'ArrowRight' && TOUR.i > 0) { TOUR.i--; showStep(); }
});
window.addEventListener('resize', () => { if (TOUR) showStep(); });
$('#helpBtn').addEventListener('click', () => {
  const k = pageKey();
  startTour((TOURS[k] || []).concat(TOURS.common));
});

// welcome on start-up
function showWelcome() {
  let off = false; try { off = localStorage.getItem('welcomeOff') === '1'; } catch (e) { }
  if (off) return;
  const noMore = `<label class="nomore"><input type="checkbox" id="tourNoMore"> لا تظهر هذه التعليمات عند التشغيل</label>`;
  startTour([
    [null, 'أهلاً بك في ' + ((LISTS.profile || {}).app_title || 'عيادة د. مهند يونس') + ' 🦷', 'جولة سريعة لأهم أجزاء البرنامج. يمكنك إعادتها في أي وقت من زر <b>؟</b> أعلى الشاشة.', noMore],
    ['#q', 'خانة البحث', 'من هنا تصل إلى أي مريض: اكتب جزءاً من اسمه أو رقم هاتفه، ثم اختر من القائمة.'],
    ['[data-go="#/today"]', 'مواعيد اليوم', 'جدول المرضى المحجوزين لليوم أو لأي تاريخ آخر، مع الوقت ونوع العمل وحالة الحضور.'],
    ['#closeBtn', 'إغلاق', 'عند الانتهاء اضغطه: يرفع آخر البيانات إلى Google Drive، فتفتح على الجهاز الآخر (الحاسبة أو الهاتف) بأحدث نسخة.'],
    ['#helpBtn', 'المساعدة', 'في أي صفحة اضغط <b>؟</b> فتظهر شروحات تشير إلى كل جزء فيها.'],
  ]);
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'tourNoMore') { try { localStorage.setItem('welcomeOff', e.target.checked ? '1' : '0'); } catch (err) { } }
  });
}

/* ------------------------------------------------------------ start */
(async function start() {
  try { await loadLists(); } catch (e) { toast('تعذر الاتصال بالبرنامج', true); }
  refreshBadge();
  cloudPoll();
  await pcPoll();
  await route();
  showWelcome();
})();
