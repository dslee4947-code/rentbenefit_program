import Contract from '../models/Contract.js';
import Vehicle from '../models/Vehicle.js';
import Company from '../models/Company.js';
import Customer from '../models/Customer.js';
import Schedule from '../models/Schedule.js';
import BillingSchedule from '../models/BillingSchedule.js';
import VehicleLedger from '../models/VehicleLedger.js';
import { buildScheduleForContract } from './billingScheduleController.js';
import { appendContractPeriod, syncLedgerEntries } from './ledgerController.js';
import { buildSchedules, generateContractNo } from './contractController.js';
import { ensureCustomerFolders, ensureContractFolder, buildContractFolderName } from '../utils/documentStorageService.js';
import { nextPaymentDate } from '../utils/billingDate.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';
import { saveSignedFile } from './contractSignedController.js';

/**
 * 계약의 만기 처리 — 연장.
 *
 * 차는 한 대에 기록 하나, 계약은 그 차에 순서대로 이어 붙인다.
 * 연장은 이전 계약을 '종료(연장)'로 닫고, 같은 차량에 새 계약(…-1, -2)을 붙인다.
 * 이전 계약의 회차·입금은 그대로 남는다. 예전처럼 계약일을 고쳐 쓰면 최초 계약의 회차가 사라지고,
 * 원장의 입금이 엉뚱한 회차에 붙었다(2026-10-04, 재계약 4건에서 93회차).
 *
 * 반납·재렌트·인수는 다음 단계에서 이 파일에 붙인다.
 */

const DAY = 24 * 60 * 60 * 1000;
const addDays = (date, days) => new Date(new Date(date).getTime() + days * DAY);

/**
 * 연장 기본 시작일.
 *
 * 계약의 endDate는 '계약일 + 기간'이라(2027-03-01 + 24개월 = 2029-03-01) 이미 계약 기간 다음 날이다.
 * 여기에 하루를 더하면 3월 1일 하루가 빈다. 그래서 endDate 그날을 연장 시작일로 쓴다.
 */
const defaultStartOf = (prev) => (prev.endDate ? new Date(prev.endDate) : null);

/** 두 날짜 사이 개월 수(한국 날짜 기준). 2021-10-28 → 2026-10-28 = 60, 2026-04-27이면 53 */
const monthsBetween = (from, to) => {
  const kst = (d) => new Date(new Date(d).getTime() + 9 * 3600e3);
  const a = kst(from); const b = kst(to);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
    - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
};

/** 계약자 이름. 폴더와 활동 기록에 쓴다. */
const partyNameOf = async (contract) => (contract.companyId
  ? (await Company.findById(contract.companyId).select('name').lean())?.name
  : (await Customer.findById(contract.customer).select('name').lean())?.name) || '';

/**
 * 연장 계약번호. 최초 계약번호 뒤에 -1, -2를 붙인다(대표님 결정 2026-10-05).
 * 연장의 연장이면 뿌리 번호는 그대로 두고 순번만 늘린다(22040024-1 → 22040024-2).
 */
const extensionNumberOf = async (prev) => {
  const base = prev.baseContractNo || prev.contractNo;
  let seq = (prev.extensionSeq || 0) + 1;
  // 손으로 만든 번호와 겹치면 다음 순번을 쓴다
  // eslint-disable-next-line no-await-in-loop
  while (await Contract.exists({ contractNo: `${base}-${seq}` })) seq += 1;
  return { base, seq, contractNo: `${base}-${seq}` };
};

const EXTENDABLE = ['진행중', '보관됨'];

/**
 * 계약을 닫는다. 연장·반납·인수가 모두 이 함수를 지난다.
 *
 * 계약은 지우지 않고 '종료'로 둔다. 회차표·입금·서류가 이 계약을 가리킨다.
 * 끝난 날 뒤에 출금일이 오는 회차 중 아직 청구하지 않은 것은 정리한다(그 기간은 다음 계약이 맡거나 계약이 없다).
 * 이미 발행했거나 입금된 회차는 그대로 둔다.
 *
 * @param {import('mongoose').Document} contract 닫을 계약
 * @param {'연장'|'반납'|'인수'|'매각'} reason
 * @param {Date} lastDay 계약이 실제로 끝난 날
 * @param {object} [options]
 * @param {number} [options.keepRounds] 남길 회차 수(계약이 실제로 간 개월 수). 주면 출금일 대신 회차 수로 정리한다.
 *   연장에서 쓴다 — 렌트료를 다음 달 5일에 받는 계약은 마지막 회차 출금일이 계약 종료일 뒤라(신흥정보통신 60회 11/5,
 *   계약 종료 10/28) 출금일로 자르면 마지막 달 렌트료가 빠진다.
 * @returns {Promise<number>} 정리한 회차 수
 */
