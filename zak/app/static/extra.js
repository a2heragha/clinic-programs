/* Clinic add-ons: icons, colour themes, prescribing safety, care gaps, registries, statistics,
   WhatsApp reminders, backup monitor, AI helpers (lab-sheet reading, visit summary). Loaded after app.js. */

/* ============================================================ icons (24×24 line icons) */
const ICONS = {
  today: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M8 2v4M16 2v4M3 10h18M8 14h3M8 18h6"/>',
  new: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6.5 7-6.5s7 2.5 7 6.5M19 8v6M16 11h6"/>',
  log: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  calc: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h.01M16 19h.01"/>',
  reg: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/><path d="M3.5 12h4l2-3 3 6 2-3h5.5"/>',
  stats: '<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17v-9"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  clinic: '<path d="M3 21h18M5 21V8l7-5 7 5v13M10 21v-5h4v5M12 8v4M10 10h4"/>',
  look: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.3"/><circle cx="12" cy="7.5" r="1.3"/><circle cx="16" cy="10" r="1.3"/><path d="M12 21a2.5 2.5 0 0 1 0-5h2a3 3 0 0 0 3-3"/>',
  print: '<path d="M6 9V2h12v7"/><rect x="2" y="9" width="20" height="8" rx="2"/><path d="M6 14h12v8H6z"/>',
  hours: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  users: '<circle cx="9" cy="7" r="4"/><path d="M2 21v-1a7 7 0 0 1 14 0v1M16 3.2a4 4 0 0 1 0 7.6M22 21v-1a6 6 0 0 0-4-5.6"/>',
  tpl: '<path d="M6 3h6a4 4 0 0 1 0 8H6zM6 11v10M11 11l7 10M18 13l-6 8"/>',
  spark: '<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  labs: '<path d="M9 3h6M10 3v6L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 9V3M7 15h10"/>',
  labreq: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h6"/>',
  drugs: '<path d="M10.5 20.5l-7-7a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7zM8.5 8.5l7 7"/>',
  dx: '<path d="M6 3v6a5 5 0 0 0 10 0V3M11 14v3a4 4 0 0 0 8 0v-2"/><circle cx="19" cy="13" r="2"/>',
  areas: '<path d="M12 22s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  occ: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  dups: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a2 2 0 0 1 2-2h11"/>',
  online: '<path d="M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 9.5a4.5 4.5 0 0 1-.5 8.5z"/>',
  data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>',
  wa: '<path d="M20.5 12a8.5 8.5 0 0 1-12.6 7.4L3.5 20.5l1.2-4.2A8.5 8.5 0 1 1 20.5 12z"/><path d="M9 8.5c0 3.5 2.8 6.5 6.5 6.5l.9-1.6-2-1-1 .9a5 5 0 0 1-2.7-2.7l.9-1-1-2z"/>',
  alert: '<path d="M12 3 2 21h20zM12 10v5M12 18h.01"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
  kidney: '<path d="M9 3C5 3 3 7 3 11s2 9 6 9c2.5 0 3-2 3-4 0-1.5-1.5-2.5-1.5-4S12 9.5 12 8c0-2.5-1-5-3-5zM15 3c4 0 6 4 6 8s-2 9-6 9"/>',
  body: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7M7 9.5h10M9 22l3-8 3 8"/>',
  lung: '<path d="M12 3v8M12 11c-1 1-3 1.5-4 1M12 11c1 1 3 1.5 4 1M8 6C5 7 3 12 3 16c0 3 2 4 4 4s3-1 3-3V9M16 6c3 1 5 6 5 10 0 3-2 4-4 4s-3-1-3-3V9"/>',
  drop: '<path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>',
  logout: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
};
function ic(n, cls = '') { return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ICONS.dot}</svg>`; }
const TAB_ICON = { clinic: 'clinic', look: 'look', print: 'print', hours: 'hours', users: 'users', tpl: 'tpl', ai: 'spark', labs: 'labs', labreq: 'labreq',
  drugs: 'drugs', dx: 'dx', areas: 'areas', occ: 'occ', dups: 'dups', online: 'online', data: 'data' };
const NAV_ICON = { '#/today': 'today', '#/new': 'new', '#/log': 'log', '#/calc': 'calc', '#/reg': 'reg', '#/stats': 'stats', '#/settings': 'settings' };
function decorateNav() {
  $$('#nav [data-go]').forEach(b => { if (!b.querySelector('svg')) { b.title = b.textContent.trim(); b.innerHTML = ic(NAV_ICON[b.dataset.go] || 'dot') + '<span>' + b.textContent.trim() + '</span>'; } });
}
const CALC_ICON = { bmi: 'body', egfr: 'kidney', crcl: 'kidney', ldl: 'drop', homa: 'drop', ca: 'labs', ag: 'labs', qtc: 'heart', fib4: 'labs', meld: 'labs', child: 'labs',
  cha: 'heart', hasbled: 'drop', curb: 'lung', wpe: 'lung', wdvt: 'body', ascvd: 'heart' };

/* ============================================================ colour themes */
const THEMES = { blue: '#1d4f8a', navy: '#1b2f5e', teal: '#0f6b6b', green: '#2f6b3a', purple: '#5b3a8c', maroon: '#8a1d3b', brown: '#7a4a1e', graphite: '#3b4652' };
function themeCfg() { try { return Object.assign({ accent: THEMES.blue, mode: 'light', size: 14, density: 'normal' }, JSON.parse(L.meta.theme || '{}')); } catch (e) { return { accent: THEMES.blue, mode: 'light', size: 14 }; } }
function mix(hex, other, t) {   // blend two #rrggbb colours
  const a = hex.match(/\w\w/g).map(x => parseInt(x, 16)), b = other.match(/\w\w/g).map(x => parseInt(x, 16));
  return '#' + a.map((x, i) => Math.round(x + (b[i] - x) * t).toString(16).padStart(2, '0')).join('');
}
function applyTheme(cfg) {
  cfg = cfg || themeCfg();
  const r = document.documentElement.style, dark = cfg.mode === 'dark', acc = /^#[0-9a-f]{6}$/i.test(cfg.accent) ? cfg.accent : THEMES.blue;
  document.documentElement.classList.toggle('dark', dark);
  const set = (k, v) => r.setProperty(k, v);
  set('--accent', dark ? mix(acc, '#ffffff', .25) : acc);
  set('--accent-ink', dark ? mix(acc, '#000000', .35) : acc);
  if (dark) {
    set('--bg', '#10151c'); set('--card', '#18202a'); set('--card-2', '#1f2834'); set('--ink', '#e4e9ef'); set('--muted', '#97a4b3'); set('--line', '#2c3744');
    set('--accent-2', mix(acc, '#18202a', .72)); set('--warn', '#ff7b8f'); set('--warn-bg', '#3a1d25'); set('--amber', '#f0b44c'); set('--amber-bg', '#3a2e17');
    set('--ok', '#6fd18a'); set('--ok-bg', '#173322'); set('--focus', '#c9a100');
  } else {
    set('--bg', '#f3f5f8'); set('--card', '#ffffff'); set('--card-2', '#fbfcfe'); set('--ink', '#1c2633'); set('--muted', '#687586'); set('--line', '#dbe1e8');
    set('--accent-2', mix(acc, '#ffffff', .9)); set('--warn', '#b4233c'); set('--warn-bg', '#fdecef'); set('--amber', '#8a5a00'); set('--amber-bg', '#fff4dc');
    set('--ok', '#2c7a3f'); set('--ok-bg', '#e8f6ec'); set('--focus', '#ffd75e');
  }
  set('--fs', (+cfg.size || 14) + 'px');
}

/* ============================================================ patient conditions (chronic list + all diagnoses) */
const CONDS = {
  dm: /diabet|\bt[12]?dm\b|\bdm\b|\bniddm\b|\biddm\b/i, htn: /hypertens|\bhtn\b|\bht\b/i,
  ckd: /\bckd\b|chronic kidney|renal impairment|renal failure|nephropathy|\besrd\b|\beskd\b|dialysis/i,
  lipid: /lipid|cholesterol|hypertriglycerid/i, ihd: /\bihd\b|ischa?emic heart|angina|\bcad\b|\bmi\b|myocardial infarction|\bpci\b|cabg|\bacs\b|stent/i,
  hf: /heart failure|\bhf\b|hfref|hfpef|cardiomyopathy/i, af: /atrial fibrillation|\baf\b/i, thyroid: /hypothyroid|hashimoto|thyroidectomy/i,
  asthma: /asthma|\bcopd\b/i, pud: /peptic ulcer|\bpud\b|gi bleed|upper gi bleeding|melaena|duodenal ulcer|gastric ulcer/i, gout: /\bgout\b/i,
  stroke: /stroke|\bcva\b|\btia\b/i, preg: /pregnan|gestation/i,
};
function patientText() { return [P.patient.chronic || '', P.patient.past_history || ''].concat(P.visits.map(v => v.diagnosis || '')).join('\n'); }
const NOT_DM = /gestational|\bgdm\b|pre-?diabet|insulin resistance|impaired (fasting|glucose)/i;
function hasCond(k, txt) { const t = txt != null ? txt : patientText(); return k === 'dm' ? t.split('\n').some(l => CONDS.dm.test(l) && !NOT_DM.test(l)) : CONDS[k].test(t); }
function daysAgo(iso, ref) { return Math.round((new Date((ref || todayISO()) + 'T12:00:00') - new Date(iso + 'T12:00:00')) / 864e5); }
function curEgfr(refDate) {
  const cr = latestLab('CREAT', refDate); if (!cr) return null;
  const e = C.egfr(cr.value, ageAt(P.patient, cr.date), P.patient.gender);
  return e ? { egfr: Math.round(e), cr: cr.value, date: cr.date } : null;
}
function curWeight() { const v = P.visits.find(y => y.weight); return v ? v.weight : null; }

/* ============================================================ care gaps before the visit */
function renderDue(vid) {
  const box = $('#dueCard'); if (!box) return;
  const cur = P.visits.find(y => y.id === vid), ref = cur ? cur.date : todayISO(), txt = patientText();
  const items = [];   // [level, text]
  const lab = c => latestLab(c, ref);
  const due = (code, days, label) => { const l = lab(code); if (!l) items.push(['mid', `${label} — never recorded`]); else { const d = daysAgo(l.date, ref); if (d > days) items.push(['mid', `${label} due — last ${dmy(l.date)} (${Math.round(d / 30)} mo)`]); } };
  const dm = hasCond('dm', txt), htn = hasCond('htn', txt), ckd = hasCond('ckd', txt), ihd = hasCond('ihd', txt) || hasCond('stroke', txt);
  const statin = /statin|crestor|lipitor|avas\b|atorva|rosuva|simva/i.test((P.patient.long_meds || '') + (P.visits.slice(0, 3).map(v => (v.meds || []).join(' ')).join(' ')));
  if (dm) { due('HBA1C', 100, 'HbA1c'); due('UACR', 400, 'Urine ACR'); due('CREAT', 400, 'Creatinine'); }
  if (dm || hasCond('lipid', txt) || ihd || statin) due('LDL', 400, 'Lipid profile');
  if (htn && !dm) { due('CREAT', 400, 'Creatinine'); due('K', 400, 'Potassium'); }
  if (ckd) { due('CREAT', 190, 'Creatinine'); due('HB', 400, 'Hb'); if (!dm) due('UACR', 400, 'Urine ACR'); }
  if (hasCond('thyroid', txt) || /thyrox|euthyrox|levothyrox/i.test(P.patient.long_meds || '')) due('TSH', 400, 'TSH');
  // targets
  const a1c = lab('HBA1C'); if (dm && a1c && a1c.value > 7) items.push([a1c.value >= 9 ? 'abn' : 'mid', `HbA1c ${fnum(a1c.value, 1)}% above target 7 (${dmy(a1c.date)})`]);
  const ldl = lab('LDL'), tgt = ihd || dm ? (ihd ? 55 : 70) : 100;
  if (ldl && (dm || ihd || statin || hasCond('lipid', txt)) && ldl.value > tgt) items.push(['mid', `LDL ${Math.round(ldl.value)} above target ${tgt} (${dmy(ldl.date)})`]);
  const lastBP = P.visits.find(y => y.id !== vid && y.bp_sys && y.date <= ref);
  if (lastBP && (lastBP.bp_sys >= 140 || (lastBP.bp_dia || 0) >= 90)) items.push(['mid', `Last BP ${lastBP.bp_sys}/${lastBP.bp_dia || '?'} (${dmy(lastBP.date)}) above 140/90`]);
  const e = curEgfr(ref);
  if (e && e.egfr < 60) items.push([e.egfr < 30 ? 'abn' : 'mid', `eGFR ${e.egfr} (${C.ckd(e.egfr)}) — check renal dosing (Cr ${e.cr}, ${dmy(e.date)})`]);
  const k = lab('K'); if (k && (k.value > 5.5 || k.value < 3.5) && daysAgo(k.date, ref) < 180) items.push(['abn', `Potassium ${k.value} (${dmy(k.date)})`]);
  // abnormal results of the last 6 months not covered above
  const tests = Object.fromEntries((L.lab_tests || []).map(t => [t.code, t]));
  const shown = new Set(['HBA1C', 'LDL', 'K', 'CREAT', 'EGFR']);
  const abn = (L.lab_tests || []).filter(t => !shown.has(t.code)).map(t => [t, lab(t.code)]).filter(([t, l]) => l && daysAgo(l.date, ref) <= 183 && labCls(t, l.value));
  abn.forEach(([t, l]) => items.push(['info', `${t.name} ${fnum(l.value, 2)} ${labCls(t, l.value) === 'lab-hi' ? '↑' : '↓'} (${dmy(l.date)})`]));
  // follow-up
  const prev = P.visits.find(y => y.id !== vid && y.date < ref);
  if (prev && prev.follow_up && prev.follow_up < ref) { const late = daysAgo(prev.follow_up, ref); if (late > 14) items.push(['info', `Follow-up was due ${dmy(prev.follow_up)} — came ${late} days late`]); }
  if (prev && prev.plan && /(ogd|endoscop|colonoscop|echo|ct\b|mri|biopsy|refer|ultrasound|\bus\b|doppler|holter|spirometr)/i.test(prev.plan)) items.push(['info', `Planned last time: ${prev.plan.split('\n')[0].slice(0, 120)}`]);
  const cls = { abn: 'd-abn', mid: 'd-mid', info: 'd-info' }, icn = { abn: 'alert', mid: 'alert', info: 'info' };
  box.innerHTML = `<h3>${ic('check')} Care gaps &amp; alerts</h3>${items.length ? `<ul class="duel">${items.map(([lv, t]) => `<li class="${cls[lv]}">${ic(icn[lv])}<span>${esc(t)}</span></li>`).join('')}</ul>` : '<div class="muted small">Nothing overdue for this patient ✓</div>'}`;
}

/* ============================================================ prescribing safety */
const DRUG = {   // class → name patterns (generic + common brands in Iraq)
  nsaid: /diclofen|voltaren|ibupro|brufen|naproxen|meloxic|mobic|celecox|celebrex|etoric|arcoxia|ketorol|piroxic|indometh|mefenamic|ponstan|lornoxicam|xefo|aceclofenac|nimesulide|myogesic/i,
  aspirin: /aspirin|aspocid|\basa\b|cardio-?aspirin|jusprin/i,
  anticoag: /warfarin|rivaroxaban|xarelto|apixaban|eliquis|dabigatran|pradaxa|edoxaban|enoxaparin|clexane|heparin|fondaparinux/i,
  clopid: /clopidogrel|plavix|ticagrelor|brilinta|prasugrel/i,
  warfarin: /warfarin/i, rivaroxaban: /rivaroxaban|xarelto/i, apixaban: /apixaban|eliquis/i, dabigatran: /dabigatran|pradaxa/i, enox: /enoxaparin|clexane/i,
  acei: /\w+pril\b|triplixam|coversyl|tritace|zestril/i,
  arb: /\w+sartan|diovan|co-?diovan|exforge|angizar|newstar|diostar|cotareg|olmetec|atacand|micardis|aprovel|cozaar|hyzaar|entresto|savesto|lotid|angiosar|cotabuvan/i,
  aldo: /spironolact|aldactone|eplerenone|inspra|finerenone/i,
  kspar: /amiloride|triamterene/i,
  ksupp: /potassium chloride|slow-?k|\bkcl\b|kalinor/i,
  thiazide: /hydrochlorothiazide|\bhct\b|\bhctz\b|indapamide|natrilix|chlorthalidone|hygroton|hygriton|\/12\.5|\/25\b|plus\b/i,
  loop: /furosemide|lasix|torsemide|bumetanide/i,
  metformin: /metformin|glucophage|piophage|janumet|eucreas|galvus ?met|vildapride|xigduo|synjardy|empamet|dapamet|dapzin ?m|sitaglemet|glucovance|clovance|sitavia|\/(500|850|1000)\b/i,
  sglt2: /gliflozin|jardiance|forxiga|dapzin|empamet|dapamet|xigduo|synjardy/i,
  su: /glimepiride|amaryl|glemax|gliclazide|diamicron|glibenclamide|daonil|glipizide|clovance|glucovance/i,
  glib: /glibenclamide|daonil|glucovance|clovance/i,
  dpp4_s: /sitagliptin|januvia|janumet|sitavia|sitaglemet/i, dpp4_v: /vildagliptin|galvus|vildapride|eucreas/i,
  insulin: /insulin|lantus|novorapid|mixtard|humulin|tresiba|levemir|apidra|actrapid|toujeo|ryzodeg|humalog|lente/i,
  pioglit: /pioglitazone|actos/i,
  statin: /statin|crestor|lipitor|avas\b|atorva|rosuva|simva|zocor/i, simva: /simvastatin|zocor/i,
  fibrate: /fenofibrate|lipanthyl|gemfibrozil|lopid/i, gemfib: /gemfibrozil|lopid/i,
  macrolide: /clarithro|klacid|erythromycin/i, azithro: /azithro|zithromax/i,
  azole: /fluconazole|itraconazole|ketoconazole|voriconazole|posaconazole/i,
  quinolone: /floxacin|ciprobay|tavanic/i, cipro: /ciprofloxacin|ciprobay/i,
  metronid: /metronidazole|flagyl|tinidazole/i,
  cotrim: /trimethoprim|co-?trimox|septrin|bactrim/i,
  nitrofur: /nitrofurantoin|furadantin|macrobid/i,
  ssri: /sertraline|lustral|fluoxetine|prozac|paroxetine|seroxat|escitalopram|cipralex|citalopram|fluvoxamine|faverin|venlafaxine|efexor|duloxetine|cymbalta|deanxit/i,
  tca: /amitriptyline|tryptizol|imipramine|tofranil|clomipramine|nortriptyline|deanxit/i,
  tramadol: /tramadol|tramal|ultracet|co-?codamol|codeine/i, tramadolOnly: /tramadol|tramal|ultracet/i,
  triptan: /triptan|imigran|relpax|zomig/i,
  digoxin: /digoxin|lanoxin/i, amiodarone: /amiodarone|cordarone/i,
  ndhp: /verapamil|isoptin|diltiazem|altiazem|tildiem/i,
  bb: /\w+olol\b|concor|becore|carvedilol|dilatrend|bisoprolol|nebivolol|nebilet|inderal|tenormin/i, nsbb: /propranolol|inderal|carvedilol|dilatrend|nadolol|sotalol/i,
  nitrate: /nitrate|isosorbide|imdur|nitroglycerin|glyceryl trinitrate|\bgtn\b|nitro/i,
  pde5: /sildenafil|viagra|tadalafil|cialis|vardenafil|levitra/i,
  allopurinol: /allopurinol|zyloric|febuxostat/i, allop: /allopurinol|zyloric/i,
  aza: /azathioprine|imuran|mercaptopurine/i, mtx: /methotrexate/i,
  steroid: /prednisolone|prednisone|dexameth|decadron|hydrocortisone|methylpred|medrol|depo-?medrol|betamethasone|diprofos/i,
  lithium: /lithium|priadel/i, colchicine: /colchicine/i, theoph: /theophylline|aminophylline/i,
  thyrox: /thyroxine|levothyrox|euthyrox|eltroxin/i, cafe: /calcium|ferrous|iron|ferro|maltofer|caltrate|sucralfate|antacid/i,
  ppi: /\w+prazole|nexium|losec|controloc|pantoloc/i, omep: /omeprazole|esomeprazole|nexium|losec/i,
  gaba: /gabapentin|neurontin|pregabalin|lyrica|laryca/i,
  qt: /azithro|zithromax|clarithro|klacid|erythromycin|levofloxacin|tavanic|moxifloxacin|ciprofloxacin|ondansetron|zofran|domperidone|motilium|haloperidol|amiodarone|cordarone|citalopram|escitalopram|cipralex|hydroxychloroquine|plaquenil|sotalol|quetiapine|fluconazole/i,
  clozap: /clozapine/i,
};
const BETA2 = /salbutamol|ventolin|formoterol|salmeterol|seretide|symbicort|bufomix|airtide|budesonide\/formoterol/i;
// [classA, classB, level, message] — level: 3 contraindicated, 2 major, 1 moderate
const DDI = [
  ['anticoag', 'nsaid', 3, 'Anticoagulant + NSAID: high bleeding risk — avoid; use paracetamol'],
  ['anticoag', 'clopid', 2, 'Anticoagulant + P2Y12 inhibitor: bleeding risk — confirm indication and duration, add PPI'],
  ['anticoag', 'aspirin', 2, 'Anticoagulant + aspirin: bleeding risk — confirm the indication, add PPI'],
  ['clopid', 'nsaid', 2, 'Antiplatelet + NSAID: GI bleeding risk — avoid or add PPI'],
  ['aspirin', 'nsaid', 1, 'Aspirin + NSAID: GI bleeding, NSAID may block aspirin effect'],
  ['clopid', 'omep', 1, 'Clopidogrel + omeprazole/esomeprazole: reduced antiplatelet effect — prefer pantoprazole'],
  ['warfarin', 'macrolide', 2, 'Warfarin + macrolide: INR rises — check INR in 3–5 days'],
  ['warfarin', 'azole', 2, 'Warfarin + azole antifungal: INR rises markedly — check INR'],
  ['warfarin', 'quinolone', 2, 'Warfarin + quinolone: INR rises — check INR'],
  ['warfarin', 'metronid', 2, 'Warfarin + metronidazole: INR rises markedly — avoid or reduce dose'],
  ['warfarin', 'cotrim', 2, 'Warfarin + co-trimoxazole: INR rises — avoid or check INR'],
  ['warfarin', 'amiodarone', 2, 'Warfarin + amiodarone: reduce warfarin dose, check INR'],
  ['rivaroxaban', 'azole', 2, 'Rivaroxaban + azole antifungal: raised levels, bleeding risk'],
  ['rivaroxaban', 'macrolide', 1, 'Rivaroxaban + clarithromycin: raised levels'],
  ['acei', 'arb', 3, 'ACE inhibitor + ARB: dual RAAS blockade — hyperkalaemia and AKI; avoid'],
  ['acei', 'aldo', 1, 'ACE inhibitor + MRA: monitor potassium and creatinine'],
  ['arb', 'aldo', 1, 'ARB + MRA: monitor potassium and creatinine'],
  ['acei', 'ksupp', 2, 'ACE inhibitor + potassium supplement: hyperkalaemia'],
  ['arb', 'ksupp', 2, 'ARB + potassium supplement: hyperkalaemia'],
  ['aldo', 'ksupp', 3, 'MRA + potassium supplement: dangerous hyperkalaemia'],
  ['aldo', 'kspar', 3, 'MRA + potassium-sparing diuretic: dangerous hyperkalaemia'],
  ['acei', 'nsaid', 1, 'ACE inhibitor + NSAID: AKI and reduced BP control'],
  ['arb', 'nsaid', 1, 'ARB + NSAID: AKI and reduced BP control'],
  ['loop', 'nsaid', 1, 'Diuretic + NSAID: reduced diuretic effect, AKI'],
  ['statin', 'macrolide', 2, 'Statin + clarithromycin/erythromycin: myopathy — hold the statin during the course'],
  ['simva', 'azole', 3, 'Simvastatin + azole antifungal: rhabdomyolysis — contraindicated'],
  ['statin', 'gemfib', 2, 'Statin + gemfibrozil: myopathy — use fenofibrate instead'],
  ['simva', 'amiodarone', 1, 'Simvastatin + amiodarone: max simvastatin 20 mg'],
  ['simva', 'ndhp', 1, 'Simvastatin + verapamil/diltiazem: max simvastatin 10 mg'],
  ['ssri', 'tramadolOnly', 2, 'SSRI/SNRI + tramadol: serotonin syndrome and seizures'],
  ['ssri', 'triptan', 1, 'SSRI + triptan: serotonin syndrome (rare) — warn the patient'],
  ['ssri', 'nsaid', 1, 'SSRI + NSAID: GI bleeding — consider PPI'],
  ['ssri', 'anticoag', 1, 'SSRI + anticoagulant: bleeding risk'],
  ['bb', 'ndhp', 2, 'β-blocker + verapamil/diltiazem: bradycardia, heart block, hypotension'],
  ['digoxin', 'amiodarone', 2, 'Digoxin + amiodarone: halve the digoxin dose, check level'],
  ['digoxin', 'ndhp', 1, 'Digoxin + verapamil/diltiazem: raised digoxin, bradycardia'],
  ['digoxin', 'macrolide', 1, 'Digoxin + clarithromycin: raised digoxin level'],
  ['nitrate', 'pde5', 3, 'Nitrate + PDE-5 inhibitor: severe hypotension — contraindicated'],
  ['allop', 'aza', 3, 'Allopurinol + azathioprine: severe myelosuppression — avoid or cut azathioprine to 25%'],
  ['mtx', 'cotrim', 3, 'Methotrexate + trimethoprim: severe myelosuppression — avoid'],
  ['mtx', 'nsaid', 1, 'Methotrexate + NSAID: methotrexate toxicity — monitor'],
  ['colchicine', 'macrolide', 3, 'Colchicine + clarithromycin: fatal colchicine toxicity — avoid'],
  ['theoph', 'cipro', 2, 'Theophylline + ciprofloxacin: theophylline toxicity'],
  ['lithium', 'acei', 2, 'Lithium + ACE inhibitor: lithium toxicity'], ['lithium', 'arb', 2, 'Lithium + ARB: lithium toxicity'],
  ['lithium', 'nsaid', 2, 'Lithium + NSAID: lithium toxicity'], ['lithium', 'thiazide', 2, 'Lithium + thiazide: lithium toxicity'],
  ['thyrox', 'cafe', 1, 'Levothyroxine + calcium/iron/antacid: separate by 4 hours'],
  ['su', 'insulin', 1, 'Sulfonylurea + insulin: hypoglycaemia risk — review doses'],
  ['steroid', 'nsaid', 1, 'Steroid + NSAID: GI ulcer risk — add PPI'],
  ['tca', 'ssri', 1, 'TCA + SSRI: raised TCA level, serotonin effects'],
];
const DUP = { acei: 'ACE inhibitors', arb: 'ARBs', statin: 'statins', ppi: 'PPIs', nsaid: 'NSAIDs', su: 'sulfonylureas', bb: 'β-blockers', ssri: 'SSRIs/SNRIs', anticoag: 'anticoagulants', metformin: 'metformin products', sglt2: 'SGLT2 inhibitors' };
const ALLERGY_MAP = [
  [/penicil|amoxi|ampicil|augmentin/i, /amoxi|ampicil|penicil|augmentin|amoxiclav|clavulan|cloxa|flucloxa|piperacil|tazocin|megamox|curam|e-?moxclav|benzathine/i, 'penicillin'],
  [/cephalo|cef|ceph/i, /\bcef|ceph|ceftri|rocephin|cefix|suprax|cefur|zinnat|cefpo|cefaz|cefota|ceftaz|cefepime/i, 'cephalosporin'],
  [/penicil|amoxi/i, /\bcef|ceph|ceftri|cefix|cefur|zinnat|suprax/i, 'cephalosporin (cross-reactivity with penicillin allergy — low but real)', 1],
  [/sulf/i, /sulfa|co-?trimox|septrin|bactrim|sulfameth|sulfasalaz/i, 'sulfonamide'],
  [/nsaid|aspirin|diclofen|ibupro|voltaren/i, DRUG.nsaid, 'NSAID'],
  [/aspirin|nsaid/i, DRUG.aspirin, 'aspirin'],
  [/quinolon|floxacin|cipro/i, DRUG.quinolone, 'quinolone'],
  [/macrolid|azithro|clarithro|erythro/i, /azithro|clarithro|erythro|zithromax|klacid/i, 'macrolide'],
  [/metronid|flagyl/i, DRUG.metronid, 'metronidazole'],
  [/opioid|morphin|tramadol|codein/i, /morphin|tramadol|tramal|codein|pethidin|fentanyl|oxycod/i, 'opioid'],
  [/statin/i, DRUG.statin, 'statin'], [/ace inhib|pril\b/i, DRUG.acei, 'ACE inhibitor (angioedema risk)'],
  [/metformin/i, DRUG.metformin, 'metformin'], [/allopurin/i, DRUG.allop, 'allopurinol'], [/ceftriax/i, /ceftri|rocephin/i, 'ceftriaxone'],
  [/contrast|iodine/i, /iohexol|omnipaque|ultravist|contrast/i, 'iodinated contrast'],
];
function rxCheck() {
  const box = $('#rxAlerts'); if (!box || !P) return;
  const meds = currentMeds(), regular = (P.patient.long_meds || '').split('\n').map(s => s.trim()).filter(Boolean);
  const all = meds.map(m => ({ line: m, cur: true })).concat(regular.filter(r => !meds.some(m => m.toLowerCase().includes(r.toLowerCase().split(' ')[0]))).map(m => ({ line: m, cur: false })));
  const cls = k => all.filter(x => DRUG[k] && DRUG[k].test(x.line));
  const out = [];   // [level, text]
  const tag = xs => xs.map(x => x.cur ? x.line.split(/\s{2,}| \d/)[0] : x.line.split(/\s{2,}| \d/)[0] + ' (regular)').join(', ');
  // allergies
  const allergies = (P.patient.allergies || '').split('\n').map(s => s.trim()).filter(Boolean);
  allergies.forEach(a => {
    ALLERGY_MAP.forEach(([ra, rd, name, lvl]) => { if (ra.test(a)) meds.filter(m => rd.test(m)).forEach(m => out.push([lvl || 3, `ALLERGY "${a}": ${m} is a ${name}`])); });
    const w = a.toLowerCase().split(/[\s,(]/)[0]; if (w.length > 4) meds.filter(m => m.toLowerCase().includes(w)).forEach(m => { if (!out.some(o => o[1].includes(m))) out.push([3, `ALLERGY "${a}": ${m}`]); });
  });
  // interactions (at least one of the two is in today's prescription)
  DDI.forEach(([a, b, lvl, msg]) => { const A = cls(a), B = cls(b); if (A.length && B.length && (A.some(x => x.cur) || B.some(x => x.cur)) && !(A.length === 1 && B.length === 1 && A[0] === B[0])) out.push([lvl, msg + ' — ' + tag([...new Set(A.concat(B))])]); });
  Object.entries(DUP).forEach(([k, n]) => { const xs = cls(k).filter(x => x.cur); if (xs.length > 1) out.push([2, `Duplicate therapy — two ${n}: ${tag(xs)}`]); });
  const qt = cls('qt'); if (qt.length >= 2 && qt.some(x => x.cur)) out.push([2, 'Two QT-prolonging drugs — check QTc and potassium: ' + tag(qt)]);
  if (cls('acei').length + cls('arb').length && cls('loop').length + cls('thiazide').length && cls('nsaid').some(x => x.cur)) out.push([2, '"Triple whammy" (ACEi/ARB + diuretic + NSAID): high AKI risk']);
  // conditions
  const txt = patientText();
  if (hasCond('asthma', txt) && cls('nsbb').some(x => x.cur)) out.push([2, 'Asthma/COPD + non-selective β-blocker (propranolol/carvedilol): bronchospasm — use bisoprolol/nebivolol']);
  if (hasCond('hf', txt)) { if (cls('nsaid').some(x => x.cur)) out.push([2, 'Heart failure + NSAID: fluid retention, decompensation']); if (cls('pioglit').some(x => x.cur)) out.push([3, 'Heart failure + pioglitazone: contraindicated']); if (cls('ndhp').some(x => x.cur)) out.push([2, 'HFrEF + verapamil/diltiazem: avoid']); }
  if (hasCond('pud', txt) && cls('nsaid').some(x => x.cur) && !cls('ppi').length) out.push([2, 'History of peptic ulcer/GI bleed + NSAID without PPI']);
  if (hasCond('preg', P.visits.slice(0, 2).map(v => v.diagnosis || '').join('\n'))) {
    const tera = meds.filter(m => /pril\b|sartan|statin|warfarin|methotrexate|valpro|isotretinoin|tetracycl|doxycycl|misoprostol|carbimazole/i.test(m)); if (tera.length) out.push([3, 'Pregnancy (recent diagnosis): contraindicated in pregnancy — ' + tera.join(', ')]);
  }
  // kidney function
  const e = curEgfr(), age = ageAt(P.patient, todayISO()), wt = curWeight();
  const crcl = e && wt && age ? C.crcl(e.cr, age, wt, P.patient.gender) : null;
  if (e) {
    const g = e.egfr, has = k => cls(k).some(x => x.cur);
    const R = (cond, lvl, msg) => { if (cond) out.push([lvl, `eGFR ${g}: ${msg}`]); };
    R(has('metformin') && g < 30, 3, 'metformin contraindicated (eGFR < 30)');
    R(has('metformin') && g >= 30 && g < 45, 2, 'metformin max 1000 mg/day; do not start new');
    R(has('sglt2') && g < 20, 2, 'do not start SGLT2 inhibitor below eGFR 20; glucose-lowering effect is small below 45');
    R(has('glib') && g < 60, 2, 'glibenclamide — avoid in CKD (prolonged hypoglycaemia); prefer gliclazide');
    R(has('su') && !has('glib') && g < 30, 1, 'sulfonylurea — start low, hypoglycaemia risk');
    R(has('dpp4_s') && g < 45, 1, `sitagliptin ${g < 30 ? '25' : '50'} mg daily`);
    R(has('dpp4_v') && g < 50, 1, 'vildagliptin 50 mg once daily');
    R(has('nsaid') && g < 30, 3, 'NSAIDs — avoid');
    R(has('nsaid') && g >= 30 && g < 60, 2, 'NSAIDs — avoid or shortest course, monitor creatinine');
    R(has('aldo') && g < 30, 2, 'spironolactone — avoid below 30 (hyperkalaemia)');
    R(has('nitrofur') && g < 45, 2, 'nitrofurantoin — avoid (ineffective, toxic) below 45');
    R(has('gaba') && g < 60, 1, 'gabapentin/pregabalin — reduce the dose');
    R(has('allopurinol') && g < 60, 1, 'allopurinol — start ≤ 100 mg (50 mg if eGFR < 30) and titrate');
    R(has('colchicine') && g < 30, 2, 'colchicine — reduce dose / avoid repeated courses');
    R(has('quinolone') && g < 50, 1, 'quinolone — reduce dose');
    R(has('digoxin') && g < 60, 1, 'digoxin — reduce dose, check level');
    R(has('tramadolOnly') && g < 30, 1, 'tramadol — max 200 mg/day, longer interval');
    R(has('cotrim') && g < 30, 2, 'co-trimoxazole — halve dose or avoid');
    const cc = crcl ? Math.round(crcl) : null;
    if (has('rivaroxaban')) out.push([cc != null && cc < 15 ? 3 : 1, cc != null ? `CrCl ${cc}: rivaroxaban ${cc < 15 ? 'avoid' : cc <= 50 ? '15 mg daily for AF' : '20 mg daily for AF'}` : 'Rivaroxaban: add weight to calculate CrCl for the dose']);
    if (has('dabigatran') && cc != null && cc < 30) out.push([3, `CrCl ${cc}: dabigatran contraindicated`]);
    if (has('apixaban')) { const n = (age >= 80) + (wt && wt <= 60) + (e.cr >= 1.5); if (n >= 2) out.push([2, `Apixaban: ${n} of age ≥ 80 / weight ≤ 60 / Cr ≥ 1.5 → 2.5 mg twice daily`]); }
    if (has('enox') && cc != null && cc < 30) out.push([2, `CrCl ${cc}: enoxaparin 1 mg/kg once daily (not twice)`]);
  }
  const k = latestLab('K');
  if (k && k.value > 5.5 && (cls('acei').length || cls('arb').length || cls('aldo').length) && daysAgo(k.date) < 120) out.push([2, `Potassium ${k.value} (${dmy(k.date)}) on ACEi/ARB/MRA`]);
  out.sort((a, b) => b[0] - a[0]);
  const seen = new Set(), rows = out.filter(o => !seen.has(o[1]) && seen.add(o[1]));
  const lv = { 3: ['rx3', 'alert', 'Avoid'], 2: ['rx2', 'alert', 'Major'], 1: ['rx1', 'info', 'Check'] };
  box.innerHTML = rows.length ? `<div class="rxal">${rows.map(([l, t]) => `<div class="${lv[l][0]}">${ic(lv[l][1])}<b>${lv[l][2]}</b><span>${esc(t)}</span></div>`).join('')}</div>` : '';
}

/* ============================================================ WhatsApp reminders */
const WA_DEF = 'مرحباً {name}، نذكّركم بموعدكم في {clinic} يوم {day} {date}{time}. يرجى الاتصال بنا إذا تعذّر الحضور.';
function waNumber(ph) {
  let d = String(ph || '').replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0') && d.length === 11) d = '964' + d.slice(1);
  else if (d.length === 10 && d.startsWith('7')) d = '964' + d;
  return d.length >= 11 ? d : null;
}
function waText(name, date, time) {
  const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const t = time ? (() => { const [h, m] = time.split(':').map(Number); return ' الساعة ' + ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' صباحاً' : ' مساءً'); })() : '';
  return (L.meta.wa_template || WA_DEF).replace(/\{name\}/g, name || '').replace(/\{clinic\}/g, L.meta.clinic_name || 'العيادة')
    .replace(/\{day\}/g, days[new Date(date + 'T12:00:00').getDay()]).replace(/\{date\}/g, dmy(date)).replace(/\{time\}/g, t);
}
function waRemind(r, date) {
  const n = waNumber(r.pphone || r.phone);
  if (!n) return toast('The phone number is not a valid mobile number', true);
  window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(waText(r.pname || r.name, date, r.time)), '_blank');
}

/* ============================================================ backup monitor + restore */
async function healthCheck() {
  let h; try { h = await api('GET', '/api/health'); } catch (e) { return; }
  const old = s => !s || (Date.now() - new Date(s.replace(' ', 'T')).getTime()) > 26 * 3600e3;
  const probs = [];
  if (h.local_error) probs.push('Local backup error: ' + h.local_error);
  else if (old(h.local_last)) probs.push('No local backup in the last 24 hours');
  if (h.drive && (!h.drive_last_ms || Date.now() - h.drive_last_ms > 26 * 3600e3)) probs.push('No Google Drive backup in the last 24 hours' + (h.sync_error ? ' — ' + h.sync_error : ''));
  let el = $('#bkWarn');
  if (!probs.length) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('button'); el.id = 'bkWarn'; el.className = 'bkwarn'; $('#net').before(el); el.onclick = () => location.hash = '#/settings?tab=data'; }
  el.innerHTML = ic('alert') + '<span>Backup</span>'; el.title = probs.join('\n');
}
async function renderBackups(pane) {
  const list = await api('GET', '/api/backups');
  const box = document.createElement('div');
  box.className = 'card'; box.style.maxWidth = '820px';
  box.innerHTML = `<h3>${ic('restore')} Restore a backup</h3><div class="small muted" style="margin-bottom:6px">Replaces ALL current data with the chosen copy. A safety copy of the current data is made first. Other computers must refresh after restoring.</div>
    ${list.length ? `<table class="t"><thead><tr><th>Date</th><th>File</th><th>Size</th><th></th></tr></thead><tbody>${list.slice(0, 60).map(b => `<tr><td>${esc(b.time)}</td><td class="small muted">${esc(b.name)}</td><td class="small">${(b.size / 1048576).toFixed(1)} MB</td><td style="text-align:right"><button class="small danger" data-rs="${esc(b.name)}">Restore</button></td></tr>`).join('')}</tbody></table>` : '<div class="muted small">No backups found yet.</div>'}`;
  pane.appendChild(box);
  $$('[data-rs]', box).forEach(b => b.onclick = async () => {
    if (!confirm('Restore ' + b.dataset.rs + '?\n\nAll changes made after this backup will be replaced.')) return;
    if (!confirm('Are you sure? This cannot be undone (except by restoring the safety copy).')) return;
    try { await api('POST', '/api/restore', { name: b.dataset.rs }); alert('Restored. The program will reload now.'); location.reload(); } catch (e) { toast(e.message, true); }
  });
}

/* ============================================================ AI helpers */
function needKey() { if (L.meta.ai_has_key) return false; toast('Add the AI key first: Settings → AI features', true); return true; }
const AI_CACHE = {};
async function aiSummary() {
  if (needKey()) return;
  const box = $('#aiSumBox'), pid = P.patient.id;
  box.innerHTML = '<div class="aibox muted">' + ic('spark') + ' Reading all previous visits…</div>';
  try {
    const r = await api('POST', '/api/ai_summary', { patient_id: pid });   // the server reuses the saved summary until the file changes
    box.innerHTML = `<div class="aibox"><div style="white-space:pre-wrap">${esc(r.text)}</div><div class="muted small" style="margin-top:4px">AI summary · ${esc(r.at)}${r.cached ? ' (saved — file unchanged)' : ''} · check against the record</div></div>`;
  } catch (e) { delete AI_CACHE[pid]; box.innerHTML = `<div class="aibox" style="color:var(--warn)">${esc(e.message)}</div>`; }
}
async function aiReadLabs(f) {
  if (needKey()) return;
  const close = modal(`<h2>${ic('spark')} Reading lab values<span class="sp"></span><button data-close>✕</button></h2><div class="muted" style="padding:20px 0">Reading the sheet… (10–30 seconds)</div>`);
  let r; try { r = await api('POST', '/api/ai_ocr', { file_id: f.id }); } catch (e) { close(); return toast(e.message, true); }
  close();
  const tests = Object.fromEntries((L.lab_tests || []).map(t => [t.code, t]));
  const c2 = modal(`<h2>${ic('spark')} Lab values found<span class="sp"></span><label class="small">Test date <input type="date" id="oDate" value="${r.date && /^\d{4}-\d\d-\d\d$/.test(r.date) ? r.date : f.date}"></label><button data-close>✕</button></h2>
    ${r.items.length ? `<table class="t"><thead><tr><th></th><th>Test</th><th>Value</th><th>Unit</th><th>As written</th></tr></thead><tbody>
      ${r.items.map((it, i) => `<tr><td><input type="checkbox" data-ok="${i}" checked></td><td>${esc((tests[it.code] || {}).name || it.code)}</td><td><input data-v="${i}" value="${it.value}" style="width:80px;text-align:right" inputmode="decimal"></td><td class="muted small">${esc((tests[it.code] || {}).unit || '')}</td><td class="muted small" dir="auto">${esc(it.as_written || '')}</td></tr>`).join('')}</tbody></table>` : '<div class="muted">No matching values were found on this sheet.</div>'}
    ${(r.other || []).length ? `<div class="small muted" style="margin-top:8px"><b>Other results (not saved):</b> ${r.other.map(esc).join(' · ')}</div>` : ''}
    <div class="foot"><span class="muted small" style="margin-right:auto">Check every value against the sheet before saving.</span><button data-close>Cancel</button><button class="primary" id="oSave"${r.items.length ? '' : ' disabled'}>Save checked values</button></div>`);
  const s = $('#oSave'); if (s) s.onclick = async () => {
    const items = r.items.map((it, i) => ({ code: it.code, value: $(`[data-v="${i}"]`).value.trim(), source: 'ocr' })).filter((it, i) => $(`[data-ok="${i}"]`).checked && it.value);
    await api('POST', '/api/lab', { patient_id: P.patient.id, visit_id: VIS.id, date: $('#oDate').value, items });
    c2(); toast(items.length + ' results saved'); reloadPatient();
  };
}

/* ============================================================ extra settings tabs */
const EXTRA_TABS = {
  async errors(pane, card) {
    const d = await api('GET', '/api/errors?n=400'), SRC = { server: '🖥️ Server', api: '⚙️ Request', browser: '🌐 Screen', sync: '☁️ Sync', handoff: '🔁 Hand-over', update: '⬇️ Update', backup: '💾 Backup', crash: '💥 Crash', thread: '💥 Background' };
    const now = Object.entries(d.state).filter(([, v]) => v);
    pane.innerHTML = card('Error log — ' + esc(d.pc) + ' · version ' + esc(d.ver || '?'), `
      <div class="small muted" style="margin-bottom:8px">Errors of this computer. They are also kept inside the database, so they reach Google Drive with the hand-over copy and the backups.</div>
      ${now.length ? `<div class="flag allergy" style="display:block;margin-bottom:8px">Now: ${now.map(([k, v]) => esc(SRC[k] || k) + ' — ' + esc(v)).join(' · ')}</div>` : '<div class="flag noall" style="display:inline-block;margin-bottom:8px">✅ No error right now</div>'}
      ${d.rows.length ? `<table class="tbl"><tr><th>Time</th><th>Where</th><th>Error</th></tr>${d.rows.map((r, i) => `<tr><td class="small" style="white-space:nowrap">${esc(r.t)}</td><td class="small" style="white-space:nowrap">${esc(SRC[r.src] || r.src)}</td><td dir="auto">${esc(r.msg)}${r.detail ? ` <button class="small" data-ed="${i}">details</button><pre class="small hidden" id="ed${i}" style="white-space:pre-wrap;max-height:240px;overflow:auto">${esc(r.detail)}</pre>` : ''}</td></tr>`).join('')}</table>` : '<div class="muted">No errors recorded. 🎉</div>'}`);
    $$('[data-ed]', pane).forEach(b => b.onclick = () => $('#ed' + b.dataset.ed).classList.toggle('hidden'));
  },
  look(pane, card) {
    const t = themeCfg();
    pane.innerHTML = card('Appearance', `
      <div class="small muted" style="margin-bottom:8px">Applies to every computer of the clinic (and the secretary's phone page on Wi-Fi).</div>
      <div class="lbl">Main colour</div>
      <div class="swatches">${Object.entries(THEMES).map(([k, c]) => `<button class="sw${t.accent === c ? ' on' : ''}" data-c="${c}" style="background:${c}" title="${k}"></button>`).join('')}
        <label class="small" style="margin-left:8px">Custom <input type="color" id="thC" value="${t.accent}"></label></div>
      <div class="row" style="margin-top:12px"><label>Mode<select id="thM"><option value="light"${t.mode !== 'dark' ? ' selected' : ''}>Light</option><option value="dark"${t.mode === 'dark' ? ' selected' : ''}>Dark</option></select></label>
        <label>Text size<select id="thS">${[13, 14, 15, 16, 17].map(n => `<option value="${n}"${+t.size === n ? ' selected' : ''}>${n}${n === 14 ? ' (default)' : ''}</option>`).join('')}</select></label></div>
      <div class="lbl" style="margin-top:12px">Colour coding used in the program</div>
      <div class="legend"><span class="chip abn">Abnormal / avoid</span><span class="chip mid">Needs attention</span><span class="chip">Normal</span><span class="flag allergy">⚠ Allergy</span><span class="flag chronic">Chronic condition</span><span class="status st-waiting">Waiting</span><span class="status st-in">With doctor</span><span class="status st-done">Done</span><span class="status st-noshow">No-show</span><span class="lab-hi">High value</span> <span class="lab-lo">Low value</span></div>
      <div class="actions"><button class="primary" id="thSave">Save</button><button id="thReset">Reset to default</button></div>`, ' style="max-width:820px"');
    const cur = () => ({ accent: $('#thC').value, mode: $('#thM').value, size: +$('#thS').value });
    const live = () => applyTheme(cur());
    $$('.sw', pane).forEach(b => b.onclick = () => { $('#thC').value = b.dataset.c; $$('.sw', pane).forEach(x => x.classList.toggle('on', x === b)); live(); });
    ['#thC', '#thM', '#thS'].forEach(s => $(s).addEventListener('input', live));
    $('#thSave').onclick = async () => { await api('PUT', '/api/meta', { theme: JSON.stringify(cur()) }); await loadLists(); toast('Saved'); };
    $('#thReset').onclick = async () => { await api('PUT', '/api/meta', { theme: '' }); await loadLists(); showSetTab('look'); };
  },
  ai(pane, card) {
    const m = L.meta;
    pane.innerHTML = card('AI features', `
      <div class="small muted" style="margin-bottom:8px">Two helpers use an Anthropic (Claude) API key: <b>Read lab values</b> from a photo/PDF of a lab sheet (open a file in the patient's Investigation files), and <b>AI summary</b> of all previous visits (patient page → Summary). Without a key everything else works normally.<br>
        When used, the sheet image or the visit text of that patient is sent to Anthropic over the internet; nothing is sent otherwise.</div>
      <div class="row"><label class="grow">API key<input id="aiK" type="password" data-lang="en" autocomplete="off" placeholder="${m.ai_has_key ? 'Saved — type only to replace it' : 'sk-ant-…  (get it from console.anthropic.com)'}"></label></div>
      ${aiModelPick('ocr', 'Reading lab sheets (photo / PDF)', m.ai_model_ocr || m.ai_model || AI_DEF)}
      ${aiModelPick('sum', 'Summary of previous visits', m.ai_model_sum || m.ai_model || AI_DEF)}
      ${aiModelPick('plan', 'Suggestions for today (questions, exam, differential, tests, medicines)', m.ai_model_plan || 'claude-sonnet-5-5')}
      <div class="small muted" style="margin-top:6px">Prices are approximate (US dollars, Anthropic list prices). *Per month = about 300 lab sheets / summaries / suggestions; a saved summary is reused for free until the file changes.</div>
      <div class="actions"><button class="primary" id="aiSave">Save</button><button id="aiTest">Test the key</button>${m.ai_has_key ? '<button class="danger" id="aiDel">Remove key</button>' : ''}<span id="aiSt" class="small" style="margin-left:8px">${m.ai_has_key ? '<span style="color:var(--ok)">● key saved</span>' : '<span class="muted">no key yet</span>'}</span></div>`, ' style="max-width:820px"');
    $('#aiSave').onclick = async () => { const b = { ai_model: '', ai_model_ocr: ($('[name=aim_ocr]:checked') || {}).value || AI_DEF, ai_model_sum: ($('[name=aim_sum]:checked') || {}).value || AI_DEF, ai_model_plan: ($('[name=aim_plan]:checked') || {}).value || 'claude-sonnet-5-5' }; if ($('#aiK').value.trim()) b.ai_key = $('#aiK').value.replace(/\s+/g, ''); await api('PUT', '/api/meta', b); await loadLists(); toast('Saved'); showSetTab('ai'); };
    $('#aiTest').onclick = async () => { $('#aiSt').innerHTML = '<span class="muted">testing…</span>';
      const k = $('#aiK').value.replace(/\s+/g, '');     // a key typed/pasted but not saved yet is saved first, then tested
      if (k) { if (!/^sk-ant-/.test(k)) { $('#aiSt').innerHTML = '<span style="color:var(--warn)">● the key must start with sk-ant-</span>'; return; } await api('PUT', '/api/meta', { ai_key: k }); await loadLists(); }
      try { await api('POST', '/api/ai_test', {}); $('#aiSt').innerHTML = '<span style="color:var(--ok)">● the key works</span>'; } catch (e) { $('#aiSt').innerHTML = `<span style="color:var(--warn)">● ${esc(e.message)}</span>`; } };
    const d = $('#aiDel'); if (d) d.onclick = async () => { if (!confirm('Remove the AI key?')) return; await api('PUT', '/api/meta', { ai_key: '' }); await loadLists(); showSetTab('ai'); };
  },
};

/* ============================================================ chronic-disease registries */
const REG = [['dm', 'Diabetes', 'drop'], ['htn', 'Hypertension', 'heart'], ['ckd', 'Chronic kidney disease', 'kidney'], ['lipid', 'Dyslipidaemia', 'drop'], ['ihd', 'Ischaemic heart disease', 'heart'],
  ['hf', 'Heart failure', 'heart'], ['af', 'Atrial fibrillation', 'heart'], ['thyroid', 'Hypothyroidism', 'labs'], ['asthma', 'Asthma / COPD', 'lung']];
async function viewRegistry(v, params) {
  const cond = REG.some(r => r[0] === params.c) ? params.c : (localStorageGet('regTab') || 'dm');
  const flt = params.f || 'all';
  v.innerHTML = `<div class="tabsview"><nav class="vtabs card">${REG.map(([k, l, i]) => `<button data-tab="${k}"${k === cond ? ' class="on"' : ''}>${ic(i)}<span>${l}</span><small class="cnt" data-n="${k}"></small></button>`).join('')}</nav><div id="regPane"><div class="card muted">Loading…</div></div></div>`;
  $$('.vtabs [data-tab]').forEach(b => b.onclick = () => location.hash = '#/reg?c=' + b.dataset.tab);
  api('GET', '/api/registry_counts').then(c => Object.entries(c).forEach(([k, n]) => { const el = $(`[data-n="${k}"]`); if (el) el.textContent = n; }));
  localStorageSet('regTab', cond);
  const d = await api('GET', '/api/registry?cond=' + cond);
  const F = { all: ['All', () => true], off: ['Off target', r => r.flags.length], due: ['Tests due', r => r.due.length], lost: ['No visit > 6 months', r => r.lost], fu: ['Missed follow-up', r => r.missed_fu && r.lost] };
  const rows = d.rows.filter(F[flt][1]);
  const val = (x, f = 1) => x ? `${fnum(x[1], f)} <span class="muted small">${dmy(x[0]).slice(3)}</span>` : '<span class="muted">—</span>';
  const cols = { dm: [['HbA1c', r => val(r.hba1c)], ['LDL', r => val(r.ldl, 0)], ['eGFR', r => val(r.egfr, 0)], ['UACR', r => val(r.uacr, 0)]], htn: [['BP', r => r.bp ? `${r.bp[1]}/${r.bp[2] || '?'} <span class="muted small">${dmy(r.bp[0]).slice(3)}</span>` : '—'], ['eGFR', r => val(r.egfr, 0)], ['K', r => val(r.k)]],
    ckd: [['eGFR', r => val(r.egfr, 0)], ['Creatinine', r => val(r.creat, 2)], ['UACR', r => val(r.uacr, 0)], ['K', r => val(r.k)]], lipid: [['LDL', r => val(r.ldl, 0)]], ihd: [['LDL', r => val(r.ldl, 0)], ['BP', r => r.bp ? `${r.bp[1]}/${r.bp[2] || '?'}` : '—']],
    hf: [['eGFR', r => val(r.egfr, 0)], ['K', r => val(r.k)], ['BP', r => r.bp ? `${r.bp[1]}/${r.bp[2] || '?'}` : '—']], af: [['eGFR', r => val(r.egfr, 0)], ['BP', r => r.bp ? `${r.bp[1]}/${r.bp[2] || '?'}` : '—']], thyroid: [['TSH', r => val(r.tsh, 2)]], asthma: [] }[cond];
  $('#regPane').innerHTML = `<div class="card"><h3>${ic(REG.find(r => r[0] === cond)[2])} ${esc(d.label)} <span class="muted small" style="text-transform:none">· ${d.rows.length} patients</span><span class="sp"></span>
      ${Object.entries(F).map(([k, [l, fn]]) => `<button class="small${k === flt ? ' primary' : ''}" data-f="${k}" style="text-transform:none">${l} <b>${d.rows.filter(fn).length}</b></button>`).join('')}
      <button class="small" id="regCsv" style="text-transform:none">Export CSV</button></h3>
    <table class="t reg"><thead><tr><th>Patient</th><th>Age</th><th>Phone</th><th>Last visit</th>${cols.map(c => `<th>${c[0]}</th>`).join('')}<th>Off target</th><th>Due</th></tr></thead><tbody>
    ${rows.slice(0, 500).map(r => `<tr><td><a href="#/p/${r.id}" class="ar">${esc(r.name)}</a></td><td>${r.age != null ? r.age : ''}</td>
      <td style="white-space:nowrap">${esc(r.phone || '')}${r.phone && (r.lost || r.missed_fu) ? ` <button class="small wa" data-wa="${r.id}" title="WhatsApp: ask the patient to come for follow-up">${ic('wa')}</button>` : ''}</td>
      <td style="white-space:nowrap">${r.last_visit ? dmy(r.last_visit) : '—'}${r.lost ? ' <span class="chip abn">lost</span>' : ''}</td>
      ${cols.map(c => `<td style="white-space:nowrap">${c[1](r)}</td>`).join('')}
      <td>${r.flags.map(f => `<span class="chip abn">${esc(f)}</span>`).join(' ')}</td><td class="small">${r.due.map(esc).join(', ')}</td></tr>`).join('') || `<tr><td colspan="9" class="muted">No patients.</td></tr>`}
    </tbody></table>${rows.length > 500 ? `<div class="muted small">Showing 500 of ${rows.length} — use the filters.</div>` : ''}
    <div class="muted small" style="margin-top:6px">Patients are found from the chronic-condition list and from every visit diagnosis. Targets: HbA1c ≤ 7, LDL < 70 (diabetes/IHD) or < 100, BP < 140/90.</div></div>`;
  $$('#regPane [data-f]').forEach(b => b.onclick = () => location.hash = '#/reg?c=' + cond + '&f=' + b.dataset.f);
  $$('#regPane [data-wa]').forEach(b => b.onclick = () => { const r = rows.find(x => x.id === +b.dataset.wa), n = waNumber(r.phone); if (!n) return toast('Not a valid mobile number', true);
    window.open('https://wa.me/' + n + '?text=' + encodeURIComponent(`مرحباً ${r.name}، نذكّركم بموعد المراجعة الدورية في ${L.meta.clinic_name || 'العيادة'}. يرجى الاتصال بنا لتحديد موعد.`), '_blank'); });
  $('#regCsv').onclick = () => {
    const head = ['File', 'Name', 'Age', 'Phone', 'Last visit'].concat(cols.map(c => c[0]), ['Off target', 'Due']);
    const strip = h => String(h).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const lines = [head].concat(rows.map(r => [r.id, r.name, r.age != null ? r.age : '', r.phone || '', r.last_visit || ''].concat(cols.map(c => strip(c[1](r))), [r.flags.join('; '), r.due.join('; ')])));
    const csv = '﻿' + lines.map(l => l.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = d.label.replace(/\W+/g, '_') + '_' + todayISO() + '.csv'; a.click();
  };
}

/* ============================================================ statistics */
async function viewStats(v, params) {
  const t = todayISO(), per = params.per || '30';
  const from = params.from || (per === 'all' ? '2000-01-01' : per === 'year' ? t.slice(0, 4) + '-01-01' : addDays(t, -(+per - 1))), to = params.to || t;
  const d = await api('GET', `/api/stats?from=${from}&to=${to}`);
  const bars = (pairs, lab) => { const mx = Math.max(1, ...pairs.map(p => p[1])); const every = Math.ceil(pairs.length / 14); return `<div class="bars">${pairs.map(([k, n], i) => `<div class="bar" title="${esc(lab(k))}: ${n}"><div style="height:${Math.max(2, n / mx * 100)}%"></div>${i % every === 0 ? `<span>${esc(lab(k))}</span>` : ''}</div>`).join('')}</div>`; };
  const hbars = list => { const mx = Math.max(1, ...list.map(x => x[1])); return list.map(([k, n]) => `<div class="hb"><span dir="auto">${esc(k)}</span><div><i style="width:${n / mx * 100}%"></i></div><b>${n}</b></div>`).join('') || '<div class="muted small">—</div>'; };
  const series = d.per_day.length > 62 ? d.per_month : d.per_day;
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const ns = d.appts.total ? Math.round(d.appts.noshow / d.appts.total * 100) : 0;
  v.innerHTML = `<div class="card slim"><h3>${ic('stats')} Clinic statistics<span class="sp"></span>
      ${[['7', '7 days'], ['30', '30 days'], ['90', '3 months'], ['365', '12 months'], ['year', 'This year'], ['all', 'All']].map(([k, l]) => `<button class="small${!params.from && per === k ? ' primary' : ''}" data-per="${k}" style="text-transform:none">${l}</button>`).join('')}
      <input type="date" id="sF" value="${from}"> – <input type="date" id="sT" value="${to}"></h3></div>
    <div class="kpis">
      <div class="kpi"><b>${d.visits}</b><span>Visits</span></div><div class="kpi"><b>${d.patients}</b><span>Patients seen</span></div>
      <div class="kpi"><b>${d.new}</b><span>New patients</span></div><div class="kpi"><b>${d.visits ? (d.visits / Math.max(1, d.per_day.length)).toFixed(1) : 0}</b><span>Visits per working day</span></div>
      <div class="kpi"><b>${d.appts.total}</b><span>Appointments</span></div><div class="kpi${ns > 15 ? ' bad' : ''}"><b>${ns}%</b><span>No-show</span></div>
      <div class="kpi"><b>${d.all_patients}</b><span>Files in total</span></div></div>
    <div class="sgrid"><div class="card"><h3>Visits per ${d.per_day.length > 62 ? 'month' : 'day'}</h3>${series.length ? bars(series, k => k.length === 7 ? k.slice(5) + '/' + k.slice(2, 4) : k.slice(8) + '/' + k.slice(5, 7)) : '<div class="muted small">No visits in this period.</div>'}</div>
      <div class="card"><h3>By weekday</h3>${bars(d.weekday.map((n, i) => [i, n]), i => WD[i])}</div>
      <div class="card"><h3>Top diagnoses</h3>${hbars(d.top_dx)}</div>
      <div class="card"><h3>Top medications</h3>${hbars(d.top_meds)}</div></div>`;
  $$('[data-per]').forEach(b => b.onclick = () => location.hash = '#/stats?per=' + b.dataset.per);
  const cust = () => location.hash = `#/stats?from=${$('#sF').value}&to=${$('#sT').value}`;
  $('#sF').onchange = cust; $('#sT').onchange = cust;
}

/* ============================================================ calculator: ASCVD 10-year risk (Pooled Cohort Equations) */
C.ascvd = (v) => {
  const { age, sex, tc, hdl, sbp } = v; if (!age || !sex || !tc || !hdl || !sbp) return null;
  const la = Math.log(age), lt = Math.log(tc), lh = Math.log(hdl), ls = Math.log(sbp), smk = v.smk ? 1 : 0, dm = v.dm ? 1 : 0, trt = v.trt, aa = +v.race === 1;
  let s, s0, mean;
  if (sex === 'F' && !aa) { s = -29.799 * la + 4.884 * la * la + 13.54 * lt - 3.114 * la * lt - 13.578 * lh + 3.149 * la * lh + (trt ? 2.019 * ls : 1.957 * ls) + 7.574 * smk - 1.665 * la * smk + 0.661 * dm; s0 = 0.9665; mean = -29.18; }
  else if (sex === 'F') { s = 17.114 * la + 0.94 * lt - 18.92 * lh + 4.475 * la * lh + (trt ? 29.291 * ls - 6.432 * la * ls : 27.82 * ls - 6.087 * la * ls) + 0.691 * smk + 0.874 * dm; s0 = 0.9533; mean = 86.61; }
  else if (!aa) { s = 12.344 * la + 11.853 * lt - 2.664 * la * lt - 7.99 * lh + 1.769 * la * lh + (trt ? 1.797 * ls : 1.764 * ls) + 7.837 * smk - 1.795 * la * smk + 0.658 * dm; s0 = 0.9144; mean = 61.18; }
  else { s = 2.469 * la + 0.302 * lt - 0.307 * lh + (trt ? 1.916 * ls : 1.809 * ls) + 0.549 * smk + 0.645 * dm; s0 = 0.8954; mean = 19.54; }
  return (1 - Math.pow(s0, Math.exp(s - mean))) * 100;
};
CALCS.push({ id: 'ascvd', t: 'ASCVD 10-year risk (PCE)', f: [['age', 'Age (40–79)'], ['sex', 'Sex', 'sex'], ['race', 'Equation', ['White / other (use for Iraqi patients)', 'African American']], ['tc', 'Total cholesterol (mg/dL)'], ['hdl', 'HDL (mg/dL)'], ['sbp', 'Systolic BP'],
  ['trt', 'On BP treatment', 'ck'], ['dm', 'Diabetes', 'ck'], ['smk', 'Current smoker', 'ck']],
  r: v => { if (v.age && (v.age < 40 || v.age > 79)) return ['Valid for age 40–79 only', 'mid']; const r = C.ascvd(v); if (r == null) return null;
    return [`10-year ASCVD risk ${r.toFixed(1)}% — ${r < 5 ? 'low' : r < 7.5 ? 'borderline' : r < 20 ? 'intermediate: moderate/high-intensity statin' : 'high: high-intensity statin'}`, r >= 20 ? 'abn' : r >= 7.5 ? 'mid' : 'ok']; },
  n: 'Pooled Cohort Equations (ACC/AHA 2013). For known ASCVD (MI, stroke, PCI) the patient is already high risk — do not use.' });
CALCS.push({ id: 'ganzoni', t: 'Iron deficit — Ganzoni', f: [['w', 'Weight (kg)'], ['hb', 'Actual Hb (g/dL)'], ['thb', 'Target Hb (g/dL) — empty = 15 (13 if < 35 kg)'], ['st', 'Iron stores (mg) — empty = 500 (15 mg/kg if < 35 kg)']],
  r: v => { if (!v.w || !v.hb) return null; const small = v.w < 35, t = v.thb || (small ? 13 : 15), st = v.st != null ? v.st : (small ? 15 * v.w : 500);
    if (t <= v.hb) return [`Hb is at or above the target (${t} g/dL) — iron deficit = stores only: ${Math.round(st)} mg`, 'ok'];
    const d = v.w * (t - v.hb) * 2.4 + st, fcm = Math.min(1000, 20 * v.w);
    return [`Total iron deficit ${Math.round(d)} mg · iron sucrose 100 mg ampoules: ${Math.ceil(d / 100)} (max 200 mg per dose) · ferric carboxymaltose: ${Math.ceil(d / fcm)} infusion(s) of up to ${Math.round(fcm)} mg (≤ 20 mg/kg, max 1000 mg each, ≥ 7 days apart)`, 'mid']; },
  n: 'Ganzoni: deficit (mg) = weight (kg) × (target Hb − actual Hb) (g/dL) × 2.4 + iron stores. Check the product leaflet for the maximum single dose.' });
CALCS.forEach(c => c.ic = c.ic || CALC_ICON[c.id] || 'calc');

/* every date box shows and accepts day/month/year (dd/mm/yyyy) whatever the language of Windows / the phone;
   the real <input type=date> stays hidden underneath, so .value is still yyyy-mm-dd for the program */
(function () {
  const D = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  const p2 = n => String(n).padStart(2, '0');
  const fmt = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v.slice(8, 10) + '/' + v.slice(5, 7) + '/' + v.slice(0, 4) : '';
  const parse = t => {
    const m = String(t || '').trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).match(/^(\d{1,2})\D+(\d{1,2})\D+(\d{2}|\d{4})$/) ||
      String(t || '').trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).match(/^(\d{2})(\d{2})(\d{4})$/);
    if (!m) return null;
    let y = +m[3]; if (y < 100) y += 2000;
    const d = new Date(y, +m[2] - 1, +m[1]);
    if (d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[1]) return null;
    return y + '-' + p2(m[2]) + '-' + p2(m[1]);
  };
  function enhance(inp) {
    if (inp.dataset.dmy) return; inp.dataset.dmy = '1';
    const w = document.createElement('span'), t = document.createElement('input'), b = document.createElement('button');
    w.className = 'dmy'; if (inp.getAttribute('style')) w.setAttribute('style', inp.getAttribute('style'));
    t.type = 'text'; t.className = inp.className; t.placeholder = 'dd/mm/yyyy'; t.inputMode = 'numeric'; t.autocomplete = 'off'; t.dir = 'ltr'; t.setAttribute('data-lang', 'en');
    if (inp.title) t.title = inp.title;
    b.type = 'button'; b.className = 'dmy-b'; b.tabIndex = -1; b.title = 'Calendar'; b.textContent = '📅';
    inp.parentNode.insertBefore(w, inp); w.append(t, b, inp); inp.classList.add('dmy-h'); inp.tabIndex = -1;
    const show = () => { t.value = fmt(D.get.call(inp)); t.classList.remove('bad'); };
    Object.defineProperty(inp, 'value', { configurable: true, get() { return D.get.call(inp); }, set(v) { D.set.call(inp, v); show(); } });
    Object.defineProperty(inp, 'disabled', { configurable: true, get() { return t.disabled; }, set(v) { t.disabled = b.disabled = !!v; } });
    inp.focus = () => t.focus();
    show();
    const fire = () => { inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); };
    inp.addEventListener('change', show);
    const commit = () => {
      if (!t.value.trim()) { if (D.get.call(inp)) { D.set.call(inp, ''); fire(); } return true; }
      const v = parse(t.value);
      if (!v) { t.classList.add('bad'); return false; }
      t.classList.remove('bad'); t.value = fmt(v);
      if (v !== D.get.call(inp)) { D.set.call(inp, v); fire(); }
      return true;
    };
    t.addEventListener('input', () => {        // 09112026 → 09/11/2026 while typing
      const d = t.value.replace(/[٠-٩]/g, x => '٠١٢٣٤٥٦٧٨٩'.indexOf(x));
      if (/^\d{8}$/.test(d)) t.value = d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4);
      if (/^\d{1,2}\D\d{1,2}\D\d{4}$/.test(t.value)) commit();
    });
    t.addEventListener('change', commit);
    t.addEventListener('blur', () => { if (!commit()) setTimeout(show, 1500); });
    t.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
    b.onclick = () => { try { inp.showPicker(); } catch (e) { t.focus(); } };
  }
  const scan = () => document.querySelectorAll('input[type=date]:not([data-dmy])').forEach(enhance);
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();

