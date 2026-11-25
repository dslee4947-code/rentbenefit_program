/**
 * 차고지 감면 공문에 붙이는 장기렌트 차량 명세. 화면(서류·편집)과 서버(자동 목록·엑셀 읽기)가 같이 쓴다.
 * 양식: Dropbox 2. 차고지감면/3차_차고지감면 서류/3차_장기렌트_차량명세_계약자별_….xlsx
 */

export const SHORT_PARTY = '단기렌트 (사고대차)';

/** 계약자별 묶음. 차가 많은 계약자가 먼저, 단기렌트는 맨 뒤. */
export const groupLongTermList = (rows) => {
  const map = new Map();
  (rows || []).forEach((r) => {
    const key = r.short ? SHORT_PARTY : r.party || '(계약자 없음)';
    if (!map.has(key)) map.set(key, { party: key, short: !!r.short, rows: [] });
    map.get(key).rows.push(r);
  });
  return [...map.values()].map((g) => ({
    ...g,
    bizNo: g.rows.find((r) => r.bizNo)?.bizNo || '',
    contracts: new Set(g.rows.map((r) => r.contractNo).filter((n) => n && n !== '-')).size
  })).sort((a, b) => Number(a.short) - Number(b.short) || b.rows.length - a.rows.length || a.party.localeCompare(b.party, 'ko'));
};

export const sortLongTermList = (rows) => {
  const sorted = [...(rows || [])].sort((a, b) => String(a.contractNo).localeCompare(String(b.contractNo)) || String(a.plateNo).localeCompare(String(b.plateNo)));
  return groupLongTermList(sorted).flatMap((g) => g.rows);
};

export const longTermCounts = (rows) => {
  const long = (rows || []).filter((r) => !r.short);
  return {
    long: long.length,
    short: (rows || []).length - long.length,
    contracts: new Set(long.map((r) => r.contractNo).filter((n) => n && n !== '-')).size,
    parties: new Set(long.map((r) => r.party)).size
  };
};

const ymd = (v) => {
  if (v instanceof Date) return Number.isNaN(+v) ? '' : new Date(+v + 9 * 3600e3).toISOString().slice(0, 10);
  const m = String(v ?? '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
};
const num = (v) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return n || null; };

/** 엑셀 표(줄의 배열)에서 차량 명세를 읽는다. 머리줄의 칸 이름으로 자리를 찾는다. */
export const parseLongTermSheet = (table) => {
  const clean = (v) => String(v ?? '').replace(/\s+/g, '');
  const headAt = table.findIndex((r) => r.some((c) => clean(c) === '차량번호') && r.some((c) => clean(c) === '차대번호'));
  if (headAt < 0) return [];
  const head = table[headAt].map(clean);
  const col = (re) => head.findIndex((h) => re.test(h));
  const at = {
    party: col(/계약자|계약사/), contractNo: col(/계약번호/), plateNo: col(/차량번호/), vin: col(/차대번호/), model: col(/차종/),
    start: col(/시작|인도|대여일시/), end: col(/종료|반납/), months: col(/대여기간/), fee: col(/대여료|렌트료/)
  };
  let bizNo = '';
  const rows = [];
  table.slice(headAt + 1).forEach((r) => {
    const get = (k) => (at[k] >= 0 ? r[at[k]] : '');
    const plateNo = clean(get('plateNo'));
    if (!/^\d{2,3}[가-힣]\d{4}$/.test(plateNo)) {
      // 계약자 묶음 줄: "신흥정보통신㈜ · 42대 · 계약 10건 · 206-85-09469"
      bizNo = String(r[0] ?? '').match(/\d{3}-\d{2}-\d{5}/)?.[0] || '';
      return;
    }
    const party = String(get('party') ?? '').trim();
    const short = /단기렌트|사고대차/.test(party);
    const contractNo = String(get('contractNo') ?? '').trim();
    rows.push({
      plateNo, vin: clean(get('vin')), model: String(get('model') ?? '').trim(), party: short ? SHORT_PARTY : party, short,
      bizNo: short ? '' : bizNo, contractNo: contractNo === '-' ? '' : contractNo,
      start: ymd(get('start')), end: ymd(get('end')), months: num(get('months')), fee: num(get('fee'))
    });
  });
  return sortLongTermList(rows);
};
