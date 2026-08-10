import mongoose from 'mongoose';
const { Schema } = mongoose;

// 법인(고객사)명 -> 실제 원드라이브(RENT) 폴더명 매핑.
// 기존에 수작업으로 만들어둔 폴더명이 제각각이라, 자동 생성 대신 최초 1회 사용자가 확인/입력한 값을 저장해두고 재사용한다.
const CompanyFolderSchema = new Schema({
  companyName: { type: String, required: true }, // 정규화된 법인명 (Vehicle.contractCompany에서 "_숫자" 접미사 제거)
  bizNo: { type: String, default: '' }, // 사업자번호 (동명 법인 구분용, 없으면 빈 문자열)
  folderName: { type: String, required: true }, // RENT 폴더 바로 아래의 실제 법인 폴더명
}, { timestamps: true });

CompanyFolderSchema.index({ companyName: 1, bizNo: 1 }, { unique: true });

const CompanyFolder = mongoose.model('CompanyFolder', CompanyFolderSchema);
export default CompanyFolder;
