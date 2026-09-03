import fs from 'fs';
import BillingSchedule from '../models/BillingSchedule.js';
import Contract from '../models/Contract.js';
import Vehicle from '../models/Vehicle.js';
import Company from '../models/Company.js';
import Schedule from '../models/Schedule.js';
import { buildDueDates, calcDailyRent, calcLateInterest, daysBetween, calcSendDate } from '../utils/billingDate.js';
import { saveToCustomerFolder } from '../utils/documentStorageService.js';
import { sendInvoiceMail } from '../utils/mailService.js';

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

// 서류 종류별로 어느 청구 항목에 합산되는지. 통행료도 결국 차를 쓴 사람이 내는 돈이라 범칙금과 같이 묶는다.
const FINE_KINDS = ['범칙금', '과태료', '통행료'];
const MAINTENANCE_KINDS = ['정비내역'];

/**
 * 회차 금액을 다시 계산한다.
 *
 * 서류(범칙금 고지서 등)에 금액을 적어 두면 그 합계가 청구 금액이 된다.
 * 한 달에 고지서가 서너 장 오면 사람이 더해 넣다가 틀리는 일이 가장 잦았다.
 * 금액을 적지 않고 서류만 올린 경우에는 손으로 넣은 값을 건드리지 않는다.
 *
 * @param {object} round 회차 (mongoose 서브도큐먼트)
 */
const recalcRound = (round) => {
  const atts = round.attachments || [];
  const sumOf = (kinds) => atts
    .filter((a) => kinds.includes(a.kind))
    .reduce((sum, a) => sum + (Number(a.amount) || 0), 0);
  const hasAmount = (kinds) => atts.some((a) => kinds.includes(a.kind) && Number(a.amount) > 0);

  if (hasAmount(FINE_KINDS)) round.fine = sumOf(FINE_KINDS);
  if (hasAmount(MAINTENANCE_KINDS)) round.maintenance = sumOf(MAINTENANCE_KINDS);

  // 기타 청구는 항목명을 적을 수 있게 배열로 두고, other는 그 합계로 유지한다(청구서 양식·합계식은 그대로).
  if ((round.extras || []).length) {
    round.other = round.extras.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }

  round.total = (round.monthlyRent || 0) + (round.prevUnpaid || 0) + (round.interest || 0)
    + (round.fine || 0) + (round.maintenance || 0) + (round.other || 0) - (round.prevOverpaid || 0);
  return round;
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
export const resolveScheduleInputs = async (contractId) => {
  const contract = await Contract.findById(contractId).lean();
  if (!contract) throw new Error('계약을 찾을 수 없습니다.');

  const vehicles = await Vehicle.find({ contract: contractId }).lean();
  if (!vehicles.length) throw new Error('이 계약에 묶인 차량이 없습니다.');

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

  if (!paymentDay) throw new Error('월 대여료 결제일이 정해지지 않았습니다. 출고 준비에서 먼저 지정해 주세요.');
  if (!rentStartDate && !deliveryDate) throw new Error('렌트료 개시일 또는 인도일이 없어 청구일을 정할 수 없습니다.');

  const totalRounds = contract.termMonths || vehicles[0]?.paymentTerm || 0;
  if (!totalRounds) throw new Error('계약 기간이 없어 회차를 만들 수 없습니다.');

  // 렌트료를 완납해서 매달 받을 돈이 없는 계약이 있다. 0원짜리 청구서를 매달 만들어 두면
  // 청구 대상 목록에 계속 뜨면서 실제로 보낼 건과 섞인다.
  if (!monthlyRent) throw new Error('월 렌트료가 0원이라 회차표를 만들지 않았습니다. (완납 등 청구가 필요 없는 계약)');

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

      items.push({
        scheduleId: s._id,
        contract: s.contract,
        company: s.company,
        customer: s.customer,
        totalRounds: s.totalRounds,
        monthlyRent: s.monthlyRent,
        dailyRent: s.dailyRent,
        lateInterestRate,
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
      saved = saveToCustomerFolder({
        partyName,
        docFolder: '02.청구서',
        subFolder: contractNo,
        fileName,
        fileBuffer: req.file.buffer
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
          try {
            if (att.savedPath && fs.existsSync(att.savedPath)) {
              extraFiles.push({ fileName: att.fileName, buffer: fs.readFileSync(att.savedPath) });
            }
          } catch { /* 읽지 못한 서류는 건너뛴다 */ }
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
const attachFileToRound = async (schedule, round, req) => {
  const kind = (req.body.kind || '기타').trim();
  const amount = Number(req.body.amount) || 0;
  const plateNo = (req.body.plateNo || '').trim();
  const occurredAt = req.body.occurredAt ? new Date(req.body.occurredAt) : undefined;

  const partyName = resolvePartyName(schedule);
  const contractNo = schedule.contract?.docFolderName || schedule.contract?.contractNo || '계약번호미상';
  const ext = (req.file.originalname.match(/\.[^.]+$/) || ['.pdf'])[0];

  // 같은 종류가 여러 건 올 수 있다(범칙금 3장 등). 어느 차 건인지가 제일 먼저 필요한 정보라
  // 차량번호를 이름에 넣고, 차량번호가 없으면 같은 종류의 몇 번째인지를 붙인다.
  const sameKind = (round.attachments || []).filter((a) => a.kind === kind).length;
  const suffix = plateNo ? `_${plateNo}` : (sameKind ? `_${sameKind + 1}` : '');
  const fileName = `${partyName}_청구서_${round.no}회차_${kind}${suffix}${ext}`;

  const saved = saveToCustomerFolder({
    partyName,
    docFolder: '02.청구서',
    subFolder: contractNo,
    fileName,
    fileBuffer: req.file.buffer
  });

  round.attachments.push({
    kind,
    amount,
    plateNo,
    occurredAt,
    fileName: saved.fileName,
    savedPath: saved.localPath,
    uploadedAt: new Date()
  });
  recalcRound(round); // 서류 금액이 범칙금·정비 항목에 바로 합산된다
  await schedule.save();

  return { kind, saved, attachment: round.attachments[round.attachments.length - 1] };
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

    const { kind, saved, attachment } = await attachFileToRound(schedule, round, req);
    res.json({ success: true, attachment, round, message: `${kind} 서류를 올렸습니다. (${saved.fileName})` });
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

    const { kind, saved, attachment } = await attachFileToRound(schedule, round, req);
    res.json({
      success: true,
      attachment,
      roundNo: round.no,
      dueDate: round.dueDate,
      sendDate: calcSendDate(round.dueDate),
      message: `${kind} 서류를 ${round.no}회차(출금일 ${formatYmd(round.dueDate)}) 청구서에 붙였습니다.`
    });
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

    const items = schedules.map((s) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const pending = (s.rounds || []).filter((r) => r.status === '예정');
      const next = pending.find((r) => new Date(r.dueDate) >= today) || pending[0] || null;
      return {
        scheduleId: s._id,
        contractId: s.contract?._id,
        contractNo: s.contract?.contractNo,
        partyName: s.company?.name || s.customer?.name || '',
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
    if (!(round.attachments || []).some((a) => Number(a.amount) > 0)) {
      if (FINE_KINDS.includes(removed.kind)) round.fine = 0;
      if (MAINTENANCE_KINDS.includes(removed.kind)) round.maintenance = 0;
    }
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
