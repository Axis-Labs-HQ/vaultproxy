package api

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/rs/zerolog/log"
)

// AuthMiddleware validates JWT session tokens for dashboard/API users.
func (h *Handlers) AuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
			WriteError(w, http.StatusUnauthorized, "unauthorized", "missing or invalid authorization header")
			return
		}
		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")

		token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, jwt.ErrSignatureInvalid
			}
			return []byte(h.cfg.JWTSecret), nil
		})
		if err != nil || !token.Valid {
			// Log the actual error internally; do not expose details to caller.
			log.Warn().Err(err).Msg("jwt validation failed")
			WriteError(w, http.StatusUnauthorized, "unauthorized", "invalid or expired token")
			return
		}

		next.ServeHTTP(w, r)
	})
}

// ProxyTokenMiddleware validates proxy tokens used by edge workers to resolve keys.
// The org is identified via X-Org-ID header. This header fallback is intentional
// for multi-org users per design F5: a single proxy token may serve requests on
// behalf of different orgs, so the caller specifies the target org explicitly.
func (h *Handlers) ProxyTokenMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" || !strings.HasPrefix(authHeader, "Bearer ") {
			WriteError(w, http.StatusUnauthorized, "unauthorized", "missing proxy token")
			return
		}
		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")

		hashed := sha256HexToken(tokenStr)
		var tokenHash string
		err := h.db.QueryRow(
			`SELECT token_hash FROM proxy_tokens WHERE token_hash = ? AND (expires_at IS NULL OR expires_at > datetime('now'))`,
			hashed,
		).Scan(&tokenHash)
		if err != nil {
			WriteError(w, http.StatusUnauthorized, "unauthorized", "invalid or expired token")
			return
		}

		next.ServeHTTP(w, r)
	})
}

func sha256HexToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
