import { COMPANY, LINE, NAVY, NOTE_BG, PAGE_H, PAGE_W, RED, labelCell, tableStyle, valueCell, won } from '../../utils/endDocStyle.js';

/**
 * 중도해지 정산서 · 중도해지 안내문 · 계약종료 확인서가 함께 쓰는 모양.
 *
 * 디자인은 Dropbox "09.중도해지/중도해지_정산서261104.xlsx"를 따른다(대표님 2026-11-04):
 * 남색 제목과 남색 띠, 회색 이름 칸, 노란 결과 띠.
 * A4 한 장(794 × 1120px, 96dpi)으로 그린다. PDF는 여백 0으로 떠서 한 장이 A4 한 장이 된다.
 */

export function A4Page({ children, last = true, footer = true, padding = '34px 44px' }) {
  return (
    <div style={{ width: `${PAGE_W}px`, height: `${PAGE_H}px`, padding, boxSizing: 'border-box', background: '#fff', color: '#111', fontFamily: "'Malgun Gothic', sans-serif", position: 'relative', overflow: 'hidden', pageBreakAfter: last ? 'auto' : 'always', breakAfter: last ? 'auto' : 'page' }}>
      {children}
      {footer && <div style={{ position: 'absolute', left: 0, right: 0, bottom: '22px', textAlign: 'center', color: NAVY, fontWeight: 700, fontSize: '13px' }}>{COMPANY}</div>}
    </div>
  );
}

/** 왼쪽 큰 제목·설명, 오른쪽 회사명·발행일 */
export function DocHead({ title, sub, issueDate }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '16px', marginBottom: '12px' }}>
      <div>
        <div style={{ color: NAVY, fontSize: '25px', fontWeight: 800, lineHeight: 1.25 }}>{title}</div>
        {sub && <div style={{ color: '#808080', fontSize: '12px', marginTop: '3px' }}>{sub}</div>}
      </div>
      <div style={{ textAlign: 'right', flex: 'none' }}>
        <div style={{ color: NAVY, fontSize: '16px', fontWeight: 800 }}>{COMPANY}</div>
        {issueDate && <div style={{ color: '#808080', fontSize: '12px', marginTop: '3px' }}>발행일 : {issueDate}</div>}
      </div>
    </div>
  );
}

/** 남색 띠 제목 */
export function Band({ children, top = 12 }) {
  return <div style={{ background: NAVY, color: '#fff', fontWeight: 700, fontSize: '14px', padding: '5px 9px', marginTop: `${top}px`, lineHeight: 1.3 }}>{children}</div>;
}

/** 이름·값이 짝으로 놓인 표. rows = [[이름, 값, 이름, 값], …], 짝이 하나면 값이 줄 끝까지 간다 */
export function PairTable({ rows, label = '17%', value = '33%' }) {
  return (
    <table style={tableStyle}>
      <colgroup><col style={{ width: label }} /><col style={{ width: value }} /><col style={{ width: label }} /><col style={{ width: value }} /></colgroup>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td style={labelCell}>{row[0]}</td>
            <td style={valueCell} colSpan={row.length === 2 ? 3 : 1}>{row[1]}</td>
            {row.length > 2 && <td style={labelCell}>{row[2]}</td>}
            {row.length > 2 && <td style={valueCell}>{row[3]}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 추가 납부·환급을 한 줄로 알리는 노란 띠 */
export function ResultNote({ amount }) {
  const text = amount > 0
    ? `고객님께서 추가로 납부하실 금액은 ${won(amount)} 입니다.`
    : amount < 0 ? `고객님께 환급해 드릴 금액은 ${won(-amount)} 입니다.` : '추가로 납부하시거나 환급될 금액은 없습니다.';
  return <div style={{ background: NOTE_BG, color: RED, fontWeight: 800, fontSize: '16px', textAlign: 'center', padding: '8px', border: LINE, borderTop: 'none' }}>{text}</div>;
}

/** 회사 직인 줄 */
export function SealLine({ size = 18 }) {
  return (
    <div style={{ textAlign: 'center', fontSize: `${size}px`, fontWeight: 800, color: NAVY }}>
      <span style={{ position: 'relative', display: 'inline-block', letterSpacing: '0.5px' }}>
        주식회사 &nbsp;렌트베네핏 &nbsp;대표이사 &nbsp;신 동 일
        <img src="/docs/company-seal.png" alt="" style={{ position: 'absolute', right: '-66px', top: '50%', transform: 'translateY(-50%)', width: '80px', opacity: 0.9 }} />
      </span>
    </div>
  );
}
