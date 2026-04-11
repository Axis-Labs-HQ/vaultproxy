'use client';

import { useState, useEffect, useRef } from 'react';
import { authClient } from '@/lib/auth-client';

interface Org {
  id: string;
  name: string;
  slug: string;
}

export function OrgSwitcher() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [activeOrg, setActiveOrg] = useState<Org | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    authClient.organization.list().then((res) => {
      if (res.data) setOrgs(res.data as Org[]);
    });
    authClient.organization.getFullOrganization().then((res) => {
      if (res.data) setActiveOrg(res.data as Org);
    });
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function switchOrg(org: Org) {
    await authClient.organization.setActive({ organizationId: org.id });
    setActiveOrg(org);
    setOpen(false);
  }

  const initial = activeOrg?.name?.charAt(0)?.toUpperCase() ?? '?';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium text-cream-900 rounded-md hover:bg-cream-100 transition-colors"
      >
        <span className="flex items-center justify-center w-7 h-7 rounded-md bg-terra text-white text-xs font-bold shrink-0">
          {initial}
        </span>
        <span className="truncate">{activeOrg?.name ?? 'Select org'}</span>
        <svg className="w-4 h-4 ml-auto text-cream-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
        </svg>
      </button>

      {open && orgs.length > 0 && (
        <div className="absolute left-0 right-0 mt-1 bg-white border border-cream-200 rounded-md shadow-lg z-50">
          {orgs.map((org) => (
            <button
              key={org.id}
              onClick={() => switchOrg(org)}
              className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-cream-50 transition-colors ${
                org.id === activeOrg?.id ? 'bg-cream-50 font-medium' : 'text-cream-700'
              }`}
            >
              <span className="flex items-center justify-center w-6 h-6 rounded bg-terra text-white text-xs font-bold shrink-0">
                {org.name.charAt(0).toUpperCase()}
              </span>
              <span className="truncate">{org.name}</span>
              {org.id === activeOrg?.id && (
                <svg className="w-4 h-4 ml-auto text-terra shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
