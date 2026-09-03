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
  deliveryPeriod: String, // 예상납기 (견적서 기준)

  // 2. 실물 등록 정보 (실제 차량이 배정된 뒤 입력)
  year: String,
  vin: String,
  plateNo: String,
  registrationDate: Date,

  // 3. 가격 스냅샷 (목록 화면에서 매번 계약을 populate하지 않고 바로 표시하기 위한 용도, 원본은 Contract.pricing)
  // 견적서 가격 상세 항목을 빠짐없이 그대로 담는다.
  carPrice: Number, // 차량가 (견적서의 basePrice)
  discount: Number, // 할인금액
  supplyPrice: Number, // 공급가액
  deliveryFee: Number, // 탁송료
  acquisitionTax: Number, // 취득세
  publicBond: Number, // 공채
  registrationAgencyFee: Number, // 등록대행료
  deposit: Number, // 보증금
  advancePayment: Number, // 선수금
  takeoverPrice: Number, // 인수가
  monthlyFee: Number, // 월 렌트료
  paymentTerm: Number, // 납입 개월 수
  individualConsumptionTax: Number, // 개별소비세(교육세·가산세 포함)

  // 4. 보험 정보 (견적서의 insurance 선택값 기반)
  insurance: {
    company: String, // 실제 가입해야 정해지므로 기본값을 두지 않는다
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

  // 5-1. 계약자 정보
  //
  // 계약서로 등록된 차량은 contract가 정본이다(contract -> customer/companyId).
  // 아래 항목은 계약서 없이 차량 DB에 직접(엑셀 일괄 등록 등) 넣는 차량을 위한 것으로,
  // 화면에서는 contract가 있으면 그쪽을 먼저 쓰고 없을 때만 여기를 본다.
  //
  // 법인 정보를 문자열로 복사하지 않고 Company를 참조하는 이유:
  // 법인 주소나 대표자가 바뀌면 법인 관리에서 한 번만 고쳐도 전 차량에 반영되어야 한다.
  // 복사해 두면 차량 수만큼 따로 고쳐야 하고, 고치다 말면 값이 어긋난다.
  partyType: { type: String, enum: ['법인', '개인'] },
  company: { type: Schema.Types.ObjectId, ref: 'Company' }, // partyType이 '법인'일 때
  contractorName: String, // 개인 계약자명. 법인이면 Company.name을 쓰므로 비워 둔다

  // 렌트료 출금 계좌
  banking: {
    holder: String, // 예금주명
    bankName: String,
    accountNo: String
  },

  // 이 차량을 들여올 때 실행한 대출/할부. 차량 단위로 조건이 달라 차량에 둔다.
  loan: {
    executed: { type: Boolean, default: false }, // 대출실행 여부
    lender: String, // 차용처
    executedDate: Date, // 실행일
    amount: Number, // 할부이용금액
    termMonths: Number, // 기간(개월)
    monthlyPayment: Number // 월할부금
  },

  // 6. 운영 상태
  status: {
    type: String,
    enum: ['계약중', '장기렌트', '사고대차', '예약', '거래완료'],
    default: '장기렌트'
  },
  currentMileage: { type: Number, default: 0 }, // 실제 누적 주행거리
  notes: { type: String, default: '' },

  // 7. 출고 준비 정보 (계약 완료 후 차량이 실제로 출고될 때 입력)
  deliveryDate: Date, // 인도일
  rentBillingDate: Date, // 렌트료 게시일
  // 월 대여료 결제일. '5' '10' '15' '25' 또는 '말일'.
  // 말일은 달마다 실제 날짜가 달라(2월 28/29일, 30일, 31일) 숫자로 못 박을 수 없어 말 그대로 저장한다.
  monthlyPaymentDay: String,
  interestRate: Number, // 금리(%) - 견적서에 적용된 금리가 계약 등록 시 자동으로 넘어옴 (견적서는 소수, 여기는 퍼센트)

  // 계약 조건 - 견적서에서 정해 계약서를 거쳐 넘어온다.
  // 정본은 Contract.terms이고, 여기 값은 차량 DB만 보고도 조건을 확인하려고 함께 둔다.
  lateInterestRate: Number, // 연체 이율 (연 %)
  earlyTerminationRate: Number, // 중도해지 수수료율 (%)
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
  gifts: [{ name: String, price: Number }],

  // 8. 출고 준비 상세 (출고 준비 화면에서 입력)

  // 차량 작업내용 - 선팅/블랙박스/코팅처럼 출고 전에 하는 작업.
  // 건마다 업체와 금액이 다르고 개수도 정해져 있지 않아 목록으로 둔다.
  // 위 accessories는 견적서에서 넘어온 금액이고, 여기는 실제로 진행한 작업 기록이다.
  vehicleWorks: [{
    name: String, // 작업명 (예: 선팅, 블랙박스, 유리막코팅)
    vendor: String, // 작업 업체
    price: Number,
    scheduledDate: Date, // 작업 예정일
    completed: { type: Boolean, default: false },
    note: String
  }],

  // 보험 가입 - 위 insurance는 견적 기준의 '조건'이고, 여기는 실제 가입 결과다.
  // 증권번호와 만기일은 가입해야 나오는 값이라 따로 둔다.
  insuranceEnrollment: {
    enrolled: { type: Boolean, default: false },
    company: String, // 실제 가입한 보험사
    policyNo: String, // 증권번호
    startDate: Date, // 보험 개시일
    endDate: Date, // 만기일
    premium: Number, // 실제 납입 보험료
    policyHolder: String, // 계약자(피보험자)
    note: String
  },

  // 출고지 - 차량을 어디서 어떻게 인도하는지
  deliveryPlace: {
    name: String, // 출고지명 (예: 서울 출고센터)
    address: String,
    managerName: String, // 출고지 담당자
    managerPhone: String,
    scheduledAt: Date, // 출고 예정 일시
    method: String, // 탁송 / 직접인수
    note: String
  },

  // 운전자 - 대표자일 수도, 계약 담당자일 수도, 제3자일 수도 있다.
  // 위 driver(이름)는 목록/기존 화면이 쓰던 값이라 그대로 두고, 저장할 때 name을 그쪽에도 맞춰 준다.
  driverInfo: {
    relation: String, // 대표자 / 책임담당자 / 실무담당자 / 기타
    name: String,
    birthDate: String, // 생년월일 (YYYY-MM-DD)
    licenseNo: String, // 면허번호
    licenseType: String, // 면허 종류 (예: 1종 보통)
    phone: String,
    email: String,
    note: String
  }
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
