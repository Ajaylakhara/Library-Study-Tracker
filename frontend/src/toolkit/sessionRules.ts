/**
 * When may the app drop a signed-in user? Only when the server clearly says the
 * session is over. A slow cold start, a lost connection or a server error says
 * nothing about the session, so those must never log anyone out.
 */

/** The server answered and rejected the session: expired/invalid token (401) or a blocked account (403). */
export function shouldLogoutOnAuthCheckFailure(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

/** Worth one automatic retry: no answer (network error or timeout reports 0), request timeout, or 5xx. */
export function isTransientStatus(status: number | undefined): boolean {
  if (status === undefined) return true;
  return status === 0 || status === 408 || status >= 500;
}

export function statusOf(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : 0;
}

export const AUTH_CHECK_RETRY_DELAY_MS = 1500;
