# VaultProxy — MVP Architecture

## Overview

VaultProxy is a split-architecture API key proxy with two core components:

1. **Edge Proxy** (Cloudflare Workers + Hono) — the hot path. Intercepts API calls at the edge, resolves key aliases, injects real keys, and forwards requests with minimal latency.
2. **Control Plane** (Go + Chi + SQLite) — the management layer. Handles key CRUD, encryption, auth, push sync, and audit logging.

## Design Principles

- **Zero-trust the application layer** — real keys never leave VaultProxy
- **Edge-first** — proxy runs at 330+ Cloudflare PoPs for sub-ms overhead
- **Push, don't pull** — sync keys to hosting platforms proactively, don't wait for deploys
- **Encryption at rest** — AES-256-GCM for all stored keys
- **Audit everything** — every key access, rotation, and sync is logged

## Request Flow

```
Client → Edge Proxy → Control Plane (resolve) → Edge Proxy → Target API
         (CF Worker)   (Go API, cached in KV)    (inject key)
```

1. Client sends request to `edge.vaultproxy.dev/proxy/{alias}/...`
2. Edge proxy authenticates via proxy token (`vp_...`)
3. Edge proxy resolves alias → real key (KV cache, 60s TTL, fallback to control plane)
4. Edge proxy rewrites Authorization header with real key
5. Edge proxy forwards to target API
6. Response streams back to client

## Data Model

### Organizations
Multi-tenant isolation. Each org has its own key namespace.

### API Keys
- Stored encrypted (AES-256-GCM)
- Referenced by alias (globally unique)
- Tracks provider, rotation history, active status
- Key prefix stored in plaintext for UI display (e.g., `sk-proj-...`)

### Proxy Tokens
- Scoped authentication for edge proxy
- Hashed (SHA-256) in database
- Support expiration and scope restrictions

### Push Targets
- Link an API key to a hosting platform + env var name
- Platforms: Render, Vercel, Railway, AWS SSM
- Each platform implements the `Platform` interface
- Sync is triggered on key rotation or manually

### Audit Log
- Append-only log of all operations
- Tracks: user, action, resource, IP, timestamp
- Queryable by org and date range

## Push Sync Architecture

Push sync is the killer feature. When a key is rotated:

1. Control plane updates the encrypted key in the database
2. Control plane looks up all push targets for that key
3. For each target, calls the platform's API to update the env var
4. No redeploy needed — platforms pick up new env vars on next request

### Platform Interface

```go
type Platform interface {
    Name() string
    Push(ctx context.Context, target *Target, envVar string, value string) error
    Validate(config map[string]string) error
}
```

### Supported Platforms (MVP)

| Platform | API | Redeploy Required? |
|----------|-----|-------------------|
| Render | Service env var API | No |
| Vercel | Project env API | No (serverless) |
| Railway | Variable API | No |
| AWS SSM | PutParameter | No (if using dynamic lookup) |

## Security Model

- **Encryption**: AES-256-GCM with key derived from master secret (SHA-256)
- **Auth**: Better Auth (self-hosted) for user sessions
- **Proxy tokens**: Separate auth path for edge proxy (hashed, scoped, expirable)
- **CORS**: Configurable per deployment
- **Rate limiting**: Per-org, per-token (planned)

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Edge runtime | CF Workers | $0.30/M requests, 330+ PoPs, zero cold start, full streaming |
| Edge framework | Hono | Built for Workers, tiny bundle, familiar Express-like API |
| Control plane language | Go | Fast compilation, excellent crypto stdlib, low memory |
| Control plane framework | Chi | Lightweight, idiomatic, middleware-friendly |
| Database | SQLite (WAL) | Zero-ops, embedded, handles millions of rows, easy backups |
| Auth | Better Auth | Self-hosted, no vendor lock-in, TypeScript SDK |
| Encryption | AES-256-GCM | Go native, authenticated encryption, industry standard |

## Pricing Model

| Tier | Price | Limits |
|------|-------|--------|
| Free | $0 | 5 keys, 1 push target, 10K proxy requests/mo |
| Pro | $39/mo | Unlimited keys, unlimited push targets, 1M requests/mo |
| Enterprise | Custom | SSO, custom SLAs, dedicated support, self-hosted option |

## Future Roadmap (Post-MVP)

- Dashboard web UI (React)
- CLI tool for key management
- GitHub Actions integration
- Auto-rotation with provider APIs
- Key groups and bulk rotation
- Webhook notifications on rotation
- SDK libraries (Node, Python, Go)
- Self-hosted single-binary distribution
