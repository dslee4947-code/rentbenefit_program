import Company from '../models/Company.js';

/**
 * 사고대차 차량의 계약사.
 *
 * 사고대차는 고객과 렌트 계약을 맺고 내주는 차가 아니라, 사고가 난 고객에게 우리가 대차로
 * 내주는 차다. 계약자가 따로 없으므로 계약사·대표자는 언제나 우리 회사로 고정한다.
 * 엑셀에 계약자가 적혀 있어도(대차를 받은 고객 이름이 적히곤 한다) 이 값이 이긴다.
 */
export const ACCIDENT_RENTAL_STATUS = '사고대차';
export const ACCIDENT_RENTAL_PARTY = { name: '렌트베네핏', ceoName: '이두식' };

/**
 * 사고대차용 계약사 법인을 찾거나 만든다. 대표자는 항상 고정값으로 맞춘다.
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
 * 차량 저장 값에 사고대차 계약사를 박아 넣는다. 사고대차가 아니면 아무것도 하지 않는다.
 * @param {object} payload 저장 직전의 차량 값
 */
export const applyAccidentRentalParty = async (payload) => {
  if (payload?.status !== ACCIDENT_RENTAL_STATUS) return payload;

  const company = await ensureAccidentRentalCompany();
  payload.company = company._id;
  payload.contractorName = '';
  payload.partyType = '법인';
  return payload;
};
