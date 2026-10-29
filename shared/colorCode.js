/**
 * 차량 색상 이름(한글·영문·약자 섞임)을 영어 두 글자 약자로 줄인다. 단기렌트 요금표에 '외장/내장'으로 쓴다.
 * 예: '옵시디언 블랙' / '블랙 모노톤' → 'bl/bl', '폴라 화이트' / '브라운' → 'wh/br'
 * 이름 안에서 가장 앞에 나오는 색 낱말을 고른다 ('인디고/브라운투톤' → nv, '스모키그린(어스브라운 시트)' → gn).
 */
const COLOR_WORDS = [
  ['wh', ['화이트', '확이트', '흰', '백색', '클라우드', 'white', 'pw', 'p.w']],
  ['bl', ['블랙', '검정', '흑색', 'black', 'ob', 'bl']],
  ['gr', ['그레이', '그래이', '회색', '차콜', '그라파이트', 'grey', 'gray', 'graphite', 'charcoal']],
  ['si', ['실버', '은색', 'silver']],
  ['br', ['브라운', '갈색', '토프', 'brown', 'taupe', 'sepia']],
  ['be', ['베이지', '카멜', '에크루', '크림', 'beige', 'camel', 'cream']],
  ['nv', ['인디고', '네이비', 'indigo', 'navy']],
  ['bu', ['블루', '파랑', '청색', 'blue']],
  ['gn', ['그린', '녹색', 'green']],
  ['rd', ['레드', '빨강', '버건디', '와인', 'red', 'burgundy']]
];

// 영문 약자(ob, bl, pw)는 낱말 중간(예: 'global')에 걸리지 않게 앞뒤가 영문자가 아닐 때만 맞춘다
const SHORT_LATIN = /^[a-z.]{1,3}$/;

export const colorAbbr = (name) => {
  const s = String(name || '').toLowerCase();
  if (!s.trim()) return '';
  let best = null;
  for (const [code, words] of COLOR_WORDS) {
    for (const w of words) {
      let from = 0;
      let at;
      while ((at = s.indexOf(w, from)) !== -1) {
        const ok = !SHORT_LATIN.test(w) || (!/[a-z]/.test(s[at - 1] || '') && !/[a-z]/.test(s[at + w.length] || ''));
        if (ok) break;
        from = at + 1;
      }
      if (at !== -1 && (!best || at < best.at)) best = { code, at };
    }
  }
  return best ? best.code : '';
};

/** '외장/내장' 약자. 둘 다 모르면 빈 문자열, 한쪽만 모르면 '-'. */
export const colorCode = (exterior, interior) => {
  const ex = colorAbbr(exterior);
  const inn = colorAbbr(interior);
  if (!ex && !inn) return '';
  return `${ex || '-'}/${inn || '-'}`;
};
