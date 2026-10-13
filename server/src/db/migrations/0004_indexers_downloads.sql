CREATE TABLE indexers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  implementation TEXT NOT NULL CHECK (implementation IN ('newznab', 'torznab')),
  settings TEXT NOT NULL DEFAULT '{}',
  enable_rss INTEGER NOT NULL DEFAULT 1,
  enable_automatic_search INTEGER NOT NULL DEFAULT 1,
  enable_interactive_search INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 25 CHECK (priority BETWEEN 1 AND 50),
  tags TEXT NOT NULL DEFAULT '[]',
  added TEXT NOT NULL
);

CREATE TABLE download_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  implementation TEXT NOT NULL CHECK (implementation IN ('sabnzbd', 'nzbget', 'qbittorrent', 'transmission')),
  protocol TEXT NOT NULL CHECK (protocol IN ('usenet', 'torrent')),
  enable INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 1 CHECK (priority BETWEEN 1 AND 50),
  remove_completed_downloads INTEGER NOT NULL DEFAULT 1,
  remove_failed_downloads INTEGER NOT NULL DEFAULT 1,
  settings TEXT NOT NULL DEFAULT '{}',
  tags TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL REFERENCES series (id) ON DELETE CASCADE,
  episode_id INTEGER REFERENCES episodes (id) ON DELETE CASCADE,
  source_title TEXT NOT NULL,
  quality TEXT NOT NULL,
  date TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('grabbed', 'downloadFolderImported', 'downloadFailed', 'episodeFileDeleted', 'episodeFileRenamed', 'downloadIgnored')),
  download_id TEXT,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX history_series_idx ON history (series_id);
CREATE INDEX history_download_id_idx ON history (download_id);
CREATE INDEX history_date_idx ON history (date);

CREATE TABLE blocklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL REFERENCES series (id) ON DELETE CASCADE,
  episode_ids TEXT NOT NULL DEFAULT '[]',
  source_title TEXT NOT NULL,
  quality TEXT NOT NULL,
  date TEXT NOT NULL,
  published_date TEXT,
  size INTEGER,
  protocol TEXT NOT NULL,
  indexer TEXT,
  message TEXT,
  torrent_info_hash TEXT
);
CREATE INDEX blocklist_series_idx ON blocklist (series_id);

CREATE TABLE scheduled_tasks (
  name TEXT PRIMARY KEY,
  command_name TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL,
  last_execution TEXT,
  last_start_time TEXT,
  next_execution TEXT NOT NULL
);
