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

  // ledger: 원장에서 옮겨 온 건 / manual: 화면에서 적은 건 / calendar: 구글 캘린더(업무캘린더) 일정에서 옮겨 온 건
  source: { type: String, enum: ['ledger', 'manual', 'calendar'], default: 'manual' },
  // 캘린더에서 옮긴 건의 일정 id. 이관을 다시 돌려도 같은 일정이 두 번 들어가지 않게 하는 열쇠다.
  calendarEventId: { type: String },
  // 원장 줄 하나는 한 번만 옮긴다. 이관 스크립트를 두 번 돌려도 겹치지 않게 하는 열쇠다.
  ledgerEntryId: { type: Schema.Types.ObjectId },

  fileName: String,
  savedPath: String,
  createdBy: { type: String, default: '' },

  // ── 상세 양식 (2026-10 대표님 요청, 시안 docs/mockups/vehicle-service-form-v1.html) ──
  // 예전 기록(간단 양식)에는 없어도 된다. 화면은 값이 있을 때만 보여 준다.
  status: { type: String, enum: ['예정', '입고', '수리 중', '완료'], default: '완료' },
  staff: { type: String, default: '' }, // 진행 직원
  request: { type: String, default: '' }, // 고객 요청(점검 의뢰). 작업 내용은 description

  // 수리 기간과 주행거리. 나중에 문제가 생겼을 때 증거자료가 된다.
  inAt: Date,
  outAt: Date,
  mileageIn: Number,
  mileageOut: Number,
  fuelIn: { type: String, default: '' },
  fuelOut: { type: String, default: '' },

  // 입고·출고 이동. 외주 탁송이면 탁송료가 생기고 원장에 넣어야 한다.
  // 거리를 함께 남겨 두면 해마다 km당 탁송료가 얼마나 올랐는지 볼 수 있다.
  transport: {
    in: { method: String, from: String, to: String, distanceKm: Number, vendor: String, fee: Number },
    out: { method: String, from: String, to: String, distanceKm: Number, vendor: String, fee: Number }
  },

  // 누가 비용을 내는가
  payer: { type: String, enum: ['', '자차 보험', '상대방 보험', '보증·리콜(무상)', '회사 부담', '고객 부담'], default: '' },
  insurer: { type: String, default: '' },
  claimNo: { type: String, default: '' },
  fault: { type: String, default: '' }, // 과실 비율 (예: 상대 100 : 0)
  deductible: Number, // 자기부담금
  loaner: { type: String, default: '' }, // 수리 동안 내준 대차 차량
  costs: { repair: Number, vat: Number, insurancePaid: Number },

  // 수리 부위. 차량 그림에서 고른다. 차량 카드에서 지금까지 고친 곳을 겹쳐 보여 준다.
  parts: [{ _id: false, zone: String, action: { type: String, enum: ['교환', '판금·도색', '수리·점검'] }, memo: String }],
  // 바꾼 소모품 (엔진오일·필터 등). 다음 교체 시기 계산에 쓴다.
  consumables: [String],
  // 정기점검 회차. 정기점검으로 처음 저장할 때 그 차의 정기점검 수 + 1로 붙는다.
  checkRound: Number,

  // 수리 내역서에서 정리한 작업 줄과 합계 (2026-10-30, utils/repairInvoice.js).
  // 내역서 글자를 읽어 양식에 채우고 사람이 확인해 저장한다. 읽은 글자(text)도 남겨 나중에 다시 정리할 수 있게 한다.
  lines: [{ _id: false, name: String, qty: Number, unitPrice: Number, parts: Number, labor: Number, amount: Number }],
  invoice: {
    bizNo: String, issuedDate: String,
    partsTotal: Number, laborTotal: Number, supply: Number, vat: Number, discount: Number, total: Number,
    text: String
  },

  // 수리 내역서·견적서·사진 여러 장
  attachments: [{ _id: false, fileName: String, savedPath: String, label: String }]
}, { timestamps: true });

VehicleServiceSchema.index({ vehicle: 1, date: -1 });
VehicleServiceSchema.index({ ledgerEntryId: 1 }, { unique: true, sparse: true });
// 한 일정에 차가 둘 이상 적힌 경우가 있어 (일정, 차) 묶음으로 하나만 둔다
VehicleServiceSchema.index({ calendarEventId: 1, vehicle: 1 }, { unique: true, partialFilterExpression: { calendarEventId: { $type: 'string' } } });

const VehicleService = mongoose.model('VehicleService', VehicleServiceSchema);

export default VehicleService;
