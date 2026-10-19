import { paymentDayStyleOf, paymentDayStyle } from './paymentDay.js';

/**
 * 결제일 배지. '25일'처럼 글자와 색을 함께 보여 준다.
 * date(출금일) 또는 dayKey('5'·'10'·'15'·'25'·'last') 중 하나를 준다.
 */
export default function PaymentDayBadge({ date, dayKey, size = 'sm' }) {
  const st = dayKey ? paymentDayStyle(dayKey) : paymentDayStyleOf(date);
  return (
    <span
      style={{
        display: 'inline-block',
        padding: size === 'sm' ? '0.05rem 0.45rem' : '0.15rem 0.6rem',
        borderRadius: '999px',
        background: st.bg,
        color: st.color,
        border: `1px solid ${st.color}33`,
        fontSize: size === 'sm' ? '0.7rem' : '0.8rem',
        fontWeight: 800,
        whiteSpace: 'nowrap',
        lineHeight: 1.5
      }}
    >
      {st.label}
    </span>
  );
}
