import Contract from '../models/Contract.js';
import Vehicle from '../models/Vehicle.js';
import Schedule from '../models/Schedule.js';
import { contractEndOf, earliestDeliveryOf, vehicleEndOf } from './contractTerm.js';

/**
 * 차량 인도일이 바뀐 뒤 계약의 만기일을 다시 맞춘다.
 *
 * 인도일은 출고 준비 화면에서 차량에만 저장된다. 계약 문서는 그 저장을 지나지 않아서,
 * 여기서 따로 맞추지 않으면 계약 만기가 계약일 기준으로 남는다(utils/contractTerm.js 참고).
 *
 * 함께 맞추는 것:
 * - 계약의 인도일: 가장 먼저 인도한 차의 날짜. 계약을 다시 저장할 때 pre-save 훅이 이 값으로 만기를 계산한다.
 * - 캘린더의 '렌트만료' 일정: 차마다 자기 인도일 기준으로. 아직 끝내지 않은(예정) 일정만 고친다.
 */

// 날짜만 비교한다. 엑셀에서 옮긴 값과 화면에서 넣은 값은 같은 날이라도 시각이 달라 그대로 비교하면 매번 바뀐 것으로 잡힌다.
const ymd = (x) => (x ? new Date(x).toISOString().slice(0, 10) : null);
const sameDay = (a, b) => ymd(a) === ymd(b);

const vehiclesOf = async (contract) => {
  const ids = [...(contract.vehicles || []), contract.vehicle].filter(Boolean);
  if (!ids.length) return [];
  return Vehicle.find({ _id: { $in: ids } }).select('plateNo deliveryDate').lean();
};

/** 바꿀 값을 계산만 한다. 저장하지 않는다. */
export const planContractEndDate = async (contract) => {
  const vehicles = await vehiclesOf(contract);
  const endDate = contractEndOf(contract, vehicles);
  const deliveryDate = contract.contractKind === '연장'
    ? contract.deliveryDate
    : (earliestDeliveryOf(vehicles) || contract.deliveryDate);
  const vehicleEnds = vehicles.map((v) => ({ vehicleId: v._id, plateNo: v.plateNo, endDate: vehicleEndOf(contract, v) }));

  const changes = {};
  if (endDate && !sameDay(endDate, contract.endDate)) changes.endDate = endDate;
  if (deliveryDate && !sameDay(deliveryDate, contract.deliveryDate)) changes.deliveryDate = deliveryDate;
  return { changes, vehicleEnds };
};

/**
 * 계약 하나의 만기일·인도일·렌트만료 일정을 맞춘다.
 * @param {string|import('mongoose').Types.ObjectId} contractId
 * @returns {Promise<{changes: object, vehicleEnds: object[]}|null>}
 */
export const refreshContractEndDate = async (contractId) => {
  const contract = await Contract.findById(contractId)
    .select('contractKind contractDate deliveryDate termMonths endDate vehicles vehicle')
    .lean();
  if (!contract) return null;

  const plan = await planContractEndDate(contract);
  // updateOne이라 pre-save 훅을 지나지 않는다. 훅은 차량을 모르므로 여기서 계산한 값을 그대로 넣는다.
  if (Object.keys(plan.changes).length) await Contract.updateOne({ _id: contract._id }, { $set: plan.changes });

  for (const { vehicleId, endDate } of plan.vehicleEnds) {
    if (!endDate) continue;
    await Schedule.updateMany(
      { type: '렌트만료', targetContract: contract._id, targetVehicle: vehicleId, status: '예정' },
      { $set: { dueDate: endDate } }
    );
  }
  return plan;
};
