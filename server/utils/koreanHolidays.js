/**
 * 대한민국 공휴일.
 *
 * 설날·추석·부처님오신날은 음력이라 계산으로 뽑을 수 없다. 음력 변환표를 코드에 넣는 것보다
 * 확정된 날짜를 적어 두는 편이 읽기도 고치기도 쉽다. 매년 12월에 다음 해를 한 줄씩 더하면 된다.
 *
 * 표에 없는 해는 주말만 쉬는 날로 본다. 청구서가 공휴일에 나가는 것보다
 * 프로그램이 멈추는 편이 더 나쁘기 때문이다. 대신 로그로 알린다.
 *
 * 선거일·임시공휴일은 갑자기 정해져서 미리 적어 둘 수 없다.
 * 그때는 서버 환경변수 EXTRA_HOLIDAYS에 'YYYY-MM-DD,YYYY-MM-DD'로 넣으면 바로 반영된다.
 */

// 대체공휴일까지 반영한 확정 공휴일. (신정·현충일은 대체공휴일 대상이 아니다)
const HOLIDAYS = {
  2025: [
    '01-01', // 신정
    '01-27', '01-28', '01-29', '01-30', // 설 연휴 (01-27 임시공휴일)
    '03-01', '03-03', // 삼일절(토) · 대체
    '05-05', '05-06', // 어린이날 + 부처님오신날 겹침 · 대체
    '06-06', // 현충일
    '08-15', // 광복절
    '10-03', // 개천절
    '10-05', '10-06', '10-07', '10-08', // 추석 연휴 · 대체
    '10-09', // 한글날
    '12-25' // 성탄절
  ],
  2026: [
    '01-01', // 신정
    '02-16', '02-17', '02-18', // 설 연휴
    '03-01', '03-02', // 삼일절(일) · 대체
    '05-05', // 어린이날
    '05-24', '05-25', // 부처님오신날(일) · 대체
    '06-06', // 현충일(토)
    '08-15', '08-17', // 광복절(토) · 대체
    '09-24', '09-25', '09-26', '09-28', // 추석 연휴 · 대체
    '10-03', '10-05', // 개천절(토) · 대체
    '10-09', // 한글날
    '12-25' // 성탄절
  ],
  2027: [
    '01-01', // 신정
    '02-06', '02-07', '02-08', '02-09', '02-10', // 설 연휴(토·일 겹침) · 대체 2일
    '03-01', // 삼일절
    '05-05', // 어린이날
    '05-13', // 부처님오신날
    '06-06', // 현충일(일)
    '08-15', '08-16', // 광복절(일) · 대체
    '09-14', '09-15', '09-16', // 추석 연휴
    '10-03', '10-04', // 개천절(일) · 대체
    '10-09', '10-11', // 한글날(토) · 대체
    '12-25', '12-27' // 성탄절(토) · 대체
  ]
};

/** 갑자기 정해지는 임시공휴일·선거일. 서버 환경변수로 넣는다. */
const extraHolidays = new Set(
  String(process.env.EXTRA_HOLIDAYS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))
);

// 표에 없는 해를 만났을 때 한 번만 알린다. 매일 도는 작업이라 그냥 두면 로그가 덮인다.
const warnedYears = new Set();

/** 날짜를 YYYY-MM-DD로. UTC로 바꾸면 하루 밀리므로 지역 시각 그대로 읽는다. */
const ymd = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * 주말인지.
 * @param {Date} date 날짜
 * @returns {boolean}
 */
export const isWeekend = (date) => date.getDay() === 0 || date.getDay() === 6;

/**
 * 공휴일인지. 주말은 포함하지 않는다(따로 본다).
 * @param {Date} date 날짜
 * @returns {boolean}
 */
export const isPublicHoliday = (date) => {
  const key = ymd(date);
  if (extraHolidays.has(key)) return true;

  const year = date.getFullYear();
  const list = HOLIDAYS[year];
  if (!list) {
    if (!warnedYears.has(year)) {
      warnedYears.add(year);
      console.warn(`[공휴일] ${year}년 공휴일 표가 없습니다. 주말만 쉬는 날로 봅니다. koreanHolidays.js에 추가해 주세요.`);
    }
    return false;
  }
  return list.includes(key.slice(5));
};

/**
 * 쉬는 날인지 (주말 또는 공휴일).
 * @param {Date|string} date 날짜
 * @returns {boolean}
 */
export const isHoliday = (date) => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return false;
  return isWeekend(d) || isPublicHoliday(d);
};

/**
 * 그 날이 쉬는 날이면 앞의 영업일로 당긴다.
 *
 * 뒤로 미루지 않고 앞으로 당기는 이유: 청구서는 출금일 전에 도착해야 법인이 결재를 올린다.
 * 하루 늦으면 그 달 출금이 밀린다. 하루 이른 것은 아무 일도 아니다.
 *
 * @param {Date|string} date 원래 날짜
 * @param {number} [maxShift] 최대 며칠까지 당길지 (연휴가 길어도 무한히 돌지 않게)
 * @returns {Date|null} 앞의 영업일
 */
export const previousBusinessDay = (date, maxShift = 14) => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;

  for (let i = 0; i <= maxShift; i += 1) {
    if (!isHoliday(d)) return d;
    d.setDate(d.getDate() - 1);
  }
  return d; // 연휴가 2주를 넘는 일은 없지만, 넘으면 그냥 그 날을 쓴다
};
