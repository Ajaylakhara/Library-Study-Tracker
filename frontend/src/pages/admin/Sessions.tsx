import { useEffect, useState } from 'react';
import { Armchair, CheckCircle2, Clock3, Timer } from 'lucide-react';
import { get, post } from '../../store/api';
import { ENDPOINTS } from '../../config/endpoints';
import { errMsg } from '../../toolkit/createAppThunk';
import { useAppDispatch } from '../../hooks/useRedux';
import { showToast } from '../../toolkit/toastSlice';
import { useAdminHeader } from '../../layout/AdminLayout';
import { useAsync } from '../../hooks/useAsync';
import { Button } from '../../components/Button';
import { Select } from '../../components/Controls';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { AdminMetricCard } from '../../components/AdminMetricCard';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { formatMinutes } from '../../helper/formatMinutes';
import { dateTimeLabel, ymd } from '../../helper/date';
import type { AdminSession, LiveSeat, Pagination as P, Student } from '../../types';

const PAGE_SIZE = 10;

interface Filters {
  status: string;
  studentId: string;
  seatId: string;
  from: string;
  to: string;
}
const EMPTY: Filters = { status: '', studentId: '', seatId: '', from: '', to: '' };

const istStart = (d: string) => new Date(`${d}T00:00:00+05:30`).toISOString();
const istEnd = (d: string) => new Date(`${d}T23:59:59.999+05:30`).toISOString();

function badgeKey(s: AdminSession): string {
  if (s.status === 'active') return new Date(s.shiftEndsAt).getTime() < Date.now() ? 'overtime' : 'live';
  return s.checkoutType === 'forced' ? 'forced' : s.checkoutType === 'auto' ? 'auto' : 'completed';
}

