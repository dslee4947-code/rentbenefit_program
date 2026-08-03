import React, { useState, useEffect } from 'react';
import { 
  Users, 
  Search, 
  RefreshCw, 
  Plus, 
  Building, 
  Phone, 
  Mail, 
  MapPin, 
  Edit3, 
  Trash2, 
  X, 
  CheckCircle2,
  AlertCircle,
  Eye
} from 'lucide-react';
import OutlookContactModal from './OutlookContactModal';

function CustomerListView({ showToast, currentUser }) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filterSource, setFilterSource] = useState('all'); // 'all' | 'outlook' | 'manual'
  const [filterCategory, setFilterCategory] = useState('all'); // outlook folder filter
  const [categories, setCategories] = useState([]);
  
  // Multi-window Outlook Contact Card Manager State
  const [openOutlookWindows, setOpenOutlookWindows] = useState([]); 
  const [maxZIndex, setMaxZIndex] = useState(1000);

  // Open / Focus Multi-Window Customer Handler
  const handleOpenOutlookWindow = (customer) => {
    if (!customer) return;

    setOpenOutlookWindows(prev => {
      const existing = prev.find(w => w.customer._id === customer._id);
      const nextZIndex = maxZIndex + 1;
      setMaxZIndex(nextZIndex);

      if (existing) {
        // Bring existing window to front
        return prev.map(w => w.customer._id === customer._id ? { ...w, zIndex: nextZIndex } : w);
      } else {
        // Open new independent window with cascade offset
        const openCount = prev.length;
        const initialPosition = {
          x: Math.min(window.innerWidth - 960, 80 + (openCount % 10) * 35),
          y: Math.min(window.innerHeight - 690, 50 + (openCount % 10) * 30)
        };
        return [...prev, { customer, position: initialPosition, zIndex: nextZIndex }];
      }
    });
  };

  const handleCloseOutlookWindow = (customerId) => {
    setOpenOutlookWindows(prev => prev.filter(w => w.customer._id !== customerId));
  };

  const handleFocusOutlookWindow = (customerId) => {
    const nextZIndex = maxZIndex + 1;
    setMaxZIndex(nextZIndex);
    setOpenOutlookWindows(prev => prev.map(w => w.customer._id === customerId ? { ...w, zIndex: nextZIndex } : w));
  };
  
  // Pagination State
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ totalCount: 0, totalPages: 1, limit: 50 });
  const [stats, setStats] = useState({ total: 0, outlook: 0, manual: 0 });

  // Outlook Sync State
  const [isSyncing, setIsSyncing] = useState(false);

  // Modal State for Add/Edit
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    bizNo: '',
    ceoName: '',
    contactName: '',
    contactPhone: '',
    email: '',
    address: '',
    bankName: '',
    bankAccount: '',
    bankHolder: ''
  });

  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

  // 0. Debounce Search Term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
      setPage(1); // Reset page on search
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // 1. 고객 목록 불러오기 (서버 초고속 페이징)
  const fetchCustomers = async (targetPage = page) => {
    try {
      setLoading(true);
      const queryParams = new URLSearchParams({
        page: targetPage,
        limit: 50,
        search: debouncedSearch,
        source: filterSource,
        category: filterCategory
      });

      const res = await fetch(`${API_BASE_URL}/api/customers?${queryParams.toString()}`);
      if (!res.ok) throw new Error('고객 목록을 불러오지 못했습니다.');
      const data = await res.json();

      if (data.customers) {
        setCustomers(data.customers);
        setPagination(data.pagination || { totalCount: 0, totalPages: 1, limit: 50 });
        setStats(data.stats || { total: 0, outlook: 0, manual: 0 });
        if (data.categories) setCategories(data.categories);
      } else {
        setCustomers(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      showToast?.(err.message || '고객 목록 로딩 오류', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers(page);
  }, [page, debouncedSearch, filterSource, filterCategory]);

  // 2. 아웃룩 수동 동기화 실행
  const handleOutlookSync = async () => {
    if (currentUser?.role === 'viewer') {
      showToast?.('수정 및 등록 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    try {
      setIsSyncing(true);
      showToast?.('아웃룩 전체 연락처(1.8만 건) 동기화를 진행 중입니다...', 'info');
      const res = await fetch(`${API_BASE_URL}/api/customers/sync-outlook`, {
        method: 'POST',
        headers: {
          'X-User-Role': currentUser?.role || 'viewer'
        }
      });
      const data = await res.json();

      if (res.ok && data.data?.success) {
        showToast?.(`아웃룩 동기화 완료! (총 ${data.data.totalCount}건 중 신규 ${data.data.addedCount}건, 갱신 ${data.data.updatedCount}건)`, 'success');
        fetchCustomers(1);
      } else {
        showToast?.(`동기화 실패: ${data.error || data.message || '오류 발생'}`, 'error');
      }
    } catch (err) {
      showToast?.(`아웃룩 동기화 중 에러 발생: ${err.message}`, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  // 4. 모달 열기 (신규/수정)
  const openAddModal = () => {
    setEditingCustomer(null);
    setFormData({
      name: '',
      bizNo: '',
      ceoName: '',
      contactName: '',
      contactPhone: '',
      email: '',
      address: '',
      bankName: '',
      bankAccount: '',
      bankHolder: ''
    });
    setShowModal(true);
  };

  const openEditModal = (customer) => {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name || '',
      bizNo: customer.bizNo || '',
      ceoName: customer.ceoName || '',
      contactName: customer.contactName || '',
      contactPhone: customer.contactPhone || '',
      email: customer.email || '',
      address: customer.address || '',
      bankName: customer.bank?.name || '',
      bankAccount: customer.bank?.account || '',
      bankHolder: customer.bank?.holder || ''
    });
    setShowModal(true);
  };

  // 5. 고객 정보 저장 (생성/수정)
  const handleSaveCustomer = async (e) => {
    e.preventDefault();
    if (currentUser?.role === 'viewer') {
      showToast?.('수정 및 등록 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    try {
      const payload = {
        name: formData.name,
        bizNo: formData.bizNo,
        ceoName: formData.ceoName,
        contactName: formData.contactName,
        contactPhone: formData.contactPhone,
        email: formData.email,
        address: formData.address,
        bank: {
          name: formData.bankName,
          account: formData.bankAccount,
          holder: formData.bankHolder
        }
      };

      let res;
      if (editingCustomer) {
        res = await fetch(`${API_BASE_URL}/api/customers/${editingCustomer._id}`, {
          method: 'PUT',
          headers: { 
            'Content-Type': 'application/json',
            'X-User-Role': currentUser?.role || 'viewer'
          },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch(`${API_BASE_URL}/api/customers`, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-User-Role': currentUser?.role || 'viewer'
          },
          body: JSON.stringify(payload)
        });
      }

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || '저장에 실패했습니다.');
      }

      showToast?.(editingCustomer ? '고객 정보가 수정되었습니다.' : '신규 고객이 등록되었습니다.', 'success');
      setShowModal(false);
      fetchCustomers();
    } catch (err) {
      showToast?.(err.message, 'error');
    }
  };

  // 6. 고객 삭제
  const handleDeleteCustomer = async (id, name) => {
    if (currentUser?.role === 'viewer') {
      showToast?.('수정 및 삭제 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (!window.confirm(`'${name}' 고객 정보를 삭제하시겠습니까?`)) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/customers/${id}`, {
        method: 'DELETE',
        headers: {
          'X-User-Role': currentUser?.role || 'viewer'
        }
      });
      if (!res.ok) throw new Error('삭제에 실패했습니다.');
      showToast?.('고객 정보가 삭제되었습니다.', 'success');
      fetchCustomers();
    } catch (err) {
      showToast?.(err.message, 'error');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* 상단 액션 툴바 */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        flexWrap: 'wrap', 
        gap: '1rem',
        background: 'var(--bg-surface)', 
        padding: '1.2rem 1.5rem', 
        borderRadius: '12px',
        border: '1px solid var(--border-color)'
      }}>
        {/* 검색 및 필터 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, minWidth: '300px' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input 
              type="text" 
              placeholder="고객명, 담당자, 연락처, 이메일, 사업자번호 검색..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '0.65rem 1rem 0.65rem 2.4rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-main)',
                color: 'var(--text-bright)',
                fontSize: '0.9rem'
              }}
            />
          </div>

          <select
            value={filterSource}
            onChange={(e) => { setFilterSource(e.target.value); setPage(1); }}
            style={{
              padding: '0.65rem 1rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-main)',
              color: 'var(--text-bright)',
              fontSize: '0.9rem',
              cursor: 'pointer'
            }}
          >
            <option value="all">전체 출처 보기</option>
            <option value="outlook">📧 아웃룩 연동 데이터</option>
            <option value="manual">👤 직접 등록 데이터</option>
          </select>

          {categories.length > 0 && (
            <select
              value={filterCategory}
              onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
              style={{
                padding: '0.65rem 1rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-main)',
                color: 'var(--text-bright)',
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
            >
              <option value="all">📂 모든 아웃룩 폴더 보기</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>📁 {cat}</option>
              ))}
            </select>
          )}
        </div>

        {/* 오른쪽 실행 버튼들 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <button
            onClick={handleOutlookSync}
            disabled={isSyncing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1.2rem',
              borderRadius: '8px',
              border: '1px solid var(--primary)',
              background: 'var(--primary-glow)',
              color: 'var(--primary)',
              fontWeight: '600',
              cursor: isSyncing ? 'not-allowed' : 'pointer',
              fontSize: '0.9rem',
              transition: 'all 0.2s'
            }}
          >
            <RefreshCw size={16} className={isSyncing ? 'spin-anim' : ''} />
            <span>{isSyncing ? '동기화 진행 중...' : '아웃룩 실시간 동기화'}</span>
          </button>

          <button
            onClick={openAddModal}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.65rem 1.2rem',
              borderRadius: '8px',
              border: 'none',
              background: 'var(--primary)',
              color: '#ffffff',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '0.9rem',
              boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
            }}
          >
            <Plus size={16} />
            <span>신규 고객 등록</span>
          </button>
        </div>
      </div>

      {/* 요약 통계 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
        <div style={{ background: 'var(--bg-surface)', padding: '1.2rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>전체 등록 고객</span>
          <h3 style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--text-bright)', marginTop: '0.3rem' }}>{stats.total.toLocaleString()} 명</h3>
        </div>
        <div style={{ background: 'var(--bg-surface)', padding: '1.2rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>📧 아웃룩 연동 고객</span>
          <h3 style={{ fontSize: '1.5rem', fontWeight: '800', color: '#0078d4', marginTop: '0.3rem' }}>
            {stats.outlook.toLocaleString()} 명
          </h3>
        </div>
        <div style={{ background: 'var(--bg-surface)', padding: '1.2rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>👤 수동 등록 고객</span>
          <h3 style={{ fontSize: '1.5rem', fontWeight: '800', color: 'var(--primary)', marginTop: '0.3rem' }}>
            {stats.manual.toLocaleString()} 명
          </h3>
        </div>
      </div>

      {/* 고객 DB 테이블 목록 */}
      <div style={{ 
        background: 'var(--bg-surface)', 
        borderRadius: '12px', 
        border: '1px solid var(--border-color)', 
        overflow: 'hidden' 
      }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            고객 DB를 초고속 조회 중입니다...
          </div>
        ) : customers.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            검색 결과 또는 등록된 고객 정보가 없습니다.
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-main)', borderBottom: '2px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.9rem 1.2rem', fontWeight: '700', minWidth: '180px' }}>성</th>
                    <th style={{ padding: '0.9rem 1.2rem', fontWeight: '700', minWidth: '240px' }}>이름</th>
                    <th style={{ padding: '0.9rem 1.2rem', fontWeight: '700', minWidth: '240px' }}>회사</th>
                    <th style={{ padding: '0.9rem 1.2rem', fontWeight: '700', width: '200px' }}>수정한 날짜</th>
                    <th style={{ padding: '0.9rem 1.2rem', fontWeight: '700', textAlign: 'center', width: '120px' }}>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((cust) => {
                    const formattedDate = cust.updatedAt 
                      ? new Date(cust.updatedAt).toLocaleString('ko-KR', {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                          weekday: 'short',
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      : '-';

                    return (
                      <tr 
                        key={cust._id} 
                        onClick={() => handleOpenOutlookWindow(cust)}
                        style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                        className="outlook-row-hover"
                      >
                        {/* 1. 성 (메인 이름) */}
                        <td style={{ padding: '0.9rem 1.2rem', fontWeight: '700', color: 'var(--text-bright)' }}>
                          {cust.surname || cust.name || '-'}
                        </td>

                        {/* 2. 이름 */}
                        <td style={{ padding: '0.9rem 1.2rem', fontWeight: '600', color: 'var(--text-main)' }}>
                          {cust.givenName || cust.displayName || cust.contactName || '-'}
                        </td>

                        {/* 3. 회사 */}
                        <td style={{ padding: '0.9rem 1.2rem', color: 'var(--text-main)', fontWeight: '500' }}>
                          {cust.companyName || (cust.surname ? cust.name : '-') || '-'}
                        </td>

                        {/* 4. 수정한 날짜 */}
                        <td style={{ padding: '0.9rem 1.2rem', color: 'var(--text-muted)', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                          {formattedDate}
                        </td>

                        {/* 5. 관리 */}
                        <td style={{ padding: '0.9rem 1.2rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', justifyContent: 'center', gap: '0.4rem' }}>
                            <button
                              onClick={() => handleOpenOutlookWindow(cust)}
                              title="아웃룩 연락처 상세 카드 보기"
                              style={{
                                border: 'none',
                                background: 'rgba(0, 120, 212, 0.1)',
                                color: '#0078d4',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                padding: '0.3rem 0.6rem',
                                fontSize: '0.78rem',
                                fontWeight: '600',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.2rem'
                              }}
                            >
                              <Eye size={13} />
                              <span>상세</span>
                            </button>
                            <button
                              onClick={() => handleDeleteCustomer(cust._id, cust.name)}
                              title="삭제"
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: '#ff4d4f',
                                cursor: 'pointer',
                                padding: '0.25rem'
                              }}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 하위 서버 페이징 컨트롤 바 */}
            <div style={{
              display: 'flex',
              justify: 'space-between',
              alignItems: 'center',
              padding: '1rem 1.5rem',
              background: 'var(--bg-main)',
              borderTop: '1px solid var(--border-color)',
              fontSize: '0.85rem',
              color: 'var(--text-muted)'
            }}>
              <div>
                총 <strong style={{ color: 'var(--text-bright)' }}>{pagination.totalCount.toLocaleString()}</strong>건 중{' '}
                {pagination.totalCount > 0 ? ((page - 1) * 50) + 1 : 0} - {Math.min(page * 50, pagination.totalCount)}건 표시
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  style={{
                    padding: '0.4rem 0.8rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: page <= 1 ? 'transparent' : 'var(--bg-surface)',
                    color: page <= 1 ? 'var(--text-muted)' : 'var(--text-bright)',
                    cursor: page <= 1 ? 'not-allowed' : 'pointer',
                    fontSize: '0.85rem'
                  }}
                >
                  ◀ 이전
                </button>

                <span style={{ fontWeight: '600', color: 'var(--text-bright)' }}>
                  {page} / {pagination.totalPages || 1} 페이지
                </span>

                <button
                  onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                  disabled={page >= pagination.totalPages}
                  style={{
                    padding: '0.4rem 0.8rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: page >= pagination.totalPages ? 'transparent' : 'var(--bg-surface)',
                    color: page >= pagination.totalPages ? 'var(--text-muted)' : 'var(--text-bright)',
                    cursor: page >= pagination.totalPages ? 'not-allowed' : 'pointer',
                    fontSize: '0.85rem'
                  }}
                >
                  다음 ▶
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 등록 / 수정 모달 */}
      {showModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            background: 'var(--bg-surface)',
            width: '100%',
            maxWidth: '560px',
            borderRadius: '16px',
            border: '1px solid var(--border-color)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            overflow: 'hidden'
          }}>
            {/* 모달 헤더 */}
            <div style={{
              padding: '1.2rem 1.5rem',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-bright)' }}>
                {editingCustomer ? '고객 정보 수정' : '신규 고객 등록'}
              </h3>
              <button 
                onClick={() => setShowModal(false)}
                style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* 모달 폼 바디 */}
            <form onSubmit={handleSaveCustomer} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    개인/법인명 *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    사업자/주민번호 *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.bizNo}
                    onChange={(e) => setFormData({ ...formData, bizNo: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    대표자명
                  </label>
                  <input
                    type="text"
                    value={formData.ceoName}
                    onChange={(e) => setFormData({ ...formData, ceoName: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    담당자명
                  </label>
                  <input
                    type="text"
                    value={formData.contactName}
                    onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)' }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    연락처
                  </label>
                  <input
                    type="text"
                    value={formData.contactPhone}
                    onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    이메일 *
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                  주소
                </label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)' }}
                />
              </div>

              {/* 모달 푸터 버튼 */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.8rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{
                    padding: '0.6rem 1.2rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    background: 'transparent',
                    color: 'var(--text-muted)',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  취소
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '0.6rem 1.2rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: 'var(--primary)',
                    color: '#fff',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  저장
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 독립 다중 아웃룩 연락처 팝업 창 관리자 (Multi-window Support) */}
      {openOutlookWindows.map(win => (
        <OutlookContactModal
          key={win.customer._id}
          windowId={win.customer._id}
          customer={win.customer}
          initialPosition={win.position}
          zIndex={win.zIndex}
          isTopWindow={win.zIndex === maxZIndex}
          onFocus={() => handleFocusOutlookWindow(win.customer._id)}
          onClose={() => handleCloseOutlookWindow(win.customer._id)}
          onSave={async (id, updatedData) => {
            if (currentUser?.role === 'viewer') {
              showToast?.('수정 및 등록 권한이 없습니다. 관리자에게 문의하세요.', 'error');
              return;
            }
            const res = await fetch(`${API_BASE_URL}/api/customers/${id}`, {
              method: 'PUT',
              headers: { 
                'Content-Type': 'application/json',
                'X-User-Role': currentUser?.role || 'viewer'
              },
              body: JSON.stringify(updatedData)
            });
            if (!res.ok) {
              const errData = await res.json();
              throw new Error(errData.message || '저장에 실패했습니다.');
            }
            showToast?.('아웃룩 연락처 정보가 저장되었습니다.', 'success');
            handleCloseOutlookWindow(id);
            fetchCustomers(page);
          }}
          onDelete={(id, name) => handleDeleteCustomer(id, name)}
          showToast={showToast}
        />
      ))}
    </div>
  );
}

export default CustomerListView;
