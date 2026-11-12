import Company from '../models/Company.js';
import Contract from '../models/Contract.js';
import Quote from '../models/Quote.js';
import Vehicle from '../models/Vehicle.js';
import Customer from '../models/Customer.js';
import BillingSchedule from '../models/BillingSchedule.js';
import { inferPartyType, bizTypeFor } from './partyType.js';

const digits = (s) => String(s || '').replace(/\D/g, '');
const bizNoFormat = (d) => (d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d);
const corpNoFormat = (d) => (d.length === 13 ? `${d.slice(0, 6)}-${d.slice(6)}` : d);

/**
 * 전자계약서를 확정할 때, 계약서에 적힌 계약사(상호·사업자번호·법인등록번호)를 계약에 잇는다.
 *
 * 견적을 담당자 개인 연락처로 만들면 계약이 법인 없이 '개인'으로 생긴다. 그래도 전자계약서는
 * 그 연락처 카드에 적힌 사업자번호·계좌로 칸을 채우므로 법인 계약서처럼 보인다(다인누리 GV80).
 * 확정한 계약서가 정답이므로, 계약에 법인이 없으면 같은 번호의 법인을 찾아(없으면 만들어) 연결한다.
 * 이미 법인이 연결된 계약은 건드리지 않는다.
 *
 * @returns {Promise<{ linked: boolean, created?: boolean, company?: object, partyType?: string }>}
 */
export const linkCompanyFromDocument = async (doc) => {
  const contractId = doc.contract?._id || doc.contract;
  const contract = await Contract.findById(contractId);
  if (!contract || contract.companyId) return { linked: false };

  const v = doc.values || {};
  const name = String(v.partyName || '').trim();
  const bizNo = digits(v.bizNo);
  const corpNo = digits(v.corpRegNo);
  if (!name || (bizNo.length !== 10 && corpNo.length !== 13)) return { linked: false };

  const partyType = inferPartyType(name, { bizNo, corporateRegistrationNo: corpNo });
  if (partyType === '일반개인') return { linked: false };

  const or = [];
  if (bizNo.length === 10) or.push({ bizNo: bizNoFormat(bizNo) }, { bizNo });
  if (corpNo.length === 13) or.push({ corporateRegistrationNo: corpNoFormat(corpNo) }, { corporateRegistrationNo: corpNo });
  let company = await Company.findOne({ $or: or });
  let created = false;
  if (!company) {
    company = await Company.create({
      name,
      bizNo: bizNo.length === 10 ? bizNoFormat(bizNo) : undefined,
      corporateRegistrationNo: corpNo.length === 13 ? corpNoFormat(corpNo) : undefined,
      bizType: bizTypeFor(partyType, { bizNo }),
      ceoName: v.ceoName || undefined,
      address: v.address || undefined,
      billingEmail: v.email || undefined,
      bank: v.bankAccount ? { holder: v.bankHolder, bankName: v.bankName, accountNo: v.bankAccount } : undefined
    });
    created = true;
  }

  contract.partyType = partyType;
  contract.companyId = company._id;
  if (!contract.corporateRegistrationNo && company.corporateRegistrationNo) contract.corporateRegistrationNo = company.corporateRegistrationNo;
  await contract.save();

  if (contract.quote) {
    await Quote.updateOne({ _id: contract.quote, companyId: { $exists: false } },
      { $set: { partyType: '법인', companyId: company._id, companyName: company.name, companyBizNo: company.bizNo } });
  }
  const vehicleIds = [...(contract.vehicles || []), contract.vehicle].filter(Boolean);
  if (vehicleIds.length) {
    await Vehicle.updateMany({ _id: { $in: vehicleIds }, company: { $exists: false } },
      { $set: { partyType, company: company._id } });
  }
  await BillingSchedule.updateMany({ contract: contract._id, company: { $exists: false } }, { $set: { company: company._id } });
  const customer = contract.customer ? await Customer.findById(contract.customer).select('ceoName companies').lean() : null;
  if (customer && !(customer.companies || []).some((c) => String(c.companyId) === String(company._id))) {
    const role = customer.ceoName && customer.ceoName === company.ceoName ? '대표' : '담당자';
    await Customer.updateOne({ _id: customer._id },
      { $push: { companies: { companyId: company._id, role, isPrimary: !(customer.companies || []).length } } });
  }
  return { linked: true, created, company, partyType };
};
