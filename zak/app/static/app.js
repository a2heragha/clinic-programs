'use strict';
/* Internal-medicine clinic — browser UI. No external libraries; works offline on the clinic network. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const dmy = iso => iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '';
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const ago = iso => { if (!iso) return ''; const n = daysBetween(iso, todayISO()); if (n <= 0) return 'today'; if (n < 31) return n + ' d ago'; if (n < 365) return Math.round(n / 30.4) + ' mo ago'; return (n / 365).toFixed(1) + ' y ago'; };
const nz = v => v !== null && v !== undefined && v !== '';
const fnum = (v, d = 1) => nz(v) ? String(+Number(v).toFixed(d)) : '';
const isAr = s => /[؀-ۿ]/.test(s || '');
const norm = s => String(s || '').trim().replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/[ً-ْـ]/g, '').replace(/\s+/g, ' ').toLowerCase();

let ME = null, L = { meta: {} }, ROUTE_CLEANUP = null;

/* ------------------------------------------------------------ keyboard language per field
   data-lang="ar": always Arabic (Arabic 101 layout) — name, address, occupation, personal note, search
   every other text field is English · "en+" (medication lines only): English, Alt+Shift switches to Arabic for dosing instructions */
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
document.addEventListener('focusin', e => { const t = e.target; if (t && t.dataset && t.dataset.lang === 'en+') delete t.dataset.cur; }, true);
/* Windows Arabic layout: some keys (B = لا, T/G/Shift-B = لإ/لأ/لآ) emit TWO characters. We cancel the keydown, but the 2nd
   character still arrives on its own (keypress / beforeinput / a code-less keydown) → "bا", "bl"… Swallow any native
   insertion that follows a key we already translated, until the next real key. */
let KB_PEND = 0, KB_OURS = false;
const kbSwallow = e => { if (!KB_OURS && KB_PEND && performance.now() - KB_PEND < 400) { e.preventDefault(); e.stopImmediatePropagation(); return true; } return false; };
document.addEventListener('keypress', kbSwallow, true);
document.addEventListener('beforeinput', e => { if (/^insert(Text|CompositionText|ReplacementText)?$/.test(e.inputType || '')) kbSwallow(e); }, true);
document.addEventListener('keyup', e => { if (e.code && e.code !== 'Unidentified') setTimeout(() => { KB_PEND = 0; }, 0); }, true);
document.addEventListener('keydown', e => {
  const t = e.target;
  if ((!e.code || e.code === 'Unidentified' || e.key === 'Unidentified') && kbSwallow(e)) return;
  if (!/^(Shift|Alt|Control|Meta|CapsLock)$/.test(e.key)) KB_PEND = 0;
  if (t && t.dataset && t.dataset.lang === 'en+' && ((e.key === 'Shift' && (e.altKey || e.ctrlKey)) || ((e.key === 'Alt' || e.key === 'Control') && e.shiftKey))) {
    t.dataset.cur = t.dataset.cur === 'ar' ? 'en' : 'ar'; toast(t.dataset.cur === 'ar' ? 'Typing: Arabic' : 'Typing: English'); return;
  }
  let lang = t && t.dataset && t.dataset.lang;
  if (!lang && t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|search|tel|)$/.test(t.getAttribute('type') || '')))) lang = 'en';   // every field is English unless marked Arabic
  if (lang === 'en+') lang = t.dataset.cur === 'ar' ? 'ar' : 'en';
  if (!lang || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
  const pair = (lang === 'ar' ? AR : EN)[e.code];
  if (!pair) return;
  let shift = e.shiftKey;
  if (lang === 'en' && e.code.startsWith('Key') && e.getModifierState && e.getModifierState('CapsLock')) shift = !shift;
  const ch = pair[shift ? 1 : 0];
  if (e.key === ch) return;
  e.preventDefault();
  KB_OURS = true;
  try { if (!document.execCommand('insertText', false, ch)) { t.setRangeText(ch, t.selectionStart, t.selectionEnd, 'end'); t.dispatchEvent(new Event('input', { bubbles: true })); } }
  finally { KB_OURS = false; }
  KB_PEND = performance.now();
}, true);

/* ------------------------------------------------------------ API + save queue */
class HttpError extends Error { }
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json(); } catch (e) { }
  if (r.status === 401 && !url.endsWith('/login') && !url.endsWith('/me')) { ME = null; showLogin(); }
  if (!r.ok) { const e = new HttpError((data && data.error) || ('Error ' + r.status)); e.status = r.status; throw e; }
  return data;
}
const Q = { items: [], running: false, failing: false };
function enqueue(fn) { Q.items.push(fn); netState(); runQueue(); }
async function runQueue() {
  if (Q.running) return;
  Q.running = true;
  while (Q.items.length) {
    try { await Q.items[0](); Q.items.shift(); Q.failing = false; }
    catch (e) { if (e instanceof HttpError) { Q.items.shift(); toast(e.message, true); } else { Q.failing = true; netState(); await sleep(3000); } }
    netState();
  }
  Q.running = false; netState();
}
function netState() {
  const el = $('#net');
  if (Q.failing) { el.className = 'net bad'; el.textContent = '● Connection lost — ' + Q.items.length + ' unsaved, retrying'; }
  else if (Q.items.length) { el.className = 'net busy'; el.textContent = '● Saving…'; }
  else { el.className = 'net ok'; el.textContent = '● Saved'; }
}
const flushed = () => new Promise(res => { const t = setInterval(() => { if (!Q.items.length && !Q.running) { clearInterval(t); res(); } }, 60); });
window.addEventListener('beforeunload', e => { if (Q.items.length || VIS.timer) { e.preventDefault(); e.returnValue = ''; } });

let toastT;
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), err ? 5000 : 2200);
}
function modal(html, onClose) {
  $('#mbox').innerHTML = html; $('#modal').classList.remove('hidden');
  const close = () => { $('#modal').classList.add('hidden'); $('#mbox').innerHTML = ''; document.removeEventListener('keydown', k, true); onClose && onClose(); };
  const k = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', k, true);
  $$('[data-close]', $('#mbox')).forEach(b => b.onclick = close);
  $('#modal').onmousedown = e => { if (e.target.id === 'modal') close(); };
  return close;
}

/* ------------------------------------------------------------ autocomplete for any input */
function combo(input, source, onPick, opts = {}) {
  const box = $('#combo');
  let items = [], sel = -1;
  const render = () => {
    const r = input.getBoundingClientRect();
    box.style.left = r.left + 'px'; box.style.top = (r.bottom + 2) + 'px'; box.style.width = Math.max(r.width, 260) + 'px';
    box.innerHTML = items.length ? items.map((x, i) => `<div class="it${i === sel ? ' sel' : ''}" data-i="${i}" dir="auto"><span>${esc(x.label || x)}</span>${x.hint ? '<small>' + esc(x.hint) + '</small>' : ''}</div>`).join('') : '';
    box.classList.toggle('hidden', !items.length);
    box.owner = input;
    box.onmousedown = e => { const it = e.target.closest('.it'); if (it) { e.preventDefault(); pick(+it.dataset.i); } };
  };
  const update = async () => { items = await source(input.value); sel = opts.autoSelect && items.length ? 0 : -1; render(); };
  const hide = () => { if (box.owner === input || !input.isConnected) { if (box.owner === input) box.classList.add('hidden'); } items = []; };
  const pick = i => { const x = items[i]; box.classList.add('hidden'); items = []; onPick(x, input); };
  input.addEventListener('input', update);
  input.addEventListener('focus', () => { if (opts.onFocus) update(); });
  input.addEventListener('blur', () => setTimeout(hide, 150));
  input.addEventListener('keydown', e => {
    if (box.classList.contains('hidden') || box.owner !== input) return;
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(-1, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); pick(sel); }
    else if (e.key === 'Escape') hide();
  });
}
function matchList(list, q, max = 12) {
  q = norm(q); if (!q) return [];
  const words = q.split(' ').filter(Boolean);
  const out = [];
  for (const x of list) { const n = norm(x); if (words.every(w => n.includes(w))) { out.push(x); if (out.length >= max) break; } }
  return out;
}

/* ------------------------------------------------------------ calculators (shared by visit + calculator page) */
const C = {
  bmi: (w, h) => w && h ? w / Math.pow(h / 100, 2) : null,
  bmiCat: b => b == null ? '' : b < 18.5 ? 'Underweight' : b < 25 ? 'Normal' : b < 30 ? 'Overweight' : b < 35 ? 'Obese I' : b < 40 ? 'Obese II' : 'Obese III',
  bsa: (w, h) => w && h ? Math.sqrt(w * h / 3600) : null,
  ibw: (h, sex) => h ? (sex === 'F' ? 45.5 : 50) + 0.9055 * (h - 152.4) : null,
  map: (s, d) => s && d ? (s + 2 * d) / 3 : null,
  egfr: (cr, age, sex) => {   // CKD-EPI 2021 (race-free)
    if (!cr || !age || !sex) return null;
    const f = sex === 'F', k = f ? 0.7 : 0.9, a = f ? -0.241 : -0.302;
    return 142 * Math.pow(Math.min(cr / k, 1), a) * Math.pow(Math.max(cr / k, 1), -1.2) * Math.pow(0.9938, age) * (f ? 1.012 : 1);
  },
  ckd: g => g == null ? '' : g >= 90 ? 'G1' : g >= 60 ? 'G2' : g >= 45 ? 'G3a' : g >= 30 ? 'G3b' : g >= 15 ? 'G4' : 'G5',
  crcl: (cr, age, w, sex) => cr && age && w ? ((140 - age) * w) / (72 * cr) * (sex === 'F' ? 0.85 : 1) : null,
  ldlF: (tc, hdl, tg) => tc && hdl && tg && tg < 400 ? tc - hdl - tg / 5 : null,
  homa: (g, ins) => g && ins ? g * ins / 405 : null,
  corrCa: (ca, alb) => ca && alb ? ca + 0.8 * (4 - alb) : null,
  ag: (na, cl, hco3) => na && cl && hco3 ? na - (cl + hco3) : null,
  qtc: (qt, hr) => qt && hr ? qt / Math.sqrt(60 / hr) : null,
  fib4: (age, ast, alt, plt) => age && ast && alt && plt ? (age * ast) / (plt * Math.sqrt(alt)) : null,
  meldna: (cr, bili, inr, na, dial) => {
    if (!cr || !bili || !inr) return null;
    cr = dial ? 4 : Math.min(Math.max(cr, 1), 4); bili = Math.max(bili, 1); inr = Math.max(inr, 1);
    let m = Math.round((0.957 * Math.log(cr) + 0.378 * Math.log(bili) + 1.12 * Math.log(inr) + 0.643) * 10);
    if (na && m > 11) { const n = Math.min(Math.max(na, 125), 137); m = Math.round(m + 1.32 * (137 - n) - 0.033 * m * (137 - n)); }
    return Math.min(m, 40);
  },
};
function ageAt(p, iso) {
  if (!p) return null;
  if (p.dob) { const d = new Date(p.dob), t = new Date((iso || todayISO()) + 'T12:00:00'); let a = t.getFullYear() - d.getFullYear(); if (t < new Date(t.getFullYear(), d.getMonth(), d.getDate())) a--; return a; }
  if (p.birth_year) return (+(iso || todayISO()).slice(0, 4)) - p.birth_year;
  return null;
}

/* ------------------------------------------------------------ boot / auth */
async function boot() {
  if (/[?&]desktop=1/.test(location.search)) localStorageSet('desk', '1');
  if (matchMedia('(max-width: 760px)').matches && localStorageGet('desk') !== '1' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) { location.href = '/m'; return; }   // the phone that runs the program itself always opens the full version
  const me = await api('GET', '/api/me');
  document.title = me.clinic_name || 'Clinic';
  if (me.setup) return showSetup(me);
  if (!me.user) return showLogin(me);
  ME = me.user;
  await loadLists();
  startApp();
}
async function loadLists() {
  L = await api('GET', '/api/lists'); document.title = L.meta.clinic_name || 'Clinic'; applyTheme();
  if (L.user && L.user.role === 'doctor' && L.meta.labreq_seeded !== '1') {   // one time: the built-in lab list becomes an editable list
    await api('POST', '/api/vocab', { kind: 'labreq', items: LAB_REQ }); await api('PUT', '/api/meta', { labreq_seeded: '1' });
    L = await api('GET', '/api/lists');
  }
}
function showSetup(me) {
  $('#top').classList.add('hidden');
  $('#view').innerHTML = `<div class="login"><h1>${esc(me.clinic_name || '')}</h1>
    <p class="muted" style="text-align:center">First run — choose the sign-in PINs (at least 4 digits).</p>
    <div class="row"><label class="grow">Doctor name<input id="dn" value="Dr. Zakariya"></label><label>Doctor PIN<input id="dp" type="password" inputmode="numeric" style="letter-spacing:.2em;font-size:16px;width:110px"></label></div>
    <div class="row" style="margin-top:8px"><label class="grow">Secretary name<input id="sn" value="Secretary"></label><label>Secretary PIN<input id="sp" type="password" inputmode="numeric" style="letter-spacing:.2em;font-size:16px;width:110px"></label></div>
    <button class="primary" id="go" style="width:100%;margin-top:14px;padding:10px">Save</button><div class="err" id="err"></div></div>`;
  $('#go').onclick = async () => {
    try { await api('POST', '/api/setup', { doctor_name: $('#dn').value, doctor_pin: $('#dp').value, secretary_name: $('#sn').value, secretary_pin: $('#sp').value }); boot(); }
    catch (e) { $('#err').textContent = e.message; }
  };
}
async function showLogin() {
  $('#top').classList.add('hidden');
  const me = await api('GET', '/api/me');
  $('#view').innerHTML = `<div class="login"><h1>${esc(me.clinic_name || '')}</h1>
    <p class="muted" style="text-align:center;margin:14px 0 10px">Type your PIN — you are signed in automatically</p>
    <input id="pin" type="password" inputmode="numeric" placeholder="PIN" autocomplete="off" data-lang="en"><div class="err" id="err"></div></div>`;
  const pin = $('#pin');
  let seq = 0, errT;
  pin.focus();
  pin.addEventListener('input', async () => {
    const v = pin.value, my = ++seq;
    $('#err').textContent = ''; clearTimeout(errT);
    if (v.length < 4) return;
    try {
      await api('POST', '/api/login', { pin: v });
      if (my !== seq) return;
      boot();
    } catch (er) {
      if (my !== seq) return;
      if (/many/i.test(er.message)) { $('#err').textContent = er.message; return; }
      errT = setTimeout(() => { if (pin.value === v) { $('#err').textContent = 'Wrong PIN'; pin.select(); } }, 1200);
    }
  });
}
function localStorageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

async function cloudDot() {
  try {
    const z = await api('GET', '/api/sync'), el = $('#cloud');
    if (!z.url) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.className = 'net ' + (z.error ? 'bad' : z.last_ok ? 'ok' : 'busy');
    el.textContent = '☁ ' + (z.error ? 'Offline' : z.last_ok ? 'Online' : '…');
    el.title = z.error ? z.error : 'Online version — last sync ' + (z.last_ok || '');
  } catch (e) { }
}
function startApp() {
  $('#top').classList.remove('hidden');
  if (ME.role === 'doctor') { cloudDot(); setInterval(cloudDot, 30000); healthCheck(); setInterval(healthCheck, 10 * 60000); }
  decorateNav();
  document.body.classList.toggle('sec', ME.role !== 'doctor');
  if (window.pcCheck) { pcCheck(); setInterval(pcCheck, 20000); }
  $('#who').textContent = ME.name + ' ⏻';
  $('#who').onclick = async () => { await flushed(); await api('POST', '/api/logout'); ME = null; location.hash = ''; showLogin(); };
  $$('#nav [data-go]').forEach(b => b.onclick = () => { location.hash = b.dataset.go; });
  if (!location.hash || location.hash === '#') location.hash = '#/today'; else route();
}
window.addEventListener('hashchange', () => { if (ME) route(); });
async function route() {
  await saveVisitNow();
  if (ROUTE_CLEANUP) { ROUTE_CLEANUP(); ROUTE_CLEANUP = null; }
  const h = location.hash.slice(2);
  const [path, qs] = h.split('?');
  const parts = path.split('/');
  const params = Object.fromEntries(new URLSearchParams(qs || ''));
  $$('#nav [data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === '#/' + parts[0]));
  const v = $('#view');
  try {
    if (parts[0] === 'today') return viewToday(v, params.date || todayISO());
    if (parts[0] === 'new') return viewPatientForm(v, null, params);
    if (parts[0] === 'p' && parts[1]) return viewPatient(v, +parts[1], params);
    if (parts[0] === 'edit' && parts[1]) return viewPatientForm(v, +parts[1]);
    if (parts[0] === 'calc') return viewCalc(v, params);
    if (parts[0] === 'log') return viewLog(v, params);
    if (parts[0] === 'settings') return viewSettings(v, params);
    if (parts[0] === 'reg') return viewRegistry(v, params);
    if (parts[0] === 'stats') return viewStats(v, params);
    if (parts[0] === 'money') return viewMoney(v, params);
    location.hash = '#/today';
  } catch (e) { v.innerHTML = '<div class="card">' + esc(e.message) + '</div>'; }
}

/* ------------------------------------------------------------ top search */
(function () {
  const q = $('#q'), box = $('#qres');
  let items = [], sel = 0, t;
  const render = () => {
    box.innerHTML = items.length ? '<div class="it res hd"><span>الاسم</span><span>العمر</span><span>السكن</span><span>الهاتف</span></div>' + items.map((p, i) => `<div class="it res${i === sel ? ' sel' : ''}" data-i="${i}">
      <span class="nm">${esc(p.name)}</span><span>${p.age != null ? p.age : ''}</span><span>${esc(p.address || '')}</span><span dir="ltr">${esc(p.phone || '')}</span></div>`).join('')
      : '<div class="empty">No patient found — <button class="link" id="qnew">add new patient</button></div>';
    box.classList.remove('hidden');
    const nb = $('#qnew'); if (nb) nb.onmousedown = e => { e.preventDefault(); const n = q.value; hide(); location.hash = '#/new?name=' + encodeURIComponent(n); };
  };
  const hide = () => { box.classList.add('hidden'); };
  const open = p => { hide(); q.value = ''; location.hash = '#/p/' + p.id; };
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => { if (!q.value.trim()) return hide(); items = await api('GET', '/api/search?q=' + encodeURIComponent(q.value)); sel = 0; render(); }, 150); });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && items[sel]) open(items[sel]);
    else if (e.key === 'Escape') { hide(); q.blur(); }
  });
  q.addEventListener('blur', () => setTimeout(hide, 150));
  box.onmousedown = e => { const it = e.target.closest('.it[data-i]'); if (it) { e.preventDefault(); open(items[+it.dataset.i]); } };
  document.addEventListener('keydown', e => { if (e.key === 'F2') { e.preventDefault(); q.focus(); q.select(); } });
})();

