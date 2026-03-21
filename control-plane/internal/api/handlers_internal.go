package api

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
)

// ResolveKey is called by the edge proxy to look up a decrypted API key by alias.
// It enforces per-org request limits and records usage. All three DB lookups are
// collapsed into a single JOIN to avoid sequential round trips.
func (h *Handlers) ResolveKey(w http.ResponseWriter, r *http.Request) {
	alias := chi.URLParam(r, "alias")
	// X-Org-ID is supplied by the proxy token middleware (design F5).
	orgID := r.Header.Get("X-Org-ID")

	if alias == "" || orgID == "" {
		WriteError(w, http.StatusBadRequest, ErrCodeBadRequest, "missing alias or org")
		return
	}

	var (
		encryptedKey []byte
		reqCount     int64
		reqLimit     int64
	)

	err := h.db.QueryRowContext(r.Context(), `
		SELECT ak.encrypted_key,
		       COALESCE(rc.count, 0),
		       COALESCE(ot.request_limit, 100000)
		FROM api_keys ak
		LEFT JOIN request_counts rc
		       ON rc.org_id = ak.org_id AND rc.month = strftime('%Y-%m','now')
		LEFT JOIN org_tiers ot
		       ON ot.org_id = ak.org_id
		WHERE ak.alias = ? AND ak.org_id = ? AND ak.is_active = TRUE`,
		alias, orgID,
	).Scan(&encryptedKey, &reqCount, &reqLimit)

	if err == sql.ErrNoRows {
		WriteError(w, http.StatusNotFound, ErrCodeNotFound, "key not found")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "resolve failed")
		return
	}

	if reqCount >= reqLimit {
		WriteError(w, http.StatusTooManyRequests, "rate_limited", "request limit exceeded")
		return
	}

	rawKey, err := h.keys.Decrypt(encryptedKey)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "decrypt failed")
		return
	}

	// Increment usage counter — failure is non-fatal but should be logged.
	_, err = h.db.ExecContext(r.Context(), `
		INSERT INTO request_counts (org_id, month, count) VALUES (?, strftime('%Y-%m','now'), 1)
		ON CONFLICT(org_id, month) DO UPDATE SET count = count + 1`,
		orgID,
	)
	if err != nil {
		log.Error().Err(err).Str("org_id", orgID).Msg("failed to increment request count")
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"key": string(rawKey),
	})
}
