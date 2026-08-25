import { useState, useEffect } from 'react';
import {
  Building2,
  Search,
  Plus,
  Edit3,
  X,
  Users,
  Star,
  User,
  Link2,
  Unlink
} from 'lucide-react';
import { formatBizNo } from '../../utils/format.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const EMPTY_FORM = {
  name: '',
  bizType: '법인사업자',
  bizNo: '',
  ceoName: '',
  address: '',
  billingEmail: '',
  folderName: '',
  memo: ''
};

function CompanyManagementView({ showToast, currentUser }) {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editingCompany, setEditingCompany] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // 소속 고객 목록 (법인 상세/수정 모달에서만 사용)
  const [affiliatedCustomers, setAffiliatedCustomers] = useState([]);
  const [affiliatedLoading, setAffiliatedLoading] = useState(false);

  // OCR 및 고객 검색을 위한 추가 상태
  const [ocrLoading, setOcrLoading] = useState(false);
  const [customerSearchTerm, setCustomerSearchTerm] = useState('');
  const [customerSearchResults, setCustomerSearchResults] = useState([]);
  const [customerSearchLoading, setCustomerSearchLoading] = useState(false);

  // 고객별 보기: 고객을 먼저 고르고 그 고객의 법인들을 관리한다
  const [viewMode, setViewMode] = useState('company'); // 'company' | 'customer'
  const [pickerTerm, setPickerTerm] = useState('');
  const [pickerResults, setPickerResults] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerCompanies, setCustomerCompanies] = useState([]);
  const [customerCompaniesLoading, setCustomerCompaniesLoading] = useState(false);

  // 기존 법인 연결용 검색
  const [linkTerm, setLinkTerm] = useState('');
  const [linkResults, setLinkResults] = useState([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [showLinkPanel, setShowLinkPanel] = useState(false);

  // 검색어 디바운스
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // 고객 검색 자동완성 디바운스
  useEffect(() => {
    if (!customerSearchTerm.trim()) {
      setCustomerSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setCustomerSearchLoading(true);
        const res = await fetch(`${API_BASE_URL}/api/customers?search=${encodeURIComponent(customerSearchTerm.trim())}&limit=8`);
        if (res.ok) {
          const data = await res.json();
          const results = data.customers || (Array.isArray(data) ? data : []);
          setCustomerSearchResults(results);
        }
      } catch (err) {
        console.error('Failed to search customers', err);
      } finally {
        setCustomerSearchLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [customerSearchTerm]);

  // 고객별 보기 - 고객 검색 디바운스
  useEffect(() => {
    if (!pickerTerm.trim()) {
      setPickerResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setPickerLoading(true);
        const res = await fetch(`${API_BASE_URL}/api/customers?search=${encodeURIComponent(pickerTerm.trim())}&limit=10`);
        if (res.ok) {
          const data = await res.json();
          setPickerResults(data.customers || (Array.isArray(data) ? data : []));
        }
      } catch (err) {
        console.error('Failed to search customers', err);
      } finally {
        setPickerLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [pickerTerm]);

  // 고객별 보기 - 연결할 기존 법인 검색 디바운스
  useEffect(() => {
    if (!linkTerm.trim()) {
      setLinkResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setLinkLoading(true);
        const res = await fetch(`${API_BASE_URL}/api/companies?search=${encodeURIComponent(linkTerm.trim())}`);
        if (res.ok) {
          const data = await res.json();
          setLinkResults(Array.isArray(data) ? data.slice(0, 8) : []);
        }
      } catch (err) {
        console.error('Failed to search companies', err);
      } finally {
        setLinkLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [linkTerm]);

  const fetchCompanies = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());

      const res = await fetch(`${API_BASE_URL}/api/companies?${params.toString()}`);
      if (!res.ok) throw new Error('법인 목록을 불러오지 못했습니다.');
      const data = await res.json();
      setCompanies(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast?.(err.message || '법인 목록 로딩 오류', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCompanies();
  }, [debouncedSearch]);

  const fetchAffiliatedCustomers = async (companyId) => {
    try {
      setAffiliatedLoading(true);
      const res = await fetch(`${API_BASE_URL}/api/companies/${companyId}/customers`);
      if (!res.ok) throw new Error('소속 고객 목록을 불러오지 못했습니다.');
      const data = await res.json();
      setAffiliatedCustomers(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setAffiliatedLoading(false);
    }
  };

  /**
   * 선택된 고객의 법인 목록을 다시 읽어온다.
   * GET /api/customers/:id 가 companies.companyId를 populate 해 준다.
   */
  const fetchCustomerCompanies = async (customerId) => {
    try {
      setCustomerCompaniesLoading(true);
      const res = await fetch(`${API_BASE_URL}/api/customers/${customerId}`);
      if (!res.ok) throw new Error('고객의 법인 목록을 불러오지 못했습니다.');
      const data = await res.json();

      const list = (data.companies || [])
        .filter((m) => m.companyId) // 삭제된 법인을 참조하는 항목 제외
        .map((m) => ({
          _id: m.companyId._id,
          name: m.companyId.name,
          bizNo: m.companyId.bizNo,
          bizType: m.companyId.bizType,
          role: m.role || '',
          isPrimary: !!m.isPrimary
        }));

      setCustomerCompanies(list);
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setCustomerCompaniesLoading(false);
    }
  };

  const handleSelectCustomer = (customer) => {
    setSelectedCustomer(customer);
    setPickerTerm('');
    setPickerResults([]);
    setShowLinkPanel(false);
    setLinkTerm('');
    setLinkResults([]);
    fetchCustomerCompanies(customer._id);
  };

  /** 이미 등록된 법인을 이 고객에게 연결한다. */
  const handleLinkExistingCompany = async (company) => {
    if (customerCompanies.some((c) => c._id === company._id)) {
      showToast?.('이미 연결된 법인입니다.', 'warning');
      return;
    }

    try {
      const res = await fetch(`${API_BASE_URL}/api/customers/${selectedCustomer._id}/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
        body: JSON.stringify({
          companyId: company._id,
          role: '담당자',
          isPrimary: customerCompanies.length === 0
        })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || '법인 연결에 실패했습니다.');
      }

      showToast?.(`${company.name} 법인을 연결했습니다.`, 'success');
      setLinkTerm('');
      setLinkResults([]);
      setShowLinkPanel(false);
      fetchCustomerCompanies(selectedCustomer._id);
    } catch (err) {
      showToast?.(err.message, 'error');
    }
  };

  const handleUnlinkCompany = async (company) => {
    if (!window.confirm(`${company.name} 법인 연결을 해제할까요?\n(법인 자체는 삭제되지 않습니다)`)) return;

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/customers/${selectedCustomer._id}/companies/${company._id}`,
        { method: 'DELETE', headers: { 'X-User-Role': currentUser?.role || 'viewer' } }
      );
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || '연결 해제에 실패했습니다.');
      }

      showToast?.('법인 연결을 해제했습니다.', 'success');
      fetchCustomerCompanies(selectedCustomer._id);
    } catch (err) {
      showToast?.(err.message, 'error');
    }
  };

  /**
   * presetCustomer가 있으면 새 법인을 그 고객에게 바로 연결된 상태로 시작한다.
   * (고객별 보기에서 "이 고객에게 법인 등록"으로 진입하는 경로)
   */
  const openAddModal = (presetCustomer = null) => {
    setEditingCompany(null);
    setFormData(EMPTY_FORM);
    setAffiliatedCustomers(
      presetCustomer
        ? [{
            _id: presetCustomer._id,
            name: presetCustomer.name,
            contactPhone: presetCustomer.contactPhone || presetCustomer.mobilePhone,
            email: presetCustomer.email,
            role: '담당자',
            isPrimary: customerCompanies.length === 0
          }]
        : []
    );
    setCustomerSearchTerm('');
    setCustomerSearchResults([]);
    setShowModal(true);
  };

  const openEditModal = (company) => {
    setEditingCompany(company);
    fetchAffiliatedCustomers(company._id);
    setFormData({
      name: company.name || '',
      bizType: company.bizType || '법인사업자',
      bizNo: company.bizNo || '',
      ceoName: company.ceoName || '',
      address: company.address || '',
      billingEmail: company.billingEmail || '',
      folderName: company.folderName || '',
      memo: company.memo || ''
    });
    setCustomerSearchTerm('');
    setCustomerSearchResults([]);
    setShowModal(true);
  };

  /**
   * 고객별 보기의 법인 카드는 요약 필드만 가지고 있으므로,
   * 수정 모달을 열기 전에 법인 전체 정보를 받아온다.
   */
  const openEditModalForCompany = async (companyId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/companies/${companyId}`);
      if (!res.ok) throw new Error('법인 정보를 불러오지 못했습니다.');
      openEditModal(await res.json());
    } catch (err) {
      showToast?.(err.message, 'error');
    }
  };

  // OCR 업로드 핸들러
  const handleOcrUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      setOcrLoading(true);
      const formDataObj = new FormData();
      formDataObj.append('file', file);

      const res = await fetch(`${API_BASE_URL}/api/companies/ocr`, {
        method: 'POST',
        headers: {
          'X-User-Role': currentUser?.role || 'viewer'
        },
        body: formDataObj
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || '사업자등록증 분석에 실패했습니다.');
      }

      const data = await res.json();
      
      setFormData(prev => ({
        ...prev,
        name: data.name || prev.name,
        bizNo: data.bizNo || prev.bizNo,
        ceoName: data.ceoName || prev.ceoName,
        address: data.address || prev.address,
        bizType: data.bizType || prev.bizType
      }));

      showToast?.(
        data.source === 'clova'
          ? 'OCR로 사업자등록증을 읽었습니다. 값이 맞는지 확인 후 저장해 주세요.'
          : '사업자등록증 정보가 자동 입력되었습니다. 값이 맞는지 확인 후 저장해 주세요.',
        'success'
      );
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setOcrLoading(false);
      e.target.value = '';
    }
  };

  // 고객 매칭 관리용 핸들러들
  const handleAddCustomer = (customer) => {
    if (affiliatedCustomers.some(c => c._id === customer._id)) {
      showToast?.('이미 추가된 고객입니다.', 'warning');
      return;
    }

    const isFirst = affiliatedCustomers.length === 0;

    setAffiliatedCustomers(prev => [
      ...prev,
      {
        _id: customer._id,
        name: customer.name,
        contactPhone: customer.contactPhone || customer.mobilePhone,
        email: customer.email,
        role: '담당자',
        isPrimary: isFirst
      }
    ]);
    setCustomerSearchTerm('');
    setCustomerSearchResults([]);
  };

  const handleRemoveCustomer = (customerId) => {
    setAffiliatedCustomers(prev => prev.filter(c => c._id !== customerId));
  };

  const handleRoleChange = (customerId, newRole) => {
    setAffiliatedCustomers(prev => prev.map(c => 
      c._id === customerId ? { ...c, role: newRole } : c
    ));
  };

  const handlePrimaryChange = (customerId) => {
    setAffiliatedCustomers(prev => prev.map(c => 
      c._id === customerId ? { ...c, isPrimary: true } : { ...c, isPrimary: false }
    ));
  };

  const handleSaveCompany = async (e) => {
    e.preventDefault();
    if (currentUser?.role === 'viewer') {
      showToast?.('등록 및 수정 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (!formData.name.trim()) {
      showToast?.('법인명은 필수입니다.', 'error');
      return;
    }

    try {
      setSaving(true);
      const payload = { 
        ...formData, 
        name: formData.name.trim(),
        customerAssociations: affiliatedCustomers.map(ac => ({
          customerId: ac._id,
          role: ac.role || '담당자',
          isPrimary: !!ac.isPrimary
        }))
      };

      const res = editingCompany
        ? await fetch(`${API_BASE_URL}/api/companies/${editingCompany._id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
            body: JSON.stringify(payload)
          })
        : await fetch(`${API_BASE_URL}/api/companies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
            body: JSON.stringify(payload)
          });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || '저장에 실패했습니다.');
      }

      showToast?.(editingCompany ? '법인 정보가 수정되었습니다.' : '신규 법인이 등록되었습니다.', 'success');
      setShowModal(false);
      fetchCompanies();
      if (selectedCustomer) {
        fetchCustomerCompanies(selectedCustomer._id);
      }
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* 보기 전환 탭 */}
      <div style={{ display: 'flex', gap: '0.4rem', borderBottom: '1px solid var(--border-color)' }}>
        {[
          { key: 'company', label: '법인별 보기', icon: Building2 },
          { key: 'customer', label: '고객별 보기', icon: User }
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setViewMode(key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.7rem 1.1rem',
              border: 'none',
              borderBottom: viewMode === key ? '2px solid var(--primary)' : '2px solid transparent',
              background: 'transparent',
              color: viewMode === key ? 'var(--primary)' : 'var(--text-muted)',
              fontWeight: '700',
              fontSize: '0.9rem',
              cursor: 'pointer',
              marginBottom: '-1px'
            }}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {viewMode === 'company' && (
      <>
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
        <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="법인명, 사업자번호, 고객명 검색..."
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

        <button
          onClick={() => openAddModal()}
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
          <span>신규 법인 등록</span>
        </button>
      </div>

      {/* 법인 목록 테이블 */}
      <div style={{
        background: 'var(--bg-surface)',
        borderRadius: '12px',
        border: '1px solid var(--border-color)',
        overflow: 'hidden'
      }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            법인 목록을 불러오는 중입니다...
          </div>
        ) : companies.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            {debouncedSearch ? '검색 결과가 없습니다.' : '등록된 법인이 없습니다. 신규 법인을 등록해 보세요.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-main)', borderBottom: '2px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '0.9rem 1.2rem', fontWeight: '700', minWidth: '220px' }}>법인명</th>
                  <th style={{ padding: '0.9rem 1.2rem', fontWeight: '700', width: '140px' }}>구분</th>
                  <th style={{ padding: '0.9rem 1.2rem', fontWeight: '700', width: '160px' }}>사업자번호</th>
                  <th style={{ padding: '0.9rem 1.2rem', fontWeight: '700', minWidth: '140px' }}>대표자</th>
                  <th style={{ padding: '0.9rem 1.2rem', fontWeight: '700', textAlign: 'center', width: '100px' }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((company) => (
                  <tr
                    key={company._id}
                    style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                    onClick={() => openEditModal(company)}
                    className="outlook-row-hover"
                  >
                    <td style={{ padding: '0.9rem 1.2rem', fontWeight: '700', color: 'var(--text-bright)' }}>
                      {company.name}
                    </td>
                    <td style={{ padding: '0.9rem 1.2rem' }}>
                      <span style={{
                        padding: '0.2rem 0.6rem',
                        borderRadius: '20px',
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        background: company.bizType === '개인사업자' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(54, 124, 255, 0.12)',
                        color: company.bizType === '개인사업자' ? '#f59e0b' : 'var(--primary)'
                      }}>
                        {company.bizType || '미지정'}
                      </span>
                    </td>
                    <td style={{ padding: '0.9rem 1.2rem', color: 'var(--text-main)' }}>
                      {company.bizNo || '-'}
                    </td>
                    <td style={{ padding: '0.9rem 1.2rem', color: 'var(--text-main)' }}>
                      {company.ceoName || '-'}
                    </td>
                    <td style={{ padding: '0.9rem 1.2rem', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => openEditModal(company)}
                        title="수정"
                        style={{
                          border: 'none',
                          background: 'rgba(54, 124, 255, 0.1)',
                          color: 'var(--primary)',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          padding: '0.3rem 0.6rem',
                          fontSize: '0.78rem',
                          fontWeight: '600',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem'
                        }}
                      >
                        <Edit3 size={13} />
                        <span>수정</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </>
      )}

      {/* ── 고객별 보기: 고객을 먼저 고르고 그 고객의 법인들을 관리한다 ── */}
      {viewMode === 'customer' && (
      <>
        {/* 고객 선택 */}
        <div style={{
          background: 'var(--bg-surface)',
          padding: '1.2rem 1.5rem',
          borderRadius: '12px',
          border: '1px solid var(--border-color)'
        }}>
          <label style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-bright)', display: 'block', marginBottom: '0.6rem' }}>
            고객 선택
          </label>

          <div style={{ position: 'relative' }}>
            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="고객명, 연락처, 이메일로 검색..."
              value={pickerTerm}
              onChange={(e) => setPickerTerm(e.target.value)}
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

            {pickerTerm && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
                zIndex: 20,
                maxHeight: '260px',
                overflowY: 'auto',
                marginTop: '4px'
              }}>
                {pickerLoading ? (
                  <div style={{ padding: '0.8rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    검색 중...
                  </div>
                ) : pickerResults.length === 0 ? (
                  <div style={{ padding: '0.8rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    검색 결과가 없습니다.
                  </div>
                ) : (
                  pickerResults.map((c) => (
                    <div
                      key={c._id}
                      onClick={() => handleSelectCustomer(c)}
                      className="outlook-row-hover"
                      style={{
                        padding: '0.7rem 0.9rem',
                        cursor: 'pointer',
                        borderBottom: '1px solid var(--border-color)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.5rem',
                        fontSize: '0.86rem'
                      }}
                    >
                      <span style={{ fontWeight: '600', color: 'var(--text-bright)' }}>{c.name}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                        {c.contactPhone || c.email || '연락처 없음'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {!selectedCustomer ? (
          <div style={{
            background: 'var(--bg-surface)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            padding: '3rem',
            textAlign: 'center',
            color: 'var(--text-muted)'
          }}>
            고객을 먼저 선택해 주세요. 선택한 고객에게 여러 개의 법인을 등록할 수 있습니다.
          </div>
        ) : (
          <div style={{
            background: 'var(--bg-surface)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            overflow: 'hidden'
          }}>
            {/* 선택된 고객 헤더 */}
            <div style={{
              padding: '1.2rem 1.5rem',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem',
              background: 'var(--bg-main)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', minWidth: 0 }}>
                <div style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  background: 'rgba(54, 124, 255, 0.12)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <User size={18} style={{ color: 'var(--primary)' }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '1rem' }}>
                    {selectedCustomer.name}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    {selectedCustomer.contactPhone || selectedCustomer.email || '연락처 없음'}
                    {' · '}
                    법인 {customerCompanies.length}개
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setShowLinkPanel((v) => !v)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    padding: '0.6rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'transparent',
                    color: 'var(--text-main)',
                    fontWeight: '600',
                    cursor: 'pointer',
                    fontSize: '0.85rem'
                  }}
                >
                  <Link2 size={15} />
                  <span>기존 법인 연결</span>
                </button>
                <button
                  onClick={() => openAddModal(selectedCustomer)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    padding: '0.6rem 1rem',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'var(--primary)',
                    color: '#ffffff',
                    fontWeight: '600',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
                  }}
                >
                  <Plus size={15} />
                  <span>이 고객에게 법인 등록</span>
                </button>
              </div>
            </div>

            {/* 기존 법인 연결 패널 */}
            {showLinkPanel && (
              <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
                <input
                  type="text"
                  autoFocus
                  placeholder="이미 등록된 법인을 법인명 또는 사업자번호로 검색..."
                  value={linkTerm}
                  onChange={(e) => setLinkTerm(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.9rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-main)',
                    color: 'var(--text-bright)',
                    fontSize: '0.86rem'
                  }}
                />

                {linkTerm && (
                  <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {linkLoading ? (
                      <div style={{ padding: '0.6rem', color: 'var(--text-muted)', fontSize: '0.83rem' }}>검색 중...</div>
                    ) : linkResults.length === 0 ? (
                      <div style={{ padding: '0.6rem', color: 'var(--text-muted)', fontSize: '0.83rem' }}>
                        검색 결과가 없습니다. 신규 법인이라면 「이 고객에게 법인 등록」을 이용해 주세요.
                      </div>
                    ) : (
                      linkResults.map((co) => (
                        <div
                          key={co._id}
                          onClick={() => handleLinkExistingCompany(co)}
                          className="outlook-row-hover"
                          style={{
                            padding: '0.6rem 0.8rem',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-main)',
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '0.5rem',
                            fontSize: '0.84rem'
                          }}
                        >
                          <span style={{ fontWeight: '600', color: 'var(--text-bright)' }}>{co.name}</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{co.bizNo || '사업자번호 없음'}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 이 고객의 법인 목록 */}
            {customerCompaniesLoading ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                법인 목록을 불러오는 중입니다...
              </div>
            ) : customerCompanies.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                이 고객에게 등록된 법인이 없습니다. 「이 고객에게 법인 등록」으로 추가해 보세요.
              </div>
            ) : (
              <div style={{ padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {customerCompanies.map((co) => (
                  <div
                    key={co._id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '0.8rem',
                      padding: '0.9rem 1rem',
                      borderRadius: '8px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-main)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0, flexWrap: 'wrap' }}>
                      <Building2 size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      <span style={{ fontWeight: '700', color: 'var(--text-bright)', fontSize: '0.92rem' }}>
                        {co.name}
                      </span>
                      {co.isPrimary && (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.2rem',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '20px',
                          fontSize: '0.72rem',
                          fontWeight: '700',
                          background: 'rgba(245, 158, 11, 0.14)',
                          color: '#f59e0b'
                        }}>
                          <Star size={11} />
                          주 소속
                        </span>
                      )}
                      <span style={{
                        padding: '0.15rem 0.5rem',
                        borderRadius: '20px',
                        fontSize: '0.72rem',
                        fontWeight: '600',
                        background: co.bizType === '개인사업자' ? 'rgba(245, 158, 11, 0.12)' : 'rgba(54, 124, 255, 0.12)',
                        color: co.bizType === '개인사업자' ? '#f59e0b' : 'var(--primary)'
                      }}>
                        {co.bizType || '미지정'}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        {co.bizNo || '사업자번호 없음'}
                      </span>
                      {co.role && (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>· {co.role}</span>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                      <button
                        onClick={() => openEditModalForCompany(co._id)}
                        style={{
                          border: 'none',
                          background: 'rgba(54, 124, 255, 0.1)',
                          color: 'var(--primary)',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          padding: '0.35rem 0.6rem',
                          fontSize: '0.78rem',
                          fontWeight: '600',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem'
                        }}
                      >
                        <Edit3 size={13} />
                        <span>수정</span>
                      </button>
                      <button
                        onClick={() => handleUnlinkCompany(co)}
                        title="이 고객과의 연결만 해제합니다. 법인 자체는 삭제되지 않습니다."
                        style={{
                          border: 'none',
                          background: 'rgba(239, 68, 68, 0.1)',
                          color: '#ef4444',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          padding: '0.35rem 0.6rem',
                          fontSize: '0.78rem',
                          fontWeight: '600',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem'
                        }}
                      >
                        <Unlink size={13} />
                        <span>연결 해제</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </>
      )}

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
            maxHeight: '90vh',
            overflowY: 'auto',
            borderRadius: '16px',
            border: '1px solid var(--border-color)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
          }}>
            <div style={{
              padding: '1.2rem 1.5rem',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              position: 'sticky',
              top: 0,
              background: 'var(--bg-surface)',
              zIndex: 1
            }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-bright)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Building2 size={18} style={{ color: 'var(--primary)' }} />
                {editingCompany ? '법인 정보 수정' : '신규 법인 등록'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSaveCompany} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              
              {/* 사업자등록증 OCR 업로드 영역 */}
              <div style={{
                border: '1.5px dashed var(--border-color)',
                borderRadius: '8px',
                padding: '1.2rem',
                textAlign: 'center',
                background: 'var(--bg-main)',
                position: 'relative',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }} className="ocr-upload-container">
                <label style={{ cursor: 'pointer', display: 'block', width: '100%', height: '100%' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                    <Plus size={16} />
                    사업자등록증 자동 완성 (PDF/이미지)
                  </span>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'block' }}>
                    클릭하거나 파일을 드래그하여 사업자등록증을 업로드하세요
                  </span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleOcrUpload}
                    style={{ display: 'none' }}
                  />
                </label>
                {ocrLoading && (
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.75)', borderRadius: '8px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: '0.85rem', fontWeight: '600', gap: '0.5rem'
                  }}>
                    <div className="spinner" style={{ width: '16px', height: '16px', border: '2px solid #fff', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}></div>
                    <style dangerouslySetInnerHTML={{__html: `@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}} />
                    <span>사업자등록증 분석 중...</span>
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    법인명 *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="개인사업자는 대표자 이름을 그대로 입력해도 됩니다"
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    구분
                  </label>
                  <select
                    value={formData.bizType}
                    onChange={(e) => setFormData({ ...formData, bizType: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)', cursor: 'pointer' }}
                  >
                    <option value="법인사업자">법인사업자</option>
                    <option value="개인사업자">개인사업자</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    사업자번호
                  </label>
                  <input
                    type="text"
                    value={formData.bizNo}
                    onChange={(e) => setFormData({ ...formData, bizNo: formatBizNo(e.target.value) })}
                    placeholder="000-00-00000"
                    maxLength={12}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)' }}
                  />
                </div>
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

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    청구 이메일
                  </label>
                  <input
                    type="email"
                    value={formData.billingEmail}
                    onChange={(e) => setFormData({ ...formData, billingEmail: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                    폴더명 (원드라이브)
                  </label>
                  <input
                    type="text"
                    value={formData.folderName}
                    onChange={(e) => setFormData({ ...formData, folderName: e.target.value })}
                    style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)' }}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' }}>
                  메모
                </label>
                <textarea
                  rows={3}
                  value={formData.memo}
                  onChange={(e) => setFormData({ ...formData, memo: e.target.value })}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-main)', color: 'var(--text-bright)', resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>

              {/* 소속 고객 관리 영역 */}
              <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.3rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Users size={15} style={{ color: 'var(--text-muted)' }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-bright)' }}>
                      소속 고객 {affiliatedCustomers.length > 0 && `(${affiliatedCustomers.length}명)`}
                    </span>
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>* 주 소속은 고객당 한 개의 법인만 가능합니다</span>
                </div>

                {/* 고객 검색 자동완성 인풋 */}
                <div style={{ position: 'relative', marginBottom: '0.8rem' }}>
                  <input
                    type="text"
                    placeholder="매치할 고객명 검색..."
                    value={customerSearchTerm}
                    onChange={(e) => setCustomerSearchTerm(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.8rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-main)',
                      color: 'var(--text-bright)',
                      fontSize: '0.85rem'
                    }}
                  />
                  
                  {customerSearchTerm && (
                    <div style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      zIndex: 10,
                      maxHeight: '160px',
                      overflowY: 'auto',
                      marginTop: '2px'
                    }}>
                      {customerSearchLoading ? (
                        <div style={{ padding: '0.6rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                          검색 중...
                        </div>
                      ) : customerSearchResults.length === 0 ? (
                        <div style={{ padding: '0.6rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                          검색 결과가 없습니다.
                        </div>
                      ) : (
                        customerSearchResults.map(c => (
                          <div
                            key={c._id}
                            onClick={() => handleAddCustomer(c)}
                            style={{
                              padding: '0.6rem 0.8rem',
                              cursor: 'pointer',
                              borderBottom: '1px solid var(--border-color)',
                              display: 'flex',
                              justifyContent: 'space-between',
                              fontSize: '0.82rem'
                            }}
                            className="outlook-row-hover"
                          >
                            <span style={{ fontWeight: '600', color: 'var(--text-bright)' }}>{c.name}</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{c.contactPhone || c.email || '연락처 없음'}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* 매칭된 소속 고객 리스트 */}
                {affiliatedLoading ? (
                  <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    불러오는 중...
                  </div>
                ) : affiliatedCustomers.length === 0 ? (
                  <div style={{
                    padding: '1.2rem',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: '0.85rem',
                    background: 'var(--bg-main)',
                    borderRadius: '8px',
                    border: '1px dashed var(--border-color)'
                  }}>
                    연결된 고객이 없습니다. 위의 검색창에서 고객명을 검색하여 추가해 주세요.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto' }}>
                    {affiliatedCustomers.map((c) => (
                      <div
                        key={c._id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.5rem 0.8rem',
                          borderRadius: '6px',
                          background: 'var(--bg-main)',
                          border: '1px solid var(--border-color)',
                          fontSize: '0.82rem',
                          gap: '0.5rem'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0, flex: 2 }}>
                          <span style={{ fontWeight: '600', color: 'var(--text-bright)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {c.name}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            ({c.contactPhone || '연락처 없음'})
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                          {/* 역할 설정 */}
                          <select
                            value={c.role || '담당자'}
                            onChange={(e) => handleRoleChange(c._id, e.target.value)}
                            style={{
                              padding: '0.2rem 0.4rem',
                              borderRadius: '4px',
                              border: '1px solid var(--border-color)',
                              background: 'var(--bg-surface)',
                              color: 'var(--text-bright)',
                              fontSize: '0.78rem'
                            }}
                          >
                            <option value="대표">대표</option>
                            <option value="담당자">담당자</option>
                            <option value="실사용자">실사용자</option>
                          </select>

                          {/* 주소속 설정 */}
                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-main)', userSelect: 'none' }}>
                            <input
                              type="checkbox"
                              checked={!!c.isPrimary}
                              onChange={() => handlePrimaryChange(c._id)}
                              style={{ cursor: 'pointer' }}
                            />
                            <span>주 소속</span>
                          </label>

                          {/* 제외 버튼 */}
                          <button
                            type="button"
                            onClick={() => handleRemoveCustomer(c._id)}
                            style={{
                              border: 'none',
                              background: 'rgba(239, 68, 68, 0.1)',
                              color: '#ef4444',
                              padding: '0.2rem 0.4rem',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                              fontWeight: '600'
                            }}
                          >
                            제외
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.8rem', marginTop: '0.5rem' }}>
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
                  disabled={saving}
                  style={{
                    padding: '0.6rem 1.2rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: 'var(--primary)',
                    color: '#fff',
                    fontWeight: '600',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.6 : 1
                  }}
                >
                  {saving ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default CompanyManagementView;
