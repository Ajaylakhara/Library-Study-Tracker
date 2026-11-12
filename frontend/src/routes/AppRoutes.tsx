import { createBrowserRouter, Navigate, Outlet, RouterProvider, useLocation } from 'react-router-dom';
import { useBootstrap, ProtectedRoute, homeFor } from '../components/ProtectedRoute';
import { RouteError } from '../components/ErrorBoundary';
import { PageLoader } from '../components/Spinner';
import { StudentLayout } from '../layout/StudentLayout';
import { AdminLayout } from '../layout/AdminLayout';
import { useAppSelector } from '../hooks/useRedux';
import { useEffect } from 'react';

const PAGE_TITLES: Record<string, string> = {
  '/login': 'Sign in',
  '/register': 'Register',
  '/home': 'Home',
  '/attendance': 'Attendance',
  '/summary': 'Summary',
  '/fees': 'Fees',
  '/profile': 'Profile',
  '/admin': 'Dashboard',
  '/admin/seats': 'Seat monitor',
  '/admin/students': 'Students',
  '/admin/sessions': 'Sessions',
  '/admin/fees': 'Fees',
  '/admin/reports': 'Reports',
  '/admin/alerts': 'Alerts',
  '/admin/account': 'Account',
};

function BrandingMetadata() {
  const { pathname } = useLocation();
  const branding = useAppSelector((state) => state.branding.settings);

  useEffect(() => {
    const pageTitle = PAGE_TITLES[pathname] ?? (pathname === '/' ? 'Home' : 'Not found');
    document.title = `${pageTitle} · ${branding.libraryName}`;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) description.content = branding.tagline || branding.libraryName;

    let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!favicon) {
      favicon = document.createElement('link');
      favicon.rel = 'icon';
      document.head.appendChild(favicon);
    }

    const href = branding.favicon || branding.logo || '/favicon.svg';
    favicon.href = href;
    favicon.type = href.startsWith('data:')
      ? href.slice(5, href.indexOf(';'))
      : href.endsWith('.svg')
        ? 'image/svg+xml'
        : '';
  }, [branding.favicon, branding.libraryName, branding.logo, pathname]);

  return <Outlet />;
}

export function PublicOnlyRoute() {
  const ready = useBootstrap();
  const user = useAppSelector((s) => s.auth.user);
  if (!ready) return <PageLoader label="Loading" />;
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  return <Outlet />;
}

export function RootRedirect() {
  const ready = useBootstrap();
  const user = useAppSelector((s) => s.auth.user);
  if (!ready) return <PageLoader label="Loading" />;
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

export const router = createBrowserRouter([
  {
    element: <BrandingMetadata />,
    errorElement: <RouteError />,
    hydrateFallbackElement: <PageLoader />,
    children: [
      { path: '/', element: <RootRedirect /> },
      {
        element: <PublicOnlyRoute />,
        children: [
          { path: '/login', lazy: () => import('../pages/auth/Login') },
          { path: '/register', lazy: () => import('../pages/auth/Register') },
        ],
      },
      { path: '/admin/login', element: <Navigate to="/login" replace /> },
      {
        element: <ProtectedRoute role="student" />,
        children: [
          {
            element: <StudentLayout />,
            children: [
              { path: '/home', lazy: () => import('../pages/student/Home') },
              { path: '/attendance', lazy: () => import('../pages/student/Attendance') },
              { path: '/summary', lazy: () => import('../pages/student/Summary') },
              { path: '/fees', lazy: () => import('../pages/student/Fees') },
              { path: '/profile', lazy: () => import('../pages/student/Profile') },
            ],
          },
        ],
      },
      {
        element: <ProtectedRoute role="admin" />,
        children: [
          {
            element: <AdminLayout />,
            children: [
              { path: '/admin', lazy: () => import('../pages/admin/Dashboard') },
              { path: '/admin/seats', lazy: () => import('../pages/admin/LiveSeats') },
              { path: '/admin/students', lazy: () => import('../pages/admin/Students') },
              { path: '/admin/sessions', lazy: () => import('../pages/admin/Sessions') },
              { path: '/admin/fees', lazy: () => import('../pages/admin/Fees') },
              { path: '/admin/reports', lazy: () => import('../pages/admin/Reports') },
              { path: '/admin/alerts', lazy: () => import('../pages/admin/Alerts') },
              { path: '/admin/account', lazy: () => import('../pages/admin/Account') },
            ],
          },
        ],
      },
      { path: '*', lazy: () => import('../pages/NotFound') },
    ],
  },
]);

export function AppRoutes() {
  return <RouterProvider router={router} />;
}
