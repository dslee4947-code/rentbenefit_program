/**
 * 계약구분(법인 / 개인사업자 / 일반개인) 판단 규칙.
 *
 * 엑셀 업로드(vehicleController)와 이미 들어간 자료를 고치는 마이그레이션이 같은 규칙을 써야
 * "업로드할 때와 고칠 때가 다르게 판단하는" 일이 생기지 않으므로 한 곳에 둔다.
 *
 * 셋으로 나누는 이유: 사업자번호가 있는 개인사업자와, 사업자 없이 개인 명의로 쓰는 계약자는
 * 청구서·세금계산서가 서로 다르게 나간다. 예전처럼 '개인' 하나로 묶으면 구분이 되지 않는다.
 */

export const PARTY_TYPES = ['법인', '개인사업자', '일반개인'];

// 상호에 이런 표기가 있으면 법인으로 본다. 개인사업자는 상호에 이런 표기를 쓸 수 없다.
// '법인'은 그 자체로 넣는다. 세무법인·법무법인·회계법인·재단법인처럼 앞에 붙는 말이 다양해
// 하나씩 적으면 빠지는 곳이 생긴다(천지세무법인이 개인사업자로 판정되던 문제).
export const CORPORATE_NAME_PATTERN = /(주식회사|유한회사|유한책임회사|합자회사|합명회사|㈜|\(주\)|㈔|\(유\)|법인)/;

/**
 * 상호와 번호로 계약구분을 정한다. 엑셀에 계약구분이 적혀 있으면 그 값을 먼저 쓴다.
 *
 * 법인등록번호는 법인에만 나오는 번호라 있으면 법인으로 본다.
 * 사업자번호는 개인사업자에게도 나오므로 법인 판단에는 쓰지 않고, 개인사업자와 일반개인을
 * 가르는 데만 쓴다.
 *
 * @param {string} companyName 상호 또는 계약자명
 * @param {{ bizNo?: string, corporateRegistrationNo?: string }} [numbers]
 * @returns {'법인'|'개인사업자'|'일반개인'}
 */
export const inferPartyType = (companyName, numbers = {}) => {
  if (numbers.corporateRegistrationNo) return '법인';
  if (CORPORATE_NAME_PATTERN.test(String(companyName || ''))) return '법인';
  return numbers.bizNo ? '개인사업자' : '일반개인';
};

/**
 * 사람이 적어 넣은 계약구분을 셋 중 하나로 맞춘다.
 *
 * 예전에 쓰던 '개인'은 사업자번호가 있으면 개인사업자, 없으면 일반개인으로 나눈다.
 * 알아볼 수 없는 값이면 null을 돌려주고, 부르는 쪽에서 상호를 보고 판단하게 한다.
 */
export const normalizePartyType = (raw, numbers = {}) => {
  const text = String(raw ?? '').replace(/\s/g, '');
  if (!text) return null;
  if (text.startsWith('법인')) return '법인';            // 법인 / 법인사업자
  if (text.includes('개인사업자')) return '개인사업자';
  if (text.startsWith('일반')) return '일반개인';        // 일반개인
  if (text.startsWith('개인')) return numbers.bizNo ? '개인사업자' : '일반개인';
  return null;
};

/** 계약구분에 맞는 법인 구분(Company.bizType). */
export const bizTypeFor = (partyType, { bizNo } = {}) => {
  if (partyType === '법인') return '법인사업자';
  if (partyType === '개인사업자') return '개인사업자';
  return bizNo ? '개인사업자' : '개인';
};