export const closeContract = async (contract, reason, lastDay, { keepRounds } = {}) => {
  const firstUncovered = addDays(lastDay, 1);
  contract.status = '종료';
  contract.endReason = reason;
  contract.actualEndDate = lastDay;
  await contract.save();

  let dropped = 0;
  const schedule = await BillingSchedule.findOne({ contract: contract._id });
  if (schedule) {
    const covered = (r) => (keepRounds !== undefined ? r.no <= keepRounds : new Date(r.dueDate) < firstUncovered);
    const keep = schedule.rounds.filter((r) => r.issuedAt || r.status !== '예정' || covered(r));
    dropped = schedule.rounds.length - keep.length;
    if (dropped) {
      schedule.rounds = keep;
      schedule.totalRounds = keep.length;
      await schedule.save();
    }
  }
  // 끝난 뒤의 정기점검·검사·렌트만료 일정은 지운다(다음 계약이 있으면 그 계약 기준으로 다시 만든다)
  await Schedule.deleteMany({
    targetContract: contract._id, status: '예정', dueDate: { $gte: firstUncovered },
    type: { $in: ['정기점검', '차량검사', '렌트만료'] }
  });
  return dropped;
};

/** 갑지의 지금 구간 번호 */
const currentSeqOf = (ledger) => (ledger.contractPeriods?.length ? Math.max(...ledger.contractPeriods.map((p) => p.seq)) : 1);

/** 사람이 확인한 정산 금액을 갑지에 한 줄 넣는다. 자동 연동이 덮지 않도록 잠가 둔다. */
const addSettlementEntry = (ledger, { side, category, label, amount, date }) => {
  if (!(Number(amount) > 0)) return;
  ledger.entries.push({
    side,
    group: side === '입금' ? '고객입금' : '회사출금',
    category,
    label,
    amount: Number(amount),
    date,
    periodSeq: currentSeqOf(ledger),
    source: 'manual',
    locked: true
  });
};

/**
 * 연장 화면을 열 때 미리 채울 값.
 * @route GET /api/contracts/:id/extension-preview
 */
