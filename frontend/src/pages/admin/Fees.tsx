import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, IndianRupee, ReceiptText } from 'lucide-react';
import { get, patch, post } from '../../store/api';
import { ENDPOINTS } from '../../config/endpoints';
import { errMsg } from '../../toolkit/createAppThunk';
import { useAppDispatch } from '../../hooks/useRedux';
import { showToast } from '../../toolkit/toastSlice';
import { useAdminHeader } from '../../layout/AdminLayout';
import { useAsync } from '../../hooks/useAsync';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { AdminMetricCard } from '../../components/AdminMetricCard';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { formatPhone, formatRupees } from '../../helper/formatMinutes';
import { currentMonth, dateLabel, monthLabel, shiftMonth } from '../../helper/date';
import { cn } from '../../helper/cn';
import type { AdminFee, Pagination as P } from '../../types';

const PAGE_SIZE = 10;
const STATUSES = [
  { key: '', label: 'All' },
  { key: 'paid', label: 'Paid' },
  { key: 'unpaid', label: 'Unpaid' },
];

function monthOptions(): string[] {
  const cur = currentMonth();
  return Array.from({ length: 13 }, (_, i) => shiftMonth(cur, -i));
}

export function Component() {
  const dispatch = useAppDispatch();
  const [month, setMonth] = useState(currentMonth());
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [payTarget, setPayTarget] = useState<AdminFee | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => setPage(1), [month, status]);

  const list = useAsync(async () => {
    const r = await get<AdminFee[]>(ENDPOINTS.admin.fees, { month, status, page, limit: PAGE_SIZE });
    return { rows: r.data, pagination: r.pagination as P };
  }, [month, status, page]);

  // Month totals regardless of the status filter
  const totals = useAsync(async () => {
    const [paid, unpaid] = await Promise.all([
      get<AdminFee[]>(ENDPOINTS.admin.fees, { month, status: 'paid', limit: 100 }),
      get<AdminFee[]>(ENDPOINTS.admin.fees, { month, status: 'unpaid', limit: 100 }),
    ]);
    const sum = (a: AdminFee[]) => a.reduce((n, f) => n + f.amount, 0);
    return { collected: sum(paid.data), pending: sum(unpaid.data), paidCount: paid.pagination?.total ?? 0, unpaidCount: unpaid.pagination?.total ?? 0 };
  }, [month]);

  useAdminHeader(
    'Fees',
    totals.data ? `${monthLabel(month)} · ${formatRupees(totals.data.collected)} collected · ${formatRupees(totals.data.pending)} pending` : monthLabel(month)
  );

  const nextMonth = shiftMonth(currentMonth(), 1);
  const [genMonth, setGenMonth] = useState(month);

  const markPaid = async () => {
    if (!payTarget) return;
    setBusy(true);
    try {
      await patch(ENDPOINTS.admin.markFeePaid(payTarget._id), {});
      dispatch(showToast('success', 'Fee marked as paid'));
      setPayTarget(null);
      list.refresh();
      totals.refresh();
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    try {
      await post(ENDPOINTS.admin.generateFees, { month: genMonth });
      dispatch(showToast('success', `Fees generated for ${monthLabel(genMonth)}`));
      setGenOpen(false);
      setMonth(genMonth);
      list.refresh();
      totals.refresh();
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<AdminFee>[] = [
    { key: 'student', header: 'Student', primary: true, render: (f) => <span className="font-semibold">{f.student?.name ?? 'Deleted user'}</span> },
    { key: 'phone', header: 'Phone', render: (f) => <span className="tnum">{f.student ? formatPhone(f.student.phone) : '—'}</span> },
    { key: 'month', header: 'Month', render: (f) => monthLabel(f.month) },
    { key: 'amount', header: 'Amount', align: 'right', render: (f) => <span className="tnum font-semibold">{formatRupees(f.amount)}</span> },
    { key: 'status', header: 'Status', render: (f) => <StatusBadge status={f.status} /> },
    { key: 'paidOn', header: 'Paid on', render: (f) => <span className="tnum text-muted">{f.paidAt ? dateLabel(f.paidAt) : '—'}</span> },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      mobileHideLabel: true,
      render: (f) =>
        f.status === 'unpaid' ? (
          <Button size="sm" variant="successOutline" onClick={() => setPayTarget(f)}>
            Mark Paid
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <AdminMetricCard
          icon={<ReceiptText size={20} />}
          color="#4A8FCE"
          label={`Billed · ${monthLabel(month, false)}`}
          value={totals.data ? formatRupees(totals.data.collected + totals.data.pending) : totals.error ? 'Unavailable' : '…'}
          note={totals.error ?? (totals.data ? `${totals.data.paidCount + totals.data.unpaidCount} records` : 'Loading monthly totals')}
        />
        <AdminMetricCard
          icon={<CheckCircle2 size={20} />}
          color="#3FA584"
          label="Collected"
          value={totals.data ? formatRupees(totals.data.collected) : totals.error ? 'Unavailable' : '…'}
          note={totals.error ?? (totals.data ? `${totals.data.paidCount} paid` : 'Loading monthly totals')}
        />
        <AdminMetricCard
          icon={<Clock3 size={20} />}
          color="#E2A23B"
          label="Unpaid"
          value={totals.data ? formatRupees(totals.data.pending) : totals.error ? 'Unavailable' : '…'}
          note={totals.error ?? (totals.data ? `${totals.data.unpaidCount} records` : 'Loading monthly totals')}
        />
        <AdminMetricCard
          icon={<IndianRupee size={20} />}
          color="#C97B78"
          label="Payment records"
          value={totals.data ? String(totals.data.paidCount + totals.data.unpaidCount) : totals.error ? 'Unavailable' : '…'}
          note={totals.error ?? monthLabel(month)}
        />
      </div>
      <div className="glass-b flex flex-wrap items-end gap-3 rounded-2xl p-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Month</span>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="glass-c h-10.5 w-50 rounded-[10px] px-3 text-sm"
            style={{ color: '#172B45' }}
          >
            {monthOptions().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1.5">
          <span id="fee-status" className="text-[13px] font-semibold">
            Status
          </span>
          <div role="radiogroup" aria-labelledby="fee-status" className="glass-c flex h-10.5 overflow-hidden rounded-[10px]">
            {STATUSES.map((s, i) => (
              <button
                key={s.key}
                role="radio"
                aria-checked={status === s.key}
                onClick={() => setStatus(s.key)}
                className={cn(
                  'px-4 text-sm',
                  i > 0 && 'border-l border-line',
                  status === s.key ? 'bg-white/90 font-semibold text-oxford shadow-sm' : 'text-ink hover:bg-white/60'
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1" />
        <Button
          variant="gold"
          className="h-10.5 rounded-[10px]"
          onClick={() => {
            setGenMonth(month);
            setGenOpen(true);
          }}
        >
          Generate fees…
        </Button>
      </div>

      {list.loading && !list.data ? (
        <div className="glass-b flex flex-col gap-2 rounded-2xl p-4" aria-busy>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      ) : list.error && !list.data ? (
        <ErrorState title="Couldn't load fees" message={list.error} onRetry={list.reload} />
      ) : list.data && list.data.rows.length === 0 ? (
        <div className="glass-b rounded-2xl">
          <EmptyState
            icon={<IndianRupee size={26} strokeWidth={1.7} />}
            title={`No fees for ${monthLabel(month)}`}
            text="Fees are generated on the 1st of every month. You can also generate them now."
            action={
              <Button variant="gold" onClick={() => { setGenMonth(month); setGenOpen(true); }}>
                Generate fees
              </Button>
            }
          />
        </div>
      ) : (
        list.data && <DataTable columns={columns} rows={list.data.rows} rowKey={(f) => f._id} footer={<Pagination p={list.data.pagination} onPage={setPage} />} />
      )}

      <ConfirmDialog
        open={!!payTarget}
        tone="primary"
        title="Mark fee as paid?"
        description={payTarget ? `${payTarget.student?.name ?? 'Student'} · ${monthLabel(payTarget.month)} · ${formatRupees(payTarget.amount)}` : ''}
        confirmLabel="Mark as paid"
        loading={busy}
        onCancel={() => setPayTarget(null)}
        onConfirm={markPaid}
      />

      <ConfirmDialog
        open={genOpen}
        tone="primary"
        title={`Generate fees for ${monthLabel(genMonth)}?`}
        description="Creates an unpaid fee for every approved student with a monthly fee set. Students who already have a fee for this month are skipped."
        confirmLabel="Generate fees"
        loading={busy}
        onCancel={() => setGenOpen(false)}
        onConfirm={generate}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Month</span>
          <select
            value={genMonth}
            onChange={(e) => setGenMonth(e.target.value)}
            className="glass-c h-10.5 rounded-[10px] px-3 text-sm"
            style={{ color: '#172B45' }}
          >
            {[nextMonth, ...monthOptions()].map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        </label>
      </ConfirmDialog>
    </div>
  );
}
