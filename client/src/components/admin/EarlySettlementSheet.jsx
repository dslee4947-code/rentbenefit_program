import { settlementOf } from '../../utils/contractEnd.js';
import { NAVY, RED, LABEL_BG, LINE, NOTE_BG, COMPANY, PAGE_W, headCell, labelCell, moneyCell, num, subCell, tableStyle, valueCell, won } from '../../utils/endDocStyle.js';
import { A4Page, Band, DocHead, PairTable, ResultNote } from './EndDocParts.jsx';

/**
 * 중도해지 정산서.
 *
 * 양식은 Dropbox "09.중도해지/중도해지_정산서261104.xlsx"(대표님 2026-11-04)의 세 시트다.
 * 구분형 '렌터카 계약 중도해지 정산 안내' · 요약형 · 상세. 계산은 모두 utils/contractEnd.js의 settlementOf 하나를 쓴다.
 */

const signedWon = (n) => (n < 0 ? <span style={{ color: RED }}>-{won(-n)}</span> : won(n));
const pctText = (n) => `${Number(n) || 0}%`;
const termText = (s) => (s.termMonths % 12 === 0 && s.termMonths ? `${s.termMonths / 12}년` : `${s.termMonths}개월`);

const NOTES = [
  '본 정산서의 금액은 원 단위 미만을 절사하였으며, 산출 근거의 숫자는 반올림 표기입니다.',
  '중도해지 위약금은 세금계산서가 발행되지 않으며, 그 외 항목은 관련 규정에 따라 처리됩니다.',
  '범칙금은 예치금 성격으로, 반납일로부터 6개월 후 최종 부과 내역 확인 뒤 잔액을 반환해 드립니다.',
  '차량 반납 이후 통행료·과태료 등이 추가로 확인될 경우, 별도로 정산을 요청드릴 수 있습니다.',
  '정산 내역에 대해 확인이 필요하신 부분은 아래 담당자에게 연락 주시면 상세히 안내해 드리겠습니다.'
];

const note = { fontSize: '12px', lineHeight: 1.55 };
const penaltyBasis = (s) => `월 렌트료 ${num(s.fee)}원 + 선수금 월분할 ${num(s.advanceMonthly)}원 기준`;
const advanceText = (s) => `선수금 ${num(s.advance)}원 ÷ 총 계약 ${num(s.totalDays)}일 × 미경과 ${num(s.remainDays)}일`;
const paidLabel = (s) => (s.paidCount ? `${num(s.paidCount)}회 · ${won(s.paidRent)}` : won(s.paidRent));
const dueText = (s) => `월 렌트료 ${num(s.fee)}원 × ${num(s.usedMonths)}개월 + 1일 ${num(s.dailyRent)}원 × ${num(s.leftDays)}일`;

function excessLines(s) {
  const contract = `약정 = 연 ${num(s.annualKm)}km ÷ 365 × 이용 ${num(s.usedDays)}일`;
  return s.excessFee === 0
    ? ['약정 주행거리 이내 운행으로 초과 부담금 없음', `※ 실주행 ${num(s.actualKm)}km ≤ 약정 ${num(s.contractKm)}km + 기본제공 ${num(s.baseKm)}km`, `    (${contract})`]
    : [`초과 ${num(s.excessKm)}km × ${num(s.kmRate)}원/km`, `※ 실주행 ${num(s.actualKm)}km - 약정 ${num(s.contractKm)}km - 기본제공 ${num(s.baseKm)}km`, `    (${contract})`];
}

function Lines({ lines }) {
  return lines.map((t) => <div key={t} style={{ whiteSpace: 'pre-wrap' }}>{t}</div>);
}

