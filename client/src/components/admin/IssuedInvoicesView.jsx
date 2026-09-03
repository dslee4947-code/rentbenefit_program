import { useState, useEffect, useCallback } from 'react';
import { Search, RefreshCw, Paperclip, Mail, FolderOpen } from 'lucide-react';
import { useTableSort } from './useTableSort.js';
import { SortableTh, SortControls } from './TableSort.jsx';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const won = (n) => (n || n === 0) ? `${Number(n).toLocaleString()}원` : '-';
const ymd = (d) => (d ? String(d).slice(0, 10) : '-');
const ymdhm = (d) => (d ? `${String(d).slice(0, 10)} ${String(d).slice(11, 16)}` : '-');

const STATUS_STYLE = {
  '예정': { bg: '#f1f5f9', color: '#475569' },
  '청구됨': { bg: '#e0f2fe', color: '#0284c7' },
  '입금완료': { bg: '#dcfce7', color: '#16a34a' },
  '미납': { bg: '#fee2e2', color: '#ef4444' }
};

/** 이번 달 1일. 기본 조회 범위는 이번 달로 둔다(매달 보내는 것이라 그게 가장 흔한 조회다). */
const firstOfThisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};

/**
 * 발행 이력.
 *
 * 발행 기록은 회차표(BillingSchedule)에 이미 다 들어 있어 따로 컬렉션을 두지 않는다.
 * 같은 내용을 두 곳에 저장하면 한쪽만 고쳐져 금액이 갈린다.
 */
