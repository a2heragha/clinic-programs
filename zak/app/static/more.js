/* Zak Clinic — more features (loaded after app.js and extra.js)
   automatic follow-up appointments + phone calls + waiting list · WhatsApp reminders for tomorrow ·
   weight / BMI / waist · family history · Arabic visit summary · whole-file export (PDF) · accounts */

Object.assign(ICONS, {
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  hourglass: '<path d="M6 2h12M6 22h12M7 2v4a5 5 0 0 0 5 5 5 5 0 0 0 5-5V2M7 22v-4a5 5 0 0 1 5-5 5 5 0 0 1 5 5v4"/>',
  auto: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M12 7v5l3 2"/>',
  scale: '<path d="M5 21h14a2 2 0 0 0 2-2l-1.5-11a2 2 0 0 0-2-1.7h-11a2 2 0 0 0-2 1.7L3 19a2 2 0 0 0 2 2z"/><path d="M12 10l2.5-2.5"/><circle cx="12" cy="11" r="1"/>',
  family: '<circle cx="8" cy="6" r="3"/><circle cx="17" cy="8" r="2.4"/><path d="M2 21v-2a5 5 0 0 1 10 0v2M13.5 21v-1.5a3.5 3.5 0 0 1 7 0V21"/>',
});
NAV_ICON['#/money'] = 'money';
decorateNav();

