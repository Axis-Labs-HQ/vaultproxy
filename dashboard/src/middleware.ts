import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/register', '/api/auth', '/api/health', '/_next', '/favicon.ico'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Redirect root to /dashboard
  if (pathname === '/') {
    const dashUrl = request.nextUrl.clone();
    dashUrl.pathname = '/dashboard';
    return NextResponse.redirect(dashUrl);
  }

  if (isPublicPath(pathname)) {
    // Redirect authenticated users away from login/register
    if (pathname === '/login' || pathname === '/register') {
      const sessionCookie =
        request.cookies.get('__Secure-better-auth.session_token') ||
        request.cookies.get('better-auth.session_token') ||
        request.cookies.get('__Secure-session_token') ||
        request.cookies.get('session_token');
      if (sessionCookie?.value) {
        const dashUrl = request.nextUrl.clone();
        dashUrl.pathname = '/dashboard';
        return NextResponse.redirect(dashUrl);
      }
    }
    return NextResponse.next();
  }

  // Check for Better Auth session cookie
  // Using cookie check instead of auth.api.getSession because
  // middleware runs in Edge Runtime which doesn't support better-sqlite3
  // Better Auth uses __Secure- prefix when running over HTTPS in production
  const sessionCookie =
    request.cookies.get('__Secure-better-auth.session_token') ||
    request.cookies.get('better-auth.session_token') ||
    request.cookies.get('__Secure-session_token') ||
    request.cookies.get('session_token');

  if (!sessionCookie?.value) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
