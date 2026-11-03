/**
 * 계약종료 확인서의 종료 구분. 구분마다 날짜 칸 이름, 차량회수지 칸 여부, 안내 문구가 다르다.
 * 양식: Dropbox "09.중도해지/중도해지 위약금_260220.xlsx" '계약종료 확인서' 시트(대표님 2026-11-03)
 */
export const END_KINDS = {
  early: {
    label: '중도해지',
    dateLabel: '중도해지일',
    pickup: true,
    lines: (date) => [
      '고객님의 무궁한 발전을 기원합니다.',
      `렌트베네핏과 고객님의 장기렌트 계약이 ${date} 중도해지로 종료되었음을 알려 드립니다.`,
      '중도해지에 따른 정산(미납 렌트료, 위약금, 초과운행부담금, 보증금 상계 등)이 모두 끝났음을 확인합니다.',
      '그동안 렌트베네핏을 이용해 주셔서 진심으로 감사드립니다.'
    ]
  },
  takeover: {
    label: '만기 후 인수',
    dateLabel: '차량인수일',
    pickup: false,
    lines: (date) => [
      '고객님의 무궁한 발전을 기원합니다.',
      `계약기간 만료에 따라 고객님께서 ${date} 차량을 인수하시어 렌트베네핏과의 장기렌트 계약이 종료되었음을 알려 드립니다.`,
      '인수 대금과 계약에 따른 정산이 모두 끝났음을 확인합니다. 명의 이전일 이후의 자동차세·보험·과태료 등은 새 소유자께 부과됩니다.',
      '렌트베네핏과 함께 계약 기간 내 노력과 좋은 결과를 이루어 내주셔서 감사의 인사를 드립니다.'
    ]
  },
  return: {
    label: '만기 후 반납',
    dateLabel: '차량반납일',
    pickup: true,
    lines: (date) => [
      '고객님의 무궁한 발전을 기원합니다.',
      `계약기간 만료에 따라 ${date} 차량을 반납받아 렌트베네핏과 고객님의 장기렌트 계약이 종료되었음을 알려 드립니다.`,
      '반납 차량 점검과 계약에 따른 정산(보증금 반환 등)이 모두 끝났음을 확인합니다.',
      '렌트베네핏과 함께 계약 기간 내 노력과 좋은 결과를 이루어 내주셔서 감사의 인사를 드립니다.'
    ]
  }
};

const DAY = 864e5;
const ymdTime = (ymd) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd || '') ? Date.parse(`${ymd}T00:00:00Z`) : NaN);

/**
 * 중도해지 예상 위약금. 엑셀 '중도해지 정산서 계산식'과 같은 식이다.
 *   1일 대여료 = 월 대여료(VAT 포함) × 12 ÷ 365, 10원 아래 버림
 *   1일 대여료(VAT 제외) = 1일 대여료 ÷ 1.1 (곱할 때는 끝수를 두고, 보여 줄 때만 반올림)
 *   위약금 = 1일 대여료(VAT 제외) × 미경과일수(만료일 − 해지일) × 위약금율, 원 아래 버림
 * @param {{ monthlyFee: number, endDate: string, terminateDate: string, ratePct: number }} p  ratePct = 35 (35%)
 * @returns {{ days: number, daily: number, dailySupply: number, penalty: number } | null}
 */
export const earlyPenalty = ({ monthlyFee, endDate, terminateDate, ratePct }) => {
  const end = ymdTime(endDate);
  const term = ymdTime(terminateDate);
  if (!monthlyFee || !ratePct || Number.isNaN(end) || Number.isNaN(term)) return null;
  const days = Math.max(0, Math.round((end - term) / DAY));
  const daily = Math.floor((monthlyFee * 12) / 365 / 10) * 10;
  return { days, daily, dailySupply: Math.round(daily / 1.1), penalty: Math.floor((daily / 1.1) * days * (ratePct / 100)) };
};

/** 위약금율(%). 화면에서 적은 값이 우선이고, 없으면 계약 값('35%'처럼 온다) */
export const ratePctOf = (doc, override) => Number.parseFloat(override) || Number.parseFloat(doc?.earlyRate) || 0;
