package api

import (
	"encoding/json"
	"net/http"
	"regexp"
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
