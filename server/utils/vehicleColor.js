/**
 * 한 칸에 같이 적힌 외장/내장 색상을 나눈다.
 *
 * 운영 엑셀은 색상을 한 칸에 "외장 / 내장" 형태로 적어 왔다.
 *   마칼루 그레이 / 슬레이트그래이(보르도브라운 시트)/올리브애쉬
 *
 * 나누는 기준은 '첫 번째 /' 하나다. 두 번째 뒤부터는 내장 색상이 여러 개인 것이라
 * 내장 색상 안에 그대로 둔다. 위 예는 이렇게 나뉜다.
 *   외장: 마칼루 그레이
 *   내장: 슬레이트그래이(보르도브라운 시트)/올리브애쉬
 */

/**
 * @param {string} raw 한 칸에 적힌 색상
 * @returns {{ exteriorColor: string, interiorColor: string }}
 *   나눌 수 없으면 interiorColor는 빈 문자열이고 exteriorColor는 원래 값 그대로다.
 */
export const splitColorValue = (raw) => {
  const text = String(raw ?? '').trim();
  if (!text) return { exteriorColor: '', interiorColor: '' };

  const slash = text.indexOf('/');
  if (slash === -1) return { exteriorColor: text, interiorColor: '' };

  const exterior = text.slice(0, slash).trim();
  const interior = text.slice(slash + 1).trim();

  // 한쪽이 비면 나눌 수 있는 값이 아니다("/블랙"처럼 적힌 칸). 원래 값을 지키는 편이 낫다.
  if (!exterior || !interior) return { exteriorColor: text, interiorColor: '' };

  return { exteriorColor: exterior, interiorColor: interior };
};

/**
 * 차량 값의 외장 색상 칸에 내장 색상이 함께 들어 있으면 두 칸으로 나눠 담는다.
 * 내장 색상 칸에 이미 값이 있으면 건드리지 않는다(따로 적어 둔 값이 정본).
 *
 * @param {object} payload 저장 직전의 차량 값
 * @returns {{ changed: boolean, conflict: string }} 나눴는지, 그리고 내장 칸이 이미 차 있어 못 나눈 값
 */
export const applyColorSplit = (payload) => {
  if (!payload) return { changed: false, conflict: '' };

  const { exteriorColor, interiorColor } = splitColorValue(payload.exteriorColor);
  if (!interiorColor) return { changed: false, conflict: '' };

  const existing = String(payload.interiorColor ?? '').trim();
  if (existing && existing !== interiorColor) {
    // 외장 칸에서 떼어낸 값과 내장 칸의 값이 다르다. 어느 쪽이 맞는지는 사람이 봐야 한다.
    return { changed: false, conflict: interiorColor };
  }

  payload.exteriorColor = exteriorColor;
  payload.interiorColor = interiorColor;
  return { changed: true, conflict: '' };
};
