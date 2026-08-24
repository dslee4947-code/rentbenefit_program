import React, { useState, useEffect } from 'react';
import { Save, Plus, Trash2, FileSignature, ChevronDown, ChevronUp, ArrowLeft, UserPlus, Users } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

function ContractRegisterView({ prefilledQuoteData, setPrefilledQuoteData, prefilledContractData, setPrefilledContractData, setActiveTab, showToast, currentUser }) {
  const [customers, setCustomers] = useState([]);
  const [contracts, setContracts] = useState([]);
  
  // Section Accordion Toggles
  const [expanded, setExpanded] = useState({
    customer: true,
    contract: true,
    vehicle: true,
    pricing: true,
    insurance: false,
    maintenance: false,
    loan: false,
    gifts: false
  });

  const toggleSection = (section) => {
    setExpanded(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // 1. Customer Input States (Search/Autocomplete vs New Customer Mode)
  const [customerId, setCustomerId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  
  const [customerName, setCustomerName] = useState('');
  const [customerBizNo, setCustomerBizNo] = useState('');
  const [customerCeoName, setCustomerCeoName] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerContactName, setCustomerContactName] = useState('');
  const [customerContactPhone, setCustomerContactPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerBankName, setCustomerBankName] = useState('');
  const [customerBankAccount, setCustomerBankAccount] = useState('');
  const [customerBankHolder, setCustomerBankHolder] = useState('');
  const [customerBizNoTransfer, setCustomerBizNoTransfer] = useState('');
  const [customerBizAddress, setCustomerBizAddress] = useState('');

  // 2. Contract Main Fields
  const [leaseCompany, setLeaseCompany] = useState('');
  const [contractDate, setContractDate] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [termMonths, setTermMonths] = useState('24');
  const [branch, setBranch] = useState('서울지점');
  const [managerMain, setManagerMain] = useState('이두식');
  const [managerMainPhone, setManagerMainPhone] = useState('');
  const [managerOps, setManagerOps] = useState('홍길동');
  const [managerOpsPhone, setManagerOpsPhone] = useState('');
  const [status, setStatus] = useState('진행중');

  // Additional Contract Fields
  const [rentPeriodYears, setRentPeriodYears] = useState('');
  const [rentStartDate, setRentStartDate] = useState('');
  const [rentPeriodDays, setRentPeriodDays] = useState('');
  const [remainingPeriodCalc, setRemainingPeriodCalc] = useState('');
  const [finesEmail, setFinesEmail] = useState('');
  const [finesEmail2, setFinesEmail2] = useState('');
  const [corporateRegistrationNo, setCorporateRegistrationNo] = useState('');

  // 3. Vehicle Fields
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleSpec, setVehicleSpec] = useState('');
  const [vehicleYear, setVehicleYear] = useState(new Date().getFullYear());
  const [vehicleColor, setVehicleColor] = useState('');
  const [vehicleColorInterior, setVehicleColorInterior] = useState('');
  const [vehicleFuelType, setVehicleFuelType] = useState('가솔린');
  const [vehicleCc, setVehicleCc] = useState('');
  const [vehicleVin, setVehicleVin] = useState('');
  const [vehiclePlateNo, setVehiclePlateNo] = useState('');
  const [vehicleOptions, setVehicleOptions] = useState('');
  const [releaseAddress, setReleaseAddress] = useState('');
  const [dealer, setDealer] = useState('');
  const [salesRep, setSalesRep] = useState('');
  const [showroom, setShowroom] = useState('');

  // New Vehicle Fields
  const [classification, setClassification] = useState('');
  const [operationType, setOperationType] = useState('');
  const [vehiclePrice, setVehiclePrice] = useState('');
  const [registrationDate, setRegistrationDate] = useState('');
  const [mileage, setMileage] = useState('');

  // Vehicle Accessories
  const [accessories, setAccessories] = useState({
    blackbox: '',
    blackboxInfo: '',
    tinting: '',
    tintingInfo: ''
  });

  // Vehicle Registration Costs
  const [registrationCosts, setRegistrationCosts] = useState({
    cost1: '',
    cost2: ''
  });

  // New States for presets and quantity
  const [contractQuantity, setContractQuantity] = useState('1');
  const [insurancePreset, setInsurancePreset] = useState('보험1');
  const [maintenancePreset, setMaintenancePreset] = useState('미포함');

  // Excel upload states & handlers
  const [excelFile, setExcelFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleExcelTemplateDownload = () => {
    window.open(`${API_HOST}/api/contracts/template`, '_blank');
  };

  const handleExcelUpload = async () => {
    if (!excelFile) {
      showToast('업로드할 엑셀 파일을 선택해주세요.', 'error');
      return;
    }
    
    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', excelFile);

    try {
      const response = await fetch(`${API_HOST}/api/contracts/import`, {
        method: 'POST',
        headers: {
          'X-User-Role': currentUser?.role || 'viewer'
        },
        body: formData
      });

      const result = await response.json();
      if (response.ok) {
        showToast(result.message || '엑셀 데이터가 성공적으로 등록되었습니다.', 'success');
        setExcelFile(null);
        setActiveTab('contracts');
      } else {
        showToast(result.message || '엑셀 업로드에 실패했습니다.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 연결 실패', 'error');
    } finally {
      setIsUploading(false);
    }
  };

  // Vehicle Insurance
  const [insurance, setInsurance] = useState({
    company: '가입',
    startDate: '',
    fee: '',
    selfCoverage: '',
    driverAge: '만26세이상',
    liabilityLimit: '무제한',
    propertyLimit: '2억원',
    personalInjury: '자상 1억/부상 1500만',
    uninsuredInjury: '2억원/ 1인당',
    deductible: '30만원',
    type: '임직원',
    emergencyCall: '포함',
    accidentRepair: '',
    generalMaintenance: ''
  });

  // Vehicle Maintenance
  const [maintenance, setMaintenance] = useState({
    consumables: '미가입',
    tireCount: '미가입',
    tireSpec: '',
    tireCost: '',
    regularCheck: '미가입',
    emergencyService: '미가입',
    generalMaintenance: '미가입'
  });

  // Vehicle Tax
  const [tax, setTax] = useState({
    carTax: ''
  });

  // Vehicle Loan/Installments
  const [loan, setLoan] = useState({
    source: '',
    executionDate: '',
    amount: '',
    term: '',
    monthlyPayment: '',
    monthlyPaymentTotal: '',
    totalInterest: '',
    interestRate: ''
  });



  // 4. Pricing details
  const [pricing, setPricing] = useState({
    basePrice: '',
    discount: '',
    supplyPrice: '',
    deliveryFee: '',
    acquisitionTax: '',
    publicBond: '',
    stampFee: '',
    plateFee: '',
    registrationAgencyFee: '',
    commission: '',
    deposit: '',
    advancePayment: '',
    takeoverPrice: '',
    monthlyFee: '',
    billingDay: '10',
    invoiceDay: '10',
    penaltyRate: '10',
    overdueRate: '15',
    
    // New Pricing Fields
    paymentTerm: '',
    monthlyFeeTotal: '',
    pandanbi: '',
    individualConsumptionTax: ''
  });

  // 5. Gifts sub list
  const [gifts, setGifts] = useState([{ name: '', price: '' }]);

  // Preset handlers for Insurance and Maintenance (called on direct user change)
  const applyInsurancePreset = (preset) => {
    if (preset === '보험1') {
      setInsurance({
        liabilityLimit: '무제한',
        propertyLimit: '2억원',
        personalInjury: '자상 1억/부상 1500만',
        deductible: '30만원',
        uninsuredInjury: '2억원/ 1인당',
        emergencyCall: '포함'
      });
    } else if (preset === '보험2') {
      setInsurance({
        liabilityLimit: '무제한',
        propertyLimit: '5억원',
        personalInjury: '자상 2억/부상 3000만',
        deductible: '50만원',
        uninsuredInjury: '2억원/ 1인당',
        emergencyCall: '포함'
      });
    }
  };

  const applyMaintenancePreset = (preset) => {
    if (preset === '포함') {
      setMaintenance({
        consumables: '가입',
        tireCount: '계약 기간 동안 4본 제공',
        regularCheck: '가입',
        emergencyService: '가입',
        generalMaintenance: '가입'
      });
    } else {
      setMaintenance({
        consumables: '미가입',
        tireCount: '미가입',
        regularCheck: '미가입',
        emergencyService: '미가입',
        generalMaintenance: '미가입'
      });
    }
  };

  // 1. Prefill / Edit Mode handler for Contracts
  useEffect(() => {
    if (!prefilledContractData) return;

    // 1-1. Customer Info
    const cust = prefilledContractData.customer || {};
    setCustomerId(cust._id || '');
    setCustomerName(cust.name || '');
    setCustomerBizNo(cust.bizNo || '');
    setCustomerCeoName(cust.ceoName || '');
    setCustomerBizNoTransfer(cust.bizNoTransfer || '');
    setCustomerBizAddress(cust.bizAddress || '');
    setCustomerEmail(cust.email || '');
    setCustomerBankName(cust.bank?.name || '');
    setCustomerBankAccount(cust.bank?.account || '');
    setCustomerBankHolder(cust.bank?.holder || '');
    setIsNewCustomer(false);

    // 1-2. Main Contract Fields
    if (prefilledContractData.contractDate) {
      const dateObj = new Date(prefilledContractData.contractDate);
      if (!isNaN(dateObj.getTime())) {
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        setContractDate(`${yyyy}-${mm}-${dd}`);
      } else {
        setContractDate('');
      }
    } else {
      setContractDate('');
    }
    setTermMonths(String(prefilledContractData.termMonths || '24'));
    setManagerOps(prefilledContractData.managerOps || '');
    setManagerOpsPhone(prefilledContractData.managerOpsPhone || '');
    setFinesEmail(prefilledContractData.finesEmail || '');
    setFinesEmail2(prefilledContractData.finesEmail2 || '');
    setStatus(prefilledContractData.status || '진행중');

    // 1-3. Pricing Info
    if (prefilledContractData.pricing) {
      setPricing(prev => ({
        ...prev,
        ...prefilledContractData.pricing
      }));
    }

    // 1-4. Vehicle Info
    const veh = prefilledContractData.vehicle || {};
    setVehicleModel(veh.model || veh.carModel || '');
    setVehicleSpec(veh.spec || veh.carSpec || '');
    setVehiclePrice(veh.vehiclePrice || veh.carPrice || '');
    setVehicleFuelType(veh.fuelType || '가솔린');
    setVehicleColor(veh.color || '');
    setVehicleColorInterior(veh.interiorColor || '');
    setVehicleOptions(veh.options || '');
    setMileage(veh.mileage !== undefined ? String(veh.mileage) : '');

    // 1-5. Insurance Flat Field to Nested State Reverse Mapping
    const propertyLimit = veh.propertyDamage || '2억원';
    if (propertyLimit === '5억원' || propertyLimit === '5억') {
      setInsurancePreset('보험2');
    } else {
      setInsurancePreset('보험1');
    }

    setInsurance({
      liabilityLimit: veh.personalInjury1 || '무제한',
      propertyLimit: veh.propertyDamage || '2억원',
      personalInjury: veh.personalInjury2 || '자상 1억/부상 1500만',
      deductible: veh.deductible ? (veh.deductible >= 500000 ? '50만원' : '30만원') : '30만원',
      uninsuredInjury: veh.uninsuredCarInjury || '2억원/ 1인당',
      emergencyCall: veh.emergencyService || '포함'
    });

    // 1-6. Maintenance Flat Field to Nested State Reverse Mapping
    const consumables = veh.consumablesExchange || '미가입';
    if (consumables === '가입' || consumables === '포함') {
      setMaintenancePreset('포함');
    } else {
      setMaintenancePreset('미포함');
    }

    setMaintenance({
      consumables: veh.consumablesExchange || '미가입',
      tireCount: veh.tireCount || '미가입',
      regularCheck: veh.regularCheckup || '미가입',
      emergencyService: veh.emergencyService || '미가입',
      generalMaintenance: veh.generalMaintenance || '미가입'
    });

    if (prefilledContractData.gifts) {
      setGifts(prefilledContractData.gifts);
    }
  }, [prefilledContractData]);

  // Fetch Customers, Contracts, and Vehicles, then merge corporate lists
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [resCustomers, resContracts, resVehicles] = await Promise.all([
          fetch(`${API_HOST}/api/customers?all=true`),
          fetch(`${API_HOST}/api/contracts`),
          fetch(`${API_HOST}/api/vehicles?limit=10000`)
        ]);
        
        let customerData = [];
        if (resCustomers.ok) {
          customerData = await resCustomers.json();
          customerData = Array.isArray(customerData) ? customerData : (customerData.customers || []);
        }
        
        let vehicleData = [];
        if (resVehicles.ok) {
          const vehicleJson = await resVehicles.json();
          vehicleData = Array.isArray(vehicleJson) ? vehicleJson : (vehicleJson.vehicles || []);
        }

        // 1. 차량 DB 데이터로부터 계약사(법인) 고유 정보 추출
        const companyMap = new Map();
        vehicleData.forEach(v => {
          if (!v.contractCompany || !v.contractCompany.trim()) return;
          const compName = v.contractCompany.trim();
          
          if (!companyMap.has(compName)) {
            companyMap.set(compName, {
              _id: `VEH-COMP-${compName}`,
              customerId: '', // 차량 DB에서 온 임시 데이터이므로 빈 ID 지정
              name: compName,
              bizNo: v.bizOrRegNo || '',
              ceoName: '',
              address: v.bizAddress || '',
              contactName: v.manager || '',
              contactPhone: v.managerPhone || '',
              email: v.fineEmail || '',
              bank: {
                name: v.bank || '',
                account: v.accountNo || '',
                holder: v.accountHolder || ''
              },
              bizNoTransfer: v.corporateRegNo || '',
              bizAddress: v.bizAddress || '',
              source: 'vehicle_db'
            });
          } else {
            // 더 풍부한 데이터가 있으면 갱신
            const existing = companyMap.get(compName);
            if (!existing.bizNo && v.bizOrRegNo) existing.bizNo = v.bizOrRegNo;
            if (!existing.address && v.bizAddress) {
              existing.address = v.bizAddress;
              existing.bizAddress = v.bizAddress;
            }
            if (!existing.contactName && v.manager) {
              existing.contactName = v.manager;
              existing.contactPhone = v.managerPhone;
            }
            if (!existing.email && v.fineEmail) existing.email = v.fineEmail;
            if (!existing.bank.name && v.bank) {
              existing.bank.name = v.bank;
              existing.bank.account = v.accountNo;
              existing.bank.holder = v.accountHolder;
            }
            if (!existing.bizNoTransfer && v.corporateRegNo) existing.bizNoTransfer = v.corporateRegNo;
            companyMap.set(compName, existing);
          }
        });

        // 2. 고객 DB를 배제하고 오직 차량 DB에서 추출한 계약사(법인) 목록만 검색 풀에 적재
        setCustomers(Array.from(companyMap.values()));
        
        if (resContracts.ok) {
          const contractData = await resContracts.json();
          setContracts(contractData);
        }
        
        if (prefilledQuoteData) {
           const quoteCustId = prefilledQuoteData.customer?._id || prefilledQuoteData.customer || '';
           setCustomerId(quoteCustId);
           
           const cust = customerData.find(c => c._id === quoteCustId);
          if (cust) {
            populateCustomerFields(cust);
            setSearchQuery(cust.name);
          }
          
          setVehicleModel(prefilledQuoteData.vehicleModel || '');
          setVehicleSpec(prefilledQuoteData.vehicleSpec || '');
          
          if (prefilledQuoteData.pricing) {
            setPricing(prev => ({
              ...prev,
              ...prefilledQuoteData.pricing
            }));
            if (prefilledQuoteData.pricing.paymentTerm) {
              setTermMonths(String(prefilledQuoteData.pricing.paymentTerm));
            }
          } else {
            if (prefilledQuoteData.totalPrice) {
              setPricing(prev => ({
                ...prev,
                basePrice: prefilledQuoteData.totalPrice,
                supplyPrice: prefilledQuoteData.totalPrice
              }));
            }

            if (prefilledQuoteData.monthlyEstimates && prefilledQuoteData.monthlyEstimates.length > 0) {
              const est24 = prefilledQuoteData.monthlyEstimates.find(e => e.termMonths === 24);
              if (est24) {
                setPricing(prev => ({ ...prev, monthlyFee: est24.monthlyFee }));
                setTermMonths('24');
              } else {
                setPricing(prev => ({ ...prev, monthlyFee: prefilledQuoteData.monthlyEstimates[0].monthlyFee }));
                setTermMonths(String(prefilledQuoteData.monthlyEstimates[0].termMonths));
              }
            }
          }
        } else if (prefilledContractData) {
          // 계약 수정 모드인 경우 자동 법인 주입 제외
        } else if (companyMap.size > 0) {
          const firstComp = Array.from(companyMap.values())[0];
          setCustomerId(firstComp._id);
          populateCustomerFields(firstComp);
          setSearchQuery(firstComp.name);
        }
      } catch (err) {
        console.error('Failed to load initial data', err);
      }
    };
    fetchData();
  }, [prefilledQuoteData, prefilledContractData]);

  const populateCustomerFields = (cust) => {
    setCustomerName(cust.name || '');
    setCustomerBizNo(cust.bizNo || '');
    setCustomerCeoName(cust.ceoName || '');
    setCustomerAddress(cust.address || '');
    setCustomerContactName(cust.contactName || '');
    setCustomerContactPhone(cust.contactPhone || '');
    setCustomerEmail(cust.email || '');
    setCustomerBankName(cust.bank?.name || '');
    setCustomerBankAccount(cust.bank?.account || '');
    setCustomerBankHolder(cust.bank?.holder || '');
    setCustomerBizNoTransfer(cust.bizNoTransfer || '');
    setCustomerBizAddress(cust.bizAddress || '');
  };

  const clearCustomerFields = () => {
    setCustomerName('');
    setCustomerBizNo('');
    setCustomerCeoName('');
    setCustomerAddress('');
    setCustomerContactName('');
    setCustomerContactPhone('');
    setCustomerEmail('');
    setCustomerBankName('');
    setCustomerBankAccount('');
    setCustomerBankHolder('');
    setCustomerBizNoTransfer('');
    setCustomerBizAddress('');
  };

  const resetAllStates = () => {
    setCustomerId('');
    setSearchQuery('');
    setShowSuggestions(false);
    setIsNewCustomer(false);
    
    setCustomerName('');
    setCustomerBizNo('');
    setCustomerCeoName('');
    setCustomerBizNoTransfer('');
    setCustomerBizAddress('');
    setCustomerEmail('');
    setCustomerBankName('');
    setCustomerBankAccount('');
    setCustomerBankHolder('');

    setContractDate('');
    setTermMonths('24');
    setManagerOps('홍길동');
    setManagerOpsPhone('');
    setFinesEmail('');
    setFinesEmail2('');
    
    setVehicleModel('');
    setVehicleSpec('');
    setVehiclePrice('');
    setVehicleFuelType('가솔린');
    setVehicleColor('');
    setVehicleColorInterior('');
    setVehicleOptions('');
    setMileage('');

    setInsurancePreset('보험1');
    setMaintenancePreset('미포함');

    setPricing({
      basePrice: '',
      discount: '',
      supplyPrice: '',
      deliveryFee: '',
      acquisitionTax: '',
      publicBond: '',
      stampFee: '',
      plateFee: '',
      registrationAgencyFee: '',
      commission: '',
      deposit: '',
      advancePayment: '',
      takeoverPrice: '',
      monthlyFee: '',
      billingDay: '10',
      invoiceDay: '10',
      penaltyRate: '10',
      overdueRate: '15',
      paymentTerm: '',
      monthlyFeeTotal: '',
      pandanbi: '',
      individualConsumptionTax: ''
    });

    setGifts([{ name: '', price: '' }]);
  };



  const handlePricingChange = (field, value) => {
    setPricing(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleNestedChange = (setter, field, value) => {
    setter(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleAddGift = () => {
    setGifts(prev => [...prev, { name: '', price: '' }]);
  };

  const handleGiftChange = (index, field, value) => {
    const updated = [...gifts];
    updated[index][field] = value;
    setGifts(updated);
  };

  const handleRemoveGift = (index) => {
    setGifts(prev => prev.filter((_, i) => i !== index));
  };



  const handleRegisterContract = async (e) => {
    e.preventDefault();

    if (currentUser?.role === 'viewer') {
      showToast('수정 및 등록 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }

    if (!isNewCustomer && !customerId) {
      showToast('검색창에서 고객을 선택해 주셔야 등록이 가능합니다.', 'error');
      return;
    }
    if (isNewCustomer && (!customerName.trim() || !customerBizNo.trim())) {
      showToast('신규 고객의 고객명과 사업자번호는 필수 입력입니다.', 'error');
      return;
    }
    if (!contractDate) {
      showToast('계약일을 입력해주세요.', 'error');
      return;
    }
    if (!termMonths) {
      showToast('렌트 기간을 입력해주세요.', 'error');
      return;
    }
    if (!vehicleModel.trim()) {
      showToast('차종 / 사양을 입력해주세요.', 'error');
      return;
    }
    if (!pricing.monthlyFee) {
      showToast('월 렌트료는 필수 입력값입니다.', 'error');
      return;
    }

    try {
      const payload = {
        isNewCustomer,
        customerId: isNewCustomer ? undefined : customerId,
        quantity: Number(contractQuantity),
        insurancePreset,
        maintenancePreset,
        customerInfo: {
          name: customerName,
          bizNo: customerBizNo,
          ceoName: customerCeoName,
          address: customerBizAddress,
          contactName: customerContactName,
          contactPhone: customerContactPhone,
          email: customerEmail || 'no-email@rentbenefit.co.kr',
          bank: {
            name: customerBankName,
            account: customerBankAccount,
            holder: customerBankHolder
          },
          bizNoTransfer: customerBizNoTransfer,
          bizAddress: customerBizAddress
        },
        quoteId: prefilledQuoteData?._id || undefined,
        // 견적서에서 넘어온 법인 정보를 계약서로 그대로 이관
        partyType: prefilledQuoteData?.partyType || '개인',
        companyId: prefilledQuoteData?.companyId?._id || prefilledQuoteData?.companyId || undefined,
        leaseCompany: undefined,
        contractDate,
        deliveryDate: undefined,
        termMonths: Number(termMonths),
        branch: undefined,
        managerMain: undefined,
        managerMainPhone: undefined,
        managerOps,
        managerOpsPhone,
        status: '진행중',
        
        rentPeriodYears: undefined,
        rentStartDate: undefined,
        rentPeriodDays: undefined,
        remainingPeriodCalc: undefined,
        finesEmail,
        finesEmail2,
        corporateRegistrationNo: undefined,

        pricing: {
          basePrice: pricing.basePrice ? Number(pricing.basePrice) : undefined,
          discount: pricing.discount ? Number(pricing.discount) : undefined,
          supplyPrice: pricing.supplyPrice ? Number(pricing.supplyPrice) : undefined,
          deliveryFee: pricing.deliveryFee ? Number(pricing.deliveryFee) : undefined,
          acquisitionTax: pricing.acquisitionTax ? Number(pricing.acquisitionTax) : undefined,
          publicBond: pricing.publicBond ? Number(pricing.publicBond) : undefined,
          stampFee: pricing.stampFee ? Number(pricing.stampFee) : undefined,
          plateFee: pricing.plateFee ? Number(pricing.plateFee) : undefined,
          registrationAgencyFee: pricing.registrationAgencyFee ? Number(pricing.registrationAgencyFee) : undefined,
          commission: pricing.commission ? Number(pricing.commission) : undefined,
          deposit: pricing.deposit ? Number(pricing.deposit) : undefined,
          advancePayment: pricing.advancePayment ? Number(pricing.advancePayment) : undefined,
          takeoverPrice: pricing.takeoverPrice ? Number(pricing.takeoverPrice) : undefined,
          monthlyFee: Number(pricing.monthlyFee),
          billingDay: pricing.billingDay ? Number(pricing.billingDay) : undefined,
          invoiceDay: pricing.invoiceDay ? Number(pricing.invoiceDay) : undefined,
          penaltyRate: pricing.penaltyRate ? Number(pricing.penaltyRate) : 35,
          overdueRate: pricing.overdueRate ? Number(pricing.overdueRate) : 25,
          
          paymentTerm: pricing.paymentTerm ? Number(pricing.paymentTerm) : undefined,
          monthlyFeeTotal: pricing.monthlyFeeTotal ? Number(pricing.monthlyFeeTotal) : undefined,
          pandanbi: pricing.pandanbi ? Number(pricing.pandanbi) : undefined,
          individualConsumptionTax: pricing.individualConsumptionTax ? Number(pricing.individualConsumptionTax) : undefined
        },
        gifts: gifts
          .filter(g => g.name.trim() !== '')
          .map(g => ({ name: g.name, price: g.price ? Number(g.price) : 0 })),
        vehicleInfo: {
          model: vehicleModel,
          spec: vehicleSpec,
          year: undefined,
          color: vehicleColor,
          colorInterior: vehicleColorInterior,
          fuelType: vehicleFuelType,
          cc: undefined,
          vin: 'VIN_AUTO_' + Date.now(),
          plateNo: undefined,
          options: vehicleOptions,
          releaseAddress: undefined,
          dealer: undefined,
          salesRep: undefined,
          showroom: undefined,
          
          classification: undefined,
          operationType: undefined,
          vehiclePrice: vehiclePrice ? Number(vehiclePrice) : undefined,
          registrationDate: undefined,
          mileage: undefined,
          
          accessories: undefined,
          registrationCosts: undefined,
          insurance: insurance,
          maintenance: maintenance,
          tax: undefined,
          loan: {
            source: loan.source,
            executionDate: loan.executionDate || undefined,
            amount: loan.amount ? Number(loan.amount) : undefined,
            term: loan.term ? Number(loan.term) : undefined,
            monthlyPayment: loan.monthlyPayment ? Number(loan.monthlyPayment) : undefined,
            monthlyPaymentTotal: loan.monthlyPaymentTotal ? Number(loan.monthlyPaymentTotal) : undefined,
            totalInterest: loan.totalInterest ? Number(loan.totalInterest) : undefined,
            interestRate: loan.interestRate ? Number(loan.interestRate) : undefined
          }
        }
      };

      const isEditMode = !!prefilledContractData;
      const url = isEditMode ? `${API_HOST}/api/contracts/${prefilledContractData._id}` : `${API_HOST}/api/contracts`;
      const method = isEditMode ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method: method,
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Role': currentUser?.role || 'viewer'
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        showToast(isEditMode ? '계약서가 성공적으로 수정되었습니다!' : '계약서가 성공적으로 등록되었으며 일정이 자동 생성되었습니다!', 'success');
        if (prefilledQuoteData) {
          setPrefilledQuoteData(null);
        }
        if (prefilledContractData) {
          setPrefilledContractData(null);
        }
        resetAllStates();
        setActiveTab('contracts');
      } else {
        const err = await response.json();
        showToast(err.message || '계약 저장 실패', 'error');
      }
    } catch (err) {
      showToast('서버 저장 실패', 'error');
    }
  };

  const handleCancelPrefill = () => {
    setPrefilledQuoteData(null);
    if (customers.length > 0) {
      setCustomerId(customers[0]._id);
      populateCustomerFields(customers[0]);
      setSearchQuery(customers[0].name);
    } else {
      setCustomerId('');
      clearCustomerFields();
      setSearchQuery('');
    }
    setVehicleModel('');
    setVehicleSpec('');
    setPricing({
      basePrice: '',
      discount: '',
      supplyPrice: '',
      deliveryFee: '',
      acquisitionTax: '',
      publicBond: '',
      stampFee: '',
      plateFee: '',
      registrationAgencyFee: '',
      commission: '',
      deposit: '',
      advancePayment: '',
      takeoverPrice: '',
      monthlyFee: '',
      billingDay: '10',
      invoiceDay: '10',
      penaltyRate: '10',
      overdueRate: '15',
      paymentTerm: '',
      monthlyFeeTotal: '',
      pandanbi: '',
      individualConsumptionTax: ''
    });
  };

  // Generate Search Suggestions dynamically based on multiple fields (Customer Name, BizNo, Manager, Plate No, etc.)
  // Normalized for space-insensitivity and dash-insensitivity
  const getSuggestions = () => {
    if (!searchQuery.trim()) return [];
    
    const qClean = searchQuery.toLowerCase().replace(/[-\s]/g, '');
    const suggestionMap = new Map();
 
    // 1. Direct Customer match (name, customerId, bizNo, contactName)
    customers.forEach(c => {
      const nameClean = String(c.name || '').toLowerCase().replace(/[-\s]/g, '');
      const cIdClean = String(c.customerId || '').toLowerCase().replace(/[-\s]/g, '');
      const bizClean = String(c.bizNo || '').replace(/[-\s]/g, '');
      const contactClean = String(c.contactName || '').toLowerCase().replace(/[-\s]/g, '');
      
      if (nameClean.includes(qClean) || cIdClean.includes(qClean) || bizClean.includes(qClean) || contactClean.includes(qClean)) {
        suggestionMap.set(c._id, {
          customer: c,
          reason: '고객 정보 일치'
        });
      }
    });
 
    // 2. Contract-level matching (vehicle plateNo, vehicle vin, contract manager, contractNo)
    contracts.forEach(con => {
      const compName = con.leaseCompany || con.vehicle?.contractCompany || '';
      if (!compName) return;
      
      const actualCustomer = customers.find(c => c.name === compName.trim());
      if (!actualCustomer) return;
 
      const hasMatch = suggestionMap.has(actualCustomer._id);
      
      const vPlate = con.vehicle?.plateNo || '';
      const vPlateClean = String(vPlate).toLowerCase().replace(/[-\s]/g, '');
      
      const vVin = con.vehicle?.vin || '';
      const vVinClean = String(vVin).toLowerCase().replace(/[-\s]/g, '');
      
      const vModel = con.vehicle?.model || '';
      
      const conNo = con.contractNo || '';
      const conNoClean = String(conNo).toLowerCase().replace(/[-\s]/g, '');
      
      const mMain = con.managerMain || '';
      const mMainClean = String(mMain).toLowerCase().replace(/[-\s]/g, '');
      
      const mOps = con.managerOps || '';
      const mOpsClean = String(mOps).toLowerCase().replace(/[-\s]/g, '');
      
      let reason = '';
      if (vPlateClean.includes(qClean)) {
        reason = `차량번호: ${vPlate} (${vModel})`;
      } else if (vVinClean.includes(qClean)) {
        reason = `차대번호: ${vVin}`;
      } else if (mMainClean.includes(qClean)) {
        reason = `담당자(책임): ${mMain}`;
      } else if (mOpsClean.includes(qClean)) {
        reason = `담당자(실무): ${mOps}`;
      } else if (conNoClean.includes(qClean)) {
        reason = `계약번호: ${conNo}`;
      }
 
      if (reason) {
        // If not already in suggestions or if Direct Match, we keep it but can show this reason
        if (!hasMatch) {
          suggestionMap.set(actualCustomer._id, {
            customer: actualCustomer,
            reason: reason
          });
        }
      }
    });
 
    return Array.from(suggestionMap.values()).slice(0, 3);
  };

  // Render input fields easily
  const renderInput = (label, type, value, onChange, placeholder = '', required = false, disabled = false) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-main)' }}>
        {label} {required && <span style={{ color: 'var(--error)' }}>*</span>}
      </label>
      <input 
        type={type} 
        value={value} 
        onChange={(e) => onChange(e.target.value)} 
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        style={{ 
          width: '100%', 
          padding: '0.45rem 0.6rem', 
          border: '1px solid var(--border-color)', 
          borderRadius: '6px', 
          fontSize: '0.85rem',
          backgroundColor: disabled ? '#f5f5f5' : '#fff',
          color: disabled ? '#8c8c8c' : 'var(--text-bright)',
          cursor: disabled ? 'not-allowed' : 'text'
        }} 
      />
    </div>
  );

  const renderSelect = (label, value, onChange, options, required = false, disabled = false) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-main)' }}>
        {label} {required && <span style={{ color: 'var(--error)' }}>*</span>}
      </label>
      <select 
        value={value} 
        onChange={(e) => onChange(e.target.value)} 
        required={required}
        disabled={disabled}
        style={{ 
          width: '100%', 
          padding: '0.45rem 0.6rem', 
          border: '1px solid var(--border-color)', 
          borderRadius: '6px', 
          fontSize: '0.85rem', 
          background: disabled ? '#f5f5f5' : '#fff',
          color: disabled ? '#8c8c8c' : 'var(--text-bright)',
          cursor: disabled ? 'not-allowed' : 'pointer'
        }}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );

  return (
    <form onSubmit={handleRegisterContract} className="contract-register-container fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem', paddingBottom: '3rem' }}>
      
      {/* Page Header */}
      <div style={{ background: '#fff', padding: '1.2rem 1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '1.3rem', fontWeight: '700', color: 'var(--text-bright)', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <FileSignature style={{ color: 'var(--primary)' }} /> 계약 내용
        </h3>
        
        {prefilledQuoteData && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.8rem', color: '#16a34a', background: '#dcfce7', padding: '0.3rem 0.6rem', borderRadius: '4px', fontWeight: '600' }}>
              견적서 연동 완료
            </span>
            <button 
              type="button" 
              onClick={handleCancelPrefill}
              style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', background: 'none', border: 'none', color: 'var(--error)', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' }}
            >
              <ArrowLeft size={12} /> 연동 취소
            </button>
          </div>
        )}

        {prefilledContractData && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <span style={{ fontSize: '0.8rem', color: '#2563eb', background: '#dbeafe', padding: '0.3rem 0.6rem', borderRadius: '4px', fontWeight: '600' }}>
              ✍️ 계약서 수정 모드
            </span>
            <button 
              type="button" 
              onClick={() => {
                setPrefilledContractData(null);
                resetAllStates();
                setActiveTab('contracts');
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', background: 'none', border: 'none', color: 'var(--error)', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' }}
            >
              <ArrowLeft size={12} /> 수정 취소
            </button>
          </div>
        )}
      </div>

      {/* 엑셀 일괄 등록 섹션 */}
      {!prefilledContractData && (
        <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--bg-main)', paddingBottom: '0.8rem' }}>
            <div>
              <h4 style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--text-bright)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                📊 엑셀 계약 대장 일괄 등록
              </h4>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                엑셀 파일의 행(Row) 데이터를 일괄 읽어와 데이터베이스에 차량, 법인고객, 계약 및 일정을 자동 생성합니다.
              </span>
            </div>
            <button
              type="button"
              onClick={handleExcelTemplateDownload}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: '#f0fdf4',
                color: '#16a34a',
                border: '1px solid #bbf7d0',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                fontSize: '0.82rem',
                fontWeight: '700',
                cursor: 'pointer',
                transition: 'background 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = '#dcfce7'}
              onMouseLeave={(e) => e.currentTarget.style.background = '#f0fdf4'}
            >
              📥 양식 다운로드
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                type="file"
                accept=".xlsx, .xls"
                onChange={(e) => setExcelFile(e.target.files[0])}
                style={{ display: 'none' }}
                id="excel-file-input"
              />
              <label
                htmlFor="excel-file-input"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '2px dashed var(--border-color)',
                  borderRadius: '8px',
                  padding: '1.5rem',
                  cursor: 'pointer',
                  backgroundColor: 'var(--bg-main)',
                  color: 'var(--text-main)',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  textAlign: 'center',
                  transition: 'border-color 0.2s, background-color 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--primary)';
                  e.currentTarget.style.backgroundColor = '#f0f7ff';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.backgroundColor = 'var(--bg-main)';
                }}
              >
                {excelFile ? (
                  <span style={{ color: 'var(--primary)', fontWeight: '700' }}>
                    📎 {excelFile.name} ({Math.round(excelFile.size / 1024)} KB)
                  </span>
                ) : (
                  '📄 클릭하여 엑셀 파일 선택 또는 파일을 여기에 놓으세요 (.xlsx, .xls)'
                )}
              </label>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={handleExcelUpload}
                disabled={!excelFile || isUploading}
                style={{
                  background: excelFile ? 'var(--primary)' : '#e5e7eb',
                  color: excelFile ? '#fff' : '#9ca3af',
                  border: 'none',
                  padding: '0.65rem 1.5rem',
                  borderRadius: '8px',
                  fontWeight: '700',
                  fontSize: '0.85rem',
                  cursor: excelFile ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  justifyContent: 'center',
                  minWidth: '100px',
                  boxShadow: excelFile ? 'var(--shadow-premium)' : 'none'
                }}
              >
                {isUploading ? '업로드 중...' : '📤 업로드'}
              </button>
              {excelFile && (
                <button
                  type="button"
                  onClick={() => setExcelFile(null)}
                  style={{
                    background: '#f3f4f6',
                    color: '#4b5563',
                    border: '1px solid #d1d5db',
                    padding: '0.35rem',
                    borderRadius: '8px',
                    fontSize: '0.78rem',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  선택 취소
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Accordion 1: 고객 정보 */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: 'var(--shadow-premium)' }}>
        <div 
          onClick={() => toggleSection('customer')}
          style={{ padding: '1rem 1.5rem', background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        >
          <span style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.95rem' }}>고객 정보</span>
          {expanded.customer ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
        
        {expanded.customer && (
          <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            
            {/* New Customer Toggle Checkbox */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem', background: 'var(--bg-main)', padding: '0.6rem 0.8rem', borderRadius: '6px', border: '1px solid var(--border-color)', width: 'fit-content' }}>
              <input 
                type="checkbox" 
                id="isNewCustomerCheckbox"
                checked={isNewCustomer}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setIsNewCustomer(checked);
                  setCustomerId('');
                  clearCustomerFields();
                  setSearchQuery('');
                }}
                style={{ width: '16px', height: '16px', accentColor: 'var(--primary)', cursor: 'pointer' }}
              />
              <label 
                htmlFor="isNewCustomerCheckbox" 
                style={{ fontSize: '0.8rem', fontWeight: '700', color: isNewCustomer ? 'var(--primary)' : 'var(--text-main)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', userSelect: 'none' }}
              >
                📝 신규 법인 직접 추가 (기존 DB에 등록되지 않은 신규 법인인 경우 체크)
              </label>
            </div>

            {/* Autocomplete Search input */}
            <div style={{ maxWidth: '450px', position: 'relative', opacity: isNewCustomer ? 0.6 : 1, transition: 'opacity 0.2s' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.3rem', color: 'var(--text-main)' }}>계약사 / 법인명 검색 *</label>
              <div style={{ position: 'relative' }}>
                <input 
                  type="text" 
                  placeholder={isNewCustomer ? "신규 법인 추가 모드 활성화됨 (아래에 직접 기입하세요)" : "계약사/법인명 검색..."} 
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCustomerName(e.target.value);
                    setShowSuggestions(true);
                    if (customerId) {
                      setCustomerId('');
                      clearCustomerFields();
                    }
                  }}
                  onFocus={() => !isNewCustomer && setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 220)}
                  required={!isNewCustomer && !customerId}
                  disabled={isNewCustomer}
                  style={{ 
                    width: '100%', 
                    padding: '0.5rem 0.8rem', 
                    border: '1px solid var(--border-color)', 
                    borderRadius: '6px', 
                    fontSize: '0.85rem',
                    backgroundColor: isNewCustomer ? '#f5f5f5' : '#fff',
                    cursor: isNewCustomer ? 'not-allowed' : 'text'
                  }} 
                />
                {searchQuery && !isNewCustomer && (
                  <button 
                    type="button" 
                    onClick={() => {
                      setSearchQuery('');
                      setCustomerId('');
                      clearCustomerFields();
                    }}
                    style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 'bold' }}
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Suggestions List */}
              {showSuggestions && searchQuery.trim() !== '' && (
                <ul style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 99,
                  background: '#fff', border: '1px solid var(--border-color)', borderRadius: '6px',
                  boxShadow: 'var(--shadow-premium)', listStyle: 'none', padding: 0, margin: '4px 0 0 0',
                  overflow: 'hidden'
                }}>
                  {(() => {
                    const suggestions = getSuggestions();
                    if (suggestions.length === 0) {
                      return (
                        <li style={{ padding: '0.6rem 0.8rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          검색 결과가 없습니다.
                        </li>
                      );
                    }
                    return suggestions.map(item => {
                      const c = item.customer;
                      return (
                        <li 
                          key={c._id}
                          onClick={() => {
                            setCustomerId(c._id);
                            populateCustomerFields(c);
                            setSearchQuery(c.name);
                            setShowSuggestions(false);
                          }}
                          style={{
                            padding: '0.6rem 0.8rem', cursor: 'pointer', fontSize: '0.8rem',
                            borderBottom: '1px solid var(--bg-main)', background: '#fff',
                            transition: 'background 0.2s', display: 'flex', flexDirection: 'column', gap: '0.2rem'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-main)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                            <span style={{ fontWeight: '600', color: 'var(--text-bright)' }}>{c.name}</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>[{c.customerId || 'ID 없음'}]</span>
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{c.bizNo}</span>
                            <span style={{ background: 'var(--primary-glow)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: '600', fontSize: '0.65rem', border: '1px solid var(--primary-glow-border)' }}>
                              {item.reason}
                            </span>
                          </div>
                        </li>
                      );
                    });
                  })()}
                </ul>
              )}
            </div>

            {/* Customer Details */}
            <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <h5 style={{ fontWeight: '700', color: 'var(--text-bright)', margin: 0, fontSize: '0.95rem', borderBottom: '2px solid var(--bg-main)', paddingBottom: '0.6rem' }}>
                {isNewCustomer ? '📝 신규 법인 정보 직접 입력' : '🏢 선택된 법인 상세 정보 (수정은 렌트차량 DB에서만 가능합니다)'}
              </h5>
              
              {/* 사업자등록증 정보 영역 */}
              <div style={{ background: 'var(--bg-main)', padding: '1.2rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.8rem' }}>
                  <span style={{ display: 'inline-block', width: '4px', height: '14px', backgroundColor: 'var(--primary)', borderRadius: '2px' }}></span>
                  <span style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.85rem' }}>📄 사업자등록증 정보</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                  {renderInput('고객명 (개인/법인명) *', 'text', customerName, setCustomerName, '예: 주식회사 에스벤네핏', true, !isNewCustomer)}
                  {renderInput('사업자/주민번호 *', 'text', customerBizNo, setCustomerBizNo, '예: 123-45-67890 또는 950101-1234567', true, !isNewCustomer)}
                  {renderInput('대표자명', 'text', customerCeoName, setCustomerCeoName, '', false, !isNewCustomer)}
                  {renderInput('법인등록번호', 'text', customerBizNoTransfer, setCustomerBizNoTransfer, '법인등록번호 입력', false, !isNewCustomer)}
                  <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 3fr', gap: '1rem' }}>
                    {renderInput('이메일', 'email', customerEmail, setCustomerEmail, 'email@example.com', false, !isNewCustomer)}
                    {renderInput('주소', 'text', customerBizAddress, setCustomerBizAddress, '주소 입력', false, !isNewCustomer)}
                  </div>
                </div>
              </div>

              {/* 통장사본 정보 영역 */}
              <div style={{ background: 'var(--bg-main)', padding: '1.2rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.8rem' }}>
                  <span style={{ display: 'inline-block', width: '4px', height: '14px', backgroundColor: '#e28743', borderRadius: '2px' }}></span>
                  <span style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.85rem' }}>🏦 통장사본 정보</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                  {renderInput('자동이체 은행', 'text', customerBankName, setCustomerBankName, '예: 신한은행', false, !isNewCustomer)}
                  {renderInput('자동이체 계좌번호', 'text', customerBankAccount, setCustomerBankAccount, '계좌번호 입력', false, !isNewCustomer)}
                  {renderInput('자동이체 예금주', 'text', customerBankHolder, setCustomerBankHolder, '', false, !isNewCustomer)}
                </div>
              </div>
            </div>

          </div>
        )}
      </div>

      {/* Accordion 2: 차량 정보 (두 번째로 이동, 타이틀 "차량 정보") */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: 'var(--shadow-premium)' }}>
        <div 
          onClick={() => toggleSection('vehicle')}
          style={{ padding: '1rem 1.5rem', background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        >
          <span style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.95rem' }}>차량 정보</span>
          {expanded.vehicle ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
        
        {expanded.vehicle && (
          <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
              {renderInput('차종 *', 'text', vehicleModel, setVehicleModel, '예: Ray, 그랜저', true)}
              {renderInput('차량 사양', 'text', vehicleSpec, setVehicleSpec, '예: 하이브리드 프레스티지')}
              {renderInput('차량가 (원)', 'number', vehiclePrice, setVehiclePrice, '예: 32000000')}
              {renderSelect('유종', vehicleFuelType, setVehicleFuelType, [
                { value: '가솔린', label: '가솔린' },
                { value: '디젤', label: '디젤' },
                { value: 'LPG', label: 'LPG' },
                { value: '하이브리드', label: '하이브리드' },
                { value: '전기', label: '전기' }
              ])}
              {renderInput('외장 색상', 'text', vehicleColor, setVehicleColor, '예: 스노우 화이트')}
              {renderInput('내장 색상', 'text', vehicleColorInterior, setVehicleColorInterior, '예: 블랙 가죽')}
              
              {/* 옵션 (두 번째 줄에 길게 추가) */}
              <div style={{ gridColumn: '1 / -1' }}>
                {renderInput('옵션', 'text', vehicleOptions, setVehicleOptions, '차량 개별 추가 옵션 입력 (예: 선루프, 네비게이션 등)')}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Accordion 3: 계약 내용 */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: 'var(--shadow-premium)' }}>
        <div 
          onClick={() => toggleSection('contract')}
          style={{ padding: '1rem 1.5rem', background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        >
          <span style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.95rem' }}>계약 내용</span>
          {expanded.contract ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
        
        {expanded.contract && (
          <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
              
              {/* 1번째 행: 렌트 기간 & 수량 & 약정주행거리 (만단위 선택 셀렉트) */}
              <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                {renderSelect('렌트 기간 (개월)', termMonths, setTermMonths, [
                  { value: '12', label: '12개월' },
                  { value: '24', label: '24개월' },
                  { value: '36', label: '36개월' },
                  { value: '48', label: '48개월' },
                  { value: '60', label: '60개월' },
                  { value: '72', label: '72개월' }
                ], true)}
                {renderInput('수량', 'number', contractQuantity, setContractQuantity, '수량 입력')}
                {renderSelect('연간 약정 주행거리 (km)', mileage || '20000', setMileage, [
                  { value: '10000', label: '10,000 km' },
                  { value: '20000', label: '20,000 km' },
                  { value: '30000', label: '30,000 km' },
                  { value: '40000', label: '40,000 km' }
                ])}
              </div>

              {/* 2번째 행: 월 렌트료, 보증금, 선수금, 인수가 */}
              <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginTop: '0.2rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.3rem', color: 'var(--text-main)' }}>월 렌트료</label>
                  <input 
                    type="number" 
                    required 
                    value={pricing.monthlyFee} 
                    onChange={(e) => handlePricingChange('monthlyFee', e.target.value)} 
                    style={{ width: '100%', padding: '0.45rem 0.6rem', border: '1px solid var(--primary)', borderRadius: '6px', fontSize: '0.85rem' }} 
                  />
                </div>
                {renderInput('보증금 (원)', 'number', pricing.deposit, (val) => handlePricingChange('deposit', val))}
                {renderInput('선수금 (원)', 'number', pricing.advancePayment, (val) => handlePricingChange('advancePayment', val))}
                {renderInput('인수가 (원)', 'number', pricing.takeoverPrice, (val) => handlePricingChange('takeoverPrice', val))}
              </div>

              {/* 일반 계약 세부 정보: 계약일, 담당자, 연락처 */}
              <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginTop: '0.2rem' }}>
                {renderInput('계약일', 'date', contractDate, setContractDate, '', true)}
                {renderInput('계약 담당자', 'text', managerOps, setManagerOps)}
                {renderInput('계약 담당자 연락처', 'text', managerOpsPhone, setManagerOpsPhone, '010-XXXX-XXXX')}
              </div>

              {/* 하단 세부 정보: 이메일 1, 이메일 2, 연체이율, 위약금 */}
              <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginTop: '0.2rem' }}>
                {renderInput('범칙금 수신 E-MAIL 1', 'email', finesEmail, setFinesEmail, 'fines@example.com')}
                {renderInput('범칙금 수신 E-MAIL 2', 'email', finesEmail2, setFinesEmail2, 'backup@example.com')}
                {renderInput('연체이율 (%)', 'number', pricing.overdueRate, (val) => handlePricingChange('overdueRate', val), '미입력 시 기본 25%')}
                {renderInput('위약금 (%)', 'number', pricing.penaltyRate, (val) => handlePricingChange('penaltyRate', val), '미입력 시 기본 35%')}
              </div>

              {/* 3번째 행: 보험 사항 서브 섹션 */}
              <div style={{ gridColumn: '1 / -1', background: 'var(--bg-main)', padding: '1.2rem', borderRadius: '8px', border: '1px solid var(--border-color)', marginTop: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ display: 'inline-block', width: '4px', height: '14px', backgroundColor: '#e28743', borderRadius: '2px' }}></span>
                    <span style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.85rem' }}>🛡️ 보험 사항</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-main)' }}>보험 구분:</span>
                    <select 
                      value={insurancePreset} 
                      onChange={(e) => {
                        const val = e.target.value;
                        setInsurancePreset(val);
                        applyInsurancePreset(val);
                      }} 
                      style={{ padding: '0.3rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.8rem', background: '#fff' }}
                    >
                      <option value="보험1">보험 1 (일반차량)</option>
                      <option value="보험2">보험 2 (고급차량)</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                  {renderInput('대인', 'text', insurance.liabilityLimit, () => {}, '', false, true)}
                  {renderInput('대물', 'text', insurance.propertyLimit, () => {}, '', false, true)}
                  {renderInput('자기손해', 'text', insurance.personalInjury, () => {}, '', false, true)}
                  {renderInput('자기부담금', 'text', insurance.deductible, () => {}, '', false, true)}
                  {renderInput('무보험차상해', 'text', insurance.uninsuredInjury, () => {}, '', false, true)}
                  {renderInput('긴급출동', 'text', insurance.emergencyCall, () => {}, '', false, true)}
                </div>
              </div>

              {/* 4번째 행: 정비 서비스 서브 섹션 */}
              <div style={{ gridColumn: '1 / -1', background: 'var(--bg-main)', padding: '1.2rem', borderRadius: '8px', border: '1px solid var(--border-color)', marginTop: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ display: 'inline-block', width: '4px', height: '14px', backgroundColor: '#107c41', borderRadius: '2px' }}></span>
                    <span style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.85rem' }}>🔧 정비 서비스</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-main)' }}>정비 서비스 여부:</span>
                    <select 
                      value={maintenancePreset} 
                      onChange={(e) => {
                        const val = e.target.value;
                        setMaintenancePreset(val);
                        applyMaintenancePreset(val);
                      }} 
                      style={{ padding: '0.3rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '4px', fontSize: '0.8rem', background: '#fff' }}
                    >
                      <option value="미포함">미포함</option>
                      <option value="포함">포함</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                  {renderInput('긴급 출동서비스', 'text', maintenance.emergencyService, () => {}, '', false, true)}
                  {renderInput('순회정비', 'text', maintenance.regularCheck, () => {}, '', false, true)}
                  {renderInput('일반정비', 'text', maintenance.generalMaintenance, () => {}, '', false, true)}
                  {renderInput('소모품 교환', 'text', maintenance.consumables, () => {}, '', false, true)}
                  {renderInput('타이어 교체', 'text', maintenance.tireCount, () => {}, '', false, true)}
                </div>
              </div>

            </div>
          </div>
        )}
      </div>

      {/* Form Action Buttons */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
        <button 
          type="button" 
          onClick={() => {
            if (prefilledContractData) setPrefilledContractData(null);
            if (prefilledQuoteData) setPrefilledQuoteData(null);
            resetAllStates();
            setActiveTab('contracts');
          }} 
          style={{ background: '#fff', border: '1px solid var(--border-color)', padding: '0.6rem 1.5rem', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem' }}
        >
          <MenuCancelText>취소</MenuCancelText>
        </button>
        <button 
          type="submit" 
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.6rem 1.5rem', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem' }}
        >
          <Save size={16} /> 저장
        </button>
      </div>

    </form>
  );
}

// Simple text wrapper helper to avoid variable confusion
const MenuCancelText = ({ children }) => <span>{children}</span>;

export default ContractRegisterView;
