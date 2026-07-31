import React, { useState, useEffect, useRef } from 'react';
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
  AlertTriangle
} from 'lucide-react';

function OutlookContactModal({ customer, windowId, initialPosition, zIndex, isTopWindow, onFocus, onClose, onSave, onDelete, showToast }) {
  if (!customer) return null;

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

  // 4. Save Handler
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
              <label style={{ fontSize: '0.73rem', color: '#606266', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>회사 (P)</label>
              <input
                type="text"
                value={formData.companyName || formData.name}
                onChange={e => {
                  handleChange('companyName', e.target.value);
                  handleChange('name', e.target.value);
                }}
                style={inputStyle}
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
              <span>주소</span>
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
                <label style={{ fontSize: '0.73rem', color: '#606266', fontWeight: '600', display: 'block', marginBottom: '0.2rem' }}>주소 (B)</label>
                <input
                  type="text"
                  value={formData.address}
                  onChange={e => handleChange('address', e.target.value)}
                  style={inputStyle}
                />
              </div>
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
                  {formData.companyName || formData.name || '회사명 없음'}
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

                {formData.address && (
                  <div style={{ fontSize: '0.72rem', color: '#606266', display: 'flex', alignItems: 'flex-start', gap: '0.3rem', marginTop: '0.1rem' }}>
                    <MapPin size={12} style={{ color: '#d81b60', flexShrink: 0, marginTop: '2px' }} />
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
