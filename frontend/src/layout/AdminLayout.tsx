import {
  createContext, useCallback, useContext, useEffect,
  useMemo, useState,
} from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../hooks/useRedux';
import { logout } from '../toolkit/authThunks';
import { get } from '../store/api';
import { ENDPOINTS } from '../config/endpoints';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { usePolling } from '../hooks/usePolling';
import { initials } from '../helper/formatMinutes';

const ITEMS = [
  { to: '/admin',          label: 'Dashboard',    icon: 'space_dashboard', end: true },
  { to: '/admin/seats',    label: 'Seat Monitor', icon: 'grid_view' },
  { to: '/admin/students', label: 'Students',     icon: 'group',       badge: 'pending' as const },
  { to: '/admin/sessions', label: 'Sessions',     icon: 'timer' },
  { to: '/admin/fees',     label: 'Fees',         icon: 'payments' },
  { to: '/admin/reports',  label: 'Reports',      icon: 'analytics' },
  { to: '/admin/alerts',   label: 'Alerts',       icon: 'notifications', badge: 'failed' as const },
];

interface Ctx { setHeader: (title: string, subtitle?: string) => void; refreshBadges: () => void; }
const AdminCtx = createContext<Ctx>({ setHeader: () => {}, refreshBadges: () => {} });

export function useAdminHeader(title: string, subtitle?: string) {
  const { setHeader } = useContext(AdminCtx);
  useEffect(() => { setHeader(title, subtitle); }, [title, subtitle, setHeader]);
}
export const useRefreshBadges = () => useContext(AdminCtx).refreshBadges;

const BadgeCtx = createContext<{ badges: { pending: number; failed: number } }>({ badges: { pending: 0, failed: 0 } });

