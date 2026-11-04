import { settlementOf } from '../../utils/contractEnd.js';
import { NAVY, RED, LABEL_BG, LINE, NOTE_BG, COMPANY, PAGE_W, headCell, labelCell, moneyCell, num, subCell, tableStyle, valueCell, won } from '../../utils/endDocStyle.js';
import { A4Page, Band, DocHead, PairTable, ResultNote, SealLine } from './EndDocParts.jsx';

/**
 * 중도해지 정산서.
 *
 * 양식은 Dropbox "09.중도해지/중도해지_정산서261104.xlsx"(대표님 2026-11-04)의 세 시트다.
 * 구분형 '렌터카 계약 중도해지 정산 안내' · 요약형 · 상세. 계산은 모두 utils/contractEnd.js의 settlementOf 하나를 쓴다.
 * 어느 양식이든 맨 뒤에 중도해지 절차 한 쪽이 붙는다. 내용은 "중도해지 위약금_260220.xlsx"의 '중도해지 안내문' 시트이고,
 * 안내문을 따로 두지 않고 정산서에 합쳤다(대표님 2026-11-04).
 */

const signedWon = (n) => (n < 0 ? <span style={{ color: RED }}>-{won(-n)}</span> : won(n));
const pctText = (n) => `${Number(n) || 0}%`;
const termText = (s) => (s.termMonths % 12 === 0 && s.termMonths ? `${s.termMonths / 12}년` : `${s.termMonths}개월`);

const NOTES = [
  '본 정산서의 금액은 원 단위 미만을 절사하였으며, 산출 근거의 숫자는 반올림 표기입니다.',
  '중도해지 위약금은 세금계산서가 발행되지 않으며, 그 외 항목은 관련 규정에 따라 처리됩니다.',
  '범칙금·과태료 30만원은 예치금으로, 반납일로부터 3개월 후 최종 부과 내역 확인 뒤 잔액을 돌려드립니다.',
  '차량 반납 이후 통행료·과태료 등이 추가로 확인될 경우, 별도로 정산을 요청드릴 수 있습니다.',
  '정산 내역에 대해 확인이 필요하신 부분은 아래 담당자에게 연락 주시면 상세히 안내해 드리겠습니다.'
];

const note = { fontSize: '12px', lineHeight: 1.55 };
const penaltyBasis = (s) => `월 렌트료 ${num(s.fee)}원 + 선수금 월분할 ${num(s.advanceMonthly)}원 기준`;
const advanceText = (s) => `선수금 ${num(s.advance)}원 ÷ 총 계약 ${num(s.totalDays)}일 × 미경과 ${num(s.remainDays)}일`;
const paidLabel = (s) => `${num(s.paidCount)}회 (${s.paidUntil}까지)`;
const paidText = (s) => `납부 ${num(s.paidCount)}회분은 ${s.paidUntil}까지 (1회차 ${s.start} ~ ${s.firstRoundEnd})`;
const overText = (s) => `납부 회차 중 반납일 다음 날(${s.overFrom})부터 ${s.paidUntil}까지 ${s.overMonths ? `${num(s.overMonths)}개월 ` : ''}${num(s.overDays)}일 (1일 ${num(s.dailyRent)}원)`;

function excessLines(s) {
  const contract = `약정 = 연 ${num(s.annualKm)}km ÷ 365 × 이용 ${num(s.usedDays)}일`;
  return s.excessFee === 0
    ? ['약정 주행거리 이내 운행으로 초과 부담금 없음', `※ 실주행 ${num(s.actualKm)}km ≤ 약정 ${num(s.contractKm)}km + 기본제공 ${num(s.baseKm)}km`, `    (${contract})`]
    : [`초과 ${num(s.excessKm)}km × ${num(s.kmRate)}원/km`, `※ 실주행 ${num(s.actualKm)}km - 약정 ${num(s.contractKm)}km - 기본제공 ${num(s.baseKm)}km`, `    (${contract})`];
}

function Lines({ lines }) {
  return lines.map((t) => <div key={t} style={{ whiteSpace: 'pre-wrap' }}>{t}</div>);
}

