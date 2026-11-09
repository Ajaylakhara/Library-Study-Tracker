import { useEffect, useState, useRef, type FormEvent, type ClipboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import { clearAuthError } from '../../toolkit/authSlice';
import { login } from '../../toolkit/authThunks';
import { AuthShell } from '../../components/AuthShell';

/* ── 6-box PIN UI (prototype exact style) ── */
function PinBoxes({ value, onChange, hasError }: { value: string; onChange: (v: string) => void; hasError: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? '');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '').slice(0, 6);
    onChange(raw);
  };
  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const d = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (d) { e.preventDefault(); onChange(d); }
  };

  const caretIdx = Math.min(value.length, 5);

  return (
    <div style={{ position: 'relative' }}>
      {/* Visual boxes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8 }} aria-hidden>
        {digits.map((d, i) => {
          const isCaret = focused && i === caretIdx && d === '';
          const bd = hasError ? 'rgba(201,123,120,0.65)' : (i === caretIdx && focused ? '#032755' : 'rgba(3,39,85,0.14)');
          const sh = hasError ? 'none' : (i === caretIdx && focused ? '0 0 0 3px rgba(248,179,69,0.45)' : 'none');
          return (
            <div key={i} style={{ position: 'relative', height: 56, borderRadius: 13, background: 'rgba(255,255,255,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${bd}`, boxShadow: sh, transition: 'border-color .15s, box-shadow .15s' }}>
              {d
                ? <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#032755', display: 'block', transform: 'scale(1)', transition: 'transform .18s cubic-bezier(.34,1.56,.64,1)' }} />
                : isCaret
                ? <span style={{ position: 'absolute', width: 2, height: 22, background: '#032755', animation: 'caret 1s infinite' }} />
                : null}
            </div>
          );
        })}
      </div>
      {/* Hidden real input */}
      <input
        ref={inputRef}
        type="password"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        onChange={handleChange}
        onPaste={handlePaste}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-label="6-digit PIN"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, fontSize: 16, cursor: 'text' }}
      />
      <style>{`@keyframes caret { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    </div>
  );
}

export function Component() {
  const dispatch  = useAppDispatch();
  const navigate  = useNavigate();
  const { submitting, error, errorStatus } = useAppSelector((s) => s.auth);
  const [phone, setPhone] = useState('');
  const [pin,   setPin]   = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => () => void dispatch(clearAuthError()), [dispatch]);

  const locked  = errorStatus === 429;
  const pending = errorStatus === 403;
  const phoneDigits = phone.replace(/\D/g, '').slice(0, 10);
  const canSubmit = phoneDigits.length === 10 && pin.length === 6 && !submitting && !locked;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    const res = await dispatch(login({ phone: phoneDigits, pin }));
    if (login.fulfilled.match(res)) {
      navigate(res.payload.role === 'admin' ? '/admin' : '/home', { replace: true });
    } else {
      setPin('');
    }
  };

  const fieldBd = (error || (touched && phoneDigits.length < 10)) && !submitting ? 'rgba(201,123,120,0.55)' : 'rgba(3,39,85,0.14)';

  return (
    <AuthShell variant="split">
      <form
        onSubmit={submit}
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 16, margin: 0 }}
      >
        <div>
          <h2 style={{ margin: 0, fontFamily: "'Source Serif 4', Georgia, serif", fontSize: 32, fontWeight: 700, lineHeight: 1.1, color: '#032755' }}>Welcome Back</h2>
          <p style={{ margin: '6px 0 0', color: '#3D4D63', fontSize: 16 }}>Sign in with your phone and 6-digit PIN</p>
        </div>

        {/* Error alert */}
        {error && (
          <div role="alert" style={{ display: 'flex', gap: 10, padding: '12px 14px', borderRadius: 12, background: locked || pending ? 'rgba(226,162,59,0.12)' : 'rgba(199,75,75,0.10)', border: `1px solid ${locked || pending ? 'rgba(226,162,59,0.45)' : 'rgba(199,75,75,0.35)'}`, color: locked || pending ? '#7A4C08' : '#8E2F2F' }}>
            <span className="ms" style={{ fontSize: 20 }}>error</span>
            <span style={{ fontSize: 13.5 }}>
              <b>{locked ? 'Too many sign-in attempts.' : pending ? 'Account not active yet.' : 'Phone or PIN is incorrect.'}</b>{' '}
              {locked ? error : pending ? error : 'Check both and try again.'}
            </span>
          </div>
        )}

        {/* Phone */}
        <label style={{ position: 'relative', display: 'block' }}>
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Phone number</span>
          <span aria-hidden style={{ position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 8, color: '#24466C' }}>
            <span className="ms" style={{ fontSize: 22, fontVariationSettings: "'wght' 300" }}>smartphone</span>
            <span style={{ fontSize: 16, color: '#5A6A7F' }}>+91</span>
          </span>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="Phone number"
            value={phone}
            onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
            autoFocus
            style={{ width: '100%', height: 58, borderRadius: 14, border: `1px solid ${fieldBd}`, background: 'rgba(255,255,255,0.82)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9)', padding: '0 16px 0 88px', fontSize: 16, color: '#172B45', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', transition: 'border-color .15s, box-shadow .15s' }}
            onFocus={e => { e.currentTarget.style.borderColor = '#032755'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(248,179,69,0.45)'; }}
            onBlur={e  => { e.currentTarget.style.borderColor = fieldBd;   e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.9)'; }}
          />
        </label>

        {/* PIN boxes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="ms" style={{ fontSize: 19, color: '#24466C', fontVariationSettings: "'wght' 300" }}>lock</span>
            PIN
          </span>
          <PinBoxes value={pin} onChange={setPin} hasError={!!error && !locked && !pending} />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={!canSubmit}
          style={{ height: 60, borderRadius: 14, border: '1px solid rgba(231,165,46,0.9)', background: 'linear-gradient(180deg, #F8BB55 0%, #F1A93A 100%)', color: '#032755', fontFamily: "'Source Serif 4', Georgia, serif", fontSize: 20, fontWeight: 600, cursor: canSubmit ? 'pointer' : 'not-allowed', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: canSubmit || submitting ? 1 : 0.55, boxShadow: '0 14px 28px -14px rgba(231,165,46,0.85), inset 0 1px 0 rgba(255,255,255,0.45)', transition: 'transform .15s, box-shadow .15s, opacity .15s' }}
          onMouseDown={e => { if (canSubmit) e.currentTarget.style.transform = 'scale(0.98)'; }}
          onMouseUp={e => { e.currentTarget.style.transform = ''; }}
        >
          {submitting && <span style={{ width: 20, height: 20, borderRadius: '50%', border: '2.5px solid rgba(3,39,85,0.25)', borderTopColor: '#032755', animation: 'spin .8s linear infinite' }} />}
          Sign In
          {!submitting && <span className="ms" style={{ fontSize: 23 }}>arrow_forward</span>}
        </button>

        {/* OR divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, color: '#5A6A7F', fontSize: 13 }}>
          <span style={{ flex: 1, height: 1, background: 'rgba(3,39,85,0.12)' }} />OR<span style={{ flex: 1, height: 1, background: 'rgba(3,39,85,0.12)' }} />
        </div>

        <button
          type="button"
          onClick={() => navigate('/register')}
          style={{ height: 52, borderRadius: 14, border: '1px solid rgba(3,39,85,0.18)', background: 'rgba(255,255,255,0.7)', color: '#032755', fontSize: 15, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit' }}
        >
          <span className="ms" style={{ fontSize: 20 }}>person_add</span>
          New here? Register for a seat
        </button>

        <p style={{ margin: 0, textAlign: 'center', fontSize: 13, color: '#5A6A7F' }}>
          Admins use this same phone and PIN sign-in.
        </p>
      </form>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </AuthShell>
  );
}
