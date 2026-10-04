import Setting from '../models/Setting.js';

/**
 * 파일을 어디에 어떤 이름으로 저장할지 정하는 유일한 곳.
 *
 * 예전에는 저장하는 함수마다 경로를 따로 만들었다. 그래서 같은 청구서가 두 자리에 생길 수
 * 있었고, 경로를 바꾸려면 여러 파일을 동시에 고쳐야 했다. 이제 모든 저장이 이 파일의
 * buildDocumentPath()를 지난다.
 *
 * 구조는 일이 진행되는 단계에 따라 두 갈래다.
 *
 *   RENT / 견적    / {고객명} / 견적서.pdf
 *   RENT / 장기렌트 / {법인명} / {문서종류} / [{계약 폴더}] / 파일
 *
 * 견적 단계에서는 아직 어느 법인으로 계약할지 정해지지 않는다. 상담한 사람 이름으로 모아야
 * 찾을 수 있다. 계약으로 넘어가면 서류가 법인 앞으로 나가므로 법인명으로 모은다.
 * 한 사람이 여러 법인을 상담하기도 하고, 한 법인에 담당자가 여럿이라 두 단계를 같은
 * 이름으로 묶으면 어느 쪽에서도 찾기 어렵다.
 */

const SETTING_KEY = 'documentStorage';

/**
 * 일의 단계. 최상위 폴더 바로 아래 이 두 폴더로 갈린다.
 *
 * keyedBy는 그 아래 폴더를 무슨 이름으로 만드는지다. 화면에 그대로 보여 준다.
 */
export const STAGES = [
  {
    code: 'quote',
    label: '견적 (장기렌트 진행 전)',
    folder: '견적',
    keyedBy: '고객명',
    hint: '상담한 고객 이름으로 폴더가 생깁니다'
  },
  {
    code: 'contract',
    label: '장기렌트 (계약 진행)',
    folder: '장기렌트',
    keyedBy: '법인명',
    hint: '계약자(법인) 이름으로 폴더가 생기고, 그 안에서 서류 종류로 나뉩니다'
  }
];

/**
 * 문서 종류.
 *
 * code는 코드와 DB가 쓰는 이름이라 절대 바뀌지 않는다. folder(폴더 이름)만 설정에서 바꾼다.
 * 그래야 사장님이 폴더 이름을 고쳐도 프로그램이 어떤 서류인지 계속 알아본다.
 *
 * 01~13번은 손으로 만들어 쓰시던 폴더 그대로다. 번호를 다시 매기면 지금까지 쌓아 온 자료와
 * 자리가 어긋나, 앞뒤로 00번과 14번만 새로 붙였다.
 *
 * flat이 붙은 종류는 문서 종류 폴더를 만들지 않는다. 견적서는 고객 이름 폴더에 바로 담긴다.
 */
export const DOC_KINDS = [
  { code: 'quote', stage: 'quote', label: '견적서', folder: '', flat: true, hint: '고객 이름 폴더에 바로 담깁니다 (견적서, 비교견적서)' },

  { code: 'company', stage: 'contract', label: '법인 서류', folder: '00.법인서류', hint: '사업자등록증, 통장사본 등' },
  { code: 'contract', stage: 'contract', label: '계약서', folder: '01.계약서', hint: '계약별로 폴더가 한 겹 더 생깁니다' },
  { code: 'invoice', stage: 'contract', label: '청구서', folder: '02.청구서', hint: '월별 청구서' },
  { code: 'regularCheck', stage: 'contract', label: '자동차 정기점검', folder: '03.자동차 정기점검', hint: '' },
  { code: 'inspection', stage: 'contract', label: '자동차 검사', folder: '04.자동차 검사', hint: '' },
  { code: 'repair', stage: 'contract', label: '자동차 고장수리', folder: '05.자동차 고장수리', hint: '' },
  { code: 'accidentRepair', stage: 'contract', label: '자동차 사고수리', folder: '06.자동차 사고수리', hint: '' },
  { code: 'delivery', stage: 'contract', label: '신차 출고', folder: '07.신차출고사진_등록증_취득세', hint: '' },
  { code: 'expiry', stage: 'contract', label: '계약 만료 준비서류', folder: '08.계약만료시준비서류', hint: '' },
  { code: 'termination', stage: 'contract', label: '중도해지', folder: '09.중도해지', hint: '' },
  { code: 'registration', stage: 'contract', label: '등록증 및 취득세 고지서', folder: '10.등록증 및 취득세 고지서', hint: '' },
  { code: 'overdue', stage: 'contract', label: '미납 렌트료 안내', folder: '11.미납렌트료 안내 최종통보 폴더', hint: '' },
  { code: 'withdrawal', stage: 'contract', label: '사고 계약 철회 안내문', folder: '12.사고관련 차량 계약 철회 안내문', hint: '' },
  { code: 'renewal', stage: 'contract', label: '계약 연장 안내문', folder: '13.계약 연장 안내문 및 계약서', hint: '' },
  { code: 'notice', stage: 'contract', label: '고지서', folder: '14.고지서', hint: '범칙금, 과태료, 통행료' }
];

