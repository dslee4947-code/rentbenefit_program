import html2pdf from 'html2pdf.js';

/**
 * 화면에 보이는 문서를 모양 그대로 A4에 맞춰 인쇄하거나 PDF로 만든다.
 *
 * 규칙은 하나다: 인쇄할 때 글자·여백·칸 너비를 따로 바꾸지 않는다. 화면 폭 그대로 두고 배율(zoom)만 줄인다.
 * 인쇄 전용으로 글자를 줄이면 화면과 종이가 달라지고, 줄여도 안 들어가면 표 오른쪽이 잘린다.
 * (2026-10-07 비교견적서: 화면 900px 표를 A4 폭 733px 안에 욱여넣다가 오른쪽 칸이 잘렸다)
 *
 * 쓰는 법은 docs/print-a4-guide.md.
 */

const MM_TO_PX = 96 / 25.4;
const A4_MM = { portrait: { w: 210, h: 297 }, landscape: { w: 297, h: 210 } };

/** 종이 가장자리 여백(mm). 문서 안에 여백을 이미 그려 둔 양식(장기렌터카 견적서)은 0을 준다. */
export const PRINT_MARGIN_MM = 8;

/**
 * 문서가 화면에서 실제로 차지하는 크기.
 * 안쪽에 스크롤 상자가 있으면 넘친 만큼까지 넣는다(좁은 화면에서 표가 옆으로 넘어가 있을 때,
 * 비교견적서처럼 표가 화면 높이 상자 안에서 세로로 스크롤될 때).
 * 세로로 넘친 만큼을 빼고 재면 배율이 덜 줄어, 인쇄 때 표가 통째로 다음 장으로 밀린다
 * (2026-10-26 비교견적서 6안: 1장에 머리글만, 2장에 표).
 */
const naturalSizeOf = (element) => {
  let overflowX = 0;
  let overflowY = 0;
  element.querySelectorAll('.print-fit-scroll').forEach((box) => {
    overflowX = Math.max(overflowX, box.scrollWidth - box.clientWidth);
    overflowY = Math.max(overflowY, box.scrollHeight - box.clientHeight);
  });
  return {
    width: Math.ceil(Math.max(element.scrollWidth, element.offsetWidth + overflowX)),
    height: Math.ceil(element.scrollHeight + overflowY)
  };
};

/**
 * A4 한 장에 들어가는 배율과 위치를 계산한다.
 * @param {HTMLElement} element 인쇄할 문서(class="print-fit")
 * @param {{orientation?: 'portrait'|'landscape', marginMm?: number, onePage?: boolean}} [options]
 *   onePage: 세로도 한 장에 들어가게 줄인다(기본). false면 폭만 맞추고 길면 다음 장으로 넘긴다.
 */
export const measurePrintFit = (element, { orientation = 'portrait', marginMm = PRINT_MARGIN_MM, onePage = true } = {}) => {
  const { width, height } = naturalSizeOf(element);
  const page = A4_MM[orientation] || A4_MM.portrait;
  const pageW = page.w * MM_TO_PX;
  const pageH = page.h * MM_TO_PX;
  const margin = marginMm * MM_TO_PX;
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2;

  let zoom = availW / width;
  if (onePage) zoom = Math.min(zoom, availH / height);
  // 브라우저마다 반올림이 달라 끝에서 1px 넘쳐 빈 둘째 장이 생기는 것을 막는다
  zoom = Math.floor(zoom * 1000) / 1000 - 0.002;

  // zoom은 요소 자신의 여백에도 걸리므로 위치값은 배율로 나눠 둔다. 폭이 남으면 가운데 둔다.
  const left = (pageW - width * zoom) / 2 / zoom;
  const top = margin / zoom;
  return { width, height, zoom, left, top };
};

