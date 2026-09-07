import Contract from '../models/Contract.js';
import Vehicle from '../models/Vehicle.js';
import Customer from '../models/Customer.js';
import Quote from '../models/Quote.js';
import Schedule from '../models/Schedule.js';
import Company from '../models/Company.js';
import BillingSchedule from '../models/BillingSchedule.js';
import { buildScheduleForContract } from './billingScheduleController.js';
import { createLedgersForVehicles } from './ledgerController.js';
import { ensureCustomerFolders } from '../utils/documentStorageService.js';
import XLSX from 'xlsx';
import { mergeCarModel } from '../utils/carModel.js';
import { normalizeMaintenance } from '../utils/maintenance.js';
import { computeSupplyPrice } from '../utils/vehiclePricing.js';

// 차종명으로 차량 코드를 자동 채번한다 (예: "그랜저 하이브리드" -> "그랜저-003").
// createContract(신규 등록)와 updateContract의 임시저장 확정(finalize) 양쪽에서 공유한다.
const generateVehicleCode = async (modelName) => {
  const cleanModelName = (modelName || '').split(' ')[0].replace(/[^a-zA-Z가-힣0-9]/g, '') || 'VEH';
  const vehicleCount = await Vehicle.countDocuments({ code: new RegExp('^' + cleanModelName + '-', 'i') });
  return `${cleanModelName}-${String(vehicleCount + 1).padStart(3, '0')}`;
};

/**
 * 차량에 적어 둘 출금 통장을 정한다.
 *
 * 계약서에 직접 적은 통장이 우선이고, 비워 두었으면 법인 관리에 등록된 그 법인의 통장을 쓴다.
 * 법인 차량은 대부분 법인 계좌에서 빠져나가므로 매번 다시 적지 않아도 되게 한다.
 *
 * @returns {Promise<{name: string, account: string, holder: string}|undefined>}
 */
const resolveContractBank = async (body) => {
  const bank = body.customerInfo?.bank;
  if (bank && (bank.holder || bank.name || bank.account)) return bank;
  if (!body.companyId) return bank;

  const company = await Company.findById(body.companyId).select('bank').lean();
  const companyBank = company?.bank;
  if (!companyBank || !(companyBank.holder || companyBank.bankName || companyBank.accountNo)) return bank;

  return {
    name: companyBank.bankName || '',
    account: companyBank.accountNo || '',
    holder: companyBank.holder || ''
  };
};

// 견적/폼에서 넘어온 vehicleInfo + pricing으로 Vehicle 문서에 넣을 필드를 구성한다.
// status는 호출하는 쪽(신규 등록/임시저장 확정)에서 정한다 - 계약이 처음 만들어질 때는 항상 '계약중'.
const buildVehicleFields = (vehicleInfo, pricing, status, bank, terms) => ({
  // 렌트차량 DB는 차종 한 칸으로 본다. 계약서에는 사양이 따로 남는다(contract.vehicles[].spec).
  carModel: mergeCarModel(vehicleInfo.model, vehicleInfo.spec),
  carSpec: '',
  fuelType: vehicleInfo.fuelType,
  cc: vehicleInfo.cc,
  exteriorColor: vehicleInfo.color,
  interiorColor: vehicleInfo.colorInterior || '',
  options: vehicleInfo.options || '',
  deliveryPeriod: vehicleInfo.deliveryPeriod || '',

  year: vehicleInfo.year,
  vin: vehicleInfo.vin || '',
  plateNo: vehicleInfo.plateNo || '',
  registrationDate: vehicleInfo.registrationDate || undefined,

  carPrice: vehicleInfo.vehiclePrice || pricing?.basePrice || 0,
  optionPrice: pricing?.optionPrice,
  discount: pricing?.discount,
  // 공급가액은 받아 적지 않고 계산한다. 차량가·할인금액을 고쳐도 늘 맞는 값이 남는다.
  supplyPrice: computeSupplyPrice({
    carPrice: vehicleInfo.vehiclePrice || pricing?.basePrice || 0,
    optionPrice: pricing?.optionPrice,
    deliveryFee: pricing?.deliveryFee,
    discount: pricing?.discount
  }),
  deliveryFee: pricing?.deliveryFee,
  acquisitionTax: pricing?.acquisitionTax,
  publicBond: pricing?.publicBond,
  registrationAgencyFee: pricing?.registrationAgencyFee,
  deposit: pricing?.deposit,
  advancePayment: pricing?.advancePayment,
  takeoverPrice: pricing?.takeoverPrice,
  monthlyFee: pricing?.monthlyFee || 0,
  paymentTerm: pricing?.paymentTerm,
  individualConsumptionTax: pricing?.individualConsumptionTax,

  insurance: {
    // 보험사는 실제로 가입해야 정해지는 값이라, 입력하지 않았으면 비워 둔다.
    // (예전에는 '삼성화재'를 기본으로 넣어 입력한 적 없는 값이 차량 DB에 남았다)
    company: vehicleInfo.insurance?.company || '',
    type: vehicleInfo.insurance?.type === 'premium' ? 'premium' : 'standard',
    driverAge: vehicleInfo.insurance?.driverAge || '만 26세 이상',
    liabilityLimit: vehicleInfo.insurance?.liabilityLimit || '무제한',
    propertyLimit: vehicleInfo.insurance?.propertyLimit || '1억원',
    personalInjury: vehicleInfo.insurance?.personalInjury || '1억원',
    uninsuredInjury: vehicleInfo.insurance?.uninsuredInjury || '2억원',
    deductible: vehicleInfo.insurance?.deductible ? (
      typeof vehicleInfo.insurance.deductible === 'number'
        ? vehicleInfo.insurance.deductible
        : (parseInt(String(vehicleInfo.insurance.deductible).replace(/[^0-9]/g, '')) * 10000 || 300000)
    ) : 300000,
    emergencyService: vehicleInfo.maintenance?.emergencyService || vehicleInfo.insurance?.emergencyCall || '가입'
  },

  // 정비는 일반정비 하나로 정해진다. 순회정비·소모품교환은 normalizeMaintenance가 맞춰 준다.
  maintenance: normalizeMaintenance({
    tireType: vehicleInfo.maintenance?.tireType || '',
    mileage: vehicleInfo.maintenance?.mileage || vehicleInfo.mileage || 0,
    generalMaintenance: vehicleInfo.maintenance?.generalMaintenance || '미가입'
  }),

  status,
  currentMileage: vehicleInfo.mileage || 0,

  // 계약 조건 - 청구서의 연체 이자 계산과 중도해지 정산에 쓰인다.
  // 계약(Contract.terms)이 정본이지만, 차량 DB만 보고도 조건을 확인할 수 있게 함께 남긴다.
  lateInterestRate: terms?.lateInterestRate,
  earlyTerminationRate: terms?.earlyTerminationRate,

  // 계약서에 입력한 통장사본(자동이체 계좌)을 차량에도 함께 남긴다.
  // 렌트료가 어느 계좌에서 빠져나가는지는 차량 단위로 확인해야 하는 정보다.
  banking: {
    holder: bank?.holder || '',
    bankName: bank?.name || '',
    accountNo: bank?.account || ''
  },

  // 출고 준비 화면에서 그대로 쓸 수 있도록 견적/계약에서 정해진 금리·수수료·판관비를 미리 채워둔다
  // 금리 단위 맞추기.
  // 견적서는 계산에 쓰려고 소수(0.06)로 들고 있고, 차량 DB와 출고 준비 화면은 퍼센트(6)로 보여준다.
  // 그대로 넘기면 렌트차량 DB에 '0.06%'로 찍혀 100배 작게 보인다.
  interestRate: pricing?.baseInterestRate !== undefined && pricing.baseInterestRate !== null
    ? Number((pricing.baseInterestRate * 100).toFixed(3))
    : undefined,
  companyCommission: pricing?.commission,
  dealerCommission: pricing?.dealerCommission,
  sellingAdminExpense: pricing?.pandanbi
});

