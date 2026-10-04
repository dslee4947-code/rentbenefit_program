import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * 대차 기록. 사고대차와 단기렌트를 한 곳에 담는다.
 *
 * 둘을 합친 이유: 같은 대차 차량(2026-09 기준 16대)을 번갈아 쓰기 때문에, 배차 현황판에서
 * "지금 이 차를 누가 쓰고 있나"를 보려면 두 기록을 한 번에 봐야 한다.
 *
 * 들어오는 길은 둘이다.
 * - 사고대차: IMS form에서 하루 두 번 동기화한다 (source = 'ims', imsId로 찾아 갱신).
 * - 단기렌트: IMS에 없어서 우리 화면에서 입력한다 (source = 'manual').
 *
 * ⛔ 주민등록번호, 운전면허번호(제2운전자 포함)는 두지 않는다.
 *    IMS 응답에는 들어 있지만 업무에 쓰지 않고, 가지고 있으면 유출 책임만 생긴다.
 *    동기화는 여기 있는 항목만 골라 담는다(허용 목록 방식).
 */

export const RENTAL_SOURCES = ['ims', 'manual'];
export const RENTAL_TYPES = ['사고대차', '단기렌트', '무상대차'];
// 고객이 들어온 길. 렌콜은 IMS 휴대폰 앱 콜, 베네핏고객은 장기렌트 기존 고객.
export const RENTAL_CHANNELS = ['렌콜', '베네핏고객', '직접'];

const RentalRecordSchema = new Schema({
  source: { type: String, enum: RENTAL_SOURCES, required: true },
  // IMS의 청구 건 id. 동기화할 때 이 값으로 찾아 새 건은 추가하고 있는 건은 갱신한다.
  imsId: { type: String },

  rentalType: { type: String, enum: RENTAL_TYPES, required: true },
  channel: { type: String, enum: [...RENTAL_CHANNELS, ''], default: '' },
  isNewCustomer: { type: Boolean, default: false }, // 처음 이용하는 고객 (실장 보고의 v 표시)

  // 대차 차량. 번호로 렌트차량 DB와 연결하고, 못 찾으면 vehicle을 비워 둔다("미연결").
  // 이름과 번호를 따로 남기는 이유: 차량 DB에 아직 없는 차여도 기록은 보여야 한다.
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
  rentCarName: { type: String, default: '' },
  rentCarNumber: { type: String, default: '' },

  // 대차를 받은 고객. 장기렌트 고객이면 customer로 연결한다.
  customer: { type: Schema.Types.ObjectId, ref: 'Customer' },
  customerName: { type: String, default: '' },
  customerContact: { type: String, default: '' },
  customerAddress: { type: String, default: '' },
  customerCarName: { type: String, default: '' }, // 사고 차량
  customerCarNumber: { type: String, default: '' },

  // 일정
  deliveredAt: Date, // 인도
  returnDueAt: Date, // 반납 예정
  returnedAt: Date, // 실제 반납. 비어 있으면 아직 이용 중이다.
  returnRequest: {
    location: String, // 반납 요청 장소
    timepoint: String, // 반납 요청 시간 (IMS가 자유 형식으로 준다)
    consulted: Boolean // 반납 협의 여부
  },

  // 차가 지금 어디 있는지 (예: 지하전시장, 철탑, 3층 야외). IMS에 없어 화면에서 입력한다.
  location: { type: String, default: '' },

  // 사고대차 - 보험사
  insurance: {
    company: String,
    managerName: String,
    contact: String,
    claimManager: String,
    faultRate: Number // 과실비율(%)
  },
  repairShop: { type: String, default: '' }, // 공업사

  // 사고대차 - 보험사 청구 진행
  claim: {
    state: String,
    requestedAt: Date,
    claimedAt: Date,
    doneAt: Date,
    percentage: Number,
    faxState: String,
    faxResult: String,
    alreadyClaimed: Boolean
  },

  // 금액. 미입금 = 청구액 - 입금액.
  // paidAmount는 IMS의 deposit_cost(보험사가 우리에게 실제로 넣은 돈)라서 사고대차의 실매출이다.
  billedAmount: { type: Number, default: 0 },
  paidAmount: { type: Number, default: 0 },
  paidAt: Date,
  differenceAmount: Number, // IMS의 difference_cost (청구와 입금의 차이를 IMS가 계산한 값)
  unpaidAmount: { type: Number, default: 0 }, // 저장할 때 계산해 넣는다

  // 담당과 소개
  salesEmployee: { type: String, default: '' },
  retrieveEmployee: { type: String, default: '' },
  rentManager: { type: String, default: '' },
  recommender: { type: String, default: '' },
  businessName: { type: String, default: '' },
  registrationId: { type: String, default: '' },
  requestId: { type: String, default: '' },

  memo: { type: String, default: '' },
  details: { type: String, default: '' },

  // 사람이 화면에서 고친 항목의 경로 (예: 'location', 'returnDueAt').
  // 동기화는 여기 적힌 항목을 덮어쓰지 않는다. 원장(VehicleLedger)의 locked와 같은 규칙이다.
  lockedFields: { type: [String], default: [] },

  lastSyncedAt: Date // IMS에서 마지막으로 갱신한 시각
}, { timestamps: true });

/**
 * 미입금액. 청구액보다 많이 들어왔으면 0으로 본다.
 *
 * save()로 저장할 때는 아래 훅이 채우지만, 동기화처럼 updateOne/bulkWrite로 한꺼번에 넣는 길에는
 * 훅이 돌지 않는다. 그런 곳에서는 이 함수로 직접 계산해 unpaidAmount를 함께 넣는다.
 */
export const calcUnpaidAmount = (billedAmount, paidAmount) =>
  Math.max(0, (Number(billedAmount) || 0) - (Number(paidAmount) || 0));

RentalRecordSchema.pre('save', function (next) {
  this.unpaidAmount = calcUnpaidAmount(this.billedAmount, this.paidAmount);
  next();
});

// imsId는 IMS에서 온 건에만 있다. 직접 입력한 건은 비어 있으므로 sparse로 유일성을 건다.
RentalRecordSchema.index({ imsId: 1 }, { unique: true, sparse: true });
RentalRecordSchema.index({ vehicle: 1, returnedAt: 1 });
RentalRecordSchema.index({ rentCarNumber: 1 });
RentalRecordSchema.index({ rentalType: 1, deliveredAt: -1 });
RentalRecordSchema.index({ returnDueAt: 1 });
RentalRecordSchema.index({ unpaidAmount: 1 });

const RentalRecord = mongoose.model('RentalRecord', RentalRecordSchema);

export default RentalRecord;
