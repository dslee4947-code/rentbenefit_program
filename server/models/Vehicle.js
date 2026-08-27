import mongoose from 'mongoose';
const { Schema } = mongoose;

// 견적서 -> 계약서 등록 흐름에서 넘어오는 정보를 그대로 담는 렌트차량 DB.
// 고객/법인/담당자/가격 상세/사은품 등은 이미 Contract에 있으므로 여기서는 중복 저장하지 않고
// contract 참조로 연결한다. 여기 남는 건 "물리적인 차량 자체"에 대한 정보(차종/사양/실물 등록/보험/정비/운영 상태)뿐이다.
const VehicleSchema = new Schema({
  contract: { type: Schema.Types.ObjectId, ref: 'Contract' }, // 이 차량이 속한 계약 (계약 등록 시 자동 연결)
  code: { type: String }, // 자동 생성 차량 코드 (예: GRA-001)

  // 1. 차종 / 사양 (견적서의 차량 정보를 그대로 전달받음)
  carModel: { type: String, required: true },
  carSpec: String,
  fuelType: String,
  cc: Number,
  exteriorColor: String,
  interiorColor: String,
  options: String,

  // 2. 실물 등록 정보 (실제 차량이 배정된 뒤 입력)
  year: String,
  vin: String,
  plateNo: String,
  registrationDate: Date,

  // 3. 가격 스냅샷 (목록 화면에서 매번 계약을 populate하지 않고 바로 표시하기 위한 용도, 원본은 Contract.pricing)
  carPrice: Number,
  monthlyFee: Number,

  // 4. 보험 정보 (견적서의 insurance 선택값 기반)
  insurance: {
    company: { type: String, default: '삼성화재' },
    type: { type: String, enum: ['standard', 'premium'], default: 'standard' },
    driverAge: String,
    liabilityLimit: String,
    propertyLimit: String,
    personalInjury: String,
    uninsuredInjury: String,
    deductible: Number,
    emergencyService: String
  },

  // 5. 정비 서비스 정보 (견적서의 maintenance 선택값 기반)
  maintenance: {
    enabled: Boolean,
    tireType: String,
    mileage: Number, // 약정 주행거리
    regularCheck: String,
    consumables: String,
    generalMaintenance: String
  },

  // 6. 운영 상태
  status: {
    type: String,
    enum: ['rented', 'available', 'maintenance', 'reserved'],
    default: 'available'
  },
  currentMileage: { type: Number, default: 0 }, // 실제 누적 주행거리
  notes: { type: String, default: '' },

  // 7. 출고 준비 정보 (계약 완료 후 차량이 실제로 출고될 때 입력)
  deliveryDate: Date, // 인도일
  rentBillingDate: Date, // 렌트료 게시일
  monthlyPaymentDay: Number, // 월 대여료 결제일 (일) - 보통 렌트료 게시일의 '일'
  interestRate: Number, // 금리(%) - 견적서에 적용된 금리가 계약 등록 시 자동으로 넘어옴
  companyCommission: Number, // 회사수수료 - 계약 등록 시 자동으로 넘어옴
  dealerCommission: Number, // 타딜러수수료 - 계약 등록 시 자동으로 넘어옴
  sellingAdminExpense: Number, // 판관비 - 계약 등록 시 자동으로 넘어옴
  driver: { type: String, default: '' }, // 운전자 (대표자가 아닌 경우에만 입력)
  vehicleManager: { type: String, default: '' }, // 차량 관리자 (있을 때만 입력)
  accessories: {
    blackboxPrice: Number,
    blackboxInfo: String, // 예: 아이나비 QSD0-7000, 빌트인캠(차량가에 포함)
    tintingPrice: Number,
    tintingInfo: String, // 예: 버텍스300 전면 35%/1열 15%, 2열·후면 5%
    tireInfo: String // 예: 금호 앞뒤 255/50 R20
  },
  gifts: [{ name: String, price: Number }]
}, { timestamps: true });

VehicleSchema.index({
  plateNo: 'text',
  vin: 'text',
  carModel: 'text',
  code: 'text'
});
VehicleSchema.index({ contract: 1 });
VehicleSchema.index({ status: 1 });

const Vehicle = mongoose.model('Vehicle', VehicleSchema);

export default Vehicle;
