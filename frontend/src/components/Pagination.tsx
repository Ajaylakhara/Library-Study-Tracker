import { cn } from '../helper/cn';
import type { Pagination as P } from '../types';

function pageList(cur: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, cur, cur - 1, cur + 1]);
  const nums = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

export function Pagination({ p, onPage }: { p: P; onPage: (n: number) => void }) {
  if (!p.total) return null;
  const from = (p.page - 1) * p.limit + 1;
  const to = Math.min(p.total, p.page * p.limit);
  const btn = 'flex h-9 min-w-9 items-center justify-center rounded-lg border px-2 text-[13px] font-semibold';
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-line px-4 py-3 text-[13px] text-muted sm:flex-row">
      <span className="tnum">
        Showing {from}–{to} of {p.total}
      </span>
      {p.pages > 1 && (
        <nav aria-label="Pagination" className="flex gap-1.5">
          <button
            aria-label="Previous page"
            disabled={p.page <= 1}
            onClick={() => onPage(p.page - 1)}
            className={cn(btn, 'border-line bg-paper text-ink disabled:opacity-40')}
          >
            ‹
          </button>
          {pageList(p.page, p.pages).map((n, i) =>
            n === '…' ? (
              <span key={`e${i}`} className="flex h-9 items-center px-1">
                …
              </span>
            ) : (
              <button
                key={n}
                aria-current={n === p.page ? 'page' : undefined}
                onClick={() => onPage(n)}
                className={cn(btn, n === p.page ? 'border-oxford bg-oxford text-paper' : 'border-line bg-paper text-ink hover:bg-sand/50')}
              >
                {n}
              </button>
            )
          )}
          <button
            aria-label="Next page"
            disabled={p.page >= p.pages}
            onClick={() => onPage(p.page + 1)}
            className={cn(btn, 'border-line bg-paper text-ink disabled:opacity-40')}
          >
            ›
          </button>
        </nav>
      )}
    </div>
  );
}
