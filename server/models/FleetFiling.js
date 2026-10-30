import mongoose from 'mongoose';
import { FILING_KINDS, FILING_STATUSES } from '../../shared/fleetFiling.js';

/**
 * 증차·감차 공문 한 건 (구청에 낸 자동차대여사업 변경등록신청서).
 *
 * 작성중 → 제출(이때 신고 대수를 snapshot에 찍어 둔다) → 처리완료(구청 메일이 오면, 이때 대수를 신고 현황에 더한다).
 * 엑셀 "구청 등록현황" 시트에서 옮긴 지난 기록은 source가 붙고, 대수는 이미 신고 현황에 들어가 있어 다시 더하지 않는다.
 * 계산 규칙은 shared/fleetFiling.js.
 */
const itemSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },   // 신구사업대비표 차종 이름
  width: Number,                                         // 가로(m)
  length: Number,                                        // 세로(m)
  delta: { type: Number, required: true },               // 늘리면 +, 줄이면 −
  plates: { type: String, default: '' },                 // 감차하는 차 번호 등
  note: { type: String, default: '' }
}, { _id: false });

// 증차할 때 붙이는 자동차매매계약서(엑셀 '차량정보' 시트)
const contractSchema = new mongoose.Schema({
  maker: { type: String, enum: ['현대', '기아'], default: '현대' },
  contractNo: { type: String, default: '' },
  model: { type: String, default: '' },
  color: { type: String, default: '' },
  price: Number,
  deliveryFee: Number,
  qty: { type: String, default: '1대' },
  deposit: Number
}, { _id: false });

const snapshotSchema = new mongoose.Schema({
  name: String, width: Number, length: Number, count: Number
}, { _id: false });

const fleetFilingSchema = new mongoose.Schema({
  filedAt: { type: Date, required: true },               // 신청일(서류에 찍히는 날)
  kind: { type: String, enum: FILING_KINDS, default: '증차·감차' },
  status: { type: String, enum: FILING_STATUSES, default: '작성중', index: true },
  reason: { type: String, default: '' },                 // 비우면 "증차 N대 / 감차 M대"
  registrationLabel: { type: String, default: '' },      // 대비표 '변경등록내역'. 비우면 "렌터카 증차"
  items: { type: [itemSchema], default: [] },
  contracts: { type: [contractSchema], default: [] },
  snapshot: { type: [snapshotSchema], default: undefined }, // 제출할 때의 신고 대수
  beforeTotal: Number,
  afterTotal: Number,
  processedAt: Date,                                     // 구청 처리 메일 온 날
  applied: { type: Boolean, default: false },            // 신고 현황에 대수를 더했는지
  memo: { type: String, default: '' },
  source: { type: String, default: '' },                 // '구청 등록현황 엑셀' 등 옮겨 온 곳
  importKey: { type: String, index: true, sparse: true },
  createdBy: { type: String, default: '' },
  updatedBy: { type: String, default: '' }
}, { timestamps: true });

fleetFilingSchema.index({ filedAt: -1 });

export default mongoose.model('FleetFiling', fleetFilingSchema);
