import { useState, useEffect } from 'react';
import { MessageCircleQuestion, Plus, X, Save, CheckCircle2, Trash2, Search } from 'lucide-react';
import { formatCustomerName } from '../../utils/format.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

function PendingInquiriesView({ showToast, currentUser }) {
  const [inquiries, setInquiries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false); // false: 대기중만, true: 전체

  const [showModal, setShowModal] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerSearchResults, setCustomerSearchResults] = useState([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [content, setContent] = useState('');
  const [assignee, setAssignee] = useState(currentUser?.name || '');
  const [saving, setSaving] = useState(false);

  const fetchInquiries = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (!showAll) params.set('status', '대기');
      const res = await fetch(`${API_HOST}/api/inquiries?${params}`);
      if (res.ok) {
        const data = await res.json();
        setInquiries(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error(err);
      showToast?.('문의 목록을 불러오지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInquiries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll]);

  // 고객 검색 (성/이름/차량정보/연락처/사업자번호)
  useEffect(() => {
    if (!customerSearchQuery.trim()) {
      setCustomerSearchResults([]);
      return;
    }
    const delay = setTimeout(async () => {
      try {
        const res = await fetch(`${API_HOST}/api/customers?search=${encodeURIComponent(customerSearchQuery.trim())}&limit=20`);
        if (res.ok) {
          const data = await res.json();
          setCustomerSearchResults(data.customers || data || []);
        }
      } catch (err) {
        console.error('Customer search failed', err);
      }
    }, 250);
    return () => clearTimeout(delay);
  }, [customerSearchQuery]);

  const openAddModal = () => {
    setSelectedCustomer(null);
    setCustomerSearchQuery('');
    setContent('');
    setAssignee(currentUser?.name || '');
    setShowModal(true);
  };

  const handleCreateInquiry = async (e) => {
    e.preventDefault();
    if (currentUser?.role === 'viewer') {
      showToast?.('등록 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (!selectedCustomer) {
      showToast?.('고객을 선택해주세요.', 'error');
      return;
    }
    if (!content.trim()) {
      showToast?.('문의 내용을 입력해주세요.', 'error');
      return;
    }

    try {
      setSaving(true);
      const res = await fetch(`${API_HOST}/api/inquiries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
        body: JSON.stringify({
          customerId: selectedCustomer._id,
          content: content.trim(),
          assignee,
          createdBy: currentUser?.name || ''
        })
      });
      if (res.ok) {
        showToast?.('문의가 등록되었습니다.', 'success');
        setShowModal(false);
        fetchInquiries();
      } else {
        const err = await res.json();
        showToast?.(err.message || '등록에 실패했습니다.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleResolve = async (inquiry) => {
    if (currentUser?.role === 'viewer') {
      showToast?.('수정 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    try {
      const res = await fetch(`${API_HOST}/api/inquiries/${inquiry._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
        body: JSON.stringify({ status: '처리완료', resolvedBy: currentUser?.name || '' })
      });
      if (res.ok) {
        showToast?.('처리완료 처리되었습니다.', 'success');
        setInquiries(prev => showAll
          ? prev.map(i => i._id === inquiry._id ? { ...i, status: '처리완료' } : i)
          : prev.filter(i => i._id !== inquiry._id));
      } else {
        showToast?.('처리에 실패했습니다.', 'error');
      }
    } catch (err) {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  const handleDelete = async (id) => {
    if (currentUser?.role === 'viewer') {
      showToast?.('삭제 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (!window.confirm('이 문의를 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(`${API_HOST}/api/inquiries/${id}`, {
        method: 'DELETE',
        headers: { 'X-User-Role': currentUser?.role || 'viewer' }
      });
      if (res.ok) {
        showToast?.('삭제되었습니다.', 'success');
        setInquiries(prev => prev.filter(i => i._id !== id));
      } else {
        showToast?.('삭제에 실패했습니다.', 'error');
      }
    } catch (err) {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  const inputStyle = { width: '100%', padding: '0.55rem 0.7rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-bright)', fontSize: '0.85rem' };
  const labelStyle = { fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ background: '#fff', padding: '1.2rem', borderRadius: '10px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <MessageCircleQuestion size={22} style={{ color: 'var(--primary)' }} />
          <div>
            <div style={{ fontWeight: '800', fontSize: '1.1rem', color: 'var(--text-bright)' }}>
              {showAll ? '전체 문의' : '미처리 문의'} {inquiries.length}건
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>등록된 고객이 남긴 문의 중 아직 처리되지 않은 건을 관리합니다.</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            처리완료 포함 전체 보기
          </label>
          <button
            type="button"
            onClick={openAddModal}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.6rem 1.1rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer' }}
          >
            <Plus size={16} /> 새 문의 등록
          </button>
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: '10px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-bright)', fontWeight: '700' }}>
              <th style={{ padding: '0.8rem' }}>고객명</th>
              <th style={{ padding: '0.8rem' }}>문의 내용</th>
              <th style={{ padding: '0.8rem' }}>담당자</th>
              <th style={{ padding: '0.8rem' }}>등록일</th>
              <th style={{ padding: '0.8rem' }}>상태</th>
              <th style={{ padding: '0.8rem', width: '120px' }}>관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" style={{ textAlign: 'center', padding: '2rem' }}>로딩 중...</td></tr>
            ) : inquiries.length === 0 ? (
              <tr><td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                <CheckCircle2 size={18} style={{ verticalAlign: 'middle', marginRight: '0.3rem', color: '#52c41a' }} />
                미처리 문의가 없습니다.
              </td></tr>
            ) : (
              inquiries.map(i => (
                <tr key={i._id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '0.8rem', fontWeight: '700' }}>{formatCustomerName(i.customer)}</td>
                  <td style={{ padding: '0.8rem', maxWidth: '360px' }}>{i.content}</td>
                  <td style={{ padding: '0.8rem' }}>{i.assignee || '-'}</td>
                  <td style={{ padding: '0.8rem' }}>{new Date(i.createdAt).toLocaleDateString()}</td>
                  <td style={{ padding: '0.8rem' }}>
                    <span style={{
                      background: i.status === '처리완료' ? '#f6ffed' : '#fff7e6',
                      color: i.status === '처리완료' ? '#52c41a' : '#fa8c16',
                      padding: '0.2rem 0.6rem', borderRadius: '20px', fontSize: '0.75rem', fontWeight: '700'
                    }}>
                      {i.status}
                    </span>
                  </td>
                  <td style={{ padding: '0.8rem' }}>
                    <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
                      {i.status !== '처리완료' && (
                        <button onClick={() => handleResolve(i)} title="처리완료" style={{ border: 'none', background: 'none', color: '#52c41a', cursor: 'pointer' }}>
                          <CheckCircle2 size={16} />
                        </button>
                      )}
                      <button onClick={() => handleDelete(i._id)} title="삭제" style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}>
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

      {showModal && (
        <div onClick={() => setShowModal(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: '12px', width: '90%', maxWidth: '480px', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.2rem 1.5rem', borderBottom: '1px solid var(--border-color)' }}>
              <h3 style={{ margin: 0, fontWeight: '800', fontSize: '1.05rem' }}>새 문의 등록</h3>
              <button type="button" onClick={() => setShowModal(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleCreateInquiry} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ position: 'relative' }}>
                <label style={labelStyle}>고객 검색 *</label>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    type="text"
                    value={customerSearchQuery}
                    onChange={(e) => { setCustomerSearchQuery(e.target.value); setIsDropdownOpen(true); setSelectedCustomer(null); }}
                    onFocus={() => setIsDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
                    placeholder="성/이름, 휴대전화, 사업자번호로 검색..."
                    style={{ ...inputStyle, paddingLeft: '2.2rem' }}
                  />
                </div>
                {isDropdownOpen && customerSearchQuery.trim() && (
                  <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: '#fff', border: '1px solid var(--border-color)', borderRadius: '6px', boxShadow: 'var(--shadow-premium)', listStyle: 'none', margin: '4px 0 0 0', padding: 0, maxHeight: '220px', overflowY: 'auto' }}>
                    {customerSearchResults.length === 0 ? (
                      <li style={{ padding: '0.6rem 0.8rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>검색 결과가 없습니다.</li>
                    ) : (
                      customerSearchResults.map(c => (
                        <li
                          key={c._id}
                          onClick={() => { setSelectedCustomer(c); setCustomerSearchQuery(formatCustomerName(c)); setIsDropdownOpen(false); }}
                          style={{ padding: '0.6rem 0.8rem', cursor: 'pointer', fontSize: '0.82rem', borderBottom: '1px solid var(--bg-main)' }}
                          onMouseDown={(e) => e.preventDefault()}
                        >
                          <div style={{ fontWeight: '700' }}>{formatCustomerName(c)}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{c.mobilePhone || c.contactPhone || '연락처 없음'}</div>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>

              <div>
                <label style={labelStyle}>문의 내용 *</label>
                <textarea required value={content} onChange={(e) => setContent(e.target.value)} style={{ ...inputStyle, minHeight: '100px', resize: 'vertical' }} />
              </div>

              <div>
                <label style={labelStyle}>담당자</label>
                <input value={assignee} onChange={(e) => setAssignee(e.target.value)} style={inputStyle} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.8rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-color)' }}>
                <button type="button" onClick={() => setShowModal(false)} style={{ background: '#fff', border: '1px solid var(--border-color)', padding: '0.6rem 1.4rem', borderRadius: '8px', fontWeight: '600', cursor: 'pointer', fontSize: '0.85rem' }}>취소</button>
                <button type="submit" disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.6rem 1.4rem', borderRadius: '8px', fontWeight: '700', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '0.85rem', opacity: saving ? 0.7 : 1 }}>
                  <Save size={16} /> {saving ? '등록 중...' : '등록'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default PendingInquiriesView;
