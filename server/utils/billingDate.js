// 청구 날짜 계산.
//
// 화면 쪽 client/src/utils/format.js에 같은 규칙이 있다. 클라이언트와 서버는 번들이 달라
// 한 파일을 공유할 수 없어 각각 두되, 규칙이 갈리지 않도록 한쪽을 고치면 반대쪽도 함께 고친다.

export const PAYMENT_DAY_LAST = '말일';

/**
 * 결제일 설정을 특정 달의 실제 날짜로 바꾼다.
 *
 * '말일'이면 그 달의 마지막 날(2월이면 28 또는 29)을 돌려준다.
 * 일반 날짜라도 그 달에 없는 날이면(예: 31일 설정에 2월) 그 달 마지막 날로 당겨 준다.
 * new Date(2026, 1, 31)처럼 그냥 넘기면 3월로 넘어가 버리므로 반드시 이 함수를 쓴다.
 *
 * 시각을 정오(12:00)로 맞추는 이유:
 * 자정으로 만들면 UTC로 저장될 때 한국 시간(+9)만큼 당겨져 전날이 된다.
 * (2026-02-28 00:00 KST -> 2026-02-27T15:00Z) 이 코드베이스는 날짜를 화면에 낼 때
 * String(date).slice(0, 10)처럼 앞 10자를 쓰는 곳이 많아, 그대로 두면 하루 전 날짜가 보인다.
 * 정오로 두면 어느 쪽으로 9시간이 밀려도 날짜가 바뀌지 않는다.
 *
 * @param {number} year 연도
 * @param {number} monthIndex 0부터 시작하는 월 (0 = 1월)
 * @param {string|number} paymentDay 저장된 결제일 설정
 * @returns {Date|null} 실제 결제일
 */
export const resolvePaymentDate = (year, monthIndex, paymentDay) => {
  if (paymentDay === '' || paymentDay === null || paymentDay === undefined) return null;

  // monthIndex가 12를 넘거나 음수여도 Date가 연도를 알아서 넘겨 준다
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const normalized = new Date(year, monthIndex, 1);

  if (String(paymentDay) === PAYMENT_DAY_LAST || String(paymentDay) === '31') {
    return new Date(normalized.getFullYear(), normalized.getMonth(), lastDay, 12);
  }
  const day = Number(paymentDay);
  if (!day) return null;
  return new Date(normalized.getFullYear(), normalized.getMonth(), Math.min(day, lastDay), 12);
};

/**
 * 1일 렌트료. 월 렌트료를 1년치로 환산해 365일로 나누고 1의 자리를 버린다.
 * 예: 375,200원 -> 375200 x 12 / 365 = 12,335.34 -> 12,330원
 *
 * @param {number} monthlyRent 월 렌트료
 * @returns {number} 1일 렌트료 (10원 단위)
 */
export const calcDailyRent = (monthlyRent) => {
  const rent = Number(monthlyRent) || 0;
  if (!rent) return 0;
  return Math.floor((rent * 12) / 365 / 10) * 10;
};

// 청구서는 출금일보다 미리 보내야 법인이 결재를 올릴 시간이 있다.
export const INVOICE_SEND_LEAD_DAYS = 10;

/**
 * 청구서 발송 예정일. 출금일에서 정해진 날수만큼 앞당긴다.
 *
 * 시각을 정오로 두는 이유는 resolvePaymentDate와 같다(UTC로 저장될 때 날짜가 밀리지 않게).
 *
 * @param {Date|string} dueDate 출금일
 * @param {number} [leadDays] 며칠 전에 보낼지
 * @returns {Date|null} 발송 예정일
 */
export const calcSendDate = (dueDate, leadDays = INVOICE_SEND_LEAD_DAYS) => {
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  return new Date(due.getFullYear(), due.getMonth(), due.getDate() - leadDays, 12);
};

/**
 * 두 날짜 사이의 일수. 시각은 무시하고 날짜만 센다.
 *
 * @param {Date|string} from 시작일
 * @param {Date|string} to 끝일
 * @returns {number} 일수 (음수면 0)
 */
export const daysBetween = (from, to) => {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const day = 24 * 60 * 60 * 1000;
  const diff = Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
     Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / day
  );
  return Math.max(0, diff);
};

