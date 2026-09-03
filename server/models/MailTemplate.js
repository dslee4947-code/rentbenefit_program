import mongoose from 'mongoose';
const { Schema } = mongoose;

// 청구서 메일의 제목·본문·서명.
//
// 문구를 코드에 박아 두면 담당자가 바뀌거나 안내 문구를 고칠 때마다 배포를 해야 한다.
// 화면에서 고쳐 쓸 수 있게 DB에 둔다. 종류가 하나뿐이라 key로 한 건만 유지한다.
//
// 서명은 이미지 한 장으로 받는다. 지금도 회사 서명(상호·주소·연락처·로고)을 그림으로
// 붙여 보내고 있어서, 글자로 다시 짜 맞추는 것보다 그대로 넣는 편이 정확하다.
// 파일로 두지 않고 DB에 담는 이유는 배포하거나 서버를 옮겨도 따라가게 하기 위해서다.
const MailTemplateSchema = new Schema({
  key: { type: String, required: true, unique: true, default: 'invoice' },

  // 제목·본문에는 치환 항목을 쓸 수 있다. mailService가 실제 값으로 바꿔 넣는다.
  // {{계약자}} {{계약번호}} {{회차}} {{총회차}} {{출금일}} {{청구액}}
  subject: { type: String, default: '[렌트베네핏] {{계약자}} 청구서 {{회차}}회차' },
  body: {
    type: String,
    default: '렌트베네핏 차량 청구서 보내드립니다.\n문의사항이 있으시면 언제든지 연락주시기 바랍니다.\n감사합니다.'
  },

  signature: {
    fileName: String,
    contentType: String,
    data: Buffer,
    updatedAt: Date
  },

  updatedBy: String
}, { timestamps: true });

const MailTemplate = mongoose.model('MailTemplate', MailTemplateSchema);
export default MailTemplate;
