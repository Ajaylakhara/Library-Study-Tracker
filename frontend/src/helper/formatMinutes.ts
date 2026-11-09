export function formatMinutes(total: number | null | undefined): string {
  if (total == null) return '—';
  const m = Math.max(0, Math.round(total));
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function formatHMS(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
}

export function formatRupees(n: number): string {
  return `₹${new Intl.NumberFormat('en-IN').format(n)}`;
}

export function formatPhone(p: string): string {
  return p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
