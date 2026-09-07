import { useState, useEffect, useCallback } from 'react';
import { AlertCircle, RefreshCw, Search, X, Upload, CheckCircle2, Clock, FileWarning, Mail } from 'lucide-react';
import UpcomingDocUpload from './UpcomingDocUpload.jsx';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const won = (n) => (n || n === 0) ? `${Number(n).toLocaleString()}원` : '-';
const ymd = (d) => (d ? String(d).slice(0, 10) : '-');

// 고지서를 처리하는 세 갈래. 계약에 미리 정해 두고, 이 건만 다르면 그 자리에서 바꾼다.
const HANDLINGS = {
  대납청구: { label: '대납 후 청구', color: '#0284c7', hint: '우리가 먼저 내고 다음 청구서에 얹습니다' },
  고객납부: { label: '고객 직접 납부', color: '#d97706', hint: '담당자를 거쳐 운전자가 냅니다. 기한을 지켜봐야 합니다' },
  명의변경: { label: '명의 변경', color: '#7c3aed', hint: '관공서에 넘겨 고객에게 직접 고지되게 합니다' }
};

// 우리 손을 떠난 단계. 청구액에서 빠지고 더 챙길 일이 없다.
const DONE_STATUSES = ['납부완료', '변경완료', '고객납부'];

/**
 * 방식마다 다음에 눌러야 할 것이 다르다.
 *
 * 단계마다 버튼을 여러 개 늘어놓으면 무엇을 눌러야 할지 헷갈린다.
 * 지금 단계에서 할 일 하나만 보여 주고, 되돌리기는 따로 둔다.
 */
const NEXT_STEP = {
  대납청구: {
    접수: { to: '대납완료', label: '대납 완료', hint: '우리가 낸 것으로 표시합니다. 다음 청구서에 얹혀 나갑니다.' },
    안내: { to: '대납완료', label: '대납 완료', hint: '우리가 낸 것으로 표시합니다. 다음 청구서에 얹혀 나갑니다.' },
    기한초과: { to: '대납완료', label: '대납 완료', hint: '기한이 지났습니다. 우리가 내고 청구합니다.' }
  },
  고객납부: {
    접수: { to: '운전자확인', label: '운전자 확인', hint: '누가 운전했는지 확인했습니다.' },
    안내: { to: '운전자확인', label: '운전자 확인', hint: '누가 운전했는지 확인했습니다.' },
    운전자확인: { to: '납부완료', label: '납부 확인', hint: '고객이 직접 냈습니다. 청구액에서 뺍니다.' },
    기한초과: { to: '납부완료', label: '납부 확인', hint: '뒤늦게라도 고객이 냈으면 누르세요.' }
  },
  명의변경: {
    접수: { to: '운전자확인', label: '운전자 확인', hint: '누가 운전했는지 확인했습니다.' },
    안내: { to: '운전자확인', label: '운전자 확인', hint: '누가 운전했는지 확인했습니다.' },
    운전자확인: { to: '접수중', label: '관공서 접수', hint: '계약서와 고지서를 보냈습니다.' },
    접수중: { to: '변경완료', label: '변경 완료', hint: '명의가 넘어갔습니다. 청구액에서 뺍니다.' },
    기한초과: { to: '변경완료', label: '변경 완료', hint: '명의가 넘어갔으면 누르세요.' }
  }
};

const STATUS_STYLE = {
  접수: { bg: '#f1f5f9', color: '#475569' },
  안내: { bg: '#e0f2fe', color: '#0284c7' },
  운전자확인: { bg: '#fef3c7', color: '#d97706' },
  접수중: { bg: '#ede9fe', color: '#7c3aed' },
  대납완료: { bg: '#dbeafe', color: '#2563eb' },
  납부완료: { bg: '#dcfce7', color: '#16a34a' },
  변경완료: { bg: '#dcfce7', color: '#16a34a' },
  기한초과: { bg: '#fee2e2', color: '#ef4444' },
  청구예정: { bg: '#f1f5f9', color: '#475569' },
  고객납부: { bg: '#dcfce7', color: '#16a34a' }
};

/**
 * 거르기 기준.
 *
 * 아침에 이 화면을 열었을 때 손이 가야 할 순서대로 둔다.
 * 기한이 지난 것 → 이번 주 마감 → 기한을 못 읽어 추적이 안 되는 것 순이다.
 */
