import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * 엑셀로 만들어 밖에서 보낸 청구서(프로그램 이전 방식)의 기록.
 *
 * 드롭박스 계약 폴더의 회차별 청구서 PDF를 읽어 넣는다. 청구서 보관함이 회차 옆에 "고객이 실제로 받은 청구서"를
 * 보여 줄 때 쓴다. 회차표(BillingSchedule)의 계산 값은 덮지 않는다. 받은 금액과 프로그램 계산이 다를 때
 * 둘 다 보여야 어느 쪽이 맞는지 따질 수 있다.
 *
 * 회차표 안에 넣지 않고 따로 두는 이유: 회차표는 입금 동기화·발송 때마다 회차 배열을 통째로 다시 쓰는데,
 * 그때 이 기록을 모르는 코드가 저장하면 함께 지워진다. 따로 두면 회차표 쪽 변경과 상관없이 남는다.
 */
const ExcelInvoiceSchema = new Schema({
  schedule: { type: Schema.Types.ObjectId, ref: 'BillingSchedule', required: true },
  roundNo: { type: Number, required: true }, // 프로그램 회차 번호(결제일로 맞춘 것)
  invoiceRoundNo: Number, // 청구서에 적힌 납입회차. 계약 변경 등으로 프로그램 회차와 다를 수 있다
  payDate: String, // 청구서에 적힌 결제일 (YYYY-MM-DD)
  writtenDate: String, // 작성기준일
  total: Number, // 결제금액
  // 청구서 '청구내역' 표를 줄마다 옮긴 것. 미납통행료·범칙금·자부담금 등 이름을 그대로 둔다
  items: [{ label: String, amount: Number, _id: false }],
  plates: [String], // 청구서에 적힌 차량번호
  fileName: String,
  sourcePath: String, // 드롭박스 원본 경로. 이 PC에서 돌린 서버는 바로 연다
  savedPath: String, // OneDrive에 올린 사본 경로(운영 서버에서 열 때)
  importedAt: { type: Date, default: Date.now }
});

ExcelInvoiceSchema.index({ schedule: 1, roundNo: 1 }, { unique: true });

export default mongoose.model('ExcelInvoice', ExcelInvoiceSchema);
