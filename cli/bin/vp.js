#!/usr/bin/env node

import { loadConfig, saveConfig, getToken } from "../lib/config.js";
import { fetchKey, fetchProviders } from "../lib/api.js";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const command = args[0];

const HELP = `
vp — VaultProxy CLI

Commands:
  vp login                     Save your proxy token
  vp fetch <alias>             Print the decrypted key for an alias
  vp env <alias>=<VAR> [...]   Print export statements for key mappings
  vp run <alias>=<VAR> [...]   Inject keys into current shell (use with eval)
  vp run <alias>=<VAR> [...] -- <command>
                               Inject keys and run a command
  vp proxy start               Start the HTTPS proxy (credential injection)
  vp proxy stop                Stop the running proxy
  vp proxy status              Check if the proxy is running
  vp proxy trust               Print instructions to trust the CA cert

Options:
  vp --help                    Show this help
  vp --version                 Show version
  --proxy                      Use proxy token + base URL instead of real key
  --dry-run                    Show what would be set without fetching real keys

Environment:
  VAULTPROXY_TOKEN             Override stored token
  VAULTPROXY_API_URL           Override API URL (default: https://api.vaultproxy.dev)
  HTTPS_PROXY                  Set to http://localhost:10255 when proxy is running

Examples:
  vp login
  vp fetch railway
  eval $(vp run railway=RAILWAY_TOKEN)
  vp run railway=RAILWAY_TOKEN -- railway status
  eval $(vp run openai-1=OPENAI_API_KEY --proxy)
  vp proxy start && export HTTPS_PROXY=http://localhost:10255
`.trim();

async function main() {
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  if (command === "--version" || command === "-v") {
    console.log("0.1.0");
    process.exit(0);
  }

  switch (command) {
    case "login":
      await cmdLogin();
      break;
    case "fetch":
      await cmdFetch();
      break;
    case "env":
      await cmdEnv();
      break;
    case "run":
      await cmdRun();
      break;
    case "proxy":
      await cmdProxy();
      break;
    default:
      console.error(`Unknown command: ${command}\nRun 'vp --help' for usage.`);
      process.exit(1);
  }
}

// --- login ---

