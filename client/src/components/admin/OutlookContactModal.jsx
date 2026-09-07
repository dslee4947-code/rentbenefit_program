import React, { useState, useEffect, useRef } from 'react';
import { useSaveShortcut } from './useSaveShortcut.js';
import {
  X,
  Save,
  Trash2,
  Phone,
  Mail,
  Building,
  MapPin,
  Globe,
  User,
  Briefcase,
  FileText,
  Tag,
  AlertTriangle,
  Building2,
  Search,
  Plus,
  Star
} from 'lucide-react';
import { formatBizNo } from '../../utils/format.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

function OutlookContactModal({ customer, windowId, initialPosition, zIndex, isTopWindow, onFocus, onClose, onSave, onDelete, showToast, currentUser }) {
  // customer는 항상 존재함이 보장된다 (부모는 customer가 있을 때만 이 컴포넌트를 마운트함).
  // React Hooks 규칙상 hook 호출 전에 조건부 early-return을 둘 수 없어 가드를 제거함.

  // 1. Initial State Definition
  const initialFormData = {
    surname: customer.surname || '',
    givenName: customer.givenName || '',
    name: customer.name || '',
    companyName: customer.companyName || '',
    department: customer.department || '',
    jobTitle: customer.jobTitle || '',
    displayName: customer.displayName || customer.contactName || customer.name || '',
    email: customer.email || '',
    mobilePhone: customer.mobilePhone || customer.contactPhone || '',
    businessPhone: customer.businessPhone || '',
    homePhone: customer.homePhone || '',
    faxNumber: customer.faxNumber || '',
    webPage: customer.webPage || '',
    postalCode: customer.postalCode || '',
    address: customer.address || customer.businessAddress || '',
    businessAddress: customer.businessAddress || '',
    homeAddress: customer.homeAddress || '',
    outlookCategory: customer.outlookCategory || '기본 연락처',
    bizNo: customer.bizNo || '',
    ceoName: customer.ceoName || '',
    notes: customer.notes || ''
  };

  const [formData, setFormData] = useState(initialFormData);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);

  // 2. Drag & Move Position State
  const [position, setPosition] = useState(initialPosition || { x: 100, y: 60 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const posStartRef = useRef({ x: 0, y: 0 });

  // 3. Detect Form Changes
  const handleChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    setIsDirty(true);
  };

  // 3-b. 소속 법인 섹션 상태 (저장 버튼과 무관하게 즉시 반영됨)
  const [companyAssociations, setCompanyAssociations] = useState([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [companySearchTerm, setCompanySearchTerm] = useState('');
  const [companySearchResults, setCompanySearchResults] = useState([]);
  const [companySearching, setCompanySearching] = useState(false);
  const [showAddCompanyPanel, setShowAddCompanyPanel] = useState(false);
  const [newAssocRole, setNewAssocRole] = useState('');
  const [newAssocIsPrimary, setNewAssocIsPrimary] = useState(false);
  const [showInlineCreateForm, setShowInlineCreateForm] = useState(false);
  const [inlineCompanyForm, setInlineCompanyForm] = useState({ name: '', bizType: '법인사업자', bizNo: '' });
  const [companyActionLoading, setCompanyActionLoading] = useState(false);

  const writeHeaders = {
    'Content-Type': 'application/json',
    'X-User-Role': currentUser?.role || 'viewer'
  };

  const fetchCompanyAssociations = async () => {
    try {
      setCompaniesLoading(true);
      const res = await fetch(`${API_HOST}/api/customers/${customer._id}`);
      if (!res.ok) throw new Error('소속 법인 정보를 불러오지 못했습니다.');
      const data = await res.json();
      setCompanyAssociations((data.companies || []).filter(a => a.companyId));
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setCompaniesLoading(false);
    }
  };

  useEffect(() => {
    fetchCompanyAssociations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer._id]);

  // 법인 검색 (디바운스)
  useEffect(() => {
    if (!companySearchTerm.trim()) {
      setCompanySearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setCompanySearching(true);
        const res = await fetch(`${API_HOST}/api/companies?search=${encodeURIComponent(companySearchTerm.trim())}`);
        const data = await res.json();
        setCompanySearchResults(Array.isArray(data) ? data : []);
      } catch {
        setCompanySearchResults([]);
      } finally {
        setCompanySearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [companySearchTerm]);

  const resetAddCompanyPanel = () => {
    setShowAddCompanyPanel(false);
    setCompanySearchTerm('');
    setCompanySearchResults([]);
    setNewAssocRole('');
    setNewAssocIsPrimary(false);
    setShowInlineCreateForm(false);
    setInlineCompanyForm({ name: '', bizType: '법인사업자', bizNo: '' });
  };

  const checkWritePermission = () => {
    if (currentUser?.role === 'viewer') {
      showToast?.('등록 및 수정 권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return false;
    }
    return true;
  };

  // 기존 법인을 검색해서 소속 추가
  const handleAddExistingCompany = async (companyId) => {
    if (!checkWritePermission()) return;
    try {
      setCompanyActionLoading(true);
      const res = await fetch(`${API_HOST}/api/customers/${customer._id}/companies`, {
        method: 'POST',
        headers: writeHeaders,
        body: JSON.stringify({ companyId, role: newAssocRole, isPrimary: newAssocIsPrimary })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || '법인 추가에 실패했습니다.');
      }
      const updated = await res.json();
      setCompanyAssociations((updated.companies || []).filter(a => a.companyId));
      showToast?.('소속 법인이 추가되었습니다.', 'success');
      resetAddCompanyPanel();
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setCompanyActionLoading(false);
    }
  };

  // 검색 결과에 원하는 법인이 없을 때: 그 자리에서 신규 법인을 만들고 바로 연결
  const handleCreateAndAddCompany = async () => {
    if (!checkWritePermission()) return;
    if (!inlineCompanyForm.name.trim()) {
      showToast?.('법인명은 필수입니다.', 'error');
      return;
    }
    try {
      setCompanyActionLoading(true);
      const createRes = await fetch(`${API_HOST}/api/companies`, {
        method: 'POST',
        headers: writeHeaders,
        body: JSON.stringify({
          name: inlineCompanyForm.name.trim(),
          bizType: inlineCompanyForm.bizType,
          bizNo: inlineCompanyForm.bizNo
        })
      });
      if (!createRes.ok) {
        const errData = await createRes.json();
        throw new Error(errData.message || '법인 등록에 실패했습니다.');
      }
      const createdCompany = await createRes.json();

      const linkRes = await fetch(`${API_HOST}/api/customers/${customer._id}/companies`, {
        method: 'POST',
        headers: writeHeaders,
        body: JSON.stringify({ companyId: createdCompany._id, role: newAssocRole, isPrimary: newAssocIsPrimary })
      });
      if (!linkRes.ok) {
        const errData = await linkRes.json();
        throw new Error(errData.message || '법인 연결에 실패했습니다.');
      }
      const updated = await linkRes.json();
      setCompanyAssociations((updated.companies || []).filter(a => a.companyId));
      showToast?.(`신규 법인 "${createdCompany.name}"을(를) 등록하고 연결했습니다.`, 'success');
      resetAddCompanyPanel();
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setCompanyActionLoading(false);
    }
  };

  const handleRemoveCompany = async (companyId, companyName) => {
    if (!checkWritePermission()) return;
    if (!window.confirm(`'${companyName}' 소속을 해제하시겠습니까?`)) return;
    try {
      setCompanyActionLoading(true);
      const res = await fetch(`${API_HOST}/api/customers/${customer._id}/companies/${companyId}`, {
        method: 'DELETE',
        headers: { 'X-User-Role': currentUser?.role || 'viewer' }
      });
      if (!res.ok) throw new Error('소속 해제에 실패했습니다.');
      const updated = await res.json();
      setCompanyAssociations((updated.companies || []).filter(a => a.companyId));
      showToast?.('소속이 해제되었습니다.', 'success');
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setCompanyActionLoading(false);
    }
  };

  // 이미 연결된 법인을 주 소속으로 재지정 (한 고객당 한 곳만 유지되도록 서버에서 나머지 해제)
  const handleSetPrimary = async (assoc) => {
    if (!checkWritePermission()) return;
    try {
      setCompanyActionLoading(true);
      const res = await fetch(`${API_HOST}/api/customers/${customer._id}/companies`, {
        method: 'POST',
        headers: writeHeaders,
        body: JSON.stringify({ companyId: assoc.companyId._id, role: assoc.role, isPrimary: true })
      });
      if (!res.ok) throw new Error('주 소속 지정에 실패했습니다.');
      const updated = await res.json();
      setCompanyAssociations((updated.companies || []).filter(a => a.companyId));
      showToast?.('주 소속으로 지정되었습니다.', 'success');
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setCompanyActionLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await onSave?.(customer._id, formData);
      setIsDirty(false);
      setShowConfirmClose(false);
      onClose();
    } catch (err) {
      showToast?.(err.message || '저장 중 오류가 발생했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // 4. Save Handler
  // 카드가 열려 있는 동안 Ctrl+S로 저장한다
  useSaveShortcut(!saving, () => handleSave());

  // 5. Attempt Close Handler
  const attemptClose = () => {
    if (isDirty) {
      setShowConfirmClose(true);
    } else {
      onClose();
    }
  };

  // 6. Keyboard Short-cuts (ESC: Close top window only, Ctrl+S: Save and close top window)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Execute shortcuts only for the currently active TOP window
      if (!isTopWindow) return;

      // Ctrl + S or Cmd + S (Save & Close)
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
        return;
      }

      // ESC (Close current top window)
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (showConfirmClose) {
          setShowConfirmClose(false);
        } else {
          attemptClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTopWindow, isDirty, showConfirmClose, formData]);

  // 7. Drag Window Handlers
  const handleMouseDownHeader = (e) => {
    onFocus?.();
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    posStartRef.current = { ...position };
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPosition({
        x: Math.max(0, posStartRef.current.x + dx),
        y: Math.max(0, posStartRef.current.y + dy)
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div
      onClick={onFocus}
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: '940px',
        maxWidth: '95vw',
        height: '680px',
        maxHeight: '90vh',
        zIndex: zIndex || 1000,
        background: '#f4f5f8',
        borderRadius: '8px',
        border: isTopWindow ? '2px solid #0078d4' : '1px solid #a0a5b5',
        boxShadow: isDragging 
          ? '0 25px 70px rgba(0, 0, 0, 0.5)' 
          : isTopWindow
            ? '0 16px 50px rgba(0, 120, 212, 0.35)'
            : '0 8px 30px rgba(0, 0, 0, 0.25)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        color: '#222222',
        fontSize: '0.88rem',
        fontFamily: "'Segoe UI', 'Malgun Gothic', sans-serif",
        userSelect: isDragging ? 'none' : 'auto',
        transition: isDragging ? 'none' : 'border-color 0.2s, box-shadow 0.2s'
      }}
    >
      {/* 1. 아웃룩 카테고리 컬러 드래그 헤더 바 */}
      <div
        onMouseDown={handleMouseDownHeader}
        style={{
          background: isTopWindow 
            ? 'linear-gradient(90deg, #d81b60 0%, #ad1457 100%)'
            : 'linear-gradient(90deg, #78909c 0%, #455a64 100%)',
          color: '#ffffff',
          padding: '0.45rem 0.9rem',
          display: 'flex',
          justify: 'space-between',
          alignItems: 'center',
          fontWeight: '700',
          fontSize: '0.85rem',
          cursor: isDragging ? 'grabbing' : 'grab',
          letterSpacing: '0.3px',
          transition: 'background 0.2s'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', pointerEvents: 'none' }}>
          <Tag size={15} />
          <span>[{formData.outlookCategory || '기본 연락처'}] - {formData.displayName || formData.name}</span>
          {isTopWindow && (
            <span style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.25)', padding: '0.1rem 0.4rem', borderRadius: '10px' }}>
              ● 활성 창 (Ctrl+S / ESC)
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.73rem', opacity: 0.85, pointerEvents: 'none' }}>
            드래그 이동
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); attemptClose(); }}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#ffffff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              padding: '0.1rem'
            }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* 2. Office Ribbon 스타일 상단 툴바 */}
      <div style={{
        background: '#ffffff',
        borderBottom: '1px solid #dcdfe6',
        padding: '0.5rem 0.9rem',
        display: 'flex',
        alignItems: 'center',
        justify: 'space-between',
        gap: '0.5rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            onClick={handleSave}
            disabled={saving}
            title="단축키: Ctrl + S"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.45rem 0.9rem',
              background: isDirty ? '#107c41' : '#0078d4',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '0.82rem',
              transition: 'background 0.2s'
            }}
          >
            <Save size={15} />
            <span>{saving ? '저장 중...' : isDirty ? '저장 후 닫기 (Ctrl+S)' : '저장 후 닫기 (Ctrl+S)'}</span>
          </button>

          <button
            onClick={() => {
              if (window.confirm(`'${formData.displayName || formData.name}' 연락처를 삭제하시겠습니까?`)) {
                onDelete?.(customer._id, formData.displayName || formData.name);
                onClose();
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.45rem 0.8rem',
              background: '#ffffff',
              color: '#d32f2f',
              border: '1px solid #ffcdd2',
              borderRadius: '4px',
              fontWeight: '600',
              cursor: 'pointer',
              fontSize: '0.82rem'
            }}
          >
            <Trash2 size={15} />
            <span>삭제</span>
          </button>

          <div style={{ height: '18px', width: '1px', background: '#dcdfe6', margin: '0 0.2rem' }} />

          {formData.mobilePhone && (
            <a
              href={`tel:${formData.mobilePhone}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                padding: '0.4rem 0.75rem',
                background: '#f0f4f9',
                color: '#107c41',
                border: '1px solid #c8e6c9',
                borderRadius: '4px',
                textDecoration: 'none',
                fontSize: '0.82rem',
                fontWeight: '600'
              }}
            >
              <Phone size={14} />
              <span>전화</span>
            </a>
          )}

          {formData.email && (
            <a
              href={`mailto:${formData.email}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
                padding: '0.4rem 0.75rem',
                background: '#f0f4f9',
                color: '#0078d4',
                border: '1px solid #bbdefb',
                borderRadius: '4px',
                textDecoration: 'none',
                fontSize: '0.82rem',
                fontWeight: '600'
              }}
            >
              <Mail size={14} />
              <span>메일</span>
            </a>
          )}
        </div>

        {isDirty && (
          <span style={{ fontSize: '0.78rem', color: '#e6a23c', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            ● 수정됨 (Ctrl+S 저장)
          </span>
        )}
      </div>

      {/* 3. 모달 본문 (2컬럼 레이아웃) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1.2fr 1fr',
        gap: '0.8rem',
        padding: '0.9rem',
        overflowY: 'auto',
        flex: 1
      }}>
        {/* 좌측: Outlook 연락처 상세 입력/조회 폼 */}
        <div style={{
          background: '#ffffff',
          padding: '1rem',
          borderRadius: '6px',
          border: '1px solid #e4e7ed',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}>
          {/* 성 / 이름 / 회사 / 부서 / 직급 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div>
                <label style={{ fontSize: '0.73rem', color: '#606266', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>성 (G)</label>
                <input
                  type="text"
                  value={formData.surname}
                  onChange={e => handleChange('surname', e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.73rem', color: '#606266', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>이름 (M)</label>
                <input
                  type="text"
                  value={formData.givenName}
                  onChange={e => handleChange('givenName', e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.73rem', color: '#606266', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>차량정보 (P)</label>
              <input
                type="text"
                value={formData.companyName}
                onChange={e => handleChange('companyName', e.target.value)}
                style={inputStyle}
                placeholder="아웃룩 '회사(P)' 필드 - 차량 계약 정보 요약이 들어가는 자리입니다"
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div>
                <label style={{ fontSize: '0.73rem', color: '#606266', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>부서 (A)</label>
                <input
                  type="text"
                  value={formData.department}
                  onChange={e => handleChange('department', e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.73rem', color: '#606266', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>직급 (T)</label>
                <input
                  type="text"
                  value={formData.jobTitle}
                  onChange={e => handleChange('jobTitle', e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.73rem', color: '#606266', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>표시 방법 (E)</label>
              <input
                type="text"
                value={formData.displayName}
                onChange={e => handleChange('displayName', e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ height: '1px', background: '#ebeef5' }} />

          {/* 인터넷 (전자 메일, 표시 이름, 웹 페이지) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontWeight: '700', fontSize: '0.78rem', color: '#0078d4', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Mail size={13} />
              <span>인터넷</span>
            </div>

            <div>
              <label style={{ fontSize: '0.73rem', color: '#606266', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>전자 메일</label>
              <input
                type="email"
                value={formData.email}
                onChange={e => handleChange('email', e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.73rem', color: '#606266', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>웹 페이지 (W)</label>
              <input
                type="text"
                value={formData.webPage}
                onChange={e => handleChange('webPage', e.target.value)}
                style={inputStyle}
                placeholder="https://"
              />
            </div>
          </div>

          <div style={{ height: '1px', background: '#ebeef5' }} />

          {/* 전화 번호 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontWeight: '700', fontSize: '0.78rem', color: '#107c41', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <Phone size={13} />
              <span>전화 번호</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div>
                <label style={{ fontSize: '0.73rem', color: '#606266', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>휴대폰...</label>
                <input
                  type="text"
                  value={formData.mobilePhone}
                  onChange={e => handleChange('mobilePhone', e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.73rem', color: '#606266', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>근무처...</label>
                <input
                  type="text"
                  value={formData.businessPhone}
                  onChange={e => handleChange('businessPhone', e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div>
                <label style={{ fontSize: '0.73rem', color: '#606266', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>집...</label>
                <input
                  type="text"
                  value={formData.homePhone}
                  onChange={e => handleChange('homePhone', e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.73rem', color: '#606266', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>근무처 팩스...</label>
                <input
                  type="text"
                  value={formData.faxNumber}
                  onChange={e => handleChange('faxNumber', e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>
          </div>

          <div style={{ height: '1px', background: '#ebeef5' }} />

          {/* 주소 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ fontWeight: '700', fontSize: '0.78rem', color: '#d81b60', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <MapPin size={13} />
              <span>주소 정보</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '0.5rem' }}>
              <div>
                <label style={{ fontSize: '0.73rem', color: '#606266', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>우편 번호 (U)</label>
                <input
                  type="text"
                  value={formData.postalCode}
                  onChange={e => handleChange('postalCode', e.target.value)}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.73rem', color: '#606266', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>대표 주소 (B)</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={e => handleChange('address', e.target.value)}
                  style={inputStyle}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '0.73rem', color: '#606266', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>근무처 주소 (Business Address)</label>
              <input
                type="text"
                value={formData.businessAddress}
                onChange={e => handleChange('businessAddress', e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={{ fontSize: '0.73rem', color: '#606266', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>집 주소 (Home Address)</label>
              <input
                type="text"
                value={formData.homeAddress}
                onChange={e => handleChange('homeAddress', e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>
        </div>

        {/* 우측: Outlook 비즈니스 명함(Business Card) 뷰어 + 메모 영역 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          {/* 아웃룩 비즈니스 명함 카드 */}
          <div style={{
            background: '#ffffff',
            borderRadius: '6px',
            border: '1px solid #dcdfe6',
            boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
            overflow: 'hidden'
          }}>
            <div style={{
              background: '#fafafa',
              borderBottom: '1px solid #ebeef5',
              padding: '0.35rem 0.7rem',
              fontSize: '0.7rem',
              color: '#909399',
              fontWeight: '600',
              display: 'flex',
              justify: 'space-between'
            }}>
              <span>OUTLOOK BUSINESS CARD</span>
              <span>{customer.source === 'outlook' ? '📧 Outlook Linked' : '👤 Direct Manual'}</span>
            </div>

            <div style={{
              padding: '1rem',
              background: 'linear-gradient(135deg, #ffffff 0%, #f8faff 100%)',
              display: 'grid',
              gridTemplateColumns: '55px 1fr',
              gap: '0.8rem',
              alignItems: 'flex-start'
            }}>
              <div style={{
                width: '55px',
                height: '55px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #0078d4 0%, #004578 100%)',
                color: '#ffffff',
                display: 'flex',
                justify: 'center',
                alignItems: 'center',
                fontSize: '1.3rem',
                fontWeight: '800',
                boxShadow: '0 3px 8px rgba(0,120,212,0.3)',
                border: '2px solid #ffffff'
              }}>
                {(formData.displayName || formData.name || 'C').charAt(0)}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: '800', color: '#0078d4' }}>
                  {formData.companyName || '차량정보 없음'}
                </div>

                <div style={{ fontSize: '0.98rem', fontWeight: '800', color: '#1a1a1a', display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
                  <span>{formData.displayName || formData.name}</span>
                  {formData.jobTitle && (
                    <span style={{ fontSize: '0.75rem', color: '#606266', fontWeight: '600' }}>
                      {formData.jobTitle}
                    </span>
                  )}
                </div>

                {formData.department && (
                  <div style={{ fontSize: '0.72rem', color: '#909399' }}>
                    {formData.department}
                  </div>
                )}

                <div style={{ height: '1px', background: '#e4e7ed', margin: '0.2rem 0' }} />

                {formData.mobilePhone && (
                  <div style={{ fontSize: '0.75rem', color: '#2c3e50', display: 'flex', alignItems: 'center', gap: '0.3rem', fontWeight: '600' }}>
                    <Phone size={12} style={{ color: '#107c41' }} />
                    <span>{formData.mobilePhone}</span>
                  </div>
                )}

                {formData.email && (
                  <div style={{ fontSize: '0.75rem', color: '#0078d4', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <Mail size={12} />
                    <span>{formData.email}</span>
                  </div>
                )}

                {formData.businessAddress && (
                  <div style={{ fontSize: '0.72rem', color: '#606266', display: 'flex', alignItems: 'flex-start', gap: '0.3rem', marginTop: '0.1rem' }}>
                    <MapPin size={12} style={{ color: '#0078d4', flexShrink: 0, marginTop: '2px' }} />
                    <span><strong>근무처:</strong> {formData.businessAddress}</span>
                  </div>
                )}
                {formData.homeAddress && (
                  <div style={{ fontSize: '0.72rem', color: '#606266', display: 'flex', alignItems: 'flex-start', gap: '0.3rem', marginTop: '0.1rem' }}>
                    <MapPin size={12} style={{ color: '#d81b60', flexShrink: 0, marginTop: '2px' }} />
                    <span><strong>집:</strong> {formData.homeAddress}</span>
                  </div>
                )}
                {!formData.businessAddress && !formData.homeAddress && formData.address && (
                  <div style={{ fontSize: '0.72rem', color: '#606266', display: 'flex', alignItems: 'flex-start', gap: '0.3rem', marginTop: '0.1rem' }}>
                    <MapPin size={12} style={{ color: '#78909c', flexShrink: 0, marginTop: '2px' }} />
                    <span>{formData.address}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 메모 노트 영역 */}
          <div style={{
            background: '#ffffff',
            borderRadius: '6px',
            border: '1px solid #dcdfe6',
            padding: '0.8rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4rem',
            flex: 1
          }}>
            <div style={{ fontWeight: '700', fontSize: '0.78rem', color: '#303133', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <FileText size={14} style={{ color: '#e6a23c' }} />
              <span>메모 및 관리 노트</span>
            </div>

            <textarea
              value={formData.notes}
              onChange={e => handleChange('notes', e.target.value)}
              placeholder="고객 메모를 입력하세요..."
              style={{
                width: '100%',
                height: '140px',
                padding: '0.6rem',
                borderRadius: '4px',
                border: '1px solid #dcdfe6',
                fontSize: '0.8rem',
                resize: 'vertical',
                fontFamily: 'inherit',
                color: '#303133',
                lineHeight: '1.4'
              }}
            />
          </div>
        </div>

        {/* 소속 법인 섹션 (2컬럼 전체 폭 사용) */}
        <div style={{
          gridColumn: '1 / -1',
          background: '#ffffff',
          borderRadius: '6px',
          border: '1px solid #e4e7ed',
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.7rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: '700', fontSize: '0.85rem', color: '#303133', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Building2 size={14} style={{ color: 'var(--primary, #367CFF)' }} />
              <span>소속 법인{companyAssociations.length > 0 && ` (${companyAssociations.length}곳)`}</span>
            </div>
            {!showAddCompanyPanel && (
              <button
                type="button"
                onClick={() => setShowAddCompanyPanel(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.3rem',
                  padding: '0.35rem 0.7rem', borderRadius: '4px', border: '1px solid #bbdefb',
                  background: '#f0f7ff', color: '#0078d4', fontWeight: '600', fontSize: '0.78rem', cursor: 'pointer'
                }}
              >
                <Plus size={13} />
                <span>법인 추가</span>
              </button>
            )}
          </div>

          {/* 연결된 법인 목록 */}
          {companiesLoading ? (
            <div style={{ padding: '0.8rem', textAlign: 'center', color: '#909399', fontSize: '0.8rem' }}>불러오는 중...</div>
          ) : companyAssociations.length === 0 ? (
            <div style={{ padding: '0.8rem', textAlign: 'center', color: '#909399', fontSize: '0.8rem', background: '#fafafa', borderRadius: '4px', border: '1px dashed #dcdfe6' }}>
              소속된 법인이 없습니다.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {companyAssociations.map((assoc) => (
                <div
                  key={assoc._id || assoc.companyId._id}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.5rem 0.7rem', borderRadius: '4px', background: '#fafbfc', border: '1px solid #e4e7ed', fontSize: '0.8rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                    <button
                      type="button"
                      onClick={() => !assoc.isPrimary && handleSetPrimary(assoc)}
                      title={assoc.isPrimary ? '주 소속' : '주 소속으로 지정'}
                      disabled={companyActionLoading}
                      style={{ border: 'none', background: 'transparent', cursor: assoc.isPrimary ? 'default' : 'pointer', padding: 0, display: 'flex' }}
                    >
                      <Star size={14} style={{ color: '#f59e0b' }} fill={assoc.isPrimary ? '#f59e0b' : 'none'} />
                    </button>
                    <span style={{ fontWeight: '700', color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {assoc.companyId.name}
                    </span>
                    {assoc.companyId.bizType && (
                      <span style={{ fontSize: '0.7rem', color: assoc.companyId.bizType === '개인사업자' ? '#f59e0b' : '#0078d4', background: assoc.companyId.bizType === '개인사업자' ? '#fff7e6' : '#f0f7ff', padding: '0.1rem 0.4rem', borderRadius: '10px', flexShrink: 0 }}>
                        {assoc.companyId.bizType}
                      </span>
                    )}
                    {assoc.role && <span style={{ color: '#606266', fontSize: '0.76rem', flexShrink: 0 }}>({assoc.role})</span>}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveCompany(assoc.companyId._id, assoc.companyId.name)}
                    disabled={companyActionLoading}
                    title="소속 해제"
                    style={{ border: 'none', background: 'transparent', color: '#f56c6c', cursor: 'pointer', padding: '0.2rem', flexShrink: 0 }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 법인 추가 패널: 검색 -> 선택 / 검색 결과 없으면 그 자리에서 신규 등록 */}
          {showAddCompanyPanel && (
            <div style={{ borderTop: '1px solid #ebeef5', paddingTop: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Search size={13} style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', color: '#909399' }} />
                  <input
                    type="text"
                    autoFocus
                    placeholder="법인명 또는 사업자번호 검색"
                    value={companySearchTerm}
                    onChange={(e) => { setCompanySearchTerm(e.target.value); setShowInlineCreateForm(false); }}
                    style={{ ...inputStyle, paddingLeft: '1.8rem' }}
                  />
                </div>
                <input
                  type="text"
                  placeholder="직책 (선택)"
                  value={newAssocRole}
                  onChange={(e) => setNewAssocRole(e.target.value)}
                  style={{ ...inputStyle, width: '110px' }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.76rem', color: '#606266', whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={newAssocIsPrimary} onChange={(e) => setNewAssocIsPrimary(e.target.checked)} />
                  주 소속
                </label>
                <button
                  type="button"
                  onClick={resetAddCompanyPanel}
                  style={{ border: 'none', background: 'transparent', color: '#909399', cursor: 'pointer', padding: '0.2rem' }}
                >
                  <X size={16} />
                </button>
              </div>

              {companySearchTerm.trim() && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '140px', overflowY: 'auto' }}>
                  {companySearching ? (
                    <div style={{ padding: '0.5rem', color: '#909399', fontSize: '0.78rem' }}>검색 중...</div>
                  ) : companySearchResults.length > 0 ? (
                    companySearchResults.map((co) => (
                      <button
                        type="button"
                        key={co._id}
                        onClick={() => handleAddExistingCompany(co._id)}
                        disabled={companyActionLoading}
                        style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
                          padding: '0.5rem 0.7rem', borderRadius: '4px', border: '1px solid #e4e7ed', background: '#ffffff',
                          cursor: 'pointer', fontSize: '0.8rem', textAlign: 'left'
                        }}
                      >
                        <span style={{ fontWeight: '600', color: '#1a1a1a' }}>{co.name}</span>
                        <span style={{ color: '#909399', fontSize: '0.75rem' }}>{co.bizNo || co.bizType || ''}</span>
                      </button>
                    ))
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      <div style={{ padding: '0.4rem 0.1rem', color: '#909399', fontSize: '0.78rem' }}>
                        "{companySearchTerm}" 검색 결과가 없습니다.
                      </div>
                      {!showInlineCreateForm ? (
                        <button
                          type="button"
                          onClick={() => { setShowInlineCreateForm(true); setInlineCompanyForm(prev => ({ ...prev, name: companySearchTerm.trim() })); }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '0.3rem', alignSelf: 'flex-start',
                            padding: '0.4rem 0.7rem', borderRadius: '4px', border: '1px solid #c8e6c9', background: '#f0fdf4',
                            color: '#107c41', fontWeight: '600', fontSize: '0.78rem', cursor: 'pointer'
                          }}
                        >
                          <Plus size={13} />
                          <span>"{companySearchTerm}" 신규 법인으로 등록</span>
                        </button>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0.6rem', background: '#f0fdf4', borderRadius: '4px', border: '1px solid #c8e6c9' }}>
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <input
                              type="text"
                              placeholder="법인명 *"
                              value={inlineCompanyForm.name}
                              onChange={(e) => setInlineCompanyForm({ ...inlineCompanyForm, name: e.target.value })}
                              style={{ ...inputStyle, flex: 1.4 }}
                            />
                            <select
                              value={inlineCompanyForm.bizType}
                              onChange={(e) => setInlineCompanyForm({ ...inlineCompanyForm, bizType: e.target.value })}
                              style={{ ...inputStyle, flex: 1, cursor: 'pointer' }}
                            >
                              <option value="법인사업자">법인사업자</option>
                              <option value="개인사업자">개인사업자</option>
                            </select>
                          </div>
                          <input
                            type="text"
                            placeholder="사업자번호 (선택, 000-00-00000)"
                            value={inlineCompanyForm.bizNo}
                            onChange={(e) => setInlineCompanyForm({ ...inlineCompanyForm, bizNo: formatBizNo(e.target.value) })}
                            maxLength={12}
                            style={inputStyle}
                          />
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button
                              type="button"
                              onClick={handleCreateAndAddCompany}
                              disabled={companyActionLoading}
                              style={{
                                padding: '0.4rem 0.8rem', borderRadius: '4px', border: 'none', background: '#107c41',
                                color: '#fff', fontWeight: '600', fontSize: '0.78rem', cursor: 'pointer'
                              }}
                            >
                              {companyActionLoading ? '등록 중...' : '등록하고 연결'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowInlineCreateForm(false)}
                              style={{ padding: '0.4rem 0.8rem', borderRadius: '4px', border: '1px solid #dcdfe6', background: '#fff', color: '#606266', fontWeight: '600', fontSize: '0.78rem', cursor: 'pointer' }}
                            >
                              취소
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 4. 내용 변경 후 닫기 시도 시 "변경 내용을 저장할까요?" 확인 모달 */}
      {showConfirmClose && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          justify: 'center',
          alignItems: 'center',
          zIndex: 99999
        }}>
          <div style={{
            background: '#ffffff',
            width: '420px',
            padding: '1.5rem',
            borderRadius: '8px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
            border: '1px solid #dcdfe6',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            animation: 'fadeIn 0.15s ease-out'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                background: '#fef0f0',
                color: '#f56c6c',
                display: 'flex',
                justify: 'center',
                alignItems: 'center'
              }}>
                <AlertTriangle size={22} />
              </div>
              <div>
                <h4 style={{ fontSize: '1rem', fontWeight: '700', color: '#303133' }}>변경 내용을 저장하시겠습니까?</h4>
                <p style={{ fontSize: '0.82rem', color: '#606266', marginTop: '0.2rem' }}>
                  수정된 내용이 있습니다. 저장하지 않고 닫으면 변경사항이 사라집니다.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
              <button
                onClick={handleSave}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#0078d4',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '4px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  fontSize: '0.85rem'
                }}
              >
                저장 (Save)
              </button>
              <button
                onClick={() => {
                  setShowConfirmClose(false);
                  onClose();
                }}
                style={{
                  padding: '0.5rem 1rem',
                  background: '#f4f4f5',
                  color: '#606266',
                  border: '1px solid #dcdfe6',
                  borderRadius: '4px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  fontSize: '0.85rem'
                }}
              >
                저장 안 함
              </button>
              <button
                onClick={() => setShowConfirmClose(false)}
                style={{
                  padding: '0.5rem 0.8rem',
                  background: 'transparent',
                  color: '#909399',
                  border: 'none',
                  fontWeight: '500',
                  cursor: 'pointer',
                  fontSize: '0.85rem'
                }}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '0.4rem 0.55rem',
  borderRadius: '4px',
  border: '1px solid #dcdfe6',
  background: '#ffffff',
  color: '#303133',
  fontSize: '0.81rem',
  outline: 'none',
  transition: 'border-color 0.2s'
};

export default OutlookContactModal;
