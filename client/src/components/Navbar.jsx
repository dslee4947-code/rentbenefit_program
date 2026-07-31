import React, { useState } from 'react';
import { Car, Search, PlusCircle, User, ClipboardList, Menu, X } from 'lucide-react';

function Navbar({
  fetchProducts,
  setView,
  setIsCartOpen,
  cartItemCount,
  currentUser,
  handleLogout,
  myOrdersCount = 0,
  myPaidOrdersCount = 0
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);

  const toggleUserDropdown = (e) => {
    e.stopPropagation();
    setIsUserDropdownOpen(prev => !prev);
  };

  const handleMouseLeave = () => {
    setIsUserDropdownOpen(false);
  };

  const handleNavClick = (viewName, subViewName = '') => {
    if (subViewName) {
      setView(viewName, subViewName);
    } else {
      setView(viewName);
    }
    setIsMenuOpen(false);
  };

  return (
    <header className="navbar">
      <div className="logo-container" onClick={() => handleNavClick('main')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Car className="animate-float" style={{ color: 'var(--primary)', width: '24px', height: '24px' }} />
          <span className="logo-text" style={{ fontSize: '1.6rem', letterSpacing: '1px' }}>BENefit</span>
        </div>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 'bold', letterSpacing: '0.5px' }}>ALL TYPES OF PREMIUM CAR SERVICE</span>
      </div>

      {/* 렌터카 특화 서비스 메뉴바 (Desktop) */}
      <div className="nav-menu-links desktop-only">
        <div className="nav-item-dropdown">
          <span className="nav-link-item" onClick={() => handleNavClick('rent-benefit', 'long-term')}>RENT BENefit (렌트)</span>
          <div className="dropdown-menu">
            <span className="dropdown-item" onClick={() => handleNavClick('rent-benefit', 'long-term')}>장기렌트</span>
            <span className="dropdown-item" onClick={() => handleNavClick('rent-benefit', 'short-term')}>단기렌트</span>
          </div>
        </div>

        <div className="nav-item-dropdown">
          <span className="nav-link-item" onClick={() => handleNavClick('fin-benefit', 'lease')}>FIN BENefit (금융/리스)</span>
          <div className="dropdown-menu">
            <span className="dropdown-item" onClick={() => handleNavClick('fin-benefit', 'lease')}>리스 견적서</span>
            <span className="dropdown-item" onClick={() => handleNavClick('fin-benefit', 'installment')}>할부 견적서</span>
          </div>
        </div>

        <div className="nav-item-dropdown">
          <span className="nav-link-item" onClick={() => handleNavClick('s-benefit', 'maintenance')}>S BENefit (신차/케어)</span>
          <div className="dropdown-menu">
            <span className="dropdown-item" onClick={() => handleNavClick('s-benefit', 'maintenance')}>정기점검</span>
            <span className="dropdown-item" onClick={() => handleNavClick('s-benefit', 'breakdown')}>고장수리</span>
            <span className="dropdown-item" onClick={() => handleNavClick('s-benefit', 'accident')}>사고수리</span>
            <span className="dropdown-item" onClick={() => handleNavClick('s-benefit', 'used')}>중고차 매물</span>
          </div>
        </div>

        <div className="nav-item-dropdown">
          <span className="nav-link-item" onClick={() => handleNavClick('sdi-benefit', 'insurance')}>SDI BENefit (보험)</span>
          <div className="dropdown-menu">
            <span className="dropdown-item" onClick={() => handleNavClick('sdi-benefit', 'insurance')}>보험 견적서</span>
          </div>
        </div>
      </div>

      {/* 액션 버튼 그룹 (Desktop) */}
      <div className="nav-actions desktop-only">
        {/* 인증 상태에 따라 로그인/회원가입 또는 로그아웃 표시 */}
        {currentUser ? (
          <div 
            className="nav-item-dropdown" 
            style={{ display: 'inline-block', position: 'relative' }}
            onMouseLeave={handleMouseLeave}
          >
            <span 
              className="user-profile-nav-link nav-link-item"
              onClick={toggleUserDropdown}
              style={{ fontSize: '0.9rem', color: 'var(--text-bright)', fontWeight: 600, cursor: 'pointer', display: 'inline-block', padding: '0.5rem 0' }}
            >
              {currentUser.user_type === 'admin' ? `[관리자] ${currentUser.name}님 환영합니다. ${cartItemCount > 0 ? `(${cartItemCount})` : ''}` : `${currentUser.name}님 환영합니다. ${cartItemCount > 0 ? `(${cartItemCount})` : ''}`}
            </span>
            <div 
              className={`dropdown-menu user-dropdown-menu ${isUserDropdownOpen ? 'show-dropdown' : ''}`}
              style={{ right: 0, left: 'auto' }}
            >
              {currentUser.user_type === 'admin' ? (
                <span className="dropdown-item" onClick={() => { handleNavClick('admin'); setIsUserDropdownOpen(false); }}>
                  어드민 관리
                </span>
              ) : (
                <span className="dropdown-item" onClick={() => { handleNavClick('mypage'); setIsUserDropdownOpen(false); }}>
                  내 주문 목록
                </span>
              )}
              <span className="dropdown-item" onClick={() => { setIsCartOpen(true); setIsUserDropdownOpen(false); }}>
                견적 바구니 ({cartItemCount})
              </span>
              <span 
                className="dropdown-item" 
                onClick={() => { handleLogout(); setIsUserDropdownOpen(false); }}
                style={{ borderTop: '1px solid var(--border-color)', color: 'var(--error)', marginTop: '0.3rem', paddingTop: '0.5rem' }}
              >
                로그아웃
              </span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button className="signup-nav-btn" onClick={() => handleNavClick('login')}>
              <User size={18} />
              <span>로그인</span>
            </button>
            <button className="signup-nav-btn" onClick={() => handleNavClick('signup')}>
              <span>회원가입</span>
            </button>
          </div>
        )}

      </div>

      {/* 모바일 토글 버튼 그룹 (Mobile/Tablet Only) */}
      <div className="mobile-toggle-group">
        <button className="cart-btn mobile-cart-btn" onClick={() => setIsCartOpen(true)} title="견적 바구니">
          <ClipboardList size={22} />
          {cartItemCount > 0 && <span className="cart-badge">{cartItemCount}</span>}
        </button>

        <button className="menu-toggle-btn" onClick={() => setIsMenuOpen(!isMenuOpen)} aria-label="메뉴 토글">
          {isMenuOpen ? <X size={26} /> : <Menu size={26} />}
        </button>
      </div>

      {/* 모바일 메뉴 드로어 (Mobile/Tablet Only) */}
      {isMenuOpen && (
        <div className="mobile-menu-drawer animate-fade-in">
          {/* 모바일 메뉴 링크 */}
          <div className="mobile-nav-links">
            <span className="mobile-nav-link-item" onClick={() => handleNavClick('rent-benefit', 'long-term')}>장기렌트 (RENT)</span>
            <span className="mobile-nav-link-item" onClick={() => handleNavClick('rent-benefit', 'short-term')}>단기렌트 (RENT)</span>
            <span className="mobile-nav-link-item" onClick={() => handleNavClick('fin-benefit', 'lease')}>리스 견적서 (FIN)</span>
            <span className="mobile-nav-link-item" onClick={() => handleNavClick('fin-benefit', 'installment')}>할부 견적서 (FIN)</span>
            <span className="mobile-nav-link-item" onClick={() => handleNavClick('s-benefit', 'maintenance')}>정기점검 (S)</span>
            <span className="mobile-nav-link-item" onClick={() => handleNavClick('s-benefit', 'breakdown')}>고장수리 (S)</span>
            <span className="mobile-nav-link-item" onClick={() => handleNavClick('s-benefit', 'accident')}>사고수리 (S)</span>
            <span className="mobile-nav-link-item" onClick={() => handleNavClick('s-benefit', 'used')}>중고차 매물 (S)</span>
            <span className="mobile-nav-link-item" onClick={() => handleNavClick('sdi-benefit', 'insurance')}>보험 견적서 (SDI)</span>
          </div>

          {/* 모바일 액션 버튼 */}
          <div className="mobile-actions-group">
            {currentUser ? (
              <div className="mobile-user-info">
                <span 
                  className="mobile-username user-profile-nav-link"
                  onClick={() => {
                    if (currentUser.user_type === 'admin') {
                      handleNavClick('admin');
                    } else {
                      handleNavClick('mypage');
                    }
                  }}
                  style={{ display: 'block', marginBottom: '0.8rem', textAlign: 'center', cursor: 'pointer' }}
                >
                  {currentUser.user_type === 'admin' ? `[관리자] ${currentUser.name}님 환영합니다. ${cartItemCount > 0 ? `(${cartItemCount})` : ''}` : `${currentUser.name}님 환영합니다. ${cartItemCount > 0 ? `(${cartItemCount})` : ''}`}
                </span>
                <button className="signup-nav-btn mobile-action-btn" style={{ width: '100%', justifyContent: 'center' }} onClick={() => { handleLogout(); setIsMenuOpen(false); }}>
                  로그아웃
                </button>
              </div>
            ) : (
              <div className="mobile-auth-buttons">
                <button className="signup-nav-btn mobile-action-btn" onClick={() => handleNavClick('login')}>
                  <User size={18} />
                  <span>로그인</span>
                </button>
                <button className="signup-nav-btn mobile-action-btn" onClick={() => handleNavClick('signup')}>
                  <span>회원가입</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export default Navbar;