/** 문서 종류 코드로 정보를 찾는다 */
export const kindInfo = (kind) => DOC_KINDS.find((k) => k.code === kind) || null;

/** 파일명·폴더명 규칙에 쓸 수 있는 값들. 설정 화면에서 이 목록을 그대로 보여 준다. */
export const PATTERN_TOKENS = {
  contractFolder: [
    { token: '{계약번호}', desc: '21100001' },
    { token: '{차종}', desc: 'Ray Van (여러 종이면 "Ray 외 1종")' },
    { token: '{대수}', desc: '20' }
  ],
  invoice: [
    { token: '{법인명}', desc: '신흥정보통신㈜' },
    { token: '{회차}', desc: '58' },
    { token: '{날짜}', desc: '2026-09-07' }
  ],
  invoiceAttachment: [
    { token: '{법인명}', desc: '신흥정보통신㈜' },
    { token: '{회차}', desc: '58' },
    { token: '{종류}', desc: '과태료, 통행료 등' },
    { token: '{차량번호}', desc: '12가3456 (없으면 자동으로 빠집니다)' }
  ],
  companyDoc: [
    { token: '{문서종류}', desc: '사업자등록증' },
    { token: '{법인명}', desc: '신흥정보통신㈜' },
    { token: '{날짜}', desc: '2026-09-07' }
  ],
  quote: [
    { token: '{문서종류}', desc: '견적서 / 비교견적서' },
    { token: '{고객명}', desc: '김명진 (상담한 사람 이름)' },
    { token: '{날짜}', desc: '2026-09-07' }
  ]
};

/** 설정을 건드리지 않았을 때 쓰는 값 */
export const DEFAULT_SETTINGS = {
  rootFolder: 'RENT',
  stageFolders: Object.fromEntries(STAGES.map((s) => [s.code, s.folder])),
  folders: Object.fromEntries(DOC_KINDS.map((k) => [k.code, k.folder])),
  // 계약이 여러 건인 법인이 많다. 계약번호로 한 겹 나누지 않으면 5회차 청구서가
  // 어느 계약 것인지 파일명만으로 구분되지 않는다.
  useContractSubfolder: true,
  contractFolderPattern: '{계약번호}_{차종}_{대수}대',
  fileNames: {
    invoice: '{법인명}_청구서_{회차}회차',
    invoiceAttachment: '{법인명}_청구서_{회차}회차_{종류}_{차량번호}',
    companyDoc: '{문서종류}_{법인명}',
    quote: '{문서종류}_{고객명}_{날짜}'
  }
};

// 저장할 때마다 DB를 읽으면 파일 한 장에 조회가 한 번씩 더 붙는다.
// 설정은 거의 바뀌지 않아 잠깐 들고 있다가, 설정을 바꾸면 그 자리에서 버린다.
let cache = null;
let cachedAt = 0;
const CACHE_MS = 60 * 1000;

/** 설정을 다시 읽게 만든다. 설정을 저장한 직후에 부른다. */
export const invalidateSettingsCache = () => {
  cache = null;
  cachedAt = 0;
};

/**
 * 저장 경로 설정을 읽는다. 저장해 둔 값이 없으면 기본값을 준다.
 * DB를 읽지 못해도 기본값으로 계속 돌아간다. 설정 때문에 파일 저장이 멈추면 안 된다.
 */
export const getDocumentSettings = async () => {
  if (cache && Date.now() - cachedAt < CACHE_MS) return cache;

  let saved = null;
  try {
    const doc = await Setting.findOne({ key: SETTING_KEY }).lean();
    saved = doc?.value || null;
  } catch (err) {
    console.error('[문서 경로] 설정을 읽지 못해 기본값을 씁니다:', err.message);
  }

  cache = mergeSettings(saved);
  cachedAt = Date.now();
  return cache;
};

/**
 * 저장해 둔 설정을 기본값 위에 덮는다.
 *
 * 설정에 없는 항목(나중에 문서 종류를 늘렸을 때)은 기본값이 채워지므로,
 * 예전에 저장한 설정 때문에 새 문서 종류의 폴더가 비는 일이 없다.
 */
