import React, { useState, useEffect } from 'react';
import DashboardView from './DashboardView.jsx';
import QuoteInputView from './QuoteInputView.jsx';
import ContractRegisterView from './ContractRegisterView.jsx';
import VehicleManagementView from './VehicleManagementView.jsx';
import ContractsListView from './ContractsListView.jsx';
import CalendarView from './CalendarView.jsx';
import CustomerListView from './CustomerListView.jsx';
import UserManagementView from './UserManagementView.jsx';
import BillingView from './BillingView.jsx';

import { 
  LayoutDashboard, 
  Coins, 
  FileSignature, 
  Car, 
  Receipt, 
  Calendar,
  LogOut,
  UserCheck,
  Users,
  Menu,
  X,
  Key,
  FileText
} from 'lucide-react';

function AdminDashboard({ showToast, currentUser, onLogout }) {
  const getTabFromHash = () => {
    const hash = window.location.hash.replace('#/', '');
    const validTabs = ['dashboard', 'customers', 'quote-input', 'contract-register', 'vehicles', 'contracts', 'calendar', 'users', 'billing'];
    return validTabs.includes(hash) ? hash : 'dashboard';
  };

  const [activeTab, setActiveTab] = useState(getTabFromHash);

  useEffect(() => {
    const handleHashChange = () => {
      setActiveTab(getTabFromHash());
    };
    window.addEventListener('hashchange', handleHashChange);
    
    if (!window.location.hash) {
      window.location.hash = `#/${activeTab}`;
    }

    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [activeTab]);
  
  // Shared state to transfer data from Quote -> Contract Register
  const [prefilledQuoteData, setPrefilledQuoteData] = useState(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const menuItems = [
    { id: 'dashboard', name: '통계 대시보드', icon: <LayoutDashboard size={18} /> },
    { id: 'customers', name: '고객 DB 관리', icon: <Users size={18} /> },
    { id: 'quote-input', name: '견적서', icon: <Coins size={18} /> },
    { id: 'contract-register', name: '계약서 등록', icon: <FileSignature size={18} /> },
    { id: 'vehicles', name: '렌트차량 DB', icon: <Car size={18} /> },
    { id: 'contracts', name: '계약 / 견적 목록', icon: <Receipt size={18} /> },
    { id: 'billing', name: '장기렌트 청구서', icon: <FileText size={18} /> },
    { id: 'calendar', name: '일정표 캘린더', icon: <Calendar size={18} /> }
  ];

  if (currentUser?.role === 'admin') {
    menuItems.push({ id: 'users', name: '사용자 권한 관리', icon: <Key size={18} /> });
  }

  const navigateToTab = (tabId) => {
    window.location.hash = `#/${tabId}`;
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-main)', flexDirection: 'row' }} className="admin-container">
      <style dangerouslySetInnerHTML={{__html: `
        @media (max-width: 768px) {
          .desktop-sidebar {
            display: none !important;
          }
          .mobile-header {
            display: flex !important;
          }
          .main-content {
            padding: 1rem !important;
          }
          .admin-container {
            flex-direction: column !important;
          }
        }
        @media (min-width: 769px) {
          .desktop-sidebar {
            display: flex !important;
          }
          .mobile-header {
            display: none !important;
          }
          .main-content {
            padding: 2.5rem !important;
          }
          .admin-container {
            flex-direction: row !important;
          }
        }
      `}} />
      
      {/* Mobile Top Header */}
      <header className="mobile-header" style={{
        height: '60px',
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-color)',
        display: 'none',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 1.2rem',
        position: 'sticky',
        top: 0,
        zIndex: 999
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <img src="http://www.sdibenefit.com/images/logo.png" alt="RENT BENefit" style={{ maxHeight: '28px', width: 'auto' }} />
        </div>
        <button 
          onClick={() => setIsMobileMenuOpen(true)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-main)',
            cursor: 'pointer',
            padding: '0.4rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <Menu size={24} />
        </button>
      </header>

      {/* Mobile Menu Drawer/Overlay */}
      {isMobileMenuOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'rgba(0, 0, 0, 0.4)',
          zIndex: 1000,
          display: 'flex',
          justifyContent: 'flex-end'
        }} onClick={() => setIsMobileMenuOpen(false)}>
          <div style={{
            width: '280px',
            height: '100%',
            background: 'var(--bg-surface)',
            boxShadow: '-4px 0 12px rgba(0,0,0,0.15)',
            display: 'flex',
            flexDirection: 'column',
            padding: '1.5rem',
            gap: '1.5rem'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.8rem' }}>
              <img src="http://www.sdibenefit.com/images/logo.png" alt="RENT BENefit" style={{ maxHeight: '26px', width: 'auto' }} />
              <button 
                onClick={() => setIsMobileMenuOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer'
                }}
              >
                <X size={20} />
              </button>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0' }}>
              <div style={{ width: '32px', height: '32px', background: 'var(--primary-glow)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
                <UserCheck size={16} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: '700', color: 'var(--text-bright)' }}>{currentUser?.name || '관리자'}</span>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{currentUser?.email || 'admin@rentbenefit.co.kr'}</span>
              </div>
            </div>

            <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flex: 1, overflowY: 'auto' }}>
              {menuItems.map(item => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => { 
                      window.location.hash = `#/${item.id}`; 
                      setIsMobileMenuOpen(false);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.8rem',
                      width: '100%',
                      padding: '0.7rem 0.8rem',
                      border: 'none',
                      background: isActive ? 'var(--primary-glow)' : 'transparent',
                      color: isActive ? 'var(--primary)' : 'var(--text-main)',
                      fontWeight: isActive ? '700' : '500',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      textAlign: 'left',
                      transition: 'all 0.15s'
                    }}
                  >
                    {item.icon}
                    <span>{item.name}</span>
                  </button>
                );
              })}
            </nav>

            <button
              onClick={() => {
                setIsMobileMenuOpen(false);
                onLogout();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.8rem',
                width: '100%',
                padding: '0.7rem 0.8rem',
                border: '1px solid var(--border-color)',
                background: 'transparent',
                color: 'var(--text-muted)',
                fontWeight: '600',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.85rem',
                transition: 'all 0.15s'
              }}
            >
              <LogOut size={16} />
              <span>로그아웃</span>
            </button>
          </div>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className="desktop-sidebar" style={{ width: '260px', background: 'var(--bg-surface)', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', padding: '1.5rem', gap: '2rem', position: 'sticky', top: 0, height: '100vh' }}>
        {/* Brand/Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'center', width: '100%', textAlign: 'center' }}>
          <img src="http://www.sdibenefit.com/images/logo.png" alt="RENT BENefit" style={{ maxWidth: '180px', width: '100%', height: 'auto', maxHeight: '42px', objectFit: 'contain', margin: '0 auto' }} />
          <span style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-muted)', letterSpacing: '1px', textTransform: 'uppercase', width: '100%' }}>사내 일정 관리 시스템</span>
        </div>




        {/* Sidebar User Info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', background: 'var(--bg-main)', padding: '0.8rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <div style={{ width: '36px', height: '36px', background: 'var(--primary-glow)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
            <UserCheck size={18} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-bright)' }}>{currentUser?.name || '관리자'}</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textOverflow: 'ellipsis', overflow: 'hidden' }}>{currentUser?.email || 'admin@rentbenefit.co.kr'}</span>
          </div>
        </div>

        {/* Menu Navigation */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flex: 1 }}>
          {menuItems.map(item => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { window.location.hash = `#/${item.id}`; }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.8rem',
                  width: '100%',
                  padding: '0.8rem 1rem',
                  border: 'none',
                  background: isActive ? 'var(--primary-glow)' : 'transparent',
                  color: isActive ? 'var(--primary)' : 'var(--text-main)',
                  fontWeight: isActive ? '700' : '500',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  textAlign: 'left',
                  transition: 'all 0.2s'
                }}
                className={`menu-button ${isActive ? 'active' : ''}`}
              >
                {item.icon}
                <span>{item.name}</span>
              </button>
            );
          })}
        </nav>

        {/* Logout Button */}
        <button
          onClick={onLogout}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.8rem',
            width: '100%',
            padding: '0.8rem 1rem',
            border: '1px solid var(--border-color)',
            background: 'transparent',
            color: 'var(--text-muted)',
            fontWeight: '600',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '0.9rem',
            transition: 'all 0.2s'
          }}
          className="logout-button"
        >
          <LogOut size={16} />
          <span>로그아웃</span>
        </button>
      </aside>

      {/* Main Content Area */}
      <main className="main-content" style={{ flex: 1, padding: '2.5rem', overflowY: 'auto', minWidth: 0 }}>
        
        {/* Header Title Area */}
        <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '1.8rem', fontWeight: '800', color: 'var(--text-bright)' }}>
              {activeTab === 'dashboard' && '통계 대시보드'}
              {activeTab === 'customers' && '고객 DB 관리'}
              {activeTab === 'quote-input' && '견적서'}
              {activeTab === 'contract-register' && '계약서 신규 등록'}
              {activeTab === 'vehicles' && '렌트차량 DB 관리'}
              {activeTab === 'contracts' && '계약 / 견적서 목록'}
              {activeTab === 'billing' && '장기렌트 청구서'}
              {activeTab === 'calendar' && '캘린더 관리 일정표'}
              {activeTab === 'users' && '사용자 권한 관리'}
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.2rem' }}>
              {activeTab === 'dashboard' && '사내 프로그램의 실시간 차량 DB와 계약 일정 현황 요약입니다.'}
              {activeTab === 'customers' && '아웃룩 연동 및 수동 등록된 전체 고객 정보 목록을 실시간 조회 및 관리합니다.'}
              {activeTab === 'quote-input' && '고객과의 상담 기록 및 예상 대여료 비교 견적서를 작성합니다.'}
              {activeTab === 'contract-register' && '확정된 견적 정보를 계약서로 신규 등록하고 입고 차량 DB 및 알림 일정을 자동 생성합니다.'}
              {activeTab === 'vehicles' && '전체 렌트 차량의 계약정보, 잔여일정, 담당 정비 내역을 상세 조회합니다.'}
              {activeTab === 'contracts' && '현재까지 등록된 모든 견적서 정보와 렌트 계약서 정보 리스트입니다.'}
              {activeTab === 'billing' && '계약 건별 대여료 및 기타 추가 납입 항목을 취합하여 프리미엄 청구서를 발행 및 관리합니다.'}
              {activeTab === 'calendar' && '정기점검, 종합검사, 렌트만료, 계산서발행 예정일을 한눈에 보여주는 관리 일정표입니다.'}
              {activeTab === 'users' && '가입된 사내 직원들의 권한(조회/수정 및 삭제/관리자)을 조정하고 승인합니다.'}
            </p>
          </div>
        </header>

        {/* View Router */}
        <div className="view-content-wrapper">
          {activeTab === 'dashboard' && (
            <DashboardView 
              setActiveTab={navigateToTab} 
              showToast={showToast} 
            />
          )}

          {activeTab === 'customers' && (
            <CustomerListView 
              showToast={showToast} 
            />
          )}

          {activeTab === 'quote-input' && (
            <QuoteInputView 
              setActiveTab={navigateToTab} 
              setPrefilledQuoteData={setPrefilledQuoteData}
              showToast={showToast}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'contract-register' && (
            <ContractRegisterView 
              prefilledQuoteData={prefilledQuoteData}
              setPrefilledQuoteData={setPrefilledQuoteData}
              setActiveTab={navigateToTab}
              showToast={showToast}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'vehicles' && (
            <VehicleManagementView 
              showToast={showToast} 
              currentUser={currentUser}
            />
          )}

          {activeTab === 'contracts' && (
            <ContractsListView 
              setActiveTab={navigateToTab}
              setPrefilledQuoteData={setPrefilledQuoteData}
              showToast={showToast}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'billing' && (
            <BillingView 
              showToast={showToast}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'calendar' && (
            <CalendarView 
              showToast={showToast}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'users' && currentUser?.role === 'admin' && (
            <UserManagementView 
              showToast={showToast}
              currentUser={currentUser}
            />
          )}
        </div>
      </main>

    </div>
  );
}

export default AdminDashboard;
