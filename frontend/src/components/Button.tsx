import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../helper/cn';
import Spinner from './Spinner';

type Variant = 'primary' | 'checkin' | 'checkout' | 'outline' | 'gold' | 'ghost' | 'danger' | 'dangerOutline' | 'successOutline';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-oxford text-paper hover:bg-navy active:bg-navy border border-oxford',
  checkin: 'bg-free text-paper hover:brightness-95 active:brightness-90 border border-free font-bold tracking-wider',
  checkout: 'bg-occupied text-paper hover:brightness-95 active:brightness-90 border border-occupied font-bold tracking-wider',
  danger: 'bg-occupied text-paper hover:brightness-95 border border-occupied',
  outline: 'bg-transparent text-oxford border border-oxford hover:bg-oxford/5',
  gold: 'bg-transparent text-gold-dark border border-gold hover:bg-gold/10',
  ghost: 'bg-transparent text-oxford border border-transparent hover:bg-oxford/5',
  dangerOutline: 'bg-transparent text-occupied border border-occupied hover:bg-occupied/5',
  successOutline: 'bg-transparent text-free-fg border border-free hover:bg-free/5',
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant | 'secondary';
  size?: 'md' | 'sm' | 'lg';
  loading?: boolean;
  block?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  block,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: Props) {
  const v =
    variant === 'secondary'
      ? 'bg-transparent text-ink border border-line-strong hover:bg-sand/50'
      : VARIANTS[variant];
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors',
        'disabled:opacity-50 select-none',
        size === 'lg' ? 'min-h-14 px-6 text-[17px]' : size === 'md' ? 'min-h-12 px-5 text-[15px]' : 'min-h-9 px-3 text-[13px] rounded-lg',
        v,
        block && 'w-full',
        className
      )}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : icon}
      {children}
    </button>
  );
}
