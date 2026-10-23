import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * 전자계약서 양식(엑셀) 한 벌.
 *
 * 올린 엑셀을 utils/contractTemplateParser.js로 읽은 결과를 그대로 담는다.
 * 화면은 이 결과만으로 계약서 각 장을 다시 그리고, 약관 원문(pages·clauses)은 나중에 약관을 분석할 때 쓴다.
 * 엑셀 원본 파일은 ContractTemplateFile에 따로 둔다(그림 파일을 꺼내거나 다시 읽을 때).
 *
 * 약관이 바뀌면 새 엑셀을 올려 새 버전을 만든다. 이미 만든 계약서는 그때 쓴 양식 버전을 계속 가리킨다.
 */
const ContractTemplateSchema = new Schema({
  name: { type: String, required: true }, // 화면에 보이는 이름 (예: 장기렌트 계약서 2025-11)
  kind: { type: String, default: '장기렌트' },
  version: { type: Number, required: true }, // 같은 kind 안에서 1부터
  fileName: String,
  sha256: { type: String, index: true }, // 같은 파일을 두 번 올렸는지 확인
  size: Number,
  active: { type: Boolean, default: false }, // 새 계약서를 만들 때 쓰는 양식 (kind마다 하나)
  note: String,
  uploadedBy: String,

  // 해석 결과 (parseContractTemplate)
  sheets: Schema.Types.Mixed, // 장마다 칸 너비·높이·병합·셀·글상자
  styles: Schema.Types.Mixed, // 셀 모양 표 (sheets[].cells[].s가 가리킨다)
  fields: Schema.Types.Mixed, // 입력 칸 (법인정보 시트)
  pages: Schema.Types.Mixed, // 장마다 원문 전체 (읽는 순서대로, 수식 칸은 [항목] 자리표시)
  clauses: Schema.Types.Mixed, // 약관 조항 (제n조)
  media: [String],
  stats: Schema.Types.Mixed
}, { timestamps: true });

ContractTemplateSchema.index({ kind: 1, version: -1 });

export default mongoose.model('ContractTemplate', ContractTemplateSchema);
