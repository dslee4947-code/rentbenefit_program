import { filingSheetOf } from '../../../../shared/fleetFiling.js';

/**
 * 구청에 내는 증차·감차 서류 한 묶음. 엑셀 "증차공문 서류_251013.xlsx"의 시트를 그대로 옮겼다.
 * 1. 자동차대여사업 변경등록신청서 (별지 제35호서식, 세로)
 * 2. 자동차 대여사업 신구사업대비표 (가로, 차종이 많아 두세 장)
 * 3. 자동차매매계약서 (현대·기아 양식에 계약 내용과 회사 도장, 세로) — 증차할 때만
 *
 * 쪽마다 A4 크기 그대로 그린다(세로 794×1123px, 가로 1123×794px). 화면 미리보기와 PDF가 같은 쪽을 쓴다(utils/printFit.js의 makeA4PagesPdf).
 */

const PORTRAIT = { width: 794, height: 1123 };
const LANDSCAPE = { width: 1123, height: 794 };
const FONT = "'Malgun Gothic', '맑은 고딕', 'Apple SD Gothic Neo', sans-serif";

const pageStyle = (size) => ({
  ...size,
  position: 'relative',
  background: '#fff',
  color: '#000',
  fontFamily: FONT,
  boxSizing: 'border-box',
  overflow: 'hidden',
  flex: '0 0 auto',
  boxShadow: '0 1px 6px rgba(0,0,0,0.18)'
});

const won = (n) => (Number(n) ? Math.round(Number(n)).toLocaleString() : '');
const area3 = (n) => (Number(n) ? Number(n).toFixed(3) : '-');
const m2 = (n) => `${Math.round(Number(n) || 0).toLocaleString()}㎡`;
const dash = (n) => (Number(n) ? Number(n) : '-');

/* ── 1. 변경등록신청서 ───────────────────────────────────────── */

const B = '1.5px solid #000';
const b = '1px solid #000';
const cellPad = { padding: '6px 10px' };

