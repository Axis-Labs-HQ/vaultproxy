package db

import (
	"database/sql"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

// Driver identifies the active database driver.
type Driver string

const (
	DriverSQLite   Driver = "sqlite"
	DriverPostgres Driver = "postgres"
)

// DB wraps *sql.DB and exposes the active driver so handlers can use
// driver-appropriate SQL when necessary (e.g. date functions).
type DB struct {
	*sql.DB
	Driver Driver
}

// SQL provides driver-specific SQL fragments.
type SQL struct {
	Driver Driver
}

// Now returns the current timestamp expression.
func (s SQL) Now() string {
	if s.Driver == DriverPostgres {
		return "NOW()"
	}
	return "datetime('now')"
}

// CurrentMonth returns an expression that produces 'YYYY-MM' for the current month.
func (s SQL) CurrentMonth() string {
	if s.Driver == DriverPostgres {
		return "TO_CHAR(NOW(), 'YYYY-MM')"
	}
	return "strftime('%Y-%m','now')"
}

// IntervalDaysAgo returns a timestamp expression for N days ago.
func (s SQL) IntervalDaysAgo(days string) string {
	if s.Driver == DriverPostgres {
		return "NOW() - INTERVAL '" + days + " days'"
	}
	return "datetime('now', '-" + days + " days')"
}

// Placeholder returns the parameter placeholder for position n (1-indexed).
// SQLite uses ?, Postgres uses $1, $2, etc.
// For convenience in simple cases, callers can still use ? and call
// RewritePlaceholders on the full query.
func (s SQL) Placeholder(n int) string {
	if s.Driver == DriverPostgres {
		return "$" + strings.Repeat("", 0) // handled by RewritePlaceholders
	}
	return "?"
}

// Open detects the driver from the DSN and opens the appropriate database.
func Open(dsn string) (*DB, error) {
	driver := detectDriver(dsn)

	var sqlDB *sql.DB
	var err error

	switch driver {
	case DriverPostgres:
		sqlDB, err = sql.Open("postgres", dsn)
	default:
		// SQLite with WAL mode, foreign keys enabled
		if !strings.Contains(dsn, "?") {
			dsn += "?_journal_mode=WAL&_busy_timeout=5000&_foreign_keys=ON"
		}
		sqlDB, err = sql.Open("sqlite3", dsn)
	}

	if err != nil {
		return nil, err
	}
	if err := sqlDB.Ping(); err != nil {
		return nil, err
	}

	return &DB{DB: sqlDB, Driver: driver}, nil
}

func detectDriver(dsn string) Driver {
	// OSS version is SQLite-only. For Postgres support, see VaultProxy Cloud.
	return DriverSQLite
}

// Migrate runs schema creation. For SQLite, uses CREATE TABLE IF NOT EXISTS.
// For Postgres, uses the same DDL (Postgres supports IF NOT EXISTS).
func Migrate(d *DB) error {
	s := d.schema()
	if _, err := d.Exec(s); err != nil {
		return err
	}
	// Run additive migrations for columns added after initial schema
	for _, m := range d.migrations() {
		d.Exec(m) // Ignore errors — columns may already exist
	}
	return nil
}

func (d *DB) schema() string {
	if d.Driver == DriverPostgres {
		return schemaPostgres
	}
	return schemaSQLite
}

func (d *DB) migrations() []string {
	if d.Driver == DriverPostgres {
		return migrationsPostgres
	}
	return migrationsSQLite
}

// SQLHelper returns a SQL helper for building driver-specific queries.
func (d *DB) SQLHelper() SQL {
	return SQL{Driver: d.Driver}
}

const schemaSQLite = `
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
	target_url      TEXT,
	is_active       BOOLEAN DEFAULT TRUE,
	last_rotated_at DATETIME,
	created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(org_id, alias)
);

CREATE TABLE IF NOT EXISTS proxy_tokens (
	id                    TEXT PRIMARY KEY,
	org_id                TEXT NOT NULL REFERENCES organizations(id),
	name                  TEXT NOT NULL,
	token_hash            TEXT NOT NULL UNIQUE,
	scopes                TEXT NOT NULL DEFAULT '[]',
	allowed_aliases       TEXT NOT NULL DEFAULT '[]',
	allowed_environments  TEXT NOT NULL DEFAULT '[]',
	expires_at            DATETIME,
	created_at            DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS push_targets (
	id              TEXT PRIMARY KEY,
	org_id          TEXT NOT NULL REFERENCES organizations(id),
	api_key_id      TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
	platform        TEXT NOT NULL,
	encrypted_config BLOB,
	env_var         TEXT NOT NULL,
	mode            TEXT NOT NULL DEFAULT 'fetch',
	last_synced     DATETIME,
	created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
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
CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log(org_id, id);
CREATE INDEX IF NOT EXISTS idx_proxy_tokens_hash ON proxy_tokens(token_hash);

CREATE TABLE IF NOT EXISTS request_counts (
	org_id  TEXT NOT NULL,
	month   TEXT NOT NULL,
	count   INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (org_id, month)
);

CREATE TABLE IF NOT EXISTS org_tiers (
	org_id        TEXT PRIMARY KEY REFERENCES organizations(id),
	tier          TEXT NOT NULL DEFAULT 'free',
	request_limit INTEGER NOT NULL DEFAULT 100000,
	key_limit     INTEGER NOT NULL DEFAULT 5,
	updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

const schemaPostgres = `
CREATE TABLE IF NOT EXISTS organizations (
	id          TEXT PRIMARY KEY,
	name        TEXT NOT NULL,
	slug        TEXT NOT NULL UNIQUE,
	created_at  TIMESTAMPTZ DEFAULT NOW(),
	updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
	id              TEXT PRIMARY KEY,
	org_id          TEXT NOT NULL REFERENCES organizations(id),
	email           TEXT NOT NULL UNIQUE,
	password_hash   TEXT NOT NULL,
	role            TEXT NOT NULL DEFAULT 'member',
	created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
	id              TEXT PRIMARY KEY,
	org_id          TEXT NOT NULL REFERENCES organizations(id),
	name            TEXT NOT NULL,
	provider        TEXT NOT NULL,
	encrypted_key   BYTEA NOT NULL,
	key_prefix      TEXT NOT NULL,
	alias           TEXT NOT NULL,
	target_url      TEXT,
	is_active       BOOLEAN DEFAULT TRUE,
	last_rotated_at TIMESTAMPTZ,
	created_at      TIMESTAMPTZ DEFAULT NOW(),
	updated_at      TIMESTAMPTZ DEFAULT NOW(),
	UNIQUE(org_id, alias)
);

CREATE TABLE IF NOT EXISTS proxy_tokens (
	id                    TEXT PRIMARY KEY,
	org_id                TEXT NOT NULL REFERENCES organizations(id),
	name                  TEXT NOT NULL,
	token_hash            TEXT NOT NULL UNIQUE,
	scopes                TEXT NOT NULL DEFAULT '[]',
	allowed_aliases       TEXT NOT NULL DEFAULT '[]',
	allowed_environments  TEXT NOT NULL DEFAULT '[]',
	expires_at            TIMESTAMPTZ,
	created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS push_targets (
	id              TEXT PRIMARY KEY,
	org_id          TEXT NOT NULL REFERENCES organizations(id),
	api_key_id      TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
	platform        TEXT NOT NULL,
	encrypted_config BYTEA,
	env_var         TEXT NOT NULL,
	mode            TEXT NOT NULL DEFAULT 'fetch',
	last_synced     TIMESTAMPTZ,
	created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
	id          BIGSERIAL PRIMARY KEY,
	org_id      TEXT NOT NULL,
	user_id     TEXT,
	action      TEXT NOT NULL,
	resource    TEXT NOT NULL,
	resource_id TEXT,
	metadata    TEXT DEFAULT '{}',
	ip_address  TEXT,
	created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(org_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_alias ON api_keys(alias);
CREATE INDEX IF NOT EXISTS idx_push_targets_key ON push_targets(api_key_id);
CREATE INDEX IF NOT EXISTS idx_push_targets_org ON push_targets(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_org ON audit_log(org_id, id);
CREATE INDEX IF NOT EXISTS idx_proxy_tokens_hash ON proxy_tokens(token_hash);

CREATE TABLE IF NOT EXISTS request_counts (
	org_id  TEXT NOT NULL,
	month   TEXT NOT NULL,
	count   INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (org_id, month)
);

CREATE TABLE IF NOT EXISTS org_tiers (
	org_id        TEXT PRIMARY KEY REFERENCES organizations(id),
	tier          TEXT NOT NULL DEFAULT 'free',
	request_limit INTEGER NOT NULL DEFAULT 100000,
	key_limit     INTEGER NOT NULL DEFAULT 5,
	updated_at    TIMESTAMPTZ DEFAULT NOW()
);
`

var migrationsSQLite = []string{
	`ALTER TABLE api_keys ADD COLUMN target_url TEXT`,
	`ALTER TABLE proxy_tokens ADD COLUMN allowed_aliases TEXT NOT NULL DEFAULT '[]'`,
	`ALTER TABLE proxy_tokens ADD COLUMN allowed_environments TEXT NOT NULL DEFAULT '[]'`,
	`ALTER TABLE push_targets ADD COLUMN mode TEXT NOT NULL DEFAULT 'fetch'`,
	`ALTER TABLE push_targets ADD COLUMN encrypted_config BLOB`,
}

var migrationsPostgres = []string{
	`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS target_url TEXT`,
	`ALTER TABLE proxy_tokens ADD COLUMN IF NOT EXISTS allowed_aliases TEXT NOT NULL DEFAULT '[]'`,
	`ALTER TABLE proxy_tokens ADD COLUMN IF NOT EXISTS allowed_environments TEXT NOT NULL DEFAULT '[]'`,
	`ALTER TABLE push_targets ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'fetch'`,
	`ALTER TABLE push_targets ADD COLUMN IF NOT EXISTS encrypted_config BYTEA`,
}
