import { useState, useEffect } from 'react';
import { formatCustomerName } from '../../utils/format.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

// 출고 준비·렌트차량 DB의 운전자(실운전자) 칸이 함께 쓴다(대표님 2026-11-18: 운전자는 고객 DB에 있는 사람으로 정한다)
/**
 * 고객 DB에서 사람을 찾아 이름과 연락처를 채우는 입력칸.
 *
 * 연락처가 저장된 고객만 후보로 보여 준다. 연락처가 없으면 출고 때 연락할 수 없어 쓸모가 없다.
 * 검색 결과에 없으면 직접 입력해도 그대로 저장된다.
 *
 * @param {string} label 칸 이름
 * @param {string} value 현재 이름
 * @param {(name: string, phone: string, customer: object) => void} onPick 고객을 고르면 이름·연락처와 고객 자료(이메일 등)를 넘긴다
 * @param {(name: string) => void} onType 직접 입력할 때
 */
export default function CustomerPicker({ label, value, onPick, onType, labelStyle, inputStyle, apiHost = API_HOST, placeholder = '이름 두 글자 이상 입력' }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  // 입력할 때마다 요청하지 않도록 잠시 기다렸다가 검색한다
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return undefined; // 짧으면 아래 shown이 빈 목록을 쓴다

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${apiHost}/api/customers?search=${encodeURIComponent(term)}&limit=30`);
        const data = await res.json();
        const withPhone = (data.customers || [])
          .map(c => ({ ...c, _phone: c.mobilePhone || c.contactPhone || '' }))
          .filter(c => c._phone.trim() !== '')
          .slice(0, 10);
        setResults(withPhone);
      } catch {
        setResults([]);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, apiHost]);

  const shown = query.trim().length >= 2 ? results : [];

  return (
    <div style={{ position: 'relative' }}>
      <label style={labelStyle}>{label}</label>
      <input
        value={open ? query : value}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQuery(e.target.value); onType(e.target.value); }}
        style={inputStyle}
        placeholder={placeholder}
      />
      {open && shown.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, minWidth: '300px', background: '#fff', border: '1px solid var(--border-color)', borderRadius: '6px', boxShadow: '0 6px 18px rgba(0,0,0,0.12)', zIndex: 10, maxHeight: '210px', overflowY: 'auto' }}>
          {shown.map(c => (
            <div
              key={c._id}
              onMouseDown={() => { onPick(formatCustomerName(c), c._phone, c); setQuery(''); setResults([]); setOpen(false); }}
              style={{ padding: '0.5rem 0.7rem', cursor: 'pointer', fontSize: '0.82rem', borderBottom: '1px solid var(--border-color)' }}
            >
              <div style={{ fontWeight: '700', color: 'var(--text-bright)' }}>{formatCustomerName(c)}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{[c._phone, c.department || c.companyName, c.jobTitle].filter(Boolean).join(' · ')}</div>
            </div>
          ))}
        </div>
      )}
      {open && query.trim().length >= 2 && shown.length === 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '0.5rem 0.7rem', fontSize: '0.78rem', color: 'var(--text-muted)', zIndex: 10 }}>
          연락처가 저장된 고객 중 검색 결과가 없습니다.
        </div>
      )}
    </div>
  );
}
