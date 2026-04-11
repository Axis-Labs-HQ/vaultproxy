import { NextRequest, NextResponse } from 'next/server';
import { controlPlaneFetch } from '@/lib/api';
import { getSessionContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const res = await controlPlaneFetch('/api/v1/tokens', {
    orgId: ctx.orgId,
    userId: ctx.userId,
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();

  const res = await controlPlaneFetch('/api/v1/tokens', {
    method: 'POST',
    orgId: ctx.orgId,
    userId: ctx.userId,
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(req: NextRequest) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const tokenId = req.nextUrl.searchParams.get('id');
  if (!tokenId) return NextResponse.json({ error: 'missing token id' }, { status: 400 });

  const res = await controlPlaneFetch(`/api/v1/tokens/${tokenId}`, {
    method: 'DELETE',
    orgId: ctx.orgId,
    userId: ctx.userId,
  });

  if (res.status === 204) return new NextResponse(null, { status: 204 });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
