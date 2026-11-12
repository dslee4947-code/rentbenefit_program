import Contract from '../models/Contract.js';
import Vehicle from '../models/Vehicle.js';
import ContractDocument from '../models/ContractDocument.js';
import '../models/Company.js';
import '../models/Customer.js';
import { vehicleEndOf, lastDayOf } from '../utils/contractTerm.js';

/**
 * 렌트출고 보고 글(대표님 2026-11-12 양식).
 * 출고하면 계약사·담당자·차량·기간·금액·썬팅·블랙박스·타이어·보험·정비·기타작업을 정해진 양식으로 적어 둔다.
 * 계약·차량·전자계약서에서 칸을 채우고, 직원이 고친 값은 차량에 저장한다(다시 열면 고친 값이 나온다).
 */

const ymd = (d) => {
  if (!d) return '';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '' : new Date(t.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
};
const won = (n) => (Number(n) > 0 ? Number(n).toLocaleString('ko-KR') : '');
// 300000 → 30만원
const manWon = (n) => {
  const v = Number(n);
  if (!(v > 0)) return '';
  return v % 10000 === 0 ? `${v / 10000}만원` : `${v.toLocaleString('ko-KR')}원`;
};
const termText = (m) => {
  const n = Number(m);
  if (!(n > 0)) return '';
  return n % 12 === 0 ? `${n / 12}년` : `${n}개월`;
};
// 견적 표기를 출고 보고에 쓰는 말로 줄인다
const driverAgeText = (s) => String(s || '').replace(/\s+/g, '').replace(/이상$/, '');
const liabilityText = (s) => (String(s || '').trim() === '무제한' ? '무한대' : String(s || '').trim());
const injuryText = (s) => String(s || '').replace(/자상\s*/g, '').replace(/부상\s*/g, '').replace(/\s*\/\s*/g, '/').replace(/3000만/, '3천만').replace(/1500만/, '1천5백만').trim();

const SKIP_WORKS = /선팅|썬팅|블랙박스/;

export const defaultReleaseValues = ({ contract, vehicle, docValues = {} }) => {
  const ins = vehicle.insurance || {};
  const mt = vehicle.maintenance || {};
  const acc = vehicle.accessories || {};
  const customer = contract.customer || {};
  const end = lastDayOf(vehicleEndOf(contract, vehicle));
  const tireCount = (/(\d+)\s*본/.exec(String(docValues.tire || '')) || [])[1];
  const extras = [
    ...(vehicle.vehicleWorks || []).map((w) => w.name).filter((n) => n && !SKIP_WORKS.test(n)),
    ...(vehicle.gifts || []).map((g) => String(g.name || '').trim()).filter(Boolean)
  ];
  const emergency = ins.emergencyService || docValues.emergencyService || '';
  return {
    party: contract.companyId?.name || customer.surname || customer.name || '',
    managerMain: contract.managerMain || customer.surname || vehicle.driver || '',
    managerOps: contract.managerOps || vehicle.deliveryPlace?.managerName || '',
    carModel: vehicle.carModel || '',
    year: vehicle.year || '',
    color: [vehicle.exteriorColor, vehicle.interiorColor].filter(Boolean).join('/'),
    contractDate: ymd(contract.contractDate),
    registrationDate: ymd(vehicle.registrationDate),
    deliveryDate: ymd(vehicle.deliveryDate || contract.deliveryDate),
    endDate: ymd(end),
    place: vehicle.deliveryPlace?.address || '',
    vin: vehicle.vin || '',
    plateNo: vehicle.plateNo || '',
    carPrice: won(vehicle.carPrice),
    term: termText(vehicle.paymentTerm || contract.termMonths),
    termMonths: String(vehicle.paymentTerm || contract.termMonths || ''), // 인도일을 고치면 종료일을 다시 셈할 때 쓴다(글에는 안 나옴)
    deposit: won(vehicle.deposit),
    advancePayment: won(vehicle.advancePayment),
    takeoverPrice: won(vehicle.takeoverPrice),
    monthlyFee: won(vehicle.monthlyFee),
    tinting: acc.tintingInfo || '',
    blackbox: acc.blackboxInfo || '',
    tire: acc.tireInfo || '',
    insurance: [
      ins.driverAge && `운전자 연령-${driverAgeText(ins.driverAge)}`,
      ins.liabilityLimit && `대인-${liabilityText(ins.liabilityLimit)}`,
      ins.propertyLimit && `대물-${String(ins.propertyLimit).replace(/원$/, '')}`,
      ins.personalInjury && `자손-${injuryText(ins.personalInjury)}`,
      ins.uninsuredInjury && `무보험차상해-${String(ins.uninsuredInjury).replace(/\s+/g, '')}`,
      ins.deductible && `자기부담금-${manWon(ins.deductible)}`,
      ins.driverRange && `보험종류-${ins.driverRange}`,
      emergency && `긴급출동-${emergency}`
    ].filter(Boolean).join(' / '),
    emergency,
    accidentRepair: ins.accidentRepair || '',
    generalMaintenance: mt.generalMaintenance || (mt.enabled ? '가입' : ''),
    consumables: mt.consumables || (mt.enabled ? '가입' : ''),
    tireCount: tireCount ? `렌트기간 ${tireCount}본` : '',
    extra: extras.join(' / ')
  };
};

const loadContract = (id) => Contract.findById(id)
  .populate('companyId', 'name')
  .populate('customer', 'name surname')
  .lean();

/** @route GET /api/delivery-docs/:contractId/release-report */
export const getReleaseReport = async (req, res) => {
  try {
    const contract = await loadContract(req.params.contractId);
    if (!contract) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    const ids = [...(contract.vehicles || []), contract.vehicle].filter(Boolean);
    const [vehicles, doc] = await Promise.all([
      Vehicle.find({ $or: [{ _id: { $in: ids } }, { contract: contract._id }] }).lean(),
      ContractDocument.findOne({ contract: contract._id }).sort({ updatedAt: -1 }).select('values').lean()
    ]);
    res.json({
      success: true,
      data: {
        contractId: contract._id,
        contractNo: contract.contractNo,
        party: contract.companyId?.name || contract.customer?.surname || contract.customer?.name || '',
        vehicles: vehicles.map((vehicle) => ({
          vehicleId: vehicle._id,
          plateNo: vehicle.plateNo || '',
          carModel: vehicle.carModel || '',
          defaults: defaultReleaseValues({ contract, vehicle, docValues: doc?.values }),
          saved: vehicle.releaseReport?.values || null,
          savedAt: vehicle.releaseReport?.savedAt || null,
          savedBy: vehicle.releaseReport?.savedBy || ''
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** @route PUT /api/delivery-docs/:contractId/release-report/:vehicleId  { values } (values가 null이면 저장한 값을 지운다) */
export const saveReleaseReport = async (req, res) => {
  try {
    const vehicle = await Vehicle.findOne({ _id: req.params.vehicleId, contract: req.params.contractId });
    if (!vehicle) return res.status(404).json({ success: false, message: '차량을 찾을 수 없습니다.' });
    const raw = req.body.values;
    if (raw === null) {
      vehicle.releaseReport = undefined;
    } else {
      const values = {};
      Object.entries(raw || {}).forEach(([k, v]) => { if (typeof v === 'string' && k.length < 40) values[k] = v.slice(0, 500); });
      vehicle.releaseReport = { values, savedAt: new Date(), savedBy: req.user?.name || req.user?.email || '' };
    }
    vehicle.markModified('releaseReport');
    await vehicle.save();
    res.json({ success: true, saved: vehicle.releaseReport?.values || null, savedAt: vehicle.releaseReport?.savedAt || null, message: raw === null ? '처음 값으로 되돌렸습니다.' : '저장했습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
