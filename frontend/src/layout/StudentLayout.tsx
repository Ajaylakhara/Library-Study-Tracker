import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAppSelector } from '../hooks/useRedux';
import { initials } from '../helper/formatMinutes';

const TABS = [
  { to: '/home', label: 'Home', title: 'Home', sub: 'Today’s study session', icon: 'home' },
  { to: '/attendance', label: 'Attendance', title: 'Attendance', sub: 'Monthly calendar & history', icon: 'calendar_month' },
  { to: '/summary', label: 'Summary', title: 'Summary', sub: 'Study hours & analytics', icon: 'bar_chart' },
  { to: '/fees', label: 'Fees', title: 'Fees', sub: 'Plan dues & history', icon: 'payments' },
  { to: '/profile', label: 'Profile', title: 'Profile', sub: 'Account & preferences', icon: 'person' },
];

export function StudentLayout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const branding = useAppSelector((s) => s.branding.settings);

  const activeTab = TABS.find((t) => pathname.startsWith(t.to)) ?? TABS[0];
  const userInitials = initials(user?.name ?? 'AS');

  return (
    <div
      style={{
        minHeight: '100vh',
        position: 'relative',
        overflow: 'hidden',
        color: '#172B45',
        fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
        fontSize: '14px',
        lineHeight: 1.45,
        background: '#F8F6F0',
      }}
    >
      {/* Ambient background matching Stage 0 */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <span
          style={{
            position: 'absolute',
            width: '620px',
            height: '620px',
            left: '-320px',
            bottom: '-340px',
            borderRadius: '50%',
            background: 'radial-gradient(closest-side, rgba(3,39,85,0.55), rgba(36,70,108,0.18) 60%, rgba(36,70,108,0))',
            animation: 'driftA 38s ease-in-out infinite alternate',
          }}
        />
        <span
          style={{
            position: 'absolute',
            width: '620px',
            height: '620px',
            right: '-260px',
            top: '-260px',
            borderRadius: '50%',
            background: 'radial-gradient(closest-side, rgba(248,179,69,0.62), rgba(248,179,69,0.22) 55%, rgba(248,179,69,0))',
            animation: 'driftB 34s ease-in-out infinite alternate',
          }}
        />
        <span
          style={{
            position: 'absolute',
            width: '440px',
            height: '440px',
            left: '30%',
            top: '30%',
            borderRadius: '50%',
            background: 'radial-gradient(closest-side, rgba(63,165,132,0.14), rgba(63,165,132,0))',
          }}
        />
        <span className="grain" />
      </div>

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          maxWidth: '440px',
          margin: '0 auto',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Top Header - Glass-a card floating matching prototype */}
        <header
          className="glass-a glass-keep"
          style={{
            position: 'sticky',
            top: '10px',
            zIndex: 20,
            margin: '10px 12px 0',
            borderRadius: '18px',
            padding: '10px 12px 10px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              width: '46px',
              height: '46px',
              flex: '0 0 46px',
              borderRadius: '13px',
              background: '#032856',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 16px -8px rgba(3,39,85,0.4)',
            }}
          >
            <img
              src={branding.logo || '/brand/logo-icon.png'}
              alt=""
              style={{ width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'contain', padding: branding.logo ? '4px' : '0' }}
            />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#5A6A7F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {branding.libraryName}
            </div>
            <div
              style={{
                fontFamily: "'Source Serif 4', Georgia, serif",
                fontSize: '21px',
                fontWeight: 700,
                color: '#032755',
                lineHeight: 1.15,
              }}
            >
              {activeTab.title}
            </div>
            <div
              style={{
                fontSize: '12.5px',
                color: '#3D4D63',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {activeTab.sub}
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate('/profile')}
            aria-label="Profile"
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '50%',
              border: '2px solid rgba(255,255,255,0.9)',
              background: 'linear-gradient(145deg, #4A6A9C, #24466C)',
              color: '#FDFDFD',
              fontWeight: 600,
              fontSize: '15px',
              cursor: 'pointer',
              boxShadow: '0 6px 14px -6px rgba(3,39,85,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {userInitials}
          </button>
        </header>

        {/* Content Outlet */}
        <main
          style={{
            flex: 1,
            padding: '16px 12px 112px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <Outlet />
        </main>

        {/* Fixed Bottom Nav - dark navy pill bar matching Stage 0 */}
        <nav
          aria-label="Student Navigation"
          style={{
            position: 'fixed',
            bottom: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'calc(100% - 24px)',
            maxWidth: '440px',
            zIndex: 25,
            borderRadius: '22px',
            padding: '7px',
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: '4px',
            background: 'linear-gradient(180deg, #0A3466, #032755)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 18px 40px -16px rgba(3,39,85,0.65), inset 0 1px 0 rgba(255,255,255,0.12)',
          }}
        >
          {TABS.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              style={({ isActive }) => ({
                minHeight: '54px',
                borderRadius: '15px',
                border: isActive ? '1px solid rgba(248,179,69,0.7)' : '1px solid transparent',
                background: isActive ? 'linear-gradient(145deg, rgba(248,179,69,0.32), rgba(248,179,69,0.12))' : 'transparent',
                color: isActive ? '#F8B345' : '#DDE1E6',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '1px',
                fontSize: '12px',
                fontWeight: isActive ? 600 : 500,
                boxShadow: isActive ? '0 4px 12px -2px rgba(248,179,69,0.35)' : 'none',
                textDecoration: 'none',
                transition: 'background .25s, color .2s, border-color .25s',
              })}
            >
              {({ isActive }) => (
                <>
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: '23px',
                      fontVariationSettings: `'FILL' ${isActive ? 1 : 0}, 'wght' 300`,
                    }}
                  >
                    {icon}
                  </span>
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