/* ============================================================ automatic appointments + calls + waiting list */
const CALL_TXT = { yes: 'Called — coming', no: 'Called — not coming', noans: 'No answer' };
function apptBadges(r) {
  let h = '';
  if (r.kind === 'auto') h += `<span class="abadge auto" title="Made automatically from the follow-up date">${ic('auto')}Auto</span>`;
  if (r.call) h += `<span class="abadge c-${r.call}">${ic('phone')}${CALL_TXT[r.call]}</span>`;
  return h ? `<div class="abadges">${h}</div>` : '';
}
function callBtns(r) {
  if (r.status === 'done' || r.status === 'in') return '';
  let h = '';
  if (r.kind === 'auto' && !r.status) {
    h += r.call ? `<button data-call="" title="Change the call result">${ic('phone')}↺</button>`
      : `<button data-call="yes" class="c-yes" title="Called — will come">${ic('phone')}Coming</button><button data-call="no" class="c-no" title="Called — will not come">Not coming</button><button data-call="noans" title="No answer — try again later">No answer</button>`;
  }
  if (r.call === 'no' || r.call === 'noans' || r.status === 'noshow') h += `<button data-hold title="Move to the waiting list (book a new date later)">${ic('hourglass')}Waiting list</button>`;
  return h;
}
async function renderRecall(v, date) {
  const box = $('#recallBox'); if (!box) return;
  let d; try { d = await api('GET', '/api/recall'); } catch (e) { return; }
  if (!$('#recallBox')) return;
  const ph = r => esc(r.phone || '');
  const calls = d.calls, hold = d.hold;
  box.innerHTML = `<div class="rgrid">
    <div class="card rc-calls"><h3>${ic('phone')} Calls to make <span class="muted small" style="text-transform:none">· automatic follow-ups in the next 7 days</span><span class="sp"></span><b class="cnt">${calls.length}</b></h3>
      ${calls.length ? `<table class="t"><tbody>${calls.map(r => `<tr data-u="${r.uid}"><td style="white-space:nowrap">${dmy(r.date)}</td>
        <td>${r.patient_id ? `<a href="#/p/${r.patient_id}" class="ar">${esc(r.name)}</a>` : `<span class="ar">${esc(r.name)}</span>`}${r.call === 'noans' ? ' <span class="abadge c-noans">no answer</span>' : ''}</td>
        <td style="white-space:nowrap">${r.phone ? `<a href="tel:${ph(r)}">${ph(r)}</a>` : '<span class="muted">no phone</span>'}</td>
        <td class="stbtns" style="white-space:nowrap"><button data-call="yes" class="c-yes">${ic('phone')}Coming</button><button data-call="no" class="c-no">Not coming</button><button data-call="noans">No answer</button>${r.phone ? `<button data-wa class="wa" title="WhatsApp">${ic('wa')}</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<div class="muted small">Nothing to call — all automatic appointments of the coming week are confirmed.</div>'}</div>
    <div class="card rc-hold"><h3>${ic('hourglass')} Waiting list <span class="muted small" style="text-transform:none">· patients to give a new date</span><span class="sp"></span><b class="cnt">${hold.length}</b></h3>
      ${hold.length ? `<table class="t"><tbody>${hold.map(r => `<tr data-u="${r.uid}"><td>${r.patient_id ? `<a href="#/p/${r.patient_id}" class="ar">${esc(r.name)}</a>` : `<span class="ar">${esc(r.name)}</span>`}
          <div class="small muted">was ${dmy(r.date)}${r.call ? ' · ' + CALL_TXT[r.call] : ''}${r.status === 'noshow' ? ' · no-show' : ''}</div></td>
        <td style="white-space:nowrap">${r.phone ? `<a href="tel:${ph(r)}">${ph(r)}</a>` : ''}</td>
        <td style="white-space:nowrap"><input type="date" data-nd value="${addDays(todayISO(), 1)}">${timeSelect('', '', {}, 'width:120px').replace('<select', '<select data-nt')}
          <button data-book class="primary">Book</button><button data-wa class="wa" title="WhatsApp">${ic('wa')}</button><button data-rm class="danger" title="Remove from the list">✕</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="muted small">Empty. Patients who will not come (or did not come) can be moved here and booked again later.</div>'}</div></div>`;
  box.onclick = async e => {
    const tr = e.target.closest('tr[data-u]'); if (!tr) return;
    const uid = tr.dataset.u, r = calls.concat(hold).find(x => x.uid === uid);
    try {
      const cb = e.target.closest('[data-call]'); if (cb) { await api('PUT', '/api/appt/' + uid, { call: cb.dataset.call }); return viewToday(v, date); }
      if (e.target.closest('[data-wa]')) { const n = waNumber(r.phone); if (!n) return toast('Not a valid mobile number', true); window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(waText(r.name, r.date, r.time)), '_blank'); return; }
      if (e.target.closest('[data-book]')) {
        const nd = $('[data-nd]', tr).value; if (!nd) return toast('Choose the date', true);
        await api('PUT', '/api/appt/' + uid, { date: nd, time: $('[data-nt]', tr).value, hold: 0, call: 'yes', status: '' });
        toast('Booked for ' + dmy(nd)); return viewToday(v, date);
      }
      if (e.target.closest('[data-rm]')) { if (confirm('Remove ' + r.name + ' from the waiting list?')) { await api('DELETE', '/api/appt/' + uid); viewToday(v, date); } }
    } catch (er) { toast(er.message, true); }
  };
  const n = $('#waTomN'); if (n) api('GET', '/api/appts?date=' + addDays(date, 1)).then(rs => { n.textContent = rs.length ? `${rs.filter(x => x.reminded).length} of ${rs.length} reminded` : 'no appointments tomorrow'; });
}

/* ============================================================ WhatsApp reminders for tomorrow (one click per patient, in order) */
async function waTomorrow(date) {
  const rows = (await api('GET', '/api/appts?date=' + date)).filter(r => r.status !== 'noshow');
  if (!rows.length) return toast('No appointments on ' + dmy(date));
  const close = modal(`<h2>${ic('wa')} Reminders — ${dmy(date)}<span class="sp"></span><button data-close>✕</button></h2>
    <div class="small muted" style="margin-bottom:8px">Press <b>Send next</b>: WhatsApp opens with the message ready — press send there, come back and press it again for the next patient.</div>
    <table class="t" id="waT"><tbody>${rows.map(r => { const ok = waNumber(r.pphone || r.phone); return `<tr data-id="${r.id}" class="${r.reminded ? 'sent' : ''}">
      <td>${esc(fmtTime(r.time))}</td><td class="ar">${esc(r.pname || r.name)}</td><td>${esc(r.pphone || r.phone || '')}</td>
      <td style="text-align:right">${ok ? `<span class="small st">${r.reminded ? '✓ sent' : ''}</span> <button class="small wa" data-one>${ic('wa')} Send</button>` : '<span class="muted small">no mobile number</span>'}</td></tr>`; }).join('')}</tbody></table>
    <div class="foot"><button data-close>Close</button><button class="primary" id="waNext">${ic('wa')} Send next</button></div>`);
  const send = async tr => {
    const r = rows.find(x => x.id === +tr.dataset.id), n = waNumber(r.pphone || r.phone); if (!n) return;
    window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(waText(r.pname || r.name, date, r.time)), '_blank');
    r.reminded = Date.now(); tr.classList.add('sent'); $('.st', tr).textContent = '✓ sent';
    api('PUT', '/api/appt/' + r.id, { reminded: r.reminded }).catch(() => { });
  };
  $('#waT').onclick = e => { const b = e.target.closest('[data-one]'); if (b) send(b.closest('tr')); };
  $('#waNext').onclick = () => { const tr = $$('#waT tr').find(t => !t.classList.contains('sent') && $('[data-one]', t)); if (!tr) { toast('All reminders sent'); return close(); } send(tr); };
}

/* ============================================================ weight · BMI · waist */
function bmiClass(b) { return b < 18.5 ? ['Underweight', 'mid'] : b < 25 ? ['Normal', 'ok'] : b < 30 ? ['Overweight', 'mid'] : b < 35 ? ['Obesity I', 'abn'] : b < 40 ? ['Obesity II', 'abn'] : ['Obesity III', 'abn']; }
function renderWeight() {
  const box = $('#wtCard'); if (!box || !P) return;
  const p = P.patient, pts = P.visits.filter(v => nz(v.weight)).map(v => [v.date, +v.weight]).sort((a, b) => a[0] < b[0] ? -1 : 1);
  const wst = P.visits.filter(v => nz(v.waist)).sort((a, b) => a.date < b.date ? 1 : -1)[0];
  const ht = +p.height || +((P.visits.find(v => nz(v.height)) || {}).height) || 0;
  if (!pts.length && !wst) { box.innerHTML = `<h3>${ic('scale')} Weight &amp; BMI</h3><div class="muted small">No weight recorded yet.</div>`; return; }
  const last = pts[pts.length - 1], bmi = last && ht ? last[1] / Math.pow(ht / 100, 2) : null, bc = bmi ? bmiClass(bmi) : null;
  const yAgo = addDays(todayISO(), -365), base = pts.find(x => x[0] >= yAgo);
  const chg = last && base && base[0] !== last[0] ? last[1] - base[1] : null;
  const wLim = p.gender === 'F' ? 80 : 94;   // IDF Middle-East cut-off
  const sh = pts.slice(-24);
  let svg = '';
  if (sh.length > 1) {
    const W = 300, H = 90, ys = sh.map(x => x[1]), lo = Math.min(...ys) - 1, hi = Math.max(...ys) + 1;
    const X = i => 8 + i * (W - 16) / (sh.length - 1), Y = w => H - 10 - (w - lo) * (H - 22) / (hi - lo || 1);
    svg = `<svg class="wchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline fill="none" stroke="var(--accent)" stroke-width="2" points="${sh.map((x, i) => X(i) + ',' + Y(x[1])).join(' ')}"/>
      ${sh.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x[1])}" r="3" fill="var(--accent)"><title>${dmy(x[0])}: ${fnum(x[1])} kg</title></circle>`).join('')}
      <text x="4" y="10" font-size="9" fill="currentColor" opacity=".6">${fnum(hi - 1)}</text><text x="4" y="${H - 2}" font-size="9" fill="currentColor" opacity=".6">${fnum(lo + 1)}</text></svg>`;
  }
  box.innerHTML = `<h3>${ic('scale')} Weight &amp; BMI</h3>
    <div class="wkpi">${last ? `<div><b>${fnum(last[1])}</b><span>kg · ${dmy(last[0])}</span></div>` : ''}
      ${bmi ? `<div><b class="${bc[1]}">${fnum(bmi)}</b><span>BMI · ${bc[0]}</span></div>` : `<div><b class="muted">—</b><span>BMI (no height)</span></div>`}
      ${wst ? `<div><b class="${+wst.waist >= wLim ? 'abn' : 'ok'}">${fnum(wst.waist, 0)}</b><span>waist cm${+wst.waist >= wLim ? ' · central obesity' : ''}</span></div>` : ''}</div>
    ${chg != null ? `<div class="small ${chg > 0 ? '' : ''}" style="margin-top:4px">${chg > 0 ? '▲ +' : chg < 0 ? '▼ ' : ''}${fnum(chg)} kg since ${dmy(base[0])}${base[1] ? ` (${fnum(chg / base[1] * 100)}%)` : ''}</div>` : ''}
    ${svg}`;
}

/* ============================================================ family history from the linked relatives */
const FIRST_DEG = /^(Father|Mother|Brother|Sister|Son|Daughter)$/;
const FH_CONDS = [['dm', 'Diabetes'], ['htn', 'Hypertension'], ['ihd', 'IHD'], ['stroke', 'Stroke'], ['ckd', 'CKD'], ['lipid', 'Dyslipidaemia'], ['thyroid', 'Thyroid'], ['asthma', 'Asthma/COPD']];
function famConds(f) { const t = f.chronic || ''; return FH_CONDS.filter(([k]) => hasCond(k, t)).map(c => c[1]).concat(/cancer|carcinoma|malignan|lymphoma|leuk/i.test(t) ? ['Cancer'] : []); }
function famCVD() { return ((P && P.family) || []).filter(f => FIRST_DEG.test(f.relation) && (hasCond('ihd', f.chronic || '') || hasCond('stroke', f.chronic || ''))); }
function renderFamHx() {
  const box = $('#famHx'); if (!box || !P) return;
  const fam = (P.family || []).map(f => [f, famConds(f)]).filter(x => x[1].length);
  if (!(P.family || []).length) { box.innerHTML = `<h3>${ic('family')} Family history</h3><div class="muted small">No relatives linked. Use “+ Link family member” under the name.</div>`; return; }
  const cvd = famCVD();
  box.innerHTML = `<h3>${ic('family')} Family history <span class="muted small" style="text-transform:none">· from linked files</span></h3>
    ${cvd.length ? `<div class="chip abn" style="margin-bottom:6px">ASCVD in a first-degree relative (${cvd.map(f => esc(f.relation)).join(', ')}) — risk enhancer</div>` : ''}
    ${fam.length ? fam.map(([f, c]) => `<div class="fhr"><a href="#/p/${f.id}" class="ar">${esc(f.name)}</a> <small class="muted">${esc(f.relation)}</small><div>${c.map(x => `<span class="chip">${x}</span>`).join(' ')}</div></div>`).join('')
      : `<div class="muted small">${P.family.length} linked relative(s) — no chronic disease recorded in their files.</div>`}`;
}
(function () {   // ASCVD calculator: mention the family history when opened from a patient
  const c = CALCS.find(x => x.id === 'ascvd'); if (!c) return;
  const r0 = c.r;
  c.r = v => { const x = r0(v); const f = famCVD(); if (x && f.length) x[0] += ` · Risk enhancer: ASCVD in ${f.map(y => y.relation.toLowerCase()).join(', ')} — favours starting a statin`; return x; };
})();

/* ============================================================ Arabic summary of the visit for the patient */
const DX_AR = [[/type\s*1\s*diab|\bt1dm\b/i, 'داء السكري النوع الأول'], [/gestational|\bgdm\b/i, 'سكري الحمل'], [/pre-?diabet/i, 'مقدمات السكري'], [/diabet|\bt2dm\b|\bdm\b/i, 'داء السكري'],
  [/hypertens|\bhtn\b/i, 'ارتفاع ضغط الدم'], [/lipid|cholesterol|triglycerid/i, 'ارتفاع الدهون في الدم'], [/hypothyroid|hashimoto/i, 'قصور الغدة الدرقية'], [/hyperthyroid|graves|thyrotox/i, 'فرط نشاط الغدة الدرقية'],
  [/heart failure|\bhf\b/i, 'عجز القلب'], [/atrial fibrillation|\baf\b/i, 'الرجفان الأذيني'], [/\bihd\b|isch?a?emic heart|angina|\bcad\b|coronary/i, 'مرض الشرايين التاجية للقلب'],
  [/\bckd\b|chronic kidney/i, 'مرض الكلى المزمن'], [/stone|calcul|colic/i, 'حصى / مغص كلوي'], [/\buti\b|urinary tract|cystitis/i, 'التهاب المجاري البولية'], [/asthma/i, 'الربو'], [/\bcopd\b/i, 'انسداد الرئة المزمن'],
  [/pneumonia/i, 'التهاب الرئة'], [/bronchitis/i, 'التهاب القصبات'], [/\burti\b|pharyngit|tonsill|common cold|rhinit/i, 'التهاب المجاري التنفسية العليا'], [/sinusit/i, 'التهاب الجيوب الأنفية'],
  [/an(a)?emia/i, 'فقر الدم'], [/vit(amin)?\s*d|hypovit/i, 'نقص فيتامين د'], [/\bb12\b/i, 'نقص فيتامين ب12'], [/gerd|reflux/i, 'ارتجاع المريء'], [/gastrit|dyspeps/i, 'التهاب المعدة / عسر الهضم'],
  [/peptic|ulcer/i, 'قرحة هضمية'], [/\bibs\b|irritable bowel/i, 'القولون العصبي'], [/gastroenterit|diarrh/i, 'التهاب المعدة والأمعاء'], [/constipat/i, 'الإمساك'], [/fatty liver|nafld|masld|steato/i, 'الكبد الدهني'],
  [/gout|hyperuric/i, 'النقرس / ارتفاع حامض اليوريك'], [/osteoarth|\boa\b/i, 'خشونة المفاصل'], [/rheumatoid/i, 'التهاب المفاصل الرثوي'], [/osteopor/i, 'هشاشة العظام'], [/back pain|lumbago|sciatica/i, 'ألم أسفل الظهر'],
  [/obes/i, 'السمنة'], [/migraine/i, 'الشقيقة'], [/headache/i, 'صداع'], [/vertigo|dizz/i, 'دوار'], [/anxiety/i, 'القلق'], [/depress/i, 'الاكتئاب'], [/insomnia/i, 'الأرق'], [/\bbph\b|prostat/i, 'تضخم البروستات'],
  [/allerg|urticaria/i, 'حساسية'], [/eczema|dermatit/i, 'التهاب الجلد / الأكزيما'], [/fever/i, 'حمى'], [/covid/i, 'كوفيد-19'], [/stroke|\bcva\b|\btia\b/i, 'جلطة دماغية']];
const dxAr = d => { const m = DX_AR.find(([re]) => re.test(d)); return m ? m[1] : ''; };
const DAY_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
async function printSummaryAr() {
  await saveVisitNow();
  const x = curVisit(); if (!x) return;
  const meds = currentMeds().length ? currentMeds() : (x.meds || []);
  const dx = (x.diagnosis || '').split('\n').map(s => s.trim()).filter(Boolean);
  const p = P.patient, ht = +x.height || +p.height, bmi = nz(x.weight) && ht ? +x.weight / Math.pow(ht / 100, 2) : null;
  const vit = [x.bp_sys ? ['ضغط الدم', `${x.bp_sys}/${x.bp_dia || '?'} ملم زئبق`] : null, x.hr ? ['النبض', x.hr + ' /دقيقة'] : null, nz(x.weight) ? ['الوزن', fnum(x.weight) + ' كغم'] : null,
    bmi ? ['مؤشر كتلة الجسم', fnum(bmi)] : null, nz(x.waist) ? ['محيط الخصر', fnum(x.waist, 0) + ' سم'] : null, nz(x.rbs) ? ['السكر العشوائي', fnum(x.rbs, 0) + ' ملغم/دسل'] : null, nz(x.spo2) ? ['الأوكسجين', x.spo2 + '%'] : null].filter(Boolean);
  const fu = x.follow_up ? `${DAY_AR[new Date(x.follow_up + 'T12:00:00').getDay()]} ${dmy(x.follow_up)}` : '';
  const body = `<div dir="rtl" style="font-family:Tahoma,Arial;font-size:10.5pt;line-height:1.55">
    <h1 style="font-size:13pt;margin:0 0 3mm">ملخص الزيارة</h1>
    ${dx.length ? `<p style="margin:0 0 2mm"><b>التشخيص:</b></p><ul style="margin:0 0 3mm;padding-right:6mm">${dx.map(d => `<li>${dxAr(d) ? esc(dxAr(d)) + ' — ' : ''}<span dir="ltr">${esc(d)}</span></li>`).join('')}</ul>` : ''}
    ${vit.length ? `<p style="margin:0 0 3mm"><b>القياسات:</b> ${vit.map(v => `${v[0]}: <span dir="ltr">${esc(v[1])}</span>`).join(' · ')}</p>` : ''}
    ${meds.length ? `<p style="margin:0 0 1mm"><b>العلاج:</b></p><ol style="margin:0 0 3mm;padding-right:6mm">${meds.map(m => `<li dir="auto">${esc(m)}</li>`).join('')}</ol>` : ''}
    ${x.plan ? `<p style="margin:0 0 3mm;white-space:pre-wrap"><b>التعليمات والفحوصات:</b><br><span dir="auto">${esc(x.plan)}</span></p>` : ''}
    ${fu ? `<p style="margin:0 0 3mm"><b>موعد المراجعة:</b> ${fu}</p>` : ''}
    <p style="font-size:9pt;color:#444;margin-top:4mm">يرجى إحضار هذه الورقة والأدوية ونتائج الفحوصات عند المراجعة. في حال حدوث أعراض شديدة راجع الطوارئ.</p></div>`;
  printDoc(x.date, body, { rtl: true });
}

/* ============================================================ whole file as a document (Save as PDF) for a referral */
function exportFile() {
  const p = P.patient, m = L.meta, lines = s => (s || '').split('\n').map(x => x.trim()).filter(Boolean);
  const tests = Object.fromEntries((L.lab_tests || []).map(t => [t.code, t]));
  const byCode = {}; (P.labs || []).filter(l => l.value != null || l.text).forEach(l => (byCode[l.code] = byCode[l.code] || []).push(l));
  const labRows = Object.keys(byCode).map(c => { const a = byCode[c].sort((x, y) => x.date < y.date ? -1 : 1).slice(-6); const t = tests[c] || {};
    return `<tr><td><b>${esc(t.name || c)}</b> <small>${esc(t.unit || '')}</small></td>${a.map(l => `<td>${esc(l.value != null ? fnum(l.value, 2) : l.text)}<br><small>${dmy(l.date)}</small></td>`).join('')}</tr>`; }).join('');
  const fam = (P.family || []).map(f => [f, famConds(f)]).filter(x => x[1].length);
  const vs = P.visits.slice().sort((a, b) => a.date < b.date ? 1 : -1);
  const vit = x => [x.bp_sys ? `BP ${x.bp_sys}/${x.bp_dia || '?'}` : '', x.hr ? `PR ${x.hr}` : '', nz(x.temp) ? `T ${fnum(x.temp)}°C` : '', x.spo2 ? `SpO₂ ${x.spo2}%` : '', nz(x.rbs) ? `RBS ${fnum(x.rbs, 0)}` : '', nz(x.weight) ? `Wt ${fnum(x.weight)} kg` : '', nz(x.waist) ? `Waist ${fnum(x.waist, 0)} cm` : ''].filter(Boolean).join(' · ');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.name)} — medical file</title><style>
    @page{size:A4;margin:14mm 13mm}body{font:10pt/1.45 "Segoe UI",Tahoma,Arial,sans-serif;color:#111}h1{font-size:15pt;margin:0}h2{font-size:11pt;margin:6mm 0 2mm;border-bottom:1.5px solid #1d4f8a;color:#1d4f8a;padding-bottom:1mm}
    .hd{display:flex;justify-content:space-between;border-bottom:2px solid #1d4f8a;padding-bottom:3mm;margin-bottom:3mm}.ar{direction:rtl;font-family:Tahoma,Arial}.muted{color:#555}
    table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd;padding:1.5mm 2mm;vertical-align:top;text-align:left}small{color:#555}.v{border-left:3px solid #1d4f8a;padding:1mm 0 1mm 3mm;margin:0 0 3mm;page-break-inside:avoid}
    .v b.d{color:#1d4f8a}.tag{display:inline-block;border:1px solid #b33;color:#b33;border-radius:3px;padding:0 4px;margin:0 3px 2px 0}.k{color:#555;font-weight:700;margin-right:2px}</style></head><body>
    <div class="hd"><div><h1>Medical file</h1><div class="muted">${esc(m.clinic_name || '')} · ${esc(m.doctor_name || '')}${m.clinic_phone ? ' · ' + esc(m.clinic_phone) : ''}</div></div><div style="text-align:right" class="muted">Printed ${dmy(todayISO())}<br>File #${p.id}</div></div>
    <table><tr><td style="width:50%"><b class="ar" style="font-size:12pt">${esc(p.name)}</b><br>${p.age != null ? p.age + ' years' : ''}${p.gender ? ' · ' + (p.gender === 'M' ? 'Male' : 'Female') : ''}${p.dob ? ' · DOB ' + dmy(p.dob) : ''}</td>
      <td>${esc(p.phone || '')}<br><span class="ar">${esc(p.address || '')}</span>${p.occupation ? ' · <span class="ar">' + esc(p.occupation) + '</span>' : ''}</td></tr></table>
    <h2>Summary</h2>
    <p><b>Allergies:</b> ${lines(p.allergies).length ? lines(p.allergies).map(a => `<span class="tag">${esc(a)}</span>`).join('') : 'none known'}</p>
    ${lines(p.chronic).length ? `<p><b>Chronic conditions:</b> ${lines(p.chronic).map(esc).join(' · ')}</p>` : ''}
    ${p.past_history ? `<p><b>Past history:</b> ${esc(p.past_history)}</p>` : ''}
    ${lines(p.long_meds).length ? `<p><b>Regular medications:</b><br>${lines(p.long_meds).map(esc).join('<br>')}</p>` : ''}
    ${p.smoking ? `<p><b>Smoking:</b> ${esc(p.smoking)}</p>` : ''}
    ${fam.length ? `<p><b>Family history:</b> ${fam.map(([f, c]) => esc(f.relation) + ' — ' + c.join(', ')).join(' · ')}</p>` : ''}
    ${labRows ? `<h2>Laboratory results (latest 6 of each)</h2><table>${labRows}</table>` : ''}
    <h2>Visits (${vs.length})</h2>
    ${vs.map(x => `<div class="v"><b class="d">${dmy(x.date)}</b> <small>${vit(x)}</small>
      ${x.diagnosis ? `<div><span class="k">A</span><b>${esc(x.diagnosis).replace(/\n/g, ' · ')}</b></div>` : ''}
      ${x.complaint ? `<div><span class="k">S</span>${esc(x.complaint)}</div>` : ''}${x.exam ? `<div><span class="k">O</span>${esc(x.exam)}</div>` : ''}
      ${x.plan ? `<div><span class="k">P</span>${esc(x.plan)}</div>` : ''}${x.imaging ? `<div><span class="k">Im</span>${esc(x.imaging)}</div>` : ''}${!x.complaint && !x.exam && x.notes ? `<div style="white-space:pre-wrap">${esc(x.notes)}</div>` : ''}
      ${(x.meds || []).length ? `<div><span class="k">℞</span>${x.meds.map(esc).join(' · ')}</div>` : ''}${x.follow_up ? `<div><small>Follow-up ${dmy(x.follow_up)}</small></div>` : ''}</div>`).join('')}
    <p style="margin-top:8mm;text-align:right"><b>${esc(m.doctor_name || '')}</b></p></body></html>`;
  const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'; document.body.appendChild(f);
  f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
  toast('Choose “Save as PDF” as the printer to make a PDF file');
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 3000); }, 400);
}

