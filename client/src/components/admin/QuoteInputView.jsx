import React, { useState, useEffect } from 'react';
import { Sparkles, Save, ArrowRight, UserPlus, Users, Car, Coins, Settings, HelpCircle, CheckCircle, Plus, Trash2, FolderOpen, X, Search, List, Edit, ChevronLeft, ChevronRight } from 'lucide-react';
import html2pdf from 'html2pdf.js';
import { jsPDF } from 'jspdf';
import { formatCustomerName } from '../../utils/format.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

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

// 견적 번호의 마지막 구간에 쓰는 영업이익 코드. 영업이익(원)을 만원 단위로 반올림해서
// 음수면 "-500"처럼 부호를 그대로, 양수면 "030"처럼 3자리로 0채움한다.
const formatProfitCode = (profitWon) => {
  const manwon = Math.round((profitWon || 0) / 10000);
  const sign = manwon < 0 ? '-' : '';
  return `${sign}${String(Math.abs(manwon)).padStart(3, '0')}`;
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

// 렌트/리스 구분 표시색. 두 문서(비교표, 장기렌터카 견적서)가 같은 색을 쓰도록 한 곳에서 관리한다.
// 인쇄와 PDF에서도 구분돼야 하므로 회색 농도 차이가 아닌 색상 자체를 다르게 둔다.
const CONTRACT_TYPES = ['렌트', '리스'];
const CONTRACT_TYPE_COLORS = {
  렌트: { solid: '#1d4ed8', onDark: '#93c5fd', tint: 'rgba(29, 78, 216, 0.10)' },
  리스: { solid: '#047857', onDark: '#6ee7b7', tint: 'rgba(4, 120, 87, 0.10)' }
};
const getContractTypeColors = (type) => CONTRACT_TYPE_COLORS[type] || CONTRACT_TYPE_COLORS['렌트'];

/**
 * 리스 차량의 연간 자동차세(지방교육세 포함)를 계산한다.
 *
 * 리스는 자가용(비영업용) 번호판이라 일반 승용차 요율을 쓴다.
 * 렌터카는 영업용이라 요율이 다르고, 월대여료에 세금이 이미 포함되므로 이 함수를 쓰지 않는다.
 *
 *   비영업용 승용 자동차세 연세액 = 배기량 × 요율
 *     1,000cc 이하 80원 / 1,600cc 이하 140원 / 1,600cc 초과 200원
 *   전기·수소차는 배기량이 없어 정액 100,000원
 *   여기에 지방교육세 30%를 더한 금액이 실제 고지 금액이다.
 *
 * 차령에 따른 경감(3년차부터 매년 5%, 최대 50%)은 신차 기준 견적이라 적용하지 않는다.
 */
const ELECTRIC_FUEL_TYPES = ['전기', '수소'];

const calculateLeaseCarTax = (vehicle) => {
  const fuelType = vehicle?.fuelType || '';
  const isElectric = ELECTRIC_FUEL_TYPES.some((t) => fuelType.includes(t));

  let baseTax;
  if (isElectric) {
    baseTax = 100000;
  } else {
    const cc = Number(vehicle?.cc) || 0;
    if (cc <= 0) return null; // 배기량을 모르면 추측하지 않고 '-'로 둔다
    const ratePerCc = cc <= 1000 ? 80 : cc <= 1600 ? 140 : 200;
    baseTax = cc * ratePerCc;
  }

  const educationTax = baseTax * 0.3;
  return Math.floor((baseTax + educationTax) / 10) * 10; // 10원 미만 절사
};

function QuoteInputView({ setActiveTab, setPrefilledQuoteData, showToast, currentUser }) {
  const [customers, setCustomers] = useState([]);
  const [useExistingCustomer, setUseExistingCustomer] = useState(true);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [partyType, setPartyType] = useState('개인'); // '개인' | '법인' - selectedCustomer.companies로 결정
  const [selectedCompanyId, setSelectedCompanyId] = useState(''); // partyType이 '법인'일 때 어느 법인인지
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerSearchResults, setCustomerSearchResults] = useState([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [customerQuotes, setCustomerQuotes] = useState([]); // 선택된 고객의 지난 견적 목록
  const [loadingCustomerQuotes, setLoadingCustomerQuotes] = useState(false);
  const [showQuoteHistory, setShowQuoteHistory] = useState(false);

  // 견적비교에서 "최종선택"으로 표시만 해둔 옵션 (저장/전환은 "계약서 등록 전환" 버튼을 눌러야 실행됨)
  const [finalSelection, setFinalSelection] = useState(null); // { vehicleId, optionId } | null

  // 견적서 작성 / 견적서 목록(하위 화면) 전환 - 계약/견적 목록 페이지가 없어지면서 이 화면 안으로 들어옴
  const [viewMode, setViewMode] = useState('form'); // 'form' | 'list'
  const [quotesListData, setQuotesListData] = useState([]);
  const [quotesListLoading, setQuotesListLoading] = useState(false);
  const [quotesListSearch, setQuotesListSearch] = useState('');
  const [selectedQuoteListIds, setSelectedQuoteListIds] = useState(new Set());

  // 견적서 화면 상단 "불러오기" - 고객 선택 여부와 무관하게 전체 견적서를 검색해서 불러온다
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [loadModalQuotes, setLoadModalQuotes] = useState([]);
  const [loadModalLoading, setLoadModalLoading] = useState(false);
  const [loadModalSearch, setLoadModalSearch] = useState('');

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

  // 장기렌터카 견적서 왼쪽 하단 '비고' 칸에 직접 입력하는 내용 (문서 단위)
  const [rentalRemark, setRentalRemark] = useState('');

  // 비교 견적서 '특이사항' 입력 방식.
  // false = 안별로 따로 입력, true = 안 구분 없이 하나로 입력하고 표에서는 칸을 가로로 병합해 표시
  const [isSpecialNoteMerged, setIsSpecialNoteMerged] = useState(false);
  const [mergedSpecialNote, setMergedSpecialNote] = useState('');

  // Helper to create a new vehicle structure
  const createNewVehicle = (id) => ({
    id,
    quoteId: null, // 이 "안"으로 이미 저장된 견적서가 있으면 그 _id. 있으면 다시 저장할 때 새로 만들지 않고 그 견적서를 수정한다
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
    dealerCommissionRateP: 0.00, // 타딜러수수료는 붙는 건이 예외적이라 0%에서 시작한다

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
        mileage: 20000,
        residualRate: 0.55,
        depositRate: 0.30,
        advancePaymentRate: 0.00,
        dealerIncentiveRate: 0.00,
        tireUnitCost: 160000,
        tireType: 'standard',
        discountRate: 0.00,
        contractType: '렌트', // 렌트 | 리스. 리스는 타사 견적 값을 그대로 옮겨 적는 용도라 계산에 관여하지 않는다
        specialNote: '', // 비교표 '특이사항' 행에 안별로 입력하는 내용
        insuranceFeeAnnual: 800000,
        insuranceType: 'standard',
        registrationAgencyFee: 100000,
        calcMode: 'manual',
        monthlyFeeInput: id === 1 ? 996000 : 0,
        targetProfitInput: 0
      },
      // 2안은 1안과 같은 조건에서 출발한다. 보통 조건 하나만 바꿔 비교하기 때문에
      // 서로 다른 값으로 시작하면 매번 1안에 맞추는 작업부터 해야 한다.
      {
        id: 2,
        name: '2안',
        companyName: '',
        termYears: 4,
        mileage: 20000,
        residualRate: 0.55,
        depositRate: 0.30,
        advancePaymentRate: 0.00,
        dealerIncentiveRate: 0.00,
        tireUnitCost: 160000,
        tireType: 'standard',
        discountRate: 0.00,
        contractType: '렌트', // 렌트 | 리스. 리스는 타사 견적 값을 그대로 옮겨 적는 용도라 계산에 관여하지 않는다
        specialNote: '', // 비교표 '특이사항' 행에 안별로 입력하는 내용
        insuranceFeeAnnual: 800000,
        insuranceType: 'standard',
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
  const [printFormType, setPrintFormType] = useState('rental'); // 'comparison' or 'rental'
  const [savingToStore, setSavingToStore] = useState(false);
  const [isMaintenanceDetailModalOpen, setIsMaintenanceDetailModalOpen] = useState(false);
  const [subView, setSubView] = useState('quote'); // 'quote' or 'maintenance'
  const [tempMaintenanceItems, setTempMaintenanceItems] = useState([]);
  const [tempMonthlyMaintenanceFee, setTempMonthlyMaintenanceFee] = useState(0);

  const activeVehicle = vehicles.find(v => v.id === selectedVehicleId) || vehicles[0];

  const updateActiveVehicle = (fields) => {
    setVehicles(prev => prev.map(v => {
      if (v.id !== selectedVehicleId) return v;
      
      const nextVehicle = { ...v, ...fields };
      const totalCarPrice = nextVehicle.carPrice + nextVehicle.carOptionPrice;
      const autoType = totalCarPrice >= 70000000 ? 'premium' : 'standard';
      
      const previousTotal = v.carPrice + v.carOptionPrice;
      const thresholdCrossed = (previousTotal >= 70000000) !== (totalCarPrice >= 70000000);
      
      if (thresholdCrossed) {
        nextVehicle.options = nextVehicle.options.map(opt => ({
          ...opt,
          insuranceType: autoType
        }));
      }
      
      return nextVehicle;
    }));
  };

  // 비교표는 여러 차량의 안을 한 화면에 함께 보여주므로, 활성 차량이 아닌 안도 수정할 수 있어야 한다
  const updateVehicleOption = (vehicleId, optionId, fields) => {
    setVehicles(prev => prev.map(v => {
      if (v.id !== vehicleId) return v;
      const updatedOptions = v.options.map(opt => opt.id === optionId ? { ...opt, ...fields } : opt);
      return { ...v, options: updatedOptions };
    }));
  };

  const updateActiveVehicleOption = (optionId, fields) => {
    updateVehicleOption(selectedVehicleId, optionId, fields);
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

  /**
   * 비교 차량의 순서를 한 칸씩 옮긴다.
   * vehicles 배열 순서가 곧 "차량 1/2/3" 번호, 비교표 열 순서, 차량별 색상까지 결정하므로
   * 배열 자체를 재정렬하면 화면과 문서가 함께 따라온다.
   */
  const handleMoveVehicle = (vehicleId, direction, e) => {
    e.stopPropagation(); // 순서만 바꾸고 탭 선택은 건드리지 않는다
    setVehicles(prev => {
      const from = prev.findIndex(v => v.id === vehicleId);
      const to = from + direction;
      if (from === -1 || to < 0 || to >= prev.length) return prev;

      const next = [...prev];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
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
    const totalCarPrice = activeVehicle.carPrice + activeVehicle.carOptionPrice;

    // 새 안은 1안을 그대로 복사해서 시작한다. 대부분 조건 하나만 바꿔 비교하기 때문에
    // 빈 값에서 시작하면 같은 값을 매번 다시 입력해야 한다. 복사 후 자유롭게 수정 가능하다.
    const baseOpt = activeVehicle.options[0];
    const newOpt = baseOpt
      ? {
          ...baseOpt,
          id: nextId,
          name: `${nextId}안`,
          // 특이사항은 안마다 다른 내용이라 복사하지 않는다
          specialNote: ''
        }
      : {
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
          contractType: '렌트',
          specialNote: '',
          insuranceFeeAnnual: 800000,
          insuranceType: totalCarPrice >= 70000000 ? 'premium' : 'standard',
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

  // 고객이 선택되면 그 고객의 지난 견적 목록을 불러온다 ("불러오기" 드롭다운용)
  useEffect(() => {
    if (!useExistingCustomer || !selectedCustomerId) {
      setCustomerQuotes([]);
      setShowQuoteHistory(false);
      return;
    }
    setLoadingCustomerQuotes(true);
    fetch(`${API_HOST}/api/quotes?customerId=${selectedCustomerId}`)
      .then(res => res.json())
      .then(data => setCustomerQuotes(Array.isArray(data) ? data : []))
      .catch(err => console.error('Failed to fetch customer quotes', err))
      .finally(() => setLoadingCustomerQuotes(false));
  }, [selectedCustomerId, useExistingCustomer]);

  // "불러오기" 모달이 열려 있는 동안 검색어에 맞는 견적서 목록을 가져온다
  useEffect(() => {
    if (!showLoadModal) return;
    setLoadModalLoading(true);
    const delayDebounceFn = setTimeout(() => {
      const url = loadModalSearch.trim()
        ? `${API_HOST}/api/quotes?search=${encodeURIComponent(loadModalSearch.trim())}`
        : `${API_HOST}/api/quotes`;
      fetch(url)
        .then(res => res.json())
        .then(data => setLoadModalQuotes(Array.isArray(data) ? data : []))
        .catch(err => console.error('Failed to fetch quotes', err))
        .finally(() => setLoadModalLoading(false));
    }, 250);
    return () => clearTimeout(delayDebounceFn);
  }, [showLoadModal, loadModalSearch]);

  // 고객이 바뀌면 그 고객의 소속 법인 수에 따라 개인/법인 건을 자동 판정한다.
  // 0곳: 개인, 1곳: 자동 선택, 2곳 이상: 주 소속을 기본값으로 (사용자가 드롭다운에서 바꿀 수 있음)
  useEffect(() => {
    const companies = (selectedCustomer?.companies || []).filter(a => a.companyId);
    if (!useExistingCustomer || companies.length === 0) {
      setPartyType('개인');
      setSelectedCompanyId('');
      return;
    }
    setPartyType('법인');
    if (companies.length === 1) {
      setSelectedCompanyId(companies[0].companyId._id);
    } else {
      const primary = companies.find(a => a.isPrimary);
      setSelectedCompanyId((primary || companies[0]).companyId._id);
    }
  }, [selectedCustomer, useExistingCustomer]);

  /** 문서 단위 값(비고, 통합 특이사항)은 어느 복원 경로로 들어와도 똑같이 되살린다 */
  const restoreDocumentLevelFields = (quote) => {
    setRentalRemark(quote.rentalRemark || '');
    setIsSpecialNoteMerged(!!quote.specialNoteMerged);
    setMergedSpecialNote(quote.mergedSpecialNote || '');
  };

  // 지난 견적을 선택하면 그 내용 그대로 하단 입력 필드에 불러온다
  const handleLoadQuote = (quote) => {
    // 비교 차량 스냅샷이 있으면 화면 상태를 통째로 되살린다.
    // 이 필드가 생기기 전에 저장된 견적서에는 없으므로, 그때는 아래의 대표 차량 1대 복원으로 넘어간다.
    if (Array.isArray(quote.comparisonVehicles) && quote.comparisonVehicles.length > 0) {
      const restored = quote.comparisonVehicles.map((veh) => ({
        ...veh,
        // 저장할 때 빼둔 값. 이후 저장이 새 견적서를 만들지 않고 이 견적서를 수정하도록 다시 채운다
        quoteId: quote._id
      }));

      setVehicles(restored);
      const stillExists = restored.some((v) => v.id === quote.activeVehicleId);
      setSelectedVehicleId(stillExists ? quote.activeVehicleId : restored[0].id);
      restoreDocumentLevelFields(quote);

      showToast(
        `지난 견적 정보를 불러왔습니다. (비교 차량 ${restored.length}대)`,
        'success'
      );
      return;
    }

    // Reconstruct specs from quote.vehicleSpec
    let parsedSpec = {
      carOptionsName: '-',
      fuelType: '가솔린',
      cc: 2500,
      deliveryPeriod: '-',
      exteriorColor: '-',
      interiorColor: '-'
    };
    if (quote.vehicleSpec) {
      const parts = quote.vehicleSpec.split(' / ');
      if (parts.length > 0) parsedSpec.carOptionsName = parts[0];
      parts.forEach(part => {
        if (part.startsWith('연료: ')) {
          parsedSpec.fuelType = part.replace('연료: ', '');
        } else if (part.startsWith('배기량: ')) {
          const ccStr = part.replace('배기량: ', '').replace('cc', '');
          parsedSpec.cc = Number(ccStr) || 2500;
        } else if (part.startsWith('납기: ')) {
          parsedSpec.deliveryPeriod = part.replace('납기: ', '');
        } else if (part.startsWith('외장: ')) {
          parsedSpec.exteriorColor = part.replace('외장: ', '');
        } else if (part.startsWith('내장: ')) {
          parsedSpec.interiorColor = part.replace('내장: ', '');
        }
      });
    }

    const totalCarPrice = quote.totalPrice || 0;
    const basePrice = quote.pricing?.basePrice || totalCarPrice;
    const carOptionPrice = Math.max(0, totalCarPrice - basePrice);

    const restoredOptions = (quote.monthlyEstimates && quote.monthlyEstimates.length > 0)
      ? quote.monthlyEstimates.map((est, index) => {
          const id = index + 1;
          const isPrimary = est.termMonths === quote.pricing?.paymentTerm;
          
          const depositRate = (isPrimary && totalCarPrice > 0 && quote.pricing?.deposit !== undefined)
            ? (quote.pricing.deposit / totalCarPrice)
            : (id === 1 ? 0.30 : 0.00);
          const advancePaymentRate = (isPrimary && totalCarPrice > 0 && quote.pricing?.advancePayment !== undefined)
            ? (quote.pricing.advancePayment / totalCarPrice)
            : 0.00;
          const residualRate = (isPrimary && totalCarPrice > 0 && quote.pricing?.takeoverPrice !== undefined)
            ? (quote.pricing.takeoverPrice / totalCarPrice)
            : 0.55;

          return {
            id,
            name: est.name || `${id}안`,
            companyName: est.companyName || '',
            termYears: (est.termMonths || 48) / 12,
            mileage: 20000,
            residualRate,
            depositRate,
            advancePaymentRate,
            dealerIncentiveRate: 0.00,
            tireUnitCost: id === 1 ? 160000 : 240000,
            discountRate: 0.00,
            // 저장된 견적서를 다시 열 때 안별 입력값을 그대로 되살린다.
            // 이 필드들이 추가되기 전에 저장된 견적서에는 값이 없으므로 기본값으로 떨어진다.
            contractType: est.contractType || '렌트',
            specialNote: est.specialNote || '',
            isMaintenanceEnabled: est.maintenanceEnabled !== false,
            insuranceFeeAnnual: 800000,
            insuranceType: totalCarPrice >= 70000000 ? 'premium' : 'standard',
            registrationAgencyFee: quote.pricing?.registrationAgencyFee || 100000,
            calcMode: 'manual',
            monthlyFeeInput: est.monthlyFee || 0,
            targetProfitInput: 0
          };
        })
      : [
          {
            id: 1,
            name: '1안',
            companyName: '',
            termYears: 4,
            mileage: 20000,
            residualRate: 0.55,
            depositRate: 0.30,
            advancePaymentRate: 0.00,
            dealerIncentiveRate: 0.00,
            tireUnitCost: 160000,
            tireType: 'standard',
            discountRate: 0.00,
            contractType: '렌트', // 렌트 | 리스. 리스는 타사 견적 값을 그대로 옮겨 적는 용도라 계산에 관여하지 않는다
            specialNote: '', // 비교표 '특이사항' 행에 안별로 입력하는 내용
            insuranceFeeAnnual: 800000,
            insuranceType: 'standard',
            registrationAgencyFee: 100000,
            calcMode: 'manual',
            monthlyFeeInput: quote.pricing?.monthlyFee || 0,
            targetProfitInput: 0
          }
        ];

    // Find the primary selected option id
    const selectedOptionIds = quote.pricing?.paymentTerm 
      ? [restoredOptions.find(o => o.termYears * 12 === quote.pricing.paymentTerm)?.id || 1]
      : [1];

    setVehicles(prev => prev.map(v => {
      if (v.id !== selectedVehicleId) return v;
      return {
        ...v,
        // 이 견적서를 불러왔으니, 이후 저장은 새로 만들지 않고 이 견적서를 그대로 수정한다
        quoteId: quote._id,
        carModel: quote.vehicleModel,
        carOptionsName: parsedSpec.carOptionsName,
        carPrice: basePrice,
        carOptionPrice: carOptionPrice,
        discountPrice: quote.pricing?.discount || 0,
        fuelType: parsedSpec.fuelType,
        cc: parsedSpec.cc,
        deliveryPeriod: parsedSpec.deliveryPeriod,
        exteriorColor: parsedSpec.exteriorColor,
        interiorColor: parsedSpec.interiorColor,
        consignmentFee: quote.pricing?.deliveryFee || 360000,
        globalRegistrationAgencyFee: quote.pricing?.registrationAgencyFee || 100000,
        options: restoredOptions,
        selectedOptionIds: selectedOptionIds
      };
    }));

    // 비고와 통합 특이사항은 문서 단위 값이라 차량/옵션과 별도로 복원한다
    restoreDocumentLevelFields(quote);

    showToast('지난 견적 정보를 하단 필드에 성공적으로 불러왔습니다.', 'success');
  };

  // "불러오기" 모달에서 견적을 고르면 그 견적의 고객 정보까지 함께 복원한 뒤 차량/옵션 정보를 불러온다
  const handleSelectQuoteFromModal = (quote) => {
    if (quote.customer && quote.customer._id) {
      setUseExistingCustomer(true);
      setSelectedCustomerId(quote.customer._id);
      setSelectedCustomer(quote.customer);
      setCustomerSearchQuery((quote.customer.surname || quote.customer.name || '').trim());
      // 목록 응답의 customer는 companies가 populate 안 되어 있으므로 상세 조회로 보강한다.
      fetch(`${API_HOST}/api/customers/${quote.customer._id}`)
        .then(res => res.ok ? res.json() : null)
        .then(full => { if (full) setSelectedCustomer(full); })
        .catch(() => {});
    }
    handleLoadQuote(quote);
    setShowLoadModal(false);
  };

  // "견적서 목록" 하위 화면 - 계약/견적 목록 페이지가 없어지면서 이 화면 안으로 들어옴
  const fetchQuotesList = async () => {
    setQuotesListLoading(true);
    try {
      const res = await fetch(`${API_HOST}/api/quotes`);
      if (res.ok) {
        const data = await res.json();
        setQuotesListData(Array.isArray(data) ? data : (data.quotes || data.data || []));
      }
    } catch (err) {
      console.error('Failed to load quotes list', err);
    } finally {
      setQuotesListLoading(false);
    }
  };

  const handleLoadQuoteFromList = (quote) => {
    handleSelectQuoteFromModal(quote);
    setViewMode('form');
  };

  const handleConvertQuoteToContract = (quote) => {
    setPrefilledQuoteData(quote);
    setActiveTab('contract-register');
  };

  const handleDeleteQuoteFromList = async (id) => {
    if (currentUser?.role === 'viewer') {
      showToast('수정 및 삭제 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (!window.confirm('정말 이 견적서를 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(`${API_HOST}/api/quotes/${id}`, {
        method: 'DELETE',
        headers: { 'X-User-Role': currentUser?.role || 'viewer' }
      });
      if (res.ok) {
        showToast('견적서가 삭제되었습니다.', 'success');
        setQuotesListData(prev => prev.filter(q => q._id !== id));
        setSelectedQuoteListIds(prev => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } else {
        showToast('견적서 삭제 실패', 'error');
      }
    } catch (err) {
      showToast('서버 연결 오류', 'error');
    }
  };

  const toggleQuoteListSelection = (id) => {
    setSelectedQuoteListIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllQuoteList = (ids) => {
    setSelectedQuoteListIds(prev => (prev.size === ids.length ? new Set() : new Set(ids)));
  };

  const handleBulkDeleteQuoteList = async () => {
    if (currentUser?.role === 'viewer') {
      showToast('수정 및 삭제 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (selectedQuoteListIds.size === 0) return;
    if (!window.confirm(`선택한 견적서 ${selectedQuoteListIds.size}건을 삭제하시겠습니까?`)) return;
    try {
      const ids = Array.from(selectedQuoteListIds);
      const results = await Promise.all(ids.map(id =>
        fetch(`${API_HOST}/api/quotes/${id}`, {
          method: 'DELETE',
          headers: { 'X-User-Role': currentUser?.role || 'viewer' }
        })
      ));
      const failCount = results.filter(r => !r.ok).length;
      if (failCount > 0) {
        showToast(`${ids.length - failCount}건 삭제 완료, ${failCount}건 실패`, 'error');
      } else {
        showToast(`견적서 ${ids.length}건이 삭제되었습니다.`, 'success');
      }
      setQuotesListData(prev => prev.filter(q => !selectedQuoteListIds.has(q._id)));
      setSelectedQuoteListIds(new Set());
    } catch (err) {
      showToast('서버 연결 오류', 'error');
    }
  };

  const filteredQuotesListData = quotesListData.filter(q => {
    if (!quotesListSearch.trim()) return true;
    const val = quotesListSearch.toLowerCase();
    return (
      (q.customer?.name || '').toLowerCase().includes(val) ||
      (q.customer?.surname || '').toLowerCase().includes(val) ||
      (q.customer?.givenName || '').toLowerCase().includes(val) ||
      (q.vehicleModel || '').toLowerCase().includes(val)
    );
  });

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

  // 저장 가능한 최소 조건(고객 정보 + 차종)만 조용히 체크 - 인쇄/문서함저장 시 자동 저장용 (토스트 없이 스킵 가능)
  const isFormValidForSave = () => {
    if (useExistingCustomer && !selectedCustomerId) return false;
    if (!useExistingCustomer && (!newCustomer.name.trim() || !newCustomer.bizNo.trim())) return false;
    if (!activeVehicle.carModel || !activeVehicle.carModel.trim()) return false;
    return true;
  };

  // 현재 견적 내용을 DB에 저장한다. silent=true면 검증 실패/에러를 조용히 무시한다(인쇄·문서함저장 시 백그라운드 자동저장용).
  const saveQuoteRecord = async ({ silent = false, overrideOpt = null } = {}) => {
    if (silent ? !isFormValidForSave() : !validateForm()) return null;

    // Get the currently selected option values (use first selected option as primary),
    // unless the caller explicitly picked one (e.g. "최종선택" on a specific comparison card)
    const selectedOptionIds = activeVehicle.selectedOptionIds || (activeVehicle.selectedOptionId ? [activeVehicle.selectedOptionId] : [1]);
    const primarySelectedId = selectedOptionIds[0] || 1;
    const selectedOpt = overrideOpt || activeVehicle.options.find(o => o.id === primarySelectedId) || activeVehicle.options[0];
    const calculated = calculateOptionValues(selectedOpt, activeVehicle);

    // 나중에 "불러오기"로 계약서 등록에 바로 연결할 수 있도록 가격 상세를 항상 함께 저장한다
    const pricing = {
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
      registrationAgencyFee: activeVehicle.globalRegistrationAgencyFee,
      baseInterestRate: activeVehicle.baseInterestRate,
      dealerCommission: calculated.dealerCommission
    };

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
        partyType: useExistingCustomer ? partyType : '개인',
        companyId: (useExistingCustomer && partyType === '법인') ? selectedCompanyId : undefined,
        // 스냅샷: 저장 시점의 고객명/법인명/사업자번호를 문서에 그대로 고정
        customerName: useExistingCustomer
          ? (selectedCustomer?.surname || selectedCustomer?.name || '').trim()
          : (newCustomer.name || '').trim(),
        companyName: selectedCompanyInfo?.name,
        companyBizNo: selectedCompanyInfo?.bizNo,
        vehicleModel: activeVehicle.carModel,
        vehicleSpec: `${activeVehicle.carOptionsName} / 연료: ${activeVehicle.fuelType} / 배기량: ${activeVehicle.cc}cc / 납기: ${activeVehicle.deliveryPeriod} / 외장: ${activeVehicle.exteriorColor} / 내장: ${activeVehicle.interiorColor}`,
        // 계약서 등록 시 차량 정보 항목을 파싱 없이 그대로 채울 수 있도록 구조화된 값도 함께 저장
        vehicleDetail: {
          fuelType: activeVehicle.fuelType,
          cc: activeVehicle.cc,
          deliveryPeriod: activeVehicle.deliveryPeriod,
          exteriorColor: activeVehicle.exteriorColor,
          interiorColor: activeVehicle.interiorColor
        },
        totalPrice: calculated.totalCarPrice,
        // Convert options to estimates terms list
        monthlyEstimates: activeVehicle.options.map(opt => {
          const optCalc = calculateOptionValues(opt, activeVehicle);
          return {
            termMonths: opt.termYears * 12,
            monthlyFee: optCalc.monthlyLeaseFee,
            name: opt.name,
            companyName: opt.companyName,
            contractType: opt.contractType || '렌트',
            specialNote: opt.specialNote || '',
            maintenanceEnabled: opt.isMaintenanceEnabled !== false
          };
        }),
        rentalRemark,
        specialNoteMerged: isSpecialNoteMerged,
        mergedSpecialNote,
        // 비교하던 차량 전체를 그대로 저장한다. 위의 vehicleModel/pricing은 대표 차량 1대 정보라
        // 이것이 없으면 3대를 비교한 견적을 다시 열었을 때 나머지 2대가 사라진다.
        // quoteId는 이 견적서 자체를 가리키는 값이라 스냅샷에서는 빼둔다.
        comparisonVehicles: vehicles.map(({ quoteId: _quoteId, ...veh }) => veh),
        activeVehicleId: selectedVehicleId,
        pricing,
        // 계약서 등록 시 보험/정비 항목을 그대로 채울 수 있도록 선택된 옵션의 값을 함께 저장
        insurance: {
          type: selectedOpt.insuranceType === 'premium' ? 'premium' : 'standard',
          deductible: selectedOpt.insuranceType === 'premium' ? 500000 : 300000,
          annualFee: activeVehicle.globalInsuranceFee
        },
        maintenance: {
          enabled: selectedOpt.isMaintenanceEnabled !== false,
          tireType: selectedOpt.tireType,
          mileage: selectedOpt.mileage
        },
        createdBy
      };

      // 이 "안"으로 이미 저장된 견적서가 있으면(불러오기로 열었거나 이전에 저장한 적이 있으면)
      // 새로 만들지 않고 그 견적서를 그대로 수정한다. 저장을 여러 번 눌러도 견적서가 중복 생성되지 않는다.
      const existingQuoteId = activeVehicle.quoteId;
      const response = await fetch(
        existingQuoteId ? `${API_HOST}/api/quotes/${existingQuoteId}` : `${API_HOST}/api/quotes`,
        {
          method: existingQuoteId ? 'PUT' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Role': currentUser?.role || 'viewer'
          },
          body: JSON.stringify(payload)
        }
      );

      if (response.ok) {
        const savedQuote = await response.json();
        if (!existingQuoteId) {
          // 비교 차량 전체가 이 견적서 하나에 저장되므로 모든 차량에 같은 id를 달아 둔다.
          // 활성 차량에만 달면 다른 차량 탭에서 저장할 때 견적서가 새로 만들어진다.
          setVehicles(prev => prev.map(v => ({ ...v, quoteId: savedQuote._id })));
        }
        if (!silent) showToast(existingQuoteId ? '견적서가 수정되었습니다.' : '견적서가 저장되었습니다.', 'success');
        return { savedQuote, calculated, selectedOpt, pricing };
      }
      if (!silent) {
        const err = await response.json();
        showToast(err.message || '견적서 저장에 실패했습니다.', 'error');
      }
      return null;
    } catch (err) {
      console.error(err);
      if (!silent) showToast('서버 통신 오류', 'error');
      return null;
    }
  };

  const handleSaveQuote = async (convertToContractAfterSave = false) => {
    if (currentUser?.role === 'viewer') {
      showToast('수정 및 등록 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }

    // 견적비교에서 "최종선택"으로 표시해둔 옵션이 있으면 그 옵션 그대로 저장/전환한다
    const overrideOpt = (finalSelection && finalSelection.vehicleId === activeVehicle.id)
      ? (activeVehicle.options || []).find(o => o.id === finalSelection.optionId) || null
      : null;

    const result = await saveQuoteRecord({ silent: false, overrideOpt });
    if (!result) return;
    const { savedQuote, calculated, selectedOpt, pricing } = result;

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
        pricing
      };
      setFinalSelection(null);
      setPrefilledQuoteData(prefilledData);
      setActiveTab('contract-register');
    } else {
      // Trigger print preview of the comparison sheet first, then go to the quote list
      setTimeout(() => {
        window.print();
        fetchQuotesList();
        setViewMode('list');
      }, 800);
    }
  };

  // 견적비교에서 "최종선택"을 누르면 저장/전환 없이 그 옵션에 표시만 해둔다.
  // 실제 저장 및 계약서 등록 화면으로의 전환은 "계약서 등록 전환" 버튼을 눌러야 실행된다.
  const handleFinalSelection = (opt, vehicle) => {
    setFinalSelection({ vehicleId: vehicle.id, optionId: opt.id });
    showToast(`"${opt.name || '해당 옵션'}"이(가) 최종 선택되었습니다. 하단의 '계약서 등록 전환' 버튼을 눌러 계약서 등록으로 진행해주세요.`, 'success');
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

  const selectedCompanyInfo = (partyType === '법인' && selectedCustomer && selectedCompanyId)
    ? (selectedCustomer.companies || []).find(a => a.companyId?._id === selectedCompanyId)?.companyId
    : null;

  const rawCustomerName = selectedCustomer
    ? (selectedCustomer.surname || selectedCustomer.name || '').trim()
    : (newCustomer.name || '고객');

  // 법인 건은 "법인명 / 대표자 이름", 개인 건은 이름만 표기.
  // 대표자 이름은 법인의 ceoName(사업자등록증 기준 대표자명)을 쓰고, 없으면 담당자 이름으로 대신한다.
  const displayCustomerName = selectedCompanyInfo
    ? `${selectedCompanyInfo.name} / ${selectedCompanyInfo.ceoName || rawCustomerName}`
    : rawCustomerName;

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

  // 1안~4안은 세로(A4 portrait), 5안 이상은 가로(A4 landscape)로 1페이지에 맞춰 인쇄
  const isComparisonLandscape = printFormType === 'comparison' && displaySelectedOptions.length >= 5;

  // 현재 화면의 견적서를 PDF로 만들어 로컬 원드라이브 폴더에 직접 저장
  const handleSaveToDocumentStore = async () => {
    const element = document.getElementById('print-comparison-area');
    if (!element) return;

    saveQuoteRecord({ silent: true }); // 나중에 "불러오기" 할 수 있도록 백그라운드로 저장
    setSavingToStore(true);
    // PDF 캡처용 스타일 클래스 임시 추가
    element.classList.add('html2pdf-active');
    if (isComparisonLandscape) {
      element.classList.add('is-landscape');
    }

    try {
      const docTypeLabel = printFormType === 'comparison' ? '비교견적서' : '견적서';
      // 파일명에는 쓸 수 없는 문자(/)가 들어갈 수 있어 화면 표기와 별도로 치환해서 사용한다
      const customerLabel = (displayCustomerName || '미지정고객').trim().replace(/[\\/:*?"<>|]/g, '_');
      const fileName = `${docTypeLabel}_${customerLabel}_${todayDateStr}.pdf`;

      const orientation = isComparisonLandscape ? 'landscape' : 'portrait';

      // 화면을 이미지로 캡처만 하고, PDF 조립은 직접 한다.
      // html2pdf에 그대로 맡기면 내용이 A4보다 길 때 자동으로 2페이지로 잘라버린다.
      const canvas = await html2pdf()
        .set({
          image: { type: 'png' }, // 무손실 PNG (JPEG 압축으로 인한 표 선 뭉개짐 방지)
          html2canvas: {
            scale: 2, // 해상도 배율
            useCORS: true,
            // 주의: foreignObjectRendering:true는 표 선 두께 버그는 고치지만 복잡한 레이아웃에서
            // 캡처 자체가 빈 페이지로 나오는 경우가 있어 사용하지 않음 (기본(canvas) 렌더링 방식 유지)
            // 화면에만 보이는 탭 전환 버튼 등(.no-print)은 캡처에서 제외
            ignoreElements: (el) => el.classList && el.classList.contains('no-print')
          }
        })
        .from(element)
        .toCanvas()
        .get('canvas');

      // 캡처 이미지를 A4 한 장 안에 비율 그대로 축소해 넣는다. 항상 1페이지가 된다.
      const pageSize = orientation === 'landscape' ? { w: 297, h: 210 } : { w: 210, h: 297 };
      const margin = 5; // mm
      const availableWidth = pageSize.w - margin * 2;
      const availableHeight = pageSize.h - margin * 2;

      const fitScale = Math.min(availableWidth / canvas.width, availableHeight / canvas.height);
      const imgWidth = canvas.width * fitScale;
      const imgHeight = canvas.height * fitScale;

      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation });
      pdf.addImage(
        canvas.toDataURL('image/png'),
        'PNG',
        (pageSize.w - imgWidth) / 2, // 가로 가운데 정렬
        margin,
        imgWidth,
        imgHeight
      );
      const pdfBlob = pdf.output('blob');

      const formData = new FormData();
      formData.append('file', pdfBlob, fileName);
      formData.append('businessLine', 'rental');
      formData.append('customerName', customerLabel);
      formData.append('docType', docTypeLabel);
      formData.append('fileName', fileName);

      const res = await fetch(`${API_HOST}/api/documents/save-local`, {
        method: 'POST',
        headers: { 'X-User-Role': currentUser?.role || 'viewer' },
        body: formData
      });
      const data = await res.json();

      if (data.success) {
        const displayPath = `CEO\\RENT\\${customerLabel}`;
        showToast(`[${displayPath}\\${data.fileName}] 문서함(원드라이브)에 성공적으로 저장되었습니다.`, 'success');
      } else {
        showToast(data.message || '문서함 저장에 실패했습니다.', 'error');
      }
    } catch (err) {
      console.error('Save to document store error:', err);
      showToast('PDF 생성 또는 로컬 저장 중 오류가 발생했습니다.', 'error');
    } finally {
      // PDF 캡처 완료 후 원래 스타일 복구
      element.classList.remove('html2pdf-active');
      element.classList.remove('is-landscape');
      setSavingToStore(false);
    }
  };

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
      // 열마다 오른쪽 여백이 2.5rem(40px)이던 것을 줄였다. 안이 6개면 그것만으로 240px을 쓴다
      paddingLeft: '10px',
      paddingRight: '12px',
      transition: 'all 0.15s ease',
      ...extraStyles
    };
  };

  // 컨테이너 폭을 고정하지 않고 화면을 따라가게 한다. 좌우 여백은 상위 .main-content의 padding이 담당한다.
  // 비교표는 안이 늘어날수록 넓어지는데, 폭을 묶어두면 표 안에서만 가로 스크롤이 생겨
  // 실제로 보이는 구간이 좁아진다.
  return (
    <div className="quote-input-container fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', background: '#fff', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', width: '100%', boxSizing: 'border-box' }}>
      
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.8rem' }}>
        <h3 style={{ fontSize: '1.4rem', fontWeight: '700', color: 'var(--text-bright)', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <Coins style={{ color: 'var(--primary)' }} /> 견적서
        </h3>
        <button
          type="button"
          onClick={() => { setShowLoadModal(true); setLoadModalSearch(''); }}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#fff', color: 'var(--primary)', border: '1px solid var(--primary)', padding: '0.5rem 0.9rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer' }}
        >
          <FolderOpen size={16} /> 불러오기
        </button>
      </div>

      {/* 견적서 작성 / 견적서 목록 전환 탭 */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)' }}>
        <button
          type="button"
          onClick={() => setViewMode('form')}
          style={{ flex: 1, padding: '0.8rem', border: 'none', background: viewMode === 'form' ? 'var(--primary-glow)' : 'transparent', borderBottom: viewMode === 'form' ? '3px solid var(--primary)' : 'none', color: viewMode === 'form' ? 'var(--primary)' : 'var(--text-main)', fontWeight: viewMode === 'form' ? '700' : '500', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.9rem' }}
        >
          <Coins size={16} /> 견적서 작성
        </button>
        <button
          type="button"
          onClick={() => { setViewMode('list'); fetchQuotesList(); }}
          style={{ flex: 1, padding: '0.8rem', border: 'none', background: viewMode === 'list' ? 'var(--primary-glow)' : 'transparent', borderBottom: viewMode === 'list' ? '3px solid var(--primary)' : 'none', color: viewMode === 'list' ? 'var(--primary)' : 'var(--text-main)', fontWeight: viewMode === 'list' ? '700' : '500', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', fontSize: '0.9rem' }}
        >
          <List size={16} /> 견적서 목록 ({quotesListData.length})
        </button>
      </div>

      {viewMode === 'list' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, position: 'relative', minWidth: '240px' }}>
              <input
                type="text"
                placeholder="고객명, 차종 검색..."
                value={quotesListSearch}
                onChange={(e) => setQuotesListSearch(e.target.value)}
                style={{ width: '100%', padding: '0.5rem 0.5rem 0.5rem 2rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem' }}
              />
              <Search size={14} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            </div>
            {selectedQuoteListIds.size > 0 && (
              <button
                type="button"
                onClick={handleBulkDeleteQuoteList}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--error)', color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer' }}
              >
                <Trash2 size={14} /> 선택 삭제 ({selectedQuoteListIds.size})
              </button>
            )}
          </div>

          <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-bright)', fontWeight: '700' }}>
                  <th style={{ padding: '0.8rem', width: '40px' }}>
                    <input
                      type="checkbox"
                      checked={filteredQuotesListData.length > 0 && selectedQuoteListIds.size === filteredQuotesListData.length}
                      onChange={() => toggleSelectAllQuoteList(filteredQuotesListData.map(q => q._id))}
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                  <th style={{ padding: '0.8rem' }}>고객명</th>
                  <th style={{ padding: '0.8rem' }}>차종 / 사양</th>
                  <th style={{ padding: '0.8rem' }}>차량총액</th>
                  <th style={{ padding: '0.8rem' }}>작성일</th>
                  <th style={{ padding: '0.8rem' }}>작성자</th>
                  <th style={{ padding: '0.8rem' }}>견적 상태</th>
                  <th style={{ padding: '0.8rem', width: '140px' }}>관리 및 전환</th>
                </tr>
              </thead>
              <tbody>
                {quotesListLoading ? (
                  <tr><td colSpan="8" style={{ textAlign: 'center', padding: '2rem' }}>로딩 중...</td></tr>
                ) : filteredQuotesListData.length === 0 ? (
                  <tr><td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>등록된 견적서가 없습니다.</td></tr>
                ) : (
                  filteredQuotesListData.map(q => (
                    <tr key={q._id} style={{ borderBottom: '1px solid var(--border-color)', background: selectedQuoteListIds.has(q._id) ? 'var(--primary-glow)' : 'transparent' }}>
                      <td style={{ padding: '0.8rem' }}>
                        <input
                          type="checkbox"
                          checked={selectedQuoteListIds.has(q._id)}
                          onChange={() => toggleQuoteListSelection(q._id)}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ padding: '0.8rem', fontWeight: '700' }}>{formatCustomerName(q.customer)}</td>
                      <td style={{ padding: '0.8rem' }}>{q.vehicleModel}</td>
                      <td style={{ padding: '0.8rem' }}>{q.totalPrice ? `${q.totalPrice.toLocaleString()}원` : '-'}</td>
                      <td style={{ padding: '0.8rem' }}>{new Date(q.createdAt).toLocaleDateString()}</td>
                      <td style={{ padding: '0.8rem' }}>{q.createdBy}</td>
                      <td style={{ padding: '0.8rem' }}>
                        <span style={{
                          background: q.status === '계약전환' ? '#dcfce7' : '#e2e8f0',
                          color: q.status === '계약전환' ? '#16a34a' : '#475569',
                          padding: '0.2rem 0.4rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: '600'
                        }}>
                          {q.status}
                        </span>
                      </td>
                      <td style={{ padding: '0.8rem', display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                        <button
                          onClick={() => handleLoadQuoteFromList(q)}
                          title="불러와서 수정"
                          style={{ border: 'none', background: 'none', color: 'var(--primary)', cursor: 'pointer' }}
                        >
                          <Edit size={16} />
                        </button>
                        {q.status !== '계약전환' && (
                          <button
                            onClick={() => handleConvertQuoteToContract(q)}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', border: 'none', background: 'var(--primary-glow)', color: 'var(--primary)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer' }}
                          >
                            계약전환 <ArrowRight size={10} />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteQuoteFromList(q._id)}
                          style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}
                          title="견적서 삭제"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
      <>
      {showLoadModal && (
        <div
          onClick={() => setShowLoadModal(false)}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '10px', width: '90%', maxWidth: '760px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.2rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
              <h4 style={{ margin: 0, fontWeight: '800', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <FolderOpen size={18} style={{ color: 'var(--primary)' }} /> 견적서 불러오기
              </h4>
              <button type="button" onClick={() => setShowLoadModal(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
              <div style={{ position: 'relative' }}>
                <Search size={16} style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  autoFocus
                  placeholder="고객명, 차종으로 검색..."
                  value={loadModalSearch}
                  onChange={(e) => setLoadModalSearch(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem 1rem 0.6rem 2.2rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.9rem', outline: 'none' }}
                />
              </div>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {loadModalLoading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>불러오는 중...</div>
              ) : loadModalQuotes.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  {loadModalSearch.trim() ? '검색 결과가 없습니다.' : '저장된 견적서가 없습니다.'}
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', textAlign: 'left' }}>
                      <th style={{ padding: '0.6rem 1rem' }}>고객명</th>
                      <th style={{ padding: '0.6rem 1rem' }}>차종 / 사양</th>
                      <th style={{ padding: '0.6rem 1rem' }}>차량총액</th>
                      <th style={{ padding: '0.6rem 1rem' }}>작성일</th>
                      <th style={{ padding: '0.6rem 1rem' }}>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadModalQuotes.map(q => (
                      <tr
                        key={q._id}
                        onClick={() => handleSelectQuoteFromModal(q)}
                        style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f5'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; }}
                      >
                        <td style={{ padding: '0.6rem 1rem', fontWeight: '700' }}>{formatCustomerName(q.customer)}</td>
                        <td style={{ padding: '0.6rem 1rem' }}>{q.vehicleModel || '-'}</td>
                        <td style={{ padding: '0.6rem 1rem' }}>{q.totalPrice ? `${q.totalPrice.toLocaleString()}원` : '-'}</td>
                        <td style={{ padding: '0.6rem 1rem' }}>{new Date(q.createdAt).toLocaleDateString()}</td>
                        <td style={{ padding: '0.6rem 1rem' }}>
                          <span style={{
                            background: q.status === '계약전환' ? '#dcfce7' : '#e2e8f0',
                            color: q.status === '계약전환' ? '#16a34a' : '#475569',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: '600'
                          }}>
                            {q.status || '작성중'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Section 1: Customer info */}
      <div style={{ background: 'var(--bg-main)', padding: '1.2rem 1.5rem', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h4 style={{ fontWeight: '700', color: 'var(--text-bright)', margin: 0 }}>👥 1. 고객 정보 지정</h4>
          <button 
            type="button"
            onClick={() => {
              setUseExistingCustomer(!useExistingCustomer);
              setVehicles(prev => prev.map(v => ({ ...v, quoteId: null })));
            }}
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
                placeholder="고객명(성/이름), 차량정보, 연락처, 사업자번호 등으로 검색..."
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
                        <th style={{ padding: '0.6rem 0.8rem', fontWeight: '700' }}>차량정보</th>
                        <th style={{ padding: '0.6rem 0.8rem', fontWeight: '700' }}>휴대전화</th>
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
                              // 다른 고객으로 바꿨으므로 이전에 불러왔던 견적서와의 연결을 끊는다
                              // (안 그러면 저장 시 그 고객의 견적서가 지금 고객 데이터로 덮어써질 수 있음)
                              setVehicles(prev => prev.map(v => ({ ...v, quoteId: null })));
                              // 목록 검색 응답은 companies가 populate 안 되어 있으므로
                              // 소속 법인 정보(이름/사업자번호)가 필요해 상세 조회로 보강한다.
                              fetch(`${API_HOST}/api/customers/${c._id}`)
                                .then(res => res.ok ? res.json() : null)
                                .then(full => { if (full) setSelectedCustomer(full); })
                                .catch(() => {});
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
                            <td style={{ padding: '0.6rem 0.8rem', color: '#555' }}>{c.companyName || '-'}</td>
                            <td style={{ padding: '0.6rem 0.8rem', color: '#666' }}>{c.mobilePhone || c.contactPhone || '-'}</td>
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
                  <strong>선택된 고객:</strong> <span style={{ color: 'var(--primary)', fontWeight: '700', fontSize: '0.9rem' }}>{formatCustomerName(selectedCustomer)}</span>
                </div>
                {selectedCustomer.companyName && (
                  <div>
                    <strong>차량정보:</strong> {selectedCustomer.companyName}
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

            {selectedCustomer && (() => {
              const companies = (selectedCustomer.companies || []).filter(a => a.companyId);
              if (companies.length === 0) return null;

              if (companies.length === 1) {
                return (
                  <div style={{ marginTop: '0.6rem', background: '#f0f7ff', border: '1px solid #bbdefb', borderRadius: '6px', padding: '0.7rem 1rem', fontSize: '0.82rem', color: '#0056b3' }}>
                    <strong>법인 건:</strong> {companies[0].companyId.name} {companies[0].companyId.bizNo ? `(${companies[0].companyId.bizNo})` : ''} 소속으로 진행됩니다.
                  </div>
                );
              }

              return (
                <div style={{ marginTop: '0.6rem', background: '#f0f7ff', border: '1px solid #bbdefb', borderRadius: '6px', padding: '0.7rem 1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', color: '#0056b3', marginBottom: '0.4rem' }}>
                    어느 법인으로 진행할까요?
                  </label>
                  <select
                    value={selectedCompanyId}
                    onChange={(e) => setSelectedCompanyId(e.target.value)}
                    style={{ width: '100%', maxWidth: '360px', padding: '0.5rem 0.7rem', borderRadius: '6px', border: '1px solid #91d5ff', fontSize: '0.85rem', background: '#fff' }}
                  >
                    {companies.map((a) => (
                      <option key={a.companyId._id} value={a.companyId._id}>
                        {a.companyId.name} {a.companyId.bizNo ? `(${a.companyId.bizNo})` : ''}{a.isPrimary ? ' (주 소속)' : ''}{a.role ? ` - ${a.role}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })()}

            {selectedCustomer && customerQuotes.length > 0 && (
              <div style={{ marginTop: '0.6rem' }}>
                <button
                  type="button"
                  onClick={() => setShowQuoteHistory(!showQuoteHistory)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    background: 'none', border: 'none', color: 'var(--primary)',
                    fontSize: '0.82rem', fontWeight: '700', cursor: 'pointer', padding: '0.2rem 0'
                  }}
                >
                  {showQuoteHistory ? '▲' : '▼'} 이 고객의 지난 견적 {customerQuotes.length}건 불러오기
                </button>
                {showQuoteHistory && (
                  <div style={{ marginTop: '0.4rem', border: '1px solid #d9d9d9', borderRadius: '6px', background: '#fff', overflow: 'hidden' }}>
                    {customerQuotes.map(q => (
                      <div
                        key={q._id}
                        onClick={() => handleLoadQuote(q)}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '0.6rem 0.9rem', borderBottom: '1px solid #f0f0f0',
                          cursor: 'pointer', fontSize: '0.82rem'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#f6f8fb'}
                        onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
                      >
                        <div>
                          <span style={{ color: '#8c8c8c', marginRight: '0.6rem' }}>{new Date(q.createdAt).toLocaleDateString('ko-KR')}</span>
                          <span style={{ fontWeight: '700' }}>{q.vehicleModel}</span>
                          {q.status === '계약전환' && (
                            <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', background: '#e6f7ff', color: '#1890ff', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>계약전환됨</span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <span style={{ color: 'var(--primary)', fontWeight: '700' }}>{(q.totalPrice || 0).toLocaleString()}원</span>
                          <ArrowRight size={14} color="#8c8c8c" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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
                <span style={{ display: 'flex', alignItems: 'center', marginLeft: '0.15rem' }}>
                  {[
                    { dir: -1, Icon: ChevronLeft, label: '앞으로 이동', disabled: index === 0 },
                    { dir: 1, Icon: ChevronRight, label: '뒤로 이동', disabled: index === vehicles.length - 1 }
                  ].map(({ dir, Icon, label, disabled }) => (
                    <button
                      key={dir}
                      type="button"
                      title={label}
                      disabled={disabled}
                      onClick={(e) => handleMoveVehicle(v.id, dir, e)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: isSelected ? '#fff' : colorObj.dark,
                        cursor: disabled ? 'default' : 'pointer',
                        opacity: disabled ? 0.25 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 0,
                        borderRadius: '4px'
                      }}
                    >
                      <Icon size={15} />
                    </button>
                  ))}
                </span>
              )}
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
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600', marginBottom: '0.2rem' }}>보험 등급</label>
              <select
                value={selectedOpt?.insuranceType || 'standard'}
                onChange={(e) => {
                  updateActiveVehicleOption(selectedOpt.id, { insuranceType: e.target.value });
                }}
                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem', background: '#fff', color: '#333', fontWeight: '600' }}
              >
                <option value="standard">일반형</option>
                <option value="premium">고급형</option>
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
            const isFinalSelected = finalSelection && finalSelection.vehicleId === activeVehicle.id && finalSelection.optionId === opt.id;
            return (
              <div
                key={opt.id}
                onClick={() => toggleOptionSelection(opt.id)}
                style={{
                  background: '#fff',
                  border: isFinalSelected ? '3px solid #10b981' : (isSelected ? `2px solid ${activeVehicleColor.primary}` : '1px solid var(--border-color)'),
                  borderRadius: '10px',
                  boxShadow: isFinalSelected ? '0 4px 16px rgba(16, 185, 129, 0.35)' : (isSelected ? `0 4px 16px ${activeVehicleColor.primary}26` : '0 2px 4px rgba(0,0,0,0.03)'),
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
                  <select
                    value={opt.contractType || '렌트'}
                    onClick={(e) => e.stopPropagation()} // 카드 선택 방지
                    onChange={(e) => updateActiveVehicleOption(opt.id, { contractType: e.target.value })}
                    title="리스는 타사에서 받은 견적 값을 그대로 입력하는 용도입니다"
                    style={{
                      padding: '0.2rem 0.3rem',
                      border: `2px solid ${getContractTypeColors(opt.contractType).solid}`,
                      borderRadius: '4px',
                      fontSize: '0.75rem',
                      fontWeight: '800',
                      color: getContractTypeColors(opt.contractType).solid,
                      background: '#fff',
                      cursor: 'pointer',
                      marginLeft: '0.4rem'
                    }}
                  >
                    {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
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
                      <label style={{ display: 'block', color: '#666', marginBottom: '0.15rem' }}>보험 등급</label>
                      <select
                        value={opt.insuranceType || 'standard'}
                        onChange={(e) => {
                          updateActiveVehicleOption(opt.id, { insuranceType: e.target.value });
                        }}
                        style={{ width: '100%', padding: '0.2rem', border: '1px solid #ccc', borderRadius: '4px', background: '#fff', color: '#333' }}
                      >
                        <option value="standard">일반형</option>
                        <option value="premium">고급형</option>
                      </select>
                    </div>
                    {/* 예상보험료 - 렌트는 보험료가 월대여료에 포함되므로 리스일 때만 입력받는다.
                        이 칸이 채워지면서 아래 보증금/선수금/인수가의 율(왼쪽)과 액(오른쪽)도 같은 줄에 맞는다. */}
                    <div>
                      <label style={{ display: 'block', color: '#666', marginBottom: '0.15rem' }}>
                        예상보험료 (연간/원)
                      </label>
                      <input
                        type="text"
                        disabled={opt.contractType !== '리스'}
                        value={opt.contractType === '리스' ? toCommaString(opt.estimatedInsuranceFee || 0) : ''}
                        placeholder={opt.contractType === '리스' ? '' : '렌트는 월대여료 포함'}
                        onChange={(e) => updateActiveVehicleOption(opt.id, { estimatedInsuranceFee: parseNumber(e.target.value) })}
                        style={{
                          width: '100%',
                          padding: '0.2rem',
                          border: '1px solid #ccc',
                          borderRadius: '4px',
                          background: opt.contractType === '리스' ? '#fff' : '#f5f5f5',
                          color: opt.contractType === '리스' ? '#333' : '#bbb'
                        }}
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
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleFinalSelection(opt, activeVehicle);
                    }}
                    style={{
                      marginTop: '0.6rem',
                      background: isFinalSelected ? '#10b981' : 'var(--primary)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '0.5rem',
                      fontSize: '0.85rem',
                      fontWeight: '700',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.3rem',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                      transition: 'background 0.2s'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = isFinalSelected ? '#059669' : 'var(--primary-dark, #0050b3)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = isFinalSelected ? '#10b981' : 'var(--primary)'; }}
                  >
                    <CheckCircle size={15} /> {isFinalSelected ? '최종선택됨' : '최종선택'}
                  </button>
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
        </div>

        {/* 문서에 들어갈 특이사항/비고를 미리 입력하는 영역.
            문서 위에서 바로 타이핑하면 인쇄 영역 안에 입력칸이 들어가 있어야 해서
            PDF 변환 시 다루기 까다롭다. 입력은 여기서 받고 문서에는 결과만 찍는다. */}
        <div className="no-print" style={{
          marginBottom: '1.5rem',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          padding: '1rem 1.2rem'
        }}>
          {printFormType === 'comparison' ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.7rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: '800', color: 'var(--text-bright)' }}>특이사항</span>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  {isSpecialNoteMerged
                    ? '비교 견적서 맨 아래 줄의 칸을 합쳐서 한 번에 표시됩니다'
                    : '비교 견적서 맨 아래 줄에 안별로 표시됩니다'}
                </span>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  marginLeft: 'auto',
                  fontSize: '0.78rem',
                  fontWeight: '700',
                  color: isSpecialNoteMerged ? 'var(--primary)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}>
                  <input
                    type="checkbox"
                    checked={isSpecialNoteMerged}
                    onChange={(e) => setIsSpecialNoteMerged(e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  통합
                </label>
              </div>

              {isSpecialNoteMerged ? (
                <textarea
                  rows={3}
                  value={mergedSpecialNote}
                  placeholder="특이사항 입력 (안 구분 없이 하나로 표시)"
                  onChange={(e) => setMergedSpecialNote(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem 0.6rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-main)',
                    color: 'var(--text-bright)',
                    fontSize: '0.82rem',
                    fontFamily: 'inherit',
                    resize: 'vertical'
                  }}
                />
              ) : displaySelectedOptions.length === 0 ? (
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  비교할 안을 먼저 선택해 주세요.
                </div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${Math.min(displaySelectedOptions.length, 4)}, 1fr)`,
                  gap: '0.7rem'
                }}>
                  {displaySelectedOptions.map(({ veh, opt }, idx) => (
                    <div key={idx}>
                      <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        fontSize: '0.76rem',
                        fontWeight: '700',
                        color: 'var(--text-muted)',
                        marginBottom: '0.25rem'
                      }}>
                        <span style={{
                          backgroundColor: getContractTypeColors(opt.contractType).solid,
                          color: '#fff',
                          padding: '0.05rem 0.35rem',
                          borderRadius: '3px',
                          fontSize: '0.7rem',
                          fontWeight: '800'
                        }}>{opt.contractType || '렌트'}</span>
                        <span>{veh.carModel ? `${veh.carModel.split(' ')[0]} ` : ''}{opt.name}</span>
                      </label>
                      <textarea
                        rows={3}
                        value={opt.specialNote || ''}
                        placeholder="특이사항 입력"
                        onChange={(e) => updateVehicleOption(veh.id, opt.id, { specialNote: e.target.value })}
                        style={{
                          width: '100%',
                          padding: '0.5rem 0.6rem',
                          borderRadius: '6px',
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-main)',
                          color: 'var(--text-bright)',
                          fontSize: '0.82rem',
                          fontFamily: 'inherit',
                          resize: 'vertical'
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.7rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: '800', color: 'var(--text-bright)' }}>비고</span>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                  장기렌터카 견적서 왼쪽 하단 비고 칸에 표시됩니다
                </span>
              </div>
              <textarea
                rows={4}
                value={rentalRemark}
                placeholder="비고 입력"
                onChange={(e) => setRentalRemark(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.6rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-main)',
                  color: 'var(--text-bright)',
                  fontSize: '0.82rem',
                  fontFamily: 'inherit',
                  resize: 'vertical'
                }}
              />
            </>
          )}
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
            onClick={() => {
              saveQuoteRecord({ silent: true }); // 나중에 "불러오기" 할 수 있도록 백그라운드로 저장
              const originalTitle = document.title;
              const printTitle = printFormType === 'comparison'
                ? `비교견적서_${displayCustomerName}_${todayDateStr}`
                : `견적서_${displayCustomerName}_${todayDateStr}`;
              document.title = printTitle;
              const restoreTitle = () => {
                document.title = originalTitle;
                window.removeEventListener('afterprint', restoreTitle);
              };
              window.addEventListener('afterprint', restoreTitle);
              window.print();
            }}
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
          <button
            type="button"
            onClick={handleSaveToDocumentStore}
            disabled={savingToStore}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              background: savingToStore ? '#94a3b8' : '#107c41',
              color: '#fff',
              border: 'none',
              padding: '0.6rem 1.2rem',
              borderRadius: '8px',
              fontWeight: '700',
              cursor: savingToStore ? 'not-allowed' : 'pointer',
              boxShadow: '0 4px 12px rgba(16,124,65,0.25)',
              transition: 'var(--transition-smooth)',
              marginLeft: '0.6rem'
            }}
          >
            {savingToStore ? '문서함에 저장 중...' : '📁 문서함에 저장'}
          </button>
        </div>

        {/* Print & Screen Stylesheet */}
        <style dangerouslySetInnerHTML={{__html: `
          /* Screen CSS variables and classes */
          .comparison-table-wrapper {
            overflow-x: auto;
            /* 1안/2안 헤더를 고정하려면 세로로 스크롤되는 상자가 있어야 한다.
               overflow-x만 auto면 세로 스크롤이 생기지 않아 sticky가 걸릴 기준이 없다.
               화면 전용이며, 인쇄와 PDF에서는 아래에서 해제한다. */
            max-height: 72vh;
            overflow-y: auto;
            margin-top: 1.5rem;
            border-radius: 0;
            box-shadow: none;
          }
          /* thead 전체를 한 덩어리로 고정한다. 행별로 top을 주면 1행 높이를 추정해야 하고,
             비고 칸이 rowspan=2라 두 행에 걸쳐 있어 행 단위 고정과 맞지 않는다. */
          .comparison-table-modern thead {
            position: sticky;
            top: 0;
            z-index: 3;
          }
          /* border-collapse 상태에서는 고정된 셀의 테두리가 함께 스크롤되어 사라지므로
             inset 그림자로 같은 위치에 선을 다시 그려 준다.
             화면에서만 쓴다 - html2canvas가 inset 그림자를 배경 채움으로 그려서
             PDF에서 헤더 색이 통째로 바뀐다. 인쇄/PDF에서는 아래에서 해제한다. */
          .comparison-table-modern thead th {
            box-shadow: inset 0 -1px 0 #ad885c;
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
          /* 항목명이 좁아지면 "고 전 납 입 액"처럼 세로로 쪼개져 행 높이가 튄다 */
          .comparison-table-modern td.row-header {
            white-space: nowrap;
          }
          .comparison-table-modern th, .comparison-table-modern td {
            padding: 12px 10px;
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

          /* html2pdf-active overrides to match print layout and force 1 page */
          .comparison-sheet-section.html2pdf-active {
            border: none !important;
            box-shadow: none !important;
            padding: 8mm !important; /* 브라우저 인쇄와 동일한 8mm 마진 확보 */
            margin: 0 !important;
            width: 794px !important; /* A4 가로 픽셀 (96dpi 기준 210mm) */
            min-width: 794px !important;
            max-width: 794px !important;
            background: #fff !important;
            box-sizing: border-box !important;
            border-radius: 0 !important;
          }
          
          /* 가로 모드 (비교견적서 5안 이상) */
          .comparison-sheet-section.html2pdf-active.is-landscape {
            width: 1123px !important; /* A4 세로 픽셀 (96dpi 기준 297mm) */
            min-width: 1123px !important;
            max-width: 1123px !important;
            padding: 8mm !important;
          }

          .html2pdf-active .no-print {
            display: none !important;
          }
          
          /* Comparison Quote (Portrait or Landscape) */
          .html2pdf-active .comparison-doc-header {
            margin-top: 0 !important;
            margin-bottom: 0.5rem !important;
            padding-bottom: 0.4rem !important;
            gap: 0.6rem !important;
          }
          .html2pdf-active .comparison-doc-logo {
            height: 25px !important;
          }
          .html2pdf-active .comparison-doc-kicker {
            font-size: 0.55rem !important;
          }
          .html2pdf-active .comparison-doc-title {
            font-size: 1.25rem !important;
          }
          .html2pdf-active .customer-info-bar {
            margin-bottom: 0.5rem !important;
            font-size: 0.85rem !important;
          }
          .html2pdf-active .comparison-doc-footer {
            margin-top: 0.5rem !important;
            padding-top: 0.4rem !important;
            font-size: 0.65rem !important;
          }
          .html2pdf-active .comparison-table-wrapper {
            margin-top: 0 !important;
            /* 화면용 세로 스크롤/헤더 고정은 PDF에서 잘림과 위치 어긋남을 만든다 */
            max-height: none !important;
            overflow-y: visible !important;
          }
          .html2pdf-active .comparison-table-modern thead {
            position: static !important;
          }
          /* html2canvas가 inset 그림자를 배경 채움으로 그려 헤더 색을 덮어쓴다 */
          .html2pdf-active .comparison-table-modern thead th {
            box-shadow: none !important;
          }
          .html2pdf-active .comparison-table-modern {
            width: 100% !important;
            border-top: 3px solid #111e38 !important;
            border-bottom: 3px solid #111e38 !important;
          }
          .html2pdf-active .comparison-table-modern th,
          .html2pdf-active .comparison-table-modern td {
            border-bottom: 1px solid #e9e6e0 !important;
            border-right: 1px solid #ad885c !important;
            padding: 5px 8px !important;
            font-size: 8.5pt !important;
          }
          .html2pdf-active .row-header {
            padding-left: 5px !important;
            padding-right: 5px !important;
          }

          /* Single/Long-term Rental Quote (Portrait) */
          .html2pdf-active .rental-print-area {
            max-width: 100% !important;
            width: 100% !important;
            padding: 8mm 8mm 6mm 8mm !important; /* 실제 상하 여백 축소 */
            margin: 0 !important;
            font-size: 8.0pt !important; /* 8.2pt -> 8.0pt */
            line-height: 1.20 !important; /* 줄간격 축소 */
            display: flex !important;
            flex-direction: column !important;
            justify-content: space-between !important;
            height: 280mm !important; /* 297mm -> 280mm 로 강제 지정하여 한 장 고정 */
            box-sizing: border-box !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', '맑은 고딕', sans-serif !important;
            color: #000000 !important;
            -webkit-font-smoothing: antialiased !important;
            -moz-osx-font-smoothing: grayscale !important;
            text-rendering: optimizeLegibility !important;
          }
          .html2pdf-active .rental-print-area * {
            color: #000000 !important;
          }
          .html2pdf-active .rental-print-area h2 {
            font-size: 1.4rem !important; /* 타이틀 축소 */
            margin-top: 0 !important;
            margin-bottom: 0 !important;
          }
          .html2pdf-active .rental-print-area table {
            font-size: 7.5pt !important; /* 테이블 글자 축소 */
            /* border-collapse는 캡처 시 인접 셀 테두리가 겹쳐 두꺼워 보이는 html2canvas 버그가 있어
               separate + spacing 0으로 대체 (시각적으로는 collapse와 동일하게 한 줄로 보임) */
            border-collapse: separate !important;
            border-spacing: 0 !important;
            border: 1.5px solid #000000 !important; /* 화면과 동일하게 외곽 테두리는 두껍게 */
          }
          .html2pdf-active .rental-print-area th,
          .html2pdf-active .rental-print-area td {
            padding: 2.2px 3.5px !important; /* 셀 패딩 축소 */
            border: 1px solid #000000 !important; /* 화면과 동일하게 내부 격자선 적용 */
          }
          .html2pdf-active .rental-print-area .row-header {
            font-size: 7.5pt !important;
          }
          .html2pdf-active .rental-print-area div[style*="background: #fafafa"],
          .html2pdf-active .rental-print-area div[style*="background: rgb(250, 250, 250)"] {
            padding: 3px 8px !important;
            font-size: 6.5pt !important;
            line-height: 1.25 !important;
          }
          .html2pdf-active .rental-print-area div[style*="background: #fdfbfa"],
          .html2pdf-active .rental-print-area div[style*="background: rgb(253, 251, 250)"] {
            padding: 3px 8px !important;
            font-size: 6.5pt !important;
            line-height: 1.25 !important;
          }
          .html2pdf-active .rental-print-area div[style*="font-size: 0.62rem"] {
            font-size: 6.2pt !important;
          }
          .html2pdf-active .rental-print-area div[style*="display: flex; gap: 1.2rem"],
          .html2pdf-active .rental-print-area div[style*="display: flex; gap: 1.2rem; margin-bottom: 0.5rem"] {
            gap: 0.6rem !important; /* 간격 축소 */
          }
          .html2pdf-active .rental-print-area td[style*="height: 80px"] {
            height: 40px !important; /* 비고란 높이 대폭 축소 */
          }
          .html2pdf-active .rental-print-area div[style*="border: 1px solid rgb(0, 0, 0)"], 
          .html2pdf-active .rental-print-area div[style*="border: 1px solid #000"] {
            padding: 3px 8px !important;
            font-size: 6.5pt !important;
          }
          .html2pdf-active .rental-print-area div[style*="text-align: center; margin-top: 0.5rem"] span[style*="font-size: 1.1rem"] {
            font-size: 1.05rem !important;
          }
          .html2pdf-active .rental-print-area div[style*="text-align: center; margin-top: 0.5rem"] span[style*="font-size: 1.0rem"] {
            font-size: 0.95rem !important;
          }
          .html2pdf-active .rental-print-area > div {
            margin-top: 0 !important;
            margin-bottom: 0 !important;
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
              size: A4 ${printFormType === 'comparison' && isComparisonLandscape ? 'landscape' : 'portrait'};
              margin: 0 !important; /* 브라우저 기본 헤더/푸터 강제 제거 */
            }
            body {
              background: #fff !important;
              color: #000 !important;
              margin: 0 !important;
              padding: 0 !important;
            }
            /* Hide dashboard components during print */
            aside, header, nav, footer, button, .no-print,
            body .desktop-sidebar, body .mobile-header {
              display: none !important;
            }
            .quote-input-container > :not(.comparison-sheet-section) {
              display: none !important;
            }
            main, body .main-content, body .admin-container {
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
              padding: 8mm !important; /* 마진 0 대응 본문 여백 추가 */
              margin: 0 !important;
              background: #fff !important;
              box-sizing: border-box !important;
            }
            /* 1페이지 강제 고정을 위한 여백/폰트 축소 (5안 이상 가로 인쇄 시 더 컴팩트하게) */
            .comparison-doc-header {
              margin-top: 0 !important;
              margin-bottom: ${isComparisonLandscape ? '0.4rem' : '0.8rem'} !important;
              padding-bottom: ${isComparisonLandscape ? '0.3rem' : '0.4rem'} !important;
              gap: 0.6rem !important;
            }
            .comparison-doc-logo {
              height: ${isComparisonLandscape ? '22px' : '28px'} !important;
            }
            .comparison-doc-kicker {
              font-size: 0.55rem !important;
            }
            .comparison-doc-title {
              font-size: ${isComparisonLandscape ? '1.15rem' : '1.4rem'} !important;
            }
            .customer-info-bar {
              margin-bottom: ${isComparisonLandscape ? '0.4rem' : '0.6rem'} !important;
              font-size: 0.82rem !important;
            }
            .comparison-doc-footer {
              margin-top: 0.5rem !important;
              padding-top: 0.4rem !important;
              font-size: 0.65rem !important;
            }
            .comparison-table-wrapper {
              margin-top: 0 !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
              /* 화면용 세로 스크롤은 인쇄 시 표를 잘라먹는다 */
              max-height: none !important;
              overflow-y: visible !important;
            }
            .comparison-table-modern thead {
              position: static !important;
            }
            .comparison-table-modern thead th {
              box-shadow: none !important;
            }
            .comparison-table-modern {
              width: 100% !important;
              border-top: 3px solid #111e38 !important;
              border-bottom: 3px solid #111e38 !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            .comparison-table-modern th, .comparison-table-modern td {
              border-bottom: 1px solid #e9e6e0 !important;
              border-right: 1px solid #ad885c !important;
              padding: ${isComparisonLandscape ? '5px 8px' : '7px 10px'} !important;
              font-size: ${isComparisonLandscape ? '8pt' : '9.5pt'} !important;
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
            .comparison-th-group, .comparison-th-corner {
              padding: ${isComparisonLandscape ? '0.35rem 0.4rem' : '0.55rem 0.4rem'} !important;
              font-size: ${isComparisonLandscape ? '8.5pt' : '10pt'} !important;
            }
            .comparison-th-option {
              padding: ${isComparisonLandscape ? '0.35rem 0.4rem' : '0.5rem 0.4rem'} !important;
            }
            .comparison-th-option div {
              margin-bottom: 0 !important;
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

            /* 장기렌터카 견적서 1페이지 강제 최적화 - 웹 뷰 느낌 그대로 꽉 차게 */
            .rental-print-area {
              max-width: 100% !important;
              padding: 8mm 8mm 6mm 8mm !important; /* 실제 상하 여백 축소 */
              margin: 0 !important;
              font-size: 8.0pt !important; /* 8.2pt -> 8.0pt */
              line-height: 1.20 !important; /* 줄간격 축소 */
              display: flex !important;
              flex-direction: column !important;
              justify-content: space-between !important;
              height: 280mm !important; /* 297mm -> 280mm 로 강제 지정하여 한 장 고정 */
              box-sizing: border-box !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            .rental-print-area h2 {
              font-size: 1.4rem !important; /* 타이틀 축소 */
              margin-top: 0 !important;
              margin-bottom: 0 !important;
            }
            .rental-print-area table {
              font-size: 7.5pt !important; /* 테이블 글자 축소 */
              border-collapse: collapse !important;
              border: 1.5px solid #000000 !important; /* 화면과 동일하게 외곽 테두리는 두껍게 */
            }
            .rental-print-area th,
            .rental-print-area td {
              padding: 2.2px 3.5px !important; /* 셀 패딩 축소 */
              border: 1px solid #000000 !important; /* 화면과 동일하게 내부 격자선 적용 */
            }
            .rental-print-area .row-header {
              font-size: 7.5pt !important;
            }
            /* 신용 정보 고지 박스 */
            .rental-print-area div[style*="background: #fafafa"],
            .rental-print-area div[style*="background: rgb(250, 250, 250)"] {
              padding: 3px 8px !important;
              font-size: 6.5pt !important;
              line-height: 1.25 !important;
            }
            /* 주의사항 박스 */
            .rental-print-area div[style*="background: #fdfbfa"],
            .rental-print-area div[style*="background: rgb(253, 251, 250)"] {
              padding: 3px 8px !important;
              font-size: 6.5pt !important;
              line-height: 1.25 !important;
            }
            /* 대당 / 차량소비자가격 문구 */
            .rental-print-area div[style*="font-size: 0.62rem"] {
              font-size: 6.2pt !important;
            }
            /* 보험/대여조건/차량관리/특약사항 그리드 */
            .rental-print-area div[style*="display: flex; gap: 1.2rem"],
            .rental-print-area div[style*="display: flex; gap: 1.2rem; margin-bottom: 0.5rem"] {
              gap: 0.6rem !important; /* 간격 축소 */
            }
            /* 메모 비고란/특약사항 높이 조절 */
            .rental-print-area td[style*="height: 80px"] {
              height: 40px !important; /* 비고란 높이 대폭 축소 */
            }
            /* 계약시 필요서류 박스 */
            .rental-print-area div[style*="border: 1px solid rgb(0, 0, 0)"], 
            .rental-print-area div[style*="border: 1px solid #000"] {
              padding: 3px 8px !important;
              font-size: 6.5pt !important;
            }
            /* 푸터(서명란) 마진 */
            .rental-print-area div[style*="text-align: center; margin-top: 0.5rem"] span[style*="font-size: 1.1rem"] {
              font-size: 1.05rem !important;
            }
            .rental-print-area div[style*="text-align: center; margin-top: 0.5rem"] span[style*="font-size: 1.0rem"] {
              font-size: 0.95rem !important;
            }
            /* flex space 배치를 위해 불필요하게 겹치는 직계 마진 및 여백 상쇄 */
            .rental-print-area > table,
            .rental-print-area > div {
              margin-top: 0 !important;
              margin-bottom: 0 !important;
            }
          }
        `}} />

        {/* PDF Layout Content */}
        {/* PDF Layout Content */}
        {printFormType === 'comparison' ? (
          <div style={{ maxWidth: isComparisonLandscape ? '100%' : '900px', margin: '0 auto', background: '#fff', padding: '10px' }}>
            {/* Document Title Header */}
            <div className="comparison-doc-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isComparisonLandscape ? '0.8rem' : '1.5rem', marginTop: '0.3rem', borderBottom: '2px solid #ad885c', paddingBottom: '0.6rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '150px' }}>
                <span style={{ fontSize: '1.1rem', fontWeight: '800', color: '#111e38' }}>(주)렌트베네핏</span>
              </div>
              <h2 className="comparison-doc-title" style={{ fontWeight: '800', fontSize: '1.7rem', color: '#111e38', margin: 0, letterSpacing: '1px', flex: 1, textAlign: 'center' }}>
                차량 조건비교표
              </h2>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: '150px' }}>
                <img src="/logo.png" alt="RENT BENefit" className="comparison-doc-logo" style={{ height: '32px', width: 'auto', objectFit: 'contain' }} />
              </div>
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
              <div style={{ color: '#555', fontWeight: '500', fontSize: '0.9rem', textAlign: 'right' }}>
                <div>작성일 {todayDateStr}</div>
                <div>견적번호 RB-{todayDateStr.replace(/-/g, '').substring(2)}-{formatProfitCode(firstOption?.calc?.profitMargin)}</div>
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
                    <th className="comparison-th-corner" rowSpan={2} style={{ background: '#111e38', color: '#fff', fontWeight: '800', fontSize: '0.95rem', width: '9%', minWidth: '92px', borderBottom: '1px solid #ad885c', textAlign: 'center', borderRight: '1px solid #ad885c' }}>구 분</th>
                    {vehicleColSpans.map((group, idx) => {
                      return (
                        <th
                          key={idx}
                          colSpan={group.span}
                          className="comparison-th-group"
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
                    <th className="comparison-th-corner" rowSpan={2} style={{ background: '#111e38', color: '#fff', fontWeight: '800', fontSize: '0.95rem', width: '8%', borderBottom: '1px solid #ad885c', textAlign: 'center' }}>비고</th>
                  </tr>
                  {/* Row 2: Options descriptions */}
                  <tr style={{ background: '#111e38', color: '#fff' }}>
                    {displaySelectedOptions.map(({ opt }, idx) => {
                      return (
                        <th
                          key={idx}
                          className="comparison-th-option"
                          style={{
                            background: '#111e38',
                            borderBottom: '1px solid #ad885c',
                            borderRight: '1px solid #ad885c',
                            padding: '0.8rem 0.5rem',
                            fontWeight: '700',
                            color: '#fff',
                            textAlign: 'center'
                          }}
                        >
                          {/* 1줄: 안 이름 · 렌트/리스 · 계약기간 (11pt 굵게) */}
                          <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.35rem',
                            fontSize: '11pt',
                            fontWeight: '800',
                            lineHeight: '1.3',
                            whiteSpace: 'nowrap'
                          }}>
                            <span style={{
                              backgroundColor: '#ad885c',
                              color: '#fff',
                              padding: '0.1rem 0.4rem',
                              borderRadius: '4px',
                              fontWeight: '800',
                              display: 'inline-block'
                            }}>{opt.name}</span>
                            <span style={{
                              backgroundColor: getContractTypeColors(opt.contractType).solid,
                              color: '#fff',
                              padding: '0.1rem 0.4rem',
                              borderRadius: '4px',
                              fontWeight: '800',
                              display: 'inline-block'
                            }}>{opt.contractType || '렌트'}</span>
                            <span>{opt.termYears * 12}개월</span>
                          </div>
                          {/* 2~4줄: 조건 (9pt). 인쇄 CSS가 자식 div의 margin을 0으로 만들기 때문에
                              줄 간격은 line-height로 준다 */}
                          <div style={{
                            fontSize: '9pt',
                            fontWeight: '500',
                            color: '#cbd5e1',
                            lineHeight: '1.6',
                            marginTop: '0.25rem'
                          }}>
                            <div>보증금 {Math.round(opt.depositRate * 100)}%</div>
                            <div>선수금 {Math.round(opt.advancePaymentRate * 100)}%</div>
                            <div>인수가 {Math.round(opt.residualRate * 100)}%</div>
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
                  {/* 인수가 */}
                  <tr>
                    <td className="row-header" style={{ background: '#f9f8f6', borderRight: '1px solid #ad885c' }}>인수가</td>
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
                  {/* 예상보험료 - 렌트는 월대여료에 포함되어 따로 표기하지 않는다 */}
                  <tr>
                    <td className="row-header" style={{ background: '#f9f8f6', borderRight: '1px solid #ad885c' }}>예상보험료</td>
                    {displaySelectedOptions.map(({ opt }, idx) => {
                      const fee = opt.contractType === '리스' ? Number(opt.estimatedInsuranceFee) || 0 : 0;
                      return fee > 0 ? (
                        <td key={idx} style={getCellStyles(idx, true)}>{toCommaString(fee)}</td>
                      ) : (
                        <td key={idx} style={getCellStyles(idx, true, { color: '#94a3b8', textAlign: 'center', paddingLeft: '16px', paddingRight: '16px' })}>-</td>
                      );
                    })}
                    <td style={{ background: '#f9f8f6', textAlign: 'center', color: '#94a3b8' }}>-</td>
                  </tr>
                  {/* 자동차세 - 리스만 표기. 렌터카는 영업용이라 요율이 다르고 월대여료에 이미 포함된다 */}
                  <tr>
                    <td className="row-header" style={{ background: '#ffffff', borderRight: '1px solid #ad885c' }}>자동차세</td>
                    {displaySelectedOptions.map(({ veh, opt }, idx) => {
                      const tax = opt.contractType === '리스' ? calculateLeaseCarTax(veh) : null;
                      return tax ? (
                        <td key={idx} style={getCellStyles(idx, false)}>{toCommaString(tax)}</td>
                      ) : (
                        <td key={idx} style={getCellStyles(idx, false, { color: '#94a3b8', textAlign: 'center', paddingLeft: '16px', paddingRight: '16px' })}>-</td>
                      );
                    })}
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
                  {/* 약정운행거리(년) */}
                  <tr>
                    <td className="row-header" style={{ background: '#f9f8f6', borderRight: '1px solid #ad885c' }}>약정운행거리(년)</td>
                    {displaySelectedOptions.map(({ opt }, idx) => (
                      <td key={idx} style={getCellStyles(idx, false)}>{opt.mileage ? opt.mileage.toLocaleString() + 'km' : '20,000km'}</td>
                    ))}
                    <td style={{ background: '#f9f8f6', textAlign: 'center', color: '#94a3b8' }}>-</td>
                  </tr>
                  {/* 정비 - 옵션 카드의 '월 정비비 포함' 체크박스가 그대로 반영된다 */}
                  <tr>
                    <td className="row-header" style={{ background: '#ffffff', borderRight: '1px solid #ad885c' }}>정비</td>
                    {displaySelectedOptions.map(({ opt }, idx) => (
                      <td key={idx} style={getCellStyles(idx, true, { textAlign: 'center', paddingLeft: '16px', paddingRight: '16px' })}>
                        {opt.isMaintenanceEnabled !== false ? '가입' : '미가입'}
                      </td>
                    ))}
                    <td style={{ background: '#ffffff', textAlign: 'center', color: '#94a3b8' }}>-</td>
                  </tr>
                  {/* 특이사항 - 위쪽 입력 영역에서 받은 값을 표시만 한다.
                      통합이면 안별 칸을 가로로 병합해 한 칸으로 보여준다 */}
                  <tr style={{ borderBottom: '3px solid #111e38' }}>
                    <td className="row-header" style={{ background: '#f9f8f6', borderRight: '1px solid #ad885c' }}>특이사항</td>
                    {isSpecialNoteMerged ? (
                      <td
                        colSpan={displaySelectedOptions.length}
                        style={getCellStyles(0, false, { verticalAlign: 'top', whiteSpace: 'pre-wrap', lineHeight: '1.35', textAlign: 'left' })}
                      >
                        {mergedSpecialNote.trim() ? mergedSpecialNote : '-'}
                      </td>
                    ) : (
                      displaySelectedOptions.map(({ opt }, idx) => (
                        <td key={idx} style={getCellStyles(idx, false, { verticalAlign: 'top', whiteSpace: 'pre-wrap', lineHeight: '1.35' })}>
                          {opt.specialNote?.trim() ? opt.specialNote : '-'}
                        </td>
                      ))
                    )}
                    <td style={{ background: '#f9f8f6', textAlign: 'center', color: '#94a3b8' }}>-</td>
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
          <div className="rental-print-area" style={{ maxWidth: '900px', margin: '0 auto', background: '#fff', padding: '10px 15px', color: '#000', fontFamily: "'Apple SD Gothic Neo', 'Malgun Gothic', '맑은 고딕', sans-serif", fontSize: '0.76rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', boxSizing: 'border-box' }}>
            {/* 1. Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', borderBottom: '2.5px double #000', paddingBottom: '0.6rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '150px' }}>
                <span style={{ fontSize: '1.1rem', fontWeight: '800', color: '#111e38' }}>(주)렌트베네핏</span>
              </div>
              <h2 style={{ fontSize: '1.8rem', fontWeight: '800', color: '#111e38', margin: 0, letterSpacing: '2px', flex: 1, textAlign: 'center' }}>장기렌터카 견적서</h2>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: '150px' }}>
                <img src="/logo.png" alt="RENT BENefit" style={{ maxWidth: '120px', height: 'auto' }} />
              </div>
            </div>

            {/* 2. Customer & Document Meta Info */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1.0rem', marginBottom: '0.3rem' }}>
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
                      {`RB-${todayDateStr.replace(/-/g, '').substring(2)}-${formatProfitCode(firstOption?.calc?.profitMargin)}`}
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
            <div style={{ background: '#fafafa', border: '1px solid #adadad', padding: '4px 10px', fontSize: '0.68rem', color: '#333', marginBottom: '0.3rem', borderRadius: '4px', lineHeight: '1.3' }}>
              <div style={{ fontWeight: '700', textAlign: 'center', marginBottom: '1px' }}>• 대출액 10억 이하인 경우 및 최근 1개년 재무제표 미제출시에 한함 •</div>
              <div>1. 기업의 신용도 판단 목적으로 대표자의 개인신용정보를 조회할 경우, 렌트베네핏은 해당 기업의 대표자에게 조회 사실 및 이유 등을 사전 고지하여야 합니다.</div>
              <div>2. 렌트베네핏에 장기 견적을 요청한 업무담당자께서는 귀사의 대표자에게 신용조회가 발생할 수 있음을 반드시 사전 보고해 주시기 바랍니다.</div>
            </div>

            {/* 4. Main Rental Details Table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.74rem', marginBottom: '0.1rem' }}>
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
                          {/* 렌트/리스 구분은 비교 견적서에만 표시한다 */}
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

            <div style={{ textAlign: 'right', fontSize: '0.62rem', color: '#555', marginBottom: '0.2rem', fontWeight: '600' }}>
              대당 / 차량소비자가격 * 옵션 및 VAT포함 / 월대여료 : VAT포함
            </div>

            {/* 5. Fine Print / Guidelines */}
            <div style={{ background: '#fdfbfa', border: '1px dashed #ad885c', padding: '4px 8px', fontSize: '0.66rem', color: '#555', marginBottom: '0.3rem', lineHeight: '1.35' }}>
              <div>• 상기 견적 금액은 운용대수(계약대수/차량보유대수), 차량가 변동 또는 정부 시책에 따라 변동될 수 있습니다.</div>
              <div>• 상기 견적 중 선납금을 선택하신 경우는 선납금액을 계약기간으로 균등하게 나눈 금액을 월대여료에서 차감하고 청구됩니다.</div>
              <div>• 차량 등급별 세부 옵션 사항을 반드시 확인하시기 바라며, 각 차종의 세부 옵션 사항은 차량제조사 홈페이지에서 확인이 가능합니다.</div>
              <div>• 전기차 지역 보조금 소진 및 정부 정책에 따라 견적 상세 내용이 변경될 수 있으며, 안내되는 보조금 신청 사항 및 서류 접수 내용과 상이할 경우 견적이 취소됩니다.</div>
            </div>

            {/* 6. Rental and Insurance Clauses Grid */}
            <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.3rem' }}>
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
                      <td colSpan={3} style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '600' }}>
                        {firstOption?.opt.insuranceType === 'premium' ? '5 억 원' : '2 억 원'}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ background: '#fafafa', padding: '2px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>자 기 신 체</td>
                      <td colSpan={3} style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '600' }}>
                        {firstOption?.opt.insuranceType === 'premium' ? '사상 2억 / 부상 3000만' : '사상 1억 / 부상 1500만'}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ background: '#fafafa', padding: '2px', border: '1px solid #000', textAlign: 'center', fontWeight: '700' }}>자기부담금(CMD)</td>
                      <td colSpan={3} style={{ padding: '2px 4px', border: '1px solid #000', textAlign: 'center', fontWeight: '600' }}>
                        {firstOption?.opt.insuranceType === 'premium' ? '50만원' : '30만원'}
                      </td>
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
              <div style={{ width: '50%', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
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
            <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.3rem' }}>
              <table style={{ width: '50%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '0.68rem' }}>
                <thead>
                  <tr style={{ background: '#dcdcdc', borderBottom: '1px solid #000' }}>
                    <th style={{ padding: '3px', fontWeight: '700', textAlign: 'center' }}>비고</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {/* 위쪽 입력 영역에서 받은 비고를 표시만 한다 */}
                    <td style={{ padding: '5px 8px', border: '1px solid #000', height: '80px', verticalAlign: 'top', color: '#333', whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>
                      {rentalRemark}
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
            <div style={{ border: '1px solid #000', padding: '4px 8px', fontSize: '0.68rem', marginBottom: '0.4rem', display: 'flex', gap: '0.4rem', lineHeight: '1.25' }}>
              <div style={{ fontWeight: '800', whiteSpace: 'nowrap' }}>계약시 필요서류</div>
              <div style={{ color: '#333' }}>
                <strong>• 법인:</strong> 법인등기부등본(원본), 법인인감증명서(원본), 사업자등록증(사본), 사용인감사용시 사용인감계, 대리인 날인시 위임장, CMS통장사본
              </div>
            </div>

            {/* 9. Signatures (Footer) */}
            <div style={{ textAlign: 'center', marginTop: '0.2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.1rem' }}>
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
      </>
      )}
    </div>
  );
}

export default QuoteInputView;
