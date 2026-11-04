import VehicleLedger from '../models/VehicleLedger.js';
import { recipientOf } from '../../shared/billingRecipient.js';
import { ledgerCheckOf } from '../utils/settlementLedgerCheck.js';
import crypto from 'crypto';
import Contract from '../models/Contract.js';
import Vehicle from '../models/Vehicle.js';
import BillingSchedule from '../models/BillingSchedule.js';
// populate가 찾을 수 있게 등록만 해 둔다
import '../models/Company.js';
import '../models/Customer.js';
import { saveDocument, readSavedFile } from '../utils/documentStorageService.js';
import { sendEndDocMail } from '../utils/mailService.js';
import { mergeCarModel } from '../utils/carModel.js';
import { vehicleEndOf, lastDayOf } from '../utils/contractTerm.js';
import { describeTireProvision } from '../../shared/quoteCalc.js';
import { stripHonorific, maskResidentNo } from '../utils/personName.js';

/**
 * 계약사실 증명원 · 상환스케쥴표 값 만들기, 저장, 메일 보내기. 계약 종료 서류도 같은 값을 쓴다.
 *
 * 양식은 Dropbox "계약사실 증명원_인도일, 계약 종료일.xlsx"의 '계약사실 증명원'·'상환스케쥴' 시트 그대로다.
 * 화면(자금팀 > 계약사실 증명원)이 PDF를 만들어 보내면 서버가 계약서 폴더(OneDrive)에 저장한다.
 * 메일은 담당자가 [메일 보내기]를 눌렀을 때만 나간다. 자동으로 보내는 길은 없다(2026-11-03).
 */

const DAY = 864e5;

