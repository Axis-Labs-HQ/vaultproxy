package api

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/davekim917/vaultproxy/control-plane/internal/config"
	"github.com/davekim917/vaultproxy/control-plane/internal/keys"
	"github.com/davekim917/vaultproxy/control-plane/internal/push"
	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
)

type Handlers struct {
	db   *sql.DB
	keys *keys.Service
	push *push.Registry
	cfg  *config.Config
}

func (h *Handlers) Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"service": "vaultproxy-control-plane",
	})
}

// orgIDFromContext returns the org ID from the request. For authenticated routes
// it comes from the JWT claims; for proxy token routes it comes from X-Org-ID.
func orgIDFromContext(r *http.Request) string {
	if id := r.Header.Get("X-Org-ID"); id != "" {
		return id
	}
	return ""
}

// userIDFromContext returns the user ID from JWT claims stored in request context.
func userIDFromContext(r *http.Request) string {
	if id := r.Header.Get("X-User-ID"); id != "" {
		return id
	}
	return ""
}

// ------------------------------------------------------------------
// Auth
// ------------------------------------------------------------------

func (h *Handlers) Register(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotImplemented, "not_implemented", "not implemented")
}

func (h *Handlers) Login(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotImplemented, "not_implemented", "not implemented")
}

// ------------------------------------------------------------------
// Keys
// ------------------------------------------------------------------

func (h *Handlers) ListKeys(w http.ResponseWriter, r *http.Request) {
	orgID := orgIDFromContext(r)
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, ErrCodeUnauthorized, "missing org context")
		return
	}

	rows, err := h.db.QueryContext(r.Context(),
		`SELECT id, org_id, name, provider, key_prefix, alias, is_active, last_rotated_at, created_at
		 FROM api_keys WHERE org_id = ? ORDER BY created_at DESC`, orgID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to list keys")
		return
	}
	defer rows.Close()

	var result []keys.APIKey
	for rows.Next() {
		var k keys.APIKey
		if err := rows.Scan(&k.ID, &k.OrgID, &k.Name, &k.Provider, &k.KeyPrefix, &k.Alias,
			&k.IsActive, &k.LastRotated, &k.CreatedAt); err != nil {
			WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to scan keys")
			return
		}
		result = append(result, k)
	}
	if err := rows.Err(); err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "row error")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

type createKeyRequest struct {
	Name     string `json:"name"`
	Provider string `json:"provider"`
	RawKey   string `json:"key"`
	Alias    string `json:"alias"`
}

func (h *Handlers) CreateKey(w http.ResponseWriter, r *http.Request) {
	orgID := orgIDFromContext(r)
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, ErrCodeUnauthorized, "missing org context")
		return
	}

	var req createKeyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, ErrCodeBadRequest, "invalid request body")
		return
	}

	if !aliasRegexp.MatchString(req.Alias) {
		WriteError(w, http.StatusBadRequest, ErrCodeBadRequest, "invalid alias format")
		return
	}

	apiKey, err := h.keys.Store(orgID, req.Name, req.Provider, req.RawKey, req.Alias)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to store key")
		return
	}

	// Audit log — failure is non-fatal.
	if _, aerr := h.db.ExecContext(r.Context(),
		`INSERT INTO audit_log (org_id, user_id, action, resource, resource_id, ip_address)
		 VALUES (?, ?, 'key.create', 'api_key', ?, ?)`,
		orgID, userIDFromContext(r), apiKey.ID, r.RemoteAddr,
	); aerr != nil {
		log.Error().Err(aerr).Msg("audit log insert failed")
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(apiKey)
}

func (h *Handlers) GetKey(w http.ResponseWriter, r *http.Request) {
	orgID := orgIDFromContext(r)
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, ErrCodeUnauthorized, "missing org context")
		return
	}
	keyID := chi.URLParam(r, "keyID")

	var k keys.APIKey
	err := h.db.QueryRowContext(r.Context(),
		`SELECT id, org_id, name, provider, key_prefix, alias, is_active, last_rotated_at, created_at
		 FROM api_keys WHERE id = ? AND org_id = ?`, keyID, orgID,
	).Scan(&k.ID, &k.OrgID, &k.Name, &k.Provider, &k.KeyPrefix, &k.Alias,
		&k.IsActive, &k.LastRotated, &k.CreatedAt)
	if err == sql.ErrNoRows {
		WriteError(w, http.StatusNotFound, ErrCodeNotFound, "key not found")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to fetch key")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(k)
}

