import { useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Armchair,
  ArrowDownToLine,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  DoorOpen,
  RefreshCw,
  ReceiptText,
  Users,
  UserRound,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppSelector } from '../../hooks/useRedux';
import { useAsync } from '../../hooks/useAsync';
import { usePolling } from '../../hooks/usePolling';
import { useAdminHeader } from '../../layout/AdminLayout';
import { get } from '../../store/api';
import { ENDPOINTS } from '../../config/endpoints';
import { POLL_MS, TOTAL_SEATS } from '../../config/constants';
import { currentMonth, monthRangeISO } from '../../helper/date';
import { clock, ymd } from '../../helper/date';
import { formatRupees } from '../../helper/formatMinutes';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import type { AdminSession, AppNotification, LiveSeat, ReportSummary, Student } from '../../types';

interface DashboardData {
  seats: LiveSeat[];
  report: ReportSummary;
  recentSessions: AdminSession[];
  todaySessionCount: number;
  pendingApprovals: number;
  failedAlerts: number;
}

const STATUS_COLOR = {
  occupied: '#C97B78',
  overtime: '#E2A23B',
  free: '#3FA584',
  inactive: '#A7AFBA',
};

function getGreeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getSeatStatus(seat: LiveSeat | undefined, now: number) {
  if (!seat) return { label: 'Free', color: STATUS_COLOR.free, mark: '○' };
  if (seat.session && new Date(seat.session.shiftEndsAt).getTime() < now) {
    return { label: 'Overtime', color: STATUS_COLOR.overtime, mark: '!' };
  }
  if (seat.isOccupied) return { label: 'Occupied', color: STATUS_COLOR.occupied, mark: '●' };
  if (!seat.isActive) return { label: 'Inactive', color: STATUS_COLOR.inactive, mark: '–' };
  return { label: 'Free', color: STATUS_COLOR.free, mark: '○' };
}

