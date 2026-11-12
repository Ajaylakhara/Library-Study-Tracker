import type { ReactNode } from 'react';

export function AdminMetricCard({
  icon,
  label,
  value,
  note,
  color,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  note: string;
  color: string;
}) {
  return (
    <div className="admin-metric-card glass-b lift flex min-w-0 items-center gap-3 rounded-2xl p-4">
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-md"
        style={{ background: color }}
      >
        {icon}
      </span>
      <span className="admin-metric-copy flex min-w-0 flex-col gap-0.5">
        <span className="admin-metric-label text-[13px] text-muted">{label}</span>
        <strong className="admin-metric-value tnum font-serif text-[23px] font-semibold leading-tight text-oxford">{value}</strong>
        <span className="admin-metric-note text-xs text-muted">{note}</span>
      </span>
    </div>
  );
}
