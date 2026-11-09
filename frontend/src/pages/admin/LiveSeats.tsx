import { useCallback, useEffect, useMemo, useState } from 'react';
import { get, post } from '../../store/api';
import { ENDPOINTS } from '../../config/endpoints';
import { errMsg } from '../../toolkit/createAppThunk';
import { useAppDispatch } from '../../hooks/useRedux';
import { showToast } from '../../toolkit/toastSlice';
import { useAdminHeader } from '../../layout/AdminLayout';
import { usePolling } from '../../hooks/usePolling';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { POLL_MS, TOTAL_SEATS } from '../../config/constants';
import { formatPhone } from '../../helper/formatMinutes';
import { clock } from '../../helper/date';
import type { LiveSeat } from '../../types';

type SeatStatus = 'free' | 'occupied' | 'overtime' | 'warning' | 'inactive';

interface SeatInfo {
  seat: LiveSeat;
  status: SeatStatus;
  label: string;
  remainingMs: number;
}

function getSeatStatus(seat: LiveSeat, now: number): { status: SeatStatus; label: string; remainingMs: number } {
  if (!seat.session) {
    return seat.isActive
      ? { status: 'free', label: 'Free', remainingMs: 0 }
      : { status: 'inactive', label: 'Inactive', remainingMs: 0 };
  }
  const remainingMs = new Date(seat.session.shiftEndsAt).getTime() - now;
  const mins = Math.floor(Math.abs(remainingMs) / 60000);
  const hm = `${Math.floor(mins / 60)}h ${mins % 60}m`;
  if (remainingMs < 0) return { status: 'overtime', label: `+${mins}m`, remainingMs };
  return { status: remainingMs <= 10 * 60000 ? 'warning' : 'occupied', label: mins >= 60 ? hm : `${mins}m`, remainingMs };
}

