import VehicleService from '../models/VehicleService.js';
import Vehicle from '../models/Vehicle.js';
import CalendarInbox from '../models/CalendarInbox.js';
import { saveDocument, readSavedFile } from '../utils/documentStorageService.js';
import { mimeTypeOf } from '../utils/oneDriveStorage.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';
import { vehicleEndOf, lastDayOf } from '../utils/contractTerm.js';
import { readInvoiceText, parseRepairInvoice } from '../utils/repairInvoice.js';
import { parseServiceDocument, pickServiceTarget } from '../utils/serviceDocument.js';
import { planVehicle, mileageUsageOf, kstYmd, addMonths, SERVICE_KINDS, REPAIR_KINDS, INSPECTION_RULE, MAINTENANCE_RULE, CAR_AGE_RULE } from '../utils/vehicleServicePlan.js';
import { bookingStateOf } from '../utils/serviceBooking.js';
import { SERVICE_ACTIVE_STATUSES, partyNameOf, syncVehicleServiceSchedules, loadServiceRecords } from '../utils/vehicleServiceScheduleJob.js';

// 화면에서 고칠 수 있는 항목. 차량과 파일은 올릴 때만 정해진다.
const EDITABLE = ['kind', 'date', 'mileage', 'amount', 'shop', 'description', 'memo'];

// 기록 종류별로 영수증을 넣을 계약자 폴더 (utils/documentPath.js의 DOC_KINDS)
const DOC_KIND_OF = {
  자동차검사: 'inspection',
  정기점검: 'regularCheck',
  고장수리: 'repair',
  사고수리: 'accidentRepair',
  소모품교환: 'repair',
  기타: 'repair'
};

const VEHICLE_FIELDS = 'plateNo carModel status registrationDate inspectionValidity cc fuelType deliveryDate rentBillingDate maintenance contract company contractorName currentMileage paymentTerm driver driverInfo serviceNotes';

// 계약 만료일(차마다 인도일 기준)을 세는 데 필요한 칸까지. 담당자 연락처는 운전자가 비어 있을 때 대신 보여 준다
const CONTRACT_FIELDS = 'leaseCompany termMonths contractNo contractKind contractDate deliveryDate status managerMain managerMainPhone managerOps managerOpsPhone';

/**
 * 예약·검사 때 연락할 사람(대표님 2026-11-17 "운전자 명과 전화번호도 같이").
 * 렌트차량 DB의 운전자가 정본이고, 비어 있으면 계약서의 실무담당자 → 책임담당자를 쓴다(source로 어디서 왔는지 알린다).
 * @returns {{name: string, phone: string, relation: string, note: string, source: string} | null}
 */
const driverOf = (v) => {
  const d = v.driverInfo || {};
  if (d.name || d.phone || v.driver) {
    return { name: d.name || v.driver || '', phone: d.phone || '', relation: d.relation || '', note: d.note || '', source: '운전자' };
  }
  const c = v.contract || {};
  if (c.managerOps || c.managerOpsPhone) return { name: c.managerOps || '', phone: c.managerOpsPhone || '', relation: '실무담당자', note: '', source: '계약 실무담당자' };
  if (c.managerMain || c.managerMainPhone) return { name: c.managerMain || '', phone: c.managerMainPhone || '', relation: '책임담당자', note: '', source: '계약 책임담당자' };
  return null;
};

const loadVehicle = (filter) => Vehicle.findOne(filter)
  .select(VEHICLE_FIELDS)
  .populate('contract', CONTRACT_FIELDS)
  .populate('company', 'name')
  .lean();

const DAY = 24 * 60 * 60 * 1000;

/**
 * 정기점검 횟수와 계약 주행거리 대비 실제 주행.
 *
 * - 정기점검: 계약 기간 동안 몇 번 받아야 하는지(계약 개월 ÷ 점검 주기), 몇 번 받았는지, 남은 횟수.
 *   점검 주기는 정기점검 계획(nextMaintenance)의 개월 수를 쓰고, 미가입 차는 연 1회로 센다.
 * - 주행: 기록에 적은 주행거리로 월 주행을 구해 약정과 견준다(mileageUsageOf).
 *   계약 끝날 때 예상 주행이 약정 총량보다 짧은지 긴지도 본다. 연 환산이 약정의 120%를 넘으면 정비 주기를 당기고 고객에게 안내해야 한다(대표님 2026-10).
 *   덜 타더라도 1년 넘게 정기점검이 없으면 연 1회 점검 안내가 필요하다.
 */
