package api

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// aliasRegexp is the canonical alias validation pattern shared across handlers.
var aliasRegexp = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

// Error code constants used in WriteError responses.
const (
	ErrCodeUnauthorized   = "unauthorized"
	ErrCodeForbidden      = "forbidden"
	ErrCodeNotFound       = "not_found"
	ErrCodeBadRequest     = "bad_request"
	ErrCodeConflict       = "conflict"
	ErrCodeInternalError  = "internal_error"
)

type errorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

// WriteError writes a JSON error response with the given HTTP status, error code, and message.
func WriteError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(errorResponse{Error: code, Message: message})
}

// ValidateTargetURL checks that a target URL is safe for proxying.
// MF-4: Prevents SSRF by rejecting private IPs, non-HTTPS, and internal domains.
func ValidateTargetURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}

	if u.Scheme != "https" {
		return fmt.Errorf("target URL must use HTTPS")
	}

	host := u.Hostname()

	// Reject internal/private domains
	blockedSuffixes := []string{".internal", ".local", ".localhost", ".railway.internal"}
	for _, suffix := range blockedSuffixes {
		if strings.HasSuffix(host, suffix) {
			return fmt.Errorf("target URL cannot point to internal domains")
		}
	}

	// Reject private/reserved IPs
	ip := net.ParseIP(host)
	if ip != nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return fmt.Errorf("target URL cannot point to private or reserved IP addresses")
		}
		// Block cloud metadata endpoints
		if ip.Equal(net.ParseIP("169.254.169.254")) {
			return fmt.Errorf("target URL cannot point to cloud metadata endpoints")
		}
	}

	return nil
}
