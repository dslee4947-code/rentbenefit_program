import fs from 'fs';
import crypto from 'crypto';
import BillingSchedule from '../models/BillingSchedule.js';
import RentalNotice from '../models/RentalNotice.js';
import Contract from '../models/Contract.js';
import ExcelInvoice from '../models/ExcelInvoice.js';
import Vehicle from '../models/Vehicle.js';
import Company from '../models/Company.js';
import Schedule from '../models/Schedule.js';
import { buildDueDates, resolveFirstDueDate, calcDailyRent, calcLateInterest, daysBetween, calcSendDate } from '../utils/billingDate.js';
import { isHoliday } from '../utils/koreanHolidays.js';
import { saveDocument, findContractDocument, readSavedFile, getDocumentSettings, fillPattern } from '../utils/documentStorageService.js';
import { mimeTypeOf } from '../utils/oneDriveStorage.js';
import { parseHistoryWorkbook, applyHistoryRows } from '../utils/billingHistoryImport.js';
import XLSX from 'xlsx';
import { sendInvoiceMail, sendFineNoticeMail, sendInternalMail } from '../utils/mailService.js';
import { isMaintenanceKind } from '../utils/maintenance.js';
import { noticeKeyOf, findOverdueNotices, upsertNoticeSchedule, collectNotices } from '../utils/fineNoticeScheduleJob.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';

/**
 * 날짜를 YYYY-MM-DD로. Date 객체를 그냥 자르면 'Sun Oct 25 2026...'이 나온다.
 * @param {Date|string} date 대상 날짜
 * @returns {string} YYYY-MM-DD
 */
const formatYmd = (date) => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * 오늘부터 그 날까지 며칠 남았는지. 지났으면 음수.
 * @param {Date|string} date 대상 날짜
 * @returns {number} 남은 일수
 */
const daysUntil = (date) => {
  const today = new Date();
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const d = new Date(date);
  const b = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
};

/**
 * 계약자명을 구한다. 폴더 이름과 파일 이름에 쓰인다.
 *
 * 법인 계약이면 법인명, 개인 계약이면 고객명이다.
 * 법인만 보면 개인 계약자의 서류가 전부 "거래처"라는 한 폴더에 섞인다.
 *
 * @param {object} schedule 회차표 (company, customer, contract가 populate 되어 있어야 한다)
 * @returns {string} 계약자명
 */
const resolvePartyName = (schedule) => schedule?.company?.name
  || schedule?.customer?.name
  || schedule?.contract?.leaseCompany
  || '거래처';


/**
 * 회차 금액을 다시 계산한다.
 *
 * 서류(범칙금 고지서 등)에 금액을 적어 두면 그 합계가 청구 금액이 된다.
 * 한 달에 고지서가 서너 장 오면 사람이 더해 넣다가 틀리는 일이 가장 잦았다.
 * 금액을 적지 않고 서류만 올린 경우에는 손으로 넣은 값을 건드리지 않는다.
 *
 * @param {object} round 회차 (mongoose 서브도큐먼트)
 */
// 고지서 처리 방식과 단계. 모델(BillingSchedule.js)의 enum과 같은 값이라야 한다.
export const NOTICE_HANDLINGS = ['대납청구', '고객납부', '명의변경'];
export const NOTICE_STATUSES = [
  '접수', '안내', '운전자확인', '대납완료', '접수중', '납부완료', '변경완료', '기한초과'
];
const NOTICE_STATUS_MESSAGE = {
  접수: '접수',
  안내: '고객 안내 완료',
  운전자확인: '운전자 확인',
  대납완료: '우리가 대납',
  접수중: '관공서 접수',
  납부완료: '고객이 직접 납부',
  변경완료: '명의 변경 완료',
  기한초과: '기한 초과'
};

const recalcRound = (round) => {
  const atts = round.attachments || [];
  const sumOf = (pick) => atts.filter(pick).reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  const hasAmount = (pick) => atts.some((a) => pick(a) && Number(a.amount) > 0);

  const isMaint = (a) => isMaintenanceKind(a.kind);
  const isFine = (a) => !isMaintenanceKind(a.kind);
  // 우리가 청구하지 않는 고지서는 금액에서 뺀다. 첨부는 그대로 두어 기록은 남긴다.
  //  납부완료 - 고객이 직접 냈다
  //  변경완료 - 명의가 고객에게 넘어가 우리 손을 떠났다
  //  고객납부 - 예전 상태값. 쓰던 데이터를 살린다
  // '있는지'는 상태와 무관하게 보고 '얼마인지'만 걸러야, 모두 빠진 회차에서 예전 금액이 남지 않는다.
  const NOT_BILLED = ['납부완료', '변경완료', '고객납부'];
  const billable = (a) => !NOT_BILLED.includes(a.noticeStatus);

  if (hasAmount(isFine)) round.fine = sumOf((a) => isFine(a) && billable(a));
  if (hasAmount(isMaint)) round.maintenance = sumOf((a) => isMaint(a) && billable(a));

  // 기타 청구는 항목명을 적을 수 있게 배열로 두고, other는 그 합계로 유지한다(청구서 양식·합계식은 그대로).
  if ((round.extras || []).length) {
    round.other = round.extras.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }

  round.total = (round.monthlyRent || 0) + (round.prevUnpaid || 0) + (round.interest || 0)
    + (round.fine || 0) + (round.maintenance || 0) + (round.other || 0) - (round.prevOverpaid || 0);
  return round;
};

/**
 * 연체 이자를 붙이기 전에 기다리는 날수.
 *
 * 고객 통장에서는 결제일(25일 등)에 자동이체로 나가지만, 우리 통장에는 영업일 기준 약 3일 뒤에 들어온다.
 * 그래서 결제일 뒤 15일 안에 들어온 돈은 연체가 아니다(대표님 확인 2026-10-18).
 * 15일이 지나도 안 들어오면 그 금액이 다음 달 청구서에 '전월 미결제'로 넘어가고, 그때 이자를 붙인다.
 * 청구서는 출금일 10일 전에 나가므로(직전 결제일 + 약 20일), 청구서를 만들 때는 늘 이 15일이 지나 있다.
 * 이 값은 화면에서 '미납'을 찍어도 되는 날을 가르는 데 쓴다.
 */
export const LATE_GRACE_DAYS = 15;

/**
 * 직전 회차에서 다음 회차로 넘어가는 돈과, 그중 이자가 붙는 원금.
 *
 * 연체 이자 규칙 (2026-10-18 확정)
 *  - 안 낸 돈은 전부 다음 회차의 '전월 미결제'로 넘어간다(지난번에 붙은 이자도 받을 돈이므로 함께 넘어간다).
 *  - 이자는 그중 원금(렌트료·범칙금·정비·기타)에만 붙는다. 이자에는 이자를 붙이지 않는다.
 *  - 일부만 들어오면 원금부터 갚은 것으로 본다. 엑셀로 청구하던 방식(밀린 달의 렌트료를 오래된 것부터 정리)과 같다.
 *  - 이자는 넘어간 기간(직전 결제일 → 이번 결제일)만큼 한 달치씩. 계속 밀리면 넘어갈 때마다 다시 한 달치.
 *
 * 예전에는 직전 회차 청구액 전체(이자 포함)에 이자를 붙여 달마다 이자에 이자가 쌓였다.
 * 동춘푸드 36회차가 엑셀 4,101,000원(이자 미포함)인데 시스템이 5,606,610원으로 계산한 이유다.
 *
 * 회차 안에 들어 있는 '아직 안 받은 이자'를 첫 회차부터 따라가며 센다. 회차 수가 많아야 60이라 매번 처음부터 센다.
 *
 * @param {Array<object>} rounds 회차표의 회차들 (순서 상관없음)
 * @param {number} no 이번 회차 번호
 * @returns {{carried: number, interestBase: number}} carried: 전월 미결제로 넘어오는 돈, interestBase: 이자가 붙는 원금
 */
export const carryInto = (rounds, no) => {
  const sorted = [...(rounds || [])].sort((a, b) => a.no - b.no);
  let interestIn = 0; // 이 회차의 '전월 미결제' 안에 들어 있는 이자
  let carried = 0;
  let interestBase = 0;
  for (const r of sorted) {
    if (r.no >= no) break;
    const owe = r.status === '미납' ? Math.max(0, (r.total || 0) - (r.paidAmount || 0)) : 0;
    // 이 회차 청구액 안의 이자 = 이번에 붙은 이자 + 앞에서 넘어온 이자. 입금은 원금부터 갚은 것으로 보므로 이자가 남는다.
    const interestPart = Math.min(owe, (r.interest || 0) + Math.min(r.prevUnpaid || 0, interestIn));
    carried = owe;
    interestBase = owe - interestPart;
    interestIn = interestPart;
  }
  return { carried, interestBase };
};

/**
 * 미납이 뒤 회차로 굴러가도록 다시 계산한다.
 *
 * 미납이 여러 달 이어지면 이렇게 쌓인다(월 137만원, 연 20%).
 *   33회차 미납 137만원
 *   34회차 = 렌트료 137만 + 전월 미결제 137만 + 이자(137만 기준 한 달치)
 *   35회차 = 렌트료 137만 + 전월 미결제(34회 안 낸 돈 전부) + 이자(원금 274만 기준 한 달치)
 * 이자는 원금에만 붙는다(carryInto). 한 회차만 고쳐도 뒤가 달라지므로 바뀐 회차부터 끝까지 다시 센다.
 *
 * 이미 발행한 회차는 건드리지 않는다. 보낸 청구서 금액이 나중에 바뀌면 안 되기 때문이다.
 *
 * @param {object} schedule 회차표
 * @param {number} annualRate 연체 이율 (연 %)
 * @param {number} [fromNo] 이 회차 다음부터 다시 센다
 * @returns {number} 값이 바뀐 회차 수
 */
export const applyCarryForward = (schedule, annualRate, fromNo = 0) => {
  const rounds = [...schedule.rounds].sort((a, b) => a.no - b.no);
  let changed = 0;

  for (let i = 1; i < rounds.length; i += 1) {
    const round = rounds[i];
    const prev = rounds[i - 1];
    if (round.no <= fromNo) continue;
    if (round.issuedAt) continue; // 이미 나간 청구서는 그대로 둔다

    const { carried, interestBase } = carryInto(rounds, round.no);
    const days = daysBetween(prev.dueDate, round.dueDate);
    const interest = calcLateInterest({ unpaid: interestBase, annualRate, days });

    const before = round.total;
    round.prevUnpaid = carried;
    round.interest = interest;
    round.interestRate = interest ? annualRate : undefined;
    round.interestDays = interest ? days : undefined;
    recalcRound(round);
    if (round.total !== before) changed += 1;
  }
  return changed;
};

/**
 * 계약별 연체 이율(연 %)을 렌트차량 DB에서 읽어 온다.
 *
 * 계약이 아니라 차량에서 읽는 이유: 사업 초기 20%에서 25%로 바뀌었고 앞으로도 바뀐다.
 * 계약 시점 값을 박아 두면 요율이 바뀔 때마다 과거 계약을 전부 손봐야 한다.
 *
 * @param {Array<string>} contractIds 계약 id 목록
 * @returns {Promise<Map<string, number>>} 계약 id -> 연체 이율
 */
export const loadLateInterestRates = async (contractIds) => {
  const vehicles = await Vehicle.find({ contract: { $in: contractIds } })
    .select('contract lateInterestRate')
    .lean();
  const map = new Map();
  for (const v of vehicles) {
    if (!v.contract || !v.lateInterestRate) continue;
    const key = String(v.contract);
    if (!map.has(key)) map.set(key, v.lateInterestRate); // 같은 계약이면 조건이 같으므로 첫 대를 따른다
  }
  return map;
};

/**
 * 계약 한 건의 회차표를 만들거나 다시 만든다.
 *
 * 이미 청구가 나간 회차는 건드리지 않는다. 계약 조건이 바뀌어 회차표를 다시 만들더라도
 * 이미 보낸 청구서의 금액과 상태가 뒤바뀌면 안 되기 때문이다.
 *
 * @param {string} contractId 계약 id
 * @returns {Promise<object>} 만들어진 회차표
 */
/**
 * 회차표를 만들 수 없는 이유를 코드와 함께 던진다.
 *
 * 사람에게 보여 줄 문구는 그대로 두되, 프로그램이 갈라 볼 수 있는 code를 함께 붙인다.
 * 대시보드는 "완납이라 청구가 필요 없는 계약"과 "출고 준비를 빠뜨린 계약"을 갈라야 하는데,
 * 한글 문구로 비교하면 문구를 다듬는 순간 조용히 어긋난다.
 */
const scheduleError = (code, message) => Object.assign(new Error(message), { code });

export const resolveScheduleInputs = async (contractId) => {
  const contract = await Contract.findById(contractId).lean();
  if (!contract) throw scheduleError('NO_CONTRACT', '계약을 찾을 수 없습니다.');
  // 끝난 계약(연장·반납·인수·중도해지)은 회차표를 다시 만들지 않는다.
  // 반납한 차는 마지막 계약을 가리킨 채 재고로 남는데, 그 차를 저장할 때마다 회차표를 다시 만들면
  // 반납 뒤의 회차가 되살아나 청구 대상에 뜬다.
  if (contract.status === '종료' || contract.status === '중도해지') {
    throw scheduleError('CONTRACT_ENDED', `${contract.status}된 계약이라 회차표를 다시 만들지 않습니다.`);
  }

  const vehicles = await Vehicle.find({ contract: contractId }).lean();
  if (!vehicles.length) throw scheduleError('NO_VEHICLE', '이 계약에 묶인 차량이 없습니다.');

  // 월 렌트료는 계약에 묶인 차량들의 합계다. 청구서에 차량이 여러 줄로 찍히고 합계로 청구된다.
  const monthlyRent = vehicles.reduce((sum, v) => sum + (v.monthlyFee || 0), 0)
    || contract.pricing?.monthlyFee
    || 0;

  // 결제일과 기준일은 계약에 묶인 차량 중 값이 있는 첫 대를 따른다(같은 계약이면 조건이 같다).
  // 출고일은 묶인 차량 중 가장 이른 날을 쓴다. 며칠 늦게 나온 차가 있어도 청구는
  // 먼저 나간 차를 기준으로 시작하고, 늦게 나온 차는 첫 회차에 일할로 붙는다.
  const withDay = vehicles.find((v) => v.monthlyPaymentDay) || vehicles[0];
  const paymentDay = withDay?.monthlyPaymentDay || '';
  const rentStartDate = withDay?.rentBillingDate;
  const deliveryDate = vehicles
    .map((v) => v.deliveryDate)
    .filter(Boolean)
    .sort((a, b) => new Date(a) - new Date(b))[0] || contract.deliveryDate || contract.contractDate;

  if (!paymentDay) throw scheduleError('NO_PAYMENT_DAY', '월 대여료 결제일이 정해지지 않았습니다. 출고 준비에서 먼저 지정해 주세요.');
  if (!rentStartDate && !deliveryDate) throw scheduleError('NO_DATE', '렌트료 개시일 또는 인도일이 없어 청구일을 정할 수 없습니다.');

  const totalRounds = contract.termMonths || vehicles[0]?.paymentTerm || 0;
  if (!totalRounds) throw scheduleError('NO_TERM', '계약 기간이 없어 회차를 만들 수 없습니다.');

  // 렌트료를 완납해서 매달 받을 돈이 없는 계약이 있다. 0원짜리 청구서를 매달 만들어 두면
  // 청구 대상 목록에 계속 뜨면서 실제로 보낼 건과 섞인다.
  if (!monthlyRent) throw scheduleError('NO_RENT', '월 렌트료가 0원이라 회차표를 만들지 않았습니다. (완납 등 청구가 필요 없는 계약)');

  // 1회차 출금일은 계약일보다 앞설 수 없다. 앞선다면 계약일이나 렌트료 개시일을 잘못 넣은 것이다.
  // 그대로 만들면 계약도 하기 전의 렌트료를 청구하게 되므로, 회차표를 만들지 않고 고치라고 알린다.
  // (2026-09-27 운영 DB 85건 중 이런 계약은 0건이었다)
  const firstDue = resolveFirstDueDate({ rentStartDate, deliveryDate, paymentDay });
  const dayOf = (d) => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
  if (firstDue && contract.contractDate && dayOf(firstDue) < dayOf(contract.contractDate)) {
    throw scheduleError(
      'FIRST_DUE_BEFORE_CONTRACT',
      `1회차 출금일(${formatYmd(firstDue)})이 계약일(${formatYmd(contract.contractDate)})보다 앞섭니다. `
      + '계약일을 1회차 출금일 이전으로 고치거나, 렌트료 개시일·결제일을 확인해 주세요.'
    );
  }

  return { contract, monthlyRent, paymentDay, rentStartDate, deliveryDate, totalRounds };
};

