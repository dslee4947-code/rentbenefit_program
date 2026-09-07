import mongoose from 'mongoose';
import { PARTY_TYPES } from '../utils/partyType.js';
const { Schema } = mongoose;

const ContractSchema = new Schema({
  contractNo: { type: String, required: true, unique: true }, // 자동 채번
  // 임시저장 단계에서는 아직 차량이 없다(최종 등록/전환 시점에 생성되어 여기 연결된다)
  // 이 계약으로 묶인 차량 전체.
  //
  // 청구서·세금계산서가 모두 계약서 단위라, 같은 날 같은 법인과 계약해도
  // 계약서가 다르면 청구서도 따로 나가야 한다. 그래서 차량을 계약에 묶는다.
  // 차량 쪽 Vehicle.contract와 짝을 이루며, 둘 중 이 배열을 목록 조회의 기준으로 쓴다.
  vehicles: [{ type: Schema.Types.ObjectId, ref: 'Vehicle' }],

  // 대표 차량 (목록·검색에서 계약을 한 줄로 보여줄 때 쓴다). vehicles의 첫 번째와 같다.
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle' },
  // 임시저장 상태의 차량 정보를 그대로 담아 두는 자리. 최종 등록 시 이 값을 바탕으로
  // 실제 Vehicle 문서를 만들고 나면 더 이상 쓰지 않는다(차량은 vehicle 필드가 정본이 된다).
  vehicleInfo: Schema.Types.Mixed,
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  quote: { type: Schema.Types.ObjectId, ref: 'Quote' },
  // 계약구분. '개인'은 계약서 등록 화면이 아직 쓰는 예전 값이라 함께 받아 둔다
  // (렌트차량 DB는 개인사업자/일반개인으로 나눠 본다).
  partyType: { type: String, enum: [...PARTY_TYPES, '개인'], default: '일반개인' },
  companyId: { type: Schema.Types.ObjectId, ref: 'Company' }, // partyType이 '법인'일 때만 사용
  leaseCompany: String, // 계약사
  contractDate: Date,
  deliveryDate: Date,
  termMonths: Number,
  endDate: Date, // pre-save 훅에서 자동 계산
  branch: String,
  managerMain: String, // 책임담당자
  managerMainPhone: String, // 책임담당자 연락처
  managerOps: String, // 실무담당자
  managerOpsPhone: String, // 실무담당자 연락처
  
  rentPeriodYears: Number, // 렌트 기간(Y)
  rentStartDate: Date, // 렌트료 개시일
  rentPeriodDays: Number, // 렌트 기간 일수
  remainingPeriodCalc: String, // 남은 기간 계산
  
  finesEmail: String, // 범칙금 E-MAIL 1
  finesEmail2: String, // 범칙금 E-MAIL 2
  corporateRegistrationNo: String, // 법인/식별번호

  /**
   * 범칙금·과태료 고지서를 어떻게 처리하는 계약인지.
   *
   * 고객마다 방식이 정해져 있다. 고지서가 올 때마다 사람이 판단하면 놓치거나 엇갈리므로
   * 계약에 미리 정해 두고, 고지서 한 건만 다르게 갈 때 그 건에서 바꾼다.
   *
   *  대납청구 - 우리가 먼저 내고 다음 청구서에 얹어 청구한다
   *  고객납부 - 법인 담당자를 거쳐 운전자가 직접 낸다. 기한을 넘기면 우리가 떠안게 되어 추적이 필요하다
   *  명의변경 - 경찰서·구청에 계약서와 함께 넘겨 고객에게 직접 고지되게 한다. 우리는 청구하지 않는다
   */
  fineHandling: {
    type: String,
    enum: ['대납청구', '고객납부', '명의변경'],
    default: '대납청구'
  },

  // 초기에는 차량 한 대마다 계약번호를 따로 매겼다. 그 계약들을 한 건으로 묶으면서
  // 원래 번호를 남겨 둔다. 예전 계약서·세금계산서를 찾을 때 이 번호로 대조한다.
  mergedContractNos: [String],

  // 계약 조건 - 견적서에서 정한 값이 그대로 넘어온다.
  // 연체 이율은 청구서에서 연체 이자를 계산할 때 쓴다.
  terms: {
    lateInterestRate: { type: Number, default: 25 }, // 연체 이율 (연 %)
    earlyTerminationRate: { type: Number, default: 35 } // 중도해지 수수료율 (%)
  },

  // '보관됨'은 계약서를 고객 폴더에 저장해 마무리한 상태다.
  // 계약서 목록에서 감춰지고, 이 계약에 묶인 차량은 렌트차량 DB에서 수정할 수 없다.
  // 되돌리면 다시 '진행중'이 되어 수정할 수 있다. 지우지 않고 상태로 두는 이유는
  // 차량과 청구서가 이 계약을 가리키고 있어, 삭제하면 그 연결이 끊기기 때문이다.
  status: { type: String, enum: ['임시저장', '진행중', '보관됨', '종료', '중도해지'], default: '진행중' },
  archivedAt: Date, // 계약서를 폴더에 저장해 보관한 시각
  customerFolder: String, // 계약자 폴더명 (계약자명). 나중에 계약자명이 바뀌어도 파일을 찾을 수 있게 남긴다

  // 이 계약의 서류가 들어가는 폴더 이름 ("계약번호_차종").
  // 만들 때 정해서 저장해 둔다. 나중에 차종을 고쳐도 폴더 이름이 바뀌면
  // 이미 저장된 계약서·청구서를 그 경로에서 못 찾게 되기 때문이다.
  docFolderName: String,
  pricing: {
    basePrice: Number,
    optionPrice: Number, // 옵션가
    discount: Number,
    supplyPrice: Number,
    deliveryFee: Number,
    acquisitionTax: Number,
    publicBond: Number,
    stampFee: Number,
    plateFee: Number,
    registrationAgencyFee: Number,
    commission: Number,
    deposit: Number,
    advancePayment: Number,
    takeoverPrice: Number,
    monthlyFee: Number, // 월 대여료 / 월 납입금
    paymentTerm: Number, // 기간 (월 납입금 납부 개월 수)
    monthlyFeeTotal: Number, // 월 납입금 계
    billingDay: Number, // 월 대여료 결제일
    invoiceDay: Number, // 계산서발행일
    penaltyRate: Number,
    overdueRate: Number,
    pandanbi: Number, // 판관비
    individualConsumptionTax: Number, // 개별소비세(교육세,가산세포함)
    baseInterestRate: Number, // 금리 - 견적서에서 그대로 이관, 출고 준비 시 렌트차량 DB로 다시 넘어감
    dealerCommission: Number // 타딜러수수료
  },
  gifts: [{ name: String, price: Number }],
}, { timestamps: true });

// Dashboard/list filters query by `status`; populate joins query by `customer`/`vehicle`
ContractSchema.index({ status: 1 });
ContractSchema.index({ customer: 1 });
ContractSchema.index({ vehicle: 1 });
ContractSchema.index({ vehicles: 1 });
ContractSchema.index({ createdAt: -1 });

ContractSchema.pre('save', function (next) {
  if (this.contractDate && this.termMonths) {
    const end = new Date(this.contractDate);
    end.setMonth(end.getMonth() + this.termMonths);
    this.endDate = end;
  }
  next();
});

const Contract = mongoose.model('Contract', ContractSchema);
export default Contract;
