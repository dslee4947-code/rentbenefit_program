import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * 차량 손익 원장 (갑지).
 *
 * 자금팀이 차량 1대에 들어간 돈과 들어온 돈을 직접 적어 두는 장부다.
 * 지금까지 엑셀 "렌트베네핏 장기렌트_갑지.xlsx"의 차량별 시트가 하던 일을 그대로 옮긴 것으로,
 * 시트 한 장 = 이 문서 하나다.
 *
 * 차량(Vehicle)의 하위 필드로 넣지 않고 독립 문서로 둔 이유:
 * 계약금은 계약서를 쓰는 순간 나가는데, 그 시점에는 아직 Vehicle 문서가 없다
 * (차량은 계약서 '최종 등록' 때 만들어진다). 갑지를 차량에 매달면 그 계약금을 적을 자리가 없다.
 * 그래서 vehicle/contract를 둘 다 비워 둘 수 있게 하고, 나중에 차량이 출고되면 연결만 한다.
 */

// 은행 칸에 자주 쓰는 값. 엑셀 실물에서 B(9,218건)와 SC(154건)가 대부분이고
// 카드/KB/삼성/하나/부산/현금이 가끔 나온다. 목록에 없는 값도 그대로 적을 수 있어야 해서
// enum으로 막지 않고 화면에서 선택지로만 쓴다.
export const LEDGER_BANKS = ['B', 'SC', '카드', 'KB', '삼성', '하나', '부산', '현금'];

/**
 * 항목 분류.
 *
 * 엑셀에는 항목명이 464가지나 있는데("과태료", "미납 통행료", "미납통행료", "미남통행료" …)
 * 사람이 그때그때 적은 자유 문구라 그걸 그대로 코드에 박을 수는 없다.
 * 그래서 화면에 찍히는 이름(label)은 자유 입력으로 두고, 통계를 낼 수 있게
 * 굵직한 분류(category)만 따로 고른다.
 */
export const LEDGER_CATEGORIES = [
  '계약금', '차량가', '등록비용', '할부이자', '할부금',
  '보험', '자동차세', '검사비', '정기점검', '과태료·통행료',
  '공제조합', '차량작업', '수리·사고', '유류·세차', '탁송',
  '제세공과', '보증금', '선납금', '인수가', '렌트료',
  '수수료', '캐시백', '환급', '기타'
];

/**
 * 항목명에서 분류를 고른다.
 *
 * 화면에서는 분류를 고르지 않는다. 자금팀이 금액 한 줄 적을 때마다 24개짜리 목록을
 * 뒤지게 만들 이유가 없다. 대신 적어 넣은 이름에서 자동으로 판정한다.
 *
 * 순서가 중요하다. "삼성보험료 환급"은 보험이 아니라 환급이고,
 * "렌터카보험 보증금"은 보증금이 아니라 공제조합 출자금이다.
 */
const CATEGORY_RULES = [
  [/환급|환입|환불|취소/, '환급'],
  [/캐시백/, '캐시백'],
  [/수수료/, '수수료'],
  [/렌공|공제조합|공제조함|렌터카\s*공제|렌트카공제|렌트\s*보험|렌터카보험|출자금/, '공제조합'],
  [/과태료|통행료|범칙|속도위반|주정차/, '과태료·통행료'],
  [/자동차세|교육세/, '자동차세'],
  [/검사/, '검사비'],
  [/정기\s*점검|정기점검/, '정기점검'],
  [/썬팅|선팅|블박|블랙박스|PPF|유리막|코팅|매트|타이어|캐리어|번호판\s*교체/, '차량작업'],
  [/수리|사고|면책|본인\s*부담|고객부담|휴차|유리복원/, '수리·사고'],
  [/주유|세차|충전|워셔/, '유류·세차'],
  [/탁송/, '탁송'],
  [/취득세|개별\s*소비세|개소세|가산세|형식변경|구조변경/, '제세공과'],
  [/할부/, '할부금'],
  [/^이자|이자$/, '할부이자'],
  [/보험/, '보험'],
  [/등록비용/, '등록비용'],
  [/계약금/, '계약금'],
  [/차량가|차량\s*대금/, '차량가'],
  [/보증금/, '보증금'],
  [/선납금|선수금/, '선납금'],
  [/인수가/, '인수가'],
  [/렌트료|렌트\s*\d+\s*회차/, '렌트료']
];

export const pickLedgerCategory = (label) => {
  const text = String(label || '');
  const hit = CATEGORY_RULES.find(([rx]) => rx.test(text));
  return hit ? hit[1] : '기타';
};

