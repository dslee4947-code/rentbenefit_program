import React, { useState, useEffect } from 'react';
import { CheckCircle, AlertTriangle, Info, Sparkles } from 'lucide-react';
import './App.css';

// Import sub-components
import Login from './components/Login.jsx';
import AdminDashboard from './components/admin/AdminDashboard.jsx';

function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  
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
        <Login 
          setView={() => {}} 
          showToast={showToast} 
          onLoginSuccess={handleLoginSuccess}
          toasts={toasts}
          currentUser={currentUser}
        />
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
