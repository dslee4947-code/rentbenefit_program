import mongoose from 'mongoose';

/**
 * 차량번호별 자동차등록증 한 장. Dropbox "02. 렌트베네핏 자동차등록증" 폴더에서 옮겨 온다.
 * 대폐차 신고 메일에 차를 고르면 저절로 붙는다. sourceKey(파일 크기·고친 시각)가 같으면 다시 올리지 않는다.
 */
const vehicleRegCertSchema = new mongoose.Schema({
  plateNo: { type: String, required: true, unique: true },
  sourceName: { type: String, default: '' },
  sourceKey: { type: String, default: '' },
  sourceTime: { type: Number, default: 0 },
  contentType: { type: String, required: true },
  size: { type: Number, required: true },
  data: { type: Buffer, required: true, select: false },
  updatedBy: { type: String, default: '' }
}, { timestamps: true });

export default mongoose.model('VehicleRegCert', vehicleRegCertSchema);
