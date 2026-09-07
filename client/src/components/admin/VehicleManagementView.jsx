import { useState, useEffect, useRef } from 'react';
import {
  Search,
  Plus,
  Edit3,
  Trash2,
  X,
  Save,
  Car,
  FileSignature,
  Download,
  Upload,
  Truck
} from 'lucide-react';
import { formatCustomerName, PAYMENT_DAY_OPTIONS, formatPaymentDay } from '../../utils/format.js';
import MoneyInput from './MoneyInput.jsx';
import { useTableSort } from './useTableSort.js';
import { useSaveShortcut } from './useSaveShortcut.js';
import { SortableTh, SortControls } from './TableSort.jsx';
import { useDraggableDialog, DIALOG_TOP } from './useDraggableDialog.js';
import { createPortal } from 'react-dom';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

// 목록에 보이는 순서이자 상태 선택 상자의 순서.
// 계약중(출고 전) -> 장기렌트(운용 중) -> 사고대차 -> 거래완료 순으로, 지금 손이 가는 차가 위로 온다.
// 예전에 쓰던 '예약'은 뜻이 같은 '계약중'으로 합쳤다(서버가 켜질 때 남은 자료도 함께 바꾼다).
const STATUS_LABELS = {
  '계약중': '계약중',
  '장기렌트': '장기렌트',
  '사고대차': '사고대차',
  '거래완료': '거래완료'
};

const STATUS_ORDER = Object.keys(STATUS_LABELS);

/**
 * 옆으로 넘길 때 왼쪽에 붙여 둘 열.
 *
 * 열이 80개가 넘어 오른쪽 끝으로 가면 지금 보는 줄이 어느 회사 차인지 알 수 없었다.
 * 계약사까지 붙여 두면 어떤 값을 봐도 주인을 알 수 있다.
 * 붙여 둔 칸은 나란히 놓여야 하므로 너비를 정해 두고, 그 너비를 더해 왼쪽 위치를 잡는다.
 */
const FROZEN_COLUMN_WIDTHS = [
  ['no', 52],
  ['status', 92],
  ['partyType', 92],
  ['contractCompany', 180]
];

const FROZEN_COLUMNS = FROZEN_COLUMN_WIDTHS.reduce((acc, [key, width], index) => {
  const left = FROZEN_COLUMN_WIDTHS.slice(0, index).reduce((sum, [, w]) => sum + w, 0);
  const isLast = index === FROZEN_COLUMN_WIDTHS.length - 1;
  acc[key] = { width, left, isLast };
  return acc;
}, {});

/** 왼쪽에 붙여 둔 칸의 공통 모양. 마지막 칸에는 경계선을 그어 고정 구역을 알 수 있게 한다. */
const frozenCellStyle = (key, background, zIndex) => {
  const frozen = FROZEN_COLUMNS[key];
  if (!frozen) return null;
  return {
    position: 'sticky',
    left: frozen.left,
    width: frozen.width,
    minWidth: frozen.width,
    maxWidth: frozen.width,
    zIndex,
    background,
    boxShadow: frozen.isLast ? 'inset -1px 0 0 var(--border-color)' : undefined
  };
};

// 계약구분. 개인사업자는 사업자번호가 있어 청구서가 법인과 같은 방식으로 나가고,
// 일반개인은 사업자가 없다. 예전에는 둘을 '개인' 하나로 묶어 구분이 되지 않았다.
const PARTY_TYPES = ['법인', '개인사업자', '일반개인'];

// 사업자 정보(사업자번호·대표자·사업장주소)를 두는 계약구분
const hasBusinessInfo = (partyType) => partyType === '법인' || partyType === '개인사업자';

/**
 * 화면에 보여 줄 계약구분.
 * 차량에 적힌 값이 이 화면에서 고치는 값이라 먼저 보고, 없으면 계약 쪽 값을 본다.
 * 예전 값 '개인'은 사업자번호가 있으면 개인사업자, 없으면 일반개인으로 나눠 보여 준다.
 */
const partyTypeOf = (v) => {
  const raw = v.partyType || v.contract?.partyType;
  if (PARTY_TYPES.includes(raw)) return raw;
  if (raw === '개인') {
    const bizNo = v.contract?.companyId?.bizNo || v.company?.bizNo;
    return bizNo ? '개인사업자' : '일반개인';
  }
  return raw || '-';
};

// bg는 상태 배지 색, row는 줄 전체에 까는 음영이다.
// 줄 음영은 배지보다 훨씬 옅게 잡는다. 진하면 글자가 읽기 어렵고 배지가 묻힌다.
const STATUS_COLORS = {
  '계약중': { bg: '#f0e6ff', text: '#7c3aed', row: '#faf6ff' },
  '장기렌트': { bg: '#e6f7ff', text: '#1890ff', row: '#f4fbff' },
  '사고대차': { bg: '#fff1f0', text: '#ff4d4f', row: '#fff7f6' },
  '거래완료': { bg: '#f6ffed', text: '#52c41a', row: '#f8fdf4' }
};

/** 상태에 따른 줄 색. 고쳐지는 줄은 그 표시가 우선한다(어느 줄을 고치는지가 더 급한 정보다). */
const rowBackgroundFor = (vehicle, isEditing) => {
  if (isEditing) return '#f5f3ff';
  return STATUS_COLORS[vehicle.status]?.row || '#fff';
};

/**
 * 목록의 기본 순서.
 *
 * 1) 상태: 계약중 -> 장기렌트 -> 사고대차 -> 거래완료 (모르는 상태는 맨 뒤)
 * 2) 같은 상태 안에서는 출고일(인도일)이 최근인 차가 위로.
 *    출고일이 아직 없는 차(출고 준비 전)는 그 상태의 아래쪽에 모인다.
 *
 * 머리글을 눌러 정렬하면 그 기준이 우선하고, 정렬을 풀면 다시 이 순서로 돌아온다.
 */
const byDefaultOrder = (a, b) => {
  const rank = (v) => {
    const i = STATUS_ORDER.indexOf(v.status);
    return i === -1 ? STATUS_ORDER.length : i;
  };
  const diff = rank(a) - rank(b);
  if (diff !== 0) return diff;

  const delivered = (v) => {
    const t = v.deliveryDate ? new Date(v.deliveryDate).getTime() : NaN;
    return Number.isNaN(t) ? null : t;
  };
  const ta = delivered(a);
  const tb = delivered(b);
  if (ta === null && tb === null) return 0;
  if (ta === null) return 1; // 출고일이 없는 차는 아래로
  if (tb === null) return -1;
  return tb - ta; // 최근 출고가 위로
};

/**
 * 표에서 바로 고칠 수 있는 칸.
 *
 * key는 표의 열이고, path는 수정 폼(formData)에서 그 값이 앉아 있는 자리다.
 * 여기 없는 열(NO·계약번호·사은품)은 표에서 읽기만 한다 - 계약이 정본이거나
 * 목록이라 한 칸에 넣기 어려운 값들이다.
 */
const CELL_EDITORS = {
  status: { path: 'status', type: 'select', options: () => STATUS_ORDER.map((v) => ({ value: v, label: v })) },
  partyType: { path: 'partyType', type: 'select', options: () => PARTY_TYPES.map((v) => ({ value: v, label: v })) },
  contractCompany: { path: 'company.name', type: 'text' },
  ceoName: { path: 'company.ceoName', type: 'text' },
  bizNo: { path: 'company.bizNo', type: 'text' },
  corporateRegistrationNo: { path: 'company.corporateRegistrationNo', type: 'text' },
  companyAddress: { path: 'company.address', type: 'text' },
  billingEmail: { path: 'company.billingEmail', type: 'text' },
  bankHolder: { path: 'banking.holder', type: 'text' },
  bankName: { path: 'banking.bankName', type: 'text' },
  bankAccountNo: { path: 'banking.accountNo', type: 'text' },
  loanExecuted: { path: 'loan.executed', type: 'checkbox' },
  loanLender: { path: 'loan.lender', type: 'text' },
  loanExecutedDate: { path: 'loan.executedDate', type: 'date' },
  loanAmount: { path: 'loan.amount', type: 'money' },
  loanTermMonths: { path: 'loan.termMonths', type: 'number' },
  loanMonthlyPayment: { path: 'loan.monthlyPayment', type: 'money' },
  code: { path: 'code', type: 'text' },
  carModel: { path: 'carModel', type: 'text' },
  fuelType: { path: 'fuelType', type: 'text' },
  cc: { path: 'cc', type: 'number' },
  exteriorColor: { path: 'exteriorColor', type: 'text' },
  interiorColor: { path: 'interiorColor', type: 'text' },
  options: { path: 'options', type: 'text' },
  year: { path: 'year', type: 'text' },
  vin: { path: 'vin', type: 'text' },
  plateNo: { path: 'plateNo', type: 'text' },
  registrationDate: { path: 'registrationDate', type: 'date' },
  carPrice: { path: 'carPrice', type: 'money' },
  optionPrice: { path: 'optionPrice', type: 'money' },
  discount: { path: 'discount', type: 'money' },
  // 공급가액은 차량가 + 옵션가 + 탁송료 - 할인금액으로 저장할 때 계산된다
  supplyPrice: { path: 'supplyPrice', type: 'readonly' },
  deliveryFee: { path: 'deliveryFee', type: 'money' },
  acquisitionTax: { path: 'acquisitionTax', type: 'money' },
  publicBond: { path: 'publicBond', type: 'money' },
  registrationAgencyFee: { path: 'registrationAgencyFee', type: 'money' },
  deposit: { path: 'deposit', type: 'money' },
  advancePayment: { path: 'advancePayment', type: 'money' },
  takeoverPrice: { path: 'takeoverPrice', type: 'money' },
  monthlyFee: { path: 'monthlyFee', type: 'money' },
  paymentTerm: { path: 'paymentTerm', type: 'number' },
  individualConsumptionTax: { path: 'individualConsumptionTax', type: 'money' },
  insuranceCompany: { path: 'insurance.company', type: 'text' },
  insuranceType: {
    path: 'insurance.type',
    type: 'select',
    options: () => ([{ value: 'standard', label: '일반형' }, { value: 'premium', label: '고급형' }])
  },
  driverAge: { path: 'insurance.driverAge', type: 'text' },
  liabilityLimit: { path: 'insurance.liabilityLimit', type: 'text' },
  propertyLimit: { path: 'insurance.propertyLimit', type: 'text' },
  personalInjury: { path: 'insurance.personalInjury', type: 'text' },
  uninsuredInjury: { path: 'insurance.uninsuredInjury', type: 'text' },
  deductible: { path: 'insurance.deductible', type: 'money' },
  emergencyService: { path: 'insurance.emergencyService', type: 'text' },
  tireType: { path: 'maintenance.tireType', type: 'text' },
  maintenanceMileage: { path: 'maintenance.mileage', type: 'number' },
  // 순회정비·소모품교환은 일반정비를 따라가므로 보여만 준다
  regularCheck: { path: 'maintenance.regularCheck', type: 'readonly' },
  consumables: { path: 'maintenance.consumables', type: 'readonly' },
  generalMaintenance: {
    path: 'maintenance.generalMaintenance',
    type: 'select',
    options: () => ([{ value: '가입', label: '가입' }, { value: '미가입', label: '미가입' }]),
    // 일반정비에 가입하면 순회정비·소모품교환도 함께 가입이다
    apply: (form, value) => ({
      ...form,
      maintenance: {
        ...form.maintenance,
        generalMaintenance: value,
        regularCheck: value,
        consumables: value,
        enabled: value === '가입'
      }
    })
  },
  deliveryDate: { path: 'deliveryDate', type: 'date' },
  rentBillingDate: { path: 'rentBillingDate', type: 'date' },
  monthlyPaymentDay: { path: 'monthlyPaymentDay', type: 'select', options: () => PAYMENT_DAY_OPTIONS },
  interestRate: { path: 'interestRate', type: 'number' },
  lateInterestRate: { path: 'lateInterestRate', type: 'number' },
  earlyTerminationRate: { path: 'earlyTerminationRate', type: 'number' },
  // 회사수수료(이익률)와 이익금은 저장할 때 서버가 계산한다. 사람이 고치는 값이 아니다.
  companyCommission: { path: 'companyCommission', type: 'readonly' },
  profitAmount: { path: 'profitAmount', type: 'readonly' },
  dealerCommission: { path: 'dealerCommission', type: 'money' },
  sellingAdminExpense: { path: 'sellingAdminExpense', type: 'money' },
  taxExemptionAmount: { path: 'taxExemptionAmount', type: 'money' },
  driver: { path: 'driver', type: 'text' },
  vehicleManager: { path: 'vehicleManager', type: 'text' },
  blackboxPrice: { path: 'accessories.blackboxPrice', type: 'money' },
  blackboxInfo: { path: 'accessories.blackboxInfo', type: 'text' },
  tintingPrice: { path: 'accessories.tintingPrice', type: 'money' },
  tintingInfo: { path: 'accessories.tintingInfo', type: 'text' },
  tireInfo: { path: 'accessories.tireInfo', type: 'text' }
};

