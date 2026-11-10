import { useRef, useState } from 'react';
import { Search, Printer, Copy, FileText, X, CheckSquare } from 'lucide-react';
import { korDate, PAGE_W, LINE } from '../../utils/endDocStyle.js';
import { originOf } from '../../utils/contractEnd.js';
import { RETURN_CHECKLIST, defaultReturnGuide, returnGuideLines, returnGuideText } from '../../utils/returnGuide.js';
import { printFitted } from '../../utils/printFit.js';
import { A4Page, Band, DocHead, PairTable } from './EndDocParts.jsx';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);
// 안내문만 A4 한 장에 찍는다. 단기렌트 요금표와 같은 방식(메뉴·제목·버튼을 숨기고 안내문을 왼쪽 위에 놓는다)
const PRINT_CSS = `@media print {
  @page { size: A4 portrait; margin: 0 !important; }
  body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  aside, header, nav, footer, button, .no-print, body .desktop-sidebar, body .mobile-header { display: none !important; }
  main, body .main-content, body .admin-container { padding: 0 !important; margin: 0 !important; overflow: visible !important; background: #fff !important; }
  .return-guide-preview { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; overflow: visible !important;
    background: #fff !important; padding: 0 !important; margin: 0 !important; border: none !important; border-radius: 0 !important; }
}`;
const todayYmd = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

const EMPTY = {
  party: '', plateNo: '', carModel: '', endDate: '', returnAt: '', place: '', manager: '렌트베네핏 팀장 이두식 010-9061-3000',
  annualKm: '', origin: '국산', deposit: '', issueDate: todayYmd(), guide: null
};

/** 고객에게 보내는 반납 안내문(A4 한 장) */
function ReturnGuideSheet({ form, innerRef }) {
  const blank = (v) => (String(v ?? '').trim() ? v : '');
  const rows = [
    ['임차인명', blank(form.party), '차량번호', blank(form.plateNo)],
    ['차종', blank(form.carModel), '계약 종료일', korDate(form.endDate) || ''],
    ['반납 일시', blank(form.returnAt)],
    ['반납 장소', blank(form.place)],
    ['담당자', blank(form.manager)]
  ];
  const lines = returnGuideLines(form);
  return (
    <div ref={innerRef} className="print-fit" style={{ width: `${PAGE_W}px`, background: '#fff' }}>
      <A4Page padding="46px 52px">
        <DocHead title="차량 반납 안내" sub="장기렌트 계약 만기에 따른 차량 반납 절차를 안내해 드립니다." issueDate={form.issueDate} />
        <Band top={8}>1.  반납 정보</Band>
        <PairTable label="16%" value="34%" rows={rows} />

        <Band top={22}>2.  반납 전 안내 사항</Band>
        <div style={{ border: LINE, borderTop: 'none', padding: '16px 18px 14px', fontSize: '14px', lineHeight: 1.6 }}>
          {lines.map((t, i) => (
            <div key={i} style={{ marginBottom: i === lines.length - 1 ? 0 : '11px' }}>{i + 1}. {t}</div>
          ))}
        </div>

        <div style={{ marginTop: '18px', fontSize: '14px', lineHeight: 1.6, color: '#333' }}>
          반납 일정이나 장소를 바꾸셔야 하면 담당자 또는 렌트베네핏(☎ 02-547-0303)으로 연락 주시기 바랍니다. 그동안 렌트베네핏을 이용해 주셔서 감사합니다.
        </div>
      </A4Page>
    </div>
  );
}

/**
 * 만기 반납 전 고객 안내문과 직원 체크리스트(대표님 2026-11-10).
 * 계약을 찾으면 고객·차량·종료일·약정 주행거리·보증금을 채운다. 메일은 보내지 않는다(문구 복사·인쇄·PDF만).
 */
