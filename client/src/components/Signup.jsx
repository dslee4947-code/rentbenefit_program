import React from 'react';
import { Mail, Lock, EyeOff, Eye, User, MapPin, Headphones, X, CheckCircle, AlertTriangle, Car } from 'lucide-react';

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
                placeholder="비밀번호를 입력해주세요" 
                required 
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

          {/* User Type Selection */}
          <div className="signup-user-type-selector">
            <label className="signup-label">회원 유형 선택 *</label>
            <div className="signup-user-type-buttons">
              <button 
                type="button" 
                className={`user-type-btn ${signupData.user_type === 'customer' ? 'active' : ''}`}
                onClick={() => setSignupData({...signupData, user_type: 'customer'})}
              >
                일반 회원
              </button>
              <button 
                type="button" 
                className={`user-type-btn ${signupData.user_type === 'admin' ? 'active' : ''}`}
                onClick={() => setSignupData({...signupData, user_type: 'admin'})}
              >
                관리자
              </button>
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

          {/* Submit */}
          <button 
            type="submit" 
            className="signup-submit-btn enabled"
          >
            회원가입
          </button>
        </form>
      </div>
    </div>
  );
}

export default Signup;