/* ============================================================ accounts */
async function viewMoney(v, params) {
  const t = todayISO(), m1 = t.slice(0, 8) + '01';
  const from = params.from || m1, to = params.to || t;
  const d = await api('GET', `/api/money?from=${from}&to=${to}`);
  const k = (n, l, cls = '') => `<div class="kpi ${cls}"><b>${n}</b><span>${l}</span></div>`;
  const S = f => d.days.reduce((a, r) => a + (+r[f] || 0), 0);
  const iqd = x => (Math.round(x * 1000)).toLocaleString('en') + ' IQD';
  const prevM = (() => { const x = new Date(m1 + 'T12:00:00'); x.setMonth(x.getMonth() - 1); return x.toISOString().slice(0, 8) + '01'; })();
  const mx = Math.max(1, ...d.months.map(r => +r.total || 0));
  const todayRow = d.days.find(r => r.date === t);
  v.innerHTML = `<div class="card"><h3>${ic('money')} Accounts<span class="sp"></span>
      <label class="small" style="text-transform:none">From <input type="date" id="mf" value="${from}"></label><label class="small" style="text-transform:none">To <input type="date" id="mt" value="${to}"></label>
      <button class="small" data-r="${t}|${t}">Today</button><button class="small" data-r="${m1}|${t}">This month</button><button class="small" data-r="${prevM}|${addDays(m1, -1)}">Last month</button><button class="small" id="mCsv">CSV</button></h3>
    <div class="kpis">${k(iqd(S('total')), 'income ' + (from === to ? dmy(from) : dmy(from) + ' – ' + dmy(to)))}${k(S('n'), 'visits')}${k(S('paid'), 'paid visits')}${k(S('review'), 'reviews (مراجعة)')}${k(S('free'), 'free')}
      ${from !== t || to !== t ? k(todayRow ? iqd(+todayRow.total) : '0 IQD', 'today ' + dmy(t)) : ''}</div>
    <div class="sgrid"><div><h3>By day</h3><table class="t"><thead><tr><th>Date</th><th>Visits</th><th>Paid</th><th>Review</th><th>Free</th><th style="text-align:right">Income</th></tr></thead><tbody>
      ${d.days.slice().reverse().map(r => `<tr><td><a href="#/log?from=${r.date}&to=${r.date}">${DAY_EN[new Date(r.date + 'T12:00:00').getDay()]} ${dmy(r.date)}</a></td><td>${r.n}</td><td>${r.paid}</td><td>${r.review}</td><td>${r.free}</td><td style="text-align:right"><b>${iqd(+r.total)}</b></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No visits.</td></tr>'}</tbody></table></div>
    <div><h3>Last 12 months</h3><div class="bars">${d.months.map(r => `<div class="bar" title="${r.m}: ${iqd(+r.total)} · ${r.n} visits · ${r.review} reviews"><div style="height:${Math.round((+r.total || 0) / mx * 100)}%"></div><span>${r.m.slice(5)}/${r.m.slice(2, 4)}</span></div>`).join('')}</div>
      <table class="t" style="margin-top:22px"><thead><tr><th>Month</th><th>Visits</th><th>Reviews</th><th style="text-align:right">Income</th></tr></thead><tbody>${d.months.slice().reverse().map(r => `<tr><td>${r.m.slice(5)}/${r.m.slice(0, 4)}</td><td>${r.n}</td><td>${r.review}</td><td style="text-align:right">${iqd(+r.total)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="small muted" style="margin-top:6px">Prices are typed in thousands in each visit. Set a visit to Paid / Review / Free in the visit header; automatic “review” pricing is in Settings → Clinic.</div></div>`;
  const go = (a, b) => location.hash = `#/money?from=${a}&to=${b}`;
  $('#mf').onchange = () => go($('#mf').value, $('#mt').value); $('#mt').onchange = () => go($('#mf').value, $('#mt').value);
  $$('[data-r]', v).forEach(b => b.onclick = () => go(...b.dataset.r.split('|')));
  $('#mCsv').onclick = () => {
    const rows = [['Date', 'Visits', 'Paid', 'Review', 'Free', 'Income (IQD)']].concat(d.days.map(r => [r.date, r.n, r.paid, r.review, r.free, Math.round(+r.total * 1000)]));
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.map(r => r.join(',')).join('\r\n')], { type: 'text/csv' })); a.download = `accounts_${from}_${to}.csv`; a.click();
  };
}
const DAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ============================================================ day bar: move between days (appointments + visits log) */
function dayBar(date) {
  const days = []; for (let i = -3; i <= 3; i++) days.push(addDays(date, i));
  const t = todayISO();
  return `<div class="daybar" data-date="${date}">
    <button class="db-n" data-dd="-7" title="Previous week">«</button><button class="db-n" data-dd="-1" title="Previous day">◀</button>
    <div class="db-days">${days.map(d => { const x = new Date(d + 'T12:00:00');
      return `<button class="dchip${d === date ? ' on' : ''}${d === t ? ' today' : ''}${x.getDay() === 5 ? ' fri' : ''}" data-day="${d}" title="${dmy(d)}"><small>${DAY_EN[x.getDay()]}</small><b>${d.slice(8)}</b><small>${d.slice(5, 7)}/${d.slice(2, 4)}</small><i data-cnt="${d}"></i></button>`; }).join('')}</div>
    <button class="db-n" data-dd="1" title="Next day">▶</button><button class="db-n" data-dd="7" title="Next week">»</button>
    <button class="db-t" data-today${date === t ? ' disabled' : ''}>Today</button><input type="date" class="db-pick" value="${date}" title="Go to a date"></div>`;
}
function bindDayBar(root, date, go, kind) {
  const bar = $('.daybar', root); if (!bar) return;
  bar.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.dd) return go(addDays(date, +b.dataset.dd));
    if (b.dataset.day) return go(b.dataset.day);
    if (b.hasAttribute('data-today')) return go(todayISO());
  };
  $('.db-pick', bar).addEventListener('change', e => { if (e.target.value) go(e.target.value); });
  const keys = e => {   // Alt + ← / → moves one day
    if (!e.altKey || !$('.daybar') || /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) return;
    const rtl = document.documentElement.dir === 'rtl';
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(addDays(date, rtl ? 1 : -1)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); go(addDays(date, rtl ? -1 : 1)); }
  };
  document.removeEventListener('keydown', window.__dbKeys || (() => { })); window.__dbKeys = keys; document.addEventListener('keydown', keys);
  // the counts are kept between refreshes, so the numbers do not blink when the page is redrawn
  const cache = (window.__dayCnt = window.__dayCnt || {})[kind] || (window.__dayCnt[kind] = {});
  const paint = () => $$('[data-cnt]', bar).forEach(i => {
    const d = i.dataset.cnt; if (!(d in cache)) return;
    const n = cache[d], txt = n ? String(n) : '';
    if (i.textContent !== txt) i.textContent = txt;
    i.classList.toggle('z', !n);
  });
  paint();
  api('GET', `/api/daycounts?kind=${kind}&from=${addDays(date, -3)}&to=${addDays(date, 3)}`).then(c => {
    for (let k = -3; k <= 3; k++) { const d = addDays(date, k); cache[d] = c[d] || 0; }
    paint();
  }).catch(() => { });
}

