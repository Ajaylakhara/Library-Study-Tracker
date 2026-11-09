import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../hooks/useRedux';
import { fetchMe } from '../toolkit/authThunks';
import { PageLoader } from './Spinner';
import type { Role } from '../types';

export const homeFor = (role: Role) => (role === 'admin' ? '/admin' : '/home');

/** Loads /auth/me once for the whole app and handles bfcache restore. */
export function useBootstrap() {
  const dispatch = useAppDispatch();
  const bootstrapped = useAppSelector((s) => s.auth.bootstrapped);
  useEffect(() => {
    if (!bootstrapped) dispatch(fetchMe());
  }, [bootstrapped, dispatch]);

  // Handle browser back-forward cache (bfcache) restore
  useEffect(() => {
    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        dispatch(fetchMe());
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [dispatch]);

  return bootstrapped;
}

export function ProtectedRoute({ role }: { role: Role }) {
  const ready = useBootstrap();
  const user = useAppSelector((s) => s.auth.user);
  const loc = useLocation();
  if (!ready) return <PageLoader label="Loading your account" />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />;
  return <Outlet />;
}

// Keep RequireAuth as alias for compatibility
export const RequireAuth = ProtectedRoute;
