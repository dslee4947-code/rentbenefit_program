import mongoose from 'mongoose';
const { Schema } = mongoose;

// 계약 한 건의 청구 회차표.
//
// 청구서와 세금계산서가 계약서 단위라, 같은 법인이라도 계약서가 다르면 청구서도 따로 나간다.
// 그래서 회차표도 계약당 하나만 둔다(contract에 unique).
//
// 회차를 별도 컬렉션이 아니라 배열로 둔 이유:
// 회차 수가 계약 기간만큼(보통 36~60)으로 유한하고, "이 계약이 몇 회차까지 나갔는지"를
// 늘 통째로 보기 때문에 한 문서에 모아 두는 편이 읽기도 쉽고 갱신도 원자적이다.
const BillingRoundSchema = new Schema({
  no: { type: Number, required: true }, // 회차 (1부터)
  dueDate: { type: Date, required: true }, // 청구일(출금일)

  monthlyRent: { type: Number, default: 0 }, // 그 회차의 월 렌트료 합계

  // 그 회차에만 붙는 금액들. 매달 있는 게 아니라 있을 때만 넣는다.
  prevUnpaid: { type: Number, default: 0 }, // 전월 미결제 (직전 회차에서 자동 이월)
  prevOverpaid: { type: Number, default: 0 }, // 전월 초과 입금
  interest: { type: Number, default: 0 }, // 연체 이자
  fine: { type: Number, default: 0 }, // 범칙금 / 과태료
  maintenance: { type: Number, default: 0 }, // 정기점검 등 정비 비용
  other: { type: Number, default: 0 }, // 기타 청구 (아래 extras의 합계. 항목별로 적기 위해 배열을 따로 둔다)

  // 기타 청구의 내역. '기타 80,000원'만 찍히면 법인에서 무슨 돈인지 되묻게 되므로
  // 항목명을 적어 청구서에 그대로 찍는다. other는 이 배열의 합계로 다시 계산된다.
  extras: [{
    label: { type: String, default: '기타 청구' },
    amount: { type: Number, default: 0 }
  }],
  note: String,

  // 연체 이자를 계산할 때 쓴 연이율(%). 사업 초기 20%에서 25%로 바뀐 것처럼 앞으로도 바뀌므로,
  // 그때그때 렌트차량 DB의 값을 쓰되 청구 시점에 무엇으로 계산했는지 남겨 둔다.
  interestRate: Number,
  interestDays: Number, // 연체 일수 (전월 출금일 -> 이번 출금일)

  total: { type: Number, default: 0 }, // 청구 합계

  status: {
    type: String,
    enum: ['예정', '청구됨', '입금완료', '미납'],
    default: '예정'
  },
  invoice: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  issuedAt: Date, // 청구서를 발행한 시각
  sentAt: Date, // 메일을 보낸 시각
  paidAt: Date,
  paidAmount: { type: Number, default: 0 },

  // 청구서와 함께 보내는 서류(범칙금·과태료 고지서 등).
  // 청구서와 같은 폴더에 "청구서 파일명_종류" 형태로 저장해, 어느 청구서에 딸린 건지 파일명만 봐도 알 수 있다.
  // 금액을 함께 적어 두는 이유: 범칙금이 한 달에 여러 건 오면 사람이 더해서 넣다가 틀린다.
  // 종류에 따라 fine(범칙금·과태료·통행료) 또는 maintenance(정비내역)로 자동 합산된다.
  attachments: [{
    kind: { type: String }, // 범칙금 / 과태료 / 통행료 / 정비내역 / 기타
    amount: { type: Number, default: 0 }, // 이 서류의 청구 금액
    plateNo: String, // 어느 차량 건인지. 법인이 가장 먼저 묻는 정보다
    occurredAt: Date, // 위반일 / 발생일. 어느 계약자 건인지를 가르는 값이다
    // 고지서에 적힌 번호. 같은 고지서를 다시 스캔하면 파일 지문이 달라져 중복을 못 잡으므로,
    // 이 번호를 진짜 열쇠로 쓴다.
    noticeNo: String,
    noticeDueDate: Date, // 고지서상 납부기한. 지나면 다음 회차 렌트료에 얹어 청구한다
    /**
     * 고객이 기한 안에 직접 냈는지.
     *
     * 직접 낸 건은 청구서에서 빠져야 한다. 첨부를 지우면 그 고지서가 있었다는 기록까지
     * 사라져 나중에 되짚을 수 없으므로, 지우지 않고 상태로 남기고 금액만 뺀다.
     */
    /**
     * 이 고지서를 어떻게 처리하는지. 계약의 fineHandling을 물려받고, 이 건만 다르면 여기서 바꾼다.
     */
    handling: {
      type: String,
      enum: ['대납청구', '고객납부', '명의변경'],
      default: '대납청구'
    },

    /**
     * 어디까지 진행됐는지.
     *
     *  접수      올린 직후 (공통)
     *  안내      고객에게 알렸다 (공통)
     *  운전자확인 누가 운전했는지 파악했다 (고객납부·명의변경)
     *  대납완료  우리가 냈다 (대납청구) — 다음 청구서에 얹혀 나간다
     *  접수중    경찰서·구청에 넘겼다 (명의변경)
     *  납부완료  고객이 직접 냈다 (고객납부) — 청구액에서 빠진다
     *  변경완료  명의가 넘어갔다 (명의변경) — 청구액에서 빠진다
     *  기한초과  기한을 넘겼다. 어떻게 할지는 사람이 정한다
     *
     * '고객납부'는 예전 값이다. 쓰던 데이터를 살리려고 남겨 둔다.
     */
    noticeStatus: {
      type: String,
      enum: ['접수', '안내', '운전자확인', '대납완료', '접수중', '납부완료', '변경완료', '기한초과', '청구예정', '고객납부'],
      default: '접수'
    },
    paidByCustomerAt: Date,   // 고객이 직접 낸 날
    paidByUsAt: Date,         // 우리가 대납한 날. 돈이 나갔는데 청구를 빠뜨리는 것을 막는다

    // 누가 운전했는지. 고객납부·명의변경은 이걸 모르면 다음 단계로 못 간다.
    driverName: String,
    driverPhone: String,

    // 명의 변경을 어디에 언제 넘겼는지. 반려되면 되돌려야 해서 기록이 필요하다.
    transferAgency: String,   // 경찰서 / 구청 이름
    transferSentAt: Date,     // 계약서와 고지서를 보낸 날
    transferDoneAt: Date,     // 변경이 확인된 날
    // 고객에게 안내 메일을 보낸 시각과 받는 곳.
    // 같은 고지서를 두 번 보내면 법인이 이중 청구로 오해한다. 보낸 기록이 있어야 막을 수 있다.
    noticeMailSentAt: Date,
    noticeMailTo: String,
    fileName: String,
    savedPath: String, // 실제로 저장된 경로. 폴더를 뒤지지 않고 바로 열기 위해 남긴다
    // 파일 내용의 지문(sha256). 같은 고지서를 두 번 올려 금액이 두 배로 청구되는 것을 막는다.
    // 파일 이름이 아니라 내용으로 본다. 이름은 저장할 때 바뀌기도 한다.
    fileHash: String,
    uploadedAt: { type: Date, default: Date.now }
  }],

  // 청구서 PDF가 저장된 곳
  invoiceFileName: String,
  invoiceSavedPath: String
}, { _id: false });

