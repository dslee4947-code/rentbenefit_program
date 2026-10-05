/**
 * 회사 장부 계정 분류 (2026-10-05).
 *
 * 차량 손익 원장은 "차 한 대"의 돈을 본다. 사무실 임대료·월급·세무사비처럼 어느 차에도 속하지 않는 돈은
 * 자금팀 엑셀 "렌트베네핏 입출금 리스트"에 따로 적혀 왔는데, 그 엑셀에는 성격이 전혀 다른 돈이 한 파일에 섞여 있다.
 *   - 비용: 월급, 임대료, 경조사비 …            → 손익에 들어간다
 *   - 세금: 법인세                              → 손익 맨 아래(세전이익 − 법인세)
 *   - 부가세: 고객에게 받아 나라에 내는 돈      → 손익이 아니다
 *   - 빌린 돈: 대표 차입금, 은행·공제조합 대출  → 손익이 아니다(갚아도 비용이 아니고 이자만 비용)
 *   - 자본금, 보증금·적금                       → 손익이 아니다
 * 이걸 다 더하면 "회사가 쓴 돈"이 부풀려진다(예: 2024년 미군부대 입찰 보증금 5,500만 원이 비용으로 잡혔다가 2025년 환급이 마이너스 비용으로 잡힘).
 * 그래서 줄마다 계정(account)을 하나 붙이고, 계정마다 성격(section)을 정해 재무제표의 어느 칸으로 갈지 정한다.
 *
 * 엑셀 원장(차량)과 겹치지 않는다: 2026-10-05에 엑셀 비용 1,900여 줄을 운영 원장 179장과 금액·날짜로 맞춰 봤더니
 * 탁송·차량 작업(썬팅·광택)·사은품도 원장에는 들어 있지 않았다. 둘을 더해도 이중으로 세지 않는다.
 */

/** 재무제표의 어느 칸으로 가는지. pnl=true만 손익계산서에 들어간다. */
export const COMPANY_SECTIONS = [
  { key: 'opex', name: '판매비와 관리비', pnl: true },
  { key: 'finance', name: '금융비용', pnl: true },
  { key: 'incomeTax', name: '법인세', pnl: true },
  { key: 'vat', name: '부가세', pnl: false, note: '고객에게 받아 나라에 내는 돈이라 손익이 아닙니다. 납부와 환급의 차이만 현금에 영향을 줍니다.' },
  { key: 'debt', name: '빌린 돈', pnl: false, note: '빌린 돈과 갚은 돈은 비용이 아닙니다. 이자만 금융비용입니다.' },
  { key: 'equity', name: '자본금', pnl: false },
  { key: 'asset', name: '맡겨 둔 돈', pnl: false, note: '보증금·적금은 돌려받는 돈이라 비용이 아닙니다.' }
];

/**
 * 계정 목록. group은 화면에서 묶어 보여 주는 이름이다(판관비만).
 * vehicle=true는 차량에 쓴 돈이지만 원장에는 없는 공통 비용이다. 나중에 차 1대당 원가를 볼 때 따로 더한다.
 */
export const COMPANY_ACCOUNTS = [
  { key: 'salary', name: '급여', section: 'opex', group: '인건비' },
  { key: 'payroll', name: '4대보험·퇴직연금·원천세', section: 'opex', group: '인건비' },

  { key: 'rent', name: '사무실 임대료', section: 'opex', group: '사무실' },
  { key: 'travel', name: '주차·교통·유류', section: 'opex', group: '사무실' },
  { key: 'telecom', name: '통신비', section: 'opex', group: '사무실' },
  { key: 'welfare', name: '식대·복리후생', section: 'opex', group: '사무실' },
  { key: 'supplies', name: '비품·소모품', section: 'opex', group: '사무실' },
  { key: 'admin', name: '공문·우편·증명서', section: 'opex', group: '사무실' },

  { key: 'professional', name: '세무·법무 수수료', section: 'opex', group: '수수료' },
  { key: 'paymentFee', name: '은행·결제 수수료', section: 'opex', group: '수수료' },

  { key: 'entertainment', name: '접대비(경조사·선물·골프)', section: 'opex', group: '영업' },
  { key: 'promotion', name: '고객 사은품', section: 'opex', group: '영업' },
  { key: 'marketing', name: '광고·홍보·채용', section: 'opex', group: '영업' },

  { key: 'vehicleWork', name: '차량 작업(썬팅·광택·검사)', section: 'opex', group: '차량 공통', vehicle: true },
  { key: 'delivery', name: '탁송·탁송보험', section: 'opex', group: '차량 공통', vehicle: true },
  { key: 'garage', name: '차고지', section: 'opex', group: '차량 공통', vehicle: true },
  { key: 'union', name: '렌터카 조합비·보증보험', section: 'opex', group: '차량 공통', vehicle: true },
  { key: 'taxDues', name: '세금과공과(자동차세·면허세·주민세)', section: 'opex', group: '차량 공통', vehicle: true },

  { key: 'card', name: '법인카드(내역 모름)', section: 'opex', group: '분류 필요' },
  { key: 'other', name: '기타', section: 'opex', group: '분류 필요' },

  { key: 'interest', name: '대출이자', section: 'finance' },
  { key: 'loanFee', name: '대출 부대비용(약정수수료·채권)', section: 'finance' },
  { key: 'interestIncome', name: '예금 이자수익', section: 'finance' },

  { key: 'corpTax', name: '법인세·지방소득세', section: 'incomeTax' },

  { key: 'vat', name: '부가세 납부·환급', section: 'vat' },

  { key: 'ownerLoan', name: '대표 차입금', section: 'debt' },
  { key: 'bankLoan', name: '은행·공제조합 대출', section: 'debt' },

  { key: 'capital', name: '자본금', section: 'equity' },

  { key: 'deposit', name: '보증금(입찰·휴대폰 등)', section: 'asset' },
  { key: 'savings', name: '적금·예금', section: 'asset' }
];

