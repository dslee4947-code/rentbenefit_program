// 전자계약서 화면에서 함께 쓰는 계산. 컴포넌트 파일과 나눠 둔다(react-refresh 규칙).

// 입력 칸 묶음(화면 왼쪽 입력란). 양식의 순서를 따르되 보기 쉽게 나눈다.
export const FIELD_GROUPS = [
  { title: '계약자', keys: ['contractNo', 'vehicleCode', 'partyName', 'ceoName', 'bizNo', 'corpRegNo', 'address', 'phone', 'email'] },
  { title: '담당자·운전자', keys: ['managerName', 'managerPhone', 'payerName', 'driverName'] },
  { title: '출금 계좌(CMS)', keys: ['bankName', 'bankAccount', 'bankHolder'] },
  { title: '차량', keys: ['carModel', 'origin', 'quantity', 'exteriorColor', 'interiorColor', 'options'] },
  { title: '계약 조건', keys: ['termMonths', 'carPrice', 'monthlyFee', 'deposit', 'advancePayment', 'takeoverPrice', 'annualMileage', 'penaltyRate', 'overdueRate'] },
  { title: '보험·정비', keys: ['propertyLimit', 'personalInjury', 'personalInjury_2', 'uninsuredInjury', 'deductible', 'emergencyService', 'maintenance', 'tire'] }
];

// ───────── 약관 읽기 쉬운 본 ─────────
// 엑셀은 칸 폭에 맞추려고 문장 중간에서 줄을 바꿔 두었다(줄 끝이 띄어쓰기로 끝난다).
// 셀 하나 안에서 새 항목 기호(①, 1., 가., A., 가), -, ※ …)로 시작하지 않는 줄은 앞 줄에 띄어쓰기 하나로 이어 붙인다.
// 글자는 바꾸지 않는다. 줄바꿈과 줄 앞 들여쓰기 공백만 정리한다. 원문 그대로는 template.pages[].text에 있다.
// 글상자(서명란·동의 상자·계산식)는 원래 한 줄씩 쓰는 양식이라 줄을 그대로 둔다.

const ITEM_LEVEL = [
  [/^제\s*\d+\s*조/, 0],
  [/^[①-⑳]/, 1],
  [/^\d+[.)]/, 2],
  [/^[가-하][.)]/, 3],
  [/^\(([가-하]|\d+)\)/, 3], // (가), (1). "(공급사)에게…"처럼 괄호 안이 낱말이면 번호가 아니다
  [/^[A-Z][.)]/, 4],
  [/^[a-z][.)]/, 5],
  [/^(-|※|\*|•|·|▶|■|□|○|●|\[|주[ⅠⅡⅢ])/, null] // 기호만 있는 줄: 바로 앞 문단보다 한 단계 안쪽
];
const levelOf = (line) => {
  for (const [re, level] of ITEM_LEVEL) if (re.test(line)) return level === null ? 'sub' : level;
  return undefined;
};

// 조항 제목 줄: "제6조 차량의 인도 및 반납", "제1조(특별약관의 적용)". "제6조 제①항 후문에…"처럼 다른 조항을 가리키는 문장은 아니다.
export const CLAUSE_HEAD = /^\s*제\s*(\d+)\s*조\s*(?:[(（]([^)）]+)[)）]|\s+([^제=\s][^=]*?))\s*$/;

const PARTICLE = /^(을|를|이|가|은|는|의|에|로|으로|과|와|도|만|며|고|다|게|지|서|여|야|하|한|할|함|합|된|되|될|됨|인|임|시)/;

/**
 * 줄을 이을 때 띄울지(' ') 붙일지('')를 정한다.
 * 엑셀 원문은 칸 폭에서 단어 중간을 끊기도 했다("마모⏎를", "확⏎인한"). 그래서 같은 약관 안에서 그 말을 어떻게 썼는지 본다.
 *  1) 앞줄이 띄어쓰기로 끝나면 띄운다  2) 문장부호로 끝나면 띄운다
 *  3) 끊긴 앞뒤 낱말을 붙인 꼴/띄운 꼴 중 약관 다른 곳에 더 많이 나오는 쪽
 *  4) 그래도 모르면 끊긴 자리 앞뒤 두 글자로 같은 비교  5) 그래도 모르면 조사·어미로 시작하면 붙인다
 */
export const makeJoiner = (corpusLines) => {
  const cache = new Map();
  const count = (s) => {
    if (!cache.has(s)) cache.set(s, corpusLines.reduce((n, l) => n + (l.split(s).length - 1), 0));
    return cache.get(s);
  };
  return (prev, next) => {
    if (/[ \t]$/.test(prev)) return ' ';
    const tail = (/\S+$/.exec(prev) || [''])[0];
    const head = (/^\S+/.exec(next.trim()) || [''])[0];
    if (!tail || !head || /[.,:;)\]”’》」』]$/.test(tail)) return ' ';
    const t6 = tail.slice(-6);
    const h6 = head.slice(0, 6);
    const cj = count(t6 + h6);
    const cs = count(`${t6} ${h6}`);
    if (cj !== cs) return cj > cs ? '' : ' ';
    // 끊긴 자리 앞뒤의 한글 두 글자, 그다음 한 글자씩으로 다시 본다("정⏎부기관" → '정부', "공채매⏎입비용" → '매입')
    const hanTail = (/[가-힣]+$/.exec(tail) || [''])[0];
    const hanHead = (/^[가-힣]+/.exec(head) || [''])[0];
    for (const n of [2, 1]) {
      if (hanTail.length < n || hanHead.length < n) continue;
      const a = hanTail.slice(-n);
      const b = hanHead.slice(0, n);
      const bj = count(a + b);
      const bs = count(`${a} ${b}`);
      if (bj !== bs) return bj > bs ? '' : ' ';
    }
    return /[가-힣]$/.test(tail) && PARTICLE.test(head) ? '' : ' ';
  };
};

