import React, { useState, useEffect } from 'react';
import { User, Lock, Save, Mail, Phone, Building2, MapPin } from 'lucide-react';
import { useSaveShortcut } from './useSaveShortcut.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const ROLE_LABELS = {
  viewer: '조회 권한 (Viewer)',
  editor: '수정/삭제 권한 (Editor)',
  admin: '최고 관리자 권한 (Admin)',
};

function MyPageView({ showToast, currentUser, onUpdateUser }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState({ name: '', phone: '', department: '', address: '' });
  const [originalEmail, setOriginalEmail] = useState('');
  const [email, setEmail] = useState('');
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmNewPassword: '' });

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${currentUser?.token || ''}`
  });

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await fetch(`${API_HOST}/api/users/me`, { headers: authHeaders() });
        const data = await response.json();
        if (response.ok) {
          setProfile({
            name: data.name || '',
            phone: data.phone || '',
            department: data.department || '',
            address: data.address || ''
          });
          setEmail(data.email || '');
          setOriginalEmail(data.email || '');
        } else {
          showToast(data.message || '내 정보를 불러오지 못했습니다.', 'error');
        }
      } catch (err) {
        console.error(err);
        showToast('서버 연결 실패', 'error');
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleProfileChange = (field, value) => {
    setProfile(prev => ({ ...prev, [field]: value }));
  };

  const handlePasswordChange = (field, value) => {
    setPasswordForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();

    if (!profile.name || !profile.phone || !profile.department) {
      showToast('이름, 연락처, 소속은 필수 항목입니다.', 'error');
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailPattern.test(email)) {
      showToast('올바른 이메일(아이디) 형식을 입력해주세요.', 'error');
      return;
    }

    const emailChanged = email.trim().toLowerCase() !== originalEmail;
    const wantsPasswordChange = passwordForm.newPassword || passwordForm.confirmNewPassword;
    const needsCurrentPassword = emailChanged || wantsPasswordChange;

    if (needsCurrentPassword && !passwordForm.currentPassword) {
      showToast('아이디 또는 비밀번호를 변경하려면 현재 비밀번호를 입력해주세요.', 'error');
      return;
    }
    if (wantsPasswordChange) {
      if (passwordForm.newPassword !== passwordForm.confirmNewPassword) {
        showToast('새 비밀번호가 일치하지 않습니다.', 'error');
        return;
      }
      const passwordPolicy = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>_\-]).{8,}$/;
      if (!passwordPolicy.test(passwordForm.newPassword)) {
        showToast('비밀번호는 영문, 숫자, 특수문자를 포함하여 8자 이상이어야 합니다.', 'error');
        return;
      }
    }

    setSaving(true);
    try {
      const body = { ...profile, email };
      if (needsCurrentPassword) {
        body.currentPassword = passwordForm.currentPassword;
      }
      if (wantsPasswordChange) {
        body.newPassword = passwordForm.newPassword;
      }

      const response = await fetch(`${API_HOST}/api/users/me`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
      const data = await response.json();

      if (response.ok) {
        showToast('내 정보가 성공적으로 수정되었습니다.', 'success');
        setPasswordForm({ currentPassword: '', newPassword: '', confirmNewPassword: '' });
        setOriginalEmail(data.email || '');
        if (onUpdateUser) {
          onUpdateUser({
            name: data.name,
            phone: data.phone,
            department: data.department,
            address: data.address,
            email: data.email
          });
        }
      } else {
        showToast(data.message || '정보 수정에 실패했습니다.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 통신 오류', 'error');
    } finally {
      setSaving(false);
    }
  };

  // Ctrl+S로 저장한다
  useSaveShortcut(!saving, () => handleSubmit());

  const inputStyle = {
    width: '100%',
    padding: '0.65rem 0.9rem',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    fontSize: '0.9rem',
    outline: 'none',
    background: '#fff',
    color: '#333'
  };

  const labelStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    fontSize: '0.85rem',
    fontWeight: '600',
    color: 'var(--text-main)',
    marginBottom: '0.4rem'
  };

  const fieldWrapStyle = { display: 'flex', flexDirection: 'column' };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        <span>불러오는 중...</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mypage-container fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', background: '#fff', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', maxWidth: '760px', margin: '0 auto' }}>

      {/* 계정 정보 (읽기 전용) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--bg-main)', padding: '1rem', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
        <div style={{ width: '44px', height: '44px', background: 'var(--primary-glow)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)', flexShrink: 0 }}>
          <User size={22} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--text-bright)' }}>{currentUser?.name}</span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Mail size={13} /> {currentUser?.email}
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: '600', marginTop: '0.2rem' }}>
            {ROLE_LABELS[currentUser?.role] || ROLE_LABELS.viewer}
          </span>
        </div>
      </div>

      {/* 개인 정보 수정 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-bright)', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, borderBottom: '1px solid var(--border-color)', paddingBottom: '0.7rem' }}>
          <User size={18} style={{ color: 'var(--primary)' }} /> 개인 정보
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div style={fieldWrapStyle}>
            <label style={labelStyle}><User size={14} /> 이름</label>
            <input type="text" value={profile.name} onChange={(e) => handleProfileChange('name', e.target.value)} style={inputStyle} required />
          </div>
          <div style={fieldWrapStyle}>
            <label style={labelStyle}><Phone size={14} /> 연락처</label>
            <input type="text" value={profile.phone} onChange={(e) => handleProfileChange('phone', e.target.value)} style={inputStyle} required />
          </div>
          <div style={fieldWrapStyle}>
            <label style={labelStyle}><Building2 size={14} /> 소속</label>
            <input type="text" value={profile.department} onChange={(e) => handleProfileChange('department', e.target.value)} style={inputStyle} required />
          </div>
          <div style={fieldWrapStyle}>
            <label style={labelStyle}><MapPin size={14} /> 주소</label>
            <input type="text" value={profile.address} onChange={(e) => handleProfileChange('address', e.target.value)} style={inputStyle} />
          </div>
        </div>
      </div>

      {/* 아이디 / 비밀번호 변경 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h3 style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-bright)', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0, borderBottom: '1px solid var(--border-color)', paddingBottom: '0.7rem' }}>
          <Lock size={18} style={{ color: 'var(--primary)' }} /> 아이디 / 비밀번호 변경
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '-0.5rem 0 0' }}>
          아이디(이메일)를 변경하려면 새 아이디를 입력하세요. 비밀번호를 바꾸지 않으려면 새 비밀번호 항목은 비워두세요.
          아이디 또는 비밀번호를 변경하는 경우 현재 비밀번호 확인이 필요합니다.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div style={{ ...fieldWrapStyle, gridColumn: '1 / -1' }}>
            <label style={labelStyle}><Mail size={14} /> 아이디 (이메일)</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} autoComplete="username" required />
          </div>
          <div style={{ ...fieldWrapStyle, gridColumn: '1 / -1' }}>
            <label style={labelStyle}>현재 비밀번호</label>
            <input type="password" value={passwordForm.currentPassword} onChange={(e) => handlePasswordChange('currentPassword', e.target.value)} style={inputStyle} autoComplete="current-password" placeholder="아이디 또는 비밀번호 변경 시 필수" />
          </div>
          <div style={fieldWrapStyle}>
            <label style={labelStyle}>새 비밀번호</label>
            <input type="password" value={passwordForm.newPassword} onChange={(e) => handlePasswordChange('newPassword', e.target.value)} style={inputStyle} autoComplete="new-password" placeholder="영문, 숫자, 특수문자 포함 8자 이상" />
          </div>
          <div style={fieldWrapStyle}>
            <label style={labelStyle}>새 비밀번호 확인</label>
            <input type="password" value={passwordForm.confirmNewPassword} onChange={(e) => handlePasswordChange('confirmNewPassword', e.target.value)} style={inputStyle} autoComplete="new-password" />
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={saving}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          padding: '0.8rem 1.2rem',
          border: 'none',
          borderRadius: '8px',
          background: 'var(--primary)',
          color: '#fff',
          fontWeight: '700',
          fontSize: '0.9rem',
          cursor: saving ? 'not-allowed' : 'pointer',
          opacity: saving ? 0.7 : 1
        }}
      >
        <Save size={16} /> {saving ? '저장 중...' : '저장하기'}
      </button>
    </form>
  );
}

export default MyPageView;