function Metric({
  icon,
  label,
  value,
  note,
  tint,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  note?: string;
  tint: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="dashboard-metric glass-navy chip"
      style={{ textAlign: 'left' }}
    >
      <span className="dashboard-metric-icon" style={{ background: tint }}>{icon}</span>
      <span className="dashboard-metric-copy">
        <span className="dashboard-metric-label">{label}</span>
        <strong>{value}</strong>
        {note && <small>{note}</small>}
      </span>
      {onClick && <ArrowUpRight className="dashboard-metric-arrow" size={16} aria-hidden />}
    </button>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="dashboard-panel glass-b">
      <div className="dashboard-panel-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Component() {
  const navigate = useNavigate();
  const user = useAppSelector((state) => state.auth.user);
  const now = Date.now();
  const today = ymd(new Date(now));
  const hourIST = Number(new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)));
  const month = currentMonth();
  const monthRange = monthRangeISO(month);
  const todayStart = new Date(`${today}T00:00:00+05:30`).toISOString();
  const todayEnd = new Date(`${today}T23:59:59.999+05:30`).toISOString();

  useAdminHeader('Dashboard', `${getGreeting(hourIST)}, ${user?.name?.split(' ')[0] ?? 'Admin'}. Here is the reading hall right now.`);

  const { data, loading, error, reload, refresh } = useAsync(async (): Promise<DashboardData> => {
    const [seatResponse, reportResponse, sessionsResponse, studentsResponse, alertsResponse] = await Promise.all([
      get<LiveSeat[]>(ENDPOINTS.admin.liveSeats),
      get<ReportSummary>(ENDPOINTS.admin.reportSummary, monthRange),
      get<AdminSession[]>(ENDPOINTS.admin.sessions, { from: todayStart, to: todayEnd, limit: 5 }),
      get<Student[]>(ENDPOINTS.admin.students, { status: 'pending', page: 1, limit: 1 }),
      get<AppNotification[]>(ENDPOINTS.admin.failedNotifications),
    ]);

    return {
      seats: seatResponse.data,
      report: reportResponse.data,
      recentSessions: sessionsResponse.data,
      todaySessionCount: sessionsResponse.pagination?.total ?? sessionsResponse.data.length,
      pendingApprovals: studentsResponse.pagination?.total ?? studentsResponse.data.length,
      failedAlerts: alertsResponse.data.filter((notification) => notification.status === 'failed').length,
    };
  }, [today, monthRange.from, monthRange.to]);

  usePolling(() => void refresh(), POLL_MS);

  const { seatByNumber, activeCount, activeSeatCount, overtimeCount, inactiveCount, freeCount, shiftCounts } = useMemo(() => {
    const seatMap = new Map(data?.seats.map((seat) => [seat.seatNumber, seat]) ?? []);
    const seats = Array.from({ length: TOTAL_SEATS }, (_, index) => seatMap.get(index + 1) ?? {
      seatId: null,
      seatNumber: index + 1,
      isActive: true,
      isOccupied: false,
      status: 'free' as const,
      session: null,
    });
    const active = seats.filter((seat) => seat.isOccupied);
    const overtime = active.filter((seat) => new Date(seat.session!.shiftEndsAt).getTime() < now).length;
    const shifts = new Map<number, number>([[4, 0], [12, 0], [24, 0]]);
    active.forEach((seat) => {
      const hours = seat.session?.shiftHours;
      if (hours) shifts.set(hours, (shifts.get(hours) ?? 0) + 1);
    });
    return {
      seatByNumber: seatMap,
      activeCount: active.length,
      activeSeatCount: seats.filter((seat) => seat.isActive).length,
      overtimeCount: overtime,
      inactiveCount: seats.filter((seat) => !seat.isActive && !seat.isOccupied).length,
      freeCount: seats.filter((seat) => seat.isActive && !seat.isOccupied).length,
      shiftCounts: shifts,
    };
  }, [data?.seats, now]);

  const activeOccupiedCount = (data?.seats ?? []).filter((seat) => seat.isActive && seat.isOccupied).length;
  const occupancyPercent = activeSeatCount === 0 ? 0 : Math.round((activeOccupiedCount / activeSeatCount) * 100);
  const todaySummary = data?.report.daily.find((entry) => entry.date === today);
  const attendance = data?.recentSessions ?? [];
  const maxShiftCount = Math.max(1, ...Array.from(shiftCounts.values()));
  const donut = [
    { color: STATUS_COLOR.occupied, count: Math.max(0, activeCount - overtimeCount) },
    { color: STATUS_COLOR.overtime, count: overtimeCount },
    { color: STATUS_COLOR.free, count: freeCount },
    { color: STATUS_COLOR.inactive, count: inactiveCount },
  ];
  const donutBackground = useMemo(() => {
    let start = 0;
    const stops = donut.map(({ color, count }) => {
      const end = start + (count / TOTAL_SEATS) * 100;
      const stop = `${color} ${start}% ${end}%`;
      start = end;
      return stop;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }, [activeCount, freeCount, inactiveCount, overtimeCount]);

  if (loading && !data) {
    return (
      <div className="dashboard-page">
        <Skeleton className="h-52 rounded-2xl" />
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-52 rounded-2xl" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-60 rounded-2xl" />
          <Skeleton className="h-60 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return <ErrorState title="Dashboard unavailable" message={error} onRetry={() => void reload()} />;
  }

  if (!data) return null;

  return (
    <div className="dashboard-page">
      <section className="dashboard-hero hero-navy">
        <div className="dashboard-hero-overview">
          <div className="dashboard-kicker">Right now in the reading hall</div>
          <div className="dashboard-occupancy">
            <strong>{activeCount}</strong>
            <span>of {TOTAL_SEATS} seats occupied</span>
          </div>
          <div className="dashboard-progress" role="img" aria-label={`${occupancyPercent}% of seats occupied`}>
            {activeCount > 0 && <span style={{ width: `${(Math.max(0, activeCount - overtimeCount) / TOTAL_SEATS) * 100}%`, background: STATUS_COLOR.occupied }} />}
            {overtimeCount > 0 && <span style={{ width: `${(overtimeCount / TOTAL_SEATS) * 100}%`, background: STATUS_COLOR.overtime }} />}
            {freeCount > 0 && <span style={{ width: `${(freeCount / TOTAL_SEATS) * 100}%`, background: STATUS_COLOR.free }} />}
            {inactiveCount > 0 && <span style={{ width: `${(inactiveCount / TOTAL_SEATS) * 100}%`, background: STATUS_COLOR.inactive }} />}
          </div>
          <div className="dashboard-legend">
            {[
              ['Occupied', Math.max(0, activeCount - overtimeCount), STATUS_COLOR.occupied],
              ['Overtime', overtimeCount, STATUS_COLOR.overtime],
              ['Free', freeCount, STATUS_COLOR.free],
              ['Inactive', inactiveCount, STATUS_COLOR.inactive],
            ].map(([label, value, color]) => (
              <span key={String(label)}>
                <i style={{ background: String(color) }} />
                <span>{label}</span>
                <strong>{value}</strong>
              </span>
            ))}
            <span className="dashboard-capacity"><strong>{occupancyPercent}%</strong><small>capacity</small></span>
          </div>
        </div>
        <div className="dashboard-metrics">
          <Metric icon={<UserRound size={21} />} label="Available seats" value={freeCount} tint="rgba(63,165,132,.82)" onClick={() => navigate('/admin/seats')} />
          <Metric icon={<Activity size={21} />} label="Active sessions" value={activeCount} tint="rgba(74,143,206,.9)" onClick={() => navigate('/admin/sessions')} />
          <Metric icon={<Clock3 size={21} />} label="Overtime" value={overtimeCount} tint="rgba(226,162,59,.9)" onClick={() => navigate('/admin/seats')} />
          <Metric icon={<Users size={21} />} label="Pending approvals" value={data.pendingApprovals} tint="rgba(113,121,207,.9)" onClick={() => navigate('/admin/students')} />
          <Metric icon={<CircleDollarSignIcon />} label="Unpaid fees" value={data.report.unpaidFees} note={`${formatRupees(data.report.unpaidFeeAmount)} outstanding`} tint="rgba(201,93,109,.9)" onClick={() => navigate('/admin/fees')} />
          <Metric icon={<AlertTriangle size={21} />} label="Failed alerts" value={data.failedAlerts} tint="rgba(201,123,120,.95)" onClick={() => navigate('/admin/alerts')} />
        </div>
      </section>

      {error && (
        <div className="dashboard-inline-error" role="status">
          <span>{error}</span>
          <button type="button" onClick={() => void reload()} aria-label="Retry loading dashboard">
            <RefreshCw size={15} /> Retry
          </button>
        </div>
      )}

      <div className="dashboard-top-grid">
        <Panel title="Today's overview">
          <div className="dashboard-overview-list">
            <OverviewRow icon={<CheckCircle2 />} label="Check-ins" value={todaySummary?.checkIns ?? 0} color="#3FA584" />
            <OverviewRow icon={<ArrowDownToLine />} label="Check-outs" value={todaySummary?.checkOuts ?? 0} color="#C97B78" />
            <OverviewRow icon={<Activity />} label="Sessions today" value={data.todaySessionCount} color="#4A8FCE" />
            <OverviewRow icon={<Clock3 />} label="Overtime now" value={overtimeCount} color="#E2A23B" />
            <OverviewRow icon={<ReceiptText />} label="Fees collected" value={formatRupees(data.report.collectedRevenue)} color="#7179CF" />
          </div>
        </Panel>

        <Panel title="Seat occupancy">
          <div className="dashboard-donut-layout">
            <div className="dashboard-donut" style={{ background: donutBackground }} role="img" aria-label={`${occupancyPercent}% of seats occupied`}>
              <div><strong>{occupancyPercent}%</strong><span>occupied</span></div>
            </div>
            <div className="dashboard-donut-legend">
              {[
                ['Occupied', Math.max(0, activeCount - overtimeCount), STATUS_COLOR.occupied],
                ['Overtime', overtimeCount, STATUS_COLOR.overtime],
                ['Free', freeCount, STATUS_COLOR.free],
                ['Inactive', inactiveCount, STATUS_COLOR.inactive],
              ].map(([label, value, color]) => (
                <div key={String(label)}>
                  <i style={{ background: String(color) }} />
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel title="Shift distribution">
          <div className="dashboard-shifts">
            {[4, 12, 24].map((hours) => {
              const count = shiftCounts.get(hours) ?? 0;
              const percent = activeCount ? Math.round((count / activeCount) * 100) : 0;
              const color = hours === 4 ? '#24466C' : hours === 12 ? '#E9A93A' : '#3FA584';
              return (
                <div className="dashboard-shift" key={hours}>
                  <div><strong>{hours} h</strong><b>{count}</b><span>({percent}%)</span></div>
                  <div className="dashboard-shift-track"><span style={{ width: `${(count / maxShiftCount) * 100}%`, background: color }} /></div>
                </div>
              );
            })}
            <p className="dashboard-muted-note">Currently checked-in students by shift length</p>
          </div>
        </Panel>
      </div>

      <div className="dashboard-bottom-grid">
        <Panel
          title="Seat map"
          action={<button className="dashboard-text-link" type="button" onClick={() => navigate('/admin/seats')}>Open monitor <ArrowUpRight size={14} /></button>}
        >
          <div className="dashboard-seat-legend">
            {[
              ['Occupied', STATUS_COLOR.occupied],
              ['Overtime', STATUS_COLOR.overtime],
              ['Free', STATUS_COLOR.free],
              ['Inactive', STATUS_COLOR.inactive],
            ].map(([label, color]) => <span key={String(label)}><i style={{ background: String(color) }} />{label}</span>)}
          </div>
          <div className="dashboard-seat-grid">
            {Array.from({ length: TOTAL_SEATS }, (_, index) => {
              const number = index + 1;
              const status = getSeatStatus(seatByNumber.get(number), now);
              return (
                <button
                  className="dashboard-seat-tile"
                  key={number}
                  type="button"
                  onClick={() => navigate('/admin/seats')}
                  aria-label={`Seat ${number}: ${status.label}. Open seat monitor.`}
                  title={`Seat ${number}: ${status.label}`}
                  style={{ background: status.color }}
                >
                  <span className="dashboard-seat-state" aria-hidden>{status.mark}</span>
                  {number}
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel
          title="Recent attendance"
          action={<button className="dashboard-text-link" type="button" onClick={() => navigate('/admin/sessions')}>View all <ArrowUpRight size={14} /></button>}
        >
          {attendance.length ? (
            <div className="dashboard-attendance-list">
              {attendance.map((session) => {
                const checkedOut = session.status === 'completed';
                const overtime = !checkedOut && new Date(session.shiftEndsAt).getTime() < now;
                const name = session.student?.name ?? 'Former student';
                const stateLabel = checkedOut ? 'checked out' : overtime ? 'overtime' : 'checked in';
                return (
                  <div className="dashboard-attendance-row" key={session._id}>
                    <span className={`dashboard-attendance-icon ${checkedOut ? 'is-checkout' : overtime ? 'is-overtime' : ''}`}>
                      {checkedOut ? <DoorOpen size={17} /> : overtime ? <Clock3 size={17} /> : <CheckCircle2 size={17} />}
                    </span>
                    <div className="dashboard-attendance-student">
                      <strong>{name}</strong>
                      <small className={checkedOut ? 'is-checkout-text' : overtime ? 'is-overtime-text' : 'is-checkin-text'}>{stateLabel}</small>
                    </div>
                    <span className="dashboard-attendance-meta">Seat {session.seat?.number ?? '—'}</span>
                    <span className="dashboard-attendance-meta">{session.shiftHours}h shift</span>
                    <time className="dashboard-attendance-time">{clock(session.checkInAt)}</time>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="dashboard-empty-attendance">
              <Armchair size={25} />
              <p>No check-ins yet today.</p>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function CircleDollarSignIcon() {
  return <span style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>₹</span>;
}

function OverviewRow({ icon, label, value, color }: { icon: ReactNode; label: string; value: string | number; color: string }) {
  return (
    <div className="dashboard-overview-row">
      <span style={{ color }}>{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
