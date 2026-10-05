import React, { useState, useEffect } from 'react';
import DashboardView from './DashboardView.jsx';
import QuoteInputView from './QuoteInputView.jsx';
import ContractRegisterView from './ContractRegisterView.jsx';
import DeliveryPrepView from './DeliveryPrepView.jsx';
import VehicleManagementView from './VehicleManagementView.jsx';
import CalendarView from './CalendarView.jsx';
import CustomerListView from './CustomerListView.jsx';
import PendingInquiriesView from './PendingInquiriesView.jsx';
import CompanyManagementView from './CompanyManagementView.jsx';
import UserManagementView from './UserManagementView.jsx';
import StorageSettingView from './StorageSettingView.jsx';
import MaintenanceRatesView from './MaintenanceRatesView.jsx';
import CompanyFundingView from './CompanyFundingView.jsx';
import CompanyBookView from './CompanyBookView.jsx';
import MonthlyBillingView from './MonthlyBillingView.jsx';
import InvoiceArchiveView from './InvoiceArchiveView.jsx';
import FineNoticeView from './FineNoticeView.jsx';
import LedgerView from './LedgerView.jsx';
import MyPageView from './MyPageView.jsx';
import HandbookView from './HandbookView.jsx';

import {
  LayoutDashboard,
  Coins,
  FileSignature,
  Car,
  Calendar,
  LogOut,
  UserCheck,
  Users,
  Menu,
  X,
  Key,
  FileText,
  FileWarning,
  Settings,
  Building2,
  Truck,
  MessageCircleQuestion,
  Wallet,
  BookOpen,
  FolderTree,
  Wrench,
  Landmark,
  Archive,
  Receipt
} from 'lucide-react';

