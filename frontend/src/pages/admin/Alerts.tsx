import { useEffect, useRef, useState } from 'react';
import { BellOff, Check, CheckCheck, MessageCircle } from 'lucide-react';
import { del, get, patch, post } from '../../store/api';
import { ENDPOINTS } from '../../config/endpoints';
import { useAdminHeader, useRefreshBadges } from '../../layout/AdminLayout';
import { useAsync } from '../../hooks/useAsync';
import { useAppDispatch } from '../../hooks/useRedux';
import { showToast } from '../../toolkit/toastSlice';
import { errMsg } from '../../toolkit/createAppThunk';
import { Button } from '../../components/Button';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { DataTable, type Column } from '../../components/DataTable';
import { Pagination } from '../../components/Pagination';
import { formatPhone } from '../../helper/formatMinutes';
import { dateTimeLabel, NOTIFICATION_LABELS } from '../../helper/date';
import { cn } from '../../helper/cn';
import type { AdminTelegramLink, AdminTelegramStatus, AppNotification, Pagination as P } from '../../types';

const PAGE_SIZE = 15;
// Overtime follow-up is temporarily disabled while its delivery method is undecided.
type Tab = 'failed' | 'all';

const CHANNEL: Record<string, string> = { whatsapp: 'WhatsApp', sms: 'SMS', inapp: 'In-app' };

function TelegramCard() {
  const dispatch = useAppDispatch();
  const [status, setStatus] = useState<AdminTelegramStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [linkCreated, setLinkCreated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const refreshStatus = async () => {
    try {
      const response = await get<AdminTelegramStatus>(ENDPOINTS.admin.telegramStatus);
      setStatus(response.data);
      setError(null);
      if (response.data.connected) {
        stopPolling();
        setLinkCreated(false);
      }
      return response.data;
    } catch (e) {
      setError(errMsg(e));
      throw e;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshStatus().catch(() => undefined);
    return stopPolling;
  }, []);

  const beginStatusPolling = () => {
    stopPolling();
    const expiresAt = Date.now() + 2 * 60 * 1000;
    pollRef.current = setInterval(() => {
      if (Date.now() >= expiresAt) {
        stopPolling();
        return;
      }
      void refreshStatus().catch(() => undefined);
    }, 5000);
  };

  const connectTelegram = async () => {
    const telegramWindow = window.open('about:blank', '_blank');
    if (!telegramWindow) {
      setError('Allow pop-ups for this site, then try connecting again.');
      return;
    }
    telegramWindow.opener = null;
    setConnecting(true);
    setError(null);
    try {
      const response = await post<AdminTelegramLink>(ENDPOINTS.admin.telegramLink);
      telegramWindow.location.href = response.data.link;
      setLinkCreated(true);
      beginStatusPolling();
    } catch (e) {
      telegramWindow.close();
      const message = errMsg(e);
      setError(message);
      dispatch(showToast('error', message));
    } finally {
      setConnecting(false);
    }
  };

  const disconnectTelegram = async () => {
    setDisconnecting(true);
    setError(null);
    try {
      await del(ENDPOINTS.admin.telegramDisconnect);
      setConfirmDisconnect(false);
      setLinkCreated(false);
      stopPolling();
      await refreshStatus();
      dispatch(showToast('success', 'Telegram disconnected.'));
    } catch (e) {
      const message = errMsg(e);
      setError(message);
      dispatch(showToast('error', message));
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <>
      <section className="glass-b flex flex-col gap-4 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="glass-c flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-oxford">
            <MessageCircle size={20} />
          </div>
          <div>
            <h2 className="font-semibold text-oxford">Telegram</h2>
            {loading ? (
              <p className="mt-1 text-sm text-muted">Checking connection status…</p>
            ) : status?.connected ? (
              <p className="mt-1 flex items-center gap-2 text-sm text-free-fg">
                <span className="h-2 w-2 rounded-full bg-free" aria-hidden />
                Connected
              </p>
            ) : (
              <div className="mt-1">
                <p className="text-sm text-muted">Connect Telegram to receive admin alerts in your bot chat.</p>
                {linkCreated && (
                  <p className="mt-1 text-sm text-oxford">
                    Press Start in Telegram. The link expires in 10 minutes.
                  </p>
                )}
              </div>
            )}
            {error && <p className="mt-2 text-sm text-occupied-fg" role="alert">{error}</p>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          {status?.connected ? (
            <Button variant="dangerOutline" size="sm" onClick={() => setConfirmDisconnect(true)}>
              Disconnect
            </Button>
          ) : (
            <Button size="sm" loading={connecting} disabled={loading} onClick={() => void connectTelegram()}>
              Connect Telegram
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={loading || connecting || disconnecting}
            onClick={() => {
              setError(null);
              void refreshStatus().catch(() => undefined);
            }}
          >
            Refresh status
          </Button>
        </div>
      </section>
      <ConfirmDialog
        open={confirmDisconnect}
        title="Disconnect Telegram?"
        description="You will stop receiving Telegram admin alerts until you connect again."
        confirmLabel="Disconnect"
        tone="danger"
        loading={disconnecting}
        onCancel={() => setConfirmDisconnect(false)}
        onConfirm={() => void disconnectTelegram()}
      />
    </>
  );
}

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
      <TelegramCard />
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
