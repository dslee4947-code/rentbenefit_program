import Contract from '../models/Contract.js';
import Vehicle from '../models/Vehicle.js';
import RentalRecord from '../models/RentalRecord.js';
import { RENTAL_FLEET_STATUSES } from './accidentRentalCompany.js';

/**
 * 차량 한 대의 실제 렌트 기간.
 *
 * Contract.endDate를 쓰지 않는다. 그 값은 pre-save 훅에서 `계약일 + 계약개월수`로 계산되는데,
 * 출고가 계약보다 두세 달 늦는 일이 흔해 실제 렌트 기간과 그만큼 어긋난다.
 * 청구 회차는 이미 렌트료 게시일(또는 인도일) 기준으로 만들고 있으므로
 * (billingScheduleController.resolveScheduleInputs) 기간 판정도 같은 기준을 쓴다.
 *
 * 고지서가 어느 계약자 건인지는 이 기간 안에 위반일이 드는지로 갈린다.
 * 기준이 어긋나면 계약 끝자락 고지서가 엉뚱한 계약자에게 청구된다.
 *
 * @param {object} contract 계약
 * @param {object} [vehicle] 그 계약에 묶인 차량. 있으면 차량 값을 먼저 본다
 * @returns {{start: Date, end: Date|null, months: number, basis: string}|null}
 */
export const resolveRentPeriod = (contract, vehicle) => {
  const sources = [
    [vehicle?.rentBillingDate, '렌트료 게시일'],
    [vehicle?.deliveryDate, '차량 인도일'],
    [contract?.rentStartDate, '계약 렌트 개시일'],
    [contract?.deliveryDate, '계약 인도일'],
    [contract?.contractDate, '계약일']
  ];
  const picked = sources.find(([value]) => value);
  if (!picked) return null;

  const start = new Date(picked[0]);
  if (Number.isNaN(start.getTime())) return null;

  const months = Number(contract?.termMonths) || Number(vehicle?.paymentTerm) || 0;
  let end = null;
  if (months) {
    end = new Date(start);
    end.setMonth(end.getMonth() + months);
  }

  return { start, end, months, basis: picked[1] };
};

/** 날짜가 기간의 어디에 있는지. 기간이 열려 있으면(종료일 미상) 시작일만 본다. */
const positionOf = (period, at) => {
  if (at < period.start) return '계약 전';
  if (period.end && at >= period.end) return '종료 후';
  return '기간 내';
};

/**
 * 차량번호와 위반일시로 그때의 장기렌트 계약을 찾는다.
 *
 * Vehicle.contract(단일 참조)를 보지 않는다. 그 값은 늘 최신 계약을 가리켜서,
 * 위반 후 한두 달 뒤에 오는 고지서를 지금 계약자에게 붙여 버린다.
 * 대신 Contract.vehicles 배열을 거슬러 그 차가 거쳐 간 계약을 모두 본다.
 *
 * 판정이 애매하면(둘 이상 걸림, 기간 밖) 고르지 않고 후보만 돌려준다.
 * 잘못 나간 청구서는 되돌리기 어렵다.
 *
 * @param {string} plateNo 차량번호
 * @param {Date|string|null} at 위반일시. 없으면 기간 판정 없이 후보만 준다
 * @returns {Promise<{candidates: object[], matched: object|null, reason: string}>}
 */
export const findContractAtDate = async (plateNo, at) => {
  const plate = String(plateNo || '').replace(/\s+/g, '');
  if (!plate) return { candidates: [], matched: null, reason: '차량번호가 없습니다.' };

  // 같은 차량번호로 문서가 여러 건일 수 있다. 계약을 등록할 때마다 차량을 새로 만들기 때문이다
  // (contractController.createContractVehicles). 중고 장기렌트로 재계약한 차가 여기 걸린다.
  const vehicles = await Vehicle.find({ plateNo: plate }).lean();
  if (!vehicles.length) return { candidates: [], matched: null, reason: '우리 차량이 아닙니다.' };

  const vehicleIds = vehicles.map((v) => v._id);
  const contracts = await Contract.find({
    $or: [{ vehicles: { $in: vehicleIds } }, { vehicle: { $in: vehicleIds } }]
  })
    .select('contractNo leaseCompany contractDate deliveryDate rentStartDate termMonths status finesEmail finesEmail2 vehicles vehicle')
    .lean();

  const when = at ? new Date(at) : null;
  const hasWhen = when && !Number.isNaN(when.getTime());

  const candidates = contracts.map((contract) => {
    const vehicle = vehicles.find((v) => String(v.contract) === String(contract._id))
      || vehicles.find((v) => (contract.vehicles || []).some((id) => String(id) === String(v._id)))
      || vehicles[0];
    const period = resolveRentPeriod(contract, vehicle);
    return {
      contractId: contract._id,
      contractNo: contract.contractNo,
      partyName: contract.leaseCompany || '',
      status: contract.status,
      finesEmail: contract.finesEmail || '',
      finesEmail2: contract.finesEmail2 || '',
      vehicleId: vehicle?._id,
      plateNo: vehicle?.plateNo || plate,
      carModel: vehicle?.carModel || '',
      period,
      position: (period && hasWhen) ? positionOf(period, when) : null
    };
  });

  // 시작일 순으로 둔다. 화면에 후보를 늘어놓을 때 흐름이 보인다.
  candidates.sort((a, b) => (a.period?.start || 0) - (b.period?.start || 0));

  if (!hasWhen) {
    return { candidates, matched: null, reason: '위반일시를 읽지 못해 계약을 정하지 못했습니다.' };
  }

  const inPeriod = candidates.filter((c) => c.position === '기간 내');
  if (inPeriod.length === 1) return { candidates, matched: inPeriod[0], reason: '' };
  if (inPeriod.length > 1) {
    return { candidates, matched: null, reason: '위반일에 겹치는 계약이 둘 이상입니다. 확인이 필요합니다.' };
  }
  return {
    candidates,
    matched: null,
    reason: '위반일이 장기렌트 기간 밖입니다. 사고대차 · 단기렌트 건일 수 있습니다.'
  };
};

