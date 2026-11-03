import { earlyPenalty, ratePctOf } from '../../utils/contractEnd.js';

/**
 * 중도해지 위약금 안내문.
 *
 * 양식은 Dropbox "09.중도해지/중도해지 위약금_260220.xlsx"의 '중도해지 안내문' 시트다(대표님 2026-11-03).
 * 시트는 누구에게나 같은 일반 안내라, 앞에 이 계약의 값(월 대여료·위약금율·만료일·약정거리·면책금)과
 * 해지예정일 기준 예상 위약금을 붙였다. 위약금 식은 '중도해지 정산서 계산식' 시트와 같다(utils/contractEnd.js).
 *
 * A4 두 장(794 × 1120px, 96dpi)으로 그린다. PDF는 여백 0으로 떠서 한 장이 A4 한 장이 된다.
 */

const PAGE_W = 794;
const PAGE_H = 1120;

const RED = '#e8141b';
const GRAY = '#d9d9d9';
const PINK = '#fbe5d6';
const DOT = '1px dotted #9a9a9a';

const won = (n) => `${(Number(n) || 0).toLocaleString('ko-KR')}원`;
const blank = (v) => (v === undefined || v === null || String(v).trim() === '' ? '-' : v);
const korDate = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : '';
};

function Page({ children, last }) {
  return (
    <div style={{ width: `${PAGE_W}px`, height: `${PAGE_H}px`, padding: '40px 56px', boxSizing: 'border-box', background: '#fff', color: '#111', fontFamily: "'Malgun Gothic', sans-serif", position: 'relative', overflow: 'hidden', pageBreakAfter: last ? 'auto' : 'always', breakAfter: last ? 'auto' : 'page' }}>
      <div style={{ textAlign: 'right', borderBottom: '5px solid #bfbfbf', paddingBottom: '4px' }}>
        <img src="/docs/company-name.png" alt="(주)렌트베네핏" style={{ height: '24px' }} />
      </div>
      {children}
      <img src="/docs/brand-logo.png" alt="RENT BENefit" style={{ position: 'absolute', left: '56px', bottom: '30px', height: '50px' }} />
    </div>
  );
}

function SectionTitle({ no, title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', margin: '22px 0 6px' }}>
      <span style={{ color: RED, fontSize: '24px', fontWeight: 800, lineHeight: 1 }}>{no}.</span>
      <span style={{ fontSize: '16px', fontWeight: 800 }}>{title}</span>
    </div>
  );
}

/** 왼쪽 회색 이름 칸 + 오른쪽 내용. 엑셀 시트의 칸 모양 */
function Block({ label, children }) {
  return (
    <div style={{ display: 'flex', borderTop: `3px solid ${RED}`, borderBottom: `2px solid ${RED}` }}>
      <div style={{ background: GRAY, width: '104px', flex: 'none', fontWeight: 800, fontSize: '12.5px', padding: '7px 6px', lineHeight: 1.35, whiteSpace: 'pre-line' }}>{label}</div>
      <div style={{ flex: 1, padding: '6px 10px', fontSize: '11.5px', lineHeight: 1.75 }}>{children}</div>
    </div>
  );
}

const H = ({ children }) => <div style={{ fontWeight: 800, marginTop: '2px' }}>{children}</div>;

