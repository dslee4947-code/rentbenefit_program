/**
 * 장기렌트 견적 계산식.
 *
 * 견적 작성 화면(QuoteInputView)에 있던 식을 그대로 옮겼다. 차량 손익 원장의 수익성 검토도
 * 견적서에 저장된 입력값으로 이 식을 다시 돌려 "견적 때 잡아 둔 비용"을 꺼낸다.
 * 두 화면이 같은 함수를 써야 견적서와 원장의 숫자가 어긋나지 않는다.
 */

// Financial PMT Function (matching Excel PMT). fv는 만기에 남기는 잔액(엑셀 PMT의 넷째 인자)
export function PMT(rate, nper, pv, fv = 0) {
  if (rate === 0) return -(pv + fv) / nper;
  const pvif = Math.pow(1 + rate, nper);
  return (rate * (pv * pvif + fv)) / (1 - pvif);
}

// 엑셀 RATE와 같은 기간 수익률. 뉴턴법으로 풀고, 답이 없으면 null을 돌려준다.
export function RATE(nper, pmt, pv, fv = 0, guess = 0.003) {
  let rate = guess;
  for (let i = 0; i < 100; i++) {
    const pvif = Math.pow(1 + rate, nper);
    const value = pv * pvif + (pmt * (pvif - 1)) / rate + fv;
    const dPvif = nper * Math.pow(1 + rate, nper - 1);
    const slope = pv * dPvif + (pmt * (dPvif * rate - (pvif - 1))) / (rate * rate);
    const next = rate - value / slope;
    if (!Number.isFinite(next) || next <= -1) return null;
    if (Math.abs(next - rate) < 1e-10) return next;
    rate = next;
  }
  return null;
}

// 조달 상환방식 (엑셀 ver4 118행).
// equal: 원리금 균등상환. 매달 같은 금액을 내고 만기에 남는 원금이 없다.
// balloon: 만기에 '인수가 − 보증금'만큼 원금을 남겨 두고 인수가로 갚는다. 인수가가 높을수록 원금이 늦게 줄어 이자가 늘어난다.
// 기본값은 원리금 균등상환이다. 실제 대출(메리츠캐피탈 2건)을 역산하면 만기 잔액 없이 다 갚는 구조였다(2026-09-27 검토).
// 만기 인수가 상환은 잔가(유예)형 대출로 들여오는 차에만 고른다.
export const FUNDING_REPAYMENT_MODES = {
  equal: '원리금 균등상환',
  balloon: '만기 인수가 상환'
};
export const DEFAULT_FUNDING_REPAYMENT_MODE = 'equal';

// 선수금분이자율(연). 선수금으로 아끼는 조달이자(연 2.9~3.3%)와 거의 같은 중립값이다(2026-09-27 검토).
// 이보다 낮추면 아낀 이자를 고객에게 나눠 주는 셈이고, 3.3%를 넘기면 선수금을 받을수록 손해다.
export const ADVANCE_PAYMENT_INTEREST_RATE = 0.03;

// 고잔가(인수가 연동) 수수료 요율: 일반잔가 상한을 넘는 인수가율 1%p마다 차량가의 0.107% (엑셀 ver4 115행).
// 신한캐피탈이 고잔가 전환 때 차량가 1.5%를 한 번에 물리는 것을 잔가 확대폭 14%p로 나눠 편 값이다.
export const DEFAULT_HIGH_RESIDUAL_FEE_RATE_PER_POINT = 0.00107;

export const defaultMaintenanceItems = [
  { name: '엔진오일', cycle: '7,000~8,000km', desc: '오일필터+에어 클리너', price: 200000, checked: true },
  { name: '에어컨 향균필터', cycle: '15,000~20,000km 또는 1년 도래시', desc: '향균필터', price: 40000, checked: true },
  { name: '와이퍼', cycle: '1년 도래시', desc: '-', price: 25000, checked: true },
  { name: '에어컨 가스', cycle: '1년 도래시', desc: '부족할 시', price: 250000, checked: true },
  { name: '타이어 위치 교환', cycle: '20,000km', desc: '타이어 로테이션 + 휠 밸런스', price: 100000, checked: true },
  { name: '타이어 공기압 보충', cycle: '매 점검시', desc: '-', price: 0, checked: true },
  { name: '타이어 교체', cycle: '50,000~70,000km', desc: '타이어*마모 한계선 도래 시 교체', price: 600000, checked: true },
  { name: '연료 필터', cycle: '40,000km', desc: '-', price: 60000, checked: true },
  { name: '앞 브레이크 패드 / 라이닝', cycle: '40,000km 또는 마모 시', desc: '앞 디스크 브레이크 패드', price: 150000, checked: true },
  { name: '뒤 브레이크 패드 / 라이닝', cycle: '70,000km 또는 마모 시', desc: '뒤 브레이크 라이닝', price: 150000, checked: true },
  { name: '오일류', cycle: '50,000~60,000km', desc: '변속기/브레이크/파워오일', price: 150000, checked: true },
  { name: '밸브류', cycle: '50,000km', desc: '에어컨/파워/팬 벨트', price: 200000, checked: true },
  { name: '전구류', cycle: '필요시', desc: '라이트/안개', price: 50000, checked: true },
  { name: '베터리', cycle: '80,000~100,000km', desc: '베터리', price: 200000, checked: true },
  { name: '점화플러그', cycle: '일반 40,000km / 백금 100,000km', desc: '점화 플러그, 배선', price: 50000, checked: true },
  { name: '타이밍벨트/워터펌프', cycle: '80,000~90,000km', desc: '타이밍 벨트 세트', price: 267450, checked: true },
  { name: '부동액', cycle: '100,000km 또는 필요시', desc: '부동액', price: 50000, checked: true },
  { name: '기타 보충', cycle: '수시', desc: '-', price: 0, checked: true }
];

