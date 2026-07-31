import React from 'react';
import { X, Truck, Gift, Sparkles, Car } from 'lucide-react';

function SignupSuccess({ 
  registeredName, 
  setView, 
  showToast, 
  registeredUser, 
  onLoginSuccess 
}) {
  return (
    <div className="signup-wrapper">
      <div className="signup-phone-frame success-frame">
        <div className="signup-frame-header">
          {/* 왼쪽 상단 로고 */}
          <div className="logo-container">
            <Car className="animate-float" style={{ color: 'var(--primary)' }} />
            <span className="logo-text">BENefit</span>
          </div>
          {/* 우측 상단 X 닫기 버튼 삭제 */}
        </div>

        <div className="signup-success-content">
          <h2 className="success-title">
            BENefit의 새로운 회원이 되신 것을<br />
            <span className="user-name-highlight">{registeredName}</span>님 환영합니다!
          </h2>
          <p className="success-subtitle">
            BENefit에서 제공하는<br />다양한 프리미엄 혜택과 특전을 누려보세요
          </p>

          {/* Cyber HUD Checkmark Illustration */}
          <div className="success-illustration">
            <svg viewBox="0 0 200 200" width="160" height="160" className="svg-illustration">
              {/* outer glowing circular path */}
              <circle cx="100" cy="100" r="80" fill="none" stroke="var(--primary)" strokeWidth="2" strokeDasharray="8 6" opacity="0.3" className="animate-spin-slow" />
              <circle cx="100" cy="100" r="70" fill="none" stroke="var(--primary)" strokeWidth="1" opacity="0.2" />
              {/* middle HUD ring */}
              <circle cx="100" cy="100" r="60" fill="rgba(102, 253, 241, 0.05)" stroke="var(--primary)" strokeWidth="2" strokeDasharray="40 10 90 20" />
              {/* inner ring */}
              <circle cx="100" cy="100" r="45" fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeDasharray="5 5" opacity="0.5" />
              {/* Glowing checkmark in the center */}
              <path d="M70,100 L90,120 L135,75" fill="none" stroke="var(--primary)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 0 8px var(--primary))' }} />
              {/* decorative sci-fi dots */}
              <circle cx="100" cy="30" r="3" fill="var(--primary)" />
              <circle cx="100" cy="170" r="3" fill="var(--primary)" />
              <circle cx="30" cy="100" r="3" fill="var(--primary)" />
              <circle cx="170" cy="100" r="3" fill="var(--primary)" />
            </svg>
          </div>

          {/* 3 Icons section */}
          <div className="benefit-badges">
            <div className="benefit-badge">
              <div className="badge-icon-wrapper">
                <Gift className="badge-icon" />
                <span className="badge-icon-tag">Free</span>
              </div>
              <p className="badge-title">상담 혜택<br />무료 맞춤 견적 설계</p>
            </div>

            <div className="benefit-badge">
              <div className="badge-icon-wrapper percent-wrapper">
                <Sparkles className="badge-icon" />
                <span className="badge-icon-tag">15%</span>
              </div>
              <p className="badge-title">렌터카 혜택<br />단기 렌트 15% 할인</p>
            </div>

            <div className="benefit-badge">
              <div className="badge-icon-wrapper zero-wrapper">
                <Truck className="badge-icon" />
                <span className="badge-icon-tag font-zero">Free</span>
              </div>
              <p className="badge-title">무료 탁송<br />서울/경기 무료 탁송</p>
            </div>
          </div>

          {/* Buttons */}
          <button 
            className="success-cta-btn" 
            onClick={() => {
              if (registeredUser && onLoginSuccess) {
                onLoginSuccess(registeredUser); // 로그인 전역 상태 주입 & 로컬스토리지 토큰 보관
              }
              alert(`${registeredName}님, 회원가입이 완료되었습니다. 자동으로 로그인되어 메인 페이지로 이동합니다!`);
              setView('main');
            }}
          >
            차량 둘러보기
          </button>
          
          {/* 화면 닫기 버튼 삭제 */}
        </div>
      </div>
    </div>
  );
}

export default SignupSuccess;
