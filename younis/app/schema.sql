PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS patients (
  id          INTEGER PRIMARY KEY,
  legacy_ids  TEXT,                 -- معرفات أكسس الأصلية (مفصولة بفواصل عند الدمج)
  form_no     TEXT,
  name        TEXT NOT NULL,
  name_norm   TEXT NOT NULL,
  dob         TEXT,
  phone       TEXT,
  phone_norm  TEXT,
  area        TEXT,
  medical     TEXT,                 -- الامراض والحساسية والصعوبات
  p_factor    TEXT,                 -- المستوى المادي
  private_note TEXT,                -- ملاحظة خاصة (تظهر فقط بزر)
  xray        INTEGER DEFAULT 0,    -- مسجل في برنامج الأشعة
  created_at  TEXT DEFAULT (datetime('now','localtime')),
  updated_at  TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_pat_name  ON patients(name_norm);
CREATE INDEX IF NOT EXISTS ix_pat_phone ON patients(phone_norm);
CREATE INDEX IF NOT EXISTS ix_pat_form  ON patients(form_no);

CREATE TABLE IF NOT EXISTS works (
  id            INTEGER PRIMARY KEY,
  patient_id    INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  date          TEXT,               -- YYYY-MM-DD
  tooth         TEXT,
  work_type     TEXT,
  doctor        TEXT,
  price_orig    REAL,               -- بالآلاف
  price_final   REAL,               -- بالآلاف، بعد التخفيض
  details       TEXT,
  status        TEXT NOT NULL DEFAULT 'done',   -- done | plan
  legacy        INTEGER NOT NULL DEFAULT 0,     -- 1 = منقول من أكسس، خارج الحساب
  legacy_cost   TEXT,               -- نص خانة المبلغ الكلي الأصلي
  legacy_paid   TEXT,               -- نص خانة المدفوع الأصلي
  seq           INTEGER,
  created_at    TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_work_pat  ON works(patient_id);
CREATE INDEX IF NOT EXISTS ix_work_date ON works(date);
CREATE INDEX IF NOT EXISTS ix_work_doc  ON works(doctor);

CREATE TABLE IF NOT EXISTS payments (
  id          INTEGER PRIMARY KEY,
  patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,  -- الحساب الذي يُخصم منه
  payer_id    INTEGER REFERENCES patients(id) ON DELETE SET NULL,          -- من دفع
  payer_name  TEXT,
  date        TEXT,
  amount      REAL NOT NULL,        -- بالآلاف
  note        TEXT,
  work_id     INTEGER REFERENCES works(id) ON DELETE CASCADE,   -- دفعة أُدخلت من سطر العمل
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_pay_pat ON payments(patient_id);

CREATE TABLE IF NOT EXISTS links (
  id        INTEGER PRIMARY KEY,
  a_id      INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  b_id      INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  relation  TEXT,                   -- صلة a بالنسبة لـ b (ابن، زوجة…)
  UNIQUE(a_id, b_id)
);

CREATE TABLE IF NOT EXISTS doctors    (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS work_types (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS areas      (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS p_factors  (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);

-- مرشحو التكرار وقرارات المراجعة (بمعرفات أكسس كي تُعاد عند النقل الجديد)
CREATE TABLE IF NOT EXISTS dup_candidates (
  id        INTEGER PRIMARY KEY,
  a_id      INTEGER NOT NULL,
  b_id      INTEGER NOT NULL,
  reason    TEXT,
  status    TEXT NOT NULL DEFAULT 'pending'    -- pending | merged | different
);
CREATE TABLE IF NOT EXISTS decisions (
  legacy_a  TEXT NOT NULL,
  legacy_b  TEXT NOT NULL,
  decision  TEXT NOT NULL,                     -- merge | different
  PRIMARY KEY (legacy_a, legacy_b)
);

CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);

-- مواعيد اليوم (يدخلها السكرتير)
CREATE TABLE IF NOT EXISTS appointments (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,
  time        TEXT,
  patient_id  INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  name        TEXT,
  work        TEXT,
  note        TEXT,
  status      TEXT DEFAULT '',          -- '' | arrived | done | noshow
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_appt_date ON appointments(date);
CREATE TABLE IF NOT EXISTS renames (kind TEXT, old TEXT, new TEXT);

-- المصاريف
CREATE TABLE IF NOT EXISTS expenses (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,
  item        TEXT,                 -- المادة
  office      TEXT,                 -- المكتب
  amount      REAL,                 -- بالآلاف
  doctor      TEXT,                 -- مصدر الدفع: الطبيب
  source      TEXT DEFAULT 'income',-- income = من الدخل | pocket = من جيبه
  note        TEXT,
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_exp_date ON expenses(date);
CREATE TABLE IF NOT EXISTS exp_items   (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS exp_offices (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);

-- الوصفات
CREATE TABLE IF NOT EXISTS rx_drugs     (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);   -- كل سطر دواء استُعمل
CREATE TABLE IF NOT EXISTS rx_notes     (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);   -- التعليمات
CREATE TABLE IF NOT EXISTS rx_templates (id INTEGER PRIMARY KEY, name TEXT NOT NULL, drugs TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS prescriptions (
  id          INTEGER PRIMARY KEY,
  patient_id  INTEGER REFERENCES patients(id) ON DELETE CASCADE,
  date        TEXT,
  doctor      TEXT,
  name        TEXT,
  age         TEXT,
  drugs       TEXT,                 -- سطر لكل دواء
  note        TEXT,
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_rx_pat ON prescriptions(patient_id);

-- المختبرات (أعمال المختبر ومدفوعاتها)
CREATE TABLE IF NOT EXISTS lab_works (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,
  patient     TEXT,                 -- اسم المريض
  patient_id  INTEGER,
  doctor      TEXT,
  teeth       TEXT,
  work_type   TEXT,
  lab         TEXT,                 -- المختبر
  amount      REAL,                 -- بالآلاف
  paid        REAL,                 -- NULL = مسدد بالكامل
  source      TEXT DEFAULT 'income',
  note        TEXT,
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_lab_date ON lab_works(date);
CREATE TABLE IF NOT EXISTS labs (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
