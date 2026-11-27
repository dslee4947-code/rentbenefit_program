import { useState } from 'react';
import { Copy } from 'lucide-react';
import MoneyInput from './MoneyInput.jsx';
import { insuranceRequestDefaults, buildInsuranceRequest } from './insuranceRequest.js';

/**
 * 출고 준비 > 보험 가입 > 보험방에 보낼 요청 문구.
 *
 * 차량 정보로 칸을 채워 두고, 고칠 것만 고친 뒤 [문구 복사]로 카카오톡 보험방에 붙여 넣는다.
 * 차대번호·등록일은 위 '차량 등록' 칸에 적은 값을 그대로 따라간다(두 군데 적지 않게).
 */
function InsuranceRequestBox({ vehicle, form, showToast }) {
  const [fields, setFields] = useState(() => insuranceRequestDefaults(vehicle, form));
  // 다른 차량을 열면 부르는 쪽이 key로 새로 만든다(칸을 새 차량 값으로 다시 채운다)
  const [totalTouched, setTotalTouched] = useState(false);

  const set = (key, value) => setFields((prev) => {
    const next = { ...prev, [key]: value };
    // 총가격은 고치기 전까지 기본금액 + 옵션금액으로 따라간다
    if (!totalTouched && (key === 'basePrice' || key === 'optionPrice')) {
      next.totalPrice = (Number(next.basePrice) || 0) + (Number(next.optionPrice) || 0) || '';
    }
    return next;
  });

  const text = buildInsuranceRequest({ ...fields, vin: form.vin || fields.vin, registrationDate: form.registrationDate || fields.registrationDate });
  const missing = [
    !(form.vin || fields.vin) && '차대번호',
    !(form.registrationDate || fields.registrationDate) && '등록일',
    !Number(fields.totalPrice) && '총가격'
  ].filter(Boolean);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      showToast?.('보험 가입 요청 문구를 복사했습니다. 보험방에 붙여 넣으세요.', 'success');
    } catch {
      showToast?.('복사하지 못했습니다. 아래 글을 직접 골라 복사해 주세요.', 'error');
    }
  };

  const label = { display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.15rem' };
  const input = { width: '100%', padding: '0.4rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.82rem', boxSizing: 'border-box' };
  const cell = (key, title, opts = {}) => (
    <div style={opts.wide ? { gridColumn: '1 / -1' } : undefined}>
      <label style={label}>{title}</label>
      {opts.money ? (
        <MoneyInput
          value={fields[key]}
          onChange={(e) => { if (key === 'totalPrice') setTotalTouched(true); set(key, e.target.value); }}
          style={input}
        />
      ) : (
        <input value={fields[key]} onChange={(e) => set(key, e.target.value)} style={input} placeholder={opts.placeholder} />
      )}
    </div>
  );

  return (
    <details style={{ marginTop: '0.8rem', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.6rem 0.8rem', background: '#fff' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 800, fontSize: '0.85rem', color: 'var(--primary)' }}>
        보험방 가입 요청 문구 만들기
        {missing.length > 0 && <span style={{ marginLeft: '0.5rem', color: '#b45309', fontSize: '0.75rem' }}>· 비어 있음: {missing.join(', ')}</span>}
      </summary>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.5rem 0.7rem', marginTop: '0.7rem' }}>
        {cell('customerName', '고객명')}
        {cell('carModel', '차종', { wide: true })}
        {cell('basePrice', '차량기본금액', { money: true })}
        {cell('optionPrice', '옵션금액(옵션+파츠+색상)', { money: true })}
        {cell('totalPrice', '총가격', { money: true })}
        {cell('options', '옵션', { wide: true })}
        {cell('exteriorColor', '외장')}
        {cell('interiorColor', '내장')}
        {cell('driverAge', '운전 연령', { placeholder: '만 26세 이상' })}
        {cell('propertyLimit', '대물', { placeholder: '5억' })}
        {cell('personalInjury', '자기신체사고', { placeholder: '2억/3,000만' })}
        {cell('uninsuredInjury', '무보험차상해', { placeholder: '2억' })}
        {cell('driverRange', '운전자 범위', { placeholder: '임직원' })}
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
        차대번호·등록일은 위 '차량 등록' 칸의 값을 씁니다. 여기서 고친 값은 문구에만 들어가고 차량 DB에는 저장되지 않습니다.
      </div>

      <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.6rem 0.8rem', fontSize: '0.8rem', lineHeight: 1.55, margin: '0.6rem 0', fontFamily: 'inherit' }}>
        {text}
      </pre>
      <button
        type="button"
        onClick={copy}
        style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: '#FEE500', color: '#191919', border: 'none', padding: '0.5rem 1rem', borderRadius: '8px', fontWeight: 800, fontSize: '0.85rem', cursor: 'pointer' }}
      >
        <Copy size={15} /> 문구 복사 (보험방에 붙여 넣기)
      </button>
    </details>
  );
}

export default InsuranceRequestBox;
