import React from 'react';
import { Clock, ShieldCheck, Mail, Car } from 'lucide-react';

function SignupSuccess({
  registeredName,
  setView
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
        </div>

        <div className="signup-success-content">
          <h2 className="success-title">
            <span className="user-name-highlight">{registeredName}</span>님,<br />
            가입 신청이 완료되었습니다
          </h2>
          <p className="success-subtitle">
            관리자 승인이 완료되면 로그인하여<br />서비스를 이용하실 수 있습니다
          </p>

          {/* Pending status illustration */}
          <div className="success-illustration">
            <svg viewBox="0 0 200 200" width="160" height="160" className="svg-illustration">
              <circle cx="100" cy="100" r="80" fill="none" stroke="var(--primary)" strokeWidth="2" strokeDasharray="8 6" opacity="0.3" className="animate-spin-slow" />
              <circle cx="100" cy="100" r="70" fill="none" stroke="var(--primary)" strokeWidth="1" opacity="0.2" />
              <circle cx="100" cy="100" r="60" fill="rgba(102, 253, 241, 0.05)" stroke="var(--primary)" strokeWidth="2" strokeDasharray="40 10 90 20" />
              <circle cx="100" cy="100" r="45" fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeDasharray="5 5" opacity="0.5" />
              {/* clock hands to represent "pending" */}
              <line x1="100" y1="100" x2="100" y2="68" stroke="var(--primary)" strokeWidth="6" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 8px var(--primary))' }} />
              <line x1="100" y1="100" x2="122" y2="100" stroke="var(--primary)" strokeWidth="6" strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 8px var(--primary))' }} />
              <circle cx="100" cy="100" r="5" fill="var(--primary)" />
            </svg>
          </div>

          {/* Info badges */}
          <div className="benefit-badges">
            <div className="benefit-badge">
              <div className="badge-icon-wrapper">
                <Clock className="badge-icon" />
              </div>
              <p className="badge-title">승인 대기 중<br />관리자 검토 진행중</p>
            </div>

            <div className="benefit-badge">
              <div className="badge-icon-wrapper percent-wrapper">
                <Mail className="badge-icon" />
              </div>
              <p className="badge-title">알림 안내<br />승인/거절 시 안내</p>
            </div>

            <div className="benefit-badge">
              <div className="badge-icon-wrapper zero-wrapper">
                <ShieldCheck className="badge-icon" />
              </div>
              <p className="badge-title">승인 완료 후<br />정상 로그인 가능</p>
            </div>
          </div>

          {/* Buttons */}
          <button
            className="success-cta-btn"
            onClick={() => setView('login')}
          >
            로그인 화면으로 이동
          </button>
        </div>
      </div>
    </div>
  );
}

export default SignupSuccess;
