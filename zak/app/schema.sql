PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------ patients
CREATE TABLE IF NOT EXISTS patients (
  id           INTEGER PRIMARY KEY,
  legacy_id    TEXT,                -- row number in the Echo export
  name         TEXT NOT NULL,       -- Arabic
  name_norm    TEXT NOT NULL,
  gender       TEXT,                -- M | F
  birth_year   INTEGER,             -- from the age when DOB unknown
  dob          TEXT,                -- YYYY-MM-DD (optional)
  phone        TEXT,
  phone_norm   TEXT,
  address      TEXT,                -- Arabic
  occupation   TEXT,
  marital      TEXT,
  smoking      TEXT,                -- never | current | ex
  alcohol      TEXT,
  chronic      TEXT,                -- one per line (English)
  allergies    TEXT,                -- one per line
  long_meds    TEXT,                -- regular medications, one per line
  past_history TEXT,                -- surgeries / admissions / family history
  personal_note TEXT,               -- Arabic, private
  height       REAL,                -- last known height (cm)
  created_by   TEXT,
  created_at   TEXT DEFAULT (datetime('now','localtime')),
  updated_at   TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_pat_name  ON patients(name_norm);
CREATE INDEX IF NOT EXISTS ix_pat_phone ON patients(phone_norm);

-- ------------------------------------------------------------ visits (SOAP)
CREATE TABLE IF NOT EXISTS visits (
  id          INTEGER PRIMARY KEY,
  patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  legacy_id   TEXT,                 -- prescription id in Echo
  date        TEXT NOT NULL,        -- YYYY-MM-DD
  complaint   TEXT,                 -- S: chief complaint + HPI
  exam        TEXT,                 -- O: examination findings
  diagnosis   TEXT,                 -- A: one per line
  plan        TEXT,                 -- P
  notes       TEXT,                 -- free notes (imported Echo notes land here)
  bp_sys INTEGER, bp_dia INTEGER, hr INTEGER, rr INTEGER, temp REAL, spo2 INTEGER,
  weight REAL, height REAL, rbs REAL,
  follow_up   TEXT,                 -- YYYY-MM-DD
  price       REAL,                 -- IQD
  legacy      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now','localtime')),
  updated_at  TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_visit_pat  ON visits(patient_id, date);
CREATE INDEX IF NOT EXISTS ix_visit_date ON visits(date);

CREATE TABLE IF NOT EXISTS visit_meds (
  id        INTEGER PRIMARY KEY,
  visit_id  INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  seq       INTEGER,
  line      TEXT NOT NULL           -- drug + dose + instructions, as printed
);
CREATE INDEX IF NOT EXISTS ix_vm_visit ON visit_meds(visit_id);

-- ------------------------------------------------------------ labs
CREATE TABLE IF NOT EXISTS lab_tests (
  code      TEXT PRIMARY KEY,       -- HBA1C, LDL …
  name      TEXT NOT NULL,
  unit      TEXT,
  low       REAL,                   -- normal range (NULL = no limit)
  high      REAL,
  target    REAL,                   -- treatment target line on the chart
  grp       TEXT,                   -- Diabetes, Lipids, Renal …
  seq       INTEGER
);
CREATE TABLE IF NOT EXISTS labs (
  id         INTEGER PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id   INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  date       TEXT NOT NULL,         -- date of the test
  code       TEXT NOT NULL,
  value      REAL,
  text       TEXT,                  -- non-numeric result (positive, normal …)
  source     TEXT DEFAULT 'manual', -- manual | imported (from old notes) | ocr
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_labs_pat ON labs(patient_id, code, date);

-- ------------------------------------------------------------ lists
CREATE TABLE IF NOT EXISTS drugs      (id INTEGER PRIMARY KEY, line TEXT UNIQUE NOT NULL, uses INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS diagnoses  (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, uses INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS rx_templates (id INTEGER PRIMARY KEY, name TEXT NOT NULL, lines TEXT, diagnosis TEXT, plan TEXT);

-- ------------------------------------------------------------ appointments / waiting list
CREATE TABLE IF NOT EXISTS appointments (
  id          INTEGER PRIMARY KEY,
  date        TEXT NOT NULL,
  time        TEXT,
  seq         INTEGER,              -- order in the waiting list
  patient_id  INTEGER REFERENCES patients(id) ON DELETE SET NULL,
  name        TEXT,
  phone       TEXT,
  age         TEXT,
  note        TEXT,
  status      TEXT DEFAULT '',      -- '' booked | waiting | in | done | noshow
  created_by  TEXT,
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_appt_date ON appointments(date);

-- ------------------------------------------------------------ users / settings
CREATE TABLE IF NOT EXISTS users (
  id      INTEGER PRIMARY KEY,
  name    TEXT UNIQUE NOT NULL,
  role    TEXT NOT NULL,            -- doctor | secretary
  pin     TEXT,                     -- sha256(salt+pin)
  active  INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER, created INTEGER);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);

-- ------------------------------------------------------------ saved lists (occupation, area/address, requested investigations)
CREATE TABLE IF NOT EXISTS vocab (kind TEXT NOT NULL, name TEXT NOT NULL, uses INTEGER DEFAULT 0, PRIMARY KEY (kind, name));

-- ------------------------------------------------------------ attached investigation files (image / PDF), stored in data/files/<patient>/
CREATE TABLE IF NOT EXISTS files (
  id          INTEGER PRIMARY KEY,
  patient_id  INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  visit_id    INTEGER REFERENCES visits(id) ON DELETE SET NULL,
  date        TEXT NOT NULL,          -- date of the investigation
  name        TEXT,                   -- original file name
  title       TEXT,                   -- what it is (CBC, echo report …)
  mime        TEXT,
  path        TEXT NOT NULL,          -- relative to the data folder
  size        INTEGER,
  created_by  TEXT,
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_files_pat ON files(patient_id, date);
