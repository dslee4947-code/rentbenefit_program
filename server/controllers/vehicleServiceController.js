import VehicleService from '../models/VehicleService.js';
import Vehicle from '../models/Vehicle.js';
import { saveDocument, readSavedFile } from '../utils/documentStorageService.js';
import { mimeTypeOf } from '../utils/oneDriveStorage.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';
import { planVehicle, kstYmd, addMonths, SERVICE_KINDS, REPAIR_KINDS, INSPECTION_RULE, MAINTENANCE_RULE, CAR_AGE_RULE } from '../utils/vehicleServicePlan.js';
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

const VEHICLE_FIELDS = 'plateNo carModel status registrationDate inspectionValidity cc fuelType deliveryDate rentBillingDate maintenance contract company contractorName currentMileage paymentTerm';

const loadVehicle = (filter) => Vehicle.findOne(filter)
  .select(VEHICLE_FIELDS)
  .populate('contract', 'leaseCompany termMonths')
  .populate('company', 'name')
  .lean();

const DAY = 24 * 60 * 60 * 1000;

/**
 * 정기점검 횟수와 계약 주행거리 대비 실제 주행.
 *
 * - 정기점검: 계약 기간 동안 몇 번 받아야 하는지(계약 개월 ÷ 점검 주기), 몇 번 받았는지, 남은 횟수.
 *   점검 주기는 정기점검 계획(nextMaintenance)의 개월 수를 쓰고, 미가입 차는 연 1회로 센다.
 * - 주행: 인도일부터 지금까지 주행거리를 1년으로 환산해 약정과 비교한다.
 *   약정의 120%를 넘으면 정비 주기를 당기고 고객에게 안내해야 한다(대표님 2026-10).
 *   덜 타더라도 1년 넘게 정기점검이 없으면 연 1회 점검 안내가 필요하다.
 */
const usageOf = (v, records, plan) => {
  const checks = records.filter((r) => r.kind === '정기점검');
  const termMonths = Number(v.paymentTerm) || Number(v.contract?.termMonths) || 0;
  const intervalMonths = plan.maintenance?.intervalMonths || 12;
  const expected = termMonths ? Math.max(1, Math.floor(termMonths / intervalMonths)) : null;

  const delivered = v.deliveryDate ? new Date(v.deliveryDate) : null;
  const lastKm = Math.max(Number(v.currentMileage) || 0, ...records.map((r) => Number(r.mileageOut || r.mileage) || 0));
  const months = delivered ? (Date.now() - delivered.getTime()) / DAY / 30.44 : 0;
  const contractKm = Number(v.maintenance?.mileage) || null;
  const annualizedKm = months >= 1 && lastKm ? Math.round((lastKm / months) * 12) : null;
  const ratio = annualizedKm && contractKm ? annualizedKm / contractKm : null;

  // 남은 횟수: 전체 예정 - 받은 횟수로 세면 계약 끝 무렵 차가 "10회 남음"처럼 나온다.
  // 다음 점검일부터 계약 끝나는 날까지 주기마다 몇 번 돌아오는지로 센다.
  const contractEnd = delivered && termMonths ? addMonths(kstYmd(delivered), termMonths) : '';
  const nextCheck = plan.maintenance?.date || '';
  let remaining = null;
  if (contractEnd && nextCheck) {
    remaining = 0;
    for (let d = nextCheck; d <= contractEnd && remaining < 100; d = addMonths(d, intervalMonths)) remaining += 1;
  }

  const lastCheck = checks.map((r) => kstYmd(r.date)).sort().pop() || '';
  const sinceLastCheckDays = lastCheck ? Math.floor((Date.now() - new Date(lastCheck).getTime()) / DAY) : null;
  const notices = [];
  if (ratio && ratio > 1.2) {
    notices.push({ type: 'over', text: `약정 ${contractKm.toLocaleString()}km/년보다 많이 탑니다(연 환산 ${annualizedKm.toLocaleString()}km, ${Math.round(ratio * 100)}%). 정비 주기를 당기고 고객에게 안내해야 합니다.` });
  }
  if (months >= 12 && (sinceLastCheckDays === null || sinceLastCheckDays > 365)) {
    notices.push({ type: 'yearly', text: `1년 넘게 정기점검 기록이 없습니다${lastCheck ? `(마지막 ${lastCheck})` : ''}. 덜 타더라도 연 1회 정기점검을 받도록 안내해야 합니다.` });
  }

  return {
    checks: { done: checks.length, expected, remaining, intervalMonths, termMonths: termMonths || null, contractEnd: contractEnd || null, last: lastCheck },
    usage: { lastKm: lastKm || null, monthsSinceDelivery: Math.round(months * 10) / 10, contractKm, annualizedKm, ratio: ratio ? Math.round(ratio * 100) : null },
    notices
  };
};

/** 화면 한 줄. 목록과 차량 상세가 같은 모양을 쓴다. */
const rowOf = (v, records) => {
  const plan = planVehicle(v, records);
  return {
    vehicleId: v._id,
    plateNo: v.plateNo || '',
    carModel: v.carModel || '',
    status: v.status,
    partyName: partyNameOf(v),
    registrationDate: kstYmd(v.registrationDate),
    deliveryDate: kstYmd(v.deliveryDate),
    annualKm: v.maintenance?.mileage || null,
    generalMaintenance: v.maintenance?.generalMaintenance || '',
    currentMileage: v.currentMileage || 0,
    recordCount: records.length,
    // 달력에 '일어난 날'로 올리는 고장·사고 수리(최근 13개월). 진행 중인 수리도 함께.
    repairs: records
      .filter((r) => REPAIR_KINDS.includes(r.kind) && kstYmd(r.date) >= addMonths(kstYmd(new Date()), -13))
      .map((r) => ({ kind: r.kind, date: kstYmd(r.date), status: r.status || '완료', amount: r.amount || 0, description: r.description || '', shop: r.shop || '' })),
    // 달력에서 미리 잡아 둔 검사·점검 등(아직 끝나지 않은 기록). 계산한 날짜 대신 이 날에 보인다.
    bookings: records
      .filter((r) => !REPAIR_KINDS.includes(r.kind) && r.status && r.status !== '완료')
      .map((r) => ({ kind: r.kind, date: kstYmd(r.date), status: r.status, shop: r.shop || '' })),
    ...plan,
    ...usageOf(v, records, plan)
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

const DETAIL_TEXT = ['status', 'staff', 'request', 'fuelIn', 'fuelOut', 'payer', 'insurer', 'claimNo', 'fault', 'loaner'];
const LEG_TEXT = ['method', 'from', 'to', 'vendor'];

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

/**
 * 운행 중인 차 전부의 다음 자동차검사·정기점검.
 *
 * @route GET /api/vehicle-services/plan
 */
export const getServicePlan = async (req, res) => {
  try {
    const vehicles = await Vehicle.find({ status: { $in: SERVICE_ACTIVE_STATUSES } })
      .select(VEHICLE_FIELDS)
      .populate('contract', 'leaseCompany')
      .populate('company', 'name')
      .lean();
    // 같은 번호판의 예전 차량 문서에 붙은 기록도 함께 센다(loadServiceRecords 설명)
    const byVehicle = await loadServiceRecords(vehicles, 'vehicle kind date mileage amount description status shop');

    const rows = vehicles.map((v) => rowOf(v, byVehicle.get(String(v._id)) || []));
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
    res.json({ success: true, records, row: rowOf(vehicle, records), transportRates: await transportRates() });
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
