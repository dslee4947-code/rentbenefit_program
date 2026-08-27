import mongoose from 'mongoose';
const { Schema } = mongoose;

// 이미 등록된 고객의 미처리 문의/상담 요청을 추적한다.
const InquirySchema = new Schema({
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  content: { type: String, required: true }, // 문의 내용
  status: { type: String, enum: ['대기', '처리완료'], default: '대기' },
  assignee: { type: String, default: '' }, // 담당자
  createdBy: { type: String, default: '' },
  resolvedAt: Date,
  resolvedBy: String
}, { timestamps: true });

InquirySchema.index({ status: 1 });
InquirySchema.index({ customer: 1 });
InquirySchema.index({ createdAt: -1 });

const Inquiry = mongoose.model('Inquiry', InquirySchema);
export default Inquiry;
