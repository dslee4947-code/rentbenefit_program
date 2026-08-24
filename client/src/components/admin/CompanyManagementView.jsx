import { useState, useEffect } from 'react';
import {
  Building2,
  Search,
  Plus,
  Edit3,
  X,
  Users,
  Star
} from 'lucide-react';
import { formatBizNo } from '../../utils/format.js';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:5000`;

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

  // 검색어 디바운스
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

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

  const openAddModal = () => {
    setEditingCompany(null);
    setFormData(EMPTY_FORM);
    setAffiliatedCustomers([]);
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
    setShowModal(true);
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
      const payload = { ...formData, name: formData.name.trim() };

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
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setSaving(false);
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
        <div style={{ position: 'relative', flex: 1, minWidth: '260px' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="법인명, 사업자번호 검색..."
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

              {/* 소속 고객 목록 (신규 등록 시에는 표시하지 않음 - 아직 저장된 법인이 없으므로) */}
              {editingCompany && (
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '0.3rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.6rem' }}>
                    <Users size={15} style={{ color: 'var(--text-muted)' }} />
                    <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-bright)' }}>
                      소속 고객 {affiliatedCustomers.length > 0 && `(${affiliatedCustomers.length}명)`}
                    </span>
                  </div>

                  {affiliatedLoading ? (
                    <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      불러오는 중...
                    </div>
                  ) : affiliatedCustomers.length === 0 ? (
                    <div style={{
                      padding: '1rem',
                      textAlign: 'center',
                      color: 'var(--text-muted)',
                      fontSize: '0.85rem',
                      background: 'var(--bg-main)',
                      borderRadius: '8px',
                      border: '1px dashed var(--border-color)'
                    }}>
                      아직 이 법인에 소속된 고객이 없습니다. 고객 상세 화면에서 이 법인을 추가해 주세요.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '180px', overflowY: 'auto' }}>
                      {affiliatedCustomers.map((c) => (
                        <div
                          key={c._id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '0.5rem 0.7rem',
                            borderRadius: '6px',
                            background: 'var(--bg-main)',
                            border: '1px solid var(--border-color)',
                            fontSize: '0.82rem'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                            {c.isPrimary && <Star size={13} style={{ color: '#f59e0b', flexShrink: 0 }} fill="#f59e0b" />}
                            <span style={{ fontWeight: '600', color: 'var(--text-bright)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {c.name}
                            </span>
                            {c.role && (
                              <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', flexShrink: 0 }}>
                                ({c.role})
                              </span>
                            )}
                          </div>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', flexShrink: 0 }}>
                            {c.contactPhone || c.email || '-'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

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