/**
 * 연체 이자. 미납액에 연이율을 일할로 물린다.
 *
 * 연이율은 렌트차량 DB(Vehicle.lateInterestRate)에 있는 값을 쓴다.
 * 사업 초기 20%에서 25%로 바뀌었고 앞으로도 바뀌므로, 계약에 박아 두지 않고
 * 청구할 때마다 차량 DB의 현재 값을 읽는다.
 *
 * 1의 자리를 버리는 것은 1일 렌트료와 같은 규칙이다(엑셀로 청구하던 방식 그대로).
 * 예: 576,000원을 연 25%로 30일 연체 -> 576000 x 0.25 / 365 x 30 = 11,835.6 -> 11,830원
 *
 * @param {object} params
 * @param {number} params.unpaid 미납액
 * @param {number} params.annualRate 연이율 (%)
 * @param {number} params.days 연체 일수
 * @returns {number} 연체 이자 (10원 단위)
 */
export const calcLateInterest = ({ unpaid, annualRate, days }) => {
  const amount = Number(unpaid) || 0;
  const rate = Number(annualRate) || 0;
  const overdue = Number(days) || 0;
  if (amount <= 0 || rate <= 0 || overdue <= 0) return 0;
  return Math.floor((amount * (rate / 100) / 365) * overdue / 10) * 10;
};

// 출고일과 첫 출금일 사이에 최소한 며칠은 있어야 한다.
// 25일 출금인데 24일에 출고하면 하루 만에 돈을 빼는 셈이라, 고객이 준비할 틈이 없다.
// 그런 경우 첫 회차를 다음 달로 넘긴다(그 며칠치는 첫 회차에 일할로 붙는다).
export const MIN_DAYS_TO_FIRST_BILLING = 7;

/**
 * 1회차 청구일을 정한다.
 *
 * 렌트료 개시일이 정해져 있으면 그 달의 결제일이 1회차다(계약서에 적힌 값이 우선이다).
 * 개시일이 없으면 출고일을 기준으로 처음 도래하는 결제일을 찾는다.
 * 다만 출고 직후에 바로 빠져나가면 곤란하므로, 그 사이가 MIN_DAYS_TO_FIRST_BILLING일보다
 * 짧으면 한 달 뒤로 넘긴다.
 *
 * @param {object} params
 * @param {Date|string} [params.rentStartDate] 렌트료 개시일
 * @param {Date|string} [params.deliveryDate] 출고일(인도일)
 * @param {string|number} params.paymentDay 결제일 설정
 * @returns {Date|null} 1회차 청구일
 */
export const resolveFirstDueDate = ({ rentStartDate, deliveryDate, paymentDay }) => {
  const start = rentStartDate ? new Date(rentStartDate) : null;
  if (start && !Number.isNaN(start.getTime())) {
    return resolvePaymentDate(start.getFullYear(), start.getMonth(), paymentDay);
  }

  const delivery = deliveryDate ? new Date(deliveryDate) : null;
  if (!delivery || Number.isNaN(delivery.getTime())) return null;

  // 출고한 달의 결제일부터 보되, 이미 지났거나 너무 임박하면 다음 달로 넘긴다
  for (let i = 0; i < 3; i += 1) {
    const due = resolvePaymentDate(delivery.getFullYear(), delivery.getMonth() + i, paymentDay);
    if (due && daysBetween(delivery, due) >= MIN_DAYS_TO_FIRST_BILLING) return due;
  }
  return resolvePaymentDate(delivery.getFullYear(), delivery.getMonth() + 1, paymentDay);
};

/**
 * 계약 기간만큼 회차별 청구일을 만든다.
 *
 * 1회차는 resolveFirstDueDate가 정하고, 그 뒤로는 매달 같은 결제일을 따른다.
 * 결제일이 '말일'이면 달마다 실제 날짜가 달라지므로(2월 28일, 4월 30일, 7월 31일) 매 회차를 따로 계산한다.
 *
 * @param {object} params
 * @param {Date|string} [params.rentStartDate] 렌트료 개시일
 * @param {Date|string} [params.deliveryDate] 출고일
 * @param {string|number} params.paymentDay 결제일 설정
 * @param {number} params.totalRounds 총 회차 수
 * @returns {Date[]} 회차별 청구일
 */
export const buildDueDates = ({ rentStartDate, deliveryDate, paymentDay, totalRounds }) => {
  const first = resolveFirstDueDate({ rentStartDate, deliveryDate, paymentDay });
  if (!first) return [];

  const dates = [];
  for (let i = 0; i < totalRounds; i += 1) {
    const due = resolvePaymentDate(first.getFullYear(), first.getMonth() + i, paymentDay);
    if (due) dates.push(due);
  }
  return dates;
};
