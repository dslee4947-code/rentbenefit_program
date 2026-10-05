import React, { useEffect, useMemo, useState } from 'react';
import { Save, Plus, Trash2 } from 'lucide-react';
import { toCommaString, parseNumber } from '../../utils/format.js';
import { computeInternalRate } from '../../../../shared/companyFunding.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const EMPTY_LOAN = { lender: '', principal: 0, balance: 0, annualRate: 0, startDate: '', termMonths: 0, repayment: '원리금 균등', memo: '' };

/**
 * 회사 자금 · 내부 금리.
 *
 * 회사가 빌린 돈을 한 곳에 적어 두면, 대출 잔액으로 가중 평균한 금리가 '내부 금리'가 된다.
 * 손익 원장은 자기 대출이 없는 차(회사 돈으로 산 차)에 이 금리로 묶인 돈의 이자를 매겨, 차마다 같은 잣대로 손익을 본다.
 * 대출 금액·금리는 관리자만 본다.
 */
function CompanyFundingView({ showToast }) {
  const [loaded, setLoaded] = useState(null);
  const [loans, setLoans] = useState([]);
  const [manualRate, setManualRate] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${API_HOST}/api/settings/company-funding`)
      .then((res) => res.json())
      .then((d) => {
        if (!d.success) throw new Error(d.message || '회사 자금 목록을 불러오지 못했습니다.');
        setLoaded(d);
        setLoans((d.funding?.loans || []).map((l) => ({ ...l, startDate: l.startDate ? String(l.startDate).slice(0, 10) : '' })));
        setManualRate(d.funding?.manualRate ? String(+(d.funding.manualRate * 100).toFixed(3)) : '');
      })
      .catch((err) => showToast(err.message, 'error'));
  }, [showToast]);

  // 화면에서 고치는 동안에도 내부 금리를 바로 보여 준다(서버와 같은 식)
  const preview = useMemo(
    () => computeInternalRate({ loans, manualRate: manualRate ? Number(manualRate) / 100 : null }),
    [loans, manualRate]
  );
  const totals = useMemo(() => loans.reduce((s, l) => ({
    principal: s.principal + (Number(l.principal) || 0),
    balance: s.balance + (Number(l.balance) || 0),
    yearlyInterest: s.yearlyInterest + (Number(l.balance) || Number(l.principal) || 0) * (Number(l.annualRate) || 0)
  }), { principal: 0, balance: 0, yearlyInterest: 0 }), [loans]);

  if (!loaded) return <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>회사 자금 목록을 불러오는 중…</div>;

  const setLoan = (i, field, value) => setLoans((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_HOST}/api/settings/company-funding`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ funding: { loans, manualRate: manualRate ? Number(manualRate) / 100 : null } })
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message || '저장하지 못했습니다.');
      setLoaded((prev) => ({ ...prev, ...d }));
      showToast(`${d.message} 내부 금리 연 ${(d.internalRate * 100).toFixed(2)}%`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const th = { padding: '0.5rem', fontSize: '0.76rem', fontWeight: '800', background: 'var(--bg-main)', borderBottom: '2px solid var(--border-color)', textAlign: 'left', whiteSpace: 'nowrap' };
  const td = { padding: '0.3rem 0.35rem', borderBottom: '1px solid var(--border-color)' };
  const inp = (w, right) => ({ width: w, padding: '0.3rem 0.4rem', border: '1px solid var(--border-color)', borderRadius: '5px', fontSize: '0.8rem', textAlign: right ? 'right' : 'left' });
  const sourceText = { manual: '직접 정한 금리', loans: '대출 잔액 가중 평균', default: '대출 목록이 없어 견적 기준 금리(6%)' }[preview.source];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1rem 1.2rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: '600' }}>내부 금리 (연)</div>
          <div style={{ fontSize: '1.6rem', fontWeight: '800', color: 'var(--primary)' }}>{(preview.rate * 100).toFixed(2)}%</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{sourceText}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: '600' }}>대출 잔액 합계</div>
          <div style={{ fontSize: '1.3rem', fontWeight: '800' }}>{toCommaString(totals.balance)}원</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>원금 합계 {toCommaString(totals.principal)}원</div>
        </div>
        <div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: '600' }}>1년 이자 (잔액 기준 추정)</div>
          <div style={{ fontSize: '1.3rem', fontWeight: '800' }}>{toCommaString(totals.yearlyInterest)}원</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>월 약 {toCommaString(totals.yearlyInterest / 12)}원</div>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', fontWeight: '600' }}>내부 금리 직접 정하기 (%, 비우면 자동)</span>
          <input style={inp('120px', true)} value={manualRate} placeholder="예: 5.8" onChange={(e) => setManualRate(e.target.value.replace(/[^0-9.]/g, ''))} />
        </label>
      </div>

      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.7, padding: '0 0.2rem' }}>
        손익 원장은 자기 대출이 없는 차(회사 돈으로 산 차)에 <b>묶인 돈 × 내부 금리</b>를 매달 이자로 매깁니다. 묶인 돈은 그때까지 나간 돈에서 들어온 돈을 뺀 금액입니다(보증금·대출·상환 줄은 뺌).
        캐피탈·렌공 대출로 산 차는 원장의 실제 할부이자를 씁니다.
      </div>

      <div style={{ overflowX: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              {['차용처', '원금', '현재 잔액', '금리(연 %)', '실행일', '기간(개월)', '상환 방식', '메모', ''].map((h) => <th key={h} style={th}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {loans.map((l, i) => (
              <tr key={i}>
                <td style={td}><input style={inp('130px')} value={l.lender} placeholder="예: 렌터카공제조합" onChange={(e) => setLoan(i, 'lender', e.target.value)} /></td>
                <td style={td}><input style={inp('120px', true)} value={toCommaString(l.principal)} onChange={(e) => setLoan(i, 'principal', parseNumber(e.target.value))} /></td>
                <td style={td}><input style={inp('120px', true)} value={toCommaString(l.balance)} onChange={(e) => setLoan(i, 'balance', parseNumber(e.target.value))} /></td>
                <td style={td}>
                  <input
                    style={inp('70px', true)}
                    defaultValue={l.annualRate ? String(+(l.annualRate * 100).toFixed(3)) : ''}
                    placeholder="5.5"
                    onChange={(e) => setLoan(i, 'annualRate', (Number(e.target.value.replace(/[^0-9.]/g, '')) || 0) / 100)}
                  />
                </td>
                <td style={td}><input type="date" style={inp('130px')} value={l.startDate || ''} onChange={(e) => setLoan(i, 'startDate', e.target.value)} /></td>
                <td style={td}><input style={inp('60px', true)} value={l.termMonths || ''} onChange={(e) => setLoan(i, 'termMonths', parseNumber(e.target.value))} /></td>
                <td style={td}>
                  <select style={inp('110px')} value={l.repayment || '원리금 균등'} onChange={(e) => setLoan(i, 'repayment', e.target.value)}>
                    {['원리금 균등', '원금 균등', '만기 일시', '한도(마이너스)'].map((r) => <option key={r}>{r}</option>)}
                  </select>
                </td>
                <td style={td}><input style={inp('150px')} value={l.memo || ''} placeholder="차량·담보 등" onChange={(e) => setLoan(i, 'memo', e.target.value)} /></td>
                <td style={td}>
                  <button type="button" onClick={() => setLoans((prev) => prev.filter((_, idx) => idx !== i))} title="이 대출 지우기" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#d9534f' }}>
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
            {loans.length === 0 && (
              <tr><td colSpan={9} style={{ ...td, color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0.8rem' }}>아직 입력한 대출이 없습니다. 지금은 견적 기준 금리 6%를 내부 금리로 씁니다.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'space-between' }}>
        <button type="button" onClick={() => setLoans((prev) => [...prev, { ...EMPTY_LOAN }])} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.5rem 0.9rem', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-surface)', fontWeight: '600', cursor: 'pointer' }}>
          <Plus size={15} /> 대출 추가
        </button>
        <button type="button" disabled={saving} onClick={save} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.5rem 1.1rem', border: 'none', borderRadius: '8px', background: 'var(--primary)', color: '#fff', fontWeight: '700', cursor: 'pointer' }}>
          <Save size={15} /> {saving ? '저장 중…' : '저장'}
        </button>
      </div>
    </div>
  );
}

export default CompanyFundingView;
