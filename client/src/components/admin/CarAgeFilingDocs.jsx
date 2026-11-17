import { targetTextOf } from '../../../../shared/carAgeFiling.js';

/**
 * 사업용자동차 차령조정 신청서 (별지 제55호서식) 앞쪽 + 별첨 차량 목록. 뒤쪽(처리 흐름)은 대표님 2026-11-17 요청으로 뺐다.
 * 2026-10-21에 서울시에 낸 45대 신청서 PDF와 같은 모양. 쪽마다 A4 세로 794×1123px로 그린다.
 * 부모가 .fleet-doc-page를 모아 makeA4PagesPdf로 PDF를 만든다.
 */

const PAGE = { width: 794, height: 1123 };
const SERIF = "'Batang', '바탕', 'Nanum Myeongjo', serif";
const SANS = "'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', sans-serif";
const LIST_ROWS = 45;

const pageStyle = {
  ...PAGE,
  position: 'relative',
  background: '#fff',
  color: '#000',
  fontFamily: SERIF,
  boxSizing: 'border-box',
  overflow: 'hidden',
  flex: '0 0 auto',
  boxShadow: '0 1px 6px rgba(0,0,0,0.18)',
  padding: '120px 88px 0'
};
const B = '2px solid #000';
const b = '1px solid #777';
const val = { fontFamily: SANS, fontSize: '13px', lineHeight: 1.55 };
const label = { fontSize: '15px', padding: '0 10px', lineHeight: 1.45 };

const dotted = (ymd) => {
  const [y, m, d] = String(ymd || '').slice(0, 10).split('-');
  return y ? `${y}. ${m}. ${d}.` : '';
};

function FrontPage({ filing }) {
  const a = filing.applicant || {};
  const [y, m, d] = String(filing.filedAt || '').slice(0, 10).split('-').map(Number);
  const target = targetTextOf(filing.items);
  return (
    <div className="fleet-doc-page" data-orientation="portrait" style={pageStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '2px' }}>
        <span>[별지 제55호서식] <span style={{ color: '#2563eb' }}>&lt;개정 2015.12.9.&gt;</span></span>
        <span>(앞 쪽)</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', borderTop: B, borderBottom: B }}>
        <colgroup><col style={{ width: '5.5%' }} /><col style={{ width: '22%' }} /><col style={{ width: '29%' }} /><col style={{ width: '17%' }} /><col style={{ width: '26.5%' }} /></colgroup>
        <tbody>
          <tr>
            <td colSpan={4} rowSpan={2} style={{ textAlign: 'center', fontSize: '22px', fontWeight: 700, letterSpacing: '2px', borderRight: b, height: '84px' }}>사업용자동차 차령조정 신청서</td>
            <td style={{ textAlign: 'center', fontSize: '15px', borderBottom: b, height: '42px' }}>처리기간</td>
          </tr>
          <tr><td style={{ textAlign: 'center', fontSize: '15px', height: '42px' }}>즉 시</td></tr>
          <tr style={{ borderTop: B }}>
            <td rowSpan={2} style={{ textAlign: 'center', fontSize: '15px', borderRight: b, lineHeight: 2 }}>신<br />청<br />인</td>
            <td style={{ ...label, borderRight: b, borderBottom: b, height: '62px', textAlign: 'center' }}>① 성명(법인인<br />경우 명칭 및<br />대표자 성명</td>
            <td style={{ ...val, padding: '4px 8px', borderRight: b, borderBottom: b }}>{a.name}<br />{a.ceo}</td>
            <td style={{ textAlign: 'center', fontSize: '15px', color: '#2563eb', borderRight: b, borderBottom: b }}>② 생년월일</td>
            <td style={{ ...val, padding: '4px 8px', borderBottom: b }}><span style={{ fontSize: '10px' }}>(법인등록번호)</span><br />{a.corpNo}</td>
          </tr>
          <tr>
            <td style={{ ...label, borderRight: b, height: '68px', textAlign: 'center', letterSpacing: '6px' }}>③ 주 소</td>
            <td colSpan={3} style={{ ...val, padding: '4px 8px', position: 'relative' }}>
              {a.address}<br />{a.address2}
              <div style={{ textAlign: 'right', fontFamily: SERIF, fontSize: '14px', marginTop: '2px' }}>(전화: <span style={{ fontFamily: SANS, display: 'inline-block', minWidth: '130px', textAlign: 'center' }}>{a.phone}</span>)</div>
            </td>
          </tr>
          <tr style={{ borderTop: b }}>
            <td colSpan={2} style={{ ...label, borderRight: b, height: '64px', textAlign: 'center', wordSpacing: '10px' }}>④ 사업의 종류</td>
            <td colSpan={3} style={{ ...val, padding: '4px 8px' }}>{a.business}</td>
          </tr>
          <tr style={{ borderTop: b }}>
            <td colSpan={2} style={{ ...label, borderRight: b, height: '64px', textAlign: 'center' }}>⑤ 차령조정 신청대상<br />자동차의 등록번호</td>
            <td colSpan={3} style={{ ...val, padding: '4px 8px' }}>{target.main}<br /><span style={{ fontSize: '11px' }}>{target.sub}</span></td>
          </tr>
          <tr style={{ borderTop: B }}>
            <td colSpan={5} style={{ position: 'relative', height: '318px', verticalAlign: 'top' }}>
              <div style={{ padding: '30px 22px 0 30px', fontSize: '15.5px', lineHeight: 1.9 }}>
                「여객자동차 운수사업법 시행규칙」 제107조제1항에 따라 사업용자동차의 차령조정을 신청합니다.
              </div>
              <div style={{ position: 'absolute', left: '300px', top: '110px', fontSize: '15.5px', whiteSpace: 'nowrap' }}>
                <span style={{ fontFamily: SANS, fontSize: '14px', display: 'inline-block', width: '44px', textAlign: 'right' }}>{y || ''}</span> 년
                <span style={{ fontFamily: SANS, fontSize: '14px', display: 'inline-block', width: '66px', textAlign: 'right' }}>{m || ''}</span> 월
                <span style={{ fontFamily: SANS, fontSize: '14px', display: 'inline-block', width: '66px', textAlign: 'right' }}>{d || ''}</span> 일
              </div>
              <div style={{ position: 'absolute', right: '24px', top: '190px', fontSize: '15.5px', whiteSpace: 'nowrap' }}>
                신청인 <span style={{ fontFamily: SANS, fontSize: '12px', display: 'inline-block', width: '150px' }}>{a.signName}</span> (서명 또는 인)
              </div>
              {filing.stamp && <img src="/docs/company-seal.png" alt="" style={{ position: 'absolute', right: '58px', top: '168px', width: '64px', opacity: 0.92 }} />}
              <div style={{ position: 'absolute', left: '60px', top: '262px', fontSize: '15.5px' }}>
                <b>시ㆍ도지사</b> 귀하 <span style={{ fontFamily: SANS, fontSize: '12px' }}>{a.addressee ? `(${a.addressee})` : ''}</span>
              </div>
            </td>
          </tr>
          <tr style={{ borderTop: b }}>
            <td colSpan={5} style={{ padding: '8px 14px 10px', fontSize: '15px', lineHeight: 1.75 }}>
              <span style={{ color: '#2563eb' }}>※ 첨부서류</span><br />
              <div style={{ paddingLeft: '18px', textAlign: 'justify' }}>
                「자동차관리법」 제44조 및 제45조에 따른 자동차검사대행자 또는 지정정비사업자가 발행한 별지 제56호서식의 사업용자동차 정기검사(일반택시운송사업자, 개인택시운송사업자 및 자동차대여사업자만 해당됩니다) 또는 임시검사 합격통지서 1부
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div style={{ textAlign: 'right', fontSize: '13px', marginTop: '3px' }}>210㎜×297㎜(신문용지 54g/㎡)</div>
    </div>
  );
}

