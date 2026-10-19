import VehicleLedger from '../models/VehicleLedger.js';
import Vehicle from '../models/Vehicle.js';
import Setting from '../models/Setting.js';
import { getMaintenanceRates } from './maintenanceRates.js';
import { computeInternalRate } from '../../shared/companyFunding.js';
import { calculateShortTermTarget, shortTermPerformance, vehicleAgeStartOf, SHORT_TERM_COMPARE_TERMS, SHORT_TERM_AGE_FACTORS } from '../../shared/shortTermTarget.js';

/**
 * 단기렌트 차량별 월 목표 달성 보고.
 *
 * 원장(갑지)의 단기렌트 장을 모두 읽어, 차마다 견적서 식으로 월 목표를 내고(shared/shortTermTarget.js)
 * 원장 고객입금으로 달마다 얼마나 벌었는지 맞대 본다. 경영 요약 대시보드와 원장 화면이 이 결과를 같이 쓴다.
 */

const COMPANY_FUNDING_KEY = 'companyFunding';

export const getInternalRate = async () => {
  const doc = await Setting.findOne({ key: COMPANY_FUNDING_KEY }).lean();
  return computeInternalRate(doc?.value || {}).rate;
};

// 목표 계산에 쓸 차량 정보. 렌트차량 DB 값이 정본이고, 없으면 원장 상단 값을 쓴다.
const carOf = (ledger, vehicle) => ({
  carPrice: Number(vehicle?.carPrice) || Number(ledger.header?.carPrice) || 0,
  optionPrice: Number(vehicle?.optionPrice) || 0,
  discount: Number(vehicle?.discount) || 0,
  deliveryFee: Number(vehicle?.deliveryFee) || 0,
  cc: Number(vehicle?.cc) || Number(ledger.header?.cc) || 0,
  carModel: vehicle?.carModel || ledger.header?.carModel || '',
  fuelType: vehicle?.fuelType || '',
  mileage: Number(vehicle?.maintenance?.mileage) || 0,
  tireType: vehicle?.maintenance?.tireType || ''
});

/**
 * 원장 한 장의 목표와 달성. 원장에 월 목표를 직접 적어 두었으면(shortTerm.monthlyTarget) 그 값을 쓴다.
 * @param {object} ledger lean 원장
 * @param {object|null} vehicle lean 차량
 * @param {{ annualRate: number, maintenanceRates: object }} ctx
 */
export const shortTermRowFor = (ledger, vehicle, ctx, asOf = new Date()) => {
  const calc = calculateShortTermTarget(carOf(ledger, vehicle), ctx);
  // 비교용: 5년 · 인수가 0%로 잡으면 월 얼마인지(5년 뒤 중고차 값이 순수익이 되는 방식)
  const alt = calculateShortTermTarget(carOf(ledger, vehicle), { ...ctx, terms: SHORT_TERM_COMPARE_TERMS });
  const manualTarget = Number(ledger.shortTerm?.monthlyTarget) || 0;
  const monthlyTarget = manualTarget || (calc.ok ? calc.monthlyTarget : 0);
  const perf = shortTermPerformance(ledger, monthlyTarget, asOf, { ageStart: vehicleAgeStartOf(ledger, vehicle) });
  return {
    ledgerId: ledger._id,
    ledgerNo: ledger.ledgerNo,
    vehicleId: vehicle?._id || null,
    cc: carOf(ledger, vehicle).cc,
    fuelType: vehicle?.fuelType || '',
    ageStart: vehicleAgeStartOf(ledger, vehicle),
    status: ledger.status,
    carModel: vehicle?.carModel || ledger.header?.carModel || '',
    plateNo: vehicle?.plateNo || ledger.header?.plateNo || '',
    carPrice: carOf(ledger, vehicle).carPrice,
    targetSource: manualTarget ? 'manual' : 'quote',
    calculatedTarget: calc.ok ? calc.monthlyTarget : null,
    totalCost: calc.ok ? calc.totalCost : null,
    takeoverPrice: calc.ok ? calc.takeoverPrice : null,
    maintenanceCost: calc.ok ? calc.maintenanceCost : null,
    compareTarget: alt.ok ? { monthlyTarget: alt.monthlyTarget, totalCost: alt.totalCost, termMonths: alt.termMonths } : null,
    assumptions: calc.ok ? [...calc.assumptions, `차령 가감: ${SHORT_TERM_AGE_FACTORS.map((f, i) => `${i + 1}년차${i === SHORT_TERM_AGE_FACTORS.length - 1 ? ' 이후' : ''} ×${f}`).join(' · ')} (1~3년 합계는 그대로)`] : [],
    reason: !monthlyTarget ? (calc.reason || '목표를 낼 수 없습니다') : (!perf.ok ? '단기렌트 시작일을 알 수 없습니다' : null),
    performance: perf
  };
};

/** 단기렌트 원장 전부의 보고. 판매가 끝난(거래완료) 차와 차량가가 없는 공통지출 장은 뺀다. */
export const buildShortTermReport = async (asOf = new Date()) => {
  const [ledgers, annualRate, maintenanceRates] = await Promise.all([
    VehicleLedger.find({ ledgerType: '단기렌트', status: { $ne: '거래완료' } }).lean(),
    getInternalRate(),
    getMaintenanceRates()
  ]);
  const vehicles = await Vehicle.find({ _id: { $in: ledgers.map((l) => l.vehicle).filter(Boolean) } })
    .select('carModel plateNo carPrice optionPrice discount deliveryFee cc fuelType maintenance status registrationDate deliveryDate').lean();
  const byId = new Map(vehicles.map((v) => [String(v._id), v]));
  const ctx = { annualRate, maintenanceRates };

  const rows = ledgers
    .filter((l) => Number(byId.get(String(l.vehicle))?.carPrice) || Number(l.header?.carPrice))
    .map((l) => shortTermRowFor(l, byId.get(String(l.vehicle)) || null, ctx, asOf));

  const ok = rows.filter((r) => r.performance.ok);
  const sum = (list, fn) => list.reduce((s, r) => s + (fn(r) || 0), 0);
  const lastMonthRows = ok.filter((r) => r.performance.lastMonth);
  return {
    asOf,
    annualRate,
    count: rows.length,
    // 이번 달 차령을 반영한 월 목표 합계
    monthlyTarget: sum(ok, (r) => r.performance.currentTarget),
    thisMonth: {
      target: sum(ok, (r) => r.performance.thisMonth?.target),
      actual: sum(ok, (r) => r.performance.thisMonth?.actual)
    },
    lastMonth: {
      month: lastMonthRows[0]?.performance.lastMonth.month || null,
      target: sum(lastMonthRows, (r) => r.performance.lastMonth.target),
      actual: sum(lastMonthRows, (r) => r.performance.lastMonth.actual),
      // 지난달 목표에 못 미친 차
      belowCount: lastMonthRows.filter((r) => r.performance.lastMonth.rate !== null && r.performance.lastMonth.rate < 1).length
    },
    cumTarget: sum(ok, (r) => r.performance.cumTarget),
    cumActual: sum(ok, (r) => r.performance.cumActual),
    // 목표 대비 부족한 순(지금까지 덜 번 금액이 큰 차부터)
    rows: rows.sort((a, b) => (a.performance.gap ?? 0) - (b.performance.gap ?? 0))
  };
};
