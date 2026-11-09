import type { ReactNode } from 'react';
import { cn } from '../helper/cn';

export function EmptyState({
  icon,
  title,
  text,
  action,
  className,
}: {
  icon: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold text-gold-dark" aria-hidden>
        {icon}
      </div>
      <div className="font-serif text-[22px] font-semibold leading-tight">{title}</div>
      {text && <p className="max-w-65 text-sm leading-relaxed text-muted">{text}</p>}
      {action}
    </div>
  );
}
