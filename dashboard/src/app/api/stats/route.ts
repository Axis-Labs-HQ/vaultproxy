import { NextResponse } from 'next/server';
import { controlPlaneFetch } from '@/lib/api';
import { getSessionContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // Fetch keys count and org info in parallel
  const [keysRes, orgRes] = await Promise.all([
    controlPlaneFetch('/api/v1/keys', { orgId: ctx.orgId, userId: ctx.userId }),
    controlPlaneFetch('/api/v1/org', { orgId: ctx.orgId, userId: ctx.userId }),
  ]);

  const keys = keysRes.ok ? await keysRes.json() : [];
  const org = orgRes.ok ? await orgRes.json() : null;

  return NextResponse.json({
    keyCount: Array.isArray(keys) ? keys.length : 0,
    org,
  });
}
