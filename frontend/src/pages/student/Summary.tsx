import { useState, useMemo } from 'react';
import { get } from '../../store/api';
import { ENDPOINTS } from '../../config/endpoints';
import { useAsync } from '../../hooks/useAsync';
import { MonthSwitcher } from '../../components/Controls';
import { formatMinutes } from '../../helper/formatMinutes';
import { currentMonth, daysInMonth, monthLabel, ymd } from '../../helper/date';
import type { AttendanceItem, MonthSummary } from '../../types';

export function Component() {
  const [month, setMonth] = useState(currentMonth());
  const { data, loading, error } = useAsync(async () => {
    const [summary, att] = await Promise.all([
      get<MonthSummary>(ENDPOINTS.student.summary, { month }),
      get<AttendanceItem[]>(ENDPOINTS.student.attendance, { month }),
    ]);
    return { summary: summary.data, sessions: att.data.filter((s) => s.status === 'completed') };
  }, [month]);

  const totalDays = daysInMonth(month);

  const stats = useMemo(() => {
    if (!data) return null;
    const completed = data.sessions;
    const days = new Set(completed.map((s) => ymd(s.checkInAt)));
    const daysAttended = days.size;
    const totalMin = data.summary.totalMinutes;
    const totalSessions = data.summary.totalSessions;
    const avg = daysAttended ? Math.round(totalMin / daysAttended) : 0;

    // Daily breakdown for 7 days or weeks
    const dow = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const weekBars = dow.map((d, i) => {
      // Find minutes matching that day of week mod 7
      const mins = completed
        .filter((s) => new Date(s.checkInAt).getDay() === (i + 1) % 7)
        .reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
      const hours = (mins / 60).toFixed(1);
      return { d, v: mins > 0 ? `${hours}h` : '0', mins, h: `${Math.min(100, Math.max(12, (mins / 360) * 100))}%` };
    });

    return {
      daysAttended,
      totalMin,
      totalSessions,
      avg,
      weekBars,
    };
  }, [data]);

  return (
    <section data-screen-label="Student Summary" style={{ display: 'flex', flexDirection: 'column', gap: '14px', animation: 'rise .35s both' }}>
      <MonthSwitcher month={month} onChange={setMonth} />

      {loading && !data ? (
        <div className="glass-c" style={{ borderRadius: '20px', padding: '36px', textAlign: 'center', color: '#5A6A7F' }}>
          Loading summary...
        </div>
      ) : error && !data ? (
        <div className="glass-c" style={{ borderRadius: '20px', padding: '36px', textAlign: 'center', color: '#8E2F2F' }}>
          {error}
        </div>
      ) : !stats ? null : (
        <>
          {/* Hero Navy Card — Study hours chart */}
          <div
            className="hero-navy"
            style={{
              borderRadius: '22px',
              padding: '20px',
              color: '#FDFDFD',
              display: 'flex',
              flexDirection: 'column',
              gap: '14px',
              background: 'linear-gradient(135deg, #0A3466 0%, #032755 55%, #04234D 100%)',
              border: '1px solid rgba(255,255,255,0.12)',
              boxShadow: '0 24px 44px -24px rgba(3,39,85,0.7), inset 0 1px 0 rgba(255,255,255,0.12)',
            }}
          >
            <span style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: '#F8B345' }}>
              {monthLabel(month, false)}
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
              <span style={{ fontFamily: "'Source Serif 4', serif", fontSize: '46px', fontWeight: 600, lineHeight: 1 }}>
                {formatMinutes(stats.totalMin)}
              </span>
              <span style={{ fontSize: '15px', color: '#DDE1E6' }}>studied total</span>
            </div>

            {/* 7-day Bar chart */}
            <div
              style={{
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-end',
                height: '140px',
                borderBottom: '1px solid rgba(255,255,255,0.16)',
                paddingTop: '10px',
              }}
              role="img"
              aria-label="Hours studied per weekday"
            >
              {stats.weekBars.map((b, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: '4px', height: '100%' }}>
                  <span style={{ fontSize: '11px', color: '#DDE1E6', fontVariantNumeric: 'tabular-nums' }}>
                    {b.v}
                  </span>
                  <div
                    style={{
                      width: '100%',
                      height: b.mins > 0 ? b.h : '6px',
                      background: b.mins > 0 ? 'linear-gradient(180deg, #F8BB55 0%, #E9A93A 100%)' : 'rgba(255,255,255,0.15)',
                      borderRadius: '7px 7px 0 0',
                      transformOrigin: 'bottom',
                      transition: 'height .6s ease',
                    }}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              {stats.weekBars.map((b, i) => (
                <span key={i} style={{ flex: 1, textAlign: 'center', fontSize: '12px', color: '#DDE1E6' }}>
                  {b.d}
                </span>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '16px', fontSize: '12.5px', color: '#DDE1E6' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#F8B345' }} />
                Weekday hours
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'rgba(255,255,255,0.3)' }} />
                No time logged
              </span>
            </div>
          </div>

          {/* 4 Stat Tiles in Glass-c */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div
              className="glass-c"
              style={{
                borderRadius: '16px',
                padding: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                boxShadow: '0 10px 24px -16px rgba(3,39,85,0.35), inset 0 1px 0 rgba(255,255,255,0.9)',
              }}
            >
              <span
                style={{
                  width: '42px',
                  height: '42px',
                  flex: '0 0 42px',
                  borderRadius: '50%',
                  background: 'linear-gradient(145deg, #7376BD, #4A4D94)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '21px', color: '#fff' }}>
                  event_available
                </span>
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '12.5px', color: '#3D4D63' }}>Days attended</div>
                <div style={{ fontFamily: "'Source Serif 4', serif", fontSize: '22px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {stats.daysAttended} / {totalDays}
                </div>
              </div>
            </div>

            <div
              className="glass-c"
              style={{
                borderRadius: '16px',
                padding: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                boxShadow: '0 10px 24px -16px rgba(3,39,85,0.35), inset 0 1px 0 rgba(255,255,255,0.9)',
              }}
            >
              <span
                style={{
                  width: '42px',
                  height: '42px',
                  flex: '0 0 42px',
                  borderRadius: '50%',
                  background: 'linear-gradient(145deg, #4FB894, #2A8A6C)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '21px', color: '#fff' }}>
                  trending_up
                </span>
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '12.5px', color: '#3D4D63' }}>Daily average</div>
                <div style={{ fontFamily: "'Source Serif 4', serif", fontSize: '22px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {formatMinutes(stats.avg)}
                </div>
              </div>
            </div>

            <div
              className="glass-c"
              style={{
                borderRadius: '16px',
                padding: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                boxShadow: '0 10px 24px -16px rgba(3,39,85,0.35), inset 0 1px 0 rgba(255,255,255,0.9)',
              }}
            >
              <span
                style={{
                  width: '42px',
                  height: '42px',
                  flex: '0 0 42px',
                  borderRadius: '50%',
                  background: 'linear-gradient(145deg, #EBB75A, #C98A22)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '21px', color: '#fff' }}>
                  local_fire_department
                </span>
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '12.5px', color: '#3D4D63' }}>Sessions</div>
                <div style={{ fontFamily: "'Source Serif 4', serif", fontSize: '22px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {stats.totalSessions}
                </div>
              </div>
            </div>

            <div
              className="glass-c"
              style={{
                borderRadius: '16px',
                padding: '14px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                boxShadow: '0 10px 24px -16px rgba(3,39,85,0.35), inset 0 1px 0 rgba(255,255,255,0.9)',
              }}
            >
              <span
                style={{
                  width: '42px',
                  height: '42px',
                  flex: '0 0 42px',
                  borderRadius: '50%',
                  background: 'linear-gradient(145deg, #4A6A9C, #24466C)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '21px', color: '#fff' }}>
                  donut_large
                </span>
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '12.5px', color: '#3D4D63' }}>Attendance rate</div>
                <div style={{ fontFamily: "'Source Serif 4', serif", fontSize: '22px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round((stats.daysAttended / Math.max(1, totalDays)) * 100)}%
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
