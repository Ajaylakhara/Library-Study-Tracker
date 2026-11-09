import { AlertCircle } from 'lucide-react';
import { cn } from '../helper/cn';
import { ProgressBar } from './Controls';
import { formatHMS } from '../helper/formatMinutes';
import { clock } from '../helper/date';

export interface SessionTimerProps {
  seatNumber: number;
  shiftHours: number;
  checkInAt: string;
  shiftEndsAt: string;
  remainingMs: number;
  overtime: boolean;
  ending: boolean;
  progress: number;
  className?: string;
}

export function SessionTimer({
  seatNumber,
  shiftHours,
  checkInAt,
  shiftEndsAt,
  remainingMs,
  overtime,
  ending,
  progress,
  className,
}: SessionTimerProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-xl border bg-paper p-5.5 shadow-card',
        overtime ? 'border-occupied' : 'border-gold',
        className
      )}
    >
      {overtime ? (
        <div className="flex items-center gap-2 text-xs font-semibold tracking-[0.12em] text-occupied-fg">
          <AlertCircle size={18} /> SHIFT ENDED
        </div>
      ) : (
        <div className="kicker flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-free" /> Active session · {shiftHours}h shift
        </div>
      )}
      <div className="font-serif text-[32px] font-semibold leading-[1.15]">
        You are at
        <br />
        Seat {seatNumber}
      </div>
      <div className="h-px bg-line" />

      {overtime ? (
        <div className="flex flex-col gap-1.5">
          <div className="tnum font-serif text-[52px] font-semibold leading-[1.1] text-occupied" aria-live="off">
            +{formatHMS(-remainingMs)}
          </div>
          <span className="self-start rounded-md bg-occupied px-2.5 py-1 text-xs font-bold tracking-[0.12em] text-paper">
            OVERTIME
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="text-[13px] text-muted">Time remaining</div>
          <div
            className={cn('tnum font-serif text-[52px] font-semibold leading-[1.1] tracking-wide', ending && 'text-warn-fg')}
            role="timer"
          >
            {formatHMS(remainingMs)}
          </div>
        </div>
      )}

      <ProgressBar value={overtime ? 1 : progress} tone={overtime ? 'red' : ending ? 'amber' : 'blue'} label="Shift progress" />

      {overtime ? (
        <p className="text-[13px] leading-relaxed">
          Your shift ended at {clock(shiftEndsAt)}. Please check out so the seat can be given to the next student.
        </p>
      ) : (
        <div className="tnum flex justify-between text-[13px] text-muted">
          <span>In at {clock(checkInAt)}</span>
          <span className="font-semibold text-ink">Shift ends at {clock(shiftEndsAt)}</span>
        </div>
      )}
    </div>
  );
}
