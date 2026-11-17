/**
 * 계약 만기 처리 비교표(대표님 2026-11-17): 만기가 다가온 계약자에게 세 길을 한 장에 나란히 보여 준다.
 *   1안 계약 연장 · 2안 인수 · 3안 반납(만기 반납, 중도해지 아님)
 *
 * 세 길 모두 지금 계약의 남은 회차(아직 입금 안 된 청구서)는 그대로 낸다. 그 위에
 *   연장: 보증금은 연장 계약으로 승계, 새 월 렌트료를 낸다.
 *   인수: 인수가에서 보증금을 빼고 낸다. 제3자가 인수하면 약관의 승계 수수료가 붙는다.
 *   반납: 보증금을 돌려드린다. 반납 뒤 외관 상태에 따라 수리비를 빼고 돌려드린다.
 *
 * 만기에는 계약 기간의 렌트료가 모두 정산돼야 한다(대표님 2026-11-17 "상환스케줄표의 날짜·회차와 계약기간을 보면 회차를 알 수 있다").
 * 회차표가 만기 전에 끝나 있으면 빠진 결제일을 월 렌트료로 채워 넣고 missing으로 표시한다.
 */

// 계약서 약관의 제3자 인수 승계 수수료(대표님 2026-11-09)
export const SUCCESSION_FEE = 330000;

const num = (v) => Number(v) || 0;
const KST_MS = 9 * 3600 * 1000;
// 'YYYY-MM-DD' 또는 DB 날짜(한국 자정 = UTC 전날 15시)를 한국 날짜로
const toYmd = (v) => {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : new Date(d.getTime() + KST_MS).toISOString().slice(0, 10);
};
// 같은 날짜로 n개월 뒤(말일 넘치면 그달 말일)
const addMonthsYmd = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};

/**
 * 아직 입금 안 된 회차와 그 회차의 남은 금액.
 * 미납을 다음 청구서로 넘기면 다음 회차 합계에 앞 회차 미납(prevUnpaid)이 들어가므로, 그 몫을 빼고 회차마다 제 몫만 센다.
 */
export const remainingRoundsOf = (rounds = []) => rounds
  .filter((r) => r && r.status !== '입금완료')
  .map((r) => {
    const own = num(r.total) - num(r.prevUnpaid) + num(r.prevOverpaid);
    return { no: r.no, dueDate: toYmd(r.dueDate), status: r.status, fine: num(r.fine), amount: Math.max(0, own - num(r.paidAmount)) };
  })
  .filter((r) => r.amount > 0)
  .sort((a, b) => num(a.no) - num(b.no));

/**
 * 회차표 마지막 결제일 다음 결제일이 계약 만기(저장값 = 기간 다음 날)보다 앞이면 회차표에 빠진 회차다.
 * @returns {{no, dueDate, status: '회차표 없음', amount, missing: true}[]}
 */
export const missingRoundsOf = (rounds = [], contractEnd, monthlyRent) => {
  const end = toYmd(contractEnd);
  const last = [...rounds].filter((r) => r?.dueDate).sort((a, b) => num(a.no) - num(b.no)).pop();
  if (!end || !last || !(num(monthlyRent) > 0)) return [];
  const out = [];
  const base = toYmd(last.dueDate);
  for (let k = 1; k <= 120; k += 1) {
    const due = addMonthsYmd(base, k);
    if (due >= end) break;
    out.push({ no: num(last.no) + k, dueDate: due, status: '회차표 없음', fine: 0, amount: num(monthlyRent), missing: true });
  }
  return out;
};

/**
 * @param {object} p
 *   rounds 회차표 회차들, contractEnd 계약 만기(저장값), monthlyRent 월 렌트료(빠진 회차를 채울 금액),
 *   deposit 지금 보증금, takeoverPrice 만기 인수가,
 *   extensions [{months, monthlyFee, takeoverPrice, maintenance}] 연장 견적의 안들,
 *   thirdParty 제3자 인수 여부, successionFee 승계 수수료, repairEstimate 반납 때 예상 수리비(모르면 0)
 * @returns 남은 회차와 세 길의 금액. settle가 +면 고객이 납부할 돈, -면 반환할 돈.
 */
export const compareMaturity = ({ rounds = [], contractEnd = '', monthlyRent = 0, deposit = 0, takeoverPrice = 0, extensions = [], thirdParty = false, successionFee = SUCCESSION_FEE, repairEstimate = 0 } = {}) => {
  const missing = missingRoundsOf(rounds, contractEnd, monthlyRent);
  const remaining = [...remainingRoundsOf(rounds), ...missing];
  const remainingSum = remaining.reduce((s, r) => s + r.amount, 0);
  const all = [...rounds.map((r) => ({ no: num(r.no), dueDate: toYmd(r.dueDate) })), ...missing];
  const lastNo = all.length ? Math.max(...all.map((r) => r.no)) : 0;
  const dep = num(deposit);

  const fee = thirdParty ? num(successionFee) : 0;
  const takeoverPay = num(takeoverPrice) - dep + fee;

  const repair = Math.max(0, num(repairEstimate));
  const depositBack = dep - repair;

  return {
    remaining,
    remainingSum,
    missingCount: missing.length,
    lastNo,
    deposit: dep,
    extension: {
      options: extensions.map((o) => ({ ...o, months: num(o.months), monthlyFee: num(o.monthlyFee), takeoverPrice: num(o.takeoverPrice) })),
      settle: remainingSum
    },
    takeover: { price: num(takeoverPrice), fee, pay: takeoverPay, settle: remainingSum + takeoverPay },
    return: { repair, depositBack, settle: remainingSum - depositBack }
  };
};

/**
 * 정산 금액을 고객에게 보이는 말로. 반납·인수에서 돌려드리는 돈은 보증금이므로 '보증금 반환'이라 쓴다.
 * @param {number} n settle 값(+ 납부, - 반환)
 * @param {'extension'|'takeover'|'return'} kind
 */
export const settleLabel = (n, kind) => {
  if (n > 0) return { title: '납부 금액', amount: n };
  if (n < 0) return { title: kind === 'takeover' ? '보증금 차액 반환' : '보증금 반환', amount: -n };
  return { title: '추가 납부 없음', amount: 0 };
};
