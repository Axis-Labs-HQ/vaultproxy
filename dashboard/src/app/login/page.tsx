'use client';

import { Suspense, useState, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { signIn } from '@/lib/auth-client';
import { GitHubIcon } from '@/components/icons/github-icon';

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') ?? '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleEmailSignIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? 'Sign in failed. Please check your credentials.');
        return;
      }
      router.push(next);
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleGitHubSignIn() {
    setError(null);
    try {
      const result = await signIn.social({ provider: 'github', callbackURL: next });
      if (result?.data?.url) {
        window.location.href = result.data.url;
      }
    } catch {
      setError('GitHub sign in failed. Please try again.');
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-sm px-6 py-10">
        <p className="text-xs font-semibold text-terra tracking-widest uppercase mb-8">VaultProxy</p>
        <h1 className="text-2xl font-bold text-cream-900 mb-1">Sign in</h1>
        <p className="text-sm text-cream-600 mb-8">
          No account?{' '}
          <Link href="/register" className="text-terra hover:text-terra-hover transition-colors">
            Create one
          </Link>
        </p>

        <form onSubmit={handleEmailSignIn} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-cream-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              disabled={loading}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-cream-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-terra/20 focus:border-terra disabled:opacity-50 transition-colors"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-cream-700 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              disabled={loading}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
            {loading ? 'Signing in\u2026' : 'Sign in'}
          </button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-cream-200" />
          </div>
          <div className="relative flex justify-center text-xs text-cream-500">
            <span className="bg-cream-50 px-3">or</span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleGitHubSignIn}
          className="w-full flex items-center justify-center gap-2 py-2 px-4 border border-cream-300 text-sm font-medium text-cream-700 rounded-md hover:bg-cream-100 focus:outline-none focus:ring-2 focus:ring-terra/20 focus:ring-offset-2 transition-colors"
        >
          <GitHubIcon />
          Sign in with GitHub
        </button>
      </div>
    </main>
  );
}
