import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const config = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const rootFolders = sqliteTable('root_folders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  path: text('path').notNull().unique(),
});

export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  label: text('label').notNull().unique(),
});

export const qualityDefinitions = sqliteTable('quality_definitions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  quality: integer('quality').notNull().unique(),
  title: text('title').notNull(),
  weight: integer('weight').notNull(),
  minSize: real('min_size').notNull(),
  maxSize: real('max_size'),
  preferredSize: real('preferred_size'),
});

export const qualityProfiles = sqliteTable('quality_profiles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  upgradeAllowed: integer('upgrade_allowed', { mode: 'boolean' }).notNull(),
  cutoff: integer('cutoff').notNull(),
  items: text('items').notNull(),
});

export const commands = sqliteTable(
  'commands',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull(),
    priority: text('priority').notNull().default('normal'),
    trigger: text('trigger').notNull(),
    message: text('message'),
    queuedAt: text('queued_at').notNull(),
    startedAt: text('started_at'),
    endedAt: text('ended_at'),
  },
  (t) => [index('commands_status_idx').on(t.status)],
);

/** Login sessions. Only the sha256 of the cookie token is stored; times are epoch milliseconds. */
export const sessions = sqliteTable(
  'sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (t) => [index('sessions_expires_at_idx').on(t.expiresAt)],
);

export const series = sqliteTable(
  'series',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tvdbId: integer('tvdb_id'),
    tvmazeId: integer('tvmaze_id').notNull(),
    imdbId: text('imdb_id'),
    title: text('title').notNull(),
    sortTitle: text('sort_title').notNull(),
    cleanTitle: text('clean_title').notNull(),
    titleSlug: text('title_slug').notNull(),
    status: text('status').notNull().default('continuing'),
    overview: text('overview').notNull().default(''),
    network: text('network'),
    airTime: text('air_time'),
    runtime: integer('runtime').notNull().default(0),
    year: integer('year').notNull().default(0),
    firstAired: text('first_aired'),
    genres: text('genres').notNull().default('[]'),
    images: text('images').notNull().default('[]'),
    ratings: text('ratings').notNull().default('{"votes":0,"value":0}'),
    certification: text('certification'),
    seriesType: text('series_type').notNull().default('standard'),
    path: text('path').notNull(),
    rootFolderPath: text('root_folder_path').notNull(),
    qualityProfileId: integer('quality_profile_id')
      .notNull()
      .references(() => qualityProfiles.id, { onDelete: 'restrict' }),
    seasonFolder: integer('season_folder', { mode: 'boolean' }).notNull().default(true),
    monitored: integer('monitored', { mode: 'boolean' }).notNull().default(true),
    monitorNewItems: text('monitor_new_items').notNull().default('all'),
    tags: text('tags').notNull().default('[]'),
    addOptions: text('add_options'),
    added: text('added').notNull(),
    lastInfoSync: text('last_info_sync'),
  },
  (t) => [
    uniqueIndex('series_tvmaze_id_idx').on(t.tvmazeId),
    uniqueIndex('series_tvdb_id_idx').on(t.tvdbId).where(sql`${t.tvdbId} IS NOT NULL`),
    uniqueIndex('series_path_idx').on(t.path),
    uniqueIndex('series_title_slug_idx').on(t.titleSlug),
  ],
);

export const seasons = sqliteTable(
  'seasons',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seriesId: integer('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    monitored: integer('monitored', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [unique('seasons_series_season_unique').on(t.seriesId, t.seasonNumber)],
);

export const episodeFiles = sqliteTable(
  'episode_files',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seriesId: integer('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    relativePath: text('relative_path').notNull(),
    path: text('path').notNull().unique(),
    size: integer('size').notNull().default(0),
    dateAdded: text('date_added').notNull(),
    quality: text('quality').notNull(),
    releaseGroup: text('release_group'),
  },
  (t) => [index('episode_files_series_idx').on(t.seriesId)],
);

export const episodes = sqliteTable(
  'episodes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    seriesId: integer('series_id')
      .notNull()
      .references(() => series.id, { onDelete: 'cascade' }),
    tvmazeId: integer('tvmaze_id').notNull().default(0),
    seasonNumber: integer('season_number').notNull(),
    episodeNumber: integer('episode_number').notNull(),
    absoluteEpisodeNumber: integer('absolute_episode_number'),
    title: text('title').notNull().default(''),
    overview: text('overview').notNull().default(''),
    airDate: text('air_date'),
    airDateUtc: text('air_date_utc'),
    runtime: integer('runtime').notNull().default(0),
    monitored: integer('monitored', { mode: 'boolean' }).notNull().default(true),
    episodeFileId: integer('episode_file_id').references(() => episodeFiles.id, { onDelete: 'set null' }),
  },
  (t) => [
    unique('episodes_series_season_episode_unique').on(t.seriesId, t.seasonNumber, t.episodeNumber),
    index('episodes_series_season_idx').on(t.seriesId, t.seasonNumber),
    index('episodes_file_idx').on(t.episodeFileId),
  ],
);
