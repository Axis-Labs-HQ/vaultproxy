'use client';

import { useEffect, useState } from 'react';
import { authClient, useSession } from '@/lib/auth-client';

interface OrgData {
  id: string;
  name: string;
  slug: string;
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const [org, setOrg] = useState<OrgData | null>(null);

  useEffect(() => {
    authClient.organization.getFullOrganization().then((res) => {
      if (res.data) setOrg(res.data as unknown as OrgData);
    });
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-cream-900">Settings</h1>
      <p className="text-sm text-cream-600 mt-1">
        Manage your organization and account
      </p>

      <div className="mt-8 space-y-6">
        <section className="bg-white border border-cream-200 rounded-lg p-6">
          <h2 className="text-base font-semibold text-cream-900 mb-4">Organization</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-cream-500 mb-1">Name</label>
              <p className="text-sm text-cream-900">{org?.name ?? '\u2014'}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-cream-500 mb-1">Slug</label>
              <p className="text-sm text-cream-900 font-mono">{org?.slug ?? '\u2014'}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-cream-500 mb-1">Plan</label>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-cream-100 text-cream-700">
                Free
              </span>
            </div>
          </div>
        </section>

        <section className="bg-white border border-cream-200 rounded-lg p-6">
          <h2 className="text-base font-semibold text-cream-900 mb-4">Account</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-cream-500 mb-1">Name</label>
              <p className="text-sm text-cream-900">{session?.user?.name ?? '\u2014'}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-cream-500 mb-1">Email</label>
              <p className="text-sm text-cream-900">{session?.user?.email ?? '\u2014'}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
