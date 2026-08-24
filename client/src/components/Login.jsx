import React, { useState, useEffect } from 'react';
import { Car, Headphones, X, CheckCircle, AlertTriangle } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:5000`;
function Login({
  setView,
  showToast,
  onLoginSuccess,
  toasts,
  currentUser
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // 🔄 컴포넌트 로드 시 기억된 이메일이 있는지 확인
  useEffect(() => {
    const savedEmail = localStorage.getItem('rememberedEmail');
    if (savedEmail) {
      setEmail(savedEmail);
      setRememberMe(true);
    }
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      showToast('이메일과 비밀번호를 입력해주세요.', 'error');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`${API_HOST}/api/users/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();

      if (response.ok) {
        alert(`${data.name}님, 로그인이 완료되었습니다. 환영합니다.`);
        
        // 💾 Remember me 처리
        if (rememberMe) {
          localStorage.setItem('rememberedEmail', email);
        } else {
          localStorage.removeItem('rememberedEmail');
        }

        // 로그인 성공 시 상태 업데이트 및 토큰 보관
        onLoginSuccess(data);
        setView('main');
      } else {
        showToast(data.message || '로그인에 실패했습니다.', 'error');
      }
    } catch (error) {
      console.error('Login request failed', error);
      showToast('서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.', 'error');
    } finally {
      setIsLoading(false);
    }

  };

  const handleGoogleSignIn = () => {
    showToast('구글 로그인은 준비 중입니다.', 'info');
  };

  const handleForgotPassword = () => {
    showToast('비밀번호 찾기 기능은 준비 중입니다.', 'info');
  };

  // 🔒 이미 로그인되어 있는 상태인 경우 안내 화면 렌더링
  if (currentUser) {
    return (
      <div className="signup-wrapper">
        <div className="signup-phone-frame login-frame" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '1.5rem' }}>
          <div className="signup-frame-header" style={{ width: '100%' }}>
            <div className="logo-container" onClick={() => setView('main')} style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <img src="/logo.png" alt="BENefit" style={{ maxWidth: '160px', width: '100%', height: 'auto', maxHeight: '36px', objectFit: 'contain' }} />
            </div>
            <button type="button" className="signup-icon-btn" onClick={() => setView('main')}>
              <X size={20} />
            </button>
          </div>
          
          <h2 className="login-main-title" style={{ fontSize: '2rem', marginTop: '1.5rem', textAlign: 'center', width: '100%', color: 'var(--text-bright)' }}>
            이미 로그인 상태입니다.
          </h2>
          
          <p style={{ color: 'var(--text-muted)', fontSize: '1rem', lineHeight: '1.6', margin: '0.5rem 0' }}>
            현재 <strong style={{ color: 'var(--primary)' }}>{currentUser.user_type === 'admin' ? `[관리자] ${currentUser.name}` : currentUser.name}</strong> 님 계정으로 접속 중입니다.
          </p>
          
          <button
            type="button"
            className="login-submit-btn"
            onClick={() => setView('main')}
            style={{ marginTop: '1rem' }}
          >
            메인 페이지로 돌아가기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="signup-wrapper">
      {/* Toast Notifications */}
      <div className="toast-container">
        {toasts && toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            {toast.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      <div className="signup-phone-frame login-frame">
        <div className="signup-frame-header">
          {/* logo */}
          <div className="logo-container" onClick={() => setView('main')} style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
            <img src="/logo.png" alt="BENefit" style={{ maxWidth: '160px', width: '100%', height: 'auto', maxHeight: '36px', objectFit: 'contain' }} />
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="signup-icon-btn" onClick={() => showToast('고객센터 준비 중', 'info')}>
              <Headphones size={20} />
            </button>
            <button type="button" className="signup-icon-btn" onClick={() => setView('main')}>
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Title & create account link */}
        <div className="login-header-group">
          <h2 className="login-main-title">Sign in</h2>
          <div className="login-subtitle">
            or <span className="login-link-action" onClick={() => setView('signup')}>create an account</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {/* Email input */}
          <div className="login-input-group">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="login-custom-input"
              required
            />
          </div>

          {/* Password input */}
          <div className="login-input-group">
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="login-custom-input"
              required
            />
          </div>

          {/* Remember me checkbox */}
          <div className="login-remember-container">
            <label className="login-checkbox-label">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="login-custom-checkbox"
              />
              <span className="login-checkbox-text">Remember me</span>
            </label>
          </div>

          {/* Sign in Submit Button */}
          <button
            type="submit"
            className="login-submit-btn"
            disabled={isLoading}
          >
            {isLoading ? 'Signing in...' : 'Sign in'}
          </button>

          {/* Divider */}
          <div className="login-divider-container">
            <div className="login-divider-line"></div>
          </div>

          {/* Google Sign In Button */}
          <button
            type="button"
            className="login-google-btn"
            onClick={handleGoogleSignIn}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" className="google-icon-svg">
              <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v3.9h6.69c-.29 1.5-.1.14 1.14 2.37l3.3 2.56c1.93-1.78 3.06-4.4 3.06-7.46z"/>
              <path fill="#34A853" d="M12 24c3.24 0 5.97-1.08 7.96-2.91l-3.3-2.56c-.9.6-2.07.98-3.3.98-2.54 0-4.69-1.71-5.46-4l-3.4 2.63C6.43 20.48 9.01 24 12 24z"/>
              <path fill="#FBBC05" d="M6.54 15.51c-.2-.6-.31-1.24-.31-1.9s.11-1.3.31-1.9L3.14 9.08C2.33 10.7 1.88 12.52 1.88 14.44s.45 3.74 1.26 5.36l3.4-2.63z"/>
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.96 1.19 15.24 0 12 0 9.01 0 6.43 3.52 4.4 7.02l3.4 2.63c.77-2.3 2.92-4 5.46-4z"/>
            </svg>
            <span>Sign in with Google</span>
          </button>

          {/* Forgotten password link */}
          <div className="login-forgot-container">
            <span className="login-forgot-link" onClick={handleForgotPassword}>
              Forgotten your password?
            </span>
          </div>
        </form>
      </div>
    </div>
  );
}

export default Login;
