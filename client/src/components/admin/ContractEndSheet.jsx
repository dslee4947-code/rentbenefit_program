/**
 * 계약종료 확인서.
 *
 * 내용은 Dropbox "09.중도해지/중도해지 위약금_260220.xlsx"의 '계약종료 확인서' 시트(대표님 2026-11-03),
 * 디자인은 "중도해지_정산서261104.xlsx"를 따른다(대표님 2026-11-04, EndDocParts.jsx).
 * 정산이 끝난 고객에게 보낸다. 종료 구분(중도해지 · 만기 후 인수 · 만기 후 반납)에 따라 날짜 칸 이름과 안내 문구만 바뀐다.
 */

import { END_KINDS, endNoticeLines } from '../../utils/contractEnd.js';
import { LINE, NAVY, PAGE_W, headCell, korDate, tableStyle, valueCell } from '../../utils/endDocStyle.js';
import { A4Page, Band, DocHead, PairTable, SealLine } from './EndDocParts.jsx';

const blank = (v) => (v === undefined || v === null || String(v).trim() === '' ? '' : v);
const termText = (months) => {
  const n = Number(months) || 0;
  if (!n) return '';
  return n % 12 === 0 ? `${n / 12}년` : `${n}개월`;
};

/**
 * @param {{ data: object, form: { kind: 'early'|'takeover'|'return', endDate: string, pickupAddress: string, phone: string, issueDate: string, notice?: string|null }, innerRef?: any }} props
 *   data = 서버 buildDeliveryDocs 결과(docs는 고른 차만)
 */
export default function ContractEndSheet({ data, form, innerRef }) {
  if (!data) return null;
  const type = END_KINDS[form.kind] || END_KINDS.return;
  const docs = data.docs || [];
  const plates = docs.map((d) => d.plateNo).filter(Boolean).join(', ');
  const models = [...new Set(docs.map((d) => d.carModel).filter(Boolean))].join(', ');
  const infoRows = [
    ['임차인명', blank(data.party.name), '차량번호', plates],
    ['차종', models, type.dateLabel, blank(form.endDate)],
    ...(type.pickup ? [['차량회수지(주소)', blank(form.pickupAddress)]] : []),
    ['연락처', blank(form.phone)]
  ];
  const lines = endNoticeLines(form);

  return (
    <div ref={innerRef} className="print-fit" style={{ width: `${PAGE_W}px`, background: '#fff' }}>
      <A4Page padding="46px 52px" footer={false}>
        <DocHead title="렌터카 계약종료 확인서" sub="렌트베네핏과의 장기렌트 계약이 종료되었음을 확인합니다." issueDate={form.issueDate} />

        <Band top={8}>1.  임차인 정보</Band>
        <PairTable label="19%" value="31%" rows={infoRows} />
        <div style={{ fontSize: '11px', color: '#595959', marginTop: '4px' }}>* 기타(사용자)와 임차인 정보가 다를 시 계약자의 위임여부 확인 필요</div>

        <Band top={24}>2.  계약 종료 안내</Band>
        <div style={{ border: LINE, borderTop: 'none', padding: '18px 18px 16px', fontSize: '14px', lineHeight: 1.6 }}>
          {lines.map((t, i) => (
            <div key={i} style={{ marginBottom: i === lines.length - 1 ? 0 : '14px' }}>{i + 1}. {t}</div>
          ))}
        </div>

        <Band top={24}>3.  계약내용</Band>
        <table style={tableStyle}>
          <thead>
            <tr>{['계약내용', '계약일자', '만료일자', '계약기간', '종료 구분'].map((h) => <th key={h} style={headCell}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.vehicleId}>
                <td style={valueCell}>장기렌트{docs.length > 1 ? ` (${d.plateNo})` : ''}</td>
                <td style={valueCell}>{blank(d.deliveryDate)}</td>
                <td style={valueCell}>{blank(d.endDate)}</td>
                <td style={valueCell}>{termText(d.termMonths)}</td>
                <td style={{ ...valueCell, fontWeight: 700 }}>{type.label}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ textAlign: 'center', marginTop: '70px', fontSize: '19px', fontWeight: 800, color: NAVY }}>{korDate(form.issueDate)}</div>
        <div style={{ marginTop: '28px' }}><SealLine size={19} /></div>
      </A4Page>
    </div>
  );
}
