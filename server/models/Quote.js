import mongoose from 'mongoose';
const { Schema } = mongoose;

const QuoteSchema = new Schema({
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
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
