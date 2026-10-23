/**
 * 계약사실 증명원 + 상환스케쥴.
 *
 * 양식은 Dropbox "계약사실 증명원_인도일, 계약 종료일.xlsx"의 두 시트 그대로다(2026-10-23 대표님).
 * 차 한 대마다 [계약사실 증명원 1장 + 상환스케쥴 1장]을 그린다. 차가 여러 대인 계약은 그만큼 이어 붙인다.
 *
 * 한 장은 A4(794 × 1122px, 96dpi) 크기로 그리고 장마다 나눈다. PDF는 여백 0으로 떠서 한 장이 A4 한 장이 된다.
 * 값은 서버(deliveryDocsController.buildDeliveryDocs)가 만든 것을 그대로 쓴다. 발송 전 확인도 같은 값으로 하기 때문이다.
 */

const PAGE_W = 794;
const PAGE_H = 1120;

const won = (n) => (Number(n) ? Number(n).toLocaleString('ko-KR') : '0');
const blank = (v) => (v === undefined || v === null || String(v).trim() === '' ? '-' : v);
const dayText = (d) => (/^\d+$/.test(String(d || '')) ? `${d}일` : blank(d));

const C = {
  line: '#9aa3ad',
  label: '#eef1f5',
  title: '#111e38'
};

const td = { border: `1px solid ${C.line}`, padding: '2px 7px', fontSize: '11.5px', height: '23px', lineHeight: '15px', verticalAlign: 'middle' };
const th = { ...td, background: C.label, fontWeight: 700, whiteSpace: 'nowrap', width: '96px' };

function Header({ title }) {
  return (
    <div style={{ position: 'relative', height: '74px', marginBottom: '8px' }}>
      <img src="/docs/brand-logo.png" alt="RENT BENefit" style={{ position: 'absolute', left: 0, top: 0, height: '44px' }} />
      <img src="/docs/company-name.png" alt="(주)렌트베네핏" style={{ position: 'absolute', right: 0, top: '10px', height: '22px' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: '42px', textAlign: 'center', fontSize: '22px', fontWeight: 800, color: C.title, letterSpacing: '1px' }}>{title}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginTop: '9px' }}>
      <div style={{ fontSize: '12.5px', fontWeight: 800, color: C.title, margin: '0 0 4px' }}>{title}</div>
      {children}
    </div>
  );
}