/** 구분형: ( a ) 기본 정산금 · ( b ) 중도해지 정산금 · ( c ) 고객 반환금 */
function SplitLayout({ data, doc, s, form }) {
  const a = [
    ['이용 개월', `${num(s.usedMonths)}개월`],
    ['회차분 렌트료', won(s.monthsRent)],
    ['잔여 일수', `${num(s.leftDays)}일`],
    ['1일 렌트료', won(s.dailyRent)],
    ['잔여분 렌트료', won(s.leftRent)],
    ['이용기간 렌트료', won(s.dueRent)],
    ['납부한 렌트료', won(s.paidRent)],
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
    `※ 이용기간 렌트료(${s.start} ~ ${s.returnDate}) = ${dueText(s)} = ${won(s.dueRent)}`,
    s.overpaidRent
      ? `     납부한 렌트료 ${won(s.paidRent)} - 이용기간 렌트료 = 초과 납부 ${won(s.overpaidRent)} (위약금 등과 상계)`
      : `     이용기간 렌트료 - 납부한 렌트료 ${won(s.paidRent)} = 미납 ${won(s.unpaidRent)}`,
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
    <A4Page footer={false} padding="18px 44px">
      <DocHead title="렌터카 계약 중도해지 정산 안내" sub="계약 중도해지에 따른 정산 내역을 아래와 같이 안내드립니다." issueDate={form.issueDate} />
      <Band top={0}>1.  렌트 계약 내용</Band>
      <PairTable rows={[
        ['임 차 인 명', data.party.name, '차        종', doc.carModel],
        ['계 약 기 간', `${s.termMonths}개월 (${s.start} ~ ${s.end})`, '차 량 번 호', doc.plateNo],
        ['월  렌 트 료', `${num(s.fee)} 원 (VAT 포함)`, '선   수   금', won(s.advance)]
      ]} />

      <Band>2.  중도해지 기준일</Band>
      <PairTable rows={[
        ['차 량 반 납 일', <b key="d">{s.returnDate}</b>, '납부한 렌트료', <b key="p">{paidLabel(s)}</b>]
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
    <A4Page>
      <DocHead title="중도해지 정산서" sub="장기렌터카 계약 중도해지에 따른 정산 내역입니다." issueDate={form.issueDate} />
      <Band top={0}>1.  계약 및 차량 정보</Band>
      <PairTable label="20%" value="30%" rows={[
        ['고객명', data.party.name, '차종 / 차량번호', `${doc.carModel}  ${doc.plateNo}`],
        ['렌트 실행일', s.start, '계약 만료(예정)일', s.end],
        ['차량 반납일', s.returnDate, '월 렌트료', won(s.fee)],
        ['실제 이용기간', `${num(s.usedDays)}일`, '잔여(미경과) 기간', `${num(s.remainDays)}일`],
        ['납부한 렌트료', paidLabel(s), '이용기간 렌트료', won(s.dueRent)]
      ]} />

      <Band>2.  정산 내역</Band>
      <ClaimTable
        s={s}
        depositNote="계약 시 예치하신 보증금 전액 반환"
        advanceNote={<>납입 {won(s.advance)} - 이용기간 사용분 {won(s.advanceUsed)} (위약금 등과 상계)<br />{advanceText(s)}</>}
        basis={{
          title: '산출 근거 (숫자 대입)',
          A: [`이용기간 렌트료 ${won(s.dueRent)} - 납부한 렌트료 ${won(s.paidRent)}`, `※ ${dueText(s)}`, `※ 이용기간 ${s.start} ~ ${s.returnDate}${s.overpaidRent ? ' (초과 납부분은 아래에서 차감)' : ''}`],
          B: excessLines(s),
          C: [s.repairTotal === 0 ? '반납 점검 결과 청구할 수리내역 없음' : '반납 점검 리포트상 수리내역 합계'],
          D: [`미납 통행료 ${won(s.toll)} + 범칙금 ${won(s.fine)} + 미납 수리비 ${won(s.unpaidRepair)}`, '※ 범칙금은 예치금으로, 반납 6개월 후 최종 부과 확인 뒤 잔액 반환'],
          E: [`1일 대여료(VAT 제외) ${num(s.penaltyDailySupply)}원 × 미경과 ${num(s.remainDays)}일 × ${pctText(s.ratePct)}`, `※ ${penaltyBasis(s)} (세금계산서 미발행)`]
        }}
      />
      <div style={{ marginTop: '10px' }}><ResultNote amount={s.final} /></div>
      <NoticeBlock form={form} no={3} />
    </A4Page>
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
          ['납부한 렌트료', paidLabel(s), '이용기간 렌트료', won(s.dueRent)]
        ]} />

        <Band>2.  정산 결과 요약</Band>
        <ClaimTable
          s={s}
          depositNote="계약 시 예치하신 보증금 전액"
          advanceNote="선수금 중 이용하지 않은 기간분 (아래 ⑤)"
          basis={{
            title: '내용',
            A: ['인도일부터 반납일까지의 렌트료 중 납부하지 않은 금액'],
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
          title="A.  미납 렌트료  —  인도일부터 반납일까지의 렌트료와 납부하신 금액의 차이"
          rows={[
            ['①', '이용 기간', `${s.start} ~ ${s.returnDate} (반납일 포함)`, `${num(s.usedDays)}일`],
            ['②', '이용 개월 수', s.usedMonths ? `${s.start} ~ ${s.monthsUntil}` : '한 달 미만', `${num(s.usedMonths)}개월`],
            ['③', '회차분 렌트료', `${num(s.fee)}원 × ② ${num(s.usedMonths)}개월`, won(s.monthsRent)],
            ['④', '잔여 일수', s.leftDays ? `${s.leftFrom} ~ ${s.returnDate} (반납일 포함)` : '해당 없음', `${num(s.leftDays)}일`],
            ['⑤', '1일 렌트료', `${num(s.fee)}원 × 12개월 ÷ 365일 (원 단위 절사)`, won(s.dailyRent)],
            ['⑥', '잔여분 렌트료', `⑤ ${num(s.dailyRent)}원 × ④ ${num(s.leftDays)}일`, won(s.leftRent)],
            ['⑦', '이용기간 렌트료', '③ + ⑥', won(s.dueRent)],
            ['⑧', '납부한 렌트료', `입금 확인 기준${s.paidCount ? ` (${num(s.paidCount)}회)` : ''}`, won(s.paidRent)],
            ['⑨', s.overpaidRent ? '초과 납부 렌트료' : '미납 렌트료', s.overpaidRent ? '⑧ - ⑦ (최종 정산금에서 차감)' : '⑦ - ⑧', won(s.overpaidRent || s.unpaidRent), true]
          ]}
          foot={['※ 렌트료는 인도일을 기준으로 매월 같은 날 시작하는 단위로 계산하며, 한 달에 미치지 못한 기간만 일할 계산합니다. 납부한 렌트료는 실제 입금액 기준입니다.']}
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

      <A4Page>
        <Band top={0}>4.  항목별 상세 산출 근거 (이어서)</Band>
        <DetailGroup
          title="D.  미납 청구금액  —  이용 중 발생한 통행료·범칙금 등 미정산 항목"
          rows={[
            ['', '미납 통행료', '하이패스·유료도로 미납분', won(s.toll)],
            ['', '범칙금', '과태료·범칙금 예치금', won(s.fine)],
            ['', '미납 수리비', '이용 중 발생한 미정산 수리비', won(s.unpaidRepair)],
            ['', '미납 청구금액 합계', '미납 통행료 + 범칙금 + 미납 수리비', won(s.unpaidClaim), true]
          ]}
          foot={['※ 범칙금은 예치 성격의 금액으로, 반납일로부터 6개월 후 최종 부과 여부를 확인하여 잔액을 반환해 드립니다.']}
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