export function Component() {
  const dispatch = useAppDispatch();
  const [seats, setSeats] = useState<LiveSeat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSeatNum, setSelectedSeatNum] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useAdminHeader('Seat Monitor', 'Live reading hall status · 70 seats');

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await get<LiveSeat[]>(ENDPOINTS.admin.liveSeats);
      setSeats(res.data);
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  usePolling(() => void load(), POLL_MS);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const seatInfos: SeatInfo[] = useMemo(() => {
    if (!seats) return [];
    return seats.map((s) => {
      const { status, label, remainingMs } = getSeatStatus(s, now);
      return { seat: s, status, label, remainingMs };
    });
  }, [seats, now]);

  const occupiedCount = seatInfos.filter((i) => i.seat.isOccupied).length;
  const overtimeCount = seatInfos.filter((i) => i.status === 'overtime').length;
  const freeCount = seatInfos.filter((info) => info.seat.isActive && !info.seat.isOccupied).length;
  const occPct = Math.round((occupiedCount / TOTAL_SEATS) * 100);

  const selected = seatInfos.find((i) => i.seat.seatNumber === selectedSeatNum) ?? null;

  const handleForceCheckout = async () => {
    const id = selected?.seat.session?.sessionId;
    if (!id) return;
    setBusy(true);
    try {
      await post(ENDPOINTS.admin.forceCheckout(id));
      dispatch(showToast('success', `Seat ${selected.seat.seatNumber} checked out`));
      setConfirm(false);
      await load();
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-screen-label="Seat Monitor" style={{ animation: 'pageIn .32s cubic-bezier(.2,.7,.2,1) both', display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Top Stat Strips matching Stage 0 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
        <div className="glass-a chip" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px 10px 10px', borderRadius: '16px' }}>
          <span
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 60%), #CF7F7C',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 10px -4px rgba(3,39,85,0.4)',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#FFFFFF' }}>
              person
            </span>
          </span>
          <span style={{ fontSize: '14px', color: '#5A6A7F' }}>Occupied</span>
          <span style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '22px', fontWeight: 600, color: '#172B45', fontVariantNumeric: 'tabular-nums' }}>
            {occupiedCount}
          </span>
        </div>

        <div className="glass-a chip" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px 10px 10px', borderRadius: '16px' }}>
          <span
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 60%), #E9A93A',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 10px -4px rgba(3,39,85,0.4)',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#FFFFFF' }}>
              schedule
            </span>
          </span>
          <span style={{ fontSize: '14px', color: '#5A6A7F' }}>Overtime</span>
          <span style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '22px', fontWeight: 600, color: '#172B45', fontVariantNumeric: 'tabular-nums' }}>
            {overtimeCount}
          </span>
        </div>

        <div className="glass-a chip" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px 10px 10px', borderRadius: '16px' }}>
          <span
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 60%), #3FA584',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 10px -4px rgba(3,39,85,0.4)',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#FFFFFF' }}>
              check_circle
            </span>
          </span>
          <span style={{ fontSize: '14px', color: '#5A6A7F' }}>Free</span>
          <span style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '22px', fontWeight: 600, color: '#172B45', fontVariantNumeric: 'tabular-nums' }}>
            {freeCount}
          </span>
        </div>

        <div className="glass-a chip" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px 10px 10px', borderRadius: '16px' }}>
          <span
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '50%',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.35), rgba(255,255,255,0) 60%), #4A6A9C',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 10px -4px rgba(3,39,85,0.4)',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#FFFFFF' }}>
              pie_chart
            </span>
          </span>
          <span style={{ fontSize: '14px', color: '#5A6A7F' }}>Occupancy</span>
          <span style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '22px', fontWeight: 600, color: '#172B45', fontVariantNumeric: 'tabular-nums' }}>
            {occPct}%
          </span>
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: 'auto' }}>
          <button
            type="button"
            onClick={() => void load()}
            style={{
              height: '38px',
              padding: '0 14px',
              borderRadius: '9px',
              border: '1px solid #E8E0D2',
              background: '#FFFEFC',
              color: '#032755',
              fontWeight: 500,
              fontSize: '13.5px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: '18px', animation: refreshing ? 'spin .8s linear infinite' : 'none' }}
            >
              refresh
            </span>
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: '12px', background: 'rgba(199,75,75,0.12)', color: '#8E2F2F', fontSize: '13.5px' }}>
          {error}
        </div>
      )}

      {/* Main Reading Hall Grid + Side Panel layout */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px', alignItems: 'flex-start' }}>
        {/* Reading Hall Card in Glass-b */}
        <div className="glass-b" style={{ flex: '1 1 560px', minWidth: 0, borderRadius: '18px', padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
            <h2 style={{ margin: 0, fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '21px', fontWeight: 600, color: '#032755' }}>
              Reading Hall
            </h2>
            <span style={{ fontSize: '12.5px', color: '#5A6A7F' }}>Seats 1–70 · Real-time status</span>
          </div>

          {/* 70-Seat Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(54px, 1fr))', gap: '8px' }}>
            {!seats
              ? Array.from({ length: TOTAL_SEATS }, (_, i) => (
                  <div
                    key={i}
                    style={{
                      aspectRatio: 1,
                      borderRadius: '9px',
                      background: 'rgba(3,39,85,0.06)',
                      animation: 'pulse 1.4s infinite',
                    }}
                  />
                ))
              : seatInfos.map(({ seat, status, label }) => {
                  const isSel = selectedSeatNum === seat.seatNumber;
                  const isFree = status === 'free';
                  const isOt = status === 'overtime';
                  const isInactive = status === 'inactive';

                  const tileBg = isFree
                    ? 'linear-gradient(180deg, #EBF5F1 0%, #D8EDE5 100%)'
                    : isOt
                    ? 'linear-gradient(180deg, #FBF2E3 0%, #F6E4C6 100%)'
                    : isInactive
                    ? 'linear-gradient(180deg, #F0F1F3 0%, #DDE1E6 100%)'
                    : 'linear-gradient(180deg, #F9EEEE 0%, #F4DBDA 100%)';

                  const tileBd = isSel
                    ? '#032755'
                    : isFree
                    ? '#A7D4C4'
                    : isOt
                    ? '#E7BC70'
                    : isInactive
                    ? '#A7AFBA'
                    : '#DDA8A6';

                  const tileFg = isFree ? '#1C6A54' : isOt ? '#7A4C08' : isInactive ? '#5A6A7F' : '#8E3232';

                  return (
                    <button
                      key={seat.seatId}
                      type="button"
                      className="admin-seat-tile"
                      onClick={() => setSelectedSeatNum(seat.seatNumber)}
                      title={`Seat ${seat.seatNumber}: ${label}`}
                      style={{
                        aspectRatio: 1,
                        minHeight: '44px',
                        borderRadius: '9px',
                        border: `1.5px solid ${tileBd}`,
                        background: tileBg,
                        color: tileFg,
                        boxShadow: isSel ? '0 0 0 2px #032755, 0 6px 14px -4px rgba(3,39,85,0.4)' : '0 2px 4px -2px rgba(3,39,85,0.15)',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '1px',
                        padding: 0,
                        transform: isSel ? 'scale(1.05)' : 'none',
                        transition: 'transform .15s, box-shadow .2s',
                      }}
                    >
                      <span style={{ fontSize: '14px', fontWeight: 700, lineHeight: 1 }}>{seat.seatNumber}</span>
                      <span style={{ fontSize: '11px', letterSpacing: '.02em', lineHeight: 1, opacity: 0.9 }}>{label}</span>
                    </button>
                  );
                })}
          </div>
        </div>

        {/* Side Detail Panel in Glass-b */}
        <div className="glass-b" style={{ flex: '1 1 320px', maxWidth: '380px', borderRadius: '18px', overflow: 'hidden' }}>
          {!selected ? (
            <div style={{ padding: '36px 24px', textAlign: 'center', color: '#5A6A7F' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '36px', color: '#B9AE98' }}>
                event_seat
              </span>
              <p style={{ margin: '8px 0 0', fontSize: '14px' }}>
                Select a seat on the map to see who is studying there, their shift, and remaining time.
              </p>
            </div>
          ) : (
            <div>
              {/* Dark Navy Header */}
              <div
                style={{
                  padding: '18px 20px',
                  background: '#032755',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontSize: '12px', letterSpacing: '.12em', textTransform: 'uppercase', color: '#F8B345' }}>
                    Seat
                  </div>
                  <div style={{ fontFamily: "'Source Serif 4', serif", fontSize: '32px', fontWeight: 600, lineHeight: 1.1 }}>
                    Seat {selected.seat.seatNumber}
                  </div>
                </div>

                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    padding: '4px 10px',
                    borderRadius: '20px',
                    background: selected.status === 'free'
                      ? 'rgba(63,165,132,0.3)'
                      : selected.status === 'overtime'
                      ? 'rgba(233,169,58,0.3)'
                      : selected.status === 'inactive'
                      ? 'rgba(167,175,186,0.3)'
                      : 'rgba(201,123,120,0.3)',
                    color: selected.status === 'free'
                      ? '#A9E5CF'
                      : selected.status === 'overtime'
                      ? '#FBD58A'
                      : selected.status === 'inactive'
                      ? '#DDE1E6'
                      : '#FFB8B5',
                  }}
                >
                  {selected.status === 'free'
                    ? '○ Free'
                    : selected.status === 'overtime'
                    ? '⚠ Overtime'
                    : selected.status === 'inactive'
                    ? '– Inactive'
                    : '● Occupied'}
                </span>
              </div>

              {/* Panel Body */}
              <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {selected.seat.session ? (
                  <>
                    <div>
                      <div style={{ fontSize: '17px', fontWeight: 600, color: '#032755' }}>
                        {selected.seat.session.student.name}
                      </div>
                      <div style={{ fontSize: '13px', color: '#5A6A7F' }}>
                        +91 {formatPhone(selected.seat.session.student.phone)}
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13.5px' }}>
                      <div>
                        <div style={{ fontSize: '12px', color: '#5A6A7F' }}>Shift plan</div>
                        <div style={{ fontWeight: 600 }}>{selected.seat.session.shiftHours}h shift</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '12px', color: '#5A6A7F' }}>Checked in</div>
                        <div style={{ fontWeight: 600 }}>{clock(selected.seat.session.checkInAt)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '12px', color: '#5A6A7F' }}>Expected end</div>
                        <div style={{ fontWeight: 600 }}>{clock(selected.seat.session.shiftEndsAt)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: '12px', color: '#5A6A7F' }}>{selected.status === 'overtime' ? 'Overtime' : 'Remaining'}</div>
                        <div style={{ fontWeight: 600, color: selected.status === 'overtime' ? '#C74B4B' : '#032755' }}>
                          {selected.label}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                      <button
                        type="button"
                        onClick={() => setConfirm(true)}
                        style={{
                          flex: 1,
                          height: '42px',
                          borderRadius: '10px',
                          border: '1px solid #C74B4B',
                          background: '#FFFEFC',
                          color: '#A33A3A',
                          fontWeight: 600,
                          fontSize: '14px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                          logout
                        </span>
                        Force checkout
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', color: '#5A6A7F' }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#172B45' }}>
                      {selected.status === 'inactive' ? 'Seat is inactive' : 'Seat is available'}
                    </div>
                    <div style={{ fontSize: '13px' }}>
                      {selected.status === 'inactive'
                        ? 'This seat is disabled and unavailable for check-in.'
                        : 'No student is currently occupying this seat. It will be assigned when a student checks in.'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        title={`Force check-out Seat ${selectedSeatNum ?? ''}?`}
        description={`${selected?.seat.session?.student.name ?? 'The student'} will be checked out immediately and the seat will become free.`}
        confirmLabel="Force check-out"
        loading={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={handleForceCheckout}
      />
    </section>
  );
}
