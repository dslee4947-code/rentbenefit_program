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
  status: { type: String, enum: ['진행중', '계약전환', '보류'], default: '진행중' },
  createdBy: String,
}, { timestamps: true });

const Quote = mongoose.model('Quote', QuoteSchema);
export default Quote;
