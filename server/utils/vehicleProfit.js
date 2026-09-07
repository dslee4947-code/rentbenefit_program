/**
 * 차량 한 대의 영업이익 계산.
 *
 * 견적서 화면(QuoteInputView의 calculateOptionValues)이 쓰는 식을 그대로 옮겼다.
 * 견적서는 "월 렌트료를 정하면 이익이 얼마"를 계산하는데, 렌트차량 DB에는 이미 월 렌트료가
 * 저장돼 있으므로 같은 식의 '월 렌트료 직접 입력' 갈래를 쓴다.
 *
 *   매출 = 월 렌트료 x 개월수 + 인수가 + 선수금
 *   원가 = 보험료(기본+자차) + 자동차세 + 할부 시 총구입가 + 등록비용 + 판관비 + 딜러수수료
 *          (정비 가입이면 정비비·타이어비 추가)
 *   이익금 = 매출 - 원가          <- 모든 비용을 뺀 뒤 회사에 남는 금액
 *   이익률 = 이익금 / 차량가       <- 화면의 '회사수수료' 칸에 %로 들어간다
 *
 * 차량 DB에 실제 값이 있으면 그 값을 쓰고, 없는 항목만 견적서 기본값으로 채운다.
 * 어떤 값을 가정했는지는 결과의 assumptions에 남긴다. 가정을 모르면 숫자를 믿을 수 없다.
 */

/** 원리금 균등상환 월 납입액. 엑셀 PMT와 같다. */
const PMT = (rate, nper, pv) => {
  if (!nper) return 0;
  if (rate === 0) return -pv / nper;
  const pvif = Math.pow(1 + rate, nper);
  return (rate * pv * pvif) / (1 - pvif);
};

/** 견적서 기본값. 차량에 값이 없을 때만 쓴다. */
export const QUOTE_DEFAULTS = {
  baseInterestRate: 0.06,        // 기준 금리
  commissionRate: 0.03,          // 회사수수료율
  dealerCommissionRate: 0,       // 타딜러수수료율
  insuranceFeeAnnual: 800000,    // 대인·대물 등 기본 보험료(연)
  registrationAgencyFee: 100000, // 등록대행료
  pandanbiRate: 0.03,            // 판관비율
  monthlyMaintenanceFee: 50000,  // 월 정비비
  tireUnitCost: 160000,          // 타이어 1본 단가
  annualMileage: 20000           // 연간 주행거리(정비 타이어 본수 계산용)
};

