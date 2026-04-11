'use client';

import { useState, useEffect } from 'react';

interface TokenEntry {
  id: string;
  name: string;
  scopes: string;
  created_at: string;
  expires_at: string | null;
  // Task C4: optional scope fields returned from API
  allowed_aliases?: string[];
  allowed_environments?: string[];
}

const ALL_ENVIRONMENTS = ['production', 'staging', 'development'] as const;
type EnvOption = typeof ALL_ENVIRONMENTS[number];

// Validate alias patterns: alphanumeric, dash, underscore, asterisk only
const ALIAS_PATTERN_RE = /^[a-zA-Z0-9_\-*]+$/;

function parseAliasPatterns(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function validateAliasPatterns(patterns: string[]): string | null {
  for (const p of patterns) {
    if (!ALIAS_PATTERN_RE.test(p)) {
      return `Invalid pattern "${p}". Only alphanumeric, dash, underscore, and asterisk are allowed.`;
    }
  }
  return null;
}

export default function TokensPage() {
  const [tokens, setTokens] = useState<TokenEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const [newToken, setNewToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  // Task C4: scope fields
  const [aliasPatterns, setAliasPatterns] = useState('');
  const [aliasPatternError, setAliasPatternError] = useState('');
  const [selectedEnvironments, setSelectedEnvironments] = useState<EnvOption[]>([]);

  async function loadTokens() {
    try {
      const res = await fetch('/api/tokens');
      if (res.ok) {
        const data = await res.json();
        setTokens(Array.isArray(data) ? data : []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadTokens(); }, []);

  async function handleDelete(tokenId: string) {
    try {
      const res = await fetch(`/api/tokens?id=${tokenId}`, { method: 'DELETE' });
      if (res.ok) {
        setTokens(tokens.filter(t => t.id !== tokenId));
      }
    } catch {
      // silent
    }
  }

  function handleAliasPatternChange(value: string) {
    setAliasPatterns(value);
    // Validate on the fly (only non-empty patterns)
    const patterns = parseAliasPatterns(value);
    if (patterns.length > 0) {
      setAliasPatternError(validateAliasPatterns(patterns) ?? '');
    } else {
      setAliasPatternError('');
    }
  }

  function handleEnvironmentToggle(env: EnvOption) {
    setSelectedEnvironments((prev) =>
      prev.includes(env) ? prev.filter((e) => e !== env) : [...prev, env]
    );
  }

  function resetForm() {
    setTokenName('');
    setAliasPatterns('');
    setAliasPatternError('');
    setSelectedEnvironments([]);
    setError('');
  }

  async function handleCreate() {
    setError('');

    // Validate alias patterns before submitting
    const patterns = parseAliasPatterns(aliasPatterns);
    const patternValidationError = validateAliasPatterns(patterns);
    if (patternValidationError) {
      setAliasPatternError(patternValidationError);
      return;
    }

    setCreating(true);
    try {
      const body: Record<string, unknown> = { name: tokenName };

      // Task C4: include scope fields only when non-empty
      if (patterns.length > 0) {
        body.allowed_aliases = patterns;
      }
      if (selectedEnvironments.length > 0) {
        body.allowed_environments = selectedEnvironments;
      }

      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.message || data.error || 'Failed to create token');
        return;
      }
      const data = await res.json();
      setNewToken(data.token);
      setShowCreate(false);
      resetForm();
      loadTokens();
    } catch {
      setError('Network error');
    } finally {
      setCreating(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const canCreate = tokenName.trim() && !aliasPatternError;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-cream-900">Proxy Tokens</h1>
          <p className="text-sm text-cream-600 mt-1">
            Generate tokens to authenticate your apps with the VaultProxy edge
          </p>
        </div>
        <button
          onClick={() => { setShowCreate(true); setNewToken(''); }}
          className="px-4 py-2 bg-terra text-white text-sm font-medium rounded-md hover:bg-terra-hover transition-colors shrink-0 ml-4"
        >
          Generate token
        </button>
      </div>

      {newToken ? (
        <div className="mt-6 p-5 bg-sage-50 border border-sage-200 rounded-lg animate-fade-in">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-sage-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sage-800">Token created — copy it now</p>
              <p className="text-xs text-sage-600 mt-1">This token will not be shown again.</p>
              <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-white border border-sage-200 rounded text-xs font-mono text-cream-900 break-all select-all">
                  {newToken}
                </code>
                <button
                  onClick={handleCopy}
                  className="px-3 py-2 bg-sage-600 text-white text-xs font-medium rounded hover:bg-sage-700 transition-colors shrink-0"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <div className="mt-3 p-3 bg-white rounded border border-sage-200">
                <p className="text-xs font-medium text-cream-700 mb-1">Usage example:</p>
                <pre className="text-xs text-cream-600 font-mono whitespace-pre-wrap break-all">{`curl https://proxy.vaultproxy.dev/proxy/YOUR_ALIAS/v1/chat/completions \\
  -H "Authorization: Bearer ${newToken.slice(0, 12)}..." \\
  -H "X-Target-URL: https://api.openai.com" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4","messages":[...]}'`}</pre>
              </div>
            </div>
          </div>
        </div>
      ) : showCreate ? (
        <div className="mt-6 animate-fade-in">
          <p className="text-sm text-cream-500 mb-6">
            Proxy tokens authenticate your apps with the VaultProxy edge. Each token can access all keys in your org.
          </p>
          <div className="p-5 bg-white border border-cream-200 rounded-lg">
            <h3 className="text-sm font-semibold text-cream-900 mb-3">Generate a new proxy token</h3>

            {/* Token name */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-cream-500 mb-1">Token name</label>
              <input
                type="text"
                placeholder="e.g. production, staging"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-terra/20 focus:border-terra transition-colors"
              />
            </div>

            {/* Task C4: Alias patterns */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-cream-500 mb-1">
                Alias patterns
                <span className="ml-2 font-normal text-cream-400">optional</span>
              </label>
              <input
                type="text"
                placeholder="e.g. openai-*, anthropic-* (comma-separated)"
                value={aliasPatterns}
                onChange={(e) => handleAliasPatternChange(e.target.value)}
                className={`w-full px-3 py-2 bg-white border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-terra/20 focus:border-terra transition-colors ${
                  aliasPatternError ? 'border-ember-400' : 'border-cream-300'
                }`}
              />
              {aliasPatternError ? (
                <p className="text-xs text-ember-600 mt-1">{aliasPatternError}</p>
              ) : (
                <p className="text-xs text-cream-400 mt-1">
                  Leave empty to allow all aliases. Use <code className="font-mono">*</code> as wildcard.
                </p>
              )}
            </div>

            {/* Task C4: Environment filter */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-cream-500 mb-2">
                Environment filter
                <span className="ml-2 font-normal text-cream-400">optional</span>
              </label>
              <div className="flex flex-wrap gap-3">
                {ALL_ENVIRONMENTS.map((env) => (
                  <label key={env} className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={selectedEnvironments.includes(env)}
                      onChange={() => handleEnvironmentToggle(env)}
                      className="w-3.5 h-3.5 rounded border-cream-300 text-terra focus:ring-terra/20"
                    />
                    <span className="text-sm text-cream-700 capitalize">{env}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-cream-400 mt-1">
                Leave unchecked to allow all environments.
              </p>
            </div>

            {error && <p className="text-sm text-ember-600 mt-2">{error}</p>}

            <div className="flex items-center justify-end gap-3 mt-4">
              <button
                onClick={() => { setShowCreate(false); resetForm(); }}
                className="px-4 py-2 text-sm text-cream-600 hover:text-cream-800 transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={!canCreate || creating}
                onClick={handleCreate}
                className="px-4 py-2 bg-terra text-white text-sm font-medium rounded-md hover:bg-terra-hover disabled:opacity-50 transition-colors shrink-0"
              >
                {creating ? 'Generating\u2026' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-10 py-16 text-center">
          <p className="text-sm text-cream-600">Loading tokens...</p>
        </div>
      ) : tokens.length === 0 && !newToken && !showCreate ? (
        <div className="mt-10 py-16 text-center">
          <p className="text-sm text-cream-600">No active tokens</p>
          <p className="text-sm text-cream-500 mt-2 max-w-xs mx-auto">
            Generate a token to authenticate your apps with the edge proxy.
          </p>
        </div>
      ) : tokens.length > 0 ? (
        <div className="mt-6 border border-cream-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cream-50 border-b border-cream-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-cream-700">Name</th>
                {/* Task C4: Scopes column */}
                <th className="text-left px-4 py-3 font-medium text-cream-700">Scopes</th>
                <th className="text-left px-4 py-3 font-medium text-cream-700">Created</th>
                <th className="text-left px-4 py-3 font-medium text-cream-700">Expires</th>
                <th className="text-right px-4 py-3 font-medium text-cream-700"></th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => {
                const hasAliases = t.allowed_aliases && t.allowed_aliases.length > 0;
                const hasEnvs = t.allowed_environments && t.allowed_environments.length > 0;
                const isUnrestricted = !hasAliases && !hasEnvs;

                return (
                  <tr key={t.id} className="border-b border-cream-100 last:border-0">
                    <td className="px-4 py-3 text-cream-900 font-medium">{t.name}</td>
                    {/* Task C4: scope badges */}
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {isUnrestricted ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-cream-100 text-cream-500">
                            all
                          </span>
                        ) : (
                          <>
                            {hasAliases && t.allowed_aliases!.map((pattern) => (
                              <span
                                key={pattern}
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-sage-100 text-sage-700 font-mono"
                              >
                                {pattern}
                              </span>
                            ))}
                            {hasEnvs && t.allowed_environments!.map((env) => (
                              <span
                                key={env}
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-cream-100 text-cream-600 capitalize"
                              >
                                {env}
                              </span>
                            ))}
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-cream-600">{new Date(t.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-cream-600">{t.expires_at ? new Date(t.expires_at).toLocaleDateString() : 'Never'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="text-xs text-red-500 hover:text-red-700 transition-colors"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