/** 'company.name'처럼 점으로 이어진 자리에서 값을 꺼낸다 */
const readPath = (obj, path) =>
  path.split('.').reduce((node, key) => (node === null || node === undefined ? node : node[key]), obj);

/** 값을 바꾼 새 객체를 만든다. 중간 객체도 새로 만들어야 화면이 다시 그려진다 */
const writePath = (obj, path, value) => {
  const keys = path.split('.');
  const next = { ...obj };
  let node = next;
  for (let i = 0; i < keys.length - 1; i += 1) {
    node[keys[i]] = { ...node[keys[i]] };
    node = node[keys[i]];
  }
  node[keys[keys.length - 1]] = value;
  return next;
};

const EMPTY_CONTRACT_PARTY = {
  partyType: '법인',
  contractorName: '',
  company: { name: '', ceoName: '', bizNo: '', corporateRegistrationNo: '', address: '', billingEmail: '' },
  banking: { holder: '', bankName: '', accountNo: '' },
  loan: { executed: false, lender: '', executedDate: '', amount: '', termMonths: '', monthlyPayment: '' }
};

const EMPTY_FORM = {
  ...EMPTY_CONTRACT_PARTY,
  code: '',
  carModel: '',
  fuelType: '가솔린',
  cc: '',
  exteriorColor: '',
  interiorColor: '',
  options: '',
  deliveryPeriod: '',
  year: '',
  vin: '',
  plateNo: '',
  registrationDate: '',
  carPrice: '',
  optionPrice: '',
  discount: '',
  supplyPrice: '',
  deliveryFee: '',
  acquisitionTax: '',
  publicBond: '',
  registrationAgencyFee: '',
  deposit: '',
  advancePayment: '',
  takeoverPrice: '',
  monthlyFee: '',
  paymentTerm: '',
  individualConsumptionTax: '',
  taxExemptionAmount: '',
  lateInterestRate: '',
  earlyTerminationRate: '',
  insurance: {
    company: '',
    type: 'standard',
    driverAge: '만 26세 이상',
    liabilityLimit: '무제한',
    propertyLimit: '1억원',
    personalInjury: '1억원',
    uninsuredInjury: '2억원',
    deductible: 300000,
    emergencyService: '가입'
  },
  maintenance: {
    enabled: false,
    tireType: '',
    mileage: '',
    regularCheck: '미가입',
    consumables: '미가입',
    generalMaintenance: '미가입'
  },
  status: '장기렌트',
  currentMileage: '',
  notes: '',

  // 출고 준비 정보 (출고 준비 화면과 동일한 필드 - 여기서도 수정 가능)
  deliveryDate: '',
  rentBillingDate: '',
  monthlyPaymentDay: '',
  interestRate: '',
  companyCommission: '',
  profitAmount: '',
  dealerCommission: '',
  sellingAdminExpense: '',
  driver: '',
  vehicleManager: '',
  accessories: {
    blackboxPrice: '',
    blackboxInfo: '',
    tintingPrice: '',
    tintingInfo: '',
    tireInfo: ''
  },
  gifts: [{ name: '', price: '' }]
};

