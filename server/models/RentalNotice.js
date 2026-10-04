import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * 대차 차량(단기렌트·사고대차·무상대차)에 날아온 범칙금·과태료·미납통행료 고지서.
 *
 * 장기렌트 고지서는 계약의 청구 회차(BillingSchedule.rounds.attachments)에 붙어
 * 다음 청구서로 나간다. 대차 차량은 회차표가 없고 청구하는 곳도 건마다 달라서
 * (운전한 고객, 보험사, 우리 회사 부담) 따로 모은다.
 *
 * 어느 대여 건인지는 차량번호와 위반일로 RentalRecord에서 찾는다. IMS 동기화 전이거나
 * 기록이 빠진 경우가 있어 rentalRecord가 비어 있어도 고객 이름을 직접 적을 수 있게 둔다.
 */

// 누가 내는지.
//  고객청구 - 빌려 간 고객에게 청구한다 (기본)
//  명의변경 - 관공서에 대여계약서를 넘겨 고객에게 직접 고지되게 한다
//  회사부담 - 우리 직원 운행 중이거나 받을 곳이 없어 회사가 낸다
export const RENTAL_NOTICE_HANDLINGS = ['고객청구', '명의변경', '회사부담'];

// 어디까지 진행됐는지. 목록에서 '끝난 건'은 FINISHED에 든 것이다.
export const RENTAL_NOTICE_STATUSES = ['접수', '안내', '청구', '입금완료', '변경완료', '회사납부'];
export const RENTAL_NOTICE_FINISHED = ['입금완료', '변경완료', '회사납부'];

const RentalNoticeSchema = new Schema({
  plateNo: { type: String, required: true },
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle' },

  // 그때 차를 쓰고 있던 대여 건. 못 찾으면 비워 두고 아래 고객 칸을 손으로 채운다.
  rentalRecord: { type: Schema.Types.ObjectId, ref: 'RentalRecord' },
  rentalType: { type: String, default: '' }, // 사고대차 / 단기렌트 / 무상대차
  customerName: { type: String, default: '' },
  customerContact: { type: String, default: '' },
  insuranceCompany: { type: String, default: '' }, // 사고대차면 보험사. 청구처를 정할 때 참고한다

  kind: { type: String, default: '과태료' }, // 범칙금 / 과태료 / 통행료
  // 청구할 금액. 미납통행료는 원금만 적는다(부가통행료는 청구하지 않는다, 2026-09-29 결정).
  amount: { type: Number, default: 0 },
  surcharge: { type: Number, default: 0 }, // 고지서에 적힌 부가통행료. 참고로만 남긴다
  occurredAt: Date, // 위반일 (어느 대여 건인지 가르는 값)
  violationTime: String, // 위반 시각 'HH:mm'. 하루에 두 명이 쓴 차는 시각으로 가른다
  noticeNo: { type: String, default: '' }, // 고지번호. 같은 고지서를 다시 올렸는지 보는 열쇠
  noticeDueDate: Date,

  handling: { type: String, enum: RENTAL_NOTICE_HANDLINGS, default: '고객청구' },
  status: { type: String, enum: RENTAL_NOTICE_STATUSES, default: '접수' },
  paidByUsAt: Date, // 우리가 먼저 낸 날. 돈이 나갔는데 청구를 빠뜨리는 것을 막는다
  settledAt: Date, // 끝난 날 (입금·명의변경·회사 납부)
  memo: { type: String, default: '' },

  fileName: String,
  savedPath: String,
  fileHash: String,
  uploadedBy: String
}, { timestamps: true });

// 고지번호는 한 번만. 번호가 없는 서식(빈 값)은 여럿일 수 있어 번호가 있을 때만 건다.
// 화면에서 동시에 두 번 눌러도 이중 청구가 되지 않게 하는 마지막 벽이다.
RentalNoticeSchema.index(
  { noticeNo: 1 },
  { unique: true, partialFilterExpression: { noticeNo: { $type: 'string', $gt: '' } } }
);
RentalNoticeSchema.index({ fileHash: 1 });
RentalNoticeSchema.index({ plateNo: 1, occurredAt: -1 });
RentalNoticeSchema.index({ status: 1, noticeDueDate: 1 });

const RentalNotice = mongoose.model('RentalNotice', RentalNoticeSchema);

export default RentalNotice;
