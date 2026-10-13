CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  implementation TEXT NOT NULL CHECK (implementation IN ('webhook', 'discord', 'email')),
  on_grab INTEGER NOT NULL DEFAULT 0,
  on_download INTEGER NOT NULL DEFAULT 0,
  on_upgrade INTEGER NOT NULL DEFAULT 0,
  on_rename INTEGER NOT NULL DEFAULT 0,
  on_series_add INTEGER NOT NULL DEFAULT 0,
  on_series_delete INTEGER NOT NULL DEFAULT 0,
  on_episode_file_delete INTEGER NOT NULL DEFAULT 0,
  on_episode_file_delete_for_upgrade INTEGER NOT NULL DEFAULT 0,
  on_health_issue INTEGER NOT NULL DEFAULT 0,
  on_health_restored INTEGER NOT NULL DEFAULT 0,
  include_health_warnings INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',
  settings TEXT NOT NULL DEFAULT '{}'
);
