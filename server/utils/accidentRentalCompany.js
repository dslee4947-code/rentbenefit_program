import Company from '../models/Company.js';

/**
 * 단기렌트 차량(대차 차량)의 계약사.
 *
 * 단기렌트 차는 고객과 장기 계약을 맺고 내주는 차가 아니라, 우리가 번갈아 빌려주는 회사 차다.
 * 계약자가 따로 없으므로 계약사·대표자는 언제나 우리 회사로 고정한다.
 * 엑셀에 계약자가 적혀 있어도(차를 빌려 간 고객 이름이 적히곤 한다) 이 값이 이긴다.
 *
 * 차량 상태는 '단기렌트' 하나로 통일했다(2026-09). 사고대차는 "보험사에 청구하는 단기렌트"일 뿐
 * 돈을 받는 구조가 같고, 같은 차가 오늘은 사고대차·내일은 일반 단기렌트로 나간다.
 * 사고대차·단기렌트·무상대차의 구분은 차가 아니라 대여 한 건마다 RentalRecord.rentalType에 둔다.
 */
export const SHORT_TERM_RENTAL_STATUS = '단기렌트';
// 예전 차량 상태값. 서버가 켜질 때 dbMigration이 '단기렌트'로 바꾼다. 지난 마이그레이션 스크립트만 쓴다.
export const ACCIDENT_RENTAL_STATUS = '사고대차';
// 대차 차량으로 보는 상태. 배차 현황판이 이 상태의 차를 모은다.
export const RENTAL_FLEET_STATUSES = [SHORT_TERM_RENTAL_STATUS];
export const ACCIDENT_RENTAL_PARTY = { name: '렌트베네핏', ceoName: '이두식' };

/**
 * 대차 차량용 계약사 법인을 찾거나 만든다. 대표자는 항상 고정값으로 맞춘다.
 * @returns {Promise<import('mongoose').Document>}
 */
export const ensureAccidentRentalCompany = async () => {
  let company = await Company.findOne({ name: ACCIDENT_RENTAL_PARTY.name });

  if (!company) {
    company = await Company.create({
      name: ACCIDENT_RENTAL_PARTY.name,
      ceoName: ACCIDENT_RENTAL_PARTY.ceoName,
      bizType: '법인사업자'
    });
    return company;
  }

  if (company.ceoName !== ACCIDENT_RENTAL_PARTY.ceoName) {
    company.ceoName = ACCIDENT_RENTAL_PARTY.ceoName;
    await company.save();
  }
  return company;
};

/**
 * 차량 저장 값에 대차 차량 계약사를 박아 넣는다. 단기렌트가 아니면 아무것도 하지 않는다.
 * @param {object} payload 저장 직전의 차량 값
 */
export const applyAccidentRentalParty = async (payload) => {
  if (!RENTAL_FLEET_STATUSES.includes(payload?.status)) return payload;

  const company = await ensureAccidentRentalCompany();
  payload.company = company._id;
  payload.contractorName = '';
  payload.partyType = '법인';
  return payload;
};