/* ============================================================ AI suggestions for today's visit (doctor presses the button) */
async function aiPlan() {
  if (needKey()) return;
  await saveVisitNow();
  const root = $('#vedit'), box = $('#aiPlanBox'); if (!root || !box) return;
  const f = k => { const el = $(`[data-k=${k}]`, root); return el ? el.value : ''; };
  const body = { patient_id: P.patient.id, visit_id: VIS.id, meds: currentMeds() };
  ['complaint', 'exam', 'diagnosis', 'plan', 'imaging', 'bp_sys', 'bp_dia', 'hr', 'temp', 'spo2', 'rbs', 'weight', 'waist'].forEach(k => body[k] = f(k));
  box.innerHTML = `<div class="aip card"><h3>${ic('spark')} AI suggestions for today</h3><div class="muted">Reading the file and today's entries… (10–30 seconds)</div></div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  let r; try { r = await api('POST', '/api/ai_plan', body); } catch (e) { box.innerHTML = `<div class="aip card" style="color:var(--warn)">${esc(e.message)}</div>`; return; }
  AIP = r;
  const add = (kind, i, label = '+') => `<button class="small aiadd" data-ak="${kind}" data-ai="${i}" title="Add to the visit">${label}</button>`;
  const sec = (title, icon, items) => items ? `<div class="aisec"><div class="aist">${ic(icon)} ${title}</div>${items}</div>` : '';
  const li = (kind, arr, fmt) => arr.length ? arr.map((x, i) => `<div class="aili">${add(kind, i)}<div>${fmt(x)}</div></div>`).join('') : '';
  const MA = { start: 'Start', continue: 'Continue', adjust: 'Adjust', stop: 'Stop' };
  box.innerHTML = `<div class="aip card"><h3>${ic('spark')} AI suggestions for today<span class="sp"></span><button class="small" id="aipRe" style="text-transform:none">↻ Again</button><button class="small" id="aipX" title="Close">✕</button></h3>
    ${r.focus ? `<div class="aifocus">${esc(r.focus)}</div>` : ''}
    ${r.red_flags.length ? `<div class="aired">${ic('alert')} ${r.red_flags.map(esc).join('<br>')}</div>` : ''}
    <div class="aigrid">
      ${sec('Questions to ask', 'info', li('q', r.questions, esc))}
      ${sec('Examination', 'body', li('e', r.exam, esc))}
      ${sec('Differential diagnosis', 'labs', li('d', r.ddx, x => `<b>${esc(x.dx)}</b>${x.for ? `<small>for: ${esc(x.for)}</small>` : ''}${x.against ? `<small>against / check: ${esc(x.against)}</small>` : ''}`))}
      ${sec('Investigations', 'labreq', li('t', r.tests, x => `<b>${esc(x.test)}</b>${x.why ? `<small>${esc(x.why)}</small>` : ''}`) + (r.tests.length ? `<div class="aiact"><button class="small" id="aipLab">Lab request with these…</button></div>` : ''))}
      ${sec('Medicines', 'drugs', li('m', r.meds, x => `<span class="aitag a-${esc(x.action || 'start')}">${MA[x.action] || esc(x.action || '')}</span> <b dir="auto">${esc(x.line)}</b>${x.why ? `<small>${esc(x.why)}</small>` : ''}`))}
      ${sec('Plan / advice', 'check', li('p', r.plan, esc) + (r.follow_up_days ? `<div class="aiact"><button class="small" id="aipFu">Follow-up after ${+r.follow_up_days} days</button></div>` : ''))}
    </div>
    <div class="muted small" style="margin-top:6px">+ adds the item to the visit (questions → S, examination → O, diagnosis → A, investigations / advice → P, medicines → prescription; “Stop” removes the matching medicine). Suggestions only — check every item.</div></div>`;
  $('#aipX').onclick = () => box.innerHTML = '';
  $('#aipRe').onclick = aiPlan;
  const lab = $('#aipLab'); if (lab) lab.onclick = () => labRequestDialog(r.tests.map(x => x.test));
  const fu = $('#aipFu'); if (fu) fu.onclick = () => { const el = $('[data-k=follow_up]', root); const x = curVisit(); el.value = addDays((x && x.date) || todayISO(), +r.follow_up_days); visitChanged('follow_up', el.value); fu.disabled = true; toast('Follow-up set — the automatic appointment is made'); };
  box.onclick = e => {
    const b = e.target.closest('[data-ak]'); if (!b) return;
    const it = { q: r.questions, e: r.exam, d: r.ddx, t: r.tests, m: r.meds, p: r.plan }[b.dataset.ak][+b.dataset.ai];
    const append = (k, line) => { const el = $(`[data-k=${k}]`, root); if (!el) return; if (typeof stPrev === 'function') setTimeout(stPrev); if (el.value.includes(line)) return; el.value = (el.value.trim() ? el.value.trim() + '\n' : '') + line; visitChanged(k, el.value); el.dispatchEvent(new Event('input', { bubbles: true })); };
    switch (b.dataset.ak) {
      case 'q': append('complaint', it + ' — '); break;
      case 'e': append('exam', it + ': '); break;
      case 'd': append('diagnosis', it.dx); break;
      case 't': append('plan', 'Investigations: ' + it.test); break;
      case 'p': append('plan', it); break;
      case 'm': {
        const cur = currentMeds();
        if (it.action === 'stop') {
          const w = (it.line.match(/[A-Za-z][A-Za-z-]{2,}/) || [''])[0].toLowerCase();
          const keep = cur.filter(l => !w || !l.toLowerCase().includes(w));
          if (keep.length !== cur.length) { renderMeds(keep); saveMeds(); } else append('plan', 'Stop ' + it.line);
        } else {
          const w = (it.line.match(/[A-Za-z][A-Za-z-]{2,}/) || [''])[0].toLowerCase();
          const i = it.action === 'adjust' && w ? cur.findIndex(l => l.toLowerCase().includes(w)) : -1;
          if (i >= 0) cur[i] = it.line; else if (!cur.includes(it.line)) cur.push(it.line);
          renderMeds(cur); saveMeds();
        }
        if (typeof stPrev === 'function') stPrev();
        break;
      }
    }
    b.textContent = '✓'; b.disabled = true; b.closest('.aili').classList.add('done');
  };
}
let AIP = null;


/* ============================================================ several clinic PCs (handoff.py): status bar + Close button */
async function pcCheck() {
  let h; try { h = await api('GET', '/api/pc'); } catch (e) { return; }
  const en = ME && ME.role === 'doctor', local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  let msg = '', cls = 'bad';
  if (h.closing) return;                        // the Close button is uploading the last data: its own message is shown
  if (h.readonly) msg = en ? `The program moved to PC “${h.other || '?'}” — this PC is read-only. Restart the program here to take it back.`
    : `البرنامج انتقل إلى الحاسبة «${h.other || '?'}» — هذه الحاسبة للقراءة فقط. أعد تشغيل البرنامج هنا لاستلامه.`;
  else if (h.conflict) msg = en ? `The other PC (${h.other || '?'}) saved newer data while this PC was offline. Do not enter data here — call support.`
    : `الحاسبة الأخرى (${h.other || '?'}) حفظت بيانات أحدث بينما كانت هذه الحاسبة بلا إنترنت. لا تُدخل بيانات هنا وتواصل مع الدعم.`;
  else if (h.enabled && h.offline) { cls = 'warn'; msg = en ? 'No internet — data is saved on this PC only; it will be uploaded when the connection returns. Do not use the other PC meanwhile.'
    : 'لا يوجد إنترنت — البيانات تُحفظ في هذه الحاسبة فقط وستُرفع عند عودة الاتصال. لا تستخدموا الحاسبة الأخرى الآن.'; }
  let bar = $('#pcBar');
  if (!msg) { if (bar) bar.remove(); }
  else {
    if (!bar) { bar = document.createElement('div'); bar.id = 'pcBar'; document.body.prepend(bar); }
    bar.className = 'pcbar ' + cls; bar.textContent = msg; bar.dir = en ? 'ltr' : 'rtl';
  }
  if (local && h.enabled && !$('#pcOff')) {
    const b = document.createElement('button'); b.id = 'pcOff'; b.className = 'who';
    b.textContent = en ? 'Close ⏼' : 'إغلاق البرنامج ⏼';
    b.title = en ? 'Upload the last data to Google Drive and close the program (do this before switching PCs)' : 'رفع آخر البيانات إلى Google Drive ثم إغلاق البرنامج (افعلها قبل الانتقال لحاسبة أخرى)';
    b.onclick = async () => {
      if (!confirm(en ? 'Upload the last data and close the program on this PC?' : 'رفع آخر البيانات وإغلاق البرنامج على هذه الحاسبة؟')) return;
      await flushed();
      const dir = en ? 'ltr' : 'rtl';
      const screen = html => { document.body.innerHTML = `<div class="card" style="max-width:560px;margin:15vh auto;text-align:center;font-size:18px;line-height:1.7" dir="${dir}">${html}</div>`; };
      const go = async force => {
        screen(en ? '☁️ Uploading the last data to Google Drive…<br><small>Do not switch the PC off.</small>' : '☁️ جارٍ رفع آخر البيانات إلى Google Drive…<br><small>لا تُطفئ الحاسبة.</small>');
        let r; try { r = await api('POST', '/api/shutdown', force ? { force: true } : {}); } catch (e) { r = { ok: false, error: e.message }; }
        if (r.ok) return screen(r.uploaded === false
          ? (en ? '⚠️ Closed <b>without</b> uploading. The data is on this PC only — start the program on this PC again when the internet is back.' : '⚠️ أُغلق البرنامج <b>دون</b> رفع البيانات. البيانات في هذه الحاسبة فقط — شغّل البرنامج عليها مرة أخرى عند عودة الإنترنت.')
          : (en ? '✅ All data is on Google Drive.<br><b>The program closes by itself in a few seconds — then you can switch the PC off.</b>' : '✅ كل البيانات في Google Drive.<br><b>يُغلق البرنامج نفسه خلال ثوانٍ، ثم يمكنك إطفاء الحاسبة.</b>'));
        screen((en ? '⚠️ The last data could <b>not</b> be uploaded' : '⚠️ <b>لم</b> يُرفع آخر البيانات') + `<br><small dir="ltr">${esc(r.error || '')}</small><br><br>
          <button class="primary" id="shRetry">${en ? '🔁 Try again' : '🔁 حاول مرة أخرى'}</button>
          <button id="shBack">${en ? '↩️ Keep working' : '↩️ متابعة العمل'}</button>
          <button class="danger" id="shForce">${en ? 'Close anyway' : 'أغلق على مسؤوليتي'}</button>
          <div class="small" style="margin-top:12px;color:#b45309;font-weight:600">${en ? 'Closing anyway: the patients entered since the last time there was internet stay on this PC only. If another PC or the phone is used before this PC is started again with internet, those data are lost.' : 'الإغلاق على مسؤوليتك: بيانات المرضى المدخلة منذ آخر مرة كان فيها إنترنت تبقى في هذه الحاسبة فقط. إذا استُخدمت حاسبة أخرى أو الهاتف قبل أن تُشغَّل هذه الحاسبة مع الإنترنت، تضيع تلك البيانات.'}</div>`);
        $('#shRetry').onclick = () => go(false);
        $('#shBack').onclick = () => location.reload();
        $('#shForce').onclick = () => { if (confirm(en ? 'Close without uploading? The unsent patient data may be lost.' : 'إغلاق دون رفع البيانات؟ قد تضيع بيانات المرضى غير المرفوعة.')) go(true); };
      };
      go(false);
    };
    $('#who').before(b);
  }
  if (h.readonly && $('#pcOff')) $('#pcOff').remove();
  let up = $('#upState');
  if (!h.enabled || h.readonly) { if (up) up.remove(); return; }
  if (!up) { up = document.createElement('div'); up.id = 'upState'; up.className = 'net'; $('#net').before(up); }
  const pend = h.unsent || h.offline;
  up.className = 'net ' + (pend ? (h.offline ? 'bad' : 'busy') : 'ok');
  up.textContent = pend ? (en ? '☁️⚠️ Not uploaded yet' : '☁️⚠️ لم تُرفع بعد') : (en ? '☁️✅ Uploaded' : '☁️✅ مرفوعة');
  up.title = pend ? (en ? 'Some changes are on this PC only' + (h.offline ? ' — no internet' : ' — the upload is late') : 'بعض التعديلات في هذه الحاسبة فقط' + (h.offline ? ' — لا يوجد إنترنت' : ' — تأخر الرفع')) + (h.error ? ' (' + h.error + ')' : '')
    : (en ? 'All data is on Google Drive' + (h.last_push ? ' (last upload ' + h.last_push + ')' : '') : 'كل البيانات في Google Drive' + (h.last_push ? ' (آخر رفع ' + h.last_push + ')' : ''));
}
