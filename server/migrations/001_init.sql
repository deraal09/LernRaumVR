-- LernRaumVR: Ausgangsschema (siehe docs/PLAN.md, Abschnitt 8)

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ldap_uid      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'user'    CHECK (role IN ('user', 'admin')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'blocked')),
  quota_bytes   INTEGER,                         -- NULL = Standardkontingent
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  data       TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE login_ratelimit (
  schluessel   TEXT PRIMARY KEY,
  fehlversuche INTEGER NOT NULL DEFAULT 0,
  gesperrt_bis INTEGER,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE files (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  original_name   TEXT NOT NULL,
  typ             TEXT NOT NULL DEFAULT 'other' CHECK (typ IN ('video', 'image', 'apk', 'other')),
  mime            TEXT,
  groesse         INTEGER NOT NULL,
  sha256          TEXT,
  status          TEXT NOT NULL DEFAULT 'uploading'
                  CHECK (status IN ('uploading', 'processing', 'ready', 'failed')),
  storage_backend TEXT NOT NULL DEFAULT 'local',
  storage_key     TEXT NOT NULL,
  block_size      INTEGER,
  duplicate_of    TEXT REFERENCES files(id) ON DELETE SET NULL,
  meta            TEXT NOT NULL DEFAULT '{}',     -- JSON: Codec, Auflösung, Paketname ...
  warnungen       TEXT NOT NULL DEFAULT '[]',     -- JSON-Array
  uploaded_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_files_status ON files(status);
CREATE INDEX idx_files_sha256 ON files(sha256);

CREATE TABLE uploads (
  tus_id     TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id    TEXT REFERENCES files(id) ON DELETE CASCADE,
  laenge     INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE devices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  token_hash       TEXT NOT NULL UNIQUE,
  last_seen_at     TEXT,
  freier_speicher  INTEGER,
  app_version      TEXT,
  android_version  TEXT,
  revoked_at       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE device_groups (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE device_group_members (
  group_id  INTEGER NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, device_id)
);

CREATE TABLE policies (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  name                   TEXT NOT NULL UNIQUE,
  kiosk                  INTEGER NOT NULL DEFAULT 0 CHECK (kiosk IN (0, 1)),
  einstellungen_gesperrt INTEGER NOT NULL DEFAULT 0 CHECK (einstellungen_gesperrt IN (0, 1)),
  apps                   TEXT NOT NULL DEFAULT '[]',  -- JSON: Paketname, Titel, Reihenfolge
  version                INTEGER NOT NULL DEFAULT 1,
  updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE device_policy (
  device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  group_id  INTEGER REFERENCES device_groups(id) ON DELETE CASCADE,
  policy_id INTEGER NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  CHECK ((device_id IS NULL) <> (group_id IS NULL))
);
CREATE UNIQUE INDEX idx_device_policy_device ON device_policy(device_id) WHERE device_id IS NOT NULL;
CREATE UNIQUE INDEX idx_device_policy_group  ON device_policy(group_id)  WHERE group_id  IS NOT NULL;

CREATE TABLE pairings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  code             TEXT NOT NULL,
  poll_secret_hash TEXT NOT NULL,
  device_info      TEXT NOT NULL DEFAULT '{}',
  expires_at       TEXT NOT NULL,
  device_id        INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  token_ausgegeben INTEGER NOT NULL DEFAULT 0 CHECK (token_ausgegeben IN (0, 1)),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pairings_code ON pairings(code);

CREATE TABLE transfers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id    TEXT,
  kind        TEXT NOT NULL DEFAULT 'send' CHECK (kind IN ('send', 'install', 'remove', 'play')),
  file_id     TEXT REFERENCES files(id) ON DELETE RESTRICT,
  device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'downloading', 'verified', 'done',
                                'awaiting_confirmation', 'installed', 'failed', 'cancelled')),
  bytes_done  INTEGER NOT NULL DEFAULT 0,
  released_at TEXT,                              -- Download-Slot vergeben
  fehler_code TEXT,
  fehler_text TEXT,
  payload     TEXT NOT NULL DEFAULT '{}',        -- JSON, artspezifisch
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX idx_transfers_device_status ON transfers(device_id, status);
CREATE INDEX idx_transfers_batch ON transfers(batch_id);

CREATE TABLE audit_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  aktion  TEXT NOT NULL,
  ziel    TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  zeit    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_zeit ON audit_log(zeit);
