import { SCRAP_ROWS, platesText } from '../../../../shared/scrapFiling.js';

/**
 * 대폐차 신고서 1쪽(별지 제15호서식) + 2쪽 별첨 차량 목록. 쪽마다 A4 세로 794×1123px.
 * 1쪽은 회사 양식 PDF(도장 포함)를 그림으로 깔고 칸 자리에 글자만 얹는다. 자리 값은 양식 PDF에서 잰 px다.
 * 부모가 .fleet-doc-page를 모아 makeA4PagesPdf로 PDF를 만든다.
 */
const SANS = "'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', sans-serif";
const pageStyle = {
  width: 794, height: 1123, position: 'relative', background: '#fff', color: '#000', fontFamily: SANS,
  boxSizing: 'border-box', overflow: 'hidden', flex: '0 0 auto', boxShadow: '0 1px 6px rgba(0,0,0,0.18)'
};

// 양식 칸 위에 얹는 글자. 세로 가운데에 맞춘다.
function At({ x, y, w, h, size = 13.5, align = 'left', cover = false, children }) {
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: w, height: h, fontSize: size, lineHeight: 1.2, display: 'flex', alignItems: 'center', justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start', textAlign: align, background: cover ? '#fff' : 'none' }}>
      <span style={{ whiteSpace: 'pre' }}>{children}</span>
    </div>
  );
}

// 네 대부터는 세 대씩 두 줄로 나눈다
const plateCell = (plates) => {
  const list = plates.filter(Boolean);
  if (list.length > 6) return { text: platesText(list), size: 10.5 };
  if (list.length > 3) return { text: `${list.slice(0, 3).join(', ')},\n${list.slice(3).join(', ')}`, size: 9.5 };
  return { text: platesText(list), size: list.length > 2 ? 10.5 : 13.5 };
};

function FrontPage({ filing }) {
  const items = filing.items || [];
  const before = plateCell(items.map((it) => it.before?.plateNo));
  const after = plateCell(items.map((it) => it.after?.plateNo));
  const [y, m, d] = String(filing.filedAt || '').slice(0, 10).split('-').map(Number);
  const [cy, cm, cd] = String(filing.changedAt || '').split('-').map(Number);
  const reason = filing.reason || '';
  return (
    <div className="fleet-doc-page" data-orientation="portrait" style={pageStyle}>
      <img src="/docs/scrap-filing-form.png" alt="대폐차 신고서 양식" style={{ position: 'absolute', left: 0, top: 0, width: 794, height: 1123 }} />
      {filing.showCheck && <At x={208} y={132} w={18} h={26} size={18} align="center">√</At>}
      {filing.business && <At x={311} y={284} w={195} h={26} size={filing.business.length > 14 ? 10.5 : 13}>{filing.business}</At>}
      {cy > 0 && <At x={311} y={313} w={400} h={24}>{`${cy}년 ${cm}월 ${cd}일`}</At>}
      <At x={310} y={360} w={202} h={23} size={before.size}>{before.text}</At>
      {after.text && <At x={516} y={360} w={203} h={23} size={after.size} cover>{after.text}</At>}
      <At x={311} y={386} w={405} h={22} size={reason.length > 30 ? 10.5 : 13.5}>{reason}</At>
      {filing.showDate && y > 0 && (
        <>
          <At x={424} y={464} w={50} h={17} size={13} align="right">{y}</At>
          <At x={496} y={464} w={32} h={17} size={13} align="right">{m}</At>
          <At x={549} y={464} w={32} h={17} size={13} align="right">{d}</At>
        </>
      )}
    </div>
  );
}

const COLS = [34, 54, 78, 158, 60, 80, 85, 74];
// 선을 합치면(collapse) PDF로 뜰 때 두 번 그려져 굵어진다. 칸은 오른쪽·아래 선만 그린다.
const cell = { borderRight: '1px solid #000', borderBottom: '1px solid #000', textAlign: 'center', verticalAlign: 'middle', padding: '0 2px', fontSize: '12.5px', fontWeight: 400, lineHeight: 1.15, overflow: 'hidden', wordBreak: 'break-all', boxSizing: 'border-box' };
const nameSize = (s) => ({ fontSize: String(s || '').length > 4 ? '10.5px' : '12.5px', wordBreak: 'normal' });

function ListPages({ filing }) {
  const items = filing.items || [];
  const pages = Math.max(1, Math.ceil(items.length / SCRAP_ROWS));
  return Array.from({ length: pages }, (_, p) => (
    <div key={p} className="fleet-doc-page" data-orientation="portrait" style={{ ...pageStyle, padding: '77px 0 0 77px' }}>
      <table style={{ width: 623, borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', borderLeft: '1px solid #000', borderTop: '1px solid #000' }}>
        <colgroup>{COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
        <thead>
          <tr style={{ height: 41 }}>
            <th rowSpan={2} style={cell}>NO</th><th colSpan={3} style={cell}>변경전</th><th colSpan={3} style={cell}>변경후</th><th rowSpan={2} style={cell}>변경사유</th>
          </tr>
          <tr style={{ height: 41 }}>{['차량명', '차량번호', '차대번호', '차량명', '차량번호', '차대번호'].map((h, i) => <th key={i} style={cell}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {Array.from({ length: SCRAP_ROWS }, (_, i) => {
            const n = p * SCRAP_ROWS + i;
            const it = items[n];
            const reason = it ? it.reason || filing.reason || '' : '';
            return (
              <tr key={n} style={{ height: 36 }}>
                <td style={cell}>{n + 1}</td>
                <td style={{ ...cell, ...nameSize(it?.before?.carName) }}>{it?.before?.carName}</td>
                <td style={cell}>{it?.before?.plateNo}</td>
                <td style={cell}>{it?.before?.vin}</td>
                <td style={{ ...cell, ...nameSize(it?.after?.carName) }}>{it?.after?.carName}</td>
                <td style={cell}>{it?.after?.plateNo}</td>
                <td style={{ ...cell, fontSize: '9.5px' }}>{it?.after?.vin}</td>
                <td style={{ ...cell, fontSize: reason.length > 6 ? '10.5px' : '12.5px', wordBreak: 'keep-all' }}>{reason}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  ));
}

export default function ScrapFilingDocs({ filing }) {
  return (
    <>
      <FrontPage filing={filing} />
      <ListPages filing={filing} />
    </>
  );
}
