import type { Context } from "hono";
import { resolveKey } from "../lib/cache";

// VULN-001: Private/reserved IP ranges that must be blocked for SSRF protection
const BLOCKED_HOSTS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /\.internal$/i,
  /\.local$/i,
  /\.railway\.internal$/i,
];

function isUnsafeUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== "https:") return true;
    for (const pattern of BLOCKED_HOSTS) {
      if (pattern.test(u.hostname)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Core proxy handler.
 *
 * Flow:
 * 1. Extract alias from path (/proxy/:alias/*)
 * 2. Resolve alias → real API key + target_url via control plane (cached)
 * 3. Rewrite the request: strip /proxy/:alias prefix, inject real key
 * 4. Forward to the target API
 * 5. Stream the response back to the client
 */
export async function proxyHandler(c: Context) {
  const alias = c.req.param("alias") as string;
  const controlPlaneUrl = c.env.CONTROL_PLANE_URL as string;
  const proxyToken = c.get("proxyToken") as string;

  // 1. Resolve the alias to a real API key (PERF-003: uses cached resolveKey)
  const resolved = await resolveKey(alias, controlPlaneUrl, proxyToken);
  if (!resolved) {
    return c.json({ error: "Unknown key alias or inactive key" }, 404);
  }

  // 2. Build the target URL (strip /proxy/:alias from the path)
  const url = new URL(c.req.url);
  const proxyPrefix = `/proxy/${alias}`;
  const targetPath = url.pathname.slice(proxyPrefix.length) || "/";

  // Auto-resolve target URL from control plane, fall back to X-Target-URL header
  const headerTarget = c.req.header("X-Target-URL");
  const targetBase = resolved.targetUrl || headerTarget;
  if (!targetBase) {
    return c.json({ error: "No target URL configured for this key" }, 400);
  }

  // VULN-001: Validate target URL to prevent SSRF
  if (isUnsafeUrl(targetBase)) {
    return c.json({ error: "Invalid target URL: must be HTTPS and public" }, 400);
  }

  const targetUrl = `${targetBase}${targetPath}${url.search}`;

  // 3. Build clean outbound headers (don't forward hop-by-hop or proxy headers)
  const outHeaders: Record<string, string> = {
    Authorization: `Bearer ${resolved.key}`,
    "Content-Type": c.req.header("Content-Type") || "application/json",
    Accept: c.req.header("Accept") || "*/*",
  };
  const userAgent = c.req.header("User-Agent");
  if (userAgent) outHeaders["User-Agent"] = userAgent;

  // 4. Forward the request
  const hasBody = c.req.method !== "GET" && c.req.method !== "HEAD";
  const body = hasBody ? await c.req.text() : undefined;

  const response = await fetch(targetUrl, {
    method: c.req.method,
    headers: outHeaders,
    body,
  });

  // 5. Fire metering (best-effort, non-blocking)
  fireMeter(controlPlaneUrl, proxyToken, alias, response.status);

  // 6. Stream the response back (SF-2: don't buffer — supports SSE/streaming)
  const resHeaders = new Headers();
  const contentType = response.headers.get("Content-Type");
  if (contentType) resHeaders.set("Content-Type", contentType);
  const rateLimit = response.headers.get("X-RateLimit-Remaining");
  if (rateLimit) resHeaders.set("X-RateLimit-Remaining", rateLimit);

  return new Response(response.body, {
    status: response.status,
    headers: resHeaders,
  });
}

/**
 * Send a best-effort metering event to the control plane.
 */
async function fireMeter(
  controlPlaneUrl: string,
  proxyToken: string,
  alias: string,
  statusCode: number
): Promise<void> {
  try {
    await fetch(`${controlPlaneUrl}/internal/meter`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${proxyToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ alias, statusCode, ts: Date.now() }),
    });
  } catch {
    // metering is best-effort
  }
}
