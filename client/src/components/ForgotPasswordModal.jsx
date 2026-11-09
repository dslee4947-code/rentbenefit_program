import { useState } from 'react';
import { X } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

/**
 * 비밀번호 찾기 (로그인 화면).
 * 1단계: 아이디(이메일)와 이름을 넣고 [인증번호 받기] — 사용자가 누를 때만 메일이 나간다.
 * 2단계: 메일로 받은 6자리 번호와 새 비밀번호를 넣고 [비밀번호 바꾸기].
 * 이메일이 아닌 아이디(rent-003 등)는 메일을 받을 수 없어 관리자에게 초기화를 요청하도록 안내한다.
 */
const inputStyle = {
  width: '100%', padding: '0.7rem 0.8rem', border: '1px solid #d9d9d9', borderRadius: '8px',
  fontSize: '0.95rem', boxSizing: 'border-box', outline: 'none'
};
const btnStyle = (primary, disabled) => ({
  width: '100%', padding: '0.75rem', borderRadius: '8px', fontSize: '0.95rem', fontWeight: 700,
  border: primary ? 'none' : '1px solid #d9d9d9', cursor: disabled ? 'not-allowed' : 'pointer',
  background: primary ? (disabled ? '#9db4e0' : '#1f3c88') : '#fff', color: primary ? '#fff' : '#333'
});

function ForgotPasswordModal({ initialEmail = '', onClose, showToast }) {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState(initialEmail);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const post = async (path, body) => {
    const res = await fetch(`${API_HOST}/api/users/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  };

  const requestCode = async (e) => {
    e?.preventDefault();
    const id = email.trim();
    if (!id || !name.trim()) { setNotice('아이디(이메일)와 이름을 입력해 주세요.'); return; }
    if (!id.includes('@')) {
      setNotice('이메일이 아닌 아이디는 메일로 찾을 수 없습니다. 관리자에게 비밀번호 초기화를 요청해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const { ok, data } = await post('forgot-password', { email: id, name: name.trim() });
      setNotice(data.message || (ok ? '인증번호를 보냈습니다.' : '요청하지 못했습니다.'));
      if (ok) setStep(2);
    } catch {
      setNotice('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) { setNotice('메일로 받은 6자리 인증번호를 입력해 주세요.'); return; }
    if (pw !== pw2) { setNotice('새 비밀번호 두 칸이 서로 다릅니다.'); return; }
    setBusy(true);
    try {
      const { ok, data } = await post('reset-password', { email: email.trim(), code: code.trim(), newPassword: pw });
      if (ok) {
        showToast?.(data.message || '비밀번호를 바꿨습니다.', 'success');
        onClose(email.trim());
      } else {
        setNotice(data.message || '비밀번호를 바꾸지 못했습니다.');
      }
    } catch {
      setNotice('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={() => onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: '14px', width: '100%', maxWidth: '400px', padding: '1.6rem', boxShadow: '0 10px 40px rgba(0,0,0,0.25)', color: '#222' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.2rem' }}>비밀번호 찾기</h3>
          <button type="button" onClick={() => onClose()} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }} aria-label="닫기">
            <X size={20} />
          </button>
        </div>

        {step === 1 ? (
          <form onSubmit={requestCode} style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            <p style={{ margin: 0, fontSize: '0.9rem', color: '#555', lineHeight: 1.5 }}>
              가입한 아이디(이메일)와 이름을 넣으면 그 메일로 인증번호를 보내 드립니다.
            </p>
            <input style={inputStyle} type="text" autoComplete="username" placeholder="아이디(이메일)" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input style={inputStyle} type="text" placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} />
            {notice && <div style={{ fontSize: '0.88rem', color: '#c2410c', lineHeight: 1.5 }}>{notice}</div>}
            <button type="submit" disabled={busy} style={btnStyle(true, busy)}>{busy ? '보내는 중...' : '인증번호 받기'}</button>
          </form>
        ) : (
          <form onSubmit={resetPassword} style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            <p style={{ margin: 0, fontSize: '0.9rem', color: '#555', lineHeight: 1.5 }}>
              <b>{email.trim()}</b>(으)로 받은 6자리 인증번호와 새 비밀번호를 넣어 주세요. 인증번호는 10분 동안 쓸 수 있습니다.
            </p>
            <input style={inputStyle} type="text" inputMode="numeric" maxLength={6} placeholder="인증번호 6자리" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            <input style={inputStyle} type="password" autoComplete="new-password" placeholder="새 비밀번호 (영문·숫자·특수문자 8자 이상)" value={pw} onChange={(e) => setPw(e.target.value)} />
            <input style={inputStyle} type="password" autoComplete="new-password" placeholder="새 비밀번호 확인" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            {notice && <div style={{ fontSize: '0.88rem', color: '#555', lineHeight: 1.5 }}>{notice}</div>}
            <button type="submit" disabled={busy} style={btnStyle(true, busy)}>{busy ? '바꾸는 중...' : '비밀번호 바꾸기'}</button>
            <button type="button" disabled={busy} onClick={() => requestCode()} style={btnStyle(false, busy)}>인증번호 다시 받기</button>
          </form>
        )}

        <p style={{ margin: '1rem 0 0', fontSize: '0.82rem', color: '#888', lineHeight: 1.5 }}>
          메일이 오지 않거나 이메일이 아닌 아이디라면 관리자에게 비밀번호 초기화를 요청해 주세요.
        </p>
      </div>
    </div>
  );
}

export default ForgotPasswordModal;
