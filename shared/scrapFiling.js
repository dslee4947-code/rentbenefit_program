/**
 * 대폐차 신고서 (여객자동차 운수사업법 시행규칙 별지 제15호서식, 자동차대여사업계획 변경 신고서).
 * 차를 팔거나 바꿔 신고할 때 낸다. 1쪽 ⑥ 변경 전에 차량번호, 2쪽 별첨에 차마다 차량명·차량번호·차대번호를 적는다.
 * 양식: Dropbox 2. 증차공문 등록서류/3. 감차서류/대폐차_신고서양식.pdf
 */

export const SCRAP_STATUSES = ['작성중', '제출', '처리완료', '취소'];
export const SCRAP_REASONS = ['차량 매각', '해외 수출로 매각', '폐차'];
export const SCRAP_ROWS = 20;

const KOREAN_NAMES = {
  ray: '레이', casper: '캐스퍼', avante: '아반떼', sportage: '스포티지', sorento: '쏘렌토', carnival: '카니발',
  grander: '그랜저', cona: '코나', kona: '코나', palisade: '팰리세이드', mojave: '모하비'
};
const TWO_WORDS = /^(model|grand|maybach|rx|cle)$/i;

/** 별첨 차량명 칸은 좁아 "Ray Van 스탠다드 A/T" → "레이"처럼 짧게 쓴다. */
export const scrapCarName = (model) => {
  const words = String(model || '').trim()
    .replace(/^(디\s*올\s*뉴|더\s*뉴|올\s*뉴|뉴)\s+/, '')
    .replace(/^(현대|기아|제네시스|벤츠)\s+/, '')
    .split(/\s+/);
  const first = words[0].replace(/\(H\)$/i, '');
  if (KOREAN_NAMES[first.toLowerCase()]) return KOREAN_NAMES[first.toLowerCase()];
  return TWO_WORDS.test(first) && words[1] ? `${first} ${words[1]}` : first;
};

/** 1쪽 ⑥ 칸은 여섯 대까지 들어간다. 넘으면 "외 N대 (별첨)". */
export const platesText = (plates) => {
  const list = plates.filter(Boolean);
  return list.length > 6 ? `${list.slice(0, 2).join(', ')} 외 ${list.length - 2}대 (별첨)` : list.join(', ');
};