const BillingScheduleSchema = new Schema({
  contract: { type: Schema.Types.ObjectId, ref: 'Contract', required: true, unique: true },
  company: { type: Schema.Types.ObjectId, ref: 'Company' },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer' },

  totalRounds: { type: Number, required: true }, // 계약 기간(개월)과 같다
  monthlyRent: { type: Number, default: 0 }, // 계약에 묶인 차량들의 월 렌트료 합계
  dailyRent: { type: Number, default: 0 }, // 1일 렌트료 (첫 달/마지막 달 일할 계산용)

  // 결제일 설정. '5' '10' '15' '25' 또는 '말일'.
  // 말일은 달마다 실제 날짜가 달라 숫자로 못 박을 수 없어 말 그대로 저장한다.
  paymentDay: String,
  baseDate: Date, // 1회차 기준일 (렌트료 게시일 또는 인도일)

  rounds: [BillingRoundSchema]
}, { timestamps: true });

BillingScheduleSchema.index({ company: 1 });
BillingScheduleSchema.index({ 'rounds.dueDate': 1 });
// 고지서를 올릴 때마다 "이미 올린 번호인가"를 전 계약에서 찾는다. 인덱스가 없으면 전수 조회가 된다.
BillingScheduleSchema.index({ 'rounds.attachments.noticeNo': 1 });

const BillingSchedule = mongoose.model('BillingSchedule', BillingScheduleSchema);
export default BillingSchedule;
