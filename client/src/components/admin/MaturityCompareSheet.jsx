import React from 'react';
import { DEPOSIT_ACCOUNT } from './InvoiceSheet.jsx';
import { maturityTable } from '../../../../shared/maturityCompare.js';

const won = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');
const todayYmd = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const ymd = (v) => (v ? new Date(new Date(v).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) : '');

// 비교 견적서와 같은 남색·금색 톤(대표님 2026-11-17 "안마다 색이 유치하다, 고급지게")
const NAVY = '#111e38';
const GOLD = '#ad885c';
const LINE = '#e4dfd6';
const SOFT = '#f9f8f6';
const DIM = '#9a948a';

/**
 * 계약 만기 처리 비교표 한 장(A4). 1안 계약 연장 · 2안 인수 · 3안 반납(만기 반납)을 나란히 보여 준다.
 * 금액 계산과 줄 구성은 shared/maturityCompare.js(maturityTable). 화면 모양 그대로 printFitted로 인쇄한다.
 *
 * @param {object} props
 *   car 견적 화면의 차·계약 정보, m compareMaturity 결과, ext 연장 안들 [{months, monthlyFee, takeoverPrice, maintenance, endDate}],
 *   thirdParty 제3자 인수, repairKnown 반납 수리비를 넣었는지, multiCar 한 계약에 차가 여러 대인지, createdBy 담당자,
 *   tax 인수 시 취득세 계산용 차 정보(maturityTable 참고)
 */
