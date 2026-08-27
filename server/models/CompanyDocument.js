import mongoose from 'mongoose';
const { Schema } = mongoose;

// 법인별 문서함 메타데이터. 실제 파일은 OneDrive 로컬 동기화 폴더(RENT/{문서종류}/{법인명}/)에
// 저장되고, 이 문서는 검색/다운로드를 위한 인덱스 역할만 한다.
const CompanyDocumentSchema = new Schema({
  company: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
  docType: {
    type: String,
    enum: ['사업자등록증', '통장사본', '계약서', '청구서', '견적서', '기타'],
    required: true
  },
  fileName: { type: String, required: true }, // 실제 저장된 파일명 (중복 시 _ver1 등 버전 접미사 포함)
  originalName: String, // 업로드 당시 원본 파일명
  localPath: { type: String, required: true }, // OneDrive 로컬 동기화 폴더 내 절대 경로
  mimeType: String,
  size: Number,
  uploadedBy: String,
}, { timestamps: true });

CompanyDocumentSchema.index({ company: 1, docType: 1 });
CompanyDocumentSchema.index({ company: 1, createdAt: -1 });

const CompanyDocument = mongoose.model('CompanyDocument', CompanyDocumentSchema);
export default CompanyDocument;
