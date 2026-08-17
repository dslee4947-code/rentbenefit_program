import React from 'react';
import { Mail, Lock, EyeOff, Eye, User, MapPin, Phone, Briefcase, MessageSquare, Headphones, X, CheckCircle, AlertTriangle, Car } from 'lucide-react';

function Signup({
  signupData,
  setSignupData,
  handleRegister,
  setView,
  showPassword,
  setShowPassword,
  toasts
}) {
  return (
    <div className="signup-wrapper">
      {/* Toast Notifications */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            {toast.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      <div className="signup-phone-frame">
        <div className="signup-frame-header">
          {/* 왼쪽 상단 로고 */}
          <div className="logo-container" onClick={() => setView('main')}>
            <Car className="animate-float" style={{ color: 'var(--primary)' }} />
            <span className="logo-text">BENefit</span>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="signup-icon-btn"><Headphones size={20} /></button>
            <button type="button" className="signup-icon-btn" onClick={() => setView('main')}><X size={20} /></button>
          </div>
        </div>

        <h2 className="signup-title">회원가입</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '-2rem', marginBottom: '1.8rem' }}>
          가입 신청 후 관리자 승인이 완료되어야 서비스를 이용하실 수 있습니다.
        </p>

        <form onSubmit={handleRegister} className="signup-form">
          {/* Email Input */}
          <div className="signup-field-group">
            <label className="signup-field-label">이메일 *</label>
            <div className="signup-input-wrapper">
              <Mail size={18} className="signup-input-icon" />
              <input
                type="email"
                placeholder="email@example.com"
                required
                value={signupData.email}
                onChange={(e) => setSignupData({...signupData, email: e.target.value})}
                className="signup-input"
              />
            </div>
          </div>

          {/* Password Input */}
          <div className="signup-field-group">
            <label className="signup-field-label">비밀번호 *</label>
            <div className="signup-input-wrapper">
              <Lock size={18} className="signup-input-icon" />
              <input
                type={showPassword ? "text" : "password"}
                placeholder="영문, 숫자, 특수문자 포함 8자 이상"
                required
                minLength={8}
                value={signupData.password}
                onChange={(e) => setSignupData({...signupData, password: e.target.value})}
                className="signup-input"
              />
              <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Password Confirm Input */}
          <div className="signup-field-group">
            <label className="signup-field-label">비밀번호 확인 *</label>
            <div className="signup-input-wrapper">
              <Lock size={18} className="signup-input-icon" />
              <input
                type={showPassword ? "text" : "password"}
                placeholder="비밀번호를 다시 입력해주세요"
                required
                value={signupData.passwordConfirm}
                onChange={(e) => setSignupData({...signupData, passwordConfirm: e.target.value})}
                className="signup-input"
              />
            </div>
          </div>

          {/* Name Input */}
          <div className="signup-field-group">
            <label className="signup-field-label">이름 *</label>
            <div className="signup-input-wrapper">
              <User size={18} className="signup-input-icon" />
              <input
                type="text"
                placeholder="이름을 입력해주세요"
                required
                value={signupData.name}
                onChange={(e) => setSignupData({...signupData, name: e.target.value})}
                className="signup-input"
              />
            </div>
          </div>

          {/* Phone Input */}
          <div className="signup-field-group">
            <label className="signup-field-label">연락처 *</label>
            <div className="signup-input-wrapper">
              <Phone size={18} className="signup-input-icon" />
              <input
                type="tel"
                placeholder="010-0000-0000"
                required
                value={signupData.phone}
                onChange={(e) => setSignupData({...signupData, phone: e.target.value})}
                className="signup-input"
              />
            </div>
          </div>

          {/* Department Input */}
          <div className="signup-field-group">
            <label className="signup-field-label">소속 / 부서 / 직급 *</label>
            <div className="signup-input-wrapper">
              <Briefcase size={18} className="signup-input-icon" />
              <input
                type="text"
                placeholder="예) 영업팀 대리"
                required
                value={signupData.department}
                onChange={(e) => setSignupData({...signupData, department: e.target.value})}
                className="signup-input"
              />
            </div>
          </div>

          {/* Apply Reason Input (optional) */}
          <div className="signup-field-group">
            <label className="signup-field-label">가입 목적 / 신청 사유 (선택)</label>
            <div className="signup-input-wrapper">
              <MessageSquare size={18} className="signup-input-icon" />
              <input
                type="text"
                placeholder="관리자 승인 시 참고할 내용을 입력해주세요"
                value={signupData.applyReason}
                onChange={(e) => setSignupData({...signupData, applyReason: e.target.value})}
                className="signup-input"
              />
            </div>
          </div>

          {/* Address Input */}
          <div className="signup-field-group">
            <label className="signup-field-label">주소 (선택)</label>
            <div className="signup-input-wrapper">
              <MapPin size={18} className="signup-input-icon" />
              <input
                type="text"
                placeholder="주소를 입력해주세요 (선택)"
                value={signupData.address}
                onChange={(e) => setSignupData({...signupData, address: e.target.value})}
                className="signup-input"
              />
            </div>
          </div>

          {/* Terms Agreement */}
          <div className="login-remember-container" style={{ marginTop: '0.4rem' }}>
            <label className="login-checkbox-label">
              <input
                type="checkbox"
                checked={signupData.agreeTerms}
                onChange={(e) => setSignupData({...signupData, agreeTerms: e.target.checked})}
                className="login-custom-checkbox"
                required
              />
              <span className="login-checkbox-text">
                (필수) 서비스 이용약관 및 개인정보 수집·이용에 동의합니다.
              </span>
            </label>
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="signup-submit-btn enabled"
          >
            가입 신청
          </button>
        </form>
      </div>
    </div>
  );
}

export default Signup;