/** 왼쪽 회색 이름 칸 + 오른쪽 내용 */
function Block({ label, children }) {
  return (
    <div style={{ display: 'flex', border: LINE, borderTop: 'none' }}>
      <div style={{ background: LABEL_BG, width: '98px', flex: 'none', fontWeight: 700, fontSize: '12.5px', padding: '8px 6px', lineHeight: 1.35, whiteSpace: 'pre-line', textAlign: 'center', borderRight: LINE }}>{label}</div>
      <div style={{ flex: 1, padding: '7px 11px', fontSize: '12px', lineHeight: 1.75 }}>{children}</div>
    </div>
  );
}

const StepTitle = ({ children }) => <div style={{ fontWeight: 800, marginTop: '2px', color: NAVY }}>{children}</div>;
const NoteBox = ({ children }) => <div style={{ background: NOTE_BG, padding: '6px 10px', margin: '4px 0 8px' }}>{children}</div>;

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

/** 양식 맨 뒤에 붙는 중도해지 절차 한 쪽 */
function ProcedurePage({ s, form, no }) {
  return (
    <A4Page>
      <Band top={0}>{no}.  중도해지 안내사항</Band>
      <Block label={'중도해지\n안내사항'}>
        <div>• 해지예정일 7일 전 신청서 팩스 접수 필수 (자동차 장기대여 약관 제22조 2항, FAX : 02-529-3303)</div>
        <div>• 신청서 접수 후 익일부터 순차적으로 반납 안내</div>
        <div>• 차량은 접수 당일 및 익일 반납 불가</div>
        <div>• 정산금액은 계약종료 후 문자로 안내되며, 지정 계좌로 입금</div>
        <div style={{ paddingLeft: '10px' }}>(보증금/선수금은 상계 후 잔여금액을 계약종료일 기준 14일 이내 결제계좌로 환급)</div>
      </Block>

      <Band top={14}>{no + 1}.  중도해지 절차</Band>
      <Block label="중도해지 절차">
        <StepTitle>(1) 렌트료 청구</StepTitle>
        <div>• 계약해지는 실 반납일자를 기준으로 하며, 반납일까지의 렌트료 청구</div>
        <StepTitle>(2) 중도해지위약금</StepTitle>
        <div>• 중도해지위약금 산식 : [(월 렌트료 + 선수금 월분할) × 12 ÷ 365 ÷ 1.1] × 미경과일수 × 위약금율</div>
        <div>• 위약금율은 계약서에 명시된 기준에 따라 산정</div>
        <StepTitle>(3) 면책금</StepTitle>
        <div>• 면책금은 계약서에 명시된 금액을 기준으로 손상부위 별 건당 청구</div>
        <StepTitle>(4) 초과운행부담금</StepTitle>
        <div>• 중도해지 시 아래와 같은 산식으로 초과운행부담금이 발생합니다.</div>
        <NoteBox>
          <div style={{ fontWeight: 700 }}>초과운행부담금 산식</div>
          <div>{'{ 실주행거리 − (연간 약정 주행거리 ÷ 365일 × 실제 이용 기간) − 기본 제공 주행거리 }'} × 차종별 초과운행료 (VAT 별도)</div>
          <div>기본 제공 주행거리 : {num(s.baseKm)}km, 초과운행료 : 국산차량 100원/km, 수입·외산차량 200원/km</div>
          {s.annualKm > 0 && <div>이 계약의 연간 약정 주행거리 : {num(s.annualKm)}km</div>}
        </NoteBox>

        <Timeline />

        <NoteBox>
          <StepTitle>※ 중도해지 정산금액 산정 기준</StepTitle>
          <div>• 정산금액 = 미납 렌트료(1) + 중도해지위약금(2) + 면책금(3) + 초과운행부담금(4) + 미납 통행료·범칙금 등 − 보증금 − 선수금 미경과분 − 초과 납부 렌트료</div>
          <div style={{ paddingLeft: '10px' }}>(위약금 및 초과운행부담금은 계약서에 명시된 기준에 따라 산정)</div>
          <div>• 위약금, 면책금, 초과운행부담금은 VAT 별도 금액으로 청구하며 세금계산서 발행 불가</div>
        </NoteBox>
        <div style={{ fontWeight: 800 }}>※ 차종별 위약금(VAT 별도)은 &apos;자동차 장기 대여 약관&apos;에 근거하여 산정합니다.</div>
        <div style={{ fontSize: '11px', color: '#404040', lineHeight: 1.55 }}>
          * 기본 제공 주행거리란, 차량 출고, 탁송 등 임차인의 차량 사용과 관계없는 운행거리를 감안하여 기본 제공되는 주행거리로 각 계약 상품 별(개인/법인) 상이합니다. (계약서 상 명시)
        </div>
      </Block>

      <div style={{ marginTop: '20px', fontSize: '12.5px', lineHeight: 1.8, textAlign: 'center' }}>
        <div>* 중도해지 신청서를 작성하여 보내 주셔야 접수 및 중도해지 진행이 가능합니다.</div>
        <div>(e-Mail : rent@sdibenefit.com)</div>
        <div>* 기타 문의 : {form.manager}</div>
      </div>
      <div style={{ marginTop: '22px' }}><SealLine size={17} /></div>
    </A4Page>
  );
}

