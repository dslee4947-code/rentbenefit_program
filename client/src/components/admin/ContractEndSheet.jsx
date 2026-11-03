/**
 * 계약종료 확인서.
 *
 * 양식은 Dropbox "09.중도해지/중도해지 위약금_260220.xlsx"의 '계약종료 확인서' 시트 그대로다(대표님 2026-11-03).
 * 정산이 끝난 고객에게 보낸다. 종료 구분(중도해지 · 만기 후 인수 · 만기 후 반납)에 따라 날짜 칸 이름과 안내 문구만 바뀐다.
 *
 * A4 한 장(794 × 1120px, 96dpi)으로 그린다. PDF는 여백 0으로 떠서 한 장이 A4 한 장이 된다.
 */

import { END_KINDS } from '../../utils/contractEnd.js';

const PAGE_W = 794;
const PAGE_H = 1120;

const RED = '#e8141b';
const GRAY = '#d9d9d9';
const DOT = '1px dotted #9a9a9a';

const blank = (v) => (v === undefined || v === null || String(v).trim() === '' ? '' : v);
const korDate = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : '';
};
const termText = (months) => {
  const n = Number(months) || 0;
  if (!n) return '';
  return n % 12 === 0 ? `${n / 12}년` : `${n}개월`;
};

function SectionTitle({ no, title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', margin: '0 0 6px' }}>
      <span style={{ color: RED, fontSize: '26px', fontWeight: 800, lineHeight: 1 }}>{no}.</span>
      <span style={{ fontSize: '17px', fontWeight: 800 }}>{title}</span>
    </div>
  );
}

const cellLabel = { textAlign: 'right', padding: '0 8px', fontSize: '12.5px', whiteSpace: 'nowrap', borderRight: '1px solid #bbb' };
const cellValue = { padding: '0 14px', fontSize: '12.5px' };

/**
 * @param {{ data: object, form: { kind: 'early'|'takeover'|'return', endDate: string, pickupAddress: string, phone: string, issueDate: string }, innerRef?: any }} props
 *   data = 서버 buildDeliveryDocs 결과(docs는 고른 차만)
 */
