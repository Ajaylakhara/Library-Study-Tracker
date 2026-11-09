import type { ReactNode } from 'react';
import { cn } from '../helper/cn';

export interface Column<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  mobileHideLabel?: boolean;
  primary?: boolean;
  className?: string;
  render: (row: T) => ReactNode;
}

/**
 * Sticky-header table above 768px (glass-b outer container, glass-c rows),
 * stacked glass-c cards below.
 */
export function DataTable<T>({
  columns, rows, rowKey, footer,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (r: T) => string;
  footer?: ReactNode;
}) {
  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest    = columns.filter((c) => c !== primary);

  return (
    <div className="glass-b overflow-hidden rounded-2xl">
      {/* ── Desktop table ── */}
      <div className="hidden max-h-[calc(100dvh-300px)] overflow-auto md:block">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-[1]" style={{ background: 'rgba(255,255,255,.82)', backdropFilter: 'blur(8px)' }}>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    'px-4 py-3 text-xs font-semibold tracking-[0.06em]',
                    c.align === 'right' ? 'text-right' : 'text-left'
                  )}
                  style={{
                    color: '#5A6A7F',
                    borderBottom: '1px solid rgba(3,39,85,.10)',
                  }}
                >
                  {c.header.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={rowKey(r)}
                className="transition-colors"
                style={{ borderBottom: '1px solid rgba(3,39,85,.07)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,.60)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '')}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn('px-4 py-3', c.align === 'right' && 'text-right', c.className)}
                    style={{ color: '#172B45' }}
                  >
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Mobile stacked cards ── */}
      <ul className="md:hidden" style={{ borderTop: '1px solid rgba(3,39,85,.07)' }}>
        {rows.map((r) => (
          <li
            key={rowKey(r)}
            className="flex flex-col gap-2.5 p-4 transition-colors"
            style={{ borderBottom: '1px solid rgba(3,39,85,.07)' }}
          >
            <div className="font-semibold" style={{ color: '#172B45' }}>{primary.render(r)}</div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-[13px]">
              {rest.map((c) =>
                c.mobileHideLabel ? (
                  <div key={c.key} className="col-span-2 flex flex-wrap justify-end gap-2">
                    {c.render(r)}
                  </div>
                ) : (
                  <div key={c.key} className="flex flex-col gap-0.5">
                    <dt className="text-xs" style={{ color: '#5A6A7F' }}>{c.header}</dt>
                    <dd className="tnum" style={{ color: '#172B45' }}>{c.render(r)}</dd>
                  </div>
                )
              )}
            </dl>
          </li>
        ))}
      </ul>
      {footer}
    </div>
  );
}
