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

  // 인사말과 글자 서명. 대표님이 늘 보내던 메일 모양(2026-10-20): 인사말 → 본문 → 점선 사이 회사·연락처 → 맺음말 → 로고.
  // 서명 이미지를 올리면 그 이미지가 글자 서명과 로고를 대신한다.
  greeting: { type: String, default: '안녕하십니까. 렌트베네핏 이두식 팀장입니다.' },
  signatureText: {
    type: String,
    default: [
      '㈜S BENefit ㈜RENT BENefit ㈜FIN BENefit',
      '팀장 이두식',
      '(06772) 서울시 서초구 양재대로 11길 36 서울오토갤러리 은관 505호',
      'Office: 02-547-0303  Fax: 02-529-3303  M: 010-9061-3000',
      'E-mail: rent@sdibenefit.com'
    ].join('\n')
  },
  closingLine: { type: String, default: '고객의 시간을 만드는 기업, BENefit' },

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
