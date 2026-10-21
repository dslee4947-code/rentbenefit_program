import { useEffect, useState } from 'react';

/**
 * 핸드폰에서 인쇄용 문서(견적서·비교견적서)를 원래 크기로 그린 뒤 화면 폭에 맞춰 사진처럼 통째로 줄인다.
 *
 * 문서 폭을 화면에 맞춰 좁히면 제목이 세로로 쪼개지고, 배율(zoom)로 줄이면 아이폰이 작은 글자를
 * 제멋대로 키워 문서가 눌리고 아래가 잘렸다(대표님 2026-10-21). transform으로 줄이면 문서 안 배치는
 * PC·종이와 똑같고 겉모습만 작아진다. 글자가 작으면 두 손가락으로 벌려 확대한다.
 *
 * PC(폭 769px 이상)에서는 아무것도 하지 않는다(null). 인쇄·PDF 때는 mobile.css가 축소를 끈다.
 *
 * @param {{current: HTMLElement|null}} outerRef 문서를 감싼 칸(줄인 높이만큼 자리를 잡는다)
 * @param {{current: HTMLElement|null}} innerRef 문서
 * @param {number} naturalWidth 문서 원래 폭(px)
 * @param {Array} deps 문서가 바뀌는 값(양식 종류 등)
 * @returns {{scale: number, height: number}|null}
 */
export default function usePhoneFit(outerRef, innerRef, naturalWidth, deps = []) {
  const [fit, setFit] = useState(null);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return undefined;
    const phone = window.matchMedia('screen and (max-width: 768px)');
    const measure = () => {
      if (!phone.matches) { setFit(null); return; }
      const scale = Math.min(1, Math.floor((outer.clientWidth / naturalWidth) * 1000) / 1000);
      const height = Math.ceil(inner.offsetHeight * scale);
      setFit((prev) => (prev && prev.scale === scale && prev.height === height ? prev : { scale, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(inner);
    phone.addEventListener('change', measure);
    return () => {
      observer.disconnect();
      phone.removeEventListener('change', measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naturalWidth, ...deps]);

  return fit;
}

/** 줄일 때 문서·바깥 칸에 붙일 스타일. fit이 없으면(PC) 아무것도 바꾸지 않는다. */
export const phoneFitStyles = (fit, naturalWidth) => (fit
  ? {
    outer: { height: `${fit.height}px`, overflow: 'hidden' },
    inner: { width: `${naturalWidth}px`, maxWidth: 'none', margin: 0, transform: `scale(${fit.scale})`, transformOrigin: 'top left' }
  }
  : { outer: undefined, inner: {} });
