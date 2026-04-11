import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_DIR = join(homedir(), ".vaultproxy");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULTS = {
  api_url: "https://api.vaultproxy.dev",
  proxy_url: "https://proxy.vaultproxy.dev",
};

export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULTS };
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(config) {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function getToken() {
  const cfg = loadConfig();
  // Env var takes precedence over config file
  return process.env.VAULTPROXY_TOKEN || cfg.token || null;
}

export function getApiUrl() {
  return process.env.VAULTPROXY_API_URL || loadConfig().api_url;
}
