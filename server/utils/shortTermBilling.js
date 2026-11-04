import Contract from '../models/Contract.js';
import Vehicle from '../models/Vehicle.js';
import BillingSchedule from '../models/BillingSchedule.js';
import VehicleLedger from '../models/VehicleLedger.js';
// populate('companyId'/'customer')에 필요하다(이 파일만 불러 쓰는 곳에서도 모델이 등록되게)
import '../models/Company.js';
import '../models/Customer.js';
import { calcDailyRent } from './billingDate.js';

/**
 * 단기렌트 월 청구 (대표님 2026-11-03, 주식회사 레이 그랜저 142호9185).
 *
 * 단기렌트·사고대차 차량을 한 달 단위로 빌려주면 매달 청구서를 보낸다. 청구서 발행·발송·입금 처리는
 * 장기렌트와 같은 화면(장기렌트 청구서)을 쓰도록, 계약(rentalKind '단기렌트')과 청구 회차표를 만든다.
 *
 * 장기렌트와 다른 점
 *  - 계약 기간이 없다. 회차는 대여 시작일부터 한 달씩, 다음 청구까지 필요한 만큼만 만들어 둔다
 *    (청구 화면에서 그 달을 열 때 늘어난다). 반납하면 그날까지 일할로 마지막 회차를 맞추고 끝낸다.
 *  - 청구일은 대여 시작일과 같은 날(9/16 시작이면 매달 16일, 그 달의 대여료를 미리 받는다).
 *    결제일(pricing.billingDay)을 정하면 그날이 청구일이다. 대여 기간과 반납 일할은 그대로 시작일 기준이다
 *    (레이 그랜저: 9/16 시작, 25일 결제 → 9/25에 9/16~10/15분을 받는다).
 *  - 차는 단기렌트 차량 그대로 둔다(상태·원장 형태를 바꾸지 않는다). 차량 DB의 월 렌트료도 건드리지 않는다.
 *  - 입금이 확인되면 그 차의 차량 손익 원장(단기렌트 갑지)에 '○○ 단기렌트료 n회차' 입금 줄이 들어간다.
 */

export const SHORT_TERM = '단기렌트';
// 다음 청구서를 미리 만들 수 있게 오늘부터 이만큼 앞의 회차까지 만들어 둔다(청구서는 결제일 열흘 전에 보낸다)
const AHEAD_DAYS = 35;

export const isShortTerm = (contract) => contract?.rentalKind === SHORT_TERM;

// 한국 날짜 y-m-d의 정오(UTC 03:00). 회차 날짜가 하루 밀리지 않게 시각을 낮으로 둔다
const kstNoon = (y, m, d) => new Date(Date.UTC(y, m, d, 3));
const kstParts = (date) => {
  const k = new Date(new Date(date).getTime() + 9 * 3600 * 1000);
  return { y: k.getUTCFullYear(), m: k.getUTCMonth(), d: k.getUTCDate() };
};
/** 시작일에서 n개월 뒤 같은 날. 그 달에 그날이 없으면 말일 */
const addMonths = (start, n) => {
  const { y, m, d } = kstParts(start);
  const last = new Date(Date.UTC(y, m + n + 1, 0)).getUTCDate();
  return kstNoon(y, m + n, Math.min(d, last));
};
/**
 * n번째 회차(0부터)의 청구일. 결제일이 없으면 시작일에서 n개월 뒤 같은 날이다.
 * 결제일이 시작일의 날짜보다 앞이면 그 달 결제일은 이미 지났으므로 다음 달부터 낸다. 그 달에 그날이 없으면 말일.
 */
export const shortTermDueDate = (start, n, billingDay) => {
  if (!billingDay) return addMonths(start, n);
  const { y, m, d } = kstParts(start);
  const month = m + n + (billingDay < d ? 1 : 0);
  const last = new Date(Date.UTC(y, month + 1, 0)).getUTCDate();
  return kstNoon(y, month, Math.min(billingDay, last));
};
const dayDiff = (a, b) => Math.round((kstNoon(...Object.values(kstParts(b))) - kstNoon(...Object.values(kstParts(a)))) / 86400000);
const ymd = (d) => { const { y, m, d: dd } = kstParts(d); return `${y}-${String(m + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`; };

/**
 * 단기렌트 계약의 회차표를 만들거나 늘린다. 청구·입금된 회차는 그대로 둔다.
 * @param {object|string} contractOrId
 * @param {Date} [now]
 */
