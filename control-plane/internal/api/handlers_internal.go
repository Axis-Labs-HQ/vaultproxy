package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"path"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
)

// checkAliasScope checks if the requested alias is permitted by the token's
// allowed_aliases list. Reads from X-Allowed-Aliases header set by middleware
// (PERF-001: no extra DB query). VULN-002: fails closed on parse errors.
func checkAliasScope(r *http.Request, alias string) (bool, int, string) {
	allowedJSON := r.Header.Get("X-Allowed-Aliases")
	if allowedJSON == "" || allowedJSON == "[]" {
		return true, 0, "" // unrestricted
	}

	var patterns []string
	if err := json.Unmarshal([]byte(allowedJSON), &patterns); err != nil {
		// VULN-002: fail closed on parse error
		return false, http.StatusForbidden, "scope check failed"
	}

	if len(patterns) == 0 {
		return true, 0, "" // unrestricted
	}

	for _, pattern := range patterns {
		if matched, _ := path.Match(pattern, alias); matched {
			return true, 0, ""
		}
		if pattern == alias {
			return true, 0, "" // exact match fallback
		}
	}

	return false, http.StatusForbidden, "token not authorized for this alias"
}

// ResolveKey is called by the edge proxy to look up a decrypted API key by alias.
// Returns key + target_url for auto-resolve. Enforces scope and rate limits.
func (h *Handlers) ResolveKey(w http.ResponseWriter, r *http.Request) {
	alias := chi.URLParam(r, "alias")
	orgID := r.Header.Get("X-Org-ID")

	if alias == "" || orgID == "" {
		WriteError(w, http.StatusBadRequest, ErrCodeBadRequest, "missing alias or org")
		return
	}

	// Scope check (reads from middleware-set header, no DB query)
	if allowed, code, msg := checkAliasScope(r, alias); !allowed {
		WriteError(w, code, ErrCodeUnauthorized, msg)
		return
	}

	var (
		encryptedKey []byte
		targetURL    sql.NullString
	)

	err := h.db.QueryRowContext(r.Context(),
		`SELECT encrypted_key, target_url FROM api_keys WHERE alias = ? AND org_id = ? AND is_active = TRUE`,
		alias, orgID,
	).Scan(&encryptedKey, &targetURL)

	if err == sql.ErrNoRows {
		WriteError(w, http.StatusNotFound, ErrCodeNotFound, "key not found")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "resolve failed")
		return
	}

	// MF-7: Atomic increment-and-check
	var newCount int64
	err = h.db.QueryRowContext(r.Context(), `
		INSERT INTO request_counts (org_id, month, count) VALUES (?, strftime('%Y-%m','now'), 1)
		ON CONFLICT(org_id, month) DO UPDATE SET count = count + 1
		WHERE (SELECT COALESCE(request_limit, 100000) FROM org_tiers WHERE org_id = request_counts.org_id) > request_counts.count
		RETURNING count`,
		orgID,
	).Scan(&newCount)
	if err == sql.ErrNoRows {
		WriteError(w, http.StatusTooManyRequests, "rate_limited", "request limit exceeded")
		return
	}
	if err != nil {
		log.Error().Err(err).Str("org_id", orgID).Msg("failed to increment request count")
	}

	rawKey, err := h.keys.Decrypt(encryptedKey)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "decrypt failed")
		return
	}

	var targetURLPtr *string
	if targetURL.Valid {
		targetURLPtr = &targetURL.String
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"key":        string(rawKey),
		"target_url": targetURLPtr,
	})
}

