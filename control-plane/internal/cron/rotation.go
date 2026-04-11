package cron

import (
	"database/sql"

	"github.com/rs/zerolog/log"
)

// RotationReminderJob checks api_keys for keys past their rotation threshold
// and creates audit events flagging them as due for rotation. It does NOT
// change key material — actual rotation requires the user to supply a new key
// (or use a provider with a rotation API). The audit action is key.rotation_due,
// not key.rotated, to avoid false compliance records.
type RotationReminderJob struct {
	db *sql.DB
}

func NewRotationReminderJob(db *sql.DB) *RotationReminderJob {
	return &RotationReminderJob{db: db}
}

// Run checks for keys past the 90-day threshold and logs rotation_due events.
func (j *RotationReminderJob) Run() {
	rows, err := j.db.Query(`
		SELECT ak.id, ak.org_id, ak.encrypted_key
		FROM api_keys ak
		WHERE ak.is_active = TRUE
		  AND ak.last_rotated_at < datetime('now', '-90 days')
		ORDER BY ak.org_id, ak.id`)
	if err != nil {
		log.Error().Err(err).Msg("rotation: failed to query keys")
		return
	}
	defer rows.Close()

	type keyRow struct {
		id           string
		orgID        string
		encryptedKey []byte
	}

	var pending []keyRow
	for rows.Next() {
		var kr keyRow
		if err := rows.Scan(&kr.id, &kr.orgID, &kr.encryptedKey); err != nil {
			log.Error().Err(err).Msg("rotation: failed to scan key row")
			continue
		}
		pending = append(pending, kr)
	}
	if err := rows.Err(); err != nil {
		log.Error().Err(err).Msg("rotation: row iteration error")
		return
	}

	if len(pending) == 0 {
		return
	}

	// Batch-insert audit entries for all rotated keys in one transaction.
	tx, err := j.db.Begin()
	if err != nil {
		log.Error().Err(err).Msg("rotation: failed to begin transaction")
		return
	}
	auditStmt, err := tx.Prepare(`
		INSERT INTO audit_log (org_id, action, resource, resource_id, metadata)
		VALUES (?, 'key.rotation_due', 'api_key', ?, '{}')`)
	if err != nil {
		log.Error().Err(err).Msg("rotation: failed to prepare audit stmt")
		_ = tx.Rollback()
		return
	}
	defer auditStmt.Close()

	for _, kr := range pending {
		if _, err := auditStmt.Exec(kr.orgID, kr.id); err != nil {
			log.Error().Err(err).Str("key_id", kr.id).Msg("rotation: failed to insert audit entry")
		}
	}

	if err := tx.Commit(); err != nil {
		log.Error().Err(err).Msg("rotation: failed to commit transaction")
	}
}