/** 임차인·담당자 진행 순서 줄 */
function Timeline() {
  const lane = (who, steps) => (
    <div style={{ display: 'flex', alignItems: 'center', height: '40px' }}>
      <div style={{ width: '46px', fontWeight: 800, fontSize: '11px' }}>{who}</div>
      <div style={{ flex: 1, position: 'relative', height: '40px' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: '27px', borderTop: `2px solid ${RED}` }} />
        {steps.map(([pos, label]) => (
          <div key={label} style={{ position: 'absolute', left: `${pos}%`, top: 0, transform: 'translateX(-50%)', textAlign: 'center', fontSize: '10.5px', whiteSpace: 'nowrap' }}>
            <div style={{ height: '18px' }}>{label}</div>
            <div style={{ width: '9px', height: '9px', borderRadius: '50%', border: `2px solid ${RED}`, background: '#fff', margin: '1px auto 0' }} />
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <div style={{ margin: '8px 0 6px' }}>
      {lane('임차인', [[6, '신청서 접수'], [20, '차량반납'], [74, '정산금액 입금']])}
      {lane('담당자', [[10, '반납 안내'], [28, '면책금 안내'], [46, '계약 종료'], [64, '정산금액 안내'], [82, '정산금액 환급'], [96, '처리 완료']])}
    </div>
  );
}

/**
 * @param {{ data: object, form: { terminateDate: string, issueDate: string, showPenalty: boolean, ratePct: string }, innerRef?: any }} props
 *   data = 서버 buildDeliveryDocs 결과(docs는 고른 차만)
 */
export default function EarlyTerminationGuideSheet({ data, form, innerRef }) {
  if (!data) return null;
  const docs = data.docs || [];
  const rows = docs.map((d) => ({ d, rate: ratePctOf(d, form.ratePct), calc: earlyPenalty({ monthlyFee: d.monthlyFee, endDate: d.endDate, terminateDate: form.terminateDate, ratePct: ratePctOf(d, form.ratePct) }) }));
  const total = rows.reduce((s, r) => s + (r.calc?.penalty || 0), 0);
  const one = docs.length === 1 ? docs[0] : null;
  const td = { borderTop: DOT, padding: '0 8px', height: '25px', fontSize: '12px' };
  const tl = { ...td, textAlign: 'right', whiteSpace: 'nowrap', borderRight: '1px solid #bbb', color: '#333' };
  const th = { background: GRAY, fontWeight: 800, fontSize: '11.5px', textAlign: 'center', height: '25px', borderRight: DOT, padding: '0 4px' };
  const tc = { borderTop: DOT, borderRight: DOT, textAlign: 'center', fontSize: '11.5px', height: '25px', padding: '0 4px', fontVariantNumeric: 'tabular-nums' };

  return (
    <div ref={innerRef} className="print-fit" style={{ width: `${PAGE_W}px`, background: '#fff' }}>
      <Page>
        <div style={{ textAlign: 'center', color: RED, fontSize: '27px', fontWeight: 800, margin: '26px 0 4px' }}>렌트베네핏 렌터카 중도해지 안내문</div>
        <div style={{ textAlign: 'center', fontSize: '12px', color: '#555' }}>{blank(data.party.name)} 귀하 · 발행일 {korDate(form.issueDate)}</div>

        <SectionTitle no={1} title="계약 내용을 확인해주시겠어요?" />
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', borderTop: `3px solid ${RED}`, borderBottom: `2px solid ${RED}` }}>
          <colgroup><col style={{ width: '104px' }} /><col style={{ width: '104px' }} /><col style={{ width: '200px' }} /><col style={{ width: '112px' }} /><col /></colgroup>
          <tbody>
            {[
              [['임차인명', blank(data.party.name)], ['차량번호', docs.map((d) => d.plateNo).filter(Boolean).join(', ') || '-']],
              [['차종', [...new Set(docs.map((d) => d.carModel))].join(', ') || '-'], ['월 대여료', one ? `${won(one.monthlyFee)} (VAT 포함)` : `${won(docs.reduce((s, d) => s + d.monthlyFee, 0))} (${docs.length}대 합계)`]],
              [['계약기간', one ? `${blank(one.deliveryDate)} ~ ${blank(one.endDate)}` : '아래 표 참고'], ['중도해지 위약금율', [...new Set(rows.map((r) => `${r.rate}%`))].join(', ')]],
              [['약정 주행거리', one?.mileage ? `연 ${one.mileage.toLocaleString('ko-KR')}km` : '계약서 기준'], ['면책금(고객부담금)', blank(one?.insurance?.deductible || '계약서 기준')]]
            ].map((row, i) => (
              <tr key={i}>
                {i === 0 && <td rowSpan={4} style={{ background: GRAY, fontWeight: 800, fontSize: '12.5px', verticalAlign: 'top', padding: '7px 6px', lineHeight: 1.35 }}>계약 정보</td>}
                {row.map(([l, v], j) => [
                  <td key={`l${j}`} style={i ? tl : { ...tl, borderTop: 'none' }}>{l}</td>,
                  <td key={`v${j}`} style={i ? td : { ...td, borderTop: 'none' }}>{v}</td>
                ])}
              </tr>
            ))}
          </tbody>
        </table>

        {form.showPenalty && (
          <>
            <SectionTitle no={2} title={`${korDate(form.terminateDate) || '해지예정일'} 해지 시 예상 중도해지위약금`} />
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', borderTop: `3px solid ${RED}`, borderBottom: `2px solid ${RED}` }}>
              <colgroup>{[13, 15, 14, 11, 15, 10, 22].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
              <thead>
                <tr>{['차량번호', '월 대여료(VAT 포함)', '계약 만료일', '미경과일수', '1일 대여료(VAT 제외)', '위약금율', '예상 위약금'].map((h, i) => <th key={h} style={i === 6 ? { ...th, borderRight: 'none' } : th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map(({ d, rate, calc }) => (
                  <tr key={d.vehicleId}>
                    <td style={tc}>{d.plateNo || d.code}</td>
                    <td style={tc}>{won(d.monthlyFee)}</td>
                    <td style={tc}>{blank(d.endDate)}</td>
                    <td style={tc}>{calc ? `${calc.days.toLocaleString('ko-KR')}일` : '-'}</td>
                    <td style={tc}>{calc ? won(calc.dailySupply) : '-'}</td>
                    <td style={tc}>{rate ? `${rate}%` : '-'}</td>
                    <td style={{ ...tc, borderRight: 'none', fontWeight: 800 }}>{calc ? won(calc.penalty) : '-'}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={6} style={{ ...tc, background: PINK, fontWeight: 800, fontSize: '13px' }}>예상 중도해지위약금 (VAT 별도 · 세금계산서 발행 불가)</td>
                  <td style={{ ...tc, background: PINK, borderRight: 'none', color: RED, fontWeight: 800, fontSize: '15px', whiteSpace: 'nowrap' }}>{won(total)}</td>
                </tr>
              </tbody>
            </table>
            <div style={{ fontSize: '10.5px', lineHeight: 1.65, marginTop: '5px', color: '#333' }}>
              {one && rows[0].calc && (
                <div>· 계산: 1일 대여료 {won(one.monthlyFee)} × 12 ÷ 365 = {won(rows[0].calc.daily)}(10원 미만 절사) ÷ 1.1 = {won(rows[0].calc.dailySupply)} × 미경과 {rows[0].calc.days.toLocaleString('ko-KR')}일 × {rows[0].rate}%</div>
              )}
              <div>· 실제 반납일 기준으로 다시 계산합니다. 반납일이 늦어지면 미경과일수가 줄어 위약금도 줄어듭니다.</div>
              <div>· 위 금액은 위약금만 계산한 것입니다. 반납일까지의 임대료(1), 면책금(3), 초과운행부담금(4)은 반납 후 함께 정산합니다.</div>
            </div>
          </>
        )}

        <SectionTitle no={form.showPenalty ? 3 : 2} title="중도해지 안내사항을 확인해주시겠어요?" />
        <Block label={'중도해지\n안내사항'}>
          <div>• 해지예정일 7일 전 신청서 팩스 접수 필수 (자동차 장기대여 약관 제22조 2항, FAX : 02-529-3303)</div>
          <div>• 신청서 접수 후 익일부터 순차적으로 반납 안내</div>
          <div>• 차량은 접수 당일 및 익일 반납 불가</div>
          <div>• 정산금액은 계약종료 후 문자로 안내되며, 지정 계좌로 입금</div>
          <div style={{ paddingLeft: '10px' }}>(보증금/선수금은 상계 후 잔여금액을 계약종료일 기준 14일 이내 결제계좌로 환급)</div>
        </Block>
      </Page>

      <Page last>
        <SectionTitle no={form.showPenalty ? 4 : 3} title="중도해지 절차를 확인해주시겠어요?" />
        <Block label="중도해지 절차">
          <H>(1) 임대료 청구</H>
          <div>• 계약해지는 실 반납일자를 기준으로 하며, 반납일까지의 임대료 청구</div>
          <H>(2) 중도해지위약금</H>
          <div>• 중도해지위약금 산식 : [월 대여료(VAT 제외) × 12 ÷ 365] × 미경과일수 × 위약금율</div>
          <div>• 위약금율은 계약서에 명시된 기준에 따라 산정</div>
          <H>(3) 면책금</H>
          <div>• 면책금은 계약서에 명시된 금액을 기준으로 손상부위 별 건당 청구</div>

          <Timeline />

          <div style={{ background: PINK, padding: '6px 10px', margin: '4px 0 8px' }}>
            <H>※ 중도해지 정산금액 산정 기준</H>
            <div>• 정산금액 = 임대료(1) + 중도해지위약금(2) + 면책금(3) + 초과운행부담금(4) − 보증금·선수금 잔액</div>
            <div style={{ paddingLeft: '10px' }}>(위약금 및 초과운행부담금은 계약서에 명시된 기준에 따라 산정)</div>
            <div>• 위약금, 면책금, 초과운행부담금은 VAT 별도 금액으로 청구하며 세금계산서 발행 불가</div>
          </div>

          <H>(4) 초과운행부담금</H>
          <div>• 중도해지 시 아래와 같은 산식으로 초과운행부담금이 발생합니다.</div>
          <div style={{ background: PINK, padding: '6px 10px', margin: '4px 0 8px' }}>
            <div style={{ fontWeight: 700 }}>초과운행부담금 산식</div>
            <div>{'{ 실주행거리 − (연간 약정 주행거리 ÷ 365일 × 실제 이용 기간) − 기본 제공 주행거리 }'} × 차종별 초과운행료 (VAT 별도)</div>
            <div>기본 제공 주행거리 : 200km, 초과운행료 : 국산차량 100원/km, 수입·외산차량 200원/km</div>
            {one?.mileage > 0 && <div>이 계약의 연간 약정 주행거리 : {one.mileage.toLocaleString('ko-KR')}km</div>}
          </div>
          <div style={{ fontWeight: 800 }}>※ 차종별 위약금(VAT 별도)은 &apos;자동차 장기 대여 약관&apos;에 근거하여 산정합니다.</div>
          <div style={{ fontSize: '10.5px', color: '#444', lineHeight: 1.55 }}>
            * 기본 제공 주행거리란, 차량 출고, 탁송 등 임차인의 차량 사용과 관계없는 운행거리를 감안하여 기본 제공되는 주행거리로 각 계약 상품 별(개인/법인) 상이합니다. (계약서 상 명시)
          </div>
        </Block>

        <div style={{ marginTop: '22px', fontSize: '12px', lineHeight: 1.8, textAlign: 'center' }}>
          <div>* 중도해지 신청서를 작성하여 보내 주셔야 접수 및 중도해지 진행이 가능합니다.</div>
          <div>(e-Mail : rent@sdibenefit.com)</div>
          <div>* 기타 문의 : 렌트베네핏 팀장 이두식 010-9061-3000 / ☎ 02-547-0303</div>
        </div>
        <div style={{ textAlign: 'center', marginTop: '26px', fontSize: '17px', fontWeight: 800 }}>
          <span style={{ position: 'relative', display: 'inline-block' }}>
            주식회사 &nbsp;렌트베네핏 &nbsp;대표이사 &nbsp;신 동 일
            <img src="/docs/company-seal.png" alt="" style={{ position: 'absolute', right: '-62px', top: '50%', transform: 'translateY(-50%)', width: '76px', opacity: 0.9 }} />
          </span>
        </div>
      </Page>
    </div>
  );
}