/**
 * 갑지 한 줄. 엑셀의 3개 열(회사출금액 / 고객입금액 / 기타)을 한 배열에 모았다.
 *
 * 열을 나눠 담지 않은 이유: 엑셀 상단 집계 박스가 열 기준이 아니라
 * "은행별 지출 합 / 은행별 입금 합 / 그 차액"으로 계산된다(B-회사출금액, SC-고객입금액 …).
 * 즉 실제 축은 (side × bank)라서, 한 배열에 담아 두면 집계가 전부 파생값이 된다.
 * 화면에서 3열로 보여 주는 건 group으로 구분한다.
 */
const LedgerEntrySchema = new Schema({
  // 정산 계산에 쓰는 부호. 기타 열(판매 수수료·캐시백·보험료 환급)도 회사로 들어오는 돈이라 '입금'이다.
  side: { type: String, enum: ['지출', '입금'], required: true },
  // 화면에서 어느 열에 놓을지. 엑셀 열 배치를 그대로 유지하기 위한 값이다.
  group: { type: String, enum: ['회사출금', '고객입금', '기타'], default: '회사출금' },

  category: { type: String, default: '기타' },
  label: { type: String, default: '' }, // 화면과 인쇄물에 그대로 찍히는 이름 ('보험 3회차', '미납 통행료')
  amount: { type: Number, default: 0 },
  bank: { type: String, default: '' },
  date: Date,
  round: Number, // 렌트료·보험·할부금의 회차. 자동 연동이 같은 줄을 다시 찾을 때 쓴다

  /**
   * 이 줄이 어느 계약 구간의 것인지 (1 = 최초 계약, 2 = 1차 연장 …).
   *
   * 연장할 때 계약서를 새로 쓰면 청구 회차표도 새로 생겨 회차가 1부터 다시 시작한다.
   * 이 값이 없으면 "렌트료 1회차"가 최초 계약과 연장 계약에서 같은 줄로 인식되어
   * 자동 연동이 서로를 덮어쓴다.
   */
  periodSeq: { type: Number, default: 1 },
  memo: String,

  // 이 줄을 누가 만들었는지. manual이면 자금팀이 손으로 적은 줄이다.
  source: {
    type: String,
    enum: ['manual', 'contract', 'billing', 'vehicle', 'loan'],
    default: 'manual'
  },
  sourceRef: Schema.Types.ObjectId, // 연동 원본 문서(청구 회차표 등)

  /**
   * 자동으로 만든 줄을 사람이 고치면 켜진다. 켜진 줄은 재동기화가 건드리지 않는다.
   *
   * 이게 없으면 자금팀이 맞춰 놓은 숫자가 다음 동기화 때 원래 값으로 되돌아간다.
   * 장부에서 그건 그냥 데이터 손실이다.
   */
  locked: { type: Boolean, default: false }
}, { _id: true, timestamps: false });

