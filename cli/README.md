# @vaultproxy/cli

CLI for [VaultProxy](https://vaultproxy.dev) — secure API key management with proxy and fetch modes.

## Install

```bash
npm install -g @vaultproxy/cli
```

## Setup

```bash
vp login
# Paste your proxy token (from app.vaultproxy.dev > Tokens)
```

## Usage

### Fetch a key

```bash
vp fetch openai-1
# prints: sk-real-key...
```

### Inject keys into your shell

```bash
eval $(vp run openai-1=OPENAI_API_KEY)
# OPENAI_API_KEY is now set in your shell
```

### Inject and execute a command

```bash
vp run railway=RAILWAY_TOKEN -- railway deploy
```

### Proxy mode (key never leaves VaultProxy)

```bash
eval $(vp run openai-1=OPENAI_API_KEY --proxy)
# Sets OPENAI_API_KEY (proxy token) + OPENAI_BASE_URL (proxy endpoint)
# Your app routes through VaultProxy — real key never exposed
```

### Dry run (see what would be set)

```bash
vp run openai-1=OPENAI_API_KEY --proxy --dry-run
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VAULTPROXY_TOKEN` | Override stored proxy token |
| `VAULTPROXY_API_URL` | Override API URL (default: https://api.vaultproxy.dev) |

## License

MIT
