import { headers } from 'next/headers';
import { getAuth } from './auth-server';

export interface SessionContext {
  userId: string;
  orgId: string;
}

/**
 * Get the authenticated session context from the request.
 * Returns null if not authenticated or no active org.
 */
export async function getSessionContext(): Promise<SessionContext | null> {
  const auth = await getAuth();
  const headerStore = headers();

  // Get session from Better Auth
  const session = await auth.api.getSession({
    headers: headerStore,
  });

  if (!session?.user?.id) return null;

  // Get active organization from the session
  const activeOrgId = session.session?.activeOrganizationId;
  if (!activeOrgId) return null;

  return {
    userId: session.user.id,
    orgId: activeOrgId,
  };
}
