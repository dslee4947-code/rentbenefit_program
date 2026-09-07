import fs from 'fs';
import crypto from 'crypto';
import BillingSchedule from '../models/BillingSchedule.js';
import Contract from '../models/Contract.js';
import Vehicle from '../models/Vehicle.js';
import Company from '../models/Company.js';
import Schedule from '../models/Schedule.js';
import { buildDueDates, calcDailyRent, calcLateInterest, daysBetween, calcSendDate } from '../utils/billingDate.js';
import { saveToCustomerFolder, findContractDocument, readSavedFile } from '../utils/documentStorageService.js';
import { parseHistoryWorkbook, applyHistoryRows } from '../utils/billingHistoryImport.js';
import XLSX from 'xlsx';
import { sendInvoiceMail, sendFineNoticeMail } from '../utils/mailService.js';
import { isMaintenanceKind } from '../utils/maintenance.js';
import { noticeKeyOf, findOverdueNotices, upsertNoticeSchedule, collectNotices } from '../utils/fineNoticeScheduleJob.js';

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
 * 미납이 뒤 회차로 굴러가도록 다시 계산한다.
 *
 * 미납이 여러 달 이어지면 이런 식으로 쌓인다.
 *   33회차 미납 137만원
 *   34회차 = 렌트료 137만 + 전월 미결제 137만 + 이자   -> 청구 275만
 *   35회차 = 렌트료 137만 + 전월 미결제 275만 + 이자   -> 청구 415만
 * 앞 회차의 청구액 전체가 다음 회차의 미결제가 되므로, 한 회차만 고쳐도 뒤가 전부 달라진다.
 * 그래서 바뀐 회차부터 끝까지 순서대로 다시 센다.
 *
 * 이미 발행한 회차는 건드리지 않는다. 보낸 청구서 금액이 나중에 바뀌면 안 되기 때문이다.
 *
 * @param {object} schedule 회차표
 * @param {number} annualRate 연체 이율 (연 %)
 * @param {number} [fromNo] 이 회차 다음부터 다시 센다
 * @returns {number} 값이 바뀐 회차 수
 */
