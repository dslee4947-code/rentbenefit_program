/**
 * 회사 내부 금리 (2026-10-05 대표님 결정).
 *
 * 회사는 여러 곳에서 빌린 돈(캐피탈 할부, 렌터카공제조합 대출, 은행 대출 등)과 회사 돈을 섞어 차를 산다.
 * 차마다 실제로 어느 돈으로 샀는지 따지기 어려우므로, 회사 전체 대출의 평균 금리를 '내부 금리'로 정하고
 * 각 차가 묶어 둔 돈에 이 금리로 이자를 매긴다. 그래야 차마다 "회사 돈을 쓰고도 남는지"를 같은 잣대로 본다.
 *
 *   내부 금리 = Σ(대출 잔액 × 금리) ÷ Σ 대출 잔액   (잔액이 없으면 원금으로)
 *   차별 내부 이자 = 매달 (그 차에 묶인 돈 × 내부 금리 ÷ 12)의 합
 *   묶인 돈 = 그때까지 나간 돈 − 들어온 돈 (대출금·할부금·할부이자는 빼고 본다)
 *   받은 보증금은 묶인 돈을 줄인다. 견적의 '보증금 이자 이득'과 같은 기준이 되게 하려는 것이다.
 *
 * 자기 대출로 산 차(원장에 대출금·할부금 줄이 있는 차)는 그 대출의 실제 이자를 쓰고 내부 이자를 매기지 않는다.
 * 이자 줄만 있는 원장(엑셀 갑지에서 '대출로 샀다고 보고' 넣은 이자, 2026-10 기준 119장)은 회사 돈으로 산 차로 보고 내부 이자를 쓴다.
 */

// 대출 목록을 아직 넣지 않았을 때 쓰는 값. 견적 기준 금리와 같다.
export const DEFAULT_INTERNAL_RATE = 0.06;

/** 대출 목록으로 내부 금리를 낸다. 직접 정한 금리(manualRate)가 있으면 그것을 쓴다. */
export const computeInternalRate = (funding) => {
  const manual = Number(funding?.manualRate);
  if (manual > 0) return { rate: manual, source: 'manual', weight: 0 };
  let weight = 0;
  let weighted = 0;
  for (const loan of funding?.loans || []) {
    const rate = Number(loan.annualRate);
    const base = Number(loan.balance) > 0 ? Number(loan.balance) : Number(loan.principal) || 0;
    if (!(rate > 0) || !(base > 0)) continue;
    weight += base;
    weighted += base * rate;
  }
  if (!weight) return { rate: DEFAULT_INTERNAL_RATE, source: 'default', weight: 0 };
  return { rate: weighted / weight, source: 'loans', weight };
};

// 원장 줄 중 '돈을 빌리고 갚는' 줄. 차를 사고 굴리는 돈이 아니라 묶인 돈 계산에서 뺀다.
// 보증금은 넣는다: 받은 보증금만큼 회사 돈이 덜 묶인다(견적의 보증금 이자 이득과 같은 생각).
export const FINANCING_CATEGORIES = new Set(['대출금', '할부금', '할부이자']);

/** 이 원장이 자기 대출로 산 차인지. 실제로 빌리고 갚은 줄(대출금·할부금)이 있어야 한다. 이자 줄만으로는 대출로 보지 않는다. */
export const hasOwnLoan = (entries) => (entries || []).some((e) => ['대출금', '할부금'].includes(e.category));

/**
 * 차 한 대의 내부 이자를 원장 줄로 계산한다.
 * 줄의 날짜 순서대로 묶인 돈을 쌓고, 달마다 그 달 말의 묶인 돈 × 금리 ÷ 12를 더한다(음수면 0).
 * 날짜 없는 줄은 첫 달에 넣는다. 오늘(asOf)까지만 센다.
 *
 * @returns {{ interest: number, months: number, peak: number, current: number }}
 */
export const internalInterestFor = (entries, annualRate, asOf = new Date()) => {
  const rows = (entries || [])
    .filter((e) => !FINANCING_CATEGORIES.has(e.category) && Number(e.amount))
    .map((e) => ({ t: e.date ? new Date(e.date) : null, v: (e.side === '입금' ? -1 : 1) * Number(e.amount) }));
  const dated = rows.filter((r) => r.t && !Number.isNaN(r.t.getTime())).sort((a, b) => a.t - b.t);
  if (!dated.length) return { interest: 0, months: 0, peak: 0, current: 0 };

  const monthKey = (d) => d.getFullYear() * 12 + d.getMonth();
  const start = monthKey(dated[0].t);
  const end = monthKey(asOf);
  let tied = rows.filter((r) => !r.t || Number.isNaN(r.t.getTime())).reduce((s, r) => s + r.v, 0);
  let i = 0;
  let interest = 0;
  let peak = 0;
  for (let m = start; m <= end; m += 1) {
    while (i < dated.length && monthKey(dated[i].t) <= m) { tied += dated[i].v; i += 1; }
    const held = Math.max(0, tied);
    peak = Math.max(peak, held);
    interest += held * annualRate / 12;
  }
  return { interest, months: Math.max(0, end - start + 1), peak, current: Math.max(0, tied) };
};