const VehicleLedgerSchema = new Schema({
  // 엑셀의 '구분' 열 (Ray-003, Grander-01 …). 차량 코드와 같은 체계로 채번한다.
  ledgerNo: { type: String, required: true, unique: true },

  // 차량이 아직 안 나온 갑지도 있다. 출고되면 이 두 개만 채워 연결한다.
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', default: null },
  contract: { type: Schema.Types.ObjectId, ref: 'Contract', default: null },
  company: { type: Schema.Types.ObjectId, ref: 'Company', default: null },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },

  /**
   * 갑지의 성격. 장기렌트가 대부분이지만 사고대차·단기렌트 차량도 갑지를 따로 만든다.
   * 진행 상태(status)와는 다른 축이다. "사고대차인데 아직 운용중"이 성립하기 때문이다.
   * 차량을 연결하면 렌트차량 DB의 상태(Vehicle.status)를 보고 자동으로 정해진다.
   */
  ledgerType: {
    type: String,
    enum: ['장기렌트', '사고대차', '단기렌트', '기타'],
    default: '장기렌트'
  },

  status: {
    type: String,
    enum: ['차량미배정', '운용중', '거래완료', '보류'],
    default: '차량미배정'
  },

  /**
   * 갑지 상단 정보.
   *
   * 차량·계약에서 가져올 수 있는 값이지만 스냅샷으로 복사해 둔다.
   * 차량이 연결되기 전에도 자금팀이 적을 수 있어야 하고, 갑지는 그 시점의 장부라
   * 나중에 차량 정보가 바뀌어도 이미 정산한 갑지의 표기는 그대로여야 한다.
   */
  header: {
    customerName: String, // 고객명 (담당자)
    contractorName: String, // 계약자명 (법인명)
    carModel: String, // 차종
    carSpec: String, // 차량 사양
    plateNo: String, // 차량번호
    vin: String, // 차대번호
    cc: Number, // 배기량
    year: String, // 년식
    leaseCompany: String, // 리스사 (엑셀 '리스사' 열: 현금 / 캐피탈사)
    carPrice: Number, // 차량가
    registeredAt: Date, // 등록일
    contractedAt: Date, // 계약일
    contractEndAt: Date, // 계약종료일
    deliveredAt: Date // 출고일 (인도일)
  },

  /**
   * 장기렌트 고정 조건.
   *
   * 정본은 계약서(Contract.pricing)지만 여기 값은 갑지 안에서만 고쳐 쓰는 사본이다.
   * 자금팀이 갑지에서 숫자를 고쳐도 계약서·차량 DB로 되돌아가지 않는다.
   * 계약서를 고칠 권한과 장부를 맞출 권한은 다른 일이라 서로 넘나들면 안 된다.
   */
  terms: {
    monthlyRent: Number, // 월 렌트료
    termMonths: Number, // 계약 기간(개월)
    deposit: Number, // 보증금
    advancePayment: Number, // 선납금
    takeoverPrice: Number, // 인수가
    rentStartDate: Date, // 렌트료 개시일
    paymentDay: String // 결제일 ('10', '말일' …)
  },

  // 회사가 이 차를 할부·대출로 들여왔을 때의 조건. 월할부금을 회차로 펼쳐 지출에 넣는다.
  loan: {
    executed: { type: Boolean, default: false },
    lender: String, // 차용처
    executedDate: Date,
    amount: Number, // 원금
    interestRate: Number, // 이자율(연 %)
    termMonths: Number,
    monthlyPayment: Number,
    finishedDate: Date // 상환 완료일
  },

  /**
   * 계약 구간. 연장할 때마다 한 칸씩 늘어난다.
   *
   * 연장해도 갑지는 새로 만들지 않고 이 배열만 늘린다.
   * 차량가·등록비용·취득세는 최초 1회만 나가므로 갑지를 쪼개면 두 장 다 거짓말을 한다.
   * 원 갑지는 지출만 남아 적자로, 연장 갑지는 렌트료만 쌓여 폭리로 보인다.
   * 차 1대의 손익은 연장을 포함해야 맞다.
   *
   * 구간별 소계가 필요하면 entries의 periodSeq로 걸러 낸다.
   */
  contractPeriods: [{
    seq: { type: Number, required: true }, // 1 = 최초 계약
    contract: { type: Schema.Types.ObjectId, ref: 'Contract' },
    contractNo: String, // 계약이 지워져도 어느 계약이었는지 남긴다
    startDate: Date,
    endDate: Date,
    termMonths: Number,
    monthlyRent: Number, // 구간마다 다르다. 연장하면서 렌트료가 바뀐다
    deposit: Number,
    advancePayment: Number,
    takeoverPrice: Number,
    note: String
  }],

  entries: [LedgerEntrySchema],

  note: String
}, { timestamps: true });

VehicleLedgerSchema.index({ vehicle: 1 });
VehicleLedgerSchema.index({ contract: 1 });
VehicleLedgerSchema.index({ company: 1 });
VehicleLedgerSchema.index({ status: 1 });
VehicleLedgerSchema.index({ ledgerType: 1 });
VehicleLedgerSchema.index({ 'header.plateNo': 1 });

/**
 * 갑지 한 장의 집계.
 *
 * 엑셀 상단 박스와 같은 값을 만든다.
 *   지출계: B-회사출금액 / SC-회사출금액 / 회사출금액
 *   수입계: B-고객입금액 / SC-고객입금액 / 고객입금액
 *   정산계: 은행별 (입금 - 지출), 그리고 전체 정산금액
 *
 * 사람이 더하지 않도록 항상 여기서 다시 계산한다.
 */
export const summarizeLedger = (ledger, periodSeq = null) => {
  const byBank = {};
  let paidOut = 0;
  let paidIn = 0;

  (ledger.entries || []).forEach((e) => {
    // 구간을 지정하면 그 구간 줄만 집계한다 ("1차 연장에서 얼마 남았나")
    if (periodSeq !== null && (e.periodSeq || 1) !== periodSeq) return;
    const amount = Number(e.amount) || 0;
    if (!amount) return;
    const bank = (e.bank || '미지정').trim() || '미지정';
    if (!byBank[bank]) byBank[bank] = { bank, paidOut: 0, paidIn: 0, balance: 0 };

    if (e.side === '입금') {
      byBank[bank].paidIn += amount;
      paidIn += amount;
    } else {
      byBank[bank].paidOut += amount;
      paidOut += amount;
    }
  });

  Object.values(byBank).forEach((b) => { b.balance = b.paidIn - b.paidOut; });

  return {
    byBank: Object.values(byBank).sort((a, b) => a.bank.localeCompare(b.bank)),
    paidOut,
    paidIn,
    balance: paidIn - paidOut
  };
};

const VehicleLedger = mongoose.model('VehicleLedger', VehicleLedgerSchema);
export default VehicleLedger;
