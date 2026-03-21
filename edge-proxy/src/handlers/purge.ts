import type { Context } from "hono";

/**
 * Purge handler — invalidates a cached alias entry from KV.
 *
 * Requires a valid HMAC signature in the X-Purge-Signature header to
 * prevent unauthorized cache invalidation.
 */
export async function purgeHandler(c: Context) {
  const alias = c.req.param("alias");
  const signature = c.req.header("X-Purge-Signature") ?? "";
  const secret = c.env.PURGE_SECRET as string | undefined;

  if (!secret) {
    return c.json({ error: "PURGE_NOT_CONFIGURED", message: "Purge endpoint is not configured" }, 503);
  }

  // Compute expected HMAC-SHA256 signature over the alias
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    keyMaterial,
    new TextEncoder().encode(alias),
  );

  const expected = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison to prevent timing attacks
  const enc = new TextEncoder();
  const a = enc.encode(expected);
  const b = enc.encode(signature);
  if (a.byteLength !== b.byteLength || !crypto.subtle.timingSafeEqual(a, b)) {
    return c.json({ error: "INVALID_SIGNATURE", message: "Invalid purge signature" }, 401);
  }

  // Evict from KV cache
  const cache = c.env.CACHE as KVNamespace | undefined;
  if (cache) {
    await cache.delete(`key:${alias}`);
  }

  return c.json({ purged: alias });
}
