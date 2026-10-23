import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * 계약 한 건의 전자계약서.
 *
 * 견적서에서 [계약서 등록 전환]을 누르면 그때 '사용 중' 양식으로 하나 만들어지고,
 * 입력 칸 값은 계약·견적·고객·법인·차량 정보로 채운다. 직원이 화면에서 고친 칸은 sources를 'manual'로 바꿔
 * [계약 정보 다시 불러오기]를 눌러도 덮이지 않게 한다.
 *
 * 양식(template)은 만든 그때의 버전을 계속 가리킨다. 약관이 바뀌어도 이미 맺은 계약서의 약관은 그대로다.
 */
const ContractDocumentSchema = new Schema({
  contract: { type: Schema.Types.ObjectId, ref: 'Contract', required: true, index: true },
  quote: { type: Schema.Types.ObjectId, ref: 'Quote' },
  template: { type: Schema.Types.ObjectId, ref: 'ContractTemplate', required: true },
  templateName: String,
  templateVersion: Number,

  values: { type: Schema.Types.Mixed, default: {} }, // 입력 칸 열쇠 → 글자
  sources: { type: Schema.Types.Mixed, default: {} }, // 입력 칸 열쇠 → 어디서 가져왔는지 (contract/quote/customer/company/vehicle/manual)
  documentDate: Date, // 계약서 작성일 (위임장 작성일자 등 TODAY() 자리)

  status: { type: String, enum: ['작성중', '확정'], default: '작성중' },
  confirmedAt: Date,
  confirmedBy: String,
  createdBy: String,
  updatedBy: String
}, { timestamps: true });

export default mongoose.model('ContractDocument', ContractDocumentSchema);