const usageOf = (v, records, plan) => {
  // 예정·입고·수리 중은 아직 받은 점검이 아니다
  const checks = records.filter((r) => r.kind === '정기점검' && (!r.status || r.status === '완료'));
  const termMonths = Number(v.paymentTerm) || Number(v.contract?.termMonths) || 0;
  const intervalMonths = plan.maintenance?.intervalMonths || 12;
  const expected = termMonths ? Math.max(1, Math.floor(termMonths / intervalMonths)) : null;

  const delivered = v.deliveryDate ? new Date(v.deliveryDate) : null;
  const lastKm = Math.max(Number(v.currentMileage) || 0, ...records.map((r) => Number(r.mileageOut || r.mileage) || 0));
  const months = delivered ? (Date.now() - delivered.getTime()) / DAY / 30.44 : 0;
  const contractKm = Number(v.maintenance?.mileage) || null;

  // 남은 횟수: 전체 예정 - 받은 횟수로 세면 계약 끝 무렵 차가 "10회 남음"처럼 나온다.
  // 다음 점검일부터 계약 끝나는 날까지 주기마다 몇 번 돌아오는지로 센다.
  const contractEnd = delivered && termMonths ? addMonths(kstYmd(delivered), termMonths) : '';
  // 계기판 숫자 ÷ 인도 뒤 개월로 연 환산하면 중고로 다시 내보낸 차가 약정의 10배로 나왔다. 기록 사이 주행으로 센다.
  const mileage = mileageUsageOf({
    records,
    deliveryDate: v.deliveryDate,
    contractEnd: v.status === '장기렌트' && v.contract?.termMonths ? kstYmd(lastDayOf(vehicleEndOf(v.contract, v))) : contractEnd,
    annualKm: contractKm,
    termMonths,
    longTerm: v.status === '장기렌트'
  });
  const annualizedKm = mileage?.annualizedKm || null;
  const ratio = annualizedKm && contractKm ? annualizedKm / contractKm : null;
  const nextCheck = plan.maintenance?.date || '';
  let remaining = null;
  if (contractEnd && nextCheck) {
    remaining = 0;
    for (let d = nextCheck; d <= contractEnd && remaining < 100; d = addMonths(d, intervalMonths)) remaining += 1;
  }

  const lastCheckRecord = [...checks].sort((a, b) => (kstYmd(a.date) < kstYmd(b.date) ? -1 : 1)).pop();
  const lastCheck = lastCheckRecord ? kstYmd(lastCheckRecord.date) : '';
  const sinceLastCheckDays = lastCheck ? Math.floor((Date.now() - new Date(lastCheck).getTime()) / DAY) : null;
  const notices = [];
  if (ratio && ratio > 1.2) {
    notices.push({ type: 'over', text: `약정 ${contractKm.toLocaleString()}km/년보다 많이 탑니다(연 환산 ${annualizedKm.toLocaleString()}km, ${Math.round(ratio * 100)}%). 정비 주기를 당기고 고객에게 안내해야 합니다.` });
  }
  if (months >= 12 && (sinceLastCheckDays === null || sinceLastCheckDays > 365)) {
    notices.push({ type: 'yearly', text: `1년 넘게 정기점검 기록이 없습니다${lastCheck ? `(마지막 ${lastCheck})` : ''}. 덜 타더라도 연 1회 정기점검을 받도록 안내해야 합니다.` });
  }

  return {
    checks: {
      done: checks.length, expected, remaining, intervalMonths, termMonths: termMonths || null, contractEnd: contractEnd || null, last: lastCheck,
      // 마지막 정기점검 때 주행거리·정비소. 정기점검 목록에서 "언제, 몇 km에, 어디서" 받았는지 보여 준다
      lastKm: Number(lastCheckRecord?.mileageOut || lastCheckRecord?.mileage) || null, lastShop: lastCheckRecord?.shop || ''
    },
    usage: { lastKm: lastKm || null, monthsSinceDelivery: Math.round(months * 10) / 10, contractKm, annualizedKm, ratio: ratio ? Math.round(ratio * 100) : null, mileage },
    notices
  };
};

/**
 * 스노우 타이어 고객의 이번 철 교체 안내.
 * 10~12월: 스노우 타이어로 교체 / 3~4월: 일반 타이어로 되돌리기. 그 철에 타이어를 바꾼 기록이 있으면 done.
 * 그 밖의 달이나 스노우 타이어 고객이 아니면 null.
 */
export const snowTireSeasonOf = (snowTire, records, today = kstYmd(new Date())) => {
  if (!snowTire) return null;
  const [y, m] = today.split('-').map(Number);
  let season;
  if (m >= 10) season = { type: 'winter', label: '스노우 타이어 교체', start: `${y}-10-01`, re: /스노우|윈터/ };
  else if (m >= 3 && m <= 4) season = { type: 'spring', label: '일반 타이어로 교체', start: `${y}-03-01`, re: /일반s*타이어|사계절|썸머|스노우[^/]*보관/ };
  else return null;
  const done = records
    .filter((r) => kstYmd(r.date) >= season.start && kstYmd(r.date) <= today && season.re.test(String(r.description || '')))
    .map((r) => kstYmd(r.date)).sort().pop() || '';
  return { type: season.type, label: season.label, done };
};