/** 셀·글상자 하나의 글 → 문단 목록 [{text, level}] */
export const reflowBlock = (raw, from, joiner = () => ' ') => {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
  if (from === 'shape') return lines.filter((l) => l.trim()).map((l) => ({ text: l.trim(), level: 0, line: true }));
  const out = [];
  let prevLevel = 0;
  let prevRaw = '';
  for (const line of lines) {
    const text = line.trim();
    if (!text) { if (out.length) out[out.length - 1].gap = true; prevRaw = ''; continue; }
    const lv = levelOf(text);
    const last = out[out.length - 1];
    if (last && lv === undefined && !last.gap) {
      last.text = `${last.text.replace(/\s+$/, '')}${joiner(prevRaw, line)}${text}`;
      prevRaw = line;
      continue;
    }
    prevRaw = line;
    const level = lv === 'sub' ? prevLevel + 1 : lv ?? 0;
    if (typeof lv === 'number') prevLevel = lv;
    out.push({ text, level });
  }
  return out;
};

const TERMS_PAGE = /^계약서_(\d+)$/;
const isTermsSheet = (name) => TERMS_PAGE.test(name) && Number(name.split('_')[1]) >= 6;

/**
 * 양식 → 읽기 쉬운 약관.
 * @returns {{pages: object[], clauses: object[]}}
 *   pages[].items: [{kind: 'title'|'subtitle'|'heading'|'p'|'box', text|lines, level}]
 *   clauses[]: {part, no, title, heading, page, items}
 */
export const buildReadableTerms = (template) => {
  const styles = template?.styles || [];
  const corpus = (template?.pages || []).flatMap((p) => (p.blocks || []).filter((b) => b.from === 'cell'))
    .flatMap((b) => String(b.text || '').replace(/\r\n?/g, '\n').split('\n'));
  const joiner = makeJoiner(corpus);
  const pages = (template?.pages || []).map((page) => {
    const items = [];
    for (const b of page.blocks || []) {
      if (b.r < 3) continue; // 장마다 되풀이되는 머리(회사명·계약번호·무효 안내)
      const st = styles[b.s] || {};
      const text = String(b.text || '').replace(/\r\n?/g, '\n');
      if (!text.trim()) continue;
      if (b.from === 'shape') {
        const lines = reflowBlock(text, 'shape').map((p) => p.text);
        if (lines.length === 1 && CLAUSE_HEAD.test(lines[0])) items.push({ kind: 'heading', text: lines[0] });
        else items.push({ kind: 'box', lines });
        continue;
      }
      if (st.b && (st.sz || 11) >= 14 && !/^\d+\.$/.test(text.trim())) { items.push({ kind: 'title', text: text.trim() }); continue; }
      if (st.color === '#FF0000' && st.h === 'center' && text.trim().length < 40) { items.push({ kind: 'subtitle', text: text.trim() }); continue; }
      for (const p of reflowBlock(text, b.from, joiner)) {
        if (CLAUSE_HEAD.test(p.text) && p.text.length <= 40) items.push({ kind: 'heading', text: p.text });
        else items.push({ kind: 'p', text: p.text, level: p.level, ...(st.b ? { bold: true } : {}) });
      }
    }
    return { sheet: page.sheet, twoColumn: page.twoColumn, terms: isTermsSheet(page.sheet), items };
  });

  const clauses = [];
  let current = null;
  let part = '자동차 임대차 계약 약관';
  for (const page of pages.filter((p) => p.terms)) {
    if (page.sheet === '계약서_12') { part = '업무전용자동차보험 특별약관'; current = null; }
    for (const it of page.items) {
      if (it.kind === 'heading') {
        const m = CLAUSE_HEAD.exec(it.text);
        current = { part, no: Number(m[1]), title: (m[2] || m[3] || '').trim(), heading: it.text, page: page.sheet, items: [] };
        clauses.push(current);
      } else if (current && it.kind !== 'title' && it.kind !== 'subtitle') {
        current.items.push(it);
      }
    }
  }
  return { pages, clauses };
};

/** 읽기 쉬운 본을 글로 (.txt 받기용) */
export const readableTermsText = (readable) => readable.pages.map((page) => [
  `######## ${page.sheet}`,
  ...page.items.map((it) => {
    if (it.kind === 'box') return it.lines.map((l) => `  │ ${l}`).join('\n');
    if (it.kind === 'heading' || it.kind === 'title') return `\n${it.text}`;
    return `${'  '.repeat(it.level || 0)}${it.text}`;
  })
].join('\n')).join('\n\n');

export const SOURCE_LABEL ={ contract: '계약', quote: '견적', customer: '고객', company: '법인', vehicle: '차량', manual: '직접 입력' };
