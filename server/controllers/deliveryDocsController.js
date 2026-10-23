import crypto from 'crypto';
import Contract from '../models/Contract.js';
import Vehicle from '../models/Vehicle.js';
import BillingSchedule from '../models/BillingSchedule.js';
// populate가 찾을 수 있게 등록만 해 둔다
import '../models/Company.js';
import '../models/Customer.js';
import { saveDocument, readSavedFile } from '../utils/documentStorageService.js';
import { sendDeliveryDocsMail, sendInternalMail } from '../utils/mailService.js';
import { mergeCarModel } from '../utils/carModel.js';
import { describeTireProvision } from '../../shared/quoteCalc.js';

/**
 * 인도 서류 발송 — 계약사실 증명원 + 상환스케쥴.
 *
 * 차량을 인도하면 등록이 끝나 차량번호가 정해진다. 그다음 날 아침 9시에 고객에게 두 서류를 보낸다
 * (대표님 요청 2026-10-23). 양식은 Dropbox "계약사실 증명원_인도일, 계약 종료일.xlsx"의
 * '계약사실 증명원'·'상환스케쥴' 시트 그대로다.
 *
 * 흐름은 청구서 자동 발송과 같다.
 *   1. 화면(인도 서류 발송)이 이 계약의 값으로 두 서류를 그려 보여 준다.
 *   2. 담당자가 [승인]하면 화면이 PDF를 만들어 보내고, 서버가 계약서 폴더(OneDrive)에 저장한다.
 *   3. 발송일(인도일 다음 날) 아침 9시에 서버가 그 PDF를 고객 메일로 보낸다.
 * 승인한 뒤 값(차량번호·금액·회차·받는 주소 등)이 바뀌면 보내지 않고 '변경됨'으로 둔다.
 * 담당자가 본 것과 다른 서류가 고객에게 나가면 되돌릴 수 없다.
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

// 화면에서 담당자가 채우는 칸. 프로그램에 저장된 값이 없는 항목들이다.
export const OVERRIDE_FIELDS = ['driverRange', 'accidentRepair', 'commission', 'receiptDate'];

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
  const schedule = await BillingSchedule.findOne({ contract: contract._id }).select('rounds.no rounds.dueDate rounds.monthlyRent').lean();
  const rounds = [...(schedule?.rounds || [])].sort((a, b) => a.no - b.no);

  const company = contract.companyId || null;
  const customer = contract.customer || null;
  const overrides = contract.deliveryDocs?.overrides || {};

  const party = {
    name: company?.name || customer?.name || contract.leaseCompany || '',
    // 개인 계약자의 주민등록번호는 어디에도 싣지 않는다(저장도 하지 않는다). 사업자번호만 쓴다.
    bizNo: company?.bizNo || '',
    corpNo: company?.corporateRegistrationNo || contract.corporateRegistrationNo || '',
    address: company?.address || customer?.address || '',
    ceoName: company?.ceoName || '',
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
      endDate: kstYmd(contract.endDate),
      firstDueDate: kstYmd(rounds[0]?.dueDate),
      emergency: ins.emergencyService || '',
      regularCheck: maint.regularCheck || '',
      generalMaintenance: maint.generalMaintenance || '',
      consumables: joined ? (maint.consumables || '가입') : '브랜드보증 외 사용자 부담',
      tireText: joined ? describeTireProvision(termMonths, mileage) : '브랜드보증 외 사용자 부담',
      accidentRepair: overrides.accidentRepair || '',
      insurance: {
        driverRange: overrides.driverRange || '',
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
  if (!overrides.driverRange) warnings.push('운전자 범위를 적어 주세요');

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
  return { ...data, snapshot, missing, warnings, overrides, deliveryDocs: contract.deliveryDocs || null, docFolderName: contract.docFolderName || contract.contractNo };
};

const statusOf = (d) => d.deliveryDocs?.status || (d.missing.length ? '준비 안 됨' : '승인 대기');

/**
 * 발송 목록. 인도일이 최근 N일(기본 14, 화면에서 늘릴 수 있음) ~ 앞으로 30일인 계약과, 승인했지만 아직 안 보낸 계약.
 * @route GET /api/delivery-docs/queue?back=14
 */
