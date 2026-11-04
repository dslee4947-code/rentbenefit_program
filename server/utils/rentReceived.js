/**
 * 차량 손익 원장에서 고객이 실제로 낸 렌트료를 센다 (중도해지 정산서, 대표님 2026-11-04).
 *
 * 원장의 '렌트료 n회차' 줄을 그대로 더하면 안 된다.
 *   - 청구서와 같이 받은 과태료·통행료가 섞여 있어 렌트료보다 큰 줄이 있다(Carnival-006 5회차 679,325원). 그 회차 렌트료까지만 인정한다.
 *   - 자동이체 수수료를 뺀 금액이 적혀 있어 렌트료보다 조금 작은 줄이 대부분이다(643,000원 → 642,725원, 수백 원까지 있다).
 *     고객은 다 낸 것이므로 FEE_TOLERANCE 안쪽의 차이는 다 낸 것으로 본다.
 * 여러 대 계약은 회차표 금액을 차마다 나눈 값이 원장과 맞지 않는 계약이 있어(Ray-021) 원장에 적힌 금액을 그대로 쓴다.
 */
export const FEE_TOLERANCE = 1000;

/**
 * @param {object} p
 * @param {Array} p.entries 원장 줄
 * @param {Array} p.rounds 청구 회차표({ no, monthlyRent, status })
 * @param {number} [p.periodSeq] 이 계약의 원장 구간. 연장하면 회차가 1부터 다시 시작한다
 * @param {number} [p.share] 이 차의 몫(한 대면 1)
 * @param {boolean} [p.multi] 여러 대 계약인지
 * @returns {{ total: number, count: number, lastAmount: number, short: Array, missing: number[], unnumbered: number, advanceIn: number }}
 */
export const rentReceivedOf = ({ entries, rounds, periodSeq = 1, share = 1, multi = false }) => {
  const rows = (entries || []).filter((e) => e.side === '입금' && e.category === '렌트료' && (e.periodSeq || 1) === periodSeq);
  const byRound = new Map();
  rows.filter((e) => e.round).forEach((e) => byRound.set(e.round, (byRound.get(e.round) || 0) + (Number(e.amount) || 0)));

  const rentOf = new Map((rounds || []).map((r) => [r.no, Math.round((Number(r.monthlyRent) || 0) * share)]));
  let total = 0;
  const short = [];
  [...byRound.keys()].sort((a, b) => a - b).forEach((no) => {
    const amount = byRound.get(no);
    const rent = rentOf.get(no);
    if (multi || !rent) { total += amount; return; }
    if (rent - amount > FEE_TOLERANCE) short.push({ no, amount, rent });
    total += rent - amount > FEE_TOLERANCE ? amount : rent;
  });

  const lastRound = Math.max(0, ...byRound.keys());
  return {
    total,
    count: byRound.size,
    lastAmount: byRound.get(lastRound) || 0,
    short,
    // 회차표는 입금완료인데 원장에 줄이 없는 회차
    missing: (rounds || []).filter((r) => r.status === '입금완료' && !byRound.has(r.no)).map((r) => r.no),
    // 회차 번호 없이 적힌 렌트료 줄(합계에 넣지 않는다)
    unnumbered: rows.filter((e) => !e.round).length,
    // 이 구간에 받은 선수금. 차량 DB의 선수금과 맞는지 화면에서 본다
    advanceIn: (entries || []).filter((e) => e.side === '입금' && e.category === '선납금' && (e.periodSeq || 1) === periodSeq).reduce((s, e) => s + (Number(e.amount) || 0), 0)
  };
};
