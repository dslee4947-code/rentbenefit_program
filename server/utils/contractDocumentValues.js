import Contract from '../models/Contract.js';
import Quote from '../models/Quote.js';
import ContractTemplate from '../models/ContractTemplate.js';
import ContractDocument from '../models/ContractDocument.js';

/**
 * 전자계약서 입력 칸(양식의 '법인정보' 시트)을 계약·견적·고객·법인·차량 정보로 채운다.
 *
 * 원래 엑셀은 B열에서 렌트_차량관리 엑셀을 VLOOKUP했다. 프로그램에서는 그 자리를 DB 값으로 대신한다.
 * 값을 못 찾은 칸은 비워 둔다. 지어낸 값(기본 보험사, 기본 타이어 등)은 넣지 않는다.
 *
 * 주민등록번호는 넣지 않는다. 프로그램은 주민번호를 저장하지 않는다(utils/validators.js).
 * 개인 고객의 '주민/사업자등록번호' 칸은 비워 두고, 전자서명 때 고객이 직접 적는다.
 */

const won = (n) => (Number(n) ? Math.round(Number(n)).toLocaleString('ko-KR') : '');
const plain = (v) => (v === undefined || v === null ? '' : String(v).trim());

// 원래 엑셀 규칙: 현대·기아면 '국산', 나머지는 '외산'. 제네시스도 외산으로 분류한다(양식 비고).
const DOMESTIC_MODEL = /^(현대|기아|그랜저|쏘나타|아반떼|아이오닉|코나|투싼|싼타페|팰리세이드|캐스퍼|스타리아|베뉴|넥쏘|포터|K3|K5|K8|K9|레이|모닝|니로|셀토스|스포티지|쏘렌토|카니발|모하비|EV\d|봉고|Ray|Grander|Grandeur|Sonata|Avante|Casper|Palisade|Carnival|Sorento|Sportage|Mojave|Cona|Kona|Tucson|Staria|Niro|Seltos)/i;
const originOf = (model) => {
  const m = plain(model);
  if (!m) return '';
  if (/제네시스|Genesis|^G\d0|^GV\d0/i.test(m)) return '외산';
  return DOMESTIC_MODEL.test(m) ? '국산' : '외산';
};

const pct = (v) => (v === undefined || v === null || v === '' ? '' : `${Number(v)}%`);
const manWon = (v) => {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'number') return v >= 10000 ? `${Math.round(v / 10000)}만원` : `${v}원`;
  return plain(v);
};

/**
 * @param {object} contract populate된 계약 (customer, companyId, vehicles, quote)
 * @returns {{values: object, sources: object}}
 */
