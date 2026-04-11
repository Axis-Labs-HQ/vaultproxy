package cron

import (
	"database/sql"

	"github.com/rs/zerolog/log"
)

// CleanupJob removes expired audit log entries for all orgs in a single query,
// respecting each org's configured retention period from org_tiers.
type CleanupJob struct {
	db *sql.DB
}

func NewCleanupJob(db *sql.DB) *CleanupJob {
	return &CleanupJob{db: db}
}

// Run deletes all audit log rows older than the org's configured retention period.
// A single subquery replaces the previous per-org DELETE loop, eliminating N+1.
func (j *CleanupJob) Run() {
	res, err := j.db.Exec(`
		DELETE FROM audit_log WHERE id IN (
			SELECT al.id FROM audit_log al
			JOIN org_tiers ot ON ot.org_id = al.org_id
			WHERE al.created_at < datetime('now', '-' || ot.audit_retention_days || ' days')
		)`)
	if err != nil {
		log.Error().Err(err).Msg("cleanup: failed to delete expired audit log entries")
		return
	}
	n, err := res.RowsAffected()
	if err != nil {
		log.Error().Err(err).Msg("cleanup: failed to get rows affected")
		return
	}
	if n > 0 {
		log.Info().Int64("deleted", n).Msg("cleanup: removed expired audit log entries")
	}
}