func (h *Handlers) UpdateKey(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotImplemented, "not_implemented", "not implemented")
}

func (h *Handlers) DeleteKey(w http.ResponseWriter, r *http.Request) {
	orgID := orgIDFromContext(r)
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, ErrCodeUnauthorized, "missing org context")
		return
	}
	keyID := chi.URLParam(r, "keyID")

	res, err := h.db.ExecContext(r.Context(),
		`DELETE FROM api_keys WHERE id = ? AND org_id = ?`, keyID, orgID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to delete key")
		return
	}
	n, err := res.RowsAffected()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to confirm deletion")
		return
	}
	if n == 0 {
		WriteError(w, http.StatusNotFound, ErrCodeNotFound, "key not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) RotateKey(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotImplemented, "not_implemented", "not implemented")
}

func (h *Handlers) DeactivateKey(w http.ResponseWriter, r *http.Request) {
	orgID := orgIDFromContext(r)
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, ErrCodeUnauthorized, "missing org context")
		return
	}
	keyID := chi.URLParam(r, "keyID")

	res, err := h.db.ExecContext(r.Context(),
		`UPDATE api_keys SET is_active = FALSE, updated_at = datetime('now')
		 WHERE id = ? AND org_id = ?`, keyID, orgID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to deactivate key")
		return
	}
	n, err := res.RowsAffected()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to confirm deactivation")
		return
	}
	if n == 0 {
		WriteError(w, http.StatusNotFound, ErrCodeNotFound, "key not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// ------------------------------------------------------------------
// Tokens
// ------------------------------------------------------------------

func (h *Handlers) ListTokens(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotImplemented, "not_implemented", "not implemented")
}

type createTokenRequest struct {
	Name    string   `json:"name"`
	Scopes  []string `json:"scopes"`
	Expires *string  `json:"expires_at,omitempty"`
}

func (h *Handlers) CreateToken(w http.ResponseWriter, r *http.Request) {
	orgID := orgIDFromContext(r)
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, ErrCodeUnauthorized, "missing org context")
		return
	}

	var req createTokenRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, ErrCodeBadRequest, "invalid request body")
		return
	}

	rawToken := make([]byte, 32)
	if _, err := rand.Read(rawToken); err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to generate token")
		return
	}
	tokenStr := hex.EncodeToString(rawToken)
	hashed := sha256.Sum256([]byte(tokenStr))
	tokenHash := hex.EncodeToString(hashed[:])

	idBytes := make([]byte, 16)
	if _, err := rand.Read(idBytes); err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to generate id")
		return
	}
	id := hex.EncodeToString(idBytes)

	scopesJSON, _ := json.Marshal(req.Scopes)

	_, err := h.db.ExecContext(r.Context(),
		`INSERT INTO proxy_tokens (id, org_id, name, token_hash, scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
		id, orgID, req.Name, tokenHash, string(scopesJSON), req.Expires,
	)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to store token")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{
		"id":    id,
		"token": tokenStr,
	})
}

func (h *Handlers) DeleteToken(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotImplemented, "not_implemented", "not implemented")
}

// ------------------------------------------------------------------
// Push targets
// ------------------------------------------------------------------

// ListPushTargets returns push targets for the org, redacting sensitive config fields.
func (h *Handlers) ListPushTargets(w http.ResponseWriter, r *http.Request) {
	orgID := orgIDFromContext(r)
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, ErrCodeUnauthorized, "missing org context")
		return
	}

	rows, err := h.db.QueryContext(r.Context(),
		`SELECT pt.id, pt.platform, pt.config, pt.env_var, pt.last_synced, ak.alias
		 FROM push_targets pt
		 JOIN api_keys ak ON ak.id = pt.api_key_id
		 WHERE pt.org_id = ?`, orgID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to list push targets")
		return
	}
	defer rows.Close()

	type pushTargetResponse struct {
		ID         string            `json:"id"`
		Platform   string            `json:"platform"`
		Config     map[string]string `json:"config"`
		EnvVar     string            `json:"env_var"`
		LastSynced *string           `json:"last_synced,omitempty"`
		Alias      string            `json:"alias"`
	}

	var result []pushTargetResponse
	for rows.Next() {
		var pt pushTargetResponse
		var configJSON string
		var lastSynced sql.NullString
		if err := rows.Scan(&pt.ID, &pt.Platform, &configJSON, &pt.EnvVar, &lastSynced, &pt.Alias); err != nil {
			WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to scan push targets")
			return
		}
		if lastSynced.Valid {
			pt.LastSynced = &lastSynced.String
		}

		if err := json.Unmarshal([]byte(configJSON), &pt.Config); err != nil {
			pt.Config = map[string]string{}
		}

		// Redact sensitive fields — any key containing "key", "token", or "secret".
		for k, v := range pt.Config {
			lower := strings.ToLower(k)
			if strings.Contains(lower, "key") || strings.Contains(lower, "token") || strings.Contains(lower, "secret") {
				if len(v) > 4 {
					pt.Config[k] = "****" + v[len(v)-4:]
				} else {
					pt.Config[k] = "****"
				}
			}
		}

		result = append(result, pt)
	}
	if err := rows.Err(); err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "row error")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func (h *Handlers) CreatePushTarget(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotImplemented, "not_implemented", "not implemented")
}

// SyncPushTarget pushes the decrypted API key to a platform env var, fetching
// all needed data in a single JOIN query to avoid double api_keys lookups.
func (h *Handlers) SyncPushTarget(w http.ResponseWriter, r *http.Request) {
	orgID := orgIDFromContext(r)
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, ErrCodeUnauthorized, "missing org context")
		return
	}
	targetID := chi.URLParam(r, "targetID")

	var platform, configJSON, envVar string
	var encryptedKey []byte
	err := h.db.QueryRowContext(r.Context(),
		`SELECT pt.platform, pt.config, pt.env_var, ak.encrypted_key
		 FROM push_targets pt
		 JOIN api_keys ak ON ak.id = pt.api_key_id
		 WHERE pt.id = ? AND pt.org_id = ? AND ak.is_active = TRUE
		 LIMIT 1`,
		targetID, orgID,
	).Scan(&platform, &configJSON, &envVar, &encryptedKey)
	if err == sql.ErrNoRows {
		WriteError(w, http.StatusNotFound, ErrCodeNotFound, "push target not found")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to fetch push target")
		return
	}

	rawKey, err := h.keys.Decrypt(encryptedKey)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to decrypt key")
		return
	}

	var config map[string]string
	if err := json.Unmarshal([]byte(configJSON), &config); err != nil {
		config = map[string]string{}
	}

	p, err := h.push.Get(platform)
	if err != nil {
		WriteError(w, http.StatusBadRequest, ErrCodeBadRequest, "unknown platform")
		return
	}

	target := &push.Target{
		ID:       targetID,
		Platform: platform,
		Config:   config,
		EnvVar:   envVar,
	}
	if err := p.Push(r.Context(), target, envVar, string(rawKey)); err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "push failed")
		return
	}

	_, err = h.db.ExecContext(r.Context(),
		`UPDATE push_targets SET last_synced = datetime('now') WHERE id = ?`, targetID)
	if err != nil {
		log.Error().Err(err).Msg("failed to update last_synced")
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) DeletePushTarget(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotImplemented, "not_implemented", "not implemented")
}

// ------------------------------------------------------------------
// Audit log
// ------------------------------------------------------------------

// ListAuditLog returns audit log entries with cursor-based pagination (DESC order).
// The cursor is the ID of the last item returned in the previous page; the query
// uses WHERE id < ? so that the next page starts strictly after that item.
func (h *Handlers) ListAuditLog(w http.ResponseWriter, r *http.Request) {
	orgID := orgIDFromContext(r)
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, ErrCodeUnauthorized, "missing org context")
		return
	}

	limitStr := r.URL.Query().Get("limit")
	limit := 50
	if limitStr != "" {
		if n, err := strconv.Atoi(limitStr); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}

	cursorStr := r.URL.Query().Get("cursor")

	type auditEntry struct {
		ID         int64   `json:"id"`
		OrgID      string  `json:"org_id"`
		UserID     *string `json:"user_id,omitempty"`
		Action     string  `json:"action"`
		Resource   string  `json:"resource"`
		ResourceID *string `json:"resource_id,omitempty"`
		Metadata   string  `json:"metadata"`
		IPAddress  *string `json:"ip_address,omitempty"`
		CreatedAt  string  `json:"created_at"`
	}

	var (
		rows *sql.Rows
		err  error
	)
	if cursorStr != "" {
		cursor, perr := strconv.ParseInt(cursorStr, 10, 64)
		if perr != nil {
			WriteError(w, http.StatusBadRequest, ErrCodeBadRequest, "invalid cursor")
			return
		}
		rows, err = h.db.QueryContext(r.Context(),
			`SELECT id, org_id, user_id, action, resource, resource_id, metadata, ip_address, created_at
			 FROM audit_log WHERE org_id = ? AND id < ? ORDER BY id DESC LIMIT ?`,
			orgID, cursor, limit)
	} else {
		rows, err = h.db.QueryContext(r.Context(),
			`SELECT id, org_id, user_id, action, resource, resource_id, metadata, ip_address, created_at
			 FROM audit_log WHERE org_id = ? ORDER BY id DESC LIMIT ?`,
			orgID, limit)
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to query audit log")
		return
	}
	defer rows.Close()

	var entries []auditEntry
	for rows.Next() {
		var e auditEntry
		if err := rows.Scan(&e.ID, &e.OrgID, &e.UserID, &e.Action, &e.Resource,
			&e.ResourceID, &e.Metadata, &e.IPAddress, &e.CreatedAt); err != nil {
			WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to scan audit log")
			return
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "row error")
		return
	}

	// The next cursor is the ID of the last returned entry.
	var nextCursor *int64
	if len(entries) == limit {
		c := entries[len(entries)-1].ID
		nextCursor = &c
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"entries":    entries,
		"nextCursor": nextCursor,
	})
}

// ------------------------------------------------------------------
// Org
// ------------------------------------------------------------------

func (h *Handlers) GetOrg(w http.ResponseWriter, r *http.Request) {
	orgID := orgIDFromContext(r)
	if orgID == "" {
		WriteError(w, http.StatusUnauthorized, ErrCodeUnauthorized, "missing org context")
		return
	}

	var org struct {
		ID        string    `json:"id"`
		Name      string    `json:"name"`
		Slug      string    `json:"slug"`
		CreatedAt time.Time `json:"created_at"`
		UpdatedAt time.Time `json:"updated_at"`
	}
	err := h.db.QueryRowContext(r.Context(),
		`SELECT id, name, slug, created_at, updated_at FROM organizations WHERE id = ?`, orgID,
	).Scan(&org.ID, &org.Name, &org.Slug, &org.CreatedAt, &org.UpdatedAt)
	if err == sql.ErrNoRows {
		WriteError(w, http.StatusNotFound, ErrCodeNotFound, "org not found")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to fetch org")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(org)
}

func (h *Handlers) UpdateOrg(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotImplemented, "not_implemented", "not implemented")
}

// ------------------------------------------------------------------
// Org members
// ------------------------------------------------------------------

// RemoveMember removes a member from the org. Requires caller to be an admin.
func (h *Handlers) RemoveMember(w http.ResponseWriter, r *http.Request) {
	orgID := orgIDFromContext(r)
	callerID := userIDFromContext(r)
	if orgID == "" || callerID == "" {
		WriteError(w, http.StatusUnauthorized, ErrCodeUnauthorized, "missing org or user context")
		return
	}

	var callerRole string
	err := h.db.QueryRowContext(r.Context(),
		`SELECT role FROM org_memberships WHERE org_id = ? AND user_id = ?`, orgID, callerID,
	).Scan(&callerRole)
	if err == sql.ErrNoRows {
		WriteError(w, http.StatusForbidden, ErrCodeForbidden, "not a member of this org")
		return
	}
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to check role")
		return
	}
	if callerRole != "admin" {
		WriteError(w, http.StatusForbidden, ErrCodeForbidden, "admin role required")
		return
	}

	memberID := chi.URLParam(r, "memberID")
	res, err := h.db.ExecContext(r.Context(),
		`DELETE FROM org_memberships WHERE org_id = ? AND user_id = ?`, orgID, memberID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to remove member")
		return
	}
	n, err := res.RowsAffected()
	if err != nil {
		WriteError(w, http.StatusInternalServerError, ErrCodeInternalError, "failed to confirm removal")
		return
	}
	if n == 0 {
		WriteError(w, http.StatusNotFound, ErrCodeNotFound, "member not found")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
