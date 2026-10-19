import mongoose from 'mongoose';
import { SERVICE_KINDS } from '../utils/vehicleServicePlan.js';
const { Schema } = mongoose;

/**
 * 차량 한 대에 한 정비·검사·수리 한 건.
 *
 * 다음 자동차검사·정기점검 날짜는 이 기록으로 계산한다(utils/vehicleServicePlan.js).
 * 검사를 받았다고 적으면 다음 해 검사로 넘어가고, 점검을 적으면 그날부터 주기를 다시 센다.
 *
 * 원장(VehicleLedger)에도 검사비·점검비가 적혀 있지만, 원장은 돈을 적는 곳이라
 * 주행거리·정비소·작업 내용을 담을 자리가 없고 부가세가 한 줄로 따로 들어가기도 한다.
 * 그래서 정비 이력은 따로 두고, 원장에서 옮겨 온 건은 ledgerEntryId로 이어 둔다.
 */
const VehicleServiceSchema = new Schema({
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  plateNo: { type: String, default: '' }, // 차량번호가 바뀌어도 그때 번호가 남게 함께 적는다

  kind: { type: String, enum: SERVICE_KINDS, required: true },
  date: { type: Date, required: true },
  mileage: Number, // 그때 계기판 주행거리(km). 둘 이상 쌓이면 실제 월 주행을 어림한다
  amount: { type: Number, default: 0 },
  shop: { type: String, default: '' }, // 정비소·검사소
  description: { type: String, default: '' }, // 무엇을 했는지 (엔진오일·브레이크패드 교환 등)
  memo: { type: String, default: '' },

  // ledger: 원장에서 옮겨 온 건 / manual: 화면에서 적은 건
  source: { type: String, enum: ['ledger', 'manual'], default: 'manual' },
  // 원장 줄 하나는 한 번만 옮긴다. 이관 스크립트를 두 번 돌려도 겹치지 않게 하는 열쇠다.
  ledgerEntryId: { type: Schema.Types.ObjectId },

  fileName: String,
  savedPath: String,
  createdBy: { type: String, default: '' }
}, { timestamps: true });

VehicleServiceSchema.index({ vehicle: 1, date: -1 });
VehicleServiceSchema.index({ ledgerEntryId: 1 }, { unique: true, sparse: true });

const VehicleService = mongoose.model('VehicleService', VehicleServiceSchema);

export default VehicleService;
