import VehicleService from '../models/VehicleService.js';
import Vehicle from '../models/Vehicle.js';
import { saveDocument, readSavedFile } from '../utils/documentStorageService.js';
import { mimeTypeOf } from '../utils/oneDriveStorage.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';
import { planVehicle, kstYmd, SERVICE_KINDS, INSPECTION_RULE, MAINTENANCE_RULE } from '../utils/vehicleServicePlan.js';
import { SERVICE_ACTIVE_STATUSES, partyNameOf, syncVehicleServiceSchedules } from '../utils/vehicleServiceScheduleJob.js';

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

const VEHICLE_FIELDS = 'plateNo carModel status registrationDate deliveryDate rentBillingDate maintenance contract company contractorName currentMileage';

const loadVehicle = (filter) => Vehicle.findOne(filter)
  .select(VEHICLE_FIELDS)
  .populate('contract', 'leaseCompany')
  .populate('company', 'name')
  .lean();

/** 화면 한 줄. 목록과 차량 상세가 같은 모양을 쓴다. */
const rowOf = (v, records) => ({
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
  ...planVehicle(v, records)
});

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
    const records = await VehicleService.find({ vehicle: { $in: vehicles.map((v) => v._id) } })
      .select('vehicle kind date mileage amount description')
      .lean();
    const byVehicle = new Map();
    for (const r of records) {
      const k = String(r.vehicle);
      if (!byVehicle.has(k)) byVehicle.set(k, []);
      byVehicle.get(k).push(r);
    }

    const rows = vehicles.map((v) => rowOf(v, byVehicle.get(String(v._id)) || []));
    res.json({ success: true, rows, kinds: SERVICE_KINDS, rules: { inspection: INSPECTION_RULE, maintenance: MAINTENANCE_RULE } });
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
    const records = await VehicleService.find({ vehicle: vehicle._id }).sort({ date: -1, createdAt: -1 }).lean();
    res.json({ success: true, records, row: rowOf(vehicle, records) });
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
    const vehicle = await loadVehicle({ _id: req.body.vehicleId });
    if (!vehicle) return res.status(400).json({ success: false, message: '차량을 골라 주세요.' });
    const kind = String(req.body.kind || '').trim();
    if (!SERVICE_KINDS.includes(kind)) return res.status(400).json({ success: false, message: '종류를 골라 주세요.' });
    if (!req.body.date || Number.isNaN(new Date(req.body.date).getTime())) {
      return res.status(400).json({ success: false, message: '날짜를 적어 주세요.' });
    }

    let saved = null;
    if (req.file) {
      const ext = (req.file.originalname.match(/\.[^.]+$/) || ['.pdf'])[0];
      // 차량번호_날짜_종류: 같은 차의 영수증이 폴더에서 날짜순으로 늘어선다
      saved = await saveDocument({
        partyName: partyNameOf(vehicle) || '계약사미상',
        kind: DOC_KIND_OF[kind],
        subFolder: vehicle.plateNo || '차량번호미상',
        fileName: `${vehicle.plateNo || '차량'}_${kstYmd(req.body.date)}_${kind}${ext}`,
        fileBuffer: req.file.buffer,
        keepPrevious: true // 같은 날 두 건(점검+수리)이면 이름이 같다. 덮지 않고 이름을 바꿔 남긴다
      });
    }

    const record = await VehicleService.create({
      vehicle: vehicle._id,
      plateNo: vehicle.plateNo || '',
      kind,
      date: new Date(req.body.date),
      mileage: numberOrUndefined(req.body.mileage),
      amount: numberOrUndefined(req.body.amount) || 0,
      shop: req.body.shop || '',
      description: req.body.description || '',
      memo: req.body.memo || '',
      source: 'manual',
      fileName: saved?.fileName,
      savedPath: saved?.localPath,
      createdBy: req.user?.name || req.user?.email || ''
    });
    await raiseVehicleMileage(vehicle._id, record.mileage);
    refreshSchedules();

    logActivity({
      req, dept: '차량관리부', action: ACTIONS.VEHICLE_SERVICE_RECORD,
      target: { model: 'VehicleService', id: record._id },
      summary: `${kind} 기록 (${vehicle.plateNo}${record.shop ? ` · ${record.shop}` : ''})`,
      meta: { kind, amount: record.amount, date: record.date }
    });

    res.json({ success: true, record, message: `${vehicle.plateNo} ${kind} 기록을 남겼습니다.` });
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

    for (const key of EDITABLE) {
      if (req.body[key] === undefined) continue;
      if (key === 'kind' && !SERVICE_KINDS.includes(req.body.kind)) continue;
      if (key === 'date') {
        if (!req.body.date || Number.isNaN(new Date(req.body.date).getTime())) continue; // 날짜 없는 기록은 계획을 셀 수 없다
        record.date = new Date(req.body.date);
      } else if (key === 'mileage') {
        record.mileage = numberOrUndefined(req.body.mileage);
      } else if (key === 'amount') {
        record.amount = numberOrUndefined(req.body.amount) || 0;
      } else {
        record[key] = req.body[key];
      }
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
    if (!record?.savedPath) return res.status(404).json({ success: false, message: '저장된 파일이 없습니다.' });
    const buffer = await readSavedFile(record.savedPath);
    if (!buffer) return res.status(410).json({ success: false, message: '파일이 OneDrive에서 옮겨졌거나 지워져 열 수 없습니다.' });
    const fileName = record.fileName || 'file';
    res.setHeader('Content-Type', mimeTypeOf(fileName));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