// FetchKey returns the decrypted key for a given alias with provider metadata.
// Used by CLI and CI/CD for fetch mode.
func (h *Handlers) FetchKey(w http.ResponseWriter, r *http.Request) {
	alias := chi.URLParam(r, "alias")
	orgID := r.Header.Get("X-Org-ID")

	if alias == "" || orgID == "" {
		WriteError(w, http.StatusBadRequest, ErrCodeBadRequest, "missing alias or org")
		return
	}

	// Scope check
	if allowed, code, msg := checkAliasScope(r, alias); !allowed {
		WriteError(w, code, ErrCodeUnauthorized, msg)
		return
	}

	var (
		encryptedKey []byte
		provider     string
		targetURL    sql.NullString
	)

	err := h.db.QueryRowContext(r.Context(),
		`SELECT encrypted_key, provider, target_url FROM api_keys WHERE alias = ? AND org_id = ? AND is_active = TRUE`,
		alias, orgID,
	).Scan(&encryptedKey, &provider, &targetURL)

	if err == sql.ErrNoRows {
		WriteError(w, http.StatusNotFound, ErrCodeNotFound, "key not found")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "fetch failed")
		return
	}

	// Atomic increment-and-check (same as ResolveKey)
	var newCount int64
	err = h.db.QueryRowContext(r.Context(), `
		INSERT INTO request_counts (org_id, month, count) VALUES (?, strftime('%Y-%m','now'), 1)
		ON CONFLICT(org_id, month) DO UPDATE SET count = count + 1
		WHERE (SELECT COALESCE(request_limit, 100000) FROM org_tiers WHERE org_id = request_counts.org_id) > request_counts.count
		RETURNING count`,
		orgID,
	).Scan(&newCount)
	if err == sql.ErrNoRows {
		WriteError(w, http.StatusTooManyRequests, "rate_limited", "request limit exceeded")
		return
	}
	if err != nil {
		log.Error().Err(err).Str("org_id", orgID).Msg("failed to increment request count")
	}

	rawKey, err := h.keys.Decrypt(encryptedKey)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "decrypt failed")
		return
	}

	var targetURLPtr *string
	if targetURL.Valid {
		targetURLPtr = &targetURL.String
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"key":              string(rawKey),
		"alias":            alias,
		"provider":         provider,
		"target_url":       targetURLPtr,
		"proxy_compatible": lookupProxyCompat(provider),
	})
}

// ResolveByHost resolves a credential by matching the target hostname against
// stored target_url values. Used by the Rust HTTPS proxy — the proxy intercepts
// a CONNECT request for e.g. "api.openai.com" and needs to find the matching key.
// Returns 404 if no key has a target_url matching this host (proxy passes through).
func (h *Handlers) ResolveByHost(w http.ResponseWriter, r *http.Request) {
	hostname := chi.URLParam(r, "hostname")
	orgID := r.Header.Get("X-Org-ID")

	if hostname == "" || orgID == "" {
		WriteError(w, http.StatusBadRequest, ErrCodeBadRequest, "missing hostname or org")
		return
	}

	// Match hostname against stored target_urls. We check if the target_url
	// contains the hostname (e.g., "https://api.openai.com" contains "api.openai.com").
	var (
		encryptedKey []byte
		targetURL    sql.NullString
	)

	err := h.db.QueryRowContext(r.Context(),
		`SELECT encrypted_key, target_url FROM api_keys
		 WHERE org_id = ? AND is_active = TRUE AND target_url LIKE '%' || ? || '%'
		 ORDER BY created_at DESC LIMIT 1`,
		orgID, hostname,
	).Scan(&encryptedKey, &targetURL)

	if err == sql.ErrNoRows {
		WriteError(w, http.StatusNotFound, ErrCodeNotFound, "no key configured for this host")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "resolve failed")
		return
	}

	rawKey, err := h.keys.Decrypt(encryptedKey)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "decrypt failed")
		return
	}

	var targetURLPtr *string
	if targetURL.Valid {
		targetURLPtr = &targetURL.String
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"key":        string(rawKey),
		"target_url": targetURLPtr,
	})
}

// lookupProxyCompat checks the provider registry for proxy compatibility.
// Unknown providers default to true (compatible).
func lookupProxyCompat(provider string) bool {
	for _, p := range providerRegistry {
		if strings.EqualFold(p.ID, provider) {
			return p.ProxyCompat
		}
	}
	return true
}
