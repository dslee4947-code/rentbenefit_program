import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * 전자계약서 양식의 'PDF 바탕'.
 *
 * 엑셀(Excel)이 직접 만든 빈 계약서 PDF와, 계약 값을 어디에 찍을지 적은 '값 자리 지도'를 담는다.
 * 서버는 엑셀이 없으므로(운영 서버는 리눅스) 이 둘을 미리 만들어 두고,
 * 계약서 PDF가 필요할 때 빈 PDF 위에 값만 찍는다(utils/contractPdf.js). 그래서 모양이 원본 계약서와 똑같다.
 *
 * 만드는 법: Excel이 있는 PC에서 node scripts/build-contract-pdf-base.js (양식을 바꾸면 다시 돌린다)
 */
const ContractTemplatePdfSchema = new Schema({
  template: { type: Schema.Types.ObjectId, ref: 'ContractTemplate', required: true, unique: true },
  blank: { type: Buffer, required: true }, // 값 칸을 비운 계약서 PDF
  map: Schema.Types.Mixed, // { pageSize, fields: [{sheet, a, page, x, y, size, tokenW, roomRight, roomLeft}], checks }
  sheets: [String], // PDF에 들어간 장 (순서대로)
  builtBy: String
}, { timestamps: true });

export default mongoose.model('ContractTemplatePdf', ContractTemplatePdfSchema);
