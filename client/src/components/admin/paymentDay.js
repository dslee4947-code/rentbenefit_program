// 결제일(5·10·15·25·말일)마다 정해 둔 색.
//
// 청구 대상 목록·발송 센터·입금 확인·일정표가 모두 이 색을 쓴다. 화면마다 색이 다르면
// "25일 건"을 한눈에 묶어 보지 못한다. 색만으로 구분하지 않고 늘 '25일' 같은 글자도 함께 붙인다
// (색을 구분하기 어려운 직원도 읽을 수 있게).
//
// 25일은 고객이 가장 많은 날이라 가장 눈에 띄는 주황을 쓴다.

export const PAYMENT_DAYS = [
  { key: '5', label: '5일', color: '#2563eb', bg: '#dbeafe' },
  { key: '10', label: '10일', color: '#0d9488', bg: '#ccfbf1' },
  { key: '15', label: '15일', color: '#16a34a', bg: '#dcfce7' },
  { key: '25', label: '25일', color: '#ea580c', bg: '#ffedd5' },
  { key: 'last', label: '말일', color: '#7c3aed', bg: '#ede9fe' }
];
const OTHER = { key: 'etc', label: '기타', color: '#64748b', bg: '#f1f5f9' };

/** 'YYYY-MM-DD…' 또는 Date에서 결제일 묶음 키를 고른다. 말일은 달마다 28~31일이라 날짜로 따진다. */
export const paymentDayKey = (date) => {
  if (!date) return 'etc';
  const s = String(date instanceof Date ? date.toISOString() : date);
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return 'etc';
  // 날짜만 있는 'YYYY-MM-DD'는 그대로 읽는다. 시각이 붙은 값은 한국 시간으로 읽어야
  // 한국 자정(UTC 전날 15시)으로 저장된 출금일이 하루 앞당겨지지 않는다.
  const [y, m, day] = /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? s.slice(0, 10).split('-').map(Number)
    : [d.getFullYear(), d.getMonth() + 1, d.getDate()];
  if (new Date(y, m, 0).getDate() === day) return 'last';
  return ['5', '10', '15', '25'].includes(String(day)) ? String(day) : 'etc';
};

/** 결제일 설정값('25', '말일')에서 키를 고른다. 캘린더처럼 설정값이 따로 있을 때 쓴다. */
export const paymentDayKeyOfSetting = (setting) => {
  const v = String(setting || '').trim();
  if (v === '말일') return 'last';
  return ['5', '10', '15', '25'].includes(v) ? v : 'etc';
};

/** 키의 색·이름 */
export const paymentDayStyle = (key) => PAYMENT_DAYS.find((p) => p.key === key) || OTHER;

/** 날짜의 색·이름 */
export const paymentDayStyleOf = (date) => paymentDayStyle(paymentDayKey(date));

/** 표의 한 줄 왼쪽에 굵은 색 띠를 그린다(box-shadow라 칸 폭이 바뀌지 않는다). */
export const paymentDayStripe = (date) => `inset 4px 0 0 ${paymentDayStyleOf(date).color}`;

/** 금액 칸: 자릿수가 위아래로 맞게 */
export const NUMERIC = { fontVariantNumeric: 'tabular-nums', textAlign: 'right' };
