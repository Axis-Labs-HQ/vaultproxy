# VaultProxy

**Open-source API key proxy with HTTPS proxy mode, policy controls, and deployment push sync.**

VaultProxy sits between your applications and external APIs. Your agents and services never hold raw API keys — they authenticate through VaultProxy, which resolves credentials and injects them transparently.

---

## The Problem

API keys are scattered across `.env` files, CI secrets, config stores, and deployment platforms. Rotating a key means touching 8 places. A leaked key means an emergency rotation across every service that uses it. Nobody knows which service is using which key.

Traditional secrets managers solve storage. They don't solve what happens *after* the key is fetched — once it's in your agent's memory, the vault has zero visibility.

## What VaultProxy Does Differently

VaultProxy stays in the request path. Every API call flows through the proxy:

1. Your agent or service makes a request through the HTTPS proxy
2. VaultProxy resolves the real API key from its encrypted vault
3. The key is injected into the request headers — the agent never sees it
4. The response streams back to the caller

**Key rotation is instant.** Update the key in VaultProxy. Every service using it gets the new key on their next request. No redeploys, no stale env vars, no emergency rotation.

---

## Architecture

```
┌────────────────┐                    ┌─────────────────────────────────┐
│  Your Agent /  │   HTTPS_PROXY ────▶  │  VaultProxy Rust Proxy          │
│  Application   │                    │  (MITM — intercepts requests,    │
│                │                    │   injects credentials)           │
└────────────────┘                    └────────────┬────────────────────┘
                                                  │
                              ┌───────────────────┼───────────────────┐
                              ▼                   ▼                   ▼
                    ┌──────────────┐    ┌──────────────────┐  ┌─────────────┐
                    │  OpenAI,    │    │  Control Plane   │  │  Push Sync  │
                    │  Anthropic, │    │  (Go)            │  │  Targets    │
                    │  Stripe,    │◀───│  • Encrypted key  │  │  Railway    │
                    │  Gmail...    │    │    storage (AES)  │  │  Vercel     │
                    │              │    │  • Agent & policy │  │  Render     │
                    └──────────────┘    │    management    │  │  Netlify    │
                                         │  • Scoped tokens │  │  Fly.io     │
                                         └──────────────────┘  └─────────────┘
                                         │
                                         ▼
                                   ┌──────────────┐
                                   │  Dashboard   │
                                   │  (Next.js)   │
                                   │  Multi-agent │
                                   │  Policy UI    │
                                   └──────────────┘
```

### Components

| Component | Tech | Purpose |
|-----------|------|---------|
| **Rust MITM Proxy** | Rust + tokio + hyper | HTTPS interception, credential injection, policy enforcement |
| **Control Plane** | Go | Encrypted key storage, agent management, scoped tokens, push sync |
| **Dashboard** | Next.js + Better Auth | Agent management, secret management, policy rules, push sync config |
| **CLI** | Node.js | `vp run` for fetch mode (non-proxyable tools) |

---

## Features

### Open Source (Apache 2.0)

- **HTTPS MITM proxy** — Transparent credential injection. Set `HTTPS_PROXY=http://localhost:10255` and every HTTP client routes through automatically.
- **Scoped proxy tokens** — Agents get tokens scoped to specific keys, paths, or environments. Least privilege by default.
- **Policy engine** — Block specific endpoints, rate-limit per-agent, or require manual approval before sensitive operations.
- **AES-256-GCM encryption** — Real keys encrypted at rest, decrypted only in-memory during request forwarding.
- **Agent identity** — Name and track agents separately. See which agent made which request.
- **Dashboard** — Self-hosted web UI for managing agents, secrets, policies, and access control.
- **Provider registry** — Maps hosts to auth strategies (Bearer, Basic, OAuth refresh).

### Cloud-Gated (managed VaultProxy Cloud)

