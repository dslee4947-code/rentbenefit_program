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
import { SortableTh, SortControls } from './TableSort.jsx';
import { useDraggableDialog, DIALOG_TOP } from './useDraggableDialog.js';
import { createPortal } from 'react-dom';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const STATUS_LABELS = {
  '계약중': '계약중',
  '장기렌트': '장기렌트',
  '사고대차': '사고대차',
  '예약': '예약',
  '거래완료': '거래완료'
};

const STATUS_COLORS = {
  '계약중': { bg: '#f0e6ff', text: '#7c3aed' },
  '장기렌트': { bg: '#e6f7ff', text: '#1890ff' },
  '사고대차': { bg: '#fff1f0', text: '#ff4d4f' },
  '예약': { bg: '#fffbe6', text: '#faad14' },
  '거래완료': { bg: '#f6ffed', text: '#52c41a' }
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
  carSpec: '',
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
  const [stats, setStats] = useState({ total: 0, '장기렌트': 0, '사고대차': 0, '예약': 0, '거래완료': 0 });

  const [showModal, setShowModal] = useState(false);

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
        setStats(data.stats || { total: 0, '장기렌트': 0, '사고대차': 0, '예약': 0, '거래완료': 0 });
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

  const openEditModal = (vehicle) => {
    setEditingVehicle(vehicle);
    // 계약서로 등록된 차량은 계약이 정본이라 아래 값들을 편집하지 않는다(화면에서도 읽기 전용).
    // 계약에 묶인 차량은 계약이 가리키는 법인이 정본이고, 아니면 차량에 붙은 법인을 본다
    const company = vehicle.contract?.companyId || vehicle.company || {};
    setFormData({
      partyType: vehicle.partyType || (vehicle.company ? '법인' : '개인'),
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
      carSpec: vehicle.carSpec || '',
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
    setShowModal(true);
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
    e.preventDefault();
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
      const isCorporate = formData.partyType === '법인';
      // 계약에 묶인 차량은 계약이 정본이라, 법인 정보만 고치고 차량-법인 연결은 그대로 둔다
      const linkedToContract = Boolean(editingVehicle?.contract);
      const payload = {
        _keepContractLink: linkedToContract || undefined,
        ...formData,
        partyType: formData.partyType,
        // 계약으로 만들어진 차량은 법인을 계약이 들고 있어서 차량 쪽 partyType이 '개인'이다.
        // 그 경우에도 법인 정보를 고칠 수 있어야 하므로, 계약에 묶인 차량이면 항상 보낸다.
        // (예전에는 차량 partyType이 '법인'일 때만 보내서, 고친 값이 전송조차 되지 않았다)
        _contractorName: isCorporate ? formData.company.name : formData.contractorName,
        _company: (isCorporate || linkedToContract) ? formData.company : {},
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
        companyCommission: formData.companyCommission === '' ? undefined : Number(formData.companyCommission),
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

  const formatMoney = (v) => (v || v === 0) ? `${Number(v).toLocaleString()}원` : '-';
  const formatDateCell = (v) => v ? new Date(v).toLocaleDateString() : '-';

  // 계약사(법인명/개인명) - contract가 있으면 계약 쪽 정보를 우선으로, 없으면 재고 차량에 직접 붙은 정보를 본다
  const getContractCompanyName = (v) =>
    v.contract?.companyId?.name
    || formatCustomerName(v.contract?.customer)
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
    { key: 'partyType', label: '계약구분', render: (v) => v.contract?.partyType || v.partyType || '-' },
    { key: 'contractCompany', label: '계약사', render: (v) => getContractCompanyName(v) },
    { key: 'ceoName', label: '대표자', render: (v) => getContractCeoName(v) },
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
    { key: 'carModel', label: '차량', render: (v) => v.carModel || '-' },
    { key: 'carSpec', label: '사양', render: (v) => v.carSpec || '-' },
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
    { key: 'discount', label: '할인금액', render: (v) => formatMoney(v.discount) },
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
    { key: 'maintenanceEnabled', label: '정비가입', render: (v) => v.maintenance?.enabled ? '가입' : '미가입' },
    { key: 'tireType', label: '타이어등급', render: (v) => v.maintenance?.tireType || '-' },
    { key: 'maintenanceMileage', label: '연간주행거리', render: (v) => v.maintenance?.mileage ? `${v.maintenance.mileage.toLocaleString()}km` : '-' },
    { key: 'regularCheck', label: '순회정비', render: (v) => v.maintenance?.regularCheck || '-' },
    { key: 'consumables', label: '소모품교환', render: (v) => v.maintenance?.consumables || '-' },
    { key: 'generalMaintenance', label: '일반정비', render: (v) => v.maintenance?.generalMaintenance || '-' },
    { key: 'deliveryDate', label: '인도일', sortValue: (v) => v.deliveryDate, render: (v) => formatDateCell(v.deliveryDate) },
    { key: 'rentBillingDate', label: '렌트료게시일', sortValue: (v) => v.rentBillingDate, render: (v) => formatDateCell(v.rentBillingDate) },
    { key: 'monthlyPaymentDay', label: '월결제일', render: (v) => formatPaymentDay(v.monthlyPaymentDay) || '-' },
    { key: 'interestRate', label: '금리', render: (v) => (v.interestRate || v.interestRate === 0) ? `${v.interestRate}%` : '-' },
    { key: 'lateInterestRate', label: '연체이율', render: (v) => (v.lateInterestRate || v.lateInterestRate === 0) ? `연 ${v.lateInterestRate}%` : '-' },
    { key: 'earlyTerminationRate', label: '중도해지수수료율', render: (v) => (v.earlyTerminationRate || v.earlyTerminationRate === 0) ? `${v.earlyTerminationRate}%` : '-' },
    { key: 'companyCommission', label: '회사수수료', render: (v) => formatMoney(v.companyCommission) },
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
    ) }
  ];

  // 표 머리글을 눌러 정렬한다. 검색·상태는 서버가 걸러 주고, 정렬은 받아 온 목록에서 한다.
  const sort = useTableSort(vehicles, VEHICLE_COLUMNS);
  const sortedVehicles = sort.rows;

  const statCards = [
    { key: 'total', label: '전체 차량', value: stats.total, color: 'var(--primary)' },
    { key: '장기렌트', label: '장기렌트', value: stats['장기렌트'], color: STATUS_COLORS['장기렌트'].text },
    { key: '사고대차', label: '사고대차', value: stats['사고대차'], color: STATUS_COLORS['사고대차'].text },
    { key: '예약', label: '예약 차량', value: stats['예약'], color: STATUS_COLORS['예약'].text },
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
            placeholder="차량 코드, 차종, 차량번호, 차대번호 검색..."
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
          defaultLabel="정렬 안 함 (최근 등록순)"
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
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-bright)', fontWeight: '700' }}>
                {VEHICLE_COLUMNS.map((col) => (
                  <SortableTh key={col.key} sort={sort} columnKey={col.key} style={{ padding: '0.8rem', whiteSpace: 'nowrap' }}>
                    {col.label}
                  </SortableTh>
                ))}
                <th style={{ padding: '0.8rem', width: '80px', position: 'sticky', right: 0, background: 'var(--bg-main)' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={VEHICLE_COLUMNS.length + 1} style={{ textAlign: 'center', padding: '2rem' }}>로딩 중...</td></tr>
              ) : vehicles.length === 0 ? (
                <tr><td colSpan={VEHICLE_COLUMNS.length + 1} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>등록된 차량이 없습니다.</td></tr>
              ) : (
                sortedVehicles.map((v, idx) => (
                  <tr key={v._id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    {VEHICLE_COLUMNS.map((col) => (
                      <td key={col.key} style={{ padding: '0.8rem', whiteSpace: 'nowrap' }}>{col.render(v, idx)}</td>
                    ))}
                    <td style={{ padding: '0.8rem', position: 'sticky', right: 0, background: '#fff' }}>
                      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                        <button onClick={() => openEditModal(v)} title="수정" style={{ border: 'none', background: 'none', color: 'var(--primary)', cursor: 'pointer' }}>
                          <Edit3 size={16} />
                        </button>
                        <button onClick={() => handleDelete(v)} title="삭제" style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
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
                            <option value="법인">법인</option>
                            <option value="개인">개인</option>
                          </select>
                        </div>
                        {isCorporate ? (
                          <>
                            <div>
                              <label style={labelStyle}>법인명 (계약자)</label>
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
                      {isCorporate && (
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
                    <input required value={formData.carModel} onChange={(e) => setFormData({ ...formData, carModel: e.target.value })} style={inputStyle} placeholder="예: 그랜저 하이브리드" />
                  </div>
                  <div>
                    <label style={labelStyle}>차량 코드</label>
                    <input value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} style={inputStyle} placeholder="비워두면 자동 생성" />
                  </div>
                  <div>
                    <label style={labelStyle}>사양</label>
                    <input value={formData.carSpec} onChange={(e) => setFormData({ ...formData, carSpec: e.target.value })} style={inputStyle} />
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
                    <label style={labelStyle}>할인금액 (원)</label>
                    <MoneyInput value={formData.discount} onChange={(e) => setFormData({ ...formData, discount: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>공급가액 (원)</label>
                    <MoneyInput value={formData.supplyPrice} onChange={(e) => setFormData({ ...formData, supplyPrice: e.target.value })} style={inputStyle} />
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
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={formData.maintenance.enabled} onChange={(e) => setFormData({ ...formData, maintenance: { ...formData.maintenance, enabled: e.target.checked } })} />
                    포함
                  </label>
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
                    <label style={labelStyle}>순회정비</label>
                    <input value={formData.maintenance.regularCheck} onChange={(e) => setFormData({ ...formData, maintenance: { ...formData.maintenance, regularCheck: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>소모품 교환</label>
                    <input value={formData.maintenance.consumables} onChange={(e) => setFormData({ ...formData, maintenance: { ...formData.maintenance, consumables: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>일반정비</label>
                    <input value={formData.maintenance.generalMaintenance} onChange={(e) => setFormData({ ...formData, maintenance: { ...formData.maintenance, generalMaintenance: e.target.value } })} style={inputStyle} />
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
                    <label style={labelStyle}>회사수수료 (원)</label>
                    <MoneyInput value={formData.companyCommission} onChange={(e) => setFormData({ ...formData, companyCommission: e.target.value })} style={inputStyle} />
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
