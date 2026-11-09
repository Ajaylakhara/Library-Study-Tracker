import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../helper/cn';

interface FieldProps {
  label: string;
  helper?: string;
  error?: string | null;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

export function Field({ label, helper, error, children }: FieldProps) {
  const id = useId();
  const descId = error || helper ? `${id}-d` : undefined;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold" style={{ color: '#172B45' }}>
        {label}
      </label>
      {children(id, descId)}
      {(error || helper) && (
        <span
          id={descId}
          className="text-xs"
          style={{ color: error ? '#8E3232' : '#5A6A7F' }}
          role={error ? 'alert' : undefined}
        >
          {error || helper}
        </span>
      )}
    </div>
  );
}

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'prefix'> {
  label: string;
  value: string;
  onChange: (v: string) => void;
  helper?: string;
  error?: string | null;
  prefix?: ReactNode;
  large?: boolean;
}

export function Input({ label, value, onChange, helper, error, prefix, large = true, className, ...rest }: InputProps) {
  return (
    <Field label={label} helper={helper} error={error}>
      {(id, desc) => (
        <div
          className={cn('flex w-full overflow-hidden rounded-xl transition-colors', large ? 'h-13' : 'h-12')}
          style={{
            background: 'rgba(255,255,255,.72)',
            border: `1px solid ${error ? '#C97B78' : 'rgba(3,39,85,.16)'}`,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,.85)',
          }}
        >
          {prefix && (
            <span
              className="flex items-center border-r px-3.5 text-[15px]"
              style={{ color: '#5A6A7F', borderColor: 'rgba(3,39,85,.12)' }}
            >
              {prefix}
            </span>
          )}
          <input
            id={id}
            aria-describedby={desc}
            aria-invalid={!!error}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={cn('min-w-0 flex-1 bg-transparent px-3.5 text-base outline-none', className)}
            style={{ color: '#172B45' }}
            onFocus={(e) => {
              e.currentTarget.parentElement!.style.borderColor = '#032755';
              e.currentTarget.parentElement!.style.boxShadow =
                '0 0 0 3px rgba(248,179,69,.45), inset 0 1px 0 rgba(255,255,255,.85)';
            }}
            onBlur={(e) => {
              e.currentTarget.parentElement!.style.borderColor = error ? '#C97B78' : 'rgba(3,39,85,.16)';
              e.currentTarget.parentElement!.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,.85)';
            }}
            {...rest}
          />
        </div>
      )}
    </Field>
  );
}

export function PhoneInput({
  value, onChange, label = 'Phone number', error, autoFocus,
}: {
  value: string; onChange: (v: string) => void; label?: string; error?: string | null; autoFocus?: boolean;
}) {
  return (
    <Input
      label={label}
      prefix="+91"
      value={value}
      onChange={(v) => onChange(v.replace(/\D/g, '').slice(0, 10))}
      inputMode="numeric"
      autoComplete="tel-national"
      placeholder="98765 43210"
      maxLength={10}
      error={error}
      autoFocus={autoFocus}
      className="tnum"
    />
  );
}

/** Compact search box */
export function SearchBox({
  value, onChange, placeholder, label, className,
}: {
  value: string; onChange: (v: string) => void;
  placeholder: string; label: string; className?: string;
}) {
  return (
    <div
      className={cn('glass-c flex h-10 items-center gap-2 rounded-[10px] px-3', className)}
      style={{ border: '1px solid rgba(3,39,85,.16)' }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5A6A7F" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-4.5-4.5" />
      </svg>
      <input
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        style={{ color: '#172B45' }}
      />
    </div>
  );
}
