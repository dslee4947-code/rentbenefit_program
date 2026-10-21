import { useEffect, useRef } from 'react';

/**
 * 뒤로 가기(핸드폰에서 화면 왼쪽 끝을 오른쪽으로 쓸기, 안드로이드 뒤로 버튼, 브라우저 ←)로
 * 열려 있는 상세 화면·창을 닫는다.
 *
 * 메뉴(탭)만 주소(#/ledgers)에 남고 그 안에서 연 갑지·청구서·창은 주소에 없어서,
 * 뒤로 가면 목록이 아니라 그 앞 메뉴(처음 화면)로 넘어갔다(대표님 2026-10-21).
 * 열 때 같은 주소로 기록을 한 칸 쌓아 두고, 뒤로 가면 그 칸만 빠지면서 닫히게 한다.
 * 화면의 [목록]·[닫기] 버튼으로 닫으면 쌓아 둔 칸을 같이 지운다.
 * 창 안에서 또 창을 열면 칸이 겹겹이 쌓이고, 뒤로 갈 때마다 가장 안쪽 것부터 닫힌다.
 *
 * @param {boolean} open 상세 화면·창이 열려 있는지
 * @param {() => (boolean|void)} onBack 닫는 함수. false를 돌려주면(저장 안 한 내용이 있어 취소 등) 닫지 않고 그대로 둔다.
 */
export default function useBackClose(open, onBack) {
  const onBackRef = useRef(onBack);
  // 닫는 함수는 렌더마다 새로 만들어지므로 가장 최근 것을 쓴다
  useEffect(() => { onBackRef.current = onBack; });
  const entry = useRef({ depth: 0, timer: null });

  useEffect(() => {
    if (!open) return undefined;
    const e = entry.current;
    if (e.timer) {
      // 개발 모드(StrictMode)는 효과를 지웠다 바로 다시 건다. 이미 쌓은 칸을 그대로 쓴다.
      clearTimeout(e.timer);
      e.timer = null;
    } else {
      e.depth = (window.history.state?.backDepth || 0) + 1;
      window.history.pushState({ ...(window.history.state || {}), backDepth: e.depth }, '');
    }

    let closedByBack = false;
    const onPop = () => {
      // 더 안쪽 창의 칸이 빠진 것이면 이 화면은 그대로 둔다
      if ((window.history.state?.backDepth || 0) >= e.depth) return;
      if (onBackRef.current() === false) {
        window.history.pushState({ ...(window.history.state || {}), backDepth: e.depth }, '');
        return;
      }
      closedByBack = true;
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      if (closedByBack) return;
      // 버튼으로 닫았다: 쌓아 둔 칸을 지운다(같은 주소라 화면은 그대로)
      e.timer = setTimeout(() => {
        e.timer = null;
        if (window.history.state?.backDepth === e.depth) window.history.back();
      }, 0);
    };
  }, [open]);
}
