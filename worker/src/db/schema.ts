/**
 * Drizzle ORM schema for PrivatePaste D1 SQLite database.
 * Mirrors the SQL migration exactly — keep in sync.
 */
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = sqliteTable('users', {
  id:        text('id').primaryKey(),
  email:     text('email').notNull().unique(),
  name:      text('name'),
  image:     text('image'),
  role:      text('role', { enum: ['registered', 'pro', 'admin'] }).notNull().default('registered'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
})

// ─── Sessions ─────────────────────────────────────────────────────────────────
export const sessions = sqliteTable('sessions', {
  id:         text('id').primaryKey(),
  userId:     text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token:      text('token').notNull().unique(),
  expiresAt:  integer('expires_at').notNull(),
  ipAddress:  text('ip_address'),
  userAgent:  text('user_agent'),
  createdAt:  integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt:  integer('updated_at').notNull().default(sql`(unixepoch())`),
})

// ─── Accounts ─────────────────────────────────────────────────────────────────
export const accounts = sqliteTable('accounts', {
  id:                    text('id').primaryKey(),
  accountId:             text('account_id').notNull(),
  providerId:            text('provider_id').notNull(),
  userId:                text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessToken:           text('access_token'),
  refreshToken:          text('refresh_token'),
  idToken:               text('id_token'),
  accessTokenExpiresAt:  integer('access_token_expires_at'),
  refreshTokenExpiresAt: integer('refresh_token_expires_at'),
  scope:                 text('scope'),
  password:              text('password'),
  createdAt:             integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt:             integer('updated_at').notNull().default(sql`(unixepoch())`),
})

// ─── Verifications ────────────────────────────────────────────────────────────
export const verifications = sqliteTable('verifications', {
  id:         text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value:      text('value').notNull(),
  expiresAt:  integer('expires_at').notNull(),
  createdAt:  integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt:  integer('updated_at').notNull().default(sql`(unixepoch())`),
})

// ─── Folders ──────────────────────────────────────────────────────────────────
export const folders = sqliteTable('folders', {
  id:        text('id').primaryKey(),
  userId:    text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  parentId:  text('parent_id'),  // self-reference handled in SQL
  name:      text('name').notNull(),
  slug:      text('slug').notNull(),
  color:     text('color').default('#6366f1'),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at').notNull().default(sql`(unixepoch())`),
})

// ─── Pastes ───────────────────────────────────────────────────────────────────
export const pastes = sqliteTable('pastes', {
  id:           text('id').primaryKey(),
  userId:       text('user_id').references(() => users.id, { onDelete: 'set null' }),
  folderId:     text('folder_id').references(() => folders.id, { onDelete: 'set null' }),
  title:        text('title').notNull().default('Untitled'),
  content:      text('content').notNull(),
  language:     text('language').notNull().default('plaintext'),
  visibility:   text('visibility', { enum: ['public', 'private', 'password'] }).notNull().default('public'),
  passwordHash: text('password_hash'),
  expiresAt:    integer('expires_at'),
  views:        integer('views').notNull().default(0),
  isArchived:   integer('is_archived', { mode: 'boolean' }).notNull().default(false),
  ipAddress:    text('ip_address'),
  createdAt:    integer('created_at').notNull().default(sql`(unixepoch())`),
  updatedAt:    integer('updated_at').notNull().default(sql`(unixepoch())`),
})

// ─── Inferred Types ───────────────────────────────────────────────────────────
export type User       = typeof users.$inferSelect
export type NewUser    = typeof users.$inferInsert
export type Session    = typeof sessions.$inferSelect
export type Folder     = typeof folders.$inferSelect
export type NewFolder  = typeof folders.$inferInsert
export type Paste      = typeof pastes.$inferSelect
export type NewPaste   = typeof pastes.$inferInsert
export type UserRole   = 'registered' | 'pro' | 'admin'
export type Visibility = 'public' | 'private' | 'password'