// 구글 업무캘린더에서 읽었지만 아직 '확인 대기'인 일정. 기록으로 옮기기 전에도 달력·목록에 보이게 한다
// (2026-10-30 임태형 이사님 그랜저 사고수리·정기점검·검사가 대기에만 있어 달력에 안 보였다).
const loadWaiting = (vehicle = { $ne: null }) => CalendarInbox.find({ status: '대기', vehicle })
  .select('eventId vehicle start title description parsed htmlLink').lean();
const pendingView = (w) => ({
  id: w._id, date: kstYmd(w.start), kinds: w.parsed?.kinds || [], title: w.title || '', link: w.htmlLink || '', description: w.description || '',
  // 달력 정보 창에서 칸마다 미리 채울 값
  parsed: { shop: w.parsed?.shop || '', staff: w.parsed?.staff || '', request: w.parsed?.request || '', done: w.parsed?.done || '', mileage: w.parsed?.mileageOut || w.parsed?.mileageIn || '', amount: w.parsed?.amount || '' }
});

/** 화면 한 줄. 목록과 차량 상세가 같은 모양을 쓴다. */
const rowOf = (v, records, waiting = []) => {
  const plan = planVehicle(v, records);
  return {
    vehicleId: v._id,
    plateNo: v.plateNo || '',
    carModel: v.carModel || '',
    status: v.status,
    partyName: partyNameOf(v),
    driver: driverOf(v),
    notes: { pinned: v.serviceNotes?.pinned || '', next: v.serviceNotes?.next || '', snowTire: Boolean(v.serviceNotes?.snowTire), updatedAt: v.serviceNotes?.updatedAt || null, updatedBy: v.serviceNotes?.updatedBy || '' },
    snowSeason: snowTireSeasonOf(v.serviceNotes?.snowTire, records),
    registrationDate: kstYmd(v.registrationDate),
    deliveryDate: kstYmd(v.deliveryDate),
    annualKm: v.maintenance?.mileage || null,
    generalMaintenance: v.maintenance?.generalMaintenance || '',
    currentMileage: v.currentMileage || 0,
    recordCount: records.length,
    // 장기렌트 계약 종료일(마지막 날). 달력에 '계약만료'로 올린다.
    contractEnd: v.status === '장기렌트' && v.contract?.termMonths ? kstYmd(lastDayOf(vehicleEndOf(v.contract, v))) : '',
    contractNo: v.contract?.contractNo || '',
    // 달력에 '일어난 날'로 올리는 고장·사고 수리(최근 13개월). 진행 중인 수리도 함께.
    repairs: records
      // 고장·사고 수리는 진행 상태와 상관없이, 검사·점검 등은 끝난 기록만(아직 안 끝난 것은 bookings). 달력에 ✅·🔧로 남는다
      .filter((r) => (REPAIR_KINDS.includes(r.kind) || !r.status || r.status === '완료') && kstYmd(r.date) >= addMonths(kstYmd(new Date()), -13))
      .map((r) => ({ id: r._id, kind: r.kind, date: kstYmd(r.date), status: r.status || '완료', amount: r.amount || 0, description: r.description || '', shop: r.shop || '' })),
    // 달력에서 미리 잡아 둔 검사·점검 등(아직 끝나지 않은 기록). 계산한 날짜 대신 이 날에 보인다.
    bookings: records
      .filter((r) => !REPAIR_KINDS.includes(r.kind) && r.status && r.status !== '완료')
      .map((r) => ({ id: r._id, kind: r.kind, date: kstYmd(r.date), status: r.status, shop: r.shop || '' })),
    ...plan,
    ...usageOf(v, records, plan),
    // 프로그램 예약과 구글 일정을 합친 예약 상태. 목록 칩([정기점검 지남] 등)이 이것으로 예약한 차를 뺀다(2026-11-25)
    booking: Object.fromEntries(['정기점검', '자동차검사'].map((k) => [k, bookingStateOf(k, records, waiting)])),
    pending: waiting.map(pendingView)
  };
};

/**
 * 해마다 외주 탁송 km당 평균 단가. 예상 탁송료를 보여 주고, 매년 얼마나 올랐는지 보는 데 쓴다.
 * @returns {Promise<{year: number, perKm: number, count: number}[]>}
 */
const transportRates = async () => {
  const rows = await VehicleService.find({ $or: [{ 'transport.in.fee': { $gt: 0 } }, { 'transport.out.fee': { $gt: 0 } }] })
    .select('date transport').lean();
  const byYear = new Map();
  for (const r of rows) {
    for (const leg of [r.transport?.in, r.transport?.out]) {
      if (!(leg?.fee > 0) || !(leg?.distanceKm > 0)) continue;
      const y = Number(kstYmd(r.date).slice(0, 4));
      const cur = byYear.get(y) || { year: y, fee: 0, km: 0, count: 0 };
      cur.fee += leg.fee; cur.km += leg.distanceKm; cur.count += 1;
      byYear.set(y, cur);
    }
  }
  return [...byYear.values()].sort((a, b) => a.year - b.year).map((x) => ({ year: x.year, perKm: Math.round(x.fee / x.km), count: x.count }));
};