export default function MaturityCompareSheet({ car, m, ext, thirdParty, repairKnown, multiCar, createdBy, tax }) {
  const table = maturityTable({ m, ext, startDate: car.startDate, thirdParty, repairKnown, tax });
  const frame = { width: '100%', borderCollapse: 'collapse', fontSize: '13.6px', borderTop: `2px solid ${NAVY}`, borderBottom: `2px solid ${NAVY}` };
  const label = { background: SOFT, color: '#2b2b2b', fontWeight: '700', padding: '8px 10px', borderBottom: `1px solid ${LINE}`, borderRight: `1px solid ${GOLD}`, textAlign: 'center', whiteSpace: 'nowrap' };
  const value = { padding: '8px 10px', borderBottom: `1px solid ${LINE}`, color: NAVY };
  const note = { fontSize: '11.84px', fontWeight: '500', color: '#5f5a51', marginTop: '2px', whiteSpace: 'pre-line' };
  const sectionTitle = (text, sub) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', margin: '14px 0 6px' }}>
      <span style={{ width: '3px', height: '13px', background: GOLD, display: 'inline-block', alignSelf: 'center' }} />
      <span style={{ fontSize: '15.2px', fontWeight: '800', color: NAVY }}>{text}</span>
      {sub ? <span style={{ fontSize: '12.48px', color: '#5f5a51' }}>{sub}</span> : null}
    </div>
  );
  // '1안 계약 연장' → 번호와 이름을 나눠 머리에 두 줄로
  const splitTitle = (t) => { const [no, ...rest] = t.split(' '); return { no, name: rest.join(' ') }; };

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingBottom: '10px', borderBottom: `2px solid ${GOLD}` }}>
        <div style={{ width: '170px' }}><span style={{ fontSize: '16.8px', fontWeight: '800', color: NAVY }}>(주)렌트베네핏</span></div>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontSize: '10.4px', fontWeight: '700', color: GOLD, letterSpacing: '3px' }}>CONTRACT MATURITY</div>
          <h2 style={{ fontSize: '27.2px', fontWeight: '800', color: NAVY, margin: '2px 0 0', letterSpacing: '4px' }}>계약 만기 안내</h2>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '170px' }}><img src="/logo.png" alt="RENT BENefit" style={{ maxWidth: '120px', height: 'auto' }} /></div>
      </div>

      <table style={{ ...frame, marginTop: '14px' }}>
        <tbody>
          <tr>
            <td style={{ ...label, width: '13%' }}>고객명</td><td style={{ ...value, width: '37%', fontWeight: '800' }}>{car.partyName || '-'} 귀하</td>
            <td style={{ ...label, width: '13%' }}>작성일</td><td style={value}>{todayYmd()}</td>
          </tr>
          <tr>
            <td style={label}>차량</td><td style={{ ...value, fontWeight: '700' }}>{car.carModel || '-'} · {car.plateNo || '-'}</td>
            <td style={label}>담당자</td><td style={value}>{createdBy} 팀장 · 02-547-0303 / 010-9061-3000</td>
          </tr>
          <tr>
            <td style={label}>기존 계약</td><td style={value}>계약번호 {car.contractNo || '-'} · 월 렌트료 {won(car.currentMonthlyFee)}원</td>
            <td style={label}>계약 만기</td><td style={{ ...value, fontWeight: '800' }}>{car.contractEnd || '-'}</td>
          </tr>
          <tr>
            <td style={label}>보증금</td><td style={value}>{won(m.deposit)}원</td>
            <td style={label}>만기 인수가</td><td style={value}>{won(m.takeover.price)}원</td>
          </tr>
        </tbody>
      </table>

      <div style={{ fontSize: '13.6px', lineHeight: 1.7, color: '#222', margin: '12px 2px 0' }}>
        그동안 이용해 주셔서 감사합니다. 계약 만기에 선택하실 수 있는 세 가지 방법과 각 금액을 정리해 드립니다.
        어느 방법을 선택하시더라도 아래 <b style={{ color: NAVY }}>잔여 렌트료</b>는 계약 기간까지 납부해 주셔야 합니다.
      </div>

      {sectionTitle('잔여 렌트료', '세 방법 공통')}
      <table style={frame}>
        <tbody>
          {m.remaining.length ? m.remaining.map((r) => (
            <tr key={r.no}>
              <td style={{ ...label, width: '16%' }}>{r.no}회차</td>
              <td style={{ ...value, width: '22%', textAlign: 'center' }}>{ymd(r.dueDate)} 결제</td>
              <td style={{ ...value, color: '#4a463f' }}>
                {r.status === '미납' ? '미납' : r.status === '청구됨' ? '청구서 발송' : '결제 예정'}{r.no === m.lastNo ? ' · 마지막 회차' : ''}
                {r.fine ? <div style={note}>통행료·과태료 {won(r.fine)}원 포함</div> : null}
              </td>
              <td style={{ ...value, width: '20%', textAlign: 'right', fontWeight: '800' }}>{won(r.amount)}원</td>
            </tr>
          )) : (
            <tr><td colSpan={4} style={{ ...value, textAlign: 'center', color: '#6b675f' }}>잔여 렌트료가 없습니다.</td></tr>
          )}
          {m.remaining.length > 1 && (
            <tr>
              <td colSpan={3} style={{ ...value, textAlign: 'right', fontWeight: '700', background: SOFT }}>합계</td>
              <td style={{ ...value, textAlign: 'right', fontWeight: '800', background: SOFT }}>{won(m.remainingSum)}원</td>
            </tr>
          )}
        </tbody>
      </table>

      {sectionTitle('만기 시 선택하실 수 있는 방법')}
      <table style={{ ...frame, tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ background: NAVY, color: '#fff', width: '16%', padding: '8px', fontWeight: '700', borderRight: `1px solid ${GOLD}`, borderBottom: `2px solid ${GOLD}` }}>구분</th>
            {table.cols.map((c, i) => {
              const t = splitTitle(c.title);
              return (
                <th key={i} style={{ background: NAVY, color: '#fff', padding: '7px 8px', borderRight: i < table.cols.length - 1 ? '1px solid rgba(173,136,92,0.5)' : 'none', borderBottom: `2px solid ${GOLD}` }}>
                  {/* 안 번호는 금색 배지로 눈에 띄게(대표님 2026-11-17 "1안·2안·3안을 더 잘 보이게") */}
                  <div style={{ display: 'inline-block', background: GOLD, color: '#fff', fontSize: '13.6px', fontWeight: '800', letterSpacing: '1px', padding: '1px 12px', borderRadius: '10px', marginBottom: '4px' }}>{t.no}</div>
                  <div style={{ fontSize: '15.2px', fontWeight: '800', letterSpacing: '1px' }}>{t.name}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, ri) => {
            const firstSettle = r.section === 'settle' && table.rows[ri - 1]?.section !== 'settle';
            // 결론 줄(만기 시 청구 비용): 이것만 봐도 얼마를 내는지 알 수 있게 크게(대표님 2026-11-18)
            if (r.section === 'total') {
              return (
                <tr key={r.label}>
                  <td style={{ ...label, background: NAVY, color: '#fff', fontWeight: '800', fontSize: '14.4px', borderTop: `2px solid ${GOLD}`, borderBottom: `2px solid ${GOLD}` }}>
                    {r.label}
                    {r.labelNote ? <div style={{ ...note, color: '#e6d6bf' }}>{r.labelNote}</div> : null}
                  </td>
                  {r.cells.map((v, i) => (
                    <td key={i} style={{ ...value, textAlign: 'center', verticalAlign: 'middle', background: '#f7f0e4', borderTop: `2px solid ${GOLD}`, borderBottom: `2px solid ${GOLD}`,
                      borderRight: i < r.cells.length - 1 ? `1px solid ${LINE}` : 'none', color: NAVY, fontWeight: '900', fontSize: '19.2px', padding: '10px 8px' }}>
                      {v}
                      {r.notes?.[i] ? <div style={{ ...note, fontWeight: '500' }}>{r.notes[i]}</div> : null}
                    </td>
                  ))}
                </tr>
              );
            }
            return (
              <React.Fragment key={r.label}>
                {firstSettle && (
                  <tr>
                    <td colSpan={table.cols.length + 1} style={{ padding: '7px 10px 5px', borderTop: `1.5px solid ${NAVY}`, borderBottom: `1px solid ${GOLD}`, color: NAVY, fontWeight: '800', fontSize: '13.6px', letterSpacing: '1px' }}>
                      만기 정산 <span style={{ fontWeight: '500', color: '#5f5a51', letterSpacing: 0, fontSize: '12.48px' }}>계약 만기 때 오가는 금액</span>
                    </td>
                  </tr>
                )}
                <tr>
                  <td style={label}>
                    {r.label}
                    {r.labelNote ? <div style={note}>{r.labelNote}</div> : null}
                  </td>
                  {r.cells.map((v, i) => {
                    const empty = v === '없음' || v === '-';
                    return (
                      <td key={i} style={{ ...value, textAlign: 'center', verticalAlign: 'middle', borderRight: i < r.cells.length - 1 ? `1px solid ${LINE}` : 'none',
                        color: empty ? DIM : NAVY, fontWeight: r.section === 'settle' && !empty ? '800' : '500' }}>
                        {v}
                        {r.notes?.[i] ? <div style={note}>{r.notes[i]}</div> : null}
                      </td>
                    );
                  })}
                </tr>
              </React.Fragment>
            );
          })}
          <tr>
            <td style={{ ...label, borderTop: `1.5px solid ${NAVY}` }}>비고</td>
            {table.cols.map((c, i) => (
              <td key={i} style={{ ...value, borderTop: `1.5px solid ${NAVY}`, borderRight: i < table.cols.length - 1 ? `1px solid ${LINE}` : 'none', verticalAlign: 'top', fontSize: '12.48px', lineHeight: 1.6, color: '#3d3a35' }}>
                {c.kind === 'ext' && '연장 계약서를 새로 쓰고, 연장 1회차부터 새 렌트료로 청구됩니다.'}
                {c.kind === 'takeover' && `렌트 종료일부터 1주일 안에 입금과 이전 서류(양도증명서·인감증명서 등)를 마쳐야 합니다.${thirdParty ? ' 제3자 인수는 약관에 따라 승계 수수료가 붙습니다.' : ''}`}
                {c.kind === 'return' && `반납 시 외관 상태(긁힘·찌그러짐·파손 등)를 확인하며, 수리비가 발생하면 보증금에서 공제한 뒤 반환합니다.${repairKnown ? '' : ' 수리비는 반납 후 확정됩니다.'}`}
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 'auto', paddingTop: '10px', borderTop: `1px solid ${GOLD}`, fontSize: '12.48px', lineHeight: 1.75, color: '#3d3a35' }}>
        <div>• 입금 계좌: {DEPOSIT_ACCOUNT.bankName} {DEPOSIT_ACCOUNT.accountNo} (예금주 {DEPOSIT_ACCOUNT.holder})</div>
        <div>• 잔여 렌트료는 회차 결제일에 CMS로 출금됩니다. 인수 금액을 한 번에 입금하시면 해당 회차 CMS 출금은 하지 않습니다.</div>
        {multiCar ? <div>• 이 계약은 차량이 여러 대로, 잔여 렌트료는 계약 전체 금액입니다.</div> : null}
        <div>• 위 금액은 작성일 기준이며, 이후 통행료·과태료 고지서가 오면 달라질 수 있습니다.</div>
        {tax ? <div>• 취득세는 인수하시는 분이 이전등록 때 구청에 납부합니다. 시가표준액 기준 예상액이며, 공채 매입·등록 대행료는 별도입니다.</div> : null}
        <div>• 문의: {createdBy} 팀장 02-547-0303 / 010-9061-3000 · rent@sdibenefit.com</div>
      </div>
    </>
  );
}
