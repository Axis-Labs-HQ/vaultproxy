import type { Context } from "hono";
import { purgeAlias } from "../lib/cache";

/**
 * Purge handler — invalidates cached alias entries from in-memory cache.
 * Requires PURGE_SECRET for authentication.
 */
export async function purgeHandler(c: Context) {
  const alias = c.req.param("alias");
  const secret = c.env.PURGE_SECRET as string | undefined;
  const providedSecret = c.req.header("X-Purge-Secret");

  if (!secret) {
    return c.json({ error: "PURGE_NOT_CONFIGURED" }, 503);
  }

  if (providedSecret !== secret) {
    return c.json({ error: "UNAUTHORIZED" }, 401);
  }

  purgeAlias(alias || "");
  return c.json({ purged: alias });
}