function AdminDashboard({ showToast, currentUser, onLogout, onUpdateUser }) {
  const getTabFromHash = () => {
    const hash = window.location.hash.replace('#/', '');
    // 메뉴를 새로 추가하면 여기에도 넣어야 한다. 빠지면 주소는 바뀌는데 화면은 대시보드로 되돌아간다.
    const validTabs = ['dashboard', 'customers', 'inquiries', 'companies', 'quote-input', 'contract-register', 'delivery-prep', 'vehicles', 'calendar', 'users', 'billing', 'invoice-archive', 'fine-notices', 'ledgers', 'handbook', 'storage-settings', 'maintenance-rates', 'company-funding', 'company-book', 'mypage'];
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
  
  // 화면이 낮으면 지금 열린 메뉴가 사이드바 스크롤 아래에 숨을 수 있다. 보이는 곳까지 끌어온다.
  useEffect(() => {
    document.querySelector('.desktop-sidebar .nav-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [activeTab]);

  // Shared state to transfer data from Quote -> Contract Register
  const [prefilledQuoteData, setPrefilledQuoteData] = useState(null);
  const [prefilledContractData, setPrefilledContractData] = useState(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [pendingUserCount, setPendingUserCount] = useState(0);

  const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

  useEffect(() => {
    if (currentUser?.role !== 'admin' || !currentUser?.token) return;

    const fetchPendingCount = async () => {
      try {
        const response = await fetch(`${API_HOST}/api/users/pending`, {
          headers: { 'Authorization': `Bearer ${currentUser.token}` }
        });
        if (response.ok) {
          const data = await response.json();
          setPendingUserCount(data.length);
        }
      } catch (err) {
        console.error('Failed to fetch pending user count', err);
      }
    };

    fetchPendingCount();
  }, [currentUser, activeTab]);

  // 메뉴를 업무 순서(영업 → 계약·출고 → 차량 → 청구·정산)대로 묶는다.
  // 16개를 한 줄로 늘어놓으면 원하는 메뉴를 매번 위에서부터 훑어야 한다.
  // 마이페이지는 아래 사용자 정보 칸에서 들어간다.
  const ICON_SIZE = 18;
  const menuGroups = [
    { label: null, items: [
      { id: 'dashboard', name: '통계 대시보드', icon: <LayoutDashboard size={ICON_SIZE} /> },
      { id: 'calendar', name: '일정표 캘린더', icon: <Calendar size={ICON_SIZE} /> }
    ] },
    { label: '영업', items: [
      { id: 'inquiries', name: '문의 대기', icon: <MessageCircleQuestion size={ICON_SIZE} /> },
      { id: 'customers', name: '고객 DB 관리', icon: <Users size={ICON_SIZE} /> },
      { id: 'companies', name: '법인 관리', icon: <Building2 size={ICON_SIZE} /> },
      { id: 'quote-input', name: '견적서', icon: <Coins size={ICON_SIZE} /> }
    ] },
    { label: '계약·출고', items: [
      { id: 'contract-register', name: '계약서 등록', icon: <FileSignature size={ICON_SIZE} /> },
      { id: 'delivery-prep', name: '출고 준비', icon: <Truck size={ICON_SIZE} /> }
    ] },
    { label: '차량', items: [
      { id: 'vehicles', name: '렌트차량 DB', icon: <Car size={ICON_SIZE} /> },
      { id: 'fine-notices', name: '고지서 관리', icon: <FileWarning size={ICON_SIZE} /> }
    ] },
    { label: '청구·정산', items: [
      { id: 'billing', name: '장기렌트 청구서', icon: <FileText size={ICON_SIZE} /> },
      { id: 'invoice-archive', name: '청구서 보관함', icon: <Archive size={ICON_SIZE} /> },
      { id: 'ledgers', name: '차량 손익 원장', icon: <Wallet size={ICON_SIZE} /> }
    ] },
    currentUser?.role === 'admin' && { label: '관리', items: [
      { id: 'users', name: '사용자 권한 관리', icon: <Key size={ICON_SIZE} />, badge: pendingUserCount },
      { id: 'storage-settings', name: '파일 저장 경로', icon: <FolderTree size={ICON_SIZE} /> },
      { id: 'maintenance-rates', name: '정비 단가표', icon: <Wrench size={ICON_SIZE} /> },
      { id: 'company-funding', name: '회사 자금·내부 금리', icon: <Landmark size={ICON_SIZE} /> },
      { id: 'company-book', name: '회사 장부', icon: <Receipt size={ICON_SIZE} /> }
    ] },
    { label: '도움말', items: [
      { id: 'handbook', name: '업무 매뉴얼', icon: <BookOpen size={ICON_SIZE} /> }
    ] }
  ].filter(Boolean);

  const navigateToTab = (tabId) => {
    window.location.assign(`#/${tabId}`);
  };

  const handleNavClick = (tabId) => {
    navigateToTab(tabId);
    setIsMobileMenuOpen(false);
  };

  // 데스크톱 사이드바와 모바일 서랍이 같은 메뉴를 쓴다. 한쪽만 고쳐 둘이 어긋나지 않게 하나로 둔다.
  const renderNav = () => (
    <nav className="sidebar-nav" aria-label="주 메뉴">
      {menuGroups.map((group, gi) => (
        <div key={group.label || gi} className="nav-section">
          {group.label && <div className="nav-section-label">{group.label}</div>}
          {group.items.map(item => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`nav-item${isActive ? ' active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
              >
                {item.icon}
                <span className="nav-item-label">{item.name}</span>
                {item.badge > 0 && <span className="nav-badge">{item.badge}</span>}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const renderFooter = () => (
    <div className="sidebar-footer">
      <button
        type="button"
        onClick={() => handleNavClick('mypage')}
        className={`sidebar-user${activeTab === 'mypage' ? ' active' : ''}`}
        title="마이페이지"
      >
        <span className="sidebar-avatar"><UserCheck size={16} /></span>
        <span className="sidebar-user-text">
          <span className="sidebar-user-name">{currentUser?.name || '관리자'}</span>
          <span className="sidebar-user-email">{currentUser?.email || 'admin@rentbenefit.co.kr'}</span>
        </span>
        <Settings size={16} className="sidebar-user-gear" />
      </button>
      <button
        type="button"
        onClick={() => { setIsMobileMenuOpen(false); onLogout(); }}
        className="sidebar-logout"
      >
        <LogOut size={16} />
        <span>로그아웃</span>
      </button>
    </div>
  );

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--bg-main)', flexDirection: 'row' }} className="admin-container">
      <style dangerouslySetInnerHTML={{__html: `
        /* 사이드바: 위(로고)와 아래(사용자·로그아웃)는 고정하고 가운데 메뉴만 따로 스크롤한다.
           전에는 사이드바 전체가 화면 높이에 붙어 있고 메뉴에 스크롤이 없어서,
           메뉴가 화면보다 길어지면 아래쪽 메뉴가 잘려 닿을 수 없었다. */
        .desktop-sidebar {
          width: 248px;
          flex-shrink: 0;
          height: 100vh;
          position: sticky;
          top: 0;
          flex-direction: column;
          background: var(--bg-surface);
          border-right: 1px solid var(--border-color);
        }
        .sidebar-brand {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.3rem;
          padding: 1.25rem 1rem 1rem;
          border-bottom: 1px solid var(--border-color);
        }
        .sidebar-brand img {
          max-width: 160px;
          width: 100%;
          max-height: 36px;
          object-fit: contain;
        }
        .sidebar-brand span {
          font-size: 0.72rem;
          font-weight: 600;
          color: var(--text-muted);
          letter-spacing: 0.04em;
        }
        .sidebar-nav {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          /* 메뉴 끝까지 스크롤해도 본문이 딸려 움직이지 않게 한다 */
          overscroll-behavior: contain;
          padding: 0.5rem 0.75rem 0.75rem;
          scrollbar-width: thin;
          scrollbar-color: #cbd5e1 transparent;
        }
        .sidebar-nav::-webkit-scrollbar { width: 6px; }
        .sidebar-nav::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
        .nav-section + .nav-section { margin-top: 0.35rem; }
        .nav-section-label {
          padding: 0.85rem 0.75rem 0.3rem;
          font-size: 0.72rem;
          font-weight: 700;
          color: #64748b;
          letter-spacing: 0.02em;
        }
        .nav-item {
          position: relative;
          display: flex;
          align-items: center;
          gap: 0.65rem;
          width: 100%;
          height: 38px;
          padding: 0 0.75rem;
          margin-bottom: 2px;
          border: none;
          border-radius: 6px;
          background: transparent;
          color: var(--text-main);
          /* 500은 흐려 보여서 600을 쓴다 */
          font-weight: 600;
          font-size: 0.93rem;
          letter-spacing: -0.01em;
          text-align: left;
          white-space: nowrap;
          cursor: pointer;
          transition: background 0.12s, color 0.12s;
        }
        .nav-item svg { flex-shrink: 0; color: #64748b; transition: color 0.12s; }
        .nav-item:hover { background: #f1f5f9; color: var(--text-bright); }
        .nav-item:hover svg { color: var(--text-bright); }
        .nav-item.active { background: var(--primary-glow); color: var(--primary); font-weight: 700; }
        .nav-item.active svg { color: var(--primary); }
        .nav-item.active::before {
          content: '';
          position: absolute;
          left: -0.75rem;
          top: 8px;
          bottom: 8px;
          width: 3px;
          border-radius: 0 3px 3px 0;
          background: var(--primary);
        }
        .nav-item:focus-visible,
        .sidebar-user:focus-visible,
        .sidebar-logout:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
        .nav-item-label { overflow: hidden; text-overflow: ellipsis; }
        .nav-badge {
          margin-left: auto;
          min-width: 20px;
          padding: 0 0.4rem;
          border-radius: 10px;
          background: #ef4444;
          color: #fff;
          font-size: 0.7rem;
          font-weight: 700;
          line-height: 18px;
          text-align: center;
        }
        .sidebar-footer {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          padding: 0.75rem;
          border-top: 1px solid var(--border-color);
        }
        .sidebar-user {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          width: 100%;
          padding: 0.5rem 0.6rem;
          border: none;
          border-radius: 8px;
          background: transparent;
          text-align: left;
          cursor: pointer;
          transition: background 0.12s;
        }
        .sidebar-user:hover { background: #f1f5f9; }
        .sidebar-user.active { background: var(--primary-glow); }
        .sidebar-avatar {
          width: 32px;
          height: 32px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: var(--primary-glow);
          color: var(--primary);
        }
        .sidebar-user-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
        .sidebar-user-name { font-size: 0.88rem; font-weight: 700; color: var(--text-bright); }
        .sidebar-user-email { font-size: 0.72rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sidebar-user-gear { flex-shrink: 0; color: #94a3b8; }
        .sidebar-logout {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          width: 100%;
          height: 36px;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          background: transparent;
          color: var(--text-muted);
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.12s, color 0.12s;
        }
        .sidebar-logout:hover { background: #fef2f2; color: #dc2626; border-color: #fecaca; }

        /* 모바일 서랍 */
        .mobile-drawer-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.4);
          z-index: 1000;
          display: flex;
          justify-content: flex-end;
        }
        .mobile-drawer {
          width: 280px;
          max-width: 85vw;
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-surface);
          box-shadow: -4px 0 16px rgba(0, 0, 0, 0.15);
        }
        .mobile-drawer-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1rem 1rem 0.8rem;
          border-bottom: 1px solid var(--border-color);
        }
        .mobile-drawer .nav-item { height: 44px; font-size: 1rem; }

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
          <img src="/logo.png" alt="RENT BENefit" style={{ maxHeight: '28px', width: 'auto' }} />
        </div>
        <button
          onClick={() => setIsMobileMenuOpen(true)}
          aria-label="메뉴 열기"
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

      {/* Mobile Menu Drawer */}
      {isMobileMenuOpen && (
        <div className="mobile-drawer-backdrop" onClick={() => setIsMobileMenuOpen(false)}>
          <div className="mobile-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-drawer-head">
              <img src="/logo.png" alt="RENT BENefit" style={{ maxHeight: '26px', width: 'auto' }} />
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                aria-label="메뉴 닫기"
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
              >
                <X size={20} />
              </button>
            </div>
            {renderNav()}
            {renderFooter()}
          </div>
        </div>
      )}

      {/* Sidebar Navigation */}
      <aside className="desktop-sidebar">
        <div className="sidebar-brand">
          <img src="/logo.png" alt="RENT BENefit" />
          <span>사내 일정 관리 시스템</span>
        </div>
        {renderNav()}
        {renderFooter()}
      </aside>
      {/* Main Content Area */}
      <main className="main-content" style={{ flex: 1, padding: '2.5rem', overflowY: 'auto', minWidth: 0 }}>
        
        {/* Header Title Area */}
        <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '1.8rem', fontWeight: '800', color: 'var(--text-bright)' }}>
              {activeTab === 'dashboard' && '통계 대시보드'}
              {activeTab === 'customers' && '고객 DB 관리'}
              {activeTab === 'inquiries' && '문의 대기'}
              {activeTab === 'companies' && '법인 관리'}
              {activeTab === 'quote-input' && '견적서'}
              {activeTab === 'contract-register' && '계약서 신규 등록'}
              {activeTab === 'delivery-prep' && '출고 준비'}
              {activeTab === 'vehicles' && '렌트차량 DB 관리'}
              {activeTab === 'billing' && '장기렌트 청구서'}
              {activeTab === 'invoice-archive' && '청구서 보관함'}
              {activeTab === 'fine-notices' && '고지서 관리'}
              {activeTab === 'ledgers' && '차량 손익 원장 (갑지)'}
              {activeTab === 'calendar' && '캘린더 관리 일정표'}
              {activeTab === 'users' && '사용자 권한 관리'}
              {activeTab === 'storage-settings' && '파일 저장 경로'}
              {activeTab === 'maintenance-rates' && '정비 단가표'}
              {activeTab === 'company-funding' && '회사 자금 · 내부 금리'}
              {activeTab === 'company-book' && '회사 장부'}
              {activeTab === 'handbook' && '업무 매뉴얼'}
              {activeTab === 'mypage' && '마이페이지'}
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.2rem' }}>
              {activeTab === 'dashboard' && '사내 프로그램의 실시간 차량 DB와 계약 일정 현황 요약입니다.'}
              {activeTab === 'customers' && '아웃룩 연동 및 수동 등록된 전체 고객 정보 목록을 실시간 조회 및 관리합니다.'}
              {activeTab === 'inquiries' && '등록된 고객이 남긴 문의 중 아직 처리되지 않은 건을 관리합니다.'}
              {activeTab === 'companies' && '거래 법인(및 개인사업자) 정보를 등록하고 관리합니다.'}
              {activeTab === 'quote-input' && '고객과의 상담 기록 및 예상 대여료 비교 견적서를 작성합니다.'}
              {activeTab === 'contract-register' && '확정된 견적 정보를 계약서로 신규 등록하고 입고 차량 DB 및 알림 일정을 자동 생성합니다.'}
              {activeTab === 'delivery-prep' && '계약은 완료됐지만 차량번호/차대번호 등 실물 등록이 아직 안 끝난 차량을 정리합니다.'}
              {activeTab === 'vehicles' && '전체 렌트 차량의 계약정보, 잔여일정, 담당 정비 내역을 상세 조회합니다.'}
              {activeTab === 'billing' && '계약 건별 대여료 및 기타 추가 납입 항목을 취합하여 프리미엄 청구서를 발행 및 관리합니다.'}
              {activeTab === 'invoice-archive' && '계약별로 1회차부터 모든 청구서를 보고, 과태료·자부담금을 더해 PDF로 만듭니다.'}
              {activeTab === 'fine-notices' && '범칙금·과태료·미납통행료 고지서를 모아 보고, 기한 안에 고객이 냈는지 확인해 청구 여부를 정합니다.'}
              {activeTab === 'ledgers' && '차량 1대에 들어간 돈과 들어온 돈을 갑지 한 장으로 모아 정산 결과를 확인합니다.'}
              {activeTab === 'calendar' && '정기점검, 종합검사, 렌트만료, 계산서발행 예정일을 한눈에 보여주는 관리 일정표입니다.'}
              {activeTab === 'users' && '가입된 사내 직원들의 권한(조회/수정 및 삭제/관리자)을 조정하고 승인합니다.'}
              {activeTab === 'storage-settings' && '견적서·계약서·청구서 파일이 원드라이브의 어느 폴더에 어떤 이름으로 저장될지 정합니다.'}
              {activeTab === 'maintenance-rates' && '차종 등급별 정비 항목 1회 단가와 타이어 가격을 정합니다. 견적서의 정비 원가가 이 값으로 계산됩니다.'}
              {activeTab === 'company-book' && '차 한 대에 속하지 않는 회사의 돈(월급·임대료·대출이자·대표 차입금·부가세)을 계정별로 모아, 비용과 비용이 아닌 돈을 나눠 봅니다.'}
              {activeTab === 'company-funding' && '회사 대출 목록을 적으면 잔액 가중 평균 금리가 내부 금리가 됩니다. 손익 원장이 회사 돈으로 산 차에 이 금리로 이자를 매깁니다.'}
              {activeTab === 'handbook' && '문의 접수부터 견적·계약·출고·청구·정산까지, 업무 순서와 화면 사용법을 정리한 인수인계 문서입니다.'}
              {activeTab === 'mypage' && '내 계정의 비밀번호와 개인정보를 수정합니다.'}
            </p>
          </div>
        </header>

        {/* View Router */}
        <div className="view-content-wrapper">
          {activeTab === 'dashboard' && (
            <DashboardView 
              setActiveTab={navigateToTab} 
              showToast={showToast}
              currentUser={currentUser} 
            />
          )}

          {activeTab === 'customers' && (
            <CustomerListView
              showToast={showToast}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'inquiries' && (
            <PendingInquiriesView
              showToast={showToast}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'companies' && (
            <CompanyManagementView
              showToast={showToast}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'quote-input' && (
            <QuoteInputView
              setActiveTab={navigateToTab}
              setPrefilledQuoteData={setPrefilledQuoteData}
              setPrefilledContractData={setPrefilledContractData}
              showToast={showToast}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'contract-register' && (
            <ContractRegisterView 
              prefilledQuoteData={prefilledQuoteData}
              setPrefilledQuoteData={setPrefilledQuoteData}
              prefilledContractData={prefilledContractData}
              setPrefilledContractData={setPrefilledContractData}
              setActiveTab={navigateToTab}
              showToast={showToast}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'delivery-prep' && (
            <DeliveryPrepView
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

          {activeTab === 'invoice-archive' && (
            <InvoiceArchiveView showToast={showToast} currentUser={currentUser} />
          )}
          {activeTab === 'billing' && (
            <MonthlyBillingView
              showToast={showToast}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'fine-notices' && (
            <FineNoticeView
              showToast={showToast}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'ledgers' && (
            <LedgerView
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

          {activeTab === 'storage-settings' && currentUser?.role === 'admin' && (
            <StorageSettingView
              showToast={showToast}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'maintenance-rates' && currentUser?.role === 'admin' && (
            <MaintenanceRatesView
              showToast={showToast}
              currentUser={currentUser}
            />
          )}

          {activeTab === 'company-book' && currentUser?.role === 'admin' && (
            <CompanyBookView showToast={showToast} />
          )}
          {activeTab === 'company-funding' && currentUser?.role === 'admin' && (
            <CompanyFundingView showToast={showToast} />
          )}

          {activeTab === 'handbook' && (
            <HandbookView
              setActiveTab={navigateToTab}
            />
          )}

          {activeTab === 'mypage' && (
            <MyPageView
              showToast={showToast}
              currentUser={currentUser}
              onUpdateUser={onUpdateUser}
            />
          )}
        </div>
      </main>

    </div>
  );
}

export default AdminDashboard;