const applyFitVars = (element, fit) => {
  element.style.setProperty('--print-fit-width', `${fit.width}px`);
  element.style.setProperty('--print-fit-zoom', String(fit.zoom));
  element.style.setProperty('--print-fit-left', `${fit.left}px`);
  element.style.setProperty('--print-fit-top', `${fit.top}px`);
};

const clearFitVars = (element) => {
  ['--print-fit-width', '--print-fit-zoom', '--print-fit-left', '--print-fit-top']
    .forEach((name) => element.style.removeProperty(name));
};

/**
 * 문서를 A4에 맞춰 인쇄 창을 연다. 인쇄 창에서 'PDF로 저장'을 고르면 같은 모양의 PDF가 된다.
 *
 * 용지 방향(@page size)은 화면 쪽 인쇄 CSS가 정한다. 여기 orientation과 같게 맞춰 둔다.
 * @param {HTMLElement} element
 * @param {{orientation?: string, marginMm?: number, onePage?: boolean, title?: string}} [options]
 *   title: 인쇄 창에서 PDF로 저장할 때 기본 파일 이름
 */
export const printFitted = (element, options = {}) => {
  if (!element) {
    window.print();
    return;
  }
  applyFitVars(element, measurePrintFit(element, options));

  const originalTitle = document.title;
  if (options.title) document.title = options.title;
  const restore = () => {
    clearFitVars(element);
    document.title = originalTitle;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
};

/**
 * 같은 문서를 A4 PDF 파일(Blob)로 만든다. 서버 보관·메일 첨부용.
 *
 * html2pdf는 A4 폭만 한 틀에 문서를 넣고 찍는데, 문서가 그보다 넓으면 오른쪽이 잘린다.
 * 그래서 찍는 동안만 문서를 화면 폭 그대로 펼쳐 두고(print-fit-capture), 찍은 그림을 A4 폭에 맞춰 넣는다.
 * @param {HTMLElement} element
 * @param {{orientation?: string, marginMm?: number, imageType?: 'jpeg'|'png', onePage?: boolean}} [options]
 *   onePage: 길어도 한 장에 들어가게 좌우 여백을 늘려 줄인다(견적서). 기본은 폭만 맞추고 길면 다음 장으로 넘긴다.
 * @returns {Promise<Blob>}
 */
export const makeFittedPdf = async (element, { orientation = 'portrait', marginMm = PRINT_MARGIN_MM, imageType = 'jpeg', onePage = false } = {}) => {
  const { width } = naturalSizeOf(element);
  element.style.setProperty('--print-fit-width', `${width}px`);
  element.classList.add('print-fit-capture');
  try {
    // 펼친 뒤의 높이로 잰다. 폭에 맞춘 높이가 종이를 넘으면 좌우 여백을 늘려 그만큼 줄인다
    let margin = marginMm;
    if (onePage) {
      const page = A4_MM[orientation] || A4_MM.portrait;
      const availW = page.w - marginMm * 2;
      const availH = page.h - marginMm * 2;
      const height = Math.ceil(element.scrollHeight);
      // 끝에서 반올림으로 넘쳐 빈 둘째 장이 생기지 않게 조금 덜 채운다
      const fitW = Math.min(availW, (availH * 0.99 * width) / height);
      if (fitW < availW) {
        const side = (page.w - fitW) / 2;
        margin = [marginMm, side, marginMm, side];
      }
    }
    return await html2pdf()
      .set({
        margin,
        // jpeg로 뜬다. png는 한 장에 8MB가 넘어 저장도 메일도 느려진다(표처럼 선이 많은 양식은 png를 골라도 된다).
        image: imageType === 'png' ? { type: 'png' } : { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, width, windowWidth: width },
        jsPDF: { unit: 'mm', format: 'a4', orientation },
        pagebreak: { mode: ['avoid-all', 'css'] }
      })
      .from(element)
      .outputPdf('blob');
  } finally {
    element.classList.remove('print-fit-capture');
    element.style.removeProperty('--print-fit-width');
  }
};
