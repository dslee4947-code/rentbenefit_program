import React from 'react';
import { DEPOSIT_ACCOUNT } from './InvoiceSheet.jsx';
import { maturityTable } from '../../../../shared/maturityCompare.js';

const won = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');
// 안마다 머리 색: 연장 파랑 · 인수 초록 · 반납 주황
const TONE = { ext: '#1d4ed8', takeover: '#047857', return: '#b45309' };
const todayYmd = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const ymd = (v) => (v ? new Date(new Date(v).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) : '');

/**
 * 계약 만기 처리 비교표 한 장(A4). 1안 계약 연장 · 2안 인수 · 3안 반납(만기 반납)을 나란히 보여 준다.
 * 금액 계산은 shared/maturityCompare.js. 화면 모양 그대로 printFitted로 인쇄한다.
 *
 * @param {object} props
 *   car 견적 화면의 차·계약 정보, m compareMaturity 결과, ext 연장 안들 [{months, monthlyFee, takeoverPrice, maintenance, endDate}],
 *   thirdParty 제3자 인수, repairKnown 반납 수리비를 넣었는지, multiCar 한 계약에 차가 여러 대인지, createdBy 담당자
 */
export default function MaturityCompareSheet({ car, m, ext, thirdParty, repairKnown, multiCar, createdBy }) {
  const cellHead = { background: '#dcdcdc', padding: '5px 8px', fontWeight: '700', border: '1px solid #000', textAlign: 'center' };
  const cell = { padding: '5px 8px', border: '1px solid #000' };
  const col = { ...cell, width: '28%', verticalAlign: 'top', lineHeight: 1.55 };
  const head = (bg) => ({ ...cellHead, background: bg, color: '#fff', fontSize: '14.4px', padding: '7px 8px' });
  const rowHead = { ...cellHead, width: '16%', fontSize: '11.84px' };
  const muted = { fontSize: '11.2px', color: '#555' };
  const table = maturityTable({ m, ext, startDate: car.startDate, thirdParty, repairKnown });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '9.6px', borderBottom: '2.5px double #000', paddingBottom: '9.6px' }}>
        <div style={{ width: '150px' }}><span style={{ fontSize: '17.6px', fontWeight: '800', color: '#111e38' }}>(주)렌트베네핏</span></div>
        <h2 style={{ fontSize: '28.8px', fontWeight: '800', color: '#111e38', margin: 0, letterSpacing: '2px', flex: 1, textAlign: 'center' }}>계약 만기 안내</h2>
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '150px' }}><img src="/logo.png" alt="RENT BENefit" style={{ maxWidth: '120px', height: 'auto' }} /></div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '12.16px', marginBottom: '9.6px' }}>
        <tbody>
          <tr>
            <td style={{ ...cellHead, width: '13%' }}>고객명</td><td style={{ ...cell, width: '37%', fontWeight: '700' }}>{car.partyName || '-'} 귀하</td>
            <td style={{ ...cellHead, width: '13%' }}>작성일</td><td style={{ ...cell, textAlign: 'center' }}>{todayYmd()}</td>
          </tr>
          <tr>
            <td style={cellHead}>차량</td><td style={{ ...cell, fontWeight: '600' }}>{car.carModel || '-'} · {car.plateNo || '-'}</td>
            <td style={cellHead}>담당자</td><td style={{ ...cell, textAlign: 'center' }}>{createdBy} 팀장 · 02-547-0303 / 010-9061-3000</td>
          </tr>
          <tr>
            <td style={cellHead}>기존 계약</td>
            <td style={cell}>계약번호 {car.contractNo || '-'} · 월 렌트료 {won(car.currentMonthlyFee)}원</td>
            <td style={cellHead}>계약 만기</td><td style={{ ...cell, textAlign: 'center', fontWeight: '700', color: '#b91c1c' }}>{car.contractEnd || '-'}</td>
          </tr>
          <tr>
            <td style={cellHead}>보증금</td><td style={cell}>{won(m.deposit)}원</td>
            <td style={cellHead}>만기 인수가</td><td style={{ ...cell, textAlign: 'center' }}>{won(m.takeover.price)}원</td>
          </tr>
        </tbody>
      </table>

      <div style={{ fontSize: '12.8px', lineHeight: 1.6, marginBottom: '9.6px' }}>
        그동안 이용해 주셔서 감사합니다. 계약 만기에 고르실 수 있는 세 가지 방법과 각 금액을 정리해 드립니다.
        어느 방법을 선택하시더라도 아래 <b>잔여 렌트료</b>는 계약 기간까지 납부해 주셔야 합니다.
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '12.16px', marginBottom: '9.6px' }}>
        <thead>
          <tr><th colSpan={4} style={{ ...cellHead, textAlign: 'left' }}>잔여 렌트료 (세 방법 공통)</th></tr>
        </thead>
        <tbody>
          {m.remaining.length ? m.remaining.map((r) => (
            <tr key={r.no}>
              <td style={{ ...cell, width: '16%', textAlign: 'center' }}>{r.no}회차</td>
              <td style={{ ...cell, width: '24%', textAlign: 'center' }}>{ymd(r.dueDate)} 결제</td>
              <td style={{ ...cell, color: '#555' }}>{r.status === '미납' ? '미납' : r.status === '청구됨' ? '청구서 발송' : '결제 예정'}{r.no === m.lastNo ? ' · 마지막 회차' : ''}{r.fine ? ` · 통행료·과태료 ${won(r.fine)}원 포함` : ''}</td>
              <td style={{ ...cell, width: '20%', textAlign: 'right', fontWeight: '700' }}>{won(r.amount)}원</td>
            </tr>
          )) : (
            <tr><td colSpan={4} style={{ ...cell, textAlign: 'center', color: '#555' }}>잔여 렌트료가 없습니다.</td></tr>
          )}
          <tr>
            <td colSpan={3} style={{ ...cell, textAlign: 'right', fontWeight: '700', background: '#f5f5f5' }}>합계</td>
            <td style={{ ...cell, textAlign: 'right', fontWeight: '800', background: '#f5f5f5' }}>{won(m.remainingSum)}원</td>
          </tr>
        </tbody>
      </table>

      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1.5px solid #000', fontSize: '12.16px', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ ...cellHead, width: '16%' }}>구분</th>
            {table.cols.map((c, i) => <th key={i} style={head(TONE[c.kind])}>{c.title}</th>)}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, ri) => (
            <React.Fragment key={r.label}>
              {r.section === 'settle' && table.rows[ri - 1]?.section !== 'settle' && (
                <tr><td colSpan={table.cols.length + 1} style={{ ...cellHead, background: '#fde68a', textAlign: 'left' }}>만기 정산</td></tr>
              )}
              <tr style={r.section === 'settle' ? { background: '#fffbeb' } : undefined}>
                <td style={rowHead}>{r.label}{r.labelNote ? <div style={{ fontSize: '10.4px', fontWeight: '500', color: '#6b7280' }}>{r.labelNote}</div> : null}</td>
                {r.cells.map((v, i) => (
                  <td key={i} style={{ ...cell, textAlign: 'center', verticalAlign: 'middle', fontWeight: r.section === 'settle' && v !== '없음' ? '800' : '500',
                    color: v === '없음' || v === '-' ? '#9ca3af' : r.label === '보증금 반환' ? '#047857' : '#111' }}>
                    {v}
                    {r.notes?.[i] ? <div style={{ fontSize: '10.4px', fontWeight: '500', color: '#6b7280' }}>{r.notes[i]}</div> : null}
                  </td>
                ))}
              </tr>
            </React.Fragment>
          ))}
          <tr>
            <td style={rowHead}>알아 두실 점</td>
            {table.cols.map((c, i) => (
              <td key={i} style={{ ...col, ...muted }}>
                {c.kind === 'ext' && '연장 계약서를 새로 쓰고, 연장 1회차부터 새 렌트료로 청구됩니다.'}
                {c.kind === 'takeover' && `렌트 종료일부터 1주일 안에 입금과 이전 서류(양도증명서·인감증명서 등)를 마쳐야 합니다.${thirdParty ? ' 제3자 인수는 약관에 따라 승계 수수료가 붙습니다.' : ''}`}
                {c.kind === 'return' && `반납 시 외관 상태(긁힘·찌그러짐·파손 등)를 확인하며, 수리비가 발생하면 보증금에서 공제한 뒤 반환합니다.${repairKnown ? '' : ' 수리비는 반납 후 확정됩니다.'}`}
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      <div style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid #000', fontSize: '11.52px', lineHeight: 1.7, color: '#333' }}>
        <div>• 입금 계좌: {DEPOSIT_ACCOUNT.bankName} {DEPOSIT_ACCOUNT.accountNo} (예금주 {DEPOSIT_ACCOUNT.holder})</div>
        <div>• 잔여 렌트료는 회차 결제일에 CMS로 출금됩니다. 인수 금액을 한 번에 입금하시면 해당 회차 CMS 출금은 하지 않습니다.</div>
        {multiCar ? <div>• 이 계약은 차량이 여러 대로, 잔여 렌트료는 계약 전체 금액입니다.</div> : null}
        <div>• 위 금액은 작성일 기준이며, 이후 통행료·과태료 고지서가 오면 달라질 수 있습니다.</div>
        <div>• 문의: {createdBy} 팀장 02-547-0303 / 010-9061-3000 · rent@sdibenefit.com</div>
      </div>
    </>
  );
}
