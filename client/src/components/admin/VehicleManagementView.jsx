import { useState, useEffect } from 'react';
import {
  Search,
  Plus,
  Edit3,
  Trash2,
  X,
  Save,
  Car,
  FileSignature
} from 'lucide-react';
import { formatCustomerName } from '../../utils/format.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const STATUS_LABELS = {
  rented: '운행중',
  available: '대여가능',
  maintenance: '정비중',
  reserved: '예약'
};

const STATUS_COLORS = {
  rented: { bg: '#e6f7ff', text: '#1890ff' },
  available: { bg: '#f6ffed', text: '#52c41a' },
  maintenance: { bg: '#fff1f0', text: '#ff4d4f' },
  reserved: { bg: '#fffbe6', text: '#faad14' }
};

const EMPTY_FORM = {
  code: '',
  carModel: '',
  carSpec: '',
  fuelType: '가솔린',
  cc: '',
  exteriorColor: '',
  interiorColor: '',
  options: '',
  year: '',
  vin: '',
  plateNo: '',
  registrationDate: '',
  carPrice: '',
  monthlyFee: '',
  insurance: {
    company: '삼성화재',
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
  status: 'available',
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
  const [stats, setStats] = useState({ total: 0, rented: 0, available: 0, maintenance: 0, reserved: 0 });

  const [showModal, setShowModal] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

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
        setStats(data.stats || { total: 0, rented: 0, available: 0, maintenance: 0, reserved: 0 });
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
    setFormData({
      code: vehicle.code || '',
      carModel: vehicle.carModel || '',
      carSpec: vehicle.carSpec || '',
      fuelType: vehicle.fuelType || '가솔린',
      cc: vehicle.cc ?? '',
      exteriorColor: vehicle.exteriorColor || '',
      interiorColor: vehicle.interiorColor || '',
      options: vehicle.options || '',
      year: vehicle.year || '',
      vin: vehicle.vin || '',
      plateNo: vehicle.plateNo || '',
      registrationDate: vehicle.registrationDate ? String(vehicle.registrationDate).slice(0, 10) : '',
      carPrice: vehicle.carPrice ?? '',
      monthlyFee: vehicle.monthlyFee ?? '',
      insurance: {
        company: vehicle.insurance?.company || '삼성화재',
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
      status: vehicle.status || 'available',
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
    const day = value ? Number(value.slice(8, 10)) : '';
    setFormData(prev => ({ ...prev, rentBillingDate: value, monthlyPaymentDay: day || prev.monthlyPaymentDay }));
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
      const payload = {
        ...formData,
        cc: formData.cc === '' ? undefined : Number(formData.cc),
        carPrice: formData.carPrice === '' ? undefined : Number(formData.carPrice),
        monthlyFee: formData.monthlyFee === '' ? undefined : Number(formData.monthlyFee),
        currentMileage: formData.currentMileage === '' ? undefined : Number(formData.currentMileage),
        registrationDate: formData.registrationDate || undefined,
        maintenance: {
          ...formData.maintenance,
          mileage: formData.maintenance.mileage === '' ? undefined : Number(formData.maintenance.mileage)
        },

        deliveryDate: formData.deliveryDate || undefined,
        rentBillingDate: formData.rentBillingDate || undefined,
        monthlyPaymentDay: formData.monthlyPaymentDay === '' ? undefined : Number(formData.monthlyPaymentDay),
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

  const statCards = [
    { key: 'total', label: '전체 차량', value: stats.total, color: 'var(--primary)' },
    { key: 'rented', label: '운행중', value: stats.rented, color: STATUS_COLORS.rented.text },
    { key: 'available', label: '대여가능', value: stats.available, color: STATUS_COLORS.available.text },
    { key: 'maintenance', label: '정비중', value: stats.maintenance, color: STATUS_COLORS.maintenance.text },
    { key: 'reserved', label: '예약', value: stats.reserved, color: STATUS_COLORS.reserved.text }
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
        <button
          type="button"
          onClick={openAddModal}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.6rem 1.1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer' }}
        >
          <Plus size={16} /> 차량 추가
        </button>
      </div>

      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', background: 'var(--bg-main)', padding: '0.7rem 1rem', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>
        💡 계약서를 등록하면 차량이 여기에 자동으로 등록됩니다. 이 화면의 "차량 추가"는 계약과 무관한 재고 차량을 미리 등록해두고 싶을 때만 사용하세요.
      </div>

      {/* 목록 */}
      <div style={{ background: '#fff', borderRadius: '10px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-bright)', fontWeight: '700' }}>
                <th style={{ padding: '0.8rem' }}>코드</th>
                <th style={{ padding: '0.8rem' }}>차종 / 사양</th>
                <th style={{ padding: '0.8rem' }}>차량번호</th>
                <th style={{ padding: '0.8rem' }}>유종</th>
                <th style={{ padding: '0.8rem' }}>연결 계약</th>
                <th style={{ padding: '0.8rem' }}>월 렌트료</th>
                <th style={{ padding: '0.8rem' }}>상태</th>
                <th style={{ padding: '0.8rem', width: '80px' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: '2rem' }}>로딩 중...</td></tr>
              ) : vehicles.length === 0 ? (
                <tr><td colSpan="8" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>등록된 차량이 없습니다.</td></tr>
              ) : (
                vehicles.map(v => {
                  const statusColor = STATUS_COLORS[v.status] || STATUS_COLORS.available;
                  return (
                    <tr key={v._id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.8rem', fontWeight: '700' }}>{v.code || '-'}</td>
                      <td style={{ padding: '0.8rem' }}>
                        <div style={{ fontWeight: '600' }}>{v.carModel}</div>
                        {v.carSpec && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{v.carSpec}</div>}
                      </td>
                      <td style={{ padding: '0.8rem' }}>{v.plateNo || '-'}</td>
                      <td style={{ padding: '0.8rem' }}>{v.fuelType || '-'}</td>
                      <td style={{ padding: '0.8rem' }}>
                        {v.contract ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                            <span style={{ fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                              <FileSignature size={12} style={{ color: 'var(--primary)' }} />
                              {v.contract.companyId?.name || formatCustomerName(v.contract.customer)}
                            </span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{v.contract.contractNo}</span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>미연결 (재고)</span>
                        )}
                      </td>
                      <td style={{ padding: '0.8rem', fontWeight: '700' }}>{v.monthlyFee ? `${v.monthlyFee.toLocaleString()}원` : '-'}</td>
                      <td style={{ padding: '0.8rem' }}>
                        <span style={{ background: statusColor.bg, color: statusColor.text, padding: '0.2rem 0.6rem', borderRadius: '20px', fontSize: '0.75rem', fontWeight: '700' }}>
                          {STATUS_LABELS[v.status] || v.status}
                        </span>
                      </td>
                      <td style={{ padding: '0.8rem' }}>
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
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 추가/수정 모달 */}
      {showModal && (
        <div
          onClick={() => setShowModal(false)}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '760px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.2rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
              <h3 style={{ margin: 0, fontWeight: '800', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Car size={18} style={{ color: 'var(--primary)' }} /> {editingVehicle ? '차량 정보 수정' : '차량 추가'}
              </h3>
              <button type="button" onClick={() => setShowModal(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              {editingVehicle?.contract && (
                <div style={{ background: 'var(--bg-main)', padding: '0.8rem 1rem', borderRadius: '8px', fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <FileSignature size={14} style={{ color: 'var(--primary)' }} />
                  계약번호 {editingVehicle.contract.contractNo}에 연결된 차량입니다. 고객/계약 정보는 계약서 등록 화면에서 수정하세요.
                </div>
              )}

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
                <div style={{ fontWeight: '700', fontSize: '0.85rem', marginBottom: '0.6rem', color: 'var(--text-bright)' }}>💰 가격</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.8rem' }}>
                  <div>
                    <label style={labelStyle}>차량가 (원)</label>
                    <input type="number" value={formData.carPrice} onChange={(e) => setFormData({ ...formData, carPrice: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>월 렌트료 (원)</label>
                    <input type="number" value={formData.monthlyFee} onChange={(e) => setFormData({ ...formData, monthlyFee: e.target.value })} style={inputStyle} />
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
                    <input type="number" value={formData.insurance.deductible} onChange={(e) => setFormData({ ...formData, insurance: { ...formData.insurance, deductible: e.target.value } })} style={inputStyle} />
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
                    <label style={labelStyle}>약정 주행거리 (km)</label>
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
                  <div>
                    <label style={labelStyle}>누적 주행거리 (km)</label>
                    <input type="number" value={formData.currentMileage} onChange={(e) => setFormData({ ...formData, currentMileage: e.target.value })} style={inputStyle} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label style={labelStyle}>메모</label>
                    <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} style={{ ...inputStyle, minHeight: '70px', resize: 'vertical' }} />
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
                    <input type="number" min="1" max="31" value={formData.monthlyPaymentDay} onChange={(e) => setFormData({ ...formData, monthlyPaymentDay: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>금리 (%)</label>
                    <input type="number" step="0.1" value={formData.interestRate} onChange={(e) => setFormData({ ...formData, interestRate: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>회사수수료 (원)</label>
                    <input type="number" value={formData.companyCommission} onChange={(e) => setFormData({ ...formData, companyCommission: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>타딜러수수료 (원)</label>
                    <input type="number" value={formData.dealerCommission} onChange={(e) => setFormData({ ...formData, dealerCommission: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>판관비 (원)</label>
                    <input type="number" value={formData.sellingAdminExpense} onChange={(e) => setFormData({ ...formData, sellingAdminExpense: e.target.value })} style={inputStyle} />
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
                    <input type="number" value={formData.accessories.blackboxPrice} onChange={(e) => setFormData({ ...formData, accessories: { ...formData.accessories, blackboxPrice: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>블랙박스 정보</label>
                    <input value={formData.accessories.blackboxInfo} onChange={(e) => setFormData({ ...formData, accessories: { ...formData.accessories, blackboxInfo: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>선팅 금액 (원)</label>
                    <input type="number" value={formData.accessories.tintingPrice} onChange={(e) => setFormData({ ...formData, accessories: { ...formData.accessories, tintingPrice: e.target.value } })} style={inputStyle} />
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
                      <input type="number" value={g.price} onChange={(e) => handleGiftChange(idx, 'price', e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="가격 (원)" />
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
                <button type="button" onClick={() => setShowModal(false)} style={{ background: '#fff', border: '1px solid var(--border-color)', padding: '0.6rem 1.4rem', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem' }}>
                  취소
                </button>
                <button type="submit" disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.6rem 1.4rem', borderRadius: '8px', fontWeight: '700', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.85rem', opacity: saving ? 0.7 : 1 }}>
                  <Save size={16} /> {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default VehicleManagementView;
