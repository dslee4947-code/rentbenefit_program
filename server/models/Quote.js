import mongoose from 'mongoose';
const { Schema } = mongoose;

const QuoteSchema = new Schema({
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },

  // 거래 주체 구분 (고객이 법인 여러 곳에 소속될 수 있어 어느 법인 건인지 명시해야 함)
  partyType: { type: String, enum: ['개인', '법인'], default: '개인' },
  companyId: { type: Schema.Types.ObjectId, ref: 'Company' }, // partyType이 '법인'일 때만 사용

  // 스냅샷: 견적 작성 시점 값을 그대로 고정 저장. customer/companyId가 참조하는
  // 원본 데이터가 나중에 바뀌어도(고객명 수정, 법인 정보 수정 등) 이 견적서의
  // 표기 내용은 영향받지 않는다.
  customerName: String,
  companyName: String,
  companyBizNo: String,

  vehicleModel: { type: String, required: true }, // 차종/사양
  vehicleSpec: String,
  totalPrice: Number,
  monthlyEstimates: [{
    termMonths: Number,
    monthlyFee: Number,
    name: String,
    companyName: String
  }],
  // 계약서 등록 화면으로 바로 연결(불러오기)할 때 필요한 가격 상세 스냅샷
  pricing: {
    basePrice: Number,
    discount: Number,
    supplyPrice: Number,
    deliveryFee: Number,
    acquisitionTax: Number,
    publicBond: Number,
    commission: Number,
    deposit: Number,
    advancePayment: Number,
    takeoverPrice: Number,
    monthlyFee: Number,
    paymentTerm: Number,
    pandanbi: Number,
    individualConsumptionTax: Number,
    registrationAgencyFee: Number
  },
  status: { type: String, enum: ['진행중', '계약전환', '보류'], default: '진행중' },
  createdBy: String,
}, { timestamps: true });

const Quote = mongoose.model('Quote', QuoteSchema);
export default Quote;
