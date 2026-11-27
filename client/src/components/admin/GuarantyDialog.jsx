import { useRef } from 'react';
import { Printer, X } from 'lucide-react';
import { printFitted } from '../../utils/printFit.js';
import { PAGE_W, LINE, NAVY, RED, labelCell, valueCell, tableStyle, num } from '../../utils/endDocStyle.js';
import { A4Page, Band } from './EndDocParts.jsx';

/**
 * 연대보증서(대표님 2026-11-27).
 *
 * 장기렌트 계약서는 모두싸인 전자서명으로 법인만 서명하고, 대표 개인의 연대보증은 이 한 장을 종이로 받는다.
 * 민법 제428조의2: 보증은 보증인이 서명·기명날인한 서면이어야 하고 전자적 형태면 효력이 없다.
 * 민법 제428조의3: 계속 거래(렌트)의 보증은 보증 최고액을 서면으로 정해야 한다. 그래서 최고액을 꼭 적는다.
 * 계약서와는 계약번호·계약 내용으로 묶이고, 약관은 연대보증서를 계약서의 일부로 본다.
 *
 * 메일로 보내 고객이 출력 → 대표 자필 서명·개인 인감 → 인감증명서(또는 본인서명사실확인서)와 함께 원본을 돌려받는다.
 */

const DIGIT = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
const SMALL = ['', '십', '백', '천'];
const BIG = ['', '만', '억', '조'];
/** 16,400,000 → '일천육백사십만' */
export const koreanAmount = (n) => {
  let v = Math.floor(Number(n) || 0);
  if (!v) return '영';
  const groups = [];
  while (v > 0) { groups.push(v % 10000); v = Math.floor(v / 10000); }
  return groups.map((g, gi) => {
    if (!g) return '';
    const s = String(g).padStart(4, '0').split('').map((d, i) => (d === '0' ? '' : `${DIGIT[d]}${SMALL[3 - i]}`)).join('');
    return `${s}${BIG[gi]}`;
  }).reverse().join('');
};

const toNum = (s) => Number(String(s ?? '').replace(/[^0-9]/g, '')) || 0;
const kDate = (d) => {
  if (!d) return '';
  const x = new Date(new Date(d).getTime() + 9 * 3600e3);
  return `${x.getUTCFullYear()}년 ${x.getUTCMonth() + 1}월 ${x.getUTCDate()}일`;
};

/** 보증 최고액 기본값: 월 렌트료 × 계약 개월 수(렌트료 총액). 미납·위약금·이자가 이 안에 들어온다. 만 원 단위로 올린다 */
export const defaultGuarantyMax = (values) => {
  const total = toNum(values?.monthlyFee) * toNum(values?.termMonths);
  return total ? Math.ceil(total / 10000) * 10000 : 0;
};

const PRINT_CSS = `@media print {
  @page { size: A4 portrait; margin: 0 !important; }
  body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  aside, header, nav, footer, button, .no-print, body .desktop-sidebar, body .mobile-header { display: none !important; }
  main, body .main-content, body .admin-container { padding: 0 !important; margin: 0 !important; overflow: visible !important; background: #fff !important; }
  .guaranty-overlay { position: absolute !important; inset: auto !important; left: 0 !important; top: 0 !important; background: #fff !important; padding: 0 !important; display: block !important; overflow: visible !important; }
  .guaranty-paper { position: absolute !important; left: 0 !important; top: 0 !important; box-shadow: none !important; margin: 0 !important; }
}`;

const blankLine = (w) => <span style={{ display: 'inline-block', width: w, borderBottom: '1px solid #444', height: '18px', verticalAlign: 'bottom' }} />;