export default function ReturnGuideView({ showToast }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [checked, setChecked] = useState({});
  const sheetRef = useRef(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const search = async (e) => {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 2) { showToast?.('두 글자 이상 넣어 주세요.', 'error'); return; }
    const data = await fetch(`${API_HOST}/api/delivery-docs/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (!data?.success) { showToast?.(data?.message || '찾지 못했습니다.', 'error'); return; }
    setFound(data.items || []);
  };

  // 계약을 열면 차마다 한 줄씩 고를 수 있게 한다(여러 대 계약은 차마다 반납일이 다르다)
  const [contract, setContract] = useState(null);
  const openOne = async (contractId) => {
    const data = await fetch(`${API_HOST}/api/delivery-docs/${contractId}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (!data?.success) { showToast?.(data?.message || '계약을 불러오지 못했습니다.', 'error'); return; }
    setContract(data.data);
    setFound(null);
    pickCar(data.data, data.data.docs?.[0]);
  };
  const pickCar = (d, car) => {
    setChecked({});
    setForm((f) => ({
      ...EMPTY,
      manager: f.manager,
      issueDate: todayYmd(),
      party: d.party?.name || '',
      plateNo: car?.plateNo || '',
      carModel: car?.carModel || '',
      endDate: car?.endDate || '',
      annualKm: car?.mileage ? String(car.mileage) : '',
      origin: originOf(car?.carModel),
      deposit: car?.deposit ? String(car.deposit) : ''
    }));
  };

  const print = () => {
    const name = `차량반납안내_${form.party || '고객'}_${form.plateNo || ''}`.replace(/\s+/g, '');
    printFitted(sheetRef.current, { orientation: 'portrait', marginMm: 0, title: name });
  };
  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(returnGuideText(form));
      showToast?.('문자·카카오톡에 붙여 넣을 안내 문구를 복사했습니다.', 'success');
    } catch {
      showToast?.('복사하지 못했습니다. 브라우저가 클립보드를 막았는지 확인해 주세요.', 'error');
    }
  };

  const btn = (bg, color = '#fff') => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem', background: bg, color, border: bg === '#fff' ? '1px solid var(--border-color)' : 'none', borderRadius: '6px', padding: '0.5rem 0.8rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' });
  const input = { width: '100%', padding: '0.45rem 0.55rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.88rem', boxSizing: 'border-box' };
  const card = { background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1.2rem' };
  const label = { fontWeight: 700, marginBottom: '0.2rem', fontSize: '0.88rem' };

  const fields = [
    ['party', '임차인명', 'text'],
    ['plateNo', '차량번호', 'text'],
    ['carModel', '차종', 'text'],
    ['endDate', '계약 종료일', 'date'],
    ['returnAt', '반납 일시', 'text', '예: 2026년 11월 12일(목) 오후 2시'],
    ['place', '반납 장소', 'text'],
    ['manager', '담당자', 'text'],
    ['annualKm', '약정 주행거리(연, km)', 'text', '계약서 확인'],
    ['deposit', '보증금(원)', 'text', '없으면 비워 둠'],
    ['issueDate', '발행일', 'date']
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <style>{PRINT_CSS}</style>

      <div className="no-print" style={card}>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '0.6rem' }}>
          만기 반납을 앞둔 고객에게 보내는 <b>차량 반납 안내문</b>과 직원용 <b>반납 체크리스트</b>입니다.
          계약을 찾으면 고객·차량·종료일·약정 주행거리·보증금이 채워집니다. 안내문은 <b>[인쇄·PDF]</b>나 <b>[문자용 문구 복사]</b>로 보내고, 메일은 나가지 않습니다.
        </div>
        <form onSubmit={search} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="계약자(법인·고객) 이름 · 계약번호 · 차량번호" style={{ ...input, width: '320px', maxWidth: '100%' }} />
          <button type="submit" style={btn('var(--primary)')}><Search size={14} /> 찾기</button>
          {found && <button type="button" onClick={() => { setFound(null); setQuery(''); }} style={btn('#fff', 'var(--text-muted)')}>닫기</button>}
        </form>
        {found && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', marginTop: '0.7rem' }}>
            <tbody>
              {found.length === 0 && <tr><td style={{ padding: '0.8rem', color: 'var(--text-muted)' }}>찾은 계약이 없습니다.</td></tr>}
              {found.map((f) => (
                <tr key={f.contractId} style={{ borderTop: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '0.5rem' }}><b>{f.partyName}</b> <span style={{ color: 'var(--text-muted)' }}>{f.contractNo} · {f.contractStatus}</span></td>
                  <td style={{ padding: '0.5rem' }}>{(f.vehicles || []).map((v) => `${v.plateNo || '(번호 없음)'} ${v.carModel}`).join(', ') || '-'}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                    <button type="button" onClick={() => openOne(f.contractId)} style={btn('var(--primary)')}><FileText size={14} /> 열기</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="no-print" style={{ ...card, width: '340px', maxWidth: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.88rem' }}>
          {contract && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontWeight: 800 }}>{contract.party?.name}</div>
                <div style={{ color: 'var(--text-muted)' }}>{contract.contractNo}</div>
              </div>
              <button type="button" onClick={() => { setContract(null); setForm(EMPTY); setChecked({}); }} aria-label="닫기" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
          )}
          {contract?.docs?.length > 1 && (
            <label>
              <div style={label}>차량</div>
              <select value={form.plateNo} onChange={(e) => pickCar(contract, contract.docs.find((d) => d.plateNo === e.target.value))} style={input}>
                {contract.docs.map((d) => <option key={d.vehicleId} value={d.plateNo}>{d.plateNo || '(번호 없음)'} · {d.carModel}</option>)}
              </select>
            </label>
          )}

          {fields.map(([k, name, type, ph]) => (
            <label key={k}>
              <div style={label}>{name}</div>
              <input type={type} value={form[k] || ''} placeholder={ph} onChange={set(k)} style={input} />
            </label>
          ))}
          <label>
            <div style={label}>초과운행료 기준</div>
            <select value={form.origin} onChange={set('origin')} style={input}>
              <option value="국산">국산차 (1km당 100원)</option>
              <option value="외산">수입차 (1km당 200원)</option>
            </select>
          </label>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
              <span style={{ fontWeight: 700 }}>반납 전 안내 사항</span>
              {typeof form.guide === 'string' && (
                <button type="button" onClick={() => setForm((f) => ({ ...f, guide: null }))} style={{ border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', fontWeight: 700, padding: 0 }}>기본 문구로</button>
              )}
            </div>
            <textarea
              value={typeof form.guide === 'string' ? form.guide : defaultReturnGuide(form).join('\n')}
              onChange={(e) => setForm((f) => ({ ...f, guide: e.target.value }))}
              rows={12}
              style={{ ...input, resize: 'vertical', lineHeight: 1.5, fontFamily: 'inherit' }}
            />
            <div style={{ color: '#4b5563', marginTop: '0.2rem' }}>한 줄이 한 항목입니다. 번호는 저절로 붙습니다. 고치지 않으면 종료일·주행거리·보증금에 맞춰 문구가 바뀝니다.</div>
          </div>

          <button type="button" onClick={print} style={btn('var(--primary)')}><Printer size={14} /> 안내문 인쇄·PDF</button>
          <button type="button" onClick={copyText} style={btn('#fff', 'var(--text-main)')}><Copy size={14} /> 문자용 문구 복사</button>
        </div>

        <div className="return-guide-preview" style={{ flex: 1, minWidth: '300px', background: '#e5e7eb', borderRadius: '8px', padding: '0.8rem', overflowX: 'auto' }}>
          <ReturnGuideSheet form={form} innerRef={sheetRef} />
        </div>
      </div>

      <div className="no-print" style={card}>
        <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <CheckSquare size={18} /> 직원 반납 체크리스트 <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.85rem' }}>(화면에만 보이고 안내문에는 들어가지 않습니다)</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
          {RETURN_CHECKLIST.map((g) => (
            <div key={g.title}>
              <div style={{ fontWeight: 800, marginBottom: '0.4rem', color: 'var(--primary)' }}>{g.title}</div>
              {g.items.map((t) => {
                const key = `${g.title}|${t}`;
                return (
                  <label key={key} style={{ display: 'flex', gap: '0.45rem', alignItems: 'flex-start', marginBottom: '0.4rem', fontSize: '0.9rem', lineHeight: 1.5, cursor: 'pointer' }}>
                    <input type="checkbox" checked={!!checked[key]} onChange={() => setChecked((c) => ({ ...c, [key]: !c[key] }))} style={{ marginTop: '0.25rem' }} />
                    <span style={{ textDecoration: checked[key] ? 'line-through' : 'none', color: checked[key] ? 'var(--text-muted)' : 'inherit' }}>{t}</span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
