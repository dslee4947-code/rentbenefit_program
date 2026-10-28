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

  /**
   * 받았어야 했지만 청구하지 않은 연체 이자(기록용, 청구 합계에 들어가지 않는다).
   *
   * 엑셀로 보내던 시절에는 미납을 다음 달 '전월 미결제'로만 넘기고 이자를 붙이지 않았다.
   * 대표님 지시(2026-10-20): 이자를 받은 적은 없지만 청구서에는 얼마였는지 명시한다.
   * principal = 이 회차로 넘어온 원금(전월 미결제), days = 직전 출금일 → 이 회차 출금일.
   */
  unbilledInterest: {
    amount: Number,
    principal: Number,
    rate: Number,
    days: Number,
    // 어느 미납 회차에 대해, 언제부터 언제까지 붙은 이자인지(원장 입금일 기준, utils/lateInterestHistory.js)
    items: [{
      _id: false,
      fromNo: Number, // 미납이었던 회차
      fromDue: Date, // 그 회차 출금일
      principal: Number,
      from: Date, // 이자 기간 시작(직전 출금일)
      to: Date, // 이자 기간 끝(이 회차 출금일)
      days: Number,
      rate: Number,
      amount: Number
    }]
  },

  /**
   * 지난 회차들의 '받지 않은 연체 이자'를 이 회차 청구서에 모아 청구한 내역.
   *
   * 대표님 지시(2026-10-28, 동춘푸드): 미청구 이자 총합을 다음 청구서에 넣는다.
   * 금액은 기타 청구(extras)의 label 줄로 들어가 합계에 잡히고, 여기에는 어느 회차의 어느 이자인지를 남긴다.
   * 지난 회차의 unbilledInterest는 그대로 두고(그때는 청구하지 않은 게 사실이다),
   * 이 내역에 있는 건은 보관함에서 'n회차에서 청구'로 보여 주고 누적 '청구 보류' 합계에서 뺀다.
   * 기타 청구에서 그 줄을 지우면 이 내역도 함께 지운다(updateRound).
   */
  pastInterestCharge: {
    label: String, // extras에 넣은 줄 이름
    amount: Number,
    chargedAt: Date,
    items: [{
      _id: false,
      onNo: Number, // 이자가 붙었던 청구서 회차
      fromNo: Number, // 미납이었던 회차
      principal: Number,
      from: Date,
      to: Date,
      days: Number,
      rate: Number,
      amount: Number
    }]
  },

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
     *  청구취소  고지서를 올린 뒤 고객이 직접 내겠다고 했다 — 청구액에서 빼고, 낸 것을 확인하면 납부완료
     *            (대표님 2026-10-23). 기한까지 안 내면 [다시 청구]로 되돌린다
     *
     * '고객납부'는 예전 값이다. 쓰던 데이터를 살리려고 남겨 둔다.
     */
    noticeStatus: {
      type: String,
      enum: ['접수', '안내', '운전자확인', '대납완료', '접수중', '납부완료', '변경완료', '기한초과', '청구취소', '청구예정', '고객납부'],
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
  invoiceSavedPath: String,

  /**
   * 자동 발송.
   *
   * 발송 전날 담당자가 [승인]하면 그때 화면에서 PDF를 만들어 저장해 두고, 발송일 아침에 서버가 보낸다.
   * 서버가 혼자 PDF를 만들지 않는 이유: 청구서 양식이 화면 컴포넌트라 서버에서 같은 모양을 그리려면
   * 크롬을 서버에 넣어야 하는데, 지금 서버(512MB)로는 메모리가 모자라 서버 전체가 멈출 수 있다.
   *
   * snapshot은 승인할 때의 금액·서류·받는 주소의 지문이다. 승인 뒤 무엇이든 바뀌면 보내지 않고 '변경됨'으로
   * 멈춘다. 담당자가 본 것과 다른 청구서가 고객에게 나가는 일을 막는다.
   */
  autoSend: {
    // 발송중: 서버가 이 회차를 보내려고 붙잡은 상태. 메일을 보낸 뒤 저장 전에 서버가 죽으면 여기 멈춘다.
    //        그때 다시 보내면 고객이 두 번 받으므로 자동으로는 다시 보내지 않고 사람이 확인한다.
    // 대표승인대기: '달라진' 청구서(전월 미결제·이자·범칙금 등)를 직원이 확인했고 대표 승인을 기다린다.
    //             발송은 '승인'만 한다. 평소와 같은 청구서는 직원 승인만으로 '승인'이 된다.
    status: { type: String, enum: ['대표승인대기', '승인', '발송중', '발송완료', '변경됨', '실패'] },
    approvedAt: Date,
    approvedBy: String,
    checkedBy: String, // 대표 승인 전에 확인한 직원
    checkedAt: Date,
    to: String, // 받는 주소. 승인할 때 정한다
    snapshot: String,
    pdfFileName: String,
    pdfSavedPath: String,
    // 저장한 PDF의 지문. OneDrive에서 파일이 바뀌어 있으면 보내지 않는다
    pdfHash: String,
    claimedAt: Date,
    sentAt: Date,
    message: String // 보내지 못한 이유
  }
}, { _id: false });

const BillingScheduleSchema = new Schema({
  contract: { type: Schema.Types.ObjectId, ref: 'Contract', required: true, unique: true },
  company: { type: Schema.Types.ObjectId, ref: 'Company' },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer' },

  totalRounds: { type: Number, required: true }, // 계약 기간(개월)과 같다

  // 이 계약의 청구서를 받는 메일. 한 법인이라도 계약(차종)마다 담당자가 다를 수 있어 법인 기본 주소보다 먼저 쓴다
  // (예: 신흥정보통신 레이밴 jhlee@ / 그랜저 lareum@ / G80·K9 shtel124@).
  billingEmail: String,

  // 청구서를 메일로 보내지 않는 계약(직원 차량처럼 매월 직접 이체). 발송 센터 목록에서 뺀다.
  autoSendExcluded: { type: Boolean, default: false },
  autoSendExcludedReason: String,

  /**
   * 1회차 일할 정산.
   *
   * 인도일과 첫 결제일이 어긋나 1회차를 일할로 더(덜) 받은 계약은 그 차액을 마지막 회차에서 빼(더해) 맞춘다
   * (첫 회차 + 마지막 회차 = 월 렌트료 × 2). 고객이 매달 청구서에서 이 약속을 볼 수 있게 모든 청구서에 안내한다.
   * diff = 1회차 렌트료 − 월 렌트료 (더 받았으면 +, 덜 받았으면 −).
   */
  proration: {
    firstNo: Number,
    firstAmount: Number,
    regular: Number,
    diff: Number,
    lastNo: Number,
    lastAmount: Number,
    days: Number, // 일할 일수(알 때만)
    note: String
  },
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
