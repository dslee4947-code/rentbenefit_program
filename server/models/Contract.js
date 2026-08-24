import mongoose from 'mongoose';
const { Schema } = mongoose;

const ContractSchema = new Schema({
  contractNo: { type: String, required: true, unique: true }, // 자동 채번
  vehicle: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  quote: { type: Schema.Types.ObjectId, ref: 'Quote' },
  partyType: { type: String, enum: ['개인', '법인'], default: '개인' },
  companyId: { type: Schema.Types.ObjectId, ref: 'Company' }, // partyType이 '법인'일 때만 사용
  leaseCompany: String, // 계약사
  contractDate: { type: Date, required: true },
  deliveryDate: Date,
  termMonths: { type: Number, required: true },
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

  status: { type: String, enum: ['진행중', '종료', '중도해지'], default: '진행중' },
  pricing: {
    basePrice: Number,
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
    monthlyFee: { type: Number, required: true }, // 월 대여료 / 월 납입금
    paymentTerm: Number, // 기간 (월 납입금 납부 개월 수)
    monthlyFeeTotal: Number, // 월 납입금 계
    billingDay: Number, // 월 대여료 결제일
    invoiceDay: Number, // 계산서발행일
    penaltyRate: Number,
    overdueRate: Number,
    pandanbi: Number, // 판관비
    individualConsumptionTax: Number, // 개별소비세(교육세,가산세포함)
  },
  gifts: [{ name: String, price: Number }],
}, { timestamps: true });

// Dashboard/list filters query by `status`; populate joins query by `customer`/`vehicle`
ContractSchema.index({ status: 1 });
ContractSchema.index({ customer: 1 });
ContractSchema.index({ vehicle: 1 });
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
