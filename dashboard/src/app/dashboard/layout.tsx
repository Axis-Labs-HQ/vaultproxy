'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { signOut, useSession } from '@/lib/auth-client';
import { OrgSwitcher } from '@/components/org-switcher';

const NAV_ITEMS = [
  { label: 'Overview', href: '/dashboard' },
  { label: 'Keys', href: '/dashboard/keys' },
  { label: 'Tokens', href: '/dashboard/tokens' },
  { label: 'Push Sync', href: '/dashboard/push-sync' },
  { label: 'Usage', href: '/dashboard/usage' },
  { label: 'Settings', href: '/dashboard/settings' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const [navOpen, setNavOpen] = useState(false);

  async function handleSignOut() {
    await signOut();
    router.push('/login');
  }

  const sidebarContent = (
    <>
      <div className="px-4 pt-5 pb-3">
        <p className="text-[11px] font-bold text-terra tracking-[0.2em] uppercase mb-4">VaultProxy</p>
        <OrgSwitcher />
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setNavOpen(false)}
              className={`block px-3 py-1.5 text-sm rounded-md transition-colors ${
                active
                  ? 'text-terra font-medium'
                  : 'text-cream-600 hover:text-cream-800'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-cream-200">
        <div className="flex items-center gap-2.5 px-3 py-1.5">
          <div className="w-7 h-7 rounded-full bg-cream-200 flex items-center justify-center text-xs font-medium text-cream-700 shrink-0">
            {session?.user?.name?.charAt(0)?.toUpperCase() ?? '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-cream-800 truncate">{session?.user?.name ?? 'User'}</p>
            <p className="text-xs text-cream-500 truncate">{session?.user?.email ?? ''}</p>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="w-full mt-1 px-3 py-1.5 text-xs text-cream-500 hover:text-cream-700 rounded-md transition-colors text-left"
        >
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile sidebar overlay */}
      {navOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="absolute inset-0 bg-cream-900/20"
            onClick={() => setNavOpen(false)}
          />
          <aside className="relative w-56 bg-cream-50 flex flex-col border-r border-cream-200 animate-slide-in">
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="min-h-screen flex flex-col md:flex-row">
        {/* Mobile header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-cream-200">
          <p className="text-[11px] font-bold text-terra tracking-[0.2em] uppercase">VaultProxy</p>
          <button
            onClick={() => setNavOpen(true)}
            className="p-1 text-cream-600 hover:text-cream-800 transition-colors"
            aria-label="Open navigation"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </header>

        {/* Desktop sidebar */}
        <aside className="hidden md:flex w-56 flex-col border-r border-cream-200 shrink-0">
          {sidebarContent}
        </aside>

        {/* Main content */}
        <main className="flex-1 px-4 py-6 md:px-10 md:py-8">
          <div className="max-w-4xl">
            {children}
          </div>
        </main>
      </div>
    </>
  );
}
