/**
 * 렌트 차량을 인수할 때 인수자가 이전등록하며 구청에 내는 취득세(예상).
 * 대표님 2026-11-17 "차량 등록일 기준으로 구청 과표로 내야 할 취득세도, 연장하면 연장 후 취득세도".
 *
 * 과세표준 = max(인수가, 시가표준액). 시가표준액(구청 과표) = 기준가격 × 경과연수별 잔가율(천 원 미만 버림).
 *   - 잔가율: 행정안전부 「기타물건 시가표준액 조정기준」 비영업용 승용자동차(내용연수 20년) 표.
 *     김해시 차량 시가표준액 안내(https://www.gimhae.go.kr/00610/00639/00689.web)에서 옮겼다.
 *   - 기준가격: 행안부 차종별 기준가격을 프로그램이 모르므로 신차 공급가(부가세 제외)로 추정한다.
 *     위택스에서 조회한 시가표준액을 넣으면 그 값으로 기준가격을 거꾸로 구해 연장 후에도 같은 비율로 센다.
 *   - 경과연수: 인수하는 해 - 최초등록 연도(연식 대신 등록 연도).
 * 세율: 비영업용 승용 7%, 경형(1,000cc 미만) 4%에 취득세 75만 원까지 감면(초과분만 낸다).
 * 공채 매입, 이전등록 대행료, 전기·하이브리드 감면은 넣지 않는다. 10원 미만은 버린다.
 */

// 경과연수 0(1년 미만) ~ 20년
export const RESIDUAL_RATES = Object.freeze({
  국산: [0.826, 0.725, 0.614, 0.518, 0.437, 0.368, 0.311, 0.262, 0.221, 0.186, 0.157, 0.132, 0.112, 0.094, 0.079, 0.067, 0.063, 0.060, 0.057, 0.053, 0.050],
  외산: [0.842, 0.729, 0.605, 0.500, 0.412, 0.340, 0.281, 0.232, 0.172, 0.142, 0.117, 0.097, 0.080, 0.066, 0.054, 0.050, 0.048, 0.046, 0.044, 0.042, 0.040]
});
export const LIGHT_CAR_CC = 1000;
export const LIGHT_CAR_EXEMPTION = 750000;

// 국내에서 만든 차(세금 잔가율의 '국산'). 제네시스도 국산이다(계약서 양식의 국산/외산 구분과 다르다)
const DOMESTIC = /(현대|기아|제네시스|Genesis|^G\d0|^GV\d0|그랜저|쏘나타|아반떼|아이오닉|코나|투싼|싼타페|팰리세이드|캐스퍼|스타리아|베뉴|넥쏘|포터|^K\d|레이|모닝|니로|셀토스|스포티지|쏘렌토|카니발|모하비|^EV\d|봉고|쌍용|KGM|토레스|렉스턴|티볼리|코란도|르노|QM6|XM3|SM6|아르카나|그랑\s*콜레오스|쉐보레|트레일블레이저|트랙스|말리부|스파크|Ray|Grander|Grandeur|Sonata|Avante|Casper|Palisade|Carnival|Sorento|Sportage|Mojave|Kona|Tucson|Staria|Niro|Seltos)/i;
export const taxOriginOf = (model) => (DOMESTIC.test(String(model || '').trim()) ? '국산' : '외산');

const yearOf = (v) => {
  if (!v) return null;
  const s = typeof v === 'string' && /^\d{4}/.test(v) ? v : new Date(new Date(v).getTime() + 9 * 3600 * 1000).toISOString();
  return Number(s.slice(0, 4)) || null;
};

/**
 * @param {object} p
 *   registrationDate 최초등록일, onDate 인수하는 날, model 차종, cc 배기량,
 *   newCarPrice 신차가격(부가세 포함), takeoverPrice 인수가(신고가액),
 *   standardValueNow 위택스 조회 시가표준액(있으면), standardYear 그 조회값의 연도
 * @returns {null | {years, rate, origin, basePrice, standardValue, taxBase, basis, light, grossTax, exemption, tax}}
 */
export const acquisitionTaxOf = ({ registrationDate, onDate, model, cc, newCarPrice, takeoverPrice = 0, standardValueNow, standardYear }) => {
  const regYear = yearOf(registrationDate);
  const year = yearOf(onDate);
  if (!regYear || !year) return null;
  const origin = taxOriginOf(model);
  const table = RESIDUAL_RATES[origin];
  const residual = (y) => table[Math.min(table.length - 1, Math.max(0, y - regYear))];
  const rate = residual(year);
  // 조회값이 있으면 그 해 잔가율로 나눠 기준가격을 구한다. 없으면 신차 공급가
  const looked = Number(standardValueNow) || 0;
  const basePrice = looked > 0 ? looked / residual(yearOf(standardYear) || year) : (Number(newCarPrice) || 0) / 1.1;
  if (!(basePrice > 0)) return null;
  const standardValue = Math.floor((basePrice * rate) / 1000) * 1000;
  const declared = Number(takeoverPrice) || 0;
  const taxBase = Math.max(declared, standardValue);
  const light = Number(cc) > 0 && Number(cc) < LIGHT_CAR_CC;
  const grossTax = Math.floor((taxBase * (light ? 0.04 : 0.07)) / 10) * 10;
  const exemption = light ? Math.min(grossTax, LIGHT_CAR_EXEMPTION) : 0;
  return {
    years: Math.min(table.length - 1, Math.max(0, year - regYear)),
    year,
    rate,
    origin,
    basePrice: Math.round(basePrice),
    standardValue,
    taxBase,
    basis: declared >= standardValue ? '인수가' : '시가표준액',
    light,
    grossTax,
    exemption,
    tax: grossTax - exemption,
    looked: looked > 0
  };
};
