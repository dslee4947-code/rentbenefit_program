/**
 * 엑셀 날짜 칸(SheetJS cellDates)이 준 Date를 '그 날짜'의 UTC 자정으로 바꾼다.
 *
 * SheetJS는 날짜 칸을 서버 시간대의 자정으로 만드는데, 한국 시간대에서는 옛 표준시 차이(52초)가 끼어
 * 전날 23:59:08이 된다(UTC 14:59:08). 그대로 저장하면 화면에 하루 전 날짜로 보였다
 * (엑셀 2023-07-05 입금이 프로그램에서 07-04, 대표님 2026-10-22).
 * 반나절을 더한 뒤 그 시간대의 연·월·일을 읽으면 서버가 한국이든 UTC든 엑셀에 적힌 날짜가 나온다.
 * 글자로 적힌 날짜('2022-01-05')를 new Date로 읽은 값과 같은 모양(UTC 자정)이 된다.
 *
 * @param {Date} d SheetJS가 준 날짜
 * @returns {Date}
 */
export const excelCellDate = (d) => {
  const t = new Date(d.getTime() + 12 * 3600 * 1000);
  return new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()));
};

/** 위 문제로 저장된 값인지(UTC 14:59:08). 한국 자정 52초 전이라 사람이 일부러 넣을 시각이 아니다. */
export const isShiftedExcelDate = (d) => d instanceof Date
  && d.getUTCHours() === 14 && d.getUTCMinutes() === 59 && d.getUTCSeconds() === 8 && d.getUTCMilliseconds() === 0;

/** 위 문제로 저장된 값을 원래 날짜의 UTC 자정으로 */
export const fixShiftedExcelDate = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
