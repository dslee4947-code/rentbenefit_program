/**
 * 차종 검색용 한글·영어 이름 묶음.
 *
 * 갑지의 차종 칸과 갑지번호가 엑셀에서 온 대로 영어(Avante)·한글(아반떼)이 섞여 있다.
 * '아반떼'로 찾아도 'Avante-001'이 나오게, 한 묶음 안의 이름은 모두 같은 차로 본다(대표님 2026-10-30).
 * 새 차종이 엑셀에 들어오면 여기에 한 줄 더한다.
 */
const CAR_MODEL_ALIASES = [
  ['아반떼', 'avante', 'elantra'],
  ['그랜저', 'grander', 'grandeur'],
  ['쏘나타', '소나타', 'sonata'],
  ['팰리세이드', '펠리세이드', 'palisade'],
  ['투싼', 'tucson'],
  ['싼타페', 'santafe', 'santa fe'],
  ['코나', 'cona', 'kona'],
  ['캐스퍼', 'casper'],
  ['아이오닉', 'ionic', 'ioniq'],
  ['카니발', 'carnival'],
  ['쏘렌토', '소렌토', 'sorento'],
  ['스포티지', 'sportage'],
  ['셀토스', 'seltos'],
  ['니로', 'niro'],
  ['레이', 'ray'],
  ['모하비', 'mojave', 'mohave'],
  ['콜레오스', 'koleos'],
  ['벤츠', 'benz', 'mercedes', '메르세데스', '마이바흐', 'maybach'],
  ['테슬라', 'tesla', 'model y', 'model s', 'model 3', 'model x'],
  ['폴스타', 'polestar'],
  ['렉서스', 'lexus', 'es300h', 'rx350h', 'rx 350h'],
  ['알파드', 'alphard', '토요타', 'toyota'],
  ['레인지로버', '레인지 로버', 'range rover', 'range', '랜드로버', 'land rover'],
  ['제네시스', 'genesis', 'g80', 'g90', 'gv70', 'gv80']
];

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 검색어에 맞는 차종 묶음의 다른 이름들을 정규식으로 돌려준다.
 * 두 글자 이상일 때만 본다('레'만 쳐도 레이·레인지로버가 다 나오는 것을 막으려고).
 */
export const carModelRegexesFor = (q) => {
  const nq = norm(q);
  if (nq.length < 2) return [];
  const names = new Set();
  for (const group of CAR_MODEL_ALIASES) {
    if (group.some((name) => norm(name).includes(nq) || (nq.length >= 3 && nq.includes(norm(name)) && norm(name).length >= 3))) {
      group.forEach((name) => names.add(name));
    }
  }
  return [...names].map((name) => new RegExp(escapeRx(name).replace(/\s+/g, '\\s*'), 'i'));
};
