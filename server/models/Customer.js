import mongoose from 'mongoose';
import { rejectResidentRegistrationNumber } from '../utils/validators.js';
const { Schema } = mongoose;

const CustomerSchema = new Schema({
  customerId: { type: String, required: true, unique: true }, // 고객코드 예: CUST001
  name: { type: String, required: true }, // 개인/법인명
  // 사업자/주민번호 (Outlook 등 실제 사업자번호가 없는 고객은 필드 자체를 생략).
  // 주민등록번호 형식(6자리-7자리)은 저장 거부 - 사업자번호는 3-2-5 형식이라 겹치지 않음.
  bizNo: { type: String, validate: rejectResidentRegistrationNumber },
  ceoName: String, // 대표자명 (법인)
  address: String,
  contactName: String, // 담당자명
  contactPhone: String, // 담당자 연락처
  email: String, // 이메일 (Outlook 등 실제 이메일이 없는 고객은 필드 자체를 생략)
  bank: {
    name: String,
    account: String,
    holder: String, // 예금주
  },
  bizNoTransfer: { type: String, validate: rejectResidentRegistrationNumber }, // 사업자/주민번호(이체/식별번호)
  bizAddress: String, // 사업자 주소
  source: { type: String, default: 'manual' }, // 생성 출처: manual, outlook 등
  outlookId: { type: String }, // MS Outlook 연락처 ID
  outlookCategory: { type: String }, // MS Outlook 폴더 분류 (예: B1, B1 > 보험 등)
  
  // Outlook Detailed Fields (메모 제외)
  surname: String, // 성
  givenName: String, // 이름
  companyName: String, // 아웃룩 "회사(P)" 필드. 실무상 회사명이 아니라 차량 계약 정보 요약이 들어감 (UI 라벨: 차량정보)
  department: String, // 부서
  jobTitle: String, // 직급
  displayName: String, // 표시 방법
  mobilePhone: String, // 휴대폰 번호
  businessPhone: String, // 근무처 전화
  homePhone: String, // 집 전화
  faxNumber: String, // 팩스 번호
  webPage: String, // 웹 페이지
  postalCode: String, // 우편번호
  businessAddress: String, // 근무처 주소
  homeAddress: String, // 집 주소

  // 소속 법인 (한 고객이 법인 두 곳 이상에 소속될 수 있음)
  companies: [{
    companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
    role: String, // 대표 / 담당자 / 실사용자
    isPrimary: { type: Boolean, default: false },
  }],
}, { timestamps: true });

// High-performance search indexes for 18k+ records
CustomerSchema.index({ outlookId: 1 });
CustomerSchema.index({ email: 1 });
CustomerSchema.index({ name: 1, contactName: 1, contactPhone: 1 });
CustomerSchema.index({ source: 1, outlookCategory: 1 });
CustomerSchema.index({ 'companies.companyId': 1 });

const Customer = mongoose.model('Customer', CustomerSchema);
export default Customer;
