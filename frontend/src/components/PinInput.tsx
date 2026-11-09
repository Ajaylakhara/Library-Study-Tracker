import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../helper/cn';

interface Props {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  compact?: boolean;
  /** called when the 6th digit is entered */
  onComplete?: (v: string) => void;
  hideToggle?: boolean;
}

const LEN = 6;

export function PinInput({ label, value, onChange, error, disabled, autoFocus, compact, onComplete, hideToggle }: Props) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const [show, setShow] = useState(false);
  const digits = Array.from({ length: LEN }, (_, i) => value[i] ?? '');

  const focus = (i: number) => refs.current[Math.max(0, Math.min(LEN - 1, i))]?.focus();

  const setAt = (i: number, d: string) => {
    const arr = digits.slice();
    arr[i] = d;
    const next = arr.join('').slice(0, LEN);
    onChange(next);
    if (next.length === LEN && !arr.includes('')) onComplete?.(next);
  };

  const onInput = (i: number, raw: string) => {
    const d = raw.replace(/\D/g, '');
    if (!d) return;
    if (d.length > 1) {
      // autofill or multi-char input: spread across boxes
      const next = (value.slice(0, i) + d).slice(0, LEN);
      onChange(next);
      focus(next.length >= LEN ? LEN - 1 : next.length);
      if (next.length === LEN) onComplete?.(next);
      return;
    }
    setAt(i, d);
    if (i < LEN - 1) focus(i + 1);
  };

  const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (digits[i]) {
        const arr = digits.slice();
        arr[i] = '';
        onChange(arr.join('').replace(/\s+$/g, ''));
      } else if (i > 0) {
        onChange(value.slice(0, i - 1));
        focus(i - 1);
      }
    } else if (e.key === 'ArrowLeft') focus(i - 1);
    else if (e.key === 'ArrowRight') focus(i + 1);
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const d = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, LEN);
    if (!d) return;
    e.preventDefault();
    onChange(d);
    focus(d.length >= LEN ? LEN - 1 : d.length);
    if (d.length === LEN) onComplete?.(d);
  };

  return (
    <div className="flex flex-col gap-2" role="group" aria-label={label}>
      <div className="flex items-center justify-between">
        <span className={cn('font-semibold', compact ? 'text-[13px]' : 'text-sm')}>{label}</span>
        {!hideToggle && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide PIN' : 'Show PIN'}
            className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted hover:text-ink"
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
            {show ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      <div className={cn('grid grid-cols-6', compact ? 'gap-1.5' : 'gap-2')}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type={show ? 'text' : 'password'}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={LEN}
            value={d}
            disabled={disabled}
            autoFocus={autoFocus && i === 0}
            aria-label={`${label}, digit ${i + 1}`}
            aria-invalid={error}
            onChange={(e) => onInput(i, e.target.value)}
            onKeyDown={(e) => onKey(i, e)}
            onPaste={onPaste}
            onFocus={(e) => e.target.select()}
            className={cn(
              'min-w-0 rounded-[10px] border bg-paper text-center tnum text-ink transition-colors',
              'focus:border-2 focus:border-gold focus:outline-none disabled:opacity-50',
              compact ? 'h-11 text-lg' : 'h-13 text-[22px]',
              error ? 'border-[1.5px] border-occupied' : 'border-line-strong'
            )}
          />
        ))}
      </div>
    </div>
  );
}
