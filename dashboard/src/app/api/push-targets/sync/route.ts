import { NextRequest, NextResponse } from 'next/server';
import { controlPlaneFetch } from '@/lib/api';
import { getSessionContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const targetId = req.nextUrl.searchParams.get('id');
  if (!targetId) return NextResponse.json({ error: 'missing target id' }, { status: 400 });

  const res = await controlPlaneFetch(`/api/v1/push-targets/${targetId}/sync`, {
    method: 'POST',
    orgId: ctx.orgId,
    userId: ctx.userId,
  });

  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
