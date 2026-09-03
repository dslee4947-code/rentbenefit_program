import mongoose from 'mongoose';
import { rejectResidentRegistrationNumber } from '../utils/validators.js';
const { Schema } = mongoose;

const CompanySchema = new Schema({
  // 사업자번호 (없는 법인/개인 거래처는 필드 생략). OCR 오인식 등으로 형식이
  // 정확히 000-00-00000이 아닐 수 있어 형식은 강제하지 않고, 주민등록번호가
  // 잘못 들어가는 것만 막는다.
  bizNo: { type: String, validate: rejectResidentRegistrationNumber },
  corporateRegistrationNo: String, // 법인등록번호 (000000-0000000 형식, 사업자번호와 별개)
  name: { type: String, required: true }, // 법인명. 개인사업자는 상호 없이 대표자 이름이 그대로 들어가도 정상.
  // '개인'은 사업자등록이 없는 개인 계약자. 이 경우 bizNo 자리에는
  // 주민등록번호 앞 7자리(생년월일 + 뒤 첫 자리)만 넣는다. 뒷자리 전체는 받지 않는다.
  bizType: { type: String, enum: ['법인사업자', '개인사업자', '개인'] },
  ceoName: String, // 대표자명
  address: String,
  billingEmail: String, // 청구서 수신 이메일

  // 이 법인의 기본 출금 통장.
  // 차량마다 계좌가 다를 수 있어 실제 값은 차량(Vehicle.banking)에 따로 두고,
  // 여기 값은 법인 차량을 새로 등록할 때 채워 넣는 기본값으로 쓴다.
  bank: {
    holder: String, // 예금주명
    bankName: String,
    accountNo: String
  },
  folderName: String, // 원드라이브 폴더명 (companyfolders에서 이관)
  memo: String,
}, { timestamps: true });

// bizNo가 있는 문서끼리만 유일해야 함 (없는 문서는 인덱스 대상에서 제외)
CompanySchema.index({ bizNo: 1 }, { unique: true, sparse: true });
CompanySchema.index({ name: 1 });

const Company = mongoose.model('Company', CompanySchema);
export default Company;
