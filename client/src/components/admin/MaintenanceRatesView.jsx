import React, { useEffect, useMemo, useState } from 'react';
import { Save, RotateCcw } from 'lucide-react';
import { toCommaString, parseNumber } from '../../utils/format.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

/**
 * 차종 등급별 정비 단가표.
 *
 * 견적서의 정비 원가는 "항목별 1회 단가 × 계약 기간 동안 하는 횟수"로 나온다. 이 화면에서 등급마다 1회 단가와
 * 타이어 1본 가격을 정한다. 새로 내는 견적부터 이 값을 쓰고, 이미 낸 견적은 그때 단가가 견적서에 남아 있어 바뀌지 않는다.
 * 렌트차량 DB 이익(견적서가 없는 차)은 다음 계산부터 새 단가를 쓴다.
 *
 * 각 등급의 '근거'에는 이 값이 어디서 나왔는지 적는다. 근거가 없으면 나중에 맞는 값인지 검토할 수 없다.
 */
function MaintenanceRatesView({ showToast, currentUser }) {
  const [data, setData] = useState(null);
  const [rates, setRates] = useState(null);
  const [saving, setSaving] = useState(false);
  const canEdit = currentUser?.role === 'admin';

  useEffect(() => {
    fetch(`${API_HOST}/api/settings/maintenance-rates`)
      .then((res) => res.json())
      .then((d) => {
        if (!d.success) throw new Error(d.message || '단가표를 불러오지 못했습니다.');
        setData(d);
        setRates(d.rates);
      })
      .catch((err) => showToast(err.message, 'error'));
  }, [showToast]);

  const changed = useMemo(() => data && rates && JSON.stringify(rates) !== JSON.stringify(data.rates), [data, rates]);

  if (!data || !rates) return <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>정비 단가표를 불러오는 중…</div>;

  const setItem = (grade, key, value) => setRates((prev) => ({
    ...prev,
    grades: { ...prev.grades, [grade]: { ...prev.grades[grade], items: { ...prev.grades[grade].items, [key]: parseNumber(value) } } }
  }));
  const setTire = (grade, kind, value) => setRates((prev) => ({
    ...prev,
    grades: { ...prev.grades, [grade]: { ...prev.grades[grade], tire: { ...prev.grades[grade].tire, [kind]: parseNumber(value) } } }
  }));
  const setBasis = (grade, value) => setRates((prev) => ({
    ...prev,
    grades: { ...prev.grades, [grade]: { ...prev.grades[grade], basis: value } }
  }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_HOST}/api/settings/maintenance-rates`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates })
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message || '저장하지 못했습니다.');
      setData((prev) => ({ ...prev, rates: d.rates, updatedAt: d.updatedAt, updatedBy: d.updatedBy }));
      setRates(d.rates);
      showToast(d.message, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const cycleOf = (item, grade) => {
    const o = rates.grades[grade]?.overrides?.[item.key] || {};
    if (item.basis === 'km') return `${((o.cycleKm || item.cycleKm) / 10000).toLocaleString()}만km`;
    return `${o.cycleMonths || item.cycleMonths}개월`;
  };

  const th = { padding: '0.55rem 0.6rem', fontSize: '0.78rem', fontWeight: '800', background: 'var(--bg-main)', borderBottom: '2px solid var(--border-color)', whiteSpace: 'nowrap' };
  const td = { padding: '0.35rem 0.5rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.8rem', verticalAlign: 'middle' };
  const input = { width: '92px', padding: '0.3rem 0.4rem', border: '1px solid var(--border-color)', borderRadius: '5px', textAlign: 'right', fontSize: '0.8rem', fontWeight: '600' };
  const grades = data.grades;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1.1rem', fontSize: '0.82rem', lineHeight: 1.7 }}>
        <div>견적의 정비 원가 = <b>항목별 1회 단가 × 계약 기간 동안 하는 횟수</b> (주행거리·개월 수로 셈) + <b>타이어 1본 가격 × 본수</b>(5만km마다 4본) + <b>얼라이먼트 × 교체 횟수</b>.</div>
        <div>새로 내는 견적부터 이 값을 씁니다. 이미 낸 견적은 그때 단가가 견적서에 함께 저장돼 있어 숫자가 바뀌지 않습니다.</div>
        <div style={{ color: 'var(--text-muted)' }}>
          지금 단가표: {rates.version || '-'}{data.updatedAt ? ` · 마지막 저장 ${new Date(data.updatedAt).toLocaleString('ko-KR')} ${data.updatedBy || ''}` : ' · 아직 저장한 적 없음(기본값)'}
        </div>
      </div>

      {canEdit && (
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={() => { if (window.confirm('기본값(근거 포함 초기값)으로 되돌릴까요? 저장을 눌러야 반영됩니다.')) setRates(JSON.parse(JSON.stringify({ ...data.defaults, version: data.defaults.version }))); }}
            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.5rem 0.9rem', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-surface)', fontWeight: '600', cursor: 'pointer' }}
          >
            <RotateCcw size={15} /> 기본값으로
          </button>
          <button
            type="button"
            disabled={!changed || saving}
            onClick={save}
            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.5rem 1.1rem', border: 'none', borderRadius: '8px', background: changed ? 'var(--primary)' : '#cbd5e1', color: '#fff', fontWeight: '700', cursor: changed ? 'pointer' : 'default' }}
          >
            <Save size={15} /> {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      )}

      <div style={{ overflowX: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>항목</th>
              <th style={{ ...th, textAlign: 'left' }}>주기</th>
              {grades.map((g) => <th key={g.key} style={{ ...th, textAlign: 'right' }} title={g.examples}>{g.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.key}>
                <td style={{ ...td, fontWeight: '700' }} title={item.desc}>{item.name}</td>
                <td style={{ ...td, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{item.basis === 'km' ? `${(item.cycleKm / 10000).toLocaleString()}만km마다` : `${item.cycleMonths}개월마다`}</td>
                {grades.map((g) => (
                  <td key={g.key} style={{ ...td, textAlign: 'right' }} title={`${g.label} 주기: ${cycleOf(item, g.key)}`}>
                    <input
                      style={input}
                      disabled={!canEdit}
                      value={toCommaString(rates.grades[g.key].items[item.key])}
                      onChange={(e) => setItem(g.key, item.key, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
            {[['standard', '타이어 1본 (표준)', '5만km마다 4본'], ['premium', '타이어 1본 (프리미엄)', '5만km마다 4본'], ['alignment', '얼라이먼트 (1회)', '타이어 교체 때마다']].map(([kind, label, cycle]) => (
              <tr key={kind} style={{ background: '#fbfcfe' }}>
                <td style={{ ...td, fontWeight: '700' }}>{label}</td>
                <td style={{ ...td, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{cycle}</td>
                {grades.map((g) => (
                  <td key={g.key} style={{ ...td, textAlign: 'right' }}>
                    <input
                      style={input}
                      disabled={!canEdit}
                      value={toCommaString(rates.grades[g.key].tire[kind])}
                      onChange={(e) => setTire(g.key, kind, e.target.value)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1.1rem' }}>
        <div style={{ fontWeight: '800', fontSize: '0.88rem', marginBottom: '0.5rem' }}>등급별 근거</div>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {grades.map((g) => (
            <label key={g.key} style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '0.6rem', alignItems: 'start', fontSize: '0.8rem' }}>
              <span style={{ fontWeight: '700', paddingTop: '0.35rem' }}>{g.label}<div style={{ fontWeight: '400', color: 'var(--text-muted)', fontSize: '0.72rem' }}>{g.examples}</div></span>
              <textarea
                rows={2}
                disabled={!canEdit}
                value={rates.grades[g.key].basis || ''}
                onChange={(e) => setBasis(g.key, e.target.value)}
                placeholder="이 등급 단가의 출처(단가표 이름, 업체, 날짜)"
                style={{ width: '100%', padding: '0.4rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.78rem', fontFamily: 'inherit', resize: 'vertical' }}
              />
            </label>
          ))}
        </div>
        <div style={{ marginTop: '0.7rem', fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          참고 자료: {(rates.sources || []).join(' · ')}
        </div>
      </div>
    </div>
  );
}

export default MaintenanceRatesView;