function GuarantySheet({ info, max, guarantor, innerRef }) {
  const contractRows = [
    ['계약번호', info.contractNo, '계약일', kDate(info.contractDate)],
    ['임차인(상호)', info.partyName, '등록번호', [info.bizNo, info.corpRegNo].filter(Boolean).join(' / ')],
    ['차종', info.carModel, '차량번호', info.plateNo],
    ['계약기간', info.termMonths ? `${info.termMonths}개월${info.period ? ` (${info.period})` : ''}` : '', '월 렌트료', info.monthlyFee ? `${num(toNum(info.monthlyFee))}원 (VAT 포함)` : '']
  ];
  const p = { fontSize: '13px', lineHeight: 1.75, margin: '6px 0', textAlign: 'justify' };
  return (
    <div ref={innerRef} className="print-fit guaranty-paper" style={{ width: `${PAGE_W}px`, background: '#fff' }}>
      <A4Page padding="44px 52px">
        <div style={{ textAlign: 'center', color: NAVY, fontSize: '30px', fontWeight: 800, letterSpacing: '14px', margin: '4px 0 4px' }}>연대보증서</div>
        <div style={{ textAlign: 'center', color: '#808080', fontSize: '12px', marginBottom: '14px' }}>자동차(장기) 임대차 계약 · 계약번호 {info.contractNo}</div>

        <Band top={0}>1. 보증하는 계약</Band>
        <table style={tableStyle}>
          <colgroup><col style={{ width: '15%' }} /><col style={{ width: '35%' }} /><col style={{ width: '15%' }} /><col style={{ width: '35%' }} /></colgroup>
          <tbody>
            {contractRows.map((r) => (
              <tr key={r[0]}>
                <td style={labelCell}>{r[0]}</td><td style={valueCell}>{r[1] || ''}</td>
                <td style={labelCell}>{r[2]}</td><td style={valueCell}>{r[3] || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <Band>2. 보증 내용</Band>
        <p style={p}>
          보증인은 위 계약(임대차 계약 약관과 부속 약정을 포함합니다)에 따라 임차인이 주식회사 렌트베네핏(이하 &ldquo;회사&rdquo;)에 부담하는
          렌트료, 연체이자, 중도해지 위약금, 손해배상금, 차량 반환 지연에 따른 대여료, 범칙금·과태료 등 대납금 및 그 밖의 일체의 채무를
          아래 보증 최고액 범위에서 임차인과 연대하여 보증합니다.
        </p>

        <Band>3. 보증 최고액 · 보증 기간</Band>
        <table style={tableStyle}>
          <colgroup><col style={{ width: '18%' }} /><col style={{ width: '82%' }} /></colgroup>
          <tbody>
            <tr>
              <td style={labelCell}>보증 최고액</td>
              <td style={{ ...valueCell, textAlign: 'left', fontWeight: 800, fontSize: '14px', color: RED }}>
                금 {koreanAmount(max)}원정 (₩{num(max)})
              </td>
            </tr>
            <tr>
              <td style={labelCell}>보증인 자필 기재</td>
              <td style={{ ...valueCell, textAlign: 'left', height: '36px' }}>
                금 {blankLine('300px')} 원정 <span style={{ color: '#808080', fontSize: '11px' }}>(위 최고액을 보증인이 직접 씁니다)</span>
              </td>
            </tr>
            <tr>
              <td style={labelCell}>보증 기간</td>
              <td style={{ ...valueCell, textAlign: 'left' }}>위 계약 체결일부터 계약이 끝나고(중도해지 포함) 차량 반환과 정산이 모두 끝날 때까지</td>
            </tr>
          </tbody>
        </table>

        <Band>4. 확인 사항</Band>
        <p style={{ ...p, fontSize: '12.5px', lineHeight: 1.7 }}>
          ① 보증인은 위 계약의 내용과 임대차 계약 약관을 충분히 설명 듣고 이해하였으며, 본인의 의사로 이 보증서에 서명·날인합니다.<br />
          ② 이 보증서는 위 계약서의 일부이며(계약 약관: 연대보증서는 계약서의 일부로 봅니다), 계약이 연장되거나 조건이 바뀌는 경우
          그 내용은 보증인에게 알리고 새로 보증서를 받습니다.<br />
          ③ 보증인의 주소·연락처가 바뀌면 지체 없이 회사에 알립니다.
        </p>

        <div style={{ textAlign: 'center', fontSize: '14px', margin: '14px 0 10px' }}>
          20{blankLine('40px')}년 {blankLine('36px')}월 {blankLine('36px')}일
        </div>

        <Band>5. 연대보증인</Band>
        <table style={tableStyle}>
          <colgroup><col style={{ width: '16%' }} /><col style={{ width: '34%' }} /><col style={{ width: '16%' }} /><col style={{ width: '34%' }} /></colgroup>
          <tbody>
            <tr>
              <td style={labelCell}>성명</td>
              <td style={{ ...valueCell, height: '40px', fontWeight: 700, fontSize: '14px' }}>{guarantor}</td>
              <td style={labelCell}>생년월일</td>
              <td style={{ ...valueCell, height: '40px' }} />
            </tr>
            <tr>
              <td style={labelCell}>주소</td>
              <td style={{ ...valueCell, height: '40px' }} colSpan={3} />
            </tr>
            <tr>
              <td style={labelCell}>연락처</td>
              <td style={{ ...valueCell, height: '40px' }} />
              <td style={labelCell}>임차인과의 관계</td>
              <td style={{ ...valueCell, height: '40px' }}>대표이사</td>
            </tr>
            <tr>
              <td style={labelCell}>자필 서명</td>
              <td style={{ ...valueCell, height: '64px' }} />
              <td style={labelCell}>개인 인감</td>
              <td style={{ ...valueCell, height: '64px', textAlign: 'right', color: '#999' }}>(인)</td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: '11.5px', color: '#555', marginTop: '6px', lineHeight: 1.6 }}>
          ※ 첨부: 보증인 <b>인감증명서</b>(최근 3개월, 본인 발급) 1통 또는 <b>본인서명사실확인서</b> 1통 · 법인 인감이 아닌 <b>대표 개인 인감</b>을 찍습니다.<br />
          ※ 원본을 회사로 보내 주세요(스캔본만으로는 접수되지 않습니다).
        </div>

        <div style={{ textAlign: 'right', fontSize: '15px', fontWeight: 800, color: NAVY, marginTop: '14px', borderTop: LINE, paddingTop: '8px' }}>
          주식회사 렌트베네핏 귀중
        </div>
      </A4Page>
    </div>
  );
}

/**
 * @param {{ doc: object, values: object, locked: boolean, onChange: (key: string, v: string) => void, onClose: () => void }} props
 *   값은 계약서 칸(values)에서 읽고, 보증인·최고액을 고치면 계약서 칸 guarantorName·guarantyMax로 남긴다([저장]으로 저장).
 */
export default function GuarantyDialog({ doc, values, locked, onChange, onClose }) {
  const sheetRef = useRef(null);
  const c = doc?.contract || {};
  const vehicles = Array.isArray(c.vehicles) ? c.vehicles.filter((v) => v && typeof v === 'object') : [];
  const plateNo = vehicles.map((v) => v.plateNo).filter(Boolean).join(', ') || c.vehicle?.plateNo || '';
  const dot = (d) => { const x = new Date(new Date(d).getTime() + 9 * 3600e3); return `${x.getUTCFullYear()}.${String(x.getUTCMonth() + 1).padStart(2, '0')}.${String(x.getUTCDate()).padStart(2, '0')}`; };
  const period = c.rentStartDate && c.endDate ? `${dot(c.rentStartDate)} ~ ${dot(c.endDate)}` : '';
  const info = {
    contractNo: values.contractNo || c.contractNo || '',
    contractDate: c.contractDate || doc?.documentDate,
    partyName: values.partyName || '',
    bizNo: values.bizNo || '',
    corpRegNo: values.corpRegNo || '',
    carModel: values.carModel || '',
    plateNo,
    termMonths: values.termMonths || c.termMonths || '',
    period,
    monthlyFee: values.monthlyFee || ''
  };
  const guarantor = values.guarantorName ?? values.ceoName ?? '';
  const auto = defaultGuarantyMax({ ...values, termMonths: info.termMonths });
  const max = toNum(values.guarantyMax) || auto;

  const print = () => printFitted(sheetRef.current, { orientation: 'portrait', marginMm: 0, title: `연대보증서_${info.partyName}_${info.contractNo}` });
  const field = { width: '100%', padding: '0.4rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: '0.85rem', boxSizing: 'border-box' };

  return (
    <div className="guaranty-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, overflow: 'auto', padding: '2rem 1rem', display: 'flex', gap: '1rem', justifyContent: 'center', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <style>{PRINT_CSS}</style>
      <div className="no-print" style={{ width: 320, maxWidth: '100%', background: '#fff', borderRadius: 10, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.7rem', fontSize: '0.85rem' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <b style={{ fontSize: '1rem' }}>연대보증서</b>
          <button type="button" onClick={onClose} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <label>
          <div style={{ fontWeight: 700, marginBottom: 3 }}>연대보증인 (대표 개인)</div>
          <input value={guarantor} disabled={locked} onChange={(e) => onChange('guarantorName', e.target.value)} style={field} />
        </label>
        <label>
          <div style={{ fontWeight: 700, marginBottom: 3 }}>보증 최고액 (원)</div>
          <input value={num(max)} disabled={locked} onChange={(e) => onChange('guarantyMax', String(toNum(e.target.value) || ''))} style={field} />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.5 }}>
            기본값: 월 렌트료 × 계약 {info.termMonths || '?'}개월 = {num(auto)}원(만 원 단위 올림). 이 금액이 없으면 보증이 무효라 꼭 적습니다.
          </div>
        </label>
        <button type="button" onClick={print} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', padding: '0.6rem', borderRadius: 8, border: 'none', background: '#0f172a', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
          <Printer size={15} /> 인쇄 / PDF 저장
        </button>
        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.65, background: '#f8fafc', borderRadius: 8, padding: '0.6rem' }}>
          <b>받는 방법</b><br />
          1. PDF로 저장해 고객에게 메일로 보냅니다.<br />
          2. 대표가 <b>자필 서명·최고액 자필 기재</b>, <b>개인 인감</b> 날인<br />
          3. <b>인감증명서</b>(또는 본인서명사실확인서)와 함께 <b>원본</b>을 등기·퀵으로 회수<br />
          4. 인감 대조, 대표에게 문자로 본인 날인 확인 후 계약서 폴더에 보관<br />
          고친 보증인·최고액은 계약서 [저장]을 눌러야 남습니다.
        </div>
      </div>
      <div style={{ boxShadow: '0 10px 30px rgba(0,0,0,0.25)' }}>
        <GuarantySheet info={info} max={max} guarantor={guarantor} innerRef={sheetRef} />
      </div>
    </div>
  );
}
