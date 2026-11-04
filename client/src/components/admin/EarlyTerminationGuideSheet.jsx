import { earlyPenalty, ratePctOf } from '../../utils/contractEnd.js';
import { LABEL_BG, LINE, NAVY, NOTE_BG, PAGE_W, RED, headCell, korDate, moneyCell, num, subCell, tableStyle, won } from '../../utils/endDocStyle.js';
import { A4Page, Band, DocHead, PairTable, SealLine } from './EndDocParts.jsx';

/**
 * 중도해지 위약금 안내문.
 *
 * 내용은 Dropbox "09.중도해지/중도해지 위약금_260220.xlsx"의 '중도해지 안내문' 시트(대표님 2026-11-03)이고,
 * 위약금 식과 디자인은 "중도해지_정산서261104.xlsx"를 따른다(대표님 2026-11-04, utils/contractEnd.js · EndDocParts.jsx).
 * 시트는 누구에게나 같은 일반 안내라, 앞에 이 계약의 값(월 대여료·위약금율·만료일·약정거리·면책금)과
 * 해지예정일 기준 예상 위약금을 붙였다.
 */

const blank = (v) => (v === undefined || v === null || String(v).trim() === '' ? '-' : v);

/** 왼쪽 회색 이름 칸 + 오른쪽 내용 */
function Block({ label, children }) {
  return (
    <div style={{ display: 'flex', border: LINE, borderTop: 'none' }}>
      <div style={{ background: LABEL_BG, width: '98px', flex: 'none', fontWeight: 700, fontSize: '12.5px', padding: '8px 6px', lineHeight: 1.35, whiteSpace: 'pre-line', textAlign: 'center', borderRight: LINE }}>{label}</div>
      <div style={{ flex: 1, padding: '7px 11px', fontSize: '12px', lineHeight: 1.75 }}>{children}</div>
    </div>
  );
}

const H = ({ children }) => <div style={{ fontWeight: 800, marginTop: '2px', color: NAVY }}>{children}</div>;
const Note = ({ children, margin = '6px 0 8px' }) => <div style={{ background: NOTE_BG, padding: '6px 10px', margin }}>{children}</div>;

