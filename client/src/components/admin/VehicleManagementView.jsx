import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { 
  Search, 
  Plus, 
  Edit3, 
  Trash2, 
  X, 
  Save, 
  FileSpreadsheet, 
  Download,
  Filter,
  CheckCircle2,
  List,
  Layers,
  Calendar,
  CreditCard,
  Shield,
  Gift
} from 'lucide-react';

const getTabForField = (field) => {
  const basicFields = [
    'carNumber', 'carModel', 'category', 'operation', 'contractCompany', 'manager', 
    'managerPhone', 'carSpec', 'carPrice', 'year', 'color', 'fuelType', 'vin', 'options', 'cc', 'regDate'
  ];
  const contractFields = [
    'contractDate', 'deliveryDate', 'rentPeriodYears', 'rentEndDate', 'remainingPeriod', 
    'mileage', 'practicalManager', 'practicalPhone', 'branch', 'deliveryAddress', 
    'rentStartDate', 'rentPeriodDays', 'remainingPeriodCalc', 'contractNo'
  ];
  const priceFields = [
    'basePrice', 'discountAmount', 'supplyAmount', 'consignmentFee', 'mandatoryInsuranceFee', 
    'acquisitionTax', 'bond', 'stampFee', 'plateFee', 'regAgencyFee', 'commission', 
    'dashcam', 'dashcamInfo', 'tinting', 'tintingInfo', 'regCost1', 'regCost2'
  ];
  const insuranceFields = [
    'insuranceCompany', 'insuranceStartDate', 'insuranceFee', 'ownCarInsuranceFee', 'driverAge', 
    'personalInjury1', 'propertyDamage', 'personalInjury2', 'uninsuredCarInjury', 'deductible', 
    'insuranceType', 'emergencyService', 'accidentRepair', 'generalMaintenance', 'consumablesExchange', 
    'tireCount', 'tireType', 'tireCost', 'carTax', 'tire', 'regularCheckup'
  ];
  const financeFields = [
    'lender', 'executionDate', 'installmentAmount', 'installmentPeriod', 'monthlyInstallment', 
    'totalMonthlyInstallment', 'totalInterest', 'interestRate', 'monthlyFeePayDay', 'invoiceDate', 
    'monthlyPayment', 'paymentPeriod', 'totalMonthlyPayment', 'deposit', 'advancePayment', 
    'acquisitionValue', 'residualRateP', 'interest2', 'fineEmail', 'managerMobile'
  ];
  
  if (basicFields.includes(field)) return 'basic';
  if (contractFields.includes(field)) return 'contract';
  if (priceFields.includes(field)) return 'price';
  if (insuranceFields.includes(field)) return 'insurance';
  if (financeFields.includes(field)) return 'finance';
  return 'gifts';
};

const getRowBgColor = (operation, index, isHovered = false, isSelected = false) => {
  if (isSelected) {
    return isHovered ? '#c6d9ff' : '#d6e4ff';
  }
  
  if (operation === '장기렌트') {
    return isHovered ? '#bae7ff' : (index % 2 === 0 ? '#f4faff' : '#e6f7ff'); // Extremely Light Blue vs Light Blue
  }
  if (operation === '사고대차') {
    return isHovered ? '#ffccc7' : (index % 2 === 0 ? '#fff9f8' : '#fff1f0'); // Extremely Light Red vs Light Red
  }
  if (operation === '계약진행중') {
    return isHovered ? '#fffb8f' : (index % 2 === 0 ? '#fffdf0' : '#feffe6'); // Extremely Light Yellow vs Light Yellow
  }
  
  return isHovered ? '#e6f4ff' : (index % 2 === 0 ? '#ffffff' : '#fcfcfc'); // White vs Light Gray
};

