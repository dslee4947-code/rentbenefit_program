import { makeFittedPdf } from '../../utils/printFit.js';
import { advanceSummary } from './advancePayment.js';

/**
 * 청구서 양식과 PDF 만들기.
 *
 * 월 청구 화면(발행)과 청구서 보관함(지난 회차 보기)이 같은 양식을 쓴다.
 * 양식이 두 벌이면 한쪽만 고쳐져, 보관함에서 본 청구서와 실제로 나간 청구서가 달라진다.
 */

const ymd = (d) => (d ? String(d).slice(0, 10) : '-');
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 렌트베네핏 입금전용계좌. 엑셀 청구서 107장이 모두 이 계좌였다(2026-10-19 확인).
// 자동이체(CMS) 출금일에 잔액 부족 등으로 빠지지 않았을 때 고객이 직접 넣는 곳이다.
export const DEPOSIT_ACCOUNT = { bankName: '부산은행', accountNo: '101-2077-5994-03', holder: '(주)렌트베네핏' };

/**
 * 고객 출금 계좌 가리기. 첫 묶음 숫자만 보이고 나머지 숫자는 *로 바꾼다. '-' 자리는 그대로 둔다.
 *   276-081940-01-014 -> 276-******-**-***
 *   50408111604012    -> 5040********** ('-'가 없으면 앞 4자리만)
 * 엑셀은 수식(앞 5글자 + * 11개)과 손으로 가린 것이 섞여 고객마다 모양이 달랐다.
 */
export const maskAccount = (accountNo) => {
  const s = String(accountNo || '').trim();
  if (!s) return '';
  const star = (t) => t.replace(/[0-9A-Za-z]/g, '*');
  const i = s.indexOf('-');
  if (i > 0) return s.slice(0, i) + star(s.slice(i));
  return s.slice(0, 4) + star(s.slice(4));
};

/** 출금 계좌: 차량에 적힌 계좌가 먼저, 없으면 법인·고객 기본 계좌 */
const debitAccountOf = (vehicles, company, customer) => {
  const v = (vehicles || []).find((x) => x?.banking?.accountNo)?.banking;
  if (v) return { bankName: v.bankName, accountNo: v.accountNo };
  if (company?.bank?.accountNo) return { bankName: company.bank.bankName, accountNo: company.bank.accountNo };
  if (customer?.bank?.account) return { bankName: customer.bank.name, accountNo: customer.bank.account };
  return null;
};

// 서류에 적은 금액이 어느 청구 항목으로 합산되는지. 서버(billingScheduleController.js)와 같은 규칙이다.
// 정비내역만 '정기점검/정비'로 가고 나머지는 모두 '범칙금/과태료'로 묶는다.
// 종류 이름을 직접 적을 수 있어(주차위반 등) 정해진 목록으로 판정하지 않는다.
export const MAINTENANCE_KINDS = ['정비내역', '정비'];
export const isMaintenanceKind = (kind) => MAINTENANCE_KINDS.includes(String(kind || '').trim());

export const sumAmount = (list) => (list || []).reduce((sum, a) => sum + (Number(a.amount) || 0), 0);

// 우리가 청구하지 않는 고지서 상태. 서버 recalcRound(billingScheduleController.js)와 같은 목록이다.
//  납부완료 - 고객이 직접 냈다 / 변경완료 - 명의가 고객에게 넘어갔다 / 고객납부 - 예전 상태값
// 예전 화면은 고객납부만 빼서, 고객이 이미 낸 과태료가 명세에 찍힐 수 있었다.
// 청구취소: 올린 뒤 고객이 직접 내겠다고 해 청구에서 뺀 건(대표님 2026-10-23)
export const NOT_BILLED_NOTICE_STATUSES = ['납부완료', '변경완료', '고객납부', '청구취소'];
export const isBilledNotice = (a) => !NOT_BILLED_NOTICE_STATUSES.includes(a?.noticeStatus);

/**
 * 연장 계약 첫 청구서 안내 문장. 서버 메일(billingScheduleController extensionLeadOf)과 같은 말을 쓴다.
 * @param {object} contract populate된 계약(contractNo, contractDate, endDate, extensionInfo)
 */
