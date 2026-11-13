/* The secretary always works in Arabic (right-to-left); the doctor always in English.
   The program's pages are written in English — for the secretary every interface text is swapped
   for its Arabic version as soon as it appears. Patient names and typed data are never touched. */
(function () {
  const AR = {
    // top bar
    'Today': 'اليوم', '+ New patient': '+ مريض جديد', 'Settings': 'الإعدادات', '● Saved': '● محفوظ', 'Saved': 'تم الحفظ', 'Saving…': 'جارٍ الحفظ…',
    'Offline': 'غير متصل', 'Online': 'متصل', 'Sign out': 'خروج', 'Save status': 'حالة الحفظ', 'Calendar': 'التقويم',
    'Search patient — name or phone  (F2)': 'ابحث عن مريض — بالاسم أو الهاتف  (F2)', 'add new patient': 'إضافة مريض جديد', 'No patient found —': 'لا يوجد مريض —',
    // today
    'Appointments & waiting list': 'المواعيد وقائمة الانتظار', 'Patient (search existing, or type a new name)': 'المريض (ابحث أو اكتب اسماً جديداً)',
    'Phone': 'الهاتف', 'Time': 'الوقت', 'Note': 'ملاحظة', 'Add': 'إضافة', 'Patient': 'المريض', 'Age': 'العمر', 'Weight': 'الوزن', 'Status': 'الحالة',
    '— no time —': '— بدون وقت —', 'No appointments for this day.': 'لا توجد مواعيد في هذا اليوم.', 'kg': 'كغم',
    'Booked': 'محجوز', 'Waiting': 'حاضر', 'With doctor': 'عند الطبيب', 'Done': 'انتهى', 'No-show': 'لم يحضر',
    'Arrived': 'حضر', 'register': 'تسجيل ملف', 'new': 'جديد', 'Back to booked': 'رجوع إلى محجوز', 'Move up': 'تحريك للأعلى', 'Remove': 'حذف',
    'Send a WhatsApp reminder': 'إرسال تذكير واتساب', 'WhatsApp': 'واتساب',
    'Auto': 'موعد تلقائي', 'Made automatically from the follow-up date': 'أُنشئ تلقائياً من تاريخ المراجعة',
    'Called — coming': 'تم الاتصال — يحضر', 'Called — not coming': 'تم الاتصال — لن يحضر', 'No answer': 'لم يرد', 'no answer': 'لم يرد',
    'Coming': 'يحضر', 'Not coming': 'لن يحضر', 'Called — will come': 'تم الاتصال — سيحضر', 'Called — will not come': 'تم الاتصال — لن يحضر',
    'No answer — try again later': 'لم يرد — حاول لاحقاً', 'Change the call result': 'تغيير نتيجة الاتصال',
    'Waiting list': 'قائمة الانتظار', 'Move to the waiting list (book a new date later)': 'نقل إلى قائمة الانتظار (حجز موعد جديد لاحقاً)',
    'Calls to make': 'اتصالات المتابعة', '· automatic follow-ups in the next 7 days': '· مواعيد تلقائية خلال 7 أيام', '· patients to give a new date': '· مرضى يحتاجون موعداً جديداً',
    'Nothing to call — all automatic appointments of the coming week are confirmed.': 'لا توجد اتصالات — كل المواعيد التلقائية للأسبوع القادم مؤكدة.',
    'Empty. Patients who will not come (or did not come) can be moved here and booked again later.': 'القائمة فارغة. من لن يحضر أو لم يحضر يمكن نقله إلى هنا وحجز موعد جديد له لاحقاً.',
    'Book': 'حجز', 'no phone': 'لا يوجد هاتف', 'Remove from the list': 'حذف من القائمة', 'no appointments tomorrow': 'لا توجد مواعيد غداً', 'no-show': 'لم يحضر',
    // WhatsApp reminders window
    'Press': 'اضغط', 'Send next': 'إرسال التالي', 'Send': 'إرسال', '✓ sent': '✓ أُرسل', 'no mobile number': 'لا يوجد رقم موبايل', 'Close': 'إغلاق',
    ': WhatsApp opens with the message ready — press send there, come back and press it again for the next patient.': ': يفتح واتساب والرسالة جاهزة — أرسلها ثم ارجع واضغط مرة أخرى للمريض التالي.',
    // patient form
    'New patient': 'مريض جديد', 'Edit patient': 'تعديل بيانات المريض', 'Full name (Arabic)': 'الاسم الكامل', 'Gender': 'الجنس', 'Male': 'ذكر', 'Female': 'أنثى',
    'Birth year': 'سنة الميلاد', 'Date of birth': 'تاريخ الميلاد', 'Marital': 'الحالة الاجتماعية', 'Single': 'أعزب', 'Married': 'متزوج', 'Divorced': 'مطلق', 'Widowed': 'أرمل',
    'Address (السكن)': 'السكن', 'Occupation (العمل)': 'العمل', 'Save patient': 'حفظ', "Save + add to today's list": 'حفظ وإضافة إلى قائمة اليوم', 'Cancel': 'إلغاء',
    '← Back to file': '← رجوع إلى الملف', 'Possible existing file:': 'قد يكون له ملف:', 'same phone': 'نفس الهاتف', 'similar name': 'اسم مشابه', 'Personal note': 'ملاحظة خاصة',
    // patient page
    '+ Attach investigation (image / PDF)': '+ إرفاق فحص (صورة / PDF)', 'Edit details': 'تعديل البيانات', 'Upcoming appointments': 'المواعيد القادمة', 'None': 'لا يوجد',
    'Date': 'التاريخ', 'Book appointment': 'حجز موعد', 'Family:': 'العائلة:', '+ Link family member': '+ ربط فرد من العائلة', 'Family member': 'فرد العائلة',
    'is the … of': 'صلة القرابة بـ', 'Link': 'ربط', 'Same phone:': 'نفس الهاتف:', 'Unlink': 'فك الربط',
    'Father': 'الأب', 'Mother': 'الأم', 'Son': 'الابن', 'Daughter': 'البنت', 'Husband': 'الزوج', 'Wife': 'الزوجة', 'Brother': 'الأخ', 'Sister': 'الأخت',
    'Grandfather': 'الجد', 'Grandmother': 'الجدة', 'Grandson': 'الحفيد', 'Granddaughter': 'الحفيدة', 'Uncle': 'العم / الخال', 'Aunt': 'العمة / الخالة',
    'Nephew': 'ابن الأخ / الأخت', 'Niece': 'بنت الأخ / الأخت', 'Cousin': 'ابن / بنت العم', 'Family': 'قريب', 'Linked': 'مرتبط',
    // settings
    'My PIN': 'الرقم السري', 'Current PIN': 'الرقم السري الحالي', 'New PIN': 'الرقم السري الجديد', 'Change': 'تغيير', 'Save': 'حفظ',
    'Previous week': 'الأسبوع السابق', 'Previous day': 'اليوم السابق', 'Next day': 'اليوم التالي', 'Next week': 'الأسبوع التالي', 'Go to a date': 'الذهاب إلى تاريخ',
    'Sun': 'الأحد', 'Mon': 'الإثنين', 'Tue': 'الثلاثاء', 'Wed': 'الأربعاء', 'Thu': 'الخميس', 'Fri': 'الجمعة', 'Sat': 'السبت',
    'Weight today (kg)': 'الوزن اليوم (كغم)', 'Save weight': 'حفظ الوزن', 'Previous:': 'السابق:', "Weight saved — added to today's list as waiting": 'تم حفظ الوزن — وأُضيف المريض إلى قائمة اليوم (حاضر)',
    // messages
    'Weight saved': 'تم حفظ الوزن', 'Moved to the waiting list': 'نُقل إلى قائمة الانتظار', 'Choose the patient from the list': 'اختر المريض من القائمة',
    'Choose the date': 'اختر التاريخ', 'Not a valid mobile number': 'رقم الموبايل غير صالح', 'The phone number is not a valid mobile number': 'رقم الهاتف ليس رقم موبايل صالحاً',
    'Remove this appointment?': 'حذف هذا الموعد؟', 'Remove this family link?': 'حذف ربط العائلة؟', 'Weight must be between 2 and 300 kg': 'الوزن بين 2 و 300 كغم',
    'Patient name is required': 'اسم المريض مطلوب', 'Wrong PIN': 'الرقم السري خطأ', 'Already linked': 'مرتبط مسبقاً', 'Cannot link a patient to himself': 'لا يمكن ربط المريض بنفسه',
    'All reminders sent': 'تم إرسال كل التذكيرات', 'Doctor only': 'للطبيب فقط', 'Birth year must be 4 digits, e.g. 1975': 'سنة الميلاد 4 أرقام، مثل 1975',
    'Only images or PDF files': 'صور أو PDF فقط', 'File is larger than 25 MB': 'الملف أكبر من 25 ميغا', 'Uploading…': 'جارٍ الرفع…',
  };
  const AMPM = (h, m, ap) => `${h}:${m} ${ap === 'AM' ? 'ص' : 'م'}`;
  const RX = [
    [/^(\d{1,2}):(\d\d) (AM|PM)$/, (s, h, m, ap) => AMPM(h, m, ap)],
    [/^(\d{1,2}):(\d\d) (AM|PM)( \(\d+\))$/, (s, h, m, ap, n) => AMPM(h, m, ap) + n],
    [/^(\d+) patients ·$/, '$1 مريض ·'], [/^(\d+) patients · (.*)$/, (s, n, r) => n + ' مريض · ' + r.replace(/Booked|Waiting|With doctor|Done|No-show/g, w => AR[w])],
    [/^WhatsApp reminders for (.+)$/, 'تذكير واتساب لمواعيد $1'], [/^Reminders — (.+)$/, 'التذكيرات — $1'],
    [/^(\d+) of (\d+) reminded$/, 'أُرسل التذكير لـ $1 من $2'], [/^(\d+) visits?$/, '$1 زيارة'],
    [/^(\d+) visits(?: · last (\S+))? · (\d+) attached files$/, (s, n, l, f) => `${n} زيارة${l ? ' · آخر زيارة ' + l : ''} · ${f} ملف مرفق`],
    [/^was (\S+)( · .*)?$/, (s, d, r) => 'كان ' + d + (r ? r.replace(/Called — coming|Called — not coming|No answer|no-show/g, w => AR[w]) : '')],
    [/^(\S+) {1,2}(\S* ?\S*) — (Booked|Waiting|With doctor|Done|No-show)$/, (s, d, t, st) => `${d} ${tr(t)} — ${AR[st]}`],
    [/^(\S+)  — (Booked|Waiting|With doctor|Done|No-show)$/, (s, d, st) => `${d} — ${AR[st]}`],
    [/^Booked for (.+)$/, 'تم الحجز يوم $1'], [/^No appointments on (.+)$/, 'لا توجد مواعيد يوم $1'], [/^Remove (.+) from the waiting list\?$/, 'حذف $1 من قائمة الانتظار؟'],
    [/^(\d+) ?y$/, '$1 سنة'], [/^Previous: (.*)$/, (m, r) => 'السابق: ' + r], [/^\((\d+)y, (.*) — (same phone|similar name)\)$/, (s, a, p, w) => `(${a} سنة، ${p} — ${AR[w]})`],
  ];
  const WORDS = [[/\b(\d+) y\b/g, '$1 سنة'], [/\bMale\b/g, 'ذكر'], [/\bFemale\b/g, 'أنثى'], [/\bno phone\b/g, 'لا يوجد هاتف']];
  function tr(s) {
    const k = String(s).trim(); if (k === '◀') return String(s).replace(k, '▶'); if (k === '▶') return String(s).replace(k, '◀'); if (k === '«') return String(s).replace(k, '»'); if (k === '»') return String(s).replace(k, '«'); if (!k || !/[A-Za-z]/.test(k)) return s;
    let r = AR[k];
    if (r == null) for (const [re, to] of RX) if (re.test(k)) { r = k.replace(re, to); break; }
    if (r == null && k.includes('·')) { let x = k; WORDS.forEach(([re, to]) => x = x.replace(re, to)); if (x !== k) r = x; }
    return r == null ? s : String(s).replace(k, r);
  }
  window.trAr = tr;
  const sec = () => document.body && document.body.classList.contains('sec');
  const SKIP = 'script,style,textarea,.nm,.keep,[contenteditable]';
  const DONE = new WeakMap();      // text we already translated is not translated again (◀ ▶ would flip back and forth)
  function trNode(n) {
    if (DONE.get(n) === n.nodeValue) return;
    const v = tr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v;
    DONE.set(n, n.nodeValue);
  }
  function walk(root) {
    if (!sec() || !root) return;
    if (root.nodeType === 3) { if (!root.parentElement || !root.parentElement.closest(SKIP)) trNode(root); return; }
    if (root.nodeType !== 1 || root.closest(SKIP)) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) { if (n.parentElement.closest(SKIP)) continue; trNode(n); }
    const els = [root].concat(Array.from(root.querySelectorAll('[placeholder],[title]')));
    els.forEach(e => { if (e.placeholder) { const v = tr(e.placeholder); if (v !== e.placeholder) e.placeholder = v; } if (e.title) { const v = tr(e.title); if (v !== e.title) e.title = v; } });
  }
  function setDir() {
    const s = sec();
    document.documentElement.dir = s ? 'rtl' : 'ltr'; document.documentElement.lang = s ? 'ar' : 'en';
    document.documentElement.classList.toggle('arui', s);
    if (s) walk(document.body);
  }
  let busy = false;
  const mo = new MutationObserver(ms => {
    if (busy) return; busy = true;
    try {
      for (const m of ms) {
        if (m.type === 'attributes' && m.target === document.body) { setDir(); continue; }
        if (!sec()) continue;
        if (m.type === 'characterData') walk(m.target);
        else m.addedNodes.forEach(walk);
      }
    } finally { busy = false; }
  });
  const start = () => { mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] }); setDir(); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  // messages shown by the program
  const _toast = window.toast; if (_toast) window.toast = (m, e) => _toast(sec() ? tr(m) : m, e);
  const _confirm = window.confirm.bind(window); window.confirm = m => _confirm(sec() ? tr(m) : m);
  const _prompt = window.prompt.bind(window); window.prompt = (m, d) => _prompt(sec() ? tr(m) : m, d);
})();