/* ── Sidebar Component matching Admin Console.dc.html ── */
function Sidebar({ compact, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const dispatch    = useAppDispatch();
  const navigate    = useNavigate();
  const user        = useAppSelector((s) => s.auth.user);
  const branding    = useAppSelector((s) => s.branding.settings);
  const { badges }  = useContext(BadgeCtx);
  const [confirm, setConfirm] = useState(false);
  const [busy,    setBusy]    = useState(false);
  const location  = useLocation();
  const activeIndex = ITEMS.findIndex(({ to, end }) => end ? location.pathname === to : location.pathname.startsWith(to));

  return (
    <aside
      id="admin-navigation"
      className="admin-sidebar"
      aria-label="Primary"
      style={{
        height: 'calc(100vh - 24px)',
        width: compact ? '80px' : '256px',
        flex: compact ? '0 0 80px' : '0 0 256px',
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '20px',
        overflow: 'hidden',
        background: 'linear-gradient(180deg, #032856 0px, #032856 150px, #0A3466 100%)',
        border: '1px solid rgba(255,255,255,0.10)',
        color: '#FDFDFD',
        boxShadow: '0 28px 56px -24px rgba(3,39,85,0.6), inset 0 1px 0 rgba(255,255,255,0.10)',
      }}
    >
      {/* Brand header */}
      <div style={{ position: 'relative', padding: compact ? '18px 10px' : '22px 16px 14px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px' }}>
        <img
          src={branding.logo || '/brand/logo-icon.png'}
          alt={compact ? branding.shortName : ''}
          style={{ width: '44px', height: '44px', flex: '0 0 auto', objectFit: 'contain', display: 'block', borderRadius: '10px' }}
        />
        {!compact && (
          <span style={{ color: '#FDFDFD', fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '17px', fontWeight: 600, lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {branding.libraryName}
          </span>
        )}
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '10px 14px' }} aria-label="Admin">
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {activeIndex >= 0 && (
            <span className="nav-pill" aria-hidden="true" style={{ height: '46px', transform: `translateY(${activeIndex * 52}px)` }}>
              <span className="edge" />
            </span>
          )}
          {ITEMS.map(({ to, label, icon, end, badge }) => {
            const count = badge ? badges[badge] : 0;
            const isActive = end ? location.pathname === to : location.pathname.startsWith(to);

            return (
              <NavLink
                key={to}
                to={to}
                end={end}
                title={label}
                onClick={onNavigate}
                className="admin-nav-link"
                style={{
                  position: 'relative',
                  zIndex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  height: '46px',
                  padding: compact ? '0 16px' : '0 16px',
                  justifyContent: compact ? 'center' : 'flex-start',
                  borderRadius: '12px',
                  textDecoration: 'none',
                  border: '1px solid transparent',
                  background: 'transparent',
                  color: isActive ? '#FFFFFF' : '#DDE1E6',
                  fontSize: '15px',
                  fontWeight: isActive ? 600 : 500,
                  transition: 'background .2s, color .2s, transform .12s',
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontSize: '23px',
                    color: isActive ? '#F8B345' : '#DDE1E6',
                    fontVariationSettings: "'wght' 300",
                  }}
                >
                  {icon}
                </span>
                {!compact && <span style={{ flex: 1 }}>{label}</span>}
                {count > 0 && (
                  <span
                    style={{
                      minWidth: '22px',
                      height: '22px',
                      padding: '0 6px',
                      borderRadius: '11px',
                      background: '#F8B345',
                      color: '#032755',
                      fontSize: '12px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 8px -2px rgba(0,0,0,0.4)',
                    }}
                  >
                    {badge === 'failed' ? (count > 9 ? '9+' : count) : (count > 99 ? '99+' : count)}
                  </span>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {/* User profile card */}
      <div
        className="glass-navy"
        style={{
          margin: '14px',
          padding: compact ? '12px 8px' : '16px',
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: compact ? 'center' : 'flex-start' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              background: 'linear-gradient(145deg, #4A6A9C, #24466C)',
              border: '1px solid rgba(255,255,255,0.25)',
              color: '#FDFDFD',
              fontWeight: 600,
              fontSize: '15px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: '0 0 44px',
            }}
          >
            {initials(user?.name ?? 'Admin')}
          </div>
          {!compact && (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '15px', fontWeight: 600, color: '#FDFDFD', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user?.name ?? 'Administrator'}
              </div>
              <div style={{ fontSize: '12.5px', color: '#DDE1E6' }}>Administrator</div>
            </div>
          )}
        </div>

        <NavLink
          to="/admin/account"
          title="Account"
          onClick={onNavigate}
          aria-current={location.pathname === '/admin/account' ? 'page' : undefined}
          style={{
            minHeight: '36px',
            padding: compact ? '0 6px' : '0 8px',
            borderRadius: '8px',
            color: location.pathname === '/admin/account' ? '#F8B345' : '#DDE1E6',
            background: location.pathname === '/admin/account' ? 'rgba(248,179,69,0.12)' : 'transparent',
            textDecoration: 'none',
            fontSize: '13.5px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: compact ? 'center' : 'flex-start',
            gap: '8px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>manage_accounts</span>
          {!compact && 'Account'}
        </NavLink>

        <button
          type="button"
          className="admin-sidebar-logout"
          onClick={() => setConfirm(true)}
          style={{
            alignSelf: compact ? 'center' : 'flex-end',
            minHeight: '36px',
            padding: '0 6px',
            border: 'none',
            background: 'transparent',
            color: '#DDE1E6',
            fontSize: '13.5px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            borderRadius: '8px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
            logout
          </span>
          {!compact && 'Logout'}
        </button>
      </div>

      <ConfirmDialog
        open={confirm}
        title="Log out?"
        description="You will need your admin phone number and PIN to sign in again."
        confirmLabel="Log out"
        tone="primary"
        loading={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={async () => {
          setBusy(true);
          await dispatch(logout());
          navigate('/login', { replace: true });
        }}
      />
    </aside>
  );
}

export function AdminLayout() {
  const navigate = useNavigate();
  const [header, setHeaderState] = useState<{ title: string; subtitle?: string }>({ title: 'Dashboard', subtitle: 'Right now in the reading hall' });
  const [drawer, setDrawer] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [badges, setBadges] = useState({ pending: 0, failed: 0 });
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const updateViewport = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
      if (!event.matches) setDrawer(false);
    };

    mediaQuery.addEventListener('change', updateViewport);
    return () => mediaQuery.removeEventListener('change', updateViewport);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const setHeader = useCallback((title: string, subtitle?: string) => setHeaderState({ title, subtitle }), []);

  const refreshBadges = useCallback(() => {
    Promise.all([
      get(ENDPOINTS.admin.students, { status: 'pending', limit: 1 }),
      get(ENDPOINTS.admin.failedNotifications),
    ])
      .then(([s, f]) => setBadges({ pending: s.pagination?.total ?? 0, failed: f.count ?? 0 }))
      .catch(() => void 0);
  }, []);

  useEffect(() => { refreshBadges(); }, [refreshBadges]);
  usePolling(refreshBadges, 30_000);

  const ctx = useMemo(() => ({ setHeader, refreshBadges }), [setHeader, refreshBadges]);
  const badgeCtx = useMemo(() => ({ badges }), [badges]);

  const clockTime = now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  const clockDate = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <AdminCtx.Provider value={ctx}>
      <BadgeCtx.Provider value={badgeCtx}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            position: 'relative',
            color: '#172B45',
            fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
            fontSize: '14px',
            lineHeight: 1.45,
            background: '#F8F6F0',
            padding: '12px',
            gap: '18px',
          }}
        >
          {/* Ambient background with orbs + grain */}
          <div className="ambient" aria-hidden="true">
            <span className="orb orb-gold" />
            <span className="orb orb-navy" />
            <span className="orb orb-mint" />
            <span className="orb orb-rose" />
            <span className="grain" />
          </div>

          {/* Desktop and tablet sidebar */}
          {sidebarVisible && (
            <>
              <div className="hidden lg:block" style={{ position: 'sticky', top: '12px', zIndex: 2, alignSelf: 'flex-start', height: 'calc(100vh - 24px)', flex: '0 0 256px' }}>
                <Sidebar />
              </div>
              <div className="hidden md:block lg:hidden" style={{ position: 'sticky', top: '12px', zIndex: 2, alignSelf: 'flex-start', height: 'calc(100vh - 24px)', flex: '0 0 80px' }}>
                <Sidebar compact />
              </div>
            </>
          )}

          {/* Mobile Drawer */}
          {drawer && (
            <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex' }}>
              <div
                onClick={() => setDrawer(false)}
                style={{ position: 'absolute', inset: 0, background: 'rgba(3,39,85,0.4)', animation: 'fadeIn .2s both' }}
              />
              <div style={{ position: 'relative', zIndex: 1, padding: '12px' }}>
                <Sidebar onNavigate={() => setDrawer(false)} />
              </div>
            </div>
          )}

          {/* Main Content Area */}
          <div style={{ flex: 1, minWidth: 0, maxWidth: '1480px', width: '100%', margin: '0 auto', position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Floating Top Header matching Admin Console.dc.html */}
            <header
              className="glass-a glass-keep admin-topbar"
              style={{
                position: 'sticky',
                top: '12px',
                zIndex: 20,
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                flexWrap: 'wrap',
                padding: '16px 26px',
                borderRadius: '20px',
                background: 'linear-gradient(105deg, rgba(255,254,252,0.97) 0%, rgba(255,254,252,0.96) 62%, rgba(255,244,220,0.97) 100%)',
                backdropFilter: 'blur(14px) saturate(160%)',
                WebkitBackdropFilter: 'blur(14px) saturate(160%)',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  if (isMobile) {
                    setDrawer((open) => !open);
                  } else {
                    setSidebarVisible((visible) => !visible);
                  }
                }}
                className="admin-topbar-toggle glass-c chip"
                aria-label={
                  isMobile
                    ? drawer ? 'Close navigation menu' : 'Open navigation menu'
                    : sidebarVisible ? 'Hide sidebar' : 'Show sidebar'
                }
                aria-expanded={
                  isMobile ? drawer : sidebarVisible
                }
                aria-controls="admin-navigation"
                title={
                  isMobile
                    ? drawer ? 'Close menu' : 'Open menu'
                    : sidebarVisible ? 'Hide sidebar' : 'Show sidebar'
                }
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '11px',
                  color: '#032755',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 'none',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>
                  {isMobile
                    ? drawer ? 'close' : 'menu'
                    : sidebarVisible ? 'left_panel_close' : 'left_panel_open'}
                </span>
              </button>

              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <h1
                    style={{
                      margin: 0,
                      fontFamily: "'Source Serif 4', Georgia, serif",
                      fontWeight: 600,
                      fontSize: '38px',
                      lineHeight: 1.1,
                      color: '#032755',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {header.title}
                  </h1>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '11px',
                      letterSpacing: '.06em',
                      textTransform: 'uppercase',
                      padding: '3px 8px',
                      borderRadius: '6px',
                      border: '1px dashed #D99526',
                      color: '#8A5A0E',
                      background: 'rgba(248,179,69,0.12)',
                    }}
                  >
                    Live LMS
                  </span>
                </div>
                {header.subtitle && (
                  <p style={{ margin: '4px 0 0', color: '#5A6A7F', fontSize: '14.5px' }}>
                    {header.subtitle}
                  </p>
                )}
              </div>

              {/* Clock and Alerts bell */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '19px', fontWeight: 600, color: '#172B45', fontVariantNumeric: 'tabular-nums' }}>
                    {clockTime}
                  </div>
                  <div style={{ fontSize: '13.5px', color: '#5A6A7F' }}>{clockDate}</div>
                </div>

                <span aria-hidden="true" style={{ width: '1px', height: '36px', background: 'rgba(3,39,85,0.12)' }} />

                <button
                  type="button"
                  className="admin-topbar-alerts"
                  onClick={() => navigate('/admin/alerts')}
                  aria-label="Alerts"
                  style={{
                    position: 'relative',
                    width: '44px',
                    height: '44px',
                    borderRadius: '12px',
                    border: 'none',
                    background: 'transparent',
                    color: '#24466C',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '28px', fontVariationSettings: "'wght' 300" }}>
                    notifications
                  </span>
                  {badges.failed > 0 && (
                    <span
                      style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px',
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: '#F8B345',
                        border: '2px solid #FFFEFC',
                      }}
                    />
                  )}
                </button>
              </div>
            </header>

            {/* Sub-page Outlet */}
            <main className="admin-route" style={{ flex: 1, minWidth: 0 }}>
              <Outlet />
            </main>
          </div>
        </div>
      </BadgeCtx.Provider>
    </AdminCtx.Provider>
  );
}