const extensionNoticeOf = (contract) => {
  const info = contract.extensionInfo || {};
  // 한국 날짜로 읽는다(자정이 UTC 전날 15시로 저장된 값도 있다). 저장된 종료일은 기간 다음 날이라 하루 뺀다
  const kst = (d, days = 0) => new Date(new Date(d).getTime() + (9 + days * 24) * 3600e3).toISOString().slice(0, 10);
  const lastDay = contract.endDate ? kst(contract.endDate, -1) : '';
  const period = contract.contractDate ? ` · 계약 기간 ${kst(contract.contractDate)} ~ ${lastDay}` : '';
  const prev = info.previousContractNo
    ? ` 이전 계약(${info.previousContractNo})${info.previousLastRound ? ` ${info.previousLastRound}회` : ''} 다음 회차입니다.`
    : '';
  return `[연장 계약 안내] 이번 청구서부터 연장 계약(${contract.contractNo}${period}) 조건으로 청구합니다.${prev}`;
};

/**
 * 회차 청구액. 서버 recalcRound와 같은 식이다.
 * @param {object} round 회차 (fine, maintenance, other는 이미 합산된 값)
 */
export const roundTotal = (round) => Number(round?.monthlyRent || 0) + Number(round?.prevUnpaid || 0)
  + Number(round?.interest || 0) + Number(round?.fine || 0) + Number(round?.maintenance || 0)
  + Number(round?.other || 0) - Number(round?.prevOverpaid || 0);

/**
 * 화면에 그려 둔 청구서 양식을 모양 그대로 A4 PDF로 만든다(utils/printFit.js, docs/print-a4-guide.md).
 * 선과 작은 글자가 많은 표라 png로 뜬다.
 * @param {HTMLElement} element InvoiceSheet의 innerRef
 * @returns {Promise<Blob>}
 */
export const makeInvoicePdf = (element) => makeFittedPdf(element, { orientation: 'portrait', marginMm: 5, imageType: 'png' });

/**
 * 청구서 양식. 월 청구 화면은 숨겨 두고 PDF로 캡처하고, 청구서 보관함은 화면에 그대로 보여 준다.
 * 엑셀로 쓰던 청구서 양식(결제금액 내역 / 청구내역 / 상세내역 / 차량 표)을 그대로 옮겼다.
 */
/**
 * 상세내역의 차종 칸. 같은 차종이 여러 대면 대수를 붙이고(레이 20대), 차종이 셋 이상이면 두 개만 쓰고 '외 n종'으로 줄인다.
 */
const carModelText = (vehicles) => {
  const counts = new Map();
  (vehicles || []).forEach((v) => {
    const model = String(v?.carModel || '').trim();
    if (model) counts.set(model, (counts.get(model) || 0) + 1);
  });
  const parts = [...counts].map(([model, n]) => (n > 1 ? `${model} ${n}대` : model));
  if (!parts.length) return '-';
  return parts.length > 2 ? `${parts.slice(0, 2).join(', ')} 외 ${parts.length - 2}종` : parts.join(', ');
};

