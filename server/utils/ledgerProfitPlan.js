import Vehicle from '../models/Vehicle.js';
import Contract from '../models/Contract.js';
import Quote from '../models/Quote.js';
import { calculateVehicleProfit, QUOTE_DEFAULTS } from './vehicleProfit.js';
import { mergeMaintenanceRates } from '../../shared/maintenanceRates.js';
import { quotePlanOf, planInterestTotal, planRevenue, isDepositOffsetTakeover } from '../../shared/ledgerPlan.js';

/**
 * 원장 '계약 손익 기준표' (구상안 2단계, 2026-10-28).
 *
 * 예전에는 수익성 검토를 열 때마다 견적 비용을 다시 계산했다. 그러면 렌트차량 DB를 고칠 때마다
 * 이미 끝난 계약의 손익까지 따라 바뀐다. 계약할 때 정한 기준은 한 번 계산해 갑지에 저장해 두고,
 * 바꿀 때는 [다시 계산]으로만 바꾼다(바꾸기 전 값은 history에 남긴다).
 *
 * 값을 가져오는 순서: 프로그램 견적서 → 원장 계약 조건(월 렌트료·선납금·보증금·인수가·기간) → 렌트차량 DB → 기본값.
 * 견적은 차를 들여올 때 한 번 쓰므로 최초 계약(1구간)을 놓고 계산한다.
 */

/**
 * 견적서가 없는 지난 계약의 정비비는 정비 단가표의 처음 값(shared 기본값, '2026-10-04 초기값')으로 낸다.
 * 2026-10-28 단가표가 실제 평균으로 올랐는데(정기점검 경차 56k→90k 등), 대표님은 정비비 검토를
 * '견적서에 나온 금액 그대로'로 원하신다. 지금 단가로 지난 계약의 기준을 세우면 그때 받기로 한 정비비보다 커진다.
 * 새 계약은 견적서가 있어 견적서의 정비 내역을 그대로 쓴다.
 */
export const PAST_CONTRACT_MAINTENANCE_RATES = mergeMaintenanceRates(null);

const LABEL = { monthlyFee: '월 렌트료', advancePayment: '선납금', deposit: '보증금', takeoverPrice: '인수가' };

const firstPeriodOf = (ledger) => [...(ledger.contractPeriods || [])].sort((a, b) => a.seq - b.seq)[0];

/** 이 갑지의 최초 계약과 그 견적서. 견적서가 없으면 이유를 함께 준다. */
export const findLedgerQuote = async (ledger) => {
  const first = firstPeriodOf(ledger);
  // 구간이 있으면 1구간의 계약만 본다. ledger.contract는 연장하면 연장 계약으로 바뀌어 견적과 상관없다.
  const contractId = first ? first.contract : ledger.contract;
  const contract = contractId
    ? await Contract.findById(contractId).select('quote contractNo termMonths rentPeriodYears').lean()
    : null;

  if (!contract) return { contract, quote: null, reason: '연결된 계약이 없습니다.' };
  if (!contract.quote) return { contract, quote: null, reason: `계약 ${contract.contractNo || ''}은(는) 견적서에서 만들어지지 않았습니다.`.replace(/\s+/g, ' ') };
  const quote = await Quote.findById(contract.quote)
    .select('vehicleModel totalPrice pricing insurance maintenance comparisonVehicles activeVehicleId monthlyEstimates createdAt')
    .lean();
  return quote ? { contract, quote, reason: '' } : { contract, quote: null, reason: '계약에 적힌 견적서가 삭제되었습니다.' };
};

/**
 * 견적서가 없는 차(엑셀에서 옮겨 온 계약 대부분)는 렌트차량 DB 값에 견적서 식을 돌린다.
 *
 * 계약 조건은 렌트차량 DB보다 원장 값을 먼저 쓴다(2026-10-28).
 * 렌트차량 DB의 월 렌트료가 원장과 다른 차가 32대였다(Benz-013: DB 469,000원, 원장 2,975,445원). 그 값으로 계산하니
 * 125대 합계가 1억 8천만 원 손실로 나왔다. 원장은 자금팀이 실제 계약대로 맞춰 둔 장부라 그쪽이 맞다.
 * 구간이 하나뿐이면 고정 조건(terms)도 같은 계약이다. 연장한 갑지의 terms는 연장 계약 값이라
 * (Ray-002: 연장 렌트료 130,000원 × 최초 60개월) 1구간이 비어도 쓰지 않는다.
 */
