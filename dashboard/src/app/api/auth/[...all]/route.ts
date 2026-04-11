import { getAuth } from '@/lib/auth-server';
import { toNextJsHandler } from 'better-auth/next-js';
import { NextRequest } from 'next/server';

// Lazy-initialize handlers to avoid database connection at build time
export async function GET(request: NextRequest) {
  const auth = await getAuth();
  const { GET: handler } = toNextJsHandler(auth);
  return handler(request);
}

export async function POST(request: NextRequest) {
  const auth = await getAuth();
  const { POST: handler } = toNextJsHandler(auth);
  return handler(request);
}