/**
 * 한국 날짜로 며칠째인지. 고지서의 위반일은 시각이 없는 일이 많아 하루 단위로 비교한다.
 * 서버(도쿄 리전)의 시간대와 상관없이 같은 값이 나오도록 KST(+9시간)로 맞춘다.
 */
const DAY = 864e5;
// 반납 정보가 없는 대여 기록을 얼마나 열어 둘지. 사고대차 수리 기간이 길어도 대개 이 안에 끝난다.
const OPEN_RENTAL_DAYS = 60;
const dayOf = (d) => Math.floor((new Date(d).getTime() + 9 * 3600e3) / DAY);

/**
 * 차량번호와 위반일로 그때 대차 차량을 쓰던 대여 건을 찾는다.
 *
 * 장기렌트 계약 기간 밖에서 난 위반은 대부분 대차(단기렌트·사고대차) 운행 중에 생긴다.
 * 대여 기록(RentalRecord)의 인도일~반납일(반납 전이면 반납 예정일, 그것도 없으면 오늘)에
 * 위반일이 드는 건을 찾는다. 인도·반납이 같은 날 겹치면 둘 다 걸리므로 고르지 않고 후보만 준다.
 *
 * 대여 기록이 없어도 차가 대차 차량(상태 '단기렌트')이면 fleet로 알려 준다.
 * 그 경우 고객은 사람이 채운다.
 *
 * @param {string} plateNo 차량번호
 * @param {Date|string|null} at 위반일
 * @returns {Promise<{fleet: boolean, vehicleId: any, matched: object|null, candidates: object[], reason: string}>}
 */
export const findRentalAtDate = async (plateNo, at) => {
  const plate = String(plateNo || '').replace(/\s+/g, '');
  const empty = { fleet: false, vehicleId: null, matched: null, candidates: [], reason: '' };
  if (!plate) return { ...empty, reason: '차량번호가 없습니다.' };

  const vehicles = await Vehicle.find({ plateNo: plate }).select('status').lean();
  const fleetVehicle = vehicles.find((v) => RENTAL_FLEET_STATUSES.includes(v.status));

  const when = at ? new Date(at) : null;
  const hasWhen = when && !Number.isNaN(when.getTime());
  let candidates = [];
  if (hasWhen) {
    const day = dayOf(when);
    const records = await RentalRecord.find({ rentCarNumber: plate, deliveredAt: { $lte: new Date((day + 1) * DAY) } })
      .select('rentalType customerName customerContact deliveredAt returnedAt returnDueAt insurance.company')
      .sort({ deliveredAt: -1 })
      .limit(20)
      .lean();
    candidates = records
      .filter((r) => {
        // 반납일·반납 예정일이 모두 비어 있으면 끝을 모른다. 오늘까지 열어 두면 닫지 않은 옛 기록이
        // 그 뒤의 모든 위반에 걸리므로, 인도 후 OPEN_RENTAL_DAYS까지만 본다.
        const end = r.returnedAt || r.returnDueAt
          || new Date(Math.min(Date.now(), new Date(r.deliveredAt).getTime() + OPEN_RENTAL_DAYS * DAY));
        return dayOf(r.deliveredAt) <= day && day <= dayOf(end);
      })
      .map((r) => ({
        rentalId: r._id,
        rentalType: r.rentalType,
        customerName: r.customerName || '',
        customerContact: r.customerContact || '',
        insuranceCompany: r.insurance?.company || '',
        deliveredAt: r.deliveredAt,
        returnedAt: r.returnedAt || null,
        returnDueAt: r.returnDueAt || null
      }));
  }

  const fleet = Boolean(fleetVehicle) || candidates.length > 0;
  const vehicleId = (fleetVehicle || vehicles[0])?._id || null;
  if (candidates.length === 1) return { fleet, vehicleId, matched: candidates[0], candidates, reason: '' };
  if (candidates.length > 1) {
    return { fleet, vehicleId, matched: null, candidates, reason: '그날 이 차를 쓴 대여 건이 둘 이상입니다. 위반 시각으로 골라 주세요.' };
  }
  if (!fleet) return { ...empty, vehicleId, reason: '' };
  return {
    fleet, vehicleId, matched: null, candidates,
    reason: hasWhen ? '대차 차량이지만 그날의 대여 기록이 없습니다. 고객을 직접 적어 주세요.' : '위반일을 읽지 못했습니다.'
  };
};
