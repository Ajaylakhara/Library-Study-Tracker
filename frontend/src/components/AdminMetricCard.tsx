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
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[13px] text-muted">{label}</span>
        <strong className="tnum font-serif text-[23px] font-semibold leading-tight text-oxford">{value}</strong>
        <span className="truncate text-xs text-muted">{note}</span>
      </span>
    </div>
  );
}