/** 한국 날짜(YYYY-MM-DD). 운영 서버는 UTC라 그냥 자르면 하루가 밀린다. */
export const kstYmd = (d) => {
  if (!d) return '';
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? '' : new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
};
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const todayKst = () => kstYmd(new Date());

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
const pct = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${n <= 1 ? Math.round(n * 1000) / 10 : n}%`;
};

// 화면에서 담당자가 고쳐 쓰는 칸. 운전자 범위·사고수리는 렌트차량 DB(보험) 값이 기본이고, 적으면 그 값이 우선한다.
// residentFront: 개인 계약자의 주민등록번호 앞 6자리. 뒷자리는 받지 않고 서류에는 '******'로 찍는다
export const OVERRIDE_FIELDS = ['driverRange', 'accidentRepair', 'commission', 'receiptDate', 'residentFront'];
const BIZ_NO = /^\d{3}-?\d{2}-?\d{5}$/;

/**
 * 한 계약의 두 서류에 들어갈 값을 모두 만든다. 화면 그리기와 발송 전 확인이 같은 값을 쓴다.
 * @param {string} contractId
 * @returns {Promise<object|null>}
 */
export const buildDeliveryDocs = async (contractId) => {
  const contract = await Contract.findById(contractId)
    .populate('companyId', 'name bizNo corporateRegistrationNo ceoName address billingEmail')
    .populate('customer', 'name address email mobilePhone')
    .lean();
  if (!contract) return null;

  const vehicles = await Vehicle.find(contract.vehicles?.length ? { _id: { $in: contract.vehicles } } : { contract: contract._id })
    .sort({ code: 1 })
    .lean();
  const schedule = await BillingSchedule.findOne({ contract: contract._id }).select('billingEmail rounds.no rounds.dueDate rounds.monthlyRent rounds.status rounds.sentTo rounds.autoSend.to').lean();
  const rounds = [...(schedule?.rounds || [])].sort((a, b) => a.no - b.no);

  const company = contract.companyId || null;
  const customer = contract.customer || null;
  const overrides = contract.deliveryDocs?.overrides || {};

  // 개인 계약자: 고객 이름 칸의 '이승섭 변호사님' 같은 직책은 떼고 이름만 쓴다.
  // 번호는 사업자번호가 있으면(개인사업자) 그것을, 없으면 주민등록번호 앞 6자리만 쓰고 뒷자리는 가린다(대표님 2026-11-03)
  const personal = !company && contract.partyType !== '법인';
  const personalBizNo = BIZ_NO.test(String(customer?.bizNo || '').trim()) ? customer.bizNo.trim() : '';
  const party = {
    name: company?.name || stripHonorific(customer?.name || contract.leaseCompany || ''),
    personal,
    bizNoLabel: personal && !personalBizNo ? '주민등록번호' : '사업자번호',
    bizNo: company?.bizNo || (personal ? personalBizNo || maskResidentNo(overrides.residentFront) : ''),
    corpNo: company?.corporateRegistrationNo || contract.corporateRegistrationNo || '',
    address: company?.address || customer?.address || '',
    ceoName: stripHonorific(company?.ceoName || ''),
    phone: contract.managerMainPhone || contract.managerOpsPhone || customer?.mobilePhone || ''
  };

  // 차가 여러 대면 회차 청구액(계약 전체)을 월 렌트료 비율로 차마다 나눈다.
  const feeSum = vehicles.reduce((s, v) => s + (Number(v.monthlyFee) || 0), 0);
  const termMonths = Number(contract.termMonths) || Number(contract.pricing?.paymentTerm) || 0;

  const docs = vehicles.map((v) => {
    const fee = Number(v.monthlyFee) || 0;
    const share = vehicles.length > 1 && feeSum > 0 ? fee / feeSum : 1;
    const maint = v.maintenance || {};
    const ins = v.insurance || {};
    const joined = maint.generalMaintenance === '가입' || maint.enabled === true;
    const takeover = Number(v.takeoverPrice) || 0;
    const mileage = Number(maint.mileage) || 0;
    return {
      vehicleId: String(v._id),
      code: v.code || '',
      plateNo: v.plateNo || '',
      vin: v.vin || '',
      carModel: mergeCarModel(v.carModel, v.carSpec),
      color: [v.exteriorColor, v.interiorColor].filter((x) => x && x !== '-').join(' / '),
      options: v.options && v.options !== '-' ? v.options : '',
      carPrice: (Number(v.carPrice) || 0) + (Number(v.optionPrice) || 0),
      takeoverPrice: takeover,
      takeoverText: takeover > 0 ? '만기시 선택' : '만기시 반납',
      mileage,
      deposit: Number(v.deposit) || 0,
      advancePayment: Number(v.advancePayment) || 0,
      termMonths,
      earlyRate: pct(v.earlyTerminationRate ?? contract.terms?.earlyTerminationRate),
      lateRate: pct(v.lateInterestRate ?? contract.terms?.lateInterestRate),
      paymentDay: String(v.monthlyPaymentDay || contract.pricing?.billingDay || ''),
      monthlyFee: fee,
      deliveryDate: kstYmd(v.deliveryDate || contract.deliveryDate),
      // 계약에 저장된 만기일은 예전 계약일 기준으로 남은 것이 있어, 차마다 인도일 + 개월 수로 다시 센다(청구서와 같은 값).
      // 보여 주는 날은 계약 기간의 마지막 날이다(만기일 - 1일)
      endDate: kstYmd(lastDayOf(vehicleEndOf(contract, v) || contract.endDate)),
      firstDueDate: kstYmd(rounds[0]?.dueDate),
      emergency: ins.emergencyService || '',
      regularCheck: maint.regularCheck || '',
      generalMaintenance: maint.generalMaintenance || '',
      consumables: joined ? (maint.consumables || '가입') : '브랜드보증 외 사용자 부담',
      tireText: joined ? describeTireProvision(termMonths, mileage) : '브랜드보증 외 사용자 부담',
      accidentRepair: overrides.accidentRepair || ins.accidentRepair || '',
      // 화면에서 입력 칸을 비우면 들어갈 렌트차량 DB 값
      db: { driverRange: ins.driverRange || '', accidentRepair: ins.accidentRepair || '' },
      insurance: {
        driverRange: overrides.driverRange || ins.driverRange || '',
        driverAge: ins.driverAge || '',
        liability: ins.liabilityLimit || '',
        property: ins.propertyLimit || '',
        personalInjury: ins.personalInjury || '',
        uninsured: ins.uninsuredInjury || '',
        deductible: ins.deductible ? `${(Number(ins.deductible) / 10000).toLocaleString()}만원` : ''
      },
      schedule: rounds.map((r) => ({
        no: r.no,
        dueDate: kstYmd(r.dueDate),
        amount: Math.round((Number(r.monthlyRent) || 0) * share)
      }))
    };
  });

  const deliveryDates = docs.map((d) => d.deliveryDate).filter(Boolean).sort();
  const lastDelivery = deliveryDates[deliveryDates.length - 1] || '';
  const to = contract.deliveryDocs?.to || company?.billingEmail || customer?.email || '';

  // 이것이 비어 있으면 승인하지 못한다
  const missing = [];
  if (!docs.length) missing.push('계약에 묶인 차량이 없습니다');
  docs.forEach((d) => {
    if (!d.plateNo) missing.push(`${d.code || d.carModel} 차량번호(인도·등록 전)`);
    if (!d.deliveryDate) missing.push(`${d.code || d.carModel} 인도일`);
  });
  if (!rounds.length) missing.push('청구 회차표(결제일·렌트료 개시일을 출고 준비에서 넣어 주세요)');
  if (!isEmail(to)) missing.push('받는 사람 이메일(법인 청구 이메일)');
  // 비어 있어도 보낼 수는 있지만 확인이 필요한 칸
  const warnings = [];
  if (company && !party.corpNo) warnings.push('법인등록번호가 비어 있습니다(법인 관리에서 채워 주세요)');
  if (docs.some((d) => !d.insurance.driverRange)) warnings.push('운전자 범위가 렌트차량 DB(보험)에 없습니다. 적어 주세요');

  const data = {
    contractId: String(contract._id),
    contractNo: contract.contractNo,
    contractStatus: contract.status,
    party,
    to,
    sendDate: lastDelivery ? addDays(lastDelivery, 1) : '',
    commission: overrides.commission || '',
    receiptDate: overrides.receiptDate || '',
    docs
  };
  const snapshot = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  // 저장해 둔 계약사실 증명원·상환스케쥴표(지문에는 넣지 않는다. 저장할 때마다 바뀌는 기록이다)
  const factDocs = (contract.factDocs || [])
    .map((f) => ({ ...f, _id: String(f._id), vehicleId: f.vehicleId ? String(f.vehicleId) : '' }))
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  const endDocs = (contract.endDocs || [])
    .map((f) => ({ ...f, _id: String(f._id), vehicleId: f.vehicleId ? String(f.vehicleId) : '' }))
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  // 계약종료 확인서에 쓰는 값. 정산이 끝났는지 보려고 결제일이 지났는데 입금되지 않은 회차를 같이 준다
  const today = todayKst();
  const ending = {
    contractDate: kstYmd(contract.contractDate),
    endReason: contract.endReason || '',
    actualEndDate: kstYmd(contract.actualEndDate),
    unpaidRounds: rounds.filter((r) => ['청구됨', '미납'].includes(r.status) && kstYmd(r.dueDate) <= today).map((r) => r.no),
    // 종료 서류를 보낼 곳. 청구서를 보내는 메일과 같은 순서로 찾는다
    mailTo: recipientOf(schedule, company, customer) || to
  };
  return { ...data, snapshot, missing, warnings, overrides, factDocs, endDocs, ending, deliveryDocs: contract.deliveryDocs || null, docFolderName: contract.docFolderName || contract.contractNo };
};

/** @route GET /api/delivery-docs/:contractId */
export const getDeliveryDocs = async (req, res) => {
  try {
    const d = await buildDeliveryDocs(req.params.contractId);
    if (!d) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    res.json({ success: true, data: d });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 담당자가 채우는 칸(운전자 범위·사고수리·수수료·영수일)과 받는 주소를 저장한다.
 * @route PUT /api/delivery-docs/:contractId
 */
export const saveDeliveryDocsInput = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.contractId);
    if (!contract) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    if (['발송중', '발송완료'].includes(contract.deliveryDocs?.status)) {
      return res.status(409).json({ success: false, message: '이미 보냈거나 보내는 중인 서류입니다.' });
    }
    const current = contract.deliveryDocs?.toObject?.() || contract.deliveryDocs || {};
    const overrides = { ...(current.overrides || {}) };
    OVERRIDE_FIELDS.forEach((k) => {
      if (req.body[k] !== undefined) overrides[k] = String(req.body[k] || '').trim();
    });
    // 주민등록번호는 앞 6자리만 둔다. 뒷자리까지 넣어도 잘라 버린다
    if (overrides.residentFront !== undefined) overrides.residentFront = (/^\s*(\d{6})/.exec(overrides.residentFront) || [])[1] || '';
    const to = req.body.to !== undefined ? String(req.body.to || '').trim() : current.to;
    contract.deliveryDocs = { ...current, overrides, to };
    contract.markModified('deliveryDocs');
    await contract.save();
    const d = await buildDeliveryDocs(contract._id);
    res.json({ success: true, data: d, message: '저장했습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 고객·계약 검색. 인도 다음 날 자동 발송과 별개로, 고객이 다시 요청하면 찾아서 바로 보낸다.
 * 계약자(법인·고객) 이름, 계약번호, 차량번호로 찾는다.
 * @route GET /api/delivery-docs/search?q=
 */
export const searchDeliveryDocs = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ success: true, items: [] });
    // 띄어쓰기는 있어도 없어도 찾는다("주식회사 대건" = "주식회사대건")
    const chars = [...q.replace(/\s+/g, '')].map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const rx = new RegExp(chars.join('\\s*'), 'i');
    const Company = Contract.db.model('Company');
    const Customer = Contract.db.model('Customer');
    const [companies, customers, vehicles] = await Promise.all([
      Company.find({ name: rx }).select('_id').limit(50).lean(),
      Customer.find({ name: rx }).select('_id').limit(50).lean(),
      Vehicle.find({ plateNo: rx }).select('contract').limit(50).lean()
    ]);
    const contracts = await Contract.find({
      status: { $ne: '임시저장' },
      $or: [
        { contractNo: rx },
        { companyId: { $in: companies.map((c) => c._id) } },
        { customer: { $in: customers.map((c) => c._id) } },
        { _id: { $in: vehicles.map((v) => v.contract).filter(Boolean) } }
      ]
    })
      .populate('companyId', 'name billingEmail')
      .populate('customer', 'name email')
      .select('contractNo status vehicles companyId customer deliveryDocs.status deliveryDocs.sentAt deliveryDocs.to contractDate')
      .sort({ contractDate: -1 })
      .limit(30)
      .lean();
    const vehicleMap = new Map((await Vehicle.find({ contract: { $in: contracts.map((c) => c._id) } }).select('contract plateNo carModel deliveryDate').lean())
      .reduce((m, v) => m.set(String(v.contract), [...(m.get(String(v.contract)) || []), v]), new Map()));
    res.json({
      success: true,
      items: contracts.map((c) => ({
        contractId: String(c._id),
        contractNo: c.contractNo,
        contractStatus: c.status,
        partyName: c.companyId?.name || stripHonorific(c.customer?.name || ''),
        to: c.deliveryDocs?.to || c.companyId?.billingEmail || c.customer?.email || '',
        status: c.deliveryDocs?.status || '',
        sentAt: c.deliveryDocs?.sentAt || null,
        vehicles: (vehicleMap.get(String(c._id)) || []).map((v) => ({ plateNo: v.plateNo, carModel: v.carModel, deliveryDate: kstYmd(v.deliveryDate) }))
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const FACT_KIND_NAME = { fact: '계약사실증명원', schedule: '상환스케쥴표', both: '계약사실증명원_상환스케쥴표' };
// 메일 양식의 {{서류}}에 넣을 이름
const FACT_MAIL_NAME = { fact: '계약사실 증명원', schedule: '상환스케쥴표', both: '계약사실 증명원 및 상환스케쥴표' };

/**
 * 요청에서 서류 종류와 차를 고르고 빠진 값을 확인한다. 저장과 메일이 같이 쓴다.
 * 계약사실 증명원은 차량번호·차대번호를 증명하려고 만드는 서류라 둘 다 있어야 한다.
 */
const pickFactDoc = (req, d) => {
  if (!req.file) return { error: 'PDF가 없습니다.' };
  const kind = FACT_KIND_NAME[req.body.kind] ? req.body.kind : 'both';
  const vehicleId = String(req.body.vehicleId || '');
  const docs = vehicleId ? d.docs.filter((x) => x.vehicleId === vehicleId) : d.docs;
  if (!docs.length) return { error: '이 계약에 묶인 차량을 찾지 못했습니다.' };
  const lacking = docs.filter((x) => !x.plateNo || (kind !== 'schedule' && !x.vin));
  if (lacking.length) return { error: `차량번호·차대번호가 없는 차가 있어 저장하지 않았습니다: ${lacking.map((x) => x.code || x.carModel).join(', ')} (렌트차량 DB에서 채워 주세요)` };
  if (kind !== 'fact' && docs.some((x) => !x.schedule.length)) return { error: '청구 회차표가 없어 상환스케쥴표를 만들 수 없습니다.' };
  return { kind, docs, plates: docs.map((x) => x.plateNo).join(',') };
};

const storeFactDoc = (req, d, { kind, plates }) => saveDocument({
  partyName: d.party.name,
  kind: 'contract',
  subFolder: d.docFolderName,
  fileName: `${FACT_KIND_NAME[kind]}_${d.party.name}_${plates}_${todayKst()}.pdf`,
  fileBuffer: req.file.buffer
});

/** 계약에 남길 기록. 차가 여러 대면 차마다 한 줄이다 */
const factDocEntries = (req, { kind, docs }, saved, sent = {}) => docs.map((x) => ({
  kind,
  vehicleId: x.vehicleId,
  plateNo: x.plateNo,
  vin: x.vin,
  fileName: saved.fileName,
  savedPath: saved.localPath,
  savedAt: new Date(),
  savedBy: req.user?.name || req.user?.email || '',
  ...sent
}));

/** 같은 차에 같은 서류를 메일로 보낸 기록 */
export const alreadySentFactDoc = (factDocs, kind, vehicleIds) => (factDocs || [])
  .find((f) => f.sentAt && f.kind === kind && vehicleIds.includes(String(f.vehicleId)));

/**
 * 계약사실 증명원 · 상환스케쥴표를 계약서 폴더에 저장한다.
 * @route POST /api/delivery-docs/:contractId/fact-docs (multipart: file, kind, vehicleId?)
 */
export const saveFactDoc = async (req, res) => {
  try {
    const d = await buildDeliveryDocs(req.params.contractId);
    if (!d) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    const picked = pickFactDoc(req, d);
    if (picked.error) return res.status(400).json({ success: false, message: picked.error });
    const saved = await storeFactDoc(req, d, picked);
    await Contract.updateOne({ _id: d.contractId }, { $push: { factDocs: { $each: factDocEntries(req, picked, saved) } } });
    res.json({ success: true, message: `${saved.fileName}을(를) 계약서 폴더에 저장했습니다.`, data: await buildDeliveryDocs(d.contractId) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 계약사실 증명원 · 상환스케쥴표를 고객에게 메일로 보내고 계약서 폴더에도 저장한다 (화면의 [메일 보내기]).
 * 같은 차에 같은 서류를 이미 보냈으면 force 없이는 다시 보내지 않는다(고객이 두 번 받는다).
 * @route POST /api/delivery-docs/:contractId/fact-docs/send (multipart: file, kind, vehicleId?, to, force?)
 */
export const sendFactDoc = async (req, res) => {
  try {
    const d = await buildDeliveryDocs(req.params.contractId);
    if (!d) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    const picked = pickFactDoc(req, d);
    if (picked.error) return res.status(400).json({ success: false, message: picked.error });
    const to = String(req.body.to || d.ending.mailTo || '').trim();
    if (!isEmail(to)) return res.status(400).json({ success: false, message: '받는 사람 이메일을 확인해 주세요.' });
    const sent = alreadySentFactDoc(d.factDocs, picked.kind, picked.docs.map((x) => x.vehicleId));
    if (sent && req.body.force !== 'true') {
      return res.status(409).json({ success: false, alreadySent: true, message: `이미 ${kstYmd(sent.sentAt)}에 ${sent.sentTo}(으)로 보낸 기록이 있습니다.` });
    }
    const saved = await storeFactDoc(req, d, picked);
    await sendEndDocMail({
      to,
      templateKey: 'contract-fact',
      fileName: saved.fileName,
      fileBuffer: req.file.buffer,
      values: { 계약자: d.party.name, 계약번호: d.contractNo, 차량번호: picked.plates, 서류: FACT_MAIL_NAME[picked.kind] }
    });
    await Contract.updateOne({ _id: d.contractId }, { $push: { factDocs: { $each: factDocEntries(req, picked, saved, { sentAt: new Date(), sentTo: to }) } } });
    res.json({ success: true, message: `${to}(으)로 메일을 보내고 계약서 폴더에 저장했습니다.`, data: await buildDeliveryDocs(d.contractId) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** 저장해 둔 계약사실 증명원 열기. @route GET /api/delivery-docs/:contractId/fact-docs/:docId/file */
export const getFactDocFile = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.contractId).select('factDocs').lean();
    const doc = (contract?.factDocs || []).find((f) => String(f._id) === req.params.docId);
    if (!doc?.savedPath) return res.status(404).json({ success: false, message: '저장한 서류가 없습니다.' });
    const buffer = await readSavedFile(doc.savedPath);
    if (!buffer) return res.status(410).json({ success: false, message: '파일이 OneDrive에서 옮겨졌거나 지워져 열 수 없습니다.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.fileName || 'fact.pdf')}`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const END_KIND_NAME = { early: '계약종료확인서_중도해지', takeover: '계약종료확인서_만기인수', return: '계약종료확인서_만기반납', settlement: '중도해지정산서' };
