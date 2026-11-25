import { groupLongTermList, longTermCounts } from '../../../../shared/longTermList.js';

/**
 * 장기렌트 차량 명세 (차고지 감면 공문에 붙임). A4 가로 1123×794px 쪽마다 그린다.
 * 대표님이 2026-11-18에 만든 엑셀(3차_장기렌트_차량명세_계약자별)과 같은 칸이다.
 */
const FONT = "'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', sans-serif";
const page = { width: 1123, height: 794, position: 'relative', background: '#fff', color: '#000', fontFamily: FONT, boxSizing: 'border-box', overflow: 'hidden', flex: '0 0 auto', boxShadow: '0 1px 6px rgba(0,0,0,0.18)', padding: '46px 50px 0' };
const COLS = [36, 150, 96, 84, 150, 222, 84, 84, 56, 61];
// 선을 합치면(collapse) PDF로 뜰 때 굵어져 칸마다 오른쪽·아래 선만 그린다
const line = { borderRight: '1px solid #8a8a8a', borderBottom: '1px solid #8a8a8a', boxSizing: 'border-box' };
const td = { ...line, height: 20, padding: '0 4px', fontSize: '10.5px', lineHeight: '13px', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' };
const th = { ...line, height: 34, padding: '0 3px', fontSize: '10.5px', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap', background: '#dbe5f1', lineHeight: '14px' };
const ROWS = 31;

export default function LongTermListPages({ rows, baseDate }) {
  if (!rows?.length) return null;
  const n = longTermCounts(rows);
  const groups = groupLongTermList(rows);
  const lines = [];
  let no = 0;
  groups.forEach((g) => {
    lines.push({ head: [g.party, `${g.rows.length}대`, g.short ? '' : `계약 ${g.contracts}건`, g.bizNo].filter(Boolean).join('   ·   ') });
    g.rows.forEach((r) => { no += 1; lines.push({ no, r }); });
  });
  lines.push({ total: `합계  ${rows.length}대 (장기렌트 ${n.long}대 · 계약 ${n.contracts}건 · 계약자 ${n.parties}곳${n.short ? ` / 단기렌트 ${n.short}대` : ''})` });
  // 묶음 머리줄이 쪽 맨 아래에 혼자 남지 않게 다음 쪽으로 넘긴다
  const pages = [];
  for (let i = 0; i < lines.length;) {
    let end = Math.min(lines.length, i + ROWS);
    if (end < lines.length && lines[end - 1].head) end -= 1;
    pages.push(lines.slice(i, end));
    i = end;
  }
  return pages.map((list, p) => (
    <div key={p} className="fleet-doc-page" data-orientation="landscape" style={page}>
      <div style={{ textAlign: 'center', fontSize: '18px', fontWeight: 700 }}>장기렌트 차량 명세 (최근 6개월 내 1개월 이상 장기임대)</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', margin: '6px 0 5px' }}>
        <span>(주)렌트베네핏 · {baseDate} 기준 · 장기렌트 {n.long}대 · 계약 {n.contracts}건 · 계약자 {n.parties}곳{n.short ? ` · 단기렌트 ${n.short}대` : ''}</span>
        <span>{p + 1} / {pages.length}</span>
      </div>
      <table style={{ width: 1023, borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', borderLeft: '1px solid #8a8a8a', borderTop: '1px solid #8a8a8a' }}>
        <colgroup>{COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead>
          <tr>
            <th style={th}>No</th><th style={th}>계약자 (대여인)</th><th style={th}>계약번호</th><th style={th}>차량번호</th><th style={th}>차대번호</th><th style={th}>차종</th>
            <th style={th}>대여 시작일<br />(최초 인도일)</th><th style={th}>반납 예정일<br />(계약종료일)</th><th style={th}>대여기간<br />(개월)</th><th style={th}>월대여료<br />(VAT포함)</th>
          </tr>
        </thead>
        <tbody>
          {list.map((x, i) => {
            if (x.head || x.total) return <tr key={i}><td colSpan={10} style={{ ...td, textAlign: 'left', fontWeight: 700, background: x.total ? '#fff2cc' : '#f2f2f2' }}>{x.head || x.total}</td></tr>;
            const { r } = x;
            return (
              <tr key={i}>
                <td style={td}>{x.no}</td>
                <td style={{ ...td, textAlign: 'left' }}>{r.party}</td>
                <td style={td}>{r.contractNo || '-'}</td>
                <td style={td}>{r.plateNo}</td>
                <td style={td}>{r.vin}</td>
                <td style={{ ...td, textAlign: 'left', fontSize: String(r.model).length > 26 ? '9.5px' : td.fontSize }}>{r.model}</td>
                <td style={td}>{r.start || '-'}</td>
                <td style={td}>{r.end || '-'}</td>
                <td style={td}>{r.months || '-'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{r.fee ? Number(r.fee).toLocaleString() : '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {p === pages.length - 1 && <div style={{ fontSize: '10.5px', marginTop: '6px' }}>* 대부분 계약 연장 차량으로, 대여 시작일은 최초 인도일이고 대여기간·반납 예정일은 현재(연장) 계약 기준입니다.</div>}
    </div>
  ));
}