export const buildContractValues = (contract) => {
  const values = {};
  const sources = {};
  const set = (key, value, source) => {
    const v = plain(value);
    if (!v || values[key]) return;
    values[key] = v;
    sources[key] = source;
  };

  const customer = contract.customer || {};
  const company = contract.companyId && typeof contract.companyId === 'object' ? contract.companyId : null;
  const vehicles = (contract.vehicles || []).filter((v) => v && typeof v === 'object');
  const vehicle = vehicles[0] || (contract.vehicle && typeof contract.vehicle === 'object' ? contract.vehicle : null);
  const info = contract.vehicleInfo || {};
  const quote = contract.quote && typeof contract.quote === 'object' ? contract.quote : null;
  const pricing = contract.pricing || {};
  const qp = quote?.pricing || {};
  const isCompany = contract.partyType === '법인' || Boolean(company);

  set('vehicleCode', vehicle?.code, 'vehicle');
  set('contractNo', contract.contractNo, 'contract');

  set('partyName', company?.name, 'company');
  set('partyName', customer.name, 'customer');
  set('ceoName', company?.ceoName, 'company');
  set('ceoName', customer.ceoName, 'customer');
  if (!isCompany) set('ceoName', customer.name, 'customer');
  set('bizNo', company?.bizNo, 'company');
  set('bizNo', customer.bizNo, 'customer');
  set('corpRegNo', contract.corporateRegistrationNo, 'contract');
  set('corpRegNo', company?.corporateRegistrationNo, 'company');
  set('address', company?.address, 'company');
  set('address', customer.address || customer.bizAddress || customer.businessAddress, 'customer');
  set('phone', customer.contactPhone || customer.mobilePhone || customer.businessPhone, 'customer');

  // 출금 계좌: 계약자(고객) 통장 → 법인 통장 → 차량에 남긴 통장 순
  set('bankName', customer.bank?.name, 'customer');
  set('bankAccount', customer.bank?.account, 'customer');
  set('bankHolder', customer.bank?.holder, 'customer');
  set('bankName', company?.bank?.bankName, 'company');
  set('bankAccount', company?.bank?.accountNo, 'company');
  set('bankHolder', company?.bank?.holder, 'company');
  set('bankName', vehicle?.banking?.bankName, 'vehicle');
  set('bankAccount', vehicle?.banking?.accountNo, 'vehicle');
  set('bankHolder', vehicle?.banking?.holder, 'vehicle');

  set('email', company?.billingEmail, 'company');
  set('email', customer.email, 'customer');
  set('email', contract.finesEmail, 'contract');
  // 계약담당자는 고객 쪽 담당자다(계약서_3 '법인담당자의 정보')
  set('managerName', customer.contactName, 'customer');
  set('managerPhone', customer.contactPhone || customer.mobilePhone, 'customer');

  const model = [info.model, info.spec].filter(Boolean).join(' ') || vehicle?.carModel
    || [quote?.vehicleModel, (quote?.vehicleSpec || '').split(' / ')[0]].filter(Boolean).join(' ');
  set('carModel', model, info.model ? 'contract' : vehicle?.carModel ? 'vehicle' : 'quote');
  set('origin', originOf(info.model || vehicle?.carModel || quote?.vehicleModel), 'contract');
  set('quantity', String(vehicles.length || (contract.vehicles || []).length || 1), 'contract');
  set('termMonths', contract.termMonths || pricing.paymentTerm || qp.paymentTerm, 'contract');

  set('carPrice', won(info.vehiclePrice || pricing.basePrice || vehicle?.carPrice || quote?.totalPrice), 'contract');
  set('deposit', won(pricing.deposit ?? qp.deposit), 'contract');
  set('advancePayment', won(pricing.advancePayment ?? qp.advancePayment), 'contract');
  set('takeoverPrice', won(pricing.takeoverPrice ?? qp.takeoverPrice), 'contract');
  set('monthlyFee', won(pricing.monthlyFee || qp.monthlyFee || vehicle?.monthlyFee), 'contract');

  const maint = info.maintenance || {};
  const general = maint.generalMaintenance || vehicle?.maintenance?.generalMaintenance
    || (maint.enabled !== undefined ? (maint.enabled ? '가입' : '미가입') : '')
    || (quote?.maintenance?.enabled !== undefined ? (quote.maintenance.enabled ? '가입' : '미가입') : '');
  set('maintenance', general, maint.generalMaintenance || maint.enabled !== undefined ? 'contract' : vehicle ? 'vehicle' : 'quote');

  set('exteriorColor', info.color || vehicle?.exteriorColor || quote?.vehicleDetail?.exteriorColor, 'contract');
  set('interiorColor', info.colorInterior || vehicle?.interiorColor || quote?.vehicleDetail?.interiorColor, 'contract');
  const mileage = maint.mileage || vehicle?.maintenance?.mileage || quote?.maintenance?.mileage;
  set('annualMileage', mileage ? Number(mileage).toLocaleString('ko-KR') : '', 'contract');
  set('options', info.options || vehicle?.options, 'contract');

  const ins = info.insurance || {};
  const vins = vehicle?.insurance || {};
  set('propertyLimit', ins.propertyLimit || vins.propertyLimit, ins.propertyLimit ? 'contract' : 'vehicle');
  set('personalInjury', ins.personalInjury || vins.personalInjury, ins.personalInjury ? 'contract' : 'vehicle');
  set('personalInjury_2', values.personalInjury, sources.personalInjury);
  set('uninsuredInjury', ins.uninsuredInjury || vins.uninsuredInjury, ins.uninsuredInjury ? 'contract' : 'vehicle');
  set('deductible', manWon(ins.deductible ?? vins.deductible), ins.deductible ? 'contract' : 'vehicle');
  set('emergencyService', maint.emergencyService || ins.emergencyCall || vins.emergencyService, 'contract');
  set('tire', maint.tireType || vehicle?.maintenance?.tireType, 'contract');

  const terms = contract.terms || quote?.terms || {};
  set('penaltyRate', pct(terms.earlyTerminationRate ?? pricing.penaltyRate), 'contract');
  set('overdueRate', pct(terms.lateInterestRate ?? pricing.overdueRate), 'contract');

  return { values, sources };
};

