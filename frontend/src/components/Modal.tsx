import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../helper/cn';
import { Button } from './Button';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  kicker?: string;
  children: ReactNode;
  footer?: ReactNode;
  locked?: boolean;
  width?: string;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Centered on desktop, bottom sheet on mobile. Glass-a dialog card with overlay scrim. */
export function Modal({
  open, onClose, title, kicker, children, footer, locked,
  width = 'sm:max-w-[460px]',
}: ModalProps) {
  const ref    = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prev        = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const node  = ref.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked) {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === 'Tab' && node) {
        const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (!items.length) return;
        const a = items[0];
        const z = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
  }, [open, locked]);

  if (!open) return null;

  return createPortal(
    /* Scrim — static blur, only opacity animates */
    <div
      className="overlay anim-fade fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}
    >
      {/* Dialog card — glass-a */}
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          'modal-dialog glass-a glass-keep anim-sheet sm:anim-pop',
          'flex max-h-[90dvh] w-full flex-col gap-4 overflow-hidden',
          'rounded-t-[24px] px-5 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3',
          'sm:max-h-[90dvh] sm:rounded-2xl sm:p-7',
          width
        )}
      >
        {/* Drag handle (mobile) */}
        <div className="mx-auto h-1 w-10 rounded-full sm:hidden" style={{ background: 'rgba(3,39,85,.18)' }} aria-hidden />

        <div className="modal-scroll-body flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-1">
            {kicker && <span className="kicker">{kicker}</span>}
            <h2 id={titleId} className="font-serif text-2xl font-semibold leading-tight" style={{ color: '#172B45' }}>
              {title}
            </h2>
          </div>
          {children}
        </div>

        {footer && (
          <div className="modal-actions flex shrink-0 flex-col-reverse gap-2 pt-4 sm:flex-row sm:justify-end"
               style={{ borderTop: '1px solid rgba(3,39,85,.10)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export interface ConfirmProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

export function ConfirmDialog({
  open, title, description, confirmLabel, cancelLabel = 'Cancel',
  tone = 'danger', loading, onConfirm, onCancel, children,
}: ConfirmProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      locked={loading}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>{cancelLabel}</Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading} data-autofocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {description && <p className="text-[15px] leading-relaxed" style={{ color: '#5A6A7F' }}>{description}</p>}
      {children}
    </Modal>
  );
}
