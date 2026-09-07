import React, { useState, useEffect } from 'react';
import { Save, Plus, Trash2, FileSignature, ChevronDown, ChevronUp, ArrowLeft, UserPlus, Users, Upload, Download, List, Edit, Search, Clock, Truck, FolderCheck, RotateCcw } from 'lucide-react';
import { formatCustomerName, toCommaString, parseNumber, extractQuoteVehicleDetail } from '../../utils/format.js';
import { useTableSort } from './useTableSort.js';
import { downloadFile } from '../../utils/authFetch.js';
import { useSaveShortcut } from './useSaveShortcut.js';
import { SortableTh, SortControls } from './TableSort.jsx';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const todayDateStr = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// 계약서에 넣는 차량 한 대의 항목.
// 보험·정비·대출은 계약 단위로 정해지므로 여기 두지 않는다.
const EMPTY_VEHICLE = {
  model: '',
  options: '',
  price: '',
  fuelType: '가솔린',
  cc: '',
  color: '',
  colorInterior: '',
  plateNo: '',
  vin: ''
};

function ContractRegisterView({ prefilledQuoteData, setPrefilledQuoteData, prefilledContractData, setPrefilledContractData, setActiveTab, showToast, currentUser }) {
  const [customers, setCustomers] = useState([]);
  const [contracts, setContracts] = useState([]);
  // 보관된 계약은 목록에서 감춰진다. 되돌리려면 이 값을 켜서 함께 불러온다.
  const [showArchived, setShowArchived] = useState(false);
  // 보기 설정이 바뀌면 목록을 다시 불러온다
  useEffect(() => { fetchContractsList(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [showArchived]);

  // 새 계약서 작성 화면 / 계약서 목록(하위 화면) 전환
  const [viewMode, setViewMode] = useState('form'); // 'form' | 'list'
  const [contractListSearch, setContractListSearch] = useState('');
  const [contractStatusFilter, setContractStatusFilter] = useState('all'); // 계약서 목록 상태 필터

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
  const [companySuggestions, setCompanySuggestions] = useState([]); // "계약사/법인명 검색"의 법인 DB 검색 결과
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

  // 거래 주체 구분 - 선택된 고객이 법인에 소속되어 있으면 그 법인의 사업자등록증 정보를 그대로 채운다
  const [partyType, setPartyType] = useState('개인'); // '개인' | '법인'
  const [selectedCompanyId, setSelectedCompanyId] = useState('');

  const [customerCompanies, setCustomerCompanies] = useState([]); // 선택된 고객의 소속 법인 목록 (2곳 이상일 때 전환용)
  const [companyLoading, setCompanyLoading] = useState(false);

  // 통장사본 문서함 (선택된 법인의 문서함에 저장됨)
  const [bankDocuments, setBankDocuments] = useState([]);
  const [pendingBankFile, setPendingBankFile] = useState(null);
  const [uploadingBankDoc, setUploadingBankDoc] = useState(false);

  // 2. Contract Main Fields
  const [leaseCompany, setLeaseCompany] = useState('');
  const [contractDate, setContractDate] = useState(todayDateStr());
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
  // 범칙금·과태료 고지서가 오면 어떻게 할지. 계약할 때 정해 두고 예외만 그때그때 바꾼다.
  const [fineHandling, setFineHandling] = useState('대납청구');
  const [corporateRegistrationNo, setCorporateRegistrationNo] = useState('');

  // 3. Vehicle Fields
  // 한 계약에 차량이 여러 대 들어간다.
  // 청구서와 세금계산서가 계약서 단위라, 같은 날 계약해도 계약서가 다르면 따로 나가야 하기 때문이다.
  const [vehicleList, setVehicleList] = useState([{ ...EMPTY_VEHICLE }]);
  const [releaseAddress, setReleaseAddress] = useState('');
  const [dealer, setDealer] = useState('');
  const [salesRep, setSalesRep] = useState('');
  const [showroom, setShowroom] = useState('');

  // New Vehicle Fields
  const [classification, setClassification] = useState('');
  const [operationType, setOperationType] = useState('');

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

  // 계약 조건 - 견적서에서 정한 값이 넘어오고, 청구서의 연체 이자 계산에 쓰인다
  const [lateInterestRate, setLateInterestRate] = useState('25');
  const [earlyTerminationRate, setEarlyTerminationRate] = useState('35');

  // Excel upload states & handlers
  const [excelFile, setExcelFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleExcelTemplateDownload = () => {
    // 새 창으로 주소를 열면 로그인 토큰이 실리지 않아 막힌다. 받아서 저장한다.
    downloadFile(`${API_HOST}/api/contracts/template`, '계약서_양식.xlsx')
      .catch((err) => showToast(err.message, 'error'));
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
        fetchContractsList();
        setViewMode('list');
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
    // 견적서에서 정해져 넘어오는 값. 화면에서는 확인만 하고 차량 DB로 그대로 전달한다.
    mileage: '',
    tireType: '',
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
    optionPrice: '',
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
    penaltyRate: '35',
    overdueRate: '25',
    
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

  // 정비 서비스 여부에 따른 세부 항목 기본값.
  // 선택 상자로 바꿀 때와 저장된 계약을 불러올 때가 같은 값을 쓰도록 한 곳에 모아 둔다.
  const MAINTENANCE_PRESETS = {
    '포함': {
      consumables: '가입',
      tireCount: '계약 기간 동안 4본 제공',
      regularCheck: '가입',
      emergencyService: '가입',
      generalMaintenance: '가입'
    },
    '미포함': {
      consumables: '미가입',
      tireCount: '미가입',
      regularCheck: '미가입',
      emergencyService: '미가입',
      generalMaintenance: '미가입'
    }
  };

  // 견적서에서 정해진 연간 주행거리와 타이어 등급은 정비 포함/미포함과 무관한 값이라,
  // 프리셋을 바꿔도 지우지 않고 그대로 둔다.
  // 차량 한 대의 항목을 고친다
  const updateVehicleAt = (index, field, value) => {
    setVehicleList((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: value } : v)));
  };

  // 차량을 한 대 더 넣는다.
  // 같은 계약의 차량은 차종·옵션이 거의 같고 색상만 다른 경우가 많아, 바로 위 차량을 복사해서 시작한다.
  // 차량번호와 차대번호는 차량마다 반드시 달라야 하므로 복사하지 않는다.
  const addVehicle = () => {
    setVehicleList((prev) => {
      const last = prev[prev.length - 1];
      return [...prev, last ? { ...last, plateNo: '', vin: '' } : { ...EMPTY_VEHICLE }];
    });
  };

  // 이미 추가해 둔 차량에 바로 위 차량 내용을 다시 덮어쓴다 (차량번호/차대번호는 그대로 둔다)
  const copyFromPreviousVehicle = (index) => {
    if (index === 0) return;
    setVehicleList((prev) => prev.map((v, i) => (
      i === index ? { ...prev[index - 1], plateNo: v.plateNo, vin: v.vin } : v
    )));
  };

  const removeVehicleAt = (index) => {
    setVehicleList((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const applyMaintenancePreset = (preset) => {
    setMaintenance(prev => ({
      ...(MAINTENANCE_PRESETS[preset] || MAINTENANCE_PRESETS['미포함']),
      mileage: prev.mileage,
      tireType: prev.tireType
    }));
  };

  // 견적서는 타이어 등급을 standard/premium으로 다룬다. 차량 DB에는 사람이 읽는 말로 남긴다.
  const TIRE_GRADE_LABEL = { standard: '일반형', premium: '고급형' };
  const toTireGradeLabel = (value) => TIRE_GRADE_LABEL[value] || value || '';

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
    setPartyType('개인');
    setSelectedCompanyId('');
    setCustomerCompanies([]);
    setBankDocuments([]);
  };

  // 법인 소속 고객 중 계약 담당자로 쓸 사람을 고른다: 담당자(주소속 우선) > 대표 > (없으면) 대표자명만
  const resolveContractManager = (companyCustomers, company) => {
    const managers = companyCustomers.filter(c => c.role === '담당자');
    const reps = companyCustomers.filter(c => c.role === '대표');
    const pick = managers.find(c => c.isPrimary) || managers[0] || reps.find(c => c.isPrimary) || reps[0];
    if (pick) {
      return {
        name: formatCustomerName(pick),
        phone: pick.mobilePhone || pick.contactPhone || ''
      };
    }
    return { name: company?.ceoName || '', phone: '' };
  };

  // 법인 검색 결과를 고르면, applyCustomerSelection에 넘길 실제 고객 레코드가 하나 필요하다
  // (계약은 항상 담당 고객을 정본으로 갖는다). 같은 우선순위로 담당 고객을 고른다.
  const pickCompanyContact = (companyCustomers) => {
    const managers = companyCustomers.filter(c => c.role === '담당자');
    const reps = companyCustomers.filter(c => c.role === '대표');
    return managers.find(c => c.isPrimary) || managers[0] || reps.find(c => c.isPrimary) || reps[0] || companyCustomers[0] || null;
  };

  // 사업자등록증 정보 칸을 비운다. 법인을 고르기 전에는 아무 값도 들어 있지 않아야
  // 이전 고객의 값이 남아 그대로 저장되는 일이 없다.
  const clearBusinessFields = () => {
    setCustomerName('');
    setCustomerBizNo('');
    setCustomerCeoName('');
    setCustomerBizNoTransfer('');
    setCustomerBizAddress('');
    setCustomerAddress('');
    setCustomerEmail('');
    setCustomerBankName('');
    setCustomerBankAccount('');
    setCustomerBankHolder('');
  };

  // 선택된 법인의 사업자등록증 정보(법인명/사업자번호/대표자/법인등록번호/주소/이메일)를 그대로 채운다.
  // 이메일은 법인 등록(사업자등록증 업로드) 때 입력한 청구 이메일을 먼저 쓰고,
  // 비어 있을 때만 소속 고객(계약 담당자 → 대표) 이메일로 보강한다.
  const applyCompanyBilling = (company, contactCust, companyCustomers = []) => {
    setCustomerName(company.name || '');
    setCustomerBizNo(company.bizNo || '');
    setCustomerCeoName(company.ceoName || '');
    setCustomerBizNoTransfer(company.corporateRegistrationNo || '');
    setCustomerBizAddress(company.address || '');
    setCustomerAddress(company.address || '');
    // 출금 통장은 법인 관리에 등록해 둔 법인 통장을 먼저 쓰고, 없으면 담당 고객 정보로 보강한다
    setCustomerBankName(company.bank?.bankName || contactCust?.bank?.name || '');
    setCustomerBankAccount(company.bank?.accountNo || contactCust?.bank?.account || '');
    setCustomerBankHolder(company.bank?.holder || contactCust?.bank?.holder || '');
    setCustomerEmail(company.billingEmail || contactCust?.email || pickCompanyContact(companyCustomers)?.email || '');
    // 범칙금 수신 이메일: 사업자등록증 업로드(법인 등록) 시 입력한 청구 이메일을 그대로 사용
    setFinesEmail(company.billingEmail || '');
  };

  // 법인 상세정보 + 소속 고객 + 통장사본 문서함을 함께 불러와 폼에 채운다
  const loadCompanyBilling = async (companyId, contactCust) => {
    setCompanyLoading(true);
    try {
      const [companyRes, companyCustomersRes, docsRes] = await Promise.all([
        fetch(`${API_HOST}/api/companies/${companyId}`),
        fetch(`${API_HOST}/api/companies/${companyId}/customers`),
        fetch(`${API_HOST}/api/companies/${companyId}/documents?docType=통장사본`)
      ]);
      const company = companyRes.ok ? await companyRes.json() : null;
      const companyCustomers = companyCustomersRes.ok ? await companyCustomersRes.json() : [];
      const docs = docsRes.ok ? await docsRes.json() : [];

      if (company) {
        applyCompanyBilling(company, contactCust, Array.isArray(companyCustomers) ? companyCustomers : []);
        const manager = resolveContractManager(Array.isArray(companyCustomers) ? companyCustomers : [], company);
        setManagerOps(manager.name);
        setManagerOpsPhone(manager.phone);
      }
      setBankDocuments(Array.isArray(docs) ? docs : []);
    } catch (err) {
      console.error('법인 정보를 불러오지 못했습니다', err);
    } finally {
      setCompanyLoading(false);
    }
  };

  // 고객을 선택(검색 결과 클릭 또는 견적서 연동)하면, 소속 법인 여부에 따라
  // 법인 사업자등록증 정보 또는 개인 정보를 자동으로 채운다.
  const applyCustomerSelection = async (cust, forcedCompanyId) => {
    setCustomerId(cust._id);
    setSearchQuery(formatCustomerName(cust));
    setIsNewCustomer(false);

    let full = cust;
    if (!full.companies) {
      try {
        const res = await fetch(`${API_HOST}/api/customers/${cust._id}`);
        if (res.ok) full = await res.json();
      } catch { /* ignore */ }
    }

    const companies = (full.companies || []).filter(a => a.companyId);
    setCustomerCompanies(companies);

    // 견적서/계약서에 어느 법인인지 적혀 있을 때만 그 법인을 자동으로 고른다.
    // 적혀 있지 않으면 소속 법인 중 하나를 임의로 고르지 않고 비워 둔다.
    // (엉뚱한 법인이 이미 선택된 채로 시작하면 잘못 저장되기 쉬워, 직접 검색해 고르게 한다)
    const targetCompanyId = forcedCompanyId || '';

    if (targetCompanyId) {
      setPartyType('법인');
      setSelectedCompanyId(targetCompanyId);
      await loadCompanyBilling(targetCompanyId, full);
    } else {
      // 법인을 아직 고르지 않았다. 사업자등록증 정보는 법인을 검색해 불러올 때 채운다.
      setPartyType(companies.length > 0 ? '법인' : '개인');
      setSelectedCompanyId('');
      setBankDocuments([]);
      clearBusinessFields();
      setFinesEmail('');
      setManagerOps('홍길동');
      setManagerOpsPhone('');
    }
  };

  // 1. Prefill / Edit Mode handler for Contracts
  useEffect(() => {
    if (!prefilledContractData) return;

    // 1-1. Customer Info
    const cust = prefilledContractData.customer || {};
    setCustomerId(cust._id || '');
    setIsNewCustomer(false);

    // 1-1-1. 거래 주체(법인/개인)와 이 계약에 연결된 법인을 그대로 되살린다.
    // 이걸 빼먹으면 "법인 건" 전환 드롭다운이 아예 안 뜨거나 엉뚱한 법인이 선택된 채로 남는다.
    setLateInterestRate(String(prefilledContractData.terms?.lateInterestRate ?? 25));
    setEarlyTerminationRate(String(prefilledContractData.terms?.earlyTerminationRate ?? 35));

    const linkedCompanyId = prefilledContractData.companyId?._id || prefilledContractData.companyId || '';
    setPartyType(prefilledContractData.partyType || '개인');
    setSelectedCompanyId(linkedCompanyId);

    // 사업자등록증 정보는 '법인' 정보로만 채운다.
    //
    // 예전에는 고객 레코드(cust)로 채웠는데, 아웃룩에서 넘어온 고객은 name이 사람 이름이 아니라
    // 연락처 메모(예: "렌공 125호8722 G80 ...")라서 법인명 칸에 엉뚱한 값이 들어갔다.
    // 법인이 연결돼 있으면 법인 관리에 등록된 정보를 불러와 채우고, 없으면 비워 둔다.
    clearBusinessFields();
    if (linkedCompanyId) {
      loadCompanyBilling(linkedCompanyId, cust);
    } else {
      // 개인 계약은 고객 정보가 곧 계약자 정보다
      populateCustomerFields(cust);
    }

    // 1-1-2. 이 고객이 소속된 법인 전체 목록을 불러온다. 지금 이 계약이 어느 법인 소속이든 상관없이
    // 항상 불러와 둬야, 나중에 다른 법인으로 계약을 바꾸는 드롭다운이 계속 나타난다.
    if (cust._id) {
      fetch(`${API_HOST}/api/customers/${cust._id}`)
        .then(res => res.ok ? res.json() : null)
        .then(full => {
          if (full) {
            setCustomerCompanies((full.companies || []).filter(a => a.companyId));
          }
        })
        .catch(() => {});
    } else {
      setCustomerCompanies([]);
    }

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
    setFineHandling(prefilledContractData.fineHandling || '대납청구');
    setStatus(prefilledContractData.status || '진행중');

    // 1-3. Pricing Info
    if (prefilledContractData.pricing) {
      setPricing(prev => ({
        ...prev,
        ...prefilledContractData.pricing
      }));
    }

    // 1-4. Vehicle Info
    // 계약에 실제 차량(vehicle)이 이미 있으면 그게 정본이고, 아직 임시저장 상태라 차량이 없으면
    // pending 필드(vehicleInfo)를 대신 쓴다. 두 소스는 필드 이름이 서로 달라 여기서 한 모양으로 맞춘다.
    const realVeh = prefilledContractData.vehicle;
    const pendingVeh = prefilledContractData.vehicleInfo;
    const veh = realVeh
      ? {
          model: realVeh.carModel,
          vehiclePrice: realVeh.carPrice,
          fuelType: realVeh.fuelType,
          cc: realVeh.cc,
          color: realVeh.exteriorColor,
          colorInterior: realVeh.interiorColor,
          options: realVeh.options,
          mileage: realVeh.currentMileage,
          insurance: realVeh.insurance,
          maintenance: realVeh.maintenance
        }
      : { ...(pendingVeh || {}) };

    // 유종/배기량/외장·내장 색상은 견적서가 원본이다. 임시저장 계약에 이 값이 비어 있으면
    // (전환 시점에 실려 오지 않은 예전 임시저장 건) 연결된 견적서에서 그대로 가져온다.
    if (!realVeh) {
      const quoteSpec = extractQuoteVehicleDetail(prefilledContractData.quote);
      veh.fuelType = veh.fuelType || quoteSpec.fuelType;
      veh.cc = veh.cc || quoteSpec.cc;
      veh.color = veh.color || quoteSpec.exteriorColor;
      veh.colorInterior = veh.colorInterior || quoteSpec.interiorColor;
    }

    // 계약에 묶인 차량 전체를 복원한다. 예전 계약은 차량이 한 대뿐이라 그대로 한 대짜리 목록이 된다.
    const savedVehicles = prefilledContractData.vehicles;
    if (Array.isArray(savedVehicles) && savedVehicles.length) {
      setVehicleList(savedVehicles.map((rv) => ({
        model: rv.carModel || '',
        options: rv.options || '',
        price: rv.carPrice ?? '',
        fuelType: rv.fuelType || '가솔린',
        cc: rv.cc ? String(rv.cc) : '',
        color: rv.exteriorColor || '',
        colorInterior: rv.interiorColor || '',
        plateNo: rv.plateNo || '',
        vin: rv.vin || ''
      })));
    } else {
      setVehicleList([{
        ...EMPTY_VEHICLE,
        model: veh.model || '',
        options: veh.options || '',
        price: veh.vehiclePrice ?? '',
        fuelType: veh.fuelType || '가솔린',
        cc: veh.cc ? String(veh.cc) : '',
        color: veh.color || '',
        colorInterior: veh.colorInterior || ''
      }]);
    }
    setMileage(veh.mileage !== undefined && veh.mileage !== null ? String(veh.mileage) : '');

    // 1-5. 보험 - insurance.type('standard'/'premium')으로 프리셋을 판정하고, 세부값은 있는 그대로 되살린다
    setInsurancePreset(veh.insurance?.type === 'premium' ? '보험2' : '보험1');
    setInsurance({
      liabilityLimit: veh.insurance?.liabilityLimit || '무제한',
      propertyLimit: veh.insurance?.propertyLimit || '2억원',
      personalInjury: veh.insurance?.personalInjury || '자상 1억/부상 1500만',
      deductible: veh.insurance?.deductible ? (veh.insurance.deductible >= 500000 ? '50만원' : '30만원') : '30만원',
      uninsuredInjury: veh.insurance?.uninsuredInjury || '2억원/ 1인당',
      emergencyCall: veh.insurance?.emergencyService || '포함'
    });

    // 1-6. 정비 - maintenance.enabled로 프리셋을 판정하고, 저장된 세부값이 있으면 그대로 되살린다.
    //
    // 비어 있는 항목을 '미가입'으로 채우면 안 된다.
    // 정비 '포함'인데 타이어 교체만 저장이 안 된 계약을 열면 '미가입'으로 보여서,
    // 미포함으로 바꿨다가 다시 포함으로 되돌려야 '계약 기간 동안 4본 제공'이 나타났다.
    // 그래서 빈 항목은 그 프리셋의 기본값으로 채운다.
    const maintenancePresetValue = veh.maintenance?.enabled !== false ? '포함' : '미포함';
    const maintenanceDefaults = MAINTENANCE_PRESETS[maintenancePresetValue];
    setMaintenancePreset(maintenancePresetValue);
    setMaintenance({
      // 견적서에서 정해진 값
      mileage: veh.maintenance?.mileage ?? '',
      tireType: toTireGradeLabel(veh.maintenance?.tireType),
      consumables: veh.maintenance?.consumables || maintenanceDefaults.consumables,
      // 타이어 교체는 '계약 기간 동안 4본 제공' 같은 설명이고, 타이어 등급(tireType)과는 다른 항목이다.
      // 예전에는 여기에 tireType을 넣어 등급이 설명 자리로 새고 차량 DB에는 아무것도 안 남았다.
      tireCount: maintenanceDefaults.tireCount,
      regularCheck: veh.maintenance?.regularCheck || maintenanceDefaults.regularCheck,
      emergencyService: veh.insurance?.emergencyService || maintenanceDefaults.emergencyService,
      generalMaintenance: veh.maintenance?.generalMaintenance || maintenanceDefaults.generalMaintenance
    });

    if (prefilledContractData.gifts) {
      setGifts(prefilledContractData.gifts);
    }
  }, [prefilledContractData]);

  // Fetch Customers and Contracts (검색/매칭 용). 계약사 검색은 실제 Customer/Company 데이터를 사용한다
  // (차량 DB의 자유 입력 텍스트를 검색 풀로 쓰면 차량정보 등 엉뚱한 값이 섞여 나오는 문제가 있었음).
  useEffect(() => {
    const fetchData = async () => {
      try {
        // 고객은 여기서 받지 않는다. 예전에는 고객 1만 8천 건(18MB)을 통째로 받아 검색창
        // 자동완성에만 썼는데, 화면을 열 때마다 7초가 걸렸고 그동안 서버가 다른 사람 요청까지
        // 처리하지 못했다. 지금은 아래 '검색어가 바뀔 때' 효과에서 필요한 만큼만 물어본다.
        const resContracts = await fetch(`${API_HOST}/api/contracts`);

        if (resContracts.ok) {
          const contractData = await resContracts.json();
          setContracts(contractData);
        }

        if (prefilledQuoteData) {
          const quoteCust = prefilledQuoteData.customer;
          const quoteCompanyId = prefilledQuoteData.companyId?._id || prefilledQuoteData.companyId || undefined;
          if (quoteCust && quoteCust._id) {
            await applyCustomerSelection(quoteCust, quoteCompanyId);
          }

          // 계약일은 항상 오늘 날짜로 시작 (수정 모드가 아닌 신규 등록)
          setContractDate(todayDateStr());

          const quoteVehicle = { ...EMPTY_VEHICLE, model: prefilledQuoteData.vehicleModel || '' };
          // vehicleSpec은 "옵션명 / 연료: .. / 배기량: .. / ..." 형태로 저장돼 있고, 첫 구간이 옵션명이다
          quoteVehicle.options = (prefilledQuoteData.vehicleSpec || '').split(' / ')[0] || '';

          // 견적서에서 넘어온 차량 세부 항목(유종/배기량/색상)을 그대로 채운다
          const vd = prefilledQuoteData.vehicleDetail;
          if (vd) {
            quoteVehicle.fuelType = vd.fuelType || '가솔린';
            if (vd.cc) quoteVehicle.cc = String(vd.cc);
            if (vd.exteriorColor) quoteVehicle.color = vd.exteriorColor;
            if (vd.interiorColor) quoteVehicle.colorInterior = vd.interiorColor;
          }
          setVehicleList([quoteVehicle]);

          // 견적서에서 정한 대여 조건(중도해지 수수료율·연체 이율)을 그대로 이어받는다
          if (prefilledQuoteData.terms) {
            setEarlyTerminationRate(String(prefilledQuoteData.terms.earlyTerminationRate ?? 35));
            setLateInterestRate(String(prefilledQuoteData.terms.lateInterestRate ?? 25));
          }

          if (prefilledQuoteData.pricing) {
            setPricing(prev => ({
              ...prev,
              ...prefilledQuoteData.pricing
            }));
            if (prefilledQuoteData.pricing.paymentTerm) {
              setTermMonths(String(prefilledQuoteData.pricing.paymentTerm));
            }
          }

          // 옵션가를 따로 받은 견적서는 차량가와 옵션가를 나눠 담는다.
          // 옛 견적서는 옵션가가 없어 차량가+옵션가가 합쳐진 총액(totalPrice)만 있으므로 그대로 차량가에 넣는다.
          if (prefilledQuoteData.pricing?.optionPrice) {
            setPricing(prev => ({
              ...prev,
              basePrice: prefilledQuoteData.pricing.basePrice,
              optionPrice: prefilledQuoteData.pricing.optionPrice
            }));
            setVehicleList((prev) => prev.map((v, i) => (i === 0 ? { ...v, price: prefilledQuoteData.pricing.basePrice } : v)));
          } else if (prefilledQuoteData.totalPrice) {
            setPricing(prev => ({
              ...prev,
              basePrice: prefilledQuoteData.totalPrice,
              supplyPrice: prefilledQuoteData.totalPrice
            }));
            setVehicleList((prev) => prev.map((v, i) => (i === 0 ? { ...v, price: prefilledQuoteData.totalPrice } : v)));
          } else if (prefilledQuoteData.pricing?.basePrice) {
            setVehicleList((prev) => prev.map((v, i) => (i === 0 ? { ...v, price: prefilledQuoteData.pricing.basePrice } : v)));
          }

          if (!prefilledQuoteData.pricing && prefilledQuoteData.monthlyEstimates && prefilledQuoteData.monthlyEstimates.length > 0) {
            const est24 = prefilledQuoteData.monthlyEstimates.find(e => e.termMonths === 24);
            if (est24) {
              setPricing(prev => ({ ...prev, monthlyFee: est24.monthlyFee }));
              setTermMonths('24');
            } else {
              setPricing(prev => ({ ...prev, monthlyFee: prefilledQuoteData.monthlyEstimates[0].monthlyFee }));
              setTermMonths(String(prefilledQuoteData.monthlyEstimates[0].termMonths));
            }
          }

          // 견적서에 저장된 보험/정비 선택값을 그대로 적용
          if (prefilledQuoteData.insurance) {
            const preset = prefilledQuoteData.insurance.type === 'premium' ? '보험2' : '보험1';
            setInsurancePreset(preset);
            applyInsurancePreset(preset);
          }
          if (prefilledQuoteData.maintenance) {
            const preset = prefilledQuoteData.maintenance.enabled ? '포함' : '미포함';
            setMaintenancePreset(preset);
            applyMaintenancePreset(preset);
            if (prefilledQuoteData.maintenance.mileage) {
              setMileage(String(prefilledQuoteData.maintenance.mileage));
            }
          }
        }
        // prefilledContractData(계약 수정)는 별도 useEffect에서 처리, 그 외 신규/빈 화면은 자동 채움 없이 검색부터 시작
      } catch (err) {
        console.error('Failed to load initial data', err);
      }
    };
    fetchData();
  }, [prefilledQuoteData, prefilledContractData]);

  // "계약사 / 법인명 검색"은 이름이 법인 검색이니, 고객 DB뿐 아니라 법인 DB도 실제로 검색해야 한다.
  // 법인을 고르면 그 법인의 담당 고객을 자동으로 찾아 연결한다(계약은 항상 고객을 정본으로 가진다).
  useEffect(() => {
    if (isNewCustomer || !searchQuery.trim()) {
      setCompanySuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_HOST}/api/companies?search=${encodeURIComponent(searchQuery.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setCompanySuggestions((Array.isArray(data) ? data : []).slice(0, 5));
        }
      } catch {
        // 검색 실패는 조용히 무시 - 고객 검색 결과는 그대로 남아 있다
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, isNewCustomer]);

  // 검색 결과에서 법인을 고르면, 그 법인의 담당 고객을 찾아 applyCustomerSelection으로 연결한다
  const handleSelectCompanySuggestion = async (company) => {
    setShowSuggestions(false);
    try {
      const res = await fetch(`${API_HOST}/api/companies/${company._id}/customers`);
      const companyCustomers = res.ok ? await res.json() : [];
      const contact = pickCompanyContact(companyCustomers);
      if (!contact) {
        showToast(`"${company.name}" 법인에 연결된 담당 고객이 없습니다. 법인 관리에서 담당자를 먼저 등록해주세요.`, 'error');
        return;
      }
      await applyCustomerSelection(contact, company._id);
    } catch (err) {
      showToast('법인 정보를 불러오지 못했습니다.', 'error');
    }
  };

  // 고객이 2곳 이상의 법인에 소속된 경우, 드롭다운에서 계약 대상 법인을 바꿀 때 사용
  const handleSwitchCompany = async (companyId) => {
    setSelectedCompanyId(companyId);
    if (!companyId) {
      setPartyType('개인');
      setBankDocuments([]);
      return;
    }
    setPartyType('법인');
    let contactCust = null;
    try {
      const res = await fetch(`${API_HOST}/api/customers/${customerId}`);
      if (res.ok) contactCust = await res.json();
    } catch { /* ignore */ }
    await loadCompanyBilling(companyId, contactCust);
  };

  // 통장사본 파일을 선택된 법인 문서함에 업로드한다
  const handleUploadBankDocument = async () => {
    if (!pendingBankFile) {
      showToast('업로드할 파일을 선택해주세요.', 'error');
      return;
    }
    if (!selectedCompanyId) {
      showToast('법인이 선택된 경우에만 통장사본을 업로드할 수 있습니다.', 'error');
      return;
    }
    setUploadingBankDoc(true);
    try {
      const formData = new FormData();
      formData.append('file', pendingBankFile);
      formData.append('docType', '통장사본');
      const res = await fetch(`${API_HOST}/api/companies/${selectedCompanyId}/documents`, {
        method: 'POST',
        headers: { 'X-User-Role': currentUser?.role || 'viewer' },
        body: formData
      });
      if (res.ok) {
        const doc = await res.json();
        setBankDocuments(prev => [doc, ...prev]);
        setPendingBankFile(null);
        showToast('통장사본이 업로드되었습니다.', 'success');
      } else {
        const err = await res.json();
        showToast(err.message || '통장사본 업로드에 실패했습니다.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setUploadingBankDoc(false);
    }
  };

  const handleDeleteBankDocument = async (docId) => {
    if (!window.confirm('이 통장사본 파일을 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(`${API_HOST}/api/companies/${selectedCompanyId}/documents/${docId}`, {
        method: 'DELETE',
        headers: { 'X-User-Role': currentUser?.role || 'viewer' }
      });
      if (res.ok) {
        setBankDocuments(prev => prev.filter(d => d._id !== docId));
        showToast('삭제되었습니다.', 'success');
      } else {
        const err = await res.json();
        showToast(err.message || '삭제에 실패했습니다.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 통신 오류가 발생했습니다.', 'error');
    }
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
    setPartyType('개인');
    setSelectedCompanyId('');
    setCustomerCompanies([]);
    setBankDocuments([]);
    setPendingBankFile(null);

    setContractDate(todayDateStr());
    setTermMonths('24');
    setManagerOps('홍길동');
    setManagerOpsPhone('');
    setFinesEmail('');
    setFinesEmail2('');

    setVehicleList([{ ...EMPTY_VEHICLE }]);
    setMileage('');

    setInsurancePreset('보험1');
    // 프리셋만 되돌리면 세부 항목에 이전 계약 값이 남으므로 함께 초기화한다
    setMaintenancePreset('미포함');
    applyMaintenancePreset('미포함');

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
      penaltyRate: '35',
      overdueRate: '25',
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



  // 등록/임시저장 공통으로 쓰는 계약 payload. status/finalize는 호출하는 쪽에서 덧붙인다.
  const buildContractPayload = () => ({
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
    quoteId: prefilledQuoteData?._id || prefilledContractData?.quote?._id || prefilledContractData?.quote || undefined,
    // 고객 선택(검색 또는 견적서 연동) 시 자동 판정된 거래 주체(법인/개인) 정보를 그대로 이관
    partyType: isNewCustomer ? '개인' : partyType,
    companyId: isNewCustomer ? undefined : (selectedCompanyId || undefined),
    leaseCompany: undefined,
    contractDate: contractDate || undefined,
    deliveryDate: undefined,
    termMonths: termMonths ? Number(termMonths) : undefined,
    branch: undefined,
    managerMain: undefined,
    managerMainPhone: undefined,
    managerOps,
    managerOpsPhone,

    rentPeriodYears: undefined,
    rentStartDate: undefined,
    rentPeriodDays: undefined,
    remainingPeriodCalc: undefined,
    finesEmail,
    finesEmail2,
    fineHandling,
    corporateRegistrationNo: customerBizNoTransfer || undefined,

    pricing: {
      basePrice: pricing.basePrice ? Number(pricing.basePrice) : undefined,
      optionPrice: pricing.optionPrice ? Number(pricing.optionPrice) : undefined,
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
      monthlyFee: pricing.monthlyFee ? Number(pricing.monthlyFee) : undefined,
      billingDay: pricing.billingDay ? Number(pricing.billingDay) : undefined,
      invoiceDay: pricing.invoiceDay ? Number(pricing.invoiceDay) : undefined,
      penaltyRate: pricing.penaltyRate ? Number(pricing.penaltyRate) : 35,
      overdueRate: pricing.overdueRate ? Number(pricing.overdueRate) : 25,

      paymentTerm: pricing.paymentTerm ? Number(pricing.paymentTerm) : undefined,
      monthlyFeeTotal: pricing.monthlyFeeTotal ? Number(pricing.monthlyFeeTotal) : undefined,
      pandanbi: pricing.pandanbi ? Number(pricing.pandanbi) : undefined,
      individualConsumptionTax: pricing.individualConsumptionTax ? Number(pricing.individualConsumptionTax) : undefined,
      baseInterestRate: pricing.baseInterestRate ? Number(pricing.baseInterestRate) : undefined,
      dealerCommission: pricing.dealerCommission ? Number(pricing.dealerCommission) : undefined
    },
    gifts: gifts
      .filter(g => g.name.trim() !== '')
      .map(g => ({ name: g.name, price: g.price ? Number(g.price) : 0 })),
    // 이 계약으로 묶이는 차량 전체. 서버가 이 목록만큼 렌트차량 DB에 차량을 만든다.
    vehicleInfos: vehicleList
      .filter((v) => (v.model || '').trim() !== '')
      .map((v) => ({
        model: v.model,
        options: v.options,
        fuelType: v.fuelType,
        cc: v.cc ? Number(v.cc) : undefined,
        color: v.color,
        colorInterior: v.colorInterior,
        plateNo: v.plateNo || undefined,
        vin: v.vin || undefined,
        vehiclePrice: v.price ? Number(v.price) : undefined,
        // 보험·정비는 계약 단위로 정해지므로 모든 차량에 같은 값이 들어간다
        insurance,
        maintenance
      })),
    terms: {
      lateInterestRate: Number(lateInterestRate) || 25,
      earlyTerminationRate: Number(earlyTerminationRate) || 35
    },
    // 예전 화면·엑셀 가져오기와의 호환을 위해 대표 차량 한 대도 그대로 보낸다
    vehicleInfo: {
      model: vehicleList[0]?.model || '',
      year: undefined,
      color: vehicleList[0]?.color || '',
      colorInterior: vehicleList[0]?.colorInterior || '',
      fuelType: vehicleList[0]?.fuelType || '가솔린',
      cc: vehicleList[0]?.cc ? Number(vehicleList[0].cc) : undefined,
      // 차대번호는 등록증을 봐야 알 수 있는 값이다. 입력하지 않았으면 비워 두고,
      // 출고 준비 화면에서 '차대번호 없음'으로 보이게 한다.
      // (예전에는 VIN_AUTO_… 같은 값을 만들어 넣어서, 없는 정보가 있는 것처럼 보였다)
      vin: vehicleList[0]?.vin || undefined,
      plateNo: vehicleList[0]?.plateNo || undefined,
      options: vehicleList[0]?.options || '',
      releaseAddress: undefined,
      dealer: undefined,
      salesRep: undefined,
      showroom: undefined,

      classification: undefined,
      operationType: undefined,
      vehiclePrice: vehicleList[0]?.price ? Number(vehicleList[0].price) : undefined,
      registrationDate: undefined,
      mileage: mileage ? Number(mileage) : undefined,

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
  });

  // 이미 임시저장된 계약을 이어서 편집 중인지: prefilledContractData는 있는데 아직 vehicle이 없는 상태
  const isEditingDraft = !!prefilledContractData && !prefilledContractData.vehicle;

  // "저장" - 계약을 최종 등록(또는 임시저장 계약을 확정)한다. 이 순간 렌트차량 DB에 차량이 만들어지고
  // 상태는 '계약중'으로 지정되며, 완료 후에는 실물 등록을 이어갈 수 있게 "출고 준비"로 이동한다.
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
    if (!(vehicleList[0]?.model || '').trim()) {
      showToast('차종 / 사양을 입력해주세요.', 'error');
      return;
    }
    if (!pricing.monthlyFee) {
      showToast('월 렌트료는 필수 입력값입니다.', 'error');
      return;
    }

    try {
      const isEditMode = !!prefilledContractData;
      const payload = { ...buildContractPayload(), status: '진행중', finalize: true };
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
        // '저장'은 계약을 확정하는 단계이므로 항상 출고 준비로 넘어간다.
        //
        // 예전에는 렌트차량 DB에 차량이 새로 만들어질 때만 넘어갔다. 그래서 이미 등록된 계약을
        // 불러와 저장하면 차량이 이미 있다는 이유로 계약서 목록에 그대로 머물렀다.
        // 계약서 목록에 남겨 두고 싶을 때는 '임시저장'을 쓴다.
        const createsVehicle = !isEditMode || isEditingDraft;
        showToast(
          createsVehicle ? '계약서가 성공적으로 등록되었으며 일정이 자동 생성되었습니다!' : '계약서가 성공적으로 수정되었습니다!',
          'success'
        );
        setPrefilledQuoteData(null);
        setPrefilledContractData(null);
        resetAllStates();
        setActiveTab('delivery-prep');
      } else {
        const err = await response.json();
        showToast(err.message || '계약 저장 실패', 'error');
      }
    } catch (err) {
      showToast('서버 저장 실패', 'error');
    }
  };

  // "임시저장" - 아직 다 채우지 못했어도 계약서 목록에 진행 상황을 저장해 둔다.
  // 렌트차량 DB에는 차량을 만들지 않는다(그건 "저장"이 최종 등록할 때의 몫이다).
  /**
   * 계약서 목록에서 그 계약의 차량을 곧바로 출고 준비로 보낸다.
   *
   * 출고 준비 화면은 '계약중' + 계약서에 연결된 차량을 대상으로 하므로 상태만 되돌리면 된다.
   * 차량번호/차대번호처럼 이미 등록된 값은 건드리지 않는다.
   */
  const handleSendToDeliveryPrep = async (contract) => {
    if (currentUser?.role === 'viewer') {
      showToast('수정 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    const vehicle = contract.vehicle;
    if (!vehicle) {
      showToast('아직 차량이 만들어지지 않은 계약입니다. 계약서를 저장하면 차량이 생성됩니다.', 'info');
      return;
    }

    // 이미 출고 준비 대상이면 상태를 건드리지 않고 화면만 넘어간다
    if (vehicle.status === '계약중') {
      setActiveTab('delivery-prep');
      return;
    }

    if (!window.confirm(`${vehicle.carModel} 차량을 출고 준비 목록으로 보낼까요?\n상태가 '계약중'으로 바뀝니다.`)) return;

    try {
      const res = await fetch(`${API_HOST}/api/vehicles/${vehicle._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
        body: JSON.stringify({ status: '계약중' })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('출고 준비 목록으로 보냈습니다.', 'success');
        setActiveTab('delivery-prep');
      } else {
        showToast(data.message || '출고 준비로 보내지 못했습니다.', 'error');
      }
    } catch (err) {
      showToast('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  /**
   * 계약서를 계약자 폴더에 보관한다.
   * 보관하면 계약서 목록에서 내려가고, 이 계약의 차량은 렌트차량 DB에서 수정할 수 없다.
   */
  const handleArchiveContract = async (contract) => {
    if (currentUser?.role === 'viewer') {
      showToast('권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (!window.confirm(`${contract.contractNo} 계약서를 보관할까요?\n계약서 목록에서 내려가고, 이 계약의 차량은 수정할 수 없게 됩니다. 되돌리기로 다시 꺼낼 수 있습니다.`)) return;

    try {
      const res = await fetch(`${API_HOST}/api/contracts/${contract._id}/archive`, {
        method: 'POST', headers: { 'X-User-Role': currentUser?.role || 'viewer' }
      });
      const data = await res.json();
      showToast(data.message || (res.ok ? '보관했습니다.' : '보관하지 못했습니다.'), res.ok ? 'success' : 'error');
      if (res.ok) fetchContractsList();
    } catch {
      showToast('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  const handleUnarchiveContract = async (contract) => {
    if (currentUser?.role === 'viewer') {
      showToast('권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    try {
      const res = await fetch(`${API_HOST}/api/contracts/${contract._id}/unarchive`, {
        method: 'POST', headers: { 'X-User-Role': currentUser?.role || 'viewer' }
      });
      const data = await res.json();
      showToast(data.message || (res.ok ? '되돌렸습니다.' : '되돌리지 못했습니다.'), res.ok ? 'success' : 'error');
      if (res.ok) fetchContractsList();
    } catch {
      showToast('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  const handleSaveDraft = async () => {
    if (currentUser?.role === 'viewer') {
      showToast('등록 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (!isNewCustomer && !customerId) {
      showToast('검색창에서 고객을 선택해 주셔야 임시저장이 가능합니다.', 'error');
      return;
    }
    if (isNewCustomer && (!customerName.trim() || !customerBizNo.trim())) {
      showToast('신규 고객의 고객명과 사업자번호는 필수 입력입니다.', 'error');
      return;
    }

    try {
      const payload = buildContractPayload();
      const isEditMode = !!prefilledContractData;
      const url = isEditMode
        ? `${API_HOST}/api/contracts/${prefilledContractData._id}`
        : `${API_HOST}/api/contracts/draft`;
      const method = isEditMode ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        showToast('계약서가 임시저장되었습니다.', 'success');
        setPrefilledQuoteData(null);
        setPrefilledContractData(null);
        resetAllStates();
        fetchContractsList();
        setViewMode('list');
      } else {
        const err = await response.json();
        showToast(err.message || '임시저장 실패', 'error');
      }
    } catch (err) {
      showToast('서버 저장 실패', 'error');
    }
  };

  // 계약서를 쓰는 동안 Ctrl+S로 임시저장한다.
  // '계약서 등록'은 차량·계약·회차표를 한꺼번에 만드는 되돌리기 어려운 동작이라
  // 단축키로는 임시저장까지만 한다.
  useSaveShortcut(viewMode === 'form', () => handleSaveDraft());

  const handleCancelPrefill = () => {
    setPrefilledQuoteData(null);
    setCustomerId('');
    clearCustomerFields();
    setSearchQuery('');
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
      penaltyRate: '35',
      overdueRate: '25',
      paymentTerm: '',
      monthlyFeeTotal: '',
      pandanbi: '',
      individualConsumptionTax: ''
    });
  };

  // "계약서 목록" 하위 화면 - 계약/견적 목록 페이지가 없어지면서 이 화면 안으로 들어옴
  const fetchContractsList = async () => {
    try {
      const res = await fetch(`${API_HOST}/api/contracts${showArchived ? '?includeArchived=true' : ''}`);
      if (res.ok) {
        const data = await res.json();
        setContracts(Array.isArray(data) ? data : (data.contracts || data.data || []));
      }
    } catch (err) {
      console.error('Failed to load contracts list', err);
    }
  };

  const handleEditContractFromList = (contract) => {
    setPrefilledContractData(contract);
    setPrefilledQuoteData(null);
    setViewMode('form');
  };

  const handleDeleteContractFromList = async (id) => {
    if (currentUser?.role === 'viewer') {
      showToast('수정 및 삭제 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (!window.confirm('정말 이 계약서를 삭제하시겠습니까? 관련 차량 및 등록 일정들도 모두 일괄 삭제됩니다.')) return;

    try {
      const response = await fetch(`${API_HOST}/api/contracts/${id}`, {
        method: 'DELETE',
        headers: { 'X-User-Role': currentUser?.role || 'viewer' }
      });
      if (response.ok) {
        showToast('계약서가 성공적으로 삭제되었습니다.', 'success');
        setContracts(prev => prev.filter(c => c._id !== id));
      } else {
        showToast('계약서 삭제 실패', 'error');
      }
    } catch (err) {
      showToast('서버 연결 오류', 'error');
    }
  };

  const filteredContractsList = contracts.filter(c => {
    if (contractStatusFilter !== 'all' && (c.status || '진행중') !== contractStatusFilter) return false;
    if (!contractListSearch.trim()) return true;
    const q = contractListSearch.toLowerCase();
    return (
      (c.contractNo || '').toLowerCase().includes(q) ||
      (c.customer?.name || '').toLowerCase().includes(q) ||
      (c.customer?.surname || '').toLowerCase().includes(q) ||
      (c.customer?.givenName || '').toLowerCase().includes(q) ||
      (c.vehicle?.carModel || '').toLowerCase().includes(q)
    );
  });

  // 계약서 목록에서 정렬할 수 있는 항목. 머리글을 누르거나 정렬 상자로 고른다.
  const CONTRACT_LIST_COLUMNS = [
    { key: 'contractNo', label: '계약번호', sortValue: (c) => c.contractNo },
    { key: 'status', label: '상태', sortValue: (c) => c.status || '진행중' },
    { key: 'customerName', label: '고객명', sortValue: (c) => formatCustomerName(c.customer) },
    { key: 'carModel', label: '차종', sortValue: (c) => c.vehicle?.carModel || c.vehicleInfo?.model },
    { key: 'contractDate', label: '계약일', numeric: true, sortValue: (c) => c.contractDate },
    { key: 'monthlyFee', label: '월 렌트료', numeric: true, sortValue: (c) => c.pricing?.monthlyFee }
  ];
  const contractListSort = useTableSort(filteredContractsList, CONTRACT_LIST_COLUMNS);
  const sortedContractsList = contractListSort.rows;

  // 검색창에 글자를 넣으면 그때 서버에서 고객을 찾아온다.
  //
  // 타자 한 글자마다 부르지 않도록 250ms 기다렸다 보낸다. 서버는 하이픈·공백을 무시하고 찾으므로
  // 사업자번호를 '1234567890'으로 쳐도 '123-45-67890'이 걸린다.
  useEffect(() => {
    const term = searchQuery.trim();
    if (term.length < 2) {
      setCustomers([]);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_HOST}/api/customers?limit=30&search=${encodeURIComponent(term)}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setCustomers(Array.isArray(data) ? data : (data.customers || []));
      } catch {
        /* 검색 실패는 조용히 넘긴다. 자동완성이 안 뜰 뿐 입력은 계속할 수 있다 */
      }
    }, 250);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchQuery]);

  // Generate Search Suggestions dynamically based on multiple fields (Customer Name, BizNo, Manager, Plate No, etc.)
  // Normalized for space-insensitivity and dash-insensitivity
  const getSuggestions = () => {
    if (!searchQuery.trim()) return [];
    
    const qClean = searchQuery.toLowerCase().replace(/[-\s]/g, '');
    const suggestionMap = new Map();
 
    // 1. Direct Customer match (성/이름, 고객ID, 사업자/주민번호, 휴대전화, 담당자명)
    customers.forEach(c => {
      const surnameClean = String(c.surname || c.name || '').toLowerCase().replace(/[-\s]/g, '');
      const givenNameClean = String(c.givenName || '').toLowerCase().replace(/[-\s]/g, '');
      const cIdClean = String(c.customerId || '').toLowerCase().replace(/[-\s]/g, '');
      const bizClean = String(c.bizNo || '').replace(/[-\s]/g, '');
      const contactClean = String(c.contactName || '').toLowerCase().replace(/[-\s]/g, '');
      const mobileClean = String(c.mobilePhone || c.contactPhone || '').replace(/[-\s]/g, '');

      if (
        surnameClean.includes(qClean) || givenNameClean.includes(qClean) ||
        cIdClean.includes(qClean) || bizClean.includes(qClean) ||
        contactClean.includes(qClean) || mobileClean.includes(qClean)
      ) {
        suggestionMap.set(c._id, {
          customer: c,
          reason: '고객 정보 일치'
        });
      }
    });
 
    // 2. Contract-level matching (vehicle plateNo, vehicle vin, contract manager, contractNo)
    contracts.forEach(con => {
      const compName = con.leaseCompany || con.vehicle?.contractCompany || '';
      // 계약에 고객이 붙어 있으면 그걸 쓴다. 예전에는 고객 전체 목록에서 이름으로 되찾으려고
      // 1만 8천 건을 미리 받아 두고 있었다.
      const actualCustomer = con.customer
        || (compName ? customers.find(c => c.name === compName.trim()) : null);
      if (!actualCustomer?._id) return;
 
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

  // 금액 입력 필드 전용 - 표시는 천 단위 콤마(예: "100,000")로 보여주고, 실제 값은 숫자만 저장한다.
  const renderMoneyInput = (label, value, onChange, placeholder = '', required = false, disabled = false) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-main)' }}>
        {label} {required && <span style={{ color: 'var(--error)' }}>*</span>}
      </label>
      <input
        type="text"
        inputMode="numeric"
        value={toCommaString(value)}
        onChange={(e) => onChange(parseNumber(e.target.value))}
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
          cursor: disabled ? 'not-allowed' : 'text',
          textAlign: 'right'
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      {/* 새 계약서 작성 / 계약서 목록 전환 탭 */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: '#fff', borderRadius: '12px 12px 0 0', overflow: 'hidden', boxShadow: 'var(--shadow-premium)' }}>
        <button
          type="button"
          onClick={() => setViewMode('form')}
          style={{ flex: 1, padding: '1rem', border: 'none', background: viewMode === 'form' ? 'var(--primary-glow)' : '#fff', borderBottom: viewMode === 'form' ? '3px solid var(--primary)' : 'none', color: viewMode === 'form' ? 'var(--primary)' : 'var(--text-main)', fontWeight: viewMode === 'form' ? '700' : '500', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
        >
          <FileSignature size={16} /> 새 계약서 작성
        </button>
        <button
          type="button"
          onClick={() => { setViewMode('list'); fetchContractsList(); }}
          style={{ flex: 1, padding: '1rem', border: 'none', background: viewMode === 'list' ? 'var(--primary-glow)' : '#fff', borderBottom: viewMode === 'list' ? '3px solid var(--primary)' : 'none', color: viewMode === 'list' ? 'var(--primary)' : 'var(--text-main)', fontWeight: viewMode === 'list' ? '700' : '500', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem' }}
        >
          <List size={16} /> 계약서 목록 ({contracts.length})
        </button>
      </div>

      {viewMode === 'list' ? (
        <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)', position: 'relative' }}>
            <input
              type="text"
              placeholder="계약번호, 고객명, 차종 검색..."
              value={contractListSearch}
              onChange={(e) => setContractListSearch(e.target.value)}
              style={{ width: '100%', padding: '0.5rem 0.5rem 0.5rem 2rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.85rem' }}
            />
            <Search size={14} style={{ position: 'absolute', left: '1.9rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            {/* 보관한 계약은 목록에서 내려간다. 되돌리려면 여기서 켜서 함께 본다. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                보관한 계약서도 보기
              </label>
              <select
                value={contractStatusFilter}
                onChange={(e) => setContractStatusFilter(e.target.value)}
                style={{ padding: '0.4rem 0.6rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.82rem', background: '#fff', cursor: 'pointer' }}
              >
                <option value="all">전체 상태</option>
                <option value="진행중">진행중</option>
                <option value="임시저장">임시저장</option>
                <option value="보관됨">보관됨</option>
              </select>
              <SortControls
                sort={contractListSort}
                selectStyle={{ padding: '0.4rem 0.6rem', fontSize: '0.82rem' }}
                defaultLabel="정렬 안 함 (최근 등록순)"
                show={contractListSort.active || Boolean(contractListSearch) || contractStatusFilter !== 'all'}
                onReset={() => { setContractListSearch(''); setContractStatusFilter('all'); }}
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{sortedContractsList.length}건</span>
            </div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-bright)', fontWeight: '700' }}>
                {CONTRACT_LIST_COLUMNS.map((col) => (
                  <SortableTh key={col.key} sort={contractListSort} columnKey={col.key} style={{ padding: '0.8rem' }}>
                    {col.label}
                  </SortableTh>
                ))}
                <th style={{ padding: '0.8rem', width: '260px' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {sortedContractsList.length === 0 ? (
                <tr><td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  {contracts.length ? '조건에 맞는 계약서가 없습니다.' : '등록된 계약서가 없습니다.'}
                </td></tr>
              ) : (
                sortedContractsList.map(c => (
                  <tr key={c._id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.8rem', fontWeight: '700' }}>{c.contractNo}</td>
                    <td style={{ padding: '0.8rem' }}>
                      <span style={{
                        padding: '0.2rem 0.6rem', borderRadius: '20px', fontSize: '0.75rem', fontWeight: '700',
                        background: c.status === '임시저장' ? '#fffbe6' : c.status === '진행중' ? '#e6f7ff' : '#f5f5f5',
                        color: c.status === '임시저장' ? '#faad14' : c.status === '진행중' ? '#1890ff' : '#8c8c8c'
                      }}>
                        {c.status || '진행중'}
                      </span>
                    </td>
                    <td style={{ padding: '0.8rem' }}>{formatCustomerName(c.customer)}</td>
                    <td style={{ padding: '0.8rem' }}>{c.vehicle?.carModel || c.vehicleInfo?.model || '-'}</td>
                    <td style={{ padding: '0.8rem' }}>{c.contractDate ? new Date(c.contractDate).toLocaleDateString() : '-'}</td>
                    <td style={{ padding: '0.8rem', fontWeight: '700' }}>{c.pricing?.monthlyFee?.toLocaleString() || '-'}{c.pricing?.monthlyFee ? '원' : ''}</td>
                    <td style={{ padding: '0.8rem', display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
                      <button
                        onClick={() => handleEditContractFromList(c)}
                        style={{ border: 'none', background: 'none', color: 'var(--primary)', cursor: 'pointer' }}
                        title="계약서 수정"
                      >
                        <Edit size={16} />
                      </button>
                      <button
                        onClick={() => handleDeleteContractFromList(c._id)}
                        style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}
                        title="계약서 삭제"
                      >
                        <Trash2 size={16} />
                      </button>
                      {c.status === '보관됨' ? (
                        <button
                          onClick={() => handleUnarchiveContract(c)}
                          title="보관 해제 - 계약서 목록으로 되돌리고 차량 수정을 다시 엽니다"
                          style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: '#fff', border: '1px solid var(--border-color)', color: 'var(--text-muted)', padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          <RotateCcw size={13} /> 되돌리기
                        </button>
                      ) : (
                        <button
                          onClick={() => handleArchiveContract(c)}
                          title="계약서를 계약자 폴더에 보관합니다"
                          style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: '#fff', border: '1px solid var(--border-color)', color: 'var(--text-muted)', padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          <FolderCheck size={13} /> 보관
                        </button>
                      )}
                      {/* 차량이 만들어진 계약만 출고 준비로 보낼 수 있다 (임시저장 계약은 아직 차량이 없다) */}
                      {c.vehicle && (
                        <button
                          onClick={() => handleSendToDeliveryPrep(c)}
                          title="이 계약의 차량을 출고 준비로 보내기"
                          style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: '#fff', border: '1px solid var(--primary)', color: 'var(--primary)', padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap' }}
                        >
                          <Truck size={13} /> 출고준비
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
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
                fetchContractsList();
                setViewMode('list');
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
                    const custSuggestions = getSuggestions();
                    if (companySuggestions.length === 0 && custSuggestions.length === 0) {
                      return (
                        <li style={{ padding: '0.6rem 0.8rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          검색 결과가 없습니다.
                        </li>
                      );
                    }
                    return (
                      <>
                        {companySuggestions.length > 0 && (
                          <>
                            <li style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem', fontWeight: '700', color: 'var(--text-muted)', background: 'var(--bg-main)' }}>
                              🏢 법인
                            </li>
                            {companySuggestions.map(company => (
                              <li
                                key={company._id}
                                onClick={() => handleSelectCompanySuggestion(company)}
                                style={{
                                  padding: '0.6rem 0.8rem', cursor: 'pointer', fontSize: '0.8rem',
                                  borderBottom: '1px solid var(--bg-main)', background: '#fff',
                                  transition: 'background 0.2s', display: 'flex', flexDirection: 'column', gap: '0.2rem'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-main)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                  <span style={{ fontWeight: '600', color: 'var(--text-bright)' }}>{company.name}</span>
                                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{company.ceoName ? `대표 ${company.ceoName}` : ''}</span>
                                </div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--primary)' }}>
                                  {company.bizNo || '사업자번호 없음'}
                                </div>
                              </li>
                            ))}
                          </>
                        )}
                        {custSuggestions.length > 0 && (
                          <>
                            <li style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem', fontWeight: '700', color: 'var(--text-muted)', background: 'var(--bg-main)' }}>
                              👤 고객
                            </li>
                            {custSuggestions.map(item => {
                              const c = item.customer;
                              return (
                                <li
                                  key={c._id}
                                  onClick={() => {
                                    applyCustomerSelection(c);
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
                                    <span style={{ fontWeight: '600', color: 'var(--text-bright)' }}>{formatCustomerName(c)}</span>
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{c.mobilePhone || c.contactPhone || '연락처 없음'}</span>
                                  </div>
                                  <div style={{ fontSize: '0.7rem', color: 'var(--primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>{c.bizNo || '사업자번호 없음'}</span>
                                    <span style={{ background: 'var(--primary-glow)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: '600', fontSize: '0.65rem', border: '1px solid var(--primary-glow-border)' }}>
                                      {item.reason}
                                    </span>
                                  </div>
                                </li>
                              );
                            })}
                          </>
                        )}
                      </>
                    );
                  })()}
                </ul>
              )}
            </div>

            {/* Customer Details */}
            <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <h5 style={{ fontWeight: '700', color: 'var(--text-bright)', margin: 0, fontSize: '0.95rem', borderBottom: '2px solid var(--bg-main)', paddingBottom: '0.6rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>
                  {isNewCustomer ? '📝 신규 법인 정보 직접 입력' : (partyType === '법인' ? '🏢 선택된 법인 상세 정보 (사업자등록증 기준)' : '👤 선택된 고객 상세 정보')}
                  {companyLoading && <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', fontWeight: '500', color: 'var(--text-muted)' }}>불러오는 중...</span>}
                </span>
                {!isNewCustomer && customerCompanies.length > 0 && (
                  <select
                    value={selectedCompanyId}
                    onChange={(e) => handleSwitchCompany(e.target.value)}
                    style={{ padding: '0.35rem 0.6rem', border: '1px solid var(--primary)', borderRadius: '6px', fontSize: '0.78rem', color: 'var(--primary)', fontWeight: '600', background: '#fff', cursor: 'pointer' }}
                  >
                    {customerCompanies.map(a => (
                      <option key={a.companyId?._id || a.companyId} value={a.companyId?._id || a.companyId}>
                        {a.companyId?.name || '법인'} {a.isPrimary ? '(주 소속)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </h5>

              {/* 사업자등록증 정보 영역 */}
              <div style={{ background: 'var(--bg-main)', padding: '1.2rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.8rem' }}>
                  <span style={{ display: 'inline-block', width: '4px', height: '14px', backgroundColor: 'var(--primary)', borderRadius: '2px' }}></span>
                  <span style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.85rem' }}>📄 사업자등록증 정보</span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                  {renderInput('고객명 (개인/법인명) *', 'text', customerName, setCustomerName, '예: 주식회사 에스벤네핏', true)}
                  {renderInput('사업자/주민번호 *', 'text', customerBizNo, setCustomerBizNo, '예: 123-45-67890 또는 950101-1234567', true)}
                  {renderInput('대표자명', 'text', customerCeoName, setCustomerCeoName)}
                  {renderInput('법인등록번호', 'text', customerBizNoTransfer, setCustomerBizNoTransfer, '법인등록번호 입력')}
                  <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 3fr', gap: '1rem' }}>
                    {renderInput('이메일', 'email', customerEmail, setCustomerEmail, 'email@example.com')}
                    {renderInput('주소', 'text', customerBizAddress, setCustomerBizAddress, '주소 입력')}
                  </div>
                </div>
              </div>

              {/* 출금 통장 영역 - 자동으로 불러와도 항상 수정 가능해야 한다 */}
              <div style={{ background: 'var(--bg-main)', padding: '1.2rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.8rem' }}>
                  <span style={{ display: 'inline-block', width: '4px', height: '14px', backgroundColor: '#e28743', borderRadius: '2px' }}></span>
                  <span style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.85rem' }}>🏦 출금 통장</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                  {renderInput('자동이체 은행', 'text', customerBankName, setCustomerBankName, '예: 신한은행')}
                  {renderInput('자동이체 계좌번호', 'text', customerBankAccount, setCustomerBankAccount, '계좌번호 입력')}
                  {renderInput('자동이체 예금주', 'text', customerBankHolder, setCustomerBankHolder)}
                </div>

                {selectedCompanyId ? (
                  <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px dashed var(--border-color)' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.6rem' }}>
                      <input
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png"
                        onChange={(e) => setPendingBankFile(e.target.files?.[0] || null)}
                        style={{ fontSize: '0.78rem', flex: 1 }}
                      />
                      <button
                        type="button"
                        onClick={handleUploadBankDocument}
                        disabled={!pendingBankFile || uploadingBankDoc}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.3rem',
                          background: pendingBankFile ? 'var(--primary)' : '#d9d9d9', color: '#fff', border: 'none',
                          padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: '600',
                          cursor: pendingBankFile && !uploadingBankDoc ? 'pointer' : 'not-allowed'
                        }}
                      >
                        <Upload size={13} /> {uploadingBankDoc ? '업로드 중...' : '통장사본 업로드'}
                      </button>
                    </div>
                    {bankDocuments.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        {bankDocuments.map(doc => (
                          <div key={doc._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.4rem 0.6rem', fontSize: '0.78rem' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.originalName || doc.fileName}</span>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
                              <a
                                href="#"
                                onClick={(e) => {
                                  e.preventDefault();
                                  downloadFile(`${API_HOST}/api/companies/${selectedCompanyId}/documents/${doc._id}/download`, doc.fileName || '서류')
                                    .catch((err) => showToast(err.message, 'error'));
                                }}
                                style={{ color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
                              >
                                <Download size={13} /> 다운로드
                              </a>
                              <button type="button" onClick={() => handleDeleteBankDocument(doc._id)} style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}>
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px dashed var(--border-color)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    통장사본 파일 업로드는 법인이 선택된 경우에만 가능합니다.
                  </div>
                )}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                이 계약으로 묶이는 차량 <strong style={{ color: 'var(--text-bright)' }}>{vehicleList.length}대</strong>
                <span style={{ marginLeft: '0.5rem' }}>· 청구서와 세금계산서는 계약서 단위로 나갑니다.</span>
              </span>
              <button
                type="button"
                onClick={addVehicle}
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid var(--primary)', background: '#fff', color: 'var(--primary)', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer' }}
              >
                <Plus size={14} /> 차량 추가
              </button>
            </div>

            {vehicleList.map((veh, index) => (
              <div key={index} style={{ border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1rem', background: index === 0 ? '#fff' : 'var(--bg-main)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
                  <span style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-bright)' }}>
                    차량 {index + 1}{index === 0 ? '' : ''}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {index > 0 && (
                      <button
                        type="button"
                        onClick={() => copyFromPreviousVehicle(index)}
                        title="바로 위 차량의 내용을 그대로 가져옵니다. 차량번호와 차대번호는 그대로 둡니다."
                        style={{ border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer' }}
                      >
                        차량 {index} 정보 가져오기
                      </button>
                    )}
                    {vehicleList.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeVehicleAt(index)}
                        title="이 차량 빼기"
                        style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                  {renderInput('차종 *', 'text', veh.model, (v) => updateVehicleAt(index, 'model', v), '예: Ray, 그랜저', index === 0)}
                  {renderInput('옵션', 'text', veh.options, (v) => updateVehicleAt(index, 'options', v), '예: 선루프, 네비게이션 등')}
                  {renderMoneyInput('차량가 (원)', veh.price, (v) => updateVehicleAt(index, 'price', v), '예: 32,000,000')}
                  {renderSelect('유종', veh.fuelType, (v) => updateVehicleAt(index, 'fuelType', v), [
                    { value: '가솔린', label: '가솔린' },
                    { value: '디젤', label: '디젤' },
                    { value: 'LPG', label: 'LPG' },
                    { value: '하이브리드', label: '하이브리드' },
                    { value: '전기', label: '전기' }
                  ])}
                  {renderInput('배기량 (cc)', 'number', veh.cc, (v) => updateVehicleAt(index, 'cc', v), '예: 2500')}
                  {renderInput('외장 색상', 'text', veh.color, (v) => updateVehicleAt(index, 'color', v), '예: 스노우 화이트')}
                  {renderInput('내장 색상', 'text', veh.colorInterior, (v) => updateVehicleAt(index, 'colorInterior', v), '예: 블랙 가죽')}
                  {renderInput('차량번호', 'text', veh.plateNo, (v) => updateVehicleAt(index, 'plateNo', v), '출고 후 입력')}
                </div>
              </div>
            ))}
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

              {/* 계약 조건 - 연체 이자 계산과 중도해지 정산에 쓰인다 */}
              <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                {renderInput('연체 이율 (연 %)', 'number', lateInterestRate, setLateInterestRate, '예: 25')}
                {renderInput('중도해지 수수료율 (%)', 'number', earlyTerminationRate, setEarlyTerminationRate, '예: 35')}
              </div>

              {/* 2번째 행: 월 렌트료, 보증금, 선수금, 인수가, 옵션가 */}
              <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginTop: '0.2rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '600', marginBottom: '0.3rem', color: 'var(--text-main)' }}>
                    월 렌트료 <span style={{ color: 'var(--error)' }}>*</span>
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={toCommaString(pricing.monthlyFee)}
                    onChange={(e) => handlePricingChange('monthlyFee', parseNumber(e.target.value))}
                    style={{ width: '100%', padding: '0.45rem 0.6rem', border: '1px solid var(--primary)', borderRadius: '6px', fontSize: '0.85rem', textAlign: 'right' }}
                  />
                </div>
                {renderMoneyInput('보증금 (원)', pricing.deposit, (val) => handlePricingChange('deposit', val))}
                {renderMoneyInput('선수금 (원)', pricing.advancePayment, (val) => handlePricingChange('advancePayment', val))}
                {renderMoneyInput('인수가 (원)', pricing.takeoverPrice, (val) => handlePricingChange('takeoverPrice', val))}
                {/* 옵션가는 차량가와 따로 남긴다. 견적서에서 불러오면 자동으로 채워진다. */}
                {renderMoneyInput('옵션가 (원)', pricing.optionPrice, (val) => handlePricingChange('optionPrice', val))}
              </div>

              {/* 일반 계약 세부 정보: 계약일, 담당자, 연락처 */}
              <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginTop: '0.2rem' }}>
                {renderInput('계약일', 'date', contractDate, setContractDate, '', true)}
                {renderInput('계약 담당자', 'text', managerOps, setManagerOps)}
                {renderInput('계약 담당자 연락처', 'text', managerOpsPhone, setManagerOpsPhone, '010-XXXX-XXXX')}
              </div>

              {/* 하단 세부 정보: 이메일 1, 이메일 2, 고지서 처리 방식, 연체이율, 위약금 */}
              <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginTop: '0.2rem' }}>
                {renderInput('범칙금 수신 E-MAIL 1', 'email', finesEmail, setFinesEmail, 'fines@example.com')}
                {renderInput('범칙금 수신 E-MAIL 2', 'email', finesEmail2, setFinesEmail2, 'backup@example.com')}
                {/*
                  고지서를 어떻게 처리할지 계약할 때 정해 둔다.
                  건마다 물어보면 매일 오는 고지서를 하나씩 판단해야 해서, 미리 정해 두고
                  예외가 생긴 건만 고지서 관리 화면에서 바꾼다.
                */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-main)' }}>
                    고지서 처리 방식
                  </label>
                  <select
                    value={fineHandling}
                    onChange={(e) => setFineHandling(e.target.value)}
                    style={{
                      width: '100%', padding: '0.45rem 0.6rem', border: '1px solid var(--border-color)',
                      borderRadius: '6px', fontSize: '0.85rem', backgroundColor: '#fff',
                      color: 'var(--text-bright)', cursor: 'pointer'
                    }}
                  >
                    <option value="대납청구">대납 후 청구</option>
                    <option value="고객납부">고객 직접 납부</option>
                    <option value="명의변경">명의 변경</option>
                  </select>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {fineHandling === '대납청구' && '우리가 먼저 내고 다음 청구서에 얹습니다'}
                    {fineHandling === '고객납부' && '담당자를 거쳐 운전자가 냅니다. 기한을 지켜봐야 합니다'}
                    {fineHandling === '명의변경' && '관공서에 넘겨 고객에게 직접 고지되게 합니다'}
                  </span>
                </div>
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
                  {renderInput('타이어 등급', 'text', maintenance.tireType, () => {}, '견적서에서 선택', false, true)}
                  {renderInput('연간 주행거리 (km)', 'text', maintenance.mileage ? Number(maintenance.mileage).toLocaleString() : '', () => {}, '견적서에서 선택', false, true)}
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
            fetchContractsList();
            setViewMode('list');
          }}
          style={{ background: '#fff', border: '1px solid var(--border-color)', padding: '0.6rem 1.5rem', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem' }}
        >
          <MenuCancelText>취소</MenuCancelText>
        </button>
        {/* 이미 정식 등록된 계약(차량이 있는 계약)을 고치는 중이면 "임시저장"은 의미가 없어 숨긴다 */}
        {(!prefilledContractData || !prefilledContractData.vehicle) && (
          <button
            type="button"
            onClick={handleSaveDraft}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#fff', color: 'var(--text-main)', border: '1px solid var(--border-color)', padding: '0.6rem 1.5rem', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem' }}
          >
            <Clock size={16} /> 임시저장
          </button>
        )}
        <button
          type="submit"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.6rem 1.5rem', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem' }}
        >
          <Save size={16} /> 출고 준비로 전환
        </button>
      </div>

    </form>
      )}
    </div>
  );
}

// Simple text wrapper helper to avoid variable confusion
const MenuCancelText = ({ children }) => <span>{children}</span>;

export default ContractRegisterView;
