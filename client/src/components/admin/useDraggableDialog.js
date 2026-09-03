import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * 팝업창을 제목 줄로 잡아 끌어 옮길 수 있게 한다.
 *
 * 내용이 긴 팝업은 화면 높이를 넘길 수 있는데, 세로 가운데 정렬이면 위아래로 같이 넘쳐서
 * 제목 줄이 화면 밖으로 나가 버리고 스크롤로도 닿지 않는다.
 * 그래서 팝업은 위쪽에서 조금 내려온 자리에 띄우고(overlayStyle), 필요하면 끌어서 옮긴다.
 *
 * @param {boolean} open 팝업이 열려 있는지. 열 때마다 위치를 처음 자리로 되돌린다.
 */
export function useDraggableDialog(open) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);

  // 팝업을 새로 열면 이전에 옮겨 둔 위치가 남지 않도록 되돌린다
  useEffect(() => {
    if (open) setPos({ x: 0, y: 0 });
  }, [open]);

  const onMouseDown = useCallback((e) => {
    // 닫기 버튼이나 입력칸에서 시작한 클릭은 드래그로 보지 않는다
    if (e.target.closest('button, input, select, textarea, a')) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y };
    e.preventDefault();
  }, [pos.x, pos.y]);

  useEffect(() => {
    const handleMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      // 팝업을 화면 밖으로 완전히 내보내면 다시 잡을 수 없으므로 이동 범위를 제한한다
      const limitX = window.innerWidth * 0.4;
      const limitY = window.innerHeight * 0.4;
      const clamp = (v, limit) => Math.max(-limit, Math.min(limit, v));
      setPos({
        x: clamp(d.originX + e.clientX - d.startX, limitX),
        y: clamp(d.originY + e.clientY - d.startY, limitY)
      });
    };
    const handleUp = () => { dragRef.current = null; };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  return {
    // 제목 줄에 펼쳐 넣는다
    dragHandleProps: { onMouseDown, style: { cursor: 'move', userSelect: 'none' } },
    // 팝업 본체에 펼쳐 넣는다 (끌어 옮긴 만큼 이동)
    dragStyle: { transform: `translate(${pos.x}px, ${pos.y}px)` }
  };
}

/**
 * 팝업 위 여백.
 *
 * 팝업 제목 줄이 페이지 제목(예: '렌트차량 DB 관리')과 같은 높이에 오도록 맞춘 값이다.
 * 페이지 제목은 본문 안쪽 여백 2.5rem(40px) 아래에 있고,
 * 팝업 제목은 이 여백 + 제목 줄 안쪽 여백 1.2rem(19.2px) 아래에 있어
 * 두 글자의 중심이 맞는 지점이 28px이다.
 *
 * 페이지 제목 위치는 화면 높이와 무관하게 늘 같으므로 vh가 아니라 고정 px를 쓴다.
 */
export const DIALOG_TOP = '28px';