export const buildShortTermSchedule = async (contractOrId, now = new Date()) => {
  const contract = typeof contractOrId === 'object' && contractOrId.rentalKind
    ? contractOrId
    : await Contract.findById(contractOrId).lean();
  if (!isShortTerm(contract)) throw new Error('단기렌트 계약이 아닙니다.');
  const start = contract.rentStartDate || contract.deliveryDate;
  const monthly = Number(contract.pricing?.monthlyFee) || 0;
  const billingDay = Number(contract.pricing?.billingDay) || 0;
  if (!start) throw new Error('대여 시작일이 없습니다.');
  if (!monthly) throw new Error('월 대여료가 0원입니다.');

  const until = contract.returnDate ? new Date(contract.returnDate) : new Date(now.getTime() + AHEAD_DAYS * 86400000);
  const existing = await BillingSchedule.findOne({ contract: contract._id });
  const kept = new Map((existing?.rounds || []).filter((r) => r.status !== '예정' || r.issuedAt).map((r) => [r.no, r]));

  const rounds = [];
  for (let i = 0; i < 600; i += 1) {
    const period = addMonths(start, i); // 이 회차 대여 기간의 시작
    const due = shortTermDueDate(start, i, billingDay);
    if (contract.returnDate ? dayDiff(period, until) <= 0 : due > until) break;
    const no = i + 1;
    if (kept.has(no)) { rounds.push(kept.get(no)); continue; }
    // 반납이 이번 달 대여 기간 안이면 반납일까지 일할(반납일은 빼고 센다)
    const next = addMonths(start, i + 1);
    let amount = monthly;
    let note;
    if (contract.returnDate && dayDiff(until, next) > 0) {
      const days = dayDiff(period, until);
      const span = dayDiff(period, next);
      amount = Math.round((monthly * days) / span);
      note = `반납일(${ymd(until)})까지 ${days}일 일할 (월 ${monthly.toLocaleString()}원 × ${days}/${span}일)`;
    }
    rounds.push({ no, dueDate: due, monthlyRent: amount, total: amount, status: '예정', ...(note ? { note } : {}) });
  }
  // 반납으로 회차가 줄면 뒤의 (아직 안 나간) 회차는 지운다. 이미 청구·입금된 회차는 남긴다
  kept.forEach((r, no) => { if (!rounds.some((x) => x.no === no)) rounds.push(r); });
  rounds.sort((a, b) => a.no - b.no);

  const payload = {
    contract: contract._id,
    company: contract.companyId || undefined,
    customer: contract.customer,
    totalRounds: rounds.length,
    monthlyRent: monthly,
    dailyRent: calcDailyRent(monthly),
    paymentDay: String(billingDay || kstParts(start).d),
    baseDate: start,
    rounds
  };
  if (existing) {
    existing.set(payload);
    return existing.save();
  }
  return BillingSchedule.create(payload);
};

/** 진행 중인 단기렌트 계약의 회차를 오늘 기준으로 늘린다. 청구 화면을 열 때 부른다 */
export const ensureShortTermRounds = async () => {
  const list = await Contract.find({ rentalKind: SHORT_TERM, status: '진행중' }).lean();
  for (const c of list) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await buildShortTermSchedule(c);
    } catch (err) {
      console.error(`[단기렌트 회차] ${c.contractNo}: ${err.message}`);
    }
  }
};

/** 청구서 차량 표에 찍을 값. 단기렌트 차는 차량 DB의 월 렌트료·인도일이 이 계약 것이 아니다 */
export const shortTermVehicleView = (contract, v) => (isShortTerm(contract)
  ? { ...v, monthlyFee: Number(contract.pricing?.monthlyFee) || 0, deliveryDate: contract.rentStartDate, advancePayment: 0, paymentTerm: 0 }
  : v);

/**
 * 단기렌트 회차의 입금을 그 차의 차량 손익 원장에 적는다(차량으로, 없으면 차량번호로 갑지를 찾는다).
 * 입금액이 0이 되면(입금 취소) 자동으로 넣은 줄을 지운다. 사람이 고친 줄(locked)은 건드리지 않는다.
 * @returns {Promise<string>} 무엇을 했는지 한 줄
 */
export const postShortTermPaymentToLedger = async (schedule, roundNo) => {
  const contract = await Contract.findById(schedule.contract).populate('companyId', 'name').populate('customer', 'name').lean();
  if (!isShortTerm(contract)) return '';
  const round = schedule.rounds.find((r) => r.no === Number(roundNo));
  if (!round) return '';
  const vehicleId = contract.vehicle || contract.vehicles?.[0];
  const vehicle = vehicleId ? await Vehicle.findById(vehicleId).select('plateNo code').lean() : null;
  const ledger = (vehicleId && await VehicleLedger.findOne({ vehicle: vehicleId }))
    || (vehicle?.plateNo && await VehicleLedger.findOne({ 'header.plateNo': vehicle.plateNo }));
  if (!ledger) return `원장 없음(${vehicle?.plateNo || vehicle?.code || '차량 없음'})`;

  const party = contract.companyId?.name || contract.customer?.name || contract.leaseCompany || '';
  const idx = ledger.entries.findIndex((e) => e.source === 'billing' && String(e.sourceRef) === String(schedule._id) && e.round === round.no);
  const paid = Number(round.paidAmount) || 0;
  if (idx >= 0 && ledger.entries[idx].locked) return `${ledger.ledgerNo} 원장 줄을 사람이 고쳐 두어 그대로 둠`;
  if (!paid) {
    if (idx < 0) return '';
    ledger.entries.splice(idx, 1);
    await ledger.save();
    return `${ledger.ledgerNo} 원장에서 ${round.no}회차 입금 줄을 뺌`;
  }
  const row = {
    side: '입금', group: '고객입금', category: '렌트료',
    label: `${party} 단기렌트료 ${round.no}회차`,
    amount: paid, bank: 'B', date: round.paidAt || round.dueDate, round: round.no, periodSeq: 1,
    source: 'billing', sourceRef: schedule._id, memo: `단기렌트 청구 ${contract.contractNo}`
  };
  if (idx >= 0) Object.assign(ledger.entries[idx], row);
  else ledger.entries.push({ ...row, locked: false });
  await ledger.save();
  return `${ledger.ledgerNo} 원장에 ${round.no}회차 입금 ${paid.toLocaleString()}원을 적음`;
};