/* ============================================================ TODAY / waiting list */
/* half-hour appointment slots; the secretary sees only the working hours set in Settings → Appointments */
const WORK_DEF = ['13:00', '21:00'];
const fmtTime = t => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return ((h % 12) || 12) + ':' + String(m || 0).padStart(2, '0') + (h < 12 ? ' AM' : ' PM'); };
function allSlots() { const o = []; for (let h = 0; h < 24; h++) for (const mm of ['00', '30']) o.push(String(h).padStart(2, '0') + ':' + mm); return o; }
function workSlots() { const f = L.meta.work_from || WORK_DEF[0], t = L.meta.work_to || WORK_DEF[1]; return allSlots().filter(x => x >= f && x <= t); }
function timeSelect(id, sel = '', counts = {}, style = '') {
  const work = workSlots(), opt = t => `<option value="${t}"${t === sel ? ' selected' : ''}>${fmtTime(t)}${counts[t] ? '  (' + counts[t] + ' booked)' : ''}</option>`;
  const other = ME.role === 'doctor' ? allSlots().filter(t => !work.includes(t)) : [];
  const odd = sel && !work.includes(sel) && !other.includes(sel) ? opt(sel) : '';
  return `<select id="${id}" style="${style}"><option value="">— no time —</option>${odd}${work.map(opt).join('')}${other.length ? `<optgroup label="Outside working hours">${other.map(opt).join('')}</optgroup>` : ''}</select>`;
}
const ST = { '': 'Booked', waiting: 'Waiting', in: 'With doctor', done: 'Done', noshow: 'No-show' };
async function viewToday(v, date) {
  const rows = await api('GET', '/api/appts?date=' + date);
  const counts = {}; rows.forEach(r => counts[r.status || ''] = (counts[r.status || ''] || 0) + 1);
  v.innerHTML = `<div class="card"><h3>Appointments &amp; waiting list

      <span class="sp"></span><span class="muted small" style="text-transform:none">${rows.length} patients · ${Object.entries(counts).map(([k, n]) => ST[k] + ' ' + n).join(' · ')}</span></h3>
    ${dayBar(date)}
    <div class="row" style="margin-bottom:10px">
      <label class="grow" style="max-width:420px">Patient (search existing, or type a new name)<input id="ap_name" data-lang="ar" dir="rtl" autocomplete="off"></label>
      <label>Phone<input id="ap_phone" data-lang="en" inputmode="tel" style="width:130px"></label>
      <label>Time${timeSelect('ap_time', '', rows.reduce((a, r) => (r.time && (a[r.time] = (a[r.time] || 0) + 1), a), {}), 'width:170px')}</label>
      <label class="grow">Note<input id="ap_note" data-lang="en" dir="auto"></label>
      <button class="primary" id="ap_add">Add</button>
    </div>
    <table class="t" id="tb"><thead><tr><th style="width:34px">#</th><th style="width:80px">Time</th><th>Patient</th><th>Age</th><th style="width:70px">Weight</th><th>Phone</th><th>Note</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr data-id="${r.id}"${r.kind === 'auto' ? ` class="auto call-${r.call || 'none'}"` : ''}>
      <td class="muted">${i + 1}</td><td style="white-space:nowrap">${esc(fmtTime(r.time))}</td>
      <td>${apptBadges(r)}${r.patient_id ? `<a href="#/p/${r.patient_id}" class="ar">${esc(r.pname)}</a>${r.nvisits ? ` <small class="muted">${r.nvisits} visits</small>` : ' <small class="muted">new</small>'}` : `<span class="ar">${esc(r.name || '')}</span> <button class="link small" data-reg="${r.id}">register</button>`}</td>
      <td>${esc(r.age != null ? r.age : '')}</td><td><input class="wt" data-wt inputmode="decimal" data-lang="en" value="${r.weight != null ? r.weight : ''}" placeholder="kg" style="width:60px"></td><td>${esc(r.pphone || r.phone || '')}</td><td dir="auto">${esc(r.note || '')}</td>
      <td><span class="status st-${r.status || ''}">${ST[r.status || '']}</span></td>
      <td class="stbtns" style="white-space:nowrap">
        ${r.status !== 'waiting' && r.status !== 'in' && r.status !== 'done' ? `<button data-st="waiting">Arrived</button>` : ''}
        ${ME.role === 'doctor' && r.patient_id && r.status !== 'done' ? `<button data-st="in" class="primary">Start visit</button>` : ''}
        ${r.status === 'in' ? `<button data-st="done">Done</button>` : ''}
        ${!r.status ? `<button data-st="noshow">No-show</button>` : ''}
        ${r.status ? `<button data-st="" title="Back to booked">↺</button>` : ''}
        ${callBtns(r)}${(r.pphone || r.phone) ? `<button data-wa title="Send a WhatsApp reminder" class="wa">${ic('wa')}</button>` : ''}<button data-up title="Move up">↑</button><button data-del class="danger" title="Remove">✕</button></td></tr>`).join('')}
    ${rows.length ? '' : '<tr><td colspan="9" class="muted">No appointments for this day.</td></tr>'}</tbody></table>
    <div class="actions" style="margin-top:8px"><button id="waTom">${ic('wa')} WhatsApp reminders for ${dmy(addDays(date, 1))}</button><span class="small muted" id="waTomN"></span></div></div>
    <div id="recallBox"></div>`;
  const go = d => location.hash = '#/today?date=' + d;
  bindDayBar(v, date, go, 'appt');
  let picked = null;
  const nm = $('#ap_name');
  combo(nm, async q => q.trim().length < 2 ? [] : (await api('GET', '/api/search?q=' + encodeURIComponent(q))).map(p => ({ label: p.name, hint: (p.age != null ? p.age + 'y · ' : '') + (p.phone || '') + (p.address ? ' · ' + p.address : ''), p })),
    x => { picked = x.p; nm.value = x.p.name; $('#ap_phone').value = x.p.phone || ''; $('#ap_time').focus(); });
  nm.addEventListener('input', () => { picked = null; });
  const add = async () => {
    if (!nm.value.trim()) return nm.focus();
    await api('POST', '/api/appt', { date, patient_id: picked ? picked.id : null, name: nm.value, phone: $('#ap_phone').value, time: $('#ap_time').value, note: $('#ap_note').value });
    viewToday(v, date).then(() => $('#ap_name').focus());
  };
  $('#ap_add').onclick = add;
  $('#waTom').onclick = () => waTomorrow(addDays(date, 1));
  renderRecall(v, date);
  $$('#ap_name,#ap_phone,#ap_time,#ap_note').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter' && $('#combo').classList.contains('hidden')) add(); }));
  $('#tb').addEventListener('change', async e => {
    if (!e.target.hasAttribute('data-wt')) return;
    const id = +e.target.closest('tr').dataset.id, w = e.target.value.trim();
    try { await api('PUT', '/api/appt/' + id, { weight: w === '' ? null : +w }); e.target.classList.add('ok'); toast('Weight saved'); } catch (er) { toast(er.message, true); }
  });
  $('#tb').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.hasAttribute('data-wt')) e.target.blur(); });
  $('#tb').onclick = async e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const id = +tr.dataset.id, r = rows.find(x => x.id === id);
    if (e.target.dataset.st !== undefined) {
      const st = e.target.dataset.st;
      await api('PUT', '/api/appt/' + id, { status: st });
      if (st === 'in') return startVisit(r.patient_id);
      return viewToday(v, date);
    }
    if (e.target.closest('[data-wa]')) { waRemind(r, date); api('PUT', '/api/appt/' + id, { reminded: Date.now() }).catch(() => { }); return; }
    const cb = e.target.closest('[data-call]'); if (cb) { await api('PUT', '/api/appt/' + id, { call: cb.dataset.call }); return viewToday(v, date); }
    if (e.target.closest('[data-hold]')) { await api('PUT', '/api/appt/' + id, { hold: 1 }); toast('Moved to the waiting list'); return viewToday(v, date); }
    if (e.target.hasAttribute('data-del')) { if (confirm('Remove this appointment?')) { await api('DELETE', '/api/appt/' + id); viewToday(v, date); } return; }
    if (e.target.hasAttribute('data-up')) { const ids = rows.map(x => x.id); const i = ids.indexOf(id); if (i > 0) { [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; await api('PUT', '/api/appt_order', { ids }); viewToday(v, date); } return; }
    if (e.target.dataset.reg) { location.hash = '#/new?appt=' + id + '&name=' + encodeURIComponent(r.name || '') + '&phone=' + encodeURIComponent(r.phone || '') + '&by=' + (r.age && +r.age ? new Date().getFullYear() - +r.age : ''); }
  };
  ROUTE_CLEANUP = (() => { const t = setInterval(() => { if (location.hash.startsWith('#/today') && !document.activeElement.closest('#view input')) viewToday(v, date); }, 30000); return () => clearInterval(t); })();
}
async function startVisit(pid) {
  const d = await api('GET', '/api/patient/' + pid);
  const t = (d.visits || []).find(x => x.date === todayISO() && !x.legacy);
  const id = t ? t.id : (await api('POST', '/api/visit', { patient_id: pid })).id;
  location.hash = '#/p/' + pid + '?v=' + id;
}

/* ============================================================ patient form (new / edit) */
const CHRONIC_SUGG = ['Type 2 diabetes', 'Type 1 diabetes', 'Hypertension', 'Dyslipidaemia', 'Ischaemic heart disease', 'Heart failure', 'Atrial fibrillation',
  'Hypothyroidism', 'Hyperthyroidism', 'Asthma', 'COPD', 'CKD', 'Chronic liver disease', 'Hepatitis B', 'Stroke / TIA', 'Epilepsy', 'Rheumatoid arthritis', 'Gout',
  'Osteoporosis', 'Depression', 'Anxiety', 'IBS', 'GERD', 'Peptic ulcer', 'Iron deficiency anaemia', 'Obesity', 'BPH'];
const ALLERGY_SUGG = ['Penicillin', 'Amoxicillin', 'Cephalosporins', 'Sulfa drugs', 'Aspirin', 'NSAIDs', 'Ibuprofen', 'Diclofenac (Voltaren)', 'Dexamethasone',
  'Metformin', 'ACE inhibitors (cough)', 'Contrast media', 'Iodine', 'Latex', 'Egg', 'Peanut', 'Seafood'];
async function viewPatientForm(v, pid, params = {}) {
  const dr = ME.role === 'doctor';
  let p = { gender: '', name: params.name || '', phone: params.phone || '' };
  if (pid) p = (await api('GET', '/api/patient/' + pid)).patient;
  const by = pid ? (p.birth_year || (p.dob ? p.dob.slice(0, 4) : '')) : (params.by || '');
  v.innerHTML = `<div class="card" style="max-width:1100px"><h3>${pid ? 'Edit patient' : 'New patient'}<span class="sp"></span>${pid ? `<button data-back>← Back to file</button>` : ''}</h3>
    <div class="row">
      <label class="grow" style="min-width:320px">Full name (Arabic)<input id="f_name" data-lang="ar" dir="rtl" value="${esc(p.name)}" style="font-size:16px"></label>
      <label>Gender<select id="f_gender"><option value=""></option><option value="M"${p.gender === 'M' ? ' selected' : ''}>Male</option><option value="F"${p.gender === 'F' ? ' selected' : ''}>Female</option></select></label>
      <label>Birth year<input id="f_birth_year" data-lang="en" inputmode="numeric" maxlength="4" placeholder="1975" style="width:80px" value="${esc(by)}"></label>
      <span id="f_agehint" class="muted small" style="padding-bottom:7px;min-width:50px"></span>
      <label>Phone<input id="f_phone" data-lang="en" inputmode="tel" style="width:140px" value="${esc(p.phone || '')}"></label>
    </div>
    <div class="row" style="margin-top:8px">
      <label>Address (السكن)<input id="f_address" data-lang="ar" dir="rtl" autocomplete="off" style="width:260px" value="${esc(p.address || '')}"></label>
      <label>Occupation (العمل)<input id="f_occupation" data-lang="ar" dir="rtl" autocomplete="off" style="width:200px" value="${esc(p.occupation || '')}"></label>
      <label>Marital<select id="f_marital">${['', 'Single', 'Married', 'Widowed', 'Divorced'].map(x => `<option${p.marital === x ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
    </div>
    <div id="simil" class="small" style="margin-top:6px"></div>
    ${dr ? `<div class="row" style="margin-top:10px;align-items:start">
      <label class="grow">Chronic diseases <span class="muted">(one per line)</span><textarea id="f_chronic" rows="3" data-lang="en">${esc(p.chronic || '')}</textarea></label>
      <label class="grow">Allergies <span class="muted">(one per line)</span><textarea id="f_allergies" rows="3" data-lang="en" style="color:var(--warn);font-weight:600">${esc(p.allergies || '')}</textarea></label>
      <label class="grow">Regular medications<textarea id="f_long_meds" rows="3" data-lang="en" dir="auto">${esc(p.long_meds || '')}</textarea></label></div>
    <div class="row" style="margin-top:8px;align-items:start">
      <label>Smoking<select id="f_smoking">${['', 'Never', 'Current', 'Ex-smoker'].map(x => `<option${p.smoking === x ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Alcohol<select id="f_alcohol">${['', 'No', 'Occasional', 'Regular'].map(x => `<option${p.alcohol === x ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Height (cm)<input id="f_height" inputmode="decimal" style="width:80px" value="${esc(p.height || '')}"></label>
      <label class="grow">Past / surgical / family history<textarea id="f_past_history" rows="2" data-lang="en">${esc(p.past_history || '')}</textarea></label>
      <label class="grow">Personal note (Arabic, private)<textarea id="f_personal_note" rows="2" data-lang="ar" dir="rtl">${esc(p.personal_note || '')}</textarea></label></div>
    <div class="small muted" style="margin-top:4px">Quick add: ${CHRONIC_SUGG.slice(0, 12).map(x => `<button class="link small" data-ch="${esc(x)}">${esc(x)}</button>`).join('')} · Allergy: ${ALLERGY_SUGG.slice(0, 7).map(x => `<button class="link small" data-al="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}
    <div class="actions"><label class="wbox">${ic('scale')}Weight today (kg)<input id="f_wt" data-lang="en" inputmode="decimal" style="width:80px"></label>
      <button class="primary" id="save">${pid ? 'Save' : 'Save patient'}</button>
      ${!pid && params.appt ? '' : (!pid ? `<button id="saveBook">Save + add to today's list</button>` : '')}
      ${pid && dr ? `<span class="sp" style="flex:1"></span><button class="danger" id="del">Delete patient</button>` : ''}</div></div>`;
  const back = $('[data-back]'); if (back) back.onclick = () => location.hash = '#/p/' + pid;
  $('#f_name').focus();
  const ageHint = () => { const y = +$('#f_birth_year').value; $('#f_agehint').textContent = y > 1900 && y <= new Date().getFullYear() ? (new Date().getFullYear() - y) + ' y' : ''; };
  $('#f_birth_year').addEventListener('input', ageHint); ageHint();
  combo($('#f_address'), q => matchList(L.areas || [], q, 12), x => { $('#f_address').value = x; $('#f_occupation').focus(); });
  combo($('#f_occupation'), q => matchList(L.occupations || [], q, 12), x => { $('#f_occupation').value = x; });
  $$('[data-ch]').forEach(b => b.onclick = () => addLine('#f_chronic', b.dataset.ch));
  $$('[data-al]').forEach(b => b.onclick = () => addLine('#f_allergies', b.dataset.al));
  if (dr) {
    combo($('#f_chronic'), q => matchList(CHRONIC_SUGG, q.split('\n').pop()), x => replaceLastLine('#f_chronic', x));
    combo($('#f_allergies'), q => matchList(ALLERGY_SUGG, q.split('\n').pop()), x => replaceLastLine('#f_allergies', x));
  }
  let st;
  const checkSim = () => { clearTimeout(st); st = setTimeout(async () => {
    if (!$('#f_name')) return;
    const r = await api('GET', `/api/similar?name=${encodeURIComponent($('#f_name').value)}&phone=${encodeURIComponent($('#f_phone').value)}${pid ? '&exclude=' + pid : ''}`);
    if (!$('#simil')) return;
    $('#simil').innerHTML = r.length ? '<b style="color:var(--amber)">Possible existing file:</b> ' + r.map(x => `<a href="#/p/${x.id}" class="ar">${esc(x.name)}</a> <span class="muted">(${x.age != null ? x.age + 'y, ' : ''}${esc(x.phone || '')} — ${x.why})</span>`).join(' · ') : '';
  }, 400); };
  $('#f_name').addEventListener('input', checkSim); $('#f_phone').addEventListener('input', checkSim); if (!pid && p.name) checkSim();
  const collect = () => {
    const b = {}; ['name', 'gender', 'birth_year', 'phone', 'address', 'occupation', 'marital'].concat(dr ? ['chronic', 'allergies', 'long_meds', 'smoking', 'alcohol', 'height', 'past_history', 'personal_note'] : [])
      .forEach(k => b[k] = $('#f_' + k).value);
    return b;
  };
  const save = async book => {
    const b = collect(); if (!b.name.trim()) { toast('Name is required', true); return; }
    const yr = +b.birth_year; if (b.birth_year && (!(yr > 1900) || yr > new Date().getFullYear())) { toast('Birth year must be 4 digits, e.g. 1975', true); $('#f_birth_year').focus(); return; }
    try {
      const r = pid ? await api('PUT', '/api/patient/' + pid, b) : await api('POST', '/api/patient', b);
      loadLists();
      if (params.appt) await api('PUT', '/api/appt/' + params.appt, { patient_id: r.id });
      if (book) await api('POST', '/api/appt', { date: todayISO(), patient_id: r.id, name: b.name, phone: b.phone, status: 'waiting' });
      const wt = $('#f_wt').value.trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[٫,]/, '.');
      if (wt) await api('POST', '/api/weight', { patient_id: r.id, weight: wt });
      toast('Saved'); location.hash = book || params.appt ? '#/today' : '#/p/' + r.id;
    } catch (e) { toast(e.message, true); }
  };
  $('#save').onclick = () => save(false);
  const sb = $('#saveBook'); if (sb) sb.onclick = () => save(true);
  const del = $('#del'); if (del) del.onclick = async () => { if (confirm('Delete this patient and ALL his visits and labs? This cannot be undone.')) { await api('DELETE', '/api/patient/' + pid); location.hash = '#/today'; } };
}
function addLine(sel, text) { const t = $(sel); const ls = t.value.split('\n').map(x => x.trim()).filter(Boolean); if (!ls.includes(text)) ls.push(text); t.value = ls.join('\n'); }
function replaceLastLine(sel, text) { const t = $(sel); const ls = t.value.split('\n'); ls[ls.length - 1] = text; t.value = ls.join('\n') + '\n'; t.focus(); }

/* ============================================================ patient file */
let P = null;          // current patient data {patient, visits, labs}
const VIS = { id: null, pending: {}, timer: null };
async function saveVisitNow() {
  if (VIS.timer) { clearTimeout(VIS.timer); VIS.timer = null; flushVisit(); }
  await flushed();
}
function flushVisit() {
  VIS.timer = null;
  const id = VIS.id, b = VIS.pending; VIS.pending = {};
  if (!id || !Object.keys(b).length) return;
  enqueue(() => api('PUT', '/api/visit/' + id, b));
}
function visitChanged(k, val) {
  VIS.pending[k] = val;
  const v = P && P.visits.find(x => x.id === VIS.id); if (v) v[k] = val;
  clearTimeout(VIS.timer); VIS.timer = setTimeout(flushVisit, 700);
}

async function viewPatient(v, pid, params) {
  const d = await api('GET', '/api/patient/' + pid);
  if (!d) { v.innerHTML = '<div class="card">Patient not found.</div>'; return; }
  if (ME.role !== 'doctor') return viewPatientBasic(v, d);
  P = d;
  const p = d.patient;
  const vid = params.v ? +params.v : (d.visits.find(x => x.date === todayISO()) || {}).id || (d.visits[0] || {}).id;
  const lines = s => (s || '').split('\n').map(x => x.trim()).filter(Boolean);
  v.innerHTML = `<div class="card"><div class="phead">
      <div class="pname">${esc(p.name)}</div>
      <div class="facts">${p.age != null ? p.age + ' y' : 'age ?'} · ${p.gender === 'M' ? 'Male' : p.gender === 'F' ? 'Female' : '—'} · ${esc(p.phone || 'no phone')} · <span class="ar">${esc(p.address || '')}</span>${p.occupation ? ' · ' + esc(p.occupation) : ''}</div>
      <span style="flex:1"></span>
      <span class="muted small">File #${p.id} · ${d.visits.length} visits${d.visits.length ? ' since ' + dmy(d.visits[d.visits.length - 1].date) : ''}</span>
      <button id="editP">Edit file</button><button id="expP" class="small" title="The whole file as a PDF for a referral">${ic('pdf')} Export file</button><button id="mergeP" class="small" title="Merge a duplicate file into this one">Merge…</button></div>
    <div class="flags">
      ${lines(p.allergies).length ? lines(p.allergies).map(x => `<span class="flag allergy">⚠ Allergy: ${esc(x)}</span>`).join('') : '<span class="muted small">No known allergies recorded</span>'}
      ${lines(p.chronic).map(x => `<span class="flag chronic">${esc(x)}</span>`).join('')}
      ${/^current/i.test(p.smoking || '') ? '<span class="flag smoke">Smoker</span>' : /^ex/i.test(p.smoking || '') ? '<span class="flag smoke">Ex-smoker</span>' : ''}
      ${lines(p.long_meds).length ? `<span class="flag meds" title="${esc(p.long_meds)}">Regular meds: ${lines(p.long_meds).length}</span>` : ''}
      ${p.personal_note ? `<span class="flag smoke ar" title="Personal note">🔒 ${esc(p.personal_note)}</span>` : ''}
    </div><div class="famline" id="famLine"></div><div id="linker" class="linker hidden"></div></div>
  <div class="pgrid">
    <div class="card"><h3>Visits<span class="sp"></span><button class="primary small" id="newV">+ New visit</button></h3><div class="vlist" id="vlist"></div></div>
    <div id="vedit"></div>
    <div class="side"><div class="card due" id="dueCard"></div><div class="card sum" id="summary"></div><div class="card" id="wtCard"></div><div class="card" id="famHx"></div><div class="card" id="filesCard"></div><div class="card" id="labsCard"></div></div>
  </div>`;
  $('#editP').onclick = () => location.hash = '#/edit/' + pid;
  $('#mergeP').onclick = () => mergeDialog(p);
  $('#expP').onclick = () => exportFile();
  $('#newV').onclick = async () => { await saveVisitNow(); const r = await api('POST', '/api/visit', { patient_id: pid }); location.hash = '#/p/' + pid + '?v=' + r.id; };
  renderFamily(d);
  renderVisitList(vid);
  renderSummary(vid);
  renderLabs();
  renderFiles();
  renderWeight(); renderFamHx();
  if (vid) openVisit(vid); else $('#vedit').innerHTML = '<div class="card muted">No visits yet. Press <b>+ New visit</b> to start.</div>';
  const paste = e => {   // Ctrl+V of a screenshot / scanned image attaches it to the file
    if ($('#modal').classList.contains('hidden') === false) return;
    const fs = Array.from((e.clipboardData || {}).files || []).filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
    if (fs.length) { e.preventDefault(); uploadFiles(fs); }
  };
  document.addEventListener('paste', paste);
  const keys = e => {
    if (e.ctrlKey && e.key.toLowerCase() === 'p' && VIS.id) { e.preventDefault(); printRx(); }
    if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); $('#newV').click(); }
  };
  document.addEventListener('keydown', keys);
  ROUTE_CLEANUP = () => { document.removeEventListener('keydown', keys); document.removeEventListener('paste', paste); VIS.id = null; };
}
const FAM_REL = ['Father', 'Mother', 'Son', 'Daughter', 'Husband', 'Wife', 'Brother', 'Sister', 'Grandfather', 'Grandmother', 'Grandson', 'Granddaughter', 'Uncle', 'Aunt', 'Nephew', 'Niece', 'Cousin'];
function renderFamily(d) {
  const box = $('#famLine'), lk = $('#linker'); if (!box) return;
  const p = d.patient, fam = d.family || [], doc = ME.role === 'doctor';
  const reload = () => route();
  box.innerHTML = `<span class="muted small">Family:</span> ` + fam.map(f => `<span class="fchip${f.direct ? '' : ' ind'}" title="${esc(f.chronic ? 'Chronic: ' + f.chronic : '')}">
      <a href="#/p/${f.id}" class="ar">${esc(f.name)}</a> <small>${esc(f.relation)}</small>${doc && f.chronic ? ' <small class="fchr">● ' + esc(f.chronic).slice(0, 40) + '</small>' : ''}
      ${f.direct ? `<button class="link small" data-unl="${f.link_id}" title="Unlink">✕</button>` : ''}</span>`).join('') +
    `<button class="link small" id="famAdd">+ Link family member</button><span id="famSug"></span>`;
  api('GET', '/api/family_suggest/' + p.id).then(sg => {
    if (!sg.length || !$('#famSug')) return;
    $('#famSug').innerHTML = ' <span class="muted small">Same phone:</span> ' + sg.map(x => `<button class="small" data-sug="${x.id}" data-nm="${esc(x.name)}">+ <span class="ar">${esc(x.name)}</span></button>`).join(' ');
  }).catch(() => {});
  const open = (pre) => {
    lk.classList.remove('hidden');
    lk.innerHTML = `<div class="row"><label class="grow">Family member<input id="lkN" data-lang="ar" dir="rtl" autocomplete="off" value="${esc(pre ? pre.name : '')}"></label>
      <label>is the … of <b class="ar">${esc(p.name)}</b><input id="lkR" list="lkRL" data-lang="en" style="width:150px"><datalist id="lkRL">${FAM_REL.map(r => `<option value="${r}">`).join('')}</datalist></label>
      <button class="primary" id="lkOk">Link</button><button id="lkX">Cancel</button></div>`;
    let pick = pre || null;
    combo($('#lkN'), async q => q.trim().length < 2 ? [] : (await api('GET', '/api/search?q=' + encodeURIComponent(q))).filter(x => x.id !== p.id).map(x => ({ label: x.name, hint: '#' + x.id + ' · ' + (x.age != null ? x.age + 'y · ' : '') + (x.phone || '') + (x.address ? ' · ' + x.address : ''), p: x })),
      x => { pick = { id: x.p.id, name: x.p.name }; $('#lkN').value = x.p.name; $('#lkR').focus(); }, { autoSelect: true });
    $('#lkN').addEventListener('input', () => { pick = null; });
    $(pre ? '#lkR' : '#lkN').focus();
    $('#lkX').onclick = () => lk.classList.add('hidden');
    $('#lkOk').onclick = async () => {
      if (!pick) { toast('Choose the patient from the list', true); return $('#lkN').focus(); }
      try { await api('POST', '/api/link', { a_id: pick.id, b_id: p.id, relation: $('#lkR').value.trim() }); toast('Linked'); reload(); } catch (e) { toast(e.message, true); }
    };
  };
  box.onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'famAdd') return open();
    if (b.dataset.sug) return open({ id: +b.dataset.sug, name: b.dataset.nm });
    if (b.dataset.unl && confirm('Remove this family link?')) { await api('DELETE', '/api/link/' + b.dataset.unl); reload(); }
  };
}
function renderVisitList(vid) {
  $('#vlist').innerHTML = P.visits.map(x => `<div class="v${x.id === vid ? ' on' : ''}${x.legacy ? ' legacy' : ''}" data-v="${x.id}">
    <div class="d">${dmy(x.date)} <span class="muted small" style="font-weight:400">${ago(x.date)}</span></div>
    <div class="x" dir="auto">${esc((x.diagnosis || x.complaint || x.notes || '').split('\n')[0] || '—')}</div></div>`).join('') || '<div class="muted small">—</div>';
  $('#vlist').onclick = e => { const it = e.target.closest('[data-v]'); if (it) location.hash = '#/p/' + P.patient.id + '?v=' + it.dataset.v; };
}

function openVisit(vid) {
  const x = P.visits.find(y => y.id === vid);
  if (!x) return;
  VIS.id = vid; VIS.pending = {};
  const p = P.patient;
  const today = x.date === todayISO();
  $('#vedit').innerHTML = `<div class="card">
    <h3>Visit ${dmy(x.date)}${x.legacy ? ' <span class="muted small" style="text-transform:none">(imported from the old program)</span>' : ''}<span class="sp"></span>
      <label class="small muted" style="text-transform:none">Date <input type="date" data-k="date" value="${x.date}"></label>
      <label class="small muted" style="text-transform:none">Price ×1000 <input data-k="price" inputmode="numeric" style="width:60px" title="In thousands: 15 = 15,000 IQD" value="${x.price != null ? x.price : ''}"></label>
      <select data-k="fee_type" title="Fee" style="text-transform:none;width:auto">${[['', 'Paid'], ['review', 'Review (مراجعة)'], ['free', 'Free']].map(([k, l]) => `<option value="${k}"${(x.fee_type || '') === k ? ' selected' : ''}>${l}</option>`).join('')}</select></h3>
    <div class="vitals">
      ${[['bp_sys', 'BP sys'], ['bp_dia', 'BP dia'], ['hr', 'Pulse'], ['rr', 'RR'], ['temp', 'Temp °C'], ['spo2', 'SpO₂ %'], ['rbs', 'RBS mg/dL'], ['weight', 'Weight kg'], ['height', 'Height cm'], ['waist', 'Waist cm']]
        .map(([k, l]) => `<label>${l}<input data-k="${k}" inputmode="decimal" value="${x[k] != null ? fnum(x[k], 2) : ''}"></label>`).join('')}
    </div>
    <div class="chips" id="vchips"></div>
    <div class="soap">
      <div class="k">S<small>Complaint</small></div><textarea data-k="complaint" rows="3" data-lang="en" dir="auto" placeholder="Chief complaint, history of present illness">${esc(x.complaint || '')}</textarea>
      <div class="k">O<small>Exam</small></div><textarea data-k="exam" rows="2" data-lang="en" dir="auto" placeholder="Examination findings">${esc(x.exam || '')}</textarea>
      <div class="k">A<small>Diagnosis</small></div><div><textarea data-k="diagnosis" rows="2" data-lang="en" placeholder="One diagnosis per line (suggestions appear while typing)" style="font-weight:600">${esc(x.diagnosis || '')}</textarea></div>
      <div class="k">P<small>Plan</small></div><textarea data-k="plan" rows="2" data-lang="en" dir="auto" placeholder="Plan, investigations, advice">${esc(x.plan || '')}</textarea>
      ${x.notes || x.legacy ? `<div class="k" style="font-size:13px">N<small>Notes</small></div><div>${x.legacy && x.notes ? `<button class="small" type="button" id="togNotes">Show original old note</button>` : ''}<textarea data-k="notes" id="notesTa" rows="${Math.min(10, Math.max(3, (x.notes || '').split('\n').length + 1))}" data-lang="en" dir="auto" style="${x.legacy && x.notes ? 'display:none;margin-top:6px;background:var(--amber-bg)' : ''}">${esc(x.notes || '')}</textarea></div>` : ''}
    </div>
    <div class="card" style="margin:12px 0 0;background:var(--card-2)">
      <h3>℞ Medications<span class="sp"></span>
        <select id="tpl" style="text-transform:none"><option value="">Templates…</option>${(L.templates || []).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select>
        <button class="small" id="copyLast" title="Copy the medications of the previous visit">Copy last visit</button>
        <button class="small" id="saveTpl">Save as template</button></h3>
      <div id="rxAlerts"></div><div class="meds" id="meds"></div>
      <div class="row" style="margin-top:6px"><label>Follow-up<input type="date" data-k="follow_up" value="${x.follow_up || ''}"></label>
        ${[7, 14, 30, 60, 90].map(n => `<button class="small" data-fu="${n}">${n < 30 ? n + ' d' : n / 30 + ' mo'}</button>`).join('')}</div>
    </div>
    <div class="actions">
      <button class="primary" id="pRx" title="Ctrl+P">🖨 Prescription</button>
      <button id="pLab">Lab request</button><button id="pEcho">Echo request</button><button id="pRef">Referral</button><button id="pRep">Medical report</button><button id="pSick">Sick leave</button><button id="pAi" class="aibtn" title="AI suggestions for today from the history and what is typed now">${ic('spark')} AI suggestions</button><button id="pSum" title="Arabic summary of this visit for the patient">${ic('tpl')} Patient summary</button>
      <button id="addLabs">+ Add lab results</button>
      <button id="toCalc">Calculators</button>
      <span style="flex:1"></span><button class="danger small" id="delV">Delete visit</button>
    </div><div id="aiPlanBox"></div></div>`;
  const root = $('#vedit');
  $$('[data-k]', root).forEach(el => {
    const k = el.dataset.k;
    el.addEventListener('input', () => {
      let val = el.value;
      visitChanged(k, val);
      if (['bp_sys', 'bp_dia', 'hr', 'rr', 'temp', 'spo2', 'rbs', 'weight', 'height', 'waist'].includes(k)) vitalsChips();
      if (k === 'fee_type' && val === 'free') { const pr = $('[data-k=price]', root); pr.value = 0; }
      if (k === 'diagnosis' || k === 'complaint') renderVisitList(VIS.id);
    });
    if (k === 'date') el.addEventListener('change', () => { saveVisitNow().then(() => reloadPatient()); });
    if (k === 'diagnosis') {
      el.addEventListener('blur', () => { if (el.value.trim()) { VIS.pending.commit_dx = 1; visitChanged('diagnosis', el.value); } });
      combo(el, q => matchList(L.diagnoses || [], q.split('\n').pop(), 10), pick => { const ls = el.value.split('\n'); ls[ls.length - 1] = pick; el.value = ls.join('\n'); visitChanged('diagnosis', el.value); el.focus(); });
    }
  });
  $$('[data-fu]', root).forEach(b => b.onclick = () => { const i = $('[data-k=follow_up]', root); i.value = addDays(todayISO(), +b.dataset.fu); visitChanged('follow_up', i.value); });
  renderMeds(x.meds || []);
  vitalsChips(); rxCheck();
  $('#tpl').onchange = e => { const t = (L.templates || []).find(y => y.id === +e.target.value); e.target.value = ''; if (!t) return;
    const cur = currentMeds(); t.lines.forEach(l => { if (!cur.includes(l)) cur.push(l); }); renderMeds(cur); saveMeds();
    if (t.diagnosis) { const el = $('[data-k=diagnosis]', root); if (!el.value.includes(t.diagnosis)) { el.value = (el.value ? el.value.trim() + '\n' : '') + t.diagnosis; visitChanged('diagnosis', el.value); } }
    if (t.plan) { const el = $('[data-k=plan]', root); if (!el.value.includes(t.plan)) { el.value = (el.value ? el.value.trim() + '\n' : '') + t.plan; visitChanged('plan', el.value); } }
    for (const k of ['complaint', 'exam']) if (t[k]) { const el = $(`[data-k=${k}]`, root); if (!el.value.includes(t[k])) { el.value = (el.value ? el.value.trim() + '\n' : '') + t[k]; visitChanged(k, el.value); } }
    if (t.follow_days) { const el = $('[data-k=follow_up]', root); if (!el.value) { el.value = addDays(x.date, +t.follow_days); visitChanged('follow_up', el.value); } } };
  $('#copyLast').onclick = () => { const prev = P.visits.find(y => y.id !== VIS.id && y.date <= x.date && (y.meds || []).length); if (!prev) return toast('No previous medications');
    const cur = currentMeds(); prev.meds.forEach(l => { if (!cur.includes(l)) cur.push(l); }); renderMeds(cur); saveMeds(); toast('Copied from ' + dmy(prev.date)); };
  $('#saveTpl').onclick = () => templateDialog({ name: ($('[data-k=diagnosis]', root).value.split('\n')[0] || ''), lines: currentMeds(), diagnosis: '', plan: '' });
  $('#pRx').onclick = printRx; $('#pLab').onclick = labRequestDialog; $('#pEcho').onclick = echoDialog; $('#pRep').onclick = reportDialog; $('#pRef').onclick = referralDialog; $('#pSick').onclick = sickDialog; $('#pSum').onclick = printSummaryAr; $('#pAi').onclick = aiPlan;
  $('#addLabs').onclick = () => addLabsDialog(x.date);
  $('#toCalc').onclick = () => location.hash = '#/calc?p=' + p.id + '&v=' + x.id;
  $('#delV').onclick = async () => { if (!confirm('Delete this visit (' + dmy(x.date) + ')?')) return; await saveVisitNow(); await api('DELETE', '/api/visit/' + x.id); location.hash = '#/p/' + p.id; };
  const tn = $('#togNotes', root);
  if (tn) tn.onclick = () => { const ta = $('#notesTa', root); const show = ta.style.display === 'none'; ta.style.display = show ? '' : 'none'; tn.textContent = show ? 'Hide original old note' : 'Show original old note'; };
  if (today && !x.complaint && !x.legacy) setTimeout(() => { const f = $('[data-k=bp_sys]', root); f && f.focus(); }, 50);
}
async function reloadPatient() { const vid = VIS.id; P = await api('GET', '/api/patient/' + P.patient.id); renderVisitList(vid); renderSummary(vid); renderLabs(); renderFiles(); renderWeight(); renderFamHx(); vitalsChips(); }

/* ------------------------------------------------------------ attached investigations (image / PDF) */
function renderFiles() {
  const fs = P.files || [];
  $('#filesCard').innerHTML = `<h3>Investigation files<span class="sp"></span><label class="small primary" style="text-transform:none;cursor:pointer;background:var(--accent);color:#fff;border-radius:6px;padding:2px 8px">+ Image / PDF<input type="file" id="fUp" accept="image/*,application/pdf" multiple hidden></label></h3>
    <div id="fDrop" class="drop">${fs.length ? `<div class="thumbs">${fs.map(f => `<div class="th" data-f="${f.id}" title="${esc((f.title || f.name || '') + ' — ' + dmy(f.date))}">
        ${f.mime === 'application/pdf' ? '<div class="pdf">PDF</div>' : `<img src="/api/file/${f.id}" loading="lazy" alt="">`}<div class="cap">${dmy(f.date).slice(0, 5)} ${esc(f.title || '')}</div></div>`).join('')}</div>`
      : '<div class="muted small">Drop scans or photos here, press + Image / PDF, or paste a screenshot (Ctrl+V).</div>'}</div>`;
  $('#fUp').onchange = e => { uploadFiles(Array.from(e.target.files)); e.target.value = ''; };
  const d = $('#fDrop');
  d.ondragover = e => { e.preventDefault(); d.classList.add('over'); };
  d.ondragleave = () => d.classList.remove('over');
  d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); uploadFiles(Array.from(e.dataTransfer.files)); };
  $$('[data-f]', d).forEach(t => t.onclick = () => fileDialog(fs.find(f => f.id === +t.dataset.f)));
}
async function fileToPayload(f) {
  if (f.type === 'application/pdf' || !f.type.startsWith('image/') || f.type === 'image/heic') {
    const buf = new Uint8Array(await f.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
    return { mime: f.type || 'application/octet-stream', data: btoa(bin) };
  }
  // photos are reduced to max 2200 px (enough to read a lab report) to keep the database folder small
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(f); });
  const k = Math.min(1, 2200 / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] };
}
async function uploadFiles(list) {
  list = list.filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
  if (!list.length) return toast('Only images or PDF files', true);
  const v = P.visits.find(x => x.id === VIS.id);
  toast('Uploading ' + list.length + ' file(s)…');
  for (const f of list) {
    try { const pl = await fileToPayload(f); await api('POST', '/api/file', Object.assign(pl, { patient_id: P.patient.id, visit_id: VIS.id, date: (v && v.date) || todayISO(), name: f.name, title: f.name.replace(/\.[^.]+$/, '').slice(0, 40) })); }
    catch (e) { toast((f.name || 'file') + ': ' + e.message, true); }
  }
  await reloadPatient(); toast('Attached');
}
function fileDialog(f) {
  const url = '/api/file/' + f.id;
  const close = modal(`<h2><input id="fT" value="${esc(f.title || '')}" placeholder="What is it? (CBC, echo report …)" data-lang="en" dir="auto" style="flex:1"><input type="date" id="fD" value="${f.date}">
      <a href="${url}" target="_blank"><button>Open full size</button></a><button id="fAi" title="Read the lab values from this sheet (needs the AI key in Settings)">${ic('spark')} Read lab values</button><button class="danger" id="fDel">Delete</button><button data-close>✕</button></h2>
    ${f.mime === 'application/pdf' ? `<iframe src="${url}" style="width:100%;height:72vh;border:1px solid var(--line);border-radius:6px"></iframe>` : `<img src="${url}" style="max-width:100%;max-height:74vh;display:block;margin:auto">`}
    <div class="muted small" style="margin-top:6px">${esc(f.name || '')} · ${Math.round((f.size || 0) / 1024)} KB · added by ${esc(f.created_by || '')}</div>`);
  const save = () => api('PUT', '/api/file/' + f.id, { title: $('#fT').value, date: $('#fD').value }).then(reloadPatient);
  $('#fT').addEventListener('change', save); $('#fD').addEventListener('change', save);
  $('#fDel').onclick = async () => { if (!confirm('Delete this file?')) return; await api('DELETE', '/api/file/' + f.id); close(); reloadPatient(); };
  $('#fAi').onclick = () => { close(); aiReadLabs(f); };
}

function currentMeds() { return $$('#meds input').map(i => i.value.trim()).filter(Boolean); }
function renderMeds(list) {
  const box = $('#meds');
  box.innerHTML = list.concat(['']).map((m, i) => `<div class="m"><span class="n">${i + 1}.</span><input value="${esc(m)}" data-lang="en" dir="auto" placeholder="${i === list.length ? 'Type a drug — previous prescriptions are suggested' : ''}"><button class="small" data-mu="${i}" title="Move up">↑</button><button class="small danger" data-md="${i}" title="Remove">✕</button></div>`).join('');
  $$('input', box).forEach((inp, i) => {
    combo(inp, q => matchList(L.drugs || [], q, 14), pick => { inp.value = pick; onMedEdit(i, true); });
    inp.addEventListener('input', () => onMedEdit(i));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && $('#combo').classList.contains('hidden')) { e.preventDefault(); const nx = $$('#meds input')[i + 1]; nx && nx.focus(); } });
  });
  box.onclick = e => {
    const cur = $$('#meds input').map(i => i.value.trim());
    if (e.target.dataset.md !== undefined) { cur.splice(+e.target.dataset.md, 1); renderMeds(cur.filter(Boolean)); saveMeds(); }
    if (e.target.dataset.mu !== undefined) { const i = +e.target.dataset.mu; if (i > 0 && cur[i]) { [cur[i - 1], cur[i]] = [cur[i], cur[i - 1]]; renderMeds(cur.filter(Boolean)); saveMeds(); } }
  };
}
function onMedEdit(i, picked) {
  const inputs = $$('#meds input');
  if (i === inputs.length - 1 && inputs[i].value.trim()) {   // typing in the empty last row adds a new empty row
    const cur = inputs.map(x => x.value); renderMeds(cur.filter((x, j) => x.trim() || j === i));
    const inp = $$('#meds input')[i]; inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
    if (picked) { const nx = $$('#meds input')[i + 1]; nx && nx.focus(); }
  } else if (picked) { const nx = $$('#meds input')[i + 1]; nx && nx.focus(); }
  saveMeds();
}
function saveMeds() { visitChanged('meds', currentMeds()); rxCheck(); }

function latestLab(code, beforeIso) {
  const xs = P.labs.filter(l => l.code === code && l.value != null && (!beforeIso || l.date <= beforeIso));
  return xs.length ? xs[xs.length - 1] : null;
}
function vitalsChips() {
  const x = P.visits.find(y => y.id === VIS.id); if (!x) return;
  const p = P.patient, g = k => { const el = $(`#vedit [data-k=${k}]`); return el && el.value !== '' ? +el.value : null; };
  const w = g('weight'), h = g('height') || p.height, s = g('bp_sys'), d = g('bp_dia'), spo2 = g('spo2'), hr = g('hr'), t = g('temp'), rbs = g('rbs');
  const age = ageAt(p, x.date);
  const chips = [];
  const bmi = C.bmi(w, h);
  if (bmi) chips.push([`BMI <b>${bmi.toFixed(1)}</b> ${C.bmiCat(bmi)}`, bmi >= 30 || bmi < 18.5 ? 'abn' : bmi >= 25 ? 'mid' : '']);
  const bsa = C.bsa(w, h); if (bsa) chips.push([`BSA <b>${bsa.toFixed(2)}</b> m²`, '']);
  if (s && d) chips.push([`MAP <b>${Math.round(C.map(s, d))}</b>`, '']);
  if (s && d) { const c = s >= 180 || d >= 120 ? ['Hypertensive crisis', 'abn'] : s >= 140 || d >= 90 ? ['Stage 2 HTN range', 'abn'] : s >= 130 || d >= 80 ? ['Stage 1 HTN range', 'mid'] : s < 90 ? ['Low BP', 'abn'] : ['BP normal', '']; chips.push([c[0], c[1]]); }
  const cr = latestLab('CREAT', x.date);
  if (cr) { const e = C.egfr(cr.value, ageAt(p, cr.date), p.gender); if (e) chips.push([`eGFR <b>${Math.round(e)}</b> ${C.ckd(e)} <span class="muted">(Cr ${cr.value}, ${dmy(cr.date)})</span>`, e < 30 ? 'abn' : e < 60 ? 'mid' : '']);
    const cc = C.crcl(cr.value, age, w, p.gender); if (cc) chips.push([`CrCl <b>${Math.round(cc)}</b> mL/min`, cc < 30 ? 'abn' : cc < 60 ? 'mid' : '']); }
  if (!p.gender && cr) chips.push(['Set gender in the file to calculate eGFR', 'mid']);
  const ibw = C.ibw(h, p.gender); if (ibw && h) chips.push([`IBW <b>${ibw.toFixed(0)}</b> kg`, '']);
  $('#vchips').innerHTML = chips.map(([t, c]) => `<span class="chip ${c}">${t}</span>`).join('');
  const flag = (k, bad) => { const el = $(`#vedit [data-k=${k}]`); if (el) el.classList.toggle('abn', !!bad); };
  flag('bp_sys', s && (s >= 140 || s < 90)); flag('bp_dia', d && (d >= 90 || d < 50)); flag('spo2', spo2 && spo2 < 94); flag('hr', hr && (hr > 100 || hr < 50));
  flag('temp', t && (t >= 37.8 || t < 35.5)); flag('rbs', rbs && (rbs >= 200 || rbs < 70));
}

/* ------------------------------------------------------------ previous-visits summary (rule based) */
function renderSummary(vid) {
  const cur = P.visits.find(y => y.id === vid);
  const before = P.visits.filter(y => y.id !== vid && (!cur || y.date <= cur.date));
  const last = before[0];
  const medsV = before.find(y => (y.meds || []).length);
  const dxCount = {};
  P.visits.forEach(y => (y.diagnosis || '').split(/\n/).map(s => s.trim()).filter(Boolean).forEach(s => { const k = s.toLowerCase(); dxCount[k] = dxCount[k] || { n: 0, label: s, last: y.date }; dxCount[k].n++; }));
  const dxs = Object.values(dxCount).sort((a, b) => b.n - a.n || (b.last > a.last ? 1 : -1)).slice(0, 8);
  const keyCodes = ['HBA1C', 'FBS', 'LDL', 'TG', 'CREAT', 'TSH', 'HB', 'FERRITIN', 'VITD', 'ALT'];
  const keyLabs = keyCodes.map(c => [c, latestLab(c)]).filter(x => x[1]);
  const lastBP = before.find(y => y.bp_sys);
  const lastW = before.find(y => y.weight);
  const tests = Object.fromEntries((L.lab_tests || []).map(t => [t.code, t]));
  renderDue(vid);
  $('#summary').innerHTML = `<h3>${ic('history')} Summary before this visit<span class="sp"></span><button class="small" id="aiSum" title="AI summary of all previous visits (needs the AI key in Settings)">${ic('spark')} AI summary</button></h3><div id="aiSumBox"></div>${!last ? '<div class="muted small">First visit — no previous history.</div>' : `<dl>
    <dt>Last visit</dt><dd>${dmy(last.date)} <span class="muted">(${ago(last.date)})</span></dd>
    ${last.diagnosis ? `<dt>Diagnosis</dt><dd dir="auto"><b>${esc(last.diagnosis)}</b></dd>` : ''}
    ${last.plan ? `<dt>Plan given</dt><dd dir="auto">${esc(last.plan)}</dd>` : ''}
    ${last.follow_up ? `<dt>Follow-up</dt><dd>${dmy(last.follow_up)}</dd>` : ''}
    ${medsV ? `<dt>Last meds</dt><dd dir="auto">${medsV.meds.map(m => esc(m)).join('<br>')} <span class="muted small">(${dmy(medsV.date)})</span></dd>` : ''}
    ${dxs.length ? `<dt>Problems</dt><dd dir="auto">${dxs.map(d => esc(d.label) + (d.n > 1 ? ` <span class="muted">×${d.n}</span>` : '')).join(' · ')}</dd>` : ''}
    ${lastBP ? `<dt>Last BP</dt><dd>${lastBP.bp_sys}/${lastBP.bp_dia || '?'} <span class="muted">(${dmy(lastBP.date)})</span></dd>` : ''}
    ${lastW ? `<dt>Last weight</dt><dd>${fnum(lastW.weight)} kg <span class="muted">(${dmy(lastW.date)})</span></dd>` : ''}
    ${keyLabs.length ? `<dt>Key labs</dt><dd>${keyLabs.map(([c, l]) => `<span class="${labCls(tests[c], l.value)}">${esc((tests[c] || {}).name || c)} ${fnum(l.value, 2)}</span> <span class="muted small">${dmy(l.date).slice(3)}</span>`).join('<br>')}</dd>` : ''}
  </dl>`}`;
  $('#aiSum').onclick = aiSummary;
}
function labCls(t, v) { if (!t || v == null) return ''; if (t.high != null && v > t.high) return 'lab-hi'; if (t.low != null && v < t.low) return 'lab-lo'; return ''; }

/* ------------------------------------------------------------ labs panel + charts */
function derivedSeries(code) {
  const p = P.patient;
  if (code === 'EGFR') return P.labs.filter(l => l.code === 'CREAT' && l.value).map(l => ({ date: l.date, value: Math.round(C.egfr(l.value, ageAt(p, l.date), p.gender) || 0), source: 'calc' })).filter(x => x.value);
  if (code === 'BP') return P.visits.filter(v => v.bp_sys).map(v => ({ date: v.date, value: v.bp_sys, value2: v.bp_dia })).reverse();
  if (code === 'WT') return P.visits.filter(v => v.weight).map(v => ({ date: v.date, value: v.weight })).reverse();
  return P.labs.filter(l => l.code === code && l.value != null).map(l => ({ date: l.date, value: l.value, source: l.source, id: l.id }));
}
function renderLabs() {
  const tests = L.lab_tests || [];
  const have = tests.filter(t => P.labs.some(l => l.code === t.code) || (t.code === 'EGFR' && P.patient.gender && P.labs.some(l => l.code === 'CREAT')));
  const extra = [];
  if (P.visits.some(v => v.bp_sys)) extra.push({ code: 'BP', name: 'Blood pressure', unit: 'mmHg', high: 140, target: 130 });
  if (P.visits.some(v => v.weight)) extra.push({ code: 'WT', name: 'Weight', unit: 'kg' });
  const rows = extra.concat(have).map(t => {
    const s = derivedSeries(t.code); if (!s.length) return '';
    const a = s[s.length - 1], b = s.length > 1 ? s[s.length - 2] : null;
    const val = t.code === 'BP' ? a.value + '/' + (a.value2 || '?') : fnum(a.value, 2);
    const dir = b && a.value !== b.value ? (a.value > b.value ? 'arrow-up' : 'arrow-dn') : '';
    return `<tr class="click" data-c="${t.code}"><td>${esc(t.name)}</td><td class="num ${labCls(t, a.value).replace('lab-', '')} ${a.source === 'imported' ? 'imp' : ''} ${dir}">${val}</td>
      <td class="muted small">${dmy(a.date)}</td><td>${s.length > 1 ? sparkline(s, t) : ''}</td></tr>`;
  }).join('') + (() => {   // text results (Positive / Negative …) — latest of each test
    const last = {}; P.labs.filter(l => l.value == null && l.text).forEach(l => { if (!last[l.code] || l.date >= last[l.code].date) last[l.code] = l; });
    return Object.values(last).map(l => { const t = tests.find(x => x.code === l.code) || { name: l.code };
      return `<tr><td>${esc(t.name)}</td><td class="num" dir="auto">${esc(l.text)}</td><td class="muted small">${dmy(l.date)}</td><td></td></tr>`; }).join('');
  })();
  $('#labsCard').innerHTML = `<h3>Labs &amp; trends<span class="sp"></span><button class="small" id="lAdd">+ Add</button></h3>
    ${rows ? `<table class="t labtbl"><tbody>${rows}</tbody></table><div class="legend">Click a row for the chart. <i>Italic</i> = read from old notes — please verify. Red = high, blue = low.</div>` : '<div class="muted small">No lab results yet.</div>'}`;
  $('#lAdd').onclick = () => addLabsDialog((P.visits.find(v => v.id === VIS.id) || {}).date || todayISO());
  $$('#labsCard tr[data-c]').forEach(tr => tr.onclick = () => chartDialog(tr.dataset.c));
}
function sparkline(s, t) {
  const W = 70, H = 20, xs = s.slice(-12), vals = xs.map(p => p.value), mn = Math.min(...vals), mx = Math.max(...vals), r = mx - mn || 1;
  const pts = xs.map((p, i) => [(i / (xs.length - 1)) * (W - 4) + 2, H - 2 - ((p.value - mn) / r) * (H - 4)]);
  return `<svg class="spark" width="${W}" height="${H}"><polyline fill="none" stroke="#1d4f8a" stroke-width="1.5" points="${pts.map(p => p.join(',')).join(' ')}"/>${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="1.8" fill="${labCls(t, xs[i].value) ? '#b4233c' : '#1d4f8a'}"/>`).join('')}</svg>`;
}
function lineChart(s, t, W = 820, H = 300) {
  const pad = { l: 46, r: 14, t: 14, b: 34 };
  const t0 = new Date(s[0].date).getTime(), t1 = new Date(s[s.length - 1].date).getTime(), span = Math.max(t1 - t0, 864e5 * 10);
  const vals = s.flatMap(p => [p.value, p.value2]).filter(v => v != null).concat([t.low, t.high, t.target].filter(v => v != null));
  let mn = Math.min(...vals), mx = Math.max(...vals); const r0 = (mx - mn) || Math.abs(mx) || 1; mn -= r0 * 0.12; mx += r0 * 0.12; if (mn < 0 && Math.min(...s.map(p => p.value)) >= 0) mn = 0;
  const X = d => pad.l + ((new Date(d).getTime() - t0) / span) * (W - pad.l - pad.r);
  const Y = v => pad.t + (1 - (v - mn) / (mx - mn)) * (H - pad.t - pad.b);
  const ticks = 5, yt = Array.from({ length: ticks + 1 }, (_, i) => mn + (mx - mn) * i / ticks);
  let g = `<svg width="100%" viewBox="0 0 ${W} ${H}" style="max-width:${W}px;font:11px Segoe UI,Arial">`;
  if (t.low != null || t.high != null) { const yh = Y(t.high != null ? Math.min(t.high, mx) : mx), yl = Y(t.low != null ? Math.max(t.low, mn) : mn); g += `<rect x="${pad.l}" y="${yh}" width="${W - pad.l - pad.r}" height="${Math.max(0, yl - yh)}" fill="#e8f6ec"/>`; }
  yt.forEach(v => { g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#eef1f4"/><text x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end" fill="#687586">${+v.toFixed(v < 10 ? 1 : 0)}</text>`; });
  if (t.target != null) g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(t.target)}" y2="${Y(t.target)}" stroke="#2c7a3f" stroke-dasharray="6 4" stroke-width="1.5"/><text x="${W - pad.r - 4}" y="${Y(t.target) - 4}" text-anchor="end" fill="#2c7a3f">target ${t.target}</text>`;
  const nt = Math.min(s.length, 7); const step = Math.max(1, Math.floor(s.length / nt));
  s.forEach((p, i) => { if (i % step === 0 || i === s.length - 1) g += `<text x="${X(p.date)}" y="${H - 12}" text-anchor="middle" fill="#687586">${dmy(p.date).slice(3)}</text>`; });
  const path = k => s.filter(p => p[k] != null).map((p, i) => (i ? 'L' : 'M') + X(p.date).toFixed(1) + ' ' + Y(p[k]).toFixed(1)).join(' ');
  g += `<path d="${path('value')}" fill="none" stroke="#1d4f8a" stroke-width="2"/>`;
  if (s.some(p => p.value2 != null)) g += `<path d="${path('value2')}" fill="none" stroke="#8a5a00" stroke-width="2"/>`;
  s.forEach(p => {
    const bad = labCls(t, p.value);
    g += `<circle cx="${X(p.date)}" cy="${Y(p.value)}" r="4.5" fill="${p.source === 'imported' ? '#fff' : bad ? '#b4233c' : '#1d4f8a'}" stroke="${bad ? '#b4233c' : '#1d4f8a'}" stroke-width="2"><title>${dmy(p.date)}: ${p.value}${p.value2 ? '/' + p.value2 : ''}${p.source === 'imported' ? ' (from old notes)' : ''}</title></circle>`;
    g += `<text x="${X(p.date)}" y="${Y(p.value) - 9}" text-anchor="middle" fill="${bad ? '#b4233c' : '#1c2633'}" font-weight="600">${fnum(p.value, 2)}</text>`;
    if (p.value2 != null) g += `<circle cx="${X(p.date)}" cy="${Y(p.value2)}" r="4" fill="#8a5a00"><title>${p.value2}</title></circle><text x="${X(p.date)}" y="${Y(p.value2) + 16}" text-anchor="middle" fill="#8a5a00">${p.value2}</text>`;
  });
  return g + '</svg>';
}
function chartDialog(code) {
  const tests = L.lab_tests || [];
  const t = code === 'BP' ? { code, name: 'Blood pressure (systolic / diastolic)', unit: 'mmHg', high: 140, target: 130 } : code === 'WT' ? { code, name: 'Weight', unit: 'kg' } : tests.find(x => x.code === code);
  const s = derivedSeries(code);
  const close = modal(`<h2>${esc(t.name)} <span class="muted small">${esc(t.unit || '')}${t.low != null || t.high != null ? ' · normal ' + (t.low != null ? t.low : '') + '–' + (t.high != null ? t.high : '') : ''}</span><span class="sp"></span>
      <select id="chSel">${[['BP', 'Blood pressure'], ['WT', 'Weight']].concat(tests.map(x => [x.code, x.name])).map(([c, n]) => `<option value="${c}"${c === code ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select><button data-close>✕</button></h2>
    ${s.length ? lineChart(s, t) : '<p class="muted">No values.</p>'}
    ${s.length && !['BP', 'WT', 'EGFR'].includes(code) ? `<table class="t" style="margin-top:8px"><thead><tr><th>Date</th><th>Value</th><th>Source</th><th></th></tr></thead><tbody>${s.slice().reverse().map(p => `<tr><td>${dmy(p.date)}</td><td class="${labCls(t, p.value)}">${p.value}</td><td class="muted small">${p.source === 'imported' ? 'read from old notes' : p.source}</td><td><button class="small danger" data-dl="${p.id}">Delete</button></td></tr>`).join('')}</tbody></table>` : ''}
    ${code === 'EGFR' ? '<p class="muted small">Calculated from each creatinine with CKD-EPI 2021 (age at the test date, gender from the file).</p>' : ''}`);
  $('#chSel').onchange = e => { close(); chartDialog(e.target.value); };
  $$('[data-dl]').forEach(b => b.onclick = async () => { await api('DELETE', '/api/lab/' + b.dataset.dl); P.labs = P.labs.filter(l => l.id !== +b.dataset.dl); renderLabs(); close(); chartDialog(code); });
}
function addLabsDialog(date) {
  const tests = (L.lab_tests || []).filter(t => t.code !== 'EGFR');
  const groups = {}; tests.forEach(t => (groups[t.grp] = groups[t.grp] || []).push(t));
  const close = modal(`<h2>Add lab results<span class="sp"></span><label class="small">Test date <input type="date" id="lDate" value="${date}"></label><button data-close>✕</button></h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:4px 16px">
    ${Object.entries(groups).map(([g, ts]) => `<div><div class="muted small" style="font-weight:700;margin-top:6px">${esc(g)}</div>${ts.map(t => `<div class="row" style="align-items:center;flex-wrap:nowrap;margin:2px 0"><span style="flex:1;font-size:13px">${esc(t.name)}</span><input data-c="${t.code}" inputmode="decimal" style="width:80px;text-align:right"><span class="muted small" style="width:70px">${esc(t.unit || '')}</span></div>`).join('')}</div>`).join('')}
    </div>
    <div class="muted small" style="font-weight:700;margin-top:12px">Other tests <span style="font-weight:400">— any test not in the list above (it is added to the list for next time)</span></div>
    <table class="t oth"><thead><tr><th>Test name</th><th>Result</th><th>Unit</th><th>Normal from</th><th>to</th><th></th></tr></thead><tbody id="othT"></tbody></table>
    <button class="small" id="othAdd" style="margin-top:4px">+ Another test</button>
    <div class="foot"><span class="muted small" style="margin-right:auto">Only filled boxes are saved. Tab moves to the next box.</span><button data-close>Cancel</button><button class="primary" id="lSave">Save results</button></div>`);
  const othRow = () => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input data-o="name" data-lang="en" placeholder="e.g. Anti-CCP" style="width:100%"></td><td><input data-o="value" data-lang="en" style="width:90px" placeholder="value or text"></td>
      <td><input data-o="unit" data-lang="en" style="width:80px"></td><td><input data-o="low" inputmode="decimal" style="width:65px"></td><td><input data-o="high" inputmode="decimal" style="width:65px"></td><td><button class="small danger" data-ox>✕</button></td>`;
    $('#othT').appendChild(tr);
    const nm = $('[data-o=name]', tr);
    combo(nm, q => (L.lab_tests || []).filter(t => norm(t.name).includes(norm(q)) || t.code.toLowerCase().includes(q.toLowerCase())).slice(0, 10).map(t => ({ label: t.name, hint: t.unit || '', t })), x => {
      nm.value = x.t.name; $('[data-o=unit]', tr).value = x.t.unit || ''; $('[data-o=low]', tr).value = x.t.low != null ? x.t.low : ''; $('[data-o=high]', tr).value = x.t.high != null ? x.t.high : ''; $('[data-o=value]', tr).focus(); });
    $('[data-ox]', tr).onclick = () => tr.remove();
    return tr;
  };
  othRow(); $('#othAdd').onclick = () => $('[data-o=name]', othRow()).focus();
  $('[data-c]', $('#mbox')).focus();
  $('#lSave').onclick = async () => {
    const items = $$('#mbox [data-c]').filter(i => i.value.trim()).map(i => ({ code: i.dataset.c, value: i.value.trim() }));
    for (const tr of $$('#othT tr')) {     // other tests: reuse a test of the same name, or create it
      const g = k => $(`[data-o=${k}]`, tr).value.trim(), name = g('name'), val = g('value');
      if (!name || !val) continue;
      const ex = (L.lab_tests || []).find(t => norm(t.name) === norm(name) || t.code === name.toUpperCase());
      const code = ex ? ex.code : (name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'TEST') + (ex ? '' : '');
      const meta = { name };
      if (g('unit')) meta.unit = g('unit'); if (g('low')) meta.low = g('low'); if (g('high')) meta.high = g('high'); if (!ex) meta.grp = 'Other';
      await api('PUT', '/api/lab_test/' + encodeURIComponent(code), meta);
      items.push({ code, value: val });
    }
    if (!items.length) return close();
    await loadLists();
    await api('POST', '/api/lab', { patient_id: P.patient.id, visit_id: VIS.id, date: $('#lDate').value, items });
    close(); toast(items.length + ' results saved'); reloadPatient();
  };
}
function mergeDialog(p) {
  const close = modal(`<h2>Merge a duplicate file into <span class="ar">${esc(p.name)}</span><span class="sp"></span><button data-close>✕</button></h2>
    <p class="small muted">All visits, labs and appointments of the other file move to this file, then the other file is deleted.</p>
    <input id="mq" data-lang="ar" dir="rtl" placeholder="Search the duplicate file" style="width:100%"><div id="mres" style="margin-top:8px"></div>`);
  $('#mq').value = p.name; const run = async () => {
    const r = (await api('GET', '/api/search?q=' + encodeURIComponent($('#mq').value))).filter(x => x.id !== p.id);
    $('#mres').innerHTML = r.map(x => `<div class="row" style="align-items:center;margin:4px 0"><span class="ar grow">${esc(x.name)}</span><span class="muted small">${x.age != null ? x.age + 'y · ' : ''}${esc(x.phone || '')} · ${esc(x.address || '')}${x.last_visit ? ' · last ' + dmy(x.last_visit) : ' · no visits'}</span><button class="small" data-m="${x.id}">Merge into this file</button></div>`).join('') || '<span class="muted">No other file found.</span>';
    $$('[data-m]').forEach(b => b.onclick = async () => { if (!confirm('Merge? This cannot be undone.')) return; await api('POST', '/api/merge', { keep: p.id, drop: +b.dataset.m }); close(); toast('Merged'); route(); });
  };
  $('#mq').addEventListener('input', run); run();
}
function templateDialog(t) {
  const close = modal(`<h2>${t.id ? 'Edit' : 'New'} template<span class="sp"></span><button data-close>✕</button></h2>
    <div class="row"><label class="grow">Template name<input id="tn" data-lang="en" dir="auto" value="${esc(t.name || '')}"></label><label class="grow">Adds diagnosis (optional)<input id="td" data-lang="en" value="${esc(t.diagnosis || '')}"></label></div>
    <label class="small muted" style="display:block;margin-top:8px">Medication lines (one per line)<textarea id="tl" rows="7" data-lang="en" dir="auto">${esc((t.lines || []).join('\n'))}</textarea></label>
    <label class="small muted" style="display:block;margin-top:8px">Adds plan / advice (optional)<textarea id="tp" rows="2" data-lang="en" dir="auto">${esc(t.plan || '')}</textarea></label>
    <div class="row" style="margin-top:8px"><label class="grow">Adds complaint (S) — visit template<textarea id="tc" rows="2" data-lang="en" dir="auto">${esc(t.complaint || '')}</textarea></label><label class="grow">Adds exam (O)<textarea id="te" rows="2" data-lang="en" dir="auto">${esc(t.exam || '')}</textarea></label></div>
    <div class="row" style="margin-top:8px"><label>Follow-up after (days)<input id="tf" data-lang="en" inputmode="numeric" style="width:90px" value="${esc(t.follow_days || '')}"></label><span class="small muted" style="align-self:end">sets the follow-up date (and the automatic appointment) when the visit has none</span></div>
    <div class="foot">${t.id ? '<button class="danger" id="tdel" style="margin-right:auto">Delete</button>' : ''}<button data-close>Cancel</button><button class="primary" id="tsave">Save template</button></div>`);
  $('#tsave').onclick = async () => {
    const b = { name: $('#tn').value, diagnosis: $('#td').value, plan: $('#tp').value, lines: $('#tl').value.split('\n'), complaint: $('#tc').value, exam: $('#te').value, follow_days: $('#tf').value };
    if (t.id) await api('PUT', '/api/template/' + t.id, b); else await api('POST', '/api/template', b);
    await loadLists(); close(); toast('Template saved'); if ($('#tpl')) $('#tpl').innerHTML = '<option value="">Templates…</option>' + L.templates.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
    if (location.hash.startsWith('#/settings')) route();
  };
  const del = $('#tdel'); if (del) del.onclick = async () => { if (confirm('Delete template?')) { await api('DELETE', '/api/template/' + t.id); await loadLists(); close(); route(); } };
}

/* ------------------------------------------------------------ secretary view of a patient */
function viewPatientBasic(v, d) {
  const p = d.patient;
  v.innerHTML = `<div class="card" style="max-width:900px"><div class="phead"><div class="pname">${esc(p.name)}</div>
      <div class="facts">${p.age != null ? p.age + ' y' : ''} · ${p.gender === 'M' ? 'Male' : p.gender === 'F' ? 'Female' : ''} · ${esc(p.phone || 'no phone')} · <span class="ar">${esc(p.address || '')}</span></div>
      <span style="flex:1"></span><button id="ed">Edit details</button></div>
    <p class="muted">${d.visit_count} visits${d.last_visit ? ' · last ' + dmy(d.last_visit) : ''} · ${d.file_count || 0} attached files</p>
    <div class="wrow"><label class="wbox">${ic('scale')}Weight today (kg)<input id="pWt" data-lang="en" inputmode="decimal" style="width:80px" value="${d.today_weight != null ? d.today_weight : ''}"></label><button class="primary" id="pWtS">Save weight</button>
      <span class="muted small">${(d.weights || []).length ? 'Previous: ' + d.weights.map(w => `${fnum(w[1])} kg <span class="muted">(${dmy(w[0])})</span>`).join(' · ') : ''}</span></div>
    <div class="famline" id="famLine"></div><div id="linker" class="linker hidden"></div>
    <div class="row"><label class="small" style="cursor:pointer"><span class="primary" style="background:var(--accent);color:#fff;border-radius:6px;padding:5px 12px;display:inline-block">+ Attach investigation (image / PDF)</span><input type="file" id="sUp" accept="image/*,application/pdf" multiple hidden></label></div>
    <h3>Upcoming appointments</h3>${d.appointments.length ? d.appointments.map(a => `<div>${dmy(a.date)} ${esc(fmtTime(a.time))} — ${ST[a.status || '']}</div>`).join('') : '<div class="muted">None</div>'}
    <div class="row" style="margin-top:10px"><label>Date<input type="date" id="bd" value="${todayISO()}"></label><label>Time${timeSelect('bt')}</label><label class="grow">Note<input id="bn" data-lang="en" dir="auto"></label><button class="primary" id="bk">Book appointment</button></div></div>`;
  $('#ed').onclick = () => location.hash = '#/edit/' + p.id;
  const sw = async () => { const w = $('#pWt').value.trim().replace(/[٠-٩]/g, x => '٠١٢٣٤٥٦٧٨٩'.indexOf(x)).replace(/[٫,]/, '.'); if (!w) return $('#pWt').focus();
    try { const r = await api('POST', '/api/weight', { patient_id: p.id, weight: w }); toast(r.created ? 'Weight saved — added to today\'s list as waiting' : 'Weight saved'); } catch (e) { toast(e.message, true); } };
  $('#pWtS').onclick = sw; $('#pWt').onkeydown = e => { if (e.key === 'Enter') sw(); };
  renderFamily(d);
  $('#sUp').onchange = async e => { P = { patient: p, visits: [], labs: [], files: [] }; VIS.id = null; const fs = Array.from(e.target.files);
    for (const f of fs) { try { const pl = await fileToPayload(f); await api('POST', '/api/file', Object.assign(pl, { patient_id: p.id, date: todayISO(), name: f.name, title: f.name.replace(/\.[^.]+$/, '').slice(0, 40) })); } catch (er) { toast(er.message, true); } }
    toast(fs.length + ' file(s) attached'); viewPatient(v, p.id, {}); };
  $('#bk').onclick = async () => { await api('POST', '/api/appt', { date: $('#bd').value, time: $('#bt').value, note: $('#bn').value, patient_id: p.id, name: p.name, phone: p.phone }); toast('Booked'); location.hash = '#/today?date=' + $('#bd').value; };
}

/* ============================================================ printing
   All forms print on the clinic's A5 sheet. When the sheet is pre-printed (header, "اسم المريض / التاريخ / العمر"
   dotted line, Rx sign and footer), only the patient's name/date/age are written on the dotted line and the content
   below the Rx sign. Positions are in mm, measured from the clinic's sheet; rx_off_x / rx_off_y calibrate the printer. */
/* Default texts of the clinic sheet (Settings → Printing can change every line) */
const HDR_DEF = {
  hdr_title: 'الدكتـــور', hdr_name: 'زكريا سمير العزو', hdr_degree_en: 'M.B.ch.B.-C.A.B.m (med.)',
  hdr_lines: 'دكتوراه (بورد) في الطب الباطني\nاختصاص في الامراض الباطنية و القلبية و الصدرية\nوداء السكري و امراض الكلى\nبكالوريوس طب و جراحة عامة\nزميل المجلس العربي للاختصاصات الطبية',
  hdr_reg: 'رقم التسجيل ٤٦٤٥٠ في ٢٠١٥/٣/١٢', hdr_phones: '0776 942 8730\n0750 022 7803', hdr_address: 'موصل - شارع المصارف\nمجاور صيدلية رؤية',
};
const hdr = k => (L.meta[k] != null && String(L.meta[k]).trim() !== '') ? L.meta[k] : HDR_DEF[k];
/* Round logo of the sheet, drawn as SVG (sharp at any print size) */
function logoSvg(sizeMm, opacity = 1) {
  const top = 'ZAKARIA SAMIR AL-AZZO', bot = hdr('hdr_degree_en');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" style="width:${sizeMm}mm;height:${sizeMm}mm;opacity:${opacity}">
    <defs><path id="lt" d="M 33.3,124.3 A 71,71 0 1 1 166.7,124.3"/><path id="lb" d="M 18.9,121.7 A 84,84 0 0 0 181.1,121.7"/></defs>
    <circle cx="100" cy="100" r="96" fill="#4a7fc1"/><circle cx="100" cy="100" r="62" fill="#fff"/>
    <text font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="17.5" fill="#fff" letter-spacing="1.1"><textPath href="#lt" startOffset="50%" text-anchor="middle">${esc(top)}</textPath></text>
    <text font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="11.5" fill="#fff" letter-spacing="2.4"><textPath href="#lb" startOffset="50%" text-anchor="middle">${esc(bot)}</textPath></text>
    <path d="M 78,64 C 52,62 48,96 62,114" fill="none" stroke="#2b2b2b" stroke-width="5" stroke-linecap="round"/>
    <path d="M 122,64 C 148,62 152,96 138,114" fill="none" stroke="#2b2b2b" stroke-width="5" stroke-linecap="round"/>
    <rect x="72" y="60" width="10" height="5" rx="2" fill="#2b2b2b"/><rect x="118" y="60" width="10" height="5" rx="2" fill="#2b2b2b"/>
    <path d="M 62,114 L 100,146 L 138,114" fill="none" stroke="#4a7fc1" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M 100,128 C 76,110 66,98 68,86 C 70,74 84,70 92,76 C 96,79 99,83 100,86 C 101,83 104,79 108,76 C 116,70 130,74 132,86 C 134,98 124,110 100,128 Z" fill="#b5121b"/>
    <polyline points="70,96 84,96 89,88 94,106 99,80 104,104 108,92 112,96 130,96" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/>
  </svg>`;
}
/* ---- layout of the printed fields (Settings → Printing → Layout): font, size, bold, X/Y/width in mm from the top-left of the A5 sheet */
const RX_FONTS = ['Tahoma', 'Arial', 'Segoe UI', 'Calibri', 'Times New Roman', 'Traditional Arabic', 'Simplified Arabic', 'Sakkal Majalla', 'Arabic Typesetting', 'Courier New', 'Sheet Arabic', 'Sheet Naskh'];
const RX_ELEMS = [['name', 'Patient name'], ['age', 'Age'], ['date', 'Date'], ['body', 'Medications / text'], ['rx', 'Rx symbol (plain paper)']];
function rxLayoutDef(pre) {
  const n = k => +L.meta[k] || 0;
  if (pre) {   // older single settings are used as the starting point
    const y = (n('rx_line_mm') || 55) - 4.3, top = n('rx_top_mm') || 80, bot = n('rx_bottom_mm') || 27, side = n('rx_side_mm') || 14, pt = n('rx_font_pt') || 12;
    return { name: { x: 55, y, w: 68, font: 'Tahoma', size: 12, bold: 1, align: 'right' }, age: { x: 9, y, w: 13, font: 'Tahoma', size: 12, bold: 1, align: 'center' },
      date: { x: 23, y, w: 27, font: 'Tahoma', size: 12, bold: 1, align: 'center' }, body: { x: side, y: top, w: 148 - 2 * side, h: 210 - bot - top, font: 'Segoe UI', size: pt, bold: 0, lh: 1.45 },
      rx: { x: 7, y: 62, size: 34, show: 0 } };
  }
  return { name: { x: 75, y: 51.5, w: 45, font: 'Sheet Arabic', size: 12.5, bold: 1, align: 'right' }, age: { x: 8.6, y: 51.5, w: 14.7, font: 'Tahoma', size: 11, bold: 1, align: 'center' },
    date: { x: 31.5, y: 51.5, w: 21, font: 'Tahoma', size: 10, bold: 1, align: 'center' }, body: { x: 14, y: n('rx_top_mm') || 80, w: 120, h: 107, font: 'Segoe UI', size: n('rx_font_pt') || 12, bold: 0, lh: 1.45 },
    rx: { x: 7, y: 62, size: 34, show: 1 } };
}
function rxLayout(pre) {
  const d = rxLayoutDef(pre); let u = {};
  try { u = JSON.parse(L.meta['rx_layout_' + (pre ? 'pre' : 'plain')] || '{}'); } catch (e) { }
  Object.keys(d).forEach(k => Object.assign(d[k], u[k] || {}));
  return d;
}
// single quotes only: this text goes inside style="..." attributes (a double quote there cut the style off, so font and size were lost)
const rxFont = f => f === 'Sheet Arabic' ? 'SheetAr,Tahoma' : f === 'Sheet Naskh' ? "SheetName,'Traditional Arabic'" : `'${String(f || 'Tahoma').replace(/['"<>;]/g, '')}',Tahoma,Arial`;
const rxEl = (e, ox, oy, extra = '') => `left:${(+e.x || 0) + ox}mm;top:${(+e.y || 0) + oy}mm;width:${+e.w || 30}mm;font-family:${rxFont(e.font)};font-size:${+e.size || 12}pt;font-weight:${+e.bold ? 700 : 400};text-align:${e.align || 'left'};${extra}`;
function printDoc(date, body, opts = {}) {
  const m = L.meta, p = P.patient, age = ageAt(p, date);
  const n = k => +m[k] || 0;
  const pre = m.rx_header === '0';
  const ox = pre ? n('rx_off_x') : 0, oy = pre ? n('rx_off_y') : 0, LY = rxLayout(pre), B = LY.body, pt = +B.size || 12;
  const F = location.origin + '/fonts/';
  const css = `
    @font-face{font-family:SheetName;src:url(${F}naskh-700.woff2) format('woff2');font-weight:700}
    @font-face{font-family:SheetAr;src:url(${F}harmattan-700.woff2) format('woff2');font-weight:700}
    @font-face{font-family:SheetAr;src:url(${F}harmattan-latin-700.woff2) format('woff2');font-weight:700;unicode-range:U+0000-00FF}
    @page{size:A5;margin:0}
    html,body{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font:${pt}pt/${+B.lh || 1.45} ${rxFont(B.font)},sans-serif;color:#000}
    .body{font-weight:${+B.bold ? 700 : 400}}
    .page{position:relative;width:148mm;height:209mm;overflow:hidden}
    .f{position:absolute;white-space:nowrap;overflow:hidden}
    .ar{direction:rtl;font-family:Tahoma,Arial}
    .a{position:absolute}
    .body{position:absolute;overflow:hidden}
    .rx{font-size:1.9em;font-weight:700;font-family:Georgia,serif;margin:0 0 2mm}
    ol{margin:0;padding-left:6mm}ol li{margin:0 0 2.6mm;padding-left:1mm}
    h1{font-size:1.2em;text-align:center;margin:0 0 4mm}
    p{margin:0 0 2.5mm;white-space:pre-wrap}
    .sig{margin-top:8mm;text-align:${opts.rtl ? 'left' : 'right'};direction:rtl;font-weight:700}
    /* plain-paper reproduction of the clinic sheet */
    .sh-ar{font-family:SheetAr,Tahoma,Arial,sans-serif;font-weight:700;direction:rtl}
    .sh-tab{position:absolute;top:14mm;right:5mm;width:29mm;height:6.2mm;background:#2f73b6;clip-path:polygon(9% 0,100% 0,100% 100%,0 100%);color:#fff;font-size:15pt;line-height:6.2mm;text-align:right;padding-right:3mm;box-sizing:border-box}
    .sh-name{position:absolute;top:19.6mm;right:4.5mm;width:58mm;text-align:center;font-family:SheetName,"Traditional Arabic",serif;font-weight:700;font-size:25pt;line-height:1.25;color:#a8151f;direction:rtl;-webkit-text-stroke:.35px #a8151f;white-space:nowrap}
    .sh-deg{position:absolute;top:31mm;right:4.5mm;width:58mm;text-align:center;font-family:Cambria,Georgia,"Times New Roman",serif;font-weight:700;font-size:10.5pt;color:#2f6fb1;white-space:nowrap}
    .sh-lines{position:absolute;top:9.4mm;text-align:right;font-size:8.4pt;line-height:4.45mm;white-space:pre;color:#000;-webkit-text-stroke:.2px #000}
    .sh-reg{position:absolute;top:32.2mm;text-align:right;font-size:9.6pt;color:#000;-webkit-text-stroke:.25px #000;white-space:nowrap}
    .sh-hr{position:absolute;left:4.4mm;right:5.2mm;height:.55mm;background:#3a87c4}
    .sh-lab{position:absolute;top:52.6mm;font-size:9.8pt;color:#3d678d;white-space:nowrap}
    .sh-dot{position:absolute;top:56.4mm;border-bottom:.25mm dotted #8a9db0}
    .sh-val{position:absolute;white-space:nowrap;overflow:hidden;color:#000}
    .sh-rx{position:absolute;left:7mm;top:62mm;font-family:"Arial Black",Arial,sans-serif;font-weight:900;color:#2a74b8;line-height:1}
    .sh-wm{position:absolute;left:35.3mm;top:85.5mm}
    .sh-ph{position:absolute;top:194.1mm;left:18.6mm;font-family:"Arial Black",Arial,sans-serif;font-weight:900;font-size:10.6pt;letter-spacing:.55mm;line-height:3.85mm;color:#1e5c99;white-space:pre}
    .sh-ad{position:absolute;top:193.4mm;right:13mm;width:38mm;text-align:right;font-size:12pt;line-height:4.05mm;color:#2e5e93;-webkit-text-stroke:.2px #2e5e93;white-space:pre-line}
    .sh-ic{position:absolute;width:6.4mm;height:6.4mm;border-radius:50%;background:#1e6db4;color:#fff;text-align:center;line-height:6.4mm;font-size:10pt}
    .sh-bar{position:absolute;left:0;right:0;top:204.6mm;height:5.4mm;background:#1a75be}
    .sh-tri{position:absolute;top:199.4mm;width:16mm;height:5.2mm;background:linear-gradient(to bottom,#e8eff6,#cddcea)}`;
  let page;
  if (pre) {
    page = `<div class="f ar"${opts.preview ? ' data-drag="name"' : ''} style="${rxEl(LY.name, ox, oy)}">${esc(p.name)}</div>
      <div class="f"${opts.preview ? ' data-drag="date"' : ''} style="${rxEl(LY.date, ox, oy)}">${dmy(date)}</div>
      <div class="f"${opts.preview ? ' data-drag="age"' : ''} style="${rxEl(LY.age, ox, oy)}">${age != null ? age : ''}</div>
      ${opts.rx && +LY.rx.show ? `<div class="sh-rx"${opts.preview ? ' data-drag="rx"' : ''} style="left:${+LY.rx.x + ox}mm;top:${+LY.rx.y + oy}mm"><span style="font-size:${+LY.rx.size}pt">R</span><span style="font-size:${+LY.rx.size * .8}pt;position:relative;left:-2.4mm;top:3.2mm">X</span></div>` : ''}
      <div class="body"${opts.preview ? ' data-drag="body"' : ''} style="left:${+B.x + ox}mm;top:${+B.y + oy}mm;width:${+B.w}mm;height:${+B.h}mm">${body}</div>`;
  } else {
    const house = `<svg viewBox="0 0 24 24" style="width:4.2mm;height:4.2mm;vertical-align:middle"><path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3z" fill="#fff"/></svg>`;
    const phone = `<svg viewBox="0 0 24 24" style="width:4mm;height:4mm;vertical-align:middle"><path d="M4 9c0-2 3-4 8-4s8 2 8 4v1.5h-4.2V9c-1-.6-2.3-.8-3.8-.8s-2.8.2-3.8.8v1.5H4zM6.5 12h11l1.8 6.5H4.7zM12 13.4a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z" fill="#fff"/></svg>`;
    page = `<div class="sh-wm">${logoSvg(71, .17)}</div>
      <div class="sh-tab sh-ar">${esc(hdr('hdr_title'))}</div>
      <div class="sh-name">${esc(hdr('hdr_name'))}</div>
      <div class="sh-deg">${esc(hdr('hdr_degree_en'))}</div>
      <div class="a" style="left:52.8mm;top:3.4mm">${logoSvg(36)}</div>
      <div class="sh-lines sh-ar" style="right:101mm">${esc(hdr('hdr_lines'))}</div>
      <div class="sh-reg sh-ar" style="right:101mm">${esc(hdr('hdr_reg'))}</div>
      <div class="sh-hr" style="top:49.6mm"></div>
      <div class="sh-lab sh-ar" style="right:10.4mm">اسم المريض :-</div><div class="sh-dot" style="left:75mm;right:27mm"></div>
      <div class="sh-val" dir="rtl"${opts.preview ? ' data-drag="name"' : ''} style="${rxEl(LY.name, 0, 0)}">${esc(p.name)}</div>
      <div class="sh-lab sh-ar" style="right:86.8mm">التاريخ:-</div><div class="sh-dot" style="left:32mm;right:96.5mm"></div>
      <div class="sh-val"${opts.preview ? ' data-drag="date"' : ''} style="${rxEl(LY.date, 0, 0)}">${dmy(date)}</div>
      <div class="sh-lab sh-ar" style="right:117.4mm">العمر:-</div><div class="sh-dot" style="left:8.6mm;right:124.7mm"></div>
      <div class="sh-val"${opts.preview ? ' data-drag="age"' : ''} style="${rxEl(LY.age, 0, 0)}">${age != null ? age : ''}</div>
      ${opts.rx && +LY.rx.show ? `<div class="sh-rx"${opts.preview ? ' data-drag="rx"' : ''} style="left:${+LY.rx.x}mm;top:${+LY.rx.y}mm"><span style="font-size:${+LY.rx.size}pt">R</span><span style="font-size:${+LY.rx.size * .8}pt;position:relative;left:-2.4mm;top:3.2mm">X</span></div>` : ''}
      <div class="body"${opts.preview ? ' data-drag="body"' : ''} style="left:${+B.x}mm;top:${+B.y}mm;width:${+B.w}mm;height:${+B.h}mm">${body}</div>
      <div class="sh-hr" style="top:189.6mm"></div>
      <div class="sh-ic" style="left:11mm;top:194.6mm">${phone}</div><div class="sh-ph">${esc(hdr('hdr_phones'))}</div>
      <div class="sh-ic" style="left:94.6mm;top:194.6mm">${house}</div><div class="sh-ad sh-ar">${esc(hdr('hdr_address'))}</div>
      <div class="sh-tri" style="left:0;clip-path:polygon(0 0,100% 100%,0 100%)"></div><div class="sh-tri" style="right:0;clip-path:polygon(100% 0,100% 100%,0 100%)"></div>
      <div class="sh-bar"></div>`;
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.name)}</title><style>${css}</style></head><body><div class="page">${page}</div></body></html>`;
  if (opts.preview) return html;
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
  const go = () => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 3000); };
  const fr = f.contentDocument.fonts;
  Promise.race([fr && fr.ready ? fr.ready.then(() => sleep(150)) : sleep(300), sleep(2500)]).then(go);
}
const sig = (ar) => `<div class="sig" style="text-align:${ar ? 'left' : 'right'}">${esc(L.meta.doctor_name || '')}</div>`;
function curVisit() { return P.visits.find(y => y.id === VIS.id); }
async function printRx() {
  await saveVisitNow();
  const x = curVisit(), meds = currentMeds();
  if (!meds.length) return toast('No medications to print', true);
  printDoc(x.date, `<ol>${meds.map(m => `<li dir="auto">${esc(m)}</li>`).join('')}</ol>
    ${x.follow_up ? `<p style="margin-top:5mm;text-align:right" class="ar">موعد المراجعة: ${dmy(x.follow_up)}</p>` : ''}`, { rx: true });
}
const LAB_REQ = ['CBC', 'ESR', 'CRP', 'FBS', 'RBS', 'HbA1c', 'Lipid profile', 'Blood urea', 'S. creatinine', 'Electrolytes (Na, K)', 'Liver function tests', 'Uric acid', 'S. calcium',
  'TSH', 'Free T4', 'Ferritin', 'Serum iron / TIBC', 'Vitamin D', 'Vitamin B12', 'Urine albumin/creatinine ratio', 'GUE', 'GSE', 'H. pylori stool antigen', 'Urea breath test',
  'HBsAg', 'HCV Ab', 'PSA', 'PT / INR', 'D-dimer', 'Troponin', 'RF', 'Anti-CCP', 'ANA', 'Fasting insulin', 'ECG', 'Abdominal ultrasound', 'Chest X-ray', 'Spirometry'];
function labRequestDialog(pre) {
  const pool = L.labreq && L.labreq.length ? L.labreq : LAB_REQ;
  const close = modal(`<h2>Lab request (English)<span class="sp"></span><button data-close>✕</button></h2>
    <div class="small muted" style="margin-bottom:6px">Type a test — suggestions come from the list and from tests requested before. Enter moves to the next line.</div>
    <div class="meds" id="lrList"></div>
    <div class="small" style="margin-top:6px">Panels: ${[['Diabetes', ['FBS', 'HbA1c', 'S. creatinine', 'Urine albumin/creatinine ratio', 'Lipid profile']], ['Check-up', ['CBC', 'FBS', 'HbA1c', 'Lipid profile', 'Blood urea', 'S. creatinine', 'Liver function tests', 'TSH', 'Vitamin D', 'GUE']], ['Anaemia', ['CBC', 'Ferritin', 'Serum iron / TIBC', 'Vitamin B12']], ['Thyroid', ['TSH', 'Free T4']]]
      .map(([n, t]) => `<button class="small" data-panel="${esc(JSON.stringify(t))}">${n}</button>`).join(' ')}</div>
    <label class="small" style="display:flex;gap:6px;margin-top:8px"><input type="checkbox" id="lrDx" checked> Print the clinical information (diagnosis)</label>
    <div class="foot"><button data-close>Cancel</button><button class="primary" id="lrPrint">🖨 Print</button></div>`);
  const rows = list => {
    const box = $('#lrList');
    box.innerHTML = list.concat(['']).map((m, i) => `<div class="m"><span class="n">${i + 1}.</span><input value="${esc(m)}" data-lang="en" autocomplete="off"><button class="small danger" data-x="${i}">✕</button></div>`).join('');
    $$('input', box).forEach((inp, i) => {
      combo(inp, q => matchList(pool, q, 12), pick => { inp.value = pick; grow(i); const nx = $$('#lrList input')[i + 1]; nx && nx.focus(); }, { autoSelect: true });
      inp.addEventListener('input', () => grow(i));
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && $('#combo').classList.contains('hidden')) { e.preventDefault(); const nx = $$('#lrList input')[i + 1]; nx ? nx.focus() : $('#lrPrint').focus(); } });
    });
    box.onclick = e => { if (e.target.dataset.x !== undefined) { const cur = vals(); cur.splice(+e.target.dataset.x, 1); rows(cur); } };
  };
  const vals = () => $$('#lrList input').map(i => i.value.trim()).filter(Boolean);
  const grow = i => { const ins = $$('#lrList input'); if (i === ins.length - 1 && ins[i].value.trim()) { const v = ins[i].value; rows(vals()); const el = $$('#lrList input')[i]; el.focus(); el.value = v; el.setSelectionRange(v.length, v.length); } };
  rows(Array.isArray(pre) ? pre : []); $('#lrList input').focus();
  $$('[data-panel]').forEach(b => b.onclick = () => { const cur = vals(); JSON.parse(b.dataset.panel).forEach(t => { if (!cur.includes(t)) cur.push(t); }); rows(cur); });
  $('#lrPrint').onclick = async () => {
    await saveVisitNow();
    const x = curVisit(), sel = vals();
    if (!sel.length) return toast('Type at least one test', true);
    api('POST', '/api/vocab', { kind: 'labreq', items: sel }).then(loadLists).catch(() => { });
    printDoc(x.date, `<h1>Laboratory request</h1><p>Kindly do the following investigations:</p>
      <ol style="columns:${sel.length > 8 ? 2 : 1}">${sel.map(t => `<li>${esc(t)}</li>`).join('')}</ol>
      ${$('#lrDx').checked && x.diagnosis ? `<p style="margin-top:3mm"><b>Clinical information:</b> ${esc(x.diagnosis.replace(/\n/g, ', '))}</p>` : ''}${sig(false)}`);
    close();
  };
}
const he = p => p.gender === 'F' ? ['she', 'her', 'Mrs./Ms.'] : ['he', 'his', 'Mr.'];
const arG = p => p.gender === 'F' ? { pt: 'المريضة', age: 'البالغة', suff: 'ها', comp: 'تشكو', she: 'هي' } : { pt: 'المريض', age: 'البالغ', suff: 'ه', comp: 'يشكو', she: 'هو' };
function visitFacts() {
  const p = P.patient, x = curVisit();
  const labs = ['HBA1C', 'FBS', 'CREAT', 'LDL', 'HB', 'TSH'].map(c => [c, latestLab(c)]).filter(z => z[1]).map(([c, l]) => ((L.lab_tests.find(t => t.code === c) || {}).name || c) + ' ' + l.value);
  return { p, x, age: ageAt(p, x.date), dx: (x.diagnosis || '').split('\n').map(s => s.trim()).filter(Boolean).join(', '), cc: (x.complaint || '').split('\n')[0].trim(),
    chronic: (p.chronic || '').split('\n').map(s => s.trim()).filter(Boolean).join(', '), allergy: (p.allergies || '').split('\n').map(s => s.trim()).filter(Boolean).join(', '),
    vit: x.bp_sys ? `BP ${x.bp_sys}/${x.bp_dia || ''}${x.hr ? ', PR ' + x.hr : ''}${x.spo2 ? ', SpO2 ' + x.spo2 + '%' : ''}` : '', labs: labs.join(', '), meds: currentMeds() };
}
// referral + echo request: Arabic or English letter, editable before printing
function letterDialog(kind) {
  const titles = { ref: ['Referral letter', 'إحالة', 'Referral'], echo: ['Echo request', 'طلب فحص إيكو القلب', 'Echocardiography request'] };
  const close = modal(`<h2>${titles[kind][0]}<span class="sp"></span><select id="lgL"><option value="ar">العربية</option><option value="en">English</option></select><button data-close>✕</button></h2>
    <div class="row"><label class="grow">${kind === 'echo' ? 'To (echo centre / doctor) — optional' : 'To (doctor / department / hospital)'}<input id="lgTo" dir="auto" data-lang="en"></label></div>
    <label class="small muted" style="display:block;margin-top:8px">Letter (edit freely)<textarea id="lgT" rows="13"></textarea></label>
    <div class="foot"><button data-close>Cancel</button><button class="primary" id="lgP">🖨 Print</button></div>`);
  const fill = () => {
    const ar = $('#lgL').value === 'ar', f = visitFacts(), g = arG(f.p), [, his, mr] = he(f.p), t = $('#lgT');
    t.dir = ar ? 'rtl' : 'ltr'; t.dataset.lang = ar ? 'ar' : 'en'; $('#lgTo').dataset.lang = ar ? 'ar' : 'en'; $('#lgTo').dir = ar ? 'rtl' : 'auto';
    if (kind === 'ref') t.value = ar
      ? `الزميل المحترم\nتحية طيبة\n\nنحيل إليكم ${g.pt} (${f.p.name}) ${g.age} من العمر ${f.age != null ? f.age : '...'} سنة${f.cc ? '، الذي ' + g.comp + ' من ' + f.cc : ''}.\n${f.dx ? 'التشخيص المبدئي: ' + f.dx + '\n' : ''}${f.chronic ? 'الأمراض المزمنة: ' + f.chronic + '\n' : ''}${f.vit ? f.vit + '\n' : ''}${f.labs ? 'آخر التحاليل: ' + f.labs + '\n' : ''}${f.meds.length ? 'العلاج الحالي: ' + f.meds.join('؛ ') + '\n' : ''}${f.allergy ? 'الحساسية: ' + f.allergy + '\n' : ''}\nسبب الإحالة: \n\nنرجو التفضل بالاطلاع وإجراء اللازم مع التقدير.`
      : `Dear colleague,\n\nKindly see ${mr} ${f.p.name}, ${f.age != null ? f.age + ' years old' : ''}${f.cc ? ', who presented with ' + f.cc : ''}.\n${f.dx ? 'Provisional diagnosis: ' + f.dx + '\n' : ''}${f.chronic ? 'Background: ' + f.chronic + '\n' : ''}${f.vit ? f.vit + '\n' : ''}${f.labs ? 'Recent labs: ' + f.labs + '\n' : ''}${f.meds.length ? 'Current medications: ' + f.meds.join('; ') + '\n' : ''}${f.allergy ? 'ALLERGIES: ' + f.allergy + '\n' : ''}\nReason for referral: \n\nThank you for seeing ${his === 'her' ? 'her' : 'him'}.`;
    else t.value = ar
      ? `يرجى إجراء فحص الإيكو للقلب ${g.pt.replace('ال', 'لل')} (${f.p.name}) ${g.age} من العمر ${f.age != null ? f.age : '...'} سنة.\n\n${f.dx ? 'التشخيص: ' + f.dx + '\n' : ''}${f.chronic ? 'الأمراض المزمنة: ' + f.chronic + '\n' : ''}${f.cc ? 'الأعراض: ' + f.cc + '\n' : ''}${f.vit ? f.vit + '\n' : ''}\nالغرض من الفحص: تقييم وظيفة البطين الأيسر والكسر القذفي (EF)، الصمامات، تضخم عضلة القلب، وضغط الشريان الرئوي.\n\nمع التقدير.`
      : `Kindly perform a transthoracic echocardiography for ${mr} ${f.p.name}, ${f.age != null ? f.age + ' years old' : ''}.\n\n${f.dx ? 'Diagnosis: ' + f.dx + '\n' : ''}${f.chronic ? 'Background: ' + f.chronic + '\n' : ''}${f.cc ? 'Symptoms: ' + f.cc + '\n' : ''}${f.vit ? f.vit + '\n' : ''}\nPlease assess: LV size and systolic function (EF), diastolic function, LVH, valves, pulmonary artery pressure, pericardium.\n\nThank you.`;
  };
  fill(); $('#lgL').onchange = fill;
  $('#lgP').onclick = async () => {
    await saveVisitNow();
    const ar = $('#lgL').value === 'ar', to = $('#lgTo').value.trim(), dir = ar ? 'rtl' : 'ltr', al = ar ? 'right' : 'left';
    printDoc(curVisit().date, `<h1>${ar ? titles[kind][1] : titles[kind][2]}</h1>${to ? `<p dir="${dir}" style="text-align:${al}"><b>${ar ? 'إلى: ' : 'To: '}${esc(to)}</b></p>` : ''}
      <p dir="${dir}" style="text-align:${al}">${esc($('#lgT').value)}</p>${sig(ar)}`);
    close();
  };
}
const referralDialog = () => letterDialog('ref');
const echoDialog = () => letterDialog('echo');
function reportText(lang) {
  const f = visitFacts(), p = f.p, g = arG(p), first = P.visits[P.visits.length - 1];
  const dx = [...new Set(P.visits.flatMap(v => (v.diagnosis || '').split('\n').map(s => s.trim()).filter(Boolean)))].slice(0, 6);
  const meds = f.meds.length ? f.meds : ((P.visits.find(v => (v.meds || []).length) || {}).meds || []);
  if (lang === 'ar') return `إلى من يهمه الأمر\n\nراجع${p.gender === 'F' ? 'ت' : ''} ${g.pt} (${p.name}) ${g.age} من العمر ${f.age != null ? f.age : '...'} سنة عيادتنا منذ ${dmy(first.date)}${dx.length ? '، و' + g.she + ' مصاب' + (p.gender === 'F' ? 'ة' : '') + ' بـ: ' + dx.join('، ') : ''}.\n${meds.length ? '\nالعلاج الحالي:\n' + meds.map((m, i) => (i + 1) + '. ' + m).join('\n') + '\n' : ''}\nوقد زُوّد${p.gender === 'F' ? 'ت' : ''} بهذا التقرير بناءً على طلب${g.suff}.`;
  return `To whom it may concern,\n\nThis is to certify that ${he(p)[2]} ${p.name}, ${f.age != null ? f.age + ' years old' : ''}, has been under my care since ${dmy(first.date)}${dx.length ? ' for: ' + dx.join(', ') : ''}.\n${meds.length ? '\nCurrent medications:\n' + meds.map((m, i) => (i + 1) + '. ' + m).join('\n') + '\n' : ''}${f.x.plan ? '\nRecommendations: ' + f.x.plan + '\n' : ''}\nThis report was given at the patient's request.`;
}
function reportDialog() {
  const close = modal(`<h2>Medical report<span class="sp"></span><select id="rl"><option value="ar">العربية</option><option value="en">English</option></select><button data-close>✕</button></h2>
    <textarea id="rt" rows="14"></textarea><div class="foot"><button data-close>Cancel</button><button class="primary" id="rp">🖨 Print</button></div>`);
  const fill = () => { const ar = $('#rl').value === 'ar'; $('#rt').value = reportText($('#rl').value); $('#rt').dir = ar ? 'rtl' : 'ltr'; $('#rt').dataset.lang = ar ? 'ar' : 'en'; };
  fill(); $('#rl').onchange = fill;
  $('#rp').onclick = () => { const ar = $('#rl').value === 'ar', dir = ar ? 'rtl' : 'ltr', al = ar ? 'right' : 'left';
    printDoc(curVisit().date, `<h1>${ar ? 'تقرير طبي' : 'Medical Report'}</h1><p dir="${dir}" style="text-align:${al}">${esc($('#rt').value)}</p>${sig(ar)}`); close(); };
}
function sickDialog() {
  const p = P.patient, x = curVisit();
  const close = modal(`<h2>Sick leave (إجازة مرضية)<span class="sp"></span><button data-close>✕</button></h2>
    <div class="row"><label>Days<input id="sd" inputmode="numeric" value="3" style="width:70px"></label><label>From<input id="sf" type="date" value="${x.date}"></label>
      <label class="grow">Diagnosis (as printed)<input id="sx" data-lang="en" dir="auto" value="${esc((x.diagnosis || '').split('\n')[0])}"></label></div>
    <div class="foot"><button data-close>Cancel</button><button class="primary" id="sp">🖨 Print</button></div>`);
  $('#sp').onclick = () => {
    const n = +$('#sd').value || 1, from = $('#sf').value, to = addDays(from, n - 1), age = ageAt(p, x.date), g = arG(p);
    printDoc(x.date, `<h1>إجازة مرضية</h1><p class="ar" style="text-align:right">يُمنح ${g.pt} (<b>${esc(p.name)}</b>) ${g.age} من العمر ${age != null ? age : '...'} سنة إجازة مرضية لمدة (<b>${n}</b>) ${n === 1 ? 'يوم' : n <= 10 ? 'أيام' : 'يوماً'} اعتباراً من ${dmy(from)} ولغاية ${dmy(to)}${$('#sx').value ? '، لإصابت' + g.suff + ' بـ <span dir="ltr">' + esc($('#sx').value) + '</span>' : ''}.</p>${sig(true)}`);
    close();
  };
}

/* ============================================================ calculators page */
const CALCS = [
  { id: 'bmi', t: 'BMI / BSA / IBW', f: [['w', 'Weight (kg)'], ['h', 'Height (cm)'], ['sex', 'Sex', 'sex']], r: v => { const b = C.bmi(v.w, v.h); if (!b) return null; return [`BMI ${b.toFixed(1)} — ${C.bmiCat(b)} · BSA ${C.bsa(v.w, v.h).toFixed(2)} m² · IBW ${C.ibw(v.h, v.sex).toFixed(0)} kg`, b >= 30 || b < 18.5 ? 'abn' : b >= 25 ? 'mid' : 'ok']; } },
  { id: 'egfr', t: 'eGFR — CKD-EPI 2021', f: [['cr', 'Creatinine (mg/dL)'], ['age', 'Age'], ['sex', 'Sex', 'sex']], r: v => { const e = C.egfr(v.cr, v.age, v.sex); return e ? [`eGFR ${Math.round(e)} mL/min/1.73m² — CKD ${C.ckd(e)}`, e < 30 ? 'abn' : e < 60 ? 'mid' : 'ok'] : null; }, n: 'Race-free 2021 equation.' },
  { id: 'crcl', t: 'Creatinine clearance — Cockcroft-Gault', f: [['cr', 'Creatinine (mg/dL)'], ['age', 'Age'], ['w', 'Weight (kg)'], ['sex', 'Sex', 'sex']], r: v => { const c = C.crcl(v.cr, v.age, v.w, v.sex); return c ? [`CrCl ${Math.round(c)} mL/min`, c < 30 ? 'abn' : c < 60 ? 'mid' : 'ok'] : null; }, n: 'Used for drug dose adjustment. Uses actual body weight.' },
  { id: 'ldl', t: 'LDL — Friedewald', f: [['tc', 'Total cholesterol (mg/dL)'], ['hdl', 'HDL (mg/dL)'], ['tg', 'Triglycerides (mg/dL)']], r: v => { if (v.tg >= 400) return ['Not valid when TG ≥ 400', 'mid']; const l = C.ldlF(v.tc, v.hdl, v.tg); return l ? [`LDL ${Math.round(l)} mg/dL · non-HDL ${Math.round(v.tc - v.hdl)} mg/dL`, l >= 160 ? 'abn' : l >= 100 ? 'mid' : 'ok'] : null; } },
  { id: 'homa', t: 'HOMA-IR', f: [['g', 'Fasting glucose (mg/dL)'], ['ins', 'Fasting insulin (µU/mL)']], r: v => { const h = C.homa(v.g, v.ins); return h ? [`HOMA-IR ${h.toFixed(2)} — ${h >= 2.5 ? 'insulin resistance likely' : 'normal'}`, h >= 2.5 ? 'abn' : 'ok'] : null; } },
  { id: 'ca', t: 'Corrected calcium', f: [['ca', 'Calcium (mg/dL)'], ['alb', 'Albumin (g/dL)']], r: v => { const c = C.corrCa(v.ca, v.alb); return c ? [`Corrected Ca ${c.toFixed(2)} mg/dL`, c > 10.5 || c < 8.5 ? 'abn' : 'ok'] : null; } },
  { id: 'ag', t: 'Anion gap', f: [['na', 'Na (mmol/L)'], ['cl', 'Cl (mmol/L)'], ['hco3', 'HCO₃ (mmol/L)'], ['alb', 'Albumin g/dL (optional)']], r: v => { const a = C.ag(v.na, v.cl, v.hco3); if (a == null) return null; const c = v.alb ? a + 2.5 * (4 - v.alb) : null; return [`Anion gap ${a.toFixed(1)}${c != null ? ' · albumin-corrected ' + c.toFixed(1) : ''}`, (c != null ? c : a) > 12 ? 'abn' : 'ok']; } },
  { id: 'qtc', t: 'QTc — Bazett', f: [['qt', 'QT (ms)'], ['hr', 'Heart rate']], r: v => { const q = C.qtc(v.qt, v.hr); return q ? [`QTc ${Math.round(q)} ms`, q > 500 ? 'abn' : q > 450 ? 'mid' : 'ok'] : null; } },
  { id: 'fib4', t: 'FIB-4 (liver fibrosis)', f: [['age', 'Age'], ['ast', 'AST (U/L)'], ['alt', 'ALT (U/L)'], ['plt', 'Platelets (×10⁹/L)']], r: v => { const f = C.fib4(v.age, v.ast, v.alt, v.plt); return f ? [`FIB-4 ${f.toFixed(2)} — ${f < 1.3 ? 'low risk of advanced fibrosis' : f > 2.67 ? 'high risk' : 'indeterminate'}`, f < 1.3 ? 'ok' : f > 2.67 ? 'abn' : 'mid'] : null; } },
  { id: 'meld', t: 'MELD-Na', f: [['cr', 'Creatinine (mg/dL)'], ['bili', 'Bilirubin (mg/dL)'], ['inr', 'INR'], ['na', 'Na (mmol/L)'], ['dial', 'Dialysis ×2 in last week', 'ck']], r: v => { const m = C.meldna(v.cr, v.bili, v.inr, v.na, v.dial); return m ? [`MELD-Na ${m}`, m >= 20 ? 'abn' : m >= 10 ? 'mid' : 'ok'] : null; } },
  { id: 'child', t: 'Child-Pugh', f: [['bili', 'Bilirubin (mg/dL)'], ['alb', 'Albumin (g/dL)'], ['inr', 'INR'], ['asc', 'Ascites', ['None', 'Mild', 'Moderate–severe']], ['enc', 'Encephalopathy', ['None', 'Grade 1–2', 'Grade 3–4']]],
    r: v => { if (!v.bili || !v.alb || !v.inr) return null; const s = (v.bili < 2 ? 1 : v.bili <= 3 ? 2 : 3) + (v.alb > 3.5 ? 1 : v.alb >= 2.8 ? 2 : 3) + (v.inr < 1.7 ? 1 : v.inr <= 2.3 ? 2 : 3) + (+v.asc + 1) + (+v.enc + 1); return [`Score ${s} — Class ${s <= 6 ? 'A' : s <= 9 ? 'B' : 'C'}`, s <= 6 ? 'ok' : s <= 9 ? 'mid' : 'abn']; } },
  { id: 'cha', t: 'CHA₂DS₂-VASc', f: [['age', 'Age'], ['sex', 'Sex', 'sex'], ['chf', 'Heart failure', 'ck'], ['htn', 'Hypertension', 'ck'], ['dm', 'Diabetes', 'ck'], ['stroke', 'Stroke / TIA / thromboembolism', 'ck'], ['vasc', 'Vascular disease (MI, PAD, plaque)', 'ck']],
    r: v => { if (!v.age) return null; const s = (v.chf ? 1 : 0) + (v.htn ? 1 : 0) + (v.age >= 75 ? 2 : v.age >= 65 ? 1 : 0) + (v.dm ? 1 : 0) + (v.stroke ? 2 : 0) + (v.vasc ? 1 : 0) + (v.sex === 'F' ? 1 : 0); const hi = v.sex === 'F' ? s >= 3 : s >= 2; return [`Score ${s} — ${hi ? 'anticoagulation recommended' : (v.sex === 'F' ? s === 2 : s === 1) ? 'consider anticoagulation' : 'low risk'}`, hi ? 'abn' : (v.sex === 'F' ? s === 2 : s === 1) ? 'mid' : 'ok']; } },
  { id: 'hasbled', t: 'HAS-BLED', f: [['h', 'Uncontrolled HTN (SBP > 160)', 'ck'], ['r', 'Abnormal renal function', 'ck'], ['l', 'Abnormal liver function', 'ck'], ['s', 'Prior stroke', 'ck'], ['b', 'Bleeding history / predisposition', 'ck'], ['i', 'Labile INR', 'ck'], ['e', 'Age > 65', 'ck'], ['d', 'Antiplatelets / NSAIDs', 'ck'], ['a', 'Alcohol ≥ 8 drinks/week', 'ck']],
    r: v => { const s = ['h', 'r', 'l', 's', 'b', 'i', 'e', 'd', 'a'].filter(k => v[k]).length; return [`Score ${s} — ${s >= 3 ? 'high bleeding risk: correct modifiable factors, review closely' : 'low–moderate risk'}`, s >= 3 ? 'abn' : s === 2 ? 'mid' : 'ok']; } },
  { id: 'curb', t: 'CURB-65', f: [['c', 'Confusion', 'ck'], ['u', 'Urea > 42 mg/dL (> 7 mmol/L)', 'ck'], ['r', 'RR ≥ 30', 'ck'], ['b', 'SBP < 90 or DBP ≤ 60', 'ck'], ['a', 'Age ≥ 65', 'ck']],
    r: v => { const s = ['c', 'u', 'r', 'b', 'a'].filter(k => v[k]).length; return [`Score ${s} — ${s <= 1 ? 'low risk, outpatient treatment' : s === 2 ? 'consider admission / close follow-up' : 'severe pneumonia, admit (consider ICU if 4–5)'}`, s <= 1 ? 'ok' : s === 2 ? 'mid' : 'abn']; } },
  { id: 'wpe', t: 'Wells score — PE', f: [['dvt', 'Clinical signs of DVT (3)', 'ck'], ['alt', 'PE is the most likely diagnosis (3)', 'ck'], ['hr', 'Heart rate > 100 (1.5)', 'ck'], ['imm', 'Immobilisation ≥ 3 d or surgery < 4 wk (1.5)', 'ck'], ['prev', 'Previous DVT / PE (1.5)', 'ck'], ['hem', 'Haemoptysis (1)', 'ck'], ['ca', 'Active malignancy (1)', 'ck']],
    r: v => { const s = (v.dvt ? 3 : 0) + (v.alt ? 3 : 0) + (v.hr ? 1.5 : 0) + (v.imm ? 1.5 : 0) + (v.prev ? 1.5 : 0) + (v.hem ? 1 : 0) + (v.ca ? 1 : 0); return [`Score ${s} — PE ${s > 4 ? 'likely: CT pulmonary angiography' : 'unlikely: D-dimer'}`, s > 4 ? 'abn' : 'ok']; } },
  { id: 'wdvt', t: 'Wells score — DVT', f: [['ca', 'Active cancer', 'ck'], ['par', 'Paralysis / recent cast', 'ck'], ['bed', 'Bedridden > 3 d or surgery < 12 wk', 'ck'], ['ten', 'Tenderness along deep veins', 'ck'], ['leg', 'Entire leg swollen', 'ck'], ['calf', 'Calf swelling > 3 cm vs other leg', 'ck'], ['pit', 'Pitting oedema (symptomatic leg)', 'ck'], ['col', 'Collateral superficial veins', 'ck'], ['prev', 'Previous DVT', 'ck'], ['alt', 'Alternative diagnosis as likely (−2)', 'ck']],
    r: v => { const s = ['ca', 'par', 'bed', 'ten', 'leg', 'calf', 'pit', 'col', 'prev'].filter(k => v[k]).length - (v.alt ? 2 : 0); return [`Score ${s} — DVT ${s >= 2 ? 'likely: ultrasound' : 'unlikely: D-dimer'}`, s >= 2 ? 'abn' : 'ok']; } },
];
async function viewCalc(v, params) {
  let pre = {};
  if (params.p) {
    const d = await api('GET', '/api/patient/' + params.p); P = d;
    const x = d.visits.find(y => y.id === +params.v) || d.visits[0] || {};
    const lab = c => { const l = latestLab(c); return l ? l.value : ''; };
    const age = ageAt(d.patient, x.date);
    pre = { w: x.weight || '', h: x.height || d.patient.height || '', sex: d.patient.gender || '', age: age || '', cr: lab('CREAT'), tc: lab('TC'), hdl: lab('HDL'), tg: lab('TG'), g: lab('FBS'),
      ca: lab('CA'), alb: lab('ALB'), ast: lab('AST'), alt: lab('ALT'), plt: lab('PLT'), bili: lab('TBIL'), inr: lab('INR'), na: lab('NA'), hr: x.hr || '' };
    const lines = (d.patient.chronic || '').toLowerCase();
    pre.htn = /hypertens|\bht\b|htn/.test(lines); pre.dm = /diabet|\bdm\b/.test(lines); pre.sbp = (d.visits.find(y => y.bp_sys) || {}).bp_sys || ''; pre.trt = pre.htn; pre.smk = /^current/i.test(d.patient.smoking || ''); pre.chf = /heart failure/.test(lines); pre.e = age > 65; pre.a = age >= 65;
  }
  const cur = CALCS.find(c => c.id === (params.c || localStorageGet('calcTab'))) || CALCS[0];
  v.innerHTML = `${params.p ? `<div class="card slim"><h3>Calculators — <span class="ar" style="text-transform:none">${esc(P.patient.name)}</span> <span class="muted small" style="text-transform:none">(filled from the file — check the values)</span> <span class="sp"></span><button data-back>← Back to visit</button></h3></div>` : ''}
    <div class="tabsview"><nav class="vtabs card">${CALCS.map(c => `<button data-tab="${c.id}"${c.id === cur.id ? ' class="on"' : ''}>${ic(c.ic || 'calc')}<span>${c.t}</span></button>`).join('')}</nav><div id="calcPane"></div></div>`;
  const back = $('[data-back]'); if (back) back.onclick = () => location.hash = '#/p/' + params.p + (params.v ? '?v=' + params.v : '');
  const vals = {};      // values typed are kept while switching tabs
  const show = c => {
    localStorageSet('calcTab', c.id);
    $$('.vtabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === c.id));
    const val = k => vals[k] !== undefined ? vals[k] : pre[k];
    $('#calcPane').innerHTML = `<div class="card calc big" data-id="${c.id}"><h3>${c.t}</h3>
      ${c.f.map(([k, l, type]) => type === 'ck' ? `<label class="ck"><input type="checkbox" data-f="${k}"${val(k) ? ' checked' : ''}>${l}</label>`
        : type === 'sex' ? `<div class="row"><label>${l}<select data-f="${k}"><option value=""></option><option value="M"${val('sex') === 'M' ? ' selected' : ''}>Male</option><option value="F"${val('sex') === 'F' ? ' selected' : ''}>Female</option></select></label></div>`
        : Array.isArray(type) ? `<div class="row"><label>${l}<select data-f="${k}">${type.map((o, i) => `<option value="${i}"${+val(k) === i ? ' selected' : ''}>${o}</option>`).join('')}</select></label></div>`
        : `<div class="row"><label style="width:260px">${l}<input data-f="${k}" data-lang="en" inputmode="decimal" value="${esc(val(k) != null ? val(k) : '')}"></label></div>`).join('')}
      <div class="res"></div>${c.n ? `<div class="note">${c.n}</div>` : ''}</div>`;
    const box = $('#calcPane .calc');
    const run = () => { const vv = {}; $$('[data-f]', box).forEach(i => { const raw = i.type === 'checkbox' ? i.checked : i.value; vals[i.dataset.f] = raw; vv[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.tagName === 'SELECT' ? i.value : (i.value === '' ? null : +i.value); });
      const r = c.r(vv); const out = $('.res', box); out.textContent = r ? r[0] : '—'; out.className = 'res ' + (r ? r[1] : ''); };
    box.addEventListener('input', run); box.addEventListener('change', run); run();
    const f = $('input:not([type=checkbox])', box); f && f.focus();
  };
  $$('.vtabs [data-tab]').forEach(b => b.onclick = () => show(CALCS.find(c => c.id === b.dataset.tab)));
  show(cur);
}

/* ============================================================ visits log */
async function viewLog(v, params) {
  const from = params.from || todayISO(), to = params.to || from;
  const d = await api('GET', `/api/visits?from=${from}&to=${to}`);
  v.innerHTML = `<div class="card"><h3>Visits log${from === to ? ' — ' + DAY_EN[new Date(from + 'T12:00:00').getDay()] + ' ' + dmy(from) : ''}<span class="sp"></span><label class="small" style="text-transform:none">From <input type="date" id="lf" value="${from}"></label><label class="small" style="text-transform:none">To <input type="date" id="lt" value="${to}"></label>
    <button class="small" data-r="0">Today</button><button class="small" data-r="7">7 days</button><button class="small" data-r="30">30 days</button></h3>
    ${dayBar(from === to ? from : to)}
    <p><b>${d.count}</b> visits${from !== to ? ` <span class="muted">(${dmy(from)} – ${dmy(to)})</span>` : ''}</p>
    <table class="t"><thead><tr><th>Date</th><th>Patient</th><th>Diagnosis</th></tr></thead><tbody>
    ${d.rows.map(r => `<tr class="click" data-p="${r.patient_id}" data-v="${r.id}"><td>${dmy(r.date)}</td><td class="ar" style="text-align:left">${esc(r.name)}</td><td dir="auto">${esc((r.diagnosis || '').replace(/\n/g, ', '))}</td></tr>`).join('')}</tbody></table></div>`;
  const go = (f, t) => location.hash = `#/log?from=${f}&to=${t}`;
  $('#lf').onchange = () => go($('#lf').value, $('#lt').value); $('#lt').onchange = () => go($('#lf').value, $('#lt').value);
  $$('[data-r]').forEach(b => b.onclick = () => go(addDays(todayISO(), -+b.dataset.r), todayISO()));
  bindDayBar(v, from === to ? from : to, x => go(x, x), 'visit');
  $$('tr[data-p]').forEach(tr => tr.onclick = () => location.hash = '#/p/' + tr.dataset.p + '?v=' + tr.dataset.v);
}

/* ============================================================ settings */
const SET_TABS = [['clinic', 'Clinic'], ['look', 'Appearance'], ['print', 'Printing'], ['hours', 'Appointments'], ['users', 'Users & PINs'], ['tpl', 'Ready prescriptions'], ['ai', 'AI features'],
  ['labs', 'Lab tests'], ['labreq', 'Lab request list'], ['drugs', 'Drug suggestions'], ['dx', 'Diagnosis suggestions'], ['areas', 'Addresses'], ['occ', 'Occupations'],
  ['dups', 'Duplicate files'], ['online', 'Online version'], ['data', 'Data & backup']];
async function viewSettings(v, params = {}) {
  await loadLists();
  const dr = ME.role === 'doctor';
  if (!dr) {
    v.innerHTML = `<div class="card" style="max-width:500px"><h3>My PIN</h3>${pinBox()}</div>`;
    return bindPin();
  }
  const tab = SET_TABS.some(t => t[0] === params.tab) ? params.tab : (localStorageGet('setTab') || 'clinic');
  v.innerHTML = `<div class="tabsview"><nav class="vtabs card">${SET_TABS.map(([k, l]) => `<button data-tab="${k}">${ic(TAB_ICON[k] || 'dot')}<span>${l}</span></button>`).join('')}</nav><div id="setPane"></div></div>`;
  $$('.vtabs [data-tab]').forEach(b => b.onclick = () => { history.replaceState(null, '', '#/settings?tab=' + b.dataset.tab); showSetTab(b.dataset.tab); });
  showSetTab(SET_TABS.some(t => t[0] === tab) ? tab : 'clinic');
}
const metaF = (k, l, w, attr = '', ph = '') => `<label class="${w ? '' : 'grow'}">${l}<input data-m="${k}" value="${esc(L.meta[k] || '')}" ${w ? `style="width:${w}px"` : ''} ${attr} placeholder="${esc(ph)}"></label>`;
const metaT = (k, l, rows, attr = '') => `<label class="grow">${l}<textarea data-m="${k}" rows="${rows}" ${attr} placeholder="${esc(HDR_DEF[k] || '')}">${esc(L.meta[k] || '')}</textarea></label>`;
async function saveMeta(root) { const b = {}; $$('[data-m]', root).forEach(i => b[i.dataset.m] = i.value); await api('PUT', '/api/meta', b); await loadLists(); toast('Saved'); }
/* add / remove editor for a suggestion list */
function listEditor(box, o) {
  let flt = '';
  const draw = () => {
    const items = o.items(), f = norm(flt), shown = f ? items.filter(x => norm(x).includes(f)) : items;
    $('.le-list', box).innerHTML = shown.slice(0, 400).map(x => `<div class="le-it"><span ${o.ar ? 'class="ar"' : 'dir="auto"'}>${esc(x)}</span><button class="small danger" data-del="${esc(x)}" title="Remove from the list">✕</button></div>`).join('')
      + (shown.length > 400 ? `<div class="muted small" style="padding:6px">${shown.length - 400} more — type in the filter box to find them.</div>` : '') + (shown.length ? '' : '<div class="muted small" style="padding:6px">Nothing.</div>');
    $('.le-n', box).textContent = items.length + ' items';
  };
  box.innerHTML = `<div class="row"><label class="grow">Add new<input class="le-add" data-lang="${o.ar ? 'ar' : 'en'}" ${o.ar ? 'dir="rtl"' : ''}></label><button class="primary le-addb">Add</button></div>
    <div class="row" style="margin-top:8px"><label class="grow">Filter<input class="le-f" data-lang="${o.ar ? 'ar' : 'en'}" ${o.ar ? 'dir="rtl"' : ''} placeholder="type to search the list"></label><span class="le-n muted small" style="padding-bottom:6px"></span></div>
    <div class="le-list"></div>`;
  const add = async () => { const i = $('.le-add', box), val = i.value.trim(); if (!val) return i.focus(); try { await o.add(val); await loadLists(); i.value = ''; draw(); toast('Added'); i.focus(); } catch (e) { toast(e.message, true); } };
  $('.le-addb', box).onclick = add; $('.le-add', box).onkeydown = e => { if (e.key === 'Enter') add(); };
  $('.le-f', box).oninput = e => { flt = e.target.value; draw(); };
  $('.le-list', box).onclick = async e => { const d = e.target.dataset.del; if (d === undefined) return; if (!confirm('Remove "' + d + '" from the suggestions?')) return; await o.del(d); await loadLists(); draw(); };
  draw();
}
const vocabEd = kind => ({ items: () => L[{ area: 'areas', occupation: 'occupations', labreq: 'labreq' }[kind]] || [], add: x => api('POST', '/api/vocab', { kind, items: [x] }), del: x => api('DELETE', '/api/vocab', { kind, name: x }) });
const itemEd = kind => ({ items: () => (kind === 'drug' ? L.drugs : L.diagnoses) || [], add: x => api('POST', '/api/list_item', { kind, value: x }), del: x => api('DELETE', '/api/list_item', { kind, value: x }) });
function hourOpts(sel) { let o = ''; for (let h = 0; h < 24; h++) for (const mm of ['00', '30']) { const t = String(h).padStart(2, '0') + ':' + mm; o += `<option value="${t}"${t === sel ? ' selected' : ''}>${fmtTime(t)}</option>`; } return o; }
async function showSetTab(tab) {
  localStorageSet('setTab', tab);
  $$('.vtabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const pane = $('#setPane'), m = L.meta;
  const card = (title, html, extra = '') => `<div class="card"${extra}><h3>${title}</h3>${html}</div>`;
  if (EXTRA_TABS[tab]) return EXTRA_TABS[tab](pane, card);
  if (tab === 'clinic') {
    pane.innerHTML = card('Clinic', `
      <div class="row">${metaF('clinic_name', 'Clinic name (top bar)', 0, 'data-lang="ar" dir="rtl"')}</div>
      <div class="row" style="margin-top:6px">${metaF('doctor_name', 'Doctor name (signature on reports)', 0, 'data-lang="ar" dir="rtl"')}</div>
      <div class="row" style="margin-top:6px">${metaF('doctor_degree', 'Degree (reports)', 0, 'data-lang="ar" dir="rtl"')}</div>
      <div class="row" style="margin-top:6px">${metaF('clinic_address', 'Address', 0, 'data-lang="ar" dir="rtl"')}${metaF('clinic_phone', 'Phone', 200, 'data-lang="en"')}</div>
      <div class="row" style="margin-top:6px">${metaF('visit_price', 'Visit price in thousands (15 = 15,000)', 160, 'data-lang="en" inputmode="numeric"')}${metaF('review_days', 'Review (مراجعة) if within … days of the last visit', 160, 'data-lang="en" inputmode="numeric"')}${metaF('review_price', 'Review price in thousands', 160, 'data-lang="en" inputmode="numeric"')}</div>
      <div class="small muted" style="margin-top:4px">Leave "Review … days" empty to switch it off. Each visit can still be set to Paid / Review / Free by hand (visit header).</div>
      <div class="actions"><button class="primary" id="sv">Save</button></div>`, ' style="max-width:820px"');
    $('#sv').onclick = () => saveMeta(pane);
  } else if (tab === 'print') {
    const isPre = () => $('#rxPaper').value === '0';
    pane.innerHTML = `<div class="split ps">
      <div>${card('Paper', `
        <input type="hidden" data-m="rx_header" id="rxPaper" value="${m.rx_header === '0' ? '0' : '1'}">
        <div class="seg" id="paperSeg"><button data-v="0">${ic('print')} Pre-printed clinic sheet<small>prints only the name, age, date and medicines</small></button><button data-v="1">${ic('tpl')} Plain A5 paper<small>prints the whole sheet design as well</small></button></div>
        <div class="row" id="shiftRow" style="margin-top:10px">${metaF('rx_off_x', 'Printer shift → right + / left − (mm)', 190, 'data-lang="en" inputmode="decimal"')}${metaF('rx_off_y', 'Printer shift ↓ down + / up − (mm)', 190, 'data-lang="en" inputmode="decimal"')}</div>
        <div class="small muted" id="shiftHint" style="margin-top:4px">If everything on a real sheet is off by the same amount, change only these two boxes.</div>`)}
      ${card('Prescription text <span class="sp"></span><button class="small" id="lyReset" style="text-transform:none">↺ Default</button>', `
        <input type="hidden" data-m="rx_layout_pre" id="lyPre" value="${esc(m.rx_layout_pre || '')}"><input type="hidden" data-m="rx_layout_plain" id="lyPlain" value="${esc(m.rx_layout_plain || '')}">
        <div class="small muted" style="margin-bottom:8px">X = distance from the <b>left</b> edge, Y = from the <b>top</b> edge, in mm (A5 = 148 × 210). <b>Tip:</b> drag a text in the preview to move it.</div>
        <div id="lyBox"></div>`)}
      ${card('Sheet texts', `<div class="small muted" style="margin-bottom:6px">Leave a box empty to use the text of the clinic sheet.</div>
        <div class="row">${metaF('hdr_title', 'Title', 140, 'data-lang="ar" dir="rtl"', HDR_DEF.hdr_title)}${metaF('hdr_name', 'Doctor name (red)', 0, 'data-lang="ar" dir="rtl"', HDR_DEF.hdr_name)}</div>
        <div class="row" style="margin-top:6px">${metaF('hdr_degree_en', 'Degree (English, blue + logo)', 0, 'data-lang="en"', HDR_DEF.hdr_degree_en)}</div>
        <div class="row" style="margin-top:6px">${metaT('hdr_lines', 'Qualifications (left block, one per line)', 5, 'data-lang="ar" dir="rtl"')}</div>
        <div class="row" style="margin-top:6px">${metaF('hdr_reg', 'Registration line', 0, 'data-lang="ar" dir="rtl"', HDR_DEF.hdr_reg)}</div>
        <div class="row" style="margin-top:6px">${metaT('hdr_phones', 'Phones (one per line)', 2, 'data-lang="en"')}${metaT('hdr_address', 'Address (two lines)', 2, 'data-lang="ar" dir="rtl"')}</div>`, ' id="hdrCard"')}
      </div>
      <div class="pvcol">${card('Preview <span class="sp"></span><span class="small muted" style="text-transform:none" id="pvMode"></span>', `<div class="pv"><iframe id="pvf" title="Print preview"></iframe></div>
        <div class="actions"><button class="primary" id="sv">Save</button><button id="testPrint">🖨 Test print</button></div>`)}</div></div>`;
    const hid = () => isPre() ? $('#lyPre') : $('#lyPlain');
    const cur = () => { const pre = isPre(), d = rxLayoutDef(pre); let u = {}; try { u = JSON.parse(hid().value || '{}'); } catch (e) { } Object.keys(d).forEach(k => Object.assign(d[k], u[k] || {})); return d; };
    const FLD = { name: 'Patient name', age: 'Age', date: 'Date', body: 'Medicines / text', rx: 'Rx symbol' };
    const drawLayout = () => {
      const pre = isPre(), LY = cur();
      $$('#paperSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === (pre ? '0' : '1')));
      $('#shiftRow').classList.toggle('hidden', !pre); $('#shiftHint').classList.toggle('hidden', !pre); $('#hdrCard').classList.toggle('hidden', pre);
      $('#pvMode').textContent = pre ? 'pre-printed sheet' : 'plain paper';
      const num = (k, f, v, st = '0.5') => `<input type="number" step="${st}" data-ly="${k}" data-f="${f}" value="${v != null ? v : ''}">`;
      const font = (k, e) => `<select data-ly="${k}" data-f="font">${RX_FONTS.map(x => `<option${x === e.font ? ' selected' : ''} style="font-family:${rxFont(x)}">${x}</option>`).join('')}</select>`;
      const al = (k, e) => `<select data-ly="${k}" data-f="align">${[['right', 'Right'], ['center', 'Centre'], ['left', 'Left']].map(([a, t]) => `<option value="${a}"${a === e.align ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
      const bold = (k, e) => `<label class="bchk" title="Bold"><input type="checkbox" data-ly="${k}" data-f="bold"${+e.bold ? ' checked' : ''}><b>B</b></label>`;
      $('#lyBox').innerHTML = `<table class="lyt"><thead><tr><th></th><th>Font</th><th>Size</th><th></th><th>X</th><th>Y</th><th>Width</th><th>Align</th></tr></thead><tbody>
        ${['name', 'age', 'date'].map(k => { const e = LY[k]; return `<tr data-row="${k}"><th>${FLD[k]}</th><td>${font(k, e)}</td><td>${num(k, 'size', e.size)}</td><td>${bold(k, e)}</td><td>${num(k, 'x', e.x)}</td><td>${num(k, 'y', e.y)}</td><td>${num(k, 'w', e.w)}</td><td>${al(k, e)}</td></tr>`; }).join('')}
        <tr data-row="body"><th>${FLD.body}</th><td>${font('body', LY.body)}</td><td>${num('body', 'size', LY.body.size)}</td><td>${bold('body', LY.body)}</td><td>${num('body', 'x', LY.body.x)}</td><td>${num('body', 'y', LY.body.y)}</td><td>${num('body', 'w', LY.body.w)}</td><td></td></tr>
        <tr class="sub"><th></th><td colspan="7"><span class="small muted">Height</span> ${num('body', 'h', LY.body.h)} mm <span class="small muted" style="margin-left:12px">Line spacing</span> ${num('body', 'lh', LY.body.lh, '0.05')}</td></tr>
        <tr data-row="rx"><th>${FLD.rx}</th><td><label class="ck"><input type="checkbox" data-ly="rx" data-f="show"${+LY.rx.show ? ' checked' : ''}> print it</label></td><td>${num('rx', 'size', LY.rx.size, '1')}</td><td></td><td>${num('rx', 'x', LY.rx.x)}</td><td>${num('rx', 'y', LY.rx.y)}</td><td></td><td></td></tr>
        </tbody></table>`;
    };
    const sync = () => { const o = cur(); $$('[data-ly]', $('#lyBox')).forEach(i => { o[i.dataset.ly][i.dataset.f] = i.type === 'checkbox' ? (i.checked ? 1 : 0) : i.tagName === 'SELECT' ? i.value : (i.value === '' ? null : +i.value); });
      Object.values(o).forEach(e => Object.keys(e).forEach(k => e[k] == null && delete e[k])); hid().value = JSON.stringify(o); };
    $('#lyBox').addEventListener('input', sync); $('#lyBox').addEventListener('change', sync);
    $('#paperSeg').onclick = e => { const b = e.target.closest('button[data-v]'); if (!b) return; $('#rxPaper').value = b.dataset.v; drawLayout(); preview(); };
    $('#lyReset').onclick = () => { hid().value = ''; drawLayout(); preview(); toast('Default layout — press Save to keep it'); };
    const sample = '<ol><li dir="auto">ATORVASTATIN TAB. 20 MG حبة ليلا</li><li dir="auto">METFORMIN 500 MG مرتين يوميا بعد الاكل</li><li dir="auto">VITAMIN D3 TAB. 50,000 حبة اسبوعيا</li></ol>';
    const keepP = P;
    const preview = () => {
      const save = L.meta; L.meta = Object.assign({}, save); $$('[data-m]', pane).forEach(i => L.meta[i.dataset.m] = i.value);
      P = { patient: { name: 'اسم المريض التجريبي', birth_year: new Date().getFullYear() - 45 }, visits: [], labs: [] };
      try { $('#pvf').srcdoc = printDoc(todayISO(), sample, { rx: true, preview: true }); } finally { L.meta = save; P = keepP; }
    };
    // drag a text in the preview to move it (X/Y boxes follow)
    $('#pvf').onload = () => {
      const doc = $('#pvf').contentDocument; if (!doc) return;
      const page = doc.querySelector('.page'); if (!page) return;
      doc.head.insertAdjacentHTML('beforeend', '<style>[data-drag]{cursor:move;outline:1px dashed rgba(29,79,138,.35)}[data-drag]:hover{outline:1.5px solid #1d4f8a;background:rgba(29,79,138,.06)}</style>');
      $$('[data-drag]', doc).forEach(el => el.addEventListener('mousedown', ev => {
        ev.preventDefault();
        const k = el.dataset.drag, mm = 148 / page.getBoundingClientRect().width, x0 = ev.clientX, y0 = ev.clientY;
        const ix = $(`[data-ly="${k}"][data-f="x"]`), iy = $(`[data-ly="${k}"][data-f="y"]`), bx = +ix.value || 0, by = +iy.value || 0, l0 = parseFloat(el.style.left), t0 = parseFloat(el.style.top);
        const mv = e => { const dx = Math.round((e.clientX - x0) * mm * 2) / 2, dy = Math.round((e.clientY - y0) * mm * 2) / 2;
          el.style.left = (l0 + dx) + 'mm'; el.style.top = (t0 + dy) + 'mm'; ix.value = bx + dx; iy.value = by + dy; };
        const up = () => { doc.removeEventListener('mousemove', mv); doc.removeEventListener('mouseup', up); sync(); preview(); };
        doc.addEventListener('mousemove', mv); doc.addEventListener('mouseup', up);
      }));
    };
    drawLayout();
    let pt; pane.addEventListener('input', e => { if (e.target.closest('[data-ly],[data-m]')) { clearTimeout(pt); pt = setTimeout(preview, 250); } });
    pane.addEventListener('change', e => { if (e.target.closest('[data-ly],[data-m]')) preview(); });
    preview();
    $('#sv').onclick = () => saveMeta(pane);
    $('#testPrint').onclick = async () => { await saveMeta(pane); P = { patient: { name: 'اسم المريض التجريبي للمعايرة', birth_year: new Date().getFullYear() - 45 }, visits: [], labs: [] }; try { printDoc(todayISO(), sample, { rx: true }); } finally { P = keepP; } };
  } else if (tab === 'hours') {
    pane.innerHTML = card('Appointment hours', `<div class="small muted" style="margin-bottom:8px">Appointments are booked in half-hour slots. The secretary (computer and phone) sees only the slots inside these working hours.</div>
      <div class="row"><label>From<select data-m="work_from">${hourOpts(m.work_from || WORK_DEF[0])}</select></label><label>To (last slot)<select data-m="work_to">${hourOpts(m.work_to || WORK_DEF[1])}</select></label></div>
      <h3 style="margin-top:16px">${ic('wa')} WhatsApp reminder message</h3>
      <div class="small muted" style="margin-bottom:6px">The ${ic('wa')} button on the appointments list opens WhatsApp with this message. You can use {name} {day} {date} {time} {clinic}.</div>
      <textarea data-m="wa_template" rows="3" data-lang="ar" dir="rtl" style="width:100%" placeholder="${esc(WA_DEF)}">${esc(m.wa_template || '')}</textarea>
      <div class="actions"><button class="primary" id="sv">Save</button></div>`, ' style="max-width:720px"');
    $('#sv').onclick = async () => { const f = $('[data-m=work_from]').value, t = $('[data-m=work_to]').value; if (t < f) return toast('"To" must be after "From"', true); await saveMeta(pane); };
  } else if (tab === 'users') {
    pane.innerHTML = card('Users & PINs', `<div class="small muted" style="margin-bottom:6px">Sign-in is by PIN only, so every user needs a different PIN.</div>
      <table class="t"><tbody>${L.users.map(u => `<tr><td>${esc(u.name)}</td><td class="muted">${u.role}</td><td>${u.active ? '' : '<span class="muted">disabled</span>'}</td>
        <td style="text-align:right"><button class="small" data-pin="${u.id}">Set PIN</button> <button class="small" data-act="${u.id}" data-on="${u.active ? 0 : 1}">${u.active ? 'Disable' : 'Enable'}</button></td></tr>`).join('')}</tbody></table>
      <div class="row" style="margin-top:8px"><label class="grow">New user<input id="nuName"></label><label>Role<select id="nuRole"><option value="secretary">Secretary</option><option value="doctor">Doctor</option></select></label><label>PIN<input id="nuPin" type="password" inputmode="numeric" data-lang="en" style="width:90px"></label><button id="nuAdd">Add</button></div>
      <h3 style="margin-top:14px">My PIN</h3>${pinBox()}`, ' style="max-width:820px"');
    $$('[data-pin]').forEach(b => b.onclick = async () => { const p = prompt('New PIN (at least 4 digits, different from the other users):'); if (!p) return; try { await api('PUT', '/api/user/' + b.dataset.pin, { pin: p }); toast('PIN changed'); } catch (e) { toast(e.message, true); } });
    $$('[data-act]').forEach(b => b.onclick = async () => { try { await api('PUT', '/api/user/' + b.dataset.act, { active: !!+b.dataset.on }); await loadLists(); showSetTab('users'); } catch (e) { toast(e.message, true); } });
    $('#nuAdd').onclick = async () => { try { await api('POST', '/api/user', { name: $('#nuName').value, role: $('#nuRole').value, pin: $('#nuPin').value }); await loadLists(); showSetTab('users'); } catch (e) { toast(e.message, true); } };
    bindPin();
  } else if (tab === 'tpl') {
    pane.innerHTML = card('Ready prescriptions <span class="sp"></span><button class="small primary" id="tNew" style="text-transform:none">+ New</button>',
      L.templates.length ? `<table class="t"><tbody>${L.templates.map(t => `<tr class="click" data-t="${t.id}"><td><b>${esc(t.name)}</b></td><td class="muted small" dir="auto">${esc(t.lines.slice(0, 4).join(' · '))}${t.lines.length > 4 ? ' …' : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="muted small">No ready prescriptions yet. Create one here or press "Save as template" inside a visit.</div>');
    $('#tNew').onclick = () => templateDialog({});
    $$('[data-t]').forEach(tr => tr.onclick = () => templateDialog(L.templates.find(t => t.id === +tr.dataset.t)));
  } else if (tab === 'labs') {
    pane.innerHTML = card('Lab tests — normal ranges & chart targets', `
      <table class="t"><thead><tr><th>Test</th><th>Unit</th><th>Low</th><th>High</th><th>Target</th></tr></thead><tbody>
      ${L.lab_tests.map(t => `<tr data-lt="${t.code}"><td>${esc(t.name)}</td><td class="muted small">${esc(t.unit || '')}</td>${['low', 'high', 'target'].map(k => `<td><input data-k="${k}" data-lang="en" value="${t[k] != null ? t[k] : ''}" style="width:70px" inputmode="decimal"></td>`).join('')}</tr>`).join('')}</tbody></table>
      <div class="small muted">Changes save automatically.</div>`, ' style="max-width:820px"');
    $$('[data-lt] input').forEach(i => i.addEventListener('change', () => { const code = i.closest('tr').dataset.lt; enqueue(() => api('PUT', '/api/lab_test/' + code, { [i.dataset.k]: i.value })); }));
  } else if (['labreq', 'drugs', 'dx', 'areas', 'occ'].includes(tab)) {
    const cfg = { labreq: ['Lab request list', 'Suggestions shown while typing a lab request.', vocabEd('labreq'), false],
      drugs: ['Drug suggestions', 'Medication lines suggested while writing a prescription. New lines are added automatically when you prescribe them.', itemEd('drug'), false],
      dx: ['Diagnosis suggestions', 'Suggested while typing the diagnosis. New diagnoses are added automatically.', itemEd('dx'), false],
      areas: ['Addresses (areas)', 'Saved areas suggested in the patient address field.', vocabEd('area'), true],
      occ: ['Occupations', 'Saved occupations suggested in the patient form.', vocabEd('occupation'), true] }[tab];
    pane.innerHTML = card(cfg[0], `<div class="small muted" style="margin-bottom:8px">${cfg[1]}</div><div id="le"></div>`, ' style="max-width:820px"');
    listEditor($('#le'), Object.assign({ ar: cfg[3] }, cfg[2]));
  } else if (tab === 'dups') {
    const dups = JSON.parse(m.dup_names || '[]');
    pane.innerHTML = card('Possible duplicate files', dups.length ? `<div class="small muted" style="margin-bottom:6px">These names appear more than once in the old program. Old visits were attached to the first file. Open each one and use <b>Merge…</b> if they are the same person.</div>
        ${dups.map(n => `<div><a href="#" data-dq="${esc(n)}" class="ar">${esc(n)}</a></div>`).join('')}` : '<div class="muted small">None.</div>', ' style="max-width:820px"');
    $$('[data-dq]').forEach(a => a.onclick = e => { e.preventDefault(); const q = $('#q'); q.value = a.dataset.dq; q.dispatchEvent(new Event('input')); q.focus(); });
  } else if (tab === 'online') {
    pane.innerHTML = card('Online version (Google)<span class="sp"></span><span id="syncSt" class="small" style="text-transform:none"></span>', `
      <div class="small muted" style="margin-bottom:6px">Phone page for the secretary (Arabic) and the doctor (English, view only), working from anywhere. Follow the guide in the <b>google</b> folder (دليل الإعداد) once, then paste the link and the token here.</div>
      <div class="row"><label class="grow">Web app link (ends with /exec)<input id="syUrl" data-lang="en" value="${esc(m.sync_url || '')}" placeholder="https://script.google.com/macros/s/…/exec"></label></div>
      <div class="row" style="margin-top:6px"><label class="grow">Sync token<input id="syTok" data-lang="en" type="password" placeholder="${m.sync_url ? 'saved — type only to change it' : 'from the setup step in Google'}"></label></div>
      <div class="actions"><button class="primary" id="sySave">Save &amp; connect</button><button id="syNow">Sync now</button><button id="syBk">Sync + backup to Drive</button></div>
      <div class="small muted" id="syInfo" style="margin-top:6px"></div>`, ' style="max-width:820px"');
    const showSync = async () => {
      const z = await api('GET', '/api/sync'); if (!$('#syncSt')) return;
      $('#syncSt').innerHTML = !z.enabled && !(z.url && z.has_token) ? '<span class="muted">not connected</span>' : z.error ? `<span style="color:var(--warn)">● ${esc(z.error)}</span>` : z.last_ok ? '<span style="color:var(--ok)">● connected</span>' : '<span class="muted">connecting…</span>';
      $('#syInfo').innerHTML = z.url ? `Last sync: ${esc(z.last_ok || '—')} · waiting to upload: ${z.pending} · from phone: ${z.pulled} appointments, ${z.new_patients} new patients · doctor summaries: ${esc(z.clinical_last || '—')} · Drive backup: ${esc(z.backup_last || '—')}` : '';
    };
    showSync(); const syT = setInterval(() => { if (!$('#syncSt')) return clearInterval(syT); showSync(); }, 5000);
    $('#sySave').onclick = async () => { try { await api('PUT', '/api/sync_config', { url: $('#syUrl').value, token: $('#syTok').value }); await api('POST', '/api/sync_now', {}); $('#syTok').value = ''; toast('Saved — first upload of all patients may take a few minutes'); } catch (e) { toast(e.message, true); } };
    $('#syNow').onclick = async () => { await api('POST', '/api/sync_now', {}); toast('Syncing…'); };
    $('#syBk').onclick = async () => { await api('POST', '/api/sync_now', { backup: 1 }); toast('Syncing + uploading a full backup…'); };
  } else if (tab === 'data') {
    const st = await api('GET', '/api/status');
    pane.innerHTML = card('Data & backup', `
      <dl class="sum" style="display:grid;grid-template-columns:170px 1fr;gap:4px">
        <dt class="muted">Patients</dt><dd>${st.patients}</dd><dt class="muted">Visits</dt><dd>${st.visits}</dd><dt class="muted">Lab values</dt><dd>${st.labs}</dd>
        <dt class="muted">Last backup</dt><dd>${esc(st.backup.last || '—')} ${st.backup.error ? '<span style="color:var(--warn)">' + esc(st.backup.error) + '</span>' : ''}</dd>
        <dt class="muted">Database</dt><dd class="small">${esc(st.db)}</dd>
        <dt class="muted">Open from other devices</dt><dd>${st.ips.map(i => `<span class="kbd">http://${i}:${st.port}</span>`).join(' ')}</dd>
        ${m.import_date ? `<dt class="muted">Old data imported</dt><dd>${dmy(m.import_date)}</dd>` : ''}</dl>
      <div class="actions"><button id="bkNow">Back up now</button></div>
      <div class="small muted">Automatic backup at every start and every 6 hours (last 30 kept) in the <b>backups</b> folder.</div>`, ' style="max-width:820px"');
    $('#bkNow').onclick = async () => { await api('POST', '/api/backup'); toast('Backup started'); setTimeout(() => showSetTab('data'), 1500); };
    renderBackups(pane);
  }
}
function pinBox() { return `<div class="row"><label>Current PIN<input id="pOld" type="password" inputmode="numeric" style="width:100px"></label><label>New PIN<input id="pNew" type="password" inputmode="numeric" style="width:100px"></label><button id="pSave">Change</button></div>`; }
function bindPin() { $('#pSave').onclick = async () => { try { await api('PUT', '/api/my_pin', { old: $('#pOld').value, new: $('#pNew').value }); toast('PIN changed'); $('#pOld').value = $('#pNew').value = ''; } catch (e) { toast(e.message, true); } }; }

boot();