export default function ContractEndSheet({ data, form, innerRef }) {
  if (!data) return null;
  const type = END_KINDS[form.kind] || END_KINDS.return;
  const docs = data.docs || [];
  const plates = docs.map((d) => d.plateNo).filter(Boolean).join(', ');
  const models = [...new Set(docs.map((d) => d.carModel).filter(Boolean))].join(', ');
  const infoRows = [
    [['임차인명', blank(data.party.name)], ['차량번호', plates]],
    [['차종', models], [type.dateLabel, blank(form.endDate)]],
    ...(type.pickup ? [[['차량회수지(주소)', blank(form.pickupAddress)]]] : []),
    [['연락처', blank(form.phone)]]
  ];
  const lines = [...type.lines(korDate(form.endDate) || '        '), '기타 문의 사항은 렌트베네핏(☎ 02-547-0303)으로 연락 주시기 바랍니다. 감사합니다.'];
  const head = { background: GRAY, fontWeight: 800, fontSize: '13px', textAlign: 'center', height: '26px', borderRight: DOT };
  const cell = { textAlign: 'center', fontSize: '13px', fontWeight: 700, height: '26px', borderTop: DOT, borderRight: DOT };

  return (
    <div ref={innerRef} className="print-fit" style={{ width: `${PAGE_W}px`, background: '#fff' }}>
      <div style={{ width: `${PAGE_W}px`, height: `${PAGE_H}px`, padding: '46px 62px', boxSizing: 'border-box', background: '#fff', color: '#111', fontFamily: "'Malgun Gothic', sans-serif", position: 'relative', overflow: 'hidden' }}>
        <div style={{ textAlign: 'right', borderBottom: '5px solid #bfbfbf', paddingBottom: '4px' }}>
          <img src="/docs/company-name.png" alt="(주)렌트베네핏" style={{ height: '24px' }} />
        </div>

        <div style={{ textAlign: 'center', color: RED, fontSize: '28px', fontWeight: 800, margin: '34px 0 22px', letterSpacing: '0.5px' }}>
          렌트베네핏 렌터카 계약종료 확인서
        </div>

        <SectionTitle no={1} title="임차인 정보" />
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', borderTop: `3px solid ${RED}`, borderBottom: `2px solid ${RED}` }}>
          <colgroup><col style={{ width: '118px' }} /><col style={{ width: '118px' }} /><col style={{ width: '200px' }} /><col style={{ width: '92px' }} /><col /></colgroup>
          <tbody>
            {infoRows.map((row, i) => (
              <tr key={i} style={{ height: '27px', borderTop: i ? DOT : 'none' }}>
                {i === 0 && (
                  <td rowSpan={infoRows.length} style={{ background: GRAY, fontWeight: 800, fontSize: '13.5px', verticalAlign: 'top', padding: '8px 4px', lineHeight: 1.35 }}>
                    개인/법인<br />고객 정보
                  </td>
                )}
                {row.length === 1 ? [
                  <td key="l" style={cellLabel}>{row[0][0]}</td>,
                  <td key="v" style={cellValue} colSpan={3}>{row[0][1]}</td>
                ] : row.map(([l, v], j) => [
                  <td key={`l${j}`} style={cellLabel}>{l}</td>,
                  <td key={`v${j}`} style={cellValue}>{v}</td>
                ])}
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: '9.5px', marginTop: '3px' }}>* 기타(사용자)와 임차인 정보가 다를 시 계약자의 위임여부 확인 필요</div>

        <div style={{ height: '26px' }} />
        <SectionTitle no={2} title="계약 종료 안내" />
        <div style={{ display: 'flex', borderTop: `3px solid ${RED}`, borderBottom: `2px solid ${RED}` }}>
          <div style={{ background: GRAY, width: '118px', flex: 'none' }} />
          <div style={{ padding: '16px 14px 14px', fontSize: '13px', lineHeight: 1.5 }}>
            {lines.map((t, i) => (
              <div key={i} style={{ marginBottom: i === lines.length - 1 ? 0 : '15px' }}>{i + 1}. {t}</div>
            ))}
          </div>
        </div>

        <div style={{ height: '26px' }} />
        <SectionTitle no={3} title="계약내용" />
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', borderTop: `3px solid ${RED}`, borderBottom: `2px solid ${RED}` }}>
          <thead>
            <tr>
              {['계약내용', '계약일자', '만료일자', '계약기간', '종료 구분'].map((h, i) => (
                <th key={h} style={i === 4 ? { ...head, borderRight: 'none' } : head}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.vehicleId}>
                <td style={cell}>장기렌트{docs.length > 1 ? ` (${d.plateNo})` : ''}</td>
                <td style={cell}>{blank(d.deliveryDate)}</td>
                <td style={cell}>{blank(d.endDate)}</td>
                <td style={cell}>{termText(d.termMonths)}</td>
                <td style={{ ...cell, borderRight: 'none' }}>{type.label}</td>
              </tr>
            ))}
            {docs.length < 3 && Array.from({ length: 3 - docs.length }).map((_, i) => (
              <tr key={`e${i}`}>{[0, 1, 2, 3, 4].map((j) => <td key={j} style={j === 4 ? { ...cell, borderRight: 'none' } : cell} />)}</tr>
            ))}
          </tbody>
        </table>

        <div style={{ textAlign: 'center', marginTop: '48px', fontSize: '19px', fontWeight: 800 }}>{korDate(form.issueDate)}</div>
        <div style={{ textAlign: 'center', marginTop: '26px', fontSize: '19px', fontWeight: 800 }}>
          <span style={{ position: 'relative', display: 'inline-block', letterSpacing: '0.5px' }}>
            주식회사 &nbsp;렌트베네핏 &nbsp;대표이사 &nbsp;신 동 일
            <img src="/docs/company-seal.png" alt="" style={{ position: 'absolute', right: '-66px', top: '50%', transform: 'translateY(-50%)', width: '84px', opacity: 0.9 }} />
          </span>
        </div>

        <img src="/docs/brand-logo.png" alt="RENT BENefit" style={{ position: 'absolute', left: '62px', bottom: '36px', height: '56px' }} />
      </div>
    </div>
  );
}
