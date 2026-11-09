import { WifiOff } from 'lucide-react';
import { cn } from '../helper/cn';
import { Button } from './Button';

export function ErrorState({
  title = "Couldn't load this",
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center gap-3 px-6 py-12 text-center', className)}>
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-line text-muted" aria-hidden>
        <WifiOff size={26} strokeWidth={1.7} />
      </div>
      <div className="font-serif text-[22px] font-semibold leading-tight">{title}</div>
      <p className="max-w-65 text-sm leading-relaxed text-muted">{message || 'Check your internet connection and try again.'}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
