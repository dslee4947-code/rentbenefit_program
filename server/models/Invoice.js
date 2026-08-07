import mongoose from 'mongoose';
const { Schema } = mongoose;

const InvoiceSchema = new Schema({
  invoiceNo: { type: String, required: true, unique: true }, // 자동 채번: INV-YYYYMM-XXXX
  contract: { type: Schema.Types.ObjectId, ref: 'Contract' },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
  billingMonth: { type: String, required: true }, // 예: 2026-08
  invoiceDate: { type: Date, default: Date.now },
  dueDate: { type: Date, required: true },
  items: [{
    desc: { type: String, required: true },
    supplyPrice: { type: Number, required: true },
    vat: { type: Number, required: true },
    total: { type: Number, required: true }
  }],
  totalSupplyPrice: { type: Number, required: true },
  totalVat: { type: Number, required: true },
  totalAmount: { type: Number, required: true },
  bankName: { type: String, required: true },
  bankAccount: { type: String, required: true },
  bankHolder: { type: String, required: true },
  remarks: String,
  createdBy: String,
  // 엑셀 결제금액내역 전용 필드 (선택적)
  prevUnpaid: { type: Number, default: 0 },
  prevOverpaid: { type: Number, default: 0 },
  maintenanceFee: { type: Number, default: 0 },
  fineFee: { type: Number, default: 0 },
  firstMonthFee: { type: Number, default: 0 },
  lastMonthFee: { type: Number, default: 0 },
  nthPay: { type: Number, default: 1 },
  withdrawDate: { type: Date },
  virtualAccount: String,
  email: String,
  vehicles: [{
    carNo: String,
    monthlyRent: Number,
    deliveryDate: Date
  }],
  invoiceType: { type: String, enum: ['standard', 'excel_payment'], default: 'standard' },
  status: { type: String, enum: ['발행', '취소'], default: '발행' }
}, { timestamps: true });

const Invoice = mongoose.model('Invoice', InvoiceSchema);
export default Invoice;
