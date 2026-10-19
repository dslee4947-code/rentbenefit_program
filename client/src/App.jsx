import React, { useState, useEffect } from 'react';
import { CheckCircle, AlertTriangle, Info, Sparkles } from 'lucide-react';
import './App.css';

// Import sub-components
import Login from './components/Login.jsx';
import AdminDashboard from './components/admin/AdminDashboard.jsx';
import Signup from './components/Signup.jsx';
import SignupSuccess from './components/SignupSuccess.jsx';


// 알림 색. warning은 저장은 됐지만 사람이 무언가 고쳐야 할 때 쓴다(예: 계약일 확인 필요).
const TOAST_COLORS = {
  success: { bg: '#dcfce7', text: '#16a34a', border: '#bbf7d0' },
  error: { bg: '#fee2e2', text: '#ef4444', border: '#fecaca' },
  warning: { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' },
  info: { bg: '#e0f2fe', text: '#0284c7', border: '#bae6fd' }
};

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loginView, setLoginView] = useState('login'); // 'login', 'signup', 'signup-success'
  const [signupData, setSignupData] = useState({
    email: '',
    password: '',
    passwordConfirm: '',
    name: '',
    phone: '',
    department: '',
    applyReason: '',
    address: '',
    agreeTerms: false
  });
  const [showPassword, setShowPassword] = useState(false);

  const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!signupData.email || !signupData.password || !signupData.name || !signupData.phone || !signupData.department) {
      showToast('이메일, 비밀번호, 이름, 연락처, 소속은 필수 항목입니다.', 'error');
      return;
    }
    if (signupData.password !== signupData.passwordConfirm) {
      showToast('비밀번호가 일치하지 않습니다.', 'error');
      return;
    }
    const passwordPolicy = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>_\-]).{8,}$/;
    if (!passwordPolicy.test(signupData.password)) {
      showToast('비밀번호는 영문, 숫자, 특수문자를 포함하여 8자 이상이어야 합니다.', 'error');
      return;
    }
    if (!signupData.agreeTerms) {
      showToast('이용약관 및 개인정보 수집·이용에 동의해주세요.', 'error');
      return;
    }
    try {
      const response = await fetch(`${API_HOST}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: signupData.email,
          password: signupData.password,
          name: signupData.name,
          phone: signupData.phone,
          department: signupData.department,
          applyReason: signupData.applyReason,
          address: signupData.address,
          agreedToTerms: signupData.agreeTerms
        })
      });
      const data = await response.json();
      if (response.ok) {
        setLoginView('signup-success');
      } else {
        showToast(data.message || '회원가입에 실패했습니다.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 연결 실패', 'error');
    }
  };
  
  // Toast notifications state
  const [toasts, setToasts] = useState([]);

  // Load user session on mount
  useEffect(() => {
    const savedUser = localStorage.getItem('currentUser');
    if (savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser);
        setCurrentUser(parsedUser);

        // 캐시된 role/status가 서버 최신 상태와 다를 수 있으므로(예: 다른 관리자가 권한을 변경한 경우)
        // 로그인 이후 서버에서 최신 정보를 재확인하여 항상 동기화한다.
        if (parsedUser?.token) {
          fetch(`${API_HOST}/api/users/me`, {
            headers: { 'Authorization': `Bearer ${parsedUser.token}` }
          })
            .then(async (response) => {
              if (response.status === 401) {
                // 토큰이 만료/무효화된 경우 세션 종료
                localStorage.removeItem('currentUser');
                setCurrentUser(null);
                return;
              }
              if (!response.ok) return; // 일시적 오류 시 캐시된 세션 유지
              const data = await response.json();
              const refreshed = { ...parsedUser, ...data };
              setCurrentUser(refreshed);
              localStorage.setItem('currentUser', JSON.stringify(refreshed));
            })
            .catch(() => {
              // 네트워크 오류 시 캐시된 세션 유지
            });
        }
      } catch (err) {
        console.error('Failed to parse saved user', err);
      }
    }
    setLoading(false);
  }, []);

  const showToast = (message, type = 'success') => {
    // 서버가 꺼져 있거나 인터넷이 끊기면 브라우저는 'Failed to fetch'라고만 알려 준다. 무엇을 할지 알 수 있는 말로 바꾼다.
    const text = /failed to fetch|networkerror|load failed/i.test(String(message))
      ? '서버에 연결할 수 없습니다. 서버가 켜져 있는지, 인터넷이 연결돼 있는지 확인해 주세요.'
      : message;
    // 같은 ms에 여러 장이 뜨면 Date.now()만으로는 id가 겹쳐 함께 지워지거나 남는다
    const id = `${Date.now()}-${Math.random()}`;
    // 같은 알림은 한 장만 남긴다. 서버가 꺼진 채 화면을 열면 요청 수십 개가 한꺼번에 실패해
    // 같은 알림이 화면 오른쪽을 가득 채웠다(2026-10-18).
    setToasts(prev => [...prev.filter(t => t.message !== text), { id, message: text, type }]);

    // 보통은 3초 뒤 사라진다. 주의(warning)는 사람이 무언가 고쳐야 하는 안내라 읽을 시간을 더 준다.
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, type === 'warning' ? 8000 : 3000);
  };

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    localStorage.setItem('currentUser', JSON.stringify(user));
  };

  const handleUpdateCurrentUser = (updatedFields) => {
    setCurrentUser(prev => {
      const merged = { ...prev, ...updatedFields };
      localStorage.setItem('currentUser', JSON.stringify(merged));
      return merged;
    });
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('currentUser');
    setLoginView('login');
    // 관리자 화면의 해시 라우트(#/users 등)가 남아있으면 로그인 화면 진입 후에도
    // 흔적이 남으므로 로그아웃 시 초기화한다.
    window.location.hash = '';
    showToast('로그아웃 되었습니다.', 'info');
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-main)', color: 'var(--text-muted)' }}>
        <span>시스템 로딩 중...</span>
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* Toast Alert Portal */}
      <div className="toast-container" style={{ position: 'fixed', top: '20px', right: '20px', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {toasts.map((toast) => (
          <div 
            key={toast.id} 
            className={`toast ${toast.type}`}
            style={{
              background: TOAST_COLORS[toast.type]?.bg || TOAST_COLORS.info.bg,
              color: TOAST_COLORS[toast.type]?.text || TOAST_COLORS.info.text,
              border: `1px solid ${TOAST_COLORS[toast.type]?.border || TOAST_COLORS.info.border}`,
              maxWidth: '480px',
              padding: '0.8rem 1.2rem',
              borderRadius: '8px',
              boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              fontSize: '0.85rem',
              fontWeight: '600',
              animation: 'fadeIn 0.3s ease-out'
            }}
          >
            {toast.type === 'success' && <CheckCircle size={16} />}
            {(toast.type === 'error' || toast.type === 'warning') && <AlertTriangle size={16} style={{ flexShrink: 0 }} />}
            {toast.type === 'info' && <Info size={16} />}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>

      {/* Main View Controller */}
      {!currentUser ? (
        <>
          {loginView === 'login' && (
            <Login 
              setView={setLoginView} 
              showToast={showToast} 
              onLoginSuccess={handleLoginSuccess}
              toasts={toasts}
              currentUser={currentUser}
            />
          )}
          {loginView === 'signup' && (
            <Signup
              signupData={signupData}
              setSignupData={setSignupData}
              handleRegister={handleRegister}
              setView={setLoginView}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
              toasts={toasts}
            />
          )}
          {loginView === 'signup-success' && (
            <SignupSuccess
              registeredName={signupData.name}
              setView={setLoginView}
            />
          )}
        </>
      ) : (
        <AdminDashboard
          showToast={showToast}
          currentUser={currentUser}
          onLogout={handleLogout}
          onUpdateUser={handleUpdateCurrentUser}
        />
      )}
    </div>
  );
}

export default App;
