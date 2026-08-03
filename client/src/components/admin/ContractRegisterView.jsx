import React, { useState, useEffect } from 'react';
import { Save, Plus, Trash2, FileSignature, ChevronDown, ChevronUp, ArrowLeft, UserPlus, Users } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

function ContractRegisterView({ prefilledQuoteData, setPrefilledQuoteData, setActiveTab, showToast, currentUser }) {
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
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  
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
  const [vehicleFuelType, setVehicleFuelType] = useState('가솔린');
  const [vehicleCc, setVehicleCc] = useState('');
  const [vehicleVin, setVehicleVin] = useState('');
  const [vehiclePlateNo, setVehiclePlateNo] = useState('');
  const [vehicleOptions, setVehicleOptions] = useState([]);
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

  // Vehicle Insurance
  const [insurance, setInsurance] = useState({
    company: '',
    startDate: '',
    fee: '',
    selfCoverage: '',
    driverAge: '',
    liabilityLimit: '',
    propertyLimit: '',
    personalInjury: '',
    uninsuredInjury: '',
    deductible: '',
    type: '',
    emergencyCall: '',
    accidentRepair: '',
    generalMaintenance: ''
  });

  // Vehicle Maintenance
  const [maintenance, setMaintenance] = useState({
    consumables: '',
    tireCount: '',
    tireSpec: '',
    tireCost: '',
    regularCheck: ''
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

  // Option list tags helper
  const [optionInput, setOptionInput] = useState('');

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

  // Fetch Customers and Contracts, then auto-load details
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [resCustomers, resContracts] = await Promise.all([
          fetch(`${API_HOST}/api/customers`),
          fetch(`${API_HOST}/api/contracts`)
        ]);
        
        let customerData = [];
        if (resCustomers.ok) {
          customerData = await resCustomers.json();
          setCustomers(customerData);
        }
        
        if (resContracts.ok) {
          const contractData = await resContracts.json();
          setContracts(contractData);
        }
        
        if (prefilledQuoteData) {
          const quoteCustId = prefilledQuoteData.customer?._id || prefilledQuoteData.customer || '';
          setCustomerId(quoteCustId);
          setIsNewCustomer(false);
          
          const cust = customerData.find(c => c._id === quoteCustId);
          if (cust) {
            populateCustomerFields(cust);
            setSearchQuery(`[${cust.customerId || 'ID 없음'}] ${cust.name} (${cust.bizNo})`);
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
        } else if (customerData.length > 0) {
          setCustomerId(customerData[0]._id);
          populateCustomerFields(customerData[0]);
          setSearchQuery(`[${customerData[0].customerId || 'ID 없음'}] ${customerData[0].name} (${customerData[0].bizNo})`);
        }
      } catch (err) {
        console.error('Failed to load initial data', err);
      }
    };
    fetchData();
  }, [prefilledQuoteData]);

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

  const handleToggleCustomerMode = (isNew) => {
    setIsNewCustomer(isNew);
    if (isNew) {
      setCustomerId('');
      clearCustomerFields();
      setSearchQuery('');
    } else {
      if (customers.length > 0) {
        setCustomerId(customers[0]._id);
        populateCustomerFields(customers[0]);
        setSearchQuery(`[${customers[0].customerId || 'ID 없음'}] ${customers[0].name} (${customers[0].bizNo})`);
      }
    }
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

  const handleAddOption = (e) => {
    if (e.key === 'Enter' && optionInput.trim()) {
      e.preventDefault();
      if (!vehicleOptions.includes(optionInput.trim())) {
        setVehicleOptions(prev => [...prev, optionInput.trim()]);
      }
      setOptionInput('');
    }
  };

  const handleRemoveOption = (opt) => {
    setVehicleOptions(prev => prev.filter(o => o !== opt));
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
    if (!vehicleVin.trim()) {
      showToast('차대번호(VIN)를 입력해주세요.', 'error');
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
        customerInfo: {
          name: customerName,
          bizNo: customerBizNo,
          ceoName: customerCeoName,
          address: customerAddress,
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
        leaseCompany,
        contractDate,
        deliveryDate: deliveryDate || undefined,
        termMonths: Number(termMonths),
        branch,
        managerMain,
        managerMainPhone,
        managerOps,
        managerOpsPhone,
        status,
        
        rentPeriodYears: rentPeriodYears ? Number(rentPeriodYears) : undefined,
        rentStartDate: rentStartDate || undefined,
        rentPeriodDays: rentPeriodDays ? Number(rentPeriodDays) : undefined,
        remainingPeriodCalc,
        finesEmail,
        finesEmail2,
        corporateRegistrationNo,

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
          penaltyRate: pricing.penaltyRate ? Number(pricing.penaltyRate) : undefined,
          overdueRate: pricing.overdueRate ? Number(pricing.overdueRate) : undefined,
          
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
          year: vehicleYear ? Number(vehicleYear) : undefined,
          color: vehicleColor,
          fuelType: vehicleFuelType,
          cc: vehicleCc ? Number(vehicleCc) : undefined,
          vin: vehicleVin,
          plateNo: vehiclePlateNo,
          options: vehicleOptions,
          releaseAddress,
          dealer,
          salesRep,
          showroom,
          
          classification,
          operationType,
          vehiclePrice: vehiclePrice ? Number(vehiclePrice) : undefined,
          registrationDate: registrationDate || undefined,
          mileage: mileage ? Number(mileage) : undefined,
          
          accessories,
          registrationCosts: {
            cost1: registrationCosts.cost1 ? Number(registrationCosts.cost1) : undefined,
            cost2: registrationCosts.cost2 ? Number(registrationCosts.cost2) : undefined
          },
          insurance: {
            company: insurance.company,
            startDate: insurance.startDate || undefined,
            fee: insurance.fee ? Number(insurance.fee) : undefined,
            selfCoverage: insurance.selfCoverage ? Number(insurance.selfCoverage) : undefined,
            driverAge: insurance.driverAge,
            liabilityLimit: insurance.liabilityLimit,
            propertyLimit: insurance.propertyLimit,
            personalInjury: insurance.personalInjury,
            uninsuredInjury: insurance.uninsuredInjury,
            deductible: insurance.deductible,
            type: insurance.type,
            emergencyCall: insurance.emergencyCall,
            accidentRepair: insurance.accidentRepair,
            generalMaintenance: insurance.generalMaintenance
          },
          maintenance: {
            consumables: maintenance.consumables,
            tireCount: maintenance.tireCount,
            tireSpec: maintenance.tireSpec,
            tireCost: maintenance.tireCost ? Number(maintenance.tireCost) : undefined,
            regularCheck: maintenance.regularCheck
          },
          tax: {
            carTax: tax.carTax ? Number(tax.carTax) : undefined
          },
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

      const response = await fetch(`${API_HOST}/api/contracts`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Role': currentUser?.role || 'viewer'
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        showToast('계약서가 성공적으로 등록되었으며 일정이 자동 생성되었습니다!', 'success');
        if (prefilledQuoteData) {
          setPrefilledQuoteData(null);
        }
        setActiveTab('contracts');
      } else {
        const err = await response.json();
        showToast(err.message || '계약 등록 실패', 'error');
      }
    } catch (err) {
      showToast('서버 저장 실패', 'error');
    }
  };

  const handleCancelPrefill = () => {
    setPrefilledQuoteData(null);
    setIsNewCustomer(false);
    if (customers.length > 0) {
      setCustomerId(customers[0]._id);
      populateCustomerFields(customers[0]);
      setSearchQuery(`[${customers[0].customerId || 'ID 없음'}] ${customers[0].name} (${customers[0].bizNo})`);
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
      const nameClean = (c.name || '').toLowerCase().replace(/[-\s]/g, '');
      const cIdClean = (c.customerId || '').toLowerCase().replace(/[-\s]/g, '');
      const bizClean = (c.bizNo || '').replace(/[-\s]/g, '');
      const contactClean = (c.contactName || '').toLowerCase().replace(/[-\s]/g, '');
      
      if (nameClean.includes(qClean) || cIdClean.includes(qClean) || bizClean.includes(qClean) || contactClean.includes(qClean)) {
        suggestionMap.set(c._id, {
          customer: c,
          reason: '고객 정보 일치'
        });
      }
    });

    // 2. Contract-level matching (vehicle plateNo, vehicle vin, contract manager, contractNo)
    contracts.forEach(con => {
      if (!con.customer) return;
      const custObj = con.customer;
      
      const cId = custObj._id || custObj; // populated vs plain ID
      const actualCustomer = typeof custObj === 'object' ? custObj : customers.find(c => c._id === cId);
      
      if (!actualCustomer) return;

      const hasMatch = suggestionMap.has(actualCustomer._id);
      
      const vPlate = con.vehicle?.plateNo || '';
      const vPlateClean = vPlate.toLowerCase().replace(/[-\s]/g, '');
      
      const vVin = con.vehicle?.vin || '';
      const vVinClean = vVin.toLowerCase().replace(/[-\s]/g, '');
      
      const vModel = con.vehicle?.model || '';
      
      const conNo = con.contractNo || '';
      const conNoClean = conNo.toLowerCase().replace(/[-\s]/g, '');
      
      const mMain = con.managerMain || '';
      const mMainClean = mMain.toLowerCase().replace(/[-\s]/g, '');
      
      const mOps = con.managerOps || '';
      const mOpsClean = mOps.toLowerCase().replace(/[-\s]/g, '');
      
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
  const renderInput = (label, type, value, onChange, placeholder = '', required = false) => (
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
        style={{ width: '100%', padding: '0.45rem 0.6rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem' }} 
      />
    </div>
  );

  const renderSelect = (label, value, onChange, options, required = false) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-main)' }}>
        {label} {required && <span style={{ color: 'var(--error)' }}>*</span>}
      </label>
      <select 
        value={value} 
        onChange={(e) => onChange(e.target.value)} 
        required={required}
        style={{ width: '100%', padding: '0.45rem 0.6rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff' }}
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
          <FileSignature style={{ color: 'var(--primary)' }} /> 통합 계약 정보 등록 (116개 전체 정보)
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
      </div>

      {/* Accordion 1: 고객 선택 및 정보 */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: 'var(--shadow-premium)' }}>
        <div 
          onClick={() => toggleSection('customer')}
          style={{ padding: '1rem 1.5rem', background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        >
          <span style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.95rem' }}>1. 계약 고객 지정 및 상세 정보</span>
          {expanded.customer ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
        
        {expanded.customer && (
          <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            
            {/* Toggle Switch to choose select existing vs new */}
            <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--bg-main)', padding: '0.4rem', borderRadius: '8px', border: '1px solid var(--border-color)', alignSelf: 'flex-start' }}>
              <button
                type="button"
                onClick={() => handleToggleCustomerMode(false)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', border: 'none',
                  background: !isNewCustomer ? '#fff' : 'transparent',
                  color: !isNewCustomer ? 'var(--primary)' : 'var(--text-main)',
                  fontWeight: !isNewCustomer ? '700' : '500',
                  borderRadius: '6px', cursor: 'pointer', boxShadow: !isNewCustomer ? 'var(--shadow-premium)' : 'none',
                  fontSize: '0.8rem', transition: 'all 0.2s'
                }}
              >
                <Users size={14} /> 기존 고객 검색
              </button>
              <button
                type="button"
                onClick={() => handleToggleCustomerMode(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.5rem 1rem', border: 'none',
                  background: isNewCustomer ? '#fff' : 'transparent',
                  color: isNewCustomer ? 'var(--primary)' : 'var(--text-main)',
                  fontWeight: isNewCustomer ? '700' : '500',
                  borderRadius: '6px', cursor: 'pointer', boxShadow: isNewCustomer ? 'var(--shadow-premium)' : 'none',
                  fontSize: '0.8rem', transition: 'all 0.2s'
                }}
              >
                <UserPlus size={14} /> 신규 고객 직접 추가
              </button>
            </div>

            {/* Autocomplete Search input (only for existing customer) */}
            {!isNewCustomer && (
              <div style={{ maxWidth: '450px', position: 'relative' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.3rem', color: 'var(--text-main)' }}>기존 고객 검색 *</label>
                <div style={{ position: 'relative' }}>
                  <input 
                    type="text" 
                    placeholder="고객명, ID, 사업자번호, 차량번호, 담당자 검색..." 
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowSuggestions(true);
                      // Clear selected customer if user starts typing a new query
                      if (customerId) {
                        setCustomerId('');
                        clearCustomerFields();
                      }
                    }}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 220)}
                    required={!isNewCustomer && !customerId}
                    style={{ width: '100%', padding: '0.5rem 0.8rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem' }} 
                  />
                  {searchQuery && (
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

                {/* Suggestions List (Max 3 items, supports multi-attribute match) */}
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
                              setSearchQuery(`[${c.customerId || 'ID 없음'}] ${c.name} (${c.bizNo})`);
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
            )}

            {/* Customer Details - Auto Populated and Editable / New customer entry */}
            <div style={{ background: 'var(--bg-main)', padding: '1.2rem', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              <h5 style={{ fontWeight: '700', color: 'var(--text-bright)', margin: 0 }}>
                {isNewCustomer ? '📝 신규 고객 정보 직접 입력 (저장 시 DB에 신규 등록)' : '🔎 고객 상세 정보 (변경 시 기존 고객 정보가 업데이트됩니다)'}
              </h5>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '0.5rem' }}>
                {renderInput('고객명 (개인/법인명) *', 'text', customerName, setCustomerName, '예: 주식회사 에스벤네핏', true)}
                {renderInput('사업자/주민번호 *', 'text', customerBizNo, setCustomerBizNo, '예: 123-45-67890 또는 950101-1234567', true)}
                {renderInput('대표자명 (법인의 경우)', 'text', customerCeoName, setCustomerCeoName)}
                {renderInput('고객 주소', 'text', customerAddress, setCustomerAddress, '기본 주소')}
                {renderInput('담당자명', 'text', customerContactName, setCustomerContactName)}
                {renderInput('담당자 연락처', 'text', customerContactPhone, setCustomerContactPhone, '010-XXXX-XXXX')}
                {renderInput('이메일', 'email', customerEmail, setCustomerEmail, 'email@example.com')}
                
                {renderInput('자동이체 은행', 'text', customerBankName, setCustomerBankName, '예: 신한은행')}
                {renderInput('자동이체 계좌번호', 'text', customerBankAccount, setCustomerBankAccount, '계좌번호 입력')}
                {renderInput('자동이체 예금주', 'text', customerBankHolder, setCustomerBankHolder)}
                
                {renderInput('사업자/주민번호 (이체용 식별번호)', 'text', customerBizNoTransfer, setCustomerBizNoTransfer, '이체 등록 시 필요한 주민/사업자번호')}
                {renderInput('사업자 주소 (이체용 주소)', 'text', customerBizAddress, setCustomerBizAddress, '세금계산서 주소와 다를 경우')}
              </div>
            </div>

          </div>
        )}
      </div>

      {/* Accordion 2: 계약 기본 정보 */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: 'var(--shadow-premium)' }}>
        <div 
          onClick={() => toggleSection('contract')}
          style={{ padding: '1rem 1.5rem', background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        >
          <span style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.95rem' }}>2. 계약 및 관리 사원 정보</span>
          {expanded.contract ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
        
        {expanded.contract && (
          <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
              {renderInput('리스사 / 계약사', 'text', leaseCompany, setLeaseCompany, '예: 현대캐피탈, 메리츠 등')}
              {renderInput('계약일 *', 'date', contractDate, setContractDate, '', true)}
              {renderInput('차량 인도 날짜', 'date', deliveryDate, setDeliveryDate)}
              
              {renderSelect('렌트 기간 (개월) *', termMonths, setTermMonths, [
                { value: '12', label: '12개월' },
                { value: '24', label: '24개월' },
                { value: '36', label: '36개월' },
                { value: '48', label: '48개월' },
                { value: '60', label: '60개월' }
              ], true)}

              {renderInput('렌트 기간 (연 단위)', 'number', rentPeriodYears, setRentPeriodYears, '예: 2')}
              {renderInput('렌트료 개시일', 'date', rentStartDate, setRentStartDate)}
              {renderInput('렌트 기간 일수', 'number', rentPeriodDays, setRentPeriodDays, '예: 730')}
              {renderInput('남은 기간 계산', 'text', remainingPeriodCalc, setRemainingPeriodCalc, '예: 24개월 남음')}

              {renderInput('지점', 'text', branch, setBranch)}
              {renderInput('책임담당자', 'text', managerMain, setManagerMain)}
              {renderInput('책임담당자 연락처', 'text', managerMainPhone, setManagerMainPhone, '010-XXXX-XXXX')}
              {renderInput('실무담당자', 'text', managerOps, setManagerOps)}
              {renderInput('실무담당자 연락처', 'text', managerOpsPhone, setManagerOpsPhone, '010-XXXX-XXXX')}

              {renderInput('범칙금 수신 E-MAIL 1', 'email', finesEmail, setFinesEmail, 'fines@example.com')}
              {renderInput('범칙금 수신 E-MAIL 2', 'email', finesEmail2, setFinesEmail2, 'backup@example.com')}
              {renderInput('법인/식별번호', 'text', corporateRegistrationNo, setCorporateRegistrationNo, '예: 110111-XXXXXXX')}
              
              {renderSelect('계약 상태', status, setStatus, [
                { value: '진행중', label: '진행중' },
                { value: '종료', label: '종료' },
                { value: '중도해지', label: '중도해지' }
              ])}
            </div>
          </div>
        )}
      </div>

      {/* Accordion 3: 차량 정보 및 사양 */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: 'var(--shadow-premium)' }}>
        <div 
          onClick={() => toggleSection('vehicle')}
          style={{ padding: '1rem 1.5rem', background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        >
          <span style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.95rem' }}>3. 차량 정보 및 추가 사양</span>
          {expanded.vehicle ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
        
        {expanded.vehicle && (
          <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
              {renderInput('차종 *', 'text', vehicleModel, setVehicleModel, '예: Ray, 그랜저', true)}
              {renderInput('차량 사양', 'text', vehicleSpec, setVehicleSpec, '예: 하이브리드 프레스티지')}
              {renderInput('차량가 (원)', 'number', vehiclePrice, setVehiclePrice, '예: 32000000')}
              {renderInput('연식 (년)', 'number', vehicleYear, setVehicleYear)}
              {renderInput('색상', 'text', vehicleColor, setVehicleColor, '예: 스노우 화이트')}
              
              {renderSelect('유종', vehicleFuelType, setVehicleFuelType, [
                { value: '가솔린', label: '가솔린' },
                { value: '디젤', label: '디젤' },
                { value: 'LPG', label: 'LPG' },
                { value: '하이브리드', label: '하이브리드' },
                { value: '전기', label: '전기' }
              ])}

              {renderInput('배기량 (cc)', 'number', vehicleCc, setVehicleCc, '예: 1598')}
              {renderInput('차대번호 (VIN) *', 'text', vehicleVin, setVehicleVin, '17자리 필수', true)}
              {renderInput('차량번호', 'text', vehiclePlateNo, setVehiclePlateNo, '예: 125하5497')}
              {renderInput('등록일', 'date', registrationDate, setRegistrationDate)}
              {renderInput('운행 거리 (km)', 'number', mileage, setMileage, '예: 25000')}
              {renderInput('출고지 주소', 'text', releaseAddress, setReleaseAddress, '차량 출고 주소')}
              {renderInput('딜러사', 'text', dealer, setDealer, '예: 현대자동차 대리점')}
              {renderInput('담당 영업 사원', 'text', salesRep, setSalesRep, '영업사원 이름')}
              {renderInput('전시장', 'text', showroom, setShowroom, '예: 서초 전시장')}
              
              {renderInput('구분 (엑셀 No/구분)', 'text', classification, setClassification, '예: Ray-029')}
              {renderInput('운영 구분', 'text', operationType, setOperationType, '예: 사고대차, 영업용')}
            </div>

            {/* Nested block: 악세서리 장착 (블랙박스, 선팅 등) */}
            <div style={{ background: 'var(--bg-main)', padding: '1.2rem', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
              <h5 style={{ fontWeight: '700', color: 'var(--text-bright)', margin: '0 0 0.5rem 0' }}>악세서리 및 편의 옵션</h5>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                {renderInput('블랙박스 모델', 'text', accessories.blackbox, (val) => handleNestedChange(setAccessories, 'blackbox', val), '예: 엠피온')}
                {renderInput('블랙박스 상세정보', 'text', accessories.blackboxInfo, (val) => handleNestedChange(setAccessories, 'blackboxInfo', val))}
                {renderInput('선팅 브랜드', 'text', accessories.tinting, (val) => handleNestedChange(setAccessories, 'tinting', val), '예: 루마')}
                {renderInput('선팅 세부 농도/사양', 'text', accessories.tintingInfo, (val) => handleNestedChange(setAccessories, 'tintingInfo', val), '예: 전면 35%/측후면 15%')}
              </div>
            </div>

            {/* Vehicle Options Tags */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-main)' }}>차량 개별 추가 옵션 태그 (Enter 키로 등록)</label>
              <input 
                type="text" 
                placeholder="예: 네비게이션, 선루프 입력 후 Enter" 
                value={optionInput}
                onChange={(e) => setOptionInput(e.target.value)}
                onKeyDown={handleAddOption}
                style={{ width: '100%', padding: '0.45rem 0.6rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem' }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {vehicleOptions.map(opt => (
                  <span key={opt} style={{ background: 'var(--primary-glow)', border: '1px solid var(--primary)', color: 'var(--primary)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    {opt}
                    <button type="button" onClick={() => handleRemoveOption(opt)} style={{ border: 'none', background: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.7rem' }}>×</button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Accordion 4: 상세 계약 금액 (PRICING) */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: 'var(--shadow-premium)' }}>
        <div 
          onClick={() => toggleSection('pricing')}
          style={{ padding: '1rem 1.5rem', background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        >
          <span style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.95rem' }}>4. 상세 계약 금액 설정 (PRICING)</span>
          {expanded.pricing ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
        
        {expanded.pricing && (
          <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.3rem', color: 'var(--text-main)' }}>월 납입금 * (원)</label>
                <input 
                  type="number" 
                  required 
                  value={pricing.monthlyFee} 
                  onChange={(e) => handlePricingChange('monthlyFee', e.target.value)} 
                  style={{ width: '100%', padding: '0.45rem 0.6rem', border: '1px solid var(--primary)', borderRadius: '6px', fontSize: '0.85rem' }} 
                />
              </div>

              {renderInput('기본가격 (원)', 'number', pricing.basePrice, (val) => handlePricingChange('basePrice', val))}
              {renderInput('할인금액 (원)', 'number', pricing.discount, (val) => handlePricingChange('discount', val))}
              {renderInput('공급가액 (원)', 'number', pricing.supplyPrice, (val) => handlePricingChange('supplyPrice', val))}
              {renderInput('탁송료 (원)', 'number', pricing.deliveryFee, (val) => handlePricingChange('deliveryFee', val))}
              {renderInput('취득세 (원)', 'number', pricing.acquisitionTax, (val) => handlePricingChange('acquisitionTax', val))}
              {renderInput('공채 (원)', 'number', pricing.publicBond, (val) => handlePricingChange('publicBond', val))}
              {renderInput('인지대/증지대 (원)', 'number', pricing.stampFee, (val) => handlePricingChange('stampFee', val))}
              {renderInput('번호판대 (원)', 'number', pricing.plateFee, (val) => handlePricingChange('plateFee', val))}
              {renderInput('등록대행료 (원)', 'number', pricing.registrationAgencyFee, (val) => handlePricingChange('registrationAgencyFee', val))}
              {renderInput('수수료 (원)', 'number', pricing.commission, (val) => handlePricingChange('commission', val))}
              {renderInput('보증금 (원)', 'number', pricing.deposit, (val) => handlePricingChange('deposit', val))}
              {renderInput('선수금 (원)', 'number', pricing.advancePayment, (val) => handlePricingChange('advancePayment', val))}
              {renderInput('인수가 (원)', 'number', pricing.takeoverPrice, (val) => handlePricingChange('takeoverPrice', val))}
              
              {renderInput('대여료 결제일 (일)', 'number', pricing.billingDay, (val) => handlePricingChange('billingDay', val), '예: 10')}
              {renderInput('계산서발행일 (일)', 'number', pricing.invoiceDay, (val) => handlePricingChange('invoiceDay', val), '예: 10')}
              {renderInput('위약금률 (%)', 'number', pricing.penaltyRate, (val) => handlePricingChange('penaltyRate', val))}
              {renderInput('연체이율 (%)', 'number', pricing.overdueRate, (val) => handlePricingChange('overdueRate', val))}
              
              {renderInput('할부/대여 기간 (개월)', 'number', pricing.paymentTerm, (val) => handlePricingChange('paymentTerm', val), '예: 60')}
              {renderInput('월 납입금 계 (원)', 'number', pricing.monthlyFeeTotal, (val) => handlePricingChange('monthlyFeeTotal', val))}
              {renderInput('판관비 (원)', 'number', pricing.pandanbi, (val) => handlePricingChange('pandanbi', val))}
              {renderInput('개별소비세 (원)', 'number', pricing.individualConsumptionTax, (val) => handlePricingChange('individualConsumptionTax', val))}
            </div>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', background: 'var(--bg-main)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              {renderInput('등록 비용 계 (원)', 'number', registrationCosts.cost1, (val) => handleNestedChange(setRegistrationCosts, 'cost1', val))}
              {renderInput('부대 비용 계2 (원)', 'number', registrationCosts.cost2, (val) => handleNestedChange(setRegistrationCosts, 'cost2', val))}
            </div>
          </div>
        )}
      </div>

      {/* Accordion 5: 보험 상세 설정 */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: 'var(--shadow-premium)' }}>
        <div 
          onClick={() => toggleSection('insurance')}
          style={{ padding: '1rem 1.5rem', background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        >
          <span style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.95rem' }}>5. 보험 상세 설정</span>
          {expanded.insurance ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
        
        {expanded.insurance && (
          <div style={{ padding: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            {renderInput('보험 회사', 'text', insurance.company, (val) => handleNestedChange(setInsurance, 'company', val), '예: 현대해상')}
            {renderInput('보험 가입일', 'date', insurance.startDate, (val) => handleNestedChange(setInsurance, 'startDate', val))}
            {renderInput('보험료 (원)', 'number', insurance.fee, (val) => handleNestedChange(setInsurance, 'fee', val))}
            {renderInput('자차 보험비 (원)', 'number', insurance.selfCoverage, (val) => handleNestedChange(setInsurance, 'selfCoverage', val))}
            {renderInput('운전자 연령 제한', 'text', insurance.driverAge, (val) => handleNestedChange(setInsurance, 'driverAge', val), '예: 만26세 이상')}
            {renderInput('대인 보장 한도', 'text', insurance.liabilityLimit, (val) => handleNestedChange(setInsurance, 'liabilityLimit', val), '예: 무한')}
            {renderInput('대물 보장 한도', 'text', insurance.propertyLimit, (val) => handleNestedChange(setInsurance, 'propertyLimit', val), '예: 3억원')}
            {renderInput('자기신체사고 (자손)', 'text', insurance.personalInjury, (val) => handleNestedChange(setInsurance, 'personalInjury', val), '예: 1억원')}
            {renderInput('무보험차상해', 'text', insurance.uninsuredInjury, (val) => handleNestedChange(setInsurance, 'uninsuredInjury', val), '예: 2억원')}
            {renderInput('고객 자기부담금', 'text', insurance.deductible, (val) => handleNestedChange(setInsurance, 'deductible', val), '예: 30만원')}
            {renderInput('보험 종류', 'text', insurance.type, (val) => handleNestedChange(setInsurance, 'type', val), '예: 누구나')}
            {renderInput('긴급출동 횟수', 'text', insurance.emergencyCall, (val) => handleNestedChange(setInsurance, 'emergencyCall', val), '예: 5회/년')}
            {renderInput('사고수리 가입 여부', 'text', insurance.accidentRepair, (val) => handleNestedChange(setInsurance, 'accidentRepair', val), '예: 가입, 미가입')}
            {renderInput('일반정비 가입 여부', 'text', insurance.generalMaintenance, (val) => handleNestedChange(setInsurance, 'generalMaintenance', val), '예: 가입(소모품포함)')}
          </div>
        )}
      </div>

      {/* Accordion 6: 정비 및 타이어 관리 */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: 'var(--shadow-premium)' }}>
        <div 
          onClick={() => toggleSection('maintenance')}
          style={{ padding: '1rem 1.5rem', background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        >
          <span style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.95rem' }}>6. 정비 및 소모품/타이어 관리</span>
          {expanded.maintenance ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
        
        {expanded.maintenance && (
          <div style={{ padding: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            {renderInput('소모품 교환 조항', 'text', maintenance.consumables, (val) => handleNestedChange(setMaintenance, 'consumables', val), '예: 사용자 부담')}
            {renderInput('제공 타이어 본수', 'text', maintenance.tireCount, (val) => handleNestedChange(setMaintenance, 'tireCount', val), '예: 4본/2년')}
            {renderInput('타이어 사양', 'text', maintenance.tireSpec, (val) => handleNestedChange(setMaintenance, 'tireSpec', val), '예: 금호 205/55R16')}
            {renderInput('타이어 비용 (원)', 'number', maintenance.tireCost, (val) => handleNestedChange(setMaintenance, 'tireCost', val))}
            {renderInput('정기 점검 조건', 'text', maintenance.regularCheck, (val) => handleNestedChange(setMaintenance, 'regularCheck', val), '예: 6개월 방문')}
            {renderInput('자동차세 금액 (원)', 'number', tax.carTax, (val) => handleNestedChange(setTax, 'carTax', val))}
          </div>
        )}
      </div>

      {/* Accordion 7: 할부 금융 정보 */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: 'var(--shadow-premium)' }}>
        <div 
          onClick={() => toggleSection('loan')}
          style={{ padding: '1rem 1.5rem', background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        >
          <span style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.95rem' }}>7. 할부 금융 및 자금 실행 설정</span>
          {expanded.loan ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
        
        {expanded.loan && (
          <div style={{ padding: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
            {renderInput('차용처 / 금융사', 'text', loan.source, (val) => handleNestedChange(setLoan, 'source', val), '예: 신한카드, 현금')}
            {renderInput('실행일', 'date', loan.executionDate, (val) => handleNestedChange(setLoan, 'executionDate', val))}
            {renderInput('할부 이용 금액 (원)', 'number', loan.amount, (val) => handleNestedChange(setLoan, 'amount', val))}
            {renderInput('할부 기간 (개월)', 'number', loan.term, (val) => handleNestedChange(setLoan, 'term', val))}
            {renderInput('월 할부금 (원)', 'number', loan.monthlyPayment, (val) => handleNestedChange(setLoan, 'monthlyPayment', val))}
            {renderInput('월 할부금 계 (원)', 'number', loan.monthlyPaymentTotal, (val) => handleNestedChange(setLoan, 'monthlyPaymentTotal', val))}
            {renderInput('할부 총 이자 (원)', 'number', loan.totalInterest, (val) => handleNestedChange(setLoan, 'totalInterest', val))}
            {renderInput('할부 금리 (%)', 'number', loan.interestRate, (val) => handleNestedChange(setLoan, 'interestRate', val), '예: 5.8')}
          </div>
        )}
      </div>

      {/* Accordion 8: 지급 사은품 정보 */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden', boxShadow: 'var(--shadow-premium)' }}>
        <div 
          onClick={() => toggleSection('gifts')}
          style={{ padding: '1rem 1.5rem', background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        >
          <span style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.95rem' }}>8. 사은품 관리 (GIFT)</span>
          {expanded.gifts ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
        
        {expanded.gifts && (
          <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button 
                type="button" 
                onClick={handleAddGift} 
                style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', background: '#3b82f6', color: '#fff', border: 'none', padding: '0.3rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: '600' }}
              >
                <Plus size={12} /> 추가
              </button>
            </div>
            {gifts.map((gift, index) => (
              <div key={index} style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <input 
                  type="text" 
                  placeholder="사은품명 (예: 루마썬팅)" 
                  value={gift.name} 
                  onChange={(e) => handleGiftChange(index, 'name', e.target.value)} 
                  style={{ flex: 2, padding: '0.45rem 0.6rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem' }} 
                />
                <input 
                  type="number" 
                  placeholder="가격 (원)" 
                  value={gift.price} 
                  onChange={(e) => handleGiftChange(index, 'price', e.target.value)} 
                  style={{ flex: 1, padding: '0.45rem 0.6rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem' }} 
                />
                <button type="button" onClick={() => handleRemoveGift(index)} style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Form Action Buttons */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
        <button 
          type="button" 
          onClick={() => setActiveTab('contracts')} 
          style={{ background: '#fff', border: '1px solid var(--border-color)', padding: '0.6rem 1.5rem', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem' }}
        >
          <MenuCancelText>취소</MenuCancelText>
        </button>
        <button 
          type="submit" 
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.6rem 1.5rem', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem' }}
        >
          <Save size={16} /> 통합 계약서 등록 완료
        </button>
      </div>

    </form>
  );
}

// Simple text wrapper helper to avoid variable confusion
const MenuCancelText = ({ children }) => <span>{children}</span>;

export default ContractRegisterView;
