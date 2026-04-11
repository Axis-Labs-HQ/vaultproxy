'use client';

import { useEffect, useState } from 'react';
import { authClient } from '@/lib/auth-client';

interface OrgData {
  id: string;
  name: string;
  slug: string;
  members?: { id: string; userId: string; role: string }[];
}

export default function DashboardPage() {
  const [org, setOrg] = useState<OrgData | null>(null);
  const [keyCount, setKeyCount] = useState<number | null>(null);

  useEffect(() => {
    authClient.organization.getFullOrganization().then((res) => {
      if (res.data) setOrg(res.data as OrgData);
    });
    fetch('/api/stats').then(r => r.json()).then(data => {
      setKeyCount(data.keyCount ?? 0);
    }).catch(() => setKeyCount(0));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-cream-900">Overview</h1>
      <p className="text-sm text-cream-600 mt-1">
        {org ? org.name : 'Loading\u2026'}
      </p>

      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 mt-6">
        <span>
          <span className="text-3xl font-bold text-cream-900 mr-1">{keyCount !== null ? keyCount : '\u2014'}</span>
          <span className="text-sm text-cream-500">keys</span>
        </span>
        <span className="text-sm text-cream-500">0 requests today</span>
        <span className="text-sm text-cream-500">{org?.members?.length ?? 0} members</span>
      </div>

      {(keyCount === null || keyCount === 0) && (
        <div className="mt-12 animate-fade-in">
          <h2 className="text-base font-semibold text-cream-900 mb-2">Get started</h2>
          <ol className="text-sm text-cream-600 space-y-2 list-decimal list-inside">
            <li>Add your real API key in <a href="/dashboard/keys" className="text-terra hover:text-terra-hover transition-colors">Keys</a></li>
            <li>Generate a proxy token in <a href="/dashboard/tokens" className="text-terra hover:text-terra-hover transition-colors">Tokens</a></li>
            <li>Point your SDK to <code className="text-xs bg-cream-100 px-1 py-0.5 rounded font-mono">proxy.vaultproxy.dev</code> with your proxy token</li>
          </ol>
        </div>
      )}
    </div>
  );
}
