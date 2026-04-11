'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface ApiKey {
  id: string;
  name: string;
  provider: string;
  key_prefix: string;
  alias: string;
  is_active: boolean;
  created_at: string;
}

interface ProviderInfo {
  id: string;
  name: string;
  base_url?: string;
  base_url_env?: string;
  proxy_compatible: boolean;
}

const FALLBACK_PROVIDERS: ProviderInfo[] = [
  { id: 'openai', name: 'OpenAI', proxy_compatible: true },
  { id: 'anthropic', name: 'Anthropic', proxy_compatible: true },
  { id: 'stripe', name: 'Stripe', proxy_compatible: false },
  { id: 'other', name: 'Other', proxy_compatible: true },
];

const ENVIRONMENTS = ['production', 'staging', 'development'] as const;
type Environment = typeof ENVIRONMENTS[number];

function getNextAlias(provider: string, existingKeys: ApiKey[]): string {
  const prefix = provider.toLowerCase();
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);

  const usedNumbers = existingKeys
    .map((k) => k.alias.match(pattern))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => parseInt(m[1], 10));

  const next = usedNumbers.length === 0 ? 1 : Math.max(...usedNumbers) + 1;
  return `${prefix}-${next}`;
}

export default function KeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Provider registry (Task C1)
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);

  const [name, setName] = useState('');
  const [provider, setProvider] = useState('');
  const [rawKey, setRawKey] = useState('');
  const [alias, setAlias] = useState('');
  const [aliasManuallyEdited, setAliasManuallyEdited] = useState(false);
  // Task C3: environment field
  const [environment, setEnvironment] = useState<Environment>('production');

  // Task C1: fetch providers from API with fallback
  useEffect(() => {
    const apiBase =
      (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) ||
      'https://api.vaultproxy.dev';
    fetch(`${apiBase}/api/v1/providers`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: ProviderInfo[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setProviders(data);
        } else {
          setProviders(FALLBACK_PROVIDERS);
        }
      })
      .catch(() => setProviders(FALLBACK_PROVIDERS))
      .finally(() => setProvidersLoading(false));
  }, []);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/keys');
      if (res.ok) {
        const data = await res.json();
        setKeys(Array.isArray(data) ? data : []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  useEffect(() => {
    if (provider && !aliasManuallyEdited) {
      setAlias(getNextAlias(provider, keys));
    }
  }, [provider, keys, aliasManuallyEdited]);

  const suggestedAlias = useMemo(() => {
    if (!provider) return '';
    return getNextAlias(provider, keys);
  }, [provider, keys]);

  // Task C2: look up proxy_compatible for a given provider name
  function getProviderInfo(providerName: string): ProviderInfo | undefined {
    return providers.find(
      (p) => p.name.toLowerCase() === providerName.toLowerCase() ||
             p.id.toLowerCase() === providerName.toLowerCase()
    );
  }

  function handleProviderChange(value: string) {
    setProvider(value);
    setAliasManuallyEdited(false);
  }

  function handleAliasChange(value: string) {
    setAlias(value);
    setAliasManuallyEdited(true);
  }

  async function handleCreate() {
    setError('');
    setCreating(true);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Task C3: include environment in POST body
        body: JSON.stringify({ name, provider, key: rawKey, alias, environment }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.message || data.error || 'Failed to create key');
        return;
      }
      setShowCreate(false);
      setName('');
      setProvider('');
      setRawKey('');
      setAlias('');
      setAliasManuallyEdited(false);
      setEnvironment('production');
      fetchKeys();
    } catch {
      setError('Network error');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(keyId: string) {
    await fetch(`/api/keys/${keyId}`, { method: 'DELETE' });
    setConfirmDelete(null);
    fetchKeys();
  }

  const canCreate = name.trim() && provider.trim() && rawKey.trim() && alias.trim();
  const isEmpty = !loading && keys.length === 0;

  const createForm = (
    <div className="p-5 bg-white border border-cream-200 rounded-lg">
      <h3 className="text-sm font-semibold text-cream-900 mb-4">Add a new API key</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-cream-500 mb-1">Name</label>
          <input
            type="text"
            placeholder="e.g. OpenAI Production"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-terra/20 focus:border-terra transition-colors"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-cream-500 mb-1">Provider</label>
          <select
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value)}
            disabled={providersLoading}
            className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-terra/20 focus:border-terra transition-colors disabled:opacity-60"
          >
            <option value="" disabled>
              {providersLoading ? 'Loading providers...' : 'Select a provider...'}
            </option>
            {providers.map((p) => (
              <option key={p.id} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-cream-500 mb-1">
            Alias
            {provider && !aliasManuallyEdited && (
              <span className="ml-2 text-terra font-normal">auto-filled</span>
            )}
          </label>
          <input
            type="text"
            placeholder="e.g. openai-1 (used in proxy URL)"
            value={alias}
            onChange={(e) => handleAliasChange(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-terra/20 focus:border-terra transition-colors"
          />
          {aliasManuallyEdited && suggestedAlias && (
            <button
              type="button"
              onClick={() => { setAlias(suggestedAlias); setAliasManuallyEdited(false); }}
              className="text-xs text-terra hover:text-terra-hover mt-1 transition-colors"
            >
              Reset to suggested: {suggestedAlias}
            </button>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-cream-500 mb-1">API Key</label>
          <input
            type="password"
            placeholder="sk-... (encrypted at rest)"
            value={rawKey}
            onChange={(e) => setRawKey(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-terra/20 focus:border-terra transition-colors"
          />
        </div>
        {/* Task C3: Environment dropdown */}
        <div>
          <label className="block text-xs font-medium text-cream-500 mb-1">
            Environment
            <span className="ml-2 font-normal text-cream-400">optional</span>
          </label>
          <select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as Environment)}
            className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-terra/20 focus:border-terra transition-colors"
          >
            {ENVIRONMENTS.map((env) => (
              <option key={env} value={env}>
                {env.charAt(0).toUpperCase() + env.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="text-sm text-ember-600 mt-3">{error}</p>}
      <div className="flex justify-end gap-3 mt-4">
        {!isEmpty && (
          <button
            onClick={() => { setShowCreate(false); setError(''); }}
            className="px-4 py-2 text-sm text-cream-600 hover:text-cream-800 transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          disabled={!canCreate || creating}
          onClick={handleCreate}
          className="px-4 py-2 bg-terra text-white text-sm font-medium rounded-md hover:bg-terra-hover disabled:opacity-50 transition-colors"
        >
          {creating ? 'Encrypting\u2026' : 'Store key'}
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-cream-900">API Keys</h1>
          <p className="text-sm text-cream-600 mt-1">
            Store your real API keys securely. VaultProxy encrypts them and gives you proxy aliases.
          </p>
        </div>
        {keys.length > 0 && !showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-terra text-white text-sm font-medium rounded-md hover:bg-terra-hover transition-colors shrink-0 ml-4"
          >
            Add key
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-cream-500 mt-8">Loading keys\u2026</p>
      ) : isEmpty ? (
        <div className="mt-8 animate-fade-in">
          <p className="text-sm text-cream-500 mb-6">
            Your real keys are encrypted at rest and resolved at the edge. Add your first one below.
          </p>
          {createForm}
        </div>
      ) : (
        <>
          {showCreate && (
            <div className="mt-6 animate-fade-in">
              {createForm}
            </div>
          )}
          <div className="mt-6 bg-white border border-cream-200 rounded-lg divide-y divide-cream-100">
            {keys.map((key) => {
              // Task C2: determine proxy compatibility badge
              const providerInfo = getProviderInfo(key.provider);
              // Unknown providers default to proxy-compatible per spec
              const isProxyCompatible = providerInfo ? providerInfo.proxy_compatible : true;

              return (
                <div key={key.id} className="flex items-center justify-between px-4 py-3.5 md:px-5 gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-cream-900">{key.name}</p>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-cream-100 text-cream-600">
                        {key.provider}
                      </span>
                      {/* Task C2: proxy compatibility badge */}
                      {isProxyCompatible ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-sage-100 text-sage-700">
                          proxy
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-cream-100 text-cream-500">
                          fetch only
                        </span>
                      )}
                      {!key.is_active && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-ember-100 text-ember-700">
                          inactive
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 mt-0.5">
                      <p className="text-xs text-cream-500 font-mono">{key.key_prefix}{'........'}</p>
                      <p className="text-xs text-cream-500">alias: <span className="font-mono">{key.alias}</span></p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <p className="text-xs text-cream-500 hidden sm:block">{new Date(key.created_at).toLocaleDateString()}</p>
                    {confirmDelete === key.id ? (
                      <div className="flex items-center gap-2 animate-fade-in">
                        <span className="text-xs text-ember-600">Delete?</span>
                        <button
                          onClick={() => handleDelete(key.id)}
                          className="text-xs font-medium text-ember-600 hover:text-ember-700 transition-colors"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="text-xs text-cream-500 hover:text-cream-700 transition-colors"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(key.id)}
                        className="p-1 text-cream-400 hover:text-ember-600 transition-colors"
                        title="Delete key"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
