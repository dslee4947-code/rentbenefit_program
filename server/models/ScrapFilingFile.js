import mongoose from 'mongoose';

/** 대폐차 신고서에 붙인 자동차등록증. 메일에 신고서 PDF와 함께 첨부한다. 파일이 커서 신고서와 따로 둔다. */
const scrapFilingFileSchema = new mongoose.Schema({
  filing: { type: mongoose.Schema.Types.ObjectId, ref: 'ScrapFiling', required: true, index: true },
  plateNo: { type: String, default: '' },
  fileName: { type: String, required: true },
  contentType: { type: String, required: true },
  size: { type: Number, required: true },
  data: { type: Buffer, required: true, select: false },
  uploadedBy: { type: String, default: '' }
}, { timestamps: true });

export default mongoose.model('ScrapFilingFile', scrapFilingFileSchema);