const END_KIND_MAIL = { early: 'contract-end', takeover: 'contract-end', return: 'contract-end', settlement: 'early-settlement' };

/** 같은 차에 같은 서류를 메일로 보낸 기록. 계약종료 확인서는 종료 구분이 달라도 같은 서류로 본다 */
export const alreadySentEndDoc = (endDocs, kind, vehicleIds) => (endDocs || [])
  .find((f) => f.sentAt && END_KIND_MAIL[f.kind] === END_KIND_MAIL[kind] && vehicleIds.includes(String(f.vehicleId)));

/** 요청에서 서류 종류와 차를 고른다. 저장과 메일이 같이 쓴다 */
const pickEndDoc = (req, d) => {
  if (!req.file) return { error: 'PDF가 없습니다.' };
  const kind = req.body.kind;
  if (!END_KIND_NAME[kind]) return { error: '종료 구분(중도해지·만기 인수·만기 반납·중도해지 정산서)을 골라 주세요.' };
  const vehicleId = String(req.body.vehicleId || '');
  const docs = vehicleId ? d.docs.filter((x) => x.vehicleId === vehicleId) : d.docs;
  if (!docs.length) return { error: '이 계약에 묶인 차량을 찾지 못했습니다.' };
  if (docs.some((x) => !x.plateNo)) return { error: '차량번호가 없는 차가 있어 저장하지 않았습니다.' };
  return { kind, docs, plates: docs.map((x) => x.plateNo).join(',') };
};