export const getDeliveryDocsQueue = async (req, res) => {
  try {
    const today = todayKst();
    const back = Math.min(Math.max(Number(req.query.back) || 14, 1), 365);
    const from = new Date(Date.parse(`${addDays(today, -back)}T00:00:00+09:00`));
    const until = new Date(Date.parse(`${addDays(today, 31)}T00:00:00+09:00`));
    const vehicleContracts = await Vehicle.distinct('contract', { deliveryDate: { $gte: from, $lt: until }, contract: { $ne: null } });
    const pending = await Contract.distinct('_id', { 'deliveryDocs.status': { $in: ['승인', '발송중', '실패', '변경됨'] } });
    const ids = [...new Set([...vehicleContracts, ...pending].map(String))];

    const items = [];
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const d = await buildDeliveryDocs(id);
      if (!d || d.contractStatus === '임시저장') continue;
      items.push({
        contractId: d.contractId,
        contractNo: d.contractNo,
        partyName: d.party.name,
        vehicles: d.docs.map((x) => ({ plateNo: x.plateNo, carModel: x.carModel, deliveryDate: x.deliveryDate })),
        to: d.to,
        sendDate: d.sendDate,
        status: statusOf(d),
        changed: d.deliveryDocs?.status === '승인' && d.deliveryDocs.snapshot !== d.snapshot,
        message: d.deliveryDocs?.message || '',
        sentAt: d.deliveryDocs?.sentAt || null,
        approvedBy: d.deliveryDocs?.approvedBy || '',
        missing: d.missing,
        warnings: d.warnings
      });
    }
    items.sort((a, b) => String(a.sendDate || '9').localeCompare(String(b.sendDate || '9')));
    res.json({ success: true, today, items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
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
 * 승인. 화면이 만든 PDF를 계약서 폴더에 저장하고 발송일 아침에 보낸다.
 * @route POST /api/delivery-docs/:contractId/approve (multipart: file, snapshot)
 */
export const approveDeliveryDocs = async (req, res) => {
  try {
    const d = await buildDeliveryDocs(req.params.contractId);
    if (!d) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    if (!req.file) return res.status(400).json({ success: false, message: 'PDF가 없습니다.' });
    if (d.missing.length) return res.status(400).json({ success: false, message: `아직 보낼 수 없습니다: ${d.missing.join(', ')}` });
    if (req.body.snapshot !== d.snapshot) {
      return res.status(409).json({ success: false, message: '화면을 연 뒤 계약·차량 정보가 바뀌었습니다. 새로고침 후 다시 승인해 주세요.' });
    }
    const contract = await Contract.findById(d.contractId);
    if (['발송중', '발송완료'].includes(contract.deliveryDocs?.status)) {
      return res.status(409).json({ success: false, message: '이미 보냈거나 보내는 중인 서류입니다.' });
    }

    const fileName = `계약사실증명원_상환스케쥴_${d.party.name}_${d.contractNo}.pdf`;
    const saved = await saveDocument({
      partyName: d.party.name,
      kind: 'contract',
      subFolder: d.docFolderName,
      fileName,
      fileBuffer: req.file.buffer
    });
    const who = req.user?.name || req.user?.email || '';
    contract.deliveryDocs = {
      ...(contract.deliveryDocs?.toObject?.() || {}),
      status: '승인',
      to: d.to,
      approvedAt: new Date(),
      approvedBy: who,
      snapshot: d.snapshot,
      pdfFileName: saved.fileName,
      pdfSavedPath: saved.localPath,
      pdfHash: crypto.createHash('sha256').update(req.file.buffer).digest('hex'),
      sentAt: undefined,
      message: ''
    };
    contract.markModified('deliveryDocs');
    await contract.save();
    const when = d.sendDate && d.sendDate > todayKst() ? `${d.sendDate} 아침 9시에` : '오늘(발송일이 지났으면 다음 정기 발송 때)';
    res.json({ success: true, message: `${d.party.name} 계약사실 증명원·상환스케쥴을 승인했습니다. ${when} ${d.to}로 보냅니다.` });
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
        partyName: c.companyId?.name || c.customer?.name || '',
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

/**
 * 바로 보내기(다시 요청한 고객 등). 화면이 만든 PDF를 담당자가 확인한 뒤 누르면 저장하고 그 자리에서 보낸다.
 * 이미 보낸 계약도 다시 보낼 수 있다. 보낸 기록은 history에 쌓인다.
 * @route POST /api/delivery-docs/:contractId/send-now (multipart: file, snapshot, to)
 */
export const sendDeliveryDocsNow = async (req, res) => {
  try {
    const d = await buildDeliveryDocs(req.params.contractId);
    if (!d) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    if (!req.file) return res.status(400).json({ success: false, message: 'PDF가 없습니다.' });
    if (req.body.snapshot !== d.snapshot) {
      return res.status(409).json({ success: false, message: '화면을 연 뒤 계약·차량 정보가 바뀌었습니다. 새로고침 후 다시 보내 주세요.' });
    }
    const to = String(req.body.to || d.to || '').trim();
    if (!isEmail(to)) return res.status(400).json({ success: false, message: '받는 사람 이메일을 확인해 주세요.' });
    const blocking = d.missing.filter((m) => !m.startsWith('받는 사람'));
    if (blocking.length) return res.status(400).json({ success: false, message: `아직 보낼 수 없습니다: ${blocking.join(', ')}` });
    if (d.deliveryDocs?.status === '발송중') return res.status(409).json({ success: false, message: '지금 보내는 중입니다. 잠시 뒤 다시 확인해 주세요.' });

    const fileName = `계약사실증명원_상환스케쥴_${d.party.name}_${d.contractNo}.pdf`;
    const saved = await saveDocument({ partyName: d.party.name, kind: 'contract', subFolder: d.docFolderName, fileName, fileBuffer: req.file.buffer });
    await sendDeliveryDocsMail({
      to,
      fileName,
      fileBuffer: req.file.buffer,
      values: {
        계약자: d.party.name,
        계약번호: d.contractNo,
        차량번호: d.docs.map((x) => x.plateNo).filter(Boolean).join(', '),
        인도일: d.docs.map((x) => x.deliveryDate).filter(Boolean).sort()[0] || ''
      }
    });
    const who = req.user?.name || req.user?.email || '';
    await Contract.updateOne({ _id: d.contractId }, {
      $set: {
        'deliveryDocs.status': '발송완료',
        'deliveryDocs.sentAt': new Date(),
        'deliveryDocs.message': '',
        'deliveryDocs.pdfFileName': saved.fileName,
        'deliveryDocs.pdfSavedPath': saved.localPath,
        'deliveryDocs.pdfHash': crypto.createHash('sha256').update(req.file.buffer).digest('hex'),
        'deliveryDocs.snapshot': d.snapshot
      },
      $push: { 'deliveryDocs.history': { sentAt: new Date(), to, by: who, kind: '요청 발송', fileName: saved.fileName } }
    });
    res.json({ success: true, message: `${d.party.name} 계약사실 증명원·상환스케쥴을 ${to}로 보냈습니다.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** 승인 취소 / 보내지 않기. @route POST /api/delivery-docs/:contractId/cancel { skip? } */
export const cancelDeliveryDocs = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.contractId);
    if (!contract) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    if (['발송중', '발송완료'].includes(contract.deliveryDocs?.status)) {
      return res.status(409).json({ success: false, message: '이미 보냈거나 보내는 중인 서류입니다.' });
    }
    const current = contract.deliveryDocs?.toObject?.() || {};
    contract.deliveryDocs = { overrides: current.overrides, to: current.to, ...(req.body?.skip ? { status: '보내지 않음' } : {}) };
    contract.markModified('deliveryDocs');
    await contract.save();
    res.json({ success: true, message: req.body?.skip ? '이 계약은 보내지 않음으로 표시했습니다.' : '승인을 취소했습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** 승인할 때 저장한 PDF. @route GET /api/delivery-docs/:contractId/file */
export const getDeliveryDocsFile = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.contractId).select('deliveryDocs').lean();
    if (!contract?.deliveryDocs?.pdfSavedPath) return res.status(404).json({ success: false, message: '승인한 서류가 없습니다.' });
    const buffer = await readSavedFile(contract.deliveryDocs.pdfSavedPath);
    if (!buffer) return res.status(410).json({ success: false, message: '파일이 OneDrive에서 옮겨졌거나 지워져 열 수 없습니다.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(contract.deliveryDocs.pdfFileName || 'docs.pdf')}`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

let running = false;

/**
 * 승인된 서류 중 발송일이 된 것을 보낸다. 매일 아침 9시 정기 작업과 화면의 [지금 보내기]가 부른다.
 * @param {{contractId?: string, ignoreSendDate?: boolean}} [options]
 */
export const runDeliveryDocsSend = async ({ contractId, ignoreSendDate = false } = {}) => {
  if (running) return { sent: 0, held: 0, failed: 0, results: [], busy: true };
  running = true;
  try {
    const today = todayKst();
    const filter = { 'deliveryDocs.status': '승인' };
    if (contractId) filter._id = contractId;
    const contracts = await Contract.find(filter).select('_id').lean();
    const results = [];
    for (const { _id } of contracts) {
      /* eslint-disable no-await-in-loop */
      const d = await buildDeliveryDocs(_id);
      if (!d) continue;
      if (!ignoreSendDate && (!d.sendDate || d.sendDate > today)) continue;
      const record = { partyName: d.party.name, contractNo: d.contractNo, to: d.deliveryDocs.to };
      const hold = async (status, message) => {
        await Contract.updateOne({ _id }, { $set: { 'deliveryDocs.status': status, 'deliveryDocs.message': message } });
        results.push({ ...record, status, message });
      };
      if (d.deliveryDocs.snapshot !== d.snapshot) { await hold('변경됨', '승인한 뒤 계약·차량·회차·받는 주소가 바뀌었습니다. 다시 확인하고 승인해 주세요.'); continue; }
      const pdf = await readSavedFile(d.deliveryDocs.pdfSavedPath);
      if (!pdf) { await hold('실패', '승인할 때 저장한 PDF를 찾지 못했습니다. 다시 승인해 주세요.'); continue; }
      if (d.deliveryDocs.pdfHash && crypto.createHash('sha256').update(pdf).digest('hex') !== d.deliveryDocs.pdfHash) {
        await hold('변경됨', '승인한 뒤 OneDrive의 PDF가 바뀌었습니다. 다시 승인해 주세요.');
        continue;
      }
      // 보내기 직전에 붙잡는다. 화면의 [지금 보내기]와 정기 작업이 겹쳐도 한 번만 나간다.
      const claim = await Contract.updateOne({ _id, 'deliveryDocs.status': '승인' }, { $set: { 'deliveryDocs.status': '발송중' } });
      if (claim.modifiedCount !== 1) { results.push({ ...record, status: '건너뜀', message: '그사이 다른 곳에서 처리했습니다.' }); continue; }
      try {
        await sendDeliveryDocsMail({
          to: d.deliveryDocs.to,
          fileName: d.deliveryDocs.pdfFileName,
          fileBuffer: pdf,
          values: {
            계약자: d.party.name,
            계약번호: d.contractNo,
            차량번호: d.docs.map((x) => x.plateNo).filter(Boolean).join(', '),
            인도일: d.docs.map((x) => x.deliveryDate).filter(Boolean).sort()[0] || ''
          }
        });
        await Contract.updateOne({ _id }, {
          $set: { 'deliveryDocs.status': '발송완료', 'deliveryDocs.sentAt': new Date(), 'deliveryDocs.message': '' },
          $push: { 'deliveryDocs.history': { sentAt: new Date(), to: d.deliveryDocs.to, by: '자동 발송', kind: '인도 다음 날', fileName: d.deliveryDocs.pdfFileName } }
        });
        results.push({ ...record, status: '발송완료' });
      } catch (err) {
        // 메일이 나갔는지 모르므로 '승인'으로 되돌리지 않는다. 사람이 확인한다.
        await hold('실패', `보내는 도중 오류가 났습니다. 메일이 나갔는지 확인해 주세요. (${err.message})`);
      }
      /* eslint-enable no-await-in-loop */
    }
    const count = (st) => results.filter((r) => r.status === st).length;
    const summary = { sent: count('발송완료'), held: count('변경됨'), failed: count('실패'), results };
    if (results.length) console.log(`[인도 서류 발송] 보냄 ${summary.sent} · 보류 ${summary.held} · 실패 ${summary.failed}`);
    return summary;
  } finally {
    running = false;
  }
};

/** @route POST /api/delivery-docs/run { contractId? } */
export const runDeliveryDocsNow = async (req, res) => {
  try {
    const one = Boolean(req.body?.contractId);
    const summary = await runDeliveryDocsSend({ contractId: req.body?.contractId, ignoreSendDate: one });
    if (summary.busy) return res.status(409).json({ success: false, message: '발송이 이미 돌고 있습니다. 잠시 뒤 새로고침해 주세요.' });
    const parts = [`${summary.sent}건 보냈습니다.`];
    if (summary.held) parts.push(`${summary.held}건은 내용이 바뀌어 보류했습니다.`);
    if (summary.failed) parts.push(`${summary.failed}건은 실패했습니다.`);
    res.json({ success: true, ...summary, message: summary.results.length ? parts.join(' ') : '보낼 서류가 없습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 오후 알림: 내일(또는 이미 지난) 발송일인데 아직 승인 안 한 계약을 담당자 메일로 알린다. 없으면 보내지 않는다.
 */
export const sendDeliveryDocsReminder = async () => {
  const tomorrow = addDays(todayKst(), 1);
  const from = new Date(Date.now() - 30 * DAY);
  const ids = await Vehicle.distinct('contract', { deliveryDate: { $gte: from }, contract: { $ne: null } });
  const rows = [];
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const d = await buildDeliveryDocs(id);
    if (!d || d.contractStatus === '임시저장' || d.deliveryDocs?.status) continue;
    if (!d.sendDate || d.sendDate > tomorrow) continue;
    rows.push(`<li>${d.party.name} (${d.contractNo}) · 발송일 ${d.sendDate}${d.missing.length ? ` · 빠진 것: ${d.missing.join(', ')}` : ''}</li>`);
  }
  if (!rows.length) return { count: 0 };
  await sendInternalMail({
    subject: `[인도 서류] 승인 안 한 계약사실 증명원 ${rows.length}건`,
    html: `<p>아래 계약은 계약사실 증명원·상환스케쥴 발송일이 내일이거나 지났는데 아직 승인하지 않았습니다.</p><ul>${rows.join('')}</ul><p>프로그램 &gt; 계약·출고 &gt; 인도 서류 발송에서 확인해 주세요.</p>`
  });
  return { count: rows.length };
};