function ApplicationPage({ info, filing, sheet }) {
  // 신청일은 'YYYY-MM-DD'(화면) 또는 날짜(저장된 공문)로 온다
  const [y, m, day] = String(filing.filedAt || '').slice(0, 10).split('-').map(Number);
  const c = info.company;
  return (
    <div className="fleet-doc-page" data-orientation="portrait" style={{ ...pageStyle(PORTRAIT), padding: '96px 78px 0 78px', fontSize: '14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
        <span>[별지 제35호서식] &lt;개정 2021. 9. 24.&gt;</span><span>(앞쪽)</span>
      </div>
      {/* 원본 양식은 칸마다 나뉜 자리가 달라 표를 덩어리별로 나눠 그린다 */}
      <table style={{ width: '100%', borderCollapse: 'collapse', borderTop: B, tableLayout: 'fixed' }}>
        <colgroup><col style={{ width: '79%' }} /><col style={{ width: '21%' }} /></colgroup>
        <tbody>
          <tr>
            <td rowSpan={2} style={{ textAlign: 'center', fontSize: '21px', fontWeight: 700, letterSpacing: '1px', borderRight: b, height: '104px' }}>자동차대여사업 변경등록신청서</td>
            <td style={{ textAlign: 'center', borderBottom: b, height: '52px' }}>처리기간</td>
          </tr>
          <tr><td style={{ textAlign: 'center', height: '52px' }}>7일</td></tr>
        </tbody>
      </table>
      <table style={{ width: '100%', borderCollapse: 'collapse', borderTop: B, tableLayout: 'fixed' }}>
        <colgroup><col style={{ width: '3.9%' }} /><col style={{ width: '24.3%' }} /><col style={{ width: '23.8%' }} /><col style={{ width: '23.9%' }} /><col style={{ width: '24.1%' }} /></colgroup>
        <tbody>
          <tr>
            <td rowSpan={2} style={{ borderRight: b }} />
            <td style={{ ...cellPad, borderRight: b, borderBottom: b }}>③ 법인명</td>
            <td style={{ ...cellPad, borderRight: b, borderBottom: b, whiteSpace: 'nowrap' }}>{c.name}</td>
            <td colSpan={2} style={{ ...cellPad, borderBottom: b, textAlign: 'right' }}>(전화: {c.phone} )</td>
          </tr>
          <tr>
            <td style={{ ...cellPad, borderRight: b }}>④ 주소</td>
            <td colSpan={2} style={{ ...cellPad, borderRight: b, whiteSpace: 'nowrap' }}>{c.address}</td>
            <td style={{ ...cellPad, textAlign: 'right', whiteSpace: 'nowrap' }}>(전화: {c.officePhone} )</td>
          </tr>
        </tbody>
      </table>
      <table style={{ width: '100%', borderCollapse: 'collapse', borderTop: B, tableLayout: 'fixed' }}>
        <colgroup><col style={{ width: '11.8%' }} /><col style={{ width: '44.5%' }} /><col style={{ width: '43.7%' }} /></colgroup>
        <tbody>
          <tr>
            <td rowSpan={2} style={{ padding: '4px 6px', borderRight: b, whiteSpace: 'nowrap', lineHeight: 1.6 }}>⑤ 변 경<br />&nbsp;&nbsp;&nbsp;&nbsp;사 항</td>
            <td style={{ textAlign: 'center', borderRight: b, borderBottom: b, padding: '5px' }}>변경 전</td>
            <td style={{ textAlign: 'center', borderBottom: b, padding: '5px' }}>변경 후</td>
          </tr>
          <tr>
            <td style={{ textAlign: 'center', borderRight: b, padding: '6px' }}>{sheet.beforeTotal}대</td>
            <td style={{ textAlign: 'center', padding: '6px' }}>{sheet.afterTotal}대</td>
          </tr>
        </tbody>
      </table>
      <table style={{ width: '100%', borderCollapse: 'collapse', borderTop: B, tableLayout: 'fixed' }}>
        <colgroup><col style={{ width: '11.8%' }} /><col style={{ width: '88.2%' }} /></colgroup>
        <tbody>
          <tr>
            <td style={{ padding: '4px 6px', borderRight: b, whiteSpace: 'nowrap', lineHeight: 1.6 }}>⑥ 변 경<br />&nbsp;&nbsp;&nbsp;&nbsp;사 유</td>
            <td style={{ textAlign: 'center', padding: '6px', whiteSpace: 'pre-line', lineHeight: 1.5 }}>{sheet.reason}</td>
          </tr>
        </tbody>
      </table>
      <table style={{ width: '100%', borderCollapse: 'collapse', borderBottom: B, tableLayout: 'fixed' }}>
        <tbody>
          <tr style={{ borderTop: B }}>
            <td style={{ position: 'relative', height: '262px', verticalAlign: 'top' }}>
              <div style={{ padding: '30px 0 0 52px', lineHeight: 1.6 }}>
                「여객자동차 운수사업법」 제35조 및 같은 법 시행규칙 제65조에 따라<br />자동차대여사업 변경등록을 신청합니다.
              </div>
              <div style={{ position: 'absolute', right: '42px', top: '104px', fontSize: '14.5px', letterSpacing: '1px' }}>
                {y || ''} 년&nbsp;&nbsp; {m || ''} 월&nbsp;&nbsp; {day || ''} 일
              </div>
              <div style={{ position: 'absolute', left: '300px', top: '150px' }}>신청인</div>
              <div style={{ position: 'absolute', right: '20px', top: '150px' }}>(서명 또는 인)</div>
              <div style={{ position: 'absolute', left: '42px', top: '186px' }}>시ㆍ도지사 귀하</div>
              <img src="/docs/company-stamp-address.png" alt="" style={{ position: 'absolute', left: '300px', top: '120px', width: '236px' }} />
              <img src="/docs/company-seal.png" alt="" style={{ position: 'absolute', left: '528px', top: '120px', width: '74px' }} />
            </td>
          </tr>
          <tr style={{ borderTop: B }}>
            <td style={{ position: 'relative', height: '400px', verticalAlign: 'top', padding: '22px 14px 0 22px', fontSize: '13.5px', lineHeight: 1.75 }}>
              <div style={{ position: 'absolute', right: '0', top: '0', width: '170px', borderLeft: b, borderBottom: b, textAlign: 'center', fontSize: '13px' }}>
                <div style={{ borderBottom: b, padding: '4px' }}>수 수 료</div>
                <div style={{ padding: '18px 6px', lineHeight: 1.7 }}>증차: 5,000원<br />자동차 1대당 2,000원 추가<br />기타: 2,000원</div>
              </div>
              <div style={{ paddingRight: '170px' }}>
                ※ 첨부서류<br />
                &nbsp;1. 신ㆍ구 사업계획대비표 1부<br />
                &nbsp;2. 자동차 대수를 늘리는 경우에는 다음 각 목의 서류<br />
                &nbsp;&nbsp;&nbsp;가. 늘어나는 대여사업용 자동차의 명세서(자동차번호, 차종, 연식, 등록일, 길이, 너비가 포함되어야 합니다)나 자동차매매계약서 1부
              </div>
              <div style={{ marginTop: '18px' }}>
                &nbsp;&nbsp;&nbsp;나. 차고를 설치하려는 토지의 소유권 또는 사용권을 증명할 수 있는 서류와 수용능력을 적은 서류 각 1부<br />
                &nbsp;3. 시설의 임대기간 또는 주차장의 사용계약기간이 끝나 재계약하여 사용하려는 경우에는 시설의 임대기간 또는 사용계약기간이 적힌 재계약서류 1부<br />
                &nbsp;4. 매매계약서를 제출하여 자동차대여사업의 등록을 한 후 자동차등록 시의 대여사업용 자동차의 종류 또는 대수가 자동차대여사업 등록 시의 대여사업용 자동차의 종류 또는 대수가 변경된 경우에는 다음 각 목의 서류<br />
                &nbsp;&nbsp;가. 변경사유서 1부<br />
                &nbsp;&nbsp;나. 변경하려는 자동차의 매매계약서 1부
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div style={{ textAlign: 'right', fontSize: '12px', marginTop: '4px' }}>210㎜×297㎜(신문용지 54g/㎡)</div>
    </div>
  );
}

/* ── 2. 신구사업대비표 ───────────────────────────────────────── */

const NAVY = '#1f3864';
const CREAM = '#fff2cc';
const th2 = { border: '1px solid #000', padding: '2px 4px', fontWeight: 700, textAlign: 'center', fontSize: '13px', background: '#fff' };
const tdDot = { borderLeft: '1px dashed #000', borderRight: '1px dashed #000', borderBottom: '1px solid #000', padding: '0 6px', fontSize: '12.5px', height: '19px', lineHeight: '18px' };
const FIRST_ROWS = 16;
const NEXT_ROWS = 34;

function ComparisonHead({ info, sheet }) {
  const g = sheet.garage;
  const net = sheet.afterTotal - sheet.beforeTotal;
  const note = sheet.increase && !sheet.decrease ? '증차' : sheet.decrease && !sheet.increase ? '감차' : '증감';
  return (
    <>
      <div style={{ textAlign: 'center', fontSize: '21px', fontWeight: 700, marginBottom: '22px' }}>자동차 대여사업 신구사업대비표</div>
      <div style={{ fontSize: '13.5px', lineHeight: '24px', marginBottom: '6px' }}>
        <div><b style={{ display: 'inline-block', width: '160px' }}>□ 업&nbsp;&nbsp;&nbsp;체&nbsp;&nbsp;&nbsp;명 :</b>{info.company.name}</div>
        <div><b style={{ display: 'inline-block', width: '160px' }}>□ 주 사 무 소 :</b>{info.company.officeAddress}</div>
        <div><b style={{ display: 'inline-block', width: '160px' }}>□ 변경등록내역 :</b>{sheet.registrationLabel}</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', borderTop: `3px solid ${NAVY}`, borderBottom: `3px solid ${NAVY}`, marginBottom: '16px', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '8%' }} /><col style={{ width: '14%' }} /><col style={{ width: '7.5%' }} /><col style={{ width: '5%' }} /><col style={{ width: '5%' }} /><col style={{ width: '5%' }} />
          <col style={{ width: '14%' }} /><col style={{ width: '7.5%' }} /><col style={{ width: '5%' }} /><col style={{ width: '5%' }} /><col style={{ width: '5%' }} /><col style={{ width: '6%' }} /><col style={{ width: '8%' }} />
        </colgroup>
        <tbody>
          <tr>
            <td rowSpan={3} style={th2}>구분</td>
            <td colSpan={5} style={th2}>변 경 전</td>
            <td colSpan={5} style={th2}>변 경 후</td>
            <td colSpan={2} rowSpan={3} style={th2}>비고</td>
          </tr>
          <tr>
            <td colSpan={2} style={{ ...th2, fontWeight: 400 }}>차고지면적(단위:㎡)</td>
            <td colSpan={3} style={{ ...th2, fontWeight: 400 }}>자동차대수<br />및 종별</td>
            <td colSpan={2} style={{ ...th2, fontWeight: 400 }}>차고지면적(단위:㎡)</td>
            <td colSpan={3} style={{ ...th2, fontWeight: 400 }}>자동차대수<br />및 종별</td>
          </tr>
          <tr>
            {['변경 전', '규모(㎡)', '계', '승용', '승합', '위치', '규모(㎡)', '계', '승용', '승합'].map((t, i) => <td key={i} style={{ ...th2, fontWeight: 400 }}>{t}</td>)}
          </tr>
          <tr style={{ height: '40px' }}>
            <td style={th2}>주사무소</td>
            <td style={{ ...th2, fontWeight: 400 }}>{g.location}</td>
            <td style={{ ...th2, fontWeight: 400, color: '#e00' }}>{m2(g.area)}</td>
            <td style={{ ...th2, fontWeight: 400 }}>{sheet.beforeTotal}</td>
            <td style={{ ...th2, fontWeight: 400 }}>{sheet.beforeTotal}</td>
            <td style={{ ...th2, fontWeight: 400 }}>0</td>
            <td style={{ ...th2, fontWeight: 400 }}>{g.location}</td>
            <td style={{ ...th2, fontWeight: 400, color: '#e00' }}>{m2(g.area)}</td>
            <td style={{ ...th2, fontWeight: 400 }}>{sheet.afterTotal}</td>
            <td style={{ ...th2, fontWeight: 400 }}>{sheet.afterTotal}</td>
            <td style={{ ...th2, fontWeight: 400 }}>0</td>
            <td style={{ ...th2, fontWeight: 400 }}>{net === 0 ? '변경' : note}</td>
            <td style={{ ...th2, fontWeight: 400 }}>{net === 0 ? '-' : `${net}대`}</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}

const COMP_COLS = ['9%', '8.5%', '8.5%', '7.5%', '11%', '8.5%', '8.5%', '7.5%', '11%', '20%'];

function ComparisonTableHead({ sheet }) {
  return (
    <>
      <colgroup>{COMP_COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
      <thead>
        <tr>
          <td rowSpan={3} style={th2}>구분</td>
          <td colSpan={4} style={{ ...th2, height: '28px' }}>변 경 전</td>
          <td colSpan={4} style={th2}>변 경 후</td>
          <td rowSpan={3} style={th2}>변경 후 사용 면적(㎡)</td>
        </tr>
        <tr>
          <td colSpan={2} style={{ ...th2, fontWeight: 400, borderBottom: 'none' }}>재원</td>
          <td rowSpan={2} style={{ ...th2, fontWeight: 400 }}>대수</td>
          <td rowSpan={2} style={{ ...th2, fontWeight: 400 }}>사용면적(㎡)</td>
          <td colSpan={2} style={{ ...th2, fontWeight: 400, borderBottom: 'none' }}>재원</td>
          <td rowSpan={2} style={{ ...th2, fontWeight: 400 }}>대수</td>
          <td rowSpan={2} style={{ ...th2, fontWeight: 400 }}>사용면적(㎡)</td>
        </tr>
        <tr>
          <td style={{ ...th2, fontWeight: 400 }}>가로</td><td style={{ ...th2, fontWeight: 400 }}>세로</td>
          <td style={{ ...th2, fontWeight: 400 }}>가로</td><td style={{ ...th2, fontWeight: 400 }}>세로</td>
        </tr>
        {sheet && (
          <tr style={{ background: '#dbe5f1', fontWeight: 700 }}>
            <td style={{ ...tdDot, textAlign: 'center' }}>계</td>
            <td style={tdDot} /><td style={tdDot} />
            <td style={{ ...tdDot, textAlign: 'right' }}>{sheet.beforeTotal}</td>
            <td style={{ ...tdDot, textAlign: 'right' }}>{m2(sheet.beforeArea)}</td>
            <td style={tdDot} /><td style={tdDot} />
            <td style={{ ...tdDot, textAlign: 'right' }}>{sheet.increase + sheet.decrease}</td>
            <td style={{ ...tdDot, textAlign: 'right' }}>{m2(sheet.changeArea)}</td>
            <td style={{ ...tdDot, textAlign: 'right' }}>{m2(sheet.garage.afterUsedArea)}</td>
          </tr>
        )}
      </thead>
    </>
  );
}

function ComparisonRow({ r, side }) {
  const changed = r.delta !== 0;
  return (
    <tr>
      <td style={{ ...tdDot, textAlign: 'center', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden' }}>{r.name}</td>
      <td style={{ ...tdDot, textAlign: 'center', background: CREAM }}>{r.width || ''}</td>
      <td style={{ ...tdDot, textAlign: 'center', background: CREAM }}>{r.length || ''}</td>
      <td style={{ ...tdDot, textAlign: 'right', background: CREAM }}>{dash(r.before)}</td>
      <td style={{ ...tdDot, textAlign: 'right' }}>{area3(r.beforeArea)}</td>
      <td style={{ ...tdDot, textAlign: 'center' }}>{changed ? r.width.toFixed(3) : ''}</td>
      <td style={{ ...tdDot, textAlign: 'center' }}>{changed ? r.length.toFixed(3) : ''}</td>
      <td style={{ ...tdDot, textAlign: 'right', background: CREAM, color: r.delta < 0 ? '#c00' : undefined }}>{changed ? r.delta : ''}</td>
      <td style={{ ...tdDot, textAlign: 'right' }}>{changed ? area3(r.afterArea) : '-'}</td>
      <td style={{ ...tdDot, fontSize: '11px' }}>
        {side && <span style={{ display: 'flex', justifyContent: 'space-between' }}><span>{side[0]}</span><span>{side[1]}</span></span>}
      </td>
    </tr>
  );
}

function ComparisonPages({ info, sheet }) {
  const g = sheet.garage;
  const side = [
    ['감면전 소요면적', m2(g.requiredArea)],
    ['감면 면적', m2(g.reduction)],
    ['감면후 소요면적', m2(g.reducedRequired)],
    ['재계약 면적', m2(g.contractArea)],
    ['잔여면적', m2(g.remaining)]
  ];
  const chunks = [sheet.rows.slice(0, FIRST_ROWS)];
  for (let i = FIRST_ROWS; i < sheet.rows.length; i += NEXT_ROWS) chunks.push(sheet.rows.slice(i, i + NEXT_ROWS));
  return chunks.map((rows, pi) => (
    <div key={pi} className="fleet-doc-page" data-orientation="landscape" style={{ ...pageStyle(LANDSCAPE), padding: pi === 0 ? '64px 78px 0' : '78px 78px 0' }}>
      {pi === 0 && <ComparisonHead info={info} sheet={sheet} />}
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', borderTop: pi === 0 ? `3px solid ${NAVY}` : 'none', borderBottom: `2px solid ${NAVY}` }}>
        {pi === 0 ? <ComparisonTableHead sheet={sheet} /> : <colgroup>{COMP_COLS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>}
        <tbody>
          {rows.map((r, i) => <ComparisonRow key={`${pi}-${i}`} r={r} side={pi === 0 ? side[i] : null} />)}
        </tbody>
      </table>
    </div>
  ));
}

/* ── 3. 자동차매매계약서 ─────────────────────────────────────── */

// 칸 자리는 구청에 낸 PDF(현대: 2026-10-21 GV80H)에서 잰 값, 기아는 같은 엑셀 칸 배치로 옮긴 값. 양식 그림 크기에 대한 비율.
// 계약번호·차종·색상은 원본에서 칸 이름 글자와 겹쳐 찍혀 조금 오른쪽으로 옮겼다.
const CONTRACT_LAYOUT = {
  현대: {
    image: '/docs/sale-contract-hyundai.jpg',
    contractNo: { left: 0.13, top: 0.1202 },
    model: { left: 0.152, top: 0.165 },
    color: { left: 0.158, top: 0.1911 },
    qty: { right: 0.5753, top: 0.1909 },
    price: { right: 0.3119, top: 0.2217 },
    deposit: { right: 0.5767, top: 0.2218 },
    deliveryFee: { right: 0.3117, top: 0.2485 },
    stamps: [
      { src: '/docs/company-stamp-address.png', left: 0.0412, top: 0.4321, width: 0.3257 },
      { src: '/docs/company-seal.png', left: 0.3444, top: 0.4353, width: 0.0985 },
      { src: '/docs/company-stamp-address.png', left: 0.5486, top: 0.8468, width: 0.3259 },
      { src: '/docs/company-seal.png', left: 0.8522, top: 0.8499, width: 0.0978 }
    ]
  },
  기아: {
    image: '/docs/sale-contract-kia.jpg',
    contractNo: { left: 0.165, top: 0.1065 },
    model: { left: 0.19, top: 0.1765 },
    color: { left: 0.19, top: 0.1991 },
    qty: { right: 0.5753, top: 0.1989 },
    price: { right: 0.3119, top: 0.2491 },
    deposit: { right: 0.8265, top: 0.2491 },
    deliveryFee: { right: 0.3117, top: 0.2969 },
    stamps: [
      { src: '/docs/company-stamp-address.png', left: 0.4834, top: 0.5121, width: 0.319 },
      { src: '/docs/company-seal.png', left: 0.7799, top: 0.5151, width: 0.092 },
      { src: '/docs/company-stamp-address.png', left: 0.4802, top: 0.8071, width: 0.319 },
      { src: '/docs/company-seal.png', left: 0.7765, top: 0.81, width: 0.092 }
    ]
  }
};

function ContractPage({ contract }) {
  const L = CONTRACT_LAYOUT[contract.maker] || CONTRACT_LAYOUT.현대;
  const { width: W, height: H } = PORTRAIT;
  const at = (pos, value) => (value ? (
    <div style={{
      position: 'absolute',
      top: `${pos.top * H - 2}px`,
      ...(pos.left != null ? { left: `${pos.left * W}px` } : { right: `${W - pos.right * W}px` }),
      fontSize: '13px', lineHeight: 1, whiteSpace: 'nowrap', color: '#000'
    }}>{value}</div>
  ) : null);
  return (
    <div className="fleet-doc-page" data-orientation="portrait" style={pageStyle(PORTRAIT)}>
      <img src={L.image} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {at(L.contractNo, contract.contractNo || '-')}
      {at(L.model, contract.model)}
      {at(L.color, contract.color)}
      {at(L.qty, contract.qty)}
      {at(L.price, won(contract.price))}
      {at(L.deposit, won(contract.deposit))}
      {at(L.deliveryFee, won(contract.deliveryFee))}
      {L.stamps.map((s, i) => (
        <img key={i} src={s.src} alt="" style={{ position: 'absolute', left: `${s.left * W}px`, top: `${s.top * H}px`, width: `${s.width * W}px`, opacity: 0.92 }} />
      ))}
    </div>
  );
}

/**
 * 공문 한 건의 서류 전체. 부모가 .fleet-doc-page를 모아 PDF로 묶는다.
 */
export default function FleetFilingDocs({ info, filing }) {
  const sheet = filingSheetOf(info, filing);
  const contracts = sheet.increase > 0 ? (filing.contracts || []) : [];
  return (
    <>
      <ApplicationPage info={info} filing={filing} sheet={sheet} />
      <ComparisonPages info={info} sheet={sheet} />
      {contracts.map((c, i) => <ContractPage key={i} contract={c} />)}
    </>
  );
}
