/**
 * 차량별 감가상각 (관리용, 대표님 2026-10-28 "반납형으로 5년에 20%").
 *
 * 차를 산 돈은 산 날 한 번에 비용이 아니라 쓰는 동안 나눠 비용으로 본다. 세무 장부가 아니라 손익을 보려는 관리용 계산이다.
 * - 인수형(장기렌트·인수가 있음): (취득원가 − 인수가) ÷ 계약 개월, 첫 계약 시작일부터
 * - 반납형(장기렌트·인수가 없음)·단기렌트: 60개월, 끝에 취득원가의 20%가 남는다고 보고 등록일부터
 * 취득원가 = 원장 지출 중 차량가·계약금·등록비용·제세공과. 할부 원금은 차값을 나눠 내는 것이라 비용이 아니다.
 */
export const DEPRECIATION_RULE = { returnMonths: 60, residualRate: 0.2 };

const BUY_CATEGORIES = ['차량가', '계약금', '등록비용', '제세공과'];

const monthsBetween = (a, b) =>
  (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() >= a.getDate() ? 0 : -1);

/**
 * 원장 한 개의 감가상각. 계산할 수 없으면 { skip: '이유' }.
 * 월 매출 = 지금 구간 월 렌트료 + 선납금 ÷ 계약 개월(인수형). 단기는 회차가 없어 0.
 */
export const depreciationOf = (ledger, asOf = new Date()) => {
  const entries = ledger.entries || [];
  const buyRows = entries.filter((e) => e.side === '지출' && BUY_CATEGORIES.includes(e.category));
  const cost = buyRows.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  if (cost <= 0) return { skip: '원장에 차량 구입 줄 없음' };

  const periods = [...(ledger.contractPeriods || [])].sort((a, b) => (a.seq || 0) - (b.seq || 0));
  const last = periods[periods.length - 1];
  const takeover = Number(last?.takeoverPrice) || Number(ledger.terms?.takeoverPrice) || 0;
  const contractMonths = periods.reduce((s, p) => s + (Number(p.termMonths) || 0), 0) || Number(ledger.terms?.termMonths) || 0;
  const reg = ledger.header?.registeredAt ? new Date(ledger.header.registeredAt) : null;
  const firstBuy = buyRows.map((e) => e.date && new Date(e.date)).filter(Boolean).sort((a, b) => a - b)[0] || null;

  let kind; let months; let residual; let start;
  if (ledger.ledgerType === '장기렌트' && takeover > 0 && contractMonths > 0) {
    kind = '인수형'; months = contractMonths; residual = takeover;
    start = periods[0]?.startDate ? new Date(periods[0].startDate)
      : ledger.header?.contractedAt ? new Date(ledger.header.contractedAt) : reg || firstBuy;
  } else {
    kind = ledger.ledgerType === '단기렌트' ? '단기' : '반납형';
    months = DEPRECIATION_RULE.returnMonths;
    residual = Math.round(cost * DEPRECIATION_RULE.residualRate);
    start = reg || firstBuy || (periods[0]?.startDate ? new Date(periods[0].startDate) : null);
  }
  if (!start) return { skip: '시작일 없음' };

  const monthly = Math.max(0, cost - residual) / months;
  const elapsed = Math.max(0, Math.min(months, monthsBetween(start, asOf)));
  const accumulated = monthly * elapsed;
  const rent = Number(last?.monthlyRent || ledger.terms?.monthlyRent) || 0;
  const advance = entries.filter((e) => e.side === '입금' && e.category === '선납금').reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const revenue = kind === '단기' ? 0 : rent + (kind === '인수형' && contractMonths ? advance / contractMonths : 0);

  return {
    kind,
    cost: Math.round(cost),
    residual: Math.round(residual),
    months,
    start,
    elapsed,
    monthly: Math.round(monthly),
    accumulated: Math.round(accumulated),
    book: Math.round(cost - accumulated),
    revenue: Math.round(revenue)
  };
};