export const mergeSettings = (saved) => {
  const s = saved || {};
  return {
    rootFolder: String(s.rootFolder || DEFAULT_SETTINGS.rootFolder).trim() || DEFAULT_SETTINGS.rootFolder,
    stageFolders: { ...DEFAULT_SETTINGS.stageFolders, ...(s.stageFolders || {}) },
    folders: { ...DEFAULT_SETTINGS.folders, ...(s.folders || {}) },
    useContractSubfolder: s.useContractSubfolder !== false,
    contractFolderPattern: s.contractFolderPattern || DEFAULT_SETTINGS.contractFolderPattern,
    fileNames: { ...DEFAULT_SETTINGS.fileNames, ...(s.fileNames || {}) }
  };
};

/** OneDrive 경로에 쓸 수 없는 문자를 없앤다 */
export const sanitizeSegment = (segment) => String(segment || '')
  .replace(/[\\/:*?"<>|#%]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim() || '미지정';

/**
 * '{법인명}_청구서_{회차}회차' 같은 규칙에 실제 값을 넣는다.
 *
 * 값이 없는 자리는 통째로 지운다. 차량번호가 없을 때 '..._과태료_' 처럼
 * 끝에 밑줄만 남는 이름이 생기지 않게, 붙어 있던 구분 기호까지 함께 지운다.
 *
 * @param {string} pattern 규칙
 * @param {Record<string, string|number>} values 넣을 값
 * @returns {string} 완성된 이름 (확장자는 붙이지 않는다)
 */
export const fillPattern = (pattern, values = {}) => {
  let out = String(pattern || '');

  for (const [key, raw] of Object.entries(values)) {
    const value = raw === 0 ? '0' : String(raw ?? '').trim();
    const token = `{${key}}`;
    if (value) {
      out = out.split(token).join(value);
    } else {
      // 빈 값은 앞이나 뒤에 붙은 구분 기호와 함께 지운다
      out = out.replace(new RegExp(`[_\\-\\s]*${escapeRegExp(token)}`, 'g'), '');
    }
  }

  // 채우지 못한 자리(규칙에 오타가 있을 때)와 남은 구분 기호를 정리한다
  return out
    .replace(/\{[^}]*\}/g, '')
    .replace(/[_\-\s]{2,}/g, '_')
    .replace(/^[_\-\s]+|[_\-\s]+$/g, '')
    .trim() || '문서';
};

const escapeRegExp = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 문서 종류 코드로 폴더 이름을 찾는다. 모르는 코드면 그 코드를 폴더 이름으로 쓴다. */
export const folderNameOf = (settings, kind) => settings.folders[kind] || sanitizeSegment(kind);

/** 그 문서가 어느 단계에 속하는지. 모르는 코드는 계약 단계로 본다. */
export const stageOf = (kind) => (kindInfo(kind)?.stage === 'quote' ? 'quote' : 'contract');

/**
 * 계약자(법인) 폴더까지의 경로. 계약 단계 전용이다.
 * @returns {string[]} ['RENT','장기렌트','신흥정보통신㈜']
 */
export const contractPartyRoot = (settings, partyName) => [
  sanitizeSegment(settings.rootFolder),
  sanitizeSegment(settings.stageFolders.contract),
  sanitizeSegment(partyName)
];

/**
 * 파일을 저장할 전체 경로를 만든다. 프로그램의 모든 저장이 이 함수를 지난다.
 *
 * @param {object} params
 * @param {string} params.partyName 폴더 이름. 견적은 고객명, 계약은 법인명
 * @param {string} params.kind DOC_KINDS의 code (예: 'invoice')
 * @param {string} [params.subFolder] 한 겹 더 나눌 이름 (계약 폴더 등)
 * @param {string} params.fileName 확장자까지 붙인 파일명
 * @returns {Promise<string[]>} ['RENT','장기렌트','신흥정보통신㈜','02.청구서','21100001_Ray Van_20대','파일.pdf']
 */
export const buildDocumentPath = async ({ partyName, kind, subFolder, fileName }) => {
  const settings = await getDocumentSettings();
  const info = kindInfo(kind);
  const stage = stageOf(kind);

  const segments = [
    sanitizeSegment(settings.rootFolder),
    sanitizeSegment(settings.stageFolders[stage]),
    sanitizeSegment(partyName)
  ];

  // 견적서는 고객 이름 폴더에 바로 담는다. 한 사람의 견적서가 몇 장 안 되는데
  // 폴더를 한 겹 더 두면 열 때마다 한 번 더 들어가야 한다.
  if (!info?.flat) segments.push(sanitizeSegment(folderNameOf(settings, kind)));

  // 계약 폴더는 설정에서 끌 수 있다. 계약이 한 건뿐인 곳은 한 겹이 오히려 성가시다.
  if (subFolder && settings.useContractSubfolder) segments.push(sanitizeSegment(subFolder));

  segments.push(sanitizeSegment(fileName));
  return segments;
};

/**
 * 계약 폴더 이름을 만든다. 기본은 '21100001_Ray Van_20대' 모양이다.
 *
 * 계약번호만으로는 폴더를 열기 전까지 무슨 차가 몇 대인지 알 수 없어 함께 적는다.
 * 한 계약에 차종이 섞여 있으면 가장 많은 차종에 '외 N종'을 붙인다.
 *
 * @param {string} contractNo 계약번호
 * @param {Array<{carModel?: string}>} vehicles 계약에 묶인 차량
 * @returns {Promise<string>} 폴더 이름
 */
export const buildContractFolderName = async (contractNo, vehicles = []) => {
  const settings = await getDocumentSettings();
  const no = String(contractNo || '계약번호미상').trim();

  const models = vehicles.map((v) => (v.carModel || '').trim()).filter(Boolean);
  let label = '';
  if (models.length) {
    const count = new Map();
    models.forEach((m) => count.set(m, (count.get(m) || 0) + 1));
    const [top] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    label = count.size > 1 ? `${top} 외 ${count.size - 1}종` : top;
  }

  return sanitizeSegment(fillPattern(settings.contractFolderPattern, {
    계약번호: no,
    차종: label,
    대수: vehicles.length || ''
  }));
};

/**
 * 설정 화면의 미리보기를 만든다.
 *
 * 규칙을 고치는 순간 "이렇게 저장됩니다"를 보여 줘야, 저장하고 나서야 이름이
 * 이상한 걸 알아채는 일이 없다. 화면과 서버가 같은 결과를 보이도록 서버에서 만든다.
 *
 * @param {object} settings mergeSettings를 지난 설정
 * @returns {Array<{stage: string, label: string, path: string}>}
 */
export const buildPreview = (settings) => {
  const customer = '김명진';
  const party = '신흥정보통신㈜';
  const root = sanitizeSegment(settings.rootFolder);
  const quoteRoot = `${root}\\${sanitizeSegment(settings.stageFolders.quote)}`;
  const rentRoot = `${root}\\${sanitizeSegment(settings.stageFolders.contract)}`;

  const contractFolder = sanitizeSegment(fillPattern(settings.contractFolderPattern, {
    계약번호: '21100001', 차종: 'Ray Van', 대수: 20
  }));
  const sub = settings.useContractSubfolder ? `\\${contractFolder}` : '';
  const today = new Date().toISOString().slice(0, 10);

  const at = (kind) => `${rentRoot}\\${party}\\${sanitizeSegment(folderNameOf(settings, kind))}`;
  const name = (key, values) => sanitizeSegment(fillPattern(settings.fileNames[key], values));

  return [
    {
      stage: 'quote',
      label: '견적서 인쇄',
      path: `${quoteRoot}\\${customer}\\${name('quote', { 문서종류: '견적서', 고객명: customer, 계약자: customer, 날짜: today })}.pdf`
    },
    {
      stage: 'quote',
      label: '비교견적서 인쇄',
      path: `${quoteRoot}\\${customer}\\${name('quote', { 문서종류: '비교견적서', 고객명: customer, 계약자: customer, 날짜: today })}.pdf`
    },
    {
      stage: 'contract',
      label: '계약서 (사람이 넣는 자리)',
      path: `${at('contract')}\\${contractFolder}\\`
    },
    {
      stage: 'contract',
      label: '법인 서류',
      path: `${at('company')}\\${name('companyDoc', { 문서종류: '사업자등록증', 법인명: party, 계약자: party, 날짜: today })}.pdf`
    },
    {
      stage: 'contract',
      label: '청구서 발행',
      path: `${at('invoice')}${sub}\\${name('invoice', { 법인명: party, 계약자: party, 회차: 58, 날짜: today })}.pdf`
    },
    {
      stage: 'contract',
      label: '고지서 (차량번호 있음)',
      path: `${at('notice')}${sub}\\${name('invoiceAttachment', { 법인명: party, 계약자: party, 회차: 58, 종류: '과태료', 차량번호: '12가3456' })}.pdf`
    },
    {
      stage: 'contract',
      label: '고지서 (차량번호 없음)',
      path: `${at('notice')}${sub}\\${name('invoiceAttachment', { 법인명: party, 계약자: party, 회차: 58, 종류: '통행료', 차량번호: '' })}.pdf`
    },
    {
      stage: 'contract',
      label: '그 밖의 청구 첨부 (정비내역·기타)',
      path: `${at('invoice')}${sub}\\${name('invoiceAttachment', { 법인명: party, 계약자: party, 회차: 58, 종류: '정비내역', 차량번호: '12가3456' })}.pdf`
    }
  ];
};
