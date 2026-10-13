CREATE TABLE series (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tvdb_id INTEGER,
  tvmaze_id INTEGER NOT NULL,
  imdb_id TEXT,
  title TEXT NOT NULL,
  sort_title TEXT NOT NULL,
  clean_title TEXT NOT NULL,
  title_slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'continuing',
  overview TEXT NOT NULL DEFAULT '',
  network TEXT,
  air_time TEXT,
  runtime INTEGER NOT NULL DEFAULT 0,
  year INTEGER NOT NULL DEFAULT 0,
  first_aired TEXT,
  genres TEXT NOT NULL DEFAULT '[]',
  images TEXT NOT NULL DEFAULT '[]',
  ratings TEXT NOT NULL DEFAULT '{"votes":0,"value":0}',
  certification TEXT,
  series_type TEXT NOT NULL DEFAULT 'standard',
  path TEXT NOT NULL,
  root_folder_path TEXT NOT NULL,
  quality_profile_id INTEGER NOT NULL REFERENCES quality_profiles (id) ON DELETE RESTRICT,
  season_folder INTEGER NOT NULL DEFAULT 1,
  monitored INTEGER NOT NULL DEFAULT 1,
  monitor_new_items TEXT NOT NULL DEFAULT 'all',
  tags TEXT NOT NULL DEFAULT '[]',
  add_options TEXT,
  added TEXT NOT NULL,
  last_info_sync TEXT
);

CREATE UNIQUE INDEX series_tvmaze_id_idx ON series (tvmaze_id);
CREATE UNIQUE INDEX series_tvdb_id_idx ON series (tvdb_id) WHERE tvdb_id IS NOT NULL;
CREATE UNIQUE INDEX series_path_idx ON series (path);
CREATE UNIQUE INDEX series_title_slug_idx ON series (title_slug);

CREATE TABLE seasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL REFERENCES series (id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  monitored INTEGER NOT NULL DEFAULT 1,
  UNIQUE (series_id, season_number)
);

CREATE TABLE episode_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL REFERENCES series (id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  relative_path TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL DEFAULT 0,
  date_added TEXT NOT NULL,
  quality TEXT NOT NULL,
  release_group TEXT
);

CREATE INDEX episode_files_series_idx ON episode_files (series_id);

CREATE TABLE episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id INTEGER NOT NULL REFERENCES series (id) ON DELETE CASCADE,
  tvmaze_id INTEGER NOT NULL DEFAULT 0,
  season_number INTEGER NOT NULL,
  episode_number INTEGER NOT NULL,
  absolute_episode_number INTEGER,
  title TEXT NOT NULL DEFAULT '',
  overview TEXT NOT NULL DEFAULT '',
  air_date TEXT,
  air_date_utc TEXT,
  runtime INTEGER NOT NULL DEFAULT 0,
  monitored INTEGER NOT NULL DEFAULT 1,
  episode_file_id INTEGER REFERENCES episode_files (id) ON DELETE SET NULL,
  UNIQUE (series_id, season_number, episode_number)
);

CREATE INDEX episodes_series_season_idx ON episodes (series_id, season_number);
CREATE INDEX episodes_file_idx ON episodes (episode_file_id);
