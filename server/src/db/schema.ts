import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