/** 계약 하나를 계약서 채우기에 필요한 것까지 불러온다. */
export const loadContractForDocument = (contractId) => Contract.findById(contractId)
  .populate('customer')
  .populate('companyId')
  .populate('vehicles')
  .populate('vehicle')
  .populate({ path: 'quote', model: Quote });

/**
 * 계약 정보를 다시 읽어 계약서 칸을 채운다. 직원이 고친 칸(sources가 manual)과 확정된 계약서는 건드리지 않는다.
 * @returns {Promise<{doc: object|null, changed: number}>}
 */
export const refreshContractDocument = async (doc, { userName = '' } = {}) => {
  if (!doc || doc.status === '확정') return { doc, changed: 0 };
  const contract = await loadContractForDocument(doc.contract);
  if (!contract) return { doc, changed: 0 };
  const fresh = buildContractValues(contract);
  const values = { ...(doc.values || {}) };
  const sources = { ...(doc.sources || {}) };
  let changed = 0;
  for (const [key, v] of Object.entries(fresh.values)) {
    if (sources[key] === 'manual' || values[key] === v) continue;
    values[key] = v;
    sources[key] = fresh.sources[key];
    changed += 1;
  }
  if (changed) {
    doc.values = values;
    doc.sources = sources;
    if (userName) doc.updatedBy = userName;
    doc.markModified('values');
    doc.markModified('sources');
    await doc.save();
  }
  return { doc, changed };
};

/** 계약이 바뀐 뒤(임시저장 확정 등) 그 계약의 계약서가 있으면 빈칸을 다시 채운다. 실패해도 계약 저장은 막지 않는다. */
export const refreshContractDocumentFor = async (contractId) => {
  try {
    const doc = await ContractDocument.findOne({ contract: contractId });
    if (doc) await refreshContractDocument(doc);
  } catch (err) {
    console.error('[전자계약서] 다시 채우기 실패:', err.message);
  }
};

/**
 * 계약의 전자계약서를 만든다. 이미 있으면 그대로 돌려준다(한 계약에 하나).
 * 사용 중인 양식이 없으면 null.
 */
export const ensureContractDocument = async (contractId, { user } = {}) => {
  const existing = await ContractDocument.findOne({ contract: contractId });
  if (existing) return existing;
  const template = await ContractTemplate.findOne({ kind: '장기렌트', active: true }).select('name version');
  if (!template) return null;
  const contract = await loadContractForDocument(contractId);
  if (!contract) return null;
  const { values, sources } = buildContractValues(contract);
  return ContractDocument.create({
    contract: contract._id,
    quote: contract.quote?._id || contract.quote || undefined,
    template: template._id,
    templateName: template.name,
    templateVersion: template.version,
    values,
    sources,
    documentDate: new Date(),
    createdBy: user?.name || user?.email || ''
  });
};
