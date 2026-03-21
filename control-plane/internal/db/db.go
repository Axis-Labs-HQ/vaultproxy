package db

import (
	"database/sql"

	_ "github.com/mattn/go-sqlite3"
)

func Open(dsn string) (*sql.DB, error) {
	db, err := sql.Open("sqlite3", dsn+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		return nil, err
	}
	return db, nil
}

func Migrate(db *sql.DB) error {
	_, err := db.Exec(schema)
	return err
}

const schema = `
CREATE TABLE IF NOT EXISTS organizations (
	id          TEXT PRIMARY KEY,
	name        TEXT NOT NULL,
	slug        TEXT NOT NULL UNIQUE,
	created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
	id              TEXT PRIMARY KEY,
	org_id          TEXT NOT NULL REFERENCES organizations(id),
	email           TEXT NOT NULL UNIQUE,
	password_hash   TEXT NOT NULL,
	role            TEXT NOT NULL DEFAULT 'member',
	created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_keys (
	id              TEXT PRIMARY KEY,
	org_id          TEXT NOT NULL REFERENCES organizations(id),
	name            TEXT NOT NULL,
	provider        TEXT NOT NULL,
	encrypted_key   BLOB NOT NULL,
	key_prefix      TEXT NOT NULL,
	alias           TEXT NOT NULL,
	is_active       BOOLEAN DEFAULT TRUE,
	last_rotated_at DATETIME,
	created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(org_id, alias)
);

CREATE TABLE IF NOT EXISTS proxy_tokens (
	id          TEXT PRIMARY KEY,
	org_id      TEXT NOT NULL REFERENCES organizations(id),
	name        TEXT NOT NULL,
	token_hash  TEXT NOT NULL UNIQUE,
	scopes      TEXT NOT NULL DEFAULT '[]',
	expires_at  DATETIME,
	created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS push_targets (
	id          TEXT PRIMARY KEY,
	org_id      TEXT NOT NULL REFERENCES organizations(id),
	api_key_id  TEXT NOT NULL REFERENCES api_keys(id),
	platform    TEXT NOT NULL,
	config      TEXT NOT NULL DEFAULT '{}',
	env_var     TEXT NOT NULL,
	last_synced DATETIME,
	created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
	id          INTEGER PRIMARY KEY AUTOINCREMENT,
	org_id      TEXT NOT NULL,
	user_id     TEXT,
	action      TEXT NOT NULL,
	resource    TEXT NOT NULL,
	resource_id TEXT,
	metadata    TEXT DEFAULT '{}',
	ip_address  TEXT,
	created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(org_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_alias ON api_keys(alias);
CREATE INDEX IF NOT EXISTS idx_push_targets_key ON push_targets(api_key_id);
CREATE INDEX IF NOT EXISTS idx_push_targets_org ON push_targets(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log(org_id, created_at);
`
