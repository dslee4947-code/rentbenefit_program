/**
 * 대폐차 신고서 (여객자동차 운수사업법 시행규칙 별지 제15호서식, 자동차대여사업계획 변경 신고서).
 * 차를 팔거나 바꿔 신고할 때 낸다. 1쪽 ⑥ 변경 전에 차량번호, 2쪽 별첨에 차마다 차량명·차량번호·차대번호를 적는다.
 * 양식: Dropbox 2. 증차공문 등록서류/3. 감차서류/대폐차_신고서양식.pdf
 */

export const SCRAP_STATUSES = ['작성중', '제출', '처리완료', '취소'];
export const SCRAP_REASONS = ['차량 매각', '해외 수출로 매각', '폐차'];
export const SCRAP_ROWS = 20;
export const SCRAP_MAIL_TO = 'scra@scra.or.kr'; // 서울시자동차대여사업조합
export const SCRAP_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
// 메일 한 통은 4MB까지라(Graph), 파일을 글자로 바꾸며 3분의 1이 늘어나는 것과 서명 그림을 빼면 첨부는 이만큼이다
export const SCRAP_MAIL_LIMIT = 2.8 * 1024 * 1024;

/** 조합에 보내는 메일의 처음 글. 보내기 전에 화면에서 고칠 수 있다. */
export const scrapMailDraft = (filing) => {
  const items = filing.items || [];
  const first = items[0]?.before || {};
  const plates = items.length > 1 ? `${first.plateNo} 외 ${items.length - 1}대` : first.plateNo || '';
  return {
    subject: `[㈜렌트베네핏] 대폐차 신고서 제출 (${plates})`,
    body: [
      '안녕하십니까. ㈜렌트베네핏입니다.',
      '',
      '아래 차량의 대폐차 신고서와 자동차등록증을 보내드립니다.',
      '',
      ...items.map((it, i) => `${i + 1}. ${[it.before?.carName, it.before?.plateNo].filter(Boolean).join(' ')}${it.before?.vin ? ` (차대번호 ${it.before.vin})` : ''}${it.after?.plateNo ? ` → ${[it.after.carName, it.after.plateNo].filter(Boolean).join(' ')}` : ''}`),
      '',
      ...(filing.reason ? [`변경사유 : ${filing.reason}`] : []),
      '첨부 : 대폐차 신고서, 자동차등록증',
      '',
      '확인 후 처리 부탁드립니다.',
      '감사합니다.'
    ].join('\n')
  };
};

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