const th = { border: '1px solid #444', background: '#e5e7eb', padding: '3px 6px', fontWeight: 700, textAlign: 'left', fontSize: '12px' };
const td = { border: '1px solid #444', padding: '2px 6px', fontSize: '12px', height: '17px' };

function ListPages({ filing }) {
  const items = filing.items || [];
  if (items.length < 2) return null;
  const a = filing.applicant || {};
  const chunks = [];
  for (let i = 0; i < items.length; i += LIST_ROWS) chunks.push(items.slice(i, i + LIST_ROWS));
  return chunks.map((rows, pi) => (
    <div key={pi} className="fleet-doc-page" data-orientation="portrait" style={{ ...pageStyle, fontFamily: SANS, padding: '76px 88px 0' }}>
      <div style={{ fontSize: '19px', fontWeight: 700, marginBottom: '6px' }}>[별첨] 차령조정 신청대상 자동차의 등록번호{chunks.length > 1 ? ` (${pi + 1}/${chunks.length})` : ''}</div>
      <div style={{ fontSize: '12px', marginBottom: '8px' }}>
        신청인: {a.name}{a.corpNo ? ` (법인등록번호 ${a.corpNo})` : ''}&nbsp;&nbsp; 총 {items.length}대&nbsp;&nbsp; {dotted(filing.filedAt)}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup><col style={{ width: '7%' }} /><col style={{ width: '15%' }} /><col style={{ width: '25%' }} /><col style={{ width: '22%' }} /><col style={{ width: '31%' }} /></colgroup>
        <thead><tr>{['연번', '차명', '자동차등록번호', '검사 합격일', '합격통지서'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((it, i) => {
            const n = pi * LIST_ROWS + i + 1;
            return (
              <tr key={n}>
                <td style={td}>{n}</td>
                <td style={{ ...td, whiteSpace: 'nowrap', overflow: 'hidden' }}>{it.carName}</td>
                <td style={td}>{it.plateNo}</td>
                <td style={td}>{it.passedAt}</td>
                <td style={{ ...td, whiteSpace: 'nowrap', overflow: 'hidden' }}>{it.note || `첨부 ${n}번`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  ));
}

export default function CarAgeFilingDocs({ filing }) {
  return (
    <>
      <FrontPage filing={filing} />
      <ListPages filing={filing} />
    </>
  );
}