const FILTERS = [
  { key: 'unnotified', label: '안내 전', hint: '아직 고객에게 알리지 않은 건', color: '#0284c7' },
  { key: 'overdue', label: '기한 지남', hint: '이번 청구서에 얹혀 나갑니다', color: 'var(--error)' },
  { key: 'soon', label: '7일 내 마감', hint: '아직 안내할 시간이 있습니다', color: '#d97706' },
  { key: 'waiting', label: '납부 대기', hint: '기한이 남은 건 전부', color: 'var(--primary)' },
  { key: 'paid', label: '처리 완료', hint: '고객이 냈거나 명의가 넘어가 청구액에서 뺀 건', color: '#16a34a' },
  { key: 'nodue', label: '기한 미상', hint: '기한을 못 읽어 추적이 안 됩니다', color: '#7c3aed' },
  // 방식마다 손이 가는 곳이 달라 따로 모아 본다
  { key: '대납청구', label: '대납 후 청구', hint: '우리가 내고 청구할 건', color: '#0284c7' },
  { key: '고객납부처리', label: '고객 직접 납부', hint: '고객이 낼 건. 기한을 지켜봐야 합니다', color: '#d97706' },
  { key: '명의변경', label: '명의 변경', hint: '관공서에 넘길 건', color: '#7c3aed' }
];

const matchesFilter = (key, x) => {
  const done = DONE_STATUSES.includes(x.noticeStatus);
  switch (key) {
    case 'unnotified': return !done && !x.noticeMailSentAt;
    case 'overdue': return !done && x.dday !== null && x.dday < 0;
    case 'soon': return !done && x.dday !== null && x.dday >= 0 && x.dday <= 7;
    case 'waiting': return !done && x.dday !== null && x.dday >= 0;
    case 'paid': return done;
    case 'nodue': return !done && x.dday === null;
    case '대납청구':
    case '고객납부처리':
    case '명의변경':
      return !done && x.handling === (key === '고객납부처리' ? '고객납부' : key);
    default: return true;
  }
};

/** 납부기한까지 며칠 남았는지를 사람이 읽는 말로. */
const ddayLabel = (dday) => {
  if (dday === null) return '기한 미상';
  if (dday > 0) return `D-${dday}`;
  if (dday === 0) return '오늘까지';
  return `${-dday}일 지남`;
};

const ddayColor = (dday, paid) => {
  if (paid) return 'var(--text-muted)';
  if (dday === null) return '#7c3aed';
  if (dday < 0) return 'var(--error)';
  if (dday <= 3) return '#d97706';
  return 'var(--text-muted)';
};

/**
 * 범칙금 · 과태료 · 미납통행료 고지서 관리.
 *
 * 고지서는 매일 회사로 오고, 계약을 가로질러 쌓인다. 청구서 화면에서 계약을 하나씩 열어
 * 확인하게 하면 기한이 지난 건을 놓친다. 그래서 고지서만 모아 보는 자리를 따로 둔다.
 *
 * 여기서 하는 일은 하나다. "기한에 고객이 냈는지 확인하고 표시하는 것."
 * 냈으면 청구액에서 빠지고, 안 냈으면 그대로 다음 청구서에 얹혀 나간다.
 *
 * 장기렌트 계약에만 해당한다. 사고대차·단기렌트는 회차표가 없어 여기 뜨지 않는다.
 */