const applyCarryForward = (schedule, annualRate, fromNo = 0) => {
  const rounds = [...schedule.rounds].sort((a, b) => a.no - b.no);
  let changed = 0;

  for (let i = 1; i < rounds.length; i += 1) {
    const round = rounds[i];
    const prev = rounds[i - 1];
    if (round.no <= fromNo) continue;
    if (round.issuedAt) continue; // 이미 나간 청구서는 그대로 둔다

    const unpaid = prev.status === '미납'
      ? Math.max(0, (prev.total || 0) - (prev.paidAmount || 0))
      : 0;
    const interest = calcLateInterest({
      unpaid,
      annualRate,
      days: daysBetween(prev.dueDate, round.dueDate)
    });

    const before = round.total;
    round.prevUnpaid = unpaid;
    round.interest = interest;
    round.interestRate = unpaid ? annualRate : undefined;
    round.interestDays = unpaid ? daysBetween(prev.dueDate, round.dueDate) : undefined;
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
const loadLateInterestRates = async (contractIds) => {
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
      .populate('customer', 'name contactName contactPhone email')
      .lean();
    if (!schedule) {
      return res.status(404).json({ success: false, message: '회차표가 아직 없습니다.' });
    }
    const vehicles = await Vehicle.find({ contract: req.params.contractId })
      .select('code carModel plateNo monthlyFee deliveryDate')
      .lean();
    res.json({ success: true, schedule, vehicles });
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
      const unpaid = prev && prev.status === '미납'
        ? Math.max(0, (prev.total || 0) - (prev.paidAmount || 0))
        : 0;
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
        suggestedInterest: calcLateInterest({ unpaid, annualRate: lateInterestRate, days: overdueDays }),
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
    // 폴더 이름은 계약을 만들 때 정해 둔 "계약번호_차종"을 그대로 쓴다.
    // 여기서 다시 만들면 차종을 고쳤을 때 폴더가 갈려 이미 보낸 청구서를 못 찾는다.
    const contractNo = schedule.contract?.docFolderName || schedule.contract?.contractNo || '계약번호미상';
    const fileName = `${partyName}_청구서_${round.no}회차.pdf`;

    // 1) 계약자 폴더 > 02.청구서 > 계약번호 에 저장.
    //    한 법인에 계약이 여러 건이라, 계약번호로 한 단계 더 나누지 않으면
    //    5회차 청구서가 어느 계약 것인지 파일명만으로 구분되지 않는다.
    let saved;
    try {
      saved = await saveToCustomerFolder({
        partyName,
        docFolder: '02.청구서',
        subFolder: contractNo,
        fileName,
        fileBuffer: req.file.buffer,
        // 이미 메일로 보낸 회차만 이전 파일을 남긴다. 아직 안 보냈으면 최종본으로 덮어쓴다.
        keepPrevious: Boolean(round.sentAt)
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: `청구서 저장에 실패했습니다: ${err.message}` });
    }

    // 2) 메일 발송 (요청했을 때만)
    let mailResult = null;
    let mailError = null;
    if (String(req.body.sendEmail) === 'true') {
      const to = req.body.to || schedule.company?.billingEmail;

      // 담당자가 바뀌어 받는 주소를 고쳐 보냈다면, 법인에도 반영해 다음 달부터 그 주소가 기본이 되게 한다.
      // 매달 같은 주소를 다시 고쳐 넣는 일을 없앤다.
      if (String(req.body.saveEmailToCompany) === 'true' && to && schedule.company?._id
          && to !== schedule.company.billingEmail) {
        await Company.findByIdAndUpdate(schedule.company._id, { billingEmail: to });
      }
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
          fileBuffer: req.file.buffer,
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

    // 3) 회차 상태 갱신
    round.status = round.status === '입금완료' ? round.status : '청구됨';
    round.issuedAt = new Date();
    round.invoiceFileName = saved.fileName;
    round.invoiceSavedPath = saved.localPath;
    if (mailResult) round.sentAt = new Date();
    await schedule.save();

    // 캘린더에 잡아 둔 발송 일정을 끝난 것으로 바꾼다. 보낸 건이 알림에 계속 남으면 안 된다.
    await Schedule.updateMany(
      { type: '청구서발송', targetContract: schedule.contract?._id, status: '예정', dueDate: { $lte: round.dueDate } },
      { status: '완료' }
    );

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
  const suffix = plateNo ? `_${plateNo}` : (sameKind ? `_${sameKind + 1}` : '');
  const fileName = `${partyName}_청구서_${round.no}회차_${kind}${suffix}${ext}`;

  const saved = await saveToCustomerFolder({
    partyName,
    docFolder: '02.청구서',
    subFolder: contractNo,
    fileName,
    fileBuffer: req.file.buffer
  });

  // 같은 회차에 같은 파일이 이미 있으면 새로 붙이지 않고 그 자리의 값을 고친다.
  // 금액을 빠뜨리고 올린 뒤 다시 올리는 일이 잦은데, 새로 붙이면 금액이 두 번 잡힌다.
  const existing = round.attachments.find((a) => a.fileHash === fileHash);
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

    // 다른 회차에 같은 파일이 있으면 막는다. 회차를 착각해 두 번 청구되는 것을 막기 위해서다.
    // 같은 회차면 그 자리의 값을 고친다(아래 attachFileToRound가 처리한다).
    const dup = findSameFile(schedule, crypto.createHash('sha256').update(req.file.buffer).digest('hex'));
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

    // 고지서 번호가 같으면 파일이 달라도 같은 건이다. 재스캔한 고지서가 두 번 청구되는 것을 막는다.
    const sameNotice = findSameNotice(schedule, (req.body.noticeNo || '').trim());
    if (sameNotice && sameNotice.round !== round.no) {
      return res.status(409).json({
        success: false,
        duplicate: true,
        message: `고지번호 ${req.body.noticeNo} 건이 이미 ${sameNotice.round}회차에 올라가 있습니다. (${sameNotice.attachment.fileName})`
      });
    }

    // 다른 회차에 같은 파일이 있으면 막는다. 같은 회차면 그 자리의 값을 고친다.
    const dup = findSameFile(schedule, crypto.createHash('sha256').update(req.file.buffer).digest('hex'));
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
      let ready = false;
      try {
        await resolveScheduleInputs(c._id);
        ready = true;
      } catch (err) {
        reason = err.message;
      }
      missing.push({
        contractId: c._id,
        contractNo: c.contractNo,
        partyName: c.companyId?.name || c.customer?.name || '',
        ready,
        reason
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
    const removed = round.attachments[index];
    round.attachments.splice(index, 1);
    // 남은 서류만으로 금액을 다시 더한다. 서류를 뺐는데 금액이 남아 있으면 청구액이 맞지 않는다.
    const left = round.attachments || [];
    if (!left.some((a) => !isMaintenanceKind(a.kind) && Number(a.amount) > 0)) round.fine = 0;
    if (!left.some((a) => isMaintenanceKind(a.kind) && Number(a.amount) > 0)) round.maintenance = 0;
    recalcRound(round);
    await schedule.save();
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

    // 처리 방식은 이 건만 다르게 갈 때 바꾼다
    if (NOTICE_HANDLINGS.includes(req.body.handling)) att.handling = req.body.handling;

    const status = NOTICE_STATUSES.includes(req.body.noticeStatus) ? req.body.noticeStatus : '접수';
    att.noticeStatus = status;

    // 단계마다 남겨야 할 것이 다르다. 되돌릴 수도 있어 해당하지 않는 날짜는 지운다.
    att.paidByCustomerAt = status === '납부완료' ? (att.paidByCustomerAt || new Date()) : undefined;
    att.paidByUsAt = status === '대납완료' ? (att.paidByUsAt || new Date()) : undefined;
    att.transferDoneAt = status === '변경완료' ? (att.transferDoneAt || new Date()) : undefined;

    if (req.body.driverName !== undefined) att.driverName = String(req.body.driverName).trim();
    if (req.body.driverPhone !== undefined) att.driverPhone = String(req.body.driverPhone).trim();
    if (req.body.transferAgency !== undefined) {
      att.transferAgency = String(req.body.transferAgency).trim();
      if (att.transferAgency && !att.transferSentAt) att.transferSentAt = new Date();
    }

    recalcRound(round);
    await schedule.save();

    // 캘린더 일정도 맞춘다. 우리 손을 떠난 건은 더 챙길 일이 없다.
    const done = ['납부완료', '변경완료', '대납완료'].includes(status);
    await Schedule.updateOne(
      { 'source.key': noticeKeyOf(att, schedule._id, round.no) },
      { $set: { status: done ? '완료' : '예정' } }
    );

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
