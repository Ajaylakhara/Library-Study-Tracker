import { useEffect, useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../hooks/useRedux';
import { dismissLastStudy } from '../../toolkit/studentSlice';
import { checkIn, checkOut, fetchSeats, fetchStatus } from '../../toolkit/studentThunks';
import { useCountdown } from '../../hooks/useCountdown';
import { usePolling } from '../../hooks/usePolling';
import { POLL_MS } from '../../config/constants';
import { formatHMS, formatMinutes } from '../../helper/formatMinutes';
import { clock, dateLabel } from '../../helper/date';
import type { ShiftHours } from '../../types';

export function Component() {
  const dispatch = useAppDispatch();
  const { session, statusLoaded, lastStudy, busy, seats, seatsLoaded, seatsError } = useAppSelector((s) => s.student);
  const user = useAppSelector((s) => s.auth.user);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<number | ''>('');
  const [selectedShift, setSelectedShift] = useState<ShiftHours>(4);
  const hasAssignment = typeof user?.seatNumber === 'number' && typeof user.shiftHours === 'number';

  useEffect(() => {
    dispatch(fetchStatus());
  }, [dispatch]);

  useEffect(() => {
    if (!session && !hasAssignment) dispatch(fetchSeats());
  }, [dispatch, session, hasAssignment]);

  usePolling(() => dispatch(fetchStatus()), session ? 30_000 : POLL_MS * 2, statusLoaded);

  const cd = useCountdown(session?.shiftEndsAt, session?.checkInAt);

  const handleCheckIn = async () => {
    const seat = user?.seatNumber ?? selectedSeat;
    const shift = user?.shiftHours ?? selectedShift;
    if (seat === '') {
      setErrorMsg('Please select an available seat before checking in.');
      return;
    }
    setErrorMsg(null);
    const res = await dispatch(checkIn({ seat, shiftHours: shift }));
    if (checkIn.rejected.match(res)) {
      const payload = res.payload;
      const msg = typeof payload === 'string' ? payload : (payload as { message?: string })?.message ?? 'Could not check in. Please try again.';
      setErrorMsg(msg);
    }
  };

  const handleCheckOut = async () => {
    await dispatch(checkOut());
    setSheetOpen(false);
  };

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const todayLabel = dateLabel(now);

  const seatNumber = session?.seatNumber;
  const shiftHours = session?.shiftHours;
  const firstName = user?.name ? user.name.split(' ')[0] : 'Student';

  // SVG ring parameters
  // circumference = 2 * Math.PI * 94 ≈ 590.6
  const circ = 590.6;
  const overtime = cd.overtime;
  const ringProgress = overtime ? 1 : Math.min(1, Math.max(0, cd.progress));
  const dashOffset = circ * (1 - ringProgress);
  const ringColor = overtime ? '#C97B78' : cd.ending ? '#F8B345' : '#3FA584';
  const ringGlow = overtime ? 'rgba(201,123,120,0.5)' : cd.ending ? 'rgba(248,179,69,0.5)' : 'rgba(63,165,132,0.45)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', animation: 'rise .35s both' }}>
      {/* Hero Navy Card — Stage 0 exact design */}
      <div
        className="hero-navy"
        style={{
          borderRadius: '22px',
          padding: '20px',
          color: '#FDFDFD',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          background: 'linear-gradient(135deg, #0A3466 0%, #032755 55%, #04234D 100%)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 24px 44px -24px rgba(3,39,85,0.7), inset 0 1px 0 rgba(255,255,255,0.12)',
        }}
      >
        {/* Header line */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingBottom: '14px', borderBottom: '1px solid rgba(255,255,255,0.14)' }}>
          <span style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '27px', fontWeight: 600, lineHeight: 1.15 }}>
            {greeting}, {firstName}
          </span>
          <span style={{ fontSize: '14px', color: '#DDE1E6' }}>{todayLabel}</span>
        </div>

        {/* Sub-strip with Seat and Status badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: '#F8B345' }}>
            {session
              ? `Seat ${seatNumber} · ${shiftHours}-hour shift`
              : hasAssignment
                ? `Assigned seat ${user.seatNumber} · ${user.shiftHours}-hour shift`
                : 'Choose a seat and shift to check in'}
          </span>

          {session ? (
            overtime ? (
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: '20px',
                  background: 'rgba(201,123,120,0.24)',
                  color: '#FFB8B5',
                  border: '1px solid rgba(201,123,120,0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                  schedule
                </span>
                Overtime
              </span>
            ) : (
              <span
                style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: '20px',
                  background: 'rgba(63,165,132,0.24)',
                  color: '#A9E5CF',
                  border: '1px solid rgba(63,165,132,0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                  check_circle
                </span>
                In seat
              </span>
            )
          ) : (
            <span
              style={{
                fontSize: '12px',
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: '20px',
                background: 'rgba(255,255,255,0.12)',
                color: '#DDE1E6',
                border: '1px solid rgba(255,255,255,0.2)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>
                radio_button_unchecked
              </span>
              Idle
            </span>
          )}
        </div>

        {errorMsg && (
          <div
            role="alert"
            style={{
              display: 'flex',
              gap: '10px',
              padding: '12px 14px',
              borderRadius: '12px',
              background: 'rgba(199,75,75,0.2)',
              border: '1px solid rgba(199,75,75,0.4)',
              color: '#FFB8B5',
              fontSize: '13.5px',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
              error
            </span>
            <span>{errorMsg}</span>
          </div>
        )}

        {/* State A: Idle (No active session) */}
        {!session && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '6px 0 2px' }}>
            <div
              style={{
                width: '190px',
                height: '190px',
                borderRadius: '50%',
                border: '12px solid rgba(255,255,255,0.10)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                textAlign: 'center',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '40px', color: '#F8B345' }}>
                qr_code_scanner
              </span>
              <span style={{ fontSize: '13.5px', color: '#DDE1E6', padding: '0 20px' }}>
                Ready to study · Check in to begin
              </span>
            </div>

            {hasAssignment ? (
              <div style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: '#DDE1E6' }}>
                  Assigned seat
                  <div style={{ height: '46px', display: 'flex', alignItems: 'center', borderRadius: '10px', padding: '0 10px', background: 'rgba(255,255,255,0.94)', color: '#172B45', fontWeight: 600 }}>
                    Seat {user.seatNumber}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: '#DDE1E6' }}>
                  Study shift
                  <div style={{ height: '46px', display: 'flex', alignItems: 'center', borderRadius: '10px', padding: '0 10px', background: 'rgba(255,255,255,0.94)', color: '#172B45', fontWeight: 600 }}>
                    {user.shiftHours} hours
                  </div>
                </div>
              </div>
            ) : (
            <div style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: '#DDE1E6' }}>
                Available seat
                <select
                  value={selectedSeat}
                  onChange={(e) => setSelectedSeat(e.target.value ? Number(e.target.value) : '')}
                  disabled={!seatsLoaded || seats.length === 0 || busy}
                  style={{ height: '46px', borderRadius: '10px', padding: '0 10px', font: 'inherit', color: '#172B45' }}
                >
                  <option value="">{seatsLoaded ? 'Select a seat' : 'Loading seats…'}</option>
                  {seats.map((seat) => <option key={seat.number} value={seat.number}>Seat {seat.number}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px', color: '#DDE1E6' }}>
                Study shift
                <select
                  value={selectedShift}
                  onChange={(e) => setSelectedShift(Number(e.target.value) as ShiftHours)}
                  disabled={busy}
                  style={{ height: '46px', borderRadius: '10px', padding: '0 10px', font: 'inherit', color: '#172B45' }}
                >
                  <option value={4}>4 hours</option>
                  <option value={12}>12 hours</option>
                  <option value={24}>24 hours</option>
                </select>
              </label>
            </div>
            )}
            {seatsError && (
              <div role="alert" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', color: '#FFB8B5', fontSize: '13px' }}>
                <span>{seatsError}</span>
                <button type="button" onClick={() => dispatch(fetchSeats())} style={{ color: 'inherit', background: 'transparent', border: '1px solid currentColor', borderRadius: '8px', padding: '6px 10px', cursor: 'pointer' }}>
                  Retry
                </button>
              </div>
            )}
            {!hasAssignment && seatsLoaded && !seatsError && seats.length === 0 && (
              <p role="status" style={{ margin: 0, color: '#DDE1E6' }}>No seats are currently available.</p>
            )}

            {!hasAssignment && selectedSeat === '' && seats.length > 0 && (
              <p id="check-in-seat-hint" role="status" style={{ width: '100%', margin: 0, color: '#DDE1E6', fontSize: '13px' }}>
                Choose an available seat above to enable check-in.
              </p>
            )}

            <button
              type="button"
              onClick={handleCheckIn}
              disabled={busy || (!hasAssignment && (selectedSeat === '' || seats.length === 0))}
              aria-describedby={!hasAssignment && selectedSeat === '' && seats.length > 0 ? 'check-in-seat-hint' : undefined}
              style={{
                width: '100%',
                height: '58px',
                borderRadius: '15px',
                border: !hasAssignment && (selectedSeat === '' || seats.length === 0) ? '1px solid rgba(255,255,255,0.2)' : '1px solid rgba(231,165,46,0.9)',
                background: !hasAssignment && (selectedSeat === '' || seats.length === 0)
                  ? 'rgba(255,255,255,0.12)'
                  : 'linear-gradient(180deg, #F8BB55 0%, #F1A93A 100%)',
                color: !hasAssignment && (selectedSeat === '' || seats.length === 0) ? '#DDE1E6' : '#032755',
                fontFamily: "'Source Serif 4', Georgia, serif",
                fontSize: '20px',
                fontWeight: 600,
                cursor: busy || (!hasAssignment && (selectedSeat === '' || seats.length === 0)) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px',
                boxShadow: !hasAssignment && (selectedSeat === '' || seats.length === 0)
                  ? 'none'
                  : '0 14px 28px -14px rgba(231,165,46,0.9), inset 0 1px 0 rgba(255,255,255,0.45)',
              }}
            >
              {busy ? (
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
                  <span className="material-symbols-outlined" style={{ fontSize: '23px' }}>
                    login
                  </span>
                  Check In
                </>
              )}
            </button>
          </div>
        )}

        {/* State B: Active Session Running */}
        {session && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            {overtime && (
              <div
                role="alert"
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '12px 14px',
                  borderRadius: '13px',
                  background: 'rgba(201,123,120,0.22)',
                  border: '1px solid rgba(201,123,120,0.5)',
                  color: '#FFB8B5',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '22px', animation: 'otPulse 1.6s infinite' }}>
                  warning
                </span>
                <span style={{ fontWeight: 600, fontSize: '15px' }}>Shift over, please check out</span>
              </div>
            )}

            {/* Circular Progress Ring */}
            <div style={{ position: 'relative', width: '220px', height: '220px' }}>
              <svg width="220" height="220" viewBox="0 0 220 220" style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
                <circle cx="110" cy="110" r="94" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="14" />
                <circle
                  cx="110"
                  cy="110"
                  r="94"
                  fill="none"
                  stroke={ringColor}
                  strokeWidth="14"
                  strokeLinecap="round"
                  strokeDasharray="590.6"
                  strokeDashoffset={dashOffset}
                  style={{
                    transition: 'stroke-dashoffset .9s linear, stroke .4s',
                    filter: `drop-shadow(0 0 6px ${ringGlow})`,
                  }}
                />
              </svg>
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                }}
              >
                <span style={{ fontSize: '12px', letterSpacing: '.08em', textTransform: 'uppercase', color: '#DDE1E6' }}>
                  {overtime ? 'OVERTIME' : 'TIME REMAINING'}
                </span>
                <span
                  style={{
                    fontFamily: "'Source Serif 4', Georgia, serif",
                    fontSize: '38px',
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                    color: overtime ? '#FFB8B5' : '#FDFDFD',
                    lineHeight: 1.1,
                  }}
                >
                  {overtime ? `+${formatHMS(-cd.remainingMs)}` : formatHMS(cd.remainingMs)}
                </span>
                <span style={{ fontSize: '13px', color: '#DDE1E6' }}>
                  {overtime ? `Ended at ${clock(session.shiftEndsAt)}` : `Ends at ${clock(session.shiftEndsAt)}`}
                </span>
              </div>
            </div>

            {/* Two mini stat tiles */}
            <div style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div
                className="glass-navy flat"
                style={{
                  borderRadius: '14px',
                  padding: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  background: 'linear-gradient(145deg, rgba(255,255,255,0.12), rgba(255,255,255,0.03))',
                }}
              >
                <span
                  style={{
                    width: '38px',
                    height: '38px',
                    flex: '0 0 38px',
                    borderRadius: '50%',
                    background: 'linear-gradient(145deg, #4FB894, #2A8A6C)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#fff' }}>
                    login
                  </span>
                </span>
                <div>
                  <div style={{ fontSize: '12px', color: '#DDE1E6' }}>Checked in</div>
                  <div style={{ fontFamily: "'Source Serif 4', serif", fontSize: '18px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {clock(session.checkInAt)}
                  </div>
                </div>
              </div>

              <div
                className="glass-navy flat"
                style={{
                  borderRadius: '14px',
                  padding: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  background: 'linear-gradient(145deg, rgba(255,255,255,0.12), rgba(255,255,255,0.03))',
                }}
              >
                <span
                  style={{
                    width: '38px',
                    height: '38px',
                    flex: '0 0 38px',
                    borderRadius: '50%',
                    background: overtime ? 'linear-gradient(145deg, #C97B78, #9A4A47)' : 'linear-gradient(145deg, #EBB75A, #C98A22)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#fff' }}>
                    schedule
                  </span>
                </span>
                <div>
                  <div style={{ fontSize: '12px', color: '#DDE1E6' }}>Shift ends</div>
                  <div
                    style={{
                      fontFamily: "'Source Serif 4', serif",
                      fontSize: '18px',
                      fontWeight: 600,
                      fontVariantNumeric: 'tabular-nums',
                      color: overtime ? '#FFB8B5' : '#FDFDFD',
                    }}
                  >
                    {clock(session.shiftEndsAt)}
                  </div>
                </div>
              </div>
            </div>

            {/* Shift Progress bar */}
            <div style={{ width: '100%' }}>
              <div style={{ height: '10px', borderRadius: '6px', background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${Math.round(ringProgress * 100)}%`,
                    background: `linear-gradient(180deg, rgba(255,255,255,0.3), rgba(255,255,255,0) 60%), ${ringColor}`,
                    borderRadius: '6px',
                    transition: 'width .9s linear',
                  }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '12px', color: '#DDE1E6' }}>
                <span>Times from server</span>
                <span>{Math.round(ringProgress * 100)}% complete</span>
              </div>
            </div>

            {/* Check out button */}
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              style={{
                width: '100%',
                height: '56px',
                borderRadius: '15px',
                border: overtime ? '1px solid #C74B4B' : '1px solid rgba(255,255,255,0.25)',
                background: overtime ? 'linear-gradient(180deg, #E26363 0%, #C74B4B 100%)' : 'rgba(255,255,255,0.14)',
                color: '#FDFDFD',
                fontFamily: "'Source Serif 4', Georgia, serif",
                fontSize: '19px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25)',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>
                logout
              </span>
              Check Out
            </button>
          </div>
        )}
      </div>

      {/* Success card if just checked out */}
      {lastStudy && (
        <div
          className="glass-a glass-keep"
          role="status"
          style={{
            borderRadius: '22px',
            padding: '24px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: '12px',
            animation: 'popIn .35s cubic-bezier(.34,1.56,.64,1) both',
          }}
        >
          <span
            style={{
              width: '54px',
              height: '54px',
              borderRadius: '50%',
              background: 'rgba(63,165,132,0.16)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '32px', color: '#26876D' }}>
              check_circle
            </span>
          </span>
          <div style={{ fontFamily: "'Source Serif 4', serif", fontSize: '24px', fontWeight: 700, color: '#032755' }}>
            Study session logged!
          </div>
          <div style={{ color: '#3D4D63', fontSize: '15px' }}>
            You completed <b>{formatMinutes(lastStudy.durationMinutes)}</b> at Seat {lastStudy.seatNumber}.
          </div>
          <button
            type="button"
            onClick={() => dispatch(dismissLastStudy())}
            style={{
              height: '46px',
              padding: '0 24px',
              borderRadius: '12px',
              border: 'none',
              background: '#032755',
              color: '#FDFDFD',
              fontSize: '15px',
              fontWeight: 600,
              cursor: 'pointer',
              marginTop: '4px',
            }}
          >
            Done
          </button>
        </div>
      )}

      {/* Section: This month stats */}
      <h2 style={{ margin: '6px 2px 0', fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '21px', fontWeight: 600, color: '#032755' }}>
        This month
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
        <div
          className="glass-c"
          style={{
            borderRadius: '16px',
            padding: '14px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxShadow: '0 10px 24px -16px rgba(3,39,85,0.35), inset 0 1px 0 rgba(255,255,255,0.9)',
          }}
        >
          <span
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              background: 'linear-gradient(145deg, #7376BD, #4A4D94)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), 0 5px 12px -6px rgba(3,39,85,0.45)',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#fff' }}>
              event_available
            </span>
          </span>
          <span style={{ fontFamily: "'Source Serif 4', serif", fontSize: '24px', fontWeight: 600, lineHeight: 1, color: '#032755' }}>
            15
          </span>
          <span style={{ fontSize: '12.5px', color: '#3D4D63' }}>Sessions</span>
        </div>

        <div
          className="glass-c"
          style={{
            borderRadius: '16px',
            padding: '14px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxShadow: '0 10px 24px -16px rgba(3,39,85,0.35), inset 0 1px 0 rgba(255,255,255,0.9)',
          }}
        >
          <span
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              background: 'linear-gradient(145deg, #EBB75A, #C98A22)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), 0 5px 12px -6px rgba(3,39,85,0.45)',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#fff' }}>
              timer
            </span>
          </span>
          <span style={{ fontFamily: "'Source Serif 4', serif", fontSize: '24px', fontWeight: 600, lineHeight: 1, color: '#032755' }}>
            58h
          </span>
          <span style={{ fontSize: '12.5px', color: '#3D4D63' }}>Hours studied</span>
        </div>

        <div
          className="glass-c"
          style={{
            borderRadius: '16px',
            padding: '14px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxShadow: '0 10px 24px -16px rgba(3,39,85,0.35), inset 0 1px 0 rgba(255,255,255,0.9)',
          }}
        >
          <span
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              background: 'linear-gradient(145deg, #4FB894, #2A8A6C)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), 0 5px 12px -6px rgba(3,39,85,0.45)',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#fff' }}>
              trending_up
            </span>
          </span>
          <span style={{ fontFamily: "'Source Serif 4', serif", fontSize: '24px', fontWeight: 600, lineHeight: 1, color: '#032755' }}>
            3.8h
          </span>
          <span style={{ fontSize: '12.5px', color: '#3D4D63' }}>Daily average</span>
        </div>
      </div>

      {/* Confirmation Bottom Sheet (Matches Prototype) */}
      {sheetOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div
            onClick={() => setSheetOpen(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(3,39,85,0.38)', animation: 'fadeIn .2s both' }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm check-out"
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: '440px',
              background: 'rgba(255,254,252,0.98)',
              borderRadius: '24px 24px 0 0',
              padding: '14px 20px 28px',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              boxShadow: '0 -20px 50px -20px rgba(3,39,85,0.4)',
              animation: 'sheetUp .32s cubic-bezier(.2,.8,.3,1) both',
            }}
          >
            <div style={{ width: '40px', height: '5px', borderRadius: '3px', background: '#D8D1C3', alignSelf: 'center' }} />
            <h2 style={{ margin: 0, fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '24px', fontWeight: 700, color: '#032755' }}>
              Check out from Seat {seatNumber}?
            </h2>
            <p style={{ margin: 0, color: '#172B45', fontSize: '15px' }}>
              You've been studying for <b>{formatMinutes(Math.max(0, Math.floor(cd.elapsedMs / 60000)))}</b>. The server records your check-out time.
            </p>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                style={{
                  flex: 1,
                  height: '54px',
                  borderRadius: '14px',
                  border: '1px solid rgba(3,39,85,0.18)',
                  background: '#FFFEFC',
                  color: '#172B45',
                  fontWeight: 600,
                  fontSize: '15px',
                  cursor: 'pointer',
                }}
              >
                Stay
              </button>
              <button
                type="button"
                onClick={handleCheckOut}
                disabled={busy}
                style={{
                  flex: 1,
                  height: '54px',
                  borderRadius: '14px',
                  border: 'none',
                  background: '#032755',
                  color: '#FDFDFD',
                  fontWeight: 600,
                  fontSize: '15px',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#F8B345' }}>
                  logout
                </span>
                Check Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
