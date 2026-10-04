import html2pdf from 'html2pdf.js';

/**
 * 청구서 양식과 PDF 만들기.
 *
 * 월 청구 화면(발행)과 청구서 보관함(지난 회차 보기)이 같은 양식을 쓴다.
 * 양식이 두 벌이면 한쪽만 고쳐져, 보관함에서 본 청구서와 실제로 나간 청구서가 달라진다.
 */

const ymd = (d) => (d ? String(d).slice(0, 10) : '-');

// 서류에 적은 금액이 어느 청구 항목으로 합산되는지. 서버(billingScheduleController.js)와 같은 규칙이다.
// 정비내역만 '정기점검/정비'로 가고 나머지는 모두 '범칙금/과태료'로 묶는다.
// 종류 이름을 직접 적을 수 있어(주차위반 등) 정해진 목록으로 판정하지 않는다.
export const MAINTENANCE_KINDS = ['정비내역', '정비'];
export const isMaintenanceKind = (kind) => MAINTENANCE_KINDS.includes(String(kind || '').trim());

export const sumAmount = (list) => (list || []).reduce((sum, a) => sum + (Number(a.amount) || 0), 0);

// 우리가 청구하지 않는 고지서 상태. 서버 recalcRound(billingScheduleController.js)와 같은 목록이다.
//  납부완료 - 고객이 직접 냈다 / 변경완료 - 명의가 고객에게 넘어갔다 / 고객납부 - 예전 상태값
// 예전 화면은 고객납부만 빼서, 고객이 이미 낸 과태료가 명세에 찍힐 수 있었다.
export const NOT_BILLED_NOTICE_STATUSES = ['납부완료', '변경완료', '고객납부'];
export const isBilledNotice = (a) => !NOT_BILLED_NOTICE_STATUSES.includes(a?.noticeStatus);

/**
 * 회차 청구액. 서버 recalcRound와 같은 식이다.
 * @param {object} round 회차 (fine, maintenance, other는 이미 합산된 값)
 */
export const roundTotal = (round) => Number(round?.monthlyRent || 0) + Number(round?.prevUnpaid || 0)
  + Number(round?.interest || 0) + Number(round?.fine || 0) + Number(round?.maintenance || 0)
  + Number(round?.other || 0) - Number(round?.prevOverpaid || 0);

/**
 * 화면에 그려 둔 청구서 양식을 PDF로 만든다.
 * @param {HTMLElement} element InvoiceSheet의 innerRef
 * @returns {Promise<Blob>}
 */
export const makeInvoicePdf = (element) => html2pdf()
  .set({
    margin: 5,
    image: { type: 'png' },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
  })
  .from(element)
  .outputPdf('blob');

/**
 * 청구서 양식. 월 청구 화면은 숨겨 두고 PDF로 캡처하고, 청구서 보관함은 화면에 그대로 보여 준다.
 * 엑셀로 쓰던 청구서 양식(결제금액 내역 / 청구내역 / 상세내역 / 차량 표)을 그대로 옮겼다.
 */
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
  const details = [
    ['고객명', name],
    ['거래은행', company?.bank?.bankName || '-'],
    ['계좌번호', company?.bank?.accountNo || '-'],
    ['납입회차', `${round?.no || '-'} 회`],
    ['출금일', ymd(round?.dueDate)]
  ];

  return (
    <div ref={innerRef} style={{ width: '780px', padding: '28px', background: '#fff', color: '#111', fontFamily: "'Malgun Gothic', sans-serif" }}>
      <div style={{ fontSize: '20px', fontWeight: 800, marginBottom: '16px' }}>{name}</div>

      <div style={{ background: '#8a8a8a', color: '#fff', padding: '5px 10px', fontWeight: 700, fontSize: '12px' }}>결제금액 내역</div>
      <div style={{ textAlign: 'right', fontSize: '18px', fontWeight: 800, margin: '10px 0' }}>
        {Number(total || 0).toLocaleString()} 원
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
            <th style={head}>월 렌트료</th>
            <th style={head}>인도일</th>
          </tr>
        </thead>
        <tbody>
          {(vehicles || []).map((v, i) => (
            <tr key={v._id}>
              <td style={{ ...cell, textAlign: 'center' }}>{i + 1}</td>
              <td style={{ ...cell, textAlign: 'center' }}>{v.plateNo || v.code || '-'}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{v.monthlyFee ? Number(v.monthlyFee).toLocaleString() : '-'}</td>
              <td style={{ ...cell, textAlign: 'center' }}>{ymd(v.deliveryDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: '28px', borderTop: '2px solid #333', paddingTop: '10px', fontSize: '11px', color: '#444' }}>
        <div style={{ fontWeight: 800, fontSize: '13px', color: '#111' }}>(주)렌트베네핏</div>
        <div>서울시 서초구 양재대로 11길 36, 은관 505호 (양재동, 서울오토갤러리)</div>
        <div>대표이사 신동일 | 사업자번호 422-88-02467 &nbsp;&nbsp; T. 02-547-0303 &nbsp; F. 02-529-3303</div>
      </div>
    </div>
  );
}