function VehicleManagementView({ showToast, currentUser }) {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stats, setStats] = useState({ total: 0, '계약중': 0, '장기렌트': 0, '사고대차': 0, '거래완료': 0 });

  const [showModal, setShowModal] = useState(false);
  // 표에서 고치고 있는 줄. 수정 단추를 누르면 그 줄이 입력칸으로 바뀐다.
  const [editingRowId, setEditingRowId] = useState(null);

  // 팝업을 제목 줄로 잡아 끌어 옮길 수 있게 한다

  const { dragHandleProps, dragStyle } = useDraggableDialog(showModal);
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

  /** 엑셀 양식에 채워 넣은 차량들을 한 번에 등록한다 */
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    // 같은 파일을 고쳐서 다시 올리는 경우가 많아, 값을 비워야 onChange가 다시 발생한다
    e.target.value = '';
    if (!file) return;

    if (currentUser?.role === 'viewer') {
      showToast?.('등록 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }

    const body = new FormData();
    body.append('file', file);

    try {
      setImporting(true);
      const res = await fetch(`${API_BASE_URL}/api/vehicles/import`, {
        method: 'POST',
        headers: { 'X-User-Role': currentUser?.role || 'viewer' },
        body
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.message || '업로드에 실패했습니다.');
      }

      showToast?.(data.message, data.errorCount ? 'warning' : 'success');
      // 건너뛴 줄은 몇 번째 줄인지 알아야 고칠 수 있으므로 콘솔에 남긴다
      if (data.errors?.length) {
        console.warn('[차량 엑셀 업로드] 처리하지 못한 행:', data.errors);
      }
      fetchVehicles();
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const fetchVehicles = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
      if (statusFilter !== 'all') params.set('status', statusFilter);
      params.set('limit', '10000');

      const res = await fetch(`${API_BASE_URL}/api/vehicles?${params}`);
      const data = await res.json();
      if (data.success) {
        setVehicles(data.vehicles || []);
        setStats(data.stats || { total: 0, '계약중': 0, '장기렌트': 0, '사고대차': 0, '거래완료': 0 });
      }
    } catch (err) {
      console.error(err);
      showToast?.('차량 목록을 불러오지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVehicles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, statusFilter]);

  const openAddModal = () => {
    setEditingVehicle(null);
    setFormData(EMPTY_FORM);
    setShowModal(true);
  };

  // 고칠 차량을 폼에 싣는다. 표에서 고치든 팝업에서 고치든 같은 폼을 쓴다.
  const loadVehicleIntoForm = (vehicle) => {
    setEditingVehicle(vehicle);
    // 계약서로 등록된 차량은 계약이 정본이라 아래 값들을 편집하지 않는다(화면에서도 읽기 전용).
    // 계약에 묶인 차량은 계약이 가리키는 법인이 정본이고, 아니면 차량에 붙은 법인을 본다
    const company = vehicle.contract?.companyId || vehicle.company || {};
    setFormData({
      partyType: partyTypeOf(vehicle),
      contractorName: vehicle.contractorName || '',
      company: {
        // 어느 법인을 고치는지 서버가 알 수 있게 id를 함께 들고 간다.
        // 사업자번호를 고치는 순간 번호로는 못 찾아 같은 법인이 하나 더 생기기 때문이다.
        _id: company._id || '',
        name: company.name || '',
        ceoName: company.ceoName || '',
        bizNo: company.bizNo || '',
        corporateRegistrationNo: company.corporateRegistrationNo || '',
        address: company.address || '',
        billingEmail: company.billingEmail || ''
      },
      banking: {
        holder: vehicle.banking?.holder || '',
        bankName: vehicle.banking?.bankName || '',
        accountNo: vehicle.banking?.accountNo || ''
      },
      loan: {
        executed: !!vehicle.loan?.executed,
        lender: vehicle.loan?.lender || '',
        executedDate: vehicle.loan?.executedDate ? String(vehicle.loan.executedDate).slice(0, 10) : '',
        amount: vehicle.loan?.amount ?? '',
        termMonths: vehicle.loan?.termMonths ?? '',
        monthlyPayment: vehicle.loan?.monthlyPayment ?? ''
      },
      code: vehicle.code || '',
      carModel: vehicle.carModel || '',
      fuelType: vehicle.fuelType || '가솔린',
      cc: vehicle.cc ?? '',
      exteriorColor: vehicle.exteriorColor || '',
      interiorColor: vehicle.interiorColor || '',
      options: vehicle.options || '',
      deliveryPeriod: vehicle.deliveryPeriod || '',
      year: vehicle.year || '',
      vin: vehicle.vin || '',
      plateNo: vehicle.plateNo || '',
      registrationDate: vehicle.registrationDate ? String(vehicle.registrationDate).slice(0, 10) : '',
      carPrice: vehicle.carPrice ?? '',
      optionPrice: vehicle.optionPrice ?? '',
      discount: vehicle.discount ?? '',
      supplyPrice: vehicle.supplyPrice ?? '',
      deliveryFee: vehicle.deliveryFee ?? '',
      acquisitionTax: vehicle.acquisitionTax ?? '',
      publicBond: vehicle.publicBond ?? '',
      registrationAgencyFee: vehicle.registrationAgencyFee ?? '',
      deposit: vehicle.deposit ?? '',
      advancePayment: vehicle.advancePayment ?? '',
      takeoverPrice: vehicle.takeoverPrice ?? '',
      monthlyFee: vehicle.monthlyFee ?? '',
      paymentTerm: vehicle.paymentTerm ?? '',
      individualConsumptionTax: vehicle.individualConsumptionTax ?? '',
      taxExemptionAmount: vehicle.taxExemptionAmount ?? '',
      lateInterestRate: vehicle.lateInterestRate ?? '',
      earlyTerminationRate: vehicle.earlyTerminationRate ?? '',
      insurance: {
        company: vehicle.insurance?.company || '',
        type: vehicle.insurance?.type || 'standard',
        driverAge: vehicle.insurance?.driverAge || '만 26세 이상',
        liabilityLimit: vehicle.insurance?.liabilityLimit || '무제한',
        propertyLimit: vehicle.insurance?.propertyLimit || '1억원',
        personalInjury: vehicle.insurance?.personalInjury || '1억원',
        uninsuredInjury: vehicle.insurance?.uninsuredInjury || '2억원',
        deductible: vehicle.insurance?.deductible ?? 300000,
        emergencyService: vehicle.insurance?.emergencyService || '가입'
      },
      maintenance: {
        enabled: !!vehicle.maintenance?.enabled,
        tireType: vehicle.maintenance?.tireType || '',
        mileage: vehicle.maintenance?.mileage ?? '',
        regularCheck: vehicle.maintenance?.regularCheck || '미가입',
        consumables: vehicle.maintenance?.consumables || '미가입',
        generalMaintenance: vehicle.maintenance?.generalMaintenance || '미가입'
      },
      status: vehicle.status || '장기렌트',
      currentMileage: vehicle.currentMileage ?? '',
      notes: vehicle.notes || '',

      deliveryDate: vehicle.deliveryDate ? String(vehicle.deliveryDate).slice(0, 10) : '',
      rentBillingDate: vehicle.rentBillingDate ? String(vehicle.rentBillingDate).slice(0, 10) : '',
      monthlyPaymentDay: vehicle.monthlyPaymentDay ?? '',
      interestRate: vehicle.interestRate ?? '',
      companyCommission: vehicle.companyCommission ?? '',
      profitAmount: vehicle.profitAmount ?? '',
      dealerCommission: vehicle.dealerCommission ?? '',
      sellingAdminExpense: vehicle.sellingAdminExpense ?? '',
      driver: vehicle.driver || '',
      vehicleManager: vehicle.vehicleManager || '',
      accessories: {
        blackboxPrice: vehicle.accessories?.blackboxPrice ?? '',
        blackboxInfo: vehicle.accessories?.blackboxInfo || '',
        tintingPrice: vehicle.accessories?.tintingPrice ?? '',
        tintingInfo: vehicle.accessories?.tintingInfo || '',
        tireInfo: vehicle.accessories?.tireInfo || ''
      },
      gifts: vehicle.gifts && vehicle.gifts.length > 0
        ? vehicle.gifts.map(g => ({ name: g.name || '', price: g.price ?? '' }))
        : [{ name: '', price: '' }]
    });
    // 팝업은 여기서 열지 않는다. 수정은 표에서 하고, 팝업은 '차량 추가'와 '자세히'에서만 연다.
  };

  const handleRentBillingDateChange = (value) => {
    // 결제일은 정해진 값 중에서만 고르므로, 게시일의 '일'이 목록에 없으면 건드리지 않는다
    const day = value ? String(Number(value.slice(8, 10))) : '';
    const usable = PAYMENT_DAY_OPTIONS.some(o => o.value === day);
    setFormData(prev => ({ ...prev, rentBillingDate: value, monthlyPaymentDay: usable ? day : prev.monthlyPaymentDay }));
  };

  const handleGiftChange = (index, field, value) => {
    setFormData(prev => {
      const gifts = [...prev.gifts];
      gifts[index] = { ...gifts[index], [field]: value };
      return { ...prev, gifts };
    });
  };

  /** 표에서 그 줄을 바로 고친다 */
  const startInlineEdit = (vehicle) => {
    if (currentUser?.role === 'viewer') {
      showToast?.('수정 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    loadVehicleIntoForm(vehicle);
    setEditingRowId(vehicle._id);
  };

  const cancelInlineEdit = () => {
    setEditingRowId(null);
    setEditingVehicle(null);
  };

  /** 표에 없는 항목(사은품·비고 등)까지 고칠 때. 지금 싣고 있는 폼 그대로 팝업을 연다. */
  const openDetailPopup = () => setShowModal(true);

  // 표에서 고치는 중에 Esc를 누르면 되돌린다
  useEffect(() => {
    if (!editingRowId) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape') cancelInlineEdit(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingRowId]);

  /** 일반정비에 가입하면 순회정비·소모품교환도 함께 가입이다 */
  const setGeneralMaintenance = (value) => {
    setFormData((prev) => ({
      ...prev,
      maintenance: {
        ...prev.maintenance,
        generalMaintenance: value,
        regularCheck: value,
        consumables: value,
        enabled: value === '가입'
      }
    }));
  };

  const handleAddGift = () => {
    setFormData(prev => ({ ...prev, gifts: [...prev.gifts, { name: '', price: '' }] }));
  };

  const handleRemoveGift = (index) => {
    setFormData(prev => ({ ...prev, gifts: prev.gifts.filter((_, i) => i !== index) }));
  };

  // 출고가 끝난 차량을 다시 출고 준비 목록으로 되돌린다.
  //
  // 출고 준비 화면은 '계약중' + 계약서에 연결된 차량을 대상으로 하므로 상태만 되돌리면 된다.
  // 차량번호/차대번호는 실제로 등록된 값이라 지우지 않는다(지우면 등록증을 다시 봐야 한다).
  const handleSendToDeliveryPrep = async () => {
    if (currentUser?.role === 'viewer') {
      showToast?.('수정 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (!editingVehicle?.contract) {
      showToast?.('출고 준비는 계약서에 연결된 차량만 가능합니다.', 'info');
      return;
    }
    if (!window.confirm(`${editingVehicle.carModel} 차량을 출고 준비 목록으로 되돌릴까요?\n상태가 '계약중'으로 바뀌고 출고 준비 화면에 다시 나타납니다.`)) {
      return;
    }

    try {
      setSaving(true);
      const res = await fetch(`${API_BASE_URL}/api/vehicles/${editingVehicle._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
        body: JSON.stringify({ status: '계약중' })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast?.('출고 준비 목록으로 되돌렸습니다. 출고 준비 화면에서 이어서 입력하세요.', 'success');
        setShowModal(false);
        fetchVehicles();
      } else {
        showToast?.(data.message || '되돌리지 못했습니다.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    if (currentUser?.role === 'viewer') {
      showToast?.('등록 및 수정 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (!formData.carModel.trim()) {
      showToast?.('차종은 필수입니다.', 'error');
      return;
    }

    try {
      setSaving(true);
      const isBusiness = hasBusinessInfo(formData.partyType);
      // 계약에 묶인 차량은 계약이 정본이라, 법인 정보만 고치고 차량-법인 연결은 그대로 둔다
      const linkedToContract = Boolean(editingVehicle?.contract);
      // 개인사업자처럼 계약구분이 '개인'이어도 사업자 정보(사업자번호·대표자·주소)가
      // 붙어 있는 계약자가 있다. 그 정보는 법인 문서에만 저장되므로, 연결이 있으면
      // 계약구분과 상관없이 함께 보내야 저장하면서 지워지지 않는다.
      const hasCompanyDoc = Boolean(formData.company?._id);
      const sendCompany = isBusiness || linkedToContract || hasCompanyDoc;
      const payload = {
        _keepContractLink: linkedToContract || undefined,
        ...formData,
        partyType: formData.partyType,
        // 계약으로 만들어진 차량은 법인을 계약이 들고 있어서 차량 쪽 partyType이 '개인'이다.
        // 그 경우에도 법인 정보를 고칠 수 있어야 하므로, 계약에 묶인 차량이면 항상 보낸다.
        // (예전에는 차량 partyType이 '법인'일 때만 보내서, 고친 값이 전송조차 되지 않았다)
        _contractorName: sendCompany ? (formData.company.name || formData.contractorName) : formData.contractorName,
        _company: sendCompany ? formData.company : {},
        company: undefined,
        contractorName: undefined,
        banking: { ...formData.banking },
        loan: {
          executed: !!formData.loan.executed,
          lender: formData.loan.lender,
          executedDate: formData.loan.executedDate || undefined,
          amount: formData.loan.amount === '' ? undefined : Number(formData.loan.amount),
          termMonths: formData.loan.termMonths === '' ? undefined : Number(formData.loan.termMonths),
          monthlyPayment: formData.loan.monthlyPayment === '' ? undefined : Number(formData.loan.monthlyPayment)
        },
        cc: formData.cc === '' ? undefined : Number(formData.cc),
        carPrice: formData.carPrice === '' ? undefined : Number(formData.carPrice),
        optionPrice: formData.optionPrice === '' ? undefined : Number(formData.optionPrice),
        discount: formData.discount === '' ? undefined : Number(formData.discount),
        supplyPrice: formData.supplyPrice === '' ? undefined : Number(formData.supplyPrice),
        deliveryFee: formData.deliveryFee === '' ? undefined : Number(formData.deliveryFee),
        acquisitionTax: formData.acquisitionTax === '' ? undefined : Number(formData.acquisitionTax),
        publicBond: formData.publicBond === '' ? undefined : Number(formData.publicBond),
        registrationAgencyFee: formData.registrationAgencyFee === '' ? undefined : Number(formData.registrationAgencyFee),
        deposit: formData.deposit === '' ? undefined : Number(formData.deposit),
        advancePayment: formData.advancePayment === '' ? undefined : Number(formData.advancePayment),
        takeoverPrice: formData.takeoverPrice === '' ? undefined : Number(formData.takeoverPrice),
        monthlyFee: formData.monthlyFee === '' ? undefined : Number(formData.monthlyFee),
        paymentTerm: formData.paymentTerm === '' ? undefined : Number(formData.paymentTerm),
        individualConsumptionTax: formData.individualConsumptionTax === '' ? undefined : Number(formData.individualConsumptionTax),
        taxExemptionAmount: formData.taxExemptionAmount === '' ? undefined : Number(formData.taxExemptionAmount),
        lateInterestRate: formData.lateInterestRate === '' ? undefined : Number(formData.lateInterestRate),
        earlyTerminationRate: formData.earlyTerminationRate === '' ? undefined : Number(formData.earlyTerminationRate),
        currentMileage: formData.currentMileage === '' ? undefined : Number(formData.currentMileage),
        registrationDate: formData.registrationDate || undefined,
        maintenance: {
          ...formData.maintenance,
          mileage: formData.maintenance.mileage === '' ? undefined : Number(formData.maintenance.mileage)
        },

        deliveryDate: formData.deliveryDate || undefined,
        rentBillingDate: formData.rentBillingDate || undefined,
        monthlyPaymentDay: formData.monthlyPaymentDay || undefined,
        interestRate: formData.interestRate === '' ? undefined : Number(formData.interestRate),
        // 회사수수료(이익률)·이익금은 서버가 계산하므로 보내지 않는다
        companyCommission: undefined,
        profitAmount: undefined,
        dealerCommission: formData.dealerCommission === '' ? undefined : Number(formData.dealerCommission),
        sellingAdminExpense: formData.sellingAdminExpense === '' ? undefined : Number(formData.sellingAdminExpense),
        accessories: {
          blackboxPrice: formData.accessories.blackboxPrice === '' ? undefined : Number(formData.accessories.blackboxPrice),
          blackboxInfo: formData.accessories.blackboxInfo,
          tintingPrice: formData.accessories.tintingPrice === '' ? undefined : Number(formData.accessories.tintingPrice),
          tintingInfo: formData.accessories.tintingInfo,
          tireInfo: formData.accessories.tireInfo
        },
        gifts: formData.gifts
          .filter(g => g.name.trim() !== '')
          .map(g => ({ name: g.name, price: g.price === '' ? 0 : Number(g.price) }))
      };

      const res = editingVehicle
        ? await fetch(`${API_BASE_URL}/api/vehicles/${editingVehicle._id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
            body: JSON.stringify(payload)
          })
        : await fetch(`${API_BASE_URL}/api/vehicles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
            body: JSON.stringify(payload)
          });

      const data = await res.json();
      if (res.ok && data.success) {
        showToast?.(data.message || '저장되었습니다.', 'success');
        setShowModal(false);
        setEditingRowId(null);
        fetchVehicles();
      } else {
        showToast?.(data.message || '저장에 실패했습니다.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // 팝업이 열려 있는 동안 Ctrl+S로 저장한다
  // 팝업이든 표에서든 고치는 중이면 Ctrl+S로 저장한다
  useSaveShortcut((showModal || Boolean(editingRowId)) && !saving, () => handleSave());

  const handleDelete = async (vehicle) => {
    if (currentUser?.role === 'viewer') {
      showToast?.('삭제 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (vehicle.contract) {
      showToast?.('계약과 연결된 차량은 계약서를 먼저 삭제해야 지울 수 있습니다.', 'error');
      return;
    }
    if (!window.confirm(`"${vehicle.carModel}" 차량을 삭제하시겠습니까?`)) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/vehicles/${vehicle._id}`, {
        method: 'DELETE',
        headers: { 'X-User-Role': currentUser?.role || 'viewer' }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast?.('삭제되었습니다.', 'success');
        setVehicles(prev => prev.filter(v => v._id !== vehicle._id));
      } else {
        showToast?.(data.message || '삭제에 실패했습니다.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  const inputStyle = { width: '100%', padding: '0.55rem 0.7rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-bright)', fontSize: '0.85rem' };
  const labelStyle = { fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' };

  // 표 머리글을 위에 붙여 둔다(엑셀의 틀 고정).
  //
  // borderCollapse가 collapse라 붙어 있는 칸에는 아래 테두리가 그려지지 않는다.
  // 그래서 테두리 대신 안쪽 그림자로 밑줄을 만든다.
  const stickyHeadStyle = {
    padding: '0.8rem',
    whiteSpace: 'nowrap',
    position: 'sticky',
    top: 0,
    zIndex: 2,
    background: 'var(--bg-main)',
    boxShadow: 'inset 0 -1px 0 var(--border-color)'
  };

  // 표 안에서 쓰는 작은 입력칸
  const cellInputStyle = {
    width: '100%', minWidth: '92px', padding: '0.3rem 0.4rem',
    border: '1px solid var(--primary)', borderRadius: '4px',
    fontSize: '0.82rem', background: '#fff', color: 'var(--text-bright)'
  };

  /**
   * 표의 한 칸을 고치는 입력칸을 그린다.
   * 고칠 수 없는 칸(CELL_EDITORS에 없는 열)은 null을 돌려주고, 부르는 쪽에서 원래 값을 보여 준다.
   */
  const renderCellEditor = (col) => {
    const editor = CELL_EDITORS[col.key];
    if (!editor) return null;

    const value = readPath(formData, editor.path);
    // apply가 있는 칸은 옆 칸까지 함께 정한다(일반정비 -> 순회정비·소모품교환)
    const onChange = (next) => setFormData((prev) => (
      editor.apply ? editor.apply(prev, next) : writePath(prev, editor.path, next)
    ));

    if (editor.type === 'readonly') {
      return (
        <span title="일반정비를 따라갑니다" style={{ color: 'var(--text-muted)' }}>
          {value || '-'}
        </span>
      );
    }

    if (editor.type === 'money') {
      return <MoneyInput value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={cellInputStyle} />;
    }
    if (editor.type === 'number') {
      return <input type="number" value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={{ ...cellInputStyle, textAlign: 'right' }} />;
    }
    if (editor.type === 'date') {
      return <input type="date" value={String(value || '').slice(0, 10)} onChange={(e) => onChange(e.target.value)} style={cellInputStyle} />;
    }
    if (editor.type === 'checkbox') {
      return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
    }
    if (editor.type === 'select') {
      const options = editor.options();
      // 목록에 없는 값이 저장돼 있으면(예전 자료) 그 값도 보여 줘야 모르는 새 바뀌지 않는다
      const unlisted = value !== '' && value !== null && value !== undefined
        && !options.some((o) => String(o.value) === String(value));
      return (
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={cellInputStyle}>
          <option value="">-</option>
          {unlisted && <option value={value}>{String(value)}</option>}
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
    }
    return <input type="text" value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={cellInputStyle} />;
  };

  // 공급가액은 입력받지 않고 계산해서 보여 준다. 저장 값도 서버가 같은 식으로 다시 계산한다.
  const supplyPricePreview = (() => {
    const num = (value) => (value === '' || value === null || value === undefined ? 0 : Number(value) || 0);
    const parts = [formData.carPrice, formData.optionPrice, formData.deliveryFee, formData.discount];
    if (parts.every((v) => v === '' || v === null || v === undefined)) return '';
    return num(formData.carPrice) + num(formData.optionPrice) + num(formData.deliveryFee) - num(formData.discount);
  })();

  const formatMoney = (v) => (v || v === 0) ? `${Number(v).toLocaleString()}원` : '-';
  // 이익률은 소수 둘째 자리까지. 적자는 눈에 띄게 붉게 보여 준다.
  const formatRate = (v) => {
    if (v === null || v === undefined || v === '') return '-';
    const rate = Number(v);
    return <span style={{ fontWeight: '700', color: rate < 0 ? 'var(--error)' : 'var(--text-bright)' }}>{rate.toFixed(2)}%</span>;
  };
  const formatDateCell = (v) => v ? new Date(v).toLocaleDateString() : '-';

  // 계약의 고객 이름. 고객이 없으면 빈 값을 돌려준다.
  //
  // formatCustomerName은 고객이 없을 때 화면에 찍을 '-'를 돌려주는데,
  // 그 '-'가 아래 계약사 계산에서 "값이 있다"로 취급돼 뒤 항목까지 내려가지 못했다.
  // 계약이 없는 차량(엑셀로 직접 올린 차량 등)은 차량에 법인·계약자명이 붙어 있는데도
  // 계약사 칸이 전부 '-'로 보이던 원인이다.
  const getContractCustomerName = (v) => {
    if (!v.contract?.customer) return '';
    const name = formatCustomerName(v.contract.customer);
    return name === '-' ? '' : name;
  };

  // 계약사(법인명/개인명) - contract가 있으면 계약 쪽 정보를 우선으로, 없으면 재고 차량에 직접 붙은 정보를 본다
  const getContractCompanyName = (v) =>
    v.contract?.companyId?.name
    || getContractCustomerName(v)
    || v.company?.name
    || v.contractorName
    || '-';

  // 대표자 - 법인이면 Company.ceoName, 개인 계약은 대표자 개념이 없으므로 '-'
  const getContractCeoName = (v) =>
    v.contract?.companyId?.ceoName
    || v.company?.ceoName
    || '-';

  const getCompanyField = (v, field) => v.contract?.companyId?.[field] || v.company?.[field] || '-';

  // 렌트차량 DB에 저장되는 항목을 빠짐없이 보여주기 위한 열 정의.
  // NO(행 번호)만 화면 전용이고, 그 뒤로는 엑셀 양식(VEHICLE_EXCEL_COLUMNS)과 같은 순서를 그대로 따라
  // 엑셀에 입력한 값이 웹페이지의 몇 번째 열에 들어갔는지 바로 대조할 수 있게 했습니다.
  const VEHICLE_COLUMNS = [
    { key: 'no', label: 'NO', sortable: false, render: (v, idx) => idx + 1 },
    { key: 'status', label: '상태', render: (v) => {
      const c = STATUS_COLORS[v.status] || STATUS_COLORS['장기렌트'];
      return <span style={{ background: c.bg, color: c.text, padding: '0.2rem 0.6rem', borderRadius: '20px', fontSize: '0.75rem', fontWeight: '700' }}>{STATUS_LABELS[v.status] || v.status}</span>;
    } },
    { key: 'partyType', label: '계약구분', render: (v) => partyTypeOf(v) },
    { key: 'contractCompany', label: '계약사', render: (v) => getContractCompanyName(v) },
    { key: 'ceoName', label: '대표자', render: (v) => getContractCeoName(v) },
    // 사양은 차량 칸에 함께 적는다(예: "G80 3.5T AWD"). 따로 두면 두 칸을 오가며 봐야 했다.
    { key: 'carModel', label: '차량', render: (v) => v.carModel || '-' },
    { key: 'bizNo', label: '사업자번호', render: (v) => getCompanyField(v, 'bizNo') },
    { key: 'corporateRegistrationNo', label: '법인등록번호', render: (v) => getCompanyField(v, 'corporateRegistrationNo') },
    { key: 'companyAddress', label: '사업장주소', render: (v) => getCompanyField(v, 'address') },
    { key: 'billingEmail', label: '청구이메일', render: (v) => getCompanyField(v, 'billingEmail') },
    { key: 'bankHolder', label: '예금주명', render: (v) => v.banking?.holder || '-' },
    { key: 'bankName', label: '은행', render: (v) => v.banking?.bankName || '-' },
    { key: 'bankAccountNo', label: '계좌번호', render: (v) => v.banking?.accountNo || '-' },
    { key: 'loanExecuted', label: '대출실행', render: (v) => v.loan?.executed ? '실행' : '미실행' },
    { key: 'loanLender', label: '차용처', render: (v) => v.loan?.lender || '-' },
    { key: 'loanExecutedDate', label: '실행일', sortValue: (v) => v.loan?.executedDate, render: (v) => formatDateCell(v.loan?.executedDate) },
    { key: 'loanAmount', label: '할부이용금액', render: (v) => formatMoney(v.loan?.amount) },
    { key: 'loanTermMonths', label: '할부기간', render: (v) => v.loan?.termMonths ? `${v.loan.termMonths}개월` : '-' },
    { key: 'loanMonthlyPayment', label: '월할부금', render: (v) => formatMoney(v.loan?.monthlyPayment) },
    { key: 'code', label: '코드', render: (v) => <span style={{ fontWeight: '700' }}>{v.code || '-'}</span> },
    { key: 'fuelType', label: '유종', render: (v) => v.fuelType || '-' },
    { key: 'cc', label: '배기량', render: (v) => v.cc ? `${v.cc}cc` : '-' },
    { key: 'exteriorColor', label: '외장색상', render: (v) => v.exteriorColor || '-' },
    { key: 'interiorColor', label: '내장색상', render: (v) => v.interiorColor || '-' },
    { key: 'options', label: '옵션', render: (v) => v.options || '-' },
    { key: 'year', label: '연식', render: (v) => v.year || '-' },
    { key: 'vin', label: '차대번호', render: (v) => v.vin || '-' },
    { key: 'plateNo', label: '차량번호', render: (v) => v.plateNo || '-' },
    { key: 'registrationDate', label: '등록일', sortValue: (v) => v.registrationDate, render: (v) => formatDateCell(v.registrationDate) },
    { key: 'carPrice', label: '차량가', render: (v) => formatMoney(v.carPrice) },
    { key: 'optionPrice', label: '옵션가', render: (v) => formatMoney(v.optionPrice) },
    { key: 'discount', label: '할인금액', render: (v) => formatMoney(v.discount) },
    // 공급가액 = 차량가 + 옵션가 + 탁송료 - 할인금액 (저장할 때 서버가 계산)
    { key: 'supplyPrice', label: '공급가액', render: (v) => formatMoney(v.supplyPrice) },
    { key: 'deliveryFee', label: '탁송료', render: (v) => formatMoney(v.deliveryFee) },
    { key: 'acquisitionTax', label: '취득세', render: (v) => formatMoney(v.acquisitionTax) },
    { key: 'publicBond', label: '공채', render: (v) => formatMoney(v.publicBond) },
    { key: 'registrationAgencyFee', label: '등록대행료', render: (v) => formatMoney(v.registrationAgencyFee) },
    { key: 'deposit', label: '보증금', render: (v) => formatMoney(v.deposit) },
    { key: 'advancePayment', label: '선수금', render: (v) => formatMoney(v.advancePayment) },
    { key: 'takeoverPrice', label: '인수가', render: (v) => formatMoney(v.takeoverPrice) },
    { key: 'monthlyFee', label: '월렌트료', render: (v) => <span style={{ fontWeight: '700' }}>{formatMoney(v.monthlyFee)}</span> },
    { key: 'paymentTerm', label: '납입개월수', render: (v) => v.paymentTerm ? `${v.paymentTerm}개월` : '-' },
    // 견적서에서 넘어오는 값은 계약 기간 전체의 자동차세 합계다(연간액 x 계약 연수).
    // 예전에는 '개별소비세'라는 이름으로 표시돼 다른 세금으로 오해할 수 있었다.
    { key: 'individualConsumptionTax', label: '자동차세', render: (v) => formatMoney(v.individualConsumptionTax) },
    { key: 'insuranceCompany', label: '보험사', render: (v) => v.insurance?.company || '-' },
    { key: 'insuranceType', label: '보험구분', render: (v) => v.insurance?.type === 'premium' ? '고급형' : '일반형' },
    { key: 'driverAge', label: '운전자연령', render: (v) => v.insurance?.driverAge || '-' },
    { key: 'liabilityLimit', label: '대인', render: (v) => v.insurance?.liabilityLimit || '-' },
    { key: 'propertyLimit', label: '대물', render: (v) => v.insurance?.propertyLimit || '-' },
    { key: 'personalInjury', label: '자기손해', render: (v) => v.insurance?.personalInjury || '-' },
    { key: 'uninsuredInjury', label: '무보험차상해', render: (v) => v.insurance?.uninsuredInjury || '-' },
    { key: 'deductible', label: '자기부담금', render: (v) => formatMoney(v.insurance?.deductible) },
    { key: 'emergencyService', label: '긴급출동', render: (v) => v.insurance?.emergencyService || '-' },
    { key: 'tireType', label: '타이어등급', render: (v) => v.maintenance?.tireType || '-' },
    { key: 'maintenanceMileage', label: '연간주행거리', render: (v) => v.maintenance?.mileage ? `${v.maintenance.mileage.toLocaleString()}km` : '-' },
    // 순회정비·소모품교환은 일반정비를 따라간다(일반정비에 가입하면 셋 다 가입되는 상품).
    // 그래서 표에서는 읽기만 하고, 고치는 것은 일반정비 한 칸이다.
    { key: 'regularCheck', label: '순회정비', render: (v) => v.maintenance?.regularCheck || '-' },
    { key: 'consumables', label: '소모품교환', render: (v) => v.maintenance?.consumables || '-' },
    { key: 'generalMaintenance', label: '일반정비', render: (v) => v.maintenance?.generalMaintenance || '-' },
    { key: 'deliveryDate', label: '인도일', sortValue: (v) => v.deliveryDate, render: (v) => formatDateCell(v.deliveryDate) },
    { key: 'rentBillingDate', label: '렌트료게시일', sortValue: (v) => v.rentBillingDate, render: (v) => formatDateCell(v.rentBillingDate) },
    { key: 'monthlyPaymentDay', label: '월결제일', render: (v) => formatPaymentDay(v.monthlyPaymentDay) || '-' },
    { key: 'interestRate', label: '금리', render: (v) => (v.interestRate || v.interestRate === 0) ? `${v.interestRate}%` : '-' },
    { key: 'lateInterestRate', label: '연체이율', render: (v) => (v.lateInterestRate || v.lateInterestRate === 0) ? `연 ${v.lateInterestRate}%` : '-' },
    { key: 'earlyTerminationRate', label: '중도해지수수료율', render: (v) => (v.earlyTerminationRate || v.earlyTerminationRate === 0) ? `${v.earlyTerminationRate}%` : '-' },
    // 회사수수료 = 이익률(%) = 이익금 / 차량가. 옆의 이익금과 짝이다(둘 다 저장할 때 계산된다).
    { key: 'companyCommission', label: '회사수수료(이익률)', render: (v) => formatRate(v.companyCommission) },
    { key: 'profitAmount', label: '이익금', render: (v) => formatMoney(v.profitAmount) },
    { key: 'dealerCommission', label: '타딜러수수료', render: (v) => formatMoney(v.dealerCommission) },
    { key: 'sellingAdminExpense', label: '판관비', render: (v) => formatMoney(v.sellingAdminExpense) },
    { key: 'driver', label: '운전자', render: (v) => v.driver || '-' },
    { key: 'vehicleManager', label: '차량관리자', render: (v) => v.vehicleManager || '-' },
    { key: 'blackboxPrice', label: '블랙박스금액', render: (v) => formatMoney(v.accessories?.blackboxPrice) },
    { key: 'blackboxInfo', label: '블랙박스정보', render: (v) => v.accessories?.blackboxInfo || '-' },
    { key: 'tintingPrice', label: '선팅금액', render: (v) => formatMoney(v.accessories?.tintingPrice) },
    { key: 'tintingInfo', label: '선팅정보', render: (v) => v.accessories?.tintingInfo || '-' },
    { key: 'tireInfo', label: '타이어', render: (v) => v.accessories?.tireInfo || '-' },
    // 아래 두 항목은 엑셀 양식에는 없고(계약서 등록에서만 채워짐) 화면에만 보조로 표시합니다.
    { key: 'gifts', label: '사은품', render: (v) => v.gifts?.length ? v.gifts.map((g) => g.name).filter(Boolean).join(', ') || '-' : '-' },
    { key: 'contractNo', label: '계약번호', render: (v) => (
      v.contract ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', whiteSpace: 'nowrap' }}>
          <FileSignature size={12} style={{ color: 'var(--primary)' }} />
          {v.contract.contractNo}
        </span>
      ) : (
        <span style={{ color: 'var(--text-muted)' }}>미연결 (재고)</span>
      )
    ) },
    // 면세금액 - 국산차를 렌터카로 살 때 받은 개별소비세·교육세 면세분.
    // 단기렌트면 그대로 혜택이지만, 장기렌트로 세금계산서를 발행하면 환입해야 한다.
    { key: 'taxExemptionAmount', label: '면세금액', render: (v) => formatMoney(v.taxExemptionAmount) }
  ];

  // 표 머리글을 눌러 정렬한다. 검색·상태는 서버가 걸러 주고, 정렬은 받아 온 목록에서 한다.
  // 정렬을 고르지 않았을 때는 기본 순서(상태 -> 최근 출고순)로 보여 준다.
  const orderedVehicles = [...vehicles].sort(byDefaultOrder);
  const sort = useTableSort(orderedVehicles, VEHICLE_COLUMNS);
  const sortedVehicles = sort.rows;

  const statCards = [
    { key: 'total', label: '전체 차량', value: stats.total, color: 'var(--primary)' },
    { key: '계약중', label: '계약중', value: stats['계약중'], color: STATUS_COLORS['계약중'].text },
    { key: '장기렌트', label: '장기렌트', value: stats['장기렌트'], color: STATUS_COLORS['장기렌트'].text },
    { key: '사고대차', label: '사고대차', value: stats['사고대차'], color: STATUS_COLORS['사고대차'].text },
    { key: '거래완료', label: '거래완료', value: stats['거래완료'], color: STATUS_COLORS['거래완료'].text }
  ];

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* 통계 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
        {statCards.map(card => (
          <div key={card.key} style={{ background: '#fff', padding: '1.2rem', borderRadius: '10px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)' }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: '600' }}>{card.label}</div>
            <div style={{ fontSize: '1.6rem', fontWeight: '800', color: card.color, marginTop: '0.3rem' }}>{card.value}</div>
          </div>
        ))}
      </div>

      {/* 검색/필터/추가 */}
      <div style={{ background: '#fff', padding: '1rem 1.5rem', borderRadius: '10px', border: '1px solid var(--border-color)', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, position: 'relative', minWidth: '240px' }}>
          <Search size={14} style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="계약사 · 대표자 · 차량코드 · 차종 · 차량번호 · 차대번호 · 계약번호 검색..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '0.6rem 1rem 0.6rem 2.2rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.88rem' }}
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ padding: '0.6rem 0.8rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
          <option value="all">전체 상태</option>
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
        {/* 정렬 - 표 머리글을 눌러도 같은 기준으로 바뀝니다 */}
        <SortControls
          sort={sort}
          defaultLabel="기본 순서 (상태 · 최근 출고순)"
          show={sort.active || Boolean(searchTerm) || statusFilter !== 'all'}
          onReset={() => { setSearchTerm(''); setStatusFilter('all'); }}
        />
        <button
          type="button"
          onClick={openAddModal}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.6rem 1.1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer' }}
        >
          <Plus size={16} /> 차량 추가
        </button>

        <a
          href={`${API_BASE_URL}/api/vehicles/template`}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: '#fff', color: 'var(--text-main)', border: '1px solid var(--border-color)', padding: '0.6rem 1.1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer', textDecoration: 'none' }}
        >
          <Download size={16} /> 엑셀 양식
        </a>

        {/* 파일 선택창은 input이 열어야 해서, 버튼을 눌러 숨겨둔 input을 대신 클릭시킨다 */}
        <input
          type="file"
          accept=".xlsx,.xls"
          ref={fileInputRef}
          onChange={handleImportFile}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: importing ? '#94a3b8' : '#107c41', color: '#fff', border: 'none', padding: '0.6rem 1.1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: '700', cursor: importing ? 'not-allowed' : 'pointer' }}
        >
          <Upload size={16} /> {importing ? '업로드 중...' : '엑셀 업로드'}
        </button>
      </div>

      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', background: 'var(--bg-main)', padding: '0.7rem 1rem', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>
        💡 계약서를 등록하면 차량이 여기에 자동으로 등록됩니다. "차량 추가"와 "엑셀 업로드"는 계약과 무관한 차량을 직접 넣을 때 사용하세요.
        <br />
        📄 여러 대를 한 번에 넣으려면 <strong>엑셀 양식</strong>을 받아 2행 아래부터 입력한 뒤 <strong>엑셀 업로드</strong>하세요. 2행의 안내 문구는 지우지 않아도 됩니다. 고객·법인·계약 정보는 계약서 등록에서 연결되므로 양식에 없습니다.
      </div>

      {/* 목록 - 렌트차량 DB에 저장된 항목을 전부 열로 보여주고, 옆으로 스크롤해서 확인합니다 */}
      <div style={{ background: '#fff', borderRadius: '10px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        {/* 표를 화면 안에서 스크롤시킨다. 머리글을 이 안에 붙여 둬야 아래로 내려도 항목 이름이 계속 보인다. */}
        <div style={{ overflow: 'auto', maxHeight: 'calc(100vh - 420px)', minHeight: '300px' }}>
          <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--bg-main)', color: 'var(--text-bright)', fontWeight: '700' }}>
                {VEHICLE_COLUMNS.map((col) => {
                  const frozen = frozenCellStyle(col.key, 'var(--bg-main)', 4);
                  return (
                    <SortableTh
                      key={col.key}
                      sort={sort}
                      columnKey={col.key}
                      style={frozen ? { ...stickyHeadStyle, ...frozen } : stickyHeadStyle}
                    >
                      {col.label}
                    </SortableTh>
                  );
                })}
                {/* 관리 열은 가로로도 고정이라 위·오른쪽 둘 다 붙는다 */}
                <th style={{ ...stickyHeadStyle, width: '80px', right: 0, zIndex: 3 }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={VEHICLE_COLUMNS.length + 1} style={{ textAlign: 'center', padding: '2rem' }}>로딩 중...</td></tr>
              ) : vehicles.length === 0 ? (
                <tr><td colSpan={VEHICLE_COLUMNS.length + 1} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>등록된 차량이 없습니다.</td></tr>
              ) : (
                sortedVehicles.map((v, idx) => {
                  const isEditing = editingRowId === v._id;
                  // 왼쪽·오른쪽에 붙여 둔 칸은 배경이 비치면 안 되므로 줄과 같은 색을 직접 칠한다
                  const rowBackground = rowBackgroundFor(v, isEditing);
                  return (
                  <tr key={v._id} style={{ borderBottom: '1px solid var(--border-color)', background: rowBackground }}>
                    {VEHICLE_COLUMNS.map((col) => {
                      const frozen = frozenCellStyle(col.key, rowBackground, 1);
                      return (
                        <td
                          key={col.key}
                          style={{
                            padding: isEditing ? '0.35rem 0.4rem' : '0.8rem',
                            whiteSpace: 'nowrap',
                            ...(frozen || {})
                          }}
                        >
                          {(isEditing && renderCellEditor(col)) || col.render(v, idx)}
                        </td>
                      );
                    })}
                    <td style={{ padding: '0.8rem', position: 'sticky', right: 0, background: rowBackground }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <button onClick={() => handleSave()} disabled={saving} title="저장 (Ctrl+S)" style={{ border: 'none', background: 'none', color: 'var(--primary)', cursor: saving ? 'not-allowed' : 'pointer' }}>
                            <Save size={16} />
                          </button>
                          <button onClick={cancelInlineEdit} title="취소 (Esc)" style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                            <X size={16} />
                          </button>
                          {/* 사은품·비고처럼 표에 없는 항목은 팝업에서 고친다. 지금 고치던 값이 그대로 열린다. */}
                          <button onClick={openDetailPopup} title="자세히 (표에 없는 항목까지)" style={{ border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '700', padding: '0.15rem 0.35rem', cursor: 'pointer' }}>
                            자세히
                          </button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                          <button onClick={() => startInlineEdit(v)} title="수정 (표에서 바로 고치기)" style={{ border: 'none', background: 'none', color: 'var(--primary)', cursor: 'pointer' }}>
                            <Edit3 size={16} />
                          </button>
                          <button onClick={() => handleDelete(v)} title="삭제" style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 추가/수정 모달 */}
      {showModal && (
        createPortal(
        /* 팝업은 document.body에 직접 그린다.
           페이지 쪽 조상에 transform/animation이 걸려 있으면 position:fixed의 기준이 그 요소로 바뀌어
           팝업이 스크롤되는 콘텐츠 영역 안에 갇히고, 화면 기준 위치가 어긋난다. */
        <div
          onClick={() => setShowModal(false)}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: `${DIALOG_TOP} 2rem 2rem` }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ ...dragStyle, background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '760px', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}
          >
            <div {...dragHandleProps} style={{ ...dragHandleProps.style, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.2rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
              <h3 style={{ margin: 0, fontWeight: '800', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Car size={18} style={{ color: 'var(--primary)' }} /> {editingVehicle ? '차량 정보 수정' : '차량 추가'}
              </h3>
              <button type="button" onClick={() => setShowModal(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              {(() => {
                // 계약서로 등록된 차량은 계약이 정본이므로 여기서 고치지 않는다(읽기 전용).
                // 엑셀 업로드나 직접 등록으로 들어온 차량만 이 화면에서 계약자 정보를 수정한다.
                const contract = editingVehicle?.contract;

                if (contract) {
                  const setCompanyField = (field, value) => setFormData((prev) => ({ ...prev, company: { ...prev.company, [field]: value } }));
                  const hasCompany = Boolean(contract.companyId);

                  return (
                    <div style={{ background: 'var(--bg-main)', padding: '0.9rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <FileSignature size={14} style={{ color: 'var(--primary)' }} />
                        계약번호 {contract.contractNo}에 연결된 차량입니다.
                      </div>
                      {contract.status === '보관됨' && (
                        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#c2410c', borderRadius: '6px', padding: '0.5rem 0.7rem', fontSize: '0.8rem', lineHeight: 1.5 }}>
                          🔒 계약서가 보관되어 있어 이 차량은 수정할 수 없습니다.
                          계약서 등록 화면에서 <strong>되돌리기</strong>를 누른 뒤 수정해 주세요.
                        </div>
                      )}

                      {hasCompany ? (
                        <>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' }}>
                            <div>
                              <label style={labelStyle}>법인명</label>
                              <input value={formData.company.name} onChange={(e) => setCompanyField('name', e.target.value)} style={inputStyle} />
                            </div>
                            <div>
                              <label style={labelStyle}>대표자</label>
                              <input value={formData.company.ceoName} onChange={(e) => setCompanyField('ceoName', e.target.value)} style={inputStyle} />
                            </div>
                            <div>
                              <label style={labelStyle}>사업자번호</label>
                              <input value={formData.company.bizNo} onChange={(e) => setCompanyField('bizNo', e.target.value)} style={inputStyle} placeholder="000-00-00000" />
                            </div>
                            <div>
                              <label style={labelStyle}>법인등록번호</label>
                              <input value={formData.company.corporateRegistrationNo} onChange={(e) => setCompanyField('corporateRegistrationNo', e.target.value)} style={inputStyle} placeholder="000000-0000000" />
                            </div>
                            <div>
                              <label style={labelStyle}>사업장 주소</label>
                              <input value={formData.company.address} onChange={(e) => setCompanyField('address', e.target.value)} style={inputStyle} />
                            </div>
                            <div>
                              <label style={labelStyle}>청구 이메일</label>
                              <input value={formData.company.billingEmail} onChange={(e) => setCompanyField('billingEmail', e.target.value)} style={inputStyle} />
                            </div>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                            여기서 고친 법인 정보는 이 법인을 쓰는 모든 차량과 계약, 청구서에 함께 반영됩니다.
                            차량이 어느 계약에 속하는지는 계약서 등록 화면에서 바꿉니다.
                          </div>
                        </>
                      ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.4rem 1rem' }}>
                          {[['계약자', formatCustomerName(contract.customer)], ['구분', contract.partyType || '개인']].map(([label, value]) => (
                            <div key={label} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.82rem', minWidth: 0 }}>
                              <span style={{ color: 'var(--text-muted)', flexShrink: 0, minWidth: '78px' }}>{label}</span>
                              <span style={{ color: 'var(--text-bright)', fontWeight: '600', wordBreak: 'break-all' }}>{value || '-'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }

                const isCorporate = formData.partyType === '법인';
                // 일반개인으로 골랐어도 사업자 정보가 이미 붙어 있으면 그대로 보여 주고 고칠 수 있게 한다.
                // 숨기면 저장할 때 사업자번호·대표자가 함께 지워진다.
                const showCompanyFields = hasBusinessInfo(formData.partyType) || Boolean(formData.company?._id);
                const setCompany = (field, value) => setFormData((prev) => ({ ...prev, company: { ...prev.company, [field]: value } }));
                const setBanking = (field, value) => setFormData((prev) => ({ ...prev, banking: { ...prev.banking, [field]: value } }));
                const setLoan = (field, value) => setFormData((prev) => ({ ...prev, loan: { ...prev.loan, [field]: value } }));

                return (
                  <>
                    <div>
                      <div style={{ fontWeight: '700', fontSize: '0.85rem', marginBottom: '0.6rem', color: 'var(--text-bright)' }}>🏢 계약자</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' }}>
                        <div>
                          <label style={labelStyle}>계약 구분</label>
                          <select value={formData.partyType} onChange={(e) => setFormData({ ...formData, partyType: e.target.value })} style={inputStyle}>
                            {PARTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        {showCompanyFields ? (
                          <>
                            <div>
                              <label style={labelStyle}>{isCorporate ? '법인명 (계약자)' : '상호 · 이름 (계약자)'}</label>
                              <input value={formData.company.name} onChange={(e) => setCompany('name', e.target.value)} style={inputStyle} placeholder="예: 주식회사 삼지" />
                            </div>
                            <div>
                              <label style={labelStyle}>대표자명</label>
                              <input value={formData.company.ceoName} onChange={(e) => setCompany('ceoName', e.target.value)} style={inputStyle} />
                            </div>
                            <div>
                              <label style={labelStyle}>사업자번호</label>
                              <input value={formData.company.bizNo} onChange={(e) => setCompany('bizNo', e.target.value)} style={inputStyle} placeholder="000-00-00000" />
                            </div>
                            <div>
                              <label style={labelStyle}>법인등록번호</label>
                              <input value={formData.company.corporateRegistrationNo} onChange={(e) => setCompany('corporateRegistrationNo', e.target.value)} style={inputStyle} placeholder="000000-0000000" />
                            </div>
                            <div>
                              <label style={labelStyle}>사업장 주소</label>
                              <input value={formData.company.address} onChange={(e) => setCompany('address', e.target.value)} style={inputStyle} />
                            </div>
                            <div>
                              <label style={labelStyle}>청구 이메일</label>
                              <input value={formData.company.billingEmail} onChange={(e) => setCompany('billingEmail', e.target.value)} style={inputStyle} />
                            </div>
                          </>
                        ) : (
                          <div>
                            <label style={labelStyle}>계약자명</label>
                            <input value={formData.contractorName} onChange={(e) => setFormData({ ...formData, contractorName: e.target.value })} style={inputStyle} />
                          </div>
                        )}
                      </div>
                      {showCompanyFields && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem', lineHeight: 1.5 }}>
                          사업자번호가 같은 법인이 이미 있으면 그 법인에 연결되고, 없으면 새 법인으로 등록됩니다.
                          여기서 고친 법인 정보는 같은 법인을 쓰는 다른 차량에도 함께 반영됩니다.
                        </div>
                      )}
                    </div>

                    <div>
                      <div style={{ fontWeight: '700', fontSize: '0.85rem', marginBottom: '0.6rem', color: 'var(--text-bright)' }}>🏦 렌트료 출금 계좌</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' }}>
                        <div>
                          <label style={labelStyle}>예금주명</label>
                          <input value={formData.banking.holder} onChange={(e) => setBanking('holder', e.target.value)} style={inputStyle} />
                        </div>
                        <div>
                          <label style={labelStyle}>은행</label>
                          <input value={formData.banking.bankName} onChange={(e) => setBanking('bankName', e.target.value)} style={inputStyle} />
                        </div>
                        <div>
                          <label style={labelStyle}>계좌번호</label>
                          <input value={formData.banking.accountNo} onChange={(e) => setBanking('accountNo', e.target.value)} style={inputStyle} />
                        </div>
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginBottom: '0.6rem' }}>
                        <span style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-bright)' }}>💳 대출 / 할부</span>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                          <input type="checkbox" checked={formData.loan.executed} onChange={(e) => setLoan('executed', e.target.checked)} />
                          대출실행
                        </label>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' }}>
                        <div>
                          <label style={labelStyle}>차용처</label>
                          <input value={formData.loan.lender} onChange={(e) => setLoan('lender', e.target.value)} style={inputStyle} />
                        </div>
                        <div>
                          <label style={labelStyle}>실행일</label>
                          <input type="date" value={formData.loan.executedDate} onChange={(e) => setLoan('executedDate', e.target.value)} style={inputStyle} />
                        </div>
                        <div>
                          <label style={labelStyle}>할부이용금액 (원)</label>
                          <MoneyInput value={formData.loan.amount} onChange={(e) => setLoan('amount', e.target.value)} style={inputStyle} />
                        </div>
                        <div>
                          <label style={labelStyle}>할부기간 (개월)</label>
                          <input type="number" value={formData.loan.termMonths} onChange={(e) => setLoan('termMonths', e.target.value)} style={inputStyle} />
                        </div>
                        <div>
                          <label style={labelStyle}>월할부금 (원)</label>
                          <MoneyInput value={formData.loan.monthlyPayment} onChange={(e) => setLoan('monthlyPayment', e.target.value)} style={inputStyle} />
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* 차종/사양 */}
              <div>
                <div style={{ fontWeight: '700', fontSize: '0.85rem', marginBottom: '0.6rem', color: 'var(--text-bright)' }}>📄 차종 / 사양</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' }}>
                  <div>
                    <label style={labelStyle}>차종 *</label>
                    <input required value={formData.carModel} onChange={(e) => setFormData({ ...formData, carModel: e.target.value })} style={inputStyle} placeholder="예: 그랜저(H) 1.6T 프리미엄 (사양까지 함께)" />
                  </div>
                  <div>
                    <label style={labelStyle}>차량 코드</label>
                    <input value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} style={inputStyle} placeholder="비워두면 자동 생성" />
                  </div>
                  
                  <div>
                    <label style={labelStyle}>유종</label>
                    <select value={formData.fuelType} onChange={(e) => setFormData({ ...formData, fuelType: e.target.value })} style={inputStyle}>
                      <option value="가솔린">가솔린</option>
                      <option value="디젤">디젤</option>
                      <option value="LPG">LPG</option>
                      <option value="하이브리드">하이브리드</option>
                      <option value="전기">전기</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>배기량 (cc)</label>
                    <input type="number" value={formData.cc} onChange={(e) => setFormData({ ...formData, cc: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>외장 색상</label>
                    <input value={formData.exteriorColor} onChange={(e) => setFormData({ ...formData, exteriorColor: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>내장 색상</label>
                    <input value={formData.interiorColor} onChange={(e) => setFormData({ ...formData, interiorColor: e.target.value })} style={inputStyle} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>옵션</label>
                    <input value={formData.options} onChange={(e) => setFormData({ ...formData, options: e.target.value })} style={inputStyle} placeholder="선루프, 네비게이션 등" />
                  </div>
                </div>
              </div>

              {/* 실물 등록 정보 */}
              <div>
                <div style={{ fontWeight: '700', fontSize: '0.85rem', marginBottom: '0.6rem', color: 'var(--text-bright)' }}>🚗 실물 등록 정보</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' }}>
                  <div>
                    <label style={labelStyle}>연식</label>
                    <input value={formData.year} onChange={(e) => setFormData({ ...formData, year: e.target.value })} style={inputStyle} placeholder="예: 2026년식" />
                  </div>
                  <div>
                    <label style={labelStyle}>차량번호</label>
                    <input value={formData.plateNo} onChange={(e) => setFormData({ ...formData, plateNo: e.target.value })} style={inputStyle} placeholder="출고 후 입력" />
                  </div>
                  <div>
                    <label style={labelStyle}>차대번호 (VIN)</label>
                    <input value={formData.vin} onChange={(e) => setFormData({ ...formData, vin: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>등록일</label>
                    <input type="date" value={formData.registrationDate} onChange={(e) => setFormData({ ...formData, registrationDate: e.target.value })} style={inputStyle} />
                  </div>
                </div>
              </div>

              {/* 가격 */}
              <div>
                <div style={{ fontWeight: '700', fontSize: '0.85rem', marginBottom: '0.6rem', color: 'var(--text-bright)' }}>💰 가격 (견적서 기준)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' }}>
                  <div>
                    <label style={labelStyle}>차량가 (원)</label>
                    <MoneyInput value={formData.carPrice} onChange={(e) => setFormData({ ...formData, carPrice: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>옵션가 (원)</label>
                    <MoneyInput value={formData.optionPrice} onChange={(e) => setFormData({ ...formData, optionPrice: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>할인금액 (원)</label>
                    <MoneyInput value={formData.discount} onChange={(e) => setFormData({ ...formData, discount: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>공급가액 (원)</label>
                    <MoneyInput
                      value={supplyPricePreview}
                      readOnly
                      style={{ ...inputStyle, background: 'var(--bg-main)', color: 'var(--text-muted)' }}
                    />
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      차량가 + 옵션가 + 탁송료 - 할인금액
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>탁송료 (원)</label>
                    <MoneyInput value={formData.deliveryFee} onChange={(e) => setFormData({ ...formData, deliveryFee: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>취득세 (원)</label>
                    <MoneyInput value={formData.acquisitionTax} onChange={(e) => setFormData({ ...formData, acquisitionTax: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>공채 (원)</label>
                    <MoneyInput value={formData.publicBond} onChange={(e) => setFormData({ ...formData, publicBond: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>등록대행료 (원)</label>
                    <MoneyInput value={formData.registrationAgencyFee} onChange={(e) => setFormData({ ...formData, registrationAgencyFee: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>보증금 (원)</label>
                    <MoneyInput value={formData.deposit} onChange={(e) => setFormData({ ...formData, deposit: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>선수금 (원)</label>
                    <MoneyInput value={formData.advancePayment} onChange={(e) => setFormData({ ...formData, advancePayment: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>인수가 (원)</label>
                    <MoneyInput value={formData.takeoverPrice} onChange={(e) => setFormData({ ...formData, takeoverPrice: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>월 렌트료 (원)</label>
                    <MoneyInput value={formData.monthlyFee} onChange={(e) => setFormData({ ...formData, monthlyFee: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>면세금액 (원)</label>
                    <MoneyInput value={formData.taxExemptionAmount} onChange={(e) => setFormData({ ...formData, taxExemptionAmount: e.target.value })} style={inputStyle} />
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      국산차 렌터카 면세분. 장기렌트면 환입 대상입니다.
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>자동차세 (계약기간 총액)</label>
                    <MoneyInput value={formData.individualConsumptionTax} onChange={(e) => setFormData({ ...formData, individualConsumptionTax: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>납입 개월 수</label>
                    <input type="number" value={formData.paymentTerm} onChange={(e) => setFormData({ ...formData, paymentTerm: e.target.value })} style={inputStyle} />
                  </div>
                </div>
              </div>

              {/* 보험 */}
              <div>
                <div style={{ fontWeight: '700', fontSize: '0.85rem', marginBottom: '0.6rem', color: 'var(--text-bright)' }}>🛡️ 보험</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' }}>
                  <div>
                    <label style={labelStyle}>보험사</label>
                    <input value={formData.insurance.company} onChange={(e) => setFormData({ ...formData, insurance: { ...formData.insurance, company: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>보험 구분</label>
                    <select value={formData.insurance.type} onChange={(e) => setFormData({ ...formData, insurance: { ...formData.insurance, type: e.target.value } })} style={inputStyle}>
                      <option value="standard">일반형</option>
                      <option value="premium">고급형(임직원)</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>운전자 연령</label>
                    <input value={formData.insurance.driverAge} onChange={(e) => setFormData({ ...formData, insurance: { ...formData.insurance, driverAge: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>자기부담금 (원)</label>
                    <MoneyInput value={formData.insurance.deductible} onChange={(e) => setFormData({ ...formData, insurance: { ...formData.insurance, deductible: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>대인</label>
                    <input value={formData.insurance.liabilityLimit} onChange={(e) => setFormData({ ...formData, insurance: { ...formData.insurance, liabilityLimit: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>대물</label>
                    <input value={formData.insurance.propertyLimit} onChange={(e) => setFormData({ ...formData, insurance: { ...formData.insurance, propertyLimit: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>자기손해</label>
                    <input value={formData.insurance.personalInjury} onChange={(e) => setFormData({ ...formData, insurance: { ...formData.insurance, personalInjury: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>무보험차상해</label>
                    <input value={formData.insurance.uninsuredInjury} onChange={(e) => setFormData({ ...formData, insurance: { ...formData.insurance, uninsuredInjury: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>긴급출동</label>
                    <input value={formData.insurance.emergencyService} onChange={(e) => setFormData({ ...formData, insurance: { ...formData.insurance, emergencyService: e.target.value } })} style={inputStyle} />
                  </div>
                </div>
              </div>

              {/* 정비 */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.6rem' }}>
                  <div style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-bright)' }}>🔧 정비 서비스</div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    일반정비에 가입하면 순회정비·소모품교환도 함께 가입됩니다
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' }}>
                  <div>
                    <label style={labelStyle}>타이어 등급</label>
                    <input value={formData.maintenance.tireType} onChange={(e) => setFormData({ ...formData, maintenance: { ...formData.maintenance, tireType: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>연간 주행거리 (km)</label>
                    <input type="number" value={formData.maintenance.mileage} onChange={(e) => setFormData({ ...formData, maintenance: { ...formData.maintenance, mileage: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>일반정비</label>
                    <select
                      value={formData.maintenance.generalMaintenance}
                      onChange={(e) => setGeneralMaintenance(e.target.value)}
                      style={inputStyle}
                    >
                      <option value="가입">가입</option>
                      <option value="미가입">미가입</option>
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>순회정비</label>
                    <input value={formData.maintenance.regularCheck} readOnly style={{ ...inputStyle, background: 'var(--bg-main)', color: 'var(--text-muted)' }} />
                  </div>
                  <div>
                    <label style={labelStyle}>소모품 교환</label>
                    <input value={formData.maintenance.consumables} readOnly style={{ ...inputStyle, background: 'var(--bg-main)', color: 'var(--text-muted)' }} />
                  </div>
                </div>
              </div>

              {/* 운영 상태 */}
              <div>
                <div style={{ fontWeight: '700', fontSize: '0.85rem', marginBottom: '0.6rem', color: 'var(--text-bright)' }}>📌 운영 상태</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' }}>
                  <div>
                    <label style={labelStyle}>상태</label>
                    <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} style={inputStyle}>
                      {Object.entries(STATUS_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* 출고 준비 정보 */}
              <div>
                <div style={{ fontWeight: '700', fontSize: '0.85rem', marginBottom: '0.6rem', color: 'var(--text-bright)' }}>🚚 출고 준비 정보</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' }}>
                  <div>
                    <label style={labelStyle}>인도일</label>
                    <input type="date" value={formData.deliveryDate} onChange={(e) => setFormData({ ...formData, deliveryDate: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>렌트료 게시일</label>
                    <input type="date" value={formData.rentBillingDate} onChange={(e) => handleRentBillingDateChange(e.target.value)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>월 대여료 결제일 (일)</label>
                    <select value={formData.monthlyPaymentDay} onChange={(e) => setFormData({ ...formData, monthlyPaymentDay: e.target.value })} style={inputStyle}>
                      <option value="">선택</option>
                      {PAYMENT_DAY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      {/* 예전에 자유 입력으로 저장해 둔 날짜가 목록에서 사라지지 않게 함께 보여 준다 */}
                      {formData.monthlyPaymentDay !== '' && !PAYMENT_DAY_OPTIONS.some(o => String(o.value) === String(formData.monthlyPaymentDay)) && (
                        <option value={formData.monthlyPaymentDay}>{formData.monthlyPaymentDay}일 (기존 입력값)</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>연체 이율 (연 %)</label>
                    <input type="number" value={formData.lateInterestRate} onChange={(e) => setFormData({ ...formData, lateInterestRate: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>중도해지 수수료율 (%)</label>
                    <input type="number" value={formData.earlyTerminationRate} onChange={(e) => setFormData({ ...formData, earlyTerminationRate: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>금리 (%)</label>
                    <input type="number" step="0.1" value={formData.interestRate} onChange={(e) => setFormData({ ...formData, interestRate: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>회사수수료 (이익률)</label>
                    <input
                      value={formData.companyCommission === '' || formData.companyCommission === null || formData.companyCommission === undefined
                        ? ''
                        : `${Number(formData.companyCommission).toFixed(2)}%`}
                      readOnly
                      style={{ ...inputStyle, background: 'var(--bg-main)', color: 'var(--text-muted)' }}
                    />
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      이익금 ÷ 차량가 (저장하면 다시 계산됩니다)
                    </div>
                  </div>
                  <div>
                    <label style={labelStyle}>타딜러수수료 (원)</label>
                    <MoneyInput value={formData.dealerCommission} onChange={(e) => setFormData({ ...formData, dealerCommission: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>판관비 (원)</label>
                    <MoneyInput value={formData.sellingAdminExpense} onChange={(e) => setFormData({ ...formData, sellingAdminExpense: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>운전자 (대표가 아닐 시)</label>
                    <input value={formData.driver} onChange={(e) => setFormData({ ...formData, driver: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>차량 관리자</label>
                    <input value={formData.vehicleManager} onChange={(e) => setFormData({ ...formData, vehicleManager: e.target.value })} style={inputStyle} />
                  </div>
                </div>
              </div>

              {/* 블랙박스 / 선팅 / 타이어 */}
              <div>
                <div style={{ fontWeight: '700', fontSize: '0.85rem', marginBottom: '0.6rem', color: 'var(--text-bright)' }}>🔧 블랙박스 / 선팅 / 타이어</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' }}>
                  <div>
                    <label style={labelStyle}>블랙박스 금액 (원)</label>
                    <MoneyInput value={formData.accessories.blackboxPrice} onChange={(e) => setFormData({ ...formData, accessories: { ...formData.accessories, blackboxPrice: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>블랙박스 정보</label>
                    <input value={formData.accessories.blackboxInfo} onChange={(e) => setFormData({ ...formData, accessories: { ...formData.accessories, blackboxInfo: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>선팅 금액 (원)</label>
                    <MoneyInput value={formData.accessories.tintingPrice} onChange={(e) => setFormData({ ...formData, accessories: { ...formData.accessories, tintingPrice: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>선팅 정보</label>
                    <input value={formData.accessories.tintingInfo} onChange={(e) => setFormData({ ...formData, accessories: { ...formData.accessories, tintingInfo: e.target.value } })} style={inputStyle} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>타이어</label>
                    <input value={formData.accessories.tireInfo} onChange={(e) => setFormData({ ...formData, accessories: { ...formData.accessories, tireInfo: e.target.value } })} style={inputStyle} placeholder="예: 금호 앞뒤 255/50 R20" />
                  </div>
                </div>
              </div>

              {/* 사은품 */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                  <div style={{ fontWeight: '700', fontSize: '0.85rem', color: 'var(--text-bright)' }}>🎁 사은품</div>
                  <button type="button" onClick={handleAddGift} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', border: 'none', background: 'var(--primary-glow)', color: 'var(--primary)', padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer' }}>
                    <Plus size={13} /> 추가
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {formData.gifts.map((g, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                      <input value={g.name} onChange={(e) => handleGiftChange(idx, 'name', e.target.value)} style={{ ...inputStyle, flex: 2 }} placeholder="사은품명" />
                      <MoneyInput value={g.price} onChange={(e) => handleGiftChange(idx, 'price', e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="가격 (원)" />
                      {formData.gifts.length > 1 && (
                        <button type="button" onClick={() => handleRemoveGift(idx)} style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}>
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.8rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color)' }}>
                {/* 이미 출고 준비가 끝난(=계약중이 아닌) 계약 차량만 되돌릴 수 있다 */}
                {editingVehicle && editingVehicle.contract && formData.status !== '계약중' && (
                  <button
                    type="button"
                    onClick={handleSendToDeliveryPrep}
                    disabled={saving}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginRight: 'auto', background: '#fff', border: '1px solid var(--primary)', color: 'var(--primary)', padding: '0.6rem 1.2rem', borderRadius: '8px', fontWeight: '700', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.85rem', opacity: saving ? 0.7 : 1 }}
                  >
                    <Truck size={16} /> 출고 준비로 되돌리기
                  </button>
                )}
                <button type="button" onClick={() => setShowModal(false)} style={{ background: '#fff', border: '1px solid var(--border-color)', padding: '0.6rem 1.4rem', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem' }}>
                  취소
                </button>
                <button type="submit" disabled={saving || editingVehicle?.contract?.status === '보관됨'} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.6rem 1.4rem', borderRadius: '8px', fontWeight: '700', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.85rem', opacity: saving ? 0.7 : 1 }}>
                  <Save size={16} /> {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>, document.body)
      )}
    </div>
  );
}

export default VehicleManagementView;