/** 칸 짝(라벨, 값)을 한 줄에 여러 개 */
function Grid({ rows }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map(([label, value, span = 1], j) => (
              [
                <th key={`l${j}`} style={th}>{label}</th>,
                <td key={`v${j}`} style={td} colSpan={span}>{value}</td>
              ]
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Page({ children, last }) {
  return (
    <div
      style={{
        width: `${PAGE_W}px`,
        height: `${PAGE_H}px`,
        padding: '30px 44px',
        boxSizing: 'border-box',
        background: '#fff',
        color: '#111',
        fontFamily: "'Malgun Gothic', sans-serif",
        position: 'relative',
        overflow: 'hidden',
        pageBreakAfter: last ? 'auto' : 'always',
        breakAfter: last ? 'auto' : 'page'
      }}
    >
      {children}
    </div>
  );
}

function FactPage({ data, doc }) {
  const p = data.party;
  const ins = doc.insurance || {};
  return (
    <Page>
      <Header title="계약사실 증명원(개인/법인)" />

      <Section title="1. 고객 정보">
        <Grid rows={[
          [['개인/법인명', blank(p.name)], ['사업자번호', blank(p.bizNo)], ['법인번호', blank(p.corpNo)]],
          [['주소', blank(p.address), 3], ['대표자명', blank(p.ceoName)]],
          [['차량번호', blank(doc.plateNo)], ['차대번호', blank(doc.vin)], ['연락처', blank(p.phone)]]
        ]} />
      </Section>

      <Section title="2. 차량 조건">
        <Grid rows={[
          [['대여차종', blank(doc.carModel)], ['외장 색상', blank(doc.color)]],
          [['옵션사항', blank(doc.options), 3]]
        ]} />
      </Section>

      <Section title="3. 상품조건">
        <Grid rows={[
          [['차량가격', `${won(doc.carPrice)} 원`], ['인수가', doc.takeoverPrice ? `${won(doc.takeoverPrice)} 원` : '만기시 반납'], ['주행약정거리', doc.mileage ? `${won(doc.mileage)} km` : '-']],
          [['상품구분', '장기렌트'], ['보증금', `${won(doc.deposit)} 원`], ['대여기간', doc.termMonths ? `${doc.termMonths} 개월` : '-']],
          [['인수가능여부', doc.takeoverText], ['선납금', `${won(doc.advancePayment)} 원`], ['계산서발행일', '영업일 기준 3일 후']],
          [['위약금률', blank(doc.earlyRate)], ['연체이율', blank(doc.lateRate)], ['대여료결제일', dayText(doc.paymentDay)]],
          [['납입방법', 'CMS'], ['대여료 납입주기', '매월 납부'], ['월대여료', <>{won(doc.monthlyFee)} 원 <span style={{ fontSize: '9px', color: '#555' }}>(VAT포함)</span></>]],
          [['차량인도일', blank(doc.deliveryDate)], ['계약종료일', blank(doc.endDate)], ['첫달 결제일', blank(doc.firstDueDate)]]
        ]} />
        <div style={{ height: '6px' }} />
        <Grid rows={[
          [['긴급출동', blank(doc.emergency)], ['검사정비', blank(doc.regularCheck)]],
          [['일반정비', blank(doc.generalMaintenance)], ['소모품교환', blank(doc.consumables)]],
          [['사고수리', blank(doc.accidentRepair)], ['타이어본수', blank(doc.tireText)]]
        ]} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: '#444', marginTop: '4px' }}>
          <span>* 만기 후 소유권 이전과 관련한 취득세는 별도 납부</span>
          <span>* 정비 항목 및 소모품 교환 주기는 정비 서비스 타입별 정비 기준에 따름</span>
        </div>
      </Section>

      <Section title="4. 보증금/수수료 납입 영수증">
        <div style={{ position: 'relative' }}>
          <Grid rows={[
            [['고객명', blank(p.name)], ['사업자번호', blank(p.bizNo)]],
            [['보증금', `${won(doc.deposit)} 원`], ['수수료', data.commission ? `${data.commission} 원` : '-']]
          ]} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11.5px', margin: '12px 0 12px' }}>
            <span>위의 금액을 정히 영수함</span>
            <span>{data.receiptDate || '        년      월      일'}</span>
            <span style={{ position: 'relative', display: 'inline-block', marginRight: '40px' }}>
              렌트베네핏 주식회사 &nbsp; 대표이사 &nbsp; 신 동 일 &nbsp;(인)
              <img src="/docs/company-seal.png" alt="" style={{ position: 'absolute', right: '-24px', top: '50%', transform: 'translateY(-50%)', width: '64px', opacity: 0.9 }} />
            </span>
          </div>
        </div>
      </Section>

      <Section title="5. 보험사항">
        <Grid rows={[
          [['운전자 범위', blank(ins.driverRange)], ['대인배상', blank(ins.liability)], ['대물배상', blank(ins.property)]],
          [['운전자 연령', blank(ins.driverAge)], ['자기신체사고', blank(ins.personalInjury)], ['무보험차상해', blank(ins.uninsured)]],
          [['기타', '-'], ['고객부담금', blank(ins.deductible)], ['', '']]
        ]} />
      </Section>

      <Section title="6. 고객 담당지점 안내">
        <div style={{ border: `1px solid ${C.line}`, padding: '8px 10px', fontSize: '12px', textAlign: 'right' }}>
          렌터카 상담사 &nbsp; 이 두 식 &nbsp; M. 010-9061-3000
        </div>
      </Section>

      <div style={{ marginTop: '14px', fontSize: '11.5px', lineHeight: 1.7 }}>
        <div style={{ fontWeight: 700 }}>위와 같이 자동차렌트 계약이 체결되었음을 확인합니다.</div>
        <div style={{ color: '#444' }}>계약사실 증명원의 내용과 계약사실이 다를 경우, 담당지점 또는 렌트베네핏 02-547-0303로 문의 바랍니다.</div>
      </div>
      <div style={{ textAlign: 'right', marginTop: '10px', paddingRight: '40px', fontSize: '14px', fontWeight: 700 }}>
        <span style={{ position: 'relative', display: 'inline-block' }}>
          렌트베네핏 주식회사 &nbsp; 대표이사 &nbsp; 신 동 일 &nbsp;(인)
          <img src="/docs/company-seal.png" alt="" style={{ position: 'absolute', right: '-24px', top: '50%', transform: 'translateY(-50%)', width: '64px', opacity: 0.9 }} />
        </span>
      </div>
    </Page>
  );
}

// 상환스케쥴 표에 쓸 수 있는 높이(px). 첫 장은 위 요약 칸이 있어 낮다. 합계 줄도 이 안에 든다.
const FIRST_BODY_H = 800;
const NEXT_BODY_H = 940;
// 한 줄 높이. 회차가 적으면 넉넉하게 늘려 한 장을 채우고, 한 장에 다 안 들어가면 읽기 좋은 높이로 다음 장에 잇는다.
const ROW_MIN = 18;
const ROW_MAX = 24;
const ROW_SPLIT = 22; // 여러 장으로 나눌 때 한 장에 몇 회차까지 넣을지 셀 때 쓰는 높이

/** 회차를 장마다 나누고 줄 높이를 정한다 */
function layoutSchedule(rows) {
  const lines = rows.length + 1; // 합계 줄
  if (lines * ROW_MIN <= FIRST_BODY_H) {
    return { chunks: [rows], rowH: Math.min(ROW_MAX, Math.floor(FIRST_BODY_H / lines)) };
  }
  // 한 장에 다 안 들어가면 장 수를 정한 뒤 회차를 장마다 고르게 나눈다(48회차면 24·24).
  // 뒷장만 몇 줄 남는 모양이 되지 않게 하려는 것이다.
  const firstCap = Math.floor(FIRST_BODY_H / ROW_SPLIT) - 1;
  const nextCap = Math.floor(NEXT_BODY_H / ROW_SPLIT) - 1;
  let pages = 2;
  while (firstCap + nextCap * (pages - 1) < rows.length) pages += 1;
  const per = Math.ceil(rows.length / pages);
  const chunks = [];
  for (let i = 0; i < rows.length; i += per) chunks.push(rows.slice(i, i + per));
  return { chunks, rowH: Math.max(ROW_MIN, Math.min(ROW_MAX, Math.floor(FIRST_BODY_H / (per + 1)))) };
}

function SchedulePages({ data, doc, isLastDoc }) {
  const rows = doc.schedule || [];
  const { chunks, rowH } = layoutSchedule(rows);
  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const cell = {
    border: `1px solid ${C.line}`, padding: '0 10px', fontSize: rowH >= 21 ? '12px' : '11.5px',
    height: `${rowH}px`, lineHeight: `${rowH - 2}px`, textAlign: 'right', fontVariantNumeric: 'tabular-nums'
  };
  const head = { ...cell, background: C.label, fontWeight: 700, textAlign: 'center', height: '26px', lineHeight: '24px' };

  return chunks.map((chunk, ci) => (
    <Page key={ci} last={isLastDoc && ci === chunks.length - 1}>
      <Header title={ci ? '렌트베네핏 상환스케쥴 (이어서)' : '렌트베네핏 상환스케쥴'} />
      {ci === 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', marginBottom: '10px' }}>
          <tbody>
            {[
              [['고객명', blank(data.party.name)], ['차량번호', blank(doc.plateNo)]],
              [['선수금', `${won(doc.advancePayment)} 원`], ['인도일', blank(doc.deliveryDate)]],
              [['보증금', `${won(doc.deposit)} 원`], ['실행일', blank(doc.firstDueDate)]],
              [['월렌트료', `${won(doc.monthlyFee)} 원`], ['렌트종료일', blank(doc.endDate)]]
            ].map((row, i) => (
              <tr key={i}>
                {row.map(([l, v], j) => [
                  <th key={`l${j}`} style={{ ...th, width: '110px' }}>{l}</th>,
                  <td key={`v${j}`} style={td}>{v}</td>
                ])}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '9%' }} /><col style={{ width: '19%' }} /><col style={{ width: '19%' }} />
          <col style={{ width: '19%' }} /><col style={{ width: '17%' }} /><col style={{ width: '17%' }} />
        </colgroup>
        <thead>
          <tr>{['회차', '납입일자', '월 렌트료', '공급가액', '부가세', '비고'].map((h) => <th key={h} style={head}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {chunk.map((r) => {
            const supply = Math.round((Number(r.amount) || 0) / 1.1);
            return (
              <tr key={r.no}>
                <td style={{ ...cell, textAlign: 'center' }}>{r.no}</td>
                <td style={{ ...cell, textAlign: 'center' }}>{r.dueDate}</td>
                <td style={cell}>{won(r.amount)}</td>
                <td style={cell}>{won(supply)}</td>
                <td style={cell}>{won((Number(r.amount) || 0) - supply)}</td>
                <td style={cell} />
              </tr>
            );
          })}
          {ci === chunks.length - 1 && (
            <tr>
              <td colSpan={2} style={{ ...head, textAlign: 'center' }}>합계</td>
              <td style={{ ...cell, fontWeight: 700 }}>{won(total)}</td>
              <td style={{ ...cell, fontWeight: 700 }}>{won(Math.round(total / 1.1))}</td>
              <td style={{ ...cell, fontWeight: 700 }}>{won(total - Math.round(total / 1.1))}</td>
              <td style={cell} />
            </tr>
          )}
        </tbody>
      </table>
    </Page>
  ));
}

/**
 * @param {{ data: object, innerRef?: any }} props data = 서버의 buildDeliveryDocs 결과
 */
export default function ContractFactSheet({ data, innerRef }) {
  if (!data) return null;
  const docs = data.docs || [];
  return (
    <div ref={innerRef} className="print-fit" style={{ width: `${PAGE_W}px`, background: '#fff' }}>
      {docs.map((doc, i) => (
        <div key={doc.vehicleId}>
          <FactPage data={data} doc={doc} />
          <SchedulePages data={data} doc={doc} isLastDoc={i === docs.length - 1} />
        </div>
      ))}
    </div>
  );
}
