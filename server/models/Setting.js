import mongoose from 'mongoose';

/**
 * 프로그램 설정을 담아 두는 곳.
 *
 * 지금은 문서 저장 경로 하나만 쓰지만, 나중에 다른 설정이 생겨도 같은 자리에 넣을 수 있게
 * key 하나에 값 한 덩어리(value)를 담는 모양으로 둔다. 설정 종류마다 컬렉션을 새로 만들면
 * 화면과 API가 계속 늘어난다.
 */
const settingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, index: true },

  // 설정 내용. 종류마다 모양이 달라 형태를 고정하지 않는다.
  value: { type: mongoose.Schema.Types.Mixed, default: {} },

  // 누가 언제 바꿨는지. 저장 경로가 갑자기 달라졌을 때 되짚을 수 있어야 한다.
  updatedBy: { type: String, default: '' }
}, { timestamps: true });

export default mongoose.model('Setting', settingSchema);
