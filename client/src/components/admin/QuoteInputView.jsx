import React, { useState, useEffect } from 'react';
import { Sparkles, Save, ArrowRight, UserPlus, Users, Car, Coins, Settings, HelpCircle, CheckCircle, Plus, Trash2 } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

// Financial PMT Function (matching Excel PMT)
function PMT(rate, nper, pv) {
  if (rate === 0) return -pv / nper;
  const pvif = Math.pow(1 + rate, nper);
  return (rate * pv * pvif) / (1 - pvif);
}

// Number formatting with commas
const toCommaString = (num) => {
  if (num === undefined || num === null || isNaN(num)) return '0';
  return Math.round(num).toLocaleString('ko-KR');
};

const parseNumber = (val) => {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const num = Number(val.toString().replace(/[^0-9.-]/g, ''));
  return isNaN(num) ? 0 : num;
};

const VEHICLE_COLORS = [
  { primary: '#1890ff', light: '#e6f7ff', border: '#91d5ff', dark: '#0050b3' }, // Blue (차량 1)
  { primary: '#10b981', light: '#ecfdf5', border: '#a7f3d0', dark: '#047857' }, // Emerald Green (차량 2)
  { primary: '#f59e0b', light: '#fffbeb', border: '#fde68a', dark: '#b45309' }, // Amber Orange (차량 3)
  { primary: '#8b5cf6', light: '#f5f3ff', border: '#ddd6fe', dark: '#6d28d9' }, // Violet Purple (차량 4)
  { primary: '#ec4899', light: '#fdf2f8', border: '#fbcfe8', dark: '#be185d' }  // Pink (차량 5)
];

const getVehicleColor = (index) => {
  return VEHICLE_COLORS[index % VEHICLE_COLORS.length];
};

const defaultMaintenanceItems = [
  { name: '엔진오일', cycle: '7,000~8,000km', desc: '오일필터+에어 클리너', price: 200000, checked: true },
  { name: '에어컨 향균필터', cycle: '15,000~20,000km 또는 1년 도래시', desc: '향균필터', price: 40000, checked: true },
  { name: '와이퍼', cycle: '1년 도래시', desc: '-', price: 25000, checked: true },
  { name: '에어컨 가스', cycle: '1년 도래시', desc: '부족할 시', price: 250000, checked: true },
  { name: '타이어 위치 교환', cycle: '20,000km', desc: '타이어 로테이션 + 휠 밸런스', price: 100000, checked: true },
  { name: '타이어 공기압 보충', cycle: '매 점검시', desc: '-', price: 0, checked: true },
  { name: '타이어 교체', cycle: '50,000~70,000km', desc: '타이어*마모 한계선 도래 시 교체', price: 600000, checked: true },
  { name: '연료 필터', cycle: '40,000km', desc: '-', price: 60000, checked: true },
  { name: '앞 브레이크 패드 / 라이닝', cycle: '40,000km 또는 마모 시', desc: '앞 디스크 브레이크 패드', price: 150000, checked: true },
  { name: '뒤 브레이크 패드 / 라이닝', cycle: '70,000km 또는 마모 시', desc: '뒤 브레이크 라이닝', price: 150000, checked: true },
  { name: '오일류', cycle: '50,000~60,000km', desc: '변속기/브레이크/파워오일', price: 150000, checked: true },
  { name: '밸브류', cycle: '50,000km', desc: '에어컨/파워/팬 벨트', price: 200000, checked: true },
  { name: '전구류', cycle: '필요시', desc: '라이트/안개', price: 50000, checked: true },
  { name: '베터리', cycle: '80,000~100,000km', desc: '베터리', price: 200000, checked: true },
  { name: '점화플러그', cycle: '일반 40,000km / 백금 100,000km', desc: '점화 플러그, 배선', price: 50000, checked: true },
  { name: '타이밍벨트/워터펌프', cycle: '80,000~90,000km', desc: '타이밍 벨트 세트', price: 267450, checked: true },
  { name: '부동액', cycle: '100,000km 또는 필요시', desc: '부동액', price: 50000, checked: true },
  { name: '기타 보충', cycle: '수시', desc: '-', price: 0, checked: true }
];

const getRecommendedTirePrices = (carModel) => {
  const model = (carModel || '').toLowerCase();
  
  if (model.includes('gv80') || model.includes('팰리세이드') || model.includes('모하비') || model.includes('렉스턴')) {
    return {
      standard: 160000,
      premium: 260000,
      standardLabel: '금호 크루젠 HP71 (16만원)',
      premiumLabel: '미쉐린 프라이머시 LTX (26만원)'
    };
  }
  if (model.includes('쏘렌토') || model.includes('싼타페') || model.includes('스포티지') || model.includes('투싼') || model.includes('qm6') || model.includes('토레스')) {
    return {
      standard: 140000,
      premium: 220000,
      standardLabel: '한국 다이나프로 HL3 (14만원)',
      premiumLabel: '콘티넨탈 크로스콘택트 (22만원)'
    };
  }
  if (model.includes('g80') || model.includes('g90') || model.includes('그랜저') || model.includes('그랜져') || model.includes('k9') || model.includes('k8') || model.includes('아우디') || model.includes('벤츠') || model.includes('bmw')) {
    return {
      standard: 150000,
      premium: 240000,
      standardLabel: '금호 마제스티9 TA91 (15만원)',
      premiumLabel: '미쉐린 파일럿 스포츠 4 (24만원)'
    };
  }
  if (model.includes('아반떼') || model.includes('k3') || model.includes('k5') || model.includes('쏘나타') || model.includes('소나타') || model.includes('말리부') || model.includes('sm6')) {
    return {
      standard: 110000,
      premium: 170000,
      standardLabel: '금호 솔루스 TA51 (11만원)',
      premiumLabel: '한국 벤투스 S2 AS (17만원)'
    };
  }
  if (model.includes('캐스퍼') || model.includes('레이') || model.includes('모닝') || model.includes('스파크')) {
    return {
      standard: 80000,
      premium: 120000,
      standardLabel: '한국 키너지 EX (8만원)',
      premiumLabel: '금호 솔루스 TA31 (12만원)'
    };
  }
  return {
    standard: 130000,
    premium: 200000,
    standardLabel: '일반 사계절 타이어 (13만원)',
    premiumLabel: '고급 저소음 타이어 (20만원)'
  };
};

const getCalculatedMaintenanceFee = (opt, vehicle) => {
  if (!opt || !vehicle) return 50000;
  
  const rawItems = opt.maintenanceItems || vehicle.maintenanceItems || defaultMaintenanceItems;
  const totalMileage = (opt.termYears || 4) * (opt.mileage || 20000);
  const computedTireCount = Math.floor(totalMileage / 60000) * 4;
  const computedTireCost = computedTireCount * (opt.tireUnitCost || 150000);
  
  const totalSum = rawItems
    .filter(item => item.checked)
    .reduce((sum, item) => {
      if (item.name === '타이어 교체') {
        return sum + computedTireCost;
      }
      return sum + (item.price || 0);
    }, 0);
    
  const termMonths = (opt.termYears || 4) * 12;
  if (termMonths <= 0) return 0;
  
  return Math.floor((totalSum / termMonths) / 1000) * 1000;
};

