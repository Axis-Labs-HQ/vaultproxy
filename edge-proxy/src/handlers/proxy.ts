import type { Context } from "hono";
import { resolveKey } from "../lib/cache";

/**
 * Core proxy handler.
 *
 * Flow:
 * 1. Extract alias from path (/proxy/:alias/*)
 * 2. Resolve alias → real API key via control plane (with KV cache)
 * 3. Rewrite the request: strip /proxy/:alias prefix, inject real key
 * 4. Forward to the target API
 * 5. Stream the response back to the client
 * 6. Fire a metering event to the control plane (best-effort)
 */
export async function proxyHandler(c: Context) {
  const alias = c.req.param("alias") as string;
  const controlPlaneUrl = c.env.CONTROL_PLANE_URL as string;
  const proxyToken = c.get("proxyToken") as string;

  // 1. Resolve the alias to a real API key
  const realKey = await resolveKey(alias, controlPlaneUrl, proxyToken, c.env.CACHE as KVNamespace | undefined);
  if (!realKey) {
    return c.json({ error: "Unknown key alias or inactive key" }, 404);
  }

  // 2. Build the target URL (strip /proxy/:alias from the path)
  const url = new URL(c.req.url);
  const proxyPrefix = `/proxy/${alias}`;
  const targetPath = url.pathname.slice(proxyPrefix.length);

  // TODO: resolve target base URL from alias config
  // For now, expect X-Target-URL header from client
  const targetBase = c.req.header("X-Target-URL");
  if (!targetBase) {
    return c.json({ error: "X-Target-URL header required (will be auto-resolved in v2)" }, 400);
  }

  const targetUrl = `${targetBase}${targetPath}${url.search}`;

  // 3. Clone headers, inject real key
  const headers = new Headers(c.req.raw.headers);
  headers.set("Authorization", `Bearer ${realKey}`);
  headers.delete("X-Target-URL");

  // 4. Forward the request
  const response = await fetch(targetUrl, {
    method: c.req.method,
    headers,
    body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
  });

  // 5. Fire a metering event — use the same authenticated proxyToken, not the env binding
  c.executionCtx.waitUntil(
    fireMeter(controlPlaneUrl, proxyToken, alias, response.status),
  );

  // 6. Stream the response back
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

/**
 * Send a best-effort metering event to the control plane.
 * Uses the proxyToken authenticated by the auth middleware.
 */
async function fireMeter(
  controlPlaneUrl: string,
  proxyToken: string,
  alias: string,
  statusCode: number,
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
    // metering is best-effort; never let it break the proxy response
  }
}
