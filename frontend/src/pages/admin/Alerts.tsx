import { useEffect, useState } from 'react';
import { BellOff, Check, CheckCheck } from 'lucide-react';
import { get, patch, post } from '../../store/api';
import { ENDPOINTS } from '../../config/endpoints';
import { useAdminHeader, useRefreshBadges } from '../../layout/AdminLayout';
import { useAsync } from '../../hooks/useAsync';
import { useAppDispatch } from '../../hooks/useRedux';
import { showToast } from '../../toolkit/toastSlice';
import { errMsg } from '../../toolkit/createAppThunk';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { formatPhone } from '../../helper/formatMinutes';
import { dateTimeLabel, NOTIFICATION_LABELS } from '../../helper/date';
import { cn } from '../../helper/cn';
import type { AppNotification, Pagination as P } from '../../types';

const PAGE_SIZE = 15;
// Overtime follow-up is temporarily disabled while its delivery method is undecided.
type Tab = 'failed' | 'all';

const CHANNEL: Record<string, string> = { whatsapp: 'WhatsApp', sms: 'SMS', inapp: 'In-app' };

export function Component() {
  const dispatch = useAppDispatch();
  const [tab, setTab] = useState<Tab>('failed');
  const [page, setPage] = useState(1);
  const [markingAll, setMarkingAll] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const refreshBadges = useRefreshBadges();

  useEffect(() => setPage(1), [tab]);

  const { data, loading, error, reload } = useAsync(async () => {
    const unread = await get<unknown>(ENDPOINTS.admin.unreadNotificationCount);
    const unreadCount = unread.unreadCount ?? unread.count ?? 0;
    if (tab === 'failed') {
      const r = await get<AppNotification[]>(ENDPOINTS.admin.failedNotifications);
      return { rows: r.data, unreadCount, pagination: null as P | null };
    }
    const r = await get<AppNotification[]>(ENDPOINTS.admin.notifications, { page, limit: PAGE_SIZE });
    return { rows: r.data, unreadCount, pagination: r.pagination as P };
  }, [tab, page]);

  useEffect(() => {
    refreshBadges();
  }, [data, refreshBadges]);

  useAdminHeader('Alerts', tab === 'failed' ? 'Failed & admin alerts' : 'All notifications');

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      await post(ENDPOINTS.admin.readAllNotifications);
      dispatch(showToast('success', 'All alerts marked as read.'));
      await reload();
      refreshBadges();
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
    } finally {
      setMarkingAll(false);
    }
  };

  const handleMarkRowRead = async (id: string) => {
    setMarkingId(id);
    try {
      await patch(ENDPOINTS.admin.readNotification(id), {});
      dispatch(showToast('success', 'Alert marked as read.'));
      await reload();
      refreshBadges();
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
    } finally {
      setMarkingId(null);
    }
  };

  const columns: Column<AppNotification>[] = [
    {
      key: 'student',
      header: 'Student',
      primary: true,
      render: (n) => {
        const name = n.studentNameSnapshot || n.user?.name || 'Unknown';
        const phone = n.studentPhoneSnapshot || n.user?.phone;
        const isUnread = n.read === false;

        return (
          <div className="flex items-start gap-2">
            {isUnread && (
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold"
                title="Unread alert"
                aria-label="Unread"
              />
            )}
            <div className="flex flex-col gap-0.5">
              <span className={cn('font-semibold', isUnread && 'text-oxford')}>
                {name}
              </span>
              {phone && <span className="tnum text-xs font-normal text-muted">{formatPhone(phone)}</span>}
            </div>
          </div>
        );
      },
    },
    { key: 'type', header: 'Type', render: (n) => NOTIFICATION_LABELS[n.type] ?? n.type },
    {
      key: 'channel',
      header: 'Channel',
      render: (n) => (
        <span
          className="glass-c chip rounded-full px-2.5 py-0.5 text-xs font-semibold"
          style={{ color: '#172B45' }}
        >
          {CHANNEL[n.channel] ?? n.channel}
        </span>
      ),
    },
    ...(tab === 'all'
      ? [{ key: 'status', header: 'Status', render: (n: AppNotification) => <StatusBadge status={n.status} /> } as Column<AppNotification>]
      : []),
    {
      key: 'error',
      header: 'Error message',
      render: (n) =>
        n.lastError ? (
          <span className="font-mono text-[12.5px] text-occupied-fg">{n.lastError}</span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    { key: 'attempts', header: 'Attempts', align: 'right', render: (n) => <span className="tnum">{n.attempts} / 3</span> },
    { key: 'when', header: 'Last tried', render: (n) => <span className="tnum text-muted">{dateTimeLabel(n.updatedAt)}</span> },
    {
      key: 'actions',
      header: 'Action',
      align: 'right',
      mobileHideLabel: true,
      render: (n) =>
        n.read === false ? (
          <button
            onClick={() => handleMarkRowRead(n._id)}
            disabled={markingId === n._id}
            title="Mark as read"
            aria-label="Mark alert as read"
            className="glass-c chip inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50"
            style={{ color: '#5A6A7F' }}
          >
            <Check size={14} className="text-gold" />
            <span>Mark read</span>
          </button>
        ) : (
          <span className="text-xs text-muted/70">Read</span>
        ),
    },
  ];

  const unreadCount = data?.unreadCount ?? 0;
  const hasUnread = data && data.rows.some((r) => r.read === false);

  return (
    <div className="flex flex-col gap-5">
      <div className="glass-b flex flex-col gap-3 rounded-2xl p-4 md:flex-row md:items-center md:justify-between">
        <div role="tablist" aria-label="Notification view" className="glass-c flex w-fit gap-1 rounded-[10px] p-1">
          {(['failed', 'all'] as Tab[]).map((t) => {
            const countDisplay = t === 'failed' && unreadCount > 0 ? (unreadCount > 9 ? '9+' : unreadCount) : null;
            return (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  'relative flex h-9 items-center gap-2 rounded-lg px-3 text-sm transition-all',
                  tab === t ? 'bg-white/90 font-semibold text-oxford shadow-sm' : 'text-muted hover:bg-white/60 hover:text-ink'
                )}
              >
                <span>{t === 'failed' ? 'Failed' : 'All notifications'}</span>
                {countDisplay && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1.5 text-[11px] font-bold text-navy">
                    {countDisplay}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 pb-2">
          <p className="text-sm text-muted">
            {tab === 'failed'
              ? 'Alerts needing admin attention. Messages retried 3 times appear under Failed.'
              : 'All dispatched notifications.'}
          </p>
          {hasUnread && (
            <Button
              variant="outline"
              size="sm"
              loading={markingAll}
              icon={<CheckCheck size={16} />}
              onClick={handleMarkAllRead}
            >
              Mark all as read
            </Button>
          )}
        </div>
      </div>

      {loading && !data ? (
        <div className="glass-b flex flex-col gap-2 rounded-2xl p-4" aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : error && !data ? (
        <ErrorState title="Couldn't load notifications" message={error} onRetry={reload} />
      ) : data && data.rows.length === 0 ? (
        <div className="glass-b rounded-2xl">
          <EmptyState
            icon={<BellOff size={26} strokeWidth={1.7} />}
            title={tab === 'failed' ? 'No failed messages' : 'No notifications yet'}
            text={tab === 'failed' ? 'Every message was delivered. Nothing needs your attention.' : 'Alerts sent to students and staff appear here.'}
          />
        </div>
      ) : (
        data && (
          <DataTable
            columns={columns}
            rows={data.rows}
            rowKey={(n) => n._id}
            footer={data.pagination ? <Pagination p={data.pagination} onPage={setPage} /> : undefined}
          />
        )
      )}
    </div>
  );
}
