import { useEffect, useState, useRef, type FormEvent, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import { clearAuthError } from '../../toolkit/authSlice';
import { register } from '../../toolkit/authThunks';
import { formatPhone } from '../../helper/formatMinutes';
import { validateRegisterForm, type RegisterFieldErrors } from '../../helper/validators';
import { get } from '../../store/api';
import { ENDPOINTS } from '../../config/endpoints';
import { errMsg } from '../../toolkit/createAppThunk';
import type { ShiftHours } from '../../types';

export function Component() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { submitting, error } = useAppSelector((s) => s.auth);
  const branding = useAppSelector((s) => s.branding.settings);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [whatsappOptIn, setWhatsappOptIn] = useState(false);
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [seats, setSeats] = useState<number[]>([]);
  const [seatsLoading, setSeatsLoading] = useState(true);
  const [seatsError, setSeatsError] = useState<string | null>(null);
  const [seatsReload, setSeatsReload] = useState(0);
  const [seatNumber, setSeatNumber] = useState<number | ''>('');
  const [shiftHours, setShiftHours] = useState<ShiftHours>(4);
  const [pinFocus, setPinFocus] = useState(false);
  const pinInputRef = useRef<HTMLInputElement>(null);

  const [touched, setTouched] = useState(false);
  const [serverFieldErrors, setServerFieldErrors] = useState<RegisterFieldErrors>({});
  const [serverGeneralError, setServerGeneralError] = useState<string | null>(null);
  const [done, setDone] = useState<{ phone: string } | null>(null);

  useEffect(() => () => void dispatch(clearAuthError()), [dispatch]);

  useEffect(() => {
    let active = true;
    get<number[]>(ENDPOINTS.auth.availableSeats)
      .then((res) => {
        if (active) setSeats(res.data);
      })
      .catch((error: unknown) => {
        if (active) setSeatsError(errMsg(error));
      })
      .finally(() => {
        if (active) setSeatsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [seatsReload]);

  const clientErrors = validateRegisterForm({
    name,
    phone,
    pin,
  });

  const nameErr = (touched ? clientErrors.name : null) || serverFieldErrors.name || null;
  const phoneErr = (touched ? clientErrors.phone : null) || serverFieldErrors.phone || null;
  const pinErr = (touched ? clientErrors.pin : null) || serverFieldErrors.pin || null;

  const errorList = [nameErr, phoneErr, pinErr].filter(Boolean) as string[];

  const handlePhone = (val: string) => {
    const raw = val.replace(/\D/g, '').slice(0, 10);
    setPhone(raw);
    if (serverFieldErrors.phone) setServerFieldErrors((prev) => ({ ...prev, phone: undefined }));
  };

  const handlePin = (val: string) => {
    const raw = val.replace(/\D/g, '').slice(0, 6);
    setPin(raw);
    if (serverFieldErrors.pin) setServerFieldErrors((prev) => ({ ...prev, pin: undefined }));
  };

  const handlePinKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && pin.length > 0) {
      setPin(pin.slice(0, -1));
    }
  };

  const handlePinPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    setPin(pasted);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setServerFieldErrors({});
    setServerGeneralError(null);

    const hasClientErrors = Object.keys(clientErrors).length > 0;
    if (hasClientErrors || seatNumber === '') return;

    const res = await dispatch(
      register({
        name: name.trim(),
        phone: phone.replace(/\D/g, ''),
        pin,
        seatNumber,
        shiftHours,
        whatsappOptIn,
        smsOptIn,
      })
    );

    if (register.fulfilled.match(res)) {
      setDone({ phone: phone.replace(/\D/g, '') });
    } else if (register.rejected.match(res)) {
      const payload = res.payload;
      const fieldMap: RegisterFieldErrors = {};
      let genErr: string | null = null;

      if (typeof payload === 'object' && payload !== null) {
        if (payload.errors && payload.errors.length > 0) {
          payload.errors.forEach((err) => {
            const key = err.field as keyof RegisterFieldErrors;
            fieldMap[key] = err.message;
          });
        }
        if (payload.status === 409 && /phone/i.test(payload.message)) {
          fieldMap.phone = payload.message;
        } else if (!payload.errors || payload.errors.length === 0) {
          genErr = payload.message;
        }
      } else if (typeof payload === 'string') {
        const pipeIdx = payload.indexOf('|');
        const status = pipeIdx !== -1 ? Number(payload.slice(0, pipeIdx)) : 0;
        const msg = pipeIdx !== -1 ? payload.slice(pipeIdx + 1) : payload;
        if (status === 409 && /phone/i.test(msg)) {
          fieldMap.phone = msg;
        } else {
          genErr = msg;
        }
      }

      setServerFieldErrors(fieldMap);
      setServerGeneralError(genErr);
    }
  };

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
      {/* Ambient background */}
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

      <div style={{ position: 'relative', zIndex: 1, maxWidth: '440px', margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <main style={{ padding: '40px 16px', display: 'flex', flexDirection: 'column', gap: '20px', animation: 'rise .4s both' }}>
          {/* Header Brand */}
          <section aria-label={branding.libraryName} style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div
              style={{
                width: '60px',
                height: '60px',
                flex: '0 0 60px',
                borderRadius: '16px',
                background: '#032856',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 12px 24px -12px rgba(3,39,85,0.55)',
              }}
            >
              <img src={branding.logo || '/brand/logo-icon.png'} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
            </div>
            <div>
              <div style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '24px', fontWeight: 700, color: '#032755', lineHeight: 1.1 }}>
                {branding.libraryName}
              </div>
              <div style={{ fontSize: '12.5px', letterSpacing: '.26em', textTransform: 'uppercase', color: '#3D4D63' }}>
                Student Portal
              </div>
            </div>
          </section>

          {/* Success screen */}
          {done ? (
            <div
              className="glass-a glass-keep"
              role="status"
              style={{
                borderRadius: '24px',
                padding: '34px 22px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: '14px',
                animation: 'popIn .35s cubic-bezier(.34,1.56,.64,1) both',
              }}
            >
              <svg width="80" height="80" viewBox="0 0 80 80" aria-hidden="true">
                <circle cx="40" cy="40" r="35" fill="rgba(63,165,132,0.14)" stroke="#3FA584" strokeWidth="3" />
                <path
                  d="M26 41 l10 10 l19 -21"
                  fill="none"
                  stroke="#1C6A54"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="48"
                  strokeDashoffset="0"
                />
              </svg>
              <h1 style={{ margin: 0, fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '28px', fontWeight: 700, color: '#032755' }}>
                Request sent
              </h1>
              <p style={{ margin: 0, color: '#172B45', fontSize: '15px' }}>
                Request sent for {formatPhone(done.phone)}. Your account will be activated once the librarian approves it.
              </p>
              <button
                type="button"
                onClick={() => navigate('/login')}
                style={{
                  height: '54px',
                  width: '100%',
                  borderRadius: '14px',
                  border: 'none',
                  background: '#032755',
                  color: '#FDFDFD',
                  fontSize: '16px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginTop: '6px',
                }}
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form
              className="glass-a glass-keep"
              onSubmit={submit}
              noValidate
              style={{
                borderRadius: '24px',
                padding: '26px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              <div>
                <h1 style={{ margin: 0, fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '30px', fontWeight: 700, color: '#032755', lineHeight: 1.1 }}>
                  Create account
                </h1>
                <p style={{ margin: '6px 0 0', color: '#3D4D63', fontSize: '15px' }}>
                  The librarian approves every new registration.
                </p>
              </div>

              {/* Server or validation alerts */}
              {(errorList.length > 0 && touched) || serverGeneralError || error ? (
                <div
                  role="alert"
                  style={{
                    display: 'flex',
                    gap: '10px',
                    padding: '12px 14px',
                    borderRadius: '12px',
                    background: 'rgba(199,75,75,0.10)',
                    border: '1px solid rgba(199,75,75,0.35)',
                    color: '#8E2F2F',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                    error
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '13.5px' }}>
                    <b>{serverGeneralError || error || `Please check ${errorList.length} field${errorList.length > 1 ? 's' : ''}`}</b>
                    {errorList.slice(0, 2).map((err, i) => (
                      <span key={i}>{err}</span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Name */}
              <label style={{ position: 'relative', display: 'block' }}>
                <span className="sr-only">Full name</span>
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: '18px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#24466C',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>
                    person
                  </span>
                </span>
                <input
                  type="text"
                  placeholder="Full name"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (serverFieldErrors.name) setServerFieldErrors((prev) => ({ ...prev, name: undefined }));
                  }}
                  style={{
                    width: '100%',
                    height: '56px',
                    borderRadius: '14px',
                    border: `1px solid ${nameErr ? 'rgba(199,75,75,0.6)' : 'rgba(3,39,85,0.14)'}`,
                    background: 'rgba(255,255,255,0.82)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9)',
                    padding: '0 16px 0 54px',
                    fontSize: '16px',
                    color: '#172B45',
                    outline: 'none',
                  }}
                />
              </label>

              {/* Phone */}
              <label style={{ position: 'relative', display: 'block' }}>
                <span className="sr-only">Phone number</span>
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    left: '18px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: '#24466C',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>
                    smartphone
                  </span>
                  <span style={{ fontSize: '16px', color: '#5A6A7F' }}>+91</span>
                </span>
                <input
                  type="tel"
                  inputMode="numeric"
                  placeholder="10-digit mobile number"
                  autoComplete="tel-national"
                  value={phone}
                  onChange={(e) => handlePhone(e.target.value)}
                  style={{
                    width: '100%',
                    height: '56px',
                    borderRadius: '14px',
                    border: `1px solid ${phoneErr ? 'rgba(199,75,75,0.6)' : 'rgba(3,39,85,0.14)'}`,
                    background: 'rgba(255,255,255,0.82)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9)',
                    padding: '0 16px 0 88px',
                    fontSize: '16px',
                    color: '#172B45',
                    outline: 'none',
                  }}
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px', fontWeight: 500 }}>
                  Assigned seat
                  <select
                    value={seatNumber}
                    onChange={(e) => setSeatNumber(e.target.value ? Number(e.target.value) : '')}
                    disabled={seatsLoading || !!seatsError || seats.length === 0}
                    style={{ height: '52px', borderRadius: '14px', border: '1px solid rgba(3,39,85,0.14)', background: 'rgba(255,255,255,0.82)', padding: '0 12px', font: 'inherit', color: '#172B45' }}
                  >
                    <option value="">{seatsLoading ? 'Loading seats…' : 'Select a seat'}</option>
                    {seats.map((number) => <option key={number} value={number}>Seat {number}</option>)}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px', fontWeight: 500 }}>
                  Study shift
                  <select
                    value={shiftHours}
                    onChange={(e) => setShiftHours(Number(e.target.value) as ShiftHours)}
                    style={{ height: '52px', borderRadius: '14px', border: '1px solid rgba(3,39,85,0.14)', background: 'rgba(255,255,255,0.82)', padding: '0 12px', font: 'inherit', color: '#172B45' }}
                  >
                    <option value={4}>4 hours</option>
                    <option value={12}>12 hours</option>
                    <option value={24}>24 hours</option>
                  </select>
                </label>
              </div>
              {seatsError ? (
                <p role="alert" style={{ margin: 0, color: '#8E2F2F', fontSize: '13px' }}>
                  Could not load available seats: {seatsError}
                  <button type="button" onClick={() => setSeatsReload((value) => value + 1)} style={{ marginLeft: '8px', color: '#032755', textDecoration: 'underline' }}>Retry</button>
                </p>
              ) : seats.length === 0 && !seatsLoading ? (
                <p role="alert" style={{ margin: 0, color: '#8E2F2F', fontSize: '13px' }}>No seats are available. Please contact the librarian.</p>
              ) : seatNumber === '' ? (
                <p role="status" style={{ margin: 0, color: '#5A6A7F', fontSize: '13px' }}>Choose a seat and study shift for your account.</p>
              ) : null}

              <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <legend style={{ fontSize: '14px', fontWeight: 500, padding: 0, marginBottom: '4px' }}>
                  Optional notifications
                </legend>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', minHeight: '36px' }}>
                  <input type="checkbox" checked={whatsappOptIn} onChange={(e) => setWhatsappOptIn(e.target.checked)} />
                  WhatsApp updates
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', minHeight: '36px' }}>
                  <input type="checkbox" checked={smsOptIn} onChange={(e) => setSmsOptIn(e.target.checked)} />
                  SMS updates
                </label>
              </fieldset>

              {/* 6-box PIN UI */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span id="rpin-l" style={{ fontSize: '14px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '19px', color: '#24466C' }}>
                    lock
                  </span>
                  Choose a 6-digit PIN
                </span>
                <div style={{ position: 'relative' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '8px' }} aria-hidden="true">
                    {[0, 1, 2, 3, 4, 5].map((idx) => {
                      const isFilled = idx < pin.length;
                      const isCurrent = idx === pin.length && pinFocus;
                      const hasErr = !!pinErr;
                      return (
                        <div
                          key={idx}
                          style={{
                            position: 'relative',
                            height: '54px',
                            borderRadius: '13px',
                            background: 'rgba(255,255,255,0.82)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: hasErr
                              ? '1.5px solid rgba(199,75,75,0.8)'
                              : isCurrent
                              ? '1.5px solid #032755'
                              : isFilled
                              ? '1.5px solid #032755'
                              : '1.5px solid rgba(3,39,85,0.14)',
                            boxShadow: isCurrent ? '0 0 0 3px rgba(248,179,69,0.45)' : 'inset 0 1px 0 rgba(255,255,255,0.9)',
                            transition: 'border-color .15s, box-shadow .15s',
                          }}
                        >
                          <span
                            style={{
                              width: '12px',
                              height: '12px',
                              borderRadius: '50%',
                              background: '#032755',
                              opacity: isFilled ? 1 : 0,
                              transform: isFilled ? 'scale(1)' : 'scale(0.3)',
                              transition: 'transform .18s cubic-bezier(.34,1.56,.64,1), opacity .15s',
                            }}
                          />
                          {isCurrent && (
                            <span
                              style={{
                                position: 'absolute',
                                width: '2px',
                                height: '22px',
                                background: '#032755',
                                animation: 'caret 1s infinite',
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <input
                    ref={pinInputRef}
                    aria-labelledby="rpin-l"
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => handlePin(e.target.value)}
                    onKeyDown={handlePinKeyDown}
                    onPaste={handlePinPaste}
                    onFocus={() => setPinFocus(true)}
                    onBlur={() => setPinFocus(false)}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      opacity: 0,
                      fontSize: '16px',
                      cursor: 'text',
                    }}
                  />
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting || seatsLoading || !!seatsError || seats.length === 0 || seatNumber === ''}
                style={{
                  height: '58px',
                  borderRadius: '14px',
                  border: '1px solid rgba(231,165,46,0.9)',
                  background: 'linear-gradient(180deg, #F8BB55 0%, #F1A93A 100%)',
                  color: '#032755',
                  fontFamily: "'Source Serif 4', Georgia, serif",
                  fontSize: '20px',
                  fontWeight: 600,
                  cursor: submitting ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  boxShadow: '0 14px 28px -14px rgba(231,165,46,0.85), inset 0 1px 0 rgba(255,255,255,0.45)',
                  marginTop: '8px',
                }}
              >
                {submitting ? (
                  <span
                    style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '50%',
                      border: '2.5px solid rgba(3,39,85,0.25)',
                      borderTopColor: '#032755',
                      animation: 'spin .8s linear infinite',
                    }}
                  />
                ) : (
                  <>
                    Send request
                    <span className="material-symbols-outlined" style={{ fontSize: '23px' }}>
                      arrow_forward
                    </span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => navigate('/login')}
                style={{
                  border: 'none',
                  background: 'none',
                  color: '#032755',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '14px',
                  minHeight: '44px',
                }}
              >
                Already registered? Sign in
              </button>
            </form>
          )}
        </main>
      </div>
    </div>
  );
}
