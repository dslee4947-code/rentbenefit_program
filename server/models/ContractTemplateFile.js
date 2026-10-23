import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * 전자계약서 양식의 엑셀 원본 파일.
 * 해석 결과(ContractTemplate)와 나눠 둔다. 목록을 볼 때마다 수 MB짜리 파일을 함께 읽지 않게 하려는 것이다.
 */
const ContractTemplateFileSchema = new Schema({
  template: { type: Schema.Types.ObjectId, ref: 'ContractTemplate', required: true, unique: true },
  data: { type: Buffer, required: true }
}, { timestamps: true });

export default mongoose.model('ContractTemplateFile', ContractTemplateFileSchema);
