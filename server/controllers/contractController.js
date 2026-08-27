import Contract from '../models/Contract.js';
import Vehicle from '../models/Vehicle.js';
import Customer from '../models/Customer.js';
import Quote from '../models/Quote.js';
import Schedule from '../models/Schedule.js';
import XLSX from 'xlsx';

// @desc    Get all contracts
// @route   GET /api/contracts
// @access  Public
export const getContracts = async (req, res) => {
  try {
    const { search, status } = req.query;
    let query = {};

    if (status) {
      query.status = status;
    }

    const contracts = await Contract.find(query)
      .populate('customer')
      .populate('vehicle')
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
          contract.vehicle.code.toLowerCase().includes(search.toLowerCase()) ||
          contract.vehicle.model.toLowerCase().includes(search.toLowerCase()) ||
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

    if ((!customerId && !req.body.isNewCustomer) || !contractDate || !termMonths || !pricing || !vehicleInfo || !vehicleInfo.model) {
      return res.status(400).json({ message: 'Missing required contract, customer, or vehicle fields' });
    }

    // 1. Auto-generate Vehicle Code & Create Vehicle
    const cleanModelName = vehicleInfo.model.split(' ')[0].replace(/[^a-zA-Z가-힣0-9]/g, '') || 'VEH';
    const vehicleCount = await Vehicle.countDocuments({ code: new RegExp('^' + cleanModelName + '-', 'i') });
    const vehicleCode = `${cleanModelName}-${String(vehicleCount + 1).padStart(3, '0')}`;

    const vehicle = await Vehicle.create({
      code: vehicleCode,
      carModel: vehicleInfo.model,
      carSpec: vehicleInfo.spec,
      fuelType: vehicleInfo.fuelType,
      cc: vehicleInfo.cc,
      exteriorColor: vehicleInfo.color,
      interiorColor: vehicleInfo.colorInterior || '',
      options: vehicleInfo.options || '',

      year: vehicleInfo.year,
      vin: vehicleInfo.vin || '',
      plateNo: vehicleInfo.plateNo || '',
      registrationDate: vehicleInfo.registrationDate || undefined,

      carPrice: vehicleInfo.vehiclePrice || 0,
      monthlyFee: pricing.monthlyFee || 0,

      insurance: {
        company: vehicleInfo.insurance?.company || '삼성화재',
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

      maintenance: {
        enabled: vehicleInfo.maintenance?.enabled !== false,
        tireType: vehicleInfo.maintenance?.tireType || '',
        mileage: vehicleInfo.maintenance?.mileage || vehicleInfo.mileage || 0,
        regularCheck: vehicleInfo.maintenance?.regularCheck || '미가입',
        consumables: vehicleInfo.maintenance?.consumables || '미가입',
        generalMaintenance: vehicleInfo.maintenance?.generalMaintenance || '미가입'
      },

      status: 'rented',
      currentMileage: vehicleInfo.mileage || 0,

      // 출고 준비 화면에서 그대로 쓸 수 있도록 견적/계약에서 정해진 금리·수수료·판관비를 미리 채워둔다
      interestRate: pricing?.baseInterestRate,
      companyCommission: pricing?.commission,
      dealerCommission: pricing?.dealerCommission,
      sellingAdminExpense: pricing?.pandanbi
    });

    // 2. Resolve Customer (Select existing or Create new, and optionally update)
    let customer;
    if (req.body.isNewCustomer) {
      const { name, bizNo, ceoName, address, contactName, contactPhone, email, bank, bizNoTransfer, bizAddress } = req.body.customerInfo || {};
      
      if (!name || !bizNo) {
        return res.status(400).json({ message: '신규 고객 등록을 위해 고객명과 사업자/주민번호는 필수입니다.' });
      }

      // Check if duplicate bizNo exists
      const customerExists = await Customer.findOne({ bizNo });
      if (customerExists) {
        return res.status(400).json({ message: '이미 동일한 사업자/주민번호로 등록된 고객이 존재합니다.' });
      }

      const count = await Customer.countDocuments();
      const newCustId = `CUST${String(count + 1).padStart(3, '0')}`;

      customer = await Customer.create({
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
    } else {
      customer = await Customer.findById(customerId);
      if (!customer) {
        return res.status(404).json({ message: 'Customer not found' });
      }

      // Update customer details if customerInfo is passed (enabling updates directly from the form)
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
    }
    const cId = customer.customerId || 'CUST000';
    const finalCustomerId = customer._id;

    const contractDateObj = new Date(contractDate);
    const yy = String(contractDateObj.getFullYear()).slice(-2);
    const mm = String(contractDateObj.getMonth() + 1).padStart(2, '0');
    const prefix = `${cId}-${yy}${mm}-`;
    const contractCount = await Contract.countDocuments({ contractNo: new RegExp('^' + prefix) });
    const contractNo = `${prefix}${String(contractCount + 1).padStart(2, '0')}`;

    // 3. Create Contract
    const contract = new Contract({
      contractNo,
      vehicle: vehicle._id,
      customer: finalCustomerId,
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
      corporateRegistrationNo: req.body.corporateRegistrationNo,

      pricing,
      gifts: gifts || []
    });

    const savedContract = await contract.save(); // pre-save calculates endDate

    // 3.5. 방금 만든 계약과 차량을 서로 연결 (차량 생성 시점엔 계약이 아직 없어 나중에 연결)
    await Vehicle.findByIdAndUpdate(vehicle._id, { contract: savedContract._id });

    // 4. Auto-generate Schedules (SCHEDULE 자동 생성)
    const schedulesToCreate = [];

    // Regular Maintenance: Every 6 months
    const maintenanceIntervals = Math.floor(termMonths / 6);
    for (let i = 1; i <= maintenanceIntervals; i++) {
      const maintenanceDate = new Date(contractDateObj);
      maintenanceDate.setMonth(maintenanceDate.getMonth() + (i * 6));
      schedulesToCreate.push({
        type: '정기점검',
        targetVehicle: vehicle._id,
        targetContract: savedContract._id,
        dueDate: maintenanceDate,
        status: '예정',
        assignee: managerOps || managerMain || '담당자 미정'
      });
    }

    // Vehicle Inspection: Month 24 (or term end if shorter than 24 months)
    const inspectionDate = new Date(contractDateObj);
    if (termMonths >= 24) {
      inspectionDate.setMonth(inspectionDate.getMonth() + 24);
      schedulesToCreate.push({
        type: '차량검사',
        targetVehicle: vehicle._id,
        targetContract: savedContract._id,
        dueDate: inspectionDate,
        status: '예정',
        assignee: managerOps || managerMain || '담당자 미정'
      });
    } else {
      schedulesToCreate.push({
        type: '차량검사',
        targetVehicle: vehicle._id,
        targetContract: savedContract._id,
        dueDate: savedContract.endDate,
        status: '예정',
        assignee: managerOps || managerMain || '담당자 미정'
      });
    }

    // Rent Expiration: At endDate
    schedulesToCreate.push({
      type: '렌트만료',
      targetVehicle: vehicle._id,
      targetContract: savedContract._id,
      dueDate: savedContract.endDate,
      status: '예정',
      assignee: managerMain || '담당자 미정'
    });

    // Invoice Dispatch: Monthly on invoiceDay (or contract start date day)
    const invoiceDay = pricing.invoiceDay || contractDateObj.getDate();
    for (let m = 1; m <= termMonths; m++) {
      const invoiceDate = new Date(contractDateObj);
      invoiceDate.setMonth(invoiceDate.getMonth() + m - 1);
      // Adjust invoice day
      invoiceDate.setDate(invoiceDay);
      // If invoice day is greater than actual days in that month, it rolls over, which is fine or handles automatically by JS
      schedulesToCreate.push({
        type: '청구서발송',
        targetVehicle: vehicle._id,
        targetContract: savedContract._id,
        dueDate: invoiceDate,
        status: '예정',
        assignee: managerOps || '담당자 미정'
      });
    }

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
      .populate('companyId', 'name bizNo bizType');

    res.status(201).json(populatedContract);
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

    if (contract) {
      contract.leaseCompany = req.body.leaseCompany !== undefined ? req.body.leaseCompany : contract.leaseCompany;
      contract.contractDate = req.body.contractDate !== undefined ? new Date(req.body.contractDate) : contract.contractDate;
      contract.deliveryDate = req.body.deliveryDate !== undefined ? req.body.deliveryDate : contract.deliveryDate;
      contract.termMonths = req.body.termMonths !== undefined ? req.body.termMonths : contract.termMonths;
      contract.branch = req.body.branch !== undefined ? req.body.branch : contract.branch;
      contract.managerMain = req.body.managerMain !== undefined ? req.body.managerMain : contract.managerMain;
      contract.managerMainPhone = req.body.managerMainPhone !== undefined ? req.body.managerMainPhone : contract.managerMainPhone;
      contract.managerOps = req.body.managerOps !== undefined ? req.body.managerOps : contract.managerOps;
      contract.managerOpsPhone = req.body.managerOpsPhone !== undefined ? req.body.managerOpsPhone : contract.managerOpsPhone;
      
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

      // Update associated vehicle if vehicleInfo is supplied
      if (req.body.vehicleInfo) {
        const vInfo = req.body.vehicleInfo;
        const mappedVehicleInfo = {
          carModel: vInfo.model,
          carSpec: vInfo.spec,
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
      }

      // Update associated customer if customerInfo is supplied
      if (req.body.customerInfo) {
        await Customer.findByIdAndUpdate(contract.customer, req.body.customerInfo);
      }

      const updatedContract = await contract.save();
      const populated = await Contract.findById(updatedContract._id)
        .populate('customer')
        .populate('vehicle');
      res.json(populated);
    } else {
      res.status(404).json({ message: 'Contract not found' });
    }
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
      // Remove vehicle
      await Vehicle.deleteOne({ _id: contract.vehicle });
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
        year: '2024년식', // Default
        color: color || '',
        interiorColor: interiorColor || '',
        fuelType: fuelType || '가솔린',
        vin: 'VIN_AUTO_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
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
        status: 'rented'
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

      // Invoice Dispatch: Monthly on invoiceDay
      const invoiceDay = savedContract.pricing.invoiceDay || contractDateObj.getDate();
      for (let m = 1; m <= termMonthsValue; m++) {
        const invoiceDate = new Date(contractDateObj);
        invoiceDate.setMonth(invoiceDate.getMonth() + m - 1);
        invoiceDate.setDate(invoiceDay);
        schedulesToCreate.push({
          type: '청구서발송',
          targetVehicle: vehicle._id,
          targetContract: savedContract._id,
          dueDate: invoiceDate,
          status: '예정',
          assignee: practicalManager || '담당자 미정'
        });
      }

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

