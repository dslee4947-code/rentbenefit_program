/**
 * 중도해지 정산서를 만들 때 원장과 맞춰 볼 값. 계산에는 쓰지 않고 화면 경고에만 쓴다.
 * 렌트료는 청구 회차표의 회차 수와 원래 월 렌트료로 계산한다. 원장에는 CMS 수수료가 빠진 금액이 적혀 있다(대표님 2026-11-04).
 *
 * @param {object} p
 * @param {Array} p.entries 원장 줄
 * @param {number} [p.periodSeq] 이 계약의 원장 구간. 연장하면 회차가 1부터 다시 시작한다
 * @returns {{ ledgerRounds: number, advanceIn: number }} 렌트료 줄이 있는 회차 수, 이 구간에 받은 선수금
 */
export const ledgerCheckOf = ({ entries, periodSeq = 1 }) => {
  const inPeriod = (entries || []).filter((e) => e.side === '입금' && (e.periodSeq || 1) === periodSeq);
  return {
    ledgerRounds: new Set(inPeriod.filter((e) => e.category === '렌트료' && e.round).map((e) => e.round)).size,
    advanceIn: inPeriod.filter((e) => e.category === '선납금').reduce((s, e) => s + (Number(e.amount) || 0), 0)
  };
};