export const estimateFromVehicle = async ({ ledger, contract, vehicle, maintenanceRates }) => {
  const first = firstPeriodOf(ledger);
  const single = (ledger.contractPeriods || []).length <= 1;
  const fromLedger = (key) => {
    const value = Number(first?.[key]) || (single ? Number(ledger.terms?.[key]) : 0);
    return value > 0 ? value : 0;
  };
  const ledgerTerms = {
    monthlyFee: fromLedger('monthlyRent'),
    advancePayment: fromLedger('advancePayment'),
    deposit: fromLedger('deposit'),
    takeoverPrice: fromLedger('takeoverPrice')
  };
  const ledgerNotes = [];
  const merged = { ...vehicle };
  let fromLedgerUsed = false;
  Object.entries(ledgerTerms).forEach(([key, value]) => {
    if (!value) return;
    fromLedgerUsed = true;
    // 1천 원 미만 차이는 원장이 CMS 수수료(275원)를 떼고 적은 것이라 렌트차량 DB 값을 그대로 둔다(수수료는 화면에서 따로 뺀다)
    if (Math.abs(value - (Number(vehicle[key]) || 0)) < 1000) return;
    ledgerNotes.push(`${LABEL[key]}: 렌트차량 DB ${(Number(vehicle[key]) || 0).toLocaleString()}원 대신 원장 ${value.toLocaleString()}원`);
    merged[key] = value;
  });

  // 기간도 1구간(최초 계약)을 먼저 본다. 고정 조건(terms)은 연장하면 연장 계약 기간으로 바뀌므로 구간이 하나일 때만 쓴다.
  const termMonths = Number(first?.termMonths) || (single ? Number(ledger.terms?.termMonths) : 0) || Number(vehicle.paymentTerm)
    || Number(contract?.termMonths) || Number(contract?.rentPeriodYears || 0) * 12 || 0;
  const profit = calculateVehicleProfit(merged, termMonths, { maintenanceRates: maintenanceRates || PAST_CONTRACT_MAINTENANCE_RATES });
  if (!profit.ok) return { ok: false, reason: profit.reason };

  return {
    ok: true,
    estimate: {
      ...profit.breakdown,
      months: profit.termMonths,
      vehicleLabel: [vehicle.carModel, vehicle.plateNo].filter(Boolean).join(' '),
      ledgerNotes,
      sources: {
        ...profit.sources,
        ...(vehicle.fromHeader ? { netVehiclePrice: '갑지 상단 차량가' } : {}),
        ...(fromLedgerUsed ? { revenue: '원장 계약 조건' } : {})
      },
      // 판관비는 차량 DB에 금액이 있으면 그 값을 썼으므로 '차량가의 3%' 가정은 빼고 보여 준다
      assumptions: [
        ...(vehicle.fromHeader ? ['차량: 렌트차량 DB에 연결된 차가 없어 갑지 상단 차량가·배기량으로 계산'] : []),
        ...(vehicle.depositOffset ? [`인수가: 원장에 인수가 줄이 없어 보증금 ${vehicle.depositOffset.toLocaleString()}원과 상계한 것으로 봄`] : []),
        ...profit.assumptions.filter((a) => !(Number(vehicle.sellingAdminExpense) > 0 && a.startsWith('판관비'))),
        `베네핏 수수료: 차량가의 ${(QUOTE_DEFAULTS.commissionRate * 100).toFixed(1)}%`
      ]
    }
  };
};

/**
 * 차량이 연결되지 않은 갑지(엑셀 '판매완료 정산 리스트'에서 옮긴 거래완료 차 대부분)는 갑지 상단 정보로 차를 대신한다.
 * 차량가·배기량·차종과, 등록일(없으면 출고일·계약일)부터 계약종료일까지의 개월 수, 고정 조건(월 렌트료·보증금 등)을 쓴다.
 *
 * 계약 기준을 세울 수 없는 갑지는 만들지 않고 이유를 준다(2026-10-28 점검).
 *   - 계약 기간(등록일~계약종료일)이나 월 렌트료가 없으면: 렌트료 입금 줄 수로 기간을 짐작하면 틀린다
 *     (Benz-004는 46회를 받았는데 원장 렌트료 줄은 7줄뿐이라 7개월로 잡혔다)
 *   - 중간에 반납받아 중고로 판 차('차량 판매금'·'판매 대금'·'차량대금' 입금): 계약대로 끝난 차가 아니라 계약 기준이 의미 없다.
 *     이런 차의 손익은 원장 정산계(실제 들어오고 나간 돈)가 맞다.
 * @returns {object|{skip: string}|null}
 */
