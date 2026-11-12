import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, IndianRupee, ReceiptText } from 'lucide-react';
import { get, isApiError, patch, post } from '../../store/api';
import { ENDPOINTS } from '../../config/endpoints';
import { errMsg } from '../../toolkit/createAppThunk';
import { useAppDispatch } from '../../hooks/useRedux';
import { showToast } from '../../toolkit/toastSlice';
import { useAdminHeader } from '../../layout/AdminLayout';
import { useAsync } from '../../hooks/useAsync';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Modal } from '../../components/Modal';
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
import type { AdminFee, FeeReminderChannel, Pagination as P, PreparedFeeReminder, SentFeeReminder } from '../../types';

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

function reminderChannelLabel(channel: FeeReminderChannel): string {
  return channel === 'whatsapp' ? 'WhatsApp' : channel === 'sms' ? 'SMS' : 'Telegram';
}

export function Component() {
  const dispatch = useAppDispatch();
  const [month, setMonth] = useState(currentMonth());
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [payTarget, setPayTarget] = useState<AdminFee | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reminderFee, setReminderFee] = useState<AdminFee | null>(null);
  const [preparedReminder, setPreparedReminder] = useState<PreparedFeeReminder | null>(null);
  const [reminderChannel, setReminderChannel] = useState<FeeReminderChannel>('whatsapp');
  const [reminderMessage, setReminderMessage] = useState('');
  const [confirmRecent, setConfirmRecent] = useState(false);
  const [reminderResult, setReminderResult] = useState<SentFeeReminder | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [markingReminderSent, setMarkingReminderSent] = useState(false);

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

  const openReminder = async (fee: AdminFee) => {
    setReminderFee(fee);
    setPreparedReminder(null);
    setReminderResult(null);
    setConfirmRecent(false);
    setReminderBusy(true);
    try {
      const response = await post<PreparedFeeReminder>(ENDPOINTS.admin.prepareFeeReminder(fee._id), {});
      setPreparedReminder(response.data);
      setReminderMessage(response.data.message);
      setReminderChannel(response.data.preferredChannel);
    } catch (error) {
      setReminderFee(null);
      dispatch(showToast('error', errMsg(error)));
    } finally {
      setReminderBusy(false);
    }
  };

  const submitReminder = async () => {
    if (!preparedReminder) return;
    setReminderBusy(true);
    let popup: Window | null = null;
    try {
      popup = reminderChannel === 'telegram' ? null : window.open('about:blank', '_blank');
      const response = await post<SentFeeReminder>(
        ENDPOINTS.admin.sendFeeReminder(preparedReminder.feeId),
        {
          channel: reminderChannel,
          message: reminderMessage,
          confirmRecent,
        }
      );
      setReminderResult(response.data);
      if (popup) {
        const url = reminderChannel === 'sms' ? response.data.smsUri : response.data.url;
        if (url) popup.location.href = url;
        else popup.close();
      }
      if (response.data.telegramSent) {
        dispatch(showToast('success', 'Reminder sent on Telegram.'));
        list.refresh();
        totals.refresh();
      }
    } catch (error) {
      popup?.close();
      if (isApiError(error) && error.status === 409 && reminderFee) {
        try {
          const latest = await post<PreparedFeeReminder>(
            ENDPOINTS.admin.prepareFeeReminder(reminderFee._id),
            {}
          );
          setPreparedReminder(latest.data);
          setReminderMessage(latest.data.message);
          setConfirmRecent(false);
        } catch (refreshError) {
          dispatch(showToast('error', `Could not refresh reminder status: ${errMsg(refreshError)}`));
        }
      }
      dispatch(showToast('error', errMsg(error)));
    } finally {
      setReminderBusy(false);
    }
  };

  const markReminderSent = async () => {
    if (!reminderResult?.notificationId) return;
    setMarkingReminderSent(true);
    try {
      await post(ENDPOINTS.admin.markReminderSent(reminderResult.notificationId), {});
      dispatch(showToast('success', 'Reminder marked as sent.'));
      setReminderFee(null);
      list.refresh();
      totals.refresh();
    } catch (error) {
      dispatch(showToast('error', errMsg(error)));
    } finally {
      setMarkingReminderSent(false);
    }
  };

  const copyReminder = async () => {
    try {
      await navigator.clipboard.writeText(reminderMessage);
      dispatch(showToast('success', 'Reminder message copied.'));
    } catch {
      dispatch(showToast('error', 'Could not copy the reminder. Select and copy the message instead.'));
    }
  };

  const columns: Column<AdminFee>[] = [
    { key: 'student', header: 'Student', primary: true, render: (f) => <span className="font-semibold">{f.student?.name ?? 'Deleted user'}</span> },
    { key: 'phone', header: 'Phone', render: (f) => <span className="tnum">{f.student ? formatPhone(f.student.phone) : '—'}</span> },
    { key: 'month', header: 'Month', render: (f) => monthLabel(f.month) },
    { key: 'amount', header: 'Amount', align: 'right', render: (f) => <span className="tnum font-semibold">{formatRupees(f.amount)}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (f) => (
        <span className="flex flex-col items-start gap-1">
          <StatusBadge status={f.status} />
          <span className="text-[11px] leading-snug text-muted">
            {f.lastReminderAt && f.lastReminderChannel
              ? `Reminded ${dateLabel(f.lastReminderAt)}, ${reminderChannelLabel(f.lastReminderChannel)}`
              : 'Not reminded'}
          </span>
        </span>
      ),
    },
    { key: 'paidOn', header: 'Paid on', render: (f) => <span className="tnum text-muted">{f.paidAt ? dateLabel(f.paidAt) : '—'}</span> },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      mobileHideLabel: true,
      render: (f) =>
        f.status === 'unpaid' ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button size="sm" variant="gold" onClick={() => void openReminder(f)}>Remind</Button>
            <Button size="sm" variant="successOutline" onClick={() => setPayTarget(f)}>Mark Paid</Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div className="admin-fee-stats grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
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

      <Modal
        open={!!reminderFee}
        onClose={() => { if (!reminderBusy && !markingReminderSent) setReminderFee(null); }}
        title="Send fee reminder"
        kicker="Fee follow-up"
        width="sm:max-w-[560px]"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReminderFee(null)} disabled={reminderBusy || markingReminderSent}>Close</Button>
            {preparedReminder && !reminderResult && (
              <Button
                variant="gold"
                onClick={() => void submitReminder()}
                loading={reminderBusy}
                disabled={!!preparedReminder.lastReminder && !confirmRecent}
              >
                {reminderChannel === 'telegram' ? 'Send now' : reminderChannel === 'sms' ? 'Open SMS app' : 'Open WhatsApp'}
              </Button>
            )}
          </>
        }
      >
        {reminderBusy && !preparedReminder ? (
          <p role="status" className="text-sm text-muted">Preparing reminder…</p>
        ) : preparedReminder ? (
          <div className="flex min-w-0 flex-col gap-4">
            <dl className="grid min-w-0 grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-muted">Student</dt><dd className="break-words font-semibold">{preparedReminder.studentName}</dd></div>
              <div><dt className="text-xs text-muted">Phone</dt><dd className="break-all">{preparedReminder.phone}</dd></div>
              <div><dt className="text-xs text-muted">Month</dt><dd>{monthLabel(preparedReminder.month)}</dd></div>
              <div><dt className="text-xs text-muted">Amount</dt><dd>{formatRupees(preparedReminder.amount)}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-muted">Total due</dt><dd className="font-semibold">{formatRupees(preparedReminder.totalDue)}</dd></div>
            </dl>

            <fieldset className="flex flex-wrap gap-2">
              <legend className="mb-2 text-sm font-semibold">Reminder channel</legend>
              {(['whatsapp', 'sms', 'telegram'] as const).map((channel) => {
                const available = preparedReminder.channels.includes(channel);
                return (
                  <button
                    key={channel}
                    type="button"
                    disabled={!available || !!reminderResult}
                    aria-pressed={reminderChannel === channel}
                    title={channel === 'telegram' && !available ? 'Student has not linked Telegram' : undefined}
                    onClick={() => { setReminderChannel(channel); setReminderResult(null); }}
                    className={cn(
                      'min-h-11 rounded-xl border px-3 text-sm font-semibold',
                      reminderChannel === channel ? 'border-oxford bg-oxford text-white' : 'border-line-strong bg-white/70 text-ink',
                      !available && 'cursor-not-allowed opacity-50'
                    )}
                  >
                    {channel === preparedReminder.preferredChannel ? '★ ' : ''}
                    {reminderChannelLabel(channel)}
                    {channel === preparedReminder.preferredChannel ? ' · Preferred' : ''}
                  </button>
                );
              })}
            </fieldset>
            {!preparedReminder.channels.includes('telegram') && (
              <p className="m-0 text-xs text-muted">Telegram: Student has not linked Telegram.</p>
            )}

            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              Message preview
              <textarea
                value={reminderMessage}
                onChange={(event) => setReminderMessage(event.target.value)}
                maxLength={2000}
                rows={5}
                disabled={!!reminderResult}
                className="glass-c min-h-28 w-full resize-y rounded-xl p-3 text-sm font-normal"
              />
            </label>

            {preparedReminder.lastReminder && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <p className="m-0">
                  Last reminder: {dateLabel(preparedReminder.lastReminder.sentAt)}, {reminderChannelLabel(preparedReminder.lastReminder.channel)}.
                </p>
                <label className="mt-2 flex min-h-11 items-center gap-2">
                  <input type="checkbox" checked={confirmRecent} onChange={(event) => setConfirmRecent(event.target.checked)} />
                  Send another reminder anyway
                </label>
              </div>
            )}

            {reminderResult && (
              <div role="status" className="flex flex-col gap-2 rounded-xl bg-emerald-50 p-3 text-sm">
                {reminderResult.telegramSent ? (
                  <span>Reminder sent to Telegram.</span>
                ) : (
                  <>
                    <span>Reminder is ready to send.</span>
                    {reminderResult.url && (
                      <a className="break-all font-semibold text-oxford underline" href={reminderChannel === 'sms' ? reminderResult.url : reminderResult.url} target="_blank" rel="noreferrer">
                        {reminderChannel === 'sms' ? 'Open secure SMS reminder page' : 'Open WhatsApp'}
                      </a>
                    )}
                    {reminderResult.notificationId && (
                      <Button variant="successOutline" onClick={() => void markReminderSent()} loading={markingReminderSent}>
                        Mark as sent
                      </Button>
                    )}
                    {reminderChannel === 'sms' && <Button variant="secondary" onClick={() => void copyReminder()}>Copy message</Button>}
                  </>
                )}
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