export const getCalculatedMaintenanceFee = (opt, vehicle) => {
  if (!opt || !vehicle) return 50000;
  
  const rawItems = opt.maintenanceItems || vehicle.maintenanceItems || defaultMaintenanceItems;
  const totalMileage = (opt.termYears || 4) * (opt.mileage || 20000);
  const computedTireCount = Math.floor(totalMileage / 60000) * 4;
  const computedTireCost = computedTireCount * (opt.tireUnitCost || 150000);
  
  const totalSum = rawItems
    .filter(item => item.checked)
    .reduce((sum, item) => {
      if (item.name === '타이어 교체') {
        return sum + computedTireCost;
      }
      return sum + (item.price || 0);
    }, 0);
    
  const termMonths = (opt.termYears || 4) * 12;
  if (termMonths <= 0) return 0;
  
  return Math.floor((totalSum / termMonths) / 1000) * 1000;
};

/**
 * 견적 한 안(opt)의 원가·렌트료·이익을 계산한다.
 * vehicle은 견적 화면의 차량 상태(견적서 comparisonVehicles에 저장되는 값)다.
 */
export const calculateQuoteOption = (opt, vehicle) => {
  if (!opt || !vehicle) return {
    totalCarPrice: 0,
    discountAmount: 0,
    netVehiclePrice: 0,
    acquisitionTax: 0,
    publicBond: 0,
    ownCarInsuranceFee: 0,
    carTaxAnnual: 0,
    deposit: 0,
    advancePayment: 0,
    fundingPrincipal: 0,
    interestRate: 0,
    fundingInterest: 0,
    advancePaymentInterest: 0,
    monthlyInstallmentSum: 0,
    monthlyInstallment: 0,
    totalBuyPriceWithFinancing: 0,
    dealerCommission: 0,
    companyCommission: 0,
    pandanbi: 0,
    tireCostTotal: 0,
    maintenanceFeeTotal: 0,
    totalCost: 0,
    takeoverPrice: 0,
    monthlyLeaseFee: 0,
    profitMargin: 0,
    profitRate: 0,
    fundingRepaymentMode: DEFAULT_FUNDING_REPAYMENT_MODE,
    fundingBalloon: 0,
    generalResidualCap: null,
    highResidualFee: 0,
    businessIrr: null
  };

  const {
    carPrice,
    carOptionPrice,
    discountPrice,
    consignmentFee,
    isBondExempt,
    globalInsuranceFee,
    cc,
    baseInterestRate,
    dealerCommissionRateP,
    commissionRateP,
    isPandanbiEnabled,
    tireCount,
    monthlyMaintenanceFee,
    isMaintenanceEnabled,
    globalRegistrationAgencyFee
  } = vehicle;

  // 총 차량가격 = 차량가격 + 옵션가격
  const totalCarPrice = carPrice + carOptionPrice;
  
  // 할인/면세액
  const discountAmount = discountPrice;
  
  // 차량가격 (11행: E11) -> 8번 결론식: 기본차량가 + 옵션가 - 할인가 + 탁송료
  const netVehiclePrice = carPrice + carOptionPrice - discountPrice + consignmentFee;
  
  // 취득세 (E21) -> ROUNDDOWN(E11/1.1*0.04, -1)
  const acquisitionTax = Math.floor(((netVehiclePrice / 1.1) * 0.04) / 10) * 10;
  
  // 공채 (E22) -> ROUNDDOWN(E11/1.1*3%*16%,-1) (면제 시 0)
  const publicBond = isBondExempt ? 0 : Math.floor(((netVehiclePrice / 1.1) * 0.03 * 0.16) / 10) * 10;
  
  // 자차보험비 (E24) -> E7(netVehiclePrice) 기준으로 계산
  let ownCarRate;
  if (netVehiclePrice <= 10000000) {
    ownCarRate = 0.022;
  } else if (netVehiclePrice >= 500000000) {
    ownCarRate = 0.012;
  } else {
    ownCarRate = 0.017 - (netVehiclePrice - 10000000) * (0.01 / (500000000 - 10000000));
  }
  // 기존의 ceilingCarPrice(천만 원 단위 올림) 곱하기 방식 대신, 실제 차량 공급가액(netVehiclePrice)을 기준으로 계산하여 역전 현상을 해결합니다.
  const ownCarInsuranceFee = netVehiclePrice * ownCarRate;
  
  // 자동차세 (E25) -> 배기량(cc) 기준 IF 조건 적용
  let carTaxAnnual = 20000;
  if (cc <= 0 || !cc) {
    carTaxAnnual = 20000;
  } else if (cc <= 1600) {
    carTaxAnnual = cc * 18;
  } else if (cc <= 2500) {
    carTaxAnnual = cc * 19;
  } else if (cc > 2500) {
    carTaxAnnual = cc * 24;
  } else {
    carTaxAnnual = 20000;
  }
  
  // 보증금 (E38) 및 선수금 (E40) -> 천단위 미만 버림
  const deposit = Math.floor((totalCarPrice * opt.depositRate) / 1000) * 1000;
  const advancePayment = Math.floor((totalCarPrice * opt.advancePaymentRate) / 1000) * 1000;
  
  // 조달원금 (E13)
  const fundingPrincipal = netVehiclePrice - deposit - advancePayment + acquisitionTax + publicBond + globalInsuranceFee + ownCarInsuranceFee;
  
  // 이자부담율 (E14)
  const termMonths = Math.round(Number(opt.termYears) * 12);
  let addedRate = 0.014;
  if (termMonths <= 12) addedRate = 0.0031;
  else if (termMonths <= 24) addedRate = 0.0025;
  else if (termMonths <= 36) addedRate = 0.0019;
  else if (termMonths <= 48) addedRate = 0.0014;
  else addedRate = 0.0010;
  const interestRate = baseInterestRate + addedRate;
  
  const rentPeriodMonths = opt.termYears * 12; // E32

  // 인수가 (E36) -> 천단위 미만 버림
  const takeoverPrice = Math.floor((totalCarPrice * opt.residualRate) / 1000) * 1000;

  // 조달이자 (E15, 엑셀 ver4 '인수가 연동')
  // 만기 인수가 상환이면 만기에 '인수가 − 보증금'만큼 원금이 남는다(E77). 그만큼 원금이 늦게 줄어 이자가 붙는다.
  // 엑셀은 보증금이 인수가보다 크면 이 값이 음수가 되어 오히려 균등상환보다 이자가 적게 나오는데,
  // 원금을 기간보다 빨리 갚는 대출은 없으므로 0 아래로 내려가지 않게 막는다.
  const fundingRepaymentMode = vehicle.fundingRepaymentMode || DEFAULT_FUNDING_REPAYMENT_MODE;
  const fundingBalloon = fundingRepaymentMode === 'balloon' ? Math.max(0, takeoverPrice - deposit) : 0;
  const fundingInterest = PMT(interestRate / 12, rentPeriodMonths, -fundingPrincipal, fundingBalloon) * rentPeriodMonths + fundingBalloon - fundingPrincipal;
  
  // 선수금분이자 (E16)
  const advancePaymentInterest = advancePayment * ADVANCE_PAYMENT_INTEREST_RATE * opt.termYears;
  
  // 월할부금계 (E18)
  const monthlyInstallmentSum = fundingPrincipal + fundingInterest - advancePaymentInterest;
  
  // 월할부금 (E17)
  const monthlyInstallment = monthlyInstallmentSum / rentPeriodMonths;
  
  // 할부 시 총구입가 (E19)
  const totalBuyPriceWithFinancing = netVehiclePrice + fundingInterest + advancePaymentInterest;
  
  // 딜러 수수료 (AD6)
  const dealerCommission = totalCarPrice * dealerCommissionRateP;
  
  // 수수료 (AD2)
  const companyCommission = totalCarPrice * commissionRateP;
  
  // 판관비/노무비 (E28) - 글로벌 설정 기준
  const pandanbi = isPandanbiEnabled ? totalCarPrice * 0.03 : 0;
  
  // 동적 타이어 본수 계산 (6만km당 4본)
  const totalMileage = opt.termYears * opt.mileage;
  const computedTireCount = Math.floor(totalMileage / 60000) * 4;

  // 타이어 교체 비용 (AD13)
  const tireCostTotal = computedTireCount * opt.tireUnitCost;
  
  // 정기점검 비용 (AD16) - 옵션별 실시간 계산 적용 (1000원 단위 버림)
  const calculatedMaintenanceFee = getCalculatedMaintenanceFee(opt, vehicle);
  const maintenanceFeeTotal = calculatedMaintenanceFee * rentPeriodMonths;
  
  // 고잔가(인수가 연동) 수수료 (E147)
  // 인수가율이 일반잔가 상한을 넘으면, 넘은 %p마다 차량가의 일정 비율을 원가에 더한다. 10원 미만 버림.
  // 상한은 차종·기간·약정거리마다 달라(캐피탈 잔가군표) 견적 담당자가 넣는다. 비어 있으면 붙이지 않는다.
  const generalResidualCap = Number(vehicle.generalResidualCap) > 0 ? Number(vehicle.generalResidualCap) : null;
  const highResidualFeeRatePerPoint = Number(vehicle.highResidualFeeRatePerPoint ?? DEFAULT_HIGH_RESIDUAL_FEE_RATE_PER_POINT) || 0;
  const highResidualFee = generalResidualCap === null
    ? 0
    : Math.floor((Math.max(0, opt.residualRate - generalResidualCap) * 100 * highResidualFeeRatePerPoint * totalCarPrice) / 10) * 10;

  // 총구입원가 (E30) - 옵션별 정비 가입 여부 적용
  const optMaintenanceEnabled = opt.isMaintenanceEnabled !== undefined ? opt.isMaintenanceEnabled : isMaintenanceEnabled;
  let totalCost;
  const basicFees = ((globalInsuranceFee + ownCarInsuranceFee) * opt.termYears) + (carTaxAnnual * opt.termYears) + totalBuyPriceWithFinancing + globalRegistrationAgencyFee + publicBond + acquisitionTax + companyCommission + pandanbi + dealerCommission + highResidualFee;

  if (optMaintenanceEnabled) {
    totalCost = basicFees + maintenanceFeeTotal + tireCostTotal;
  } else {
    totalCost = basicFees;
  }

  // 최종 결과 계산 (월 렌트료 & 영업이익)
  let monthlyLeaseFee = 0;
  let profitMargin = 0;
  
  if (opt.calcMode === 'manual') {
    // 월 렌트료 직접 입력 모드
    monthlyLeaseFee = opt.monthlyFeeInput;
    const totalRevenue = (monthlyLeaseFee * rentPeriodMonths) + takeoverPrice + advancePayment;
    profitMargin = totalRevenue - totalCost;
  } else {
    // 영업이익 직접 입력 모드 (기본 계산식 등)
    profitMargin = opt.targetProfitInput;
    const targetRevenue = totalCost + profitMargin;
    const totalLeasePayments = targetRevenue - takeoverPrice - advancePayment;
    monthlyLeaseFee = Math.floor((totalLeasePayments / rentPeriodMonths) / 1000) * 1000; // 1000원 단위 절사
  }
  
  const profitRate = (profitMargin + companyCommission) / totalCarPrice; // AD31

  // 사업 IRR (연, 세전. 엑셀 ver4 76~78행)
  // 처음에 들어가는 돈 = 원가 − 조달이자 − 선수금분이자(금융비용은 빼고 본다) − 보증금 − 선수금(고객이 처음에 낸 돈)
  // 매달 들어오는 돈 = 월 렌트료, 만기에 들어오는 돈 = 인수가 − 보증금 반환
  // 엑셀은 선수금을 빼지 않아 선수금이 있는 견적의 IRR이 실제보다 크게 낮게 나온다(마이바흐 1안 −1.86% → 실제 5.55%).
  const businessInvestment = totalCost - fundingInterest - advancePaymentInterest - deposit - advancePayment;
  const businessIrrMonthly = (monthlyLeaseFee > 0 && businessInvestment > 0 && rentPeriodMonths > 0)
    ? RATE(rentPeriodMonths, monthlyLeaseFee, -businessInvestment, takeoverPrice - deposit)
    : null;
  const businessIrr = businessIrrMonthly === null ? null : businessIrrMonthly * 12;

  return {
    totalCarPrice,
    discountAmount,
    netVehiclePrice,
    acquisitionTax,
    publicBond,
    ownCarInsuranceFee,
    carTaxAnnual,
    deposit,
    advancePayment,
    fundingPrincipal,
    interestRate,
    fundingInterest,
    advancePaymentInterest,
    monthlyInstallmentSum,
    monthlyInstallment,
    totalBuyPriceWithFinancing,
    dealerCommission,
    companyCommission,
    pandanbi,
    tireCostTotal,
    maintenanceFeeTotal,
    totalCost,
    takeoverPrice,
    monthlyLeaseFee,
    profitMargin,
    profitRate,
    fundingRepaymentMode,
    fundingBalloon,
    generalResidualCap,
    highResidualFee,
    businessIrr
  };
};
