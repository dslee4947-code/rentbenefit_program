import mongoose from 'mongoose';
import { SCRAP_STATUSES } from '../../shared/scrapFiling.js';

/** 대폐차 신고서 한 건 (별지 제15호서식 + 별첨). 증차·감차 공문 화면의 [대폐차 신고] 탭에서 만든다. */
const carSchema = new mongoose.Schema({
  vehicle: { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
  carName: { type: String, default: '' },
  plateNo: { type: String, default: '' },
  vin: { type: String, default: '' }
}, { _id: false });

const itemSchema = new mongoose.Schema({
  before: { type: carSchema, default: () => ({}) },
  after: { type: carSchema, default: () => ({}) }, // 새 차로 바꾸는 대차일 때만
  reason: { type: String, default: '' }            // 비우면 신고서의 변경사유를 쓴다
}, { _id: false });

const scrapFilingSchema = new mongoose.Schema({
  filedAt: { type: Date, required: true },
  status: { type: String, enum: SCRAP_STATUSES, default: '작성중', index: true },
  reason: { type: String, default: '' },        // ⑦ 변경사유
  business: { type: String, default: '' },      // ④ 사업의 종류
  changedAt: { type: String, default: '' },     // ⑤ 변경연월일 YYYY-MM-DD
  showDate: { type: Boolean, default: false },  // 신고 날짜를 서류에 찍기
  showCheck: { type: Boolean, default: false }, // [√] 자동차대여사업계획 변경
  items: { type: [itemSchema], default: [] },
  memo: { type: String, default: '' },
  mails: { type: [new mongoose.Schema({ to: String, cc: String, subject: String, files: [String], sentAt: Date, sentBy: String }, { _id: false })], default: [] }, // 조합에 보낸 메일
  submittedAt: Date,
  processedAt: Date,
  createdBy: { type: String, default: '' },
  updatedBy: { type: String, default: '' }
}, { timestamps: true });

scrapFilingSchema.index({ filedAt: -1 });

export default mongoose.model('ScrapFiling', scrapFilingSchema);
