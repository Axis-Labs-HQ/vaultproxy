import type { Context, Next } from "hono";

/**
 * Validates the proxy token in the Authorization header.
 * Clients authenticate to the edge proxy with their proxy token,
 * which is different from the actual API key being proxied.
 */
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader?.startsWith("Bearer vp_")) {
    return c.json({ error: "Missing or invalid proxy token" }, 401);
  }

  // Store token for use in resolve requests to control plane
  c.set("proxyToken", authHeader.replace("Bearer ", ""));

  await next();
}