const num = (value) => {
  if (value === '' || value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const has = (value) => value !== '' && value !== null && value !== undefined && Number(value) !== 0;

/** 기간에 따라 금리에 얹는 가산율 (견적서 E14) */
const addedRateFor = (termMonths) => {
  if (termMonths <= 12) return 0.0031;
  if (termMonths <= 24) return 0.0025;
  if (termMonths <= 36) return 0.0019;
  if (termMonths <= 48) return 0.0014;
  return 0.0010;
};

/** 자차보험료율 (견적서 E24) - 공급가액이 클수록 낮아진다 */
const ownCarInsuranceRate = (netVehiclePrice) => {
  if (netVehiclePrice <= 10000000) return 0.022;
  if (netVehiclePrice >= 500000000) return 0.012;
  return 0.017 - (netVehiclePrice - 10000000) * (0.01 / (500000000 - 10000000));
};

/** 배기량 기준 연간 자동차세 (견적서 E25) */
const annualCarTax = (cc) => {
  const engine = num(cc);
  if (engine <= 0) return 20000;
  if (engine <= 1600) return engine * 18;
  if (engine <= 2500) return engine * 19;
  return engine * 24;
};

/**
 * @param {object} vehicle 차량 문서(lean)
 * @param {number} termMonths 렌트 기간(개월). 차량에 없으면 계약에서 가져와 넘긴다.
 * @param {object} [overrides] 기본값을 바꿔 쓰고 싶을 때
 * @returns {object|null} 계산에 필요한 값이 없으면 reason과 함께 돌려준다
 */
export const calculateVehicleProfit = (vehicle, termMonths, overrides = {}) => {
  const defaults = { ...QUOTE_DEFAULTS, ...overrides };
  const assumptions = [];

  const totalCarPrice = num(vehicle.carPrice) + num(vehicle.optionPrice);
  const months = num(termMonths);

  if (!totalCarPrice) return { ok: false, reason: '차량가가 없습니다' };
  if (!months) return { ok: false, reason: '렌트 기간(개월)을 알 수 없습니다' };
  if (!has(vehicle.monthlyFee)) return { ok: false, reason: '월 렌트료가 없습니다' };

  const years = months / 12;

  // 공급가액 = 차량가 + 옵션가 + 탁송료 - 할인금액
  const netVehiclePrice = totalCarPrice + num(vehicle.deliveryFee) - num(vehicle.discount);

  // 등록비용 - 차량에 실제 값이 있으면 그것이 정본이고, 없으면 견적서 식으로 낸다
  let acquisitionTax = num(vehicle.acquisitionTax);
  if (!acquisitionTax) {
    acquisitionTax = Math.floor(((netVehiclePrice / 1.1) * 0.04) / 10) * 10;
    assumptions.push('취득세: 공급가액 기준으로 계산');
  }
  let publicBond = num(vehicle.publicBond);
  if (!publicBond) {
    publicBond = Math.floor(((netVehiclePrice / 1.1) * 0.03 * 0.16) / 10) * 10;
    assumptions.push('공채: 공급가액 기준으로 계산(면제 아님으로 봄)');
  }
  let registrationAgencyFee = num(vehicle.registrationAgencyFee);
  if (!registrationAgencyFee) {
    registrationAgencyFee = defaults.registrationAgencyFee;
    assumptions.push(`등록대행료: ${defaults.registrationAgencyFee.toLocaleString()}원`);
  }

  // 보험료 - 차량에는 보험 조건만 있고 금액이 없어 견적서 기준을 쓴다
  const insuranceFeeAnnual = defaults.insuranceFeeAnnual;
  assumptions.push(`기본 보험료: 연 ${insuranceFeeAnnual.toLocaleString()}원`);
  const ownCarInsuranceFee = netVehiclePrice * ownCarInsuranceRate(netVehiclePrice);

  // 자동차세 - 차량에 계약 기간 전체 합계가 있으면 그걸 쓰고, 없으면 배기량으로 낸다
  let carTaxTotal = num(vehicle.individualConsumptionTax);
  if (!carTaxTotal) {
    carTaxTotal = annualCarTax(vehicle.cc) * years;
    assumptions.push('자동차세: 배기량 기준으로 계산');
  }

  const deposit = num(vehicle.deposit);
  const advancePayment = num(vehicle.advancePayment);
  const takeoverPrice = num(vehicle.takeoverPrice);

  // 조달 원가
  const fundingPrincipal = netVehiclePrice - deposit - advancePayment
    + acquisitionTax + publicBond + insuranceFeeAnnual + ownCarInsuranceFee;

  let baseInterestRate = num(vehicle.interestRate) ? num(vehicle.interestRate) / 100 : 0;
  if (!baseInterestRate) {
    baseInterestRate = defaults.baseInterestRate;
    assumptions.push(`금리: 연 ${(defaults.baseInterestRate * 100).toFixed(1)}%`);
  }
  const interestRate = baseInterestRate + addedRateFor(months);

  const fundingInterest = PMT(interestRate / 12, months, -fundingPrincipal) * months - fundingPrincipal;
  const advancePaymentInterest = advancePayment * 0.03 * years;
  const totalBuyPriceWithFinancing = netVehiclePrice + fundingInterest + advancePaymentInterest;

  // 판관비는 차량가의 3%로 본다
  const pandanbi = totalCarPrice * defaults.pandanbiRate;
  assumptions.push(`판관비: 차량가의 ${(defaults.pandanbiRate * 100).toFixed(1)}%`);

  const dealerCommission = num(vehicle.dealerCommission) || totalCarPrice * defaults.dealerCommissionRate;

  // 정비 - 일반정비에 가입한 차량만 원가에 넣는다
  const maintenanceJoined = vehicle.maintenance?.generalMaintenance === '가입';
  let maintenanceFeeTotal = 0;
  let tireCostTotal = 0;
  if (maintenanceJoined) {
    maintenanceFeeTotal = defaults.monthlyMaintenanceFee * months;
    const annualMileage = num(vehicle.maintenance?.mileage) || defaults.annualMileage;
    tireCostTotal = Math.floor((annualMileage * years) / 60000) * 4 * defaults.tireUnitCost;
    assumptions.push(`정비비: 월 ${defaults.monthlyMaintenanceFee.toLocaleString()}원 · 타이어 ${defaults.tireUnitCost.toLocaleString()}원/본`);
  }

  // 회사수수료는 원가에 넣지 않는다.
  //
  // 견적서는 회사수수료를 원가로 빼고 이익률을 낼 때 다시 더한다(AD31). 결국 회사가 가져가는
  // 몫은 '수수료 + 영업이익'이고, 그게 여기서 구하려는 이익금이다. 두 번 세지 않도록 원가에서 뺀다.
  const totalCost = ((insuranceFeeAnnual + ownCarInsuranceFee) * years)
    + carTaxTotal
    + totalBuyPriceWithFinancing
    + registrationAgencyFee
    + publicBond
    + acquisitionTax
    + pandanbi
    + dealerCommission
    + maintenanceFeeTotal
    + tireCostTotal;

  const totalRevenue = (num(vehicle.monthlyFee) * months) + takeoverPrice + advancePayment;

  // 이익금 = 매출 - 원가 (모든 비용을 뺀 뒤 회사에 남는 금액)
  const profitAmount = totalRevenue - totalCost;
  // 이익률(회사수수료) = 이익금 / 차량가. 화면에는 %로 보여 주므로 100을 곱해 둔다.
  const profitRatePercent = (profitAmount / totalCarPrice) * 100;

  return {
    ok: true,
    termMonths: months,
    totalCarPrice,
    netVehiclePrice,
    totalRevenue,
    totalCost,
    profitAmount,
    profitRatePercent,
    assumptions
  };
};
