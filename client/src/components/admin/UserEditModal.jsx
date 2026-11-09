import { useState } from 'react';
import { X, RefreshCw, Eye, EyeOff } from 'lucide-react';

/**
 * 사용자 정보 수정 (사용자 권한 관리 > 전체 회원 > 수정). 최고 관리자만 연다.
 * 아이디(이메일)·이름·연락처·소속·주소·권한·상태·자금팀과 비밀번호 초기화를 한 번에 고친다.
 * 비밀번호 칸을 비워 두면 비밀번호는 그대로 둔다.
 */
const PASSWORD_POLICY = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>_-]).{8,}$/;

/** 규칙(영문·숫자·특수문자 8자 이상)에 맞는 임시 비밀번호 */
const makeTempPassword = () => {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set) => set[Math.floor(Math.random() * set.length)];
  let s = 'Rb';
  for (let i = 0; i < 4; i += 1) s += pick(letters);
  for (let i = 0; i < 4; i += 1) s += pick(digits);
  return `${s}!`;
};

const label = { fontSize: '0.82rem', fontWeight: 700, color: '#444', marginBottom: '0.25rem', display: 'block' };
const input = { width: '100%', padding: '0.5rem 0.65rem', border: '1px solid #d9d9d9', borderRadius: '6px', fontSize: '0.9rem', boxSizing: 'border-box', background: '#fff', color: '#222' };

function UserEditModal({ user, isSelf, apiHost, authHeaders, onClose, onSaved, showToast }) {
  const [form, setForm] = useState({
    email: user.email || '',
    name: user.name || '',
    phone: user.phone || '',
    department: user.department || '',
    address: user.address || '',
    role: user.role || 'viewer',
    status: user.status || 'ACTIVE',
    financeTeam: user.financeTeam === true,
    password: ''
  });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.email.trim() || !form.name.trim() || !form.phone.trim() || !form.department.trim()) {
      setError('아이디(이메일), 이름, 연락처, 소속은 비워 둘 수 없습니다.');
      return;
    }
    if (form.password && !PASSWORD_POLICY.test(form.password)) {
      setError('비밀번호는 영문, 숫자, 특수문자를 포함하여 8자 이상이어야 합니다.');
      return;
    }
    const body = {
      email: form.email.trim(),
      name: form.name.trim(),
      phone: form.phone.trim(),
      department: form.department.trim(),
      address: form.address,
      financeTeam: form.financeTeam
    };
    if (!isSelf) { body.role = form.role; body.status = form.status; }
    if (form.password) body.password = form.password;

    setSaving(true);
    try {
      const res = await fetch(`${apiHost}/api/users/${user._id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.message || '저장하지 못했습니다.'); return; }
      showToast(form.password
        ? `${data.name} 님 정보를 저장하고 비밀번호를 바꿨습니다. 새 비밀번호를 본인에게 알려 주세요.`
        : `${data.name} 님 정보를 저장했습니다.`, 'success');
      onSaved(data);
    } catch {
      setError('서버 통신 오류');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
        style={{ background: '#fff', borderRadius: '12px', width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto', padding: '1.5rem', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#222' }}>사용자 정보 수정 — {user.name}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666' }} aria-label="닫기"><X size={20} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.8rem' }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <span style={label}>아이디 (이메일)</span>
            <input style={input} value={form.email} onChange={set('email')} />
          </div>
          <div><span style={label}>이름</span><input style={input} value={form.name} onChange={set('name')} /></div>
          <div><span style={label}>연락처</span><input style={input} value={form.phone} onChange={set('phone')} /></div>
          <div><span style={label}>소속 / 부서</span><input style={input} value={form.department} onChange={set('department')} /></div>
          <div><span style={label}>주소</span><input style={input} value={form.address} onChange={set('address')} /></div>
          <div>
            <span style={label}>권한</span>
            <select style={input} value={form.role} onChange={set('role')} disabled={isSelf} title={isSelf ? '자기 자신의 권한은 바꿀 수 없습니다.' : ''}>
              <option value="viewer">조회 권한 (Viewer)</option>
              <option value="editor">수정/삭제 권한 (Editor)</option>
              <option value="admin">최고 관리자 권한 (Admin)</option>
            </select>
          </div>
          <div>
            <span style={label}>상태</span>
            <select style={input} value={form.status} onChange={set('status')} disabled={isSelf} title={isSelf ? '자기 자신의 상태는 바꿀 수 없습니다.' : ''}>
              <option value="ACTIVE">활성</option>
              <option value="SUSPENDED">이용 정지</option>
              <option value="PENDING">승인 대기</option>
              <option value="REJECTED">거절됨</option>
            </select>
          </div>
          <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.88rem', fontWeight: 600, color: '#333', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.financeTeam} onChange={set('financeTeam')} />
            자금팀 메뉴 열기 (회사 자금·내부 금리, 회사 장부, 차량별 감가상각)
          </label>

          <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #eee', paddingTop: '0.8rem' }}>
            <span style={label}>비밀번호 초기화 <span style={{ fontWeight: 400, color: '#888' }}>(바꿀 때만 입력 — 비워 두면 그대로)</span></span>
            <div style={{ display: 'flex', gap: '0.4rem' }}>
              <input
                style={{ ...input, flex: 1 }}
                type={showPw ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="새 비밀번호 (영문·숫자·특수문자 8자 이상)"
                value={form.password}
                onChange={set('password')}
              />
              <button type="button" onClick={() => setShowPw((v) => !v)} title={showPw ? '숨기기' : '보기'} style={{ border: '1px solid #d9d9d9', background: '#fff', borderRadius: '6px', padding: '0 0.6rem', cursor: 'pointer' }}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              <button
                type="button"
                onClick={() => { setForm((f) => ({ ...f, password: makeTempPassword() })); setShowPw(true); }}
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid #d9d9d9', background: '#fff', borderRadius: '6px', padding: '0 0.7rem', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap' }}
              >
                <RefreshCw size={14} /> 임시 비밀번호
              </button>
            </div>
          </div>
        </div>

        {error && <div style={{ marginTop: '0.8rem', color: '#cf1322', fontSize: '0.88rem' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.2rem' }}>
          <button type="button" onClick={onClose} style={{ padding: '0.55rem 1.1rem', borderRadius: '6px', border: '1px solid #d9d9d9', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>취소</button>
          <button type="submit" disabled={saving} style={{ padding: '0.55rem 1.3rem', borderRadius: '6px', border: 'none', background: saving ? '#9db4e0' : '#1f3c88', color: '#fff', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default UserEditModal;
