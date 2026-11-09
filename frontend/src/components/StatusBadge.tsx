import type { ReactNode } from 'react';
import { cn } from '../helper/cn';

export type Tone = 'green' | 'red' | 'amber' | 'gray' | 'blue';

const TONES: Record<Tone, string> = {
  green: 'bg-free-bg text-free-fg border-[#bfd9cb]',
  red: 'bg-occupied-bg text-occupied-fg border-[#e3c3bf]',
  amber: 'bg-warn-bg text-warn-fg border-[#ebd3a6]',
  gray: 'bg-inactive-bg text-[#4a5260] border-[#dad6cc]',
  blue: 'bg-[#e8edf3] text-oxford border-[#c7d2e0]',
};

/** Status chips always carry text plus a glyph, never colour alone. */
export function Badge({ tone, glyph, children, className }: { tone: Tone; glyph?: string; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-bold tracking-wide',
        TONES[tone],
        className
      )}
    >
      {glyph && <span aria-hidden>{glyph}</span>}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'paid':
      return <Badge tone="green" glyph="✓">PAID</Badge>;
    case 'unpaid':
      return <Badge tone="red" glyph="!">UNPAID</Badge>;
    case 'pending':
      return <Badge tone="amber" glyph="…">PENDING</Badge>;
    case 'approved':
      return <Badge tone="green" glyph="✓">APPROVED</Badge>;
    case 'rejected':
      return <Badge tone="gray" glyph="✕">REJECTED</Badge>;
    case 'blocked':
      return <Badge tone="red" glyph="⊘">BLOCKED</Badge>;
    case 'live':
      return <Badge tone="blue" glyph="●">LIVE</Badge>;
    case 'overtime':
      return <Badge tone="amber" glyph="!">OVERTIME</Badge>;
    case 'forced':
      return <Badge tone="gray" glyph="✕">FORCE-ENDED</Badge>;
    case 'auto':
      return <Badge tone="gray" glyph="⟳">AUTO-ENDED</Badge>;
    case 'completed':
      return <Badge tone="gray" glyph="✓">COMPLETED</Badge>;
    case 'failed':
      return <Badge tone="red" glyph="✕">FAILED</Badge>;
    case 'sent':
      return <Badge tone="green" glyph="✓">SENT</Badge>;
    case 'queued':
      return <Badge tone="amber" glyph="…">QUEUED</Badge>;
    default:
      return <Badge tone="gray">{status.toUpperCase()}</Badge>;
  }
}
