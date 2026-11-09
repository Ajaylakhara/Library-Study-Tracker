import { Link } from 'react-router-dom';
import { useAppSelector } from '../hooks/useRedux';

export function Component() {
  const user = useAppSelector((s) => s.auth.user);
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ivory px-6 text-center">
      <div className="font-serif text-7xl font-semibold text-gold-dark">404</div>
      <h1 className="font-serif text-3xl font-semibold">This page isn't on the shelf</h1>
      <p className="max-w-sm text-muted">The link may be old or mistyped.</p>
      <Link
        to={user ? (user.role === 'admin' ? '/admin' : '/home') : '/login'}
        className="inline-flex min-h-12 items-center rounded-xl bg-oxford px-6 font-semibold text-paper hover:bg-navy"
      >
        Go back
      </Link>
    </div>
  );
}