/**
 * 상세 양식 값을 저장할 모양으로 바꾼다. 파일과 함께 올 때는 FormData의 data 칸에 JSON으로 온다.
 * 예전 간단 양식(칸이 따로 오는 것)도 그대로 받는다.
 */
const bodyOf = (req) => {
  if (typeof req.body?.data === 'string') {
    try { return { ...req.body, ...JSON.parse(req.body.data) }; } catch { return req.body; }
  }
  return req.body || {};
};

const DETAIL_TEXT = ['status', 'staff', 'request', 'fuelIn', 'fuelOut', 'payer', 'insurer', 'claimNo', 'fault', 'loaner', 'callAfterIn', 'callGuide', 'callAfterOut', 'mood', 'contactName', 'contactPhone', 'nextTodo'];
// person: 픽업 때 차를 넘겨준 사람 / 인도 때 받은 사람
const LEG_TEXT = ['method', 'from', 'to', 'person', 'vendor'];

const applyDetail = (record, b) => {
  for (const key of DETAIL_TEXT) if (b[key] !== undefined) record[key] = String(b[key] ?? '');
  for (const key of ['inAt', 'outAt']) {
    if (b[key] === undefined) continue;
    const d = b[key] ? new Date(b[key]) : null;
    record[key] = d && !Number.isNaN(d.getTime()) ? d : undefined;
  }
  for (const key of ['mileageIn', 'mileageOut', 'deductible']) if (b[key] !== undefined) record[key] = numberOrUndefined(b[key]);
  if (b.transport) {
    const t = {};
    for (const side of ['in', 'out']) {
      const leg = b.transport[side] || {};
      t[side] = {};
      LEG_TEXT.forEach((k) => { t[side][k] = String(leg[k] ?? ''); });
      t[side].distanceKm = numberOrUndefined(leg.distanceKm);
      // 외주 탁송이 아니면 탁송료가 없다
      t[side].fee = leg.method === '외주 탁송' ? numberOrUndefined(leg.fee) : undefined;
    }
    record.transport = t;
  }
  if (b.costs) {
    record.costs = { repair: numberOrUndefined(b.costs.repair), vat: numberOrUndefined(b.costs.vat), insurancePaid: numberOrUndefined(b.costs.insurancePaid) };
  }
  if (Array.isArray(b.parts)) {
    record.parts = b.parts.filter((p) => p?.zone && ['교환', '판금·도색', '수리·점검'].includes(p.action))
      .map((p) => ({ zone: String(p.zone), action: p.action, memo: String(p.memo || '') }));
  }
  if (Array.isArray(b.consumables)) record.consumables = b.consumables.map(String);
  if (Array.isArray(b.lines)) {
    record.lines = b.lines.filter((l) => String(l?.name || '').trim())
      .map((l) => ({ name: String(l.name).trim(), ...Object.fromEntries(['qty', 'unitPrice', 'parts', 'labor', 'amount'].map((k) => [k, numberOrUndefined(l[k])])) }));
  }
  if (b.carAgeExtended !== undefined) record.carAgeExtended = b.carAgeExtended === true || b.carAgeExtended === 'true';
  if (b.inspection) record.inspection = { result: String(b.inspection.result || ''), nextDate: String(b.inspection.nextDate || '') };
  if (b.invoice) {
    const inv = b.invoice;
    record.invoice = {
      bizNo: String(inv.bizNo || ''), issuedDate: String(inv.issuedDate || ''), text: String(inv.text || ''),
      ...Object.fromEntries(['partsTotal', 'laborTotal', 'supply', 'vat', 'discount', 'total'].map((k) => [k, numberOrUndefined(inv[k])]))
    };
  }

  // 예전 칸과 맞춘다: 날짜는 출고(없으면 입고), 주행거리는 출고 때 값, 금액은 수리비 + 부가세
  if (!record.date && (record.outAt || record.inAt)) record.date = record.outAt || record.inAt;
  const km = record.mileageOut || record.mileageIn;
  if (km) record.mileage = km;
  const repair = (record.costs?.repair || 0) + (record.costs?.vat || 0);
  if (repair) record.amount = repair;
};

/** 숫자 칸은 콤마가 섞여 오기도 한다(MoneyInput). 비우면 undefined로 둬 '0km'가 기록되지 않게 한다. */
const numberOrUndefined = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

/**
 * 기록의 주행거리가 차량의 현재 주행거리보다 크면 올려 둔다.
 * 기록을 지우거나 줄여도 내리지는 않는다. 계기판은 거꾸로 가지 않는다.
 */
