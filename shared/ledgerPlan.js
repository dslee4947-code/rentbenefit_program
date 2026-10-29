/**
 * 원장 '계약 손익 기준표'에 들어가는 값(견적 비용).
 *
 * 화면(수익성 검토)과 서버(기준표 저장)가 같은 값을 써야 해서 여기 둔다.
 * 서버는 이 값을 갑지에 저장해 두고, 화면은 저장된 값이 있으면 그걸 쓴다.
 */
import { calculateQuoteOption } from './quoteCalc.js';
import { GRADE_LABEL } from './maintenanceRates.js';

/**
 * 견적서에서 이 차의 계산 결과를 꺼낸다.
 *
 * 견적서에는 계산 결과가 아니라 입력값(comparisonVehicles)이 저장돼 있어서 견적 화면과 같은 식으로
 * 다시 계산한다. 비교 차량이 여러 대면 견적서를 저장할 때 보고 있던 차(activeVehicleId)를,
 * 안이 여러 개면 계약한 기간(pricing.paymentTerm)과 같은 안을 고른다.
 */
export const quotePlanOf = (quote) => {
  const vehicles = quote?.comparisonVehicles || [];
  if (!vehicles.length) return null;
  const vehicle = vehicles.find((v) => v.id === quote.activeVehicleId) || vehicles[0];
  const options = vehicle.options || [];
  const term = Number(quote.pricing?.paymentTerm) || 0;
  const selectedId = (vehicle.selectedOptionIds || [])[0];
  const opt = options.find((o) => term && Math.round(Number(o.termYears) * 12) === term)
    || options.find((o) => o.id === selectedId)
    || options[0];
  if (!opt) return null;
  try {
    const calc = calculateQuoteOption(opt, vehicle);
    const years = Number(opt.termYears) || 0;
    const maintenanceOn = opt.isMaintenanceEnabled !== undefined ? opt.isMaintenanceEnabled !== false : vehicle.isMaintenanceEnabled !== false;
    return {
      months: Math.round(years * 12),
      baseInsurance: (Number(vehicle.globalInsuranceFee) || 0) * years,
      ownCarInsurance: (calc.ownCarInsuranceFee || 0) * years,
      pandanbi: calc.pandanbi || 0,
      benefitFee: calc.companyCommission || 0,
      // 견적서마다 수수료율이 다르다(대부분 3%, 1.5%인 차도 있다). 예상 수익금에 몇 %로 뺐는지 보여 준다
      benefitRate: Number(vehicle.commissionRateP) || 0,
      maintenanceOn,
      maintenanceFee: calc.maintenanceFeeTotal || 0,
      tireFee: calc.tireCostTotal || 0,
      // 정비 항목별 계획(횟수 × 단가)과 타이어 본수, 차종 등급
      maintenanceLines: calc.maintenanceLines || [],
      tireCount: calc.tireCount || 0,
      gradeLabel: GRADE_LABEL[vehicle.vehicleGrade] || '',
      // 차 구입·등록·금융·세금. 원장의 실제 출금과 맞대 본다.
      netVehiclePrice: calc.netVehiclePrice || 0,
      registrationCost: calc.registrationCost || 0,
      fundingInterest: calc.fundingInterest || 0,
      // 계약 기간 총 이자를 어떻게 냈는지 보여 주는 값(예상 수익금 칸)
      fundingPrincipal: calc.fundingPrincipal || 0,
      interestRate: calc.interestRate || 0,
      grossFundingInterest: calc.grossFundingInterest || 0,
      depositInterestBenefit: calc.depositInterestBenefit || 0,
      advancePaymentInterest: calc.advancePaymentInterest || 0,
      fundingRepaymentMode: calc.fundingRepaymentMode,
      carTaxTotal: calc.carTaxTotal || 0,
      // 견적 원가에는 베네핏 수수료가 들어 있다. 수수료도 회사 몫이라 예상 이익에서는 원가에서 빼고 본다.
      costExCommission: (calc.totalCost || 0) - (calc.companyCommission || 0),
      quoteMonthlyRent: calc.monthlyLeaseFee || 0,
      takeoverPrice: calc.takeoverPrice || 0,
      advancePayment: calc.advancePayment || 0
    };
  } catch {
    return null;
  }
};

/**
 * 거래완료 차의 보증금이 인수가와 상계된 것인지(대표님 2026-10-28).
 *
 * 만기에 고객이 차를 인수할 때 보증금을 인수가와 상계하면 돈이 오가지 않아 원장에 '인수가'·'보증금 반환' 줄이 생기지 않고
 * 보증금만 남는다(Benz-018: 보증금 42,330,000 = 차량가 30%). 거래완료인데 인수가 입금 줄이 없고 보증금이 남아 있으면
 * 그 보증금을 인수가로 본다. 그러면 '돌려줄 돈'이 아니므로 정산계에서 빼지 않는다.
 * @param {string} status 갑지 상태
 * @param {Array} entries 갑지 줄 전체
 * @param {number} depositHeld 보관 중인 보증금
 */
export const isDepositOffsetTakeover = (status, entries, depositHeld) => status === '거래완료'
  && Number(depositHeld) > 0
  && !(entries || []).some((e) => e.side === '입금' && e.category === '인수가' && Number(e.amount) > 0);

/** 계약 기간 총 이자 = 원리금 균등상환 조달이자 − 보증금 이자 이득 + 선수금분 이자 */
export const planInterestTotal = (plan) => Math.max(0, (Number(plan?.fundingInterest) || 0) + (Number(plan?.advancePaymentInterest) || 0));

/** 기준표의 매출 = 견적 월 렌트료 × 개월 + 인수가 + 선납금 */
export const planRevenue = (plan) => (Number(plan?.quoteMonthlyRent) || 0) * (Number(plan?.months) || 0)
  + (Number(plan?.takeoverPrice) || 0) + (Number(plan?.advancePayment) || 0);
