import { useAppDispatch, useAppSelector } from '../hooks/useRedux';
import { fetchMe } from '../toolkit/authThunks';
import { Button } from './Button';

/**
 * Shown instead of the login page when the server could not be reached while checking the
 * account. The session is untouched: the user is not logged out, they can simply try again.
 */
export function ConnectionProblem() {
  const dispatch = useAppDispatch();
  const message = useAppSelector((s) => s.auth.connectionError);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4" role="alert">
      <div className="glass-b flex max-w-sm flex-col items-center gap-3 rounded-2xl p-6 text-center">
        <h1 className="text-lg font-semibold text-ink">Can't reach the server</h1>
        <p className="text-sm text-muted">
          {message ?? 'Something went wrong.'} You are still signed in. This usually clears in a few
          seconds.
        </p>
        <Button onClick={() => void dispatch(fetchMe())}>Try again</Button>
      </div>
    </div>
  );
}
