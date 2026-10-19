import Schedule from '../models/Schedule.js';
import Vehicle from '../models/Vehicle.js';
// populate('contract'/'company')가 모델 등록을 필요로 한다. 스크립트에서 이 파일만 불러도 돌게 함께 불러 둔다.
import '../models/Contract.js';
import '../models/Company.js';
import VehicleService from '../models/VehicleService.js';
import { ACCIDENT_RENTAL_PARTY, SHORT_TERM_RENTAL_STATUS } from './accidentRentalCompany.js';
import { planVehicle, addDays } from './vehicleServicePlan.js';

// 정비·검사를 챙기는 차. 재고·거래완료 차는 우리가 굴리지 않으니 일정을 띄우지 않는다.
export const SERVICE_ACTIVE_STATUSES = ['장기렌트', SHORT_TERM_RENTAL_STATUS];

// 캘린더 일정 종류(Schedule.type)와 계획 항목의 짝
const TYPES = [
  { type: '차량검사', label: '자동차검사', pick: (plan) => plan.inspection },
  { type: '정기점검', label: '정기점검', pick: (plan) => plan.maintenance }
];

/** 차 한 대의 일정을 가리키는 값. 차마다 종류마다 다가오는 일정은 이 값으로 하나만 둔다. */
export const serviceKeyOf = (type, vehicleId) => `svc:${type}:${vehicleId}`;

/**
 * 이 차의 계약사 이름. 캘린더 칸·파일 폴더에 쓴다.
 *
 * 단기렌트 차는 고객과 장기 계약을 맺은 차가 아니라 회사 차라 계약사가 언제나 우리 회사다.
 * 장기렌트는 계약서의 계약사, 계약서 없이 넣은 차는 차량에 적힌 법인·계약자를 쓴다.
 *
 * @param {object} vehicle contract(leaseCompany), company(name)를 populate한 차량
 * @returns {string}
 */
export const partyNameOf = (vehicle) => {
  if (vehicle?.status === SHORT_TERM_RENTAL_STATUS) return ACCIDENT_RENTAL_PARTY.name;
  return vehicle?.contract?.leaseCompany || vehicle?.company?.name || vehicle?.contractorName || '';
};

/**
 * 캘린더 칸 이름. 고지서 일정과 같은 순서(계약사_차량번호_종류)다.
 * 캘린더는 칸이 좁아 뒤가 잘리므로 "어느 회사, 어느 차"를 앞에 둔다.
 */
export const buildServiceTitle = (partyName, plateNo, label) => [partyName || '계약사미상', plateNo || '차량번호미상', label].join('_');

// 계획 날짜('YYYY-MM-DD')를 한국 자정으로 저장한다. 캘린더가 한국 날짜로 칸을 고른다.
const kstMidnight = (ymd) => new Date(`${ymd}T00:00:00+09:00`);

/**
 * 지난 일정이 새 기록으로 끝났는지.
 *
 * 검사는 회차가 딱 한 회 넘어갔으면 그 회차를 받은 것이다. 점검은 회차가 없어서, 마지막 점검 기록이
 * 지난 일정 앞뒤 한 주기 안에 있으면 그 일정을 받은 것으로 본다.
 * 원장에서 지난 기록을 한꺼번에 옮기면 몇 년 전 일정이 몇 회차씩 건너뛴다. 그건 받은 게 아니라
 * 기록이 늦게 들어온 것이라, '완료'를 남기지 않고 날짜만 옮긴다.
 */
