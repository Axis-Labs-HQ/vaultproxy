export interface ResolvedAlias {
  key: string;
  alias: string;
  resolvedAt: number;
}

/**
 * Resolve a key alias to the real API key.
 * Uses KV cache with 60s TTL to minimize control plane round-trips.
 */
export async function resolveKey(
  alias: string,
  controlPlaneUrl: string,
  proxyToken: string,
  cache?: KVNamespace,
): Promise<string | null> {
  // Check cache first
  if (cache) {
    const cached = await cache.get(`key:${alias}`);
    if (cached) return cached;
  }

  // Resolve from control plane
  const res = await fetch(`${controlPlaneUrl}/internal/resolve/${alias}`, {
    headers: { Authorization: `Bearer ${proxyToken}` },
  });

  if (!res.ok) return null;

  const { key } = (await res.json()) as ResolvedAlias;

  // Cache for 60s
  if (cache && key) {
    await cache.put(`key:${alias}`, key, { expirationTtl: 60 });
  }

  return key;
}