const storeEndDoc = (req, d, { kind, plates }) => saveDocument({
  partyName: d.party.name,
  kind: 'contract',
  subFolder: d.docFolderName,
  fileName: `${END_KIND_NAME[kind]}_${d.party.name}_${plates}_${todayKst()}.pdf`,
  fileBuffer: req.file.buffer
});

/** 계약에 남길 기록. 차가 여러 대면 차마다 한 줄이다 */
const endDocEntries = (req, { kind, docs }, saved, sent = {}) => {
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(req.body.endDate || '') ? req.body.endDate : '';
  // 정산서는 납부 회차와 정산금을 남긴다. 계약종료 확인서가 미입금 회차를 맞춰 볼 때 읽는다
  const settle = kind === 'settlement' && req.body.paidCount !== undefined && Number.isFinite(Number(req.body.paidCount))
    ? { paidCount: Number(req.body.paidCount), settleAmount: Number(req.body.settleAmount) || 0 }
    : {};
  return docs.map((x) => ({
    ...settle,
    kind,
    vehicleId: x.vehicleId,
    plateNo: x.plateNo,
    endDate,
    fileName: saved.fileName,
    savedPath: saved.localPath,
    savedAt: new Date(),
    savedBy: req.user?.name || req.user?.email || '',
    ...sent
  }));
};

