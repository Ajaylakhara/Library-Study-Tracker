import type { ReactNode, SelectHTMLAttributes } from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../helper/cn';
import { monthLabel, shiftMonth, currentMonth } from '../helper/date';

export function Toggle({
  checked, onChange, label, sub, disabled,
}: {
  checked: boolean; onChange: (v: boolean) => void;
  label: string; sub?: string; disabled?: boolean;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] font-medium" style={{ color: '#172B45' }}>{label}</span>
        {sub && <span className="text-xs" style={{ color: '#5A6A7F' }}>{sub}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative h-7 w-12 shrink-0 rounded-full border transition-colors disabled:opacity-50"
        style={{
          borderColor: checked ? '#032755' : '#d6ccb8',
          background: checked ? '#032755' : '#E8E0D2',
        }}
      >
        <span
          className="absolute top-[3px] h-5 w-5 rounded-full shadow transition-all"
          style={{
            background: '#FFFEFC',
            left: checked ? '22px' : '3px',
          }}
        />
      </button>
    </div>
  );
}

export function Checkbox({ checked, onChange, label }: {
  checked: boolean; onChange: (v: boolean) => void; label: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className={cn(
          'flex h-5.5 w-5.5 items-center justify-center rounded-md border-[1.5px] text-white transition-colors',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2',
        )}
        style={{
          borderColor: checked ? '#032755' : '#8a93a0',
          background: checked ? '#032755' : '#FFFEFC',
          outlineColor: '#F8B345',
        }}
      >
        {checked && <Check size={14} strokeWidth={3} />}
      </span>
      {label}
    </label>
  );
}

export function Select({
  label, children, className, ...rest
}: { label: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold" style={{ color: '#172B45' }}>{label}</span>
      <select
        className={cn('glass-c h-10.5 rounded-[10px] px-3 text-sm focus:outline-none', className)}
        style={{ color: '#172B45' }}
        {...rest}
      >
        {children}
      </select>
    </label>
  );
}

/** Previous / next month switcher */
export function MonthSwitcher({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const atCurrent = month >= currentMonth();
  return (
    <div
      className="glass-c flex h-12 items-center justify-between rounded-xl px-1"
    >
      <button
        aria-label="Previous month"
        onClick={() => onChange(shiftMonth(month, -1))}
        className="flex h-10 w-11 items-center justify-center rounded-lg transition-colors hover:bg-white/50"
        style={{ color: '#032755' }}
      >
        <ChevronLeft size={20} />
      </button>
      <span className="font-serif text-lg font-semibold" style={{ color: '#172B45' }} aria-live="polite">
        {monthLabel(month)}
      </span>
      <button
        aria-label="Next month"
        disabled={atCurrent}
        onClick={() => onChange(shiftMonth(month, 1))}
        className={cn('flex h-10 w-11 items-center justify-center rounded-lg transition-colors', !atCurrent && 'hover:bg-white/50')}
        style={{ color: atCurrent ? '#A7AFBA' : '#032755' }}
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}

export function ProgressBar({ value, tone = 'blue', label }: {
  value: number; tone?: 'blue' | 'amber' | 'red'; label: string;
}) {
  const color = tone === 'red' ? '#C97B78' : tone === 'amber' ? '#E2A23B' : '#032755';
  const pct   = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-2 overflow-hidden rounded-full"
      style={{ background: 'rgba(3,39,85,.10)' }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

export function StatCard({
  label, value, note, icon, tint, compact,
}: {
  label: string; value: ReactNode; note?: string;
  icon?: ReactNode; tint?: string; compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'glass-b lift flex items-center gap-4 rounded-2xl',
        compact ? 'p-3.5' : 'p-5'
      )}
    >
      {icon && (
        <div
          className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-lg font-bold', tint)}
          aria-hidden
        >
          {icon}
        </div>
      )}
      <div className="flex min-w-0 flex-col">
        <span className="text-[13px]" style={{ color: '#5A6A7F' }}>{label}</span>
        <span className="tnum font-serif text-[30px] font-semibold leading-tight" style={{ color: '#172B45' }}>{value}</span>
        {note && <span className="text-xs" style={{ color: '#5A6A7F' }}>{note}</span>}
      </div>
    </div>
  );
}