/* ============================================================ AI model choice with prices */
const AI_DEF = 'claude-haiku-5-5';
const AI_MODELS = [   // [id, name, note, per lab sheet, per summary, month of 300 sheets, month of 300 summaries, per suggestion, month of 300 suggestions]
  ['claude-haiku-5-5', 'Claude Haiku 5.5', 'Fast and cheapest — reads printed lab sheets well', '≈ $0.0005', '≈ $0.001', '≈ $0.15', '≈ $0.30', '≈ $0.002', '≈ $0.6'],
  ['claude-sonnet-5-5', 'Claude Sonnet 5.5', 'More accurate; better clinical reasoning (recommended for suggestions)', '≈ $0.01', '≈ $0.025', '≈ $3', '≈ $7.5', '≈ $0.03', '≈ $9'],
  ['claude-opus-5-5', 'Claude Opus 5.5', 'Most capable — for complex patients', '≈ $0.02', '≈ $0.05', '≈ $6', '≈ $15', '≈ $0.06', '≈ $18'],
];
function aiModelPick(k, title, cur) {
  const known = AI_MODELS.some(x => x[0] === cur);
  return `<div class="aim"><div class="aim-t">${title}</div>
    ${AI_MODELS.map(([id, n, note, c1, c2, m1, m2, c3, m3]) => `<label class="aim-o${id === cur ? ' on' : ''}"><input type="radio" name="aim_${k}" value="${id}"${id === cur ? ' checked' : ''}>
      <span class="aim-n"><b>${n}</b><small>${note}</small></span>
      <span class="aim-p">${k === 'ocr' ? `${c1}<small>per lab sheet</small>` : k === 'sum' ? `${c2}<small>per summary</small>` : `${c3}<small>per suggestion</small>`}</span><span class="aim-p">${k === 'ocr' ? m1 : k === 'sum' ? m2 : m3}<small>per month*</small></span></label>`).join('')}
    ${known ? '' : `<label class="aim-o on"><input type="radio" name="aim_${k}" value="${esc(cur)}" checked><span class="aim-n"><b>${esc(cur)}</b><small>set before</small></span></label>`}</div>`;
}
document.addEventListener('change', e => { if (e.target.matches('.aim input[type=radio]')) $$(`[name="${e.target.name}"]`).forEach(r => r.closest('.aim-o').classList.toggle('on', r.checked)); });
