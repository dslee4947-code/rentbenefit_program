import mongoose from 'mongoose';
import { CAR_AGE_STATUSES } from '../../shared/carAgeFiling.js';

/**
 * 사업용자동차 차령조정(차령 연장) 신청서 한 건. 별지 제55호서식 + 별첨 차량 목록.
 * 증차·감차 공문 화면의 [차령연장 신청서] 탭에서 만든다. 칸 기본값은 shared/carAgeFiling.js.
 */
const itemSchema = new mongoose.Schema({
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
  carName: { type: String, default: '' },   // 차명 (레이, 캐스퍼 …)
  plateNo: { type: String, required: true, trim: true },
  passedAt: { type: String, default: '' },  // 검사 합격일 YYYY-MM-DD
  note: { type: String, default: '' }       // 합격통지서 칸 (비우면 "첨부 N번")
}, { _id: false });

const applicantSchema = new mongoose.Schema({
  name: String, ceo: String, corpNo: String, address: String, address2: String,
  phone: String, business: String, signName: String, addressee: String
}, { _id: false });

const carAgeFilingSchema = new mongoose.Schema({
  filedAt: { type: Date, required: true },
  status: { type: String, enum: CAR_AGE_STATUSES, default: '작성중', index: true },
  applicant: { type: applicantSchema, default: () => ({}) },
  items: { type: [itemSchema], default: [] },
  stamp: { type: Boolean, default: true },  // 신청인 칸에 회사 도장
  memo: { type: String, default: '' },
  submittedAt: Date,
  processedAt: Date,
  createdBy: { type: String, default: '' },
  updatedBy: { type: String, default: '' }
}, { timestamps: true });

carAgeFilingSchema.index({ filedAt: -1 });

export default mongoose.model('CarAgeFiling', carAgeFilingSchema);