export default function InvoiceSheet({ innerRef, item, round, vehicles, total }) {
  const company = item?.company;
  const name = company?.name || item?.customer?.name || '-';
  const cell = { border: '1px solid #ccc', padding: '4px 8px', fontSize: '11px' };
  const head = { ...cell, background: '#e8e8e8', fontWeight: 700, textAlign: 'center' };

  // 금액이 적힌 서류. 범칙금이 여러 건이면 합계만 찍지 않고 명세로 펼친다.
  // 고객이 직접 낸 건은 청구액에 안 들어가므로 명세에서도 빼야 한다.
  // 합계에 없는 줄이 명세에 찍히면 법인이 바로 되묻는다.
  const fineDocs = (round?.attachments || [])
    .filter((a) => !isMaintenanceKind(a.kind) && Number(a.amount) > 0 && isBilledNotice(a));
  // 발생일은 적는 칸을 없앴다. 예전에 적어 둔 건이 있을 때만 열을 보여 준다.
  const hasOccurred = fineDocs.some((a) => a.occurredAt);
  const interestLabel = round?.interestRate
    ? `연체 이자 (연 ${round.interestRate}% · ${round.interestDays || 0}일)`
    : '연체 이자';

  const rows = [
    ['전월 미결제금액', round?.prevUnpaid],
    ['전월 초과 입금액', round?.prevOverpaid],
    ['당월 결제금액', round?.monthlyRent],
    ['정기점검', round?.maintenance],
    ['범칙금 / 과태료', round?.fine],
    [interestLabel, round?.interest],
    // 기타 청구는 '기타 80,000원'만 찍히면 무슨 돈인지 되묻게 되므로 적어 둔 항목명을 그대로 쓴다
    ...((round?.extras || []).length
      ? round.extras.map((e) => [e.label || '기타 청구', e.amount])
      : [['기타 청구', round?.other]])
  ];
  // 선납금이 있는 계약: 청구액은 그대로 두고, 차량 표의 칸과 표 아래 한 줄(잔액)에만 작게 보여 준다
  // (대표님 지시 2026-10-18, 총액 아래 식 줄은 겹쳐서 2026-10-19에 뺐다).
  const adv = advanceSummary(vehicles, round?.no);
  const small = { fontSize: '10.5px', color: '#666' };

  const debit = debitAccountOf(vehicles, company, item?.customer);
  // 연장 계약은 회차가 1부터 다시 시작한다. 표시가 없으면 '1회'만 보고 새 계약인지 헷갈린다(대표님 2026-10-26)
  const contract = item?.contract;
  const ext = contract?.contractKind === '연장';
  const extLead = ext && Number(round?.no) === 1 ? extensionNoticeOf(contract) : '';
  const details = [
    ['고객명', name],
    ['거래은행', debit?.bankName || '-'],
    ['계좌번호', debit ? maskAccount(debit.accountNo) : '-'],
    ['납입회차', ext ? `${round?.no || '-'} 회 (연장 계약)` : `${round?.no || '-'} 회`],
    ['출금일', ymd(round?.dueDate)]
  ];
  // 연체 이율 안내. 계약마다 다르다(기존 고객 20%, 이후 25%). 모르면 문구를 빼고 틀린 숫자를 찍지 않는다.
  const lateRate = Number(item?.lateInterestRate || round?.interestRate || 0);

  return (
    <div ref={innerRef} className="m-doc" style={{ width: '780px', padding: '28px', background: '#fff', color: '#111', fontFamily: "'Malgun Gothic', sans-serif" }}>
      {/* 어느 차 청구서인지 첫 장에서 바로 보이게 계약자 이름 옆에 차종을 둔다(대표님 2026-10-28) */}
      <div style={{ fontSize: '20px', fontWeight: 800, marginBottom: '16px' }}>
        {name}
        {carModelText(vehicles) !== '-' && (
          <span style={{ fontSize: '14px', fontWeight: 700, color: '#555', marginLeft: '10px' }}>{carModelText(vehicles)}</span>
        )}
      </div>

      <div style={{ background: '#8a8a8a', color: '#fff', padding: '5px 10px', fontWeight: 700, fontSize: '12px' }}>결제금액 내역</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px', margin: '10px 0 2px' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: '11px' }}>
          <tbody>
            <tr><td style={{ padding: '1px 10px 1px 0', color: '#555' }}>결제일</td><td style={{ fontWeight: 700 }}>{ymd(round?.dueDate)}</td></tr>
            <tr><td style={{ padding: '1px 10px 1px 0', color: '#555' }}>작성기준일</td><td>{ymd(round?.issuedAt) !== '-' ? ymd(round.issuedAt) : todayYmd()}</td></tr>
          </tbody>
        </table>
        <div style={{ fontSize: '18px', fontWeight: 800, whiteSpace: 'nowrap' }}>{Number(total || 0).toLocaleString()} 원</div>
      </div>

      <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
        <table style={{ width: '50%', borderCollapse: 'collapse' }}>
          <thead><tr><th colSpan={3} style={head}>청구내역</th></tr></thead>
          <tbody>
            {rows.map(([label, value], i) => (
              // 같은 이름이 여러 줄일 수 있다(과태료 두 건 등). 이름으로 구분하면 한 줄이 사라진다.
              <tr key={`${i}-${label}`}>
                <td style={{ ...cell, width: '28px', textAlign: 'center' }}>{i + 1}</td>
                <td style={cell}>{label}</td>
                <td style={{ ...cell, textAlign: 'right' }}>{value ? Number(value).toLocaleString() : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <table style={{ width: '50%', borderCollapse: 'collapse' }}>
          <thead><tr><th colSpan={3} style={head}>상세내역</th></tr></thead>
          <tbody>
            {details.map(([label, value], i) => (
              <tr key={`${i}-${label}`}>
                <td style={{ ...cell, width: '28px', textAlign: 'center' }}>{i + 1}</td>
                <td style={cell}>{label}</td>
                <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 연장 계약 첫 청구서 안내. 메일 본문 맨 위에도 같은 문장이 붙는다(서버 extensionLeadOf) */}
      {extLead && (
        <div style={{ margin: '10px 0 0', padding: '6px 10px', border: '1px solid #1e3a8a', background: '#eff6ff', color: '#1e3a8a', fontSize: '11px', fontWeight: 700 }}>
          {extLead}
        </div>
      )}

      {/* 지난 회차의 미청구 연체 이자를 이번 청구서에 모아 청구한 근거. 합계에는 기타 청구 줄로 들어가 있다(대표님 지시 2026-10-28) */}
      {round?.pastInterestCharge?.amount > 0 && round.extras?.some((e) => e.label === round.pastInterestCharge.label) && (
        <div style={{ marginTop: '10px', padding: '6px 10px', border: '1px solid #f59e0b', borderRadius: '4px', fontSize: '10px', color: '#78350f', background: '#fffbeb' }}>
          <div style={{ fontWeight: 700, marginBottom: '3px' }}>
            {round.pastInterestCharge.label} {Number(round.pastInterestCharge.amount).toLocaleString()}원 내역 (n회 청구서 · 미납 회차 원금 × 연이율 × 일수 ÷ 365, 10원 미만 버림)
          </div>
          <div style={{ columnCount: (round.pastInterestCharge.items || []).length > 8 ? 2 : 1, columnGap: '16px' }}>
            {(round.pastInterestCharge.items || []).map((it, i) => (
              <div key={i} style={{ breakInside: 'avoid', whiteSpace: 'nowrap' }}>
                · {it.onNo}회 · {it.fromNo}회분 {Number(it.principal).toLocaleString()} × {it.rate}% × {it.days}일
                ({String(it.from).slice(2, 10).replace(/-/g, '.')}~{String(it.to).slice(5, 10).replace(/-/g, '.')}) = {Number(it.amount).toLocaleString()}원
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 받지 않은 연체 이자(기록용). 바로 청구하지 못해 청구서마다 누적으로 남긴다. 청구 합계에는 들어가지 않는다(대표님 지시 2026-10-20) */}
      {(Number(item?.unbilledInterestToDate?.amount) > 0 || round?.unbilledInterest?.amount > 0) && (
        <div style={{ marginTop: '10px', padding: '6px 10px', border: '1px dashed #f59e0b', borderRadius: '4px', fontSize: '10.5px', color: '#92400e', background: '#fffbeb' }}>
          <div>
            <b>누적 연체 이자 (청구 보류) {Number(item?.unbilledInterestToDate?.amount || round?.unbilledInterest?.amount || 0).toLocaleString()}원</b>
            {item?.unbilledInterestToDate?.count ? ` · 이번 회차까지 ${item.unbilledInterestToDate.count}건` : ''}
            {' '}— 이번 청구액에는 포함하지 않았으며, 추후 정산 때 청구할 수 있습니다.
          </div>
          {round?.unbilledInterest?.amount > 0 && (
            <div style={{ marginTop: '3px' }}>
              이번 회차에 붙은 이자 {Number(round.unbilledInterest.amount).toLocaleString()}원
              {(round.unbilledInterest.items || []).map((it, i) => (
                <div key={i}>
                  · {it.fromNo}회차 미납 {Number(it.principal).toLocaleString()}원 × 연 {it.rate}% × {it.days}일
                  ({String(it.from).slice(0, 10)} ~ {String(it.to).slice(0, 10)}) = {Number(it.amount).toLocaleString()}원
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {fineDocs.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
          <thead>
            <tr>
              <th style={{ ...head, width: '36px' }}>No</th>
              <th style={head}>구분</th>
              <th style={head}>차량번호</th>
              {hasOccurred && <th style={head}>발생일</th>}
              <th style={head}>금액</th>
            </tr>
          </thead>
          <tbody>
            {fineDocs.map((a, i) => (
              <tr key={a.fileName || i}>
                <td style={{ ...cell, textAlign: 'center' }}>{i + 1}</td>
                <td style={{ ...cell, textAlign: 'center' }}>{a.kind}</td>
                <td style={{ ...cell, textAlign: 'center' }}>{a.plateNo || '-'}</td>
                {hasOccurred && <td style={{ ...cell, textAlign: 'center' }}>{a.occurredAt ? ymd(a.occurredAt) : '-'}</td>}
                <td style={{ ...cell, textAlign: 'right' }}>{Number(a.amount).toLocaleString()}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={hasOccurred ? 4 : 3} style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>범칙금 / 과태료 합계</td>
              <td style={{ ...cell, textAlign: 'right', fontWeight: 700 }}>{sumAmount(fineDocs).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '16px' }}>
        <thead>
          <tr>
            <th style={{ ...head, width: '36px' }}>No</th>
            <th style={head}>차량번호</th>
            {adv && <th style={{ ...head, ...small, fontWeight: 600 }}>월 렌트료</th>}
            {adv && <th style={{ ...head, ...small, fontWeight: 600 }}>선납금 차감</th>}
            <th style={head}>{adv ? '청구 렌트료' : '월 렌트료'}</th>
            <th style={head}>인도일</th>
            <th style={head}>종료일</th>
          </tr>
        </thead>
        <tbody>
          {(vehicles || []).map((v, i) => {
            const a = adv?.rows.find((r) => r.plateNo === v.plateNo);
            const fee = Number(v.monthlyFee) || 0;
            return (
              <tr key={v._id}>
                <td style={{ ...cell, textAlign: 'center' }}>{i + 1}</td>
                <td style={{ ...cell, textAlign: 'center' }}>{v.plateNo || v.code || '-'}</td>
                {adv && <td style={{ ...cell, ...small, textAlign: 'right' }}>{a?.deduction ? (fee + a.deduction).toLocaleString() : (fee ? fee.toLocaleString() : '-')}</td>}
                {adv && <td style={{ ...cell, ...small, textAlign: 'right' }}>{a?.deduction ? `-${a.deduction.toLocaleString()}` : '-'}</td>}
                <td style={{ ...cell, textAlign: 'right', fontWeight: adv ? 700 : 400 }}>{fee ? fee.toLocaleString() : '-'}</td>
                <td style={{ ...cell, textAlign: 'center' }}>{ymd(v.deliveryDate)}</td>
                <td style={{ ...cell, textAlign: 'center' }}>{ymd(v.endDate)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {adv && (
        <div style={{ ...small, marginTop: '6px' }}>
          선납금 {adv.total.toLocaleString()}원 중 이번 회차까지 {adv.deducted.toLocaleString()}원 차감 ·
          {' '}잔액 {adv.balance.toLocaleString()}원{adv.remaining ? ` (남은 ${adv.remaining}회)` : ' (차감 완료)'}
          {' '}· 선납금은 계약기간 동안 매월 같은 금액으로 월 렌트료에서 차감됩니다.
        </div>
      )}

      {/* 1회차 일할 정산 — 마지막 회차에 맞추기로 한 약속을 매달 청구서에 남긴다(대표님 지시 2026-10-19) */}
      {item?.proration?.diff ? (
        <div style={{ marginTop: '14px', padding: '8px 10px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '10.5px', color: '#444' }}>
          <b>1회차 일할 정산 안내</b>
          <div style={{ marginTop: '2px' }}>
            {item.proration.firstNo || 1}회차에 인도일부터 첫 결제일까지를 일할 계산해 {Number(item.proration.firstAmount).toLocaleString()}원을 청구하여,
            월 렌트료 {Number(item.proration.regular).toLocaleString()}원보다 {Math.abs(item.proration.diff).toLocaleString()}원을 {item.proration.diff > 0 ? '더' : '덜'} 받았습니다.
            이 차액은 마지막 {item.proration.lastNo}회차에서 {item.proration.diff > 0 ? '빼고' : '더해'} {Number(item.proration.lastAmount).toLocaleString()}원으로 청구합니다.
          </div>
        </div>
      ) : null}

      {lateRate > 0 && (
        <div style={{ marginTop: '14px', fontSize: '10.5px', color: '#555' }}>
          결제일로부터 15일이 지나도록 입금되지 않은 금액은 다음 회차 청구서에 전월 미결제로 넘어가며, 연 {lateRate}%의 연체이율로 연체일수만큼 일할 계산한 이자가 함께 청구됩니다.
        </div>
      )}

      {/* 렌트베네핏 입금 계좌. 맨 위에 두면 아직 출금일 전인데 미납 고객처럼 보여 아래 안내로 둔다(대표님 지시 2026-10-19) */}
      <div style={{ marginTop: '14px', padding: '8px 10px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '10.5px', color: '#444', background: '#fafafa' }}>
        <b>입금 계좌 안내</b> &nbsp;{DEPOSIT_ACCOUNT.bankName} {DEPOSIT_ACCOUNT.accountNo} (예금주 {DEPOSIT_ACCOUNT.holder})
        <div style={{ marginTop: '2px', color: '#666' }}>
          렌트료는 출금일에 등록하신 계좌에서 자동이체됩니다. 자동이체가 되지 않은 경우에만 위 계좌로 입금해 주시면 됩니다.
        </div>
      </div>

      <div style={{ marginTop: '28px', borderTop: '2px solid #333', paddingTop: '10px', fontSize: '11px', color: '#444' }}>
        <div style={{ fontWeight: 800, fontSize: '13px', color: '#111' }}>(주)렌트베네핏</div>
        <div>서울시 서초구 양재대로 11길 36, 은관 505호 (양재동, 서울오토갤러리)</div>
        <div>대표이사 신동일 | 사업자번호 422-88-02467 &nbsp;&nbsp; T. 02-547-0303 &nbsp; F. 02-529-3303</div>
      </div>
    </div>
  );
}