/**
 * 계약종료 확인서를 계약서 폴더에 저장한다 (자금팀 > 계약종료 확인서).
 * 중도해지 · 만기 후 인수 · 만기 후 반납으로 정산이 끝난 고객에게 보내는 서류다. 메일은 보내지 않는다.
 * kind 'settlement'는 중도해지 정산서(자금팀 > 중도해지 정산서)이고, endDate는 차량 반납일이다.
 * @route POST /api/delivery-docs/:contractId/end-docs (multipart: file, kind, vehicleId?, endDate)
 */
export const saveEndDoc = async (req, res) => {
  try {
    const d = await buildDeliveryDocs(req.params.contractId);
    if (!d) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    const picked = pickEndDoc(req, d);
    if (picked.error) return res.status(400).json({ success: false, message: picked.error });
    const saved = await storeEndDoc(req, d, picked);
    await Contract.updateOne({ _id: d.contractId }, { $push: { endDocs: { $each: endDocEntries(req, picked, saved) } } });
    res.json({ success: true, message: `${saved.fileName}을(를) 계약서 폴더에 저장했습니다.`, data: await buildDeliveryDocs(d.contractId) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 계약 종료 서류를 고객에게 메일로 보내고 계약서 폴더에도 저장한다 (자금팀 화면의 [메일 보내기]).
 * 청구서와 같은 계정·서명으로 나간다. 담당자가 버튼을 눌렀을 때만 나가고, 자동으로 보내는 길은 없다.
 * 같은 차에 같은 서류를 이미 보냈으면 force 없이는 다시 보내지 않는다(고객이 두 번 받는다).
 * @route POST /api/delivery-docs/:contractId/end-docs/send (multipart: file, kind, vehicleId?, endDate, to, force?)
 */
export const sendEndDoc = async (req, res) => {
  try {
    const d = await buildDeliveryDocs(req.params.contractId);
    if (!d) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    const picked = pickEndDoc(req, d);
    if (picked.error) return res.status(400).json({ success: false, message: picked.error });
    const to = String(req.body.to || d.ending.mailTo || '').trim();
    if (!isEmail(to)) return res.status(400).json({ success: false, message: '받는 사람 이메일을 확인해 주세요.' });
    const sent = alreadySentEndDoc(d.endDocs, picked.kind, picked.docs.map((x) => x.vehicleId));
    if (sent && req.body.force !== 'true') {
      return res.status(409).json({ success: false, alreadySent: true, message: `이미 ${kstYmd(sent.sentAt)}에 ${sent.sentTo}(으)로 보낸 기록이 있습니다.` });
    }
    const saved = await storeEndDoc(req, d, picked);
    await sendEndDocMail({
      to,
      templateKey: END_KIND_MAIL[picked.kind],
      fileName: saved.fileName,
      fileBuffer: req.file.buffer,
      values: { 계약자: d.party.name, 계약번호: d.contractNo, 차량번호: picked.plates }
    });
    await Contract.updateOne({ _id: d.contractId }, { $push: { endDocs: { $each: endDocEntries(req, picked, saved, { sentAt: new Date(), sentTo: to }) } } });
    res.json({ success: true, message: `${to}(으)로 메일을 보내고 계약서 폴더에 저장했습니다.`, data: await buildDeliveryDocs(d.contractId) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 중도해지 정산서에 넣을 값. 납부 회차는 청구 회차표의 입금완료 수다.
 * 연장 계약은 회차와 렌트료가 연장 구간부터 다시 시작해 periodStart(구간 시작일)도 준다.
 * 차량의 인도일은 최초 인도일로 남아 있는 차가 있다(Ray-001: 2021년 인도, 2026-10-28 연장).
 * @route GET /api/delivery-docs/:contractId/settlement-info
 * @returns data = { 차량 id: { paidRounds, roundRent, firstRoundRent, hasLedger, ledgerNo, ledgerRounds, advanceIn, periodStart } }
 */
export const getSettlementInfo = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.contractId).select('vehicles').lean();
    if (!contract) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    const vehicles = await Vehicle.find(contract.vehicles?.length ? { _id: { $in: contract.vehicles } } : { contract: contract._id }).select('monthlyFee').lean();
    const schedule = await BillingSchedule.findOne({ contract: contract._id }).select('rounds.no rounds.monthlyRent rounds.status').lean();
    const rounds = schedule?.rounds || [];
    const feeSum = vehicles.reduce((s, v) => s + (Number(v.monthlyFee) || 0), 0);
    const paidRounds = rounds.filter((r) => r.status === '입금완료').length;
    const rentOf = (no) => Number(rounds.find((r) => r.no === no)?.monthlyRent) || 0;
    const data = {};
    for (const v of vehicles) {
      const share = vehicles.length > 1 && feeSum > 0 ? (Number(v.monthlyFee) || 0) / feeSum : 1;
      const ledger = await VehicleLedger.findOne({ vehicle: v._id }).select('ledgerNo entries contractPeriods').lean();
      const period = (ledger?.contractPeriods || []).find((p) => String(p.contract) === String(contract._id));
      const periodSeq = period?.seq || 1;
      data[v._id] = {
        paidRounds,
        roundRent: Math.round(rentOf(2) * share),
        firstRoundRent: Math.round(rentOf(1) * share),
        hasLedger: Boolean(ledger),
        ledgerNo: ledger?.ledgerNo || '',
        periodStart: periodSeq > 1 ? kstYmd(period.startDate) : '',
        ...(ledger ? ledgerCheckOf({ entries: ledger.entries, periodSeq }) : {})
      };
    }
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** 저장해 둔 계약종료 확인서 열기. @route GET /api/delivery-docs/:contractId/end-docs/:docId/file */
export const getEndDocFile = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.contractId).select('endDocs').lean();
    const doc = (contract?.endDocs || []).find((f) => String(f._id) === req.params.docId);
    if (!doc?.savedPath) return res.status(404).json({ success: false, message: '저장한 서류가 없습니다.' });
    const buffer = await readSavedFile(doc.savedPath);
    if (!buffer) return res.status(410).json({ success: false, message: '파일이 OneDrive에서 옮겨졌거나 지워져 열 수 없습니다.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(doc.fileName || 'end.pdf')}`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