/** 임차인·담당자 진행 순서 줄 */
function Timeline() {
  const lane = (who, steps) => (
    <div style={{ display: 'flex', alignItems: 'center', height: '40px' }}>
      <div style={{ width: '46px', fontWeight: 800, fontSize: '11px', color: NAVY }}>{who}</div>
      <div style={{ flex: 1, position: 'relative', height: '40px' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: '27px', borderTop: `2px solid ${NAVY}` }} />
        {steps.map(([pos, label]) => (
          <div key={label} style={{ position: 'absolute', left: `${pos}%`, top: 0, transform: 'translateX(-50%)', textAlign: 'center', fontSize: '10.5px', whiteSpace: 'nowrap' }}>
            <div style={{ height: '18px' }}>{label}</div>
            <div style={{ width: '9px', height: '9px', borderRadius: '50%', border: `2px solid ${NAVY}`, background: '#fff', margin: '1px auto 0' }} />
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
  const rows = docs.map((d) => {
    const rate = ratePctOf(d, form.ratePct);
    return { d, rate, calc: earlyPenalty({ monthlyFee: d.monthlyFee, advancePayment: d.advancePayment, termMonths: d.termMonths, endDate: d.endDate, terminateDate: form.terminateDate, ratePct: rate }) };
  });
  const total = rows.reduce((s, r) => s + (r.calc?.penalty || 0), 0);
  const one = docs.length === 1 ? docs[0] : null;
  const firstCalc = rows[0]?.calc;
  const cell = { ...moneyCell, textAlign: 'center', fontSize: '12px' };
  const head = { ...headCell, fontSize: '11.5px', lineHeight: 1.25, whiteSpace: 'pre-line', height: '36px' };

  return (
    <div ref={innerRef} className="print-fit" style={{ width: `${PAGE_W}px`, background: '#fff' }}>
      <A4Page last={false}>
        <DocHead title="렌터카 중도해지 안내문" sub={`${blank(data.party.name)} 귀하`} issueDate={form.issueDate} />

        <Band top={4}>1.  계약 내용을 확인해주시겠어요?</Band>
        <PairTable label="19%" value="31%" rows={[
          ['임차인명', blank(data.party.name), '차량번호', docs.map((d) => d.plateNo).filter(Boolean).join(', ') || '-'],
          ['차종', [...new Set(docs.map((d) => d.carModel))].join(', ') || '-', '월 대여료', one ? `${won(one.monthlyFee)} (VAT 포함)` : `${won(docs.reduce((s, d) => s + d.monthlyFee, 0))} (${docs.length}대 합계)`],
          ['계약기간', one ? `${blank(one.deliveryDate)} ~ ${blank(one.endDate)}` : '아래 표 참고', '중도해지 위약금율', [...new Set(rows.map((r) => `${r.rate}%`))].join(', ')],
          ['약정 주행거리', one?.mileage ? `연 ${num(one.mileage)}km` : '계약서 기준', '면책금(고객부담금)', blank(one?.insurance?.deductible || '계약서 기준')]
        ]} />

        {form.showPenalty && (
          <>
            <Band top={16}>2.  {korDate(form.terminateDate) || '해지예정일'} 해지 시 예상 중도해지위약금</Band>
            <table style={tableStyle}>
              <colgroup>{[14, 15, 14, 11, 15, 9, 22].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
              <thead>
                <tr>{['차량번호', '월 대여료\n(VAT 포함)', '계약 만료일', '미경과일수', '1일 대여료\n(VAT 제외)', '위약금율', '예상 위약금'].map((h) => <th key={h} style={head}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map(({ d, rate, calc }) => (
                  <tr key={d.vehicleId}>
                    <td style={cell}>{d.plateNo || d.code}</td>
                    <td style={cell}>{won(d.monthlyFee)}</td>
                    <td style={cell}>{blank(d.endDate)}</td>
                    <td style={cell}>{calc ? `${num(calc.days)}일` : '-'}</td>
                    <td style={cell}>{calc ? won(calc.dailySupply) : '-'}</td>
                    <td style={cell}>{rate ? `${rate}%` : '-'}</td>
                    <td style={{ ...cell, fontWeight: 800 }}>{calc ? won(calc.penalty) : '-'}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={6} style={{ ...subCell, background: NOTE_BG }}>예상 중도해지위약금 (VAT 별도 · 세금계산서 발행 불가)</td>
                  <td style={{ ...subCell, background: NOTE_BG, color: RED, fontSize: '15px', fontWeight: 800, whiteSpace: 'nowrap' }}>{won(total)}</td>
                </tr>
              </tbody>
            </table>
            <div style={{ fontSize: '11px', lineHeight: 1.65, marginTop: '5px', color: '#404040' }}>
              {one && firstCalc && (
                <div>· 계산: 1일 대여료 {won(firstCalc.daily)} (월 대여료 {won(one.monthlyFee)}{one.advancePayment ? ` + 선수금 월분할 ${won(firstCalc.advanceMonthly)}` : ''} 기준, ×12÷365, 10원 미만 절사) ÷ 1.1 = {won(firstCalc.dailySupply)} × 미경과 {num(firstCalc.days)}일 × {rows[0].rate}%</div>
              )}
              <div>· 실제 반납일 기준으로 다시 계산합니다. 반납일이 늦어지면 미경과일수가 줄어 위약금도 줄어듭니다.</div>
              <div>· 위 금액은 위약금만 계산한 것입니다. 반납일까지의 미납 임대료(1), 면책금(3), 초과운행부담금(4), 미납 통행료·범칙금 등은 반납 후 함께 정산합니다.</div>
            </div>
          </>
        )}

        <Band top={16}>{form.showPenalty ? 3 : 2}.  중도해지 안내사항을 확인해주시겠어요?</Band>
        <Block label={'중도해지\n안내사항'}>
          <div>• 해지예정일 7일 전 신청서 팩스 접수 필수 (자동차 장기대여 약관 제22조 2항, FAX : 02-529-3303)</div>
          <div>• 신청서 접수 후 익일부터 순차적으로 반납 안내</div>
          <div>• 차량은 접수 당일 및 익일 반납 불가</div>
          <div>• 정산금액은 계약종료 후 문자로 안내되며, 지정 계좌로 입금</div>
          <div style={{ paddingLeft: '10px' }}>(보증금/선수금은 상계 후 잔여금액을 계약종료일 기준 14일 이내 결제계좌로 환급)</div>
        </Block>
      </A4Page>

      <A4Page>
        <Band top={0}>{form.showPenalty ? 4 : 3}.  중도해지 절차를 확인해주시겠어요?</Band>
        <Block label="중도해지 절차">
          <H>(1) 임대료 청구</H>
          <div>• 계약해지는 실 반납일자를 기준으로 하며, 반납일까지의 임대료 청구</div>
          <H>(2) 중도해지위약금</H>
          <div>• 중도해지위약금 산식 : [(월 대여료 + 선수금 월분할) × 12 ÷ 365 ÷ 1.1] × 미경과일수 × 위약금율</div>
          <div>• 위약금율은 계약서에 명시된 기준에 따라 산정</div>
          <H>(3) 면책금</H>
          <div>• 면책금은 계약서에 명시된 금액을 기준으로 손상부위 별 건당 청구</div>

          <Timeline />

          <Note margin="4px 0 8px">
            <H>※ 중도해지 정산금액 산정 기준</H>
            <div>• 정산금액 = 미납 임대료(1) + 중도해지위약금(2) + 면책금(3) + 초과운행부담금(4) + 미납 통행료·범칙금 등 − 보증금 − 선수금 미경과분</div>
            <div style={{ paddingLeft: '10px' }}>(위약금 및 초과운행부담금은 계약서에 명시된 기준에 따라 산정)</div>
            <div>• 위약금, 면책금, 초과운행부담금은 VAT 별도 금액으로 청구하며 세금계산서 발행 불가</div>
          </Note>

          <H>(4) 초과운행부담금</H>
          <div>• 중도해지 시 아래와 같은 산식으로 초과운행부담금이 발생합니다.</div>
          <Note margin="4px 0 8px">
            <div style={{ fontWeight: 700 }}>초과운행부담금 산식</div>
            <div>{'{ 실주행거리 − (연간 약정 주행거리 ÷ 365일 × 실제 이용 기간) − 기본 제공 주행거리 }'} × 차종별 초과운행료 (VAT 별도)</div>
            <div>기본 제공 주행거리 : 200km, 초과운행료 : 국산차량 100원/km, 수입·외산차량 200원/km</div>
            {one?.mileage > 0 && <div>이 계약의 연간 약정 주행거리 : {num(one.mileage)}km</div>}
          </Note>
          <div style={{ fontWeight: 800 }}>※ 차종별 위약금(VAT 별도)은 &apos;자동차 장기 대여 약관&apos;에 근거하여 산정합니다.</div>
          <div style={{ fontSize: '11px', color: '#404040', lineHeight: 1.55 }}>
            * 기본 제공 주행거리란, 차량 출고, 탁송 등 임차인의 차량 사용과 관계없는 운행거리를 감안하여 기본 제공되는 주행거리로 각 계약 상품 별(개인/법인) 상이합니다. (계약서 상 명시)
          </div>
        </Block>

        <div style={{ marginTop: '22px', fontSize: '12.5px', lineHeight: 1.8, textAlign: 'center' }}>
          <div>* 중도해지 신청서를 작성하여 보내 주셔야 접수 및 중도해지 진행이 가능합니다.</div>
          <div>(e-Mail : rent@sdibenefit.com)</div>
          <div>* 기타 문의 : 렌트베네핏 팀장 이두식 010-9061-3000 / ☎ 02-547-0303</div>
        </div>
        <div style={{ marginTop: '26px' }}><SealLine size={17} /></div>
      </A4Page>
    </div>
  );
}