/**
 * 기록이 바뀌면 캘린더 일정도 바로 맞춘다.
 * 새벽 작업만 두면 오늘 검사를 적어도 내일 새벽까지 캘린더에 '예정'으로 남는다.
 * 기다리지 않는다. 캘린더가 늦어도 기록 저장은 이미 끝났고, 새벽 작업이 다시 챙긴다.
 */
const refreshSchedules = () => {
  syncVehicleServiceSchedules().catch((err) => console.error('[정비·검사 일정] 실패:', err.message));
};

const raiseVehicleMileage = async (vehicleId, mileage) => {
  if (!(Number(mileage) > 0)) return;
  await Vehicle.updateOne({ _id: vehicleId, currentMileage: { $lt: Number(mileage) } }, { $set: { currentMileage: Number(mileage) } });
};

/** 올린 파일을 계약자 OneDrive 폴더의 차량번호 폴더에 넣는다 → attachments 항목들 */
const saveAttachments = async (vehicle, kind, dateRaw, uploads) => {
  const attachments = [];
  for (const [i, f] of uploads.entries()) {
    const ext = (f.originalname.match(/\.[^.]+$/) || ['.pdf'])[0];
    // 차량번호_날짜_종류: 같은 차의 영수증이 폴더에서 날짜순으로 늘어선다
    const saved = await saveDocument({
      partyName: partyNameOf(vehicle) || '계약사미상',
      kind: DOC_KIND_OF[kind],
      subFolder: vehicle.plateNo || '차량번호미상',
      fileName: `${vehicle.plateNo || '차량'}_${kstYmd(dateRaw)}_${kind}${uploads.length > 1 ? `_${i + 1}` : ''}${ext}`,
      fileBuffer: f.buffer,
      keepPrevious: true // 같은 날 두 건(점검+수리)이면 이름이 같다. 덮지 않고 이름을 바꿔 남긴다
    });
    attachments.push({ fileName: saved.fileName, savedPath: saved.localPath, label: Buffer.from(f.originalname, 'latin1').toString('utf8') });
  }
  return attachments;
};

/**
 * 수리 내역서를 읽어 양식에 채울 값을 돌려준다. 저장하지 않는다.
 * 파일을 올리면 글자를 꺼내 정리하고, 화면에서 고친 글자(text)를 보내면 그 글자로 다시 정리한다.
 *
 * @route POST /api/vehicle-services/read-invoice
 */
