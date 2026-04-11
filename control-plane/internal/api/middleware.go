package api

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/rs/zerolog/log"
)

// AuthMiddleware validates JWT session tokens or internal API keys for dashboard/API users.
// SF-8: For JWT-authenticated requests, the org ID is extracted from claims and set
// as X-Org-ID, ignoring any client-supplied value. For internal API key requests
// (dashboard → control plane), X-Org-ID from the dashboard is trusted since the
// internal key is a shared secret between the two services.
func (h *Handlers) AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
			WriteError(w, http.StatusUnauthorized, ErrCodeUnauthorized, "missing or invalid authorization header")
			return
		}
		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")

		// Allow internal API key for service-to-service calls (dashboard → control plane).
		// The dashboard sets X-Org-ID from the authenticated Better Auth session.
		if h.cfg.InternalAPIKey != "" && tokenStr == h.cfg.InternalAPIKey {
			next.ServeHTTP(w, r)
			return
		}

		token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return []byte(h.cfg.JWTSecret), nil
		})
		if err != nil || !token.Valid {
			log.Warn().Err(err).Msg("jwt validation failed")
			WriteError(w, http.StatusUnauthorized, ErrCodeUnauthorized, "invalid or expired token")
			return
		}

		// SF-8: Extract org ID from JWT claims, don't trust the header
		if claims, ok := token.Claims.(jwt.MapClaims); ok {
			if orgID, exists := claims["org_id"].(string); exists && orgID != "" {
				r.Header.Set("X-Org-ID", orgID)
			}
			if userID, exists := claims["sub"].(string); exists && userID != "" {
				r.Header.Set("X-User-ID", userID)
			}
		}

		next.ServeHTTP(w, r)
	})
}

// ProxyTokenMiddleware validates proxy tokens used by edge workers to resolve keys.
// The org is determined from the token's database record, NOT from client headers.
// PERF-001: Also fetches allowed_aliases in the same query to avoid a duplicate
// DB round-trip in the handler. Stores it in X-Allowed-Aliases header for handlers.
// VULN-002: Scope enforcement is fail-closed — DB errors deny access.
func (h *Handlers) ProxyTokenMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
			WriteError(w, http.StatusUnauthorized, ErrCodeUnauthorized, "missing proxy token")
			return
		}
		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")

		hashed := sha256HexToken(tokenStr)
		var orgID, allowedAliases string
		err := h.db.QueryRow(
			`SELECT org_id, COALESCE(allowed_aliases, '[]')
			 FROM proxy_tokens WHERE token_hash = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`,
			hashed,
		).Scan(&orgID, &allowedAliases)
		if err != nil {
			WriteError(w, http.StatusUnauthorized, ErrCodeUnauthorized, "invalid or expired token")
			return
		}

		// Set org context and scope from DB, overwriting any client-supplied values
		r.Header.Set("X-Org-ID", orgID)
		r.Header.Set("X-Allowed-Aliases", allowedAliases)
		next.ServeHTTP(w, r)
	})
}

func sha256HexToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
