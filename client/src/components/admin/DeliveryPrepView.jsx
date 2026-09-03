import { useState, useEffect } from 'react';
import { Truck, Search, X, Save, CheckCircle2, Plus, Trash2, Edit } from 'lucide-react';
import { formatCustomerName, PAYMENT_DAY_OPTIONS } from '../../utils/format.js';
import MoneyInput from './MoneyInput.jsx';
import { useTableSort } from './useTableSort.js';
import { SortableTh, SortControls } from './TableSort.jsx';
import { useDraggableDialog, DIALOG_TOP } from './useDraggableDialog.js';
import { createPortal } from 'react-dom';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const EMPTY_FORM = {
  year: '',
  vin: '',
  plateNo: '',
  registrationDate: '',
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
  gifts: [{ name: '', price: '' }],

  // 출고 전에 실제로 진행하는 작업 (선팅/블랙박스/코팅 등). 개수가 정해져 있지 않아 목록으로 다룬다.
  vehicleWorks: [],

  // 실제 보험 가입 결과 (견적서의 보험 '조건'과 구분된다)
  // 보험사는 차량의 insurance.company 한 곳에만 둔다.
  // 렌트차량 DB도 같은 값을 읽으므로, 여기서 저장하면 그대로 보인다.
  // (예전에는 insuranceEnrollment.company에 따로 저장해서 렌트차량 DB에는 빈칸으로 보였다)
  insurance: { company: '렌터카 공제' },

  deliveryPlace: {
    name: '', address: '', managerName: '', managerPhone: '',
    scheduledAt: '', method: '탁송', note: ''
  },

  driverInfo: {
    relation: '대표자', name: '', birthDate: '', licenseNo: '',
    licenseType: '', phone: '', email: '', note: ''
  }
};

const EMPTY_WORK = { name: '', vendor: '', price: '', scheduledDate: '', completed: false, note: '' };

/**
 * 고객 DB에서 사람을 찾아 이름과 연락처를 채우는 입력칸.
 *
 * 연락처가 저장된 고객만 후보로 보여 준다. 연락처가 없으면 출고 때 연락할 수 없어 쓸모가 없다.
 * 검색 결과에 없으면 직접 입력해도 그대로 저장된다.
 *
 * @param {string} label 칸 이름
 * @param {string} value 현재 이름
 * @param {(name: string, phone: string) => void} onPick 고객을 고르면 이름과 연락처를 함께 넘긴다
 * @param {(name: string) => void} onType 직접 입력할 때
 */
