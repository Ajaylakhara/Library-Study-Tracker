import { useMemo, useState } from 'react';
import { get } from '../../store/api';
import { ENDPOINTS } from '../../config/endpoints';
import { useAsync } from '../../hooks/useAsync';
import { MonthSwitcher } from '../../components/Controls';
import { formatMinutes } from '../../helper/formatMinutes';
import { clock, currentMonth, daysInMonth, firstWeekdayMon0, monthLabel, ymd } from '../../helper/date';
import type { AttendanceItem } from '../../types';

export function Component() {
  const [month, setMonth] = useState(currentMonth());
  const { data, loading, error } = useAsync(
    async () => (await get<AttendanceItem[]>(ENDPOINTS.student.attendance, { month })).data,
    [month]
  );

  const attendedDays = useMemo(() => new Set((data ?? []).map((s) => Number(ymd(s.checkInAt).slice(8, 10)))), [data]);
  const isCurrent = month === currentMonth();
  const today = isCurrent ? Number(ymd(new Date()).slice(8, 10)) : -1;
  const total = daysInMonth(month);
  const lead = firstWeekdayMon0(month);

  const sessions = useMemo(() => {
    return [...(data ?? [])].sort((a, b) => new Date(b.checkInAt).getTime() - new Date(a.checkInAt).getTime());
  }, [data]);

  return (
    <section data-screen-label="Student Attendance" style={{ display: 'flex', flexDirection: 'column', gap: '14px', animation: 'rise .35s both' }}>
      <MonthSwitcher month={month} onChange={setMonth} />

      {/* Calendar Card in Glass-b */}
      <div className="glass-b" style={{ borderRadius: '20px', padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 style={{ margin: 0, fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '21px', fontWeight: 600, color: '#032755' }}>
            {monthLabel(month, false)}
          </h2>
          <span style={{ fontSize: '13.5px', color: '#3D4D63' }}>
            <b style={{ fontFamily: "'Source Serif 4', serif", fontSize: '17px', color: '#032755' }}>{attendedDays.size}</b> of {total} days
          </span>
        </div>

        {/* Days of week header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px' }}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <span key={i} style={{ fontSize: '12px', fontWeight: 600, color: '#5A6A7F', textAlign: 'center' }}>
              {d}
            </span>
          ))}

          {/* Leading empty slots */}
          {Array.from({ length: lead }, (_, i) => (
            <div key={`lead-${i}`} />
          ))}

          {/* Day boxes */}
          {Array.from({ length: total }, (_, i) => i + 1).map((d) => {
            const att = attendedDays.has(d);
            const isToday = d === today;
            const isPast = isCurrent ? d < today : true;

            const bg = att ? '#24466C' : isToday ? 'rgba(255,255,255,0.9)' : isPast ? '#FFF' : 'rgba(255,255,255,0.5)';
            const color = att ? '#FFF' : isToday ? '#032755' : isPast ? '#172B45' : '#8A98A8';
            const border = isToday ? '2px solid #F8B345' : att ? '1px solid #15385E' : '1px solid #D9D0BF';

            return (
              <div
                key={d}
                title={`${d} ${monthLabel(month, false)}${att ? ' · Attended' : isToday ? ' · Today' : ''}`}
                style={{
                  aspectRatio: 1,
                  borderRadius: '9px',
                  background: bg,
                  border: border,
                  color: color,
                  fontSize: '13px',
                  fontWeight: att || isToday ? 600 : 400,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: att ? '0 3px 8px -2px rgba(3,39,85,0.3)' : 'none',
                }}
              >
                {d}
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '16px', fontSize: '12.5px', color: '#3D4D63', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#24466C' }} />
            Attended ({attendedDays.size})
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#fff', border: '1px solid #D9D0BF' }} />
            Absent
          </span>
          {isCurrent && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ width: '12px', height: '12px', borderRadius: '50%', border: '2px solid #F8B345' }} />
              Today
            </span>
          )}
        </div>
      </div>

      {/* Recent Sessions */}
      <h2 style={{ margin: '4px 2px 0', fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '21px', fontWeight: 600, color: '#032755' }}>
        Recent sessions
      </h2>

      {loading && !data ? (
        <div className="glass-c" style={{ borderRadius: '18px', padding: '24px', textAlign: 'center', color: '#5A6A7F' }}>
          Loading sessions...
        </div>
      ) : error && !data ? (
        <div className="glass-c" style={{ borderRadius: '18px', padding: '24px', textAlign: 'center', color: '#8E2F2F' }}>
          {error}
        </div>
      ) : sessions.length === 0 ? (
        <div className="glass-c" style={{ borderRadius: '18px', padding: '32px 20px', textAlign: 'center', color: '#5A6A7F' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '32px', color: '#B9AE98', display: 'block', marginBottom: '8px' }}>
            calendar_today
          </span>
          No sessions recorded in {monthLabel(month, false)}.
        </div>
      ) : (
        <div className="glass-c" style={{ borderRadius: '18px', padding: '4px 14px' }}>
          {sessions.map((s, idx) => {
            const inTime = clock(s.checkInAt);
            const outTime = s.checkOutAt ? clock(s.checkOutAt) : 'In progress';
            const dur = s.durationMinutes ? formatMinutes(s.durationMinutes) : 'Active';
            const isCompleted = s.status === 'completed';

            return (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 0',
                  borderTop: idx > 0 ? '1px solid rgba(3,39,85,0.08)' : 'none',
                }}
              >
                <span
                  style={{
                    width: '36px',
                    height: '36px',
                    flex: '0 0 36px',
                    borderRadius: '50%',
                    background: isCompleted ? 'rgba(63,165,132,0.16)' : 'rgba(248,179,69,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{ fontSize: '19px', color: isCompleted ? '#26876D' : '#D99526' }}
                  >
                    {isCompleted ? 'check_circle' : 'timelapse'}
                  </span>
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '14.5px' }}>
                    {ymd(s.checkInAt).slice(8, 10)} {monthLabel(month, false).slice(0, 3)} · Seat {s.seatNumber}
                  </div>
                  <div style={{ fontSize: '12.5px', color: '#3D4D63', fontVariantNumeric: 'tabular-nums' }}>
                    {inTime} – {outTime}
                  </div>
                </div>
                <span style={{ fontFamily: "'Source Serif 4', serif", fontSize: '17px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: '#032755' }}>
                  {dur}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