// 계약이 확정될 때(신규 등록/임시저장 확정) 함께 만드는 정기점검/차량검사/렌트만료/청구서발송 일정
const buildSchedules = (vehicleId, contract, termMonths, pricing, managerOps, managerMain) => {
  const schedulesToCreate = [];
  const contractDateObj = new Date(contract.contractDate);

  const maintenanceIntervals = Math.floor(termMonths / 6);
  for (let i = 1; i <= maintenanceIntervals; i++) {
    const maintenanceDate = new Date(contractDateObj);
    maintenanceDate.setMonth(maintenanceDate.getMonth() + (i * 6));
    schedulesToCreate.push({
      type: '정기점검',
      targetVehicle: vehicleId,
      targetContract: contract._id,
      dueDate: maintenanceDate,
      status: '예정',
      assignee: managerOps || managerMain || '담당자 미정'
    });
  }

  const inspectionDate = new Date(contractDateObj);
  if (termMonths >= 24) {
    inspectionDate.setMonth(inspectionDate.getMonth() + 24);
    schedulesToCreate.push({
      type: '차량검사',
      targetVehicle: vehicleId,
      targetContract: contract._id,
      dueDate: inspectionDate,
      status: '예정',
      assignee: managerOps || managerMain || '담당자 미정'
    });
  } else {
    schedulesToCreate.push({
      type: '차량검사',
      targetVehicle: vehicleId,
      targetContract: contract._id,
      dueDate: contract.endDate,
      status: '예정',
      assignee: managerOps || managerMain || '담당자 미정'
    });
  }

  schedulesToCreate.push({
    type: '렌트만료',
    targetVehicle: vehicleId,
    targetContract: contract._id,
    dueDate: contract.endDate,
    status: '예정',
    assignee: managerMain || '담당자 미정'
  });

  // 청구서 발송 일정은 여기서 만들지 않는다.
  // 회차표(BillingSchedule)의 실제 출금일에서 10일을 뺀 날이 발송일이고,
  // 그 계산은 utils/invoiceScheduleJob.js가 매일 돌면서 가장 가까운 한 건만 캘린더에 잡는다.
  // 예전에는 여기서 계약 기간만큼(36~60건) 한꺼번에 넣었는데,
  // 날짜 기준이 pricing.invoiceDay라 출고 준비에서 정한 결제일(말일 포함)과 달랐고
  // 계약 하나가 캘린더를 수십 칸씩 채워 쓸 수 없었다.

  return schedulesToCreate;
};

// 기존 고객을 조회(+선택적 업데이트)하거나 신규 고객을 생성한다. createContract/createDraftContract 공용.
const resolveCustomer = async (req) => {
  if (req.body.isNewCustomer) {
    const { name, bizNo, ceoName, address, contactName, contactPhone, email, bank, bizNoTransfer, bizAddress } = req.body.customerInfo || {};

    if (!name || !bizNo) {
      throw Object.assign(new Error('신규 고객 등록을 위해 고객명과 사업자/주민번호는 필수입니다.'), { status: 400 });
    }

    const customerExists = await Customer.findOne({ bizNo });
    if (customerExists) {
      throw Object.assign(new Error('이미 동일한 사업자/주민번호로 등록된 고객이 존재합니다.'), { status: 400 });
    }

    const count = await Customer.countDocuments();
    const newCustId = `CUST${String(count + 1).padStart(3, '0')}`;

    return Customer.create({
      customerId: newCustId,
      name,
      bizNo,
      ceoName,
      address,
      contactName,
      contactPhone,
      email: email || 'no-email@rentbenefit.co.kr',
      bank: bank || {},
      bizNoTransfer,
      bizAddress
    });
  }

  const customer = await Customer.findById(req.body.customerId);
  if (!customer) {
    throw Object.assign(new Error('Customer not found'), { status: 404 });
  }

  if (req.body.customerInfo) {
    const { name, bizNo, ceoName, address, contactName, contactPhone, email, bank, bizNoTransfer, bizAddress } = req.body.customerInfo;
    customer.name = name || customer.name;
    customer.bizNo = bizNo || customer.bizNo;
    customer.ceoName = ceoName !== undefined ? ceoName : customer.ceoName;
    customer.address = address !== undefined ? address : customer.address;
    customer.contactName = contactName !== undefined ? contactName : customer.contactName;
    customer.contactPhone = contactPhone !== undefined ? contactPhone : customer.contactPhone;
    customer.email = email || customer.email;
    customer.bank = bank || customer.bank;
    customer.bizNoTransfer = bizNoTransfer !== undefined ? bizNoTransfer : customer.bizNoTransfer;
    customer.bizAddress = bizAddress !== undefined ? bizAddress : customer.bizAddress;
    await customer.save();
  }

  return customer;
};

// 고객ID-연월-일련번호 형식으로 계약번호를 채번한다 (예: CUST001-2601-01)
const generateContractNo = async (customer, contractDateObj) => {
  const cId = customer.customerId || 'CUST000';
  const yy = String(contractDateObj.getFullYear()).slice(-2);
  const mm = String(contractDateObj.getMonth() + 1).padStart(2, '0');
  const prefix = `${cId}-${yy}${mm}-`;
  const contractCount = await Contract.countDocuments({ contractNo: new RegExp('^' + prefix) });
  return `${prefix}${String(contractCount + 1).padStart(2, '0')}`;
};

