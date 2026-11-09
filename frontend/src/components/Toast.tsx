import { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../hooks/useRedux';
import { dismissToast, type Toast, type ToastType } from '../toolkit/toastSlice';

const STYLES: Record<ToastType, { icon: typeof Info; ms: number; accentColor: string }> = {
  success: { icon: CheckCircle2, ms: 3000, accentColor: '#3FA584' },
  error:   { icon: AlertCircle,  ms: 6000, accentColor: '#C97B78' },
  info:    { icon: Info,         ms: 3000, accentColor: '#032755' },
  warning: { icon: AlertTriangle,ms: 5000, accentColor: '#E2A23B' },
};

function ToastItem({ toast }: { toast: Toast }) {
  const dispatch = useAppDispatch();
  const { icon: Icon, ms, accentColor } = STYLES[toast.type];

  useEffect(() => {
    const id = setTimeout(() => dispatch(dismissToast(toast.id)), ms);
    return () => clearTimeout(id);
  }, [dispatch, toast.id, ms]);

  return (
    <div
      role={toast.type === 'error' ? 'alert' : 'status'}
      className="glass-a glass-keep anim-toast pointer-events-auto flex items-start gap-3 rounded-2xl px-4 py-3"
      style={{ borderLeft: `4px solid ${accentColor}` }}
    >
      <Icon size={20} className="mt-0.5 shrink-0" style={{ color: accentColor }} aria-hidden />
      <p className="flex-1 text-sm leading-snug" style={{ color: '#172B45' }}>{toast.message}</p>
      <button
        onClick={() => dispatch(dismissToast(toast.id))}
        aria-label="Dismiss"
        className="flex h-6 w-6 items-center justify-center rounded-lg"
        style={{ color: '#5A6A7F' }}
      >
        <X size={16} />
      </button>
    </div>
  );
}

export function ToastHost() {
  const toasts = useAppSelector((s) => s.toast);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-50 mx-auto flex w-full max-w-sm flex-col gap-2 px-3 sm:left-auto sm:right-4 sm:mx-0"
    >
      {toasts.map((t) => <ToastItem key={t.id} toast={t} />)}
    </div>
  );
}
