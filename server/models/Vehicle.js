import mongoose from 'mongoose';
const { Schema } = mongoose;

const VehicleSchema = new Schema({
  // 1. 기본 정보
  no: { type: Number }, // No
  category: { type: String, default: '장기' }, // 구분
  operation: { type: String, default: '운영' }, // 운영
  contractCompany: { type: String, default: '' }, // 계약사
  manager: { type: String, default: '' }, // 책임담당자
  managerPhone: { type: String, default: '' }, // 연락처
  carModel: { type: String, default: '' }, // 차종
  carSpec: { type: String, default: '' }, // 차량 사양
  carPrice: { type: Number, default: 0 }, // 차량가
  year: { type: String, default: '2024년식' }, // 연식
  color: { type: String, default: '블랙' }, // 색상
  fuelType: { type: String, default: '휘발유' }, // 유종
  vin: { type: String, default: '' }, // 차대 번호
  carNumber: { type: String, default: '' }, // 차량 번호 (계약별로 동일 번호 재사용 가능)
  options: { type: String, default: '' }, // 옵션
  cc: { type: String, default: '' }, // CC
  regDate: { type: String, default: '' }, // 등록일

  // 2. 계약 & 운행 정보
  contractDate: { type: String, default: '' }, // 계약일
  deliveryDate: { type: String, default: '' }, // 인도 날짜
  rentPeriodYears: { type: String, default: '3' }, // 렌트 기간(Y)
  rentEndDate: { type: String, default: '' }, // 렌트 종료
  remainingPeriod: { type: String, default: '' }, // 남은 기간
  mileage: { type: Number, default: 0 }, // 운행 거리
  practicalManager: { type: String, default: '' }, // 실무담당자
  practicalPhone: { type: String, default: '' }, // 연락처 (실무)
  branch: { type: String, default: '' }, // 지점
  deliveryAddress: { type: String, default: '' }, // 출고지 주소
  rentStartDate: { type: String, default: '' }, // 렌트료 개시일
  rentPeriodDays: { type: String, default: '' }, // 렌트 기간 일수
  remainingPeriodCalc: { type: String, default: '' }, // 남은 기간 계산
  contractNo: { type: String, default: '' }, // 계약번호

  // 3. 차량가격 및 등록 제비용
  basePrice: { type: Number, default: 0 }, // 기본가격
  discountAmount: { type: Number, default: 0 }, // 할인금액
  supplyAmount: { type: Number, default: 0 }, // 공급가액
  consignmentFee: { type: Number, default: 0 }, // 탁송료
  mandatoryInsuranceFee: { type: Number, default: 0 }, // 의무보험료
  acquisitionTax: { type: Number, default: 0 }, // 취득세
  bond: { type: Number, default: 0 }, // 공채
  stampFee: { type: Number, default: 0 }, // 증지대
  plateFee: { type: Number, default: 0 }, // 번호판대
  regAgencyFee: { type: Number, default: 0 }, // 등록대행료
  commission: { type: Number, default: 0 }, // 수수료
  dashcam: { type: String, default: '' }, // 블랙박스
  dashcamInfo: { type: String, default: '' }, // 블랙박스 정보
  tinting: { type: String, default: '' }, // 선팅
  tintingInfo: { type: String, default: '' }, // 선팅정보
  regCost1: { type: Number, default: 0 }, // 등록비용
  regCost2: { type: Number, default: 0 }, // 등록비용2

  // 4. 보험 & 정비 정보
  insuranceCompany: { type: String, default: '삼성화재' }, // 보험 회사
  insuranceStartDate: { type: String, default: '' }, // 보험가입일
  insuranceFee: { type: Number, default: 0 }, // 보험료
  ownCarInsuranceFee: { type: Number, default: 0 }, // 자차 보험비
  tire: { type: String, default: '' }, // 타이어
  regularCheckup: { type: String, default: '' }, // 정기점검
  driverAge: { type: String, default: '만 26세 이상' }, // 운전자 연령
  personalInjury1: { type: String, default: '무제한' }, // 대인
  propertyDamage: { type: String, default: '1억원' }, // 대물
  personalInjury2: { type: String, default: '1억원' }, // 자손
  uninsuredCarInjury: { type: String, default: '2억원' }, // 무보험차상해
  deductible: { type: Number, default: 300000 }, // 고객부담금
  insuranceType: { type: String, default: '임직원특약' }, // 보험종류
  emergencyService: { type: String, default: '가입' }, // 긴급출동
  accidentRepair: { type: String, default: '' }, // 사고수리
  generalMaintenance: { type: String, default: '' }, // 일반정비
  consumablesExchange: { type: String, default: '' }, // 소모품교환
  tireCount: { type: String, default: '' }, // 타이어 본수
  tireType: { type: String, default: '' }, // 타이어
  tireCost: { type: Number, default: 0 }, // 타이어비용
  carTax: { type: String, default: '포함' }, // 자동차세

  // 5. 금융 & 납입/할부 정보
  lender: { type: String, default: '' }, // 차용처
  executionDate: { type: String, default: '' }, // 실행일
  installmentAmount: { type: Number, default: 0 }, // 할부이용금액
  installmentPeriod: { type: String, default: '' }, // 기간
  monthlyInstallment: { type: Number, default: 0 }, // 월할부금
  totalMonthlyInstallment: { type: Number, default: 0 }, // 월할부금 계
  totalInterest: { type: Number, default: 0 }, // 총이자
  interestRate: { type: String, default: '' }, // 이자
  monthlyFeePayDay: { type: String, default: '매월 25일' }, // 월 대여료 결제일
  invoiceDate: { type: String, default: '' }, // 계산서발행일
  monthlyPayment: { type: Number, default: 0 }, // 월 납입금
  paymentPeriod: { type: String, default: '36' }, // 기간
  totalMonthlyPayment: { type: Number, default: 0 }, // 월 납입금 계
  deposit: { type: Number, default: 0 }, // 보증금
  advancePayment: { type: Number, default: 0 }, // 선수금
  acquisitionValue: { type: Number, default: 0 }, // 인수가
  residualRateP: { type: String, default: '' }, // P
  interest2: { type: String, default: '' }, // 이자
  fineEmail: { type: String, default: '' }, // 범칙금 E-MAIL
  managerMobile: { type: String, default: '' }, // 담당자 휴대전화번호
  sellingAdminExpense: { type: Number, default: 0 }, // 판관비

  // 6. 사은품 & 영업/딜러 정보
  gift1: { type: String, default: '' }, // 사은품1
  gift1Price: { type: Number, default: 0 }, // 사은품1_가격
  gift2: { type: String, default: '' }, // 사은품2
  gift2Price: { type: Number, default: 0 }, // 사은품2_가격
  gift3: { type: String, default: '' }, // 사은품3
  gift3Price: { type: Number, default: 0 }, // 사은품3_가격
  gift4: { type: String, default: '' }, // 사은품4
  gift4Price: { type: Number, default: 0 }, // 사은품4_가격
  gift5: { type: String, default: '' }, // 사은품5
  gift5Price: { type: Number, default: 0 }, // 사은품5_가격
  totalGiftPrice: { type: Number, default: 0 }, // 사은품가격
  dealerCompany: { type: String, default: '' }, // 딜러사
  salesRepresentative: { type: String, default: '' }, // 담당영업사원
  showroom: { type: String, default: '' }, // 전시장
  accountHolder: { type: String, default: '' }, // 예금주명
  bank: { type: String, default: '' }, // 은행
  accountNo: { type: String, default: '' }, // 계좌
  bizOrRegNo: { type: String, default: '' }, // 사업자/주민번호
  bizAddress: { type: String, default: '' }, // 사업자 주소
  penaltyRate: { type: String, default: '' }, // 위약금률
  overdueInterestRate: { type: String, default: '' }, // 연체이율
  corporateRegNo: { type: String, default: '' }, // 법인/식별번호
  individualConsumptionTax: { type: Number, default: 0 }, // 개별소비세(교육세,가산세포함)

  status: { 
    type: String, 
    enum: ['rented', 'available', 'maintenance', 'reserved'], 
    default: 'rented' 
  }, // 운용 상태
  
  notes: { type: String, default: '' }
}, { timestamps: true });

// Search Index
VehicleSchema.index({ 
  carNumber: 'text', 
  carModel: 'text', 
  contractCompany: 'text',
  manager: 'text',
  practicalManager: 'text',
  contractNo: 'text'
});

const Vehicle = mongoose.model('Vehicle', VehicleSchema);

export default Vehicle;
