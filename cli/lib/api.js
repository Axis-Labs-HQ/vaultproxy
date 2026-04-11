import { getApiUrl, getToken } from "./config.js";

let _providersCache = null;

export async function fetchProviders() {
  if (_providersCache) return _providersCache;
  try {
    const url = `${getApiUrl()}/api/v1/providers`;
    const res = await fetch(url);
    if (!res.ok) return [];
    _providersCache = await res.json();
    return _providersCache;
  } catch {
    return [];
  }
}

export async function fetchKey(alias) {
  const token = getToken();
  if (!token) {
    throw new Error("Not logged in. Run: vp login");
  }

  const url = `${getApiUrl()}/internal/fetch/${encodeURIComponent(alias)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) throw new Error("Invalid or expired token. Run: vp login");
  if (res.status === 404) throw new Error(`Key alias "${alias}" not found`);
  if (res.status === 429) throw new Error("Rate limit exceeded");
  if (!res.ok) throw new Error(`API error: ${res.status}`);

  return res.json();
}

export async function listKeys() {
  const token = getToken();
  if (!token) {
    throw new Error("Not logged in. Run: vp login");
  }

  const url = `${getApiUrl()}/internal/keys`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return [];
  return res.json();
}
