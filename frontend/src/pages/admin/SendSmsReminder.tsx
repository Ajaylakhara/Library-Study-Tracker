import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ENDPOINTS } from '../../config/endpoints';
import { Button } from '../../components/Button';
import { useAdminHeader } from '../../layout/AdminLayout';
import { get, post } from '../../store/api';
import { useAppDispatch } from '../../hooks/useRedux';
import { errMsg } from '../../toolkit/createAppThunk';
import { showToast } from '../../toolkit/toastSlice';

interface SmsAction {
  notificationId: string;
  phone: string;
  message: string;
  smsUri: string;
}

export function Component() {
  useAdminHeader('Send SMS', 'Review and send the prepared reminder');
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const [action, setAction] = useState<SmsAction | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    get<SmsAction>(ENDPOINTS.admin.smsReminderAction(token))
      .then((response) => { if (active) setAction(response.data); })
      .catch((cause: unknown) => { if (active) setError(errMsg(cause)); });
    return () => { active = false; };
  }, [token]);

  const copyMessage = async () => {
    if (!action) return;
    try {
      await navigator.clipboard.writeText(action.message);
      dispatch(showToast('success', 'Reminder message copied.'));
    } catch {
      dispatch(showToast('error', 'Could not copy the reminder. Select and copy the message instead.'));
    }
  };

  const markSent = async () => {
    if (!action) return;
    setBusy(true);
    try {
      await post(ENDPOINTS.admin.markReminderSent(action.notificationId), {});
      dispatch(showToast('success', 'Reminder marked as sent.'));
      navigate('/admin/fees', { replace: true });
    } catch (cause) {
      dispatch(showToast('error', errMsg(cause)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-2xl">
      <div className="glass-b flex min-w-0 flex-col gap-5 rounded-2xl p-5 sm:p-7">
        <div>
          <h2 className="m-0 font-serif text-2xl font-semibold text-oxford">Reminder by SMS</h2>
          {action && <p className="mb-0 mt-2 text-sm text-muted">To {action.phone}</p>}
        </div>
        {error ? (
          <p role="alert" className="m-0 text-sm text-occupied">{error}</p>
        ) : !action ? (
          <p role="status" className="m-0 text-sm text-muted">Loading secure reminder…</p>
        ) : (
          <>
            <label className="flex flex-col gap-2 text-sm font-semibold">
              Message
              <textarea
                readOnly
                value={action.message}
                rows={7}
                className="glass-c w-full rounded-xl p-3 text-sm font-normal"
              />
            </label>
            <div className="grid gap-2 sm:grid-cols-3">
              <a className="flex min-h-12 items-center justify-center rounded-xl border border-oxford bg-oxford px-4 text-center font-semibold text-white no-underline" href={action.smsUri}>
                Open SMS app
              </a>
              <Button variant="secondary" onClick={() => void copyMessage()}>Copy message</Button>
              <Button variant="gold" onClick={() => void markSent()} loading={busy}>Mark sent</Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
