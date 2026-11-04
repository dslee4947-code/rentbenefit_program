import { useCallback, useEffect, useRef, useState } from 'react';

// 지금 화면의 '저장 안 한 내용' 확인. 왼쪽 메뉴처럼 화면 바깥에서 나갈 때도 묻도록 한 곳에 둔다.
let activeGuard = null;

/** 저장 안 한 내용이 있으면 먼저 묻고, 없으면 바로 next를 부른다 */
export const confirmLeave = (next) => {
  if (activeGuard) activeGuard(next);
  else next();
};

/**
 * 저장하지 않고 나가려 할 때 '저장하시겠습니까?'를 묻는다(대표님 2026-11-04).
 * 브라우저 창을 닫거나 새로고침할 때는 직접 창을 띄울 수 없어 브라우저 기본 확인창이 뜬다.
 *
 * @param {boolean} dirty 저장 안 한 내용이 있는지
 * @param {() => Promise<boolean>} save 저장. 성공하면 true
 * @returns {{askThen: (next: () => void) => void, unsavedDialog: JSX.Element|null}}
 */
export function useUnsavedPrompt(dirty, save) {
  const [next, setNext] = useState(null); // 답을 받은 뒤 이어서 할 일
  const [saving, setSaving] = useState(false);
  const latest = useRef({ dirty, save });
  useEffect(() => { latest.current = { dirty, save }; });

  const askThen = useCallback((fn) => {
    if (latest.current.dirty) setNext(() => fn);
    else fn();
  }, []);

  useEffect(() => {
    if (!dirty) return undefined;
    const guard = (fn) => setNext(() => fn);
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    activeGuard = guard;
    window.addEventListener('beforeunload', warn);
    return () => {
      if (activeGuard === guard) activeGuard = null;
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);

  const finish = (fn) => { setNext(null); fn(); };
  const saveThenGo = async () => {
    setSaving(true);
    const ok = await latest.current.save();
    setSaving(false);
    if (ok) finish(next);
    else setNext(null); // 저장 실패 안내를 보고 다시 고칠 수 있게 화면에 남는다
  };

  const btn = (filled) => ({
    flex: '1 1 90px', minHeight: '40px', padding: '0.5rem 0.8rem', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 700,
    cursor: saving ? 'wait' : 'pointer',
    border: `1px solid ${filled ? 'var(--primary)' : 'var(--border-color)'}`,
    background: filled ? 'var(--primary)' : '#fff',
    color: filled ? '#fff' : 'var(--text-main)'
  });

  const unsavedDialog = next ? (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, zIndex: 5000, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div style={{ background: '#fff', borderRadius: '12px', padding: '1.2rem', width: '100%', maxWidth: '360px', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        <div>
          <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-bright)' }}>저장하시겠습니까?</div>
          <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>수정한 내용이 아직 저장되지 않았습니다.</div>
        </div>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <button type="button" autoFocus disabled={saving} onClick={saveThenGo} style={btn(true)}>{saving ? '저장 중...' : '저장'}</button>
          <button type="button" disabled={saving} onClick={() => finish(next)} style={btn(false)}>저장 안 함</button>
          <button type="button" disabled={saving} onClick={() => setNext(null)} style={btn(false)}>취소</button>
        </div>
      </div>
    </div>
  ) : null;

  return { askThen, unsavedDialog };
}