export const buildScheduleForContract = async (contractId) => {
  const { contract, monthlyRent, paymentDay, rentStartDate, deliveryDate, totalRounds } = await resolveScheduleInputs(contractId);

  const dueDates = buildDueDates({ rentStartDate, deliveryDate, paymentDay, totalRounds });

  const existing = await BillingSchedule.findOne({ contract: contractId });
  const keptByNo = new Map();
  if (existing) {
    // 이미 청구가 나갔거나 입금된 회차는 그대로 둔다
    existing.rounds
      .filter((r) => r.status !== '예정')
      .forEach((r) => keptByNo.set(r.no, r));
  }

  const rounds = dueDates.map((dueDate, index) => {
    const no = index + 1;
    const kept = keptByNo.get(no);
    if (kept) return kept;
    return {
      no,
      dueDate,
      monthlyRent,
      total: monthlyRent,
      status: '예정'
    };
  });

  const payload = {
    contract: contractId,
    company: contract.companyId || undefined,
    customer: contract.customer,
    totalRounds,
    monthlyRent,
    dailyRent: calcDailyRent(monthlyRent),
    paymentDay,
    baseDate: rentStartDate || deliveryDate,
    rounds
  };

  return BillingSchedule.findOneAndUpdate(
    { contract: contractId },
    payload,
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

// @desc    계약의 회차표를 만들거나 다시 만든다
// @route   POST /api/billing-schedules/generate/:contractId
export const generateSchedule = async (req, res) => {
  try {
    const schedule = await buildScheduleForContract(req.params.contractId);
    res.json({ success: true, schedule, message: `${schedule.rounds.length}회차가 만들어졌습니다.` });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// @desc    계약의 회차표를 가져온다
// @route   GET /api/billing-schedules/contract/:contractId
export const getScheduleByContract = async (req, res) => {
  try {
    const schedule = await BillingSchedule.findOne({ contract: req.params.contractId })
      .populate('company', 'name bizNo ceoName billingEmail bank')
      .populate('customer', 'name contactName contactPhone email bank')
      .lean();
    if (!schedule) {
      return res.status(404).json({ success: false, message: '회차표가 아직 없습니다.' });
    }
    const contract = await Contract.findById(req.params.contractId).select('termMonths').lean();
    const found = await Vehicle.find({ contract: req.params.contractId })
      .select('code carModel plateNo monthlyFee deliveryDate advancePayment paymentTerm banking')
      .lean();
    // 선납금은 차량마다 '선납금 ÷ 개월 수'씩 월 렌트료에서 빠진다(계약서 조건). 개월 수는 차량 값,
    // 없으면 계약기간, 그것도 없으면 회차표의 회차 수(일할 회차가 끼면 하나 많을 수 있다)를 쓴다. 청구서가 차감액·잔액을 그릴 때 쓴다(advancePayment.js).
    const vehicles = found.map((v) => ({ ...v, advanceMonths: Number(v.paymentTerm) || Number(contract?.termMonths) || schedule.totalRounds || 0 }));
    // 엑셀로 보냈던 청구서 기록(드롭박스에서 읽어 넣은 것). 보관함이 회차 옆에 함께 보여 준다
    const excelInvoices = await ExcelInvoice.find({ schedule: schedule._id }).select('-__v').lean();
    res.json({ success: true, schedule, vehicles, excelInvoices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 특정 달에 청구할 회차만 뽑아 준다.
 *
 * 회차를 사람이 고르지 않고 청구일로 정한다. 엑셀에서 회차를 손으로 넣다 틀리는 일이 가장 잦았다.
 *
 * @route GET /api/billing-schedules/due?month=YYYY-MM
 */
export const getDueRounds = async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const [year, mon] = month.split('-').map(Number);
    if (!year || !mon) {
      return res.status(400).json({ success: false, message: '조회할 달을 YYYY-MM 형식으로 주세요.' });
    }
    const from = new Date(year, mon - 1, 1);
    const to = new Date(year, mon, 1);

    const schedules = await BillingSchedule.find({ 'rounds.dueDate': { $gte: from, $lt: to } })
      .populate('contract', 'contractNo termMonths terms')
      .populate('company', 'name bizNo billingEmail')
      .populate('customer', 'name contactName')
      .lean();

    // 연체 이율은 렌트차량 DB의 현재 값을 쓴다(요율이 바뀌면 다음 청구부터 바로 반영된다).
    const rateByContract = await loadLateInterestRates(
      schedules.map((s) => s.contract?._id).filter(Boolean)
    );

    const items = [];
    for (const s of schedules) {
      const round = s.rounds.find((r) => r.dueDate >= from && r.dueDate < to);
      if (!round) continue;

      // 전월(직전 회차) 상황. 화면에서 미결제를 한 번에 체크할 수 있게 같이 내려 준다.
      const prev = s.rounds.find((r) => r.no === round.no - 1) || null;
      // 넘어오는 돈 전부(unpaid)와 그중 이자가 붙는 원금(interestBase). 이자에는 이자를 붙이지 않는다.
      const { carried: unpaid, interestBase } = carryInto(s.rounds, round.no);
      const lateInterestRate = rateByContract.get(String(s.contract?._id))
        || s.contract?.terms?.lateInterestRate
        || 0;
      const overdueDays = prev ? daysBetween(prev.dueDate, round.dueDate) : 0;

      const sendDate = calcSendDate(round.dueDate);

      // 이번 회차의 입금 상황. 목록에서 바로 처리할 수 있게 함께 준다.
      const thisUnpaid = round.status === '미납'
        ? Math.max(0, (round.total || 0) - (round.paidAmount || 0))
        : 0;

      items.push({
        scheduleId: s._id,
        contract: s.contract,
        company: s.company,
        customer: s.customer,
        totalRounds: s.totalRounds,
        monthlyRent: s.monthlyRent,
        dailyRent: s.dailyRent,
        proration: s.proration,
        lateInterestRate,
        unpaid: thisUnpaid,
        // 출금일 10일 전이 발송일. 오늘 기준으로 며칠 남았는지 함께 준다.
        sendDate,
        sendDday: sendDate ? daysUntil(sendDate) : null,
        // 전월 미결제로 체크해 두면 이번 회차에 미수금과 연체 이자가 자동으로 채워진다
        prevRound: prev ? {
          no: prev.no,
          dueDate: prev.dueDate,
          status: prev.status,
          total: prev.total || 0,
          paidAmount: prev.paidAmount || 0,
          unpaid
        } : null,
        overdueDays,
        suggestedInterest: calcLateInterest({ unpaid: interestBase, annualRate: lateInterestRate, days: overdueDays }),
        round
      });
    }

    // 출금일 순으로 보고, 같은 날이면 계약자 가나다순. 계약번호는 외우기 어려워 이름으로 찾는다.
    const nameOf = (it) => it.company?.name || it.customer?.name || '';
    items.sort((a, b) => {
      const gap = new Date(a.round.dueDate) - new Date(b.round.dueDate);
      return gap !== 0 ? gap : nameOf(a).localeCompare(nameOf(b), 'ko');
    });
    res.json({ success: true, month, count: items.length, items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 청구서를 넣을 계약 폴더 이름. 계약을 만들 때 정해 둔 "계약번호_차종"을 그대로 쓴다.
 * 여기서 다시 만들면 차종을 고쳤을 때 폴더가 갈려 이미 보낸 청구서를 못 찾는다.
 */
const invoiceFolderOf = (schedule) => schedule.contract?.docFolderName || schedule.contract?.contractNo || '계약번호미상';

/**
 * 청구서 파일명. 규칙은 설정 화면에서 바꿀 수 있다.
 * 화면 발행과 자동 발송 승인이 같은 이름을 써야 같은 파일을 가리킨다.
 */
const invoiceFileNameOf = async (partyName, round) => {
  const settings = await getDocumentSettings();
  return `${fillPattern(settings.fileNames.invoice, {
    법인명: partyName,
    계약자: partyName, // 예전 설정이 {계약자}를 쓰고 있어도 그대로 채워지게 둔다
    회차: round.no,
    날짜: new Date().toISOString().slice(0, 10)
  })}.pdf`;
};

/**
 * 저장해 둔 청구서를 메일로 보내고 회차를 '청구됨'으로 바꾼다.
 *
 * 화면의 [발행]과 아침 자동 발송이 함께 쓴다. 두 길이 따로 놀면 한쪽만 서류 첨부나
 * 캘린더 정리를 빠뜨리게 된다.
 *
 * 메일이 실패해도 상태 갱신은 되돌리지 않는다. 파일은 이미 남았고 메일만 다시 보내면 된다.
 *
 * @returns {Promise<{mailResult: object|null, mailError: string|null}>}
 */
const deliverInvoice = async ({ schedule, round, partyName, fileName, pdfBuffer, saved, to, sendEmail, req, user }) => {
  let mailResult = null;
  let mailError = null;
  if (sendEmail) {
    try {
      // 이 회차에 올려 둔 서류를 함께 붙인다. 파일이 사라졌으면 그 건만 건너뛴다.
      const extraFiles = [];
      for (const att of round.attachments || []) {
        const buffer = await readSavedFile(att.savedPath);
        if (buffer) extraFiles.push({ fileName: att.fileName, buffer });
      }

      // 제목·본문은 화면에서 고친 양식을 쓰고, 아래 값들로 {{계약자}} 같은 자리를 채운다
      mailResult = await sendInvoiceMail({
        to,
        fileName,
        fileBuffer: pdfBuffer,
        extraFiles,
        values: {
          계약자: partyName,
          계약번호: schedule.contract?.contractNo || '',
          회차: round.no,
          총회차: schedule.totalRounds,
          출금일: formatYmd(round.dueDate),
          청구액: `${Number(round.total || 0).toLocaleString()}원`
        }
      });
    } catch (err) {
      mailError = err.message;
    }
  }

  round.status = round.status === '입금완료' ? round.status : '청구됨';
  round.issuedAt = new Date();
  round.invoiceFileName = saved.fileName;
  round.invoiceSavedPath = saved.localPath;
  if (mailResult) round.sentAt = new Date();
  await schedule.save();

  const logTarget = { model: 'BillingSchedule', id: schedule._id };
  const logMeta = { round: round.no, amount: round.total || 0, contractNo: schedule.contract?.contractNo };
  logActivity({
    req, user, dept: '청구부', action: ACTIONS.INVOICE_ISSUE, target: logTarget, meta: logMeta,
    summary: `${partyName} ${round.no}회차 청구서 발행`
  });
  if (mailResult) {
    logActivity({
      req, user, dept: '청구부', action: ACTIONS.INVOICE_SEND, target: logTarget, meta: { ...logMeta, to: mailResult.to },
      summary: `${partyName} ${round.no}회차 청구서 메일 발송`
    });
  }

  // 캘린더에 잡아 둔 발송 일정을 끝난 것으로 바꾼다. 보낸 건이 알림에 계속 남으면 안 된다.
  // 여기서 실패해도 청구서는 이미 나갔다. 실패로 알리면 담당자가 다시 보내 고객이 두 번 받는다.
  try {
    await Schedule.updateMany(
      { type: '청구서발송', targetContract: schedule.contract?._id, status: '예정', dueDate: { $lte: round.dueDate } },
      { status: '완료' }
    );
  } catch (err) {
    console.error('[청구서 발송] 캘린더 정리 실패:', err.message);
  }

  return { mailResult, mailError };
};

/**
 * 승인할 때의 청구 내용 지문.
 *
 * 금액 항목, 기타 청구, 붙은 서류(지문·금액·처리 상태), 받는 주소를 묶는다.
 * 승인 뒤 고지서가 하나 더 붙거나 전월 미결제가 바뀌면 지문이 달라져 자동 발송이 멈춘다.
 */
const roundSnapshot = (round, to, context = {}) => crypto.createHash('sha256').update(JSON.stringify({
  amounts: ['monthlyRent', 'prevUnpaid', 'prevOverpaid', 'interest', 'fine', 'maintenance', 'other', 'total']
    .map((k) => Number(round[k]) || 0),
  extras: (round.extras || []).map((e) => [e.label, Number(e.amount) || 0]),
  attachments: (round.attachments || []).map((a) => [a.fileHash || a.fileName, Number(a.amount) || 0, a.noticeStatus || '']),
  // 청구서에 찍히는 나머지 값. 금액이 같아도 이것이 바뀌면 담당자가 본 청구서와 다르다
  note: round.note || '',
  interestRate: Number(round.interestRate) || 0,
  interestDays: Number(round.interestDays) || 0,
  dueDate: formatYmd(round.dueDate),
  party: context.partyName || '',
  vehicles: context.vehicles || [],
  to: String(to || '').trim().toLowerCase()
})).digest('hex');

/**
 * 지문에 넣을 계약자명과 차량 표. 청구서 아래 차량 표가 이 값으로 그려진다.
 * @returns {Promise<{partyName: string, vehicles: Array}>}
 */
const snapshotContextOf = async (schedule) => {
  const contractId = schedule.contract?._id || schedule.contract;
  const vehicles = contractId
    ? await Vehicle.find({ contract: contractId }).select('plateNo carModel monthlyFee advancePayment paymentTerm').sort({ _id: 1 }).lean()
    : [];
  return {
    partyName: resolvePartyName(schedule),
    // 선납금·개월 수가 바뀌면 청구서의 선납금 차감·잔액 줄이 달라진다. 승인 뒤 바뀌면 보내지 않게 함께 넣는다
    vehicles: vehicles.map((v) => [v.plateNo || '', v.carModel || '', Number(v.monthlyFee) || 0, Number(v.advancePayment) || 0, Number(v.paymentTerm) || 0])
  };
};

/** 회차가 아직 보낼 수 있는 상태인지. 이미 발행했거나 입금이 끝났으면 자동 발송 대상이 아니다. */
const isSendable = (round) => !round.issuedAt && round.status === '예정';

/** 날짜만 비교한다(시각은 버린다). */
const dayKey = (d) => {
  const x = new Date(d);
  return x.getFullYear() * 10000 + (x.getMonth() + 1) * 100 + x.getDate();
};

/**
 * 이번 회차가 평소(월 렌트료만 청구)와 무엇이 다른지 항목으로 뽑는다.
 *
 * 매달 나가는 청구서 대부분은 렌트료만 있는 똑같은 청구서다. 담당자가 70장을 하나하나 열어 보면
 * 정작 봐야 할 몇 장(과태료가 붙었거나 미납이 이월된 건)을 놓친다. 다른 점만 보여 주고,
 * 다른 점이 없는 건은 한꺼번에 승인하게 한다.
 *
 * 금액은 청구서 화면이 회차를 열 때와 같은 규칙으로 낸다(저장된 값이 없으면 이월 미수금·연체 이자 제안값).
 */
const reviewOf = ({ round, schedule, unpaid, suggestedInterest }) => {
  const prevUnpaid = round.prevUnpaid || unpaid || 0;
  const interest = round.interest || suggestedInterest || 0;
  const changes = [];
  const rentGap = (round.monthlyRent || 0) - (schedule.monthlyRent || 0);
  if (rentGap) changes.push({ key: 'rent', label: rentGap < 0 ? '렌트료 일할·감액' : '렌트료 변동', amount: rentGap });
  if (prevUnpaid) changes.push({ key: 'unpaid', label: '전월 미결제', amount: prevUnpaid });
  if (interest) changes.push({ key: 'interest', label: '연체 이자', amount: interest });
  const fines = (round.attachments || []).filter((a) => !isMaintenanceKind(a.kind) && Number(a.amount) > 0
    && !['납부완료', '변경완료', '고객납부'].includes(a.noticeStatus));
  if (round.fine) changes.push({ key: 'fine', label: fines.length ? `범칙금·과태료 ${fines.length}건` : '범칙금·과태료', amount: round.fine });
  // 금액이 없는 서류도 청구서와 함께 메일로 나간다. 무엇이 붙어 나가는지 사람이 봐야 한다.
  const docsWithoutAmount = (round.attachments || []).filter((a) => !(Number(a.amount) > 0)).length;
  if (docsWithoutAmount) changes.push({ key: 'docs', label: `첨부 서류 ${docsWithoutAmount}건`, amount: 0 });
  if (round.maintenance) changes.push({ key: 'maintenance', label: '정비 비용', amount: round.maintenance });
  if (round.other) {
    const names = (round.extras || []).map((e) => e.label).filter(Boolean).join(', ');
    changes.push({ key: 'other', label: names ? `기타 (${names})` : '기타 청구', amount: round.other });
  }
  if (round.prevOverpaid) changes.push({ key: 'overpaid', label: '전월 초과 입금 차감', amount: -round.prevOverpaid });
  if ((round.note || '').trim()) changes.push({ key: 'note', label: '메모 있음', amount: 0 });

  const expectedTotal = (round.monthlyRent || 0) + prevUnpaid + interest
    + (round.fine || 0) + (round.maintenance || 0) + (round.other || 0) - (round.prevOverpaid || 0);
  return { changes, expectedTotal };
};

/**
 * 자동 발송 목록. 오늘부터 며칠 안에 보낼 청구서와, 발송일이 지났는데 아직 안 나간 청구서.
 *
 * 화면은 이 목록을 보고 회차마다 PDF를 만들어 [승인]한다. 금액 계산(전월 미결제·연체 이자 제안)이
 * 청구 대상 화면과 같아야 해서, 청구 대상 목록(getDueRounds)과 같은 모양으로 내려 준다.
 *
 * @route GET /api/billing-schedules/auto-send/queue?days=7
 */
export const getAutoSendQueue = async (req, res) => {
  try {
    const days = Math.min(31, Math.max(1, Number(req.query.days) || 7));
    const items = await buildAutoSendQueue(days);
    res.json({ success: true, days, count: items.length, items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 자동 발송 목록을 만든다. 화면(getAutoSendQueue)과 오후 알림(sendApprovalReminder)이 함께 쓴다.
 * 알림이 조용히 빠지지 않도록 실패하면 예외를 그대로 던진다.
 *
 * @param {number} days 앞으로 며칠 안에 보낼 것까지
 * @returns {Promise<object[]>}
 */
const buildAutoSendQueue = async (days) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + days);
  // 발송일은 출금일 10일 전(휴일이면 더 앞)이다. 출금일 기준으로 넉넉히 잡아 거른 뒤 발송일로 다시 거른다.
  const dueUntil = new Date(horizon);
  dueUntil.setDate(dueUntil.getDate() + 20);
  // 출금일이 이미 지난 회차는 넣지 않는다. 엑셀로 관리하던 시절에 보내 놓고 시스템에는 '예정'으로 남은 회차가
  // 많아서(2026-10 기준 100건 넘게), 넣으면 이미 보낸 청구서를 또 보내게 된다.
  // 발송일은 지났지만 출금일 전인 회차는 '놓친 건'으로 보여 준다.
  const dueFrom = today;

  const schedules = await BillingSchedule.find({ rounds: { $elemMatch: { dueDate: { $gte: dueFrom, $lt: dueUntil }, status: '예정' } } })
    .populate('contract', 'contractNo termMonths terms')
    .populate('company', 'name bizNo billingEmail')
    .populate('customer', 'name contactName email')
    .lean();
  const rateByContract = await loadLateInterestRates(schedules.map((s) => s.contract?._id).filter(Boolean));

  const items = [];
  for (const s of schedules) {
    for (const round of s.rounds) {
      if (round.dueDate < dueFrom || round.dueDate >= dueUntil) continue;
      // 보낼 수 있는 회차, 그리고 자동 발송이 걸려 있던 회차(보냄·실패·확인 필요)는 결과가 보여야 한다
      if (!isSendable(round) && !round.autoSend?.status) continue;
      const sendDate = calcSendDate(round.dueDate);
      if (!sendDate || dayKey(sendDate) > dayKey(horizon)) continue;

      const prev = s.rounds.find((r) => r.no === round.no - 1) || null;
      const { carried: unpaid, interestBase } = carryInto(s.rounds, round.no);
      const lateInterestRate = rateByContract.get(String(s.contract?._id)) || s.contract?.terms?.lateInterestRate || 0;
      const overdueDays = prev ? daysBetween(prev.dueDate, round.dueDate) : 0;
      const to = round.autoSend?.to || s.company?.billingEmail || s.customer?.email || '';

      // 승인했어도 그 뒤 내용이 바뀌었으면 화면에 '다시 승인'으로 보여 준다
      let autoStatus = round.autoSend?.status || '';
      if (autoStatus === '승인' || autoStatus === '대표승인대기') {
        const context = await snapshotContextOf(s);
        if (round.autoSend.snapshot !== roundSnapshot(round, round.autoSend.to, context)) autoStatus = '변경됨';
      }

      const suggestedInterest = calcLateInterest({ unpaid: interestBase, annualRate: lateInterestRate, days: overdueDays });
      const review = reviewOf({ round, schedule: s, unpaid, suggestedInterest });

      items.push({
        scheduleId: s._id,
        contract: s.contract,
        company: s.company,
        customer: s.customer,
        totalRounds: s.totalRounds,
        proration: s.proration,
        lateInterestRate,
        // 평소(월 렌트료만)와 무엇이 다른지. 담당자는 이것만 보고 확인할 건을 고른다
        changes: review.changes,
        routine: review.changes.length === 0,
        expectedTotal: review.expectedTotal,
        sendDate,
        sendDday: daysUntil(sendDate),
        prevRound: prev ? { no: prev.no, dueDate: prev.dueDate, status: prev.status, total: prev.total || 0, paidAmount: prev.paidAmount || 0, unpaid } : null,
        overdueDays,
        suggestedInterest,
        defaultTo: to,
        autoStatus,
        issued: Boolean(round.issuedAt),
        round
      });
    }
  }

  const nameOf = (it) => it.company?.name || it.customer?.name || '';
  items.sort((a, b) => (new Date(a.sendDate) - new Date(b.sendDate)) || nameOf(a).localeCompare(nameOf(b), 'ko'));
  return items;
};

/**
 * 이 회차가 '평소와 같은'(월 렌트료만 있는) 청구서인지. 발송 센터 목록과 같은 기준(reviewOf)으로 본다.
 * 달라진 청구서는 직원 확인 뒤 대표 승인까지 받아야 나간다(대표님 지시 2026-10-19).
 *
 * @param {object} schedule 회차표 (contract가 populate된 것)
 * @param {object} round 회차
 * @returns {Promise<boolean>}
 */
const isRoutineRound = async (schedule, round) => {
  const contractId = schedule.contract?._id || schedule.contract;
  const rate = (await loadLateInterestRates([contractId])).get(String(contractId)) || 0;
  const prev = schedule.rounds.find((r) => r.no === round.no - 1) || null;
  const { carried: unpaid, interestBase } = carryInto(schedule.rounds, round.no);
  const days = prev ? daysBetween(prev.dueDate, round.dueDate) : 0;
  const suggestedInterest = calcLateInterest({ unpaid: interestBase, annualRate: rate, days });
  return reviewOf({ round, schedule, unpaid, suggestedInterest }).changes.length === 0;
};

/**
 * 자동 발송을 승인한다. 화면에서 만든 청구서 PDF를 받아 청구서 폴더에 저장하고, 발송일 아침에 보낸다.
 *
 * 승인만으로는 고객에게 아무것도 나가지 않는다. 회차 상태도 '예정' 그대로다.
 *
 * @route POST /api/billing-schedules/:id/rounds/:no/auto-send (multipart: file, to)
 */
export const approveAutoSend = async (req, res) => {
  try {
    const schedule = await BillingSchedule.findById(req.params.id)
      .populate('company', 'name billingEmail folderName')
      .populate('customer', 'name')
      .populate('contract', 'contractNo docFolderName leaseCompany');
    if (!schedule) return res.status(404).json({ success: false, message: '회차표를 찾을 수 없습니다.' });
    const round = schedule.rounds.find((r) => r.no === Number(req.params.no));
    if (!round) return res.status(404).json({ success: false, message: '해당 회차가 없습니다.' });
    if (!isSendable(round)) return res.status(400).json({ success: false, message: '이미 발행했거나 입금이 끝난 회차입니다.' });
    if (!req.file) return res.status(400).json({ success: false, message: '청구서 PDF가 없습니다.' });

    const to = String(req.body.to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ success: false, message: '받는 사람 이메일이 없거나 형식이 맞지 않습니다.' });
    }
    // 화면이 PDF에 그린 청구액과 지금 저장된 청구액이 같아야 한다. 그사이 입금·이월이 바뀌었으면
    // PDF와 메일 본문의 금액이 서로 달라진다.
    if (req.body.expectedTotal !== undefined && Number(req.body.expectedTotal) !== Number(round.total || 0)) {
      return res.status(409).json({
        success: false,
        message: `청구액이 그사이 바뀌었습니다(화면 ${Number(req.body.expectedTotal).toLocaleString()}원 · 저장 ${Number(round.total || 0).toLocaleString()}원). 새로고침 후 다시 승인해 주세요.`
      });
    }
    if (['발송중', '발송완료'].includes(round.autoSend?.status)) {
      return res.status(409).json({ success: false, message: '이미 보내는 중이거나 보낸 청구서입니다.' });
    }

    const partyName = resolvePartyName(schedule);
    const fileName = await invoiceFileNameOf(partyName, round);
    // 다시 승인하면 같은 이름으로 덮어쓴다. 아직 고객에게 나가지 않은 파일이다.
    const saved = await saveDocument({
      partyName,
      kind: 'invoice',
      subFolder: invoiceFolderOf(schedule),
      fileName,
      fileBuffer: req.file.buffer
    });

    // 달라진 청구서는 대표(관리자)가 승인해야 나간다. 직원이 누르면 '확인'까지만 하고 대표 승인을 기다린다.
    // 대표가 직접 연 건은 대표 승인 한 번으로 끝난다.
    const who = req.user?.name || req.user?.email || '';
    const isCeo = req.user?.role === 'admin';
    const waitCeo = !isCeo && !(await isRoutineRound(schedule, round));
    const checked = round.autoSend?.status === '대표승인대기' ? round.autoSend : null;

    round.autoSend = {
      status: waitCeo ? '대표승인대기' : '승인',
      approvedAt: waitCeo ? undefined : new Date(),
      approvedBy: waitCeo ? '' : who,
      checkedBy: waitCeo ? who : (checked?.checkedBy || ''),
      checkedAt: waitCeo ? new Date() : checked?.checkedAt,
      to,
      snapshot: roundSnapshot(round, to, await snapshotContextOf(schedule)),
      pdfFileName: saved.fileName,
      pdfSavedPath: saved.localPath,
      pdfHash: crypto.createHash('sha256').update(req.file.buffer).digest('hex'),
      message: ''
    };
    await schedule.save();

    res.json({
      success: true,
      autoSend: round.autoSend,
      waitCeo,
      message: waitCeo
        ? `${partyName} ${round.no}회차를 확인했습니다. 대표님이 승인하시면 ${formatYmd(calcSendDate(round.dueDate))} 아침에 보냅니다.`
        : `${partyName} ${round.no}회차를 승인했습니다. ${formatYmd(calcSendDate(round.dueDate))} 아침에 ${to}로 보냅니다.`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 시험 메일. 화면에서 만든 청구서 PDF를 시험 주소로만 보낸다.
 *
 * 회차 상태·발행 기록·자동 발송 승인은 하나도 바꾸지 않는다. 실제 고객에게 보내기 전에
 * 메일 제목·본문·첨부·PDF 모양을 확인하는 용도다. 받는 주소를 실수로 고객 주소로 넣지 않도록
 * 계약에 등록된 청구 메일 주소로는 보내지 않는다.
 *
 * @route POST /api/billing-schedules/:id/rounds/:no/test-send (multipart: file, to)
 */
export const testSendInvoice = async (req, res) => {
  try {
    const schedule = await BillingSchedule.findById(req.params.id)
      .populate('company', 'name billingEmail')
      .populate('customer', 'name email')
      .populate('contract', 'contractNo docFolderName leaseCompany');
    if (!schedule) return res.status(404).json({ success: false, message: '회차표를 찾을 수 없습니다.' });
    const round = schedule.rounds.find((r) => r.no === Number(req.params.no));
    if (!round) return res.status(404).json({ success: false, message: '해당 회차가 없습니다.' });
    if (!req.file) return res.status(400).json({ success: false, message: '청구서 PDF가 없습니다.' });

    const to = String(req.body.to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ success: false, message: '시험 메일 주소를 확인해 주세요.' });
    // 실제 발송 때 승인한 주소(직원이 손으로 넣은 고객 주소일 수 있다)도 막는다
    const customerMails = [schedule.company?.billingEmail, schedule.customer?.email, round.autoSend?.to].filter(Boolean).map((m) => m.toLowerCase());
    if (customerMails.includes(to.toLowerCase())) {
      return res.status(400).json({ success: false, message: '고객 주소로는 시험 메일을 보낼 수 없습니다. 회사 시험 주소를 넣어 주세요.' });
    }

    const extraFiles = [];
    for (const att of round.attachments || []) {
      const buffer = await readSavedFile(att.savedPath);
      if (buffer) extraFiles.push({ fileName: att.fileName, buffer });
    }
    const partyName = resolvePartyName(schedule);
    const fileName = await invoiceFileNameOf(partyName, round);
    const mail = await sendInvoiceMail({
      to,
      fileName,
      fileBuffer: req.file.buffer,
      extraFiles,
      values: {
        계약자: partyName,
        계약번호: schedule.contract?.contractNo || '',
        회차: round.no,
        총회차: schedule.totalRounds,
        출금일: formatYmd(round.dueDate),
        // 시험은 저장하지 않고 화면 계산값으로 PDF를 만든다. 본문 금액도 PDF와 같게 화면 값을 쓴다.
        청구액: `${Number(req.body.total ?? round.total ?? 0).toLocaleString()}원`
      }
    });
    // 보낸편지함을 볼 권한이 없어도 무엇을 보냈는지 서버 기록으로 되짚을 수 있게 남긴다
    console.log(`[시험 메일] ${partyName} ${round.no}회차 → ${mail.to}`);
    res.json({ success: true, message: `시험 메일을 ${mail.to}로 보냈습니다. 회차 상태는 바뀌지 않았습니다.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 승인을 취소한다. 저장해 둔 PDF는 지우지 않는다(다시 승인하면 덮어쓴다).
 *
 * @route DELETE /api/billing-schedules/:id/rounds/:no/auto-send
 */
export const cancelAutoSend = async (req, res) => {
  try {
    const schedule = await BillingSchedule.findById(req.params.id);
    if (!schedule) return res.status(404).json({ success: false, message: '회차표를 찾을 수 없습니다.' });
    const round = schedule.rounds.find((r) => r.no === Number(req.params.no));
    if (!round) return res.status(404).json({ success: false, message: '해당 회차가 없습니다.' });
    if (['발송중', '발송완료'].includes(round.autoSend?.status)) {
      return res.status(400).json({ success: false, message: '이미 보내는 중이거나 보낸 청구서입니다.' });
    }
    round.autoSend = undefined;
    await schedule.save();
    res.json({ success: true, message: '자동 발송 승인을 취소했습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 승인된 청구서 중 발송일이 된 것을 보낸다. 매일 아침 정기 작업과 화면의 [지금 보내기]가 부른다.
 *
 * 보내기 직전에 지문을 다시 본다. 승인 뒤 금액·서류·주소가 바뀌었으면 보내지 않고 '변경됨'으로 남긴다.
 * 담당자가 확인한 것과 다른 청구서가 고객에게 나가면 되돌릴 수 없다.
 *
 * @param {object} [options]
 * @param {object} [options.user] 화면에서 눌렀을 때 누른 사람. 정기 작업이면 비워 둔다('시스템')
 * @param {string} [options.scheduleId] 이 회차표만 처리한다 (화면에서 한 건만 보낼 때)
 * @param {number} [options.roundNo]
 * @param {boolean} [options.ignoreSendDate] 발송일 전이어도 보낸다 (한 건을 지금 보낼 때)
 * @returns {Promise<{sent: number, held: number, failed: number, results: object[]}>}
 */
export const runAutoSend = async ({ user, scheduleId, roundNo, ignoreSendDate = false } = {}) => {
  // 아침 정기 작업과 화면의 [지금 보내기]가 겹치면 같은 청구서가 두 번 나간다. 한 번에 하나만 돈다.
  if (autoSendRunning) return { sent: 0, held: 0, failed: 0, results: [], busy: true };
  autoSendRunning = true;
  try {
    return await sendApprovedInvoices({ user, scheduleId, roundNo, ignoreSendDate });
  } finally {
    autoSendRunning = false;
  }
};

let autoSendRunning = false;

const sendApprovedInvoices = async ({ user, scheduleId, roundNo, ignoreSendDate }) => {
  const today = dayKey(new Date());
  const filter = { 'rounds.autoSend.status': '승인' };
  if (scheduleId) filter._id = scheduleId;
  const schedules = await BillingSchedule.find(filter)
    .populate('company', 'name billingEmail folderName')
    .populate('customer', 'name')
    .populate('contract', 'contractNo docFolderName leaseCompany');

  const results = [];
  for (const schedule of schedules) {
    const partyName = resolvePartyName(schedule);
    const context = await snapshotContextOf(schedule);
    for (const round of schedule.rounds) {
      if (round.autoSend?.status !== '승인') continue;
      if (roundNo && round.no !== Number(roundNo)) continue;
      if (!ignoreSendDate && dayKey(calcSendDate(round.dueDate)) > today) continue;

      const record = { partyName, roundNo: round.no, to: round.autoSend.to };
      // 상태를 남긴다. 저장이 실패해도 다음 회차는 계속 처리한다.
      const hold = async (status, message) => {
        round.autoSend.status = status;
        round.autoSend.message = message;
        try { await schedule.save(); } catch (err) { console.error('[청구서 자동 발송] 상태 저장 실패:', err.message); }
        results.push({ ...record, status, message });
      };

      if (!isSendable(round)) { await hold('변경됨', '그사이 화면에서 발행했거나 입금이 끝난 회차입니다.'); continue; }
      if (dayKey(round.dueDate) < today) { await hold('변경됨', '출금일이 이미 지났습니다. 청구서 화면에서 확인해 주세요.'); continue; }
      if (round.autoSend.snapshot !== roundSnapshot(round, round.autoSend.to, context)) {
        await hold('변경됨', '승인한 뒤 금액·서류·받는 주소·차량이 바뀌었습니다. 다시 확인하고 승인해 주세요.');
        continue;
      }
      const pdfBuffer = await readSavedFile(round.autoSend.pdfSavedPath);
      if (!pdfBuffer) { await hold('실패', '승인할 때 저장한 청구서 PDF를 찾지 못했습니다. 다시 승인해 주세요.'); continue; }
      if (round.autoSend.pdfHash
          && crypto.createHash('sha256').update(pdfBuffer).digest('hex') !== round.autoSend.pdfHash) {
        await hold('변경됨', '승인한 뒤 OneDrive의 청구서 PDF가 바뀌었습니다. 다시 승인해 주세요.');
        continue;
      }
      // 붙여 보낼 서류가 하나라도 없으면 보내지 않는다. 승인한 것과 다른 묶음이 나가면 안 된다.
      let missingDoc = '';
      for (const att of round.attachments || []) {
        if (!(await readSavedFile(att.savedPath))) { missingDoc = att.fileName || att.kind; break; }
      }
      if (missingDoc) { await hold('실패', `함께 보낼 서류(${missingDoc})를 찾지 못했습니다. 서류를 확인한 뒤 다시 승인해 주세요.`); continue; }

      // 보내기 직전에 이 회차를 DB에서 붙잡는다. 화면의 [발행]이나 다른 서버가 먼저 잡았으면 보내지 않는다.
      // 메모리의 표시(autoSendRunning)만으로는 화면 발행이나 서버 여러 대를 막지 못한다.
      const claim = await BillingSchedule.updateOne(
        { _id: schedule._id, rounds: { $elemMatch: { no: round.no, 'autoSend.status': '승인', issuedAt: null } } },
        { $set: { 'rounds.$.autoSend.status': '발송중', 'rounds.$.autoSend.claimedAt': new Date() } }
      );
      if (claim.modifiedCount !== 1) {
        results.push({ ...record, status: '건너뜀', message: '그사이 다른 곳에서 처리했습니다.' });
        continue;
      }
      round.autoSend.status = '발송중';

      // 여기부터는 실패해도 '승인'으로 되돌리지 않는다. 메일이 이미 나갔을 수 있어서다.
      // '발송중'이나 '실패'로 남은 건은 사람이 발행 이력에서 확인한다.
      try {
        const { mailResult, mailError } = await deliverInvoice({
          schedule,
          round,
          partyName,
          fileName: round.autoSend.pdfFileName,
          pdfBuffer,
          saved: { fileName: round.autoSend.pdfFileName, localPath: round.autoSend.pdfSavedPath },
          to: round.autoSend.to,
          sendEmail: true,
          user
        });
        if (mailResult) {
          round.autoSend.status = '발송완료';
          round.autoSend.sentAt = new Date();
          round.autoSend.message = '';
          try { await schedule.save(); } catch (err) { console.error('[청구서 자동 발송] 발송완료 저장 실패:', err.message); }
          results.push({ ...record, status: '발송완료' });
        } else {
          // 회차는 발행 처리됐지만 메일만 실패했다. 화면 발행과 같은 상태다. 메일은 발행 이력에서 다시 보낸다.
          await hold('실패', `청구서는 발행했지만 메일을 보내지 못했습니다. 발행 이력에서 다시 보내 주세요. ${mailError || ''}`.trim());
        }
      } catch (err) {
        await hold('실패', `보내는 도중 오류가 났습니다. 메일이 나갔는지 확인한 뒤 처리해 주세요. (${err.message})`);
      }
    }
  }

  const count = (st) => results.filter((r) => r.status === st).length;
  const summary = { sent: count('발송완료'), held: count('변경됨'), failed: count('실패'), results };
  if (results.length) {
    console.log(`[청구서 자동 발송] 보냄 ${summary.sent} · 보류 ${summary.held} · 실패 ${summary.failed}`);
  }
  return summary;
};

/**
 * 화면에서 자동 발송을 지금 돌린다. 한 건만 고르면 발송일 전이어도 그 건을 바로 보낸다.
 *
 * @route POST /api/billing-schedules/auto-send/run  { scheduleId?, roundNo? }
 */
export const runAutoSendNow = async (req, res) => {
  try {
    const one = req.body?.scheduleId && req.body?.roundNo;
    const summary = await runAutoSend({
      user: req.user,
      scheduleId: req.body?.scheduleId,
      roundNo: req.body?.roundNo,
      ignoreSendDate: Boolean(one)
    });
    if (summary.busy) {
      return res.status(409).json({ success: false, message: '자동 발송이 이미 돌고 있습니다. 잠시 뒤 새로고침해 주세요.' });
    }
    const parts = [`${summary.sent}건 보냈습니다.`];
    if (summary.held) parts.push(`${summary.held}건은 내용이 바뀌어 보류했습니다.`);
    if (summary.failed) parts.push(`${summary.failed}건은 실패했습니다.`);
    res.json({ success: true, ...summary, message: summary.results.length ? parts.join(' ') : '보낼 청구서가 없습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 승인할 때 저장한 청구서 PDF를 연다. 보내기 전에 무엇이 나갈지 확인하는 데 쓴다.
 *
 * @route GET /api/billing-schedules/:id/rounds/:no/auto-send/file
 */
export const getAutoSendFile = async (req, res) => {
  try {
    const schedule = await BillingSchedule.findById(req.params.id).lean();
    const round = schedule?.rounds.find((r) => r.no === Number(req.params.no));
    if (!round?.autoSend?.pdfSavedPath) return res.status(404).json({ success: false, message: '승인한 청구서가 없습니다.' });
    const buffer = await readSavedFile(round.autoSend.pdfSavedPath);
    if (!buffer) return res.status(410).json({ success: false, message: '파일이 OneDrive에서 옮겨졌거나 지워져 열 수 없습니다.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(round.autoSend.pdfFileName || 'invoice.pdf')}`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 발송 결과. 최근 며칠 동안 발행한 청구서와, 자동 발송이 멈췄거나 실패한 건.
 *
 * 담당자가 아침에 "어제·오늘 나간 것이 다 잘 나갔나"를 한 화면에서 확인하게 한다.
 * 메일이 실패한 건은 여기서 바로 다시 보낸다.
 *
 * @route GET /api/billing-schedules/auto-send/history?days=14
 */
export const getSendHistory = async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - days);

    const schedules = await BillingSchedule.find({
      $or: [
        { 'rounds.issuedAt': { $gte: since } },
        { 'rounds.autoSend.status': { $in: ['발송중', '실패', '변경됨'] } }
      ]
    })
      .populate('contract', 'contractNo')
      .populate('company', 'name billingEmail')
      .populate('customer', 'name email')
      .lean();

    const items = [];
    for (const s of schedules) {
      for (const r of s.rounds) {
        const recent = r.issuedAt && new Date(r.issuedAt) >= since;
        const stuck = ['발송중', '실패', '변경됨'].includes(r.autoSend?.status);
        if (!recent && !stuck) continue;
        // 발행했지만 메일 기록이 없으면 '메일 안 감'. 자동 발송이 실패·보류로 남았으면 그 상태를 쓴다.
        let result = r.sentAt ? '보냄' : (r.issuedAt ? '메일 안 감' : '');
        if (r.autoSend?.status === '실패') result = r.issuedAt ? '메일 실패' : '실패';
        // 메일은 나갔는데 그 뒤 저장 등에서 실패한 건. 다시 보내면 고객이 두 번 받는다
        if (r.autoSend?.status === '실패' && r.sentAt) result = '확인 필요';
        if (r.autoSend?.status === '발송중') result = '확인 필요';
        if (r.autoSend?.status === '변경됨') result = '보류';
        items.push({
          scheduleId: s._id,
          partyName: s.company?.name || s.customer?.name || '',
          contractNo: s.contract?.contractNo || '',
          roundNo: r.no,
          totalRounds: s.totalRounds,
          dueDate: r.dueDate,
          total: r.total || 0,
          issuedAt: r.issuedAt || null,
          sentAt: r.sentAt || null,
          to: r.autoSend?.to || s.company?.billingEmail || s.customer?.email || '',
          via: r.autoSend?.status ? '자동' : '직접',
          result,
          message: r.autoSend?.message || '',
          status: r.status,
          hasFile: Boolean(r.invoiceSavedPath)
        });
      }
    }
    // 손볼 것이 위로 온다
    const weight = { '확인 필요': 0, '메일 실패': 1, 실패: 1, '메일 안 감': 2, 보류: 3, 보냄: 4 };
    items.sort((a, b) => ((weight[a.result] ?? 5) - (weight[b.result] ?? 5))
      || (new Date(b.issuedAt || 0) - new Date(a.issuedAt || 0)));
    res.json({ success: true, days, items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 입금 확인할 것. 청구서는 나갔는데(청구됨) 출금일이 지난 회차.
 *
 * 청구서를 보내는 일과 돈이 들어왔는지 보는 일이 한 흐름이라 같은 화면에 둔다.
 * 입금완료·미납은 기존 일괄 처리(PATCH rounds/bulk-status)로 찍는다. 미납으로 찍으면
 * 다음 회차에 전월 미결제와 연체 이자가 붙는다.
 *
 * @route GET /api/billing-schedules/auto-send/payments
 */
export const getPaymentChecks = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const schedules = await BillingSchedule.find({ rounds: { $elemMatch: { status: '청구됨', dueDate: { $lte: today } } } })
      .populate('contract', 'contractNo')
      .populate('company', 'name')
      .populate('customer', 'name')
      .lean();
    const items = [];
    for (const s of schedules) {
      for (const r of s.rounds) {
        if (r.status !== '청구됨' || new Date(r.dueDate) > today) continue;
        items.push({
          scheduleId: s._id,
          partyName: s.company?.name || s.customer?.name || '',
          contractNo: s.contract?.contractNo || '',
          roundNo: r.no,
          dueDate: r.dueDate,
          total: r.total || 0,
          paidAmount: r.paidAmount || 0,
          daysPast: -daysUntil(r.dueDate),
          // 결제일 뒤 15일 안이면 아직 들어오는 중일 수 있다. 미납으로 찍지 않는다
          inGrace: -daysUntil(r.dueDate) <= LATE_GRACE_DAYS
        });
      }
    }
    items.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    res.json({ success: true, items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 발행한 청구서를 메일로 다시 보낸다. 메일만 실패한 건, 주소를 잘못 넣었던 건에 쓴다.
 *
 * 청구서 파일은 발행할 때 저장한 것을 그대로 쓴다. 다시 만들지 않으므로 금액이 바뀌지 않는다.
 *
 * @route POST /api/billing-schedules/:id/rounds/:no/resend  { to? }
 */
export const resendInvoice = async (req, res) => {
  try {
    const schedule = await BillingSchedule.findById(req.params.id)
      .populate('company', 'name billingEmail')
      .populate('customer', 'name email')
      .populate('contract', 'contractNo docFolderName leaseCompany');
    if (!schedule) return res.status(404).json({ success: false, message: '회차표를 찾을 수 없습니다.' });
    const round = schedule.rounds.find((r) => r.no === Number(req.params.no));
    if (!round?.issuedAt || !round.invoiceSavedPath) {
      return res.status(400).json({ success: false, message: '아직 발행하지 않은 회차입니다. 청구서 화면에서 발행해 주세요.' });
    }
    if (round.autoSend?.status === '발송중') {
      return res.status(409).json({ success: false, message: '자동 발송이 보내던 중 멈춘 건입니다. 고객이 받았는지 먼저 확인해 주세요. 받지 않았으면 [못 받음]을 누른 뒤 다시 보내세요.' });
    }
    // 이미 메일을 보낸 기록이 있으면 다시 보내지 않는다(고객이 두 번 받는다). 주소를 바꿔 다시 보낼 때만 force로 연다.
    if (round.sentAt && req.body.force !== true) {
      return res.status(409).json({ success: false, message: `이미 ${formatYmd(round.sentAt)}에 메일을 보낸 기록이 있습니다. 그래도 다시 보내려면 확인 후 진행해 주세요.`, alreadySent: true });
    }
    const to = String(req.body.to || round.autoSend?.to || schedule.company?.billingEmail || schedule.customer?.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ success: false, message: '받는 사람 이메일을 확인해 주세요.' });

    const pdfBuffer = await readSavedFile(round.invoiceSavedPath);
    if (!pdfBuffer) return res.status(410).json({ success: false, message: '저장된 청구서 파일을 찾지 못했습니다.' });
    const extraFiles = [];
    for (const att of round.attachments || []) {
      const buffer = await readSavedFile(att.savedPath);
      if (!buffer) return res.status(410).json({ success: false, message: `함께 보낼 서류(${att.fileName || att.kind})를 찾지 못했습니다.` });
      extraFiles.push({ fileName: att.fileName, buffer });
    }

    const partyName = resolvePartyName(schedule);
    const mail = await sendInvoiceMail({
      to,
      fileName: round.invoiceFileName || 'invoice.pdf',
      fileBuffer: pdfBuffer,
      extraFiles,
      values: {
        계약자: partyName,
        계약번호: schedule.contract?.contractNo || '',
        회차: round.no,
        총회차: schedule.totalRounds,
        출금일: formatYmd(round.dueDate),
        청구액: `${Number(round.total || 0).toLocaleString()}원`
      }
    });
    round.sentAt = new Date();
    if (round.autoSend?.status === '실패') {
      round.autoSend.status = '발송완료';
      round.autoSend.sentAt = new Date();
      round.autoSend.message = '';
    }
    await schedule.save();
    logActivity({
      req, dept: '청구부', action: ACTIONS.INVOICE_SEND,
      target: { model: 'BillingSchedule', id: schedule._id },
      summary: `${partyName} ${round.no}회차 청구서 메일 다시 발송`,
      meta: { round: round.no, to: mail.to }
    });
    res.json({ success: true, message: `${mail.to}로 다시 보냈습니다.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 보내던 중 멈춘 건(발송중)을 사람이 확인하고 정리한다.
 *
 * 서버가 메일을 보낸 직후 멈추면 고객이 받았는지 시스템은 알 수 없다. 담당자가 보낸편지함이나
 * 고객에게 확인한 결과를 찍는다. 받았으면 '보냄'으로 끝내고, 못 받았으면 다시 보낼 수 있게 푼다.
 *
 * @route POST /api/billing-schedules/:id/rounds/:no/auto-send/resolve  { received: boolean }
 */
export const resolveStuckSend = async (req, res) => {
  try {
    const schedule = await BillingSchedule.findById(req.params.id);
    const round = schedule?.rounds.find((r) => r.no === Number(req.params.no));
    const uncertain = round && (round.autoSend?.status === '발송중' || (round.autoSend?.status === '실패' && round.sentAt));
    if (!uncertain) {
      return res.status(400).json({ success: false, message: '확인할 건이 아닙니다.' });
    }
    if (req.body.received) {
      round.autoSend.status = '발송완료';
      round.autoSend.sentAt = round.autoSend.sentAt || new Date();
      round.autoSend.message = '담당자가 받은 것을 확인했습니다.';
      if (!round.sentAt) round.sentAt = new Date();
    } else if (round.issuedAt) {
      // 발행은 됐고 메일만 안 갔다. 발송 결과에서 [다시 보내기]로 보낸다.
      round.autoSend.status = '실패';
      round.autoSend.message = '고객이 받지 못했습니다. 다시 보내 주세요.';
      round.sentAt = undefined; // 받지 못했으므로 보낸 기록을 지워 다시 보낼 수 있게 한다
    } else {
      // 발행 전에 멈췄다. 승인을 풀어 다시 승인·발송하게 한다.
      round.autoSend = undefined;
    }
    await schedule.save();
    res.json({ success: true, message: req.body.received ? '보냄으로 정리했습니다.' : '다시 보낼 수 있게 풀었습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** 고객 이름·오류 문구가 그대로 HTML로 들어가지 않게 한다 */
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 알림 메일 본문의 표 한 줄 */
const digestRow = (cells) => `<tr>${cells.map((c) => `<td style="padding:4px 8px;border-bottom:1px solid #eee">${escapeHtml(c)}</td>`).join('')}</tr>`;
const digestTable = (head, rows) => `<table style="border-collapse:collapse;font-size:13px">`
  + `<tr>${head.map((h) => `<th style="padding:4px 8px;text-align:left;background:#f3f4f6">${h}</th>`).join('')}</tr>${rows.join('')}</table>`;

/**
 * 오후 알림: 내일 아침 나갈 청구서 중 아직 승인하지 않은 건을 담당자 메일로 알린다.
 *
 * 화면을 열어 봐야만 알 수 있으면 바쁜 날 빠뜨린다. 승인할 것이 없으면 보내지 않는다(알림 피로를 줄인다).
 */
export const sendApprovalReminder = async () => {
  const items = await buildAutoSendQueue(7);
  // 다음 영업일까지 나갈 것. 금요일 오후면 월요일 발송분까지 챙긴다(발송일은 휴일이면 앞 영업일로 당겨진다).
  const next = new Date();
  next.setHours(0, 0, 0, 0);
  do { next.setDate(next.getDate() + 1); } while (isHoliday(next));
  const nextKey = dayKey(next);
  const needs = (it) => !it.issued && ['', '변경됨', '실패'].includes(it.autoStatus);
  const pending = items.filter((it) => needs(it)
    && (dayKey(it.sendDate) <= nextKey)
    // 발송일이 지난 건 중 아무 처리도 안 된 것은 대개 밖에서 이미 보낸 건이라 따로 센다
    && !(it.sendDday < 0 && !it.autoStatus));
  const missedCount = items.filter((it) => needs(it) && it.sendDday < 0 && !it.autoStatus).length;
  const stuck = items.filter((it) => it.autoStatus === '발송중');
  // 직원이 확인했고 대표 승인만 남은 건. 대표가 안 누르면 나가지 않으므로 따로 알린다
  const ceoWaiting = items.filter((it) => it.autoStatus === '대표승인대기' && dayKey(it.sendDate) <= nextKey);
  if (!pending.length && !stuck.length && !ceoWaiting.length) return { sent: false };

  const routine = pending.filter((it) => it.routine).length;
  const rows = pending.map((it) => digestRow([
    formatYmd(it.sendDate),
    it.company?.name || it.customer?.name || '',
    `${it.round.no}회차`,
    `${Number(it.expectedTotal || 0).toLocaleString()}원`,
    it.routine ? '평소와 같음' : it.changes.map((c) => c.label).join(', ')
  ]));
  const html = `<div style="font-family:'Malgun Gothic',sans-serif;font-size:14px">
    <p><b>다음 영업일(${formatYmd(next)}) 아침 9시까지 나갈 청구서 중 아직 승인하지 않은 건이 ${pending.length}건 있습니다.</b><br>
    평소와 같은 ${routine}건은 한 번에 승인할 수 있고, 나머지 ${pending.length - routine}건은 달라진 내용을 확인해 주세요.<br>
    승인하지 않은 건은 보내지 않습니다.</p>
    ${digestTable(['발송일', '계약자', '회차', '청구액', '달라진 점'], rows)}
    ${ceoWaiting.length ? `<p style="color:#7c3aed"><b>직원 확인이 끝나 대표님 승인을 기다리는 청구서 ${ceoWaiting.length}건</b>: ${ceoWaiting.map((it) => escapeHtml(`${it.company?.name || it.customer?.name || ''} ${it.round.no}회차`)).join(', ')}</p>` : ''}
    ${stuck.length ? `<p style="color:#b45309">보내던 중 멈춰 확인이 필요한 건이 ${stuck.length}건 있습니다.</p>` : ''}
    ${missedCount ? `<p style="color:#64748b">발송일이 지났는데 처리하지 않은 건이 ${missedCount}건 있습니다. 밖에서 이미 보냈다면 '이미 보냄'으로 정리해 주세요.</p>` : ''}
    <p>장기렌트 청구서 &gt; 청구서 발송 센터에서 처리합니다.</p></div>`;
  await sendInternalMail({ subject: `[청구서] 내일 발송 승인 대기 ${pending.length + ceoWaiting.length}건${ceoWaiting.length ? ` (대표 승인 ${ceoWaiting.length})` : ''}`, html });
  return { sent: true, pending: pending.length };
};

/**
 * 아침 발송 결과를 담당자 메일로 알린다. 보낸 것이 없으면 보내지 않는다.
 * @param {object} summary runAutoSend의 결과
 */
export const sendAutoSendReport = async (summary) => {
  if (!summary?.results?.length) return { sent: false };
  const rows = summary.results.map((r) => digestRow([
    r.partyName, `${r.roundNo}회차`, r.to || '', r.status, r.message || ''
  ]));
  const bad = summary.held + summary.failed;
  const html = `<div style="font-family:'Malgun Gothic',sans-serif;font-size:14px">
    <p><b>오늘 아침 청구서 자동 발송: 보냄 ${summary.sent}건${bad ? ` · 확인 필요 ${bad}건` : ''}</b></p>
    ${bad ? '<p style="color:#b45309">보류·실패한 건은 청구서 발송 센터의 [발송 결과]에서 처리해 주세요. 보류는 승인한 뒤 내용이 바뀐 건입니다.</p>' : ''}
    ${digestTable(['계약자', '회차', '받는 주소', '결과', '사유'], rows)}</div>`;
  await sendInternalMail({ subject: `[청구서] 오늘 자동 발송 결과 - 보냄 ${summary.sent}건${bad ? ` / 확인 필요 ${bad}건` : ''}`, html });
  return { sent: true };
};

/**
 * 회차 하나를 발행한다: PDF 저장 -> 메일 발송 -> 회차 상태 갱신.
 *
 * PDF는 화면에서 만들어 보낸다(청구서 양식이 화면 컴포넌트라 서버에서 같은 모양을 다시 그리기 어렵다).
 * 파일명은 "{법인명}_청구서_{n}회차.pdf"로 맞춰, 엑셀로 관리하던 규칙을 그대로 잇는다.
 *
 * 메일이 실패해도 PDF 저장과 상태 갱신은 되돌리지 않는다.
 * 파일은 이미 남았고, 메일만 다시 보내면 되기 때문이다. 대신 무엇이 실패했는지 알려 준다.
 *
 * @route POST /api/billing-schedules/:id/rounds/:no/issue
 */
export const issueRound = async (req, res) => {
  try {
    const schedule = await BillingSchedule.findById(req.params.id)
      .populate('company', 'name billingEmail folderName')
      .populate('customer', 'name')
      .populate('contract', 'contractNo docFolderName leaseCompany');
    if (!schedule) {
      return res.status(404).json({ success: false, message: '회차표를 찾을 수 없습니다.' });
    }
    const round = schedule.rounds.find((r) => r.no === Number(req.params.no));
    if (!round) {
      return res.status(404).json({ success: false, message: '해당 회차가 없습니다.' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: '청구서 PDF가 없습니다.' });
    }

    const partyName = resolvePartyName(schedule) !== '거래처'
      ? resolvePartyName(schedule)
      : (req.body.companyName || '거래처');
    const contractNo = invoiceFolderOf(schedule);
    const fileName = await invoiceFileNameOf(partyName, round);

    // 1) 계약자 폴더 > 02.청구서 > 계약번호 에 저장.
    //    한 법인에 계약이 여러 건이라, 계약번호로 한 단계 더 나누지 않으면
    //    5회차 청구서가 어느 계약 것인지 파일명만으로 구분되지 않는다.
    let saved;
    try {
      saved = await saveDocument({
        partyName,
        kind: 'invoice',
        subFolder: contractNo,
        fileName,
        fileBuffer: req.file.buffer,
        // 이미 메일로 보낸 회차만 이전 파일을 남긴다. 아직 안 보냈으면 최종본으로 덮어쓴다.
        keepPrevious: Boolean(round.sentAt)
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: `청구서 저장에 실패했습니다: ${err.message}` });
    }

    // 2) 메일 발송(요청했을 때만)과 3) 회차 상태 갱신. 자동 발송도 같은 함수를 쓴다.
    const sendEmail = String(req.body.sendEmail) === 'true';
    const to = req.body.to || schedule.company?.billingEmail;

    // 담당자가 바뀌어 받는 주소를 고쳐 보냈다면, 법인에도 반영해 다음 달부터 그 주소가 기본이 되게 한다.
    // 매달 같은 주소를 다시 고쳐 넣는 일을 없앤다.
    if (sendEmail && String(req.body.saveEmailToCompany) === 'true' && to && schedule.company?._id
        && to !== schedule.company.billingEmail) {
      await Company.findByIdAndUpdate(schedule.company._id, { billingEmail: to });
    }

    // 자동 발송이 이 회차를 보내는 중이거나 이미 보냈으면 화면에서 또 보내지 않는다(고객이 두 번 받는다).
    // 승인만 걸려 있으면 DB에서 조건부로 풀어 아침 발송과 겹치지 않게 한다. 그사이 서버가 먼저 잡았으면 멈춘다.
    if (['발송중', '발송완료'].includes(round.autoSend?.status)) {
      return res.status(409).json({ success: false, message: '자동 발송으로 보내는 중이거나 이미 보낸 청구서입니다. 자동 발송 탭에서 확인해 주세요.' });
    }
    if (round.autoSend?.status) {
      const released = await BillingSchedule.updateOne(
        { _id: schedule._id, rounds: { $elemMatch: { no: round.no, 'autoSend.status': round.autoSend.status } } },
        { $unset: { 'rounds.$.autoSend': '' } }
      );
      if (released.modifiedCount !== 1) {
        return res.status(409).json({ success: false, message: '자동 발송이 방금 이 청구서를 보내기 시작했습니다. 새로고침 후 확인해 주세요.' });
      }
      round.autoSend = undefined;
    }

    const { mailResult, mailError } = await deliverInvoice({
      schedule, round, partyName, fileName, pdfBuffer: req.file.buffer, saved, to, sendEmail, req
    });

    res.json({
      success: true,
      fileName: saved.fileName,
      localPath: saved.localPath,
      mailSent: Boolean(mailResult),
      mailError,
      message: mailError
        ? `청구서를 저장했지만 메일은 보내지 못했습니다. ${mailError}`
        : (mailResult ? `청구서를 저장하고 ${mailResult.to}로 보냈습니다.` : '청구서를 저장했습니다.')
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 입금액을 적어 회차의 입금 상태를 정한다.
 *
 * 상태를 사람이 고르게 하지 않고 금액으로 정한다.
 * 청구액만큼 들어왔으면 입금완료, 일부만 들어왔거나 안 들어왔으면 미납이다.
 * 부분 입금이면 남은 금액이 다음 회차의 '전월 미결제'로 넘어간다.
 *
 * @route PATCH /api/billing-schedules/:id/rounds/:no/payment
 */
export const updateRoundPayment = async (req, res) => {
  try {
    const schedule = await BillingSchedule.findById(req.params.id);
    if (!schedule) return res.status(404).json({ success: false, message: '회차표를 찾을 수 없습니다.' });
    const round = schedule.rounds.find((r) => r.no === Number(req.params.no));
    if (!round) return res.status(404).json({ success: false, message: '해당 회차가 없습니다.' });

    const paid = Math.max(0, Number(req.body.paidAmount) || 0);
    const total = round.total || 0;

    // '예정'으로 되돌리기: 아직 결과가 정해지지 않은 상태로 되돌린다
    if (req.body.status === '예정') {
      round.status = '예정';
      round.paidAmount = 0;
      round.paidAt = undefined;
    } else {
      round.paidAmount = paid;
      if (paid >= total && total > 0) {
        round.status = '입금완료';
        round.paidAt = req.body.paidAt ? new Date(req.body.paidAt) : new Date();
      } else {
        round.status = '미납';
        // 일부라도 들어왔으면 그 날짜를 남긴다. 언제 얼마가 들어왔는지 알아야 이자를 따진다.
        round.paidAt = paid > 0 ? (req.body.paidAt ? new Date(req.body.paidAt) : new Date()) : undefined;
      }
    }

    // 이 회차가 바뀌면 뒤 회차의 전월 미결제와 이자가 전부 달라진다
    const rateMap = await loadLateInterestRates([schedule.contract]);
    const rate = rateMap.get(String(schedule.contract)) || 25;
    const carried = applyCarryForward(schedule, rate, round.no);
    await schedule.save();

    const unpaid = Math.max(0, total - paid);
    logActivity({
      req, dept: '재무부', action: ACTIONS.PAYMENT_UPDATE,
      target: { model: 'BillingSchedule', id: schedule._id },
      summary: `${round.no}회차 ${round.status}${round.status === '예정' ? '(으)로 되돌림' : ` (입금 ${paid.toLocaleString()}원)`}`,
      meta: { round: round.no, status: round.status, paidAmount: round.paidAmount, unpaid }
    });
    res.json({
      success: true,
      round,
      unpaid,
      carried,
      message: (round.status === '입금완료'
        ? `${round.no}회차 입금 완료로 처리했습니다.`
        : round.status === '예정'
          ? `${round.no}회차를 예정으로 되돌렸습니다.`
          : (paid > 0
            ? `${round.no}회차 부분 입금 ${paid.toLocaleString()}원. 미납 ${unpaid.toLocaleString()}원이 다음 회차로 넘어갑니다.`
            : `${round.no}회차를 미납으로 처리했습니다. 미납 ${unpaid.toLocaleString()}원이 다음 회차로 넘어갑니다.`))
        + (carried ? ` 뒤 ${carried}개 회차의 미결제·이자를 다시 계산했습니다.` : '')
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 여러 계약의 회차 상태를 한 번에 바꾼다. 전월 미결제를 화면에서 체크로 처리하기 위한 것이다.
 *
 * 미결제로 찍어 두면 다음 회차를 열 때 미수금과 연체 이자가 자동으로 채워진다.
 * 입금완료로 찍으면 따로 금액을 주지 않는 한 청구액 전액이 들어온 것으로 본다(대부분 전액 입금이다).
 *
 * @route PATCH /api/billing-schedules/rounds/bulk-status
 */
export const bulkUpdateRoundStatus = async (req, res) => {
  try {
    const { targets, status } = req.body;
    if (!Array.isArray(targets) || !targets.length) {
      return res.status(400).json({ success: false, message: '상태를 바꿀 회차를 골라 주세요.' });
    }
    if (!['예정', '청구됨', '입금완료', '미납'].includes(status)) {
      return res.status(400).json({ success: false, message: '알 수 없는 상태입니다.' });
    }

    let changed = 0;
    const skipped = [];
    for (const t of targets) {
      const schedule = await BillingSchedule.findById(t.scheduleId);
      if (!schedule) { skipped.push(`${t.scheduleId} 회차표 없음`); continue; }
      const round = schedule.rounds.find((r) => r.no === Number(t.no));
      if (!round) { skipped.push(`${t.no}회차 없음`); continue; }
      // 화면을 연 뒤 다른 사람이 상태를 바꿨으면 건드리지 않는다(목록에서 본 것과 다른 회차를 바꾸게 된다)
      if (t.expectStatus && round.status !== t.expectStatus) { skipped.push(`${t.no}회차 상태가 그사이 바뀜`); continue; }
      // 일부 입금이 적혀 있는 회차를 한꺼번에 '전액 입금'으로 찍으면 부분 입금 기록이 사라진다
      if (status === '입금완료' && t.paidAmount === undefined && t.keepPartial && (round.paidAmount || 0) > 0) {
        skipped.push(`${t.no}회차 일부 입금 있음`);
        continue;
      }

      // 결제일 뒤 15일 안은 아직 연체가 아니다(입금이 며칠 늦게 찍힌다). 미납으로 찍으면 다음 달에 이자가 붙는다.
      if (status === '미납' && daysUntil(round.dueDate) >= -LATE_GRACE_DAYS && !t.force) {
        skipped.push(`${t.no}회차 결제일 뒤 ${LATE_GRACE_DAYS}일 안`);
        continue;
      }

      round.status = status;
      if (status === '입금완료') {
        round.paidAmount = t.paidAmount !== undefined ? Number(t.paidAmount) || 0 : (round.total || 0);
        round.paidAt = new Date();
      } else if (status === '미납') {
        round.paidAmount = t.paidAmount !== undefined ? Number(t.paidAmount) || 0 : (round.paidAmount || 0);
        round.paidAt = undefined;
      }
      const rateMap = await loadLateInterestRates([schedule.contract]);
      applyCarryForward(schedule, rateMap.get(String(schedule.contract)) || 25, round.no);
      await schedule.save();
      changed += 1;
      // 입금완료·미납으로 찍는 것은 입금 입력이다(대부분 이 화면에서 전액 입금을 한꺼번에 처리한다).
      logActivity({
        req, dept: '재무부',
        action: status === '입금완료' || status === '미납' ? ACTIONS.PAYMENT_UPDATE : ACTIONS.ROUND_STATUS_CHANGE,
        target: { model: 'BillingSchedule', id: schedule._id },
        summary: `${round.no}회차 ${status} 처리 (일괄)`,
        meta: { round: round.no, status, paidAmount: round.paidAmount }
      });
    }

    res.json({
      success: true,
      changed,
      skipped,
      message: `${changed}건을 ${status}(으)로 바꿨습니다.`
        + (skipped.length ? ` (${skipped.length}건은 건너뜀)` : '')
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 청구서에 함께 보낼 서류를 올린다(범칙금·과태료 고지서 등).
 *
 * 청구서와 같은 폴더에 "{청구서 파일명}_{종류}.pdf"로 저장한다.
 * 예: 주식회사 렌트베네핏_청구서_5회차_범칙금.pdf
 * 파일명만 봐도 어느 청구서에 딸린 서류인지 알 수 있어야 나중에 찾기 쉽다.
 *
 * @route POST /api/billing-schedules/:id/rounds/:no/attachments
 */
/**
 * 이미 올린 서류와 같은 파일인지 본다.
 *
 * 범칙금 고지서를 두 번 올리면 금액이 두 배로 청구된다. 실수로 같은 파일을 다시 고르는 일이
 * 잦아서, 이름이 아니라 내용(sha256)으로 비교한다. 저장할 때 이름은 바뀌어도 내용은 같다.
 * 같은 계약의 다른 회차까지 살피는 이유: 회차를 착각해 옆 회차에 붙이는 실수도 막기 위해서다.
 *
 * @param {object} schedule 회차표
 * @param {string} hash 올리려는 파일의 지문
 * @returns {{round: number, attachment: object}|null} 이미 있으면 그 자리
 */
const findSameFile = (schedule, hash) => {
  for (const r of schedule.rounds) {
    const hit = (r.attachments || []).find((a) => a.fileHash && a.fileHash === hash);
    if (hit) return { round: r.no, attachment: hit };
  }
  return null;
};

/**
 * 같은 고지서가 이미 올라가 있는지 고지서 번호로 본다.
 *
 * 파일 지문은 같은 고지서를 다시 스캔하면 달라진다. 실제로 자주 그렇게 된다(재스캔·재발송분).
 * 고지서에 적힌 번호가 같으면 다른 파일이어도 같은 건이다.
 *
 * @param {object} schedule 회차표
 * @param {string} noticeNo 고지서 번호
 * @returns {{round: number, attachment: object}|null}
 */
const findSameNotice = (schedule, noticeNo) => {
  if (!noticeNo) return null;
  for (const r of schedule.rounds) {
    const hit = (r.attachments || []).find((a) => a.noticeNo && a.noticeNo === noticeNo);
    if (hit) return { round: r.no, attachment: hit };
  }
  return null;
};

/**
 * 같은 고지서가 대차 고지서로 이미 올라가 있는지 본다.
 * 한 장이 두 곳에 들어가면 장기렌트 고객과 대차 고객에게 모두 청구된다.
 *
 * @returns {Promise<string>} 이미 있으면 안내 문장, 없으면 빈 값
 */
const findInRentalNotices = async (noticeNo, fileHash) => {
  const or = [{ fileHash }];
  if (noticeNo) or.push({ noticeNo });
  const hit = await RentalNotice.findOne({ $or: or }).select('plateNo kind customerName').lean();
  return hit
    ? `이 고지서는 이미 대차 고지서로 올라가 있습니다. (${hit.plateNo} · ${hit.kind}${hit.customerName ? ` · ${hit.customerName}` : ''}) 고지서 관리에서 확인해 주세요.`
    : '';
};

/**
 * 붙인 서류를 어느 폴더에 넣을지 정한다.
 *
 * 범칙금·과태료·통행료는 관공서가 보낸 고지서다. 청구서와 성격이 달라 따로 모아 둬야
 * "이 법인의 고지서" 만 훑어볼 수 있다. 정비내역·기타는 청구 근거 서류라 청구서와 함께 둔다.
 *
 * @param {string} kind 화면에서 고른 서류 종류
 * @returns {string} DOC_KINDS의 code
 */
const NOTICE_KINDS = ['범칙금', '과태료', '통행료'];
const folderKindForAttachment = (kind) => (NOTICE_KINDS.includes(kind) ? 'notice' : 'invoice');

const attachFileToRound = async (schedule, round, req) => {
  const kind = (req.body.kind || '기타').trim();
  const amount = Number(req.body.amount) || 0;
  const plateNo = (req.body.plateNo || '').trim();
  const occurredAt = req.body.occurredAt ? new Date(req.body.occurredAt) : undefined;
  // 고지서에서 읽은 값. 중복 판정과 납부기한 추적에 쓴다.
  const noticeNo = (req.body.noticeNo || '').trim();
  const noticeDueDate = req.body.noticeDueDate ? new Date(req.body.noticeDueDate) : undefined;
  const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

  const partyName = resolvePartyName(schedule);
  const contractNo = schedule.contract?.docFolderName || schedule.contract?.contractNo || '계약번호미상';
  const ext = (req.file.originalname.match(/\.[^.]+$/) || ['.pdf'])[0];

  // 같은 종류가 여러 건 올 수 있다(범칙금 3장 등). 어느 차 건인지가 제일 먼저 필요한 정보라
  // 차량번호를 이름에 넣고, 차량번호가 없으면 같은 종류의 몇 번째인지를 붙인다.
  const sameKind = (round.attachments || []).filter((a) => a.kind === kind).length;
  const settings = await getDocumentSettings();
  const baseName = fillPattern(settings.fileNames.invoiceAttachment, {
    법인명: partyName,
    계약자: partyName, // 예전 설정이 {계약자}를 쓰고 있어도 그대로 채워지게 둔다
    회차: round.no,
    종류: kind,
    차량번호: plateNo
  });
  // 차량번호가 없으면 같은 종류의 몇 번째인지를 붙여 이름이 겹치지 않게 한다
  const fileName = `${baseName}${!plateNo && sameKind ? `_${sameKind + 1}` : ''}${ext}`;

  // 같은 회차에 같은 파일이 이미 있으면 새로 붙이지 않고 그 자리의 값을 고친다.
  // 금액을 빠뜨리고 올린 뒤 다시 올리는 일이 잦은데, 새로 붙이면 금액이 두 번 잡힌다.
  const existing = round.attachments.find((a) => a.fileHash === fileHash);

  // 같은 차의 과태료가 한 회차에 두 장 오면 파일명이 같아진다. 새 고지서면 덮어쓰지 않고 이름을 바꿔 남긴다.
  const saved = await saveDocument({
    partyName,
    kind: folderKindForAttachment(kind),
    subFolder: contractNo,
    fileName,
    fileBuffer: req.file.buffer,
    keepPrevious: !existing
  });

  if (existing) {
    existing.kind = kind;
    existing.amount = amount;
    existing.plateNo = plateNo;
    existing.occurredAt = occurredAt;
    existing.noticeNo = noticeNo;
    existing.noticeDueDate = noticeDueDate;
    existing.fileName = saved.fileName;
    existing.savedPath = saved.localPath;
    existing.uploadedAt = new Date();
    recalcRound(round);
    await schedule.save();
    await upsertNoticeSchedule({ schedule, round, attachment: existing, partyName })
      .catch((err) => console.error('[고지서 납부기한] 캘린더 갱신 실패:', err.message));
    return { kind, saved, attachment: existing, replaced: true };
  }

  round.attachments.push({
    kind,
    amount,
    plateNo,
    occurredAt,
    noticeNo,
    noticeDueDate,
    fileName: saved.fileName,
    savedPath: saved.localPath,
    fileHash,
    uploadedAt: new Date()
  });
  recalcRound(round); // 서류 금액이 범칙금·정비 항목에 바로 합산된다
  await schedule.save();

  const added = round.attachments[round.attachments.length - 1];
  if (NOTICE_KINDS.includes(kind)) {
    logActivity({
      req, dept: '차량관리부', action: ACTIONS.NOTICE_REGISTER,
      target: { model: 'BillingSchedule', id: schedule._id },
      summary: `${partyName} ${kind} 고지서 등록${plateNo ? ` (${plateNo})` : ''}`,
      meta: { kind, amount, round: round.no, noticeDueDate }
    });
  }
  // 납부기한을 캘린더에 바로 올린다. 실패해도 청구는 이미 끝났으므로 막지 않는다.
  await upsertNoticeSchedule({ schedule, round, attachment: added, partyName })
    .catch((err) => console.error('[고지서 납부기한] 캘린더 등록 실패:', err.message));

  return { kind, saved, attachment: added, replaced: false };
};

export const addRoundAttachment = async (req, res) => {
  try {
    const schedule = await BillingSchedule.findById(req.params.id)
      .populate('company', 'name')
      .populate('customer', 'name')
      .populate('contract', 'contractNo docFolderName leaseCompany');
    if (!schedule) return res.status(404).json({ success: false, message: '회차표를 찾을 수 없습니다.' });

    const round = schedule.rounds.find((r) => r.no === Number(req.params.no));
    if (!round) return res.status(404).json({ success: false, message: '해당 회차가 없습니다.' });
    if (!req.file) return res.status(400).json({ success: false, message: '올릴 파일이 없습니다.' });

    const noticeNo = (req.body.noticeNo || '').trim();
    const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const inRental = await findInRentalNotices(noticeNo, fileHash);
    if (inRental) return res.status(409).json({ success: false, duplicate: true, message: inRental });

    // 고지서 번호가 같으면 파일이 달라도 같은 건이다. 재스캔한 고지서가 두 번 청구되는 것을 막는다.
    // 같은 회차라도 다른 파일(재스캔본)이면 막는다. 파일이 같으면 아래에서 그 자리의 값을 고친다.
    const sameNotice = findSameNotice(schedule, noticeNo);
    if (sameNotice && (sameNotice.round !== round.no || sameNotice.attachment.fileHash !== fileHash)) {
      return res.status(409).json({
        success: false,
        duplicate: true,
        message: `고지번호 ${noticeNo} 건이 이미 ${sameNotice.round}회차에 올라가 있습니다. (${sameNotice.attachment.fileName})`
      });
    }

    // 다른 회차에 같은 파일이 있으면 막는다. 회차를 착각해 두 번 청구되는 것을 막기 위해서다.
    // 같은 회차면 그 자리의 값을 고친다(아래 attachFileToRound가 처리한다).
    const dup = findSameFile(schedule, fileHash);
    if (dup && dup.round !== round.no) {
      return res.status(409).json({
        success: false,
        duplicate: true,
        message: `같은 파일이 이미 ${dup.round}회차에 올라가 있습니다. (${dup.attachment.fileName}) 그 회차에서 지운 뒤 다시 올려 주세요.`
      });
    }

    const { kind, saved, attachment, replaced } = await attachFileToRound(schedule, round, req);
    res.json({
      success: true,
      attachment,
      round,
      replaced,
      message: replaced
        ? `같은 파일이 있어 ${kind} 서류의 금액과 정보를 새로 고쳤습니다. (${saved.fileName})`
        : `${kind} 서류를 올렸습니다. (${saved.fileName})`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 아직 발행하지 않은 회차 중 가장 먼저 청구될 회차를 찾는다.
 *
 * 범칙금 고지서는 아무 때나 날아오는데, 그때 어느 회차에 붙일지 사람이 고르게 하면
 * 이미 보낸 회차에 잘못 붙이기 쉽다. 그래서 "다음에 나갈 청구서"로 자동으로 보낸다.
 *
 * @param {object} schedule 회차표
 * @returns {object|null} 도래 예정 회차
 */
const findUpcomingRound = (schedule) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const pending = schedule.rounds.filter((r) => r.status === '예정');
  // 아직 안 지난 회차 중 가장 이른 것. 전부 지났으면 남은 것 중 가장 이른 것을 쓴다.
  return pending.find((r) => new Date(r.dueDate) >= today) || pending[0] || null;
};

/**
 * 도래 예정 청구서에 서류를 올린다. 회차를 고르지 않아도 된다.
 *
 * @route POST /api/billing-schedules/contract/:contractId/upcoming/attachments
 */
export const addUpcomingAttachment = async (req, res) => {
  try {
    const schedule = await BillingSchedule.findOne({ contract: req.params.contractId })
      .populate('company', 'name')
      .populate('customer', 'name')
      .populate('contract', 'contractNo docFolderName leaseCompany');
    if (!schedule) return res.status(404).json({ success: false, message: '이 계약의 회차표가 없습니다.' });
    if (!req.file) return res.status(400).json({ success: false, message: '올릴 파일이 없습니다.' });

    const round = findUpcomingRound(schedule);
    if (!round) {
      return res.status(400).json({ success: false, message: '아직 발행하지 않은 회차가 없습니다. 계약이 끝났는지 확인해 주세요.' });
    }

    const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const inRental = await findInRentalNotices((req.body.noticeNo || '').trim(), fileHash);
    if (inRental) return res.status(409).json({ success: false, duplicate: true, message: inRental });

    // 고지서 번호가 같으면 파일이 달라도 같은 건이다. 재스캔한 고지서가 두 번 청구되는 것을 막는다.
    // 같은 회차라도 다른 파일(재스캔본)이면 막는다. 파일이 같으면 아래에서 그 자리의 값을 고친다.
    const sameNotice = findSameNotice(schedule, (req.body.noticeNo || '').trim());
    if (sameNotice && (sameNotice.round !== round.no || sameNotice.attachment.fileHash !== fileHash)) {
      return res.status(409).json({
        success: false,
        duplicate: true,
        message: `고지번호 ${req.body.noticeNo} 건이 이미 ${sameNotice.round}회차에 올라가 있습니다. (${sameNotice.attachment.fileName})`
      });
    }

    // 다른 회차에 같은 파일이 있으면 막는다. 같은 회차면 그 자리의 값을 고친다.
    const dup = findSameFile(schedule, fileHash);
    if (dup && dup.round !== round.no) {
      return res.status(409).json({
        success: false,
        duplicate: true,
        message: `같은 파일이 이미 ${dup.round}회차에 올라가 있습니다. (${dup.attachment.fileName}) 그 회차에서 지운 뒤 다시 올려 주세요.`
      });
    }

    const { kind, saved, attachment, replaced } = await attachFileToRound(schedule, round, req);
    res.json({
      success: true,
      attachment,
      roundNo: round.no,
      dueDate: round.dueDate,
      sendDate: calcSendDate(round.dueDate),
      replaced,
      message: replaced
        ? `같은 파일이 있어 ${round.no}회차 ${kind} 서류의 금액과 정보를 새로 고쳤습니다.`
        : `${kind} 서류를 ${round.no}회차(출금일 ${formatYmd(round.dueDate)}) 청구서에 붙였습니다.`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 엑셀로 관리하던 과거 청구 내역을 회차표에 채워 넣는다.
 *
 * 회차 번호로 짝을 짓는다. 사장님 시트의 1회차가 시스템의 1회차와 같아서 그대로 맞는다.
 * 이미 발행한 회차는 건드리지 않는다.
 *
 * dryRun=true로 먼저 불러 무엇이 바뀔지 확인한 뒤 넣는 것을 권한다.
 *
 * @route POST /api/billing-schedules/import-history
 */
export const importBillingHistory = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '올릴 엑셀 파일이 없습니다.' });

    const dryRun = String(req.body.dryRun) === 'true';
    const { rows, warnings } = parseHistoryWorkbook(req.file.buffer, (req.body.contractNo || '').trim());
    if (!rows.length) {
      return res.status(400).json({
        success: false,
        message: '읽을 내용을 찾지 못했습니다. 제목 줄에 "회차"와 "월 렌트료"가 있어야 합니다.'
      });
    }

    const result = await applyHistoryRows(rows, dryRun);
    const changed = result.applied.filter((a) => a.before !== a.after);

    res.json({
      success: true,
      dryRun,
      readCount: rows.length,
      appliedCount: result.applied.length,
      changedCount: changed.length,
      applied: result.applied.filter((a) => a.fine || a.other || a.maintenance || a.interest).slice(0, 200),
      skipped: result.skipped.slice(0, 50),
      notFound: result.notFound,
      warnings: warnings.slice(0, 20),
      message: dryRun
        ? `${rows.length}줄을 읽었습니다. 넣으면 ${changed.length}개 회차의 금액이 바뀝니다. (아직 저장하지 않았습니다)`
        : `${result.applied.length}개 회차에 넣었습니다. 금액이 바뀐 회차 ${changed.length}개.`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 과거 내역을 옮겨 적을 양식을 내려 준다.
 *
 * 계약번호·회차·날짜·월 렌트료를 미리 채워 두어, 금액만 옮겨 적으면 되도록 한다.
 * 회차와 날짜를 손으로 맞추다 틀리는 일을 없앤다.
 *
 * @route GET /api/billing-schedules/history-template?contractNo=21120036
 */
export const downloadHistoryTemplate = async (req, res) => {
  try {
    const contractNo = (req.query.contractNo || '').trim();
    const query = contractNo ? { contractNo } : {};
    const contracts = await Contract.find(query).select('contractNo leaseCompany').lean();
    if (!contracts.length) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });

    const header = ['계약번호', '계약자', '회차', '날짜', '월 렌트료', '전월 미결제', '이자', '범칙금', '', '', '', '', '정기점검', '기타청구', '기타 항목명'];
    const rows = [header];

    for (const c of contracts) {
      const schedule = await BillingSchedule.findOne({ contract: c._id }).lean();
      if (!schedule) continue;
      for (const r of schedule.rounds) {
        rows.push([
          c.contractNo, c.leaseCompany || '', r.no, formatYmd(r.dueDate), r.monthlyRent || 0,
          '', '', '', '', '', '', '', '', '', ''
        ]);
      }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '과거내역');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const name = contractNo ? `과거내역_${contractNo}.xlsx` : '과거내역_전체.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(buf);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 회차표가 있는 계약 목록과 각 계약의 '다음에 나갈 청구서'.
 *
 * 범칙금 고지서를 올릴 때 계약을 고르는 데 쓴다. 어느 회차에 붙는지 미리 보여 주면
 * 엉뚱한 청구서에 붙이는 일을 막을 수 있다.
 *
 * @route GET /api/billing-schedules
 */
export const getSchedulesSummary = async (req, res) => {
  try {
    const schedules = await BillingSchedule.find({})
      .populate('contract', 'contractNo')
      .populate('company', 'name')
      .populate('customer', 'name')
      .lean();

    // 범칙금·과태료는 차량번호로 확인하고 오기 때문에, 계약을 고를 때 차량번호로 찾을 수 있어야 한다.
    // 계약마다 따로 묻지 않고 한 번에 읽어 계약별로 모아 둔다.
    const vehicles = await Vehicle.find({ contract: { $in: schedules.map((s) => s.contract?._id).filter(Boolean) } })
      .select('contract plateNo carModel')
      .lean();
    const vehiclesByContract = new Map();
    for (const v of vehicles) {
      const key = String(v.contract);
      if (!vehiclesByContract.has(key)) vehiclesByContract.set(key, []);
      vehiclesByContract.get(key).push(v);
    }

    const items = schedules.map((s) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const pending = (s.rounds || []).filter((r) => r.status === '예정');
      const next = pending.find((r) => new Date(r.dueDate) >= today) || pending[0] || null;
      const cars = vehiclesByContract.get(String(s.contract?._id)) || [];
      return {
        scheduleId: s._id,
        contractId: s.contract?._id,
        contractNo: s.contract?.contractNo,
        partyName: s.company?.name || s.customer?.name || '',
        // 차량번호는 검색과 화면 표시에 함께 쓴다
        vehicles: cars.map((v) => ({ plateNo: v.plateNo || '', carModel: v.carModel || '' })),
        plateNos: cars.map((v) => v.plateNo).filter(Boolean),
        totalRounds: s.totalRounds,
        upcoming: next ? {
          no: next.no,
          dueDate: next.dueDate,
          sendDate: calcSendDate(next.dueDate),
          attachmentCount: (next.attachments || []).length
        } : null
      };
    }).filter((x) => x.contractId);

    items.sort((a, b) => a.partyName.localeCompare(b.partyName, 'ko'));

    // 회차표가 아직 없는 계약. 결제일이나 렌트료 게시일이 비어 있으면 만들 수 없는데,
    // 화면에 안 보이면 "왜 청구 대상에 안 뜨지"만 남고 원인을 알 수 없다.
    const withSchedule = new Set(items.map((x) => String(x.contractId)));
    const contracts = await Contract.find({ status: { $ne: '해지' } })
      .select('contractNo companyId customer')
      .populate('companyId', 'name')
      .populate('customer', 'name')
      .lean();

    // 조회만 하고 만들지는 않는다. 목록을 여는 것만으로 데이터가 바뀌면 안 된다.
    const missing = [];
    for (const c of contracts) {
      if (withSchedule.has(String(c._id))) continue;
      let reason = '';
      let code = '';
      let ready = false;
      try {
        await resolveScheduleInputs(c._id);
        ready = true;
      } catch (err) {
        reason = err.message;
        code = err.code || '';
      }
      missing.push({
        contractId: c._id,
        contractNo: c.contractNo,
        partyName: c.companyId?.name || c.customer?.name || '',
        ready,
        reason,
        // NO_RENT는 완납 등으로 청구할 것이 없는 정상 계약이다. 화면이 경고에서 빼고 따로 보여 준다.
        code
      });
    }

    res.json({ success: true, count: items.length, items, missing });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 발행한 청구서 이력. 계약을 가리지 않고 발행 시각 역순으로 준다.
 *
 * 회차표(BillingSchedule)에 발행 기록이 이미 다 들어 있어 별도 컬렉션을 두지 않는다.
 * 같은 정보를 두 곳에 저장하면 한쪽만 고쳐져 어긋난다.
 *
 * @route GET /api/billing-schedules/issued?from=YYYY-MM-DD&to=YYYY-MM-DD&keyword=
 */
export const getIssuedRounds = async (req, res) => {
  try {
    const { from, to, keyword } = req.query;
    // $elemMatch를 쓰는 이유: 'rounds.issuedAt': { $ne: null }은 배열에서
    // "어떤 원소도 null이 아니어야 한다"는 뜻이라, 발행 전 회차가 하나라도 있으면 문서가 통째로 빠진다.
    const schedules = await BillingSchedule.find({ rounds: { $elemMatch: { issuedAt: { $ne: null } } } })
      .populate('contract', 'contractNo')
      .populate('company', 'name billingEmail')
      .populate('customer', 'name')
      .lean();

    const fromDate = from ? new Date(`${from}T00:00:00`) : null;
    const toDate = to ? new Date(`${to}T23:59:59`) : null;
    const kw = (keyword || '').trim().toLowerCase();

    const items = [];
    for (const s of schedules) {
      const name = s.company?.name || s.customer?.name || '';
      if (kw && ![name, s.contract?.contractNo].some((v) => (v || '').toLowerCase().includes(kw))) continue;

      for (const r of s.rounds) {
        if (!r.issuedAt) continue;
        if (fromDate && new Date(r.issuedAt) < fromDate) continue;
        if (toDate && new Date(r.issuedAt) > toDate) continue;
        items.push({
          scheduleId: s._id,
          contractId: s.contract?._id,
          contractNo: s.contract?.contractNo,
          partyName: name,
          billingEmail: s.company?.billingEmail,
          no: r.no,
          totalRounds: s.totalRounds,
          dueDate: r.dueDate,
          total: r.total,
          status: r.status,
          issuedAt: r.issuedAt,
          sentAt: r.sentAt,
          paidAt: r.paidAt,
          paidAmount: r.paidAmount,
          invoiceFileName: r.invoiceFileName,
          invoiceSavedPath: r.invoiceSavedPath,
          attachments: (r.attachments || []).map((a) => ({ kind: a.kind, fileName: a.fileName, amount: a.amount }))
        });
      }
    }

    items.sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
    res.json({
      success: true,
      count: items.length,
      sentCount: items.filter((i) => i.sentAt).length,
      totalAmount: items.reduce((sum, i) => sum + (i.total || 0), 0),
      items
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 올린 서류를 목록에서 뺀다. 이미 저장된 파일은 지우지 않는다.
 * 파일까지 지우면 이미 보낸 청구서에 딸린 근거 자료가 사라지기 때문이다.
 *
 * @route DELETE /api/billing-schedules/:id/rounds/:no/attachments/:index
 */
export const removeRoundAttachment = async (req, res) => {
  try {
    const schedule = await BillingSchedule.findById(req.params.id);
    if (!schedule) return res.status(404).json({ success: false, message: '회차표를 찾을 수 없습니다.' });
    const round = schedule.rounds.find((r) => r.no === Number(req.params.no));
    if (!round) return res.status(404).json({ success: false, message: '해당 회차가 없습니다.' });

    const index = Number(req.params.index);
    if (!round.attachments[index]) {
      return res.status(404).json({ success: false, message: '해당 서류가 없습니다.' });
    }
    // 이미 나간 청구서의 금액은 건드리지 않는다. 고객이 받은 금액과 장부가 어긋난다.
    if (round.issuedAt) {
      return res.status(400).json({ success: false, message: '이미 발행한 회차라 서류를 뺄 수 없습니다.' });
    }
    const removed = round.attachments[index];
    round.attachments.splice(index, 1);
    // 남은 서류만으로 금액을 다시 더한다. 서류를 뺐는데 금액이 남아 있으면 청구액이 맞지 않는다.
    recalcAfterRemoval(round);
    await schedule.save();
    // 캘린더에 걸린 납부기한도 지운다. 없는 고지서의 기한이 캘린더에 남으면 헛일을 한다.
    await Schedule.deleteOne({ 'source.key': noticeKeyOf(removed, schedule._id, round.no) });
    res.json({
      success: true,
      round,
      message: `${removed.fileName}을(를) 목록에서 뺐습니다. 저장된 파일은 그대로 있습니다.`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 고지서 한 건의 단계를 바꾼다.
 *
 * 한 건씩 누를 때와 여러 건을 한꺼번에 처리할 때가 같은 규칙을 써야 한다.
 * 규칙이 두 벌이면 한쪽만 고쳐 놓고 왜 결과가 다른지 한참 찾게 된다.
 *
 * @param {object} att 고지서 첨부 (mongoose 서브도큐먼트)
 * @param {object} body 바꿀 내용 (noticeStatus, handling, driverName, driverPhone, transferAgency)
 * @returns {string} 바뀐 단계
 */
const applyNoticeStatus = (att, body = {}) => {
  // 처리 방식은 이 건만 다르게 갈 때 바꾼다
  if (NOTICE_HANDLINGS.includes(body.handling)) att.handling = body.handling;

  const status = NOTICE_STATUSES.includes(body.noticeStatus) ? body.noticeStatus : '접수';
  att.noticeStatus = status;

  // 단계마다 남겨야 할 것이 다르다. 되돌릴 수도 있어 해당하지 않는 날짜는 지운다.
  att.paidByCustomerAt = status === '납부완료' ? (att.paidByCustomerAt || new Date()) : undefined;
  att.paidByUsAt = status === '대납완료' ? (att.paidByUsAt || new Date()) : undefined;
  att.transferDoneAt = status === '변경완료' ? (att.transferDoneAt || new Date()) : undefined;

  if (body.driverName !== undefined) att.driverName = String(body.driverName).trim();
  if (body.driverPhone !== undefined) att.driverPhone = String(body.driverPhone).trim();
  if (body.transferAgency !== undefined) {
    att.transferAgency = String(body.transferAgency).trim();
    if (att.transferAgency && !att.transferSentAt) att.transferSentAt = new Date();
  }
  return status;
};

/** 캘린더에 걸린 납부기한 일정을 단계에 맞춘다. 우리 손을 떠난 건은 더 챙길 일이 없다. */
const syncNoticeSchedule = (att, scheduleId, roundNo, status) => Schedule.updateOne(
  { 'source.key': noticeKeyOf(att, scheduleId, roundNo) },
  { $set: { status: ['납부완료', '변경완료', '대납완료'].includes(status) ? '완료' : '예정' } }
);

/**
 * 서류를 뺀 뒤 회차 금액을 다시 맞춘다.
 *
 * 손으로 넣은 금액이 남아 있으면 서류를 지웠는데도 청구액이 그대로다.
 * 그 종류의 서류가 하나도 안 남았을 때만 0으로 되돌린다.
 *
 * @param {object} round 회차
 */
const recalcAfterRemoval = (round) => {
  const left = round.attachments || [];
  if (!left.some((a) => !isMaintenanceKind(a.kind) && Number(a.amount) > 0)) round.fine = 0;
  if (!left.some((a) => isMaintenanceKind(a.kind) && Number(a.amount) > 0)) round.maintenance = 0;
  recalcRound(round);
};

/**
 * 고지서를 고객이 직접 냈는지 표시한다.
 *
 * 직접 낸 건은 청구서에서 빠져야 한다. 첨부를 지우면 그 고지서가 있었다는 기록까지 사라져
 * 나중에 되짚을 수 없으므로, 지우지 않고 상태만 바꾸고 금액을 뺀다.
 * 캘린더에 걸린 납부기한 일정도 함께 닫는다.
 *
 * @route PATCH /api/billing-schedules/:id/rounds/:no/attachments/:index/notice-status
 */
export const updateAttachmentNoticeStatus = async (req, res) => {
  try {
    const schedule = await BillingSchedule.findById(req.params.id);
    if (!schedule) return res.status(404).json({ success: false, message: '회차표를 찾을 수 없습니다.' });

    const round = schedule.rounds.find((r) => r.no === Number(req.params.no));
    if (!round) return res.status(404).json({ success: false, message: '해당 회차가 없습니다.' });

    const att = round.attachments[Number(req.params.index)];
    if (!att) return res.status(404).json({ success: false, message: '해당 서류가 없습니다.' });

    if (round.issuedAt) {
      return res.status(400).json({ success: false, message: '이미 발행한 회차라 금액을 바꿀 수 없습니다.' });
    }

    const status = applyNoticeStatus(att, req.body);
    recalcRound(round);
    await schedule.save();
    await syncNoticeSchedule(att, schedule._id, round.no, status);

    const billed = !['납부완료', '변경완료'].includes(status);
    res.json({
      success: true,
      round,
      attachment: att,
      message: `${NOTICE_STATUS_MESSAGE[status] || status}로 표시했습니다.`
        + (billed ? ` ${round.no}회차 청구액에 들어갑니다.` : ` ${round.no}회차 청구액에서 뺐습니다.`)
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 고른 고지서를 한꺼번에 처리한다. 단계를 옮기거나, 목록에서 뺀다.
 *
 * 고지서는 하루에 여러 장이 한 번에 오고, 같은 법인 것이 몰려 온다. 한 건씩 누르면
 * 스무 번을 눌러야 해서 중간에 빠뜨린다. 그래서 골라서 한 번에 처리한다.
 *
 * 지울 때 조심할 것이 두 가지다.
 * 1) 순번(index)으로 지우면 앞의 것을 먼저 지운 순간 뒤의 순번이 하나씩 당겨진다.
 *    그래서 같은 회차 안에서는 큰 순번부터 지운다.
 * 2) 이미 발행한 회차는 건드리지 않는다. 고객이 받은 청구서 금액과 장부가 어긋난다.
 *    막힌 건은 세어서 알려 준다. 조용히 넘기면 지운 줄 알고 넘어간다.
 *
 * 저장된 파일은 지우지 않는다. 목록에서만 뺀다. 잘못 뺐을 때 되찾을 길이 있어야 한다.
 *
 * @route POST /api/billing-schedules/notices/bulk
 */
export const bulkUpdateNotices = async (req, res) => {
  try {
    const action = req.body.action === 'delete' ? 'delete' : 'status';
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ success: false, message: '고른 고지서가 없습니다.' });
    }
    // 한 번에 너무 많이 보내면 실수로 전체를 지우는 일이 생긴다. 화면에서 보이는 만큼이면 넉넉하다.
    if (items.length > 300) {
      return res.status(400).json({ success: false, message: '한 번에 300건까지만 처리할 수 있습니다.' });
    }

    // 회차표 하나를 여러 번 읽고 저장하면 나중 저장이 앞의 것을 덮는다. 회차표별로 모은다.
    const bySchedule = new Map();
    for (const it of items) {
      const key = String(it.scheduleId || '');
      const no = Number(it.roundNo);
      const index = Number(it.index);
      if (!key || Number.isNaN(no) || Number.isNaN(index)) continue;
      if (!bySchedule.has(key)) bySchedule.set(key, []);
      bySchedule.get(key).push({ no, index, noticeStatus: it.noticeStatus, handling: it.handling });
    }

    let done = 0;
    let issuedBlocked = 0;
    let missing = 0;
    const calendarUpdates = [];

    for (const [scheduleId, rows] of bySchedule) {
      const schedule = await BillingSchedule.findById(scheduleId);
      if (!schedule) { missing += rows.length; continue; }

      // 회차별로 나눈다. 지울 때 순번이 당겨지는 문제는 회차 안에서만 생긴다.
      const byRound = new Map();
      for (const r of rows) {
        if (!byRound.has(r.no)) byRound.set(r.no, []);
        byRound.get(r.no).push(r);
      }

      let touched = false;
      for (const [no, list] of byRound) {
        const round = schedule.rounds.find((r) => r.no === no);
        if (!round) { missing += list.length; continue; }
        if (round.issuedAt) { issuedBlocked += list.length; continue; }

        if (action === 'delete') {
          // 큰 순번부터 지운다. 작은 것부터 지우면 뒤의 순번이 당겨져 엉뚱한 것이 지워진다.
          const sorted = [...list].sort((a, b) => b.index - a.index);
          for (const r of sorted) {
            const att = round.attachments[r.index];
            if (!att) { missing += 1; continue; }
            calendarUpdates.push({ del: noticeKeyOf(att, schedule._id, no) });
            round.attachments.splice(r.index, 1);
            done += 1;
            touched = true;
          }
          if (touched) recalcAfterRemoval(round);
        } else {
          for (const r of list) {
            const att = round.attachments[r.index];
            if (!att) { missing += 1; continue; }
            // 단계는 건마다 다르다. 방식이 달라 '완료'가 뜻하는 단계가 다르기 때문이다.
            const status = applyNoticeStatus(att, {
              noticeStatus: r.noticeStatus || req.body.noticeStatus,
              handling: r.handling || req.body.handling
            });
            calendarUpdates.push({ att, scheduleId: schedule._id, no, status });
            done += 1;
            touched = true;
          }
          if (touched) recalcRound(round);
        }
      }

      if (touched) await schedule.save();
    }

    // 캘린더는 회차표를 다 저장한 뒤에 맞춘다. 저장이 실패하면 캘린더만 바뀌어 어긋난다.
    for (const u of calendarUpdates) {
      if (u.del) await Schedule.deleteOne({ 'source.key': u.del });
      else await syncNoticeSchedule(u.att, u.scheduleId, u.no, u.status);
    }

    const parts = [];
    if (done) parts.push(action === 'delete' ? `${done}건을 목록에서 뺐습니다.` : `${done}건을 처리했습니다.`);
    if (issuedBlocked) parts.push(`${issuedBlocked}건은 이미 발행한 회차라 그대로 두었습니다.`);
    if (missing) parts.push(`${missing}건은 찾지 못했습니다. 새로고침 후 다시 골라 주세요.`);
    if (action === 'delete' && done) parts.push('저장된 파일은 그대로 있습니다.');

    res.json({
      success: done > 0,
      done,
      issuedBlocked,
      missing,
      message: parts.join(' ') || '처리한 건이 없습니다.'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 고지서 안내 메일을 보낸다.
 *
 * 고지서가 오면 청구서에 얹기 전에 먼저 고객에게 알린다. 기한 안에 직접 내면 청구하지 않고,
 * 안 내면 다음 달 렌트료에 합산된다. 그 순서를 지키려면 안내가 먼저 나가야 한다.
 *
 * 받는 곳은 계약서에 적어 둔 범칙금 전용 메일(finesEmail)이다. 청구 담당과 범칙금 담당이
 * 다른 법인이 많아 청구서 메일 주소로 보내면 담당자에게 닿지 않는다.
 *
 * @route POST /api/billing-schedules/:id/rounds/:no/attachments/:index/notify
 */
export const sendNoticeMail = async (req, res) => {
  try {
    const schedule = await BillingSchedule.findById(req.params.id)
      .populate('company', 'name')
      .populate('customer', 'name')
      .populate('contract', 'contractNo leaseCompany finesEmail finesEmail2 fineHandling');
    if (!schedule) return res.status(404).json({ success: false, message: '회차표를 찾을 수 없습니다.' });

    const round = schedule.rounds.find((r) => r.no === Number(req.params.no));
    if (!round) return res.status(404).json({ success: false, message: '해당 회차가 없습니다.' });

    const att = round.attachments[Number(req.params.index)];
    if (!att) return res.status(404).json({ success: false, message: '해당 서류가 없습니다.' });

    // 같은 고지서를 두 번 보내면 법인이 이중 청구로 오해한다. 다시 보내려면 뜻을 밝혀야 한다.
    if (att.noticeMailSentAt && String(req.body.resend) !== 'true') {
      return res.status(409).json({
        success: false,
        alreadySent: true,
        message: `${formatYmd(att.noticeMailSentAt)}에 ${att.noticeMailTo}(으)로 이미 보냈습니다. 다시 보내려면 [재발송]을 눌러 주세요.`
      });
    }

    // 처리 방식은 이 건에 정한 것이 우선, 없으면 계약에 정해 둔 것을 따른다.
    const handling = att.handling || schedule.contract?.fineHandling || '대납청구';

    // 명의 변경은 받는 곳이 고객이 아니라 관공서다. 계약의 범칙금 메일로 보내면 엉뚱한 데로 간다.
    const to = req.body.to?.trim()
      || (handling === '명의변경' ? '' : schedule.contract?.finesEmail);
    if (!to) {
      return res.status(400).json({
        success: false,
        message: handling === '명의변경'
          ? '보낼 관공서 주소를 적어 주세요. (예: 서초경찰서 · 서초구청 담당자 메일)'
          : '범칙금 E-MAIL이 등록되어 있지 않습니다. 계약서 등록에서 먼저 적어 주세요.'
      });
    }

    // 고지서 원본을 붙인다. 근거 없이 금액만 적어 보내면 법인이 그대로 되묻는다.
    const fileBuffer = await readSavedFile(att.savedPath);

    const partyName = resolvePartyName(schedule);

    // 방식마다 하려는 말이 다르다. 대납 안내와 같은 글로 보내면
    // 고객이 우리가 알아서 낸 줄 알고 그냥 두고, 관공서는 근거가 없어 반려한다.
    const TEMPLATE_BY_HANDLING = {
      대납청구: 'fine-notice',
      고객납부: 'fine-notice-driver',
      명의변경: 'fine-notice-transfer'
    };

    // 명의 변경은 계약서 사본이 있어야 접수된다. 없으면 보내되 무엇이 빠졌는지 알려 준다.
    const extraFiles = [];
    let contractDoc = null;
    if (handling === '명의변경') {
      contractDoc = await findContractDocument(partyName, schedule.contract?.contractNo);
      if (contractDoc?.buffer) {
        extraFiles.push({ fileName: contractDoc.fileName, buffer: contractDoc.buffer });
      } else {
        contractDoc = null;
      }
    }

    const sent = await sendFineNoticeMail({
      to,
      // 관공서로 보낼 때 고객의 범칙금 메일을 참조로 넣으면 안 된다.
      cc: handling === '명의변경' ? undefined : (schedule.contract?.finesEmail2 || undefined),
      templateKey: TEMPLATE_BY_HANDLING[handling] || 'fine-notice',
      fileName: att.fileName || '고지서.pdf',
      fileBuffer,
      extraFiles,
      values: {
        계약자: partyName,
        계약번호: schedule.contract?.contractNo || '',
        차량번호: att.plateNo || '',
        종류: att.kind || '',
        위반일: att.occurredAt ? formatYmd(att.occurredAt) : '-',
        금액: `${(Number(att.amount) || 0).toLocaleString()}원`,
        납부기한: att.noticeDueDate ? formatYmd(att.noticeDueDate) : '-',
        고지번호: att.noticeNo || '-',
        운전자: att.driverName || '-',
        운전자연락처: att.driverPhone || '-'
      }
    });

    att.noticeMailSentAt = new Date();
    att.noticeMailTo = to;
    // 관공서에 넘긴 날을 남긴다. 회신이 늦을 때 언제 보냈는지 댈 수 있어야 한다.
    if (handling === '명의변경') {
      if (!att.transferAgency) att.transferAgency = to;
      att.transferSentAt = att.transferSentAt || new Date();
      if (att.noticeStatus === '접수' || att.noticeStatus === '운전자확인') att.noticeStatus = '접수중';
    } else if (att.noticeStatus === '접수') {
      att.noticeStatus = '안내';
    }
    await schedule.save();

    res.json({
      success: true,
      sentAt: att.noticeMailSentAt,
      to,
      attachedFile: Boolean(fileBuffer),
      handling,
      contractDocAttached: Boolean(contractDoc),
      ...(handling === '명의변경' && !contractDoc
        ? { warning: `계약자 폴더(01.계약서)에서 계약서를 찾지 못해 고지서만 보냈습니다. ${partyName} 폴더에 계약서를 넣어 주세요.` }
        : {}),
      message: fileBuffer
        ? `${partyName} ${att.kind} 안내 메일을 ${to}(으)로 보냈습니다.`
        : `${partyName} ${att.kind} 안내 메일을 보냈습니다. (원본 파일을 찾지 못해 본문만 나갔습니다)`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 고지서 관리 화면에 뿌릴 목록.
 *
 * 계약을 가로질러 한 줄씩 모아 준다. 거르기는 화면에서 한다. 고지서는 하루 수십 장이라
 * 서버에서 미리 걸러 두면 "다른 조건으로 다시 보기"를 할 때마다 다시 불러야 한다.
 *
 * @route GET /api/billing-schedules/fine-notices
 */
export const getFineNotices = async (req, res) => {
  try {
    const items = await collectNotices();
    res.json({
      success: true,
      items,
      summary: (() => {
        // 손을 떠난 건(고객이 냈거나 명의가 넘어감)은 더 챙길 일이 없다
        const DONE = ['납부완료', '변경완료', '고객납부'];
        const open = items.filter((x) => !DONE.includes(x.noticeStatus));
        return {
          total: items.length,
          // 기한이 지났는데 아직 안 끝난 건. 어떻게 할지 사람이 정해야 한다.
          overdue: open.filter((x) => x.dday !== null && x.dday < 0).length,
          // 일주일 안에 마감되는 건. 안내할 시간이 남아 있다.
          soon: open.filter((x) => x.dday !== null && x.dday >= 0 && x.dday <= 7).length,
          paid: items.filter((x) => DONE.includes(x.noticeStatus)).length,
          // 기한을 못 읽어 추적이 안 되는 건. 사람이 채워 넣어야 한다.
          noDueDate: items.filter((x) => !x.noticeDueDate).length,
          // 처리 방식별로 몇 건인지. 방식마다 다음에 할 일이 달라 나눠서 본다.
          byHandling: NOTICE_HANDLINGS.reduce((acc, h) => {
            acc[h] = open.filter((x) => x.handling === h).length;
            return acc;
          }, {})
        };
      })()
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 납부기한이 지났는데 아직 고객이 내지 않은 고지서를 모아 준다.
 *
 * 기한이 지나면 다음 달 렌트료에 얹어 청구한다. 그 금액은 이미 회차에 붙어 있으므로
 * 여기서는 무엇이 넘어갔는지만 알려 준다. 챙길 일을 사람이 알아야 하기 때문이다.
 *
 * @route GET /api/billing-schedules/overdue-notices
 */
export const getOverdueNotices = async (req, res) => {
  try {
    const items = await findOverdueNotices(Number(req.query.days) || undefined);
    res.json({ success: true, items, total: items.reduce((sum, x) => sum + x.amount, 0) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    회차 하나의 청구 내역을 고친다 (범칙금·정비비 등)
// @route   PUT /api/billing-schedules/:id/rounds/:no
/**
 * 회차에 저장해 둔 청구서 PDF나 첨부 서류를 내려 준다. 청구서 보관함에서 "보낸 그대로" 보여 주는 데 쓴다.
 *
 * 파일은 OneDrive에 있어 브라우저가 바로 열 수 없다. 서버가 받아서 그대로 넘긴다.
 * inline으로 보내 새 창에서 바로 보이게 한다(내려받기 창을 띄우지 않는다).
 *
 * @route GET /api/billing-schedules/:id/rounds/:no/file           청구서
 * @route GET /api/billing-schedules/:id/rounds/:no/file?attachment=2 첨부 서류(순번)
 */
/**
 * 엑셀 청구서 기록의 파일. OneDrive 사본이 있으면 그것을, 없으면 드롭박스 원본 경로를 준다
 * (원본은 이 PC에서 돌린 서버만 읽을 수 있다. 운영 서버에서는 '파일 없음'이 된다).
 */
const excelInvoiceFileOf = async (scheduleId, roundNo) => {
  const inv = await ExcelInvoice.findOne({ schedule: scheduleId, roundNo }).lean();
  if (!inv) return null;
  return { savedPath: inv.savedPath || inv.sourcePath, fileName: inv.fileName };
};

export const getRoundFile = async (req, res) => {
  try {
    const schedule = await BillingSchedule.findById(req.params.id).lean();
    if (!schedule) return res.status(404).json({ success: false, message: '회차표를 찾을 수 없습니다.' });
    const round = schedule.rounds.find((r) => r.no === Number(req.params.no));
    if (!round) return res.status(404).json({ success: false, message: '해당 회차가 없습니다.' });

    const index = req.query.attachment;
    // ?excel=1 이면 엑셀로 보냈던 청구서 사본(excelInvoice)을 연다
    const target = index !== undefined
      ? (round.attachments || [])[Number(index)]
      : (req.query.excel
        ? await excelInvoiceFileOf(schedule._id, round.no)
        : { savedPath: round.invoiceSavedPath, fileName: round.invoiceFileName });
    if (!target?.savedPath) {
      return res.status(404).json({ success: false, message: '이 회차에 저장된 파일이 없습니다.' });
    }

    const buffer = await readSavedFile(target.savedPath);
    if (!buffer) {
      return res.status(410).json({ success: false, message: '파일이 OneDrive에서 옮겨졌거나 지워져 열 수 없습니다.' });
    }

    const fileName = target.fileName || 'file';
    res.setHeader('Content-Type', mimeTypeOf(fileName));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateRound = async (req, res) => {
  try {
    const schedule = await BillingSchedule.findById(req.params.id);
    if (!schedule) {
      return res.status(404).json({ success: false, message: '회차표를 찾을 수 없습니다.' });
    }
    const round = schedule.rounds.find((r) => r.no === Number(req.params.no));
    if (!round) {
      return res.status(404).json({ success: false, message: '해당 회차가 없습니다.' });
    }

    ['prevUnpaid', 'prevOverpaid', 'interest', 'fine', 'maintenance', 'other', 'monthlyRent']
      .forEach((field) => {
        if (req.body[field] !== undefined) round[field] = Number(req.body[field]) || 0;
      });
    if (req.body.note !== undefined) round.note = req.body.note;
    if (req.body.status !== undefined) round.status = req.body.status;

    // 기타 청구는 항목명과 금액을 함께 받는다. 금액이 0이고 이름도 없는 줄은 버린다.
    if (Array.isArray(req.body.extras)) {
      round.extras = req.body.extras
        .filter((e) => (e.label || '').trim() || Number(e.amount))
        .map((e) => ({ label: (e.label || '').trim() || '기타 청구', amount: Number(e.amount) || 0 }));
    }

    // 연체 이자를 무엇으로 계산했는지 남긴다. 요율이 바뀌어도 지난 청구서를 설명할 수 있어야 한다.
    if (req.body.interestRate !== undefined) round.interestRate = Number(req.body.interestRate) || 0;
    if (req.body.interestDays !== undefined) round.interestDays = Number(req.body.interestDays) || 0;

    // 합계는 항상 다시 계산한다. 사람이 따로 적어 두면 항목과 어긋난다.
    recalcRound(round);

    await schedule.save();
    res.json({ success: true, round, message: '회차 내역이 저장되었습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
