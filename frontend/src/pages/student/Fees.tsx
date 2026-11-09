import { get } from '../../store/api';
import { ENDPOINTS } from '../../config/endpoints';
import { useAsync } from '../../hooks/useAsync';
import { formatRupees } from '../../helper/formatMinutes';
import { dateLabel, monthLabel, currentMonth } from '../../helper/date';
import type { Fee } from '../../types';

export function Component() {
  const { data, loading, error } = useAsync(async () => (await get<Fee[]>(ENDPOINTS.student.fees)).data, []);

  if (loading && !data) {
    return (
      <div className="glass-c" style={{ borderRadius: '20px', padding: '36px', textAlign: 'center', color: '#5A6A7F' }}>
        Loading fees...
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="glass-c" style={{ borderRadius: '20px', padding: '36px', textAlign: 'center', color: '#8E2F2F' }}>
        {error}
      </div>
    );
  }

  const fees = data ?? [];
  const unpaid = fees.filter((f) => f.status === 'unpaid');
  const due = unpaid.reduce((n, f) => n + f.amount, 0);
  const latestFee = fees[0];
  const curMonthStr = latestFee ? monthLabel(latestFee.month) : monthLabel(currentMonth());

  return (
    <section data-screen-label="Student Fees" style={{ display: 'flex', flexDirection: 'column', gap: '14px', animation: 'rise .35s both' }}>
      {/* Hero Navy Card */}
      <div
        className="hero-navy"
        style={{
          borderRadius: '22px',
          padding: '20px',
          color: '#FDFDFD',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          background: 'linear-gradient(135deg, #0A3466 0%, #032755 55%, #04234D 100%)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 24px 44px -24px rgba(3,39,85,0.7), inset 0 1px 0 rgba(255,255,255,0.12)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: '#F8B345' }}>
            {curMonthStr} · {due > 0 ? 'Due 10th of month' : 'Paid for month'}
          </span>
          {due > 0 ? (
            <span
              style={{
                fontSize: '12px',
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: '20px',
                background: 'rgba(233,169,58,0.22)',
                border: '1px solid rgba(233,169,58,0.6)',
                color: '#FBD58A',
              }}
            >
              ○ Unpaid
            </span>
          ) : (
            <span
              style={{
                fontSize: '12px',
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: '20px',
                background: 'rgba(63,165,132,0.22)',
                border: '1px solid rgba(63,165,132,0.6)',
                color: '#A9E5CF',
              }}
            >
              ✓ Paid
            </span>
          )}
        </div>

        <span style={{ fontFamily: "'Source Serif 4', serif", fontSize: '52px', fontWeight: 600, lineHeight: 1 }}>
          {formatRupees(due > 0 ? due : (latestFee?.amount ?? 800))}
        </span>
        <span style={{ fontSize: '14px', color: '#DDE1E6' }}>
          {due > 0 ? `${unpaid.length} month${unpaid.length > 1 ? 's' : ''} pending` : 'All clear for this month'}
        </span>

        <div
          className="glass-navy flat"
          style={{
            borderRadius: '14px',
            padding: '12px',
            display: 'flex',
            gap: '12px',
            alignItems: 'center',
            background: 'linear-gradient(145deg, rgba(255,255,255,0.12), rgba(255,255,255,0.03))',
          }}
        >
          <span
            style={{
              width: '38px',
              height: '38px',
              flex: '0 0 38px',
              borderRadius: '50%',
              background: 'linear-gradient(145deg, #5585C9, #2D5A9A)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#fff' }}>
              storefront
            </span>
          </span>
          <span style={{ fontSize: '13.5px', color: '#F1F3F6' }}>
            Pay at the library desk. The librarian marks it paid and it updates here.
          </span>
        </div>
      </div>

      {/* History */}
      <h2 style={{ margin: '4px 2px 0', fontFamily: "'Source Serif 4', Georgia, serif", fontSize: '21px', fontWeight: 600, color: '#032755' }}>
        History
      </h2>

      {fees.length === 0 ? (
        <div className="glass-c" style={{ borderRadius: '18px', padding: '32px 20px', textAlign: 'center', color: '#5A6A7F' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '32px', color: '#B9AE98', display: 'block', marginBottom: '8px' }}>
            payments
          </span>
          No fee history yet. Monthly fees appear on the 1st of each month.
        </div>
      ) : (
        <div className="glass-c" style={{ borderRadius: '18px', padding: '4px 14px' }}>
          {fees.map((f, idx) => {
            const isPaid = f.status === 'paid';
            return (
              <div
                key={f._id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '13px 0',
                  borderTop: idx > 0 ? '1px solid rgba(3,39,85,0.08)' : 'none',
                }}
              >
                <span
                  style={{
                    width: '36px',
                    height: '36px',
                    flex: '0 0 36px',
                    borderRadius: '50%',
                    background: isPaid ? 'rgba(63,165,132,0.16)' : 'rgba(233,169,58,0.16)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: '20px',
                      color: isPaid ? '#26876D' : '#D99526',
                      fontVariationSettings: "'FILL' 1",
                    }}
                  >
                    {isPaid ? 'check_circle' : 'schedule'}
                  </span>
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '14.5px' }}>{monthLabel(f.month)}</div>
                  <div style={{ fontSize: '12.5px', color: '#3D4D63' }}>
                    {isPaid && f.paidAt ? `Paid ${dateLabel(f.paidAt)}` : 'Payment pending'}
                  </div>
                </div>
                <span style={{ fontFamily: "'Source Serif 4', serif", fontSize: '17px', fontWeight: 600, color: '#032755' }}>
                  {formatRupees(f.amount)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