/** 구분형: ( a ) 기본 정산금 · ( b ) 중도해지 정산금 · ( c ) 고객 반환금 */
function SplitLayout({ data, doc, s, form }) {
  const a = [
    ['정산일수(미납)', `${num(s.unpaidDays)}일`],
    ['미납 회차', `${num(s.unpaidRounds)}회`],
    ['회차분 렌트료', won(s.roundRent)],
    ['잔여 일수', `${num(s.leftDays)}일`],
    ['1일 렌트료', won(s.dailyRent)],
    ['잔여분 렌트료', won(s.leftRent)],
    ['미납 렌트료', won(s.unpaidRent)]
  ];
  const b = [
    ['중도해지 위약금율', pctText(s.ratePct)],
    ['미경과일수', `${num(s.remainDays)}일`],
    ['1일 대여료(세전)', won(s.penaltyDailySupply)],
    ['중도해지 위약금', won(s.penalty)],
    ['초과주행거리', `${num(s.excessKm)}km`],
    ['초과주행거리 부담금', won(s.excessFee)],
    ['차량복원비용', won(s.repairTotal)],
    ['미납 통행료', won(s.toll)],
    ['기타(범칙금·과태료)', won(s.fine)],
    ['미납 수리비', won(s.unpaidRepair)]
  ];
  const c = [
    ['보증금', won(s.deposit)],
    ['납입 선수금', won(s.advance)],
    ['이용기간 사용분', s.advanceUsed ? `-${won(s.advanceUsed)}` : won(0)],
    ['선수금 잔액', won(s.advanceRemain)],
    ['초과 납부 렌트료', won(s.overpaidRent)]
  ];
  // 이 양식은 내용이 많아 A4 한 장에 들어가게 줄 높이를 조금 줄인다
  const nameCell = { ...valueCell, textAlign: 'left', fontSize: '12px', padding: '0 6px', height: '22px' };
  const amountCell = { ...moneyCell, height: '22px' };
  const subMoney = { ...subCell, textAlign: 'right', color: NAVY, whiteSpace: 'nowrap' };
  const groups = [a, b, c];
  const notes = [
    `※ 미납 렌트료 = 월 렌트료 ${num(s.fee)}원 × ${num(s.unpaidRounds)}회 + 1일 렌트료 ${num(s.dailyRent)}원 × 잔여 ${num(s.leftDays)}일`,
    `     ${paidText(s)}${s.hasUnpaid ? ` / 미납 ${s.unpaidFrom} ~ ${s.returnDate} ${num(s.unpaidDays)}일` : ''}`,
    ...(s.overpaidRent ? [`※ 초과 납부 렌트료 = ${overText(s)} (위약금 등과 상계)`] : []),
    s.excessFee === 0
      ? `※ 초과주행거리 = 실주행 ${num(s.actualKm)}km ≤ 약정 ${num(s.contractKm)}km(연 ${num(s.annualKm)}km÷365×이용 ${num(s.usedDays)}일) → 부담금 없음`
      : `※ 초과주행거리 부담금 = 초과 ${num(s.excessKm)}km × ${num(s.kmRate)}원/km  (실주행 ${num(s.actualKm)}km - 약정 ${num(s.contractKm)}km - 기본제공 ${num(s.baseKm)}km)`,
    `※ 중도해지 위약금 = 1일 대여료(VAT 제외) ${num(s.penaltyDailySupply)}원 × 미경과 ${num(s.remainDays)}일 × ${pctText(s.ratePct)}`,
    `     1일 대여료는 ${penaltyBasis(s)}`,
    `※ 선수금 잔액 = ${advanceText(s)} (납입 선수금에서 이용기간 사용분을 뺀 금액)`,
    '※ 보증금·선수금 잔액·초과 납부 렌트료는 돌려드릴 금액으로, 위약금 등 청구금액과 상계하여 정산합니다.',
    ...NOTES.map((t) => `※ ${t}`)
  ];

  return (
    <>
    <A4Page last={false} footer={false} padding="18px 44px">
      <DocHead title="렌터카 계약 중도해지 정산 안내" sub="계약 중도해지에 따른 정산 내역을 아래와 같이 안내드립니다." issueDate={form.issueDate} />
      <Band top={0}>1.  렌트 계약 내용</Band>
      <PairTable rows={[
        ['임 차 인 명', data.party.name, '차        종', doc.carModel],
        ['계 약 기 간', `${s.termMonths}개월 (${s.start} ~ ${s.end})`, '차 량 번 호', doc.plateNo],
        ['월  렌 트 료', `${num(s.fee)} 원 (VAT 포함)`, '선   수   금', won(s.advance)]
      ]} />

      <Band>2.  중도해지 기준일</Band>
      <PairTable rows={[
        ['차 량 반 납 일', <b key="d">{s.returnDate}</b>, '납 부  회 차', <b key="p">{paidLabel(s)}</b>]
      ]} />

      <Band>3.  중도해지 정산금</Band>
      <table style={tableStyle}>
        <colgroup>{[18.5, 14.5, 19.5, 14.5, 18, 15].map((w) => <col key={w} style={{ width: `${w}%` }} />)}</colgroup>
        <thead>
          <tr>
            <th colSpan={2} style={headCell}>( a )  기본 정산금</th>
            <th colSpan={2} style={headCell}>( b )  중도해지 정산금</th>
            <th colSpan={2} style={headCell}>( c )  고객 반환금</th>
          </tr>
        </thead>
        <tbody>
          {b.map((_, i) => (
            <tr key={i}>
              {groups.map((g, j) => [
                <td key={`n${j}`} style={nameCell}>{g[i]?.[0] || ''}</td>,
                <td key={`v${j}`} style={amountCell}>{g[i]?.[1] || ''}</td>
              ])}
            </tr>
          ))}
          <tr>
            <td style={subCell}>소  계 ( a )</td><td style={subMoney}>{won(s.unpaidRent)}</td>
            <td style={subCell}>소  계 ( b )</td><td style={subMoney}>{won(s.excessFee + s.repairTotal + s.unpaidClaim + s.penalty)}</td>
            <td style={subCell}>소  계 ( c )</td><td style={subMoney}>{won(s.deposit + s.advanceRemain + s.overpaidRent)}</td>
          </tr>
        </tbody>
      </table>

      <Band>4.  총 정산금</Band>
      <table style={tableStyle}>
        <colgroup><col style={{ width: '18.5%' }} /><col style={{ width: '34%' }} /><col /></colgroup>
        <tbody>
          <tr>
            <td style={{ ...subCell, background: NAVY, color: '#fff', fontSize: '15px', height: '34px' }}>총  정 산 금</td>
            <td style={{ ...moneyCell, color: RED, fontWeight: 800, fontSize: '19px' }}>{signedWon(s.final)}</td>
            <td style={{ ...valueCell, textAlign: 'left', color: '#595959' }}>( a + b - c )</td>
          </tr>
        </tbody>
      </table>
      <ResultNote amount={s.final} />

      <Band>5.  입금 계좌</Band>
      <table style={tableStyle}>
        <colgroup><col style={{ width: '18.5%' }} /><col /></colgroup>
        <tbody>
          {[['예   금   주', COMPANY], ['계 좌 번 호', form.account], ['담   당   자', form.manager]].map(([l, v]) => (
            <tr key={l}><td style={labelCell}>{l}</td><td style={valueCell}>{v}</td></tr>
          ))}
        </tbody>
      </table>

      <Band>6.  산출 근거 및 안내사항</Band>
      <div style={{ ...note, fontSize: '11.5px', lineHeight: 1.42, color: NAVY, marginTop: '4px' }}><Lines lines={notes} /></div>
      <div style={{ textAlign: 'center', color: NAVY, fontWeight: 800, fontSize: '15px', marginTop: '6px' }}>{COMPANY}</div>
    </A4Page>
    <ProcedurePage s={s} form={form} no={7} />
    </>
  );
}