function CustomerPicker({ label, value, onPick, onType, labelStyle, inputStyle, apiHost }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  // 입력할 때마다 요청하지 않도록 잠시 기다렸다가 검색한다
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setResults([]); return; }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${apiHost}/api/customers?search=${encodeURIComponent(term)}&limit=30`);
        const data = await res.json();
        const withPhone = (data.customers || [])
          .map(c => ({ ...c, _phone: c.mobilePhone || c.contactPhone || '' }))
          .filter(c => c._phone.trim() !== '')
          .slice(0, 10);
        setResults(withPhone);
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, apiHost]);

  return (
    <div style={{ position: 'relative' }}>
      <label style={labelStyle}>{label}</label>
      <input
        value={open ? query : value}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQuery(e.target.value); onType(e.target.value); }}
        style={inputStyle}
        placeholder="이름 두 글자 이상 입력"
      />
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--border-color)', borderRadius: '6px', boxShadow: '0 6px 18px rgba(0,0,0,0.12)', zIndex: 10, maxHeight: '210px', overflowY: 'auto' }}>
          {results.map(c => (
            <div
              key={c._id}
              onMouseDown={() => { onPick(formatCustomerName(c), c._phone); setQuery(''); setResults([]); setOpen(false); }}
              style={{ padding: '0.5rem 0.7rem', cursor: 'pointer', fontSize: '0.82rem', borderBottom: '1px solid var(--border-color)' }}
            >
              <div style={{ fontWeight: '700', color: 'var(--text-bright)' }}>{formatCustomerName(c)}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{c._phone}</div>
            </div>
          ))}
        </div>
      )}
      {open && query.trim().length >= 2 && results.length === 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.5rem 0.7rem', fontSize: '0.78rem', color: 'var(--text-muted)', zIndex: 10 }}>
          연락처가 저장된 고객 중 검색 결과가 없습니다.
        </div>
      )}
    </div>
  );
}

function DeliveryPrepView({ showToast, currentUser }) {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [missingFilter, setMissingFilter] = useState('all'); // 부족한 정보로 걸러 보기

  const [showModal, setShowModal] = useState(false);

  // 팝업을 제목 줄로 잡아 끌어 옮길 수 있게 한다

  const { dragHandleProps, dragStyle } = useDraggableDialog(showModal);
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);


  const fetchPendingVehicles = async () => {
    try {
      setLoading(true);
      // 계약서 등록 시 차량은 '계약중' 상태로 만들어지고, 출고 준비(실물 등록)가 끝나야 다음 단계로 넘어간다.
      const res = await fetch(`${API_HOST}/api/vehicles?status=${encodeURIComponent('계약중')}&limit=10000`);
      const data = await res.json();
      if (data.success) {
        // 계약서까지 작성된(=contract가 연결된) '계약중' 차량을 출고 준비 대상으로 본다.
        // 차량번호/차대번호가 비었는지는 따지지 않는다.
        // 렌트차량 DB에서 '출고 준비로 되돌리기'로 넘어온 차량은 이미 둘 다 채워져 있어서,
        // 그 조건을 두면 되돌려도 목록에 나타나지 않기 때문이다.
        const pending = (data.vehicles || []).filter(v => v.contract);
        setVehicles(pending);
      }
    } catch (err) {
      console.error(err);
      showToast?.('출고 준비 목록을 불러오지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPendingVehicles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 잘못 만들어진 차량을 출고 준비 단계에서 지운다.
  // 계약서에 연결된 차량이라 지우면 그 계약에는 차량이 없는 상태가 되므로, 무엇이 사라지는지 먼저 알린다.
  const handleDelete = async (vehicle) => {
    if (currentUser?.role === 'viewer') {
      showToast?.('삭제 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    const contractNo = vehicle.contract?.contractNo;
    const message = [
      `${vehicle.code || ''} ${vehicle.carModel} 차량을 삭제할까요?`,
      contractNo ? `계약번호 ${contractNo}에 연결된 차량이라, 삭제하면 그 계약에는 차량이 없는 상태가 됩니다.` : '',
      '이 작업은 되돌릴 수 없습니다.'
    ].filter(Boolean).join('\n');
    if (!window.confirm(message)) return;

    try {
      const res = await fetch(`${API_HOST}/api/vehicles/${vehicle._id}`, {
        method: 'DELETE',
        headers: { 'X-User-Role': currentUser?.role || 'viewer' }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast?.('차량이 삭제되었습니다.', 'success');
        setVehicles(prev => prev.filter(v => v._id !== vehicle._id));
      } else {
        showToast?.(data.message || '삭제에 실패했습니다.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  const openPrepModal = (vehicle) => {
    setEditingVehicle(vehicle);
    setFormData({
      year: vehicle.year || '',
      vin: vehicle.vin || '',
      plateNo: vehicle.plateNo || '',
      registrationDate: vehicle.registrationDate ? String(vehicle.registrationDate).slice(0, 10) : '',
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
        : [{ name: '', price: '' }],

      vehicleWorks: (vehicle.vehicleWorks || []).map(w => ({
        name: w.name || '',
        vendor: w.vendor || '',
        price: w.price ?? '',
        scheduledDate: w.scheduledDate ? String(w.scheduledDate).slice(0, 10) : '',
        completed: !!w.completed,
        note: w.note || ''
      })),

      // 보험 항목은 보험사만 화면에서 고치지만, 저장할 때 등급·연령·대인/대물 같은
      // 나머지 값이 지워지지 않도록 통째로 들고 있는다.
      insurance: {
        ...(vehicle.insurance || {}),
        // 예전에 따로 저장해 둔 가입 보험사가 있으면 그 값을 이어받는다
        company: vehicle.insurance?.company || vehicle.insuranceEnrollment?.company || '렌터카 공제'
      },

      deliveryPlace: {
        name: vehicle.deliveryPlace?.name || '',
        address: vehicle.deliveryPlace?.address || '',
        managerName: vehicle.deliveryPlace?.managerName || '',
        managerPhone: vehicle.deliveryPlace?.managerPhone || '',
        scheduledAt: vehicle.deliveryPlace?.scheduledAt ? String(vehicle.deliveryPlace.scheduledAt).slice(0, 16) : '',
        method: vehicle.deliveryPlace?.method || '탁송',
        note: vehicle.deliveryPlace?.note || ''
      },

      driverInfo: {
        relation: vehicle.driverInfo?.relation || '대표자',
        name: vehicle.driverInfo?.name || vehicle.driver || '',
        birthDate: vehicle.driverInfo?.birthDate || '',
        licenseNo: vehicle.driverInfo?.licenseNo || '',
        licenseType: vehicle.driverInfo?.licenseType || '',
        phone: vehicle.driverInfo?.phone || '',
        email: vehicle.driverInfo?.email || '',
        note: vehicle.driverInfo?.note || ''
      }
    });
    setShowModal(true);
  };

  // 차량 작업내용 - 건별 추가/삭제
  const handleWorkChange = (index, field, value) => {
    setFormData(prev => {
      const vehicleWorks = [...prev.vehicleWorks];
      vehicleWorks[index] = { ...vehicleWorks[index], [field]: value };
      return { ...prev, vehicleWorks };
    });
  };
  const handleAddWork = () => setFormData(prev => ({ ...prev, vehicleWorks: [...prev.vehicleWorks, { ...EMPTY_WORK }] }));
  const handleRemoveWork = (index) => setFormData(prev => ({ ...prev, vehicleWorks: prev.vehicleWorks.filter((_, i) => i !== index) }));

  const setSection = (section, field, value) =>
    setFormData(prev => ({ ...prev, [section]: { ...prev[section], [field]: value } }));

  // 운전자는 대표자이거나 계약 담당자인 경우가 대부분이라, 계약서에 있는 값을 그대로 끌어온다.
  const fillDriverFrom = (relation) => {
    const contract = editingVehicle?.contract;
    const company = contract?.companyId;
    const picked = {
      '대표자': { name: company?.ceoName || '', phone: '' },
      '책임담당자': { name: contract?.managerMain || '', phone: contract?.managerMainPhone || '' },
      '실무담당자': { name: contract?.managerOps || '', phone: contract?.managerOpsPhone || '' }
    }[relation];

    if (!picked || (!picked.name && !picked.phone)) {
      showToast?.(`계약서에 ${relation} 정보가 없습니다. 직접 입력해 주세요.`, 'info');
      setSection('driverInfo', 'relation', relation);
      return;
    }
    setFormData(prev => ({
      ...prev,
      driverInfo: { ...prev.driverInfo, relation, name: picked.name || prev.driverInfo.name, phone: picked.phone || prev.driverInfo.phone }
    }));
  };

  // 렌트료 게시일을 입력하면 월 대여료 결제일을 그 날짜의 '일'로 자동 채운다.
  // 단, 결제일은 정해진 날짜 중에서만 고르므로 목록에 없는 날이면 건드리지 않고 직접 고르게 둔다.
  const handleRentBillingDateChange = (value) => {
    const day = value ? String(Number(value.slice(8, 10))) : '';
    const usable = PAYMENT_DAY_OPTIONS.some(o => o.value === day);
    setFormData(prev => ({
      ...prev,
      rentBillingDate: value,
      monthlyPaymentDay: usable ? day : prev.monthlyPaymentDay
    }));
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

  /**
   * 출고 준비 내용을 차량 DB에 저장한다.
   *
   * @param {object} e 폼 이벤트
   * @param {boolean} temporary 임시저장 여부.
   *   true면 상태를 '장기렌트'로 넘기지 않아 출고 준비 목록에 그대로 남는다.
   *   아직 확인할 게 남았을 때 입력한 내용만 먼저 저장해 두는 용도다.
   */
  const handleSave = async (e, temporary = false) => {
    e?.preventDefault();
    if (currentUser?.role === 'viewer') {
      showToast?.('수정 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    try {
      setSaving(true);
      const payload = {
        year: formData.year,
        vin: formData.vin,
        plateNo: formData.plateNo,
        registrationDate: formData.registrationDate || undefined,
        deliveryDate: formData.deliveryDate || undefined,
        rentBillingDate: formData.rentBillingDate || undefined,
        monthlyPaymentDay: formData.monthlyPaymentDay || undefined,
        interestRate: formData.interestRate === '' ? undefined : Number(formData.interestRate),
        companyCommission: formData.companyCommission === '' ? undefined : Number(formData.companyCommission),
        dealerCommission: formData.dealerCommission === '' ? undefined : Number(formData.dealerCommission),
        sellingAdminExpense: formData.sellingAdminExpense === '' ? undefined : Number(formData.sellingAdminExpense),
        driver: formData.driver,
        vehicleManager: formData.vehicleManager,
        accessories: {
          blackboxPrice: formData.accessories.blackboxPrice === '' ? undefined : Number(formData.accessories.blackboxPrice),
          blackboxInfo: formData.accessories.blackboxInfo,
          tintingPrice: formData.accessories.tintingPrice === '' ? undefined : Number(formData.accessories.tintingPrice),
          tintingInfo: formData.accessories.tintingInfo,
          tireInfo: formData.accessories.tireInfo
        },
        gifts: formData.gifts
          .filter(g => g.name.trim() !== '')
          .map(g => ({ name: g.name, price: g.price === '' ? 0 : Number(g.price) })),

        // 작업명이 비어 있는 줄은 저장하지 않는다
        vehicleWorks: formData.vehicleWorks
          .filter(w => w.name.trim() !== '')
          .map(w => ({
            name: w.name,
            vendor: w.vendor,
            price: w.price === '' ? undefined : Number(w.price),
            scheduledDate: w.scheduledDate || undefined,
            completed: !!w.completed,
            note: w.note
          })),

        // 보험 항목을 통째로 보내 등급·연령 등 나머지 값이 지워지지 않게 한다
        insurance: { ...formData.insurance },

        deliveryPlace: {
          ...formData.deliveryPlace,
          scheduledAt: formData.deliveryPlace.scheduledAt || undefined
        },

        driverInfo: { ...formData.driverInfo },
        // 목록과 기존 화면이 driver(이름)를 쓰므로 운전자명을 그쪽에도 맞춰 둔다
        driver: formData.driverInfo.name || formData.driver
      };

      // 차량번호+차대번호가 둘 다 채워지면 출고가 끝난 것으로 보고 '장기렌트'로 전환한다.
      // (계약서 등록 시점엔 아직 출고 전이라 '계약중'으로 만들어져 있다.)
      // 임시저장일 때는 아직 끝난 게 아니므로 상태를 그대로 둬서 목록에 남긴다.
      const finished = !temporary && payload.plateNo && payload.vin;
      if (finished) {
        payload.status = '장기렌트';
      }

      const res = await fetch(`${API_HOST}/api/vehicles/${editingVehicle._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (temporary) {
          // 이어서 입력할 수 있도록 팝업을 열어 둔 채 목록 값만 갱신한다
          showToast?.('임시저장했습니다. 출고 준비 목록에 그대로 남아 있습니다.', 'success');
          setVehicles(prev => prev.map(v => v._id === editingVehicle._id ? data.vehicle : v));
        } else {
          showToast?.('차량 DB에 저장되었습니다. 이후 수정은 렌트차량 DB 화면에서 할 수 있습니다.', 'success');
          setShowModal(false);
          // 출고가 끝난 차량만 목록에서 빠지고, 아직이면 갱신된 값으로 남는다
          if (finished) {
            setVehicles(prev => prev.filter(v => v._id !== editingVehicle._id));
          } else {
            setVehicles(prev => prev.map(v => v._id === editingVehicle._id ? data.vehicle : v));
          }
        }
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

  const filteredVehicles = vehicles.filter(v => {
    if (missingFilter === 'plate' && v.plateNo) return false;
    if (missingFilter === 'vin' && v.vin) return false;
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      (v.code || '').toLowerCase().includes(q) ||
      (v.carModel || '').toLowerCase().includes(q) ||
      formatCustomerName(v.contract?.customer).toLowerCase().includes(q) ||
      (v.contract?.contractNo || '').toLowerCase().includes(q)
    );
  });

  // 출고 준비 목록에서 정렬할 수 있는 항목
  const PREP_COLUMNS = [
    { key: 'code', label: '코드', sortValue: (v) => v.code },
    { key: 'carModel', label: '차종', sortValue: (v) => v.carModel },
    { key: 'party', label: '고객 / 계약', sortValue: (v) => v.contract?.companyId?.name || formatCustomerName(v.contract?.customer) },
    { key: 'contractNo', label: '계약번호', sortValue: (v) => v.contract?.contractNo },
    { key: 'createdAt', label: '등록일', numeric: true, sortValue: (v) => v.createdAt }
  ];
  const prepSort = useTableSort(filteredVehicles, PREP_COLUMNS);
  const visibleVehicles = prepSort.rows;

  const inputStyle = { width: '100%', padding: '0.55rem 0.7rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-bright)', fontSize: '0.85rem' };
  const labelStyle = { fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' };
  const sectionTitleStyle = { fontWeight: '700', fontSize: '0.85rem', marginBottom: '0.6rem', color: 'var(--text-bright)' };
  const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ background: '#fff', padding: '1.2rem', borderRadius: '10px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
        <Truck size={22} style={{ color: 'var(--primary)' }} />
        <div>
          <div style={{ fontWeight: '800', fontSize: '1.1rem', color: 'var(--text-bright)' }}>출고 준비 대기 {vehicles.length}건</div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>계약서까지 작성된 고객의 차량 중, 차량번호 또는 차대번호가 아직 입력되지 않은 차량입니다.</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '260px', maxWidth: '400px' }}>
          <Search size={14} style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="차량 코드, 차종, 고객명, 계약번호 검색..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ width: '100%', padding: '0.55rem 1rem 0.55rem 2.2rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem' }}
          />
        </div>
        <select
          value={missingFilter}
          onChange={(e) => setMissingFilter(e.target.value)}
          style={{ padding: '0.55rem 0.7rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem', background: '#fff', cursor: 'pointer' }}
        >
          <option value="all">부족한 정보 전체</option>
          <option value="plate">차량번호 없음</option>
          <option value="vin">차대번호 없음</option>
        </select>
        <SortControls
          sort={prepSort}
          selectStyle={{ padding: '0.55rem 0.7rem', fontSize: '0.85rem' }}
          defaultLabel="정렬 안 함 (등록순)"
          show={prepSort.active || Boolean(searchTerm) || missingFilter !== 'all'}
          onReset={() => { setSearchTerm(''); setMissingFilter('all'); }}
        />
      </div>

      <div style={{ background: '#fff', borderRadius: '10px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-bright)', fontWeight: '700' }}>
              <SortableTh sort={prepSort} columnKey="code" style={{ padding: '0.8rem' }}>코드</SortableTh>
              <SortableTh sort={prepSort} columnKey="carModel" style={{ padding: '0.8rem' }}>차종</SortableTh>
              <SortableTh sort={prepSort} columnKey="party" style={{ padding: '0.8rem' }}>고객 / 계약</SortableTh>
              <th style={{ padding: '0.8rem' }}>부족한 정보</th>
              <th style={{ padding: '0.8rem', width: '80px' }}>관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>로딩 중...</td></tr>
            ) : visibleVehicles.length === 0 ? (
              <tr><td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                <CheckCircle2 size={18} style={{ verticalAlign: 'middle', marginRight: '0.3rem', color: '#52c41a' }} />
                출고 준비가 필요한 차량이 없습니다.
              </td></tr>
            ) : (
              visibleVehicles.map(v => (
                <tr key={v._id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '0.8rem', fontWeight: '700' }}>{v.code || '-'}</td>
                  <td style={{ padding: '0.8rem' }}>
                    <div style={{ fontWeight: '600' }}>{v.carModel}</div>
                    {v.carSpec && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{v.carSpec}</div>}
                  </td>
                  <td style={{ padding: '0.8rem' }}>
                    {v.contract ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                        <span style={{ fontWeight: '600' }}>{v.contract.companyId?.name || formatCustomerName(v.contract.customer)}</span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{v.contract.contractNo}</span>
                      </div>
                    ) : '-'}
                  </td>
                  <td style={{ padding: '0.8rem' }}>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      {!v.plateNo && (
                        <span style={{ background: '#fff1f0', color: '#ff4d4f', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '600' }}>차량번호 없음</span>
                      )}
                      {!v.vin && (
                        <span style={{ background: '#fff1f0', color: '#ff4d4f', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.72rem', fontWeight: '600' }}>차대번호 없음</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '0.8rem', display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
                    <button
                      onClick={() => openPrepModal(v)}
                      style={{ border: 'none', background: 'none', color: 'var(--primary)', cursor: 'pointer' }}
                      title="출고 준비 입력"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(v)}
                      style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}
                      title="차량 삭제"
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

      {showModal && (
        createPortal(
        /* 팝업은 document.body에 직접 그린다.
           페이지 쪽 조상에 transform/animation이 걸려 있으면 position:fixed의 기준이 그 요소로 바뀌어
           팝업이 스크롤되는 콘텐츠 영역 안에 갇히고, 화면 기준 위치가 어긋난다. */
        <div onClick={() => setShowModal(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: `${DIALOG_TOP} 2rem 2rem` }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...dragStyle, background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '720px', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <div {...dragHandleProps} style={{ ...dragHandleProps.style, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.2rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
              <h3 style={{ margin: 0, fontWeight: '800', fontSize: '1.05rem' }}>{editingVehicle?.carModel} 출고 준비</h3>
              <button type="button" onClick={() => setShowModal(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSave} style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>

              {/* 계약서에서 가져온 차량 정보 (읽기 전용) */}
              {editingVehicle && (() => {
                const v = editingVehicle;
                const c = v.contract;
                const company = c?.companyId;
                const won = (n) => (n || n === 0) ? `${Number(n).toLocaleString()}원` : '-';
                const rows = [
                  ['계약번호', c?.contractNo],
                  ['계약자', company ? company.name : formatCustomerName(c?.customer)],
                  ['차량코드', v.code],
                  ['차종', v.carModel],
                  ['사양', v.carSpec],
                  ['유종 / 배기량', [v.fuelType, v.cc ? `${v.cc}cc` : ''].filter(Boolean).join(' / ')],
                  ['외장 / 내장', [v.exteriorColor, v.interiorColor].filter(Boolean).join(' / ')],
                  ['옵션', v.options],
                  ['예상납기', v.deliveryPeriod],
                  ['월 렌트료', won(v.monthlyFee)],
                  ['납입 개월 수', v.paymentTerm ? `${v.paymentTerm}개월` : ''],
                  ['보험 조건', [v.insurance?.company, v.insurance?.type === 'premium' ? '고급형' : '일반형', v.insurance?.driverAge].filter(Boolean).join(' / ')]
                ].filter(([, value]) => value);

                return (
                  <div style={{ background: 'var(--bg-main)', padding: '0.9rem 1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                    <div style={{ ...sectionTitleStyle, marginBottom: '0.6rem' }}>📋 계약서에서 가져온 차량 정보</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.4rem 1rem' }}>
                      {rows.map(([label, value]) => (
                        <div key={label} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.82rem', minWidth: 0 }}>
                          <span style={{ color: 'var(--text-muted)', flexShrink: 0, minWidth: '84px' }}>{label}</span>
                          <span style={{ color: 'var(--text-bright)', fontWeight: '600', wordBreak: 'break-all' }}>{value}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.6rem' }}>
                      계약서 등록 시 렌트차량 DB에 올라온 값입니다. 이 항목을 고치려면 계약서 등록 화면에서 수정하세요.
                    </div>
                  </div>
                );
              })()}

              {/* 실물 등록 */}
              <div>
                <div style={sectionTitleStyle}>🚗 실물 등록 정보</div>
                <div style={gridStyle}>
                  <div>
                    <label style={labelStyle}>차량번호</label>
                    <input value={formData.plateNo} onChange={(e) => setFormData({ ...formData, plateNo: e.target.value })} style={inputStyle} placeholder="예: 123가4567" />
                  </div>
                  <div>
                    <label style={labelStyle}>차대번호 (VIN)</label>
                    <input value={formData.vin} onChange={(e) => setFormData({ ...formData, vin: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>연식</label>
                    <input value={formData.year} onChange={(e) => setFormData({ ...formData, year: e.target.value })} style={inputStyle} placeholder="예: 2026년식" />
                  </div>
                  <div>
                    <label style={labelStyle}>등록일</label>
                    <input type="date" value={formData.registrationDate} onChange={(e) => setFormData({ ...formData, registrationDate: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>인도일</label>
                    <input type="date" value={formData.deliveryDate} onChange={(e) => setFormData({ ...formData, deliveryDate: e.target.value })} style={inputStyle} />
                  </div>
                </div>
              </div>

              {/* 렌트료 / 납입 정보 */}
              <div>
                <div style={sectionTitleStyle}>💳 렌트료 / 납입 정보</div>
                <div style={gridStyle}>
                  <div>
                    <label style={labelStyle}>렌트료 게시일</label>
                    <input type="date" value={formData.rentBillingDate} onChange={(e) => handleRentBillingDateChange(e.target.value)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>월 대여료 결제일</label>
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
                    <label style={labelStyle}>금리 (%)</label>
                    <input type="number" step="0.1" value={formData.interestRate} onChange={(e) => setFormData({ ...formData, interestRate: e.target.value })} style={inputStyle} placeholder="견적서에 적용된 금리" />
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
                </div>
              </div>

              {/* 1. 차량 작업내용 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                  <div style={{ ...sectionTitleStyle, marginBottom: 0 }}>🛠 차량 작업내용</div>
                  <button type="button" onClick={handleAddWork} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', border: 'none', background: 'var(--primary-glow)', color: 'var(--primary)', padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer' }}>
                    <Plus size={12} /> 작업 추가
                  </button>
                </div>
                {formData.vehicleWorks.length === 0 ? (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.6rem 0' }}>
                    선팅, 블랙박스, 유리막코팅 등 출고 전에 진행할 작업을 추가해 주세요.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {formData.vehicleWorks.map((w, i) => (
                      <div key={i} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.7rem' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem' }}>
                          <div>
                            <label style={labelStyle}>작업명</label>
                            <input value={w.name} onChange={(e) => handleWorkChange(i, 'name', e.target.value)} style={inputStyle} placeholder="예: 선팅" />
                          </div>
                          <div>
                            <label style={labelStyle}>작업 업체</label>
                            <input value={w.vendor} onChange={(e) => handleWorkChange(i, 'vendor', e.target.value)} style={inputStyle} />
                          </div>
                          <div>
                            <label style={labelStyle}>금액 (원)</label>
                            <MoneyInput value={w.price} onChange={(e) => handleWorkChange(i, 'price', e.target.value)} style={inputStyle} />
                          </div>
                          <div>
                            <label style={labelStyle}>작업 예정일</label>
                            <input type="date" value={w.scheduledDate} onChange={(e) => handleWorkChange(i, 'scheduledDate', e.target.value)} style={inputStyle} />
                          </div>
                          <div>
                            <label style={labelStyle}>비고</label>
                            <input value={w.note} onChange={(e) => handleWorkChange(i, 'note', e.target.value)} style={inputStyle} />
                          </div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                            <input type="checkbox" checked={w.completed} onChange={(e) => handleWorkChange(i, 'completed', e.target.checked)} />
                            작업 완료
                          </label>
                          <button type="button" onClick={() => handleRemoveWork(i)} style={{ border: 'none', background: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.75rem' }}>
                            <Trash2 size={12} /> 삭제
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 2. 보험 가입 */}
              <div>
                <div style={sectionTitleStyle}>🛡 보험 가입</div>
                <div style={gridStyle}>
                  <div>
                    <label style={labelStyle}>보험사</label>
                    <input value={formData.insurance.company} onChange={(e) => setSection('insurance', 'company', e.target.value)} style={inputStyle} />
                  </div>
                </div>
              </div>

              {/* 3. 출고지 등록 */}
              <div>
                <div style={sectionTitleStyle}>📍 출고지 등록</div>
                <div style={gridStyle}>
                  <div>
                    <label style={labelStyle}>출고지명</label>
                    <input value={formData.deliveryPlace.name} onChange={(e) => setSection('deliveryPlace', 'name', e.target.value)} style={inputStyle} placeholder="예: 서울 출고센터" />
                  </div>
                  <div>
                    <label style={labelStyle}>인도 방법</label>
                    <select value={formData.deliveryPlace.method} onChange={(e) => setSection('deliveryPlace', 'method', e.target.value)} style={inputStyle}>
                      <option value="탁송">탁송</option>
                      <option value="직접인수">직접인수</option>
                    </select>
                  </div>
                  <CustomerPicker
                    label="출고지 담당자 (고객 DB 검색)"
                    value={formData.deliveryPlace.managerName}
                    onPick={(name, phone) => setFormData(prev => ({
                      ...prev,
                      deliveryPlace: { ...prev.deliveryPlace, managerName: name, managerPhone: phone || prev.deliveryPlace.managerPhone }
                    }))}
                    onType={(name) => setSection('deliveryPlace', 'managerName', name)}
                    labelStyle={labelStyle}
                    inputStyle={inputStyle}
                    apiHost={API_HOST}
                  />
                  <div>
                    <label style={labelStyle}>담당자 연락처</label>
                    <input value={formData.deliveryPlace.managerPhone} onChange={(e) => setSection('deliveryPlace', 'managerPhone', e.target.value)} style={inputStyle} />
                  </div>
                </div>
                <div style={{ marginTop: '0.6rem' }}>
                  <label style={labelStyle}>출고지 주소</label>
                  <input value={formData.deliveryPlace.address} onChange={(e) => setSection('deliveryPlace', 'address', e.target.value)} style={inputStyle} />
                </div>
                <div style={{ marginTop: '0.6rem' }}>
                  <label style={labelStyle}>비고</label>
                  <input value={formData.deliveryPlace.note} onChange={(e) => setSection('deliveryPlace', 'note', e.target.value)} style={inputStyle} />
                </div>
              </div>

              {/* 4. 운전자 등록 */}
              <div>
                <div style={sectionTitleStyle}>🙋 운전자 등록</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>계약서에서 불러오기</span>
                  {['대표자', '책임담당자', '실무담당자'].map((r) => (
                    <button key={r} type="button" onClick={() => fillDriverFrom(r)} style={{ border: '1px solid var(--border-color)', background: formData.driverInfo.relation === r ? 'var(--primary-glow)' : '#fff', color: formData.driverInfo.relation === r ? 'var(--primary)' : 'var(--text-muted)', padding: '0.25rem 0.6rem', borderRadius: '20px', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer' }}>
                      {r}
                    </button>
                  ))}
                </div>
                <div style={gridStyle}>
                  <div>
                    <label style={labelStyle}>구분</label>
                    <select value={formData.driverInfo.relation} onChange={(e) => setSection('driverInfo', 'relation', e.target.value)} style={inputStyle}>
                      <option value="대표자">대표자</option>
                      <option value="책임담당자">책임담당자</option>
                      <option value="실무담당자">실무담당자</option>
                      <option value="직원">직원</option>
                      <option value="기타">기타</option>
                    </select>
                  </div>
                  <CustomerPicker
                    label="운전자명 (고객 DB 검색)"
                    value={formData.driverInfo.name}
                    onPick={(name, phone) => setFormData(prev => ({
                      ...prev,
                      driverInfo: { ...prev.driverInfo, name, phone: phone || prev.driverInfo.phone }
                    }))}
                    onType={(name) => setSection('driverInfo', 'name', name)}
                    labelStyle={labelStyle}
                    inputStyle={inputStyle}
                    apiHost={API_HOST}
                  />
                  <div>
                    <label style={labelStyle}>연락처</label>
                    <input value={formData.driverInfo.phone} onChange={(e) => setSection('driverInfo', 'phone', e.target.value)} style={inputStyle} />
                  </div>
                </div>
              </div>

              {/* 부착물 */}
              <div>
                <div style={sectionTitleStyle}>🔧 블랙박스 / 선팅 / 타이어</div>
                {/* 모델명과 금액이 한 줄에 짝으로 오도록 2열로 고정한다 */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.8rem' }}>
                  <div>
                    <label style={labelStyle}>블랙박스 모델명</label>
                    <input value={formData.accessories.blackboxInfo} onChange={(e) => setFormData({ ...formData, accessories: { ...formData.accessories, blackboxInfo: e.target.value } })} style={inputStyle} placeholder="예: 아이나비 QSD0-7000" />
                  </div>
                  <div>
                    <label style={labelStyle}>블랙박스 금액 (원)</label>
                    <MoneyInput value={formData.accessories.blackboxPrice} onChange={(e) => setFormData({ ...formData, accessories: { ...formData.accessories, blackboxPrice: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>썬팅 정보</label>
                    <input value={formData.accessories.tintingInfo} onChange={(e) => setFormData({ ...formData, accessories: { ...formData.accessories, tintingInfo: e.target.value } })} style={inputStyle} placeholder="예: 버텍스300 전면 35%/1열 15%" />
                  </div>
                  <div>
                    <label style={labelStyle}>썬팅 금액 (원)</label>
                    <MoneyInput value={formData.accessories.tintingPrice} onChange={(e) => setFormData({ ...formData, accessories: { ...formData.accessories, tintingPrice: e.target.value } })} style={inputStyle} />
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
                  <div style={sectionTitleStyle}>🎁 사은품</div>
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
                <button
                  type="button"
                  onClick={(e) => handleSave(e, true)}
                  disabled={saving}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginRight: 'auto', background: '#fff', border: '1px solid var(--primary)', color: 'var(--primary)', padding: '0.6rem 1.2rem', borderRadius: '8px', fontWeight: '700', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.85rem', opacity: saving ? 0.7 : 1 }}
                >
                  <Save size={16} /> 임시저장
                </button>
                <button type="button" onClick={() => setShowModal(false)} style={{ background: '#fff', border: '1px solid var(--border-color)', padding: '0.6rem 1.4rem', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem' }}>취소</button>
                <button type="submit" disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.6rem 1.4rem', borderRadius: '8px', fontWeight: '700', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.85rem', opacity: saving ? 0.7 : 1 }}>
                  <Save size={16} /> {saving ? '저장 중...' : '차량 DB 저장'}
                </button>
              </div>
            </form>
          </div>
        </div>, document.body)
      )}
    </div>
  );
}

export default DeliveryPrepView;
