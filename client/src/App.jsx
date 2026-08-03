import React, { useState, useEffect } from 'react';
import { CheckCircle, AlertTriangle, Info, Sparkles } from 'lucide-react';
import './App.css';

// Import sub-components
import Login from './components/Login.jsx';
import AdminDashboard from './components/admin/AdminDashboard.jsx';
import Signup from './components/Signup.jsx';
import SignupSuccess from './components/SignupSuccess.jsx';

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loginView, setLoginView] = useState('login'); // 'login', 'signup', 'signup-success'
  const [signupData, setSignupData] = useState({
    email: '',
    password: '',
    name: '',
    user_type: 'customer',
    address: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [registeredUser, setRegisteredUser] = useState(null);

  const API_HOST = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:5000`;

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!signupData.email || !signupData.password || !signupData.name) {
      showToast('이메일, 비밀번호, 이름은 필수 항목입니다.', 'error');
      return;
    }
    try {
      const response = await fetch(`${API_HOST}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(signupData)
      });
      const data = await response.json();
      if (response.ok) {
        setRegisteredUser(data);
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
        setCurrentUser(JSON.parse(savedUser));
      } catch (err) {
        console.error('Failed to parse saved user', err);
      }
    }
    setLoading(false);
  }, []);

  const showToast = (message, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    
    // Auto-remove toast after 3 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    localStorage.setItem('currentUser', JSON.stringify(user));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('currentUser');
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
              background: toast.type === 'success' ? '#dcfce7' : toast.type === 'error' ? '#fee2e2' : '#e0f2fe',
              color: toast.type === 'success' ? '#16a34a' : toast.type === 'error' ? '#ef4444' : '#0284c7',
              border: `1px solid ${toast.type === 'success' ? '#bbf7d0' : toast.type === 'error' ? '#fecaca' : '#bae6fd'}`,
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
            {toast.type === 'error' && <AlertTriangle size={16} />}
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
              showToast={showToast}
              registeredUser={registeredUser}
              onLoginSuccess={handleLoginSuccess}
            />
          )}
        </>
      ) : (
        <AdminDashboard 
          showToast={showToast}
          currentUser={currentUser}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}

export default App;