function QuoteInputView({ setActiveTab, setPrefilledQuoteData, showToast }) {
  const [customers, setCustomers] = useState([]);
  const [useExistingCustomer, setUseExistingCustomer] = useState(true);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerSearchResults, setCustomerSearchResults] = useState([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  
  // New Customer Form State
  const [newCustomer, setNewCustomer] = useState({
    name: '',
    bizNo: '',
    ceoName: '',
    address: '',
    contactName: '',
    contactPhone: '',
    email: '',
    bankName: '',
    bankAccount: '',
    bankHolder: ''
  });

  // Helper to create a new vehicle structure
  const createNewVehicle = (id) => ({
    id,
    carModel: id === 1 ? '팰리세이드 (H) 2.5 2WD 프레스티지 9인승' : '',
    carOptionsName: '-',
    carPrice: id === 1 ? 56680000 : 0,
    carOptionPrice: 0,
    discountPrice: 0,
    fuelType: '가솔린',
    cc: 2500,
    deliveryPeriod: '-',
    exteriorColor: '-',
    interiorColor: '-',
    
    // Vehicle-specific financial settings
    baseInterestRate: 0.06,
    commissionRateP: 0.03,
    dealerCommissionRateP: 0.03,
    tireCount: 4,
    monthlyMaintenanceFee: 50000,
    consignmentFee: 360000,
    isBondExempt: false,
    globalInsuranceFee: 800000,
    globalRegistrationAgencyFee: 100000,
    isPandanbiEnabled: true,
    isMaintenanceEnabled: true,
    maintenanceItems: null,
    
    // Options specific to this vehicle comparison
    options: [
      {
        id: 1,
        name: '1안',
        companyName: '',
        termYears: 4,
        mileage: 30000,
        residualRate: 0.55,
        depositRate: 0.30,
        advancePaymentRate: 0.00,
        dealerIncentiveRate: 0.00,
        tireUnitCost: 160000,
        tireType: 'standard',
        discountRate: 0.00,
        maintenancePlan: '가입',
        insuranceFeeAnnual: 800000,
        registrationAgencyFee: 100000,
        calcMode: 'manual',
        monthlyFeeInput: id === 1 ? 996000 : 0,
        targetProfitInput: 0
      },
      {
        id: 2,
        name: '2안',
        companyName: '',
        termYears: 4,
        mileage: 20000,
        residualRate: 0.55,
        depositRate: 0.00,
        advancePaymentRate: 0.00,
        dealerIncentiveRate: 0.00,
        tireUnitCost: 240000,
        tireType: 'premium',
        discountRate: 0.00,
        maintenancePlan: '가입',
        insuranceFeeAnnual: 800000,
        registrationAgencyFee: 100000,
        calcMode: 'manual',
        monthlyFeeInput: 0,
        targetProfitInput: 0
      }
    ],
    selectedOptionId: 1,
    selectedOptionIds: [1]
  });

  const [vehicles, setVehicles] = useState([createNewVehicle(1)]);
  const [selectedVehicleId, setSelectedVehicleId] = useState(1);
  const [activeInputKey, setActiveInputKey] = useState(null); // e.g., 'option-1-depositRate'
  const [activeInputValue, setActiveInputValue] = useState(''); // temporary input string
  const [createdBy, setCreatedBy] = useState('이두식');
  const [printFormType, setPrintFormType] = useState('comparison'); // 'comparison' or 'rental'
  const [isMaintenanceDetailModalOpen, setIsMaintenanceDetailModalOpen] = useState(false);
  const [subView, setSubView] = useState('quote'); // 'quote' or 'maintenance'
  const [tempMaintenanceItems, setTempMaintenanceItems] = useState([]);
  const [tempMonthlyMaintenanceFee, setTempMonthlyMaintenanceFee] = useState(0);

  const activeVehicle = vehicles.find(v => v.id === selectedVehicleId) || vehicles[0];

  const updateActiveVehicle = (fields) => {
    setVehicles(prev => prev.map(v => v.id === selectedVehicleId ? { ...v, ...fields } : v));
  };

  const updateActiveVehicleOption = (optionId, fields) => {
    setVehicles(prev => prev.map(v => {
      if (v.id !== selectedVehicleId) return v;
      const updatedOptions = v.options.map(opt => opt.id === optionId ? { ...opt, ...fields } : opt);
      return { ...v, options: updatedOptions };
    }));
  };

  const handleAddVehicle = () => {
    // Generate next ID
    const nextId = vehicles.length > 0 ? Math.max(...vehicles.map(v => v.id)) + 1 : 1;
    const newVeh = createNewVehicle(nextId);
    setVehicles(prev => [...prev, newVeh]);
    setSelectedVehicleId(nextId);
  };

  const handleDeleteVehicle = (vehicleId, e) => {
    e.stopPropagation(); // Avoid switching tabs when deleting
    if (vehicles.length <= 1) return; // Prevent deleting the last vehicle
    
    setVehicles(prev => prev.filter(v => v.id !== vehicleId));
    if (selectedVehicleId === vehicleId) {
      // Find another vehicle to select
      const remaining = vehicles.filter(v => v.id !== vehicleId);
      setSelectedVehicleId(remaining[0].id);
    }
  };

  const toggleOptionSelection = (optionId) => {
    const currentIds = activeVehicle.selectedOptionIds || (activeVehicle.selectedOptionId ? [activeVehicle.selectedOptionId] : [1]);
    let newIds;
    if (currentIds.includes(optionId)) {
      if (currentIds.length <= 1) {
        showToast('적어도 하나의 안은 선택되어야 합니다.', 'info');
        return;
      }
      newIds = currentIds.filter(id => id !== optionId);
    } else {
      newIds = [...currentIds, optionId];
    }
    updateActiveVehicle({ selectedOptionIds: newIds });
  };

  const handleAddOption = () => {
    const nextId = activeVehicle.options.length + 1;
    const newOpt = {
      id: nextId,
      name: `${nextId}안`,
      companyName: '',
      termYears: 4,
      mileage: 20000,
      residualRate: 0.55,
      depositRate: 0.30,
      advancePaymentRate: 0.00,
      dealerIncentiveRate: 0.00,
      tireUnitCost: 160000,
      discountRate: 0.00,
      maintenancePlan: '가입',
      insuranceFeeAnnual: 800000,
      registrationAgencyFee: 100000,
      calcMode: 'manual',
      monthlyFeeInput: 0,
      targetProfitInput: 0
    };
    const currentIds = activeVehicle.selectedOptionIds || (activeVehicle.selectedOptionId ? [activeVehicle.selectedOptionId] : [1]);
    updateActiveVehicle({
      options: [...activeVehicle.options, newOpt],
      selectedOptionId: nextId,
      selectedOptionIds: [...currentIds, nextId]
    });
  };

  useEffect(() => {
    // Fetch initial customers
    const fetchInitialCustomers = async () => {
      try {
        const response = await fetch(`${API_HOST}/api/customers?limit=50`);
        if (response.ok) {
          const data = await response.json();
          const list = data.customers || data || [];
          setCustomerSearchResults(list);
          setCustomers(list);
          setSelectedCustomerId('');
          setSelectedCustomer(null);
          setCustomerSearchQuery('');
        }
      } catch (err) {
        console.error('Failed to fetch customers', err);
      }
    };
    fetchInitialCustomers();
  }, []);

  useEffect(() => {
    if (!customerSearchQuery.trim()) {
      const fetchInitial = async () => {
        try {
          const response = await fetch(`${API_HOST}/api/customers?limit=50`);
          if (response.ok) {
            const data = await response.json();
            const list = data.customers || data || [];
            setCustomerSearchResults(list);
          }
        } catch (e) {
          console.error(e);
        }
      };
      fetchInitial();
      return;
    }

    // Debounce search API calls
    const delayDebounceFn = setTimeout(async () => {
      try {
        const response = await fetch(`${API_HOST}/api/customers?search=${encodeURIComponent(customerSearchQuery)}&limit=50`);
        if (response.ok) {
          const data = await response.json();
          const list = data.customers || data || [];
          setCustomerSearchResults(list);
        }
      } catch (err) {
        console.error('Search query failed', err);
      }
    }, 250);

    return () => clearTimeout(delayDebounceFn);
  }, [customerSearchQuery]);

  // 4. 수식 계산 로직 (Formulas implementation)
  const calculateOptionValues = (opt, vehicle = activeVehicle) => {
    if (!opt || !vehicle) return {
      totalCarPrice: 0,
      discountAmount: 0,
      netVehiclePrice: 0,
      acquisitionTax: 0,
      publicBond: 0,
      ownCarInsuranceFee: 0,
      carTaxAnnual: 0,
      deposit: 0,
      advancePayment: 0,
      fundingPrincipal: 0,
      interestRate: 0,
      fundingInterest: 0,
      advancePaymentInterest: 0,
      monthlyInstallmentSum: 0,
      monthlyInstallment: 0,
      totalBuyPriceWithFinancing: 0,
      dealerCommission: 0,
      companyCommission: 0,
      pandanbi: 0,
      tireCostTotal: 0,
      maintenanceFeeTotal: 0,
      totalCost: 0,
      takeoverPrice: 0,
      monthlyLeaseFee: 0,
      profitMargin: 0,
      profitRate: 0
    };

    const {
      carPrice,
      carOptionPrice,
      discountPrice,
      consignmentFee,
      isBondExempt,
      globalInsuranceFee,
      cc,
      baseInterestRate,
      dealerCommissionRateP,
      commissionRateP,
      isPandanbiEnabled,
      tireCount,
      monthlyMaintenanceFee,
      isMaintenanceEnabled,
      globalRegistrationAgencyFee
    } = vehicle;

    // 총 차량가격 = 차량가격 + 옵션가격
    const totalCarPrice = carPrice + carOptionPrice;
    
    // 할인/면세액
    const discountAmount = discountPrice;
    
    // 차량가격 (11행: E11) -> 8번 결론식: 기본차량가 + 옵션가 - 할인가 + 탁송료
    const netVehiclePrice = carPrice + carOptionPrice - discountPrice + consignmentFee;
    
    // 취득세 (E21) -> ROUNDDOWN(E11/1.1*0.04, -1)
    const acquisitionTax = Math.floor(((netVehiclePrice / 1.1) * 0.04) / 10) * 10;
    
    // 공채 (E22) -> ROUNDDOWN(E11/1.1*3%*16%,-1) (면제 시 0)
    const publicBond = isBondExempt ? 0 : Math.floor(((netVehiclePrice / 1.1) * 0.03 * 0.16) / 10) * 10;
    
    // 자차보험비 (E24) -> E7(netVehiclePrice) 기준으로 계산
    let ownCarRate;
    if (netVehiclePrice <= 10000000) {
      ownCarRate = 0.022;
    } else if (netVehiclePrice >= 500000000) {
      ownCarRate = 0.012;
    } else {
      ownCarRate = 0.017 - (netVehiclePrice - 10000000) * (0.01 / (500000000 - 10000000));
    }
    // 기존의 ceilingCarPrice(천만 원 단위 올림) 곱하기 방식 대신, 실제 차량 공급가액(netVehiclePrice)을 기준으로 계산하여 역전 현상을 해결합니다.
    const ownCarInsuranceFee = netVehiclePrice * ownCarRate;
    
    // 자동차세 (E25) -> 배기량(cc) 기준 IF 조건 적용
    let carTaxAnnual = 20000;
    if (cc <= 0 || !cc) {
      carTaxAnnual = 20000;
    } else if (cc <= 1600) {
      carTaxAnnual = cc * 18;
    } else if (cc <= 2500) {
      carTaxAnnual = cc * 19;
    } else if (cc > 2500) {
      carTaxAnnual = cc * 24;
    } else {
      carTaxAnnual = 20000;
    }
    
    // 보증금 (E38) 및 선수금 (E40) -> 천단위 미만 버림
    const deposit = Math.floor((totalCarPrice * opt.depositRate) / 1000) * 1000;
    const advancePayment = Math.floor((totalCarPrice * opt.advancePaymentRate) / 1000) * 1000;
    
    // 조달원금 (E13)
    const fundingPrincipal = netVehiclePrice - deposit - advancePayment + acquisitionTax + publicBond + globalInsuranceFee + ownCarInsuranceFee;
    
    // 이자부담율 (E14)
    const termMonths = Math.round(Number(opt.termYears) * 12);
    let addedRate = 0.014;
    if (termMonths <= 12) addedRate = 0.0031;
    else if (termMonths <= 24) addedRate = 0.0025;
    else if (termMonths <= 36) addedRate = 0.0019;
    else if (termMonths <= 48) addedRate = 0.0014;
    else addedRate = 0.0010;
    const interestRate = baseInterestRate + addedRate;
    
    const rentPeriodMonths = opt.termYears * 12; // E32
    
    // 조달이자 (E15)
    const fundingInterest = PMT(interestRate / 12, rentPeriodMonths, -fundingPrincipal) * rentPeriodMonths - fundingPrincipal;
    
    // 선수금분이자 (E16)
    const advancePaymentInterest = advancePayment * 0.03 * opt.termYears;
    
    // 월할부금계 (E18)
    const monthlyInstallmentSum = fundingPrincipal + fundingInterest - advancePaymentInterest;
    
    // 월할부금 (E17)
    const monthlyInstallment = monthlyInstallmentSum / rentPeriodMonths;
    
    // 할부 시 총구입가 (E19)
    const totalBuyPriceWithFinancing = netVehiclePrice + fundingInterest + advancePaymentInterest;
    
    // 딜러 수수료 (AD6)
    const dealerCommission = totalCarPrice * dealerCommissionRateP;
    
    // 수수료 (AD2)
    const companyCommission = totalCarPrice * commissionRateP;
    
    // 판관비/노무비 (E28) - 글로벌 설정 기준
    const pandanbi = isPandanbiEnabled ? totalCarPrice * 0.03 : 0;
    
    // 동적 타이어 본수 계산 (6만km당 4본)
    const totalMileage = opt.termYears * opt.mileage;
    const computedTireCount = Math.floor(totalMileage / 60000) * 4;

    // 타이어 교체 비용 (AD13)
    const tireCostTotal = computedTireCount * opt.tireUnitCost;
    
    // 정기점검 비용 (AD16) - 옵션별 실시간 계산 적용 (1000원 단위 버림)
    const calculatedMaintenanceFee = getCalculatedMaintenanceFee(opt, vehicle);
    const maintenanceFeeTotal = calculatedMaintenanceFee * rentPeriodMonths;
    
    // 총구입원가 (E30) - 옵션별 정비 가입 여부 적용
    const optMaintenanceEnabled = opt.isMaintenanceEnabled !== undefined ? opt.isMaintenanceEnabled : isMaintenanceEnabled;
    let totalCost;
    const basicFees = ((globalInsuranceFee + ownCarInsuranceFee) * opt.termYears) + (carTaxAnnual * opt.termYears) + totalBuyPriceWithFinancing + globalRegistrationAgencyFee + publicBond + acquisitionTax + companyCommission + pandanbi + dealerCommission;
    
    if (optMaintenanceEnabled) {
      totalCost = basicFees + maintenanceFeeTotal + tireCostTotal;
    } else {
      totalCost = basicFees;
    }
    
    // 인수가 (E36) -> 천단위 미만 버림
    const takeoverPrice = Math.floor((totalCarPrice * opt.residualRate) / 1000) * 1000;
    
    // 최종 결과 계산 (월 렌트료 & 영업이익)
    let monthlyLeaseFee = 0;
    let profitMargin = 0;
    
    if (opt.calcMode === 'manual') {
      // 월 렌트료 직접 입력 모드
      monthlyLeaseFee = opt.monthlyFeeInput;
      const totalRevenue = (monthlyLeaseFee * rentPeriodMonths) + takeoverPrice + advancePayment;
      profitMargin = totalRevenue - totalCost;
    } else {
      // 영업이익 직접 입력 모드 (기본 계산식 등)
      profitMargin = opt.targetProfitInput;
      const targetRevenue = totalCost + profitMargin;
      const totalLeasePayments = targetRevenue - takeoverPrice - advancePayment;
      monthlyLeaseFee = Math.floor((totalLeasePayments / rentPeriodMonths) / 1000) * 1000; // 1000원 단위 절사
    }
    
    const profitRate = (profitMargin + companyCommission) / totalCarPrice; // AD31
    
    return {
      totalCarPrice,
      discountAmount,
      netVehiclePrice,
      acquisitionTax,
      publicBond,
      ownCarInsuranceFee,
      carTaxAnnual,
      deposit,
      advancePayment,
      fundingPrincipal,
      interestRate,
      fundingInterest,
      advancePaymentInterest,
      monthlyInstallmentSum,
      monthlyInstallment,
      totalBuyPriceWithFinancing,
      dealerCommission,
      companyCommission,
      pandanbi,
      tireCostTotal,
      maintenanceFeeTotal,
      totalCost,
      takeoverPrice,
      monthlyLeaseFee,
      profitMargin,
      profitRate
    };
  };

  const handleOptionChange = (id, field, value) => {
    updateActiveVehicleOption(id, { [field]: value });
  };

  // 포커싱 헬퍼 핸들러들
  const handleFocus = (optionId, field) => {
    setActiveInputKey(`option-${optionId}-${field}`);
    setActiveInputValue(''); // 클릭 시 빈칸으로 비움
  };

  const handleBlur = () => {
    setActiveInputKey(null);
    setActiveInputValue('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.target.blur();
    }
  };

  const handleInputChange = (optionId, field, rawValue) => {
    setActiveInputValue(rawValue);

    // 실시간으로 역산/연동 수식 계산 반영
    let parsed = parseNumber(rawValue);

    // 백분율(%) 입력은 내부적으로 소수점으로 변환
    if (field === 'depositRate' || field === 'advancePaymentRate' || field === 'residualRate' || field === 'dealerIncentiveRate') {
      parsed = parsed / 100;
    }

    // 금액 입력을 요율로 역산하는 경우
    const totalCarPrice = activeVehicle.carPrice + activeVehicle.carOptionPrice;
    if (field === 'depositAmount') {
      const rate = totalCarPrice > 0 ? parsed / totalCarPrice : 0;
      handleOptionChange(optionId, 'depositRate', rate);
    } else if (field === 'advancePaymentAmount') {
      const rate = totalCarPrice > 0 ? parsed / totalCarPrice : 0;
      handleOptionChange(optionId, 'advancePaymentRate', rate);
    } else if (field === 'residualAmount') {
      const rate = totalCarPrice > 0 ? parsed / totalCarPrice : 0;
      handleOptionChange(optionId, 'residualRate', rate);
    } else if (field === 'termMonths') {
      handleOptionChange(optionId, 'termYears', parsed / 12);
    } else {
      handleOptionChange(optionId, field, parsed);
    }
  };

  const getInputValue = (optionId, field, stateValue) => {
    const key = `option-${optionId}-${field}`;
    if (activeInputKey === key) {
      return activeInputValue;
    }
    // 평소 상태일 때는 포맷팅해서 출력
    if (field === 'termYears') return stateValue || '';
    if (field === 'termMonths') return stateValue || '';
    if (field === 'mileage' || field === 'monthlyMaintenanceFee' || field === 'tireUnitCost') {
      return stateValue !== undefined ? toCommaString(stateValue) : '';
    }
    
    // 백분율 요율 필드는 100을 곱하고 소수점 2자리 정리 + '%' 붙이기
    if (field === 'depositRate' || field === 'advancePaymentRate' || field === 'residualRate' || field === 'dealerIncentiveRate') {
      if (stateValue === undefined || stateValue === null || isNaN(stateValue)) return '0%';
      const val = stateValue === 0 ? '0' : parseFloat((stateValue * 100).toFixed(2));
      return val + '%';
    }
    
    return stateValue;
  };

  const validateForm = () => {
    if (useExistingCustomer && !selectedCustomerId) {
      showToast('고객을 선택해주세요.', 'error');
      return false;
    }
    if (!useExistingCustomer) {
      if (!newCustomer.name.trim() || !newCustomer.bizNo.trim()) {
        showToast('신규 고객명과 사업자/주민번호는 필수입니다.', 'error');
        return false;
      }
    }
    if (!activeVehicle.carModel || !activeVehicle.carModel.trim()) {
      showToast('차종 / 모델명을 입력해주세요.', 'error');
      return false;
    }
    return true;
  };

  const handleSaveQuote = async (convertToContractAfterSave = false) => {
    if (!validateForm()) return;

    // Get the currently selected option values (use first selected option as primary)
    const selectedOptionIds = activeVehicle.selectedOptionIds || (activeVehicle.selectedOptionId ? [activeVehicle.selectedOptionId] : [1]);
    const primarySelectedId = selectedOptionIds[0] || 1;
    const selectedOpt = activeVehicle.options.find(o => o.id === primarySelectedId) || activeVehicle.options[0];
    const calculated = calculateOptionValues(selectedOpt, activeVehicle);

    try {
      const payload = {
        customerId: useExistingCustomer ? selectedCustomerId : undefined,
        newCustomer: !useExistingCustomer ? {
          name: newCustomer.name,
          bizNo: newCustomer.bizNo,
          ceoName: newCustomer.ceoName,
          address: newCustomer.address,
          contactName: newCustomer.contactName,
          contactPhone: newCustomer.contactPhone,
          email: newCustomer.email,
          bank: {
            name: newCustomer.bankName,
            account: newCustomer.bankAccount,
            holder: newCustomer.bankHolder
          }
        } : undefined,
        vehicleModel: activeVehicle.carModel,
        vehicleSpec: `${activeVehicle.carOptionsName} / 연료: ${activeVehicle.fuelType} / 배기량: ${activeVehicle.cc}cc / 납기: ${activeVehicle.deliveryPeriod} / 외장: ${activeVehicle.exteriorColor} / 내장: ${activeVehicle.interiorColor}`,
        totalPrice: calculated.totalCarPrice,
        // Convert options to estimates terms list
        monthlyEstimates: activeVehicle.options.map(opt => {
          const optCalc = calculateOptionValues(opt, activeVehicle);
          return {
            termMonths: opt.termYears * 12,
            monthlyFee: optCalc.monthlyLeaseFee,
            name: opt.name,
            companyName: opt.companyName
          };
        }),
        createdBy
      };

      const response = await fetch(`${API_HOST}/api/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const savedQuote = await response.json();
        showToast('견적서가 저장되었습니다.', 'success');

        if (convertToContractAfterSave) {
          // Pass prefilled data with pricing info of the selected option
          const prefilledData = {
            ...savedQuote,
            totalPrice: calculated.totalCarPrice,
            monthlyEstimates: [
              { 
                termMonths: selectedOpt.termYears * 12, 
                monthlyFee: calculated.monthlyLeaseFee,
                name: selectedOpt.name,
                companyName: selectedOpt.companyName
              }
            ],
            // Custom option details to prefill pricing section
            pricing: {
              basePrice: activeVehicle.carPrice,
              discount: calculated.discountAmount,
              supplyPrice: calculated.netVehiclePrice,
              deliveryFee: activeVehicle.consignmentFee,
              acquisitionTax: calculated.acquisitionTax,
              publicBond: calculated.publicBond,
              commission: calculated.companyCommission,
              deposit: calculated.deposit,
              advancePayment: calculated.advancePayment,
              takeoverPrice: calculated.takeoverPrice,
              monthlyFee: calculated.monthlyLeaseFee,
              paymentTerm: selectedOpt.termYears * 12,
              pandanbi: calculated.pandanbi,
              individualConsumptionTax: calculated.carTaxAnnual * selectedOpt.termYears,
              registrationAgencyFee: activeVehicle.globalRegistrationAgencyFee
            }
          };
          setPrefilledQuoteData(prefilledData);
          setActiveTab('contract-register');
        } else {
          // Trigger print preview of the comparison sheet first, then go to contracts list
          setTimeout(() => {
            window.print();
            setActiveTab('contracts');
          }, 800);
        }
      } else {
        const err = await response.json();
        showToast(err.message || '견적서 저장에 실패했습니다.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 통신 오류', 'error');
    }
  };

  const selectedOptionIds = activeVehicle.selectedOptionIds || (activeVehicle.selectedOptionId ? [activeVehicle.selectedOptionId] : [1]);
  const primarySelectedId = selectedOptionIds[0] || 1;
  const options = activeVehicle.options || [];
  const selectedOpt = options.find(o => o.id === primarySelectedId) || options[0] || {};
  const selectedCalc = calculateOptionValues(selectedOpt, activeVehicle);
  const recTires = getRecommendedTirePrices(activeVehicle.carModel);
  const totalCarPrice = activeVehicle.carPrice + activeVehicle.carOptionPrice;
  const activeIndex = vehicles.findIndex(v => v.id === selectedVehicleId) + 1;
  const displayOpts = options.filter(o => selectedOptionIds.includes(o.id));
  const fallbackDisplayOpts = displayOpts.length > 0 ? displayOpts : [options[0]];

  const activeVehicleIndex = vehicles.findIndex(v => v.id === selectedVehicleId);
  const activeVehicleColor = getVehicleColor(activeVehicleIndex);

  // Collect all selected options across all vehicles
  const allSelectedOptions = vehicles.flatMap((veh, vIdx) => {
    const vColor = getVehicleColor(vIdx);
    const sIds = veh.selectedOptionIds || (veh.selectedOptionId ? [veh.selectedOptionId] : [1]);
    const sOpts = (veh.options || []).filter(o => sIds.includes(o.id));
    return sOpts.map(opt => ({
      veh,
      vIdx,
      vColor,
      opt,
      calc: calculateOptionValues(opt, veh)
    }));
  });

  // If absolutely none are selected across any vehicles, fallback to active vehicle's first option
  const displaySelectedOptions = allSelectedOptions.length > 0 
    ? allSelectedOptions 
    : [{
        veh: activeVehicle,
        vIdx: activeVehicleIndex,
        vColor: activeVehicleColor,
        opt: options[0],
        calc: calculateOptionValues(options[0], activeVehicle)
      }];

  const displayCustomerName = selectedCustomer 
    ? (selectedCustomer.surname || selectedCustomer.name || '').trim()
    : (newCustomer.name || '고객');

  const todayDateStr = new Date().toISOString().substring(0, 10);
  const firstOption = displaySelectedOptions[0];

  const vehicleColSpans = [];
  let currentVehId = null;
  let currentSpan = 0;
  let currentModel = '';
  let currentVehIndex = 0;

  displaySelectedOptions.forEach((item, idx) => {
    if (currentVehId === null) {
      currentVehId = item.veh.id;
      currentSpan = 1;
      currentModel = item.veh.carModel || '차종 미입력';
      currentVehIndex = item.vIdx;
    } else if (item.veh.id === currentVehId) {
      currentSpan++;
    } else {
      vehicleColSpans.push({ model: currentModel, span: currentSpan, vIdx: currentVehIndex });
      currentVehId = item.veh.id;
      currentSpan = 1;
      currentModel = item.veh.carModel || '차종 미입력';
      currentVehIndex = item.vIdx;
    }
    if (idx === displaySelectedOptions.length - 1) {
      vehicleColSpans.push({ model: currentModel, span: currentSpan, vIdx: currentVehIndex });
    }
  });


  const renderMaintenancePage = () => {
    // Determine dynamic tire count and cost for selected option
    const totalMileage = (selectedOpt?.termYears || 4) * (selectedOpt?.mileage || 20000);
    const computedTireCount = Math.floor(totalMileage / 60000) * 4;
    const computedTireCost = computedTireCount * (selectedOpt?.tireUnitCost || 150000);

    const rawItems = tempMaintenanceItems.length > 0 ? tempMaintenanceItems : defaultMaintenanceItems;
    
    // Dynamically adjust the "타이어 교체" row price and description
    const items = rawItems.map(item => {
      if (item.name === '타이어 교체') {
        return {
          ...item,
          desc: `타이어*마모 한계선 도래 시 교체 (${computedTireCount}본)`,
          price: computedTireCost
        };
      }
      return item;
    });

    // Calculate total sum of checked items
    const totalSum = items
      .filter(item => item.checked)
      .reduce((sum, item) => sum + (item.price || 0), 0);
      
    const termMonths = selectedOpt ? selectedOpt.termYears * 12 : 48;
    const calculatedMonthly = Math.floor((totalSum / termMonths) / 1000) * 1000;

    const updateTempItem = (index, fields) => {
      setTempMaintenanceItems(prev => prev.map((item, idx) => idx === index ? { ...item, ...fields } : item));
    };

    return (
      <div style={{ background: 'var(--bg-surface)', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* Header Title Area */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: '800', color: 'var(--text-bright)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              🛠️ 정비 항목별 교환주기 및 단가 조정
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.2rem' }}>
              차량 {vehicles.findIndex(v => v.id === selectedVehicleId) + 1} ({activeVehicle.carModel || '차종 미지정'})의 정비 세부 항목을 선택하고 개별 단가를 직접 조정합니다.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button
              type="button"
              onClick={() => {
                // Apply the calculated monthly fee and save the items list to the selected option
                updateActiveVehicleOption(selectedOpt.id, {
                  maintenanceItems: items,
                  monthlyMaintenanceFee: calculatedMonthly
                });
                setSubView('quote');
                showToast('정비 상세 내역과 월 정비비가 견적서에 적용되었습니다.', 'success');
              }}
              style={{
                background: 'var(--primary)',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '0.5rem 1.2rem',
                fontSize: '0.88rem',
                fontWeight: '700',
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
            >
              적용 및 돌아가기
            </button>
            <button
              type="button"
              onClick={() => {
                setSubView('quote');
              }}
              style={{
                background: 'var(--bg-main)',
                color: 'var(--text-main)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '0.5rem 1.2rem',
                fontSize: '0.88rem',
                fontWeight: '700',
                cursor: 'pointer'
              }}
            >
              돌아가기
            </button>
          </div>
        </div>

        {/* Summary Card and Controls */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.2rem', background: 'var(--bg-main)', padding: '1.2rem 1.5rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: '600' }}>선택 항목 합계 (총 정비 원가)</span>
            <h3 style={{ margin: '0.2rem 0 0 0', fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-bright)' }}>
              {toCommaString(totalSum)} 원
            </h3>
          </div>
          <div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: '600' }}>나누는 계약 기간</span>
            <h3 style={{ margin: '0.2rem 0 0 0', fontSize: '1.5rem', fontWeight: '800', color: '#fa8c16' }}>
              {termMonths} 개월 ({selectedOpt?.name || '1안'} 기준)
            </h3>
          </div>
          <div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: '600' }}>계산된 월 정비비</span>
            <h3 style={{ margin: '0.2rem 0 0 0', fontSize: '1.5rem', fontWeight: '800', color: 'var(--primary)' }}>
              {toCommaString(calculatedMonthly)} 원 / 월
            </h3>
          </div>
          <div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>최종 적용 월 정비비 (원)</span>
            <input 
              type="text"
              value={toCommaString(calculatedMonthly)}
              disabled
              style={{
                width: '100%',
                padding: '0.4rem 0.6rem',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                fontSize: '1rem',
                fontWeight: '700',
                color: 'var(--primary)',
                background: '#f5f5f5'
              }}
            />
            <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', display: 'block', marginTop: '0.2rem' }}>* (합계 / 개월 수)로 자동 고정 적용됩니다.</span>
          </div>
        </div>

        {/* Consumables Table */}
        <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-main)', borderBottom: '2px solid var(--border-color)' }}>
                <th style={{ padding: '0.8rem 1rem', width: '8%', textAlign: 'center', borderRight: '1px solid var(--border-color)' }}>
                  <input 
                    type="checkbox"
                    checked={items.every(item => item.checked)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setTempMaintenanceItems(prev => prev.map(item => ({ ...item, checked })));
                    }}
                    style={{ transform: 'scale(1.15)', cursor: 'pointer' }}
                  />
                </th>
                <th style={{ padding: '0.8rem 1rem', fontWeight: '700', color: 'var(--text-bright)', borderRight: '1px solid var(--border-color)', textAlign: 'left', width: '22%' }}>소모품</th>
                <th style={{ padding: '0.8rem 1rem', fontWeight: '700', color: 'var(--text-bright)', borderRight: '1px solid var(--border-color)', textAlign: 'left', width: '30%' }}>교환주기</th>
                <th style={{ padding: '0.8rem 1rem', fontWeight: '700', color: 'var(--text-bright)', borderRight: '1px solid var(--border-color)', textAlign: 'left', width: '25%' }}>부품내역</th>
                <th style={{ padding: '0.8rem 1rem', fontWeight: '700', color: 'var(--text-bright)', textAlign: 'right', width: '15%' }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--primary)', marginBottom: '0.2rem' }}>총 {toCommaString(totalSum)} 원</div>
                  금액 (원)
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((row, idx) => (
                <tr 
                  key={idx} 
                  style={{ 
                    borderBottom: '1px solid var(--border-color)',
                    background: row.checked ? 'transparent' : 'rgba(0,0,0,0.02)',
                    transition: 'background 0.2s'
                  }}
                >
                  <td style={{ padding: '0.65rem 1rem', textAlign: 'center', borderRight: '1px solid var(--border-color)' }}>
                    <input 
                      type="checkbox"
                      checked={row.checked}
                      onChange={(e) => {
                        updateTempItem(idx, { checked: e.target.checked });
                      }}
                      style={{ transform: 'scale(1.15)', cursor: 'pointer' }}
                    />
                  </td>
                  <td style={{ padding: '0.65rem 1rem', fontWeight: '700', borderRight: '1px solid var(--border-color)', color: row.checked ? 'var(--text-main)' : 'var(--text-muted)' }}>{row.name}</td>
                  <td style={{ padding: '0.65rem 1rem', borderRight: '1px solid var(--border-color)', color: row.checked ? '#444' : 'var(--text-muted)' }}>{row.cycle}</td>
                  <td style={{ padding: '0.65rem 1rem', borderRight: '1px solid var(--border-color)', color: row.checked ? '#444' : 'var(--text-muted)' }}>{row.desc}</td>
                  <td style={{ padding: '0.4rem 1rem', textAlign: 'right' }}>
                    <input 
                      type="text"
                      disabled={!row.checked}
                      value={toCommaString(row.price)}
                      onChange={(e) => {
                        const newPrice = parseNumber(e.target.value);
                        if (row.name === '타이어 교체') {
                          const unitCost = computedTireCount > 0 ? Math.round(newPrice / computedTireCount) : 0;
                          if (selectedOpt) {
                            updateActiveVehicleOption(selectedOpt.id, { tireUnitCost: unitCost });
                          }
                        } else {
                          updateTempItem(idx, { price: newPrice });
                        }
                      }}
                      style={{
                        padding: '0.3rem 0.5rem',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px',
                        fontSize: '0.85rem',
                        fontWeight: '700',
                        textAlign: 'right',
                        width: '120px',
                        background: row.checked ? '#fff' : '#f5f5f5',
                        color: row.checked ? 'var(--text-bright)' : '#999'
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  if (subView === 'maintenance') {
    return renderMaintenancePage();
  }

  const getCellStyles = (idx, isEvenRow = false, extraStyles = {}) => {
    return {
      background: isEvenRow ? '#f9f8f6' : '#ffffff',
      textAlign: 'right',
      fontWeight: '500',
      paddingTop: '12px',
      paddingBottom: '12px',
      paddingLeft: '16px',
      paddingRight: '2.5rem',
      transition: 'all 0.15s ease',
      ...extraStyles
    };
  };

  return (
    <div className="quote-input-container fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', background: '#fff', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', maxWidth: '1400px', margin: '0 auto' }}>
      
      {/* Header */}
      <h3 style={{ fontSize: '1.4rem', fontWeight: '700', color: 'var(--text-bright)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
        <Coins style={{ color: 'var(--primary)' }} /> 견적서
      </h3>

      {/* Section 1: Customer info */}
      <div style={{ background: 'var(--bg-main)', padding: '1.2rem 1.5rem', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ fontWeight: '700', color: 'var(--text-bright)', margin: 0 }}>👥 1. 고객 정보 지정</h4>
          <button 
            type="button"
            onClick={() => setUseExistingCustomer(!useExistingCustomer)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' }}
          >
            {useExistingCustomer ? <><UserPlus size={14} /> 신규 고객 등록하기</> : <><Users size={14} /> 기존 고객 검색하기</>}
          </button>
        </div>

        {useExistingCustomer ? (
          <div style={{ position: 'relative' }}>
            <div style={{ position: 'relative' }}>
              <input 
                type="text" 
                placeholder="고객명(성/이름), 회사명, 연락처, 사업자번호 등으로 검색..."
                value={customerSearchQuery}
                onChange={(e) => {
                  setCustomerSearchQuery(e.target.value);
                  setIsDropdownOpen(true);
                }}
                onFocus={() => setIsDropdownOpen(true)}
                style={{ width: '100%', padding: '0.6rem 1rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.9rem', outline: 'none', background: '#fff' }}
              />
              {customerSearchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomerSearchQuery('');
                    setSelectedCustomerId('');
                    setSelectedCustomer(null);
                    setIsDropdownOpen(true);
                  }}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: '0.9rem',
                    zIndex: 2
                  }}
                >
                  ✕
                </button>
              )}
            </div>

            {isDropdownOpen && (
              <div 
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  background: '#fff',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  zIndex: 1000,
                  maxHeight: '300px',
                  overflowY: 'auto',
                  marginTop: '4px'
                }}
              >
                {customerSearchResults.length === 0 ? (
                  <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    검색 결과가 없습니다.
                  </div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: '#fafafa', borderBottom: '1px solid #e8e8e8', color: '#666', fontSize: '0.78rem' }}>
                        <th style={{ padding: '0.6rem 0.8rem', fontWeight: '700' }}>성</th>
                        <th style={{ padding: '0.6rem 0.8rem', fontWeight: '700' }}>이름</th>
                        <th style={{ padding: '0.6rem 0.8rem', fontWeight: '700' }}>회사</th>
                        <th style={{ padding: '0.6rem 0.8rem', fontWeight: '700' }}>연락처</th>
                        <th style={{ padding: '0.6rem 0.8rem', fontWeight: '700' }}>사업자/주민번호</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerSearchResults.map(c => {
                        const isSelected = c._id === selectedCustomerId;
                        const surname = c.surname || c.name || '-';
                        const givenName = c.givenName || c.displayName || c.contactName || '-';
                        return (
                          <tr 
                            key={c._id}
                            onClick={() => {
                              setSelectedCustomerId(c._id);
                              setSelectedCustomer(c);
                              setCustomerSearchQuery((c.surname || c.name || '').trim());
                              setIsDropdownOpen(false);
                            }}
                            style={{
                              borderBottom: '1px solid #f0f0f0',
                              cursor: 'pointer',
                              background: isSelected ? '#e6f7ff' : '#fff',
                              transition: 'background 0.15s'
                            }}
                            onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#f5f5f5'; }}
                            onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = '#fff'; }}
                          >
                            <td style={{ padding: '0.6rem 0.8rem', fontWeight: '700', color: '#111' }}>{surname}</td>
                            <td style={{ padding: '0.6rem 0.8rem', fontWeight: '600', color: '#333' }}>{givenName}</td>
                            <td style={{ padding: '0.6rem 0.8rem', color: '#555' }}>{c.companyName || (c.surname ? c.name : '-') || '-'}</td>
                            <td style={{ padding: '0.6rem 0.8rem', color: '#666' }}>{c.contactPhone || c.mobilePhone || '-'}</td>
                            <td style={{ padding: '0.6rem 0.8rem', color: '#777', fontSize: '0.78rem' }}>{c.bizNo || '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {isDropdownOpen && (
              <div 
                onClick={() => setIsDropdownOpen(false)}
                style={{
                  position: 'fixed',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  right: 0,
                  zIndex: 999,
                  background: 'transparent'
                }}
              />
            )}

            {selectedCustomer && (
              <div style={{ marginTop: '0.8rem', background: '#fff', border: '1px solid #d9d9d9', borderRadius: '6px', padding: '0.8rem 1rem', display: 'flex', flexWrap: 'wrap', gap: '1.5rem', fontSize: '0.82rem', color: '#555' }}>
                <div>
                  <strong>선택된 고객:</strong> <span style={{ color: 'var(--primary)', fontWeight: '700', fontSize: '0.9rem' }}>{(selectedCustomer.surname || selectedCustomer.name || '').trim()}</span>
                </div>
                {selectedCustomer.companyName && (
                  <div>
                    <strong>회사명:</strong> {selectedCustomer.companyName}
                  </div>
                )}
                <div>
                  <strong>연락처:</strong> {selectedCustomer.contactPhone || selectedCustomer.mobilePhone || '-'}
                </div>
                <div>
                  <strong>사업자/주민번호:</strong> {selectedCustomer.bizNo || '-'}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.3rem' }}>고객/법인명 *</label>
              <input type="text" placeholder="예: (주)렌트베네핏" value={newCustomer.name} onChange={(e) => setNewCustomer({...newCustomer, name: e.target.value})} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.3rem' }}>사업자/주민번호 *</label>
              <input type="text" placeholder="123-45-67890" value={newCustomer.bizNo} onChange={(e) => setNewCustomer({...newCustomer, bizNo: e.target.value})} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.3rem' }}>대표자명</label>
              <input type="text" value={newCustomer.ceoName} onChange={(e) => setNewCustomer({...newCustomer, ceoName: e.target.value})} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.3rem' }}>고객 연락처</label>
              <input type="text" value={newCustomer.contactPhone} onChange={(e) => setNewCustomer({...newCustomer, contactPhone: e.target.value})} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem' }} />
            </div>
          </div>
        )}
      </div>

      {/* 🚗 차량 비교 탭 선택 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', background: 'var(--bg-main)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', alignItems: 'center' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-main)', marginRight: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <Car size={16} /> 비교 차량 목록:
        </div>
        {vehicles.map((v, index) => {
          const isSelected = v.id === selectedVehicleId;
          const colorObj = getVehicleColor(index);
          return (
            <div 
              key={v.id} 
              onClick={() => setSelectedVehicleId(v.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.5rem 0.8rem',
                borderRadius: '6px',
                border: isSelected ? `2px solid ${colorObj.primary}` : `1px solid ${colorObj.border}`,
                background: isSelected ? colorObj.primary : colorObj.light,
                color: isSelected ? '#fff' : colorObj.dark,
                fontWeight: '700',
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'all 0.15s ease-in-out',
                boxShadow: isSelected ? `0 2px 8px ${colorObj.primary}33` : 'none'
              }}
            >
              <span>차량 {index + 1} ({v.carModel ? (v.carModel.length > 15 ? v.carModel.substring(0, 15) + '...' : v.carModel) : '모델명 미입력'})</span>
              {vehicles.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => handleDeleteVehicle(v.id, e)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: isSelected ? '#fff' : colorObj.dark,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0.1rem',
                    borderRadius: '4px',
                    marginLeft: '0.2rem'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#ff4d4f'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = isSelected ? '#fff' : colorObj.dark; }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={handleAddVehicle}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem',
            padding: '0.5rem 0.8rem',
            borderRadius: '6px',
            border: '1px dashed var(--primary)',
            background: '#e6f7ff',
            color: 'var(--primary)',
            fontWeight: '700',
            fontSize: '0.85rem',
            cursor: 'pointer',
            transition: 'all 0.15s ease-in-out'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#bae7ff'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#e6f7ff'; }}
        >
          <Plus size={14} /> 차량 추가
        </button>
      </div>

      {/* 차량 기본 정보 */}
      <div style={{ background: 'var(--bg-main)', padding: '1.2rem 1.5rem', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h4 style={{ fontWeight: '700', color: activeVehicleColor.dark, margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Car size={18} style={{ color: activeVehicleColor.primary }} /> 차량 {activeIndex} 기본 정보
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.8rem' }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', marginBottom: '0.2rem' }}>차종 / 모델명</label>
            <input type="text" value={activeVehicle.carModel} onChange={(e) => updateActiveVehicle({ carModel: e.target.value })} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff' }} />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', marginBottom: '0.2rem' }}>옵션 품목</label>
            <textarea 
              rows={2}
              value={activeVehicle.carOptionsName} 
              onChange={(e) => updateActiveVehicle({ carOptionsName: e.target.value })} 
              style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff', resize: 'vertical', fontFamily: 'inherit' }} 
              placeholder="옵션 품목을 상세히 기재해 주세요."
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', marginBottom: '0.2rem' }}>기본 차량가 (원)</label>
            <input type="text" value={toCommaString(activeVehicle.carPrice)} onChange={(e) => updateActiveVehicle({ carPrice: parseNumber(e.target.value) })} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', marginBottom: '0.2rem' }}>옵션가 (원)</label>
            <input type="text" value={toCommaString(activeVehicle.carOptionPrice)} onChange={(e) => updateActiveVehicle({ carOptionPrice: parseNumber(e.target.value) })} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', marginBottom: '0.2rem' }}>할인 금액 (원)</label>
            <input type="text" value={toCommaString(activeVehicle.discountPrice)} onChange={(e) => updateActiveVehicle({ discountPrice: parseNumber(e.target.value) })} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', marginBottom: '0.2rem' }}>탁송료 (원)</label>
            <input type="text" value={toCommaString(activeVehicle.consignmentFee)} onChange={(e) => updateActiveVehicle({ consignmentFee: parseNumber(e.target.value) })} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', marginBottom: '0.2rem' }}>유종</label>
            <select value={activeVehicle.fuelType} onChange={(e) => updateActiveVehicle({ fuelType: e.target.value })} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff' }}>
              <option value="가솔린">가솔린</option>
              <option value="디젤">디젤</option>
              <option value="LPI">LPI</option>
              <option value="하이브리드">하이브리드</option>
              <option value="전기">전기</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', marginBottom: '0.2rem' }}>배기량 (cc)</label>
            <input type="number" value={activeVehicle.cc} onChange={(e) => updateActiveVehicle({ cc: parseNumber(e.target.value) })} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', marginBottom: '0.2rem', color: 'var(--primary)' }}>자동차세 (연간/원)</label>
            <input 
              type="text" 
              value={toCommaString(
                activeVehicle.cc <= 0 || !activeVehicle.cc ? 20000 :
                activeVehicle.cc <= 1600 ? activeVehicle.cc * 18 :
                activeVehicle.cc <= 2500 ? activeVehicle.cc * 19 : activeVehicle.cc * 24
              )} 
              disabled 
              style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#666', fontWeight: '600' }} 
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', marginBottom: '0.2rem' }}>납기</label>
            <input type="text" value={activeVehicle.deliveryPeriod} onChange={(e) => updateActiveVehicle({ deliveryPeriod: e.target.value })} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff' }} placeholder="예: 즉시출고 / 4주" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', marginBottom: '0.2rem' }}>외장 색상</label>
            <input type="text" value={activeVehicle.exteriorColor} onChange={(e) => updateActiveVehicle({ exteriorColor: e.target.value })} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff' }} placeholder="예: 크리미 화이트 펄" />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '600', marginBottom: '0.2rem' }}>내장 색상</label>
            <input type="text" value={activeVehicle.interiorColor} onChange={(e) => updateActiveVehicle({ interiorColor: e.target.value })} style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff' }} placeholder="예: 웜그레이" />
          </div>
        </div>
      </div>

      {/* 등록비용, 금융 정보, 정비와 주행거리 보험 & 렌트베네핏 총구입가 (차량 상세 설정) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {/* 등록비용 */}
        <div style={{ background: 'var(--bg-main)', padding: '1.2rem 1.5rem', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <h4 style={{ fontWeight: '700', color: 'var(--text-bright)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Settings size={18} /> {activeIndex}.1 등록비용
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.8rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>취득세 (원)</label>
              <input 
                type="text" 
                value={toCommaString(selectedCalc.acquisitionTax)} 
                disabled 
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#666', fontWeight: '600' }} 
              />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600' }}>공채 (원)</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', cursor: 'pointer', color: 'var(--primary)', fontWeight: '600' }}>
                  <input 
                    type="checkbox" 
                    checked={activeVehicle.isBondExempt} 
                    onChange={(e) => updateActiveVehicle({ isBondExempt: e.target.checked })} 
                    style={{ cursor: 'pointer' }}
                  />
                  면제
                </label>
              </div>
              <input 
                type="text" 
                value={toCommaString(selectedCalc.publicBond)} 
                disabled 
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#666', fontWeight: '600' }} 
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>자동차세 (연간/원)</label>
              <input 
                type="text" 
                value={toCommaString(selectedCalc.carTaxAnnual)} 
                disabled 
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#666', fontWeight: '600' }} 
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>등록비용 (등록대행료) (원)</label>
              <input 
                type="text" 
                value={activeInputKey === `${selectedVehicleId}-global-registrationAgencyFee` ? activeInputValue : toCommaString(activeVehicle.globalRegistrationAgencyFee)} 
                onChange={(e) => {
                  setActiveInputValue(e.target.value);
                  updateActiveVehicle({ globalRegistrationAgencyFee: parseNumber(e.target.value) });
                }} 
                onFocus={() => {
                  setActiveInputKey(`${selectedVehicleId}-global-registrationAgencyFee`);
                  setActiveInputValue(activeVehicle.globalRegistrationAgencyFee.toString());
                }}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff' }} 
              />
            </div>
          </div>
        </div>

        {/* 금융 정보 */}
        <div style={{ background: 'var(--bg-main)', padding: '1.2rem 1.5rem', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <h4 style={{ fontWeight: '700', color: 'var(--text-bright)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Settings size={18} /> {activeIndex}.2 금융 정보
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.8rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>거래 차량가 (원)</label>
              <input type="text" value={toCommaString(selectedCalc.netVehiclePrice)} disabled style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#333', fontWeight: '600' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>조달원금율</label>
              <input type="text" value={selectedCalc.netVehiclePrice > 0 ? ((selectedCalc.fundingPrincipal / selectedCalc.netVehiclePrice) * 100).toFixed(2) + '%' : '0%'} disabled style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#333', fontWeight: '600' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>조달원금 (원)</label>
              <input type="text" value={toCommaString(selectedCalc.fundingPrincipal)} disabled style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#333', fontWeight: '600' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>기준 금리 (%)</label>
              <input 
                type="text" 
                value={activeInputKey === `${selectedVehicleId}-global-baseInterestRate` ? activeInputValue : (activeVehicle.baseInterestRate * 100).toFixed(1) + '%'} 
                onChange={(e) => {
                  setActiveInputValue(e.target.value);
                  updateActiveVehicle({ baseInterestRate: parseNumber(e.target.value) / 100 });
                }} 
                onFocus={() => {
                  setActiveInputKey(`${selectedVehicleId}-global-baseInterestRate`);
                  setActiveInputValue('');
                }}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff', color: '#333', fontWeight: '600' }} 
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>이자부담율</label>
              <input type="text" value={(selectedCalc.interestRate * 100).toFixed(2) + '%'} disabled style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#333', fontWeight: '600' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>조달이자 (원)</label>
              <input type="text" value={toCommaString(selectedCalc.fundingInterest)} disabled style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#333', fontWeight: '600' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>선수금분이자 (원)</label>
              <input type="text" value={toCommaString(selectedCalc.advancePaymentInterest)} disabled style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#333', fontWeight: '600' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>월할부금 (원)</label>
              <input type="text" value={toCommaString(selectedCalc.monthlyInstallment)} disabled style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#333', fontWeight: '600' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>월할부금계 (원)</label>
              <input type="text" value={toCommaString(selectedCalc.monthlyInstallmentSum)} disabled style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#333', fontWeight: '600' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>할부 시 총구입가 (원)</label>
              <input type="text" value={toCommaString(selectedCalc.totalBuyPriceWithFinancing)} disabled style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#333', fontWeight: '600' }} />
            </div>
          </div>
        </div>

        {/* 3. 정비와 주행거리 보험 */}
        <div style={{ background: 'var(--bg-main)', padding: '1.2rem 1.5rem', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h4 style={{ fontWeight: '700', color: 'var(--text-bright)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Settings size={18} /> {activeIndex}.3 정비와 주행거리 보험 ({selectedOpt?.name || '1안'} 설정)
            </h4>
            <button 
              type="button"
              onClick={() => {
                const items = selectedOpt?.maintenanceItems || defaultMaintenanceItems;
                setTempMaintenanceItems(items.map(item => ({ ...item })));
                setTempMonthlyMaintenanceFee(selectedOpt?.monthlyMaintenanceFee || 0);
                setSubView('maintenance');
              }}
              style={{
                background: 'var(--primary-glow)',
                color: 'var(--primary)',
                border: '1px solid var(--primary)',
                borderRadius: '6px',
                padding: '0.25rem 0.6rem',
                fontSize: '0.75rem',
                fontWeight: '700',
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: '0.2rem'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--primary)'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--primary-glow)'; e.currentTarget.style.color = 'var(--primary)'; }}
            >
              📋 상세내역
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.8rem' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600' }}>정비 가입</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', cursor: 'pointer', color: 'var(--primary)', fontWeight: '600' }}>
                  <input 
                    type="checkbox" 
                    checked={activeVehicle.isMaintenanceEnabled} 
                    onChange={(e) => updateActiveVehicle({ isMaintenanceEnabled: e.target.checked })} 
                    style={{ cursor: 'pointer' }}
                  />
                  가입
                </label>
              </div>
              <input 
                type="text" 
                value={activeVehicle.isMaintenanceEnabled ? "가입" : "미가입"} 
                disabled 
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#666', fontWeight: '600', marginTop: '0.2rem' }} 
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>월 정비비 (원)</label>
              <input 
                type="text" 
                value={toCommaString(getCalculatedMaintenanceFee(selectedOpt, activeVehicle))} 
                disabled 
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#666', fontWeight: '600' }} 
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>타이어 등급</label>
              <select
                value={selectedOpt?.tireType || 'standard'}
                onChange={(e) => {
                  const type = e.target.value;
                  const price = type === 'premium' ? recTires.premium : recTires.standard;
                  if (selectedOpt) {
                    updateActiveVehicleOption(selectedOpt.id, { tireType: type, tireUnitCost: price });
                  }
                }}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff', color: '#333', fontWeight: '600' }}
              >
                <option value="standard">일반형</option>
                <option value="premium">고급형</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>제공 타이어 본수 (본)</label>
              <input 
                type="text" 
                value={toCommaString(Math.floor(((selectedOpt?.termYears || 4) * (selectedOpt?.mileage || 20000)) / 60000) * 4) + ' 본 (자동 계산)'} 
                disabled 
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#666', fontWeight: '600' }} 
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>타이어 본당 비용 (원)</label>
              <input 
                type="text" 
                value={activeInputKey === `option-${selectedOpt?.id}-tireUnitCost` ? activeInputValue : toCommaString(selectedOpt?.tireUnitCost)} 
                onChange={(e) => {
                  setActiveInputValue(e.target.value);
                  if (selectedOpt) {
                    updateActiveVehicleOption(selectedOpt.id, { tireUnitCost: parseNumber(e.target.value) });
                  }
                }} 
                onFocus={() => {
                  if (selectedOpt) {
                    setActiveInputKey(`option-${selectedOpt.id}-tireUnitCost`);
                    setActiveInputValue(selectedOpt.tireUnitCost.toString());
                  }
                }}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff', color: '#333', fontWeight: '600' }} 
              />
              <div style={{ display: 'flex', gap: '0.3rem', marginTop: '0.3rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedOpt) {
                      updateActiveVehicleOption(selectedOpt.id, { tireType: 'standard', tireUnitCost: recTires.standard });
                    }
                  }}
                  style={{
                    background: (selectedOpt?.tireType === 'standard' || !selectedOpt?.tireType) ? 'var(--primary-glow)' : 'var(--bg-main)',
                    border: `1px solid ${(selectedOpt?.tireType === 'standard' || !selectedOpt?.tireType) ? 'var(--primary)' : 'var(--border-color)'}`,
                    borderRadius: '4px',
                    padding: '0.2rem 0.4rem',
                    fontSize: '0.68rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    color: (selectedOpt?.tireType === 'standard' || !selectedOpt?.tireType) ? 'var(--primary)' : 'var(--text-muted)'
                  }}
                >
                  일반: {toCommaString(recTires.standard)}원
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedOpt) {
                      updateActiveVehicleOption(selectedOpt.id, { tireType: 'premium', tireUnitCost: recTires.premium });
                    }
                  }}
                  style={{
                    background: selectedOpt?.tireType === 'premium' ? 'var(--primary-glow)' : 'var(--bg-main)',
                    border: `1px solid ${selectedOpt?.tireType === 'premium' ? 'var(--primary)' : 'var(--border-color)'}`,
                    borderRadius: '4px',
                    padding: '0.2rem 0.4rem',
                    fontSize: '0.68rem',
                    fontWeight: '600',
                    cursor: 'pointer',
                    color: selectedOpt?.tireType === 'premium' ? 'var(--primary)' : 'var(--text-muted)'
                  }}
                >
                  고급: {toCommaString(recTires.premium)}원
                </button>
              </div>
              <div style={{ fontSize: '0.64rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                * 추천: {selectedOpt?.tireType === 'premium' ? recTires.premiumLabel : recTires.standardLabel}
              </div>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>연간 주행거리 (km)</label>
              <select
                value={selectedOpt?.mileage || 20000}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (selectedOpt) {
                    updateActiveVehicleOption(selectedOpt.id, { mileage: val });
                  }
                }}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff', color: '#333', fontWeight: '600' }}
              >
                <option value={10000}>10,000 km</option>
                <option value={15000}>15,000 km</option>
                <option value={20000}>20,000 km</option>
                <option value={25000}>25,000 km</option>
                <option value={30000}>30,000 km</option>
                <option value={40000}>40,000 km</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>보험 (원)</label>
              <input 
                type="text" 
                value={activeInputKey === `${selectedVehicleId}-global-insuranceFee` ? activeInputValue : toCommaString(activeVehicle.globalInsuranceFee)} 
                onChange={(e) => {
                  setActiveInputValue(e.target.value);
                  updateActiveVehicle({ globalInsuranceFee: parseNumber(e.target.value) });
                }} 
                onFocus={() => {
                  setActiveInputKey(`${selectedVehicleId}-global-insuranceFee`);
                  setActiveInputValue(activeVehicle.globalInsuranceFee.toString());
                }}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff', color: '#333', fontWeight: '600' }} 
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>보험(자차 보험비) (원)</label>
              <input 
                type="text" 
                value={toCommaString(selectedCalc.ownCarInsuranceFee)} 
                disabled 
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#666', fontWeight: '600' }} 
              />
            </div>
          </div>
        </div>

        {/* 4. 렌트베네핏 총구입가 */}
        <div style={{ background: 'var(--bg-main)', padding: '1.2rem 1.5rem', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <h4 style={{ fontWeight: '700', color: 'var(--text-bright)', margin: 0, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <Settings size={18} /> {activeIndex}.4 렌트베네핏 총구입가
          </h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.8rem' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600' }}>판매관리비</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.75rem', cursor: 'pointer', color: 'var(--primary)', fontWeight: '600' }}>
                  <input 
                    type="checkbox" 
                    checked={activeVehicle.isPandanbiEnabled} 
                    onChange={(e) => updateActiveVehicle({ isPandanbiEnabled: e.target.checked })} 
                    style={{ cursor: 'pointer' }}
                  />
                  청구 (3%)
                </label>
              </div>
              <input 
                type="text" 
                value={toCommaString(selectedCalc.pandanbi)} 
                disabled 
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#666', fontWeight: '600', marginTop: '0.2rem' }} 
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>회사 수수료율 (%)</label>
              <input 
                type="text" 
                value={activeInputKey === `${selectedVehicleId}-global-commissionRateP` ? activeInputValue : (activeVehicle.commissionRateP * 100).toFixed(1) + '%'} 
                onChange={(e) => {
                  setActiveInputValue(e.target.value);
                  updateActiveVehicle({ commissionRateP: parseNumber(e.target.value) / 100 });
                }} 
                onFocus={() => {
                  setActiveInputKey(`${selectedVehicleId}-global-commissionRateP`);
                  setActiveInputValue('');
                }}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff', color: '#333', fontWeight: '600' }} 
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>회사 수수료 (원)</label>
              <input 
                type="text" 
                value={activeInputKey === `${selectedVehicleId}-global-commissionAmount` ? activeInputValue : toCommaString(totalCarPrice * activeVehicle.commissionRateP)} 
                onChange={(e) => {
                  setActiveInputValue(e.target.value);
                  const parsedAmount = parseNumber(e.target.value);
                  const rate = totalCarPrice > 0 ? (parsedAmount / totalCarPrice) : 0;
                  updateActiveVehicle({ commissionRateP: rate });
                }} 
                onFocus={() => {
                  setActiveInputKey(`${selectedVehicleId}-global-commissionAmount`);
                  setActiveInputValue('');
                }}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff', color: '#333', fontWeight: '600' }} 
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>딜러 수수료율 (%)</label>
              <input 
                type="text" 
                value={activeInputKey === `${selectedVehicleId}-global-dealerCommissionRateP` ? activeInputValue : (activeVehicle.dealerCommissionRateP * 100).toFixed(1) + '%'} 
                onChange={(e) => {
                  setActiveInputValue(e.target.value);
                  updateActiveVehicle({ dealerCommissionRateP: parseNumber(e.target.value) / 100 });
                }} 
                onFocus={() => {
                  setActiveInputKey(`${selectedVehicleId}-global-dealerCommissionRateP`);
                  setActiveInputValue('');
                }}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff', color: '#333', fontWeight: '600' }} 
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>딜러 수수료 (원)</label>
              <input 
                type="text" 
                value={activeInputKey === `${selectedVehicleId}-global-dealerCommissionAmount` ? activeInputValue : toCommaString(totalCarPrice * activeVehicle.dealerCommissionRateP)} 
                onChange={(e) => {
                  setActiveInputValue(e.target.value);
                  const parsedAmount = parseNumber(e.target.value);
                  const rate = totalCarPrice > 0 ? (parsedAmount / totalCarPrice) : 0;
                  updateActiveVehicle({ dealerCommissionRateP: rate });
                }} 
                onFocus={() => {
                  setActiveInputKey(`${selectedVehicleId}-global-dealerCommissionAmount`);
                  setActiveInputValue('');
                }}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff', color: '#333', fontWeight: '600' }} 
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>배네핏 총구입가 (원)</label>
              <input 
                type="text" 
                value={toCommaString(selectedCalc.totalCost)} 
                disabled 
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#f5f5f5', color: '#333', fontWeight: '700' }} 
              />
            </div>
          </div>
        </div>
      </div>

      {/* 📊 견적비교 */}
      <div>
        <h4 style={{ fontWeight: '700', color: 'var(--text-bright)', marginBottom: '0.8rem', marginTop: 0 }}>📊 견적비교</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {options.map(opt => {
            const calc = calculateOptionValues(opt, activeVehicle);
            const isSelected = selectedOptionIds.includes(opt.id);
            return (
              <div 
                key={opt.id}
                onClick={() => toggleOptionSelection(opt.id)}
                style={{
                  background: '#fff',
                  border: isSelected ? `2px solid ${activeVehicleColor.primary}` : '1px solid var(--border-color)',
                  borderRadius: '10px',
                  boxShadow: isSelected ? `0 4px 16px ${activeVehicleColor.primary}26` : '0 2px 4px rgba(0,0,0,0.03)',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  transition: 'all 0.2s ease-in-out'
                }}
              >
                {/* Proposal Title Header */}
                <div 
                  onClick={() => toggleOptionSelection(opt.id)}
                  style={{ 
                    background: isSelected ? activeVehicleColor.primary : '#fafafa', 
                    color: isSelected ? '#fff' : 'var(--text-main)', 
                    padding: '0.7rem 1rem', 
                    fontWeight: '800', 
                    fontSize: '0.9rem', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.4rem',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  <input 
                    type="checkbox"
                    checked={isSelected}
                    readOnly
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleOptionSelection(opt.id);
                    }}
                    style={{ cursor: 'pointer', transform: 'scale(1.1)', marginRight: '0.3rem' }}
                  />
                  <span style={{ whiteSpace: 'nowrap' }}>{opt.name}</span>
                  <input 
                    type="text"
                    placeholder="회사명"
                    value={opt.companyName || ''}
                    onClick={(e) => e.stopPropagation()} // 카드 선택 방지
                    onChange={(e) => handleOptionChange(opt.id, 'companyName', e.target.value)}
                    style={{
                      padding: '0.2rem 0.4rem',
                      border: '1px solid #ccc',
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      width: '90px',
                      color: '#333',
                      background: '#fff',
                      fontWeight: 'normal',
                      marginLeft: '0.5rem'
                    }}
                  />
                </div>

                <div onClick={(e) => e.stopPropagation()} style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem', flex: 1 }}>
                  {/* Settings Input Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', fontSize: '0.8rem' }}>
                    <div>
                      <label style={{ display: 'block', color: '#666', marginBottom: '0.15rem' }}>연간 주행거리 (km)</label>
                      <select 
                        value={opt.mileage || 20000} 
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          updateActiveVehicleOption(opt.id, { mileage: val });
                        }}
                        style={{ width: '100%', padding: '0.2rem', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', color: '#333' }} 
                      >
                        <option value={10000}>10,000 km</option>
                        <option value={15000}>15,000 km</option>
                        <option value={20000}>20,000 km</option>
                        <option value={25000}>25,000 km</option>
                        <option value={30000}>30,000 km</option>
                        <option value={40000}>40,000 km</option>
                      </select>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.15rem' }}>
                        <label style={{ display: 'block', color: '#666' }}>월 정비비 (원)</label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.72rem', cursor: 'pointer', color: 'var(--primary)', fontWeight: '600' }}>
                          <input 
                            type="checkbox" 
                            checked={opt.isMaintenanceEnabled !== false} 
                            onChange={(e) => {
                              updateActiveVehicleOption(opt.id, { isMaintenanceEnabled: e.target.checked });
                            }} 
                            style={{ cursor: 'pointer', transform: 'scale(0.95)' }}
                          />
                          포함
                        </label>
                      </div>
                      <input 
                        type="text" 
                        value={opt.isMaintenanceEnabled !== false ? toCommaString(getCalculatedMaintenanceFee(opt, activeVehicle)) : '0'} 
                        disabled 
                        style={{ 
                          width: '100%', 
                          padding: '0.2rem', 
                          border: '1px solid #ccc', 
                          borderRadius: '4px', 
                          background: '#f5f5f5', 
                          color: opt.isMaintenanceEnabled !== false ? '#666' : '#bbb', 
                          fontWeight: '600' 
                        }} 
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', color: '#666', marginBottom: '0.15rem' }}>타이어 등급</label>
                      <select
                        value={opt.tireType || 'standard'}
                        onChange={(e) => {
                          const type = e.target.value;
                          const recTiresForOpt = getRecommendedTirePrices(activeVehicle.carModel);
                          const price = type === 'premium' ? recTiresForOpt.premium : recTiresForOpt.standard;
                          updateActiveVehicleOption(opt.id, { tireType: type, tireUnitCost: price });
                        }}
                        style={{ width: '100%', padding: '0.2rem', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', color: '#333' }}
                      >
                        <option value="standard">일반형</option>
                        <option value="premium">고급형</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', color: '#666', marginBottom: '0.15rem' }}>타이어 본당 비용 (원)</label>
                      <input 
                        type="text" 
                        value={getInputValue(opt.id, 'tireUnitCost', opt.tireUnitCost)} 
                        onChange={(e) => handleInputChange(opt.id, 'tireUnitCost', e.target.value)} 
                        onFocus={() => handleFocus(opt.id, 'tireUnitCost')}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        style={{ width: '100%', padding: '0.2rem', border: '1px solid #ccc', borderRadius: '4px' }} 
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', color: '#666', marginBottom: '0.15rem' }}>기간 (년수)</label>
                      <select 
                        value={opt.termYears || 4} 
                        onChange={(e) => {
                          const years = Number(e.target.value);
                          updateActiveVehicleOption(opt.id, { termYears: years });
                        }}
                        style={{ width: '100%', padding: '0.2rem', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', color: '#333' }} 
                      >
                        <option value={1}>1년</option>
                        <option value={2}>2년</option>
                        <option value={3}>3년</option>
                        <option value={4}>4년</option>
                        <option value={5}>5년</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', color: '#666', marginBottom: '0.15rem' }}>기간 (개월수)</label>
                      <select 
                        value={opt.termYears ? Math.round(opt.termYears * 12) : 48} 
                        onChange={(e) => {
                          const months = Number(e.target.value);
                          updateActiveVehicleOption(opt.id, { termYears: months / 12 });
                        }}
                        style={{ width: '100%', padding: '0.2rem', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', color: '#333' }} 
                      >
                        <option value={12}>12개월</option>
                        <option value={24}>24개월</option>
                        <option value={36}>36개월</option>
                        <option value={48}>48개월</option>
                        <option value={60}>60개월</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', color: '#666', marginBottom: '0.15rem' }}>보증금율 (%)</label>
                      <input 
                        type="text" 
                        value={getInputValue(opt.id, 'depositRate', opt.depositRate)} 
                        onChange={(e) => handleInputChange(opt.id, 'depositRate', e.target.value)} 
                        onFocus={() => handleFocus(opt.id, 'depositRate')}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        style={{ width: '100%', padding: '0.2rem', border: '1px solid #ccc', borderRadius: '4px' }} 
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', color: '#666', marginBottom: '0.15rem' }}>보증금액 (원)</label>
                      <input 
                        type="text" 
                        value={getInputValue(opt.id, 'depositAmount', toCommaString(Math.floor((totalCarPrice * opt.depositRate) / 1000) * 1000))} 
                        onChange={(e) => handleInputChange(opt.id, 'depositAmount', e.target.value)} 
                        onFocus={() => handleFocus(opt.id, 'depositAmount')}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        style={{ width: '100%', padding: '0.2rem', border: '1px solid #ccc', borderRadius: '4px' }} 
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', color: '#666', marginBottom: '0.15rem' }}>선수금율 (%)</label>
                      <input 
                        type="text" 
                        value={getInputValue(opt.id, 'advancePaymentRate', opt.advancePaymentRate)} 
                        onChange={(e) => handleInputChange(opt.id, 'advancePaymentRate', e.target.value)} 
                        onFocus={() => handleFocus(opt.id, 'advancePaymentRate')}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        style={{ width: '100%', padding: '0.2rem', border: '1px solid #ccc', borderRadius: '4px' }} 
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', color: '#666', marginBottom: '0.15rem' }}>선수금액 (원)</label>
                      <input 
                        type="text" 
                        value={getInputValue(opt.id, 'advancePaymentAmount', toCommaString(Math.floor((totalCarPrice * opt.advancePaymentRate) / 1000) * 1000))} 
                        onChange={(e) => handleInputChange(opt.id, 'advancePaymentAmount', e.target.value)} 
                        onFocus={() => handleFocus(opt.id, 'advancePaymentAmount')}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        style={{ width: '100%', padding: '0.2rem', border: '1px solid #ccc', borderRadius: '4px' }} 
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', color: '#666', marginBottom: '0.15rem' }}>인수가율 (%)</label>
                      <input 
                        type="text" 
                        value={getInputValue(opt.id, 'residualRate', opt.residualRate)} 
                        onChange={(e) => handleInputChange(opt.id, 'residualRate', e.target.value)} 
                        onFocus={() => handleFocus(opt.id, 'residualRate')}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        style={{ width: '100%', padding: '0.2rem', border: '1px solid #ccc', borderRadius: '4px' }} 
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', color: '#666', marginBottom: '0.15rem' }}>인수가액 (원)</label>
                      <input 
                        type="text" 
                        value={getInputValue(opt.id, 'residualAmount', toCommaString(Math.floor((totalCarPrice * opt.residualRate) / 1000) * 1000))} 
                        onChange={(e) => handleInputChange(opt.id, 'residualAmount', e.target.value)} 
                        onFocus={() => handleFocus(opt.id, 'residualAmount')}
                        onBlur={handleBlur}
                        onKeyDown={handleKeyDown}
                        style={{ width: '100%', padding: '0.2rem', border: '1px solid #ccc', borderRadius: '4px' }} 
                      />
                    </div>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '0.3rem 0' }} />

                  {/* Mode & Target Pricing Selector */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.8rem' }}>
                    <div style={{ display: 'flex', gap: '1rem', fontWeight: '600' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                        <input type="radio" checked={opt.calcMode === 'manual'} onChange={() => handleOptionChange(opt.id, 'calcMode', 'manual')} />
                        렌트료 직접입력
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', cursor: 'pointer' }}>
                        <input type="radio" checked={opt.calcMode === 'auto'} onChange={() => handleOptionChange(opt.id, 'calcMode', 'auto')} />
                        영업이익 지정
                      </label>
                    </div>

                    {opt.calcMode === 'manual' ? (
                      <div>
                        <label style={{ display: 'block', fontWeight: '700', marginBottom: '0.2rem', color: activeVehicleColor.primary }}>월 렌트료 입력 (원)</label>
                        <input 
                          type="text" 
                          value={toCommaString(opt.monthlyFeeInput)} 
                          onChange={(e) => handleOptionChange(opt.id, 'monthlyFeeInput', parseNumber(e.target.value))} 
                          style={{ width: '100%', padding: '0.4rem', border: `2px solid ${activeVehicleColor.primary}`, borderRadius: '4px', fontSize: '0.9rem', fontWeight: '700', outline: 'none' }} 
                        />
                      </div>
                    ) : (
                      <div>
                        <label style={{ display: 'block', fontWeight: '700', marginBottom: '0.2rem', color: '#10b981' }}>목표 영업이익 입력 (원)</label>
                        <input 
                          type="text" 
                          value={toCommaString(opt.targetProfitInput)} 
                          onChange={(e) => handleOptionChange(opt.id, 'targetProfitInput', parseNumber(e.target.value))} 
                          style={{ width: '100%', padding: '0.4rem', border: '2px solid #10b981', borderRadius: '4px', fontSize: '0.9rem', fontWeight: '700', outline: 'none' }} 
                        />
                      </div>
                    )}
                  </div>

                  {/* Calculations breakdown list */}
                  <div style={{ background: '#fafafa', borderRadius: '6px', padding: '0.6rem 0.8rem', fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#666' }}>조달원금</span>
                      <span style={{ fontWeight: '600' }}>{toCommaString(calc.fundingPrincipal)}원</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#666' }}>적용 이자율</span>
                      <span style={{ fontWeight: '600', color: '#fa8c16' }}>{(calc.interestRate * 100).toFixed(2)}%</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#666' }}>조달이자 (PMT)</span>
                      <span style={{ fontWeight: '600' }}>{toCommaString(calc.fundingInterest)}원</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#666' }}>총구입원가(비용포함)</span>
                      <span style={{ fontWeight: '600' }}>{toCommaString(calc.totalCost)}원</span>
                    </div>
                    <hr style={{ border: 'none', borderTop: '1px dotted #ccc', margin: '0.15rem 0' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                      <span style={{ fontWeight: '700' }}>월 렌트료</span>
                      <span style={{ fontWeight: '800', color: 'var(--primary)' }}>{toCommaString(calc.monthlyLeaseFee)}원</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                      <span style={{ fontWeight: '700' }}>영업이익</span>
                      <span style={{ fontWeight: '800', color: calc.profitMargin >= 0 ? '#10b981' : '#ff4d4f' }}>
                        {toCommaString(calc.profitMargin)}원
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: '#666' }}>영업마진율 (AD31)</span>
                      <span style={{ fontWeight: '600' }}>{(calc.profitRate * 100).toFixed(2)}%</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* 안 추가 카드 (+) */}
          <div 
            onClick={handleAddOption}
            style={{
              background: '#f9f9f9',
              border: '2px dashed var(--border-color)',
              borderRadius: '10px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '400px',
              transition: 'all 0.2s ease-in-out',
              gap: '0.5rem',
              color: 'var(--text-muted)'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.color = 'var(--primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <span style={{ fontSize: '3rem', fontWeight: '300' }}>+</span>
            <span style={{ fontSize: '0.9rem', fontWeight: '600' }}>안 추가하기</span>
          </div>
        </div>
      </div>

       {/* Selected option summary display */}
       <div style={{ background: '#f8f9fa', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '1.2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
         <div>
           <span style={{ fontSize: '0.85rem', color: 'var(--text-bright)', fontWeight: '700' }}>선택된 안: </span>
           <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '0.6rem', marginLeft: '0.4rem' }}>
             {vehicles.map((veh, vIdx) => {
               const vColor = getVehicleColor(vIdx);
               const sIds = veh.selectedOptionIds || (veh.selectedOptionId ? [veh.selectedOptionId] : [1]);
               const sOpts = (veh.options || []).filter(o => sIds.includes(o.id));
               if (sOpts.length === 0) return null;
               
               const modelShortName = veh.carModel 
                 ? (veh.carModel.length > 15 ? veh.carModel.substring(0, 15) + '...' : veh.carModel) 
                 : '차종 미입력';
               
               return (
                 <span 
                   key={veh.id} 
                   style={{ 
                     background: vColor.light, 
                     border: `1px solid ${vColor.border}`, 
                     borderRadius: '4px', 
                     padding: '0.15rem 0.4rem', 
                     fontSize: '0.8rem', 
                     color: vColor.dark, 
                     fontWeight: '700' 
                   }}
                 >
                   차량 {vIdx + 1}({modelShortName}): {sOpts.map(o => `${o.name}${o.companyName ? ` (${o.companyName})` : ''}`).join(', ')}
                 </span>
               );
             })}
           </div>
         </div>
         <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginTop: '0.2rem', fontSize: '0.88rem', color: '#111' }}>
           {displaySelectedOptions.map(({ veh, vIdx, vColor, opt, calc }) => {
             const modelShortName = veh.carModel 
               ? (veh.carModel.length > 12 ? veh.carModel.substring(0, 12) + '...' : veh.carModel) 
               : '차종 미입력';
             
             return (
               <div 
                 key={`${veh.id}-${opt.id}`} 
                 style={{ 
                   background: vColor.light, 
                   border: `2px solid ${vColor.border}`, 
                   borderRadius: '6px', 
                   padding: '0.6rem 1rem', 
                   display: 'flex', 
                   gap: '1rem', 
                   flexWrap: 'wrap', 
                   alignItems: 'center',
                   boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                 }}
               >
                 <span style={{ fontWeight: '800', color: vColor.dark }}>
                   [차량 {vIdx + 1}: {modelShortName}] {opt.name}{opt.companyName ? ` (${opt.companyName})` : ''}
                 </span>
                 <span style={{ color: '#444' }}><strong>기간:</strong> {opt.termYears}년 ({opt.termYears * 12}개월)</span>
                 <span style={{ color: '#444' }}><strong>보증금:</strong> {toCommaString(calc.deposit)}원 ({opt.depositRate * 100}%)</span>
                 <span style={{ color: '#444' }}><strong>월 렌트료:</strong> <strong style={{ color: vColor.primary, fontSize: '1rem' }}>{toCommaString(calc.monthlyLeaseFee)}원</strong></span>
               </div>
             );
           })}
         </div>
         <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px dotted var(--border-color)', paddingTop: '0.4rem', marginTop: '0.2rem' }}>
           * 저장 또는 계약 전환 시 선택된 안들의 조건 정보가 함께 보존되며, 차량 1의 첫 번째 선택된 안이 주계약 기본정보로 연동됩니다.
         </div>
       </div>

      {/* Created By & Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: '600' }}>작성 담당자:</span>
          <input 
            type="text" 
            value={createdBy} 
            onChange={(e) => setCreatedBy(e.target.value)} 
            style={{ padding: '0.4rem 0.6rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', outline: 'none', width: '120px', background: '#fff' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '1rem' }}>
          <button 
            type="button"
            onClick={() => handleSaveQuote(false)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#fff', border: '1px solid var(--border-color)', color: 'var(--text-main)', padding: '0.7rem 1.5rem', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s' }}
            className="btn-save-draft"
          >
            <Save size={16} /> 견적 저장
          </button>
          
          <button 
            type="button"
            onClick={() => handleSaveQuote(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--primary)', border: 'none', color: '#fff', padding: '0.7rem 1.5rem', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', transition: 'all 0.2s' }}
            className="btn-convert-contract"
          >
            계약서 등록 전환 <ArrowRight size={16} />
          </button>
        </div>
      </div>

      {/* 📋 비교견적서 (차량 조건비교표) */}
      <div 
        id="print-comparison-area" 
        style={{ 
          marginTop: '1rem', 
          background: '#fff', 
          border: '1px solid var(--border-color)', 
          borderRadius: '16px', 
          padding: '2.5rem', 
          boxShadow: 'var(--shadow-premium)'
        }}
        className="comparison-sheet-section"
      >
        {/* 견적서 인쇄 양식 선택 탭 (no-print) */}
        <div className="no-print" style={{ 
          display: 'flex', 
          gap: '0.5rem', 
          marginBottom: '1.5rem', 
          background: 'var(--bg-main)', 
          padding: '0.4rem', 
          borderRadius: '10px', 
          border: '1px solid var(--border-color)',
          alignSelf: 'flex-start',
          width: 'fit-content'
        }}>
          <button
            type="button"
            onClick={() => setPrintFormType('comparison')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: 'none',
              fontSize: '0.8rem',
              fontWeight: '700',
              cursor: 'pointer',
              background: printFormType === 'comparison' ? 'var(--primary)' : 'transparent',
              color: printFormType === 'comparison' ? '#fff' : 'var(--text-muted)',
              transition: 'all 0.15s ease'
            }}
          >
            📋 비교 견적서 (조건비교표)
          </button>
          <button
            type="button"
            onClick={() => setPrintFormType('rental')}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: '6px',
              border: 'none',
              fontSize: '0.8rem',
              fontWeight: '700',
              cursor: 'pointer',
              background: printFormType === 'rental' ? 'var(--primary)' : 'transparent',
              color: printFormType === 'rental' ? '#fff' : 'var(--text-muted)',
              transition: 'all 0.15s ease'
            }}
          >
            📄 장기렌터카 견적서
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }} className="no-print">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
            <h4 style={{ fontWeight: '800', color: 'var(--text-bright)', margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {printFormType === 'comparison' ? '📋 비교견적서 (차량 조건비교표)' : '📄 장기렌터카 견적서'}
            </h4>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {printFormType === 'comparison' 
                ? '선택하신 비교 사양을 한눈에 대조하고 인쇄용 조건표를 다운로드할 수 있습니다.' 
                : '선택하신 차량 사양의 정식 인쇄용 견적서를 출력하고 다운로드할 수 있습니다.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: '#111e38',
              color: '#fff',
              border: 'none',
              padding: '0.6rem 1.2rem',
              borderRadius: '8px',
              fontWeight: '700',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(17,30,56,0.25)',
              transition: 'var(--transition-smooth)'
            }}
          >
            인쇄하기 / PDF 다운로드
          </button>
        </div>

        {/* Print & Screen Stylesheet */}
        <style dangerouslySetInnerHTML={{__html: `
          /* Screen CSS variables and classes */
          .comparison-table-wrapper {
            overflow-x: auto;
            margin-top: 1.5rem;
            border-radius: 0;
            box-shadow: none;
          }
          .comparison-table-modern {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.88rem;
            color: #334155;
            background: #fff;
            border-top: 3px solid #111e38;
            border-bottom: 3px solid #111e38;
          }
          .comparison-table-modern th, .comparison-table-modern td {
            padding: 12px 16px;
            border-bottom: 1px solid #e9e6e0;
            border-right: 1px solid #ad885c;
            transition: all 0.15s ease;
          }
          .comparison-table-modern thead tr:first-child th:last-child,
          .comparison-table-modern tbody tr td:last-child {
            border-right: none;
          }
          .row-header {
            color: #111e38;
            font-weight: 800;
            text-align: center !important;
            padding-left: 12px !important;
            padding-right: 12px !important;
            width: 15% !important;
            border-right: 1px solid #ad885c !important;
          }
          .value-cell {
            text-align: right !important;
            padding-right: 2.5rem !important;
            font-weight: 500;
          }
          .badge-gold {
            background-color: #ad885c;
            color: #fff;
            padding: 0.15rem 0.4rem;
            border-radius: 4px;
            font-weight: 800;
            font-size: 0.72rem;
            display: inline-block;
          }
          .print-only {
            display: none;
          }

          /* Mobile responsiveness optimization */
          @media screen and (max-width: 768px) {
            .comparison-sheet-section {
              padding: 1rem !important;
            }
            .comparison-table-modern {
              min-width: 800px !important;
            }
            .mobile-scroll-hint {
              display: block !important;
            }
            .customer-info-bar {
              flex-direction: column !important;
              align-items: flex-start !important;
              gap: 0.5rem !important;
            }
          }

          /* Print Overrides */
          @media print {
            @page {
              size: A4 portrait;
              margin: 8mm 8mm 8mm 8mm !important;
            }
            body {
              background: #fff !important;
              color: #000 !important;
              margin: 0 !important;
              padding: 0 !important;
            }
            /* Hide dashboard components during print */
            aside, header, nav, footer, button, .no-print {
              display: none !important;
            }
            .quote-input-container > :not(.comparison-sheet-section) {
              display: none !important;
            }
            main {
              padding: 0 !important;
              margin: 0 !important;
              overflow: visible !important;
            }
            .comparison-sheet-section {
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              width: 100% !important;
              border: none !important;
              box-shadow: none !important;
              padding: 0 !important;
              margin: 0 !important;
              background: #fff !important;
            }
            .comparison-table-modern {
              width: 100% !important;
              border-top: 3px solid #111e38 !important;
              border-bottom: 3px solid #111e38 !important;
            }
            .comparison-table-modern th, .comparison-table-modern td {
              border-bottom: 1px solid #e9e6e0 !important;
              border-right: 1px solid #ad885c !important;
              padding: 10px 12px !important;
              font-size: 10pt !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            .comparison-table-modern thead tr:first-child th:last-child,
            .comparison-table-modern tbody tr td:last-child {
              border-right: none !important;
            }
            .comparison-table-modern th {
              background-color: #111e38 !important;
              color: #fff !important;
            }
            .comparison-table-modern td.row-header {
              text-align: center !important;
              padding-left: 4px !important;
              font-weight: 800 !important;
              background-color: #fafafa !important;
              border-right: 1px solid #ad885c !important;
            }
            /* Highlight total purchase cost in yellow when printed */
            .print-highlight-yellow {
              background-color: #ffff00 !important;
              font-weight: 800 !important;
            }
            /* Reset badge styling in print */
            .badge-green, .badge-red, .badge-gray {
              background: transparent !important;
              padding: 0 !important;
              border-radius: 0 !important;
              font-size: 9.5pt !important;
              font-weight: 800 !important;
            }
            .badge-green { color: #000 !important; }
            .badge-red { color: #d32f2f !important; }
            .badge-gray { color: #000 !important; }
            .print-only {
              display: inline !important;
            }

            /* Print size optimizations for long-term rental quote sheet */
            .rental-print-area {
              width: 100% !important;
              max-width: 100% !important;
              padding: 0 !important;
              margin: 0 auto !important;
              font-size: 6.8pt !important;
              line-height: 1.15 !important;
            }
            .rental-print-area table {
              width: 100% !important;
              margin-bottom: 2px !important;
              border-collapse: collapse !important;
            }
            .rental-print-area td, .rental-print-area th {
              padding: 2px 3px !important;
              font-size: 6.5pt !important;
              border: 1px solid #000 !important;
            }
            .rental-print-area tr {
              height: auto !important;
            }
            .rental-print-area div {
              margin-bottom: 1px !important;
              line-height: 1.15 !important;
            }
          }
        `}} />

        {/* PDF Layout Content */}
        {/* PDF Layout Content */}
        {printFormType === 'comparison' ? (
          <div style={{ maxWidth: '900px', margin: '0 auto', background: '#fff', padding: '10px' }}>
            {/* Document Title Header */}
            <div style={{ textAlign: 'center', marginBottom: '2.5rem', marginTop: '0.5rem' }}>
              <div style={{ color: '#ad885c', fontSize: '0.8rem', fontWeight: '800', letterSpacing: '3px', marginBottom: '0.4rem', textTransform: 'uppercase' }}>
                Vehicle Condition Comparison
              </div>
              <h2 style={{ fontWeight: '800', fontSize: '2.2rem', color: '#111e38', margin: 0, letterSpacing: '1px', borderBottom: '2px solid #ad885c', paddingBottom: '1rem', display: 'inline-block', width: '100%' }}>
                차량 조건비교표
              </h2>
            </div>

            {/* Customer & Date Info Bar */}
            <div className="customer-info-bar" style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginBottom: '1rem',
              color: '#111e38',
              fontSize: '0.98rem',
              fontWeight: '700'
            }}>
              <div>
                <span style={{ color: '#ad885c', marginRight: '0.6rem' }}>수신</span>
                <span>{displayCustomerName} 귀하</span>
              </div>
              <div style={{ color: '#555', fontWeight: '500', fontSize: '0.9rem' }}>
                작성일 {todayDateStr}
              </div>
            </div>

            {/* Mobile Scroll Hint */}
            <div className="mobile-scroll-hint" style={{ 
              display: 'none', 
              textAlign: 'center', 
              fontSize: '0.8rem', 
              color: '#ad885c', 
              backgroundColor: '#fdfbfa',
              border: '1px dashed #ad885c',
              borderRadius: '6px',
              padding: '0.6rem',
              marginBottom: '1rem', 
              fontWeight: '700' 
            }}>
              ← 좌우로 밀어서 전체 비교표를 확인하세요 →
            </div>

            {/* Table Wrapper */}
            <div className="comparison-table-wrapper">
              <table className="comparison-table-modern">
                <thead>
                  {/* Row 1: Vehicle model colspans */}
                  <tr style={{ background: '#111e38', color: '#fff' }}>
                    <th rowSpan={2} style={{ background: '#111e38', color: '#fff', fontWeight: '800', fontSize: '0.95rem', width: '15%', borderBottom: '1px solid #ad885c', textAlign: 'center', borderRight: '1px solid #ad885c' }}>구 분</th>
                    {vehicleColSpans.map((group, idx) => {
                      return (
                        <th 
                          key={idx} 
                          colSpan={group.span} 
                          style={{ 
                            background: '#111e38', 
                            color: '#fff', 
                            fontWeight: '800', 
                            fontSize: '1rem', 
                            padding: '1.2rem 0.5rem',
                            borderBottom: '1px solid #ad885c',
                            borderRight: '1px solid #ad885c',
                            textAlign: 'center',
                            letterSpacing: '0.5px'
                          }}
                        >
                          {group.model}
                        </th>
                      );
                    })}
                    <th rowSpan={2} style={{ background: '#111e38', color: '#fff', fontWeight: '800', fontSize: '0.95rem', width: '15%', borderBottom: '1px solid #ad885c', textAlign: 'center' }}>비고</th>
                  </tr>
                  {/* Row 2: Options descriptions */}
                  <tr style={{ background: '#111e38', color: '#fff' }}>
                    {displaySelectedOptions.map(({ opt }, idx) => {
                      return (
                        <th 
                          key={idx} 
                          style={{ 
                            background: '#111e38', 
                            borderBottom: '1px solid #ad885c', 
                            borderRight: '1px solid #ad885c',
                            padding: '1rem 0.5rem', 
                            fontSize: '0.8rem', 
                            fontWeight: '700', 
                            color: '#fff',
                            lineHeight: '1.5',
                            textAlign: 'center'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', marginBottom: '0.2rem' }}>
                            <span style={{ 
                              backgroundColor: '#ad885c', 
                              color: '#fff', 
                              padding: '0.15rem 0.5rem', 
                              borderRadius: '4px', 
                              fontWeight: '800', 
                              fontSize: '0.72rem', 
                              display: 'inline-block' 
                            }}>{opt.name}</span>
                            <span style={{ fontWeight: '800', color: '#fff' }}>렌트 {opt.termYears * 12}개월 · 보증금 {Math.round(opt.depositRate * 100)}%</span>
                          </div>
                          <div style={{ color: '#cbd5e1', fontSize: '0.74rem', fontWeight: '500' }}>
                            선수금 {Math.round(opt.advancePaymentRate * 100)}% · 잔존가치 {Math.round(opt.residualRate * 100)}%
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {/* 차량가격 */}
                  <tr>
                    <td className="row-header" style={{ background: '#ffffff', borderRight: '1px solid #ad885c' }}>차량가격</td>
                    {displaySelectedOptions.map(({ calc }, idx) => (
                      <td key={idx} style={getCellStyles(idx, false)}>{toCommaString(calc.totalCarPrice)}</td>
                    ))}
                    <td style={{ background: '#ffffff', textAlign: 'center', color: '#94a3b8' }}>-</td>
                  </tr>
                  {/* 보증금 */}
                  <tr>
                    <td className="row-header" style={{ background: '#f9f8f6', borderRight: '1px solid #ad885c' }}>보증금</td>
                    {displaySelectedOptions.map(({ calc }, idx) => {
                      const hasDeposit = calc.deposit && calc.deposit > 0;
                      return (
                        <td 
                          key={idx} 
                          style={getCellStyles(idx, true, !hasDeposit ? { textAlign: 'center', paddingLeft: '16px', paddingRight: '16px' } : {})}
                        >
                          {hasDeposit ? toCommaString(calc.deposit) : '-'}
                        </td>
                      );
                    })}
                    <td style={{ background: '#f9f8f6', textAlign: 'center', color: '#94a3b8' }}>-</td>
                  </tr>
                  {/* 선수금 */}
                  <tr>
                    <td className="row-header" style={{ background: '#ffffff', borderRight: '1px solid #ad885c' }}>선수금</td>
                    {displaySelectedOptions.map(({ calc }, idx) => {
                      const hasAdvance = calc.advancePayment && calc.advancePayment > 0;
                      return (
                        <td 
                          key={idx} 
                          style={getCellStyles(idx, false, !hasAdvance ? { textAlign: 'center', paddingLeft: '16px', paddingRight: '16px' } : {})}
                        >
                          {hasAdvance ? toCommaString(calc.advancePayment) : '-'}
                        </td>
                      );
                    })}
                    <td style={{ background: '#ffffff', textAlign: 'center', color: '#94a3b8' }}>-</td>
                  </tr>
                  {/* 잔존가치 */}
                  <tr>
                    <td className="row-header" style={{ background: '#f9f8f6', borderRight: '1px solid #ad885c' }}>잔존가치</td>
                    {displaySelectedOptions.map(({ calc }, idx) => (
                      <td key={idx} style={getCellStyles(idx, true)}>{toCommaString(calc.takeoverPrice)}</td>
                    ))}
                    <td style={{ background: '#f9f8f6', textAlign: 'center', color: '#94a3b8' }}>-</td>
                  </tr>
                  {/* 출고전 납입액 */}
                  <tr>
                    <td className="row-header" style={{ background: '#ffffff', borderRight: '1px solid #ad885c' }}>출고전 납입액</td>
                    {displaySelectedOptions.map(({ calc }, idx) => (
                      <td key={idx} style={getCellStyles(idx, false, { fontWeight: '800', color: '#111e38' })}>{toCommaString(calc.deposit + calc.advancePayment)}</td>
                    ))}
                    <td style={{ background: '#ffffff', textAlign: 'center', color: '#94a3b8' }}>-</td>
                  </tr>
                  {/* 월 납입액 */}
                  <tr>
                    <td className="row-header" style={{ background: '#f9f8f6', borderRight: '1px solid #ad885c' }}>월 납입액</td>
                    {displaySelectedOptions.map(({ calc }, idx) => (
                      <td key={idx} style={getCellStyles(idx, true, { fontWeight: '800', fontSize: '0.95rem', color: '#111e38' })}>{toCommaString(calc.monthlyLeaseFee)}</td>
                    ))}
                    <td style={{ background: '#f9f8f6', textAlign: 'center', color: '#94a3b8' }}>-</td>
                  </tr>
                  {/* 기간(개월) */}
                  <tr>
                    <td className="row-header" style={{ background: '#ffffff', borderRight: '1px solid #ad885c' }}>기간(개월)</td>
                    {displaySelectedOptions.map(({ opt }, idx) => (
                      <td key={idx} style={getCellStyles(idx, false)}>{opt.termYears * 12}</td>
                    ))}
                    <td style={{ background: '#ffffff', textAlign: 'center', color: '#94a3b8' }}>-</td>
                  </tr>
                  {/* 월 납입액계 */}
                  <tr>
                    <td className="row-header" style={{ background: '#f9f8f6', borderRight: '1px solid #ad885c' }}>월 납입액계</td>
                    {displaySelectedOptions.map(({ opt, calc }, idx) => (
                      <td key={idx} style={getCellStyles(idx, true, { fontWeight: '600' })}>{toCommaString(calc.monthlyLeaseFee * opt.termYears * 12)}</td>
                    ))}
                    <td style={{ background: '#f9f8f6', textAlign: 'center', color: '#94a3b8' }}>-</td>
                  </tr>
                  {/* 종료 후 납입액 */}
                  <tr>
                    <td className="row-header" style={{ background: '#ffffff', borderRight: '1px solid #ad885c' }}>종료 후 납입액</td>
                    {displaySelectedOptions.map(({ calc }, idx) => (
                      <td key={idx} style={getCellStyles(idx, false)}>{toCommaString(calc.takeoverPrice - calc.deposit)}</td>
                    ))}
                    <td style={{ background: '#ffffff', textAlign: 'center', color: '#94a3b8' }}>-</td>
                  </tr>
                  {/* 예상보험료 */}
                  <tr>
                    <td className="row-header" style={{ background: '#f9f8f6', borderRight: '1px solid #ad885c' }}>예상보험료</td>
                    {displaySelectedOptions.map((_, idx) => (
                      <td key={idx} style={getCellStyles(idx, true, { color: '#94a3b8', textAlign: 'center', paddingLeft: '16px', paddingRight: '16px' })}>-</td>
                    ))}
                    <td style={{ background: '#f9f8f6', textAlign: 'center', color: '#94a3b8' }}>-</td>
                  </tr>
                  {/* 자동차세 */}
                  <tr>
                    <td className="row-header" style={{ background: '#ffffff', borderRight: '1px solid #ad885c' }}>자동차세</td>
                    {displaySelectedOptions.map((_, idx) => (
                      <td key={idx} style={getCellStyles(idx, false, { color: '#94a3b8', textAlign: 'center', paddingLeft: '16px', paddingRight: '16px' })}>-</td>
                    ))}
                    <td style={{ background: '#ffffff', textAlign: 'center', color: '#94a3b8' }}>-</td>
                  </tr>
                  {/* 총구입가 */}
                  <tr style={{ borderTop: '2px solid #ad885c', borderBottom: '2px solid #ad885c' }}>
                    <td className="row-header" style={{ background: '#f9f8f6', borderRight: '1px solid #ad885c' }}>총구입가</td>
                    {displaySelectedOptions.map(({ opt, calc }, idx) => {
                      const totalBuyCost = calc.advancePayment + (calc.monthlyLeaseFee * opt.termYears * 12) + calc.takeoverPrice;
                      return (
                        <td 
                          key={idx} 
                          style={getCellStyles(idx, true, { fontWeight: '800', fontSize: '0.95rem' })}
                        >
                          {toCommaString(totalBuyCost)}
                        </td>
                      );
                    })}
                    <td style={{ background: '#f9f8f6', textAlign: 'center', color: '#94a3b8' }}>-</td>
                  </tr>
                  {/* 비교금액 */}
                  <tr style={{ borderBottom: '2px solid #ad885c' }}>
                    <td className="row-header" style={{ background: '#ffffff', borderRight: '1px solid #ad885c' }}>비교금액</td>
                    {displaySelectedOptions.map(({ opt, calc }, idx) => {
                      const totalBuyCost = calc.advancePayment + (calc.monthlyLeaseFee * opt.termYears * 12) + calc.takeoverPrice;
                      const firstCost = displaySelectedOptions[0]
                        ? (displaySelectedOptions[0].calc.advancePayment + (displaySelectedOptions[0].calc.monthlyLeaseFee * displaySelectedOptions[0].opt.termYears * 12) + displaySelectedOptions[0].calc.takeoverPrice)
                        : 0;
                      const diff = firstCost - totalBuyCost;
                      
                      if (idx === 0) {
                        return <td key={idx} style={getCellStyles(idx, false, { color: '#b91c1c', fontStyle: 'italic', fontWeight: '700', textAlign: 'center', paddingLeft: '16px', paddingRight: '16px' })}>-</td>;
                      }
                      
                      let diffStr = '-';
                      let isZero = diff === 0;
                      if (diff > 0) {
                        diffStr = toCommaString(diff);
                      } else if (diff < 0) {
                        diffStr = `- ${toCommaString(Math.abs(diff))}`;
                      }
                      
                      return (
                        <td key={idx} style={getCellStyles(idx, false, { color: '#b91c1c', fontStyle: 'italic', fontWeight: '700', ...(isZero ? { textAlign: 'center', paddingLeft: '16px', paddingRight: '16px' } : {}) })}>
                          {diffStr}
                        </td>
                      );
                    })}
                    <td style={{ background: '#ffffff', textAlign: 'center', color: '#94a3b8' }}>-</td>
                  </tr>
                  {/* 약정운행거리(년) */}
                  <tr>
                    <td className="row-header" style={{ background: '#f9f8f6', borderRight: '1px solid #ad885c' }}>약정운행거리(년)</td>
                    {displaySelectedOptions.map(({ opt }, idx) => (
                      <td key={idx} style={getCellStyles(idx, false)}>{opt.mileage ? opt.mileage.toLocaleString() + 'km' : '20,000km'}</td>
                    ))}
                    <td style={{ background: '#f9f8f6', textAlign: 'center', color: '#94a3b8' }}>-</td>
                  </tr>
                  {/* 정비 */}
                  <tr style={{ borderBottom: '3px solid #111e38' }}>
                    <td className="row-header" style={{ background: '#ffffff', borderRight: '1px solid #ad885c' }}>정비</td>
                    {displaySelectedOptions.map(({ opt }, idx) => (
                      <td key={idx} style={getCellStyles(idx, true, { textAlign: 'center', paddingLeft: '16px', paddingRight: '16px' })}>{opt.maintenancePlan || '가입'}</td>
                    ))}
                    <td style={{ background: '#ffffff', textAlign: 'center', color: '#94a3b8' }}>-</td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Footer Area */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginTop: '1.5rem', 
              fontSize: '0.78rem',
              color: '#777',
              fontWeight: '500',
              borderTop: '1px solid #e9e6e0',
              paddingTop: '1rem'
            }}>
              <div>
                본 비교표는 계약 조건에 따라 변동될 수 있습니다.
              </div>
              <div style={{ 
                color: '#ad885c', 
                fontWeight: '800', 
                letterSpacing: '2px', 
                fontSize: '0.85rem' 
              }}>
                RENT BENEFIT
              </div>
            </div>
          </div>
        ) : (
          <div className="rental-print-area" style={{ maxWidth: '900px', margin: '0 auto', background: '#fff', padding: '10px 15px', color: '#000', fontFamily: 'sans-serif', fontSize: '0.76rem' }}>
            {/* 1. Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.0rem', borderBottom: '2.5px double #000', paddingBottom: '0.5rem' }}>
              <div style={{ fontSize: '1.0rem', fontWeight: '800', color: '#111e38', width: '130px' }}>(주)렌트베네핏</div>
              <h2 style={{ fontSize: '1.8rem', fontWeight: '800', color: '#111e38', margin: 0, letterSpacing: '2px', flex: 1, textAlign: 'center' }}>장기렌터카 견적서</h2>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: '130px' }}>
                <img src="http://www.sdibenefit.com/images/logo.png" alt="RENT BENefit" style={{ maxWidth: '100px', height: 'auto' }} />
                <span style={{ fontSize: '0.55rem', fontWeight: '800', color: '#ad885c', letterSpacing: '1px', marginTop: '1px' }}>RENT BENefit</span>
              </div>
            </div>

            {/* 2. Customer & Document Meta Info */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1.0rem', marginBottom: '0.6rem' }}>
              {/* 왼쪽 테이블: 고객 및 차량 정보 */}
              <table style={{ width: '50%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.74rem' }}>
                <tbody>
                  <tr>
                    <td style={{ width: '25%', background: '#dcdcdc', padding: '4px 6px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' }}>고객명</td>
                    <td style={{ width: '75%', padding: '4px 6px', border: '1px solid #000', fontWeight: '700', fontSize: '0.78rem' }}>{displayCustomerName} 귀하</td>
                  </tr>
                  <tr>
                    <td style={{ background: '#dcdcdc', padding: '4px 6px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' }}>차종</td>
                    <td style={{ padding: '4px 6px', border: '1px solid #000', fontSize: '0.72rem', fontWeight: '600' }}>{firstOption?.veh.carModel || '차종 미입력'}</td>
                  </tr>
                  <tr>
                    <td style={{ background: '#dcdcdc', padding: '4px 6px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' }}>예상납기</td>
                    <td style={{ padding: '4px 6px', border: '1px solid #000', color: '#d9534f', fontWeight: '700' }}>{firstOption?.veh.deliveryPeriod || '협의'}</td>
                  </tr>
                  <tr>
                    <td style={{ background: '#dcdcdc', padding: '4px 6px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' }}>색상</td>
                    <td style={{ padding: '4px 6px', border: '1px solid #000', fontSize: '0.72rem' }}>
                      [외장]: <span style={{ color: '#d9534f', fontWeight: '700' }}>{firstOption?.veh.exteriorColor || '-'}</span>, &nbsp;
                      [내장]: <span style={{ color: '#d9534f', fontWeight: '700' }}>{firstOption?.veh.interiorColor || '-'}</span>
                    </td>
                  </tr>
                  <tr>
                    <td style={{ background: '#dcdcdc', padding: '4px 6px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' }}>옵션</td>
                    <td style={{ padding: '4px 6px', border: '1px solid #000', fontSize: '0.70rem', color: '#d9534f', fontWeight: '600' }}>{firstOption?.veh.carOptionsName || '-'}</td>
                  </tr>
                </tbody>
              </table>

              {/* 오른쪽 테이블: 견적 정보 및 담당자 */}
              <table style={{ width: '50%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.74rem' }}>
                <tbody>
                  <tr>
                    <td style={{ width: '25%', background: '#dcdcdc', padding: '4px 6px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' }}>작성일</td>
                    <td style={{ width: '75%', padding: '4px 6px', border: '1px solid #000', textAlign: 'center' }}>{todayDateStr}</td>
                  </tr>
                  <tr>
                    <td style={{ background: '#dcdcdc', padding: '4px 6px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' }}>견적서 보관 기간</td>
                    <td style={{ padding: '4px 6px', border: '1px solid #000', textAlign: 'center' }}>작성일로부터 10일 간 보관</td>
                  </tr>
                  <tr>
                    <td style={{ background: '#dcdcdc', padding: '4px 6px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' }}>견적 번호</td>
                    <td style={{ padding: '4px 6px', border: '1px solid #000', textAlign: 'center', fontWeight: '600' }}>
                      {`RB-${todayDateStr.replace(/-/g, '').substring(2)}-${displayCustomerName.slice(0, 2).replace(/\s/g, '') || '01'}`}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ background: '#dcdcdc', padding: '4px 6px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' }}>담당자</td>
                    <td style={{ padding: '4px 6px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>{createdBy} 팀장</td>
                  </tr>
                  <tr>
                    <td style={{ background: '#dcdcdc', padding: '4px 6px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' }}>연락처</td>
                    <td style={{ padding: '2px 6px', border: '1px solid #000', fontSize: '0.70rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>TEL</span>
                        <span>02-547-0303 / 010-9061-3000</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dotted #ccc', paddingTop: '1px', marginTop: '1px' }}>
                        <span>FAX</span>
                        <span>02-529-3303</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px dotted #ccc', paddingTop: '1px', marginTop: '1px' }}>
                        <span>E-Mail</span>
                        <span style={{ color: '#0056b3', textDecoration: 'underline' }}>rent@sdibenefit.com</span>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 3. Credit Information Notice */}
            <div style={{ background: '#fafafa', border: '1px solid #adadad', padding: '4px 10px', fontSize: '0.68rem', color: '#333', marginBottom: '0.6rem', borderRadius: '4px', lineHeight: '1.3' }}>
              <div style={{ fontWeight: '700', textAlign: 'center', marginBottom: '1px' }}>• 대출액 10억 이하인 경우 및 최근 1개년 재무제표 미제출시에 한함 •</div>
              <div>1. 기업의 신용도 판단 목적으로 대표자의 개인신용정보를 조회할 경우, 렌트베네핏은 해당 기업의 대표자에게 조회 사실 및 이유 등을 사전 고지하여야 합니다.</div>
              <div>2. 렌트베네핏에 장기 견적을 요청한 업무담당자께서는 귀사의 대표자에게 신용조회가 발생할 수 있음을 반드시 사전 보고해 주시기 바랍니다.</div>
            </div>

            {/* 4. Main Rental Details Table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.74rem', marginBottom: '0.2rem' }}>
              <thead>
                <tr style={{ background: '#dcdcdc', borderBottom: '1.5px solid #000' }}>
                  <th style={{ width: '6%', padding: '4px 2px', border: '1px solid #000', fontWeight: '700', textAlign: 'center' }}>구분</th>
                  <th style={{ width: '32%', padding: '4px 2px', border: '1px solid #000', fontWeight: '700', textAlign: 'center' }}>차종</th>
                  <th style={{ width: '6%', padding: '4px 2px', border: '1px solid #000', fontWeight: '700', textAlign: 'center' }}>수량</th>
                  <th style={{ width: '8%', padding: '4px 2px', border: '1px solid #000', fontWeight: '700', textAlign: 'center' }}>계약기간</th>
                  <th style={{ width: '12%', padding: '4px 2px', border: '1px solid #000', fontWeight: '700', textAlign: 'center' }}>차량가격</th>
                  <th style={{ width: '9%', padding: '4px 2px', border: '1px solid #000', fontWeight: '700', textAlign: 'center' }}>보증금</th>
                  <th style={{ width: '9%', padding: '4px 2px', border: '1px solid #000', fontWeight: '700', textAlign: 'center' }}>선수금</th>
                  <th style={{ width: '9%', padding: '4px 2px', border: '1px solid #000', fontWeight: '700', textAlign: 'center' }}>인수가</th>
                  <th style={{ width: '11%', padding: '4px 2px', border: '1px solid #000', fontWeight: '700', textAlign: 'center' }}>월대여료</th>
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2, 3].map(index => {
                  const item = displaySelectedOptions[index];
                  if (item) {
                    const { veh, opt, calc } = item;
                    return (
                      <React.Fragment key={index}>
                        <tr style={{ height: '1.5rem' }}>
                          <td rowSpan={2} style={{ textAlign: 'center', padding: '4px 2px', border: '1px solid #000', fontWeight: '700', background: '#fafafa' }}>{index + 1}</td>
                          <td style={{ padding: '4px 4px', border: '1px solid #000', fontWeight: '700', fontSize: '0.70rem' }}>{veh.carModel}</td>
                          <td style={{ textAlign: 'center', padding: '4px 2px', border: '1px solid #000' }}>1</td>
                          <td style={{ textAlign: 'center', padding: '4px 2px', border: '1px solid #000' }}>{opt.termYears * 12}</td>
                          <td style={{ textAlign: 'right', padding: '4px 4px', border: '1px solid #000' }}>{toCommaString(calc.totalCarPrice)}</td>
                          <td style={{ textAlign: 'right', padding: '4px 4px', border: '1px solid #000' }}>{toCommaString(calc.deposit)}</td>
                          <td style={{ textAlign: 'right', padding: '4px 4px', border: '1px solid #000' }}>{toCommaString(calc.advancePayment)}</td>
                          <td style={{ textAlign: 'right', padding: '4px 4px', border: '1px solid #000' }}>{toCommaString(calc.takeoverPrice)}</td>
                          <td style={{ textAlign: 'right', padding: '4px 4px', border: '1px solid #000', fontWeight: '700', color: '#111e38' }}>{toCommaString(calc.monthlyLeaseFee)}</td>
                        </tr>
                        <tr style={{ background: '#fdfbfa', fontSize: '0.66rem', height: '1.2rem' }}>
                          <td style={{ padding: '2px 4px', border: '1px solid #000', color: '#555' }}>
                            정비 &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <strong>{opt.isMaintenanceEnabled !== false ? '가입' : '미가입'}</strong>
                          </td>
                          <td colSpan={3} style={{ border: '1px solid #000' }}></td>
                          <td style={{ textAlign: 'right', padding: '2px 4px', border: '1px solid #000', color: '#555', fontWeight: '600' }}>
                            {Math.round(opt.depositRate * 100)}%
                          </td>
                          <td style={{ textAlign: 'right', padding: '2px 4px', border: '1px solid #000', color: '#555', fontWeight: '600' }}>
                            {Math.round(opt.advancePaymentRate * 100)}%
                          </td>
                          <td style={{ textAlign: 'right', padding: '2px 4px', border: '1px solid #000', color: '#555', fontWeight: '600' }}>
                            {Math.round(opt.residualRate * 100)}%
                          </td>
                          <td style={{ border: '1px solid #000' }}></td>
                        </tr>
                      </React.Fragment>
                    );
                  } else {
                    return (
                      <React.Fragment key={index}>
                        <tr style={{ height: '1.4rem' }}>
                          <td rowSpan={2} style={{ textAlign: 'center', padding: '4px 2px', border: '1px solid #000', fontWeight: '700', background: '#fafafa', color: '#ccc' }}>{index + 1}</td>
                          <td style={{ padding: '4px 4px', border: '1px solid #000' }}></td>
                          <td style={{ border: '1px solid #000' }}></td>
                          <td style={{ border: '1px solid #000' }}></td>
                          <td style={{ border: '1px solid #000' }}></td>
                          <td style={{ border: '1px solid #000' }}></td>
                          <td style={{ border: '1px solid #000' }}></td>
                          <td style={{ border: '1px solid #000' }}></td>
                          <td style={{ border: '1px solid #000' }}></td>
                        </tr>
                        <tr style={{ height: '1.1rem', background: '#fdfbfa' }}>
                          <td style={{ border: '1px solid #000' }}></td>
                          <td colSpan={3} style={{ border: '1px solid #000' }}></td>
                          <td style={{ border: '1px solid #000' }}></td>
                          <td style={{ border: '1px solid #000' }}></td>
                          <td style={{ border: '1px solid #000' }}></td>
                          <td style={{ border: '1px solid #000' }}></td>
                        </tr>
                      </React.Fragment>
                    );
                  }
                })}
              </tbody>
            </table>

            <div style={{ textAlign: 'right', fontSize: '0.62rem', color: '#555', marginBottom: '0.4rem', fontWeight: '600' }}>
              대당 / 차량소비자가격 * 옵션 및 VAT포함 / 월대여료 : VAT포함
            </div>

            {/* 5. Fine Print / Guidelines */}
            <div style={{ background: '#fdfbfa', border: '1px dashed #ad885c', padding: '4px 8px', fontSize: '0.66rem', color: '#555', marginBottom: '0.5rem', lineHeight: '1.35' }}>
              <div>• 상기 견적 금액은 운용대수(계약대수/차량보유대수), 차량가 변동 또는 정부 시책에 따라 변동될 수 있습니다.</div>
              <div>• 상기 견적 중 선납금을 선택하신 경우는 선납금액을 계약기간으로 균등하게 나눈 금액을 월대여료에서 차감하고 청구됩니다.</div>
              <div>• 차량 등급별 세부 옵션 사항을 반드시 확인하시기 바라며, 각 차종의 세부 옵션 사항은 차량제조사 홈페이지에서 확인이 가능합니다.</div>
              <div>• 전기차 지역 보조금 소진 및 정부 정책에 따라 견적 상세 내용이 변경될 수 있으며, 안내되는 보조금 신청 사항 및 서류 접수 내용과 상이할 경우 견적이 취소됩니다.</div>
            </div>

            {/* 6. Rental and Insurance Clauses Grid */}
            <div style={{ display: 'flex', gap: '1.2rem', marginBottom: '0.5rem' }}>
              {/* 왼쪽 블록: 대여료 포함사항 & 보험가입내용 */}
              <div style={{ width: '50%', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {/* 원대여료 포함사항 */}
                <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.68rem' }}>
                  <thead>
                    <tr style={{ background: '#dcdcdc', borderBottom: '1px solid #000' }}>
                      <th style={{ padding: '3px', fontWeight: '700', textAlign: 'center' }}>원대여료 포함사항</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ padding: '4px 6px', border: '1px solid #000', lineHeight: '1.4', fontWeight: '500' }}>
                        <div>• 보험료, 차량 검사비, 세금, 공과금 전부 포함</div>
                        <div>• 차량점검, 수리 / 소모품 교체 비용 등 불포함</div>
                        <div>• 유류비, 세차비, 과태료, 범칙금은 임차인 부담</div>
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* 보험 가입 내용 */}
                <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.66rem' }}>
                  <thead>
                    <tr style={{ background: '#dcdcdc', borderBottom: '1px solid #000' }}>
                      <th colSpan={4} style={{ padding: '3px', fontWeight: '700', textAlign: 'center' }}>보험 가입 내용</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ width: '22%', background: '#fafafa', padding: '2px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>운전 범위</td>
                      <td style={{ width: '28%', padding: '2px 4px', border: '1px solid #000', textAlign: 'center' }}>임직원</td>
                      <td style={{ width: '22%', background: '#fafafa', padding: '2px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>운전자 연령</td>
                      <td style={{ width: '28%', padding: '2px 4px', border: '1px solid #000', textAlign: 'center' }}>만26세</td>
                    </tr>
                    <tr>
                      <td style={{ background: '#fafafa', padding: '2px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>대 인</td>
                      <td colSpan={3} style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '600' }}>무 제 한</td>
                    </tr>
                    <tr>
                      <td style={{ background: '#fafafa', padding: '2px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>대 물</td>
                      <td colSpan={3} style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '600' }}>2 억 원</td>
                    </tr>
                    <tr>
                      <td style={{ background: '#fafafa', padding: '2px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>자 기 신 체</td>
                      <td colSpan={3} style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '600' }}>사상 1억 / 부상 1500만</td>
                    </tr>
                    <tr>
                      <td style={{ background: '#fafafa', padding: '2px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>자기부담금(CMD)</td>
                      <td colSpan={3} style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '600' }}>30만원</td>
                    </tr>
                    <tr>
                      <td style={{ background: '#fafafa', padding: '2px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>무보험차상해</td>
                      <td colSpan={3} style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '600' }}>2억원 / 1인당</td>
                    </tr>
                    <tr>
                      <td style={{ background: '#fafafa', padding: '2px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>긴급출동</td>
                      <td colSpan={3} style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '600' }}>5회/년</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* 오른쪽 블록: 대여조건 & 차량관리/정비서비스 */}
              <div style={{ width: '50%', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {/* 대여 조건 */}
                <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.68rem' }}>
                  <thead>
                    <tr style={{ background: '#dcdcdc', borderBottom: '1px solid #000' }}>
                      <th colSpan={2} style={{ padding: '3px', fontWeight: '700', textAlign: 'center' }}>대여 조건</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ width: '40%', background: '#fafafa', padding: '3px 6px', border: '1px solid #000', fontWeight: '700' }}>• 약정주행거리</td>
                      <td style={{ width: '60%', padding: '3px 6px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>
                        {firstOption?.opt.mileage ? firstOption.opt.mileage.toLocaleString() + ' km/년' : '30,000 km/년'}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ background: '#fafafa', padding: '3px 6px', border: '1px solid #000', fontWeight: '700' }}>• 중도해지 수수료율</td>
                      <td style={{ padding: '3px 6px', border: '1px solid #000', textAlign: 'center', fontWeight: '600' }}>35%</td>
                    </tr>
                    <tr>
                      <td style={{ background: '#fafafa', padding: '3px 6px', border: '1px solid #000', fontWeight: '700' }}>• 연체 이율</td>
                      <td style={{ padding: '3px 6px', border: '1px solid #000', textAlign: 'center', fontWeight: '600' }}>연 25%</td>
                    </tr>
                  </tbody>
                </table>

                {/* 차량 관리 서비스 */}
                <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.66rem' }}>
                  <thead>
                    <tr style={{ background: '#dcdcdc', borderBottom: '1px solid #000' }}>
                      <th colSpan={3} style={{ padding: '3px', fontWeight: '700', textAlign: 'center' }}>차량 관리 서비스</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td rowSpan={3} style={{ width: '22%', background: '#fafafa', padding: '2px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>기본제공 사항</td>
                      <td style={{ width: '53%', padding: '2px 4px', border: '1px solid #000' }}>• 차량 법정 검사 대행</td>
                      <td style={{ width: '25%', padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>가입</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '2px 4px', border: '1px solid #000' }}>• 차량사고시 사고처리 및 사고수리</td>
                      <td style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>자기부담금</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '2px 4px', border: '1px solid #000' }}>• 차량사고/고장시 긴급 출동서비스</td>
                      <td style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>5회/년</td>
                    </tr>

                    <tr style={{ background: '#dcdcdc', borderBottom: '1px solid #000' }}>
                      <th colSpan={3} style={{ padding: '3px', fontWeight: '700', textAlign: 'center', borderTop: '1.5px solid #000', borderBottom: '1px solid #000' }}>정비 서비스</th>
                    </tr>
                    <tr>
                      <td rowSpan={4} style={{ width: '22%', background: '#fafafa', padding: '2px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>서비스별 적용사항</td>
                      <td style={{ padding: '2px 4px', border: '1px solid #000' }}>• 순회정비 차량을 이용한 정기 순회점검</td>
                      <td style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>
                        {firstOption?.opt.isMaintenanceEnabled !== false ? '가입' : '미가입'}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '2px 4px', border: '1px solid #000' }}>• 일반정비(고장수리) 서비스</td>
                      <td style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>
                        {firstOption?.opt.isMaintenanceEnabled !== false ? '가입' : '미가입'}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '2px 4px', border: '1px solid #000' }}>• 소모품 교환(오일류, 배터리, 기타)</td>
                      <td style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>
                        {firstOption?.opt.isMaintenanceEnabled !== false ? '가입' : '미가입'}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '2px 4px', border: '1px solid #000' }}>• 타이어 교체</td>
                      <td style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>
                        {firstOption?.opt.isMaintenanceEnabled !== false 
                          ? `${Math.floor(((firstOption?.opt.termYears || 4) * (firstOption?.opt.mileage || 20000)) / 60000) * 4}본 제공` 
                          : '미제공'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* 7. Notes and Special Terms */}
            <div style={{ display: 'flex', gap: '1.2rem', marginBottom: '0.5rem' }}>
              <table style={{ width: '50%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.68rem' }}>
                <thead>
                  <tr style={{ background: '#dcdcdc', borderBottom: '1px solid #000' }}>
                    <th style={{ padding: '3px', fontWeight: '700', textAlign: 'center' }}>비고</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '5px 8px', border: '1px solid #000', height: '80px', verticalAlign: 'top', color: '#666' }}>
                      {/* Memo space */}
                    </td>
                  </tr>
                </tbody>
              </table>

              <table style={{ width: '50%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.66rem' }}>
                <thead>
                  <tr style={{ background: '#dcdcdc', borderBottom: '1px solid #000' }}>
                    <th style={{ padding: '3px', fontWeight: '700', textAlign: 'center' }}>특약사항</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: '5px 8px', border: '1px solid #000', height: '80px', verticalAlign: 'top', lineHeight: '1.4', color: '#333' }}>
                      <div>• 개별소비세 관련 정부 정책 변경 이후 출고되는 차량의 렌탈료는 [개별소비세 변동 금액/계약 개월 수]만큼 변동됩니다.</div>
                      <div style={{ marginTop: '2px' }}>• 전기차의 대차는 내연기관 차량으로 제공됩니다.</div>
                      <div style={{ marginTop: '2px' }}>• 전기차 일반형/임반형 정비상품은 순회정비시, 소모품은 에어컨 필터, 와이퍼, 워셔액 교제만 가능하며, 그외 서비스(소독, 차량 생활물질, 스캐너 진단)는 희망시 제공됩니다.</div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 8. Required Documents */}
            <div style={{ border: '1px solid #000', padding: '4px 8px', fontSize: '0.68rem', marginBottom: '0.8rem', display: 'flex', gap: '0.4rem', lineHeight: '1.25' }}>
              <div style={{ fontWeight: '800', whiteSpace: 'nowrap' }}>계약시 필요서류</div>
              <div style={{ color: '#333' }}>
                <strong>• 법인:</strong> 법인등기부등본(원본), 법인인감증명서(원본), 사업자등록증(사본), 사용인감사용시 사용인감계, 대리인 날인시 위임장, CMS통장사본
              </div>
            </div>

            {/* 9. Signatures (Footer) */}
            <div style={{ textAlign: 'center', marginTop: '0.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: '1.2rem' }}>
                <span style={{ fontSize: '1.1rem', fontWeight: '800', letterSpacing: '2px', color: '#111e38' }}>주식회사 렌트베네핏</span>
                <span style={{ fontSize: '1.0rem', fontWeight: '800', color: '#111e38' }}>대표이사 신 동 일</span>
              </div>
              <div style={{ fontSize: '0.70rem', fontWeight: '800', letterSpacing: '3px', color: '#ad885c', marginTop: '0.2rem' }}>
                TOTAL CAR PREMIUM SOLUTION
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default QuoteInputView;