/** A~E 정산 표(요약형은 숫자 대입, 상세는 설명 한 줄) */
function ClaimTable({ s, basis, advanceNote, depositNote }) {
  const item = { ...valueCell, textAlign: 'left', fontWeight: 700 };
  const text = { ...valueCell, textAlign: 'left', fontSize: '11.5px', color: '#404040', lineHeight: 1.45, padding: '3px 8px' };
  const rows = [['A', '미납 렌트료', s.unpaidRent], ['B', '초과운행 부담금', s.excessFee], ['C', '면책금(수리비)', s.repairTotal], ['D', '미납 청구금액', s.unpaidClaim], ['E', '위약금', s.penalty]];
  const total = { ...labelCell, textAlign: 'left', padding: '0 9px' };
  const minus = { ...valueCell, textAlign: 'left' };
  return (
    <table style={tableStyle}>
      <colgroup><col style={{ width: '5%' }} /><col style={{ width: '19%' }} /><col /><col style={{ width: '20%' }} /></colgroup>
      <thead><tr><th colSpan={2} style={headCell}>구분</th><th style={headCell}>{basis.title}</th><th style={headCell}>금액</th></tr></thead>
      <tbody>
        {rows.map(([k, name, amount]) => (
          <tr key={k}>
            <td style={{ ...valueCell, fontWeight: 700, color: NAVY }}>{k}</td>
            <td style={item}>{name}</td>
            <td style={text}><Lines lines={basis[k]} /></td>
            <td style={moneyCell}>{won(amount)}</td>
          </tr>
        ))}
        <tr><td colSpan={3} style={total}>청구금액 합계  (A + B + C + D + E)</td><td style={{ ...moneyCell, background: LABEL_BG, fontWeight: 700 }}>{won(s.claimTotal)}</td></tr>
        <tr><td colSpan={2} style={minus}>차감 - 보증금</td><td style={text}>{depositNote}</td><td style={{ ...moneyCell, color: RED }}>{s.deposit ? `-${won(s.deposit)}` : won(0)}</td></tr>
        <tr><td colSpan={2} style={minus}>차감 - 선수금 미경과분</td><td style={text}>{advanceNote}</td><td style={{ ...moneyCell, color: RED }}>{s.advanceRemain ? `-${won(s.advanceRemain)}` : won(0)}</td></tr>
        {s.overpaidRent > 0 && <tr><td colSpan={2} style={minus}>차감 - 초과 납부 렌트료</td><td style={text}>반납일까지의 렌트료보다 더 납부하신 금액 (상계)</td><td style={{ ...moneyCell, color: RED }}>-{won(s.overpaidRent)}</td></tr>}
        <tr>
          <td colSpan={3} style={{ background: NAVY, color: '#fff', fontWeight: 800, fontSize: '15px', padding: '0 9px', height: '32px', border: LINE }}>▶  최종 정산금</td>
          <td style={{ background: NAVY, color: '#fff', fontWeight: 800, fontSize: '15px', textAlign: 'right', padding: '0 8px', border: LINE, whiteSpace: 'nowrap' }}>{s.final < 0 ? `-${won(-s.final)}` : won(s.final)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function NoticeBlock({ form, no }) {
  return (
    <>
      <Band>{no}.  안내 및 유의사항</Band>
      <div style={{ ...note, margin: '5px 0' }}>{NOTES.map((t, i) => <div key={t}>{i + 1}.  {t}</div>)}</div>
      <table style={tableStyle}>
        <colgroup><col style={{ width: '24%' }} /><col /></colgroup>
        <tbody>
          <tr><td style={labelCell}>입금 계좌</td><td style={valueCell}>{form.account}</td></tr>
          <tr><td style={labelCell}>담당자</td><td style={valueCell}>{form.manager}</td></tr>
        </tbody>
      </table>
    </>
  );
}

function SummaryLayout({ data, doc, s, form }) {
  return (
    <>
    <A4Page last={false}>
      <DocHead title="중도해지 정산서" sub="장기렌터카 계약 중도해지에 따른 정산 내역입니다." issueDate={form.issueDate} />
      <Band top={0}>1.  계약 및 차량 정보</Band>
      <PairTable label="20%" value="30%" rows={[
        ['고객명', data.party.name, '차종 / 차량번호', `${doc.carModel}  ${doc.plateNo}`],
        ['렌트 실행일', s.start, '계약 만료(예정)일', s.end],
        ['차량 반납일', s.returnDate, '월 렌트료', won(s.fee)],
        ['실제 이용기간', `${num(s.usedDays)}일`, '잔여(미경과) 기간', `${num(s.remainDays)}일`],
        ['납부 회차', paidLabel(s), s.overpaidRent ? '초과 납부 렌트료' : '미납 렌트료', won(s.overpaidRent || s.unpaidRent)]
      ]} />

      <Band>2.  정산 내역</Band>
      <ClaimTable
        s={s}
        depositNote="계약 시 예치하신 보증금 전액 반환"
        advanceNote={<>납입 {won(s.advance)} - 이용기간 사용분 {won(s.advanceUsed)} (위약금 등과 상계)<br />{advanceText(s)}</>}
        basis={{
          title: '산출 근거 (숫자 대입)',
          A: s.overpaidRent
            ? ['납부 회차가 반납일을 넘어 미납 없음', `※ 초과 납부분은 아래에서 차감 : ${overText(s)}`]
            : [`월 렌트료 ${num(s.fee)}원 × 미납 ${num(s.unpaidRounds)}회 = ${won(s.roundRent)}`, `  + 잔여 ${num(s.leftDays)}일 × 1일 ${num(s.dailyRent)}원 = ${won(s.leftRent)}`, `※ ${paidText(s)}`],
          B: excessLines(s),
          C: [s.repairTotal === 0 ? '반납 점검 결과 청구할 수리내역 없음' : '반납 점검 리포트상 수리내역 합계'],
          D: [`미납 통행료 ${won(s.toll)} + 범칙금 ${won(s.fine)} + 미납 수리비 ${won(s.unpaidRepair)}`, '※ 범칙금 30만원은 예치금으로, 반납 3개월 후 최종 부과 확인 뒤 잔액 반환'],
          E: [`1일 대여료(VAT 제외) ${num(s.penaltyDailySupply)}원 × 미경과 ${num(s.remainDays)}일 × ${pctText(s.ratePct)}`, `※ ${penaltyBasis(s)} (세금계산서 미발행)`]
        }}
      />
      <div style={{ marginTop: '10px' }}><ResultNote amount={s.final} /></div>
      <NoticeBlock form={form} no={3} />
    </A4Page>
    <ProcedurePage s={s} form={form} no={4} />
    </>
  );
}

/** 상세 표의 한 묶음. rows = [번호, 항목, 계산 방법, 값, 강조] */
function DetailGroup({ title, rows, foot, bg }) {
  const text = { ...valueCell, textAlign: 'left', fontSize: '11.5px', color: '#404040' };
  return (
    <>
      <div style={{ background: bg || '#dce6f1', color: NAVY, fontWeight: 700, fontSize: '13px', padding: '4px 8px', marginTop: '10px', border: LINE }}>{title}</div>
      <table style={tableStyle}>
        <colgroup><col style={{ width: '6%' }} /><col style={{ width: '24%' }} /><col /><col style={{ width: '19%' }} /></colgroup>
        <tbody>
          {rows.map(([no, name, how, value, strong]) => {
            const fill = strong ? { background: LABEL_BG, fontWeight: 700 } : {};
            return (
              <tr key={name}>
                <td style={{ ...valueCell, ...fill }}>{no}</td>
                <td style={{ ...valueCell, ...fill, textAlign: 'left' }}>{name}</td>
                <td style={{ ...text, ...(strong ? { background: LABEL_BG } : {}) }}>{how}</td>
                <td style={{ ...moneyCell, ...fill, ...(strong ? { color: NAVY } : {}) }}>{value}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {foot && <div style={{ fontSize: '11.5px', color: RED, lineHeight: 1.5, marginTop: '4px' }}><Lines lines={foot} /></div>}
    </>
  );
}

function DetailLayout({ data, doc, s, form }) {
  return (
    <>
      <A4Page last={false}>
        <DocHead title="중도해지 정산서" sub="장기렌터카 계약 중도해지에 따른 정산 내역입니다." issueDate={form.issueDate} />
        <Band top={0}>1.  계약 및 차량 정보</Band>
        <PairTable label="20%" value="30%" rows={[
          ['고객명', data.party.name, '계약기간', termText(s)],
          ['차종', doc.carModel, '렌트 실행일', s.start],
          ['차량번호', doc.plateNo, '계약 만료(예정)일', s.end],
          ['월 렌트료', won(s.fee), '차량 반납일', s.returnDate],
          ['실제 이용기간', `${num(s.usedDays)}일`, '잔여(미경과) 기간', `${num(s.remainDays)}일`],
          ['납부 회차', paidLabel(s), s.overpaidRent ? '초과 납부 렌트료' : '미납 렌트료', won(s.overpaidRent || s.unpaidRent)]
        ]} />

        <Band>2.  정산 결과 요약</Band>
        <ClaimTable
          s={s}
          depositNote="계약 시 예치하신 보증금 전액"
          advanceNote="선수금 중 이용하지 않은 기간분 (아래 ⑤)"
          basis={{
            title: '내용',
            A: ['납부 완료 회차 이후, 반납일까지의 렌트료'],
            B: ['약정 주행거리 초과분에 대한 정산'],
            C: ['반납 점검 결과 차량 손상 복구 비용'],
            D: ['미납 통행료·범칙금 등'],
            E: ['계약 만료 전 해지에 따른 손해배상액']
          }}
        />
        <div style={{ marginTop: '10px' }}><ResultNote amount={s.final} /></div>

        <DetailGroup
          title="선수금 정산  —  납입하신 선수금 중 사용하지 않은 기간분은 반환됩니다"
          rows={[
            ['①', '납입 선수금', '계약 시 선납하신 금액', won(s.advance)],
            ['②', '총 계약일수', `${s.start} ~ ${s.end}`, `${num(s.totalDays)}일`],
            ['③', '1일 선수금', '① ÷ ②', won(s.advanceDaily)],
            ['④', '이용기간 사용분', `③ × 이용 ${num(s.usedDays)}일`, won(s.advanceUsed)],
            ['⑤', '미경과분 (반환 대상)', `③ × 미경과 ${num(s.remainDays)}일`, won(s.advanceRemain), true]
          ]}
          foot={['※ 선수금은 이용하신 기간만큼 소진되며, 이용하지 않은 기간분(⑤)은 돌려드릴 금액으로 위약금 등 청구금액과 상계합니다.']}
        />
        <NoticeBlock form={form} no={3} />
      </A4Page>

      <A4Page last={false}>
        <Band top={0}>4.  항목별 상세 산출 근거</Band>
        <DetailGroup
          title="A.  미납 렌트료  —  납부가 완료된 회차 이후, 반납일까지의 렌트료"
          rows={[
            ['①', '1회차 렌트료 기간', `${s.start} ~ ${s.firstRoundEnd}  (${s.firstRoundDays}일)`, won(s.fee)],
            ['②', '납부 완료일', `청구서 ${num(s.paidCount)}회 납부`, s.paidUntil],
            ['③', '미납 기간', s.hasUnpaid ? `${s.unpaidFrom} ~ ${s.returnDate}` : '미납 없음 (납부 회차가 이용기간을 초과)', `${num(s.unpaidDays)}일`],
            ['④', '미납 회차 수', s.unpaidRounds ? `${s.unpaidFrom} ~ ${s.roundsUntil}` : '완납 회차 없음', `${num(s.unpaidRounds)}회`],
            ['⑤', '회차분 렌트료', `${num(s.fee)}원 × ④ ${num(s.unpaidRounds)}회`, won(s.roundRent)],
            ['⑥', '잔여 일수', s.leftDays ? `${s.leftFrom} ~ ${s.returnDate} (반납일 포함)` : '해당 없음', `${num(s.leftDays)}일`],
            ['⑦', '1일 렌트료', `${num(s.fee)}원 × 12개월 ÷ 365일 (원 단위 절사)`, won(s.dailyRent)],
            ['⑧', '잔여분 렌트료', `⑦ ${num(s.dailyRent)}원 × ⑥ ${num(s.leftDays)}일`, won(s.leftRent)],
            ['⑨', '미납 렌트료', '⑤ + ⑧', won(s.unpaidRent), true],
            ...(s.overpaidRent ? [['⑩', '초과 납부 렌트료', overText(s), won(s.overpaidRent), true]] : [])
          ]}
          foot={['※ 렌트료는 인도일을 기준으로 매월 같은 날 시작하는 회차 단위로 부과되며, 마지막 회차에 미치지 못한 기간만 일할 계산합니다.']}
        />
        <DetailGroup
          title="B.  초과운행 부담금  —  약정 주행거리를 넘겨 운행하신 거리에 대한 정산"
          rows={[
            ['①', '약정 주행거리', `연 ${num(s.annualKm)}km ÷ 365일 × ${num(s.usedDays)}일`, `${num(s.contractKm)}km`],
            ['②', '기본 제공 거리', '계약상 무상으로 제공되는 거리', `${num(s.baseKm)}km`],
            ['③', '실제 주행거리', '반납 시 계기판 기준', `${num(s.actualKm)}km`],
            ['④', '초과 주행거리', '③ - ① - ②', `${num(s.excessKm)}km`],
            ['⑤', 'km당 초과운행료', `${s.origin} 차량 기준 · 국산 100원, 수입 200원`, won(s.kmRate)],
            ['⑥', '초과운행 부담금', '④ × ⑤', won(s.excessFee), true]
          ]}
          foot={['※ 초과 주행거리는 소수점 이하까지 계산되므로, 표시된 반올림 값으로 재계산하면 수십 원의 차이가 있을 수 있습니다.']}
        />
        <DetailGroup
          title="C.  면책금(수리비)  —  반납 점검 결과 확인된 차량 손상 복구 비용"
          rows={[
            ...s.repairs.map((n, i) => ['', `수리내역 ${i + 1}`, '반납 점검 리포트 기준', won(n)]),
            ['', '면책금 합계', `수리내역 1 ~ ${s.repairs.length} 합계`, won(s.repairTotal), true]
          ]}
        />
      </A4Page>

      <A4Page last={false}>
        <Band top={0}>4.  항목별 상세 산출 근거 (이어서)</Band>
        <DetailGroup
          title="D.  미납 청구금액  —  이용 중 발생한 통행료·범칙금 등 미정산 항목"
          rows={[
            ['', '미납 통행료', '하이패스·유료도로 미납분', won(s.toll)],
            ['', '범칙금', '과태료·범칙금 예치금 (3개월 후 잔액 반환)', won(s.fine)],
            ['', '미납 수리비', '이용 중 발생한 미정산 수리비', won(s.unpaidRepair)],
            ['', '미납 청구금액 합계', '미납 통행료 + 범칙금 + 미납 수리비', won(s.unpaidClaim), true]
          ]}
          foot={['※ 범칙금·과태료 30만원은 예치금으로, 반납일로부터 3개월 후 최종 부과 여부를 확인하여 잔액을 돌려드립니다.']}
        />
        <DetailGroup
          title="E.  위약금  —  계약 만료 전 해지에 따른 손해배상액 (계약서 기준)"
          rows={[
            ['①', '위약금 기준 1일 렌트료', `${num(s.fee)}원 + 선수금 월분할 ${num(s.advanceMonthly)}원`, won(s.penaltyDaily)],
            ['②', '1일 렌트료 (VAT 제외)', '① ÷ 1.1 (부가세 제외)', won(s.penaltyDailySupply)],
            ['③', '미경과일수', `반납일 ${s.returnDate} ~ 만료일 ${s.end}`, `${num(s.remainDays)}일`],
            ['④', '위약금율', '계약서에 정한 중도해지 위약금율', pctText(s.ratePct)],
            ['⑤', '위약금', '② × ③ × ④', won(s.penalty), true]
          ]}
          foot={['※ 위약금은 부가가치세 과세 대상이 아니므로 세금계산서가 발행되지 않습니다.', '※ 잔여 계약기간 전액이 아닌, 잔여 렌트료의 일정 비율(위약금율)만 청구되는 금액입니다.']}
        />
      </A4Page>
      <ProcedurePage s={s} form={form} no={5} />
    </>
  );
}

/**
 * @param {{ data: object, form: object, innerRef?: any }} props
 *   data = 서버 buildDeliveryDocs 결과(docs는 고른 차 한 대), form = 화면 입력값(layout: split | summary | detail)
 */
export default function EarlySettlementSheet({ data, form, innerRef }) {
  const doc = data?.docs?.[0];
  if (!doc) return null;
  const s = settlementOf(doc, form);
  const wrap = { width: `${PAGE_W}px`, background: '#fff' };
  if (!s) {
    return <div ref={innerRef} className="print-fit" style={{ ...wrap, padding: '40px', background: NOTE_BG, fontSize: '14px' }}>차량 반납일과 인도일·계약 만료일이 있어야 정산서를 만들 수 있습니다.</div>;
  }
  const Layout = form.layout === 'summary' ? SummaryLayout : form.layout === 'detail' ? DetailLayout : SplitLayout;
  return (
    <div ref={innerRef} className="print-fit" style={wrap}>
      <Layout data={data} doc={doc} s={s} form={form} />
    </div>
  );
}
