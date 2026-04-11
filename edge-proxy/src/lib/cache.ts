export interface ResolveResult {
  key: string;
  targetUrl: string | null;
}

// SF-9: In-memory cache with token-scoped keys and explicit eviction.
// Cache key includes a hash of the proxy token to prevent cross-token
// cache hits that would bypass scope enforcement.
const memCache = new Map<string, { key: string; targetUrl: string | null; expiresAt: number }>();

function cacheKey(alias: string, tokenPrefix: string): string {
  return `${tokenPrefix}:${alias}`;
}

/**
 * Resolve a key alias to the real API key.
 * Uses in-memory cache with 30s TTL to minimize control plane round-trips.
 * SF-9: Cache key includes token prefix for scope isolation.
 */
export async function resolveKey(
  alias: string,
  controlPlaneUrl: string,
  proxyToken: string,
): Promise<ResolveResult | null> {
  const tokenPrefix = proxyToken.slice(0, 16);
  const ck = cacheKey(alias, tokenPrefix);

  // Check in-memory cache
  const cached = memCache.get(ck);
  if (cached && cached.expiresAt > Date.now()) {
    return { key: cached.key, targetUrl: cached.targetUrl };
  }

  // Resolve from control plane (with timeout from SF-1)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${controlPlaneUrl}/internal/resolve/${alias}`, {
      headers: { Authorization: `Bearer ${proxyToken}` },
      signal: controller.signal,
    });

    if (!res.ok) return null;

    const data = (await res.json()) as { key: string; target_url?: string | null };

    // Cache for 30s (reduced from 60s to limit revocation window)
    if (data.key) {
      const targetUrl = data.target_url ?? null;
      memCache.set(ck, { key: data.key, targetUrl, expiresAt: Date.now() + 30_000 });
      return { key: data.key, targetUrl };
    }

    return null;
  } catch {
    // On timeout/error, try stale cache as fallback (max 60s stale)
    if (cached && Date.now() - cached.expiresAt < 60_000) {
      return { key: cached.key, targetUrl: cached.targetUrl };
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Purge cached entries for an alias (called on key deactivation/deletion/rotation).
 */
export function purgeAlias(alias: string): void {
  for (const [key] of memCache) {
    if (key.endsWith(`:${alias}`)) {
      memCache.delete(key);
    }
  }
}

/**
 * Purge all cached entries for a token prefix (called on token revocation).
 */
export function purgeToken(tokenPrefix: string): void {
  for (const [key] of memCache) {
    if (key.startsWith(`${tokenPrefix}:`)) {
      memCache.delete(key);
    }
  }
}
