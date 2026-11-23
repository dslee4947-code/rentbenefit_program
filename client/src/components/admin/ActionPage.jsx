import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft } from 'lucide-react';

/**
 * 계약 연장·만료(반납·인수)처럼 한 가지 일을 끝까지 하는 화면을 '새 페이지'로 띄운다(대표님 2026-11-23).
 *
 * 예전에는 팝업이었는데, 대시보드·견적서 아래쪽에서 누르면 창이 페이지 맨 위에 떠 화면이 어두워지기만 하고
 * 오류처럼 보였다. 그래서 화면 전체를 덮는 페이지로 열고 늘 맨 위부터 보여 준다.
 * document.body에 바로 붙여(포털) 부모의 transform·스크롤 위치와 상관없이 같은 자리에 뜬다.
 * 브라우저 [뒤로]를 눌러도 원래 화면으로 돌아간다.
 *
 * @param {object} props
 * @param {React.ReactNode} props.title 페이지 제목
 * @param {React.ReactNode} [props.icon]
 * @param {() => void} props.onClose 돌아가기
 * @param {number} [props.width] 본문 최대 폭(px)
 */
let openCount = 0;

function ActionPage({ title, icon, onClose, width = 760, children }) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    // 뒤로 가기로 닫을 수 있게 기록을 하나 쌓는다. 단추로 닫으면 쌓은 기록을 되돌린다.
    // 개발 모드(StrictMode)는 붙였다 뗐다 다시 붙이므로, 되돌리기는 잠깐 뒤 열린 페이지가 없을 때만 한다.
    let poppedByBack = false;
    openCount += 1;
    if (!window.history.state?.actionPage) window.history.pushState({ actionPage: true }, '');
    const onPop = () => { poppedByBack = true; closeRef.current?.(); };
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current?.(); };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      openCount -= 1;
      setTimeout(() => {
        if (!poppedByBack && openCount === 0 && window.history.state?.actionPage) window.history.back();
      }, 0);
    };
  }, []);

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--bg-main, #f8fafc)', overflowY: 'auto' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 1, background: '#fff', borderBottom: '1px solid var(--border-color)', padding: 'calc(env(safe-area-inset-top, 0px) + 0.7rem) 1rem 0.7rem' }}>
        <div style={{ maxWidth: `${width}px`, margin: '0 auto', display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <button type="button" onClick={onClose}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', border: '1px solid var(--border-color)', background: '#fff', borderRadius: '8px', padding: '0.4rem 0.8rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', color: 'var(--text-bright)' }}>
            <ArrowLeft size={16} /> 돌아가기
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, fontSize: '1.15rem', color: 'var(--text-bright)' }}>{icon}{title}</div>
        </div>
      </div>
      <div style={{ maxWidth: `${width}px`, margin: '1.2rem auto 3rem', padding: '0 1rem', boxSizing: 'border-box' }}>
        <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ActionPage;
