import { useState } from 'react';
import { Activity, CircleDollarSign, Clock3, Download, FileText, UsersRound } from 'lucide-react';
import { downloadFile, get } from '../../store/api';
import { ENDPOINTS } from '../../config/endpoints';
import { errMsg } from '../../toolkit/createAppThunk';
import { useAppDispatch } from '../../hooks/useRedux';
import { showToast } from '../../toolkit/toastSlice';
import { useAdminHeader } from '../../layout/AdminLayout';
import { useAsync } from '../../hooks/useAsync';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { AdminMetricCard } from '../../components/AdminMetricCard';
import { formatMinutes, formatPhone, formatRupees } from '../../helper/formatMinutes';
import { currentMonth, monthLabel, monthRangeISO, shiftMonth } from '../../helper/date';
import type { ReportSummary, StudentReportRow } from '../../types';

export function Component() {
  const dispatch = useAppDispatch();
  const [month, setMonth] = useState(currentMonth());
  const [exporting, setExporting] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const { from, to } = monthRangeISO(month);
    const [summary, students] = await Promise.all([
      get<ReportSummary>(ENDPOINTS.admin.reportSummary, { from, to }),
      get<StudentReportRow[]>(ENDPOINTS.admin.reportStudents, { month }),
    ]);
    return { summary: summary.data, rows: students.data };
  }, [month]);

  useAdminHeader('Reports', monthLabel(month));

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { from, to } = monthRangeISO(month);
      await downloadFile(ENDPOINTS.admin.exportAttendanceCsv, `attendance-${month}.csv`, { from, to });
      dispatch(showToast('success', 'Attendance CSV downloaded'));
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
    } finally {
      setExporting(false);
    }
  };

  const options = Array.from({ length: 13 }, (_, i) => shiftMonth(currentMonth(), -i));
  const rows = data?.rows ?? [];
  const totalMin = data?.summary.totalMinutes ?? 0;
  const max = Math.max(1, ...rows.map((r) => r.totalMinutes));

  return (
    <div className="flex flex-col gap-5">
      <div className="glass-b flex flex-wrap items-center gap-3 rounded-2xl p-4">
        <select
          aria-label="Month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="glass-c h-10.5 w-50 rounded-[10px] px-3 text-sm"
          style={{ color: '#172B45' }}
        >
          {options.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <Button variant="outline" className="h-10.5 rounded-[10px]" icon={<Download size={16} />} loading={exporting} onClick={exportCsv}>
          Export CSV
        </Button>
      </div>

      {loading && !data ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-27.5 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </>
      ) : error && !data ? (
        <ErrorState title="Couldn't load reports" message={error} onRetry={reload} />
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            <AdminMetricCard icon={<Clock3 size={21} />} color="#4A8FCE" label="Total study time" value={formatMinutes(totalMin)} note={`Across ${rows.length} student${rows.length === 1 ? '' : 's'}`} />
            <AdminMetricCard
              icon={<UsersRound size={22} />}
              color="#3FA584"
              label="Average per student"
              value={formatMinutes(rows.length ? Math.round(totalMin / rows.length) : 0)}
              note="This month"
            />
            <AdminMetricCard icon={<Activity size={21} />} color="#E2A23B" label="Sessions" value={String(data.summary.totalSessions)} note="Completed" />
            <AdminMetricCard
              icon={<CircleDollarSign size={22} />}
              color="#C97B78"
              label="Fees collected"
              value={formatRupees(data.summary.collectedRevenue)}
              note={`${data.summary.unpaidFees} unpaid`}
            />
          </div>

          <section className="glass-b overflow-hidden rounded-2xl">
            <h2
              className="px-5 py-4 font-serif text-[19px] font-semibold"
              style={{ color: '#172B45', borderBottom: '1px solid rgba(3,39,85,.10)' }}
            >Study hours by student</h2>
            {rows.length === 0 ? (
              <EmptyState
                icon={<FileText size={26} strokeWidth={1.7} />}
                title="No study time yet"
                text={`Nobody has completed a session in ${monthLabel(month, false)}.`}
              />
            ) : (
              <>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full border-collapse text-sm">
                    <thead style={{ background: 'rgba(255,255,255,.82)', backdropFilter: 'blur(8px)' }}>
                      <tr className="text-xs font-semibold tracking-[0.06em] text-muted">
                        <th className="border-b border-line px-4 py-3 text-left">#</th>
                        <th className="border-b border-line px-4 py-3 text-left">STUDENT</th>
                        <th className="border-b border-line px-4 py-3 text-right">SESSIONS</th>
                        <th className="border-b border-line px-4 py-3 text-right">TOTAL HOURS</th>
                        <th className="border-b border-line px-4 py-3 text-right">AVG PER SESSION</th>
                        <th className="border-b border-line px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.student?._id ?? i} className="hover:bg-[#fbf8f1]">
                          <td className="tnum border-b border-line/70 px-4 py-3 text-muted">{String(i + 1).padStart(2, '0')}</td>
                          <td className="border-b border-line/70 px-4 py-3">
                            <div className="flex flex-col">
                              <span className="font-semibold">{r.student?.name ?? 'Deleted user'}</span>
                              {r.student && <span className="tnum text-xs text-muted">{formatPhone(r.student.phone)}</span>}
                            </div>
                          </td>
                          <td className="tnum border-b border-line/70 px-4 py-3 text-right">{r.totalSessions}</td>
                          <td className="tnum border-b border-line/70 px-4 py-3 text-right font-semibold">{formatMinutes(r.totalMinutes)}</td>
                          <td className="tnum border-b border-line/70 px-4 py-3 text-right">
                            {formatMinutes(Math.round(r.totalMinutes / Math.max(1, r.totalSessions)))}
                          </td>
                          <td className="w-60 border-b border-line/70 px-5 py-3">
                            <div className="h-1.5 overflow-hidden rounded bg-sand" aria-hidden>
                              <div className="h-full bg-oxford" style={{ width: `${(r.totalMinutes / max) * 100}%` }} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="divide-y divide-line/70 md:hidden">
                  {rows.map((r, i) => (
                    <li key={r.student?._id ?? i} className="flex flex-col gap-2 p-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold">
                          <span className="tnum mr-2 text-muted">{String(i + 1).padStart(2, '0')}</span>
                          {r.student?.name ?? 'Deleted user'}
                        </span>
                        <span className="tnum font-semibold">{formatMinutes(r.totalMinutes)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded bg-sand" aria-hidden>
                        <div className="h-full bg-oxford" style={{ width: `${(r.totalMinutes / max) * 100}%` }} />
                      </div>
                      <span className="text-xs text-muted">{r.totalSessions} sessions</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