export const vehicleFromHeader = (ledger) => {
  const h = ledger.header || {};
  if (!(Number(h.carPrice) > 0)) return null;
  const sold = (ledger.entries || []).some((e) => e.side === '입금' && Number(e.amount) > 0
    && (/판매\s*(금|대금)|매각/.test(e.label || '') || (e.category === '차량가' && /대금/.test(e.label || ''))));
  if (sold) return { skip: '중간에 반납받아 중고로 판 차라 계약 기준을 세울 수 없습니다. 원장 정산계가 실제 손익입니다.' };
  const start = h.deliveredAt || h.registeredAt || h.contractedAt;
  let months = 0;
  if (start && h.contractEndAt) {
    const a = new Date(start);
    const b = new Date(h.contractEndAt);
    // 2022-05-20 ~ 2025-05-19는 36개월이다. 끝나는 날이 시작일 전날이면 꽉 찬 달로 센다
    months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() + 1 >= a.getDate() ? 0 : -1);
  }
  const monthlyFee = Number(ledger.terms?.monthlyRent) || 0;
  if (!(months > 0) || !monthlyFee) return { skip: '갑지에 계약 기간(등록일~계약종료일)이나 월 렌트료가 없어 계약 기준을 세울 수 없습니다.' };
  // 인수가는 고정 조건, 없으면 원장 인수가 입금 줄. 엑셀 갑지에는 인수가가 마이너스로 적힌 줄이 있어(Benz-002) 0원 넘는 줄만 센다
  const takeoverIn = (ledger.entries || [])
    .filter((e) => e.side === '입금' && e.category === '인수가' && Number(e.amount) > 0)
    .reduce((t, e) => t + Number(e.amount), 0);
  // 거래완료인데 인수가 줄 없이 보증금만 남아 있으면 보증금을 인수가와 상계한 것이다(대표님 2026-10-28, Benz-018)
  const depositHeld = (ledger.entries || []).filter((e) => e.category === '보증금')
    .reduce((t, e) => t + (e.side === '입금' ? 1 : -1) * (Number(e.amount) || 0), 0);
  const offset = !(Number(ledger.terms?.takeoverPrice) > 0) && isDepositOffsetTakeover(ledger.status, ledger.entries, depositHeld) ? depositHeld : 0;
  return {
    carModel: h.carModel,
    plateNo: h.plateNo,
    carPrice: Number(h.carPrice),
    cc: Number(h.cc) || 0,
    paymentTerm: months,
    monthlyFee,
    takeoverPrice: Number(ledger.terms?.takeoverPrice) > 0 ? Number(ledger.terms.takeoverPrice) : (takeoverIn || offset),
    depositOffset: offset,
    advancePayment: Number(ledger.terms?.advancePayment) || 0,
    deposit: Number(ledger.terms?.deposit) || 0,
    maintenance: {},
    fromHeader: true
  };
};

/** 견적서로 낸 기준표는 칸마다 출처가 같다 */
const QUOTE_SOURCES = Object.fromEntries(
  ['revenue', 'netVehiclePrice', 'registrationCost', 'baseInsurance', 'ownCarInsurance', 'carTaxTotal', 'interest', 'pandanbi', 'benefitFee', 'maintenance']
    .map((k) => [k, '견적서'])
);

/**
 * 갑지 한 장의 기준표를 계산한다(저장은 하지 않는다).
 * @returns {{ok: boolean, reason?: string, plan?: object}} plan은 VehicleLedger.profitPlans 한 칸 모양
 */
export const computeProfitPlan = async (ledger, { maintenanceRates } = {}) => {
  const { contract, quote, reason } = await findLedgerQuote(ledger);
  const meta = (values, extra) => ({
    periodSeq: 1,
    values,
    // 목록·보고서에서 바로 쓰려고 핵심 숫자를 따로 둔다
    revenue: Math.round(planRevenue(values)),
    interestTotal: Math.round(planInterestTotal(values)),
    operatingProfit: Math.round(planRevenue(values) - (Number(values.costExCommission) || 0) - (Number(values.benefitFee) || 0)),
    ...extra
  });

  const fromQuote = quotePlanOf(quote);
  if (fromQuote) {
    return { ok: true, plan: meta(fromQuote, { source: '견적서', quote: quote._id, sources: QUOTE_SOURCES, assumptions: [], ledgerNotes: [] }) };
  }

  const why = quote ? '견적서가 계산에 쓰는 입력값이 저장되기 전에 만든 것입니다.' : reason;
  let vehicle = ledger.vehicle ? await Vehicle.findById(ledger.vehicle).lean() : null;
  if (!vehicle) {
    vehicle = vehicleFromHeader(ledger);
    if (!vehicle) return { ok: false, reason: `${why} 연결된 차량이 없고 갑지에 차량가도 없어 계산할 수 없습니다.` };
    if (vehicle.skip) return { ok: false, reason: vehicle.skip };
  }
  const est = await estimateFromVehicle({ ledger, contract, vehicle, maintenanceRates });
  if (!est.ok) return { ok: false, reason: `${why} 렌트차량 DB로도 계산할 수 없습니다(${est.reason}).` };
  const { sources, assumptions, ledgerNotes, vehicleLabel, ...values } = est.estimate;
  return { ok: true, plan: meta(values, { source: '추정', sources, assumptions, ledgerNotes, note: why, vehicleLabel }) };
};