export const getExtensionPreview = async (req, res) => {
  try {
    const prev = await Contract.findById(req.params.id).lean();
    if (!prev) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    if (!EXTENDABLE.includes(prev.status)) {
      return res.status(400).json({ success: false, message: `${prev.status} 상태의 계약은 연장할 수 없습니다.` });
    }
    const vehicles = await Vehicle.find({ contract: prev._id })
      .select('carModel plateNo monthlyFee takeoverPrice monthlyPaymentDay')
      .lean();
    const { contractNo } = await extensionNumberOf(prev);
    res.json({
      success: true,
      contractNo,
      partyName: await partyNameOf(prev),
      previous: {
        _id: prev._id,
        contractNo: prev.contractNo,
        contractDate: prev.contractDate,
        endDate: prev.endDate,
        termMonths: prev.termMonths,
        deposit: prev.pricing?.deposit || 0,
        takeoverPrice: prev.pricing?.takeoverPrice || 0
      },
      startDate: defaultStartOf(prev) || new Date(),
      vehicles
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 계약을 연장한다.
 *
 * body: {
 *   startDate,            연장 시작일 (기본: 이전 계약 기간이 끝난 다음 날 = endDate)
 *   termMonths,           연장 기간(개월)
 *   vehicles: [{ vehicleId, monthlyFee, takeoverPrice }],  차량별 새 조건 (계약에 묶인 차 전부)
 *   advancePayment,       연장 때 새로 받는 선납금(있으면)
 *   note
 * }
 *
 * 보증금: 연장은 계약자가 같으므로 이전 보증금을 그대로 승계한다(대표님 결정 2026-10-05).
 *
 * @route POST /api/contracts/:id/extend
 */
export const extendContract = async (req, res) => {
  try {
    // 서명 완료본 PDF를 함께 올리면 multipart로 오고, 나머지 값은 payload(JSON 글자)에 담겨 온다
    const body = typeof req.body?.payload === 'string' ? JSON.parse(req.body.payload) : (req.body || {});

    /**
     * 연장은 서명 완료본이 있어야 청구서·원장에 반영한다(대표님 2026-10-26, 계약 연장 절차 1차).
     * 서명이 늦어 첫 청구가 먼저 나가야 할 때만 관리자가 사유를 적고 먼저 반영할 수 있다(나중에 계약 화면에서 완료본을 올린다).
     */
    const signedFile = req.file || null;
    if (signedFile && !(/\.pdf$/i.test(signedFile.originalname || '') || signedFile.mimetype === 'application/pdf')) {
      return res.status(400).json({ success: false, message: '서명 완료본은 PDF 파일만 올릴 수 있습니다.' });
    }
    const overrideReason = String(body.signedOverrideReason || '').trim();
    if (!signedFile) {
      if (!overrideReason) {
        return res.status(400).json({ success: false, message: '서명 완료본(모두싸인에서 받은 PDF)을 올려 주세요. 서명 전에 먼저 반영해야 하면 관리자가 사유를 적어 주세요.' });
      }
      if (req.user?.role !== 'admin') {
        return res.status(403).json({ success: false, message: '서명 완료본 없이 먼저 반영하는 것은 관리자(대표님)만 할 수 있습니다.' });
      }
    }

    const prev = await Contract.findById(req.params.id);
    if (!prev) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    if (!EXTENDABLE.includes(prev.status)) {
      return res.status(400).json({ success: false, message: `${prev.status} 상태의 계약은 연장할 수 없습니다.` });
    }

    const termMonths = Number(body.termMonths);
    if (!termMonths || termMonths < 1) {
      return res.status(400).json({ success: false, message: '연장 기간(개월)을 입력해 주세요.' });
    }
    const startDate = body.startDate ? new Date(body.startDate) : defaultStartOf(prev);
    if (!startDate || Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ success: false, message: '연장 시작일을 입력해 주세요.' });
    }
    if (prev.contractDate && startDate <= prev.contractDate) {
      return res.status(400).json({ success: false, message: '연장 시작일이 이전 계약일보다 뒤여야 합니다.' });
    }

    const vehicles = await Vehicle.find({ contract: prev._id });
    if (!vehicles.length) {
      return res.status(400).json({ success: false, message: '이 계약에 묶인 차량이 없어 연장할 수 없습니다.' });
    }
    // 한 계약에 묶인 차는 함께 연장한다. 일부만 연장하면 이전 계약이 반쯤 살아 있게 된다(그런 경우는 반납 처리로 따로 뺀다).
    const input = new Map((body.vehicles || []).map((v) => [String(v.vehicleId), v]));
    const missing = vehicles.filter((v) => !input.has(String(v._id)));
    if (missing.length) {
      return res.status(400).json({
        success: false,
        message: `계약에 묶인 차량 ${vehicles.length}대의 조건을 모두 넣어 주세요. 빠진 차: ${missing.map((v) => v.plateNo || v.carModel).join(', ')}`
      });
    }
    const feeOf = (v) => Number(input.get(String(v._id)).monthlyFee) || 0;
    if (vehicles.some((v) => feeOf(v) <= 0)) {
      return res.status(400).json({ success: false, message: '차량마다 연장 월 렌트료를 입력해 주세요.' });
    }

    const { base, seq, contractNo } = await extensionNumberOf(prev);
    const firstVehicleInput = input.get(String(vehicles[0]._id));

    // 1) 새 계약. 계약자·담당·조건은 이전 계약을 잇고, 돈과 기간만 새로 받는다.
    const prevObj = prev.toObject();
    const next = new Contract({
      contractNo,
      contractKind: '연장',
      previousContract: prev._id,
      baseContractNo: base,
      extensionSeq: seq,
      customer: prev.customer,
      partyType: prev.partyType,
      companyId: prev.companyId,
      leaseCompany: prev.leaseCompany,
      contractDate: startDate,
      deliveryDate: prev.deliveryDate,
      termMonths,
      branch: prev.branch,
      managerMain: prev.managerMain,
      managerMainPhone: prev.managerMainPhone,
      managerOps: prev.managerOps,
      managerOpsPhone: prev.managerOpsPhone,
      finesEmail: prev.finesEmail,
      finesEmail2: prev.finesEmail2,
      fineHandling: prev.fineHandling,
      corporateRegistrationNo: prev.corporateRegistrationNo,
      terms: prevObj.terms,
      pricing: {
        ...(prevObj.pricing || {}),
        monthlyFee: feeOf(vehicles[0]),
        takeoverPrice: Number(firstVehicleInput.takeoverPrice) || 0,
        advancePayment: Number(body.advancePayment) || 0,
        deposit: prevObj.pricing?.deposit || 0, // 승계
        paymentTerm: termMonths
      },
      depositCarriedOver: true,
      vehicles: vehicles.map((v) => v._id),
      vehicle: vehicles[0]._id,
      status: '진행중',
      signedOverride: signedFile ? undefined : { by: req.user?.name || req.user?.email || '', at: new Date(), reason: overrideReason }
    });
    const saved = await next.save(); // pre-save가 endDate를 계산한다

    // 서명 완료본을 새 계약 폴더에 저장한다. 저장하지 못하면 연장을 멈추고 새 계약을 지운다(이전 계약은 아직 손대지 않았다)
    if (signedFile) {
      try {
        // 계약 폴더 이름을 먼저 정한다. 차량이 아직 이전 계약에 붙어 있어 saveSignedFile이 차종 없이 이름을 지으면
        // 아래 6)에서 만드는 계약 폴더('…-1_Ray Van_3대')와 다른 폴더에 들어간다
        saved.docFolderName = await buildContractFolderName(saved.contractNo, vehicles);
        await saveSignedFile(saved, signedFile.buffer, { by: req.user?.name || req.user?.email || '', note: '연장 계약 서명 완료본' });
      } catch (err) {
        await Contract.deleteOne({ _id: saved._id });
        return res.status(500).json({ success: false, message: `서명 완료본을 저장하지 못해 연장하지 않았습니다: ${err.message}` });
      }
    }

    // 2) 이전 계약을 닫는다. 이전 계약이 실제로 간 개월 수만큼 회차를 남기고, 만기 전 연장이면 남은 미청구 회차는 새 계약이 대신한다.
    const keepRounds = prev.contractDate ? Math.max(0, monthsBetween(prev.contractDate, startDate)) : undefined;
    const droppedRounds = await closeContract(prev, '연장', addDays(startDate, -1), { keepRounds });

    // 3) 차량은 새로 만들지 않고 새 계약에 붙인다.
    //    연장 1회차는 이전 계약의 마지막 회차 다음 달 결제일이다(대표님 2026-10-26). 시작일 다음 첫 결제일로 잡으면
    //    렌트료를 다음 달에 받는 계약은 이전 계약 마지막 회차와 같은 날 두 번 청구된다(신흥정보통신 21100001-1: 둘 다 11/5).
    const prevSchedule = await BillingSchedule.findOne({ contract: prev._id }).select('rounds.no rounds.dueDate monthlyRent').lean();
    // 청구서에 "1회 (연장 계약 · 이전 계약 60회 다음)"을 찍을 수 있게 이전 계약의 마지막 모습을 남긴다
    await Contract.updateOne({ _id: saved._id }, { $set: { extensionInfo: {
      previousContractNo: prev.contractNo,
      previousLastRound: (prevSchedule?.rounds || []).reduce((m, r) => Math.max(m, r.no || 0), 0) || undefined,
      previousMonthlyRent: Number(prevSchedule?.monthlyRent) || undefined
    } } });
    const prevLastDue = (prevSchedule?.rounds || []).map((r) => new Date(r.dueDate)).filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => b - a)[0];
    const firstDueOf = (day) => {
      const fromStart = nextPaymentDate(startDate, day);
      if (!prevLastDue || !fromStart || fromStart > prevLastDue) return fromStart;
      return nextPaymentDate(addDays(prevLastDue, 1), day);
    };
    for (const v of vehicles) {
      const vin = input.get(String(v._id));
      v.contract = saved._id;
      v.monthlyFee = feeOf(v);
      v.takeoverPrice = Number(vin.takeoverPrice) || 0;
      if (v.monthlyPaymentDay) v.rentBillingDate = firstDueOf(v.monthlyPaymentDay);
      if (v.status === '계약중' || v.status === '거래완료') v.status = '장기렌트';
      // eslint-disable-next-line no-await-in-loop
      await v.save();
    }

    // 4) 청구 회차표 — 새 계약의 1회차부터
    let billingMessage = '';
    try {
      const schedule = await buildScheduleForContract(saved._id);
      billingMessage = `청구 회차표 ${schedule.rounds.length}회차를 만들었습니다.`;
    } catch (err) {
      billingMessage = `청구 회차표는 아직 만들지 못했습니다: ${err.message}`;
    }

    // 5) 원장 — 같은 갑지에 구간을 붙인다. 보증금은 승계라 이 구간에 다시 넣지 않는다(두 번 잡힌다).
    const ledgerNotes = [];
    for (const v of vehicles) {
      // eslint-disable-next-line no-await-in-loop
      const ledger = await VehicleLedger.findOne({ vehicle: v._id });
      if (!ledger) { ledgerNotes.push(`${v.plateNo || v.carModel}: 원장이 없어 구간을 붙이지 못했습니다`); continue; }
      appendContractPeriod(ledger, saved.toObject(), { note: '연장 · 보증금 승계', deposit: 0, monthlyRent: feeOf(v) });
      // eslint-disable-next-line no-await-in-loop
      await syncLedgerEntries(ledger);
      // eslint-disable-next-line no-await-in-loop
      await ledger.save();
    }

    // 6) 일정 · 서류 폴더 · 활동 기록
    const calendar = buildSchedules(vehicles[0]._id, saved, termMonths, saved.pricing, saved.managerOps, saved.managerMain);
    if (calendar.length) await Schedule.insertMany(calendar);

    const partyName = await partyNameOf(saved);
    try {
      if (partyName) {
        const docFolderName = await buildContractFolderName(saved.contractNo, vehicles);
        await ensureContractFolder(partyName, docFolderName);
        await Contract.findByIdAndUpdate(saved._id, { customerFolder: partyName, docFolderName });
      }
    } catch (err) {
      console.log(`[계약 폴더] ${saved.contractNo}: 만들지 못했습니다 - ${err.message}`);
    }

    logActivity({
      req, dept: '계약·출고부', action: ACTIONS.CONTRACT_EXTEND,
      target: { model: 'Contract', id: saved._id },
      summary: `${partyName} ${prev.contractNo} → ${saved.contractNo} 연장 (${termMonths}개월, 월 ${feeOf(vehicles[0]).toLocaleString()}원)`,
      meta: { previous: prev.contractNo, termMonths, vehicles: vehicles.length, droppedRounds, signed: Boolean(signedFile), overrideReason: overrideReason || undefined }
    });

    const result = await Contract.findById(saved._id).populate('customer').populate('vehicles').populate('companyId', 'name');
    res.status(201).json({
      success: true,
      contract: result,
      droppedRounds,
      message: [
        `${prev.contractNo} 계약을 ${saved.contractNo}로 연장했습니다. 보증금은 그대로 승계됩니다.`,
        signedFile ? '서명 완료본을 계약 폴더에 저장했습니다.' : `서명 완료본 없이 먼저 반영했습니다(사유: ${overrideReason}). 받으면 계약 화면에서 올려 주세요.`,
        droppedRounds ? `이전 계약의 남은 ${droppedRounds}회차는 새 계약이 대신합니다.` : '',
        billingMessage,
        ...ledgerNotes
      ].filter(Boolean).join(' ')
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const parseDate = (v) => {
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
};

/**
 * 반납. 계약을 '종료(반납)'로 닫고 차를 재고로 돌린다.
 *
 * body: { returnDate, mileage, depositRefund, damageCharge, excessMileageCharge, note, nextUse: '재고' | '단기렌트' }
 *  - 보증금 반환·손상 수리비·초과 주행 정산은 원장에 사람이 확인한 줄로 넣는다.
 *  - 다음 고객이 정해질 때까지 단기렌트·사고대차로 돌리면 nextUse를 '단기렌트'로 준다.
 *    그 기간도 같은 원장에 구간으로 남긴다(대표님 결정 2026-10-05).
 *
 * 차량은 마지막 계약을 가리킨 채 남는다(지난 청구서·원장이 그 계약으로 차를 찾는다). 끝난 계약이라
 * 회차표를 다시 만들지 않는다(resolveScheduleInputs가 막는다).
 *
 * @route POST /api/contracts/:id/return
 */
export const returnContract = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    if (!EXTENDABLE.includes(contract.status)) {
      return res.status(400).json({ success: false, message: `${contract.status} 상태의 계약은 반납 처리할 수 없습니다.` });
    }
    const returnDate = parseDate(req.body.returnDate);
    if (!returnDate) return res.status(400).json({ success: false, message: '반납일을 입력해 주세요.' });
    const nextUse = req.body.nextUse === '단기렌트' ? '단기렌트' : '재고';

    const depositRefund = req.body.depositRefund !== undefined && req.body.depositRefund !== ''
      ? Number(req.body.depositRefund) || 0
      : (contract.pricing?.deposit || 0);
    const damageCharge = Number(req.body.damageCharge) || 0;
    const excessMileageCharge = Number(req.body.excessMileageCharge) || 0;
    const mileage = req.body.mileage !== undefined && req.body.mileage !== '' ? Number(req.body.mileage) : undefined;

    contract.returnInfo = { returnDate, mileage, depositRefund, damageCharge, excessMileageCharge, note: req.body.note || '' };
    const droppedRounds = await closeContract(contract, '반납', returnDate);

    const vehicles = await Vehicle.find({ contract: contract._id });
    for (const v of vehicles) {
      v.status = nextUse;
      if (mileage !== undefined && vehicles.length === 1) v.currentMileage = mileage;
      // eslint-disable-next-line no-await-in-loop
      await v.save();

      // eslint-disable-next-line no-await-in-loop
      const ledger = await VehicleLedger.findOne({ vehicle: v._id });
      if (!ledger) continue;
      // 정산은 계약 단위로 하므로 차가 여러 대면 대수로 나눠 담는다
      const share = (n) => Math.round((Number(n) || 0) / vehicles.length);
      addSettlementEntry(ledger, { side: '지출', category: '보증금', label: '보증금 반환', amount: share(depositRefund), date: returnDate });
      addSettlementEntry(ledger, { side: '입금', category: '수리·사고', label: '반납 손상 수리비(고객부담)', amount: share(damageCharge), date: returnDate });
      addSettlementEntry(ledger, { side: '입금', category: '기타', label: '초과 주행 정산', amount: share(excessMileageCharge), date: returnDate });
      // 반납은 차가 돌아온 것이라 인수가는 들어오지 않는다. 계약서의 인수가가 원장에 입금으로 남지 않게 0으로 둔다.
      const returnedPeriod = (ledger.contractPeriods || []).find((p) => String(p.contract) === String(contract._id));
      if (returnedPeriod) returnedPeriod.takeoverPrice = 0;
      else ledger.terms.takeoverPrice = 0;
      if (nextUse === '단기렌트') {
        // 반납 후 단기 운용 구간. 계약이 없는 기간이라 계약 칸은 비운다. 매출은 대여 기록에서 붙는다.
        ledger.contractPeriods.push({
          seq: currentSeqOf(ledger) + 1,
          startDate: addDays(returnDate, 1),
          note: '반납 후 단기렌트·사고대차 운용'
        });
      }
      ledger.status = '운용중';
      // eslint-disable-next-line no-await-in-loop
      await syncLedgerEntries(ledger);
      // eslint-disable-next-line no-await-in-loop
      await ledger.save();
    }

    const partyName = await partyNameOf(contract);
    logActivity({
      req, dept: '차량관리부', action: ACTIONS.CONTRACT_RETURN,
      target: { model: 'Contract', id: contract._id },
      summary: `${partyName} ${contract.contractNo} 반납 (${vehicles.map((v) => v.plateNo || v.carModel).join(', ')}) → ${nextUse}`,
      meta: { depositRefund, damageCharge, excessMileageCharge, nextUse, droppedRounds }
    });

    res.json({
      success: true,
      message: [
        `${contract.contractNo} 계약을 반납 처리했습니다. 차량은 '${nextUse}'로 바뀌었습니다.`,
        depositRefund ? `보증금 반환 ${depositRefund.toLocaleString()}원을 원장에 넣었습니다.` : '',
        droppedRounds ? `반납일 뒤의 미청구 ${droppedRounds}회차를 정리했습니다.` : ''
      ].filter(Boolean).join(' ')
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 인수. 고객이 차를 산다. 인수가를 받고 계약을 '종료(인수)'로 닫는다.
 *
 * body: { takeoverDate, takeoverAmount, note }
 *
 * @route POST /api/contracts/:id/takeover
 */
export const takeoverContract = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    if (!EXTENDABLE.includes(contract.status)) {
      return res.status(400).json({ success: false, message: `${contract.status} 상태의 계약은 인수 처리할 수 없습니다.` });
    }
    const takeoverDate = parseDate(req.body.takeoverDate);
    if (!takeoverDate) return res.status(400).json({ success: false, message: '인수일을 입력해 주세요.' });
    const amount = req.body.takeoverAmount !== undefined && req.body.takeoverAmount !== ''
      ? Number(req.body.takeoverAmount) || 0
      : (contract.pricing?.takeoverPrice || 0);

    contract.pricing = { ...(contract.toObject().pricing || {}), takeoverPrice: amount };
    const droppedRounds = await closeContract(contract, '인수', takeoverDate);

    const vehicles = await Vehicle.find({ contract: contract._id });
    for (const v of vehicles) {
      v.status = '거래완료';
      if (vehicles.length === 1) v.takeoverPrice = amount;
      // eslint-disable-next-line no-await-in-loop
      await v.save();
      // eslint-disable-next-line no-await-in-loop
      const ledger = await VehicleLedger.findOne({ vehicle: v._id });
      if (!ledger) continue;
      // 원장의 인수가 줄은 마지막 구간의 인수가로 자동으로 만들어진다. 실제 받은 금액으로 맞춘다.
      const share = Math.round(amount / vehicles.length);
      const period = (ledger.contractPeriods || []).find((p) => String(p.contract) === String(contract._id));
      if (period) period.takeoverPrice = share;
      else ledger.terms.takeoverPrice = share;
      ledger.status = '거래완료';
      // eslint-disable-next-line no-await-in-loop
      await syncLedgerEntries(ledger);
      // eslint-disable-next-line no-await-in-loop
      await ledger.save();
    }

    const partyName = await partyNameOf(contract);
    logActivity({
      req, dept: '계약·출고부', action: ACTIONS.CONTRACT_TAKEOVER,
      target: { model: 'Contract', id: contract._id },
      summary: `${partyName} ${contract.contractNo} 인수 (인수가 ${amount.toLocaleString()}원)`,
      meta: { amount, droppedRounds }
    });

    res.json({
      success: true,
      message: `${contract.contractNo} 계약을 인수 처리했습니다. 인수가 ${amount.toLocaleString()}원, 차량은 거래완료로 바뀌었습니다.`
        + (droppedRounds ? ` 인수일 뒤의 미청구 ${droppedRounds}회차를 정리했습니다.` : '')
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const RERENTABLE = ['재고', '단기렌트'];

/**
 * 재렌트. 반납받은 차(재고·단기렌트)를 새 고객에게 중고로 장기 렌트한다.
 *
 * body: {
 *   vehicleId, customerId, companyId(법인이면), contractDate, termMonths,
 *   monthlyFee, deposit, advancePayment, takeoverPrice, appraisalValue, monthlyPaymentDay
 * }
 *  - 계약번호는 새 고객 기준으로 새로 매긴다(연장이 아니다).
 *  - 보증금은 새로 받는다. 이전 고객 보증금은 반납 때 돌려줬다(대표님 결정 2026-10-05).
 *  - 평가액은 중고차 사업부가 알려 준 금액을 직원이 넣는다.
 *  - 차량은 새로 만들지 않고, 원장도 같은 장부에 구간을 붙인다.
 *
 * @route POST /api/contracts/rerent
 */
export const rerentVehicle = async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.body.vehicleId);
    if (!vehicle) return res.status(404).json({ success: false, message: '차량을 찾을 수 없습니다.' });
    if (!RERENTABLE.includes(vehicle.status)) {
      return res.status(400).json({ success: false, message: `재고·단기렌트 차량만 재렌트할 수 있습니다. (지금 ${vehicle.status})` });
    }
    if (vehicle.contract) {
      const current = await Contract.findById(vehicle.contract).select('status contractNo').lean();
      if (current && !['종료', '중도해지'].includes(current.status)) {
        return res.status(400).json({ success: false, message: `${current.contractNo} 계약이 아직 진행 중입니다. 반납 처리를 먼저 해 주세요.` });
      }
    }
    const customer = await Customer.findById(req.body.customerId);
    if (!customer) return res.status(400).json({ success: false, message: '새 계약자(고객)를 골라 주세요.' });
    const contractDate = parseDate(req.body.contractDate);
    if (!contractDate) return res.status(400).json({ success: false, message: '계약일(인도일)을 입력해 주세요.' });
    const termMonths = Number(req.body.termMonths);
    if (!termMonths) return res.status(400).json({ success: false, message: '계약 기간(개월)을 입력해 주세요.' });
    const monthlyFee = Number(req.body.monthlyFee);
    if (!monthlyFee) return res.status(400).json({ success: false, message: '월 렌트료를 입력해 주세요.' });
    const appraisalValue = Number(req.body.appraisalValue);
    if (!appraisalValue) return res.status(400).json({ success: false, message: '차량 평가액(중고차 사업부 금액)을 입력해 주세요.' });
    const paymentDay = String(req.body.monthlyPaymentDay || vehicle.monthlyPaymentDay || '').trim();
    if (!paymentDay) return res.status(400).json({ success: false, message: '월 결제일을 정해 주세요.' });

    const previous = vehicle.contract
      || (await Contract.findOne({ vehicles: vehicle._id }).sort({ contractDate: -1 }).select('_id').lean())?._id;
    const isCompany = Boolean(req.body.companyId);

    const contract = await new Contract({
      contractNo: await generateContractNo(customer, contractDate),
      contractKind: '재렌트',
      previousContract: previous || undefined,
      customer: customer._id,
      partyType: isCompany ? '법인' : (req.body.partyType || '일반개인'),
      companyId: isCompany ? req.body.companyId : undefined,
      contractDate,
      deliveryDate: contractDate,
      termMonths,
      appraisalValue,
      pricing: {
        basePrice: appraisalValue, // 재렌트 구간의 차량가는 평가액이다
        monthlyFee,
        deposit: Number(req.body.deposit) || 0,
        advancePayment: Number(req.body.advancePayment) || 0,
        takeoverPrice: Number(req.body.takeoverPrice) || 0,
        paymentTerm: termMonths
      },
      vehicles: [vehicle._id],
      vehicle: vehicle._id,
      status: '진행중'
    }).save();

    // 차는 새로 만들지 않는다. 새 계약에 붙이고 계약자 정보를 새 고객으로 바꾼다.
    // (단기렌트로 돌 때는 계약사가 렌트베네핏으로 고정돼 있었다)
    vehicle.contract = contract._id;
    vehicle.status = '장기렌트';
    vehicle.monthlyFee = monthlyFee;
    vehicle.deposit = contract.pricing.deposit;
    vehicle.advancePayment = contract.pricing.advancePayment;
    vehicle.takeoverPrice = contract.pricing.takeoverPrice;
    vehicle.monthlyPaymentDay = paymentDay;
    vehicle.deliveryDate = contractDate;
    vehicle.rentBillingDate = nextPaymentDate(contractDate, paymentDay);
    vehicle.partyType = contract.partyType === '개인' ? '일반개인' : contract.partyType;
    vehicle.company = isCompany ? req.body.companyId : undefined;
    vehicle.contractorName = isCompany ? '' : customer.name;
    await vehicle.save();

    let billingMessage = '';
    try {
      const schedule = await buildScheduleForContract(contract._id);
      billingMessage = `청구 회차표 ${schedule.rounds.length}회차를 만들었습니다.`;
    } catch (err) {
      billingMessage = `청구 회차표는 아직 만들지 못했습니다: ${err.message}`;
    }

    // 원장: 같은 장부에 재렌트 구간. 보증금은 새로 받은 돈이라 그대로 넣는다.
    let ledgerNote = '';
    const ledger = await VehicleLedger.findOne({ vehicle: vehicle._id });
    if (ledger) {
      // 반납 후 단기 운용 구간이 열려 있으면 재렌트 전날로 닫는다
      const open = (ledger.contractPeriods || []).find((p) => !p.contract && !p.endDate);
      if (open) open.endDate = addDays(contractDate, -1);
      appendContractPeriod(ledger, contract.toObject(), {
        note: `재렌트 · 고객 변경 · 평가액 ${appraisalValue.toLocaleString()}원`,
        monthlyRent: monthlyFee
      });
      await syncLedgerEntries(ledger);
      await ledger.save();
    } else {
      ledgerNote = '이 차의 원장이 없어 구간을 붙이지 못했습니다.';
    }

    const calendar = buildSchedules(vehicle._id, contract, termMonths, contract.pricing, '', '');
    if (calendar.length) await Schedule.insertMany(calendar);

    const partyName = await partyNameOf(contract);
    try {
      if (partyName) {
        await ensureCustomerFolders(partyName);
        const docFolderName = await buildContractFolderName(contract.contractNo, [vehicle]);
        await ensureContractFolder(partyName, docFolderName);
        await Contract.findByIdAndUpdate(contract._id, { customerFolder: partyName, docFolderName });
      }
    } catch (err) {
      console.log(`[계약 폴더] ${contract.contractNo}: 만들지 못했습니다 - ${err.message}`);
    }

    logActivity({
      req, dept: '영업부', action: ACTIONS.CONTRACT_RERENT,
      target: { model: 'Contract', id: contract._id },
      summary: `${partyName} ${contract.contractNo} 재렌트 (${vehicle.carModel} ${vehicle.plateNo || ''}, 평가액 ${appraisalValue.toLocaleString()}원, 월 ${monthlyFee.toLocaleString()}원)`.replace(/\s+/g, ' '),
      meta: { previous, appraisalValue, monthlyFee, termMonths }
    });

    const result = await Contract.findById(contract._id).populate('customer').populate('vehicles').populate('companyId', 'name');
    res.status(201).json({
      success: true,
      contract: result,
      message: [`${partyName} 재렌트 계약 ${contract.contractNo}을 등록했습니다.`, billingMessage, ledgerNote].filter(Boolean).join(' ')
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