const isCovered = (type, old, item) => {
  if (type === '차량검사') return Number(old.source?.roundNo) > 0 && item.round === Number(old.source.roundNo) + 1;
  if (!item.lastDone) return false;
  const oldYmd = new Date(old.dueDate.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const cycle = Math.round(item.intervalMonths * 30.44);
  return item.lastDone >= addDays(oldYmd, -cycle) && item.lastDone <= addDays(oldYmd, cycle);
};

/**
 * 차마다 다음 자동차검사·정기점검을 캘린더(Schedule)에 하나씩 맞춰 둔다.
 *
 * 계약을 등록할 때 몇 년 치를 한꺼번에 넣으면 기록이 쌓여도 날짜가 따라오지 않는다.
 * 그래서 매일 기록을 보고 다가오는 한 건만 고친다.
 *  - 계획 날짜가 바뀌면 그 일정의 날짜·이름만 고친다
 *  - 기록이 들어와 다음 회차로 넘어가면, 지난 일정은 '완료'로 남기고(그날 무엇을 했는지 되짚게)
 *    새 일정을 만든다
 *  - 운행을 마친 차나 정비 미가입으로 바뀐 차의 남은 '예정' 일정은 지운다
 *
 * 직원용 알림이다. 고객에게는 아무것도 보내지 않는다.
 * 매일 돌아도 같은 결과가 나온다.
 *
 * @param {object} [options]
 * @param {boolean} [options.dryRun] true면 세기만 하고 쓰지 않는다
 * @returns {Promise<{created: number, updated: number, closed: number, removed: number}>}
 */
export const syncVehicleServiceSchedules = async ({ dryRun = false } = {}) => {
  const vehicles = await Vehicle.find({ status: { $in: SERVICE_ACTIVE_STATUSES } })
    .select('plateNo status registrationDate deliveryDate rentBillingDate maintenance contract company contractorName')
    .populate('contract', 'leaseCompany')
    .populate('company', 'name')
    .lean();
  const records = await VehicleService.find({ vehicle: { $in: vehicles.map((v) => v._id) } })
    .select('vehicle kind date mileage amount description')
    .lean();
  const recordsByVehicle = new Map();
  for (const r of records) {
    const k = String(r.vehicle);
    if (!recordsByVehicle.has(k)) recordsByVehicle.set(k, []);
    recordsByVehicle.get(k).push(r);
  }

  const existing = await Schedule.find({ 'source.key': { $regex: '^svc:' } }).lean();
  const existingByKey = new Map(existing.map((s) => [s.source.key, s]));
  const keep = new Set();

  let created = 0;
  let updated = 0;
  let closed = 0;
  let removed = 0;

  for (const v of vehicles) {
    const plan = planVehicle(v, recordsByVehicle.get(String(v._id)) || []);
    const partyName = partyNameOf(v);

    for (const { type, label, pick } of TYPES) {
      const item = pick(plan);
      if (!item) continue;
      const key = serviceKeyOf(type, v._id);
      keep.add(key);
      const dueDate = kstMidnight(item.date);
      const title = buildServiceTitle(partyName, v.plateNo, label);
      const old = existingByKey.get(key);

      if (old && old.dueDate.getTime() !== dueDate.getTime() && dueDate > old.dueDate && isCovered(type, old, item)) {
        // 받은 일정은 열쇠를 바꿔 '완료'로 남긴다. 열쇠를 비우면 다음 날 또 새로 만들게 된다.
        const oldYmd = new Date(old.dueDate.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
        if (!dryRun) {
          await Schedule.updateOne({ _id: old._id }, { $set: { status: '완료', 'source.key': `${key}:${oldYmd}` } });
        }
        closed += 1;
        existingByKey.delete(key);
      }

      const current = existingByKey.get(key);
      const set = {
        type,
        targetVehicle: v._id,
        targetContract: v.contract?._id,
        dueDate,
        title,
        status: '예정',
        'source.key': key,
        ...(type === '차량검사' ? { 'source.roundNo': item.round } : {})
      };
      if (!current) {
        if (!dryRun) await Schedule.updateOne({ 'source.key': key }, { $set: set }, { upsert: true });
        created += 1;
      } else if (current.dueDate.getTime() !== dueDate.getTime() || current.title !== title
        || current.status !== '예정' || (type === '차량검사' && current.source?.roundNo !== item.round)) {
        if (!dryRun) await Schedule.updateOne({ _id: current._id }, { $set: set });
        updated += 1;
      }
    }
  }

  // 더 챙기지 않는 차의 다가오는 일정. '완료'로 남긴 지난 일정(열쇠 끝에 날짜가 붙은 것)은 건드리지 않는다.
  const stale = existing.filter((s) => /^svc:[^:]+:[0-9a-f]{24}$/.test(s.source.key) && !keep.has(s.source.key) && s.status === '예정');
  if (stale.length) {
    if (!dryRun) await Schedule.deleteMany({ _id: { $in: stale.map((s) => s._id) } });
    removed = stale.length;
  }

  console.log(`[정비·검사 일정] 캘린더 ${created}건 등록 · ${updated}건 갱신 · ${closed}건 완료 · ${removed}건 정리${dryRun ? ' (시험 실행, 저장 안 함)' : ''}`);
  return { created, updated, closed, removed };
};

