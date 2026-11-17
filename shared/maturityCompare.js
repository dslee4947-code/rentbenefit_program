/**
 * 계약 만기 처리 비교표(대표님 2026-11-17): 만기가 다가온 계약자에게 세 길을 한 장에 나란히 보여 준다.
 *   1안 계약 연장 · 2안 인수 · 3안 반납(만기 반납, 중도해지 아님)
 *
 * 세 길 모두 지금 계약의 남은 회차(아직 입금 안 된 청구서)는 그대로 낸다. 그 위에
 *   연장: 보증금은 연장 계약으로 승계, 새 월 렌트료를 낸다.
 *   인수: 인수가에서 보증금을 빼고 낸다. 제3자가 인수하면 약관의 승계 수수료가 붙는다.
 *   반납: 보증금을 돌려드린다. 반납 뒤 외관 상태에 따라 수리비를 빼고 돌려드린다.
 */

// 계약서 약관의 제3자 인수 승계 수수료(대표님 2026-11-09)
export const SUCCESSION_FEE = 330000;

const num = (v) => Number(v) || 0;

/**
 * 아직 입금 안 된 회차와 그 회차의 남은 금액.
 * 미납을 다음 청구서로 넘기면 다음 회차 합계에 앞 회차 미납(prevUnpaid)이 들어가므로, 그 몫을 빼고 회차마다 제 몫만 센다.
 */
export const remainingRoundsOf = (rounds = []) => rounds
  .filter((r) => r && r.status !== '입금완료')
  .map((r) => {
    const own = num(r.total) - num(r.prevUnpaid) + num(r.prevOverpaid);
    return { no: r.no, dueDate: r.dueDate, status: r.status, fine: num(r.fine), amount: Math.max(0, own - num(r.paidAmount)) };
  })
  .filter((r) => r.amount > 0)
  .sort((a, b) => num(a.no) - num(b.no));

/**
 * @param {object} p
 *   rounds 회차표 회차들, deposit 지금 보증금, takeoverPrice 지금 인수가,
 *   extensions [{months, monthlyFee, takeoverPrice, maintenance}] 연장 견적의 안들,
 *   thirdParty 제3자 인수 여부, successionFee 승계 수수료, repairEstimate 반납 때 예상 수리비(모르면 0)
 * @returns 남은 회차와 세 길의 금액. settle가 +면 고객이 내실 돈, -면 돌려드릴 돈.
 */
export const compareMaturity = ({ rounds = [], deposit = 0, takeoverPrice = 0, extensions = [], thirdParty = false, successionFee = SUCCESSION_FEE, repairEstimate = 0 } = {}) => {
  const remaining = remainingRoundsOf(rounds);
  const remainingSum = remaining.reduce((s, r) => s + r.amount, 0);
  const dep = num(deposit);

  const fee = thirdParty ? num(successionFee) : 0;
  const takeoverPay = num(takeoverPrice) - dep + fee;

  const repair = Math.max(0, num(repairEstimate));
  const depositBack = dep - repair;

  return {
    remaining,
    remainingSum,
    deposit: dep,
    extension: {
      options: extensions.map((o) => ({ ...o, months: num(o.months), monthlyFee: num(o.monthlyFee), takeoverPrice: num(o.takeoverPrice) })),
      settle: remainingSum
    },
    takeover: { price: num(takeoverPrice), fee, pay: takeoverPay, settle: remainingSum + takeoverPay },
    return: { repair, depositBack, settle: remainingSum - depositBack }
  };
};
