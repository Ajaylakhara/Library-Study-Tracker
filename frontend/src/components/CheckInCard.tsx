import type { ReactNode } from 'react';
import { cn } from '../helper/cn';

interface CheckInCardProps {
  seatNumber?: number;
  shiftHours?: number;
  className?: string;
  children?: ReactNode;
}

export function CheckInCard({ seatNumber, shiftHours, className, children }: CheckInCardProps) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border border-line bg-paper p-5 shadow-card', className)}>
      {seatNumber != null && (
        <div className="font-serif text-2xl font-semibold">
          Seat {seatNumber} {shiftHours ? `· ${shiftHours}h shift` : ''}
        </div>
      )}
      {children}
    </div>
  );
}
