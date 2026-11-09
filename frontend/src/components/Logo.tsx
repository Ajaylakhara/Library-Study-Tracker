import { cn } from '../helper/cn';

export function LogoMark({ size = 30, className }: { size?: number; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('flex shrink-0 items-center justify-center rounded-full border border-gold font-serif font-semibold text-gold-light', className)}
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      L
    </div>
  );
}
