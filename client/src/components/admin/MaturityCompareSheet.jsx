import { DEPOSIT_ACCOUNT } from './InvoiceSheet.jsx';
import { settleLabel } from '../../../../shared/maturityCompare.js';

const won = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');
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
            <th style={head('#1d4ed8')}>1안 계약 연장</th>
            <th style={head('#047857')}>2안 인수</th>
            <th style={head('#b45309')}>3안 반납</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={rowHead}>내용</td>
            <td style={col}>같은 차를 계속 이용합니다.<br />연장 시작 {car.startDate || '-'}</td>
            <td style={col}>{thirdParty ? <>고객님이 정하신 분(<b>제3자</b>) 명의로 차를 넘겨 드립니다.</> : '차를 고객님 명의로 넘겨 드립니다.'}</td>
            <td style={col}>만기에 차를 돌려주시고 계약을 마칩니다.</td>
          </tr>
          <tr>
            <td style={rowHead}>보증금</td>
            <td style={col}>연장 계약으로 그대로 승계</td>
            <td style={col}>인수가에서 차감</td>
            <td style={col}>차량 확인 후 반환</td>
          </tr>
          <tr>
            <td style={rowHead}>이후 비용</td>
            <td style={col}>
              {ext.length ? ext.map((o, i) => (
                <div key={i} style={{ marginBottom: '3px' }}>
                  <b>{o.months}개월</b> 월 <b>{won(o.monthlyFee)}원</b>
                  <div style={muted}>{o.endDate ? `${o.endDate}까지 · ` : ''}정비 {o.maintenance ? '포함' : '미포함'}{o.takeoverPrice > 0 ? ` · 만기 인수가 ${won(o.takeoverPrice)}원` : ''}</div>
                </div>
              )) : <span style={muted}>연장 견적을 넣으면 여기에 나옵니다.</span>}
            </td>
            <td style={col}>
              인수가 {won(m.takeover.price)}원<br />
              − 보증금 {won(m.deposit)}원<br />
              {thirdParty ? <>+ 승계 수수료 {won(m.takeover.fee)}원<br /></> : null}
              = <b>{m.takeover.pay >= 0 ? `인수 금액 ${won(m.takeover.pay)}원` : `보증금 차액 반환 ${won(-m.takeover.pay)}원`}</b>
            </td>
            <td style={col}>
              보증금 {won(m.deposit)}원<br />
              {repairKnown ? <>− 수리비 {won(m.return.repair)}원<br /></> : null}
              = <b>보증금 반환 {won(m.return.depositBack)}원</b>
            </td>
          </tr>
          <tr style={{ background: '#fffbeb' }}>
            <td style={{ ...rowHead, background: '#fde68a' }}>만기 정산<div style={{ fontSize: '10.4px', fontWeight: 500 }}>잔여 렌트료 포함</div></td>
            {[['extension', m.extension.settle], ['takeover', m.takeover.settle], ['return', m.return.settle]].map(([kind, n]) => {
              const l = settleLabel(n, kind);
              return (
                <td key={kind} style={{ ...col, textAlign: 'center', verticalAlign: 'middle', color: n < 0 ? '#047857' : '#111e38' }}>
                  <div style={{ fontSize: '11.84px', fontWeight: '700' }}>{l.title}</div>
                  {l.amount ? <div style={{ fontSize: '15.2px', fontWeight: '800' }}>{won(l.amount)}원</div> : null}
                </td>
              );
            })}
          </tr>
          <tr>
            <td style={rowHead}>알아 두실 점</td>
            <td style={{ ...col, ...muted }}>
              연장 계약서를 새로 쓰고, 연장 1회차부터 새 렌트료로 청구됩니다.
            </td>
            <td style={{ ...col, ...muted }}>
              렌트 종료일부터 1주일 안에 입금과 이전 서류(양도증명서·인감증명서 등)를 마쳐야 합니다.
              {thirdParty ? ' 제3자 인수는 약관에 따라 승계 수수료가 붙습니다.' : ''}
            </td>
            <td style={{ ...col, ...muted }}>
              반납 시 외관 상태(긁힘·찌그러짐·파손 등)를 확인하며, 수리비가 발생하면 보증금에서 공제한 뒤 반환합니다.
              {repairKnown ? '' : ' 수리비는 반납 후 확정됩니다.'}
            </td>
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
