import mongoose from 'mongoose';
const { Schema } = mongoose;

const QuoteSchema = new Schema({
  // 계약 조건 - 계약서 등록 시 그대로 이관된다
  terms: {
    lateInterestRate: { type: Number, default: 25 }, // 연체 이율 (연 %)
    earlyTerminationRate: { type: Number, default: 35 } // 중도해지 수수료율 (%)
  },
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
  // 계약서 등록 시 차량 정보 항목을 그대로 채울 수 있도록 세부 항목을 구조화해서 별도 저장
  // (vehicleSpec은 사람이 읽기 위한 문자열 요약이라 파싱에 의존하지 않기 위함)
  vehicleDetail: {
    fuelType: String,
    cc: Number,
    deliveryPeriod: String,
    exteriorColor: String,
    interiorColor: String
  },
  totalPrice: Number,
  monthlyEstimates: [{
    termMonths: Number,
    monthlyFee: Number,
    name: String,
    companyName: String,
    // 렌트 | 리스. 리스는 타사에서 받은 견적 값을 그대로 옮겨 적는 용도라 계산에 관여하지 않고,
    // 비교표와 견적서에서 색으로만 구분된다.
    contractType: { type: String, enum: ['렌트', '리스'], default: '렌트' },
    // 비교표 '특이사항' 행에 안별로 입력하는 내용
    specialNote: String,
    // 옵션 카드의 '월 정비비 포함' 체크 상태. maintenance.enabled는 선택된 안 하나만
    // 담고 있어서, 비교표처럼 여러 안을 나란히 보여줄 때는 안별 값이 따로 필요하다.
    maintenanceEnabled: { type: Boolean, default: true }
  }],
  // 장기렌터카 견적서 왼쪽 하단 '비고' 칸 내용 (문서 단위)
  rentalRemark: String,
  // 비교 견적서 '특이사항'을 안별로 나누지 않고 하나로 합쳐 표시할지 여부.
  // true면 표에서 안별 칸을 가로로 병합하고 mergedSpecialNote 하나만 보여준다.
  specialNoteMerged: { type: Boolean, default: false },
  mergedSpecialNote: String,

  // 견적 작성 화면에서 비교하던 차량 전체의 스냅샷.
  // 위의 vehicleModel/pricing/monthlyEstimates는 계약서 연동과 목록 표시를 위한
  // "대표 차량 1대" 정보라, 3대를 비교한 견적을 다시 열면 나머지 2대가 사라졌다.
  // 화면 상태를 그대로 담아 두고 불러올 때 통째로 복원한다.
  //
  // 편집기 상태를 있는 그대로 왕복시키는 것이 목적이라 Mixed로 둔다.
  // 필드를 하나하나 정의하면 화면에 새 항목이 추가될 때마다 스키마를 같이 고쳐야 하고,
  // 빠뜨리면 저장은 되는데 값이 조용히 사라진다.
  comparisonVehicles: [{ type: Schema.Types.Mixed }],
  activeVehicleId: Number,
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
    registrationAgencyFee: Number,
    baseInterestRate: Number, // 금리 - 출고 준비 시 렌트차량 DB에 그대로 넘어감
    dealerCommission: Number // 타딜러수수료
  },
  // 계약서 등록 시 보험/정비 항목을 그대로 채울 수 있도록 견적 시점 선택값을 저장
  insurance: {
    type: { type: String, enum: ['standard', 'premium'] }, // 일반형/고급형(임직원)
    deductible: Number,
    annualFee: Number
  },
  maintenance: {
    enabled: Boolean,
    tireType: String,
    mileage: Number
  },
  status: { type: String, enum: ['진행중', '계약전환', '보류'], default: '진행중' },
  createdBy: String,
}, { timestamps: true });

const Quote = mongoose.model('Quote', QuoteSchema);
export default Quote;
