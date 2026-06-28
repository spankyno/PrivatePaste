-- Migration: 0001_initial_schema.sql
-- PrivatePaste full database schema

-- Users table (for better-auth compatibility)
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  name        TEXT,
  image       TEXT,
  role        TEXT NOT NULL DEFAULT 'registered', -- 'registered' | 'pro' | 'admin'
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Sessions table (better-auth)
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        TEXT UNIQUE NOT NULL,
  expires_at   INTEGER NOT NULL,
  ip_address   TEXT,
  user_agent   TEXT,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Accounts table (better-auth OAuth providers)
CREATE TABLE IF NOT EXISTS accounts (
  id                    TEXT PRIMARY KEY,
  account_id            TEXT NOT NULL,
  provider_id           TEXT NOT NULL,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token          TEXT,
  refresh_token         TEXT,
  id_token              TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope                 TEXT,
  password              TEXT, -- for email/password auth (bcrypt hash)
  created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(provider_id, account_id)
);

-- Verification table (better-auth email verification)
CREATE TABLE IF NOT EXISTS verifications (
  id         TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Folders / Projects
CREATE TABLE IF NOT EXISTS folders (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES folders(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  color       TEXT DEFAULT '#6366f1',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(user_id, parent_id, slug)
);

-- Main pastes table
CREATE TABLE IF NOT EXISTS pastes (
  id              TEXT PRIMARY KEY,            -- nanoid 8 chars
  user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
  folder_id       TEXT REFERENCES folders(id) ON DELETE SET NULL,
  title           TEXT NOT NULL DEFAULT 'Untitled',
  content         TEXT NOT NULL,
  language        TEXT NOT NULL DEFAULT 'plaintext',
  visibility      TEXT NOT NULL DEFAULT 'public',   -- 'public' | 'private' | 'password'
  password_hash   TEXT,                             -- argon2/bcrypt hash if visibility='password'
  expires_at      INTEGER,                          -- unix timestamp, NULL = never
  views           INTEGER NOT NULL DEFAULT 0,
  is_archived     BOOLEAN NOT NULL DEFAULT 0,       -- pro: archive instead of delete
  ip_address      TEXT,                             -- for anon rate limiting
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_pastes_user_id      ON pastes(user_id);
CREATE INDEX IF NOT EXISTS idx_pastes_folder_id    ON pastes(folder_id);
CREATE INDEX IF NOT EXISTS idx_pastes_expires_at   ON pastes(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pastes_visibility   ON pastes(visibility);
CREATE INDEX IF NOT EXISTS idx_pastes_ip_address   ON pastes(ip_address) WHERE ip_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pastes_created_at   ON pastes(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token      ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_folders_user_id     ON folders(user_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent_id   ON folders(parent_id);

-- FTS for search (title + content)
CREATE VIRTUAL TABLE IF NOT EXISTS pastes_fts USING fts5(
  id UNINDEXED,
  title,
  content,
  content='pastes',
  content_rowid='rowid'
);

-- FTS triggers
CREATE TRIGGER IF NOT EXISTS pastes_fts_insert AFTER INSERT ON pastes BEGIN
  INSERT INTO pastes_fts(rowid, id, title, content) VALUES (new.rowid, new.id, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS pastes_fts_update AFTER UPDATE ON pastes BEGIN
  INSERT INTO pastes_fts(pastes_fts, rowid, id, title, content) VALUES ('delete', old.rowid, old.id, old.title, old.content);
  INSERT INTO pastes_fts(rowid, id, title, content) VALUES (new.rowid, new.id, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS pastes_fts_delete AFTER DELETE ON pastes BEGIN
  INSERT INTO pastes_fts(pastes_fts, rowid, id, title, content) VALUES ('delete', old.rowid, old.id, old.title, old.content);
END;
