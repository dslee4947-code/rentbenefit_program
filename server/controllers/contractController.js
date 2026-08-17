import Contract from '../models/Contract.js';
import Vehicle from '../models/Vehicle.js';
import Customer from '../models/Customer.js';
import Quote from '../models/Quote.js';
import Schedule from '../models/Schedule.js';

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
      .sort({ createdAt: -1 });

    if (search) {
      const filtered = contracts.filter(contract => {
        const matchesCustomer = contract.customer && (
          contract.customer.name.toLowerCase().includes(search.toLowerCase()) ||
          contract.customer.bizNo.includes(search)
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
      .populate('quote');
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
      year: vehicleInfo.year,
      color: vehicleInfo.color,
      interiorColor: vehicleInfo.colorInterior || '',
      fuelType: vehicleInfo.fuelType,
      cc: vehicleInfo.cc,
      vin: vehicleInfo.vin || ('AUTO_VIN_' + Date.now()),
      carNumber: vehicleInfo.plateNo || '',
      options: vehicleInfo.options || '',
      releaseAddress: vehicleInfo.releaseAddress,
      dealer: vehicleInfo.dealer,
      salesRep: vehicleInfo.salesRep,
      showroom: vehicleInfo.showroom,
      manager: req.body.customerInfo?.ceoName || '',
      managerPhone: req.body.customerInfo?.contactPhone || '',
      
      // New columns mapping
      classification: vehicleCode,
      operationType: vehicleInfo.operationType,
      carPrice: vehicleInfo.vehiclePrice || 0,
      registrationDate: vehicleInfo.registrationDate,
      mileage: vehicleInfo.mileage,

      // Flat mapping for Insurance
      insuranceCompany: vehicleInfo.insurance?.company || '삼성화재',
      driverAge: vehicleInfo.insurance?.driverAge || '만 26세 이상',
      personalInjury1: vehicleInfo.insurance?.liabilityLimit || '무제한',
      propertyDamage: vehicleInfo.insurance?.propertyLimit || '1억원',
      personalInjury2: vehicleInfo.insurance?.personalInjury || '1억원',
      uninsuredCarInjury: vehicleInfo.insurance?.uninsuredInjury || '2억원',
      deductible: vehicleInfo.insurance?.deductible ? (
        typeof vehicleInfo.insurance.deductible === 'number'
          ? vehicleInfo.insurance.deductible
          : (parseInt(String(vehicleInfo.insurance.deductible).replace(/[^0-9]/g, '')) * 10000 || 300000)
      ) : 300000,
      insuranceType: vehicleInfo.insurance?.type || '임직원특약',
      emergencyService: vehicleInfo.maintenance?.emergencyService || vehicleInfo.insurance?.emergencyCall || '가입',
      
      // Flat mapping for Maintenance
      regularCheckup: vehicleInfo.maintenance?.regularCheck || '미가입',
      generalMaintenance: vehicleInfo.maintenance?.generalMaintenance || '미가입',
      consumablesExchange: vehicleInfo.maintenance?.consumables || '미가입',
      tireCount: vehicleInfo.maintenance?.tireCount || '미가입',
      
      accessories: vehicleInfo.accessories || {},
      registrationCosts: vehicleInfo.registrationCosts || {},
      tax: vehicleInfo.tax || {},
      loan: vehicleInfo.loan || {}
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

    // 3.5. Update associated vehicle details & mark as "계약진행중"
    await Vehicle.findByIdAndUpdate(vehicle._id, {
      operation: '계약진행중',
      contractCompany: customer.name,
      manager: customer.ceoName || '',
      managerPhone: customer.contactPhone || '',
      contractNo: contractNo,
      contractDate: contractDate,
      rentEndDate: savedContract.endDate ? savedContract.endDate.toISOString().split('T')[0] : '',
      paymentPeriod: String(termMonths),
      rentPeriodYears: String(Math.round(termMonths / 12))
    });

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
      .populate('vehicle');

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
          color: vInfo.color,
          interiorColor: vInfo.colorInterior,
          fuelType: vInfo.fuelType,
          options: vInfo.options,
          vin: vInfo.vin,
          carNumber: vInfo.plateNo,
          contractCompany: req.body.customerInfo?.name,
          mileage: vInfo.mileage !== undefined ? Number(vInfo.mileage) : undefined,
          manager: req.body.customerInfo?.ceoName,
          managerPhone: req.body.customerInfo?.contactPhone,
          
          // 평면 보험 정보 매핑
          insuranceCompany: vInfo.insurance?.company,
          driverAge: vInfo.insurance?.driverAge,
          personalInjury1: vInfo.insurance?.liabilityLimit,
          propertyDamage: vInfo.insurance?.propertyLimit,
          personalInjury2: vInfo.insurance?.personalInjury,
          uninsuredCarInjury: vInfo.insurance?.uninsuredInjury,
          deductible: vInfo.insurance?.deductible ? (
            typeof vInfo.insurance.deductible === 'number' 
              ? vInfo.insurance.deductible 
              : (parseInt(String(vInfo.insurance.deductible).replace(/[^0-9]/g, '')) * 10000 || 300000)
          ) : undefined,
          insuranceType: vInfo.insurance?.type,
          emergencyService: vInfo.maintenance?.emergencyService || vInfo.insurance?.emergencyCall,
          
          // 평면 정비 정보 매핑
          regularCheckup: vInfo.maintenance?.regularCheck,
          generalMaintenance: vInfo.maintenance?.generalMaintenance,
          consumablesExchange: vInfo.maintenance?.consumables,
          tireCount: vInfo.maintenance?.tireCount
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
