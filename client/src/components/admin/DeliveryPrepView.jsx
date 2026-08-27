import { useState, useEffect } from 'react';
import { Truck, Search, X, Save, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { formatCustomerName } from '../../utils/format.js';

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
  gifts: [{ name: '', price: '' }]
};

function DeliveryPrepView({ showToast, currentUser }) {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchPendingVehicles = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_HOST}/api/vehicles?status=rented&limit=10000`);
      const data = await res.json();
      if (data.success) {
        // 계약서까지 작성된(=contract가 연결된) 차량 중, 실물 등록(차량번호/차대번호)이
        // 아직 안 끝난 차량만 출고 준비 대상으로 본다.
        const pending = (data.vehicles || []).filter(v => v.contract && (!v.plateNo || !v.vin));
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
        : [{ name: '', price: '' }]
    });
    setShowModal(true);
  };

  // 렌트료 게시일을 입력하면 월 대여료 결제일(일)을 그 날짜의 '일'로 자동 채운다 (직접 수정 가능)
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
        monthlyPaymentDay: formData.monthlyPaymentDay === '' ? undefined : Number(formData.monthlyPaymentDay),
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
          .map(g => ({ name: g.name, price: g.price === '' ? 0 : Number(g.price) }))
      };

      const res = await fetch(`${API_HOST}/api/vehicles/${editingVehicle._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast?.('차량 DB에 저장되었습니다. 이후 수정은 렌트차량 DB 화면에서 할 수 있습니다.', 'success');
        setShowModal(false);
        // 차량번호+차대번호가 둘 다 채워졌으면 출고 준비 목록에서 자동으로 빠진다
        if (payload.plateNo && payload.vin) {
          setVehicles(prev => prev.filter(v => v._id !== editingVehicle._id));
        } else {
          setVehicles(prev => prev.map(v => v._id === editingVehicle._id ? data.vehicle : v));
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
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      (v.code || '').toLowerCase().includes(q) ||
      (v.carModel || '').toLowerCase().includes(q) ||
      formatCustomerName(v.contract?.customer).toLowerCase().includes(q) ||
      (v.contract?.contractNo || '').toLowerCase().includes(q)
    );
  });

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

      <div style={{ position: 'relative', maxWidth: '400px' }}>
        <Search size={14} style={{ position: 'absolute', left: '0.8rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          type="text"
          placeholder="차량 코드, 차종, 고객명, 계약번호 검색..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ width: '100%', padding: '0.55rem 1rem 0.55rem 2.2rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem' }}
        />
      </div>

      <div style={{ background: '#fff', borderRadius: '10px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-bright)', fontWeight: '700' }}>
              <th style={{ padding: '0.8rem' }}>코드</th>
              <th style={{ padding: '0.8rem' }}>차종</th>
              <th style={{ padding: '0.8rem' }}>고객 / 계약</th>
              <th style={{ padding: '0.8rem' }}>부족한 정보</th>
              <th style={{ padding: '0.8rem', width: '120px' }}>관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>로딩 중...</td></tr>
            ) : filteredVehicles.length === 0 ? (
              <tr><td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                <CheckCircle2 size={18} style={{ verticalAlign: 'middle', marginRight: '0.3rem', color: '#52c41a' }} />
                출고 준비가 필요한 차량이 없습니다.
              </td></tr>
            ) : (
              filteredVehicles.map(v => (
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
                  <td style={{ padding: '0.8rem' }}>
                    <button
                      onClick={() => openPrepModal(v)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: '700', cursor: 'pointer' }}
                    >
                      <Truck size={13} /> 입력
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div onClick={() => setShowModal(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '720px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.2rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
              <h3 style={{ margin: 0, fontWeight: '800', fontSize: '1.05rem' }}>{editingVehicle?.carModel} 출고 준비</h3>
              <button type="button" onClick={() => setShowModal(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSave} style={{ padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>

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
                    <label style={labelStyle}>월 대여료 결제일 (일)</label>
                    <input type="number" min="1" max="31" value={formData.monthlyPaymentDay} onChange={(e) => setFormData({ ...formData, monthlyPaymentDay: e.target.value })} style={inputStyle} placeholder="렌트료 게시일 기준 자동 입력" />
                  </div>
                  <div>
                    <label style={labelStyle}>금리 (%)</label>
                    <input type="number" step="0.1" value={formData.interestRate} onChange={(e) => setFormData({ ...formData, interestRate: e.target.value })} style={inputStyle} placeholder="견적서에 적용된 금리" />
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
                </div>
              </div>

              {/* 운전자 / 관리자 */}
              <div>
                <div style={sectionTitleStyle}>🙋 운전자 / 관리자</div>
                <div style={gridStyle}>
                  <div>
                    <label style={labelStyle}>운전자 (대표가 아닐 시 입력)</label>
                    <input value={formData.driver} onChange={(e) => setFormData({ ...formData, driver: e.target.value })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>차량 관리자 (있을 시 입력)</label>
                    <input value={formData.vehicleManager} onChange={(e) => setFormData({ ...formData, vehicleManager: e.target.value })} style={inputStyle} />
                  </div>
                </div>
              </div>

              {/* 부착물 */}
              <div>
                <div style={sectionTitleStyle}>🔧 블랙박스 / 선팅 / 타이어</div>
                <div style={gridStyle}>
                  <div>
                    <label style={labelStyle}>블랙박스 금액 (원)</label>
                    <input type="number" value={formData.accessories.blackboxPrice} onChange={(e) => setFormData({ ...formData, accessories: { ...formData.accessories, blackboxPrice: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>블랙박스 정보</label>
                    <input value={formData.accessories.blackboxInfo} onChange={(e) => setFormData({ ...formData, accessories: { ...formData.accessories, blackboxInfo: e.target.value } })} style={inputStyle} placeholder="예: 아이나비 QSD0-7000" />
                  </div>
                  <div>
                    <label style={labelStyle}>선팅 금액 (원)</label>
                    <input type="number" value={formData.accessories.tintingPrice} onChange={(e) => setFormData({ ...formData, accessories: { ...formData.accessories, tintingPrice: e.target.value } })} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>선팅 정보</label>
                    <input value={formData.accessories.tintingInfo} onChange={(e) => setFormData({ ...formData, accessories: { ...formData.accessories, tintingInfo: e.target.value } })} style={inputStyle} placeholder="예: 버텍스300 전면 35%/1열 15%" />
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
                <button type="button" onClick={() => setShowModal(false)} style={{ background: '#fff', border: '1px solid var(--border-color)', padding: '0.6rem 1.4rem', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem' }}>취소</button>
                <button type="submit" disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.6rem 1.4rem', borderRadius: '8px', fontWeight: '700', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.85rem', opacity: saving ? 0.7 : 1 }}>
                  <Save size={16} /> {saving ? '저장 중...' : '차량 DB 저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default DeliveryPrepView;
