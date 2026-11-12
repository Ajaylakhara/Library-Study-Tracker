import { useEffect, useState, type ReactNode } from 'react';
import { clock, dateLabel } from '../helper/date';
import { useAppSelector } from '../hooks/useRedux';

/**
 * Shared glass auth shell. The split variant is used for phone/PIN login;
 * the centered variant is retained for registration.
 */
interface AuthShellProps {
  children: ReactNode;
  /** 'split' = branded login layout. 'center' = compact registration layout. */
  variant?: 'split' | 'center';
}

export function AuthShell({ children, variant = 'center' }: AuthShellProps) {
  if (variant === 'split') return <SplitLayout>{children}</SplitLayout>;
  return <CenterLayout>{children}</CenterLayout>;
}

/* ── Ambient layer (shared) ───────────────────────────────────────── */
function Ambient() {
  return (
    <div aria-hidden="true" className="ambient">
      <span className="orb orb-gold" />
      <span className="orb orb-navy" />
      <span className="orb orb-mint" />
      <span className="orb orb-rose" />
      <span className="grain" />
    </div>
  );
}

/* ── Split (Admin Login) ──────────────────────────────────────────── */
function SplitLayout({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => new Date());
  const branding = useAppSelector((state) => state.branding.settings);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="auth-login-shell" style={{ minHeight: '100vh', position: 'relative', overflow: 'hidden', color: '#172B45', fontFamily: "'IBM Plex Sans', system-ui, sans-serif", fontSize: 14, lineHeight: 1.45, display: 'flex', flexDirection: 'column' }}>
      <Ambient />

      <header className="auth-login-topbar">
        <span className="auth-login-status">Secure sign in</span>
        <div className="auth-login-compact-brand">
          <img src={branding.logo || '/brand/logo-icon.png'} alt="" />
          <span>{branding.shortName || branding.libraryName}</span>
        </div>
        <div className="auth-login-clock">
          <div>{clock(now)}</div>
          <span>{dateLabel(now)}</span>
        </div>
        <span aria-label="Secure connection" title="Secure connection" className="auth-login-online" />
      </header>

      <main style={{
        position: 'relative', zIndex: 1, flex: 1, width: '100%', maxWidth: 1320, margin: '0 auto',
        padding: '76px 24px 42px', display: 'grid', gridTemplateColumns: 'minmax(0,1.08fr) minmax(460px,.92fr)',
        gap: 52, alignItems: 'center',
      }}
        className="auth-split-main"
      >
        {/* Left: brand panel */}
        <section
          aria-label={branding.libraryName}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 22, animation: 'authFadeUp .5s cubic-bezier(.2,.7,.2,1) both' }}
        >
          <div className="auth-login-brand-icon">
            <img src={branding.logo || '/brand/logo-icon.png'} alt="" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <h1 style={{ margin: 0, fontFamily: "'Source Serif 4', Georgia, serif", fontWeight: 700, fontSize: 42, lineHeight: 1.08, color: '#032755', letterSpacing: '-0.01em' }}>
              {branding.libraryName}
            </h1>
            <div style={{ fontSize: 13, letterSpacing: '0.32em', textTransform: 'uppercase', color: '#3D4D63', paddingLeft: '0.32em' }}>Library Portal</div>
          </div>
          <p style={{ margin: 0, maxWidth: 420, fontSize: 16, color: '#3D4D63', lineHeight: 1.55 }}>
            Track seat occupancy, monitor study time, and make the most of your reading hall.
          </p>
          <ul className="auth-login-features">
            {[
              { icon: 'event_seat', title: '70 Seats', sub: 'Reading Hall' },
              { icon: 'schedule', title: 'Real-time', sub: 'Tracking' },
              { icon: 'bar_chart', title: 'Better', sub: 'Utilization' },
              { icon: 'verified_user', title: 'Smarter', sub: 'Management' },
            ].map((x, index) => (
              <li key={x.icon} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, animation: 'authFadeUp .45s both', animationDelay: `${0.12 + index * 0.08}s` }}>
                <span className="auth-login-feature-icon">
                  <span className="ms" style={{ fontSize: 27, color: '#032755', fontVariationSettings: "'wght' 300" }}>{x.icon}</span>
                </span>
                <span style={{ fontSize: 15, fontWeight: 600, color: '#032755', marginTop: 4 }}>{x.title}</span>
                <span style={{ fontSize: 13, color: '#3D4D63' }}>{x.sub}</span>
              </li>
            ))}
          </ul>
          <div aria-hidden="true" className="auth-login-tagline">
            <span>{branding.tagline}</span>
            <i />
          </div>
        </section>

        {/* Right: glass-a form card */}
        <section
          className="glass-a glass-keep"
          style={{ width: '100%', maxWidth: 520, justifySelf: 'center', borderRadius: 26, padding: '40px 36px', display: 'flex', flexDirection: 'column', gap: 20, animation: 'authFadeUp .5s .08s cubic-bezier(.2,.7,.2,1) both' }}
        >
          {children}
        </section>
      </main>

      <style>{`
        @keyframes authFadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        @keyframes authUnderline { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        @media (max-width: 860px) {
          .auth-login-topbar { top: 12px !important; right: 16px !important; }
          .auth-login-status { display: none !important; }
          .auth-login-compact-brand { display: flex !important; }
          .auth-split-main { grid-template-columns: 1fr !important; gap: 24px !important; padding: 78px 20px 32px !important; }
          .auth-split-main > section:first-child { display: none !important; }
          .auth-split-main > section:last-child { padding: 30px 22px !important; }
        }
        @media (min-width: 721px) and (max-height: 760px) {
          .auth-split-main { padding-top: 68px !important; padding-bottom: 24px !important; gap: 32px !important; }
          .auth-split-main > section:first-child { gap: 15px !important; }
          .auth-login-brand-icon { width: 72px !important; height: 72px !important; }
          .auth-login-brand-icon img { width: 58px !important; height: 58px !important; }
          .auth-split-main > section:first-child h1 { font-size: 36px !important; }
          .auth-login-features { margin-top: 0 !important; }
          .auth-login-feature-icon { width: 48px !important; height: 48px !important; }
          .auth-login-tagline { display: none !important; }
          .auth-split-main > section:last-child { padding: 30px !important; }
        }
      `}</style>
      <style>{`
        .auth-login-compact-brand { display: none; align-items: center; gap: 7px; color: #032755; font-weight: 600; }
        .auth-login-compact-brand img { width: 24px; height: 24px; object-fit: contain; border-radius: 5px; }
      `}</style>
    </div>
  );
}

/* ── Center (Student Login / Register) ───────────────────────────── */
function CenterLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', position: 'relative', overflow: 'hidden', color: '#172B45', fontFamily: "'IBM Plex Sans', system-ui, sans-serif", fontSize: 14, lineHeight: 1.45 }}>
      <Ambient />
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 480, margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: '0 16px 40px' }}>
        {children}
      </div>
    </div>
  );
}
