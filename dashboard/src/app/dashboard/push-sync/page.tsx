'use client';

import { useCallback, useEffect, useState } from 'react';

interface PushTarget {
  id: string;
  platform: string;
  env_var: string;
  mode: string;
  alias: string;
  last_synced: string | null;
}

interface ApiKey {
  id: string;
  name: string;
  alias: string;
  provider: string;
}

const PLATFORMS = [
  { id: 'railway', name: 'Railway', configFields: ['api_token', 'project_id', 'service_id', 'environment_id'] },
  { id: 'vercel', name: 'Vercel', configFields: ['access_token', 'project_id', 'team_id'] },
  { id: 'render', name: 'Render', configFields: ['api_key', 'service_id'] },
  { id: 'netlify', name: 'Netlify', configFields: ['access_token', 'account_id', 'site_id'] },
  { id: 'flyio', name: 'Fly.io', configFields: ['access_token', 'app_id'] },
] as const;

const FIELD_LABELS: Record<string, string> = {
  api_token: 'API Token',
  access_token: 'Access Token',
  api_key: 'API Key',
  project_id: 'Project ID',
  service_id: 'Service ID',
  environment_id: 'Environment ID',
  team_id: 'Team ID (optional)',
  account_id: 'Account ID',
  site_id: 'Site ID',
  app_id: 'App Name / ID',
};

export default function PushSyncPage() {
  const [targets, setTargets] = useState<PushTarget[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [error, setError] = useState('');

  // Form state
  const [selectedKeyId, setSelectedKeyId] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState('');
  const [envVar, setEnvVar] = useState('');
  const [mode, setMode] = useState<'fetch' | 'proxy'>('fetch');
  const [config, setConfig] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    try {
      const [targetsRes, keysRes] = await Promise.all([
        fetch('/api/push-targets'),
        fetch('/api/keys'),
      ]);
      if (targetsRes.ok) {
        const data = await targetsRes.json();
        setTargets(Array.isArray(data) ? data : []);
      }
      if (keysRes.ok) {
        const data = await keysRes.json();
        setKeys(Array.isArray(data) ? data : []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const platform = PLATFORMS.find(p => p.id === selectedPlatform);

  function resetForm() {
    setSelectedKeyId('');
    setSelectedPlatform('');
    setEnvVar('');
    setMode('fetch');
    setConfig({});
    setError('');
  }

  async function handleCreate() {
    setError('');
    setCreating(true);
    try {
      const res = await fetch('/api/push-targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key_id: selectedKeyId,
          platform: selectedPlatform,
          env_var: envVar,
          mode,
          config,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.message || data.error || 'Failed to create push target');
        return;
      }
      setShowCreate(false);
      resetForm();
      fetchData();
    } catch {
      setError('Network error');
    } finally {
      setCreating(false);
    }
  }

  async function handleSync(targetId: string) {
    setSyncing(targetId);
    try {
      const res = await fetch(`/api/push-targets/sync?id=${targetId}`, { method: 'POST' });
      if (!res.ok && res.status !== 204) {
        const data = await res.json();
        setError(data.message || 'Sync failed');
      }
      fetchData();
    } catch {
      setError('Sync failed');
    } finally {
      setSyncing(null);
    }
  }

  const canCreate = selectedKeyId && selectedPlatform && envVar.trim();
  const isEmpty = !loading && targets.length === 0;

  const createForm = (
    <div className="p-5 bg-white border border-cream-200 rounded-lg">
      <h3 className="text-sm font-semibold text-cream-900 mb-4">Connect a deployment platform</h3>

      <div className="space-y-4">
        {/* Step 1: Select key */}
        <div>
          <label className="block text-xs font-medium text-cream-500 mb-1">API Key</label>
          <select
            value={selectedKeyId}
            onChange={(e) => setSelectedKeyId(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-terra/20 focus:border-terra transition-colors"
          >
            <option value="" disabled>Select a key to push...</option>
            {keys.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name} ({k.alias}) — {k.provider}
              </option>
            ))}
          </select>
        </div>

        {/* Step 2: Select platform */}
        <div>
          <label className="block text-xs font-medium text-cream-500 mb-1">Platform</label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setSelectedPlatform(p.id); setConfig({}); }}
                className={`px-3 py-2 text-sm rounded-md border transition-colors ${
                  selectedPlatform === p.id
                    ? 'border-terra bg-terra/5 text-terra font-medium'
                    : 'border-cream-200 text-cream-600 hover:border-cream-400'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Step 3: Env var name */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-cream-500 mb-1">Environment Variable Name</label>
            <input
              type="text"
              placeholder="e.g. OPENAI_API_KEY"
              value={envVar}
              onChange={(e) => setEnvVar(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-terra/20 focus:border-terra transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-cream-500 mb-1">Mode</label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'fetch' | 'proxy')}
              className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-terra/20 focus:border-terra transition-colors"
            >
              <option value="fetch">Fetch (push real key)</option>
              <option value="proxy">Proxy (push proxy token + base URL)</option>
            </select>
          </div>
        </div>

        {/* Step 4: Platform config */}
        {platform && (
          <div>
            <label className="block text-xs font-medium text-cream-500 mb-2">
              {platform.name} Configuration
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {platform.configFields.map((field) => (
                <div key={field}>
                  <label className="block text-xs text-cream-400 mb-1">
                    {FIELD_LABELS[field] || field}
                  </label>
                  <input
                    type={field.includes('token') || field.includes('key') ? 'password' : 'text'}
                    placeholder={FIELD_LABELS[field] || field}
                    value={config[field] || ''}
                    onChange={(e) => setConfig({ ...config, [field]: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-terra/20 focus:border-terra transition-colors"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-ember-600 mt-3">{error}</p>}

      <div className="flex justify-end gap-3 mt-5">
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
          {creating ? 'Connecting\u2026' : 'Connect platform'}
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-cream-900">Push Sync</h1>
          <p className="text-sm text-cream-600 mt-1">
            Push your API keys to deployment platforms as environment variables. One click to sync.
          </p>
        </div>
        {targets.length > 0 && !showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 bg-terra text-white text-sm font-medium rounded-md hover:bg-terra-hover transition-colors shrink-0 ml-4"
          >
            Add connection
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-cream-500 mt-8">Loading connections\u2026</p>
      ) : isEmpty ? (
        <div className="mt-8 animate-fade-in">
          <p className="text-sm text-cream-500 mb-6">
            Connect a deployment platform to push your API keys as env vars. Supports Railway, Vercel, Render, Netlify, and Fly.io.
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
            {targets.map((target) => (
              <div key={target.id} className="flex items-center justify-between px-4 py-3.5 md:px-5 gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-cream-900 capitalize">{target.platform}</p>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
                      target.mode === 'proxy'
                        ? 'bg-sage-100 text-sage-700'
                        : 'bg-cream-100 text-cream-600'
                    }`}>
                      {target.mode}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 mt-0.5">
                    <p className="text-xs text-cream-500">
                      <span className="font-mono">{target.env_var}</span>
                      {' \u2192 '}
                      <span className="font-mono">{target.alias}</span>
                    </p>
                    {target.last_synced && (
                      <p className="text-xs text-cream-400">
                        Last synced: {new Date(target.last_synced).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => handleSync(target.id)}
                  disabled={syncing === target.id}
                  className="px-3 py-1.5 text-sm font-medium text-terra border border-terra/30 rounded-md hover:bg-terra/5 disabled:opacity-50 transition-colors shrink-0"
                >
                  {syncing === target.id ? 'Syncing\u2026' : 'Sync now'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
