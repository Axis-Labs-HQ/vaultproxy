import { NextResponse } from 'next/server';
import { controlPlaneFetch } from '@/lib/api';
import { getSessionContext } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: Request,
  { params }: { params: { keyId: string } }
) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { keyId } = params;

  const res = await controlPlaneFetch(`/api/v1/keys/${keyId}`, {
    method: 'DELETE',
    orgId: ctx.orgId,
    userId: ctx.userId,
  });

  if (res.status === 204) return new NextResponse(null, { status: 204 });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(
  _req: Request,
  { params }: { params: { keyId: string } }
) {
  const ctx = await getSessionContext();
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { keyId } = params;

  const res = await controlPlaneFetch(`/api/v1/keys/${keyId}/deactivate`, {
    method: 'POST',
    orgId: ctx.orgId,
    userId: ctx.userId,
  });

  if (res.status === 204) return new NextResponse(null, { status: 204 });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