async function cmdLogin() {
  const cfg = loadConfig();

  // Check if token provided as argument
  let token = args[1];

  if (!token) {
    // Interactive prompt
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    token = await new Promise((resolve) => {
      rl.question("Proxy token: ", (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  if (!token) {
    console.error("No token provided.");
    process.exit(1);
  }

  // Optional: custom API URL
  const urlFlag = args.find((a) => a.startsWith("--api-url="));
  if (urlFlag) {
    cfg.api_url = urlFlag.split("=").slice(1).join("=");
  }

  cfg.token = token;
  saveConfig(cfg);
  console.error("✓ Token saved to ~/.vaultproxy/config.json");
}

// --- fetch ---

async function cmdFetch() {
  const alias = args[1];
  if (!alias) {
    console.error("Usage: vp fetch <alias>");
    process.exit(1);
  }

  try {
    const result = await fetchKey(alias);
    // Print just the key to stdout (pipeable)
    process.stdout.write(result.key);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

// --- env ---

async function cmdEnv() {
  const mappings = parseMappings(args.slice(1));
  if (mappings.length === 0) {
    console.error("Usage: vp env <alias>=<ENV_VAR> [...]");
    console.error("Example: vp env railway=RAILWAY_TOKEN openai=OPENAI_API_KEY");
    process.exit(1);
  }

  const results = await resolveAll(mappings);
  for (const { envVar, key } of results) {
    console.log(`export ${envVar}=${shellEscape(key)}`);
  }
}

// --- run ---

async function cmdRun() {
  const dashIndex = args.indexOf("--");

  // Flags live before the "--" separator (or anywhere if no separator)
  const flagArgs = dashIndex === -1 ? args.slice(1) : args.slice(1, dashIndex);
  const isProxyMode = flagArgs.includes("--proxy");
  const isDryRun = flagArgs.includes("--dry-run");

  // No "--" means inject-only mode (prints export statements)
  const mappingArgs = dashIndex === -1 ? args.slice(1) : args.slice(1, dashIndex);
  const cmdArgs = dashIndex === -1 ? [] : args.slice(dashIndex + 1);

  const mappings = parseMappings(mappingArgs);
  if (mappings.length === 0) {
    console.error("Usage: vp run <alias>=<ENV_VAR> [...] [-- <command>]");
    console.error("  Without --: prints export statements (use with eval)");
    console.error("  With --:    injects keys and runs the command");
    console.error("  --proxy:    use proxy token + base URL injection");
    console.error("  --dry-run:  show what would be set without fetching real keys");
    console.error("Example: eval $(vp run railway=RAILWAY_TOKEN)");
    console.error("Example: vp run railway=RAILWAY_TOKEN -- railway status");
    console.error("Example: eval $(vp run openai-1=OPENAI_API_KEY --proxy)");
    process.exit(1);
  }

  // --- dry-run mode ---
  if (isDryRun) {
    if (isProxyMode) {
      const token = getToken();
      if (!token) {
        console.error("Error: Not logged in. Run: vp login");
        process.exit(1);
      }
      const cfg = loadConfig();
      const proxyBase = cfg.proxy_url || "https://proxy.vaultproxy.dev";
      const providers = await fetchProviders();

      console.error("Would set:");
      for (const { alias, envVar } of mappings) {
        let keyInfo;
        try {
          keyInfo = await fetchKey(alias);
        } catch {
          keyInfo = null;
        }

        const maskedToken = maskValue(token);
        console.error(`  ${envVar}=${maskedToken}  (proxy token)`);

        if (keyInfo) {
          const provider = providers.find((p) => p.id === keyInfo.provider);
          if (provider?.base_url_env) {
            const baseUrl = `${proxyBase}/proxy/${alias}`;
            console.error(`  ${provider.base_url_env}=${baseUrl}`);
          }
        }
      }
    } else {
      // Dry-run in fetch mode: show alias->envVar without fetching real keys
      console.error("Would set:");
      for (const { alias, envVar } of mappings) {
        console.error(`  ${envVar}=<key for alias "${alias}">`);
      }
    }
    return;
  }

  // --- proxy mode ---
  let results;
  if (isProxyMode) {
    results = await resolveAllProxy(mappings);
  } else {
    results = await resolveAll(mappings);
  }

  if (cmdArgs.length === 0) {
    // Inject-only mode: print export statements
    for (const { envVar, key, extraEnvVar, extraValue } of results) {
      console.log(`export ${envVar}=${shellEscape(key)}`);
      if (extraEnvVar && extraValue) {
        console.log(`export ${extraEnvVar}=${shellEscape(extraValue)}`);
      }
    }
    return;
  }

  // Execute mode: inject keys and run command
  const env = { ...process.env };
  for (const { envVar, key, extraEnvVar, extraValue } of results) {
    env[envVar] = key;
    if (extraEnvVar && extraValue) {
      env[extraEnvVar] = extraValue;
    }
  }

  const cmdString = cmdArgs.join(" ");
  try {
    execSync(cmdString, { env, stdio: "inherit" });
  } catch (err) {
    process.exit(err.status || 1);
  }
}

// --- proxy ---

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const PROXY_PID_FILE = join(homedir(), ".vaultproxy", "proxy.pid");
const PROXY_PORT = process.env.VP_PROXY_PORT || "10255";

async function cmdProxy() {
  const sub = args[1];

  switch (sub) {
    case "start":
      await proxyStart();
      break;
    case "stop":
      proxyStop();
      break;
    case "status":
      proxyStatus();
      break;
    case "trust":
      proxyTrust();
      break;
    default:
      console.error("Usage: vp proxy <start|stop|status|trust>");
      process.exit(1);
  }
}

async function proxyStart() {
  const token = getToken();
  if (!token) {
    console.error("Error: Not logged in. Run: vp login");
    process.exit(1);
  }

  // Check if already running
  if (existsSync(PROXY_PID_FILE)) {
    const pid = parseInt(readFileSync(PROXY_PID_FILE, "utf-8").trim());
    try {
      process.kill(pid, 0); // Check if process exists
      console.error(`Proxy already running (PID ${pid}). Use 'vp proxy stop' first.`);
      process.exit(1);
    } catch {
      // Process not running, clean up stale PID file
      unlinkSync(PROXY_PID_FILE);
    }
  }

  // Find the proxy binary
  const binaryName = "vaultproxy-proxy";
  let binaryPath;

  // Check common locations
  const candidates = [
    join(homedir(), ".vaultproxy", "bin", binaryName),
    join(process.cwd(), "proxy", "target", "release", binaryName),
    join(process.cwd(), binaryName),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      binaryPath = p;
      break;
    }
  }

  // Try PATH
  if (!binaryPath) {
    try {
      execSync(`which ${binaryName}`, { stdio: "pipe" });
      binaryPath = binaryName; // It's in PATH
    } catch {
      // Not found
    }
  }

  if (!binaryPath) {
    console.error(`Error: ${binaryName} not found.`);
    console.error("Install it from: https://github.com/Axis-Labs-HQ/vaultproxy-cloud/releases");
    console.error("Or build from source: cd proxy && cargo build --release");
    console.error(`Then place it in ~/.vaultproxy/bin/ or your PATH.`);
    process.exit(1);
  }

  const cfg = loadConfig();
  const apiUrl = cfg.api_url || "https://api.vaultproxy.dev";

  console.error(`Starting VaultProxy HTTPS proxy on port ${PROXY_PORT}...`);

  const child = spawn(binaryPath, [
    "--port", PROXY_PORT,
    "--control-plane-url", apiUrl,
    "--proxy-token", token,
  ], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, RUST_LOG: "vaultproxy_proxy=info" },
  });

  child.unref();

  // Save PID
  writeFileSync(PROXY_PID_FILE, String(child.pid), { mode: 0o600 });

  console.error(`✓ Proxy started (PID ${child.pid})`);
  console.error(`  Port: ${PROXY_PORT}`);
  console.error(`  CA cert: ~/.vaultproxy/ca/ca.crt`);
  console.error("");
  console.error("To use it:");
  console.error(`  export HTTPS_PROXY=http://localhost:${PROXY_PORT}`);
  console.error("");
  console.error("First time? Trust the CA cert:");
  console.error("  vp proxy trust");
}

function proxyStop() {
  if (!existsSync(PROXY_PID_FILE)) {
    console.error("Proxy is not running.");
    return;
  }

  const pid = parseInt(readFileSync(PROXY_PID_FILE, "utf-8").trim());
  try {
    process.kill(pid, "SIGTERM");
    console.error(`✓ Proxy stopped (PID ${pid})`);
  } catch {
    console.error(`Process ${pid} not found (already stopped).`);
  }
  unlinkSync(PROXY_PID_FILE);
}

function proxyStatus() {
  if (!existsSync(PROXY_PID_FILE)) {
    console.error("Proxy is not running.");
    process.exit(1);
  }

  const pid = parseInt(readFileSync(PROXY_PID_FILE, "utf-8").trim());
  try {
    process.kill(pid, 0);
    console.error(`✓ Proxy is running (PID ${pid}, port ${PROXY_PORT})`);
  } catch {
    console.error(`✗ Proxy is not running (stale PID ${pid})`);
    unlinkSync(PROXY_PID_FILE);
    process.exit(1);
  }
}

function proxyTrust() {
  const caPath = join(homedir(), ".vaultproxy", "ca", "ca.crt");
  const platform = process.platform;

  console.error("Trust the VaultProxy CA certificate:\n");

  if (platform === "darwin") {
    console.error("  macOS:");
    console.error(`  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ${caPath}`);
  } else if (platform === "linux") {
    console.error("  Ubuntu/Debian:");
    console.error(`  sudo cp ${caPath} /usr/local/share/ca-certificates/vaultproxy-ca.crt`);
    console.error("  sudo update-ca-certificates");
    console.error("");
    console.error("  RHEL/Fedora:");
    console.error(`  sudo cp ${caPath} /etc/pki/ca-trust/source/anchors/vaultproxy-ca.crt`);
    console.error("  sudo update-ca-trust");
  } else {
    console.error("  Windows:");
    console.error(`  certutil -addstore -user Root ${caPath}`);
  }

  console.error("");
  console.error("  Node.js (per-process, no system trust needed):");
  console.error(`  export NODE_EXTRA_CA_CERTS=${caPath}`);
  console.error("");
  console.error("  Python (per-process):");
  console.error(`  export REQUESTS_CA_BUNDLE=${caPath}`);

  if (existsSync(caPath)) {
    console.error(`\n  CA cert location: ${caPath}`);
  } else {
    console.error(`\n  ⚠ CA cert not found at ${caPath}`);
    console.error("  Run 'vp proxy start' first to generate it.");
  }
}

// --- helpers ---

function parseMappings(rawArgs) {
  const mappings = [];
  for (const arg of rawArgs) {
    if (arg.startsWith("-")) continue; // skip flags
    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) {
      // Shorthand: alias only, use ALIAS_KEY as env var name
      mappings.push({ alias: arg, envVar: arg.toUpperCase().replace(/-/g, "_") + "_KEY" });
    } else {
      const alias = arg.slice(0, eqIndex);
      const envVar = arg.slice(eqIndex + 1);
      mappings.push({ alias, envVar });
    }
  }
  return mappings;
}

async function resolveAll(mappings) {
  const results = await Promise.all(
    mappings.map(async ({ alias, envVar }) => {
      const result = await fetchKey(alias);
      return { alias, envVar, key: result.key };
    })
  );
  return results;
}

async function resolveAllProxy(mappings) {
  const token = getToken();
  if (!token) {
    throw new Error("Not logged in. Run: vp login");
  }

  const cfg = loadConfig();
  const proxyBase = cfg.proxy_url || "https://proxy.vaultproxy.dev";
  const providers = await fetchProviders();

  const results = await Promise.all(
    mappings.map(async ({ alias, envVar }) => {
      // Always fetch key metadata to get provider info
      const keyInfo = await fetchKey(alias);

      // D4: warn if provider is not proxy_compatible and fall back to fetch mode
      if (!keyInfo.proxy_compatible) {
        console.error(
          `Warning: ${keyInfo.provider} does not support proxy mode (uses request signing). Falling back to fetch mode.`
        );
        return { alias, envVar, key: keyInfo.key };
      }

      // Find provider record for base_url_env
      const provider = providers.find((p) => p.id === keyInfo.provider);

      const extraEnvVar = provider?.base_url_env || null;
      const extraValue = extraEnvVar
        ? `${proxyBase}/proxy/${alias}`
        : null;

      return { alias, envVar, key: token, extraEnvVar, extraValue };
    })
  );
  return results;
}

function maskValue(value) {
  if (!value || value.length <= 8) return value + "...";
  return value.slice(0, 8) + "...";
}

function shellEscape(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