// @desc    Get all contracts
// @route   GET /api/contracts
// @access  Public
export const getContracts = async (req, res) => {
  try {
    const { search, status, includeArchived } = req.query;
    let query = {};

    // 보관된 계약은 계약서 목록에서 감춘다. 되돌리기 화면에서만 includeArchived로 불러온다.
    if (!status && includeArchived !== 'true') {
      query.status = { $ne: '보관됨' };
    }

    if (status) {
      query.status = status;
    }

    const contracts = await Contract.find(query)
      .populate('customer')
      .populate('vehicle')
      .populate('vehicles')
      .populate('quote')
      .populate('companyId', 'name bizNo bizType')
      .sort({ createdAt: -1 });

    if (search) {
      const filtered = contracts.filter(contract => {
        const matchesCustomer = contract.customer && (
          contract.customer.name.toLowerCase().includes(search.toLowerCase()) ||
          (contract.customer.bizNo || '').includes(search)
        );
        const matchesVehicle = contract.vehicle && (
          (contract.vehicle.code || '').toLowerCase().includes(search.toLowerCase()) ||
          (contract.vehicle.carModel || '').toLowerCase().includes(search.toLowerCase()) ||
          contract.vehicle.plateNo?.toLowerCase().includes(search.toLowerCase())
        );
        const matchesContractNo = contract.contractNo.includes(search);
        return matchesCustomer || matchesVehicle || matchesContractNo;
      });
      return res.json(filtered);
    }

    res.json(contracts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get contract by ID
// @route   GET /api/contracts/:id
// @access  Public
export const getContractById = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id)
      .populate('customer')
      .populate('vehicle')
      .populate('vehicles')
      .populate('quote')
      .populate('companyId', 'name bizNo bizType');
    if (contract) {
      res.json(contract);
    } else {
      res.status(404).json({ message: 'Contract not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * 계약 하나에 딸린 차량들을 한꺼번에 만든다.
 *
 * 청구서·세금계산서가 계약서 단위라, 같은 날 계약해도 계약서가 다르면 차량 묶음도 달라야 한다.
 * 그래서 차량은 항상 "계약 단위 묶음"으로 만든다.
 *
 * 화면이 vehicleInfos(배열)를 보내면 그대로 쓰고, 예전처럼 vehicleInfo(단수) 하나만 보내면
 * 한 대짜리 묶음으로 취급한다.
 *
 * @returns {Promise<Array>} 만들어진 Vehicle 문서들
 */
const createContractVehicles = async (body, pricing) => {
  const list = Array.isArray(body.vehicleInfos) && body.vehicleInfos.length
    ? body.vehicleInfos
    : (body.vehicleInfo ? [body.vehicleInfo] : []);

  const bank = await resolveContractBank(body);
  const created = [];

  for (const info of list) {
    if (!info || !info.model) continue;
    // 차량 코드는 차종별 일련번호라, 여러 대를 만들 때도 한 대씩 순서대로 받아야 겹치지 않는다
    const code = await generateVehicleCode(info.model);
    created.push(await Vehicle.create({
      code,
      ...buildVehicleFields(info, info.pricing || pricing, '계약중', bank, body.terms)
    }));
  }
  return created;
};

// @desc    Create new contract & automate vehicle creation, sequences, schedules
// @route   POST /api/contracts
// @access  Public
export const createContract = async (req, res) => {
  try {
    const {
      customerId,
      quoteId,
      partyType,
      companyId,
      leaseCompany,
      contractDate,
      deliveryDate,
      termMonths,
      branch,
      managerMain,
      managerOps,
      pricing,
      gifts,
      // Vehicle details input concurrently
      vehicleInfo // { model, spec, year, color, fuelType, cc, vin, plateNo, options, releaseAddress, dealer, salesRep, showroom }
    } = req.body;

    const hasVehicleList = Array.isArray(req.body.vehicleInfos) && req.body.vehicleInfos.some((v) => v?.model);
    if ((!customerId && !req.body.isNewCustomer) || !contractDate || !termMonths || !pricing
        || (!hasVehicleList && (!vehicleInfo || !vehicleInfo.model))) {
      return res.status(400).json({ message: 'Missing required contract, customer, or vehicle fields' });
    }

    // 1. 이 계약으로 묶이는 차량들을 만든다 - 계약이 처음 등록되는 시점이라 상태는 '계약중'
    const vehicles = await createContractVehicles(req.body, pricing);
    if (!vehicles.length) {
      return res.status(400).json({ message: '차종을 입력한 차량이 한 대도 없습니다.' });
    }
    const vehicle = vehicles[0];

    // 2. Resolve Customer (Select existing or Create new, and optionally update)
    let customer;
    try {
      customer = await resolveCustomer(req);
    } catch (err) {
      // 고객 처리에 실패하면 방금 만든 차량들이 계약 없이 남으므로 함께 되돌린다
      await Vehicle.deleteMany({ _id: { $in: vehicles.map((v) => v._id) } });
      return res.status(err.status || 500).json({ message: err.message });
    }

    const contractDateObj = new Date(contractDate);
    const contractNo = await generateContractNo(customer, contractDateObj);

    // 3. Create Contract
    const contract = new Contract({
      contractNo,
      vehicle: vehicle._id,
      vehicles: vehicles.map((v) => v._id),
      terms: req.body.terms || undefined,
      customer: customer._id,
      quote: quoteId || null,
      partyType: partyType || '개인',
      companyId: partyType === '법인' ? (companyId || undefined) : undefined,
      leaseCompany,
      contractDate: contractDateObj,
      deliveryDate,
      termMonths,
      branch,
      managerMain,
      managerMainPhone: req.body.managerMainPhone,
      managerOps,
      managerOpsPhone: req.body.managerOpsPhone,

      rentPeriodYears: req.body.rentPeriodYears,
      rentStartDate: req.body.rentStartDate,
      rentPeriodDays: req.body.rentPeriodDays,
      remainingPeriodCalc: req.body.remainingPeriodCalc,

      finesEmail: req.body.finesEmail,
      finesEmail2: req.body.finesEmail2,
      // 고지서가 오면 어떻게 할지. 대부분 대납해서 청구하지만 법인마다 다르다.
      fineHandling: ['대납청구', '고객납부', '명의변경'].includes(req.body.fineHandling)
        ? req.body.fineHandling
        : undefined,
      corporateRegistrationNo: req.body.corporateRegistrationNo,

      status: '진행중',
      pricing,
      gifts: gifts || []
    });

    const savedContract = await contract.save(); // pre-save calculates endDate

    // 3.5. 방금 만든 계약과 차량들을 서로 연결 (차량 생성 시점엔 계약이 아직 없어 나중에 연결).
    //      대표 한 대가 아니라 이 계약으로 묶인 차량 전체를 연결해야 청구서가 계약 단위로 만들어진다.
    await Vehicle.updateMany(
      { _id: { $in: vehicles.map((v) => v._id) } },
      { contract: savedContract._id }
    );

    // 3.55. 계약자 폴더를 미리 만들어 둔다.
    //       계약서·청구서·정비 자료가 들어갈 자리를 계약 시작 시점에 잡아 둔다.
    //       폴더를 못 만들어도(권한·경로 문제) 계약 등록 자체를 막지는 않는다.
    try {
      const partyName = savedContract.companyId
        ? (await Company.findById(savedContract.companyId).select('name').lean())?.name
        : customer.name;
      if (partyName) {
        const { root } = await ensureCustomerFolders(partyName);
        await Contract.findByIdAndUpdate(savedContract._id, { customerFolder: partyName });
        console.log(`[계약자 폴더] ${savedContract.contractNo}: ${root}`);
      }
    } catch (err) {
      console.log(`[계약자 폴더] ${savedContract.contractNo}: 만들지 못했습니다 - ${err.message}`);
    }

    // 3.57. 차량 손익 원장(갑지)을 차량마다 한 장씩 만들어 둔다.
    //       계약이 성립하면 그 순간부터 계약금·차량가 같은 돈이 나가기 시작하므로 장부가 먼저 있어야 한다.
    //       못 만들어도 계약 등록은 막지 않는다(손익 원장 화면에서 나중에 만들 수 있다).
    try {
      await createLedgersForVehicles(vehicles, savedContract._id);
    } catch (err) {
      console.log(`[차량 손익 원장] ${savedContract.contractNo}: ${err.message}`);
    }

    // 3.6. 청구 회차표를 만들어 둔다.
    //      결제일이나 렌트료 게시일이 아직 없으면 만들 수 없는데, 그건 출고 준비에서 정하는 값이라
    //      계약 등록을 막지 않고 넘어간다. 나중에 청구서 화면에서 다시 만들 수 있다.
    try {
      await buildScheduleForContract(savedContract._id);
    } catch (err) {
      console.log(`[청구 회차표] ${savedContract.contractNo}: ${err.message} (출고 준비 입력 후 다시 만들 수 있습니다)`);
    }

    // 4. Auto-generate Schedules (SCHEDULE 자동 생성)
    const schedulesToCreate = buildSchedules(vehicle._id, savedContract, termMonths, pricing, managerOps, managerMain);
    if (schedulesToCreate.length > 0) {
      await Schedule.insertMany(schedulesToCreate);
    }

    // 5. If quoteId is provided, mark quote status as converted
    if (quoteId) {
      await Quote.findByIdAndUpdate(quoteId, { status: '계약전환' });
    }

    const populatedContract = await Contract.findById(savedContract._id)
      .populate('customer')
      .populate('vehicle')
      .populate('vehicles')
      .populate('companyId', 'name bizNo bizType');

    res.status(201).json(populatedContract);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    계약서 임시저장 - 렌트차량 DB에는 아직 차량을 만들지 않고 계약 정보만 저장한다.
//          견적서에서 "계약서 등록 전환"을 누르면 자동으로, 계약서 등록 화면의 "임시저장"에서도 호출된다.
// @route   POST /api/contracts/draft
// @access  Public
export const createDraftContract = async (req, res) => {
  try {
    if (!req.body.customerId && !req.body.isNewCustomer) {
      return res.status(400).json({ message: '고객 정보가 없어 임시저장할 수 없습니다.' });
    }

    let customer;
    try {
      customer = await resolveCustomer(req);
    } catch (err) {
      return res.status(err.status || 500).json({ message: err.message });
    }

    const contractDateObj = req.body.contractDate ? new Date(req.body.contractDate) : new Date();
    const contractNo = await generateContractNo(customer, contractDateObj);

    const contract = await Contract.create({
      contractNo,
      customer: customer._id,
      quote: req.body.quoteId || null,
      partyType: req.body.partyType || '개인',
      companyId: req.body.partyType === '법인' ? (req.body.companyId || undefined) : undefined,
      leaseCompany: req.body.leaseCompany,
      contractDate: contractDateObj,
      deliveryDate: req.body.deliveryDate,
      termMonths: req.body.termMonths || undefined,
      branch: req.body.branch,
      managerMain: req.body.managerMain,
      managerMainPhone: req.body.managerMainPhone,
      managerOps: req.body.managerOps,
      managerOpsPhone: req.body.managerOpsPhone,
      finesEmail: req.body.finesEmail,
      finesEmail2: req.body.finesEmail2,
      // 고지서가 오면 어떻게 할지. 대부분 대납해서 청구하지만 법인마다 다르다.
      fineHandling: ['대납청구', '고객납부', '명의변경'].includes(req.body.fineHandling)
        ? req.body.fineHandling
        : undefined,
      corporateRegistrationNo: req.body.corporateRegistrationNo,
      status: '임시저장',
      pricing: req.body.pricing || {},
      gifts: req.body.gifts || [],
      vehicleInfo: req.body.vehicleInfo || {}
    });

    // 견적에서 넘어온 임시저장이면 그 견적은 계약으로 전환된 것으로 표시한다
    if (req.body.quoteId) {
      await Quote.findByIdAndUpdate(req.body.quoteId, { status: '계약전환' });
    }

    const populated = await Contract.findById(contract._id)
      .populate('customer')
      .populate('companyId', 'name bizNo bizType');

    res.status(201).json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update contract
// @route   PUT /api/contracts/:id
// @access  Public
export const updateContract = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) {
      return res.status(404).json({ message: 'Contract not found' });
    }

    contract.leaseCompany = req.body.leaseCompany !== undefined ? req.body.leaseCompany : contract.leaseCompany;
    contract.partyType = req.body.partyType !== undefined ? req.body.partyType : contract.partyType;
    contract.companyId = req.body.partyType !== undefined
      ? (req.body.partyType === '법인' ? (req.body.companyId || undefined) : undefined)
      : contract.companyId;
    contract.contractDate = req.body.contractDate !== undefined ? new Date(req.body.contractDate) : contract.contractDate;
    contract.deliveryDate = req.body.deliveryDate !== undefined ? req.body.deliveryDate : contract.deliveryDate;
    contract.termMonths = req.body.termMonths !== undefined ? req.body.termMonths : contract.termMonths;
    contract.branch = req.body.branch !== undefined ? req.body.branch : contract.branch;
    contract.managerMain = req.body.managerMain !== undefined ? req.body.managerMain : contract.managerMain;
    contract.managerMainPhone = req.body.managerMainPhone !== undefined ? req.body.managerMainPhone : contract.managerMainPhone;
    contract.managerOps = req.body.managerOps !== undefined ? req.body.managerOps : contract.managerOps;
    contract.managerOpsPhone = req.body.managerOpsPhone !== undefined ? req.body.managerOpsPhone : contract.managerOpsPhone;
    // 범칙금 처리 방식. 고지서가 올 때마다 판단하지 않도록 계약에 정해 둔다.
    if (['대납청구', '고객납부', '명의변경'].includes(req.body.fineHandling)) {
      contract.fineHandling = req.body.fineHandling;
    }

    contract.rentPeriodYears = req.body.rentPeriodYears !== undefined ? req.body.rentPeriodYears : contract.rentPeriodYears;
    contract.rentStartDate = req.body.rentStartDate !== undefined ? req.body.rentStartDate : contract.rentStartDate;
    contract.rentPeriodDays = req.body.rentPeriodDays !== undefined ? req.body.rentPeriodDays : contract.rentPeriodDays;
    contract.remainingPeriodCalc = req.body.remainingPeriodCalc !== undefined ? req.body.remainingPeriodCalc : contract.remainingPeriodCalc;
    contract.finesEmail = req.body.finesEmail !== undefined ? req.body.finesEmail : contract.finesEmail;
    contract.finesEmail2 = req.body.finesEmail2 !== undefined ? req.body.finesEmail2 : contract.finesEmail2;
    contract.corporateRegistrationNo = req.body.corporateRegistrationNo !== undefined ? req.body.corporateRegistrationNo : contract.corporateRegistrationNo;

    contract.status = req.body.status !== undefined ? req.body.status : contract.status;
    if (req.body.pricing) {
      contract.pricing = { ...contract.pricing, ...req.body.pricing };
    }
    if (req.body.gifts) {
      contract.gifts = req.body.gifts;
    }

    // Update associated customer if customerInfo is supplied
    if (req.body.customerInfo) {
      await Customer.findByIdAndUpdate(contract.customer, req.body.customerInfo);
    }

    // 임시저장이었던 계약을 이 저장에서 확정(최종 등록/전환)하는 경우 - 여기서 처음 렌트차량 DB에 차량을 만든다.
    const finalizingDraft = req.body.finalize === true && !contract.vehicle && !(contract.vehicles || []).length;

    if (finalizingDraft) {
      const vehicleInfo = req.body.vehicleInfo || contract.vehicleInfo || {};
      if (!vehicleInfo.model) {
        return res.status(400).json({ message: '차종을 입력해야 계약을 등록할 수 있습니다.' });
      }
      if (!contract.contractDate || !contract.termMonths) {
        return res.status(400).json({ message: '계약일과 렌트 기간을 입력해야 계약을 등록할 수 있습니다.' });
      }

      const vehicles = await createContractVehicles(req.body, contract.pricing);
      if (!vehicles.length) {
        return res.status(400).json({ message: '차종을 입력한 차량이 한 대도 없습니다.' });
      }

      contract.vehicles = vehicles.map((v) => v._id);
      contract.vehicle = vehicles[0]._id;
      contract.vehicleInfo = undefined;
      contract.status = '진행중';

      const updatedContract = await contract.save();
      await Vehicle.updateMany(
        { _id: { $in: contract.vehicles } },
        { contract: updatedContract._id }
      );

      // 임시저장을 확정할 때도 차량마다 손익 원장(갑지)을 한 장씩 만든다
      try {
        await createLedgersForVehicles(vehicles, updatedContract._id);
      } catch (err) {
        console.log(`[차량 손익 원장] ${updatedContract.contractNo}: ${err.message}`);
      }

      // 대표 차량은 방금 만든 묶음의 첫 대다.
      // 여기서 정의되지 않은 vehicle을 쓰고 있어 임시저장 확정이 항상 500으로 끝났다.
      const schedulesToCreate = buildSchedules(
        vehicles[0]._id, updatedContract, updatedContract.termMonths, updatedContract.pricing,
        updatedContract.managerOps, updatedContract.managerMain
      );
      if (schedulesToCreate.length > 0) {
        await Schedule.insertMany(schedulesToCreate);
      }

      if (updatedContract.quote) {
        await Quote.findByIdAndUpdate(updatedContract.quote, { status: '계약전환' });
      }

      const populated = await Contract.findById(updatedContract._id)
        .populate('customer')
        .populate('vehicle')
      .populate('vehicles')
        .populate('companyId', 'name bizNo bizType');
      return res.json(populated);
    }

    if (contract.vehicle && req.body.vehicleInfo) {
      // 이미 정식 등록된 계약의 차량 정보 수정 - 보내온 값만 부분 반영한다
      const vInfo = req.body.vehicleInfo;
      const mappedVehicleInfo = {
        carModel: mergeCarModel(vInfo.model, vInfo.spec),
        carSpec: '',
        carPrice: vInfo.vehiclePrice,
        exteriorColor: vInfo.color,
        interiorColor: vInfo.colorInterior,
        fuelType: vInfo.fuelType,
        cc: vInfo.cc,
        options: vInfo.options,
        vin: vInfo.vin,
        plateNo: vInfo.plateNo,
        currentMileage: vInfo.mileage !== undefined ? Number(vInfo.mileage) : undefined,
        monthlyFee: req.body.pricing?.monthlyFee,

        // 통장사본을 고쳤으면 차량 쪽 계좌 정보도 함께 맞춘다
        banking: req.body.customerInfo?.bank ? {
          holder: req.body.customerInfo.bank.holder || '',
          bankName: req.body.customerInfo.bank.name || '',
          accountNo: req.body.customerInfo.bank.account || ''
        } : undefined,

        insurance: vInfo.insurance ? {
          company: vInfo.insurance.company,
          type: vInfo.insurance.type === 'premium' ? 'premium' : 'standard',
          driverAge: vInfo.insurance.driverAge,
          liabilityLimit: vInfo.insurance.liabilityLimit,
          propertyLimit: vInfo.insurance.propertyLimit,
          personalInjury: vInfo.insurance.personalInjury,
          uninsuredInjury: vInfo.insurance.uninsuredInjury,
          deductible: vInfo.insurance.deductible ? (
            typeof vInfo.insurance.deductible === 'number'
              ? vInfo.insurance.deductible
              : (parseInt(String(vInfo.insurance.deductible).replace(/[^0-9]/g, '')) * 10000 || 300000)
          ) : undefined,
          emergencyService: vInfo.maintenance?.emergencyService || vInfo.insurance.emergencyCall
        } : undefined,

        maintenance: vInfo.maintenance ? {
          enabled: vInfo.maintenance.enabled,
          tireType: vInfo.maintenance.tireType,
          mileage: vInfo.maintenance.mileage,
          regularCheck: vInfo.maintenance.regularCheck,
          consumables: vInfo.maintenance.consumables,
          generalMaintenance: vInfo.maintenance.generalMaintenance
        } : undefined
      };
      // Clean undefined properties so we do not overwrite with null
      Object.keys(mappedVehicleInfo).forEach(key => {
        if (mappedVehicleInfo[key] === undefined) {
          delete mappedVehicleInfo[key];
        }
      });
      await Vehicle.findByIdAndUpdate(contract.vehicle, mappedVehicleInfo);
    } else if (!contract.vehicle && req.body.vehicleInfo) {
      // 아직 임시저장 상태 - 차량이 없으니 폼 입력값을 pending 필드에만 담아 둔다
      contract.vehicleInfo = req.body.vehicleInfo;
    }

    const updatedContract = await contract.save();
    const populated = await Contract.findById(updatedContract._id)
      .populate('customer')
      .populate('vehicle')
      .populate('vehicles')
      .populate('companyId', 'name bizNo bizType');
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * 계약서를 고객 폴더에 저장하고 보관 상태로 넘긴다.
 *
 * 계약서 양식(PDF)은 아직 없으므로 지금은 폴더를 갖추고 상태만 넘긴다.
 * 양식이 준비되면 이 자리에서 PDF를 만들어 01.계약서에 넣으면 된다.
 *
 * @route POST /api/contracts/:id/archive
 */
export const archiveContract = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id).populate('customer', 'name').populate('companyId', 'name');
    if (!contract) return res.status(404).json({ message: '계약을 찾을 수 없습니다.' });
    if (contract.status === '보관됨') {
      return res.status(400).json({ message: '이미 보관된 계약입니다.' });
    }

    const partyName = contract.companyId?.name || contract.customer?.name;
    if (!partyName) {
      return res.status(400).json({ message: '계약자명이 없어 폴더를 만들 수 없습니다.' });
    }

    const { root } = await ensureCustomerFolders(partyName);

    contract.status = '보관됨';
    contract.archivedAt = new Date();
    contract.customerFolder = partyName;
    await contract.save();

    res.json({
      success: true,
      folder: root,
      message: `계약서를 보관했습니다. 계약서 목록에서 내려가고, 이 계약의 차량은 수정할 수 없습니다.`
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * 보관한 계약서를 다시 꺼낸다. 목록에 다시 나타나고 차량 수정도 풀린다.
 *
 * @route POST /api/contracts/:id/unarchive
 */
export const unarchiveContract = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ message: '계약을 찾을 수 없습니다.' });
    if (contract.status !== '보관됨') {
      return res.status(400).json({ message: '보관된 계약이 아닙니다.' });
    }
    contract.status = '진행중';
    contract.archivedAt = undefined;
    await contract.save();
    res.json({ success: true, message: '계약서를 되돌렸습니다. 이제 차량 정보를 수정할 수 있습니다.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete contract & its associated schedules (and optionally its vehicle)
// @route   DELETE /api/contracts/:id
// @access  Public
export const deleteContract = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (contract) {
      // Remove associated schedules
      await Schedule.deleteMany({ targetContract: contract._id });
      // 이 계약에 묶인 차량을 모두 지운다 (임시저장 상태라면 아직 차량이 없을 수 있다).
      // vehicles 배열과 Vehicle.contract 양쪽을 다 훑어, 한쪽만 연결된 예전 데이터도 빠뜨리지 않는다.
      const vehicleIds = [...(contract.vehicles || []), contract.vehicle].filter(Boolean);
      if (vehicleIds.length) {
        await Vehicle.deleteMany({ _id: { $in: vehicleIds } });
      }
      await Vehicle.deleteMany({ contract: contract._id });
      // 청구 회차표도 함께 지운다. 남겨 두면 청구 목록에 계약 없는 항목이 뜬다.
      await BillingSchedule.deleteMany({ contract: contract._id });
      // Remove contract
      await Contract.deleteOne({ _id: req.params.id });

      res.json({ message: 'Contract, associated vehicle, and schedules removed successfully' });
    } else {
      res.status(404).json({ message: 'Contract not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Excel Column Definition mapping to match the Contract Registration Form fields
const EXCEL_COLUMNS = [
  // 1. 고객 정보
  { key: 'contractCompany', label: '고객명 (개인/법인명) *' },
  { key: 'bizOrRegNo', label: '사업자/주민번호 *' },
  { key: 'ceoName', label: '대표자명' },
  { key: 'corporateRegNo', label: '법인등록번호' },
  { key: 'email', label: '이메일' },
  { key: 'bizAddress', label: '주소' },
  { key: 'bank', label: '자동이체 은행' },
  { key: 'accountNo', label: '자동이체 계좌번호' },
  { key: 'accountHolder', label: '자동이체 예금주' },
  
  // 2. 차량 정보
  { key: 'carModel', label: '차종 *' },
  { key: 'carSpec', label: '차량 사양' },
  { key: 'carPrice', label: '차량가 (원)' },
  { key: 'fuelType', label: '유종' },
  { key: 'color', label: '외장 색상' },
  { key: 'interiorColor', label: '내장 색상' },
  { key: 'options', label: '옵션' },
  
  // 3. 계약 정보
  { key: 'termMonths', label: '렌트 기간 (개월) *' },
  { key: 'mileage', label: '연간 약정 주행거리 (km)' },
  { key: 'monthlyPayment', label: '월 렌트료 *' },
  { key: 'deposit', label: '보증금 (원)' },
  { key: 'advancePayment', label: '선수금 (원)' },
  { key: 'acquisitionValue', label: '인수가 (원)' },
  { key: 'contractDate', label: '계약일 *' },
  { key: 'practicalManager', label: '계약 담당자' },
  { key: 'practicalPhone', label: '계약 담당자 연락처' },
  { key: 'finesEmail', label: '범칙금 수신 E-MAIL 1' },
  { key: 'finesEmail2', label: '범칙금 수신 E-MAIL 2' },
  { key: 'overdueInterestRate', label: '연체이율 (%)' },
  { key: 'penaltyRate', label: '위약금 (%)' }
];

// Helper to clean header for robust matching
const cleanHeader = (str) => String(str || '').replace(/[\s*()（）[\]]/g, '').toLowerCase();

// Headers & Aliases list for fuzzy/robust mapping
const FIELD_MAPPINGS = [
  { key: 'contractCompany', labels: ['고객명개인/법인명', '고객명', '법인명', '계약사', '계약사/법인명'] },
  { key: 'bizOrRegNo', labels: ['사업자/주민번호', '사업자번호', '사업자등록번호', '주민번호'] },
  { key: 'ceoName', labels: ['대표자명', '대표자'] },
  { key: 'corporateRegNo', labels: ['법인등록번호', '법인식별번호', '법인번호'] },
  { key: 'email', labels: ['이메일', '고객이메일', '이메일주소'] },
  { key: 'bizAddress', labels: ['주소', '법인주소', '사업자주소'] },
  { key: 'bank', labels: ['자동이체은행', '은행', '자동이체 은행'] },
  { key: 'accountNo', labels: ['자동이체계좌번호', '계좌번호', '계좌', '자동이체 계좌번호'] },
  { key: 'accountHolder', labels: ['자동이체예금주', '예금주명', '예금주', '자동이체 예금주'] },
  
  { key: 'carModel', labels: ['차종', '모델명', '차종/모델명'] },
  { key: 'carSpec', labels: ['차량사양', '사양', '차량 사양'] },
  { key: 'carPrice', labels: ['차량가원', '차량가', '차량가격', '차량가 (원)'] },
  { key: 'fuelType', labels: ['유종', '유형'] },
  { key: 'color', labels: ['외장색상', '외장색', '색상', '외장 색상'] },
  { key: 'interiorColor', labels: ['내장색상', '내장색', '내장 색상'] },
  { key: 'options', labels: ['옵션', '차량옵션'] },
  
  { key: 'termMonths', labels: ['렌트기간개월', '렌트기간', '기간개월', '대여기간', '기간', '렌트 기간 (개월)'] },
  { key: 'mileage', labels: ['연간약정주행거리km', '연간약정주행거리', '약정주행거리', '주행거리', '연간 약정 주행거리 (km)'] },
  { key: 'monthlyPayment', labels: ['월렌트료', '대여료', '월대여료', '렌트료', '월 렌트료'] },
  { key: 'deposit', labels: ['보증금원', '보증금', '보증금 (원)'] },
  { key: 'advancePayment', labels: ['선수금원', '선수금', '선수금 (원)'] },
  { key: 'acquisitionValue', labels: ['인수가원', '인수가', '잔존가치', '인수가 (원)'] },
  { key: 'contractDate', labels: ['계약일'] },
  { key: 'practicalManager', labels: ['계약담당자', '담당자', '계약 담당자'] },
  { key: 'practicalPhone', labels: ['계약담당자연락처', '담당자연락처', '연락처', '계약 담당자 연락처'] },
  { key: 'finesEmail', labels: ['범칙금수신e-mail1', '범칙금수신email1', '범칙금이메일1', '범칙금수신이메일1', '범칙금 수신 E-MAIL 1'] },
  { key: 'finesEmail2', labels: ['범칙금수신e-mail2', '범칙금수신email2', '범칙금이메일2', '범칙금수신이메일2', '범칙금 수신 E-MAIL 2'] },
  { key: 'overdueInterestRate', labels: ['연체이율%', '연체이율', '연체이율 (%)'] },
  { key: 'penaltyRate', labels: ['위약금률', '위약금%', '위약금률%', '위약금', '위약금 (%)'] }
];

// Helper: Excel date parsing
const parseExcelDate = (val) => {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'number') {
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(val);
  return isNaN(date.getTime()) ? null : date;
};

// @desc    Download Excel sheet template matching database schema
// @route   GET /api/contracts/template
// @access  Public
export const getContractTemplate = async (req, res) => {
  try {
    const headers = EXCEL_COLUMNS.map(col => col.label);
    const data = [headers];
    
    const worksheet = XLSX.utils.aoa_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '계약대장_양식');
    
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="RentContract_Template.xlsx"');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Import contracts via Excel file upload
// @route   POST /api/contracts/import
// @access  Public
export const importContracts = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '업로드된 파일이 없습니다.' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    if (rawRows.length < 2) {
      return res.status(400).json({ message: '엑셀 데이터가 비어 있습니다.' });
    }

    const headers = rawRows[0];
    // Find the column index for each key based on the header text mapping
    const colIndices = {};
    headers.forEach((header, index) => {
      if (!header) return;
      const cleanH = cleanHeader(header);
      const colDef = FIELD_MAPPINGS.find(def => def.labels.some(lbl => cleanHeader(lbl) === cleanH));
      if (colDef) {
        colIndices[colDef.key] = index;
      }
    });

    // Fallback: If some headers were not matched, map them based on sequential index
    EXCEL_COLUMNS.forEach((col, idx) => {
      if (colIndices[col.key] === undefined) {
        colIndices[col.key] = idx;
      }
    });

    const dataRows = rawRows.slice(1);
    let successCount = 0;

    for (const row of dataRows) {
      if (!row || row.length === 0) continue;

      // Extract row data using resolved column indices
      const rowData = {};
      EXCEL_COLUMNS.forEach(col => {
        const colIdx = colIndices[col.key];
        const val = row[colIdx];
        if (val !== undefined && val !== null) {
          rowData[col.key] = val;
        } else {
          rowData[col.key] = '';
        }
      });

      const {
        contractCompany,
        bizOrRegNo,
        ceoName,
        corporateRegNo,
        email,
        bizAddress,
        bank,
        accountNo,
        accountHolder,
        carModel,
        carSpec,
        carPrice,
        fuelType,
        color,
        interiorColor,
        options,
        termMonths,
        mileage,
        monthlyPayment,
        deposit,
        advancePayment,
        acquisitionValue,
        contractDate,
        practicalManager,
        practicalPhone,
        finesEmail,
        finesEmail2,
        overdueInterestRate,
        penaltyRate
      } = rowData;

      // Essential fields validation
      if (!contractCompany || !carModel) {
        continue; // Skip rows that lack company name or car model
      }

      const finalBizNo = bizOrRegNo || `TEMP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // 1. Find or create Customer
      let customer = await Customer.findOne({ bizNo: finalBizNo.trim() });
      if (!customer) {
        const custCount = await Customer.countDocuments();
        const newCustId = `CUST${String(custCount + 1).padStart(3, '0')}`;
        customer = await Customer.create({
          customerId: newCustId,
          name: contractCompany.trim(),
          bizNo: finalBizNo.trim(),
          ceoName: ceoName || '',
          address: bizAddress || '',
          contactName: practicalManager || ceoName || '',
          contactPhone: practicalPhone || '',
          email: email || finesEmail || 'no-email@rentbenefit.co.kr',
          bank: {
            name: bank || '',
            account: accountNo || '',
            holder: accountHolder || ''
          },
          bizNoTransfer: corporateRegNo || '',
          bizAddress: bizAddress || ''
        });
      }

      // 2. Resolve termMonths
      const termMonthsValue = termMonths ? (parseInt(String(termMonths).replace(/[^0-9]/g, '')) || 36) : 36;
      const contractDateObj = parseExcelDate(contractDate) || new Date();
      
      // 3. Generate contract number (always unique since template is simplified)
      const cId = customer.customerId || 'CUST000';
      const yy = String(contractDateObj.getFullYear()).slice(-2);
      const mm = String(contractDateObj.getMonth() + 1).padStart(2, '0');
      const prefix = `${cId}-${yy}${mm}-`;
      const contractCount = await Contract.countDocuments({ contractNo: new RegExp('^' + prefix) });
      const finalContractNo = `${prefix}${String(contractCount + 1).padStart(2, '0')}`;

      // 4. Generate vehicle code and model
      const cleanModelName = String(carModel).split(' ')[0].replace(/[^a-zA-Z가-힣0-9]/g, '') || 'VEH';
      const vehicleCount = await Vehicle.countDocuments({ code: new RegExp('^' + cleanModelName + '-', 'i') });
      const generatedVehicleCode = `${cleanModelName}-${String(vehicleCount + 1).padStart(3, '0')}`;

      const vehicleData = {
        code: generatedVehicleCode,
        category: '장기',
        operation: '계약진행중',
        contractCompany: customer.name,
        manager: customer.ceoName || '',
        managerPhone: customer.contactPhone || '',
        carModel: carModel,
        carSpec: carSpec || '',
        carPrice: carPrice ? Number(carPrice) : 0,
        year: '', // 등록증을 보고 입력한다. 임의로 채우지 않는다
        color: color || '',
        interiorColor: interiorColor || '',
        fuelType: fuelType || '가솔린',
        vin: '', // 등록증을 보고 입력한다. 임의로 만들어 넣지 않는다
        carNumber: '', // Will be added later in Vehicle DB edit modal
        options: options || '',
        cc: '',
        regDate: '',
        
        contractDate: contractDate ? String(contractDate) : '',
        deliveryDate: '',
        rentPeriodYears: String(Math.round(termMonthsValue / 12)),
        rentEndDate: '',
        remainingPeriod: '',
        mileage: mileage ? Number(mileage) : 0,
        practicalManager: practicalManager || '',
        practicalPhone: practicalPhone || '',
        branch: '',
        deliveryAddress: '',
        rentStartDate: '',
        rentPeriodDays: '',
        remainingPeriodCalc: '',
        contractNo: finalContractNo,
        
        basePrice: 0,
        discountAmount: 0,
        supplyAmount: 0,
        consignmentFee: 0,
        mandatoryInsuranceFee: 0,
        acquisitionTax: 0,
        bond: 0,
        stampFee: 0,
        plateFee: 0,
        regAgencyFee: 0,
        commission: 0,
        dashcam: '설치',
        dashcamInfo: '',
        tinting: '시공',
        tintingInfo: '',
        regCost1: 0,
        regCost2: 0,
        
        insuranceCompany: '삼성화재',
        insuranceStartDate: '',
        insuranceFee: 0,
        ownCarInsuranceFee: 0,
        tire: '',
        regularCheckup: '',
        driverAge: '만 26세 이상',
        personalInjury1: '무제한',
        propertyDamage: '2억원',
        personalInjury2: '자상 1억/부상 1500만',
        uninsuredCarInjury: '2억원',
        deductible: 300000,
        insuranceType: '임직원특약',
        emergencyService: '가입',
        accidentRepair: '',
        generalMaintenance: '',
        consumablesExchange: '',
        tireCount: '',
        tireType: '',
        tireCost: 0,
        carTax: '포함',
        
        lender: '',
        executionDate: '',
        installmentAmount: 0,
        installmentPeriod: '',
        monthlyInstallment: 0,
        totalMonthlyInstallment: 0,
        totalInterest: 0,
        interestRate: '',
        monthlyFeePayDay: '매월 25일',
        invoiceDate: '매월 25일',
        monthlyPayment: monthlyPayment ? Number(monthlyPayment) : 0,
        paymentPeriod: String(termMonthsValue),
        totalMonthlyPayment: 0,
        deposit: deposit ? Number(deposit) : 0,
        advancePayment: advancePayment ? Number(advancePayment) : 0,
        acquisitionValue: acquisitionValue ? Number(acquisitionValue) : 0,
        residualRateP: '',
        interest2: '',
        fineEmail: finesEmail || '',
        managerMobile: '',
        sellingAdminExpense: 0,
        
        gift1: '',
        gift1Price: 0,
        gift2: '',
        gift2Price: 0,
        gift3: '',
        gift3Price: 0,
        gift4: '',
        gift4Price: 0,
        gift5: '',
        gift5Price: 0,
        totalGiftPrice: 0,
        dealerCompany: '',
        salesRepresentative: '',
        showroom: '',
        accountHolder: accountHolder || '',
        bank: bank || '',
        accountNo: accountNo || '',
        bizOrRegNo: finalBizNo || '',
        bizAddress: bizAddress || '',
        penaltyRate: penaltyRate ? String(penaltyRate) : '',
        overdueInterestRate: overdueInterestRate ? String(overdueInterestRate) : '',
        corporateRegNo: corporateRegNo || '',
        individualConsumptionTax: 0,
        status: '장기렌트'
      };

      const vehicle = await Vehicle.create(vehicleData);

      const contractData = {
        contractNo: finalContractNo,
        vehicle: vehicle._id,
        customer: customer._id,
        leaseCompany: contractCompany || '',
        contractDate: contractDateObj,
        deliveryDate: null,
        termMonths: termMonthsValue,
        rentPeriodYears: Math.round(termMonthsValue / 12),
        rentStartDate: null,
        rentPeriodDays: null,
        remainingPeriodCalc: '',
        finesEmail: finesEmail || '',
        finesEmail2: finesEmail2 || '',
        corporateRegistrationNo: corporateRegNo || '',
        status: '진행중',
        pricing: {
          basePrice: 0,
          discount: 0,
          supplyPrice: 0,
          deliveryFee: 0,
          acquisitionTax: 0,
          publicBond: 0,
          stampFee: 0,
          plateFee: 0,
          registrationAgencyFee: 0,
          commission: 0,
          deposit: deposit ? Number(deposit) : 0,
          advancePayment: advancePayment ? Number(advancePayment) : 0,
          takeoverPrice: acquisitionValue ? Number(acquisitionValue) : 0,
          monthlyFee: monthlyPayment ? Number(monthlyPayment) : 0,
          paymentTerm: termMonthsValue,
          monthlyFeeTotal: 0,
          billingDay: 25,
          invoiceDay: 10,
          penaltyRate: penaltyRate ? (parseFloat(String(penaltyRate).replace(/[^0-9.]/g, '')) || 35) : 35,
          overdueRate: overdueInterestRate ? (parseFloat(String(overdueInterestRate).replace(/[^0-9.]/g, '')) || 25) : 25,
          pandanbi: 0,
          individualConsumptionTax: 0
        },
        gifts: []
      };

      const contractInstance = new Contract(contractData);
      const savedContract = await contractInstance.save();

      // Update vehicle with calculated contract end date
      await Vehicle.findByIdAndUpdate(vehicle._id, {
        rentEndDate: savedContract.endDate ? savedContract.endDate.toISOString().split('T')[0] : ''
      });

      // 5. Generate Schedules
      const schedulesToCreate = [];

      // Regular Maintenance: Every 6 months
      const maintenanceIntervals = Math.floor(termMonthsValue / 6);
      for (let i = 1; i <= maintenanceIntervals; i++) {
        const maintenanceDate = new Date(contractDateObj);
        maintenanceDate.setMonth(maintenanceDate.getMonth() + (i * 6));
        schedulesToCreate.push({
          type: '정기점검',
          targetVehicle: vehicle._id,
          targetContract: savedContract._id,
          dueDate: maintenanceDate,
          status: '예정',
          assignee: practicalManager || ceoName || '담당자 미정'
        });
      }

      // Vehicle Inspection
      const inspectionDate = new Date(contractDateObj);
      if (termMonthsValue >= 24) {
        inspectionDate.setMonth(inspectionDate.getMonth() + 24);
        schedulesToCreate.push({
          type: '차량검사',
          targetVehicle: vehicle._id,
          targetContract: savedContract._id,
          dueDate: inspectionDate,
          status: '예정',
          assignee: practicalManager || ceoName || '담당자 미정'
        });
      } else {
        schedulesToCreate.push({
          type: '차량검사',
          targetVehicle: vehicle._id,
          targetContract: savedContract._id,
          dueDate: savedContract.endDate,
          status: '예정',
          assignee: practicalManager || ceoName || '담당자 미정'
        });
      }

      // Rent Expiration
      schedulesToCreate.push({
        type: '렌트만료',
        targetVehicle: vehicle._id,
        targetContract: savedContract._id,
        dueDate: savedContract.endDate,
        status: '예정',
        assignee: ceoName || practicalManager || '담당자 미정'
      });

      // 청구서 발송 일정은 invoiceScheduleJob이 회차표를 보고 잡는다(위 buildContractSchedules 주석 참고).

      if (schedulesToCreate.length > 0) {
        await Schedule.insertMany(schedulesToCreate);
      }

      successCount++;
    }

    res.status(200).json({ success: true, message: `성공적으로 ${successCount}건의 계약을 등록/갱신하였습니다.`, count: successCount });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

