# VaultProxy

Open-source API key proxy — mask, rotate, and push-sync secrets without redeploying.

## What It Does

VaultProxy sits between your application and external APIs. Instead of embedding raw API keys in your environment variables, you use VaultProxy aliases. When your app makes an API call through the proxy, VaultProxy resolves the alias to the real key at the edge — your actual secrets never touch your application servers.

**Key rotation becomes a one-click operation.** Update the key in VaultProxy, and every service using that alias gets the new key instantly. No redeploys, no downtime, no stale env vars.

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Your App    │────▶│  Edge Proxy      │────▶│  External API   │
│              │     │  (CF Workers)    │     │  (OpenAI, etc)  │
│  alias: vp_  │     │  resolves alias  │     │                 │
│  sk-xxx      │     │  injects real key│     │                 │
└─────────────┘     └────────┬─────────┘     └─────────────────┘
                             │
                    ┌────────▼─────────┐
                    │  Control Plane   │
                    │  (Go API)        │
                    │  • Key storage   │
                    │  • Auth & RBAC   │
                    │  • Push sync     │
                    │  • Audit log     │
                    └──────────────────┘
```

**Two components:**

- **Edge Proxy** — Cloudflare Workers + Hono. Runs at 330+ PoPs worldwide. Intercepts API calls, resolves aliases, injects real keys, forwards requests. Sub-millisecond overhead.
- **Control Plane** — Go API server. Manages keys, orgs, users, proxy tokens, push sync targets, and audit logs. Encrypted at rest (AES-256-GCM).

## Features (MVP)

- **Key aliasing** — Replace real API keys with VaultProxy aliases
- **Instant rotation** — Update keys without redeploying services
- **Push sync** — Automatically push rotated keys as env vars to:
  - Render
  - Vercel
  - Railway
  - AWS SSM Parameter Store
- **Encrypted storage** — AES-256-GCM encryption at rest
- **Audit log** — Track every key access, rotation, and sync
- **Multi-org** — Isolated key namespaces per organization
- **Proxy tokens** — Scoped tokens for edge proxy authentication

## Quick Start

### Control Plane

```bash
cd control-plane
cp .env.example .env  # configure your settings
go run ./cmd/server
```

### Edge Proxy

```bash
cd edge-proxy
npm install
cp wrangler.toml.example wrangler.toml  # configure your settings
npm run dev
```

### Usage

```bash
# Instead of:
curl https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer sk-real-key-here"

# Use VaultProxy:
curl https://edge.vaultproxy.dev/proxy/my-openai-key/v1/chat/completions \
  -H "Authorization: Bearer vp_your-proxy-token"
```

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Edge Proxy | Cloudflare Workers + Hono | 330+ PoPs, $0.30/M requests, zero egress, full SSE support |
| Control Plane | Go + Chi | Fast, low memory, excellent crypto stdlib |
| Database | SQLite (WAL mode) | Zero-ops, embedded, scales to millions of keys |
| Auth | Better Auth (self-hosted) | No vendor lock-in, full control |
| Encryption | AES-256-GCM | Industry standard, Go native support |

## Project Structure

```
vaultproxy/
├── control-plane/          # Go API server
│   ├── cmd/server/         # Entry point
│   └── internal/
│       ├── api/            # HTTP handlers & routes
│       ├── config/         # Configuration
│       ├── cron/           # Scheduled jobs (key expiry, sync retries)
│       ├── db/             # Database & migrations
│       ├── keys/           # Key encryption & management
│       └── push/           # Push sync platform registry
├── dashboard/              # Next.js management UI (Better Auth, React)
├── edge-proxy/             # Cloudflare Workers
│   └── src/
│       ├── handlers/       # Proxy request handler
│       └── middleware/     # Auth middleware
└── docs/                   # Architecture & design docs
```

## License

Apache 2.0 — see [LICENSE](LICENSE)

## Contributing

VaultProxy is built in public by [Axis Labs](https://axisdataworks.com). Issues and PRs welcome.
