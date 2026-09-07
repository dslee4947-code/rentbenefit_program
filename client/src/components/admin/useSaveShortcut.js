import { useEffect, useRef } from 'react';

/**
 * Ctrl+S(맥은 ⌘+S)로 저장.
 *
 * 입력 칸이 많은 화면은 저장 단추까지 마우스를 옮기는 것보다 손이 키보드에 있을 때
 * 바로 저장하는 편이 빠르다. 브라우저의 '페이지 저장' 창은 항상 막는다.
 *
 * 팝업이 겹쳐 떠 있을 때는 가장 나중에 열린 것 하나만 저장한다.
 * 안 그러면 뒤에 있는 팝업까지 함께 저장돼, 보이지도 않는 화면의 내용이 서버로 넘어간다.
 *
 * 쓰는 법:
 *   useSaveShortcut(showModal && !saving, handleSave);
 *
 * @param {boolean} enabled 이 화면(또는 팝업)이 지금 저장을 받을 수 있는 상태인지
 * @param {Function} onSave 저장 함수. 인자 없이 불린다.
 */

// 지금 열려 있는 저장 대상들. 마지막 것이 가장 위에 있는 화면이다.
const activeTargets = [];
let listening = false;

const handleKeyDown = (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (String(e.key || '').toLowerCase() !== 's') return;

  // 저장할 화면이 없어도 브라우저 저장 창은 뜨지 않게 막는다.
  // 이 사이트에서 Ctrl+S는 '내용 저장'이지 '페이지 파일로 저장'이 아니다.
  e.preventDefault();
  if (e.repeat) return; // 꾹 누르고 있을 때 여러 번 저장되지 않게

  const target = activeTargets[activeTargets.length - 1];
  target?.run();
};

const startListening = () => {
  if (listening) return;
  // 캡처 단계에서 받는다. 입력 칸이나 편집기가 먼저 가로채도 저장이 동작해야 한다.
  window.addEventListener('keydown', handleKeyDown, true);
  listening = true;
};

export function useSaveShortcut(enabled, onSave) {
  // 저장 함수는 렌더마다 새로 만들어지므로, 최신 것을 가리키게만 해 두고
  // 등록/해제는 enabled가 바뀔 때만 한다.
  // (그려지는 도중이 아니라 그려진 뒤에 바꾼다. 실제로 부르는 시점은 키를 누른 뒤라 늦지 않다)
  const saveRef = useRef(onSave);
  useEffect(() => {
    saveRef.current = onSave;
  });

  useEffect(() => {
    if (!enabled) return undefined;

    startListening();
    const target = { run: () => saveRef.current?.() };
    activeTargets.push(target);

    return () => {
      const index = activeTargets.indexOf(target);
      if (index >= 0) activeTargets.splice(index, 1);
    };
  }, [enabled]);
}

export default useSaveShortcut;