function FineNoticeView({ showToast, currentUser }) {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('unnotified'); // 고지서가 오면 알리는 것이 먼저다
  const [keyword, setKeyword] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [busy, setBusy] = useState(null); // 처리 중인 줄

  const fetchNotices = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_HOST}/api/billing-schedules/fine-notices`, { cache: 'no-store' });
      const data = await res.json();
      if (data.success) {
        setItems(data.items || []);
        setSummary(data.summary || {});
      } else {
        showToast?.(data.message || '고지서를 불러오지 못했습니다.', 'error');
      }
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchNotices(); }, [fetchNotices]);

  /**
   * 고객이 기한 안에 직접 냈는지 표시한다.
   *
   * 냈으면 청구액에서 빠지고 캘린더 일정도 닫힌다. 서류는 지우지 않는다.
   * 지우면 그 고지서가 있었다는 기록까지 사라져 나중에 되짚을 수 없다.
   */
  const setNoticeStatus = async (row, noticeStatus, extra = {}) => {
    if (currentUser?.role === 'viewer') {
      showToast?.('권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    const id = `${row.scheduleId}-${row.roundNo}-${row.index}`;
    try {
      setBusy(id);
      const res = await fetch(
        `${API_HOST}/api/billing-schedules/${row.scheduleId}/rounds/${row.roundNo}/attachments/${row.index}/notice-status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
          body: JSON.stringify({ noticeStatus, ...extra })
        }
      );
      const data = await res.json();
      showToast?.(data.message || (data.success ? '처리했습니다.' : '처리하지 못했습니다.'), data.success ? 'success' : 'error');
      if (data.success) await fetchNotices();
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setBusy(null);
    }
  };

  /**
   * 이 고지서만 다른 방식으로 처리한다.
   *
   * 방식은 계약에 정해 두지만 예외가 생긴다. 늘 대납하던 법인도 금액이 크면
   * 운전자에게 직접 물리기도 한다. 그럴 때 이 건만 바꾼다.
   */
  const setHandling = async (row, handling) => {
    if (handling === (row.handling || '대납청구')) return;
    // 방식마다 거치는 단계가 달라 처음으로 되돌린다. 진행하던 것이 있으면 먼저 묻는다.
    if (row.noticeStatus && row.noticeStatus !== '접수'
      && !window.confirm(`${row.plateNo} · ${row.kind}\n\n처리 방식을 ${HANDLINGS[handling]?.label}(으)로 바꾸면 진행 단계가 [접수]로 돌아갑니다. 바꿀까요?`)) return;
    await setNoticeStatus(row, '접수', { handling });
  };

  /**
   * 고객에게 안내 메일을 보낸다.
   *
   * 청구서에 얹기 전에 먼저 알린다. 기한 안에 직접 내면 청구하지 않는다는 것을
   * 고객이 알아야 그 선택을 할 수 있다.
   */
  const sendNotice = async (row, resend = false) => {
    if (currentUser?.role === 'viewer') {
      showToast?.('권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (resend && !window.confirm(`이미 보낸 고지서입니다.
${row.partyName} · ${row.plateNo} · ${row.kind}

다시 보낼까요?`)) return;

    // 명의 변경은 받는 곳이 고객이 아니라 관공서다. 계약마다 다르고 건마다 달라 그때 묻는다.
    let to;
    if (row.handling === '명의변경') {
      to = window.prompt(
        `${row.plateNo} · ${row.kind}\n\n어디로 보낼까요? (예: 서초경찰서 · 서초구청 담당자 메일)\n계약서 사본을 고지서와 함께 붙여 보냅니다.`,
        row.transferAgency && row.transferAgency.includes('@') ? row.transferAgency : (row.noticeMailTo || '')
      );
      if (to === null) return;
      to = to.trim();
      if (!to) {
        showToast?.('보낼 주소를 적어 주세요.', 'error');
        return;
      }
    }

    const id = `${row.scheduleId}-${row.roundNo}-${row.index}`;
    try {
      setBusy(id);
      const res = await fetch(
        `${API_HOST}/api/billing-schedules/${row.scheduleId}/rounds/${row.roundNo}/attachments/${row.index}/notify`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
          body: JSON.stringify({ resend, ...(to ? { to } : {}) })
        }
      );
      const data = await res.json();
      showToast?.(data.message || (data.success ? '보냈습니다.' : '보내지 못했습니다.'), data.success ? 'success' : 'error');
      // 계약서를 못 찾았으면 따로 알린다. 관공서는 계약서가 없으면 접수해 주지 않는다.
      if (data.warning) showToast?.(data.warning, 'error');
      if (data.success) await fetchNotices();
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const kw = keyword.trim().toLowerCase();
  const shown = items.filter((x) => {
    if (filter !== 'all' && !matchesFilter(filter, x)) return false;
    if (!kw) return true;
    return [x.partyName, x.plateNo, x.contractNo, x.noticeNo, x.kind]
      .some((v) => (v || '').toLowerCase().includes(kw));
  });
  const shownTotal = shown.reduce((sum, x) => sum + x.amount, 0);

  /**
   * 사람이 정해 줘야 할 건.
   *
   * 고객이 내기로 한 건은 기한이 지나도 자동으로 대납으로 넘기지 않는다.
   * 담당자가 늦게 회신하는 일이 잦아, 자동으로 넘기면 이미 낸 것을 또 청구하게 된다.
   * 그래서 알림만 띄우고 넘길지 말지는 사람이 누른다.
   */
  const needsDecision = items.filter((x) => (
    !DONE_STATUSES.includes(x.noticeStatus)
    && x.handling !== '대납청구'
    && x.dday !== null && x.dday <= 7
    && !x.issued
  ));

  const countOf = (key) => items.filter((x) => matchesFilter(key, x)).length;
  const sumOf = (key) => items.filter((x) => matchesFilter(key, x)).reduce((s, x) => s + x.amount, 0);

  const thStyle = { padding: '0.6rem 0.5rem', textAlign: 'left', fontWeight: '700', whiteSpace: 'nowrap' };
  const tdStyle = { padding: '0.55rem 0.5rem', verticalAlign: 'middle' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <FileWarning size={18} style={{ color: 'var(--primary)' }} />
        <span style={{ fontSize: '1.05rem', fontWeight: '800', color: 'var(--text-bright)' }}>고지서 관리</span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          범칙금 · 과태료 · 미납통행료 · 장기렌트 계약분
        </span>
        <button
          type="button"
          onClick={() => setShowUpload((v) => !v)}
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid var(--primary)', background: showUpload ? 'var(--primary)' : '#fff', color: showUpload ? '#fff' : 'var(--primary)', padding: '0.45rem 0.9rem', borderRadius: '6px', fontSize: '0.82rem', fontWeight: '700', cursor: 'pointer' }}
        >
          <Upload size={14} /> 고지서 등록
        </button>
        <button
          type="button"
          onClick={fetchNotices}
          style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-muted)', padding: '0.45rem 0.7rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '700', cursor: 'pointer' }}
        >
          <RefreshCw size={13} /> 새로고침
        </button>
      </div>

      {showUpload && (
        <UpcomingDocUpload
          onClose={() => setShowUpload(false)}
          onDone={fetchNotices}
          showToast={showToast}
          currentUser={currentUser}
        />
      )}

      {/* 고객이 내기로 한 건 중 기한이 코앞이거나 지난 것. 자동으로 넘기지 않고 사람에게 묻는다. */}
      {needsDecision.length > 0 && (
        <div style={{ border: '1px solid #fca5a5', background: '#fef2f2', borderRadius: '10px', padding: '0.8rem 1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--error)', fontWeight: '800', fontSize: '0.88rem' }}>
            <AlertCircle size={16} />
            정해 주셔야 할 고지서 {needsDecision.length}건
            <span style={{ fontWeight: '600', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
              · 고객이 내기로 한 건인데 기한이 코앞이거나 지났습니다. 그냥 두면 아무 일도 일어나지 않습니다.
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.6rem' }}>
            {needsDecision.slice(0, 5).map((x) => {
              const id = `${x.scheduleId}-${x.roundNo}-${x.index}`;
              return (
                <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', fontSize: '0.82rem' }}>
                  <strong style={{ color: 'var(--text-bright)' }}>{x.plateNo || '차량번호 미상'}</strong>
                  <span style={{ color: 'var(--text-muted)' }}>{x.partyName}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{x.kind} {won(x.amount)}</span>
                  <span style={{ color: ddayColor(x.dday, false), fontWeight: '800' }}>{ddayLabel(x.dday)}</span>
                  <span style={{ color: HANDLINGS[x.handling]?.color, fontWeight: '700' }}>{HANDLINGS[x.handling]?.label}</span>
                  <button
                    type="button"
                    onClick={() => setHandling(x, '대납청구')}
                    disabled={busy === id}
                    title="우리가 내고 다음 청구서에 얹습니다"
                    style={{
                      marginLeft: 'auto', border: '1px solid #0284c7', background: '#0284c7', color: '#fff',
                      padding: '0.25rem 0.6rem', borderRadius: '6px', fontSize: '0.76rem', fontWeight: '800',
                      cursor: busy === id ? 'not-allowed' : 'pointer', opacity: busy === id ? 0.5 : 1
                    }}
                  >
                    대납으로 바꾸기
                  </button>
                </div>
              );
            })}
            {needsDecision.length > 5 && (
              <button
                type="button"
                onClick={() => setFilter('고객납부처리')}
                style={{ alignSelf: 'flex-start', border: 'none', background: 'none', color: 'var(--error)', fontSize: '0.78rem', fontWeight: '700', cursor: 'pointer', padding: 0 }}
              >
                나머지 {needsDecision.length - 5}건 보기 →
              </button>
            )}
          </div>
        </div>
      )}

      {/* 아침에 이 줄만 봐도 무엇을 챙겨야 하는지 알 수 있어야 한다 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.6rem' }}>
        {[
          { key: 'unnotified', label: '안내 전', icon: <Mail size={15} />, color: '#0284c7', bg: '#f0f9ff' },
          { key: 'overdue', label: '기한 지남', icon: <AlertCircle size={15} />, color: 'var(--error)', bg: '#fef2f2' },
          { key: 'soon', label: '7일 내 마감', icon: <Clock size={15} />, color: '#d97706', bg: '#fffbeb' },
          { key: 'paid', label: '처리 완료', icon: <CheckCircle2 size={15} />, color: '#16a34a', bg: '#f0fdf4' },
          { key: 'nodue', label: '기한 미상', icon: <FileWarning size={15} />, color: '#7c3aed', bg: '#f5f3ff' }
        ].map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={() => setFilter(filter === card.key ? 'all' : card.key)}
            style={{
              textAlign: 'left', cursor: 'pointer', padding: '0.7rem 0.9rem', borderRadius: '10px',
              background: card.bg,
              border: `2px solid ${filter === card.key ? card.color : 'transparent'}`
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: card.color, fontSize: '0.78rem', fontWeight: '700' }}>
              {card.icon} {card.label}
            </div>
            <div style={{ fontSize: '1.3rem', fontWeight: '800', color: card.color, marginTop: '0.15rem' }}>
              {countOf(card.key)}건
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '600' }}>
              {won(sumOf(card.key))}
            </div>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setFilter('all')}
          style={{
            border: `1px solid ${filter === 'all' ? 'var(--primary)' : 'var(--border-color)'}`,
            background: filter === 'all' ? 'var(--primary)' : '#fff',
            color: filter === 'all' ? '#fff' : 'var(--text-muted)',
            padding: '0.35rem 0.8rem', borderRadius: '20px', fontSize: '0.82rem', fontWeight: '700', cursor: 'pointer'
          }}
        >
          전체 {summary.total ?? items.length}
        </button>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            title={f.hint}
            style={{
              border: `1px solid ${filter === f.key ? f.color : 'var(--border-color)'}`,
              background: filter === f.key ? f.color : '#fff',
              color: filter === f.key ? '#fff' : 'var(--text-muted)',
              padding: '0.35rem 0.8rem', borderRadius: '20px', fontSize: '0.82rem', fontWeight: '700', cursor: 'pointer'
            }}
          >
            {f.label} {countOf(f.key)}
          </button>
        ))}

        <div style={{ position: 'relative', flex: 1, minWidth: '240px', marginLeft: 'auto' }}>
          <Search size={15} style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="계약사 / 차량번호 / 고지번호로 검색"
            style={{ width: '100%', padding: '0.5rem 0.7rem 0.5rem 2.1rem', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.88rem' }}
          />
          {keyword && (
            <button
              type="button"
              onClick={() => setKeyword('')}
              style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid var(--border-color)', borderRadius: '10px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 0.9rem', background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', fontSize: '0.82rem' }}>
          <strong style={{ color: 'var(--text-bright)' }}>{shown.length}건</strong>
          <span style={{ color: 'var(--text-muted)' }}>· 합계 {won(shownTotal)}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
            계약마다 정해 둔 [처리 방식]대로 [다음 할 일]만 눌러 나가면 됩니다. 이 건만 다르면 방식을 그 자리에서 바꾸세요.
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
            <thead>
              <tr style={{ background: '#fff', borderBottom: '1px solid var(--border-color)', color: 'var(--text-bright)' }}>
                <th style={thStyle}>계약사</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>처리 방식</th>
                <th style={thStyle}>차량번호</th>
                <th style={thStyle}>종류</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>위반일</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>납부기한</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>금액</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>붙은 회차</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>고객 안내</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>지금 단계</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>다음 할 일</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>불러오는 중...</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={11} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  {items.length ? '이 조건에 맞는 고지서가 없습니다.' : '등록된 고지서가 없습니다. [고지서 등록]으로 올려 주세요.'}
                </td></tr>
              ) : shown.map((x) => {
                // 더 손댈 일이 없는 건. 초록으로 눕혀 두고 기한 지남 표시도 하지 않는다.
                const paid = DONE_STATUSES.includes(x.noticeStatus);
                const id = `${x.scheduleId}-${x.roundNo}-${x.index}`;
                const overdue = !paid && x.dday !== null && x.dday < 0;
                return (
                  <tr
                    key={id}
                    style={{
                      borderBottom: '1px solid var(--border-color)',
                      background: paid ? '#f0fdf4' : (overdue ? '#fef2f2' : 'transparent'),
                      boxShadow: overdue ? 'inset 3px 0 0 var(--error)' : 'none',
                      opacity: paid ? 0.75 : 1
                    }}
                  >
                    <td style={{ ...tdStyle, fontWeight: '700' }}>
                      {x.partyName || '-'}
                      <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', fontWeight: '600' }}>{x.contractNo}</div>
                    </td>
                    {/* 처리 방식. 계약에 정해 둔 것을 따르되 이 건만 바꿀 수 있다. */}
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <select
                        value={x.handling || '대납청구'}
                        onChange={(e) => setHandling(x, e.target.value)}
                        disabled={x.issued || busy === id}
                        title={HANDLINGS[x.handling]?.hint}
                        style={{
                          padding: '0.22rem 0.35rem', borderRadius: '5px', fontSize: '0.74rem', fontWeight: '800',
                          cursor: (x.issued || busy === id) ? 'not-allowed' : 'pointer',
                          border: `1px solid ${HANDLINGS[x.handling]?.color || 'var(--border-color)'}`,
                          color: HANDLINGS[x.handling]?.color || 'var(--text-muted)',
                          background: '#fff'
                        }}
                      >
                        {Object.entries(HANDLINGS).map(([k, v]) => (
                          <option key={k} value={k}>{v.label}</option>
                        ))}
                      </select>
                      {x.handling !== x.contractHandling && (
                        <div style={{ fontSize: '0.68rem', color: '#d97706', fontWeight: '700', marginTop: '0.1rem' }}>
                          이 건만 예외
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, fontWeight: '700', color: 'var(--primary)' }}>{x.plateNo || '-'}</td>
                    <td style={tdStyle}>
                      {x.kind}
                      {x.noticeNo && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{x.noticeNo}</div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-muted)' }}>{ymd(x.occurredAt)}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div>{ymd(x.noticeDueDate)}</div>
                      <div style={{ fontSize: '0.73rem', fontWeight: '800', color: ddayColor(x.dday, paid) }}>
                        {paid ? '납부완료' : ddayLabel(x.dday)}
                      </div>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: '700', textDecoration: paid ? 'line-through' : 'none', color: paid ? 'var(--text-muted)' : 'var(--text-bright)' }}>
                      {won(x.amount)}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {x.roundNo}회차
                      <div style={{ fontSize: '0.72rem' }}>{ymd(x.roundDueDate)}</div>
                      {x.issued && <div style={{ fontSize: '0.7rem', color: '#0284c7', fontWeight: '700' }}>발행됨</div>}
                    </td>
                    {/* 고지서가 오면 알리는 것이 먼저다. 기한 안에 직접 내면 청구하지 않는다는 걸 고객이 알아야 한다. */}
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {x.noticeMailSentAt ? (
                        <>
                          <div style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: '700' }}>
                            {ymd(x.noticeMailSentAt)} 보냄
                          </div>
                          <button
                            type="button"
                            onClick={() => sendNotice(x, true)}
                            disabled={busy === id}
                            title={`${x.noticeMailTo}(으)로 보냈습니다. 다시 보냅니다.`}
                            style={{ border: 'none', background: 'none', color: 'var(--text-muted)', fontSize: '0.72rem', fontWeight: '700', cursor: busy === id ? 'not-allowed' : 'pointer', padding: '0.1rem' }}
                          >
                            재발송
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => sendNotice(x)}
                          disabled={paid || busy === id}
                          title={paid
                            ? '더 처리할 일이 없는 건입니다'
                            : (x.handling === '명의변경'
                              ? '관공서로 계약서와 고지서를 함께 보냅니다'
                              : '계약서의 범칙금 E-MAIL로 고지서 원본을 붙여 보냅니다')}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap',
                            padding: '0.3rem 0.6rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: '800',
                            cursor: (paid || busy === id) ? 'not-allowed' : 'pointer',
                            opacity: (paid || busy === id) ? 0.5 : 1,
                            border: '1px solid #0284c7', background: '#fff', color: '#0284c7'
                          }}
                        >
                          <Mail size={12} /> {x.handling === '명의변경' ? '접수' : '안내'}
                        </button>
                      )}
                    </td>

                    {/* 지금 어디까지 왔는지 */}
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {(() => {
                        const st = STATUS_STYLE[x.noticeStatus] || STATUS_STYLE['접수'];
                        return (
                          <span style={{ background: st.bg, color: st.color, padding: '0.15rem 0.5rem', borderRadius: '20px', fontSize: '0.73rem', fontWeight: '800', whiteSpace: 'nowrap' }}>
                            {x.noticeStatus}
                          </span>
                        );
                      })()}
                      {x.driverName && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{x.driverName}</div>
                      )}
                      {x.transferAgency && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.1rem' }}>{x.transferAgency}</div>
                      )}
                    </td>

                    {/* 다음에 할 일 하나만. 여러 버튼을 늘어놓으면 무엇을 눌러야 할지 헷갈린다. */}
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {(() => {
                        const step = NEXT_STEP[x.handling || '대납청구']?.[x.noticeStatus];
                        if (!step) {
                          return (
                            <button
                              type="button"
                              onClick={() => setNoticeStatus(x, '접수')}
                              disabled={x.issued || busy === id}
                              title="처음 단계로 되돌립니다"
                              style={{
                                whiteSpace: 'nowrap', padding: '0.28rem 0.6rem', borderRadius: '6px',
                                fontSize: '0.75rem', fontWeight: '700',
                                cursor: (x.issued || busy === id) ? 'not-allowed' : 'pointer',
                                opacity: (x.issued || busy === id) ? 0.5 : 1,
                                border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-muted)'
                              }}
                            >
                              되돌리기
                            </button>
                          );
                        }
                        const needDriver = step.to === '운전자확인';
                        const needAgency = step.to === '접수중';
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              const extra = {};
                              if (needDriver) {
                                const name = window.prompt('운전자 이름을 적어 주세요.', x.driverName || '');
                                if (name === null) return;
                                extra.driverName = name;
                                const phone = window.prompt('운전자 연락처 (없으면 비워 두세요)', x.driverPhone || '');
                                if (phone !== null) extra.driverPhone = phone;
                              }
                              if (needAgency) {
                                const agency = window.prompt('어디에 접수했나요? (예: 서초경찰서, 서초구청)', x.transferAgency || '');
                                if (agency === null) return;
                                extra.transferAgency = agency;
                              }
                              setNoticeStatus(x, step.to, extra);
                            }}
                            disabled={x.issued || busy === id}
                            title={x.issued ? '이미 발행한 회차라 바꿀 수 없습니다' : step.hint}
                            style={{
                              whiteSpace: 'nowrap', padding: '0.3rem 0.7rem', borderRadius: '6px',
                              fontSize: '0.78rem', fontWeight: '800',
                              cursor: (x.issued || busy === id) ? 'not-allowed' : 'pointer',
                              opacity: (x.issued || busy === id) ? 0.5 : 1,
                              border: `1px solid ${HANDLINGS[x.handling]?.color || 'var(--primary)'}`,
                              background: HANDLINGS[x.handling]?.color || 'var(--primary)',
                              color: '#fff'
                            }}
                          >
                            {step.label}
                          </button>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <strong>[안내]</strong>를 누르면 계약서에 적어 둔 범칙금 E-MAIL로 고지서 원본을 붙여 보냅니다.
        고지서 금액은 올리는 순간 다음에 나갈 청구서에 붙어 있고, 기한 안에 고객이 직접 냈으면
        <strong>[납부확인]</strong>을 눌러 주세요. 청구액에서 빠지고 캘린더 일정도 닫힙니다.
        서류와 기록은 지워지지 않습니다.
      </div>
    </div>
  );
}

export default FineNoticeView;