export const readRepairInvoiceFile = async (req, res) => {
  try {
    let text = typeof req.body?.text === 'string' ? req.body.text : '';
    let source = 'text';
    if (req.file) {
      const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
      ({ text, source } = await readInvoiceText(req.file.buffer, req.file.mimetype, name));
    }
    if (!text.trim()) return res.status(400).json({ success: false, message: '읽을 글자가 없습니다. 파일을 올리거나 내역서 글자를 붙여 넣어 주세요.' });
    const parsed = parseRepairInvoice(text);
    console.log(`[수리 내역서] ${source} ${text.length}자 · 줄 ${parsed.lines.length} · 합계 ${parsed.total}`);
    res.json({ success: true, source, text, parsed });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** 화면에 보낼 '넣을 일정' 한 건 */
const targetView = (r) => (r ? {
  recordId: r._id, kind: r.kind, date: kstYmd(r.date), status: r.status || '완료', shop: r.shop || '', hasDescription: Boolean(r.description)
} : null);

/** 차량번호로 차를 찾는다. 번호판이 바뀐 차도 찾고, 같은 번호면 운행 중인 차를 먼저 */
const findVehicleByPlate = async (plateNo) => {
  const plate = String(plateNo || '').replace(/\s+/g, '');
  if (!plate) return null;
  const list = await Vehicle.find({ $or: [{ plateNo: plate }, { 'plateHistory.plateNo': plate }] })
    .select(VEHICLE_FIELDS).populate('contract', CONTRACT_FIELDS).populate('company', 'name').lean();
  return list.find((v) => SERVICE_ACTIVE_STATUSES.includes(v.status)) || list[0] || null;
};

const targetOf = async (vehicle, kind, date) => {
  const records = (await loadServiceRecords([vehicle])).get(String(vehicle._id)) || [];
  return targetView(pickServiceTarget(records, { kind, date }));
};

/**
 * 자동차검사 서류나 수리 내역서를 읽어 차와 일정을 찾아 준다. 저장하지 않는다.
 * vehicleId를 주면(일정 창에서 올릴 때) 그 차로 보고, 없으면 서류의 차량번호로 찾는다.
 *
 * @route POST /api/vehicle-services/read-document  (file, vehicleId?)
 */
export const readServiceDocument = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '올린 파일이 없습니다.' });
    const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const { text, source } = await readInvoiceText(req.file.buffer, req.file.mimetype, name);
    if (!text.trim()) return res.status(400).json({ success: false, message: '글자를 읽지 못했습니다. 사진이 선명한지 확인해 주세요.' });
    const parsed = parseServiceDocument(text);
    const vehicle = req.body?.vehicleId ? await loadVehicle({ _id: req.body.vehicleId }) : await findVehicleByPlate(parsed.plateNo);
    const kind = parsed.kindGuess || '고장수리';
    console.log(`[AS 서류] ${source} ${parsed.docType} ${text.length}자 · 차 ${parsed.plateNo || '-'} · ${parsed.date || '-'}`);
    const target = vehicle ? await targetOf(vehicle, kind, parsed.date) : null;
    res.json({
      // 찾은 일정이 있으면 그 종류를 따른다. 정기점검 일정에 내역서를 올렸다고 고장수리로 바뀌면 점검 주기가 틀어진다
      success: true, source, text, parsed, kind: target?.kind || kind, target,
      vehicle: vehicle ? { vehicleId: vehicle._id, plateNo: vehicle.plateNo || '', carModel: vehicle.carModel || '', partyName: partyNameOf(vehicle) } : null
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 차·종류·날짜를 사람이 고쳤을 때 넣을 일정을 다시 찾는다.
 *
 * @route GET /api/vehicle-services/match?vehicleId=&kind=&date=
 */
export const matchServiceTarget = async (req, res) => {
  try {
    const vehicle = await loadVehicle({ _id: req.query.vehicleId });
    if (!vehicle) return res.status(404).json({ success: false, message: '차량을 찾을 수 없습니다.' });
    res.json({ success: true, target: await targetOf(vehicle, String(req.query.kind || ''), String(req.query.date || '')) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 이미 있는 기록에 내역서·사진을 더 붙인다. 달력에서 '예정'으로 만든 뒤 수리가 끝나고 내역서를 받는 경우.
 *
 * @route POST /api/vehicle-services/:id/files
 */
export const addVehicleServiceFiles = async (req, res) => {
  try {
    const record = await VehicleService.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: '기록을 찾을 수 없습니다.' });
    if (!req.files?.length) return res.status(400).json({ success: false, message: '올린 파일이 없습니다.' });
    const vehicle = await loadVehicle({ _id: record.vehicle });
    if (!vehicle) return res.status(400).json({ success: false, message: '차량을 찾을 수 없습니다.' });
    const added = await saveAttachments(vehicle, record.kind, record.date, req.files);
    record.attachments = [...(record.attachments || []), ...added];
    if (!record.savedPath) { record.fileName = added[0].fileName; record.savedPath = added[0].savedPath; }
    await record.save();
    res.json({ success: true, record, message: `파일 ${added.length}개를 붙였습니다.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 달력에서 일정을 다른 날로 옮긴다 (끌어 놓기 또는 날짜 바꾸기).
 *
 *  record   이미 있는 기록(잡아 둔 일정·수리 기록). 날짜와 입고·출고 시각을 같은 날수만큼 옮긴다
 *  pending  구글 캘린더 '확인 대기' 일정. 확인 대기 안의 날짜만 옮긴다(구글 일정 자체는 고치지 않는다).
 *           구글에서 그 일정을 다시 고치면 다음 읽기 때 구글 날짜로 돌아온다
 *  plan     계산한 검사·점검 날짜. 옮긴 날로 '예정' 기록을 만든다 — 날을 잡았으니 그날 진행한다
 *
 * @route POST /api/vehicle-services/move  { to: 'YYYY-MM-DD', items: [{ type, id?, vehicleId?, kind? }] }
 */
export const moveVehicleServices = async (req, res) => {
  try {
    const { to, items } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(to || '')) || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, message: '옮길 일정과 날짜를 알려 주세요.' });
    }
    const toDate = new Date(`${to}T00:00:00+09:00`);
    const shift = (d, days) => (d ? new Date(new Date(d).getTime() + days * DAY) : d);
    const daysFrom = (d) => Math.round((toDate - new Date(`${kstYmd(d)}T00:00:00+09:00`)) / DAY);
    const who = req.user?.name || req.user?.email || '';
    const seen = new Set();
    let moved = 0;

    for (const it of items) {
      const key = `${it.type}|${it.id || ''}|${it.vehicleId || ''}|${it.kind || ''}`;
      if (seen.has(key)) continue; // 확인 대기 한 건이 정·검·사 세 칸으로 보여도 한 번만 옮긴다
      seen.add(key);
      if (it.type === 'record') {
        // eslint-disable-next-line no-await-in-loop
        const rec = await VehicleService.findById(it.id);
        if (!rec) continue;
        const days = daysFrom(rec.date);
        if (!days) continue;
        rec.date = shift(rec.date, days);
        if (rec.inAt) rec.inAt = shift(rec.inAt, days);
        if (rec.outAt) rec.outAt = shift(rec.outAt, days);
        // eslint-disable-next-line no-await-in-loop
        await rec.save();
        moved += 1;
      } else if (it.type === 'pending') {
        // eslint-disable-next-line no-await-in-loop
        const item = await CalendarInbox.findById(it.id);
        if (!item || item.status !== '대기') continue;
        const days = daysFrom(item.start);
        if (!days) continue;
        item.start = shift(item.start, days);
        // eslint-disable-next-line no-await-in-loop
        await item.save();
        moved += 1;
      } else if (it.type === 'plan' && SERVICE_KINDS.includes(it.kind)) {
        // eslint-disable-next-line no-await-in-loop
        const vehicle = await Vehicle.findById(it.vehicleId).select('plateNo').lean();
        if (!vehicle) continue;
        // eslint-disable-next-line no-await-in-loop
        await VehicleService.create({
          vehicle: vehicle._id, plateNo: vehicle.plateNo || '', kind: it.kind, date: toDate, status: '예정',
          inAt: new Date(`${to}T10:00:00+09:00`), source: 'manual', memo: '달력에서 날짜를 잡음', createdBy: who
        });
        moved += 1;
      }
    }
    refreshSchedules();
    res.json({ success: true, moved, message: moved ? `${moved}건을 ${to}로 옮겼습니다.` : '옮길 것이 없습니다(이미 그 날짜입니다).' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 운행 중인 차 전부의 다음 자동차검사·정기점검.
 *
 * @route GET /api/vehicle-services/plan
 */
export const getServicePlan = async (req, res) => {
  try {
    const vehicles = await Vehicle.find({ status: { $in: SERVICE_ACTIVE_STATUSES } })
      .select(VEHICLE_FIELDS)
      .populate('contract', CONTRACT_FIELDS)
      .populate('company', 'name')
      .lean();
    // 같은 번호판의 예전 차량 문서에 붙은 기록도 함께 센다(loadServiceRecords 설명)
    const byVehicle = await loadServiceRecords(vehicles, 'vehicle kind date mileage amount description status shop carAgeExtended calendarEventId');

    const waiting = await loadWaiting();
    const rows = vehicles.map((v) => rowOf(v, byVehicle.get(String(v._id)) || [], waiting.filter((w) => String(w.vehicle) === String(v._id))));
    res.json({ success: true, rows, kinds: SERVICE_KINDS, rules: { inspection: INSPECTION_RULE, maintenance: MAINTENANCE_RULE, carAge: CAR_AGE_RULE } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 차 한 대의 기록 전부와 계획.
 *
 * @route GET /api/vehicle-services/vehicle/:vehicleId
 */
export const getVehicleServices = async (req, res) => {
  try {
    const vehicle = await loadVehicle({ _id: req.params.vehicleId });
    if (!vehicle) return res.status(404).json({ success: false, message: '차량을 찾을 수 없습니다.' });
    const records = (await loadServiceRecords([vehicle])).get(String(vehicle._id)) || [];
    res.json({ success: true, records, row: rowOf(vehicle, records, await loadWaiting(vehicle._id)), transportRates: await transportRates() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 차 메모(고정 메모·다음에 할 일·스노우 타이어 고객) 저장.
 *
 * @route PATCH /api/vehicle-services/vehicle/:vehicleId/notes
 */
export const updateServiceNotes = async (req, res) => {
  try {
    const b = req.body || {};
    const notes = {
      pinned: String(b.pinned || '').trim().slice(0, 1000),
      next: String(b.next || '').trim().slice(0, 1000),
      snowTire: Boolean(b.snowTire),
      updatedAt: new Date(),
      updatedBy: req.user?.name || req.user?.email || ''
    };
    const vehicle = await Vehicle.findByIdAndUpdate(req.params.vehicleId, { $set: { serviceNotes: notes } }, { new: true }).select('plateNo').lean();
    if (!vehicle) return res.status(404).json({ success: false, message: '차량을 찾을 수 없습니다.' });
    res.json({ success: true, notes });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 정비·검사·수리 한 건을 적는다. 영수증 파일은 있으면 계약자 폴더의 종류별 폴더에 차량번호별로 넣는다.
 *
 * @route POST /api/vehicle-services
 */
export const createVehicleService = async (req, res) => {
  try {
    const body = bodyOf(req);
    const vehicle = await loadVehicle({ _id: body.vehicleId });
    if (!vehicle) return res.status(400).json({ success: false, message: '차량을 골라 주세요.' });
    const kind = String(body.kind || '').trim();
    if (!SERVICE_KINDS.includes(kind)) return res.status(400).json({ success: false, message: '종류를 골라 주세요.' });
    // 상세 양식은 날짜 대신 입고·출고 시각을 받는다. 출고(없으면 입고)를 기록 날짜로 쓴다.
    const dateRaw = body.date || body.outAt || body.inAt;
    if (!dateRaw || Number.isNaN(new Date(dateRaw).getTime())) {
      return res.status(400).json({ success: false, message: '날짜(입고 또는 출고)를 적어 주세요.' });
    }

    // 영수증·수리 내역서·사진. 예전 양식은 file 한 장, 상세 양식은 files 여러 장
    const uploads = [...(req.files?.file || []), ...(req.files?.files || []), ...(req.file ? [req.file] : [])];
    const attachments = await saveAttachments(vehicle, kind, dateRaw, uploads);

    // 정기점검은 그 차의 몇 번째인지 붙인다
    const checkRound = kind === '정기점검'
      ? (await VehicleService.countDocuments({ kind: '정기점검', $or: [{ vehicle: vehicle._id }, ...(vehicle.plateNo ? [{ plateNo: vehicle.plateNo }] : [])] })) + 1
      : undefined;

    const record = new VehicleService({
      vehicle: vehicle._id,
      plateNo: vehicle.plateNo || '',
      kind,
      date: new Date(dateRaw),
      mileage: numberOrUndefined(body.mileage),
      amount: numberOrUndefined(body.amount) || 0,
      shop: body.shop || '',
      description: body.description || '',
      memo: body.memo || '',
      source: 'manual',
      fileName: attachments[0]?.fileName,
      savedPath: attachments[0]?.savedPath,
      attachments,
      checkRound,
      createdBy: req.user?.name || req.user?.email || ''
    });
    applyDetail(record, body);
    await record.save();
    await raiseVehicleMileage(vehicle._id, record.mileage);
    refreshSchedules();

    logActivity({
      req, dept: '차량관리부', action: ACTIONS.VEHICLE_SERVICE_RECORD,
      target: { model: 'VehicleService', id: record._id },
      summary: `${kind} 기록 (${vehicle.plateNo}${record.shop ? ` · ${record.shop}` : ''})`,
      meta: { kind, amount: record.amount, date: record.date }
    });

    res.json({ success: true, record, message: `${vehicle.plateNo} ${kind}${checkRound ? ` ${checkRound}회차` : ''} 기록을 남겼습니다.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 기록을 고친다.
 *
 * @route PATCH /api/vehicle-services/:id
 */
export const updateVehicleService = async (req, res) => {
  try {
    const record = await VehicleService.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: '기록을 찾을 수 없습니다.' });
    const body = bodyOf(req);

    for (const key of EDITABLE) {
      if (body[key] === undefined) continue;
      if (key === 'kind' && !SERVICE_KINDS.includes(body.kind)) continue;
      if (key === 'date') {
        if (!body.date || Number.isNaN(new Date(body.date).getTime())) continue; // 날짜 없는 기록은 계획을 셀 수 없다
        record.date = new Date(body.date);
      } else if (key === 'mileage') {
        record.mileage = numberOrUndefined(body.mileage);
      } else if (key === 'amount') {
        record.amount = numberOrUndefined(body.amount) || 0;
      } else {
        record[key] = body[key];
      }
    }
    applyDetail(record, body);
    // 상세 양식으로 고치면 날짜는 출고(없으면 입고)를 따른다
    if (body.date === undefined && (record.outAt || record.inAt)) record.date = record.outAt || record.inAt;
    // 정기점검으로 바꿨는데 회차가 없으면 붙인다
    if (record.kind === '정기점검' && !record.checkRound) {
      record.checkRound = (await VehicleService.countDocuments({
        kind: '정기점검', _id: { $ne: record._id }, $or: [{ vehicle: record.vehicle }, ...(record.plateNo ? [{ plateNo: record.plateNo }] : [])]
      })) + 1;
    }
    await record.save();
    await raiseVehicleMileage(record.vehicle, record.mileage);
    refreshSchedules();
    res.json({ success: true, record });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 기록을 지운다. OneDrive에 넣은 영수증은 남긴다(잘못 지워도 원본은 남게).
 *
 * @route DELETE /api/vehicle-services/:id
 */
export const deleteVehicleService = async (req, res) => {
  try {
    const record = await VehicleService.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ success: false, message: '기록을 찾을 수 없습니다.' });
    refreshSchedules();
    res.json({ success: true, message: '기록을 지웠습니다. 저장된 파일은 남아 있습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 영수증 원본을 연다.
 *
 * @route GET /api/vehicle-services/:id/file
 */
export const getVehicleServiceFile = async (req, res) => {
  try {
    const record = await VehicleService.findById(req.params.id).lean();
    // ?i=번호면 상세 양식의 첨부 여러 장 중 하나, 없으면 예전 영수증 한 장
    const att = req.query.i !== undefined ? record?.attachments?.[Number(req.query.i)] : null;
    const savedPath = att ? att.savedPath : record?.savedPath;
    if (!savedPath) return res.status(404).json({ success: false, message: '저장된 파일이 없습니다.' });
    const buffer = await readSavedFile(savedPath);
    if (!buffer) return res.status(410).json({ success: false, message: '파일이 OneDrive에서 옮겨졌거나 지워져 열 수 없습니다.' });
    const fileName = (att ? att.fileName : record.fileName) || 'file';
    res.setHeader('Content-Type', mimeTypeOf(fileName));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
