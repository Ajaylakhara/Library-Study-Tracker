import { cn } from '../helper/cn';
export * from './SeatTile';

export function StudentSeatLegend() {
  const item = 'flex items-center gap-1.5';
  const box = 'flex h-3.5 w-3.5 items-center justify-center rounded text-[9px]';
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted">
      <span className={item}>
        <span className={cn(box, 'border border-free bg-paper')} />
        Free
      </span>
      <span className={item}>
        <span className={cn(box, 'border-2 border-gold bg-[#f5eedf]')}>✓</span>
        Selected
      </span>
      <span className={item}>
        <span className={cn(box, 'border border-[#e3c3bf] bg-occupied-bg text-occupied')}>✕</span>
        Taken
      </span>
    </div>
  );
}

export function AdminSeatLegend() {
  const item = 'flex items-center gap-1.5';
  const box = 'flex h-3.5 w-3.5 items-center justify-center rounded border text-[9px]';
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
      <span className={item}>
        <span className={cn(box, 'border-free text-free')}>○</span>Free
      </span>
      <span className={item}>
        <span className={cn(box, 'border-occupied bg-occupied-bg text-occupied')}>●</span>Occupied
      </span>
      <span className={item}>
        <span className={cn(box, 'border-warn bg-warn-bg font-bold text-warn-fg')}>!</span>Overtime
      </span>
      <span className={item}>
        <span className={cn(box, 'border-dashed border-inactive bg-inactive-bg')}>–</span>Inactive
      </span>
      <span className={item}>
        <span className="h-3.5 w-3.5 rounded border-2 border-gold" />Selected
      </span>
    </div>
  );
}