function IssuedInvoicesView({ showToast }) {
  const [from, setFrom] = useState(firstOfThisMonth());
  const [to, setTo] = useState('');
  const [keyword, setKeyword] = useState('');
  const [data, setData] = useState({ items: [], count: 0, sentCount: 0, totalAmount: 0 });
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(false);

  // 발행 이력에서 정렬할 수 있는 항목
  const ISSUED_COLUMNS = [
    { key: 'partyName', label: '계약자', sortValue: (it) => it.partyName },
    { key: 'contractNo', label: '계약번호', sortValue: (it) => it.contractNo },
    { key: 'no', label: '회차', numeric: true, sortValue: (it) => it.no },
    { key: 'dueDate', label: '출금일', numeric: true, sortValue: (it) => it.dueDate },
    { key: 'total', label: '청구액', numeric: true, sortValue: (it) => it.total },
    { key: 'issuedAt', label: '발행일시', numeric: true, sortValue: (it) => it.issuedAt },
    { key: 'sentAt', label: '메일 발송', numeric: true, sortValue: (it) => it.sentAt },
    { key: 'invoiceFileName', label: '청구서 파일', sortValue: (it) => it.invoiceFileName },
    { key: 'status', label: '상태', sortValue: (it) => it.status }
  ];
  const filteredItems = (data.items || []).filter(
    (it) => statusFilter === 'all' || it.status === statusFilter
  );
  const sort = useTableSort(filteredItems, ISSUED_COLUMNS);
  const rows = sort.rows;

  const fetchIssued = useCallback(async () => {
    try {
      setLoading(true);
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      if (keyword.trim()) qs.set('keyword', keyword.trim());
      const res = await fetch(`${API_HOST}/api/billing-schedules/issued?${qs}`);
      const json = await res.json();
      if (json.success) setData(json);
      else showToast?.(json.message || '발행 이력을 불러오지 못했습니다.', 'error');
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  }, [from, to, keyword, showToast]);

  useEffect(() => { fetchIssued(); }, [fetchIssued]);

  const inputStyle = { padding: '0.45rem 0.6rem', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '0.85rem' };
  const th = { padding: '0.7rem', textAlign: 'left', whiteSpace: 'nowrap' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Search size={16} style={{ color: 'var(--primary)' }} />
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={inputStyle} title="발행일 시작" />
        <span style={{ color: 'var(--text-muted)' }}>~</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={inputStyle} title="발행일 끝 (비우면 오늘까지)" />
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="계약자 / 계약번호"
          style={{ ...inputStyle, width: '180px' }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ ...inputStyle, background: '#fff', cursor: 'pointer' }}
        >
          <option value="all">전체 상태</option>
          {Object.keys(STATUS_STYLE).map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
        <SortControls
          sort={sort}
          selectStyle={{ padding: '0.45rem 0.6rem', fontSize: '0.85rem', borderRadius: '6px' }}
          defaultLabel="정렬 안 함 (최근 발행순)"
          show={sort.active || statusFilter !== 'all' || Boolean(keyword)}
          onReset={() => { setStatusFilter('all'); setKeyword(''); }}
        />
        <button
          type="button"
          onClick={fetchIssued}
          style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', padding: '0.4rem 0.7rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer' }}
        >
          <RefreshCw size={13} /> 새로고침
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap' }}>
        {[
          ['발행 건수', `${data.count}건`],
          ['메일 발송', `${data.sentCount}건`],
          ['청구 합계', won(data.totalAmount)]
        ].map(([label, value]) => (
          <div key={label} style={{ background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.8rem 1.2rem', minWidth: '150px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600' }}>{label}</div>
            <div style={{ fontSize: '1.15rem', fontWeight: '800', color: 'var(--text-bright)', marginTop: '0.2rem' }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-bright)', fontWeight: '700' }}>
              <SortableTh sort={sort} columnKey="partyName" style={th}>계약자</SortableTh>
              <SortableTh sort={sort} columnKey="no" style={{ ...th, textAlign: 'center' }}>회차</SortableTh>
              <SortableTh sort={sort} columnKey="dueDate" style={{ ...th, textAlign: 'center' }}>출금일</SortableTh>
              <SortableTh sort={sort} columnKey="total" style={{ ...th, textAlign: 'right' }}>청구액</SortableTh>
              <SortableTh sort={sort} columnKey="issuedAt" style={{ ...th, textAlign: 'center' }}>발행</SortableTh>
              <SortableTh sort={sort} columnKey="sentAt" style={{ ...th, textAlign: 'center' }}>메일</SortableTh>
              <SortableTh sort={sort} columnKey="invoiceFileName" style={th}>청구서 파일</SortableTh>
              <SortableTh sort={sort} columnKey="status" style={{ ...th, textAlign: 'center' }}>상태</SortableTh>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>불러오는 중...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                {data.items.length ? '조건에 맞는 청구서가 없습니다.' : '이 기간에 발행한 청구서가 없습니다.'}
              </td></tr>
            ) : rows.map((it) => {
              const st = STATUS_STYLE[it.status] || STATUS_STYLE['예정'];
              return (
                <tr key={`${it.scheduleId}-${it.no}`} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '0.7rem' }}>
                    <div style={{ fontWeight: '700' }}>{it.partyName || '-'}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{it.contractNo}</div>
                  </td>
                  <td style={{ padding: '0.7rem', textAlign: 'center' }}>{it.no} / {it.totalRounds}</td>
                  <td style={{ padding: '0.7rem', textAlign: 'center' }}>{ymd(it.dueDate)}</td>
                  <td style={{ padding: '0.7rem', textAlign: 'right', fontWeight: '700' }}>{won(it.total)}</td>
                  <td style={{ padding: '0.7rem', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{ymdhm(it.issuedAt)}</td>
                  <td style={{ padding: '0.7rem', textAlign: 'center' }}>
                    {it.sentAt
                      ? <span title={ymdhm(it.sentAt)} style={{ color: '#16a34a', display: 'inline-flex' }}><Mail size={15} /></span>
                      : <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>미발송</span>}
                  </td>
                  <td style={{ padding: '0.7rem', maxWidth: '320px' }}>
                    <div
                      title={it.invoiceSavedPath || ''}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      <FolderOpen size={13} style={{ color: 'var(--primary)', flexShrink: 0 }} />
                      {it.invoiceFileName || '-'}
                    </div>
                    {it.attachments.length > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                        <Paperclip size={12} />
                        {it.attachments.map((a) => `${a.kind}${a.amount ? ` ${Number(a.amount).toLocaleString()}` : ''}`).join(', ')}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '0.7rem', textAlign: 'center' }}>
                    <span style={{ background: st.bg, color: st.color, padding: '0.2rem 0.6rem', borderRadius: '20px', fontSize: '0.75rem', fontWeight: '700' }}>
                      {it.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        청구서 파일은 <strong>RENT\{'{'}계약자{'}'}\02.청구서\{'{'}계약번호{'}'}</strong> 폴더에 있습니다. 파일 이름에 마우스를 올리면 전체 경로가 보입니다.
      </div>
    </div>
  );
}

export default IssuedInvoicesView;
