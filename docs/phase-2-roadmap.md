# VaultProxy — Phase 2 Roadmap

**Last updated:** 2026-03-22
**Status:** Planning
**Scope:** Post-MVP features for VaultProxy Cloud

---

## Context

Phase 1 (MVP) delivered: encrypted key storage (AES-256-GCM), alias-based resolution, proxy token authentication, a Next.js dashboard with Better Auth (GitHub OAuth), a Go control plane on Railway, a Hono edge proxy on Railway, and a basic `vp` CLI with `login`, `fetch`, `run`, and `env` commands. Both proxy mode (transparent key injection) and fetch mode (raw key retrieval for CI/CD) are functional and tested end-to-end.

**Key product insight from MVP testing:** Fetch mode is the growth engine (zero friction, zero code changes). Proxy mode is the revenue differentiator (key never leaves VaultProxy). The phase 2 roadmap is structured to make proxy mode adoption as frictionless as fetch mode through env var auto-injection and thin SDK wrappers.

---

## Two Adoption Paths

Understanding these two paths is critical to every feature decision in phase 2:

**Path A — Fetch Mode (easy, universal)**
- User stores key in VaultProxy, retrieves at runtime via CLI or API
- Real key lands in the app's environment — same security model as Doppler/Vault
- Works with everything: CLIs, SDKs, scripts, any tool

**Path B — Proxy Mode (secure, progressive)**
- Requests route through VaultProxy edge; real key never leaves the server
- Requires `base_url` change in the SDK or env var
- Superior security, but higher adoption friction for existing codebases

Phase 2's primary goal: **make Path B feel as easy as Path A** through env var auto-injection and thin wrappers.

---

## Feature Roadmap

### 1. Auto-resolve Target URL

**Priority:** P0 — ship first
**Complexity:** Low
**Status:** Plumbing exists (TODO in edge proxy), needs implementation

**What:** Store the target API base URL alongside each key (e.g., `https://api.openai.com` for OpenAI). The edge proxy resolves alias → key + target URL in one call, eliminating the `X-Target-URL` header requirement.

**Implementation:**
- Add `target_url` column to `api_keys` table (nullable)
- Auto-populate from a provider registry for known providers when creating keys in the dashboard
- Update `/internal/resolve/{alias}` response to include `target_url`
- Edge proxy uses returned `target_url`, falls back to `X-Target-URL` header

**Why first:** Every feature below depends on knowing the target URL. Push sync needs it to set `*_BASE_URL` env vars. SDK wrappers need it. The `--proxy` CLI flag needs it. This unblocks everything.

---

### 2. CLI `--proxy` Flag + Env Var Auto-Injection

**Priority:** P0 — ship with auto-resolve
**Complexity:** Low
**Status:** CLI exists (`vp run` works), needs `--proxy` flag

**What:** When a user runs `vp run openai-1=OPENAI_API_KEY --proxy`, the CLI injects TWO env vars:
```
OPENAI_API_KEY=<proxy-token>
OPENAI_BASE_URL=https://proxy.vaultproxy.dev/proxy/openai-1
```

Without `--proxy`, it injects just the raw key (fetch mode). With `--proxy`, it injects the proxy token + base URL override. Many SDKs read `*_BASE_URL` env vars natively, so this enables proxy mode with zero code changes.

**Implementation:**
- Add `--proxy` flag to `vp run` command
- When `--proxy` is set, fetch the provider's base URL env var name from a local registry (e.g., OpenAI → `OPENAI_BASE_URL`, Anthropic → `ANTHROPIC_BASE_URL`)
- Inject the proxy token as the key value (instead of the real key)
- Inject the base URL pointing to the VaultProxy edge proxy
- `--dry-run` flag shows what would be set without setting it (addresses dev wariness about env injection)

**Provider env var registry (built into CLI):**
```
openai     → OPENAI_API_KEY    + OPENAI_BASE_URL
anthropic  → ANTHROPIC_API_KEY + ANTHROPIC_BASE_URL
cohere     → CO_API_KEY        + (constructor only)
mistral    → MISTRAL_API_KEY   + (constructor only)
replicate  → REPLICATE_API_TOKEN
stripe     → STRIPE_API_KEY    + (no base URL env var)
```

SDKs without base URL env var support are candidates for thin wrappers (feature 5).

**Why this matters:** This is the bridge between fetch mode and proxy mode. One flag, zero code changes. Developers who start with fetch mode can upgrade to proxy mode per-key, per-session.

---

### 3. Scoped Tokens

**Priority:** P0 — ship in same sprint as auto-resolve
**Complexity:** Low
**Status:** `scopes` column exists on `proxy_tokens`, not enforced

**What:** Restrict proxy tokens to specific aliases or environments. A CI/CD token scoped to `staging` can't resolve production keys.

