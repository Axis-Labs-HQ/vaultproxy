/**
 * Server-side helper for calling the control plane.
 * Uses INTERNAL_API_KEY for service-to-service auth.
 * MUST only be used in Next.js API routes / server components.
 */
const CONTROL_PLANE_URL =
  process.env.CONTROL_PLANE_URL ?? 'http://localhost:8080';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY ?? '';

interface ControlPlaneOptions extends Omit<RequestInit, 'headers'> {
  orgId: string;
  userId?: string;
}

export async function controlPlaneFetch(
  path: string,
  options: ControlPlaneOptions
): Promise<Response> {
  const { orgId, userId, ...rest } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${INTERNAL_API_KEY}`,
    'X-Org-ID': orgId,
  };

  if (userId) {
    headers['X-User-ID'] = userId;
  }

  return fetch(`${CONTROL_PLANE_URL}${path}`, {
    ...rest,
    headers,
  });
}
