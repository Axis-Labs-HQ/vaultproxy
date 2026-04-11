package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/davekim917/vaultproxy/control-plane/internal/config"
	"github.com/davekim917/vaultproxy/control-plane/internal/db"
	"github.com/davekim917/vaultproxy/control-plane/internal/keys"
	"github.com/davekim917/vaultproxy/control-plane/internal/push"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func NewRouter(database *db.DB, cfg *config.Config) (http.Handler, error) {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	// Limit request body size to 1 MiB for all routes.
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
			next.ServeHTTP(w, r)
		})
	})

	// MF-3: Restrict CORS to dashboard origin. Wildcard + credentials is spec-invalid
	// and allows any website to make authenticated requests to the API.
	allowedOrigins := strings.Split(cfg.AllowedOrigins, ",")
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Org-ID", "X-User-ID"},
		ExposedHeaders:   []string{"X-Request-ID"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	keySvc, err := keys.NewService(database.DB, cfg.EncryptionMasterKey)
	if err != nil {
		return nil, fmt.Errorf("init key service: %w", err)
	}
	pushRegistry := push.NewRegistry()

	// Register push sync platform adapters
	pushRegistry.Register(&push.Railway{})
	pushRegistry.Register(&push.Vercel{})
	pushRegistry.Register(&push.RenderPlatform{})
	pushRegistry.Register(&push.Netlify{})
	pushRegistry.Register(&push.FlyIO{})

	h := &Handlers{
		db:   database.DB,
		keys: keySvc,
		push: pushRegistry,
		cfg:  cfg,
	}

	// Health + public endpoints
	r.Get("/health", h.Health)
	r.Get("/api/v1/providers", h.ListProviders)

	// API v1
	r.Route("/api/v1", func(r chi.Router) {
		// Auth
		r.Post("/auth/register", h.Register)
		r.Post("/auth/login", h.Login)

		// Authenticated routes
		r.Group(func(r chi.Router) {
			r.Use(h.AuthMiddleware)

			// Keys
			r.Get("/keys", h.ListKeys)
			r.Post("/keys", h.CreateKey)
			r.Get("/keys/{keyID}", h.GetKey)
			r.Put("/keys/{keyID}", h.UpdateKey)
			r.Delete("/keys/{keyID}", h.DeleteKey)
			r.Post("/keys/{keyID}/rotate", h.RotateKey)
			r.Post("/keys/{keyID}/deactivate", h.DeactivateKey)

			// Proxy tokens
			r.Get("/tokens", h.ListTokens)
			r.Post("/tokens", h.CreateToken)
			r.Delete("/tokens/{tokenID}", h.DeleteToken)

			// Push sync targets
			r.Get("/push-targets", h.ListPushTargets)
			r.Post("/push-targets", h.CreatePushTarget)
			r.Post("/push-targets/{targetID}/sync", h.SyncPushTarget)
			r.Delete("/push-targets/{targetID}", h.DeletePushTarget)

			// Audit log
			r.Get("/audit", h.ListAuditLog)

			// Org
			r.Get("/org", h.GetOrg)
			r.Put("/org", h.UpdateOrg)
		})
	})

	// Resolve endpoint — called by edge proxy (token-authed, not session-authed)
	r.Group(func(r chi.Router) {
		r.Use(h.ProxyTokenMiddleware)
		r.Get("/internal/resolve/{alias}", h.ResolveKey)
		r.Get("/internal/fetch/{alias}", h.FetchKey)
		r.Get("/internal/resolve-by-host/{hostname}", h.ResolveByHost)
	})

	return r, nil
}