**Implementation:**
- Add `environment` label to `api_keys` (production, staging, development)
- Enforce scope checks in `ProxyTokenMiddleware` before returning the key
- Dashboard UI for scope configuration during token creation
- CLI: `vp tokens create --scope staging --scope openai-*`

**Why P0:** Table-stakes for any team larger than one person. Without this, one leaked token exposes all keys in the org.

---

### 4. Push Sync / Env Var Injection

**Priority:** P0 — promoted from P1
**Complexity:** Medium
**Status:** DB table exists (`push_targets`), API stubs exist, sync logic not implemented

**What:** One-click in the dashboard: select a key, pick a deployment platform (Railway, Vercel, Render, Fly.io), and VaultProxy writes the env vars to that platform. For proxy mode, it writes both the proxy token and the base URL override. For fetch mode, it writes the raw key.

**Supported platforms (Sprint 2):**
- **Railway** — Variable API (REST)
- **Vercel** — Environment Variables API (REST)
- **Render** — Service env var + Environment Groups API (REST)
- **Netlify** — Site env var API (REST)
- **Fly.io** — Secrets API (GraphQL, triggers redeploy)

**Implementation:**
- Implement `Platform.Push` adapters for each platform (Railway first, since we're already deployed there)
- Each adapter calls the platform's API to set/update env vars
- Dashboard "quick setup" wizard: select provider → auto-fill env var names → select platform → connect → sync
- Support both modes: fetch (pushes raw key) and proxy (pushes proxy token + base URL)
- Webhook trigger on key rotation to cascade push to all connected targets
- Retry with exponential backoff for platform API failures

**Why promoted to P0:** This is the "zero touch" promise that makes proxy mode adoption trivial for teams. Without push sync, every developer has to manually configure env vars on every platform. With it, one click in the dashboard and every connected service is updated.

---

### 5. Thin SDK Wrappers

**Priority:** P1
**Complexity:** Medium
**Status:** Not started

**What:** Drop-in SDK wrappers for providers whose SDKs don't support `*_BASE_URL` env vars. The wrapper auto-configures the base URL to route through VaultProxy.

**Packages:**
```
@vaultproxy/openai     → wraps openai (may be unnecessary if env var works)
@vaultproxy/anthropic  → wraps @anthropic-ai/sdk
@vaultproxy/stripe     → wraps stripe (no base URL env var)
@vaultproxy/twilio     → wraps twilio
```

**Implementation pattern (Node.js example for Stripe):**
```typescript
// @vaultproxy/stripe
import Stripe from 'stripe';

export function createStripeClient(proxyAlias: string, proxyToken: string) {
  return new Stripe(proxyToken, {
    apiVersion: '2024-04-10',
    host: 'proxy.vaultproxy.dev',
    path: `/proxy/${proxyAlias}`,
  });
}
```

**Also publish Python equivalents** for providers with significant Python usage (OpenAI, Anthropic, Cohere).

**Why P1 not P0:** The env var approach (feature 2) covers the highest-value providers (OpenAI, Anthropic). Thin wrappers are needed for the long tail of SDKs that don't support base URL override. Build based on user demand — start with the providers users actually request.

---

### 6. Key Rotation Automation

**Priority:** P1
**Complexity:** Medium
**Dependencies:** Push sync (feature 4)

**What:** Schedule automatic key rotation on a cadence (30/60/90 days) or trigger on-demand. The proxy layer enables zero-downtime rotation — the alias stays stable while the real key is swapped underneath. Rotation cascades via push sync to all connected platforms.

**Implementation:**
- Add `rotation_interval_days`, `next_rotation_at`, `rotation_enabled` to `api_keys`
- Cron job checks for keys past rotation date, triggers `RotateKey` + cascade push sync
- For providers with rotation APIs (AWS IAM, GCP): programmatic rotation
- For providers without (OpenAI, Anthropic): notify user via email/webhook to supply new key
- Rotation history in audit log

**Why this matters:** The proxy architecture uniquely enables zero-downtime rotation. This is VaultProxy's strongest competitive advantage over Doppler/Infisical — they can rotate, but consumers see disruption. VaultProxy consumers never know it happened.

---

### 7. Usage Analytics & Alerts

**Priority:** P1
**Complexity:** High
**Dependencies:** Metering infrastructure (partially built)

**What:** Per-key and per-token usage dashboards. Anomaly detection alerts when usage spikes (potential key compromise). Cost estimation by mapping provider pricing.

**Implementation:**
- Extend `request_counts` to per-alias and per-token granularity
- `/api/v1/usage` endpoint with time-series data
- Dashboard analytics page with charts
- Alert rules table with email/webhook delivery

---

### 8. IP/Origin Allowlisting

**Priority:** P2
**Complexity:** Low

**What:** Restrict proxy tokens to specific IPs, CIDRs, or origins. Defense-in-depth for enterprise.

---

### 9. OAuth Flow Proxying

**Priority:** P2
**Complexity:** High

**What:** Support APIs using OAuth 2.0 (Google, Microsoft, Salesforce). VaultProxy manages the token refresh lifecycle transparently. Biggest market expansion feature.

---

## Cross-Cutting Concerns (from best-practice check)

### A. Provider Compatibility Matrix

**Priority:** P0 — ship in sprint 1
**Severity:** HIGH (from best-practice check)

**Problem:** Providers that use request signing (Stripe HMAC-SHA256, AWS SigV4, Twilio account signatures) will silently fail under proxy mode because the proxy modifies the Authorization header, breaking signature verification.

**Solution:**
- Add a `proxy_compatible` boolean to the provider registry
- Dashboard: when adding a key for a signing provider, show "Proxy mode: not supported (request signing)" and default to fetch mode
- CLI: `vp run stripe-1=STRIPE_API_KEY --proxy` should warn and fall back to fetch mode
- Docs: publish a provider compatibility table (proxy vs fetch)

**Compatible with proxy mode:** OpenAI, Anthropic, Cohere, Mistral, Replicate, SendGrid, generic REST APIs
**Fetch mode only:** Stripe, AWS, Twilio, Google Cloud (signing/mTLS)

### B. PostgreSQL Migration

**Priority:** Sprint 2 (alongside push sync)
**Severity:** MEDIUM (from best-practice check)

**Problem:** SQLite with WAL mode supports ~500-1000 writes/sec on a single node — fine for beta, but the single-writer bottleneck and no horizontal scaling become constraints at multi-tenant scale (~1000+ orgs). Doppler and Infisical both use PostgreSQL. No network filesystem support means no multi-instance control plane.

**Plan:**
- Sprint 2: Add PostgreSQL support alongside push sync (Railway managed Postgres, $5/mo)
- The Go control plane uses `database/sql` — switching drivers is a dependency swap, not a rewrite
- Run both during transition: SQLite for local dev, Postgres for prod
- Unlocks: concurrent writes, row-level locking, read replicas, multi-instance control plane

### C. Secret Versioning & Rollback

**Priority:** Sprint 3 (with key rotation)
**Severity:** MEDIUM (from best-practice check)

**Problem:** Key rotation without version history is half a feature. Both Doppler and Infisical maintain full version history with rollback. When a rotation goes wrong, teams need to revert immediately.

**Implementation:**
- Add `key_versions` table: `id`, `key_id`, `version`, `encrypted_key`, `created_at`, `created_by`
- Rotation creates a new version rather than overwriting — the active version pointer moves forward
- Rollback = set active version pointer to a previous version
- Dashboard: version history timeline per key with one-click rollback
- Audit log: records who rotated, who rolled back, and when

---

## Priority Summary

| Priority | Feature | Complexity | Revenue Impact |
|----------|---------|------------|----------------|
| **P0** | Auto-resolve Target URL | Low | Unblocks everything |
| **P0** | CLI `--proxy` flag | Low | Zero-code proxy adoption |
| **P0** | Scoped Tokens | Low | Team security |
| **P0** | Provider Compatibility Matrix | Low | Prevents trust-damaging failures |
| **P0** | Push Sync | Medium | Zero-touch adoption |
| **P1** | PostgreSQL Migration | Medium | Multi-tenant scalability |
| **P1** | Thin SDK Wrappers | Medium | Long-tail provider coverage |
| **P1** | Key Rotation + Versioning | Medium | Competitive advantage + rollback |
| **P1** | Usage Analytics | High | Visibility + alerts |
| **P2** | IP/Origin Allowlisting | Low | Enterprise compliance |
| **P2** | OAuth Flow Proxying | High | Market expansion |

## Sequencing

```
Sprint 1 (P0):  Auto-resolve Target URL + Scoped Tokens + CLI --proxy + Provider Compat Matrix
Sprint 2 (P0):  Push Sync (Railway, Vercel, Render, Netlify, Fly.io) + PostgreSQL Migration
Sprint 3 (P1):  Key Rotation + Secret Versioning + Thin Wrappers
Sprint 4 (P1):  Usage Analytics & Alerts
Backlog (P2):   IP/Origin Allowlisting, OAuth Flow Proxying
```

## User Journey (Phase 2 Complete)

```
1. Sign up → create org → add OpenAI key
2. Generate proxy token
3. vp run openai-1=OPENAI_API_KEY --proxy
   → App routes through VaultProxy, real key never exposed
   → Zero code changes

OR

3. Connect Railway project in dashboard → one-click push sync
   → Railway env vars auto-configured
   → Zero CLI needed, zero code changes

4. Key rotation due → VaultProxy rotates + pushes to Railway
   → App never notices, zero downtime

5. Usage spike alert → check dashboard → revoke compromised token
   → All other tokens/keys unaffected
```
