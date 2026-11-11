
export type SeatState = 'free' | 'occupied' | 'overtime' | 'inactive';

/** Student view: choose a free seat */
export function StudentSeatTile({
  n,
  state,
  selected,
  onSelect,
}: {
  n: number;
  state: 'free' | 'occupied';
  selected: boolean;
  onSelect: (n: number) => void;
}) {
  const free = state === 'free';
  const label = `Seat ${n}, ${selected ? 'selected' : free ? 'free' : 'occupied'}`;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      disabled={!free}
      onClick={() => onSelect(n)}
      className="glass-c chip relative h-11 rounded-lg p-0 font-serif text-[15px] font-semibold tnum transition-all"
      style={{
        border: selected
          ? '2px solid #F8B345'
          : free
            ? '1px solid #3FA584'
            : '1px solid rgba(201,123,120,.55)',
        background: selected
          ? 'rgba(248,179,69,.18)'
          : free
            ? 'rgba(255,255,255,.72)'
            : 'rgba(201,123,120,.14)',
        color: selected ? '#032755' : free ? '#1C6A54' : '#8E3232',
      }}
    >
      {n}
      <span aria-hidden className="absolute right-1 top-px font-sans text-[9px]">
        {selected ? '✓' : free ? '' : '✕'}
      </span>
    </button>
  );
}

const ADMIN_STYLES: Record<SeatState, { box: string; fg: string; glyph: string }> = {
  free: { box: 'border-free bg-paper', fg: 'text-free-fg', glyph: '○' },
  occupied: { box: 'border-[#d9a8a3] bg-[#f8ecea]', fg: 'text-occupied-fg', glyph: '●' },
  overtime: { box: 'border-warn bg-warn-bg', fg: 'text-warn-fg', glyph: '!' },
  inactive: { box: 'border-dashed border-inactive bg-inactive-bg', fg: 'text-[#77736b]', glyph: '–' },
};

/** Admin view: occupancy tile with remaining-time label */
export function AdminSeatTile({
  n,
  state,
  label,
  selected,
  onSelect,
  ariaLabel,
}: {
  n: number;
  state: SeatState;
  label: string;
  selected: boolean;
  onSelect: (n: number) => void;
  ariaLabel: string;
}) {
  const TINTS: Record<SeatState, { bg: string; border: string; fg: string }> = {
    free:     { bg: 'rgba(255,255,255,.72)',       border: '#3FA584',              fg: '#1C6A54' },
    occupied: { bg: 'rgba(201,123,120,.16)',       border: 'rgba(201,123,120,.6)', fg: '#8E3232' },
    overtime: { bg: 'rgba(248,179,69,.22)',        border: '#E2A23B',              fg: '#7A4C08' },
    inactive: { bg: 'rgba(167,175,186,.18)',       border: '#A7AFBA',              fg: '#5A6A7F' },
  };
  const t = TINTS[state];
  return (
    <button
      type="button"
      onClick={() => onSelect(n)}
      aria-label={ariaLabel}
      aria-pressed={selected}
      className="glass-c chip relative flex h-14 flex-col items-center justify-center gap-px rounded-lg p-0 transition-all sm:h-16.5 sm:gap-0.5"
      style={{
        background: t.bg,
        border: selected ? `2px solid #F8B345` : `1px solid ${t.border}`,
        boxShadow: selected ? '0 0 0 2px rgba(248,179,69,.35), inset 0 1px 0 rgba(255,255,255,.85)' : 'inset 0 1px 0 rgba(255,255,255,.85)',
      }}
    >
      <span aria-hidden className="absolute left-1.5 top-1 text-[10px] font-bold" style={{ color: t.fg }}>
        {ADMIN_STYLES[state].glyph}
      </span>
      <span className="tnum font-serif text-base font-semibold leading-none sm:text-[19px]" style={{ color: '#172B45' }}>{n}</span>
      <span className="tnum text-[9.5px] font-semibold sm:text-[10.5px]" style={{ color: t.fg }}>{label}</span>
    </button>
  );
}
