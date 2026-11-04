import { DEPOSIT_ACCOUNT } from './InvoiceSheet.jsx';
import { A4Page } from './EndDocParts.jsx';
import { num } from '../../utils/endDocStyle.js';
import companyLogo from '../../assets/deposit-notice/company-logo.png';
import carLogo from '../../assets/deposit-notice/car-logo.png';
import bankbook from '../../assets/deposit-notice/bankbook.jpg';

/**
 * 보증금·선수금 안내문.
 *
 * 전자계약서 엑셀의 '보증금 안내문' 시트 모양 그대로다(회사 정보, 통장 사본, 계좌, 금액).
 * 시트에 없던 임차인·차량 줄을 넣었다. 메일로 받는 고객이 어느 계약의 돈인지 알아야 한다.
 * 금액 칸은 받을 돈만 보여 준다.
 */

const RULE = '1px solid #d0d0d0';
const label = { width: '15%', background: '#ececec', fontWeight: 700, textAlign: 'center', borderBottom: RULE, padding: '9px 6px' };
const value = { borderBottom: RULE, padding: '9px 14px' };
const tableStyle = { width: '100%', borderCollapse: 'collapse', borderTop: '2px solid #8c8c8c', fontSize: '15px' };

const Rows = ({ rows }) => (
  <table style={tableStyle}>
    <tbody>
      {rows.map(([name, text, strong]) => (
        <tr key={name}>
          <td style={label}>{name}</td>
          <td style={{ ...value, ...(strong ? { fontWeight: 800, fontSize: '17px' } : {}) }}>{text}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

/**
 * @param {{ item: { partyName: string, vehicles: Array<{plateNo: string, carModel: string}>, deposit: number, advancePayment: number, label: string }, innerRef?: any }} props
 */
export default function DepositNoticeSheet({ item, innerRef }) {
  if (!item) return null;
  const both = item.deposit > 0 && item.advancePayment > 0;
  const cars = item.vehicles.map((v) => [v.carModel, v.plateNo].filter(Boolean).join(' ')).join(', ');
  return (
    <div ref={innerRef} className="print-fit" style={{ width: '794px', background: '#fff' }}>
      <A4Page padding="56px 60px" footer={false}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <img src={companyLogo} alt="렌트베네핏" style={{ width: '128px' }} />
          <div style={{ fontSize: '28px', fontWeight: 800, whiteSpace: 'nowrap' }}>장기렌터카 {item.label} 안내</div>
          <img src={carLogo} alt="RENT BENefit" style={{ width: '116px' }} />
        </div>

        <Rows rows={[
          ['법인명', '주식회사 렌트베네핏'],
          ['주소', '서울시 서초구 양재대로 11길 36'],
          ['연락처', '02-547-0303']
        ]} />

        <div style={{ border: '2px solid #8c8c8c', margin: '12px 0', textAlign: 'center', padding: '4px 0' }}>
          <img src={bankbook} alt="부산은행 통장 사본" style={{ width: '586px', display: 'block', margin: '0 auto' }} />
        </div>

        <Rows rows={[
          ['임차인', item.partyName],
          ...(cars ? [['차량', cars]] : []),
          ['은행', DEPOSIT_ACCOUNT.bankName],
          ['계좌번호', DEPOSIT_ACCOUNT.accountNo],
          ['예금주', '㈜렌트베네핏 신동일'],
          ...(item.deposit > 0 ? [['보증금', `${num(item.deposit)}원`, !both]] : []),
          ...(item.advancePayment > 0 ? [['선수금', `${num(item.advancePayment)}원`, !both]] : []),
          ...(both ? [['합계', `${num(item.deposit + item.advancePayment)}원`, true]] : [])
        ]} />
      </A4Page>
    </div>
  );
}