These require a managed deployment. See [VaultProxy Cloud](#vaultproxy-cloud).

- **Push sync** — When you rotate a key, VaultProxy automatically pushes the new value to Railway, Vercel, Render, Netlify, or Fly.io. No manual env var updates.
- **Fetch mode CLI** — `vp run openai=sk-xxx -- npx some-cli-tool` for tools that can't be proxied.
- **Managed hosting** — Zero ops. We handle updates, backups, and monitoring.
- **Multi-tenant SSO** — SAML/OIDC for teams.
- **Compliance export** — Audit logs and SOC 2 documentation for regulated industries.

---

## Quick Start

### 1. Start the Rust Proxy

```bash
cd proxy
cargo build --release
./target/release/vaultproxy-proxy --port 10255
```

Set your system proxy:
```bash
export HTTPS_PROXY=http://localhost:10255
export HTTP_PROXY=http://localhost:10255
```

### 2. Start the Control Plane

```bash
cd control-plane
cp .env.example .env
# Edit .env — set your encryption key and database URL
go run ./cmd/server
```

### 3. Start the Dashboard

```bash
cd dashboard
cp .env.example .env.local
# Edit .env.local — set your Better Auth configuration
npm install
npm run dev
```

### 4. Add Your First Key

Open `http://localhost:3000`, create an account, then:

1. Go to **Keys** → **Add Key**
2. Select provider (OpenAI, Stripe, etc.) or enter a custom API endpoint
3. Paste your API key — it's encrypted immediately
4. Create a **Scoped Token** with access to that key

### 5. Use from Your Agent

```bash
# The agent sets HTTPS_PROXY and uses your API key transparently
curl https://api.openai.com/v1/models
# VaultProxy intercepts, resolves the real key, injects it, forwards the request
```

Or with the CLI for non-proxyable tools:

```bash
vp login
vp run openai=my-key-alias -- python my_script.py
```

---

## Policy Engine

Control what agents can do at request time:

```
# Block DELETE on Stripe's charges endpoint
path: /v1/charges
method: DELETE
action: block

# Rate limit Anthropic calls to 100/min per agent
path: /v1/messages
method: POST
action: rate_limit
max_requests: 100
window: minute

# Require manual approval for Gmail send
path: /gmail/v1/users/me/messages/send
method: POST
action: manual_approval
```

Priority: **Block > Manual Approval > Rate Limit > Allow**

---

## VaultProxy Cloud

Managed VaultProxy hosting for teams that don't want to self-host.

| Plan | Price | Includes |
|------|-------|----------|
| **Self-hosted** | Free | Everything in this repo |
| **Pro** | $29/mo | Push sync, managed hosting, multi-tenant, SSO, audit logs |
| **Enterprise** | Custom | Dedicated infra, compliance docs, SLA, priority support |

Push sync and managed hosting are the primary Pro features. The proxy code is open source — audit it, fork it, deploy it yourself.

[Get started →](https://vaultproxy.dev)

---

## Comparison

| | VaultProxy OSS | OneCLI |
|---|---|---|
| HTTPS MITM proxy | ✅ Rust | ✅ Rust |
| Per-request credential injection | ✅ | ✅ |
| Policy engine (block/rate-limit) | ✅ | ✅ |
| Agent identity + tracking | ✅ | ✅ |
| Scoped tokens | ✅ | ✅ |
| Dashboard | ✅ Self-hosted | ✅ Self-hosted |
| Push sync to deployment platforms | ✅ | ❌ |
| Fetch mode for non-proxyable tools | ✅ | ❌ |
| Business model | OSS + managed cloud | OSS + managed cloud |

VaultProxy's differentiator is **push sync** — rotate a key once, it propagates to Railway, Vercel, Render, Netlify, and Fly.io automatically.

---

## Tech Stack

- **MITM Proxy**: Rust + tokio + hyper + tokio-rustls
- **Control Plane**: Go (Chi router, stdlib crypto)
- **Dashboard**: Next.js 14 + Better Auth
- **Database**: SQLite (self-hosted) or PostgreSQL (recommended for production)
- **Encryption**: AES-256-GCM

---

## License

Apache 2.0 — use it, fork it, build on it.

See [LICENSE](./LICENSE) for details.