function VehicleManagementView({ showToast, currentUser }) {
  // Sub Tab: 'rent_benefit' (RENT BENefit 렌터카 DB) | 'benefit_car' (BENefit 차량 DB)
  const [subTab, setSubTab] = useState('rent_benefit');

  const handleTableWheel = (e) => {
    const container = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = container;
    
    if (e.deltaY !== 0) {
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;
      const isAtTop = scrollTop <= 0;
      
      if ((e.deltaY > 0 && isAtBottom) || (e.deltaY < 0 && isAtTop)) {
        const mainContainer = container.closest('main');
        if (mainContainer) {
          mainContainer.scrollTop += e.deltaY;
        }
      }
    }
  };

  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [fuelFilter, setFuelFilter] = useState('all');
  const [operationFilter, setOperationFilter] = useState('all');

  // Pagination & Stats
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ totalCount: 0, totalPages: 1, limit: 10000 });
  const [stats, setStats] = useState({ total: 0, longTermRent: 0, accidentSubstitution: 0, contractInProgress: 0 });

  // Add/Edit Modal State
  const [showModal, setShowModal] = useState(false);
  const [modalTab, setModalTab] = useState('basic'); // 'basic', 'contract', 'price', 'insurance', 'finance', 'gifts'
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [focusedField, setFocusedField] = useState(null);
  const [justUpdated, setJustUpdated] = useState(null);
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);

  const initialFormState = {
    no: '',
    category: '',
    operation: '',
    contractCompany: '',
    manager: '',
    managerPhone: '',
    carModel: '',
    carSpec: '',
    carPrice: 0,
    year: '2024년식',
    color: '블랙',
    fuelType: '휘발유',
    vin: '',
    carNumber: '',
    options: '',
    cc: '',
    regDate: '',
    contractDate: '',
    deliveryDate: '',
    rentPeriodYears: '3년',
    rentEndDate: '',
    remainingPeriod: '',
    mileage: 0,
    practicalManager: '',
    practicalPhone: '',
    branch: '',
    deliveryAddress: '',
    rentStartDate: '',
    rentPeriodDays: '',
    remainingPeriodCalc: '',
    contractNo: '',
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
    propertyDamage: '1억원',
    personalInjury2: '1억원',
    uninsuredCarInjury: '2억원',
    deductible: 300000,
    insuranceType: '법인임직원특약',
    emergencyService: '가입',
    accidentRepair: '',
    generalMaintenance: '',
    consumablesExchange: '',
    tireCount: '',
    tireType: '',
    tireCost: 0,
    carTax: '월대여료 포함',
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
    monthlyPayment: 0,
    paymentPeriod: '36',
    totalMonthlyPayment: 0,
    deposit: 0,
    advancePayment: 0,
    acquisitionValue: 0,
    residualRateP: '',
    interest2: '',
    fineEmail: '',
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
    accountHolder: '',
    bank: '',
    accountNo: '',
    bizOrRegNo: '',
    bizAddress: '',
    penaltyRate: '',
    overdueInterestRate: '',
    corporateRegNo: '',
    individualConsumptionTax: 0,
    status: 'rented',
    notes: ''
  };

  const [formData, setFormData] = useState(initialFormState);
  const [parsedQuoteSummary, setParsedQuoteSummary] = useState(null);
  const [hoveredCard, setHoveredCard] = useState(null);
  const [limit, setLimit] = useState(10000);

  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:5000`;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    fetchVehicles();
  }, [page, debouncedSearch, statusFilter, fuelFilter, operationFilter, limit]);

  async function fetchVehicles() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page,
        limit,
        search: debouncedSearch,
        status: statusFilter,
        fuelType: fuelFilter,
        operation: operationFilter
      });

      const res = await fetch(`${API_BASE_URL}/api/vehicles?${params}`);
      const data = await res.json();

      if (data.success) {
        setVehicles(data.vehicles || []);
        setPagination(data.pagination || { totalCount: 0, totalPages: 1, limit: 100 });
        setStats(data.stats || { total: 0, longTermRent: 0, accidentSubstitution: 0, contractInProgress: 0 });
      } else {
        if (showToast) showToast('차량 목록을 불러오지 못했습니다.', 'error');
      }
    } catch (err) {
      console.error('Fetch vehicles error:', err);
    } finally {
      setLoading(false);
    }
  };

  const openAddModal = () => {
    setEditingVehicle(null);
    setFormData({
      ...initialFormState,
      no: (pagination.totalCount || 0) + 1,
      carNumber: `123가${Math.floor(1000 + Math.random() * 9000)}`
    });
    setParsedQuoteSummary(null);
    setModalTab('basic');
    setFocusedField(null);
    setShowModal(true);
  };

  const openEditModal = (vehicle, initialTab = 'basic', fieldToFocus = null) => {
    setEditingVehicle(vehicle);
    setFormData({ ...initialFormState, ...vehicle });
    setParsedQuoteSummary(null);
    setModalTab(initialTab);
    setFocusedField(fieldToFocus);
    setSelectedVehicleId(vehicle._id);
    setShowModal(true);
  };

  const isFormDirty = () => {
    const base = editingVehicle ? { ...initialFormState, ...editingVehicle } : {
      ...initialFormState,
      no: formData.no,
      carNumber: formData.carNumber
    };
    
    return Object.keys(initialFormState).some(key => {
      const norm = (v) => (v === undefined || v === null ? '' : String(v).trim());
      return norm(formData[key]) !== norm(base[key]);
    });
  };

  const handleCloseModal = async () => {
    setParsedQuoteSummary(null);
    if (isFormDirty()) {
      if (window.confirm('수정된 정보가 있습니다. 저장하시겠습니까?')) {
        const success = await handleSubmit();
        if (success) {
          setShowModal(false);
          setFocusedField(null);
        }
      } else {
        setShowModal(false);
        setFocusedField(null);
      }
    } else {
      setShowModal(false);
      setFocusedField(null);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (showModal) {
        if (e.key === 'Escape') {
          handleCloseModal();
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault();
          handleSubmit();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal, formData, editingVehicle, handleCloseModal, handleSubmit]);

  useEffect(() => {
    if (showModal && focusedField) {
      const timer = setTimeout(() => {
        const element = document.querySelector(
          `form input[name="${focusedField}"], form select[name="${focusedField}"], form textarea[name="${focusedField}"]`
        );
        if (element) {
          element.focus();
          
          // Store original styles to revert properly
          const origBorder = element.style.border;
          const origBoxShadow = element.style.boxShadow;
          const origBgColor = element.style.backgroundColor;
          const origOutline = element.style.outline;
          
          element.style.outline = 'none';
          element.style.border = '2px solid #107c41';
          element.style.boxShadow = '0 0 10px rgba(16, 124, 65, 0.5)';
          element.style.backgroundColor = '#e6f7ff';
          
          // Revert back smoothly after 2.5 seconds
          setTimeout(() => {
            element.style.transition = 'background-color 1s, border 1s, box-shadow 1s';
            element.style.backgroundColor = origBgColor;
            element.style.border = origBorder;
            element.style.boxShadow = origBoxShadow;
            element.style.outline = origOutline;
          }, 2500);
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [showModal, modalTab, focusedField]);

  const lastHighlightedRef = useRef(null);

  useEffect(() => {
    if (justUpdated && vehicles.length > 0) {
      if (lastHighlightedRef.current === justUpdated.timestamp) return;

      const row = document.querySelector(`tr[data-vehicle-id="${justUpdated.vehicleId}"]`);
      if (row) {
        lastHighlightedRef.current = justUpdated.timestamp;
        justUpdated.fields.forEach(field => {
          const cell = row.querySelector(`td[data-field="${field}"]`);
          if (cell) {
            cell.classList.add('cell-updated-highlight');
            setTimeout(() => {
              cell.classList.remove('cell-updated-highlight');
            }, 5000);
          }
        });
      }
    }
  }, [justUpdated, vehicles]);

  useEffect(() => {
    if (!showModal && selectedVehicleId && vehicles.length > 0) {
      const timer = setTimeout(() => {
        const row = document.querySelector(`tr[data-vehicle-id="${selectedVehicleId}"]`);
        if (row) {
          row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [showModal, selectedVehicleId, vehicles]);

  const handleQuoteUpload = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        const findValueByLabel = (label, offsetCols = 1, offsetRows = 0) => {
          const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:Z100');
          for (let r = range.s.r; r <= range.e.r; r++) {
            for (let c = range.s.c; c <= range.e.c; c++) {
              const cellRef = XLSX.utils.encode_cell({ r, c });
              const cell = sheet[cellRef];
              if (cell && cell.v && typeof cell.v === 'string') {
                const cleanCellVal = cell.v.replace(/\s+/g, '');
                const cleanLabel = label.replace(/\s+/g, '');
                if (cleanCellVal.includes(cleanLabel)) {
                  const targetRef = XLSX.utils.encode_cell({ r: r + offsetRows, c: c + offsetCols });
                  const targetCell = sheet[targetRef];
                  return targetCell ? (targetCell.v !== undefined ? targetCell.v : targetCell.w || '') : '';
                }
              }
            }
          }
          return '';
        };

        let tableData = {};
        const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:Z100');
        let headerRow = -1;
        let headers = {};

        for (let r = range.s.r; r <= range.e.r; r++) {
          for (let c = range.s.c; c <= range.e.c; c++) {
            const cellRef = XLSX.utils.encode_cell({ r, c });
            const cell = sheet[cellRef];
            if (cell && cell.v && typeof cell.v === 'string') {
              const val = cell.v.trim();
              if (['구분', '차종', '수량', '계약기간', '차량가격', '보증금', '선수금', '인수가', '월대여료'].includes(val)) {
                headerRow = r;
                headers[val] = c;
              }
            }
          }
          if (headerRow !== -1 && Object.keys(headers).length >= 4) {
            break;
          }
        }

        if (headerRow !== -1) {
          const dataRow = headerRow + 1;
          const getValByHeader = (headerName) => {
            const col = headers[headerName];
            if (col === undefined) return '';
            const cellRef = XLSX.utils.encode_cell({ r: dataRow, c: col });
            const cell = sheet[cellRef];
            return cell ? (cell.v !== undefined ? cell.v : cell.w || '') : '';
          };

          tableData = {
            carModel: getValByHeader('차종'),
            contractPeriod: getValByHeader('계약기간'),
            carPrice: getValByHeader('차량가격'),
            deposit: getValByHeader('보증금'),
            advancePayment: getValByHeader('선수금'),
            acquisitionValue: getValByHeader('인수가'),
            monthlyPayment: getValByHeader('월대여료'),
          };
        }

        const cleanNumber = (val) => {
          if (!val) return 0;
          if (typeof val === 'number') return val;
          const clean = String(val).replace(/[^0-9.-]/g, '');
          const num = parseFloat(clean);
          return isNaN(num) ? 0 : num;
        };

        const cleanString = (val) => {
          if (val === undefined || val === null) return '';
          return String(val).trim();
        };

        const carModel = cleanString(tableData.carModel || findValueByLabel('차종', 1));
        const options = cleanString(findValueByLabel('옵션', 1));
        const color = cleanString(findValueByLabel('색상', 1));
        const carPrice = cleanNumber(tableData.carPrice || findValueByLabel('차량가격', 1));

        const rawPeriod = tableData.contractPeriod || findValueByLabel('계약기간', 1);
        const contractPeriodNum = cleanNumber(rawPeriod);
        const rentPeriodYears = contractPeriodNum > 0 ? `${Math.floor(contractPeriodNum / 12)}년` : '3년';
        const paymentPeriod = contractPeriodNum > 0 ? String(contractPeriodNum) : '36';

        const deposit = cleanNumber(tableData.deposit || findValueByLabel('보증금', 1));
        const advancePayment = cleanNumber(tableData.advancePayment || findValueByLabel('선수금', 1));
        const acquisitionValue = cleanNumber(tableData.acquisitionValue || findValueByLabel('인수가', 1));
        const monthlyPayment = cleanNumber(tableData.monthlyPayment || findValueByLabel('월대여료', 1));

        const insuranceType = cleanString(findValueByLabel('운전 범위', 1) || findValueByLabel('운전범위', 1));
        const driverAge = cleanString(findValueByLabel('운전자 연령', 1) || findValueByLabel('운전자연령', 1));
        const personalInjury1 = cleanString(findValueByLabel('대인', 1));
        const propertyDamage = cleanString(findValueByLabel('대물', 1));

        let personalInjury2 = cleanString(findValueByLabel('자기신체', 1));
        if (!personalInjury2) personalInjury2 = cleanString(findValueByLabel('자상', 1));
        if (!personalInjury2) personalInjury2 = cleanString(findValueByLabel('자기손해', 1));

        const rawDeductible = findValueByLabel('자기부담금(CMD)', 1) || findValueByLabel('자기부담금', 1);
        const deductible = cleanNumber(rawDeductible) || (String(rawDeductible).includes('30만') ? 300000 : 300000);
        const uninsuredCarInjury = cleanString(findValueByLabel('무보험차상해', 1));
        const emergencyService = cleanString(findValueByLabel('긴급출동', 1));

        const regularCheckup = cleanString(findValueByLabel('순회정비', 1) || findValueByLabel('순회점검', 1));
        const generalMaintenance = cleanString(findValueByLabel('일반정비', 1));
        const consumablesExchange = cleanString(findValueByLabel('소모품 교환', 1) || findValueByLabel('소모품교환', 1));
        const tireType = cleanString(findValueByLabel('타이어 교체', 1) || findValueByLabel('타이어교체', 1));

        setFormData(prev => ({
          ...prev,
          carModel: carModel || prev.carModel,
          options: options || prev.options,
          color: color || prev.color,
          carPrice: carPrice || prev.carPrice,
          rentPeriodYears: rentPeriodYears || prev.rentPeriodYears,
          paymentPeriod: paymentPeriod || prev.paymentPeriod,
          deposit: deposit || prev.deposit,
          advancePayment: advancePayment || prev.advancePayment,
          acquisitionValue: acquisitionValue || prev.acquisitionValue,
          monthlyPayment: monthlyPayment || prev.monthlyPayment,

          insuranceType: insuranceType || prev.insuranceType,
          driverAge: driverAge || prev.driverAge,
          personalInjury1: personalInjury1 || prev.personalInjury1,
          propertyDamage: propertyDamage || prev.propertyDamage,
          personalInjury2: personalInjury2 || prev.personalInjury2,
          deductible: deductible || prev.deductible,
          uninsuredCarInjury: uninsuredCarInjury || prev.uninsuredCarInjury,
          emergencyService: emergencyService || prev.emergencyService,

          regularCheckup: regularCheckup || prev.regularCheckup,
          generalMaintenance: generalMaintenance || prev.generalMaintenance,
          consumablesExchange: consumablesExchange || prev.consumablesExchange,
          tireType: tireType || prev.tireType,
        }));

        setParsedQuoteSummary({
          carModel,
          carPrice,
          deposit,
          advancePayment,
          acquisitionValue,
          monthlyPayment,
          contractPeriod: contractPeriodNum || 48,
          driverAge
        });

        if (showToast) showToast('견적서 엑셀 파일을 성공적으로 불러와 입력란에 자동 적용했습니다.', 'success');
      } catch (err) {
        console.error('Quote parse error:', err);
        if (showToast) showToast('견적서 파일 분석 중 오류가 발생했습니다. 양식을 확인해주세요.', 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleFormChange = (e) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? (value === '' ? 0 : Number(value)) : value
    }));
  };

  async function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!formData.operation) {
      if (showToast) showToast('운영 구분은 필수 입력 항목입니다.', 'warning');
      return false;
    }

    if (currentUser?.role === 'viewer') {
      if (showToast) showToast('수정 및 등록 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return false;
    }

    try {
      const url = editingVehicle 
        ? `${API_BASE_URL}/api/vehicles/${editingVehicle._id}` 
        : `${API_BASE_URL}/api/vehicles`;
      
      const method = editingVehicle ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 
          'Content-Type': 'application/json',
          'X-User-Role': currentUser?.role || 'viewer'
        },
        body: JSON.stringify(formData)
      });

      const data = await res.json();

      if (data.success) {
        if (showToast) showToast(editingVehicle ? '차량 대장이 수정되었습니다.' : '신규 차량 대장이 추가되었습니다.', 'success');
        
        if (editingVehicle) {
          const changedFields = [];
          const norm = (v) => (v === undefined || v === null ? '' : String(v).trim());
          Object.keys(formData).forEach(key => {
            if (norm(formData[key]) !== norm(editingVehicle[key])) {
              changedFields.push(key);
            }
          });
          if (changedFields.length > 0) {
            setJustUpdated({
              vehicleId: editingVehicle._id,
              fields: changedFields,
              timestamp: Date.now()
            });
          }
        } else if (data.vehicle && data.vehicle._id) {
          setSelectedVehicleId(data.vehicle._id);
        }

        setShowModal(false);
        setFocusedField(null);
        fetchVehicles();
        return true;
      } else {
        if (showToast) showToast(data.message || '저장에 실패하였습니다.', 'error');
        return false;
      }
    } catch (err) {
      console.error('Save vehicle error:', err);
      if (showToast) showToast('서버 통신 실패', 'error');
      return false;
    }
  };

  const handleDeleteVehicle = async (id, carNumber) => {
    if (currentUser?.role === 'viewer') {
      if (showToast) showToast('수정 및 삭제 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (!window.confirm(`정말로 차량 [${carNumber}] 대장 기록을 삭제하시겠습니까?`)) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/vehicles/${id}`, { 
        method: 'DELETE',
        headers: {
          'X-User-Role': currentUser?.role || 'viewer'
        }
      });
      const data = await res.json();
      if (data.success) {
        if (showToast) showToast(`차량 [${carNumber}] 삭제 완료`, 'info');
        fetchVehicles();
      } else {
        if (showToast) showToast(data.message || '삭제 실패', 'error');
      }
    } catch (err) {
      console.error('Delete vehicle error:', err);
      if (showToast) showToast('삭제 처리 오류', 'error');
    }
  };

  const handleSeedData = async () => {
    if (currentUser?.role === 'viewer') {
      if (showToast) showToast('수정 및 등록 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (!window.confirm('전체 엑셀 시트 컬럼 구조의 샘플 데이터로 리셋하시겠습니까?')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/vehicles/seed`, { 
        method: 'POST',
        headers: {
          'X-User-Role': currentUser?.role || 'viewer'
        }
      });
      const data = await res.json();
      if (data.success) {
        if (showToast) showToast(data.message, 'success');
        fetchVehicles();
      }
    } catch (err) {
      console.error('Seed error:', err);
    }
  };

  const renderStatusBadge = (status) => {
    switch (status) {
      case 'rented':
        return <span style={{ background: '#e6f7ff', color: '#1890ff', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '700' }}>🚗 대여중</span>;
      case 'available':
        return <span style={{ background: '#f6ffed', color: '#52c41a', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '700' }}>🅿️ 대기중</span>;
      case 'maintenance':
        return <span style={{ background: '#fff7e6', color: '#fa8c16', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '700' }}>🔧 정비중</span>;
      case 'reserved':
        return <span style={{ background: '#f9f0ff', color: '#722ed1', padding: '0.2rem 0.6rem', borderRadius: '4px', fontSize: '0.75rem', fontWeight: '700' }}>📋 예약됨</span>;
      default:
        return null;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%' }}>
      {/* 1. 상단 DB 서브 탭 전환 컨트롤러 */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '1rem',
        borderBottom: '2px solid var(--border-color)',
        paddingBottom: '0.8rem'
      }}>
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button
            onClick={() => setSubTab('rent_benefit')}
            style={{
              padding: '0.7rem 1.4rem',
              borderRadius: '8px',
              border: 'none',
              background: subTab === 'rent_benefit' ? 'var(--primary)' : 'var(--bg-surface)',
              color: subTab === 'rent_benefit' ? '#ffffff' : 'var(--text-muted)',
              fontWeight: '700',
              cursor: 'pointer',
              fontSize: '0.95rem',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxShadow: subTab === 'rent_benefit' ? '0 4px 12px rgba(54,124,255,0.3)' : 'none'
            }}
          >
            <span>🏎️ RENT BENefit 렌터카 대장 DB (113개 전체 컬럼)</span>
          </button>

          <button
            onClick={() => setSubTab('benefit_car')}
            style={{
              padding: '0.7rem 1.4rem',
              borderRadius: '8px',
              border: 'none',
              background: subTab === 'benefit_car' ? 'var(--primary)' : 'var(--bg-surface)',
              color: subTab === 'benefit_car' ? '#ffffff' : 'var(--text-muted)',
              fontWeight: '700',
              cursor: 'pointer',
              fontSize: '0.95rem',
              transition: 'all 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              boxShadow: subTab === 'benefit_car' ? '0 4px 12px rgba(54,124,255,0.3)' : 'none'
            }}
          >
            <span>🚗 BENefit 차량 Asset 명세 DB</span>
          </button>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={handleSeedData}
            style={{
              padding: '0.55rem 1rem',
              borderRadius: '6px',
              border: '1px solid #d9d9d9',
              background: '#ffffff',
              color: '#595959',
              fontSize: '0.85rem',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            <FileSpreadsheet size={15} /> 엑셀 샘플 데이터 복원
          </button>

          <button
            onClick={openAddModal}
            style={{
              padding: '0.55rem 1.2rem',
              borderRadius: '6px',
              border: 'none',
              background: '#20744a',
              color: '#ffffff',
              fontSize: '0.85rem',
              fontWeight: '700',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              boxShadow: '0 2px 6px rgba(32,116,74,0.3)'
            }}
          >
            <Plus size={16} /> 렌터카 추가
          </button>
        </div>
      </div>

      {/* 2. 대시보드 요약 카운트 카드 */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
        gap: '1rem' 
      }}>
        {/* 카드 1: 총 대장 등록 현황 */}
        <div 
          onClick={() => { setOperationFilter('all'); setPage(1); }}
          onMouseEnter={() => setHoveredCard('all')}
          onMouseLeave={() => setHoveredCard(null)}
          style={{ 
            background: 'var(--bg-surface)', 
            padding: '1rem 1.2rem', 
            borderRadius: '10px', 
            borderTop: operationFilter === 'all' ? '2px solid #1890ff' : '1px solid var(--border-color)', 
            borderRight: operationFilter === 'all' ? '2px solid #1890ff' : '1px solid var(--border-color)', 
            borderBottom: operationFilter === 'all' ? '2px solid #1890ff' : '1px solid var(--border-color)', 
            borderLeft: '4px solid #1890ff',
            cursor: 'pointer',
            transform: hoveredCard === 'all' ? 'translateY(-3px)' : 'none',
            boxShadow: operationFilter === 'all' 
              ? '0 4px 12px rgba(24, 144, 255, 0.25)' 
              : (hoveredCard === 'all' ? '0 6px 16px rgba(0,0,0,0.1)' : '0 2px 4px rgba(0,0,0,0.05)'),
            transition: 'all 0.2s ease-in-out'
          }}
        >
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: '600' }}>📊 총 대장 등록 현황</span>
          <h3 style={{ fontSize: '1.5rem', fontWeight: '800', margin: '0.3rem 0 0 0', color: 'var(--text-bright)' }}>{stats.total} 대</h3>
        </div>

        {/* 카드 2: 계약진행 현황 */}
        <div 
          onClick={() => { setOperationFilter('계약진행중'); setPage(1); }}
          onMouseEnter={() => setHoveredCard('계약진행중')}
          onMouseLeave={() => setHoveredCard(null)}
          style={{ 
            background: 'var(--bg-surface)', 
            padding: '1rem 1.2rem', 
            borderRadius: '10px', 
            borderTop: operationFilter === '계약진행중' ? '2px solid #722ed1' : '1px solid var(--border-color)', 
            borderRight: operationFilter === '계약진행중' ? '2px solid #722ed1' : '1px solid var(--border-color)', 
            borderBottom: operationFilter === '계약진행중' ? '2px solid #722ed1' : '1px solid var(--border-color)', 
            borderLeft: '4px solid #722ed1',
            cursor: 'pointer',
            transform: hoveredCard === '계약진행중' ? 'translateY(-3px)' : 'none',
            boxShadow: operationFilter === '계약진행중' 
              ? '0 4px 12px rgba(114, 46, 209, 0.25)' 
              : (hoveredCard === '계약진행중' ? '0 6px 16px rgba(0,0,0,0.1)' : '0 2px 4px rgba(0,0,0,0.05)'),
            transition: 'all 0.2s ease-in-out'
          }}
        >
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: '600' }}>🔧 계약진행 현황</span>
          <h3 style={{ fontSize: '1.5rem', fontWeight: '800', margin: '0.3rem 0 0 0', color: '#722ed1' }}>{stats.contractInProgress} 대</h3>
        </div>

        {/* 카드 3: 장기렌트 현황 */}
        <div 
          onClick={() => { setOperationFilter('장기렌트'); setPage(1); }}
          onMouseEnter={() => setHoveredCard('장기렌트')}
          onMouseLeave={() => setHoveredCard(null)}
          style={{ 
            background: 'var(--bg-surface)', 
            padding: '1rem 1.2rem', 
            borderRadius: '10px', 
            borderTop: operationFilter === '장기렌트' ? '2px solid #52c41a' : '1px solid var(--border-color)', 
            borderRight: operationFilter === '장기렌트' ? '2px solid #52c41a' : '1px solid var(--border-color)', 
            borderBottom: operationFilter === '장기렌트' ? '2px solid #52c41a' : '1px solid var(--border-color)', 
            borderLeft: '4px solid #52c41a',
            cursor: 'pointer',
            transform: hoveredCard === '장기렌트' ? 'translateY(-3px)' : 'none',
            boxShadow: operationFilter === '장기렌트' 
              ? '0 4px 12px rgba(82, 196, 26, 0.25)' 
              : (hoveredCard === '장기렌트' ? '0 6px 16px rgba(0,0,0,0.1)' : '0 2px 4px rgba(0,0,0,0.05)'),
            transition: 'all 0.2s ease-in-out'
          }}
        >
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: '600' }}>🚗 장기렌트 현황</span>
          <h3 style={{ fontSize: '1.5rem', fontWeight: '800', margin: '0.3rem 0 0 0', color: '#52c41a' }}>{stats.longTermRent} 대</h3>
        </div>

        {/* 카드 4: 사고대차 현황 */}
        <div 
          onClick={() => { setOperationFilter('사고대차'); setPage(1); }}
          onMouseEnter={() => setHoveredCard('사고대차')}
          onMouseLeave={() => setHoveredCard(null)}
          style={{ 
            background: 'var(--bg-surface)', 
            padding: '1rem 1.2rem', 
            borderRadius: '10px', 
            borderTop: operationFilter === '사고대차' ? '2px solid #fa8c16' : '1px solid var(--border-color)', 
            borderRight: operationFilter === '사고대차' ? '2px solid #fa8c16' : '1px solid var(--border-color)', 
            borderBottom: operationFilter === '사고대차' ? '2px solid #fa8c16' : '1px solid var(--border-color)', 
            borderLeft: '4px solid #fa8c16',
            cursor: 'pointer',
            transform: hoveredCard === '사고대차' ? 'translateY(-3px)' : 'none',
            boxShadow: operationFilter === '사고대차' 
              ? '0 4px 12px rgba(250, 140, 22, 0.25)' 
              : (hoveredCard === '사고대차' ? '0 6px 16px rgba(0,0,0,0.1)' : '0 2px 4px rgba(0,0,0,0.05)'),
            transition: 'all 0.2s ease-in-out'
          }}
        >
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: '600' }}>🅿️ 사고대차 현황</span>
          <h3 style={{ fontSize: '1.5rem', fontWeight: '800', margin: '0.3rem 0 0 0', color: '#fa8c16' }}>{stats.accidentSubstitution} 대</h3>
        </div>
      </div>

      {/* 3. 검색 및 필터 컨트롤 바 */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.8rem',
        background: 'var(--bg-surface)',
        padding: '0.9rem 1.2rem',
        borderRadius: '10px',
        border: '1px solid var(--border-color)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', flex: '1', minWidth: '280px' }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <Search size={17} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="차량번호, 차종, 계약사, 책임담당자, 실무자 검색..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem 1rem 0.6rem 2.4rem',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-main)',
                color: 'var(--text-bright)',
                fontSize: '0.9rem'
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <select
            value={limit}
            onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }}
            style={{
              padding: '0.6rem 0.9rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-main)',
              color: 'var(--text-bright)',
              fontSize: '0.85rem'
            }}
          >
            <option value={10000}>전체보기</option>
            <option value={100}>100개씩 보기</option>
            <option value={200}>200개씩 보기</option>
            <option value={300}>300개씩 보기</option>
            <option value={500}>500개씩 보기</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            style={{
              padding: '0.6rem 0.9rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-main)',
              color: 'var(--text-bright)',
              fontSize: '0.85rem'
            }}
          >
            <option value="all">전체 상태 보기</option>
            <option value="rented">🚗 대여중</option>
            <option value="available">🅿️ 대기중</option>
            <option value="maintenance">🔧 정비중</option>
            <option value="reserved">📋 예약됨</option>
          </select>

          <select
            value={operationFilter}
            onChange={(e) => { setOperationFilter(e.target.value); setPage(1); }}
            style={{
              padding: '0.6rem 0.9rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-main)',
              color: 'var(--text-bright)',
              fontSize: '0.85rem'
            }}
          >
            <option value="all">전체 운영 보기</option>
            <option value="계약진행중">계약진행중</option>
            <option value="장기렌트">장기렌트</option>
            <option value="사고대차">사고대차</option>
            <option value="계약변경">계약변경</option>
            <option value="계약종료">계약종료</option>
          </select>
        </div>
      </div>

      {/* 4. 113개 컬럼 풀 엑셀 그리드 테이블 */}
      <div style={{ 
        background: '#ffffff', 
        borderRadius: '8px', 
        border: '1.5px solid #20744a', 
        boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
        overflow: 'hidden'
      }}>
        <div style={{ 
          background: '#107c41', 
          color: '#ffffff', 
          padding: '0.6rem 1.2rem', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          fontSize: '0.88rem',
          fontWeight: '700'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileSpreadsheet size={18} />
            <span>RENT BENefit 렌터카 원장 관리 대장 (총 113개 전체 항목)</span>
          </div>
          <span style={{ fontSize: '0.78rem', background: '#0b5a2f', padding: '0.2rem 0.6rem', borderRadius: '4px' }}>
            가로 스크롤을 이용해 113개 전체 컬럼을 확인 및 수정할 수 있습니다.
          </span>
        </div>

        <div 
          onWheel={handleTableWheel}
          style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 300px)', minHeight: '500px' }}
        >
          <table 
            className="excel-table"
            style={{ 
              width: 'max-content', 
              borderCollapse: 'collapse', 
              fontSize: '0.81rem', 
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            }}>
            <thead>
              <tr style={{ background: '#fff2e8', color: '#434343', borderBottom: '2px solid #ffbb96' }}>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', borderRight: '2px solid #20744a', minWidth: '50px', textAlign: 'center', position: 'sticky', top: 0, left: 0, background: '#fff2e8', zIndex: 3, boxShadow: '2px 0 5px rgba(0,0,0,0.05)' }}>No</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>구분</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '80px' }}>운영</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '130px' }}>계약사</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>책임담당자</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '110px' }}>연락처</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '120px' }}>차종</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '150px' }}>차량 사양</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '110px' }}>차량가</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '80px' }}>연식</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '80px' }}>색상</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '80px' }}>유종</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '140px' }}>차대 번호</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '110px', fontWeight: '800' }}>차량 번호</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '140px' }}>옵션</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '80px' }}>CC</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>등록일</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>계약일</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>인도 날짜</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>렌트 기간(Y)</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>렌트 종료</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>남은 기간</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>운행 거리</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>실무담당자</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '110px' }}>실무 연락처</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>지점</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '150px' }}>출고지 주소</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '110px' }}>렌트료 개시일</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>렌트 기간 일수</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>남은 기간 계산</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '120px' }}>계약번호</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '110px' }}>기본가격</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>할인금액</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '110px' }}>공급가액</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>탁송료</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>의무보험료</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>취득세</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>공채</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '80px' }}>증지대</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '80px' }}>번호판대</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>등록대행료</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>수수료</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '80px' }}>블랙박스</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '130px' }}>블랙박스 정보</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '80px' }}>선팅</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '130px' }}>선팅정보</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>등록비용</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>등록비용2</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>보험 회사</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>보험가입일</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>보험료</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>자차 보험비</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '120px' }}>타이어</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>정기점검</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>운전자 연령</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '80px' }}>대인</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '80px' }}>대물</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '80px' }}>자손</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>무보험차상해</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>고객부담금</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>보험종류</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>긴급출동</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>사고수리</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>일반정비</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '110px' }}>소모품교환</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>타이어 본수</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>타이어(정비)</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>타이어비용</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>자동차세</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>차용처</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>실행일</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '110px' }}>할부이용금액</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '80px' }}>기간</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>월할부금</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '110px' }}>월할부금 계</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>총이자</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '70px' }}>이자</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '120px' }}>월 대여료 결제일</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '110px' }}>계산서발행일</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '110px' }}>월 납입금</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '70px' }}>기간</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '110px' }}>월 납입금 계</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '110px' }}>보증금</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '110px' }}>선수금</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '110px' }}>인수가</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '60px' }}>P</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '70px' }}>이자</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '140px' }}>범칙금 E-MAIL</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '120px' }}>담당자 휴대전화번호</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>판관비</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>사은품1</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>사은품1_가격</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>사은품2</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>사은품2_가격</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>사은품3</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>사은품3_가격</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>사은품4</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>사은품4_가격</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>사은품5</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>사은품5_가격</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>사은품가격</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '120px' }}>딜러사</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>담당영업사원</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '120px' }}>전시장</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '100px' }}>예금주명</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>은행</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '130px' }}>계좌</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '130px' }}>사업자/주민번호</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '160px' }}>사업자 주소</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>위약금률</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '90px' }}>연체이율</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '130px' }}>법인/식별번호</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', position: 'sticky', top: 0, background: '#fff2e8', zIndex: 2, minWidth: '160px' }}>개별소비세(교육세,가산세포함)</th>
                <th style={{ padding: '0.65rem 0.8rem', border: '1px solid #ffd591', borderLeft: '2px solid #20744a', minWidth: '90px', textAlign: 'center', position: 'sticky', top: 0, right: 0, background: '#fff2e8', zIndex: 3, boxShadow: '-2px 0 5px rgba(0,0,0,0.05)' }}>수정/관리</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="114" style={{ textAlign: 'center', padding: '3rem', color: '#8c8c8c' }}>
                    엑셀 원장 데이터를 로딩하는 중입니다...
                  </td>
                </tr>
              ) : vehicles.length === 0 ? (
                <tr>
                  <td colSpan="114" style={{ textAlign: 'center', padding: '3rem', color: '#8c8c8c' }}>
                    등록된 대장 기록이 없습니다. 상단 [엑셀 샘플 데이터 복원] 또는 [엑셀 행 추가] 버튼을 눌러주세요.
                  </td>
                </tr>
              ) : (
                vehicles.map((v, idx) => {
                  const isSelected = v._id === selectedVehicleId;
                  return (
                    <tr
                      key={v._id || idx}
                      data-vehicle-id={v._id}
                      style={{
                        background: getRowBgColor(v.operation, idx, false, isSelected),
                        transition: 'background 0.15s',
                        cursor: 'pointer'
                      }}
                      onClick={(e) => {
                        const td = e.target.closest('td');
                        if (!td) return;
                        const fieldName = td.getAttribute('data-field');
                        if (fieldName && fieldName !== 'no') {
                          const tabName = getTabForField(fieldName);
                          openEditModal(v, tabName, fieldName);
                        } else {
                          openEditModal(v, 'basic');
                        }
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = getRowBgColor(v.operation, idx, true, isSelected);
                        if (e.currentTarget.firstElementChild) {
                          e.currentTarget.firstElementChild.style.background = isSelected ? '#a8cbff' : getRowBgColor(v.operation, idx, true, false);
                        }
                        if (e.currentTarget.lastElementChild) {
                          e.currentTarget.lastElementChild.style.background = isSelected ? '#c6d9ff' : getRowBgColor(v.operation, idx, true, false);
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = getRowBgColor(v.operation, idx, false, isSelected);
                        if (e.currentTarget.firstElementChild) {
                          e.currentTarget.firstElementChild.style.background = isSelected ? '#b5d2ff' : getRowBgColor(v.operation, idx, false, false);
                        }
                        if (e.currentTarget.lastElementChild) {
                          e.currentTarget.lastElementChild.style.background = isSelected ? '#d6e4ff' : getRowBgColor(v.operation, idx, false, false);
                        }
                      }}
                    >
                      <td data-field="no" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', borderRight: '2px solid #b8e2c8', textAlign: 'center', fontWeight: '700', position: 'sticky', left: 0, background: isSelected ? '#b5d2ff' : getRowBgColor(v.operation, idx, false, false), zIndex: 2, boxShadow: '2px 0 5px rgba(0,0,0,0.05)', transition: 'background 0.15s' }}>{idx + 1}</td>
                    <td data-field="category" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.category}</td>
                    <td data-field="operation" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.operation}</td>
                    <td data-field="contractCompany" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', fontWeight: '700', color: '#1890ff' }}>{v.contractCompany}</td>
                    <td data-field="manager" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.manager}</td>
                    <td data-field="managerPhone" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.managerPhone}</td>
                    <td data-field="carModel" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', fontWeight: '700' }}>{v.carModel}</td>
                    <td data-field="carSpec" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', color: '#595959' }}>{v.carSpec}</td>
                    <td data-field="carPrice" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right', fontWeight: '600' }}>{v.carPrice ? `${v.carPrice.toLocaleString()}원` : '0원'}</td>
                    <td data-field="year" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.year}</td>
                    <td data-field="color" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.color}</td>
                    <td data-field="fuelType" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.fuelType}</td>
                    <td data-field="vin" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', fontFamily: 'monospace' }}>{v.vin}</td>
                    <td data-field="carNumber" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', fontWeight: '800', color: '#20744a' }}>{v.carNumber}</td>
                    <td data-field="options" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.options}</td>
                    <td data-field="cc" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.cc}</td>
                    <td data-field="regDate" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.regDate}</td>
                    <td data-field="contractDate" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.contractDate}</td>
                    <td data-field="deliveryDate" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.deliveryDate}</td>
                    <td data-field="rentPeriodYears" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.rentPeriodYears}</td>
                    <td data-field="rentEndDate" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.rentEndDate}</td>
                    <td data-field="remainingPeriod" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.remainingPeriod}</td>
                    <td data-field="mileage" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.mileage ? `${v.mileage.toLocaleString()} km` : '0 km'}</td>
                    <td data-field="practicalManager" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.practicalManager}</td>
                    <td data-field="practicalPhone" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.practicalPhone}</td>
                    <td data-field="branch" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.branch}</td>
                    <td data-field="deliveryAddress" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.deliveryAddress}</td>
                    <td data-field="rentStartDate" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.rentStartDate}</td>
                    <td data-field="rentPeriodDays" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.rentPeriodDays}</td>
                    <td data-field="remainingPeriodCalc" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.remainingPeriodCalc}</td>
                    <td data-field="contractNo" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.contractNo}</td>
                    <td data-field="basePrice" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.basePrice ? `${v.basePrice.toLocaleString()}원` : '0원'}</td>
                    <td data-field="discountAmount" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.discountAmount ? `${v.discountAmount.toLocaleString()}원` : '0원'}</td>
                    <td data-field="supplyAmount" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.supplyAmount ? `${v.supplyAmount.toLocaleString()}원` : '0원'}</td>
                    <td data-field="consignmentFee" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.consignmentFee ? `${v.consignmentFee.toLocaleString()}원` : '0원'}</td>
                    <td data-field="mandatoryInsuranceFee" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.mandatoryInsuranceFee ? `${v.mandatoryInsuranceFee.toLocaleString()}원` : '0원'}</td>
                    <td data-field="acquisitionTax" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.acquisitionTax ? `${v.acquisitionTax.toLocaleString()}원` : '0원'}</td>
                    <td data-field="bond" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.bond ? `${v.bond.toLocaleString()}원` : '0원'}</td>
                    <td data-field="stampFee" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.stampFee ? `${v.stampFee.toLocaleString()}원` : '0원'}</td>
                    <td data-field="plateFee" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.plateFee ? `${v.plateFee.toLocaleString()}원` : '0원'}</td>
                    <td data-field="regAgencyFee" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.regAgencyFee ? `${v.regAgencyFee.toLocaleString()}원` : '0원'}</td>
                    <td data-field="commission" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.commission ? `${v.commission.toLocaleString()}원` : '0원'}</td>
                    <td data-field="dashcam" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.dashcam}</td>
                    <td data-field="dashcamInfo" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.dashcamInfo}</td>
                    <td data-field="tinting" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.tinting ? (typeof v.tinting === 'number' ? `${v.tinting.toLocaleString()}원` : (isNaN(Number(v.tinting)) ? v.tinting : `${Number(v.tinting).toLocaleString()}원`)) : '0원'}</td>
                    <td data-field="tintingInfo" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.tintingInfo}</td>
                    <td data-field="regCost1" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.regCost1 ? `${v.regCost1.toLocaleString()}원` : '0원'}</td>
                    <td data-field="regCost2" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.regCost2 ? `${v.regCost2.toLocaleString()}원` : '0원'}</td>
                    <td data-field="insuranceCompany" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', fontWeight: '600' }}>{v.insuranceCompany}</td>
                    <td data-field="insuranceStartDate" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.insuranceStartDate}</td>
                    <td data-field="insuranceFee" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.insuranceFee ? `${v.insuranceFee.toLocaleString()}원` : '0원'}</td>
                    <td data-field="ownCarInsuranceFee" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.ownCarInsuranceFee ? `${v.ownCarInsuranceFee.toLocaleString()}원` : '0원'}</td>
                    <td data-field="tire" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.tire}</td>
                    <td data-field="regularCheckup" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.regularCheckup}</td>
                    <td data-field="driverAge" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.driverAge}</td>
                    <td data-field="personalInjury1" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.personalInjury1}</td>
                    <td data-field="propertyDamage" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.propertyDamage}</td>
                    <td data-field="personalInjury2" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.personalInjury2}</td>
                    <td data-field="uninsuredCarInjury" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.uninsuredCarInjury}</td>
                    <td data-field="deductible" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.deductible ? `${v.deductible.toLocaleString()}원` : '0원'}</td>
                    <td data-field="insuranceType" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.insuranceType}</td>
                    <td data-field="emergencyService" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.emergencyService}</td>
                    <td data-field="accidentRepair" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.accidentRepair}</td>
                    <td data-field="generalMaintenance" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.generalMaintenance}</td>
                    <td data-field="consumablesExchange" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.consumablesExchange}</td>
                    <td data-field="tireCount" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.tireCount}</td>
                    <td data-field="tireType" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.tireType}</td>
                    <td data-field="tireCost" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.tireCost ? `${v.tireCost.toLocaleString()}원` : '0원'}</td>
                    <td data-field="carTax" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.carTax}</td>
                    <td data-field="lender" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.lender}</td>
                    <td data-field="executionDate" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.executionDate}</td>
                    <td data-field="installmentAmount" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.installmentAmount ? `${v.installmentAmount.toLocaleString()}원` : '0원'}</td>
                    <td data-field="installmentPeriod" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.installmentPeriod}</td>
                    <td data-field="monthlyInstallment" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.monthlyInstallment ? `${v.monthlyInstallment.toLocaleString()}원` : '0원'}</td>
                    <td data-field="totalMonthlyInstallment" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.totalMonthlyInstallment ? `${v.totalMonthlyInstallment.toLocaleString()}원` : '0원'}</td>
                    <td data-field="totalInterest" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.totalInterest ? `${v.totalInterest.toLocaleString()}원` : '0원'}</td>
                    <td data-field="interestRate" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.interestRate}</td>
                    <td data-field="monthlyFeePayDay" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.monthlyFeePayDay}</td>
                    <td data-field="invoiceDate" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.invoiceDate}</td>
                    <td data-field="monthlyPayment" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right', fontWeight: '700', color: '#cf1322' }}>{v.monthlyPayment ? `${v.monthlyPayment.toLocaleString()}원` : '0원'}</td>
                    <td data-field="paymentPeriod" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.paymentPeriod}</td>
                    <td data-field="totalMonthlyPayment" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.totalMonthlyPayment ? `${v.totalMonthlyPayment.toLocaleString()}원` : '0원'}</td>
                    <td data-field="deposit" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right', fontWeight: '700' }}>{v.deposit ? `${v.deposit.toLocaleString()}원` : '0원'}</td>
                    <td data-field="advancePayment" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.advancePayment ? `${v.advancePayment.toLocaleString()}원` : '0원'}</td>
                    <td data-field="acquisitionValue" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.acquisitionValue ? `${v.acquisitionValue.toLocaleString()}원` : '0원'}</td>
                    <td data-field="residualRateP" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.residualRateP}</td>
                    <td data-field="interest2" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.interest2}</td>
                    <td data-field="fineEmail" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.fineEmail}</td>
                    <td data-field="managerMobile" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.managerMobile}</td>
                    <td data-field="sellingAdminExpense" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.sellingAdminExpense ? `${v.sellingAdminExpense.toLocaleString()}원` : '0원'}</td>
                    <td data-field="gift1" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.gift1}</td>
                    <td data-field="gift1Price" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.gift1Price ? `${v.gift1Price.toLocaleString()}원` : '0원'}</td>
                    <td data-field="gift2" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.gift2}</td>
                    <td data-field="gift2Price" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.gift2Price ? `${v.gift2Price.toLocaleString()}원` : '0원'}</td>
                    <td data-field="gift3" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.gift3}</td>
                    <td data-field="gift3Price" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.gift3Price ? `${v.gift3Price.toLocaleString()}원` : '0원'}</td>
                    <td data-field="gift4" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.gift4}</td>
                    <td data-field="gift4Price" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.gift4Price ? `${v.gift4Price.toLocaleString()}원` : '0원'}</td>
                    <td data-field="gift5" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.gift5}</td>
                    <td data-field="gift5Price" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.gift5Price ? `${v.gift5Price.toLocaleString()}원` : '0원'}</td>
                    <td data-field="totalGiftPrice" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right', fontWeight: '700' }}>{v.totalGiftPrice ? `${v.totalGiftPrice.toLocaleString()}원` : '0원'}</td>
                    <td data-field="dealerCompany" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.dealerCompany}</td>
                    <td data-field="salesRepresentative" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.salesRepresentative}</td>
                    <td data-field="showroom" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.showroom}</td>
                    <td data-field="accountHolder" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.accountHolder}</td>
                    <td data-field="bank" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.bank}</td>
                    <td data-field="accountNo" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.accountNo}</td>
                    <td data-field="bizOrRegNo" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.bizOrRegNo}</td>
                    <td data-field="bizAddress" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.bizAddress}</td>
                    <td data-field="penaltyRate" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.penaltyRate}</td>
                    <td data-field="overdueInterestRate" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.overdueInterestRate}</td>
                    <td data-field="corporateRegNo" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8' }}>{v.corporateRegNo}</td>
                    <td data-field="individualConsumptionTax" style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', textAlign: 'right' }}>{v.individualConsumptionTax ? `${v.individualConsumptionTax.toLocaleString()}원` : '0원'}</td>

                    <td style={{ padding: '0.55rem 0.8rem', border: '1px solid #e8e8e8', borderLeft: '2px solid #e8e8e8', textAlign: 'center', position: 'sticky', right: 0, background: isSelected ? '#d6e4ff' : getRowBgColor(v.operation, idx, false, false), zIndex: 2, boxShadow: '-2px 0 5px rgba(0,0,0,0.05)', transition: 'background 0.15s' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '0.3rem' }}>
                        <button
                          onClick={() => openEditModal(v)}
                          title="수정"
                          style={{ border: 'none', background: '#e6f7ff', color: '#1890ff', padding: '0.3rem 0.5rem', borderRadius: '4px', cursor: 'pointer', fontWeight: '700' }}
                        >
                          수정
                        </button>
                        <button
                          onClick={() => handleDeleteVehicle(v._id, v.carNumber)}
                          title="삭제"
                          style={{ border: 'none', background: '#fff1f0', color: '#ff4d4f', padding: '0.3rem 0.5rem', borderRadius: '4px', cursor: 'pointer' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ); })
              )}
            </tbody>
          </table>
        </div>

        {pagination.totalPages > 1 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.8rem',
            padding: '0.8rem',
            borderTop: '1px solid var(--border-color)'
          }}>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              style={{
                padding: '0.4rem 0.9rem',
                borderRadius: '6px',
                border: '1px solid #d9d9d9',
                background: page <= 1 ? '#f5f5f5' : '#ffffff',
                color: page <= 1 ? '#bfbfbf' : '#595959',
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '0.85rem'
              }}
            >
              이전
            </button>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: '600' }}>
              {page} / {pagination.totalPages} 페이지 (전체 {pagination.totalCount}건)
            </span>
            <button
              onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
              disabled={page >= pagination.totalPages}
              style={{
                padding: '0.4rem 0.9rem',
                borderRadius: '6px',
                border: '1px solid #d9d9d9',
                background: page >= pagination.totalPages ? '#f5f5f5' : '#ffffff',
                color: page >= pagination.totalPages ? '#bfbfbf' : '#595959',
                cursor: page >= pagination.totalPages ? 'not-allowed' : 'pointer',
                fontWeight: '600',
                fontSize: '0.85rem'
              }}
            >
              다음
            </button>
          </div>
        )}
      </div>

      {/* 5. 엑셀 행 추가 및 수정 팝업 모달 */}
      {showModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.65)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '12px',
            width: '100%',
            maxWidth: '1000px',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 12px 32px rgba(0,0,0,0.25)'
          }}>
            {/* Modal Header */}
            <div style={{
              background: '#107c41',
              color: '#ffffff',
              padding: '1rem 1.5rem',
              display: 'flex',
              justify: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <FileSpreadsheet size={22} />
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '800' }}>
                  {editingVehicle ? `엑셀 대장 행 수정 (차량번호: ${formData.carNumber})` : '신규 엑셀 대장 행 추가'}
                </h3>
              </div>
              <button
                onClick={handleCloseModal}
                style={{ background: 'transparent', border: 'none', color: '#ffffff', cursor: 'pointer' }}
              >
                <X size={22} />
              </button>
            </div>

            {/* Modal Sub-Tabs */}
            <div style={{
              display: 'flex',
              background: '#f0f2f5',
              borderBottom: '1px solid #d9d9d9',
              padding: '0.5rem 1rem 0 1rem',
              gap: '0.3rem',
              overflowX: 'auto'
            }}>
              {[
                { id: 'basic', label: '1. 차량/기본정보', icon: Layers },
                { id: 'contract', label: '2. 견적/계약정보', icon: Calendar },
                { id: 'price', label: '3. 가격/제비용', icon: CreditCard },
                { id: 'insurance', label: '4. 보험/정비정보', icon: Shield },
                { id: 'finance', label: '5. 금융/납입정보', icon: CreditCard },
                { id: 'gifts', label: '6. 사은품/영업정보', icon: Gift }
              ].map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setModalTab(tab.id)}
                  style={{
                    padding: '0.6rem 1rem',
                    borderTopLeftRadius: '6px',
                    borderTopRightRadius: '6px',
                    border: '1px solid #d9d9d9',
                    borderBottom: modalTab === tab.id ? '2px solid #107c41' : '1px solid #d9d9d9',
                    background: modalTab === tab.id ? '#ffffff' : '#e6e8eb',
                    color: modalTab === tab.id ? '#107c41' : '#595959',
                    fontWeight: modalTab === tab.id ? '800' : '600',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    whiteSpace: 'nowrap'
                  }}
                >
                  <tab.icon size={14} /> {tab.label}
                </button>
              ))}
            </div>

            {/* Modal Body Form */}
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
              <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>

                {/* 탭 1: 기본 정보 */}
                {modalTab === 'basic' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>운영 (필수)*</label>
                      <select 
                        name="operation" 
                        value={formData.operation} 
                        onChange={handleFormChange} 
                        required
                        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc', backgroundColor: '#ffffff' }}
                      >
                        <option value="" disabled hidden>운영 선택</option>
                        <option value="장기렌트">장기렌트</option>
                        <option value="사고대차">사고대차</option>
                        <option value="계약진행중">계약진행중</option>
                        <option value="계약변경">계약변경</option>
                        <option value="계약종료">계약종료</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>차량 번호</label>
                      <input type="text" name="carNumber" value={formData.carNumber} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>차종 / 모델명</label>
                      <input type="text" name="carModel" value={formData.carModel} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>구분</label>
                      <input 
                        type="text" 
                        name="category" 
                        value={editingVehicle ? formData.category : (formData.category || '차종 등록 시 자동 부여')} 
                        disabled
                        style={{ 
                          width: '100%', 
                          padding: '0.5rem', 
                          borderRadius: '4px', 
                          border: '1px solid #ccc', 
                          backgroundColor: '#f5f5f5', 
                          cursor: 'not-allowed',
                          color: '#8c8c8c'
                        }} 
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>계약사 / 법인명</label>
                      <input type="text" name="contractCompany" value={formData.contractCompany} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>책임담당자</label>
                      <input type="text" name="manager" value={formData.manager} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>책임담당자 연락처</label>
                      <input type="text" name="managerPhone" value={formData.managerPhone} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>차량 사양</label>
                      <input type="text" name="carSpec" value={formData.carSpec} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>차량가 (원)</label>
                      <input type="number" name="carPrice" value={formData.carPrice} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>연식</label>
                      <input type="text" name="year" value={formData.year} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>색상</label>
                      <input type="text" name="color" value={formData.color} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>유종</label>
                      <input type="text" name="fuelType" value={formData.fuelType} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>차대 번호</label>
                      <input type="text" name="vin" value={formData.vin} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>옵션</label>
                      <input type="text" name="options" value={formData.options} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>CC (배기량)</label>
                      <input type="text" name="cc" value={formData.cc} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>등록일</label>
                      <input type="date" name="regDate" value={formData.regDate} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                  </div>
                )}

                {/* 탭 2: 견적 / 계약 정보 */}
                {modalTab === 'contract' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
                    {/* 견적서 업로드 영역 */}
                    <div style={{
                      border: '2px dashed #107c41',
                      borderRadius: '8px',
                      padding: '1.5rem',
                      textAlign: 'center',
                      background: '#f4faf6',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const file = e.dataTransfer.files[0];
                        if (file) handleQuoteUpload(file);
                      }}
                      onClick={() => document.getElementById('quote-file-input').click()}
                    >
                      <FileSpreadsheet size={36} color="#107c41" style={{ marginBottom: '0.5rem', marginLeft: 'auto', marginRight: 'auto' }} />
                      <div style={{ fontWeight: '700', fontSize: '0.9rem', color: '#107c41' }}>
                        장기렌터카 견적서 엑셀 파일 업로드
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '0.3rem' }}>
                        파일을 여기로 드래그하거나 클릭하여 선택하세요 (*.xlsx, *.xls)
                      </div>
                      <input 
                        id="quote-file-input"
                        type="file" 
                        accept=".xlsx, .xls"
                        onChange={(e) => {
                          const file = e.target.files[0];
                          if (file) handleQuoteUpload(file);
                        }}
                        style={{ display: 'none' }}
                      />
                    </div>

                    {/* 파싱된 요약 정보 카드 (견적서 반영 시 표시) */}
                    {parsedQuoteSummary && (
                      <div style={{
                        background: '#eafff0',
                        border: '1px solid #b7eb8f',
                        borderRadius: '6px',
                        padding: '1rem',
                        fontSize: '0.85rem'
                      }}>
                        <div style={{ fontWeight: '800', color: '#107c41', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <CheckCircle2 size={16} /> 견적서 정보 자동 분석 완료
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.4rem', color: '#333' }}>
                          <div><strong>차종:</strong> {parsedQuoteSummary.carModel}</div>
                          <div><strong>차량가격:</strong> {Number(parsedQuoteSummary.carPrice).toLocaleString()}원</div>
                          <div><strong>보증금:</strong> {Number(parsedQuoteSummary.deposit).toLocaleString()}원</div>
                          <div><strong>선수금:</strong> {Number(parsedQuoteSummary.advancePayment).toLocaleString()}원</div>
                          <div><strong>인수가:</strong> {Number(parsedQuoteSummary.acquisitionValue).toLocaleString()}원</div>
                          <div><strong>월대여료:</strong> {Number(parsedQuoteSummary.monthlyPayment).toLocaleString()}원</div>
                          <div><strong>계약기간:</strong> {parsedQuoteSummary.contractPeriod}개월</div>
                          <div><strong>보험 연령:</strong> {parsedQuoteSummary.driverAge}</div>
                        </div>
                      </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>계약일</label>
                        <input type="date" name="contractDate" value={formData.contractDate} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>인도 날짜</label>
                        <input type="date" name="deliveryDate" value={formData.deliveryDate} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>렌트 기간 (Y)</label>
                        <input type="text" name="rentPeriodYears" value={formData.rentPeriodYears} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>렌트 종료일</label>
                        <input type="date" name="rentEndDate" value={formData.rentEndDate} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>남은 기간</label>
                        <input type="text" name="remainingPeriod" value={formData.remainingPeriod} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>운행 거리 (km)</label>
                        <input type="number" name="mileage" value={formData.mileage} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>실무담당자</label>
                        <input type="text" name="practicalManager" value={formData.practicalManager} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>실무담당자 연락처</label>
                        <input type="text" name="practicalPhone" value={formData.practicalPhone} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>지점</label>
                        <input type="text" name="branch" value={formData.branch} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>출고지 주소</label>
                        <input type="text" name="deliveryAddress" value={formData.deliveryAddress} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>렌트료 개시일</label>
                        <input type="date" name="rentStartDate" value={formData.rentStartDate} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>렌트 기간 일수</label>
                        <input type="text" name="rentPeriodDays" value={formData.rentPeriodDays} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>남은 기간 계산</label>
                        <input type="text" name="remainingPeriodCalc" value={formData.remainingPeriodCalc} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>계약번호</label>
                        <input type="text" name="contractNo" value={formData.contractNo} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                      </div>
                    </div>
                  </div>
                )}

                {/* 탭 3: 가격 / 제비용 */}
                {modalTab === 'price' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>기본가격 (원)</label>
                      <input type="number" name="basePrice" value={formData.basePrice} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>할인금액 (원)</label>
                      <input type="number" name="discountAmount" value={formData.discountAmount} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>공급가액 (원)</label>
                      <input type="number" name="supplyAmount" value={formData.supplyAmount} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>탁송료 (원)</label>
                      <input type="number" name="consignmentFee" value={formData.consignmentFee} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>의무보험료 (원)</label>
                      <input type="number" name="mandatoryInsuranceFee" value={formData.mandatoryInsuranceFee} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>취득세 (원)</label>
                      <input type="number" name="acquisitionTax" value={formData.acquisitionTax} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>공채 (원)</label>
                      <input type="number" name="bond" value={formData.bond} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>증지대 (원)</label>
                      <input type="number" name="stampFee" value={formData.stampFee} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>번호판대 (원)</label>
                      <input type="number" name="plateFee" value={formData.plateFee} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>등록대행료 (원)</label>
                      <input type="number" name="regAgencyFee" value={formData.regAgencyFee} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>수수료 (원)</label>
                      <input type="number" name="commission" value={formData.commission} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>블랙박스 여부</label>
                      <input type="text" name="dashcam" value={formData.dashcam} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>블랙박스 정보</label>
                      <input type="text" name="dashcamInfo" value={formData.dashcamInfo} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>선팅 여부</label>
                      <input type="text" name="tinting" value={formData.tinting} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>선팅 정보</label>
                      <input type="text" name="tintingInfo" value={formData.tintingInfo} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>등록비용 (원)</label>
                      <input type="number" name="regCost1" value={formData.regCost1} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>등록비용2 (원)</label>
                      <input type="number" name="regCost2" value={formData.regCost2} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                  </div>
                )}

                {/* 탭 4: 보험 / 정비 정보 */}
                {modalTab === 'insurance' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>보험 회사</label>
                      <input type="text" name="insuranceCompany" value={formData.insuranceCompany} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>보험가입일</label>
                      <input type="date" name="insuranceStartDate" value={formData.insuranceStartDate} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>보험료 (원)</label>
                      <input type="number" name="insuranceFee" value={formData.insuranceFee} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>자차 보험비 (원)</label>
                      <input type="number" name="ownCarInsuranceFee" value={formData.ownCarInsuranceFee} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>운전자 연령</label>
                      <input type="text" name="driverAge" value={formData.driverAge} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>대인 배상</label>
                      <input type="text" name="personalInjury1" value={formData.personalInjury1} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>대물 배상</label>
                      <input type="text" name="propertyDamage" value={formData.propertyDamage} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>자손 (자기신체사고)</label>
                      <input type="text" name="personalInjury2" value={formData.personalInjury2} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>무보험차상해</label>
                      <input type="text" name="uninsuredCarInjury" value={formData.uninsuredCarInjury} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>고객부담금 (면책금, 원)</label>
                      <input type="number" name="deductible" value={formData.deductible} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>보험종류</label>
                      <input type="text" name="insuranceType" value={formData.insuranceType} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>긴급출동</label>
                      <input type="text" name="emergencyService" value={formData.emergencyService} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>타이어</label>
                      <input type="text" name="tire" value={formData.tire} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>정기점검</label>
                      <input type="text" name="regularCheckup" value={formData.regularCheckup} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>사고수리</label>
                      <input type="text" name="accidentRepair" value={formData.accidentRepair} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>일반정비</label>
                      <input type="text" name="generalMaintenance" value={formData.generalMaintenance} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>소모품교환</label>
                      <input type="text" name="consumablesExchange" value={formData.consumablesExchange} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>타이어 본수</label>
                      <input type="text" name="tireCount" value={formData.tireCount} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>타이어(정비)</label>
                      <input type="text" name="tireType" value={formData.tireType} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>타이어비용 (원)</label>
                      <input type="number" name="tireCost" value={formData.tireCost} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>자동차세</label>
                      <input type="text" name="carTax" value={formData.carTax} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                  </div>
                )}

                {/* 탭 5: 금융 / 납입 정보 */}
                {modalTab === 'finance' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>차용처 (금융사)</label>
                      <input type="text" name="lender" value={formData.lender} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>월 대여료 결제일</label>
                      <input type="text" name="monthlyFeePayDay" value={formData.monthlyFeePayDay} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>월 납입금 (원)</label>
                      <input type="number" name="monthlyPayment" value={formData.monthlyPayment} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>보증금 (원)</label>
                      <input type="number" name="deposit" value={formData.deposit} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>선수금 (원)</label>
                      <input type="number" name="advancePayment" value={formData.advancePayment} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>인수가 (잔존가치, 원)</label>
                      <input type="number" name="acquisitionValue" value={formData.acquisitionValue} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>범칙금 E-MAIL</label>
                      <input type="email" name="fineEmail" value={formData.fineEmail} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>담당자 휴대전화번호</label>
                      <input type="text" name="managerMobile" value={formData.managerMobile} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>실행일</label>
                      <input type="date" name="executionDate" value={formData.executionDate} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>할부이용금액 (원)</label>
                      <input type="number" name="installmentAmount" value={formData.installmentAmount} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>할부기간</label>
                      <input type="text" name="installmentPeriod" value={formData.installmentPeriod} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>월할부금 (원)</label>
                      <input type="number" name="monthlyInstallment" value={formData.monthlyInstallment} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>월할부금 계 (원)</label>
                      <input type="number" name="totalMonthlyInstallment" value={formData.totalMonthlyInstallment} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>총이자 (원)</label>
                      <input type="number" name="totalInterest" value={formData.totalInterest} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>이자율</label>
                      <input type="text" name="interestRate" value={formData.interestRate} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>계산서발행일</label>
                      <input type="text" name="invoiceDate" value={formData.invoiceDate} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>납입기간</label>
                      <input type="text" name="paymentPeriod" value={formData.paymentPeriod} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>월납입금 계 (원)</label>
                      <input type="number" name="totalMonthlyPayment" value={formData.totalMonthlyPayment} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>잔존가치율 P</label>
                      <input type="text" name="residualRateP" value={formData.residualRateP} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>금융 이자</label>
                      <input type="text" name="interest2" value={formData.interest2} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                  </div>
                )}

                {/* 탭 6: 사은품 / 기타 정보 */}
                {modalTab === 'gifts' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>사은품 1 명칭</label>
                      <input type="text" name="gift1" value={formData.gift1} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>사은품 1 가격</label>
                      <input type="number" name="gift1Price" value={formData.gift1Price} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>딜러사</label>
                      <input type="text" name="dealerCompany" value={formData.dealerCompany} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>담당영업사원</label>
                      <input type="text" name="salesRepresentative" value={formData.salesRepresentative} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>사업자/주민번호</label>
                      <input type="text" name="bizOrRegNo" value={formData.bizOrRegNo} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>사업자 주소</label>
                      <input type="text" name="bizAddress" value={formData.bizAddress} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>사은품 2 명칭</label>
                      <input type="text" name="gift2" value={formData.gift2} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>사은품 2 가격 (원)</label>
                      <input type="number" name="gift2Price" value={formData.gift2Price} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>사은품 3 명칭</label>
                      <input type="text" name="gift3" value={formData.gift3} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>사은품 3 가격 (원)</label>
                      <input type="number" name="gift3Price" value={formData.gift3Price} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>사은품 4 명칭</label>
                      <input type="text" name="gift4" value={formData.gift4} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>사은품 4 가격 (원)</label>
                      <input type="number" name="gift4Price" value={formData.gift4Price} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>사은품 5 명칭</label>
                      <input type="text" name="gift5" value={formData.gift5} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>사은품 5 가격 (원)</label>
                      <input type="number" name="gift5Price" value={formData.gift5Price} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>총 사은품 가격 (원)</label>
                      <input type="number" name="totalGiftPrice" value={formData.totalGiftPrice} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>전시장</label>
                      <input type="text" name="showroom" value={formData.showroom} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>예금주명</label>
                      <input type="text" name="accountHolder" value={formData.accountHolder} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>은행</label>
                      <input type="text" name="bank" value={formData.bank} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>계좌번호</label>
                      <input type="text" name="accountNo" value={formData.accountNo} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>위약금률</label>
                      <input type="text" name="penaltyRate" value={formData.penaltyRate} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>연체이율</label>
                      <input type="text" name="overdueInterestRate" value={formData.overdueInterestRate} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>법인/식별번호</label>
                      <input type="text" name="corporateRegNo" value={formData.corporateRegNo} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', marginBottom: '0.3rem' }}>개별소비세 (원)</label>
                      <input type="number" name="individualConsumptionTax" value={formData.individualConsumptionTax} onChange={handleFormChange} style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }} />
                    </div>
                  </div>
                )}

              </div>

              {/* Modal Footer */}
              <div style={{
                background: '#f8f9fa',
                padding: '1rem 1.5rem',
                borderTop: '1px solid #e9ecef',
                display: 'flex',
                justify: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{ fontSize: '0.82rem', color: '#6c757d' }}>
                  입력하신 모든 엑셀 대장 항목은 MongoDB 실시간 원장에 자동 반영됩니다.
                </span>
                <div style={{ display: 'flex', gap: '0.6rem' }}>
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    style={{ padding: '0.6rem 1.2rem', borderRadius: '6px', border: '1px solid #ced4da', background: '#ffffff', color: '#495057', fontWeight: '600', cursor: 'pointer' }}
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    style={{ padding: '0.6rem 1.4rem', borderRadius: '6px', border: 'none', background: '#107c41', color: '#ffffff', fontWeight: '800', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                  >
                    <Save size={16} /> 저장 및 대장 반영
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default VehicleManagementView;