const ACCOUNT_BY_KEY = new Map(COMPANY_ACCOUNTS.map((a) => [a.key, a]));
export const accountOf = (key) => ACCOUNT_BY_KEY.get(key) || ACCOUNT_BY_KEY.get('other');
export const sectionOf = (key) => COMPANY_SECTIONS.find((s) => s.key === accountOf(key).section);
export const isCompanyAccount = (key) => ACCOUNT_BY_KEY.has(key);

/**
 * 장부 금액이 그 칸에서 플러스인지 마이너스인지.
 * 비용·세금 칸은 나간 돈이 +, 들어온 돈(환급)이 −. 빌린 돈 칸은 들어온 돈(빌림)이 +, 나간 돈(갚음)이 −.
 * 자본금도 들어온 돈이 +. 맡겨 둔 돈은 나간 돈(맡김)이 +.
 */
export const signedAmount = (tx) => {
  const amount = Number(tx.amount) || 0;
  const out = tx.direction === '출금';
  const section = accountOf(tx.account).section;
  if (section === 'debt' || section === 'equity') return out ? -amount : amount;
  return out ? amount : -amount;
};

/**
 * 엑셀 칸 제목 + 내역 문구로 계정을 고른다.
 *
 * 엑셀은 칸(예: "선물-대표님 비품/기타")마다 대략 성격이 정해져 있지만 한 칸에 여러 성격이 섞여 있다
 * ("선물-대표님 비품/기타" 칸에 상표출원 수수료·구인광고·프린터 토너·서울시대여조합 가입비가 같이 있음).
 * 그래서 칸으로 기본 계정을 정하고, 내역 문구 규칙으로 덮어쓴다. 규칙은 위에서부터 처음 맞는 것을 쓴다.
 */
const COLUMN_RULES = [
  // [칸 제목에 들어 있는 말, 기본 계정, 내역 규칙]
  [/세무사/, 'professional', []],
  [/월급/, 'salary', [[/탁송\s*보험/, 'delivery']]],
  [/임대료/, 'rent', []],
  [/CMS/, 'paymentFee', [[/보험/, 'union']]],
  [/조합비/, 'union', []],
  [/소득세|4대\s*보험/, 'payroll', [[/주민세/, 'taxDues']]],
  [/주차/, 'travel', []],
  [/카드\s*단말기/, 'paymentFee', []],
  [/통신/, 'telecom', [[/보증금/, 'deposit']]],
  [/경조사/, 'entertainment', []],
  [/작업\s*업체/, 'vehicleWork', []],
  [/탁송/, 'delivery', []],
  [/사은품/, 'promotion', []],
  [/차고지/, 'garage', []],
  [/법인\s*카드/, 'card', []],
  [/법인세/, 'corpTax', [[/수수료/, 'professional'], [/주민세/, 'taxDues']]],
  [/선물/, 'entertainment', [
    [/보증금/, 'deposit'],
    [/상표|특허/, 'professional'],
    [/조합\s*가입/, 'union'],
    [/퇴직/, 'payroll'],
    [/직원.*선물|직원명절|추석\s*직원|명절\s*직원/, 'welfare'],
    [/달력|디자인|명함|현수막|구인|잡코리아|사람인|알바|광고|제본|감사패|네임텍/, 'marketing'],
    [/토너|프린터|컴퓨터|노트북|휴대폰|핸드폰|제빙|청소|하이패스|키케이스|케이블|수건/, 'supplies'],
    [/전산\s*시스템|수수료/, 'other']
  ]],
  [/기타\s*비용|은행\s*수수료/, 'other', [
    [/입찰/, 'deposit'],
    [/약정|채권|실행/, 'loanFee'],
    [/이자\s*수익/, 'interestIncome'],
    [/탁송\s*보험/, 'delivery'],
    [/보증\s*보험/, 'union'],
    [/자동차세|면허세|주민세/, 'taxDues'],
    [/설립|상표|임원\s*등기/, 'professional'],
    [/전자서명/, 'paymentFee'],
    [/도메인|홈페이지|문자/, 'marketing'],
    [/컴퓨터|톱/, 'supplies']
  ]],
  [/지\s*출|식대|비품/, 'supplies', [
    [/조화|부의|화환|축의|경조/, 'entertainment'],
    [/사은품/, 'promotion'],
    [/식대|식사|간식|생수|커피|음료|탄산|복지|복리|생일|정수기|직원\s*식/, 'welfare'],
    [/주유|교통|교툥|주차|하이패스|세차|요소수|숙박|펜션|렌터가|렌터카|출장/, 'travel'],
    [/공문|우편|발송|서류|등기|등본|인감|인증|증명|담보|지방세|SMS|문자/, 'admin'],
    [/명함|현수막|광고|알바/, 'marketing'],
    [/의무\s*보험|검사|번호판/, 'vehicleWork'],
    [/딜러|만능\s*열쇠/, 'other']
  ]]
];

/**
 * @param {string} column 엑셀 칸 제목 (예: "월급,탁송보험가입포함")
 * @param {string} description 내역 문구
 * @returns {string} 계정 key
 */
export const pickCompanyAccount = (column, description) => {
  const col = String(column || '');
  const text = String(description || '');
  const hit = COLUMN_RULES.find(([rx]) => rx.test(col));
  if (!hit) return 'other';
  const [, fallback, rules] = hit;
  const rule = rules.find(([rx]) => rx.test(text));
  return rule ? rule[1] : fallback;
};
