CREATE TABLE config (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE root_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL UNIQUE
);

CREATE TABLE quality_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quality INTEGER NOT NULL UNIQUE,
  title TEXT NOT NULL,
  weight INTEGER NOT NULL,
  min_size REAL NOT NULL,
  max_size REAL,
  preferred_size REAL
);

CREATE TABLE quality_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  upgrade_allowed INTEGER NOT NULL,
  cutoff INTEGER NOT NULL,
  items TEXT NOT NULL
);

CREATE TABLE commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  trigger TEXT NOT NULL,
  message TEXT,
  queued_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT
);

CREATE INDEX commands_status_idx ON commands (status);
