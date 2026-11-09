import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, patch, post } from '../../store/api';
import { ENDPOINTS } from '../../config/endpoints';
import { useAsync } from '../../hooks/useAsync';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import { errMsg } from '../../toolkit/createAppThunk';
import { userUpdated } from '../../toolkit/authSlice';
import { logout } from '../../toolkit/authThunks';
import { showToast } from '../../toolkit/toastSlice';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { formatPhone, initials, formatRupees } from '../../helper/formatMinutes';
import type { Profile } from '../../types';

export function Component() {
  const { data, loading, error, setData } = useAsync(async () => (await get<Profile>(ENDPOINTS.student.profile)).data, []);

  if (loading && !data) {
    return (
      <div className="glass-c" style={{ borderRadius: '20px', padding: '36px', textAlign: 'center', color: '#5A6A7F' }}>
        Loading profile...
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="glass-c" style={{ borderRadius: '20px', padding: '36px', textAlign: 'center', color: '#8E2F2F' }}>
        {error}
      </div>
    );
  }
  if (!data) return null;

  return <ProfileContent profile={data} onSaved={setData} />;
}

function ProfileContent({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const [showPinModal, setShowPinModal] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [savingPref, setSavingPref] = useState(false);

  const savePref = async (changes: Partial<Profile>, msg: string) => {
    setSavingPref(true);
    try {
      const res = await patch<Profile>(ENDPOINTS.student.profile, changes);
      const next = { ...profile, ...changes, ...res.data };
      onSaved(next);
      dispatch(userUpdated({ name: next.name, whatsappOptIn: next.whatsappOptIn, smsOptIn: next.smsOptIn }));
      dispatch(showToast('success', msg));
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
    } finally {
      setSavingPref(false);
    }
  };

  const userInitials = initials(profile.name || user?.name || 'AS');
  const userSeat = profile.seatNumber ?? user?.seatNumber;
  const userShift = profile.shiftHours ?? user?.shiftHours ?? 4;
  const userEmail = profile.email || user?.email || '—';

  const profRows = [
    { icon: 'smartphone', label: 'Phone number', value: `+91 ${formatPhone(profile.phone)}`, bg: 'rgba(36,70,108,0.14)', fg: '#24466C', ro: true },
    { icon: 'mail', label: 'Email', value: userEmail, bg: 'rgba(74,106,156,0.14)', fg: '#4A6A9C', ro: true },
    { icon: 'event_seat', label: 'Assigned seat', value: userSeat ? `Seat ${userSeat}` : 'Not assigned', bg: 'rgba(115,118,189,0.14)', fg: '#5457A0', ro: true },
    { icon: 'schedule', label: 'Shift plan', value: `${userShift}-hour shift`, bg: 'rgba(235,183,90,0.16)', fg: '#C98A22', ro: true },
    { icon: 'payments', label: 'Monthly fee', value: formatRupees(profile.monthlyFee), bg: 'rgba(63,165,132,0.16)', fg: '#26876D', ro: true },
  ];

  return (
    <section data-screen-label="Student Profile" style={{ display: 'flex', flexDirection: 'column', gap: '14px', animation: 'rise .35s both' }}>
      {/* Hero Navy Card */}
      <div
        className="hero-navy"
        style={{
          borderRadius: '22px',
          padding: '22px 20px',
          color: '#FDFDFD',
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
          background: 'linear-gradient(135deg, #0A3466 0%, #032755 55%, #04234D 100%)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 24px 44px -24px rgba(3,39,85,0.7), inset 0 1px 0 rgba(255,255,255,0.12)',
        }}
      >
        <div
          style={{
            width: '64px',
            height: '64px',
            flex: '0 0 64px',
            borderRadius: '50%',
            background: 'linear-gradient(145deg, #4A6A9C, #24466C)',
            border: '2px solid rgba(248,179,69,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            fontSize: '21px',
            boxShadow: '0 8px 18px -6px rgba(3,39,85,0.6)',
          }}
        >
          {userInitials}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "'Source Serif 4', serif", fontSize: '24px', fontWeight: 600, lineHeight: 1.15 }}>
            {profile.name}
          </div>
          <div style={{ fontSize: '13.5px', color: '#DDE1E6' }}>{userSeat ? `Seat ${userSeat}` : 'No assigned seat'}</div>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              marginTop: '6px',
              fontSize: '12px',
              fontWeight: 600,
              padding: '3px 10px',
              borderRadius: '20px',
              background: 'rgba(63,165,132,0.24)',
              border: '1px solid rgba(63,165,132,0.6)',
              color: '#A9E5CF',
            }}
          >
            ✓ Active student
          </span>
        </div>
      </div>

      {/* Profile Details in Glass-b */}
      <div className="glass-b" style={{ borderRadius: '20px', padding: '4px 16px' }}>
        {profRows.map((p, idx) => (
          <div
            key={p.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '13px 0',
              borderTop: idx > 0 ? '1px solid rgba(3,39,85,0.08)' : 'none',
            }}
          >
            <span
              style={{
                width: '38px',
                height: '38px',
                flex: '0 0 38px',
                borderRadius: '50%',
                background: p.bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '20px', color: p.fg }}>
                {p.icon}
              </span>
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '12.5px', color: '#3D4D63' }}>{p.label}</div>
              <div style={{ fontWeight: 600, fontSize: '14.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.value}
              </div>
            </div>
            {p.ro && (
              <span
                title="Set at registration"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  fontSize: '12px',
                  color: '#3D4D63',
                  padding: '3px 8px',
                  borderRadius: '20px',
                  background: 'rgba(3,39,85,0.06)',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                  lock
                </span>
                Read-only
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Notifications toggle in Glass-b */}
      <div className="glass-b" style={{ borderRadius: '20px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, color: '#032755' }}>Notification preferences</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>WhatsApp alerts</div>
            <div style={{ fontSize: '12px', color: '#5A6A7F' }}>Shift reminders and fee notices</div>
          </div>
          <input
            type="checkbox"
            checked={profile.whatsappOptIn}
            disabled={savingPref}
            onChange={(e) => savePref({ whatsappOptIn: e.target.checked }, e.target.checked ? 'WhatsApp alerts enabled' : 'WhatsApp alerts disabled')}
            style={{ width: '20px', height: '20px', accentColor: '#032755', cursor: 'pointer' }}
          />
        </div>
        <div style={{ height: '1px', background: 'rgba(3,39,85,0.08)' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>SMS alerts</div>
            <div style={{ fontSize: '12px', color: '#5A6A7F' }}>Backup delivery if WhatsApp is unreachable</div>
          </div>
          <input
            type="checkbox"
            checked={profile.smsOptIn}
            disabled={savingPref}
            onChange={(e) => savePref({ smsOptIn: e.target.checked }, e.target.checked ? 'SMS alerts enabled' : 'SMS alerts disabled')}
            style={{ width: '20px', height: '20px', accentColor: '#032755', cursor: 'pointer' }}
          />
        </div>
      </div>

      <p style={{ margin: '0 2px', fontSize: '13px', color: '#3D4D63' }}>
        Seat, shift and email are set at registration. Ask the librarian if they need to change.
      </p>

      {/* Action buttons matching prototype */}
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          type="button"
          onClick={() => setShowPinModal(true)}
          style={{
            flex: 1,
            height: '52px',
            borderRadius: '14px',
            border: '1px solid rgba(3,39,85,0.18)',
            background: 'rgba(255,255,255,0.75)',
            color: '#032755',
            fontWeight: 600,
            fontSize: '15px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '19px' }}>
            password
          </span>
          Change PIN
        </button>

        <button
          type="button"
          onClick={() => setConfirmLogout(true)}
          style={{
            flex: 1,
            height: '52px',
            borderRadius: '14px',
            border: '1px solid rgba(199,75,75,0.35)',
            background: 'rgba(255,255,255,0.75)',
            color: '#9E3434',
            fontWeight: 600,
            fontSize: '15px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '19px' }}>
            logout
          </span>
          Log out
        </button>
      </div>

      {/* Change PIN modal dialog */}
      {showPinModal && <ChangePinModal onClose={() => setShowPinModal(false)} />}

      <ConfirmDialog
        open={confirmLogout}
        title="Log out?"
        description="You will need your phone number and PIN to log in again."
        confirmLabel="Log out"
        tone="primary"
        loading={loggingOut}
        onCancel={() => setConfirmLogout(false)}
        onConfirm={async () => {
          setLoggingOut(true);
          await dispatch(logout());
          navigate('/login', { replace: true });
        }}
      />
    </section>
  );
}

function ChangePinModal({ onClose }: { onClose: () => void }) {
  const dispatch = useAppDispatch();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length === 6 && confirm !== next;
  const same = next.length === 6 && next === cur;
  const ready = cur.length === 6 && next.length === 6 && confirm.length === 6 && !mismatch && !same;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await post(ENDPOINTS.student.changePin, { oldPin: cur, newPin: next });
      dispatch(showToast('success', 'PIN updated successfully'));
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(3,39,85,0.4)', animation: 'fadeIn .2s both' }} />
      <form
        onSubmit={submit}
        className="glass-a glass-keep"
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '380px',
          borderRadius: '24px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          boxShadow: '0 24px 60px -20px rgba(3,39,85,0.45)',
          animation: 'popIn .35s cubic-bezier(.34,1.56,.64,1) both',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '22px', fontWeight: 700, color: '#032755' }}>
            Change PIN
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{ width: '32px', height: '32px', borderRadius: '8px', border: 'none', background: 'rgba(3,39,85,0.08)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#032755' }}>
              close
            </span>
          </button>
        </div>

        {error && (
          <div style={{ padding: '10px 12px', borderRadius: '10px', background: 'rgba(199,75,75,0.12)', color: '#8E2F2F', fontSize: '13px' }}>
            {error}
          </div>
        )}

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', fontWeight: 500 }}>
          Current PIN
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={cur}
            onChange={(e) => setCur(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit PIN"
            style={{ height: '46px', borderRadius: '10px', border: '1px solid rgba(3,39,85,0.16)', padding: '0 12px', fontSize: '16px', letterSpacing: '4px' }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', fontWeight: 500 }}>
          New PIN
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={next}
            onChange={(e) => setNext(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit PIN"
            style={{ height: '46px', borderRadius: '10px', border: '1px solid rgba(3,39,85,0.16)', padding: '0 12px', fontSize: '16px', letterSpacing: '4px' }}
          />
        </label>
        {same && <span style={{ fontSize: '12px', color: '#8E2F2F' }}>New PIN must be different from current PIN</span>}

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '13px', fontWeight: 500 }}>
          Confirm new PIN
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit PIN"
            style={{ height: '46px', borderRadius: '10px', border: '1px solid rgba(3,39,85,0.16)', padding: '0 12px', fontSize: '16px', letterSpacing: '4px' }}
          />
        </label>
        {mismatch && <span style={{ fontSize: '12px', color: '#8E2F2F' }}>PINs do not match</span>}

        <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
          <button
            type="button"
            onClick={onClose}
            style={{ flex: 1, height: '48px', borderRadius: '12px', border: '1px solid rgba(3,39,85,0.16)', background: '#fff', color: '#032755', fontWeight: 600, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready || busy}
            style={{
              flex: 1,
              height: '48px',
              borderRadius: '12px',
              border: 'none',
              background: '#032755',
              color: '#FDFDFD',
              fontWeight: 600,
              cursor: ready && !busy ? 'pointer' : 'not-allowed',
              opacity: ready ? 1 : 0.6,
            }}
          >
            {busy ? 'Updating...' : 'Update PIN'}
          </button>
        </div>
      </form>
    </div>
  );
}