export function Component() {
  const dispatch = useAppDispatch();
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<AdminSession | null>(null);
  const [busy, setBusy] = useState(false);

  const options = useAsync(async () => {
    const [students, seats] = await Promise.all([
      get<Student[]>(ENDPOINTS.admin.students, { limit: 100 }),
      get<LiveSeat[]>(ENDPOINTS.admin.liveSeats),
    ]);
    return { students: students.data, seats: seats.data };
  }, []);

  const list = useAsync(async () => {
    const r = await get<AdminSession[]>(ENDPOINTS.admin.sessions, {
      page,
      limit: PAGE_SIZE,
      status: applied.status,
      studentId: applied.studentId,
      seatId: applied.seatId,
      from: applied.from ? istStart(applied.from) : undefined,
      to: applied.to ? istEnd(applied.to) : undefined,
    });
    return { rows: r.data, pagination: r.pagination as P };
  }, [applied, page]);

  const live = useAsync(async () => (await get<AdminSession[]>(ENDPOINTS.admin.sessions, { status: 'active', limit: 1 })).pagination?.total ?? 0, []);
  const today = ymd(new Date());
  const completedToday = useAsync(async () => {
    const result = await get<AdminSession[]>(ENDPOINTS.admin.sessions, {
      status: 'completed',
      from: istStart(today),
      to: istEnd(today),
      limit: 1,
    });
    return result.pagination?.total ?? result.data.length;
  }, [today]);

  useAdminHeader('Sessions', list.data ? `${live.data ?? 0} live now · ${list.data.pagination.total} in this view` : undefined);

  // keep live counts / rows fresh
  useEffect(() => {
    const id = setInterval(() => {
      list.refresh();
      live.refresh();
      completedToday.refresh();
    }, 30_000);
    return () => clearInterval(id);
  });

  const apply = () => {
    setPage(1);
    setApplied(draft);
  };
  const clear = () => {
    setDraft(EMPTY);
    setApplied(EMPTY);
    setPage(1);
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);
  const filtered = JSON.stringify(applied) !== JSON.stringify(EMPTY);

  const forceOut = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await post(ENDPOINTS.admin.forceCheckout(target._id));
      dispatch(showToast('success', 'Student checked out'));
      setTarget(null);
      list.refresh();
      live.refresh();
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<AdminSession>[] = [
    { key: 'student', header: 'Student', primary: true, render: (s) => <span className="font-semibold">{s.student?.name ?? 'Deleted user'}</span> },
    { key: 'seat', header: 'Seat', render: (s) => <span className="font-serif text-base font-semibold">{s.seat?.number ?? '—'}</span> },
    { key: 'shift', header: 'Shift', render: (s) => `${s.shiftHours}h` },
    { key: 'in', header: 'Check-in', render: (s) => <span className="tnum">{dateTimeLabel(s.checkInAt)}</span> },
    {
      key: 'out',
      header: 'Check-out',
      render: (s) => <span className="tnum text-muted">{s.checkOutAt ? dateTimeLabel(s.checkOutAt) : '—'}</span>,
    },
    {
      key: 'dur',
      header: 'Duration',
      align: 'right',
      render: (s) => {
        const mins = s.status === 'active' ? Math.max(0, Math.floor((Date.now() - new Date(s.checkInAt).getTime()) / 60000)) : s.durationMinutes;
        return <span className="tnum font-semibold">{formatMinutes(mins)}</span>;
      },
    },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge status={badgeKey(s)} /> },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      mobileHideLabel: true,
      render: (s) =>
        s.status === 'active' ? (
          <Button size="sm" variant="dangerOutline" onClick={() => setTarget(s)}>
            Force Check-Out
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <AdminMetricCard
          icon={<CheckCircle2 size={20} />}
          color="#3FA584"
          label="Active now"
          value={live.data ?? (live.error ? 'Unavailable' : '…')}
          note={live.error ?? 'Current check-ins'}
        />
        <AdminMetricCard
          icon={<Clock3 size={20} />}
          color="#E2A23B"
          label="Overtime"
          value={options.data ? options.data.seats.filter((seat) => seat.session && new Date(seat.session.shiftEndsAt).getTime() < Date.now()).length : options.error ? 'Unavailable' : '…'}
          note={options.error ?? 'Past the shift end'}
        />
        <AdminMetricCard
          icon={<Timer size={20} />}
          color="#4A8FCE"
          label="Completed today"
          value={completedToday.data ?? (completedToday.error ? 'Unavailable' : '…')}
          note={completedToday.error ?? today}
        />
        <AdminMetricCard
          icon={<Armchair size={20} />}
          color="#7179CF"
          label="Seats available"
          value={options.data ? options.data.seats.filter((seat) => !seat.isOccupied).length : options.error ? 'Unavailable' : '…'}
          note={options.error ?? 'Live seat status'}
        />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
        className="glass-b flex flex-wrap items-end gap-3 rounded-2xl p-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">From</span>
          <input
            type="date"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            className="glass-c h-10.5 rounded-[10px] px-3 text-sm"
            style={{ color: '#172B45' }}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">To</span>
          <input
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            className="glass-c h-10.5 rounded-[10px] px-3 text-sm"
            style={{ color: '#172B45' }}
          />
        </label>
        <Select label="Student" value={draft.studentId} onChange={(e) => setDraft({ ...draft, studentId: e.target.value })} className="w-50">
          <option value="">All students</option>
          {options.data?.students.map((s) => (
            <option key={s._id} value={s._id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select label="Seat" value={draft.seatId} onChange={(e) => setDraft({ ...draft, seatId: e.target.value })} className="w-32.5">
          <option value="">All seats</option>
          {options.data?.seats.map((s) => (
            <option key={s.seatId} value={s.seatId}>
              Seat {s.seatNumber}
            </option>
          ))}
        </Select>
        <Select label="Status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} className="w-35">
          <option value="">All</option>
          <option value="active">Live</option>
          <option value="completed">Completed</option>
        </Select>
        <Button type="submit" size="sm" className="h-10.5 rounded-[10px] px-5" disabled={!dirty}>
          Apply filters
        </Button>
        {filtered && (
          <Button type="button" size="sm" variant="ghost" className="h-10.5 underline" onClick={clear}>
            Clear
          </Button>
        )}
      </form>

      {list.loading && !list.data ? (
        <div className="glass-b flex flex-col gap-2 rounded-2xl p-4" aria-busy>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      ) : list.error && !list.data ? (
        <ErrorState title="Couldn't load sessions" message={list.error} onRetry={list.reload} />
      ) : list.data && list.data.rows.length === 0 ? (
        <div className="glass-b rounded-2xl">
          <EmptyState icon={<Timer size={26} strokeWidth={1.7} />} title="No sessions found" text={filtered ? 'Try widening the filters.' : 'Sessions appear here once students check in.'} />
        </div>
      ) : (
        list.data && (
          <DataTable columns={columns} rows={list.data.rows} rowKey={(s) => s._id} footer={<Pagination p={list.data.pagination} onPage={setPage} />} />
        )
      )}

      <ConfirmDialog
        open={!!target}
        title={`Force check-out ${target?.student?.name ?? ''}?`}
        description={`Seat ${target?.seat?.number ?? ''} will be released immediately.`}
        confirmLabel="Force check-out"
        loading={busy}
        onCancel={() => setTarget(null)}
        onConfirm={forceOut}
      />
    </div>
  );
}
