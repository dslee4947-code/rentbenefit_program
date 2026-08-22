import mongoose from 'mongoose';
const { Schema } = mongoose;

const CustomerSchema = new Schema({
  customerId: { type: String, required: true, unique: true }, // 고객코드 예: CUST001
  name: { type: String, required: true }, // 개인/법인명
  bizNo: String, // 사업자/주민번호 (Outlook 등 실제 사업자번호가 없는 고객은 필드 자체를 생략)
  ceoName: String, // 대표자명 (법인)
  address: String,
  contactName: String, // 담당자명
  contactPhone: String, // 담당자 연락처
  email: { type: String, required: true },
  bank: {
    name: String,
    account: String,
    holder: String, // 예금주
  },
  bizNoTransfer: String, // 사업자/주민번호(이체/식별번호)
  bizAddress: String, // 사업자 주소
  source: { type: String, default: 'manual' }, // 생성 출처: manual, outlook 등
  outlookId: { type: String }, // MS Outlook 연락처 ID
  outlookCategory: { type: String }, // MS Outlook 폴더 분류 (예: B1, B1 > 보험 등)
  
  // Outlook Detailed Fields (메모 제외)
  surname: String, // 성
  givenName: String, // 이름
  companyName: String, // 회사명
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
}, { timestamps: true });

// High-performance search indexes for 18k+ records
CustomerSchema.index({ outlookId: 1 });
CustomerSchema.index({ email: 1 });
CustomerSchema.index({ name: 1, contactName: 1, contactPhone: 1 });
CustomerSchema.index({ source: 1, outlookCategory: 1 });

const Customer = mongoose.model('Customer', CustomerSchema);
export default Customer;
