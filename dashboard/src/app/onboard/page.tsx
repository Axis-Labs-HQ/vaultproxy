'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

export default function OnboardPage() {
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const slug = orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      const result = await authClient.organization.create({
        name: orgName,
        slug,
      });

      if (result.error) {
        throw new Error(result.error.message ?? 'Failed to create organization');
      }

      await authClient.organization.setActive({
        organizationId: result.data!.id,
      });

      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm px-6 py-10">
        <p className="text-xs font-semibold text-terra tracking-widest uppercase mb-8">VaultProxy</p>
        <h1 className="text-2xl font-bold text-cream-900 mb-1">Create your organization</h1>
        <p className="text-sm text-cream-600 mb-8">
          Give your team a home in VaultProxy.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="orgName" className="block text-sm font-medium text-cream-700 mb-1">
              Organization name
            </label>
            <input
              id="orgName"
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              required
              disabled={loading}
              className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-terra/20 focus:border-terra disabled:opacity-50 transition-colors"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-ember-600">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-terra text-white text-sm font-medium rounded-md hover:bg-terra-hover focus:outline-none focus:ring-2 focus:ring-terra/20 focus:ring-offset-2 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Creating\u2026' : 'Create organization'}
          </button>
        </form>
      </div>
    </main>
  );
}
