import { useState, useEffect, useCallback, useMemo } from 'react';
import { FileSignature, Upload, RefreshCw, Save, CheckCircle2, Unlock, Search, Download, ArrowLeft, BookOpen } from 'lucide-react';
import { buildReadableTerms, readableTermsText, FIELD_GROUPS, SOURCE_LABEL } from './contractSheetUtils.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const ymd = (d) => (d ? new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(0, 10) : '');
const partyOf = (doc) => doc?.contract?.companyId?.name || doc?.contract?.customer?.name || '-';

// 양식은 수백 KB라 한 번 받은 것은 다시 받지 않는다(버전마다 내용이 바뀌지 않는다)
const templateCache = new Map();
const fetchTemplate = async (id) => {
  if (templateCache.has(id)) return templateCache.get(id);
  const res = await fetch(`${API_HOST}/api/contract-templates/${id}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.message || '양식을 불러오지 못했습니다.');
  templateCache.set(id, data.template);
  return data.template;
};


const btn = (color = '#334155', solid = false) => ({
  display: 'inline-flex', alignItems: 'center', gap: '0.3rem', border: `1px solid ${solid ? color : 'var(--border-color)'}`,
  background: solid ? color : '#fff', color: solid ? '#fff' : color, padding: '0.4rem 0.7rem', borderRadius: '6px',
  fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer'
});
const tabBtn = (on) => ({
  border: 'none', borderBottom: `3px solid ${on ? 'var(--primary)' : 'transparent'}`, background: 'none',
  padding: '0.55rem 0.9rem', fontWeight: 800, fontSize: '0.88rem', color: on ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer'
});
const small = { fontSize: '0.72rem', color: 'var(--text-muted)' };
const input = { width: '100%', padding: '0.35rem 0.45rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-bright)', fontSize: '0.8rem', boxSizing: 'border-box' };

// 계약서 체크 칸(엑셀 입력 칸 밖). 서버 utils/contractPdf.js가 이 값으로 V를 찍는다.
const CHECK_FIELDS = [
  { key: 'payDay', label: '대여료 결제일', options: ['5', '10', '15', '25', '말일'], suffix: (v) => (v === '말일' ? '' : '일') },
  { key: 'driverScope', label: '운전자 범위', options: ['법인', '개인'] },
  { key: 'blackbox', label: '블랙박스 장착', options: ['장착', '장착하지 않음'] }
];

/**
 * 계약서 한 건: 왼쪽 입력란 + 오른쪽 계약서 PDF.
 *
 * 오른쪽은 서버가 만든 PDF(엑셀이 만든 빈 계약서 위에 값을 찍은 것)를 그대로 보여 준다.
 * 고객에게 보내는 파일과 화면이 같은 파일이다. 입력을 고치면 [저장] 뒤에 PDF가 새로 만들어진다.
 */
function DocumentEditor({ docId, onBack, showToast, canWrite }) {
  const [doc, setDoc] = useState(null);
  const [template, setTemplate] = useState(null);
  const [values, setValues] = useState({});
  const [dirty, setDirty] = useState({});
  const [busy, setBusy] = useState(false);
  const [pdf, setPdf] = useState({ url: '', error: '', loading: false });

  const loadPdf = useCallback(async () => {
    setPdf((p) => ({ ...p, loading: true, error: '' }));
    try {
      const res = await fetch(`${API_HOST}/api/contract-documents/${docId}/pdf`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPdf((p) => ({ ...p, loading: false, error: data.message || 'PDF를 만들지 못했습니다.' }));
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      setPdf((p) => {
        if (p.url) URL.revokeObjectURL(p.url);
        return { url, error: '', loading: false };
      });
    } catch {
      setPdf((p) => ({ ...p, loading: false, error: '서버 통신 오류가 발생했습니다.' }));
    }
  }, [docId]);

  const apply = useCallback(async (d) => {
    setDoc(d);
    setValues(d.values || {});
    setDirty({});
    loadPdf();
    try {
      setTemplate(await fetchTemplate(d.template));
    } catch (e) {
      showToast?.(e.message, 'error');
    }
  }, [showToast, loadPdf]);

  useEffect(() => {
    fetch(`${API_HOST}/api/contract-documents/${docId}`).then((r) => r.json()).then((data) => {
      if (data.success) apply(data.document);
      else showToast?.(data.message || '계약서를 불러오지 못했습니다.', 'error');
    }).catch(() => showToast?.('서버 통신 오류가 발생했습니다.', 'error'));
  }, [docId, apply, showToast]);

  // 화면을 떠날 때 PDF 임시 주소를 정리한다
  useEffect(() => () => { if (pdf.url) URL.revokeObjectURL(pdf.url); }, [pdf.url]);

  const call = async (url, method, body) => {
    setBusy(true);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const data = await res.json().catch(() => ({}));
      showToast?.(data.message || (data.success ? '처리했습니다.' : '처리하지 못했습니다.'), data.success ? 'success' : 'error');
      if (data.success && data.document) await apply(data.document);
      return data.success;
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = () => call(`${API_HOST}/api/contract-documents/${docId}`, 'PATCH', { values: dirty });
  const refresh = async () => {
    if (Object.keys(dirty).length && !(await save())) return;
    await call(`${API_HOST}/api/contract-documents/${docId}/refresh`, 'POST');
  };
  const confirm = (reopen) => {
    if (!reopen && Object.keys(dirty).length) { showToast?.('저장하지 않은 칸이 있습니다. 먼저 저장해 주세요.', 'error'); return; }
    if (!reopen && !window.confirm('계약서를 확정할까요? 확정하면 [확정 풀기]를 누르기 전까지 고칠 수 없습니다.')) return;
    call(`${API_HOST}/api/contract-documents/${docId}/confirm`, 'POST', { reopen });
  };
  const download = () => {
    if (!pdf.url) return;
    const a = document.createElement('a');
    a.href = pdf.url;
    a.download = `자동차임대차계약서_${partyOf(doc)}_${doc?.contract?.contractNo || ''}.pdf`;
    a.click();
  };
  const setValue = (key, next) => {
    setValues((prev) => ({ ...prev, [key]: next }));
    setDirty((prev) => ({ ...prev, [key]: next }));
  };

  if (!doc || !template) return <div style={{ padding: '2rem', ...small }}>불러오는 중...</div>;
  const locked = doc.status === '확정' || !canWrite;
  const fieldByKey = Object.fromEntries((template.fields || []).map((f) => [f.key, f]));
  const grouped = new Set(FIELD_GROUPS.flatMap((g) => g.keys));
  const groups = [...FIELD_GROUPS, { title: '기타', keys: (template.fields || []).map((f) => f.key).filter((k) => !grouped.has(k)) }]
    .map((g) => ({ ...g, keys: g.keys.filter((k) => fieldByKey[k]) }))
    .filter((g) => g.keys.length);
  const emptyCount = (template.fields || []).filter((f) => !String(values[f.key] || '').trim()).length;
  const dirtyCount = Object.keys(dirty).length;
  const sourceTag = (key) => {
    const source = dirty[key] !== undefined ? 'manual' : doc.sources?.[key];
    return source ? <span style={{ color: source === 'manual' ? '#2563eb' : 'var(--text-muted)' }}>{SOURCE_LABEL[source] || source}</span> : null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} style={btn()}><ArrowLeft size={13} /> 목록</button>
        <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-bright)' }}>
          {partyOf(doc)} · {doc.contract?.contractNo}
        </div>
        <span style={{ fontSize: '0.72rem', fontWeight: 800, padding: '0.15rem 0.5rem', borderRadius: 999, background: doc.status === '확정' ? '#dcfce7' : '#fef9c3', color: doc.status === '확정' ? '#15803d' : '#a16207' }}>{doc.status}</span>
        <span style={small}>양식 {doc.templateName} (버전 {doc.templateVersion}) · 빈칸 {emptyCount}개</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {!locked && <button type="button" disabled={busy} onClick={refresh} style={btn()} title="계약·견적·고객·차량 정보를 다시 읽어 칸을 채웁니다. 직접 고친 칸은 그대로 둡니다."><RefreshCw size={13} /> 계약 정보 다시 불러오기</button>}
          {!locked && <button type="button" disabled={busy || !dirtyCount} onClick={save} style={btn('#2563eb', Boolean(dirtyCount))}><Save size={13} /> 저장{dirtyCount ? ` (${dirtyCount})` : ''}</button>}
          {canWrite && doc.status !== '확정' && <button type="button" disabled={busy} onClick={() => confirm(false)} style={btn('#15803d', true)}><CheckCircle2 size={13} /> 확정</button>}
          {canWrite && doc.status === '확정' && <button type="button" disabled={busy} onClick={() => confirm(true)} style={btn('#a16207')}><Unlock size={13} /> 확정 풀기</button>}
          <button type="button" disabled={!pdf.url} onClick={download} style={btn('#0f172a', true)}><Download size={13} /> PDF 받기</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
        <div style={{ width: 330, flexShrink: 0, position: 'sticky', top: 8, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 8, background: '#fff', padding: '0.7rem' }}>
          <div style={{ ...small, marginBottom: '0.5rem', lineHeight: 1.5 }}>
            고친 뒤 [저장]을 누르면 오른쪽 계약서 PDF가 새로 만들어집니다. 주민등록번호는 저장하지 않습니다(개인 고객은 서명 때 직접 적음).
          </div>
          <div style={{ marginBottom: '0.8rem' }}>
            <div style={{ fontWeight: 800, fontSize: '0.8rem', color: 'var(--text-bright)', marginBottom: '0.3rem' }}>체크 항목</div>
            {CHECK_FIELDS.map((cf) => (
              <div key={cf.key} style={{ marginBottom: '0.45rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', ...small }}>
                  <span style={{ fontWeight: 700, color: values[cf.key] ? 'var(--text-muted)' : '#b45309' }}>{cf.label}{values[cf.key] ? '' : ' (선택 안 함)'}</span>
                  {sourceTag(cf.key)}
                </div>
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.2rem' }}>
                  {cf.options.map((o) => {
                    const on = values[cf.key] === o;
                    return (
                      <button key={o} type="button" disabled={locked} onClick={() => setValue(cf.key, on ? '' : o)}
                        style={{ border: `1px solid ${on ? '#e00000' : 'var(--border-color)'}`, background: on ? '#fff1f1' : '#fff', color: on ? '#e00000' : 'var(--text-bright)', fontWeight: on ? 800 : 500, padding: '0.2rem 0.55rem', borderRadius: 6, fontSize: '0.78rem', cursor: locked ? 'default' : 'pointer' }}
                      >
                        {on ? 'V ' : ''}{o}{cf.suffix ? cf.suffix(o) : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {groups.map((g) => (
            <div key={g.title} style={{ marginBottom: '0.8rem' }}>
              <div style={{ fontWeight: 800, fontSize: '0.8rem', color: 'var(--text-bright)', marginBottom: '0.3rem' }}>{g.title}</div>
              {g.keys.map((key) => {
                const f = fieldByKey[key];
                const v = values[key] ?? '';
                return (
                  <label key={key} style={{ display: 'block', marginBottom: '0.35rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', ...small }}>
                      <span style={{ fontWeight: 700, color: v ? 'var(--text-muted)' : '#b45309' }}>{f.label}{v ? '' : ' (빈칸)'}</span>
                      {sourceTag(key)}
                    </div>
                    <input value={v} disabled={locked} onChange={(e) => setValue(key, e.target.value)} style={{ ...input, background: locked ? '#f8fafc' : '#fff' }} />
                    {f.note && <div style={small}>{f.note}</div>}
                  </label>
                );
              })}
            </div>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0, background: '#f1f5f9', borderRadius: 8, padding: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <div style={{ ...small, display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span>고객에게 보내는 PDF와 같은 파일입니다 (A4 12쪽).</span>
            {dirtyCount > 0 && <span style={{ color: '#b45309', fontWeight: 700 }}>저장하지 않은 칸 {dirtyCount}개는 아직 PDF에 없습니다.</span>}
            {pdf.loading && <span>PDF 만드는 중...</span>}
            <button type="button" onClick={loadPdf} style={{ ...btn(), marginLeft: 'auto', padding: '0.2rem 0.5rem' }}><RefreshCw size={12} /> 다시 만들기</button>
          </div>
          {pdf.error ? (
            <div style={{ padding: '2rem', color: '#b91c1c', background: '#fff', borderRadius: 6 }}>{pdf.error}</div>
          ) : pdf.url ? (
            <iframe title="계약서 PDF" src={pdf.url} style={{ width: '100%', height: 'calc(100vh - 170px)', border: '1px solid var(--border-color)', borderRadius: 6, background: '#fff' }} />
          ) : (
            <div style={{ padding: '2rem', ...small }}>PDF 만드는 중...</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 양식 버전 목록과 올리기 */
function TemplatesPanel({ showToast, isAdmin, onOpenTerms }) {
  const [templates, setTemplates] = useState([]);
  const [file, setFile] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => fetch(`${API_HOST}/api/contract-templates`).then((r) => r.json()).then((d) => {
    if (d.success) setTemplates(d.templates || []);
  }).catch(() => showToast?.('서버 통신 오류가 발생했습니다.', 'error')), [showToast]);
  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    if (!file) { showToast?.('엑셀 파일을 골라 주세요.', 'error'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('name', name);
      const res = await fetch(`${API_HOST}/api/contract-templates`, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      showToast?.(data.message || (data.success ? '올렸습니다.' : '올리지 못했습니다.'), data.success ? 'success' : 'error');
      if (data.success) { setFile(null); setName(''); load(); }
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const activate = async (t) => {
    if (!window.confirm(`버전 ${t.version}을 새 계약서에 쓸까요? 이미 만든 계약서는 원래 양식을 그대로 씁니다.`)) return;
    const res = await fetch(`${API_HOST}/api/contract-templates/${t._id}/activate`, { method: 'PATCH' });
    const data = await res.json().catch(() => ({}));
    showToast?.(data.message || '처리했습니다.', data.success ? 'success' : 'error');
    load();
  };

  const download = async (t) => {
    const res = await fetch(`${API_HOST}/api/contract-templates/${t._id}/file`);
    if (!res.ok) { showToast?.('파일을 받지 못했습니다.', 'error'); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = t.fileName || 'contract.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      {isAdmin && (
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, background: '#fff', padding: '0.8rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <Upload size={15} />
          <strong style={{ fontSize: '0.85rem' }}>엑셀 양식 올리기</strong>
          <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ fontSize: '0.8rem' }} />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 (예: 장기렌트 계약서 2025-11)" style={{ ...input, width: 260 }} />
          <button type="button" disabled={busy} onClick={upload} style={btn('#2563eb', true)}>{busy ? '읽는 중...' : '올리기'}</button>
          <div style={{ ...small, width: '100%' }}>
            올리면 새 버전으로 쌓입니다. 처음 올린 양식은 바로 &quot;사용 중&quot;이 되고, 그 뒤 버전은 [사용하기]를 눌러야 새 계약서에 쓰입니다. 이미 만든 계약서는 그때의 양식(약관)을 그대로 씁니다.
          </div>
        </div>
      )}
      <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, background: '#fff', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead style={{ background: 'var(--bg-main)', color: 'var(--text-muted)' }}>
            <tr>{['버전', '이름', '파일', '내용', '쓴 계약서', '올린 날', ''].map((h) => <th key={h} style={{ padding: '0.5rem 0.6rem', textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {templates.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: '1.5rem', textAlign: 'center', ...small }}>올린 양식이 없습니다.</td></tr>
            ) : templates.map((t) => (
              <tr key={t._id} style={{ borderTop: '1px solid var(--border-color)' }}>
                <td style={{ padding: '0.5rem 0.6rem', whiteSpace: 'nowrap' }}>
                  <b>v{t.version}</b>{' '}
                  {t.active && <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#15803d', background: '#dcfce7', borderRadius: 999, padding: '0.1rem 0.45rem' }}>사용 중</span>}
                </td>
                <td style={{ padding: '0.5rem 0.6rem' }}>{t.name}</td>
                <td style={{ padding: '0.5rem 0.6rem', ...small }}>{t.fileName}</td>
                <td style={{ padding: '0.5rem 0.6rem', ...small, whiteSpace: 'nowrap' }}>
                  {t.stats?.sheets}장 · 입력 칸 {t.stats?.fields}개 · 약관 {t.stats?.clauses}개 조항 · {Number(t.stats?.textChars || 0).toLocaleString()}자
                </td>
                <td style={{ padding: '0.5rem 0.6rem' }}>{t.documentCount}건</td>
                <td style={{ padding: '0.5rem 0.6rem', ...small, whiteSpace: 'nowrap' }}>{ymd(t.createdAt)} {t.uploadedBy}</td>
                <td style={{ padding: '0.5rem 0.6rem', whiteSpace: 'nowrap', display: 'flex', gap: '0.3rem' }}>
                  <button type="button" onClick={() => onOpenTerms(t._id)} style={btn()}><BookOpen size={12} /> 약관 원문</button>
                  <button type="button" onClick={() => download(t)} style={btn()}><Download size={12} /> 엑셀</button>
                  {isAdmin && !t.active && <button type="button" onClick={() => activate(t)} style={btn('#15803d')}>사용하기</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * 약관 원문.
 *  - 조항별: 엑셀 폭에 맞춰 끊긴 줄을 이어 붙인 읽기 쉬운 본(글자는 그대로, 줄바꿈만 정리)
 *  - 장별 전체: 엑셀이 만든 계약서 원본 PDF(값 칸 비움, A4 12쪽). 인쇄·저장은 PDF 보기 화면에서 한다
 *  - 원문 그대로: 엑셀 줄바꿈까지 그대로(대조용)
 */
function TermsPanel({ templateId, showToast }) {
  const [template, setTemplate] = useState(null);
  const [mode, setMode] = useState('clauses');
  const [pdf, setPdf] = useState({ url: '', error: '' });
  useEffect(() => {
    if (!templateId) return;
    fetchTemplate(templateId).then(setTemplate).catch((e) => showToast?.(e.message, 'error'));
  }, [templateId, showToast]);
  const readable = useMemo(() => (template ? buildReadableTerms(template) : null), [template]);

  // 장별 전체: 서버에 보관한 빈 계약서 PDF(엑셀이 만든 것)를 받아 보여 준다
  useEffect(() => {
    if (mode !== 'pages' || !templateId) return undefined;
    let alive = true;
    let url = '';
    fetch(`${API_HOST}/api/contract-templates/${templateId}/pdf`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || '양식 PDF를 받지 못했습니다.');
        return r.blob();
      })
      .then((blob) => { url = URL.createObjectURL(blob); if (alive) setPdf({ url, error: '' }); })
      .catch((e) => { if (alive) setPdf({ url: '', error: e.message }); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [mode, templateId]);

  if (!templateId) return <div style={{ padding: '1.5rem', ...small }}>양식 관리에서 [약관 원문]을 눌러 주세요.</div>;
  if (!template || !readable) return <div style={{ padding: '1.5rem', ...small }}>불러오는 중...</div>;

  const saveText = (kind) => {
    const body = kind === 'raw'
      ? template.pages.map((p) => `######## ${p.sheet}\n${p.text}`).join('\n\n')
      : readableTermsText(readable);
    const text = [
      `${template.name} (버전 ${template.version}) · ${template.fileName}`,
      `원본 확인값(SHA-256): ${template.sha256}`,
      kind === 'raw' ? '원문 그대로(엑셀 줄바꿈 포함)' : '읽기 쉬운 본(엑셀 폭에 맞춘 줄바꿈만 이어 붙임, 글자는 원문 그대로)',
      '',
      body
    ].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `계약서_약관${kind === 'raw' ? '원문' : ''}_v${template.version}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const modeBtn = (id, label) => (
    <button type="button" onClick={() => setMode(id)} style={btn(mode === id ? '#2563eb' : '#334155', mode === id)}>{label}</button>
  );

  return (
    <div className="terms-panel" style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
      <div className="no-print" style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>{template.name}</strong><span style={small}>버전 {template.version} · 약관 {readable.clauses.length}개 조항</span>
        {modeBtn('clauses', '조항별')}
        {modeBtn('pages', '장별 전체 (A4)')}
        {modeBtn('raw', '원문 그대로')}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
          <button type="button" onClick={() => saveText('readable')} style={btn()}><Download size={12} /> 읽기 쉬운 본 .txt</button>
          <button type="button" onClick={() => saveText('raw')} style={btn()}><Download size={12} /> 원문 .txt</button>
        </span>
      </div>
      <div className="no-print" style={{ ...small, lineHeight: 1.5 }}>
        {mode === 'raw'
          ? '엑셀의 셀 글과 글상자 글을 줄바꿈까지 원문 그대로 모았습니다. 계약자 정보가 들어가는 칸은 [항목 이름]으로 표시했습니다.'
          : mode === 'pages'
            ? '엑셀이 만든 계약서 원본 PDF입니다(값 칸은 비어 있음). 인쇄·저장은 PDF 화면 위쪽 단추로 합니다. 계약마다 값이 들어간 PDF는 [계약서] 탭에서 봅니다.'
            : '엑셀 칸 폭에 맞추려고 문장 중간에서 바꾼 줄을 이어 붙였습니다. 글자는 원문 그대로이고, ①·1.·가.·A. 같은 항목은 새 문단으로 둡니다. 서명란·동의 상자·계산식(글상자)은 줄을 그대로 둡니다.'}
      </div>

      {mode === 'clauses' && readable.clauses.map((c, i) => (
        <div key={`${c.part}-${c.no}-${i}`} style={{ border: '1px solid var(--border-color)', borderRadius: 8, background: '#fff', padding: '0.8rem 1rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <strong style={{ color: 'var(--text-bright)', fontSize: '0.95rem' }}>{c.heading}</strong>
            <span style={small}>{c.part} · {c.page}</span>
          </div>
          <div style={{ marginTop: '0.5rem', maxWidth: 820 }}>
            {c.items.map((it, j) => (it.kind === 'box' ? (
              <div key={j} style={{ border: '1px solid var(--border-color)', borderRadius: 6, padding: '0.4rem 0.6rem', margin: '0.35rem 0', fontSize: '0.82rem', lineHeight: 1.6, background: '#f8fafc' }}>
                {it.lines.map((l, k) => <div key={k}>{l}</div>)}
              </div>
            ) : (
              <p key={j} style={{
                margin: '0 0 0.35rem', fontSize: '0.88rem', lineHeight: 1.75, color: 'var(--text-bright)', wordBreak: 'keep-all',
                ...(it.level ? { paddingLeft: it.level * 14 + 16, textIndent: -16 } : {})
              }}
              >
                {it.text}
              </p>
            )))}
          </div>
        </div>
      ))}

      {mode === 'pages' && (
        <div style={{ background: '#f1f5f9', borderRadius: 8, padding: '0.6rem' }}>
          {pdf.error ? (
            <div style={{ padding: '2rem', color: '#b91c1c', background: '#fff', borderRadius: 6 }}>{pdf.error}</div>
          ) : pdf.url ? (
            <iframe title="계약서 양식 PDF" src={pdf.url} style={{ width: '100%', height: 'calc(100vh - 230px)', border: '1px solid var(--border-color)', borderRadius: 6, background: '#fff' }} />
          ) : (
            <div style={{ padding: '2rem', ...small }}>PDF 불러오는 중...</div>
          )}
        </div>
      )}

      {mode === 'raw' && template.pages.map((p) => (
        <div key={p.sheet} style={{ border: '1px solid var(--border-color)', borderRadius: 8, background: '#fff', padding: '0.7rem 0.9rem' }}>
          <strong>{p.sheet}</strong>{p.twoColumn && <span style={small}> · 두 단</span>}
          <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', lineHeight: 1.6, marginTop: '0.4rem' }}>{p.text}</div>
        </div>
      ))}

    </div>
  );
}

/** 계약서 목록 + 계약을 골라 새로 만들기 */
function DocumentsPanel({ showToast, canWrite, onOpen }) {
  const [docs, setDocs] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${API_HOST}/api/contract-documents`).then((r) => r.json()),
      fetch(`${API_HOST}/api/contracts`).then((r) => r.json())
    ]).then(([d, c]) => {
      if (d.success) setDocs(d.documents || []);
      setContracts(Array.isArray(c) ? c : c.contracts || []);
    }).catch(() => showToast?.('서버 통신 오류가 발생했습니다.', 'error')).finally(() => setLoading(false));
  }, [showToast]);

  const create = async (contract) => {
    const res = await fetch(`${API_HOST}/api/contract-documents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contractId: contract._id })
    });
    const data = await res.json().catch(() => ({}));
    if (!data.success) { showToast?.(data.message || '계약서를 만들지 못했습니다.', 'error'); return; }
    onOpen(data.document._id);
  };

  const q = query.replace(/\s+/g, '').toLowerCase();
  const docByContract = new Map(docs.map((d) => [String(d.contract?._id), d]));
  const matches = q ? contracts.filter((c) => [c.contractNo, c.customer?.name, c.companyId?.name, c.vehicle?.carModel, c.vehicle?.plateNo]
    .some((x) => String(x || '').replace(/\s+/g, '').toLowerCase().includes(q))).slice(0, 20) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      {canWrite && (
        <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, background: '#fff', padding: '0.8rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <Search size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="계약번호·고객명·법인명·차종·차량번호로 계약 찾기" style={{ ...input, maxWidth: 420 }} />
          </div>
          <div style={{ ...small, marginTop: '0.35rem' }}>견적서에서 [계약서 등록 전환]을 누르면 계약서가 자동으로 만들어집니다. 그 전에 맺은 계약은 여기서 찾아 만듭니다.</div>
          {matches.length > 0 && (
            <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {matches.map((c) => {
                const has = docByContract.get(String(c._id));
                return (
                  <div key={c._id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', fontSize: '0.82rem', padding: '0.3rem 0', borderBottom: '1px solid var(--border-color)' }}>
                    <b>{c.contractNo}</b>
                    <span>{c.companyId?.name || c.customer?.name}</span>
                    <span style={small}>{c.vehicle?.carModel || c.vehicleInfo?.model || ''} {c.vehicle?.plateNo || ''} · {c.status}</span>
                    <button type="button" onClick={() => (has ? onOpen(has._id) : create(c))} style={{ ...btn('#2563eb', !has), marginLeft: 'auto' }}>
                      {has ? '계약서 열기' : '계약서 만들기'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, background: '#fff', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead style={{ background: 'var(--bg-main)', color: 'var(--text-muted)' }}>
            <tr>{['계약번호', '계약자', '상태', '양식', '고친 날', ''].map((h) => <th key={h} style={{ padding: '0.5rem 0.6rem', textAlign: 'left' }}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: '1.5rem', textAlign: 'center', ...small }}>{loading ? '불러오는 중...' : '만든 계약서가 없습니다.'}</td></tr>
            ) : docs.map((d) => (
              <tr key={d._id} onClick={() => onOpen(d._id)} style={{ borderTop: '1px solid var(--border-color)', cursor: 'pointer' }}>
                <td style={{ padding: '0.5rem 0.6rem', fontWeight: 700 }}>{d.contract?.contractNo}</td>
                <td style={{ padding: '0.5rem 0.6rem' }}>{partyOf(d)}</td>
                <td style={{ padding: '0.5rem 0.6rem' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 800, padding: '0.1rem 0.45rem', borderRadius: 999, background: d.status === '확정' ? '#dcfce7' : '#fef9c3', color: d.status === '확정' ? '#15803d' : '#a16207' }}>{d.status}</span>
                </td>
                <td style={{ padding: '0.5rem 0.6rem', ...small }}>{d.templateName} v{d.templateVersion}</td>
                <td style={{ padding: '0.5rem 0.6rem', ...small }}>{ymd(d.updatedAt)} {d.updatedBy || d.createdBy}</td>
                <td style={{ padding: '0.5rem 0.6rem' }}><FileSignature size={14} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * 전자계약서.
 *
 * 엑셀 전자계약서 양식을 올려 두면, 견적서에서 계약으로 전환할 때 그 양식으로 계약서가 만들어진다.
 * 빈칸은 계약·견적·고객·법인·차량 정보로 채우고, 직원이 고친 칸은 따로 표시한다.
 * 약관 원문은 양식마다 그대로 보관해 나중에 분석할 수 있게 한다.
 */
function ContractDocsView({ showToast, currentUser, initialDocId }) {
  const [tab, setTab] = useState('docs');
  const [openDocId, setOpenDocId] = useState(initialDocId || null);
  const [termsTemplateId, setTermsTemplateId] = useState(null);
  const canWrite = currentUser?.role !== 'viewer';
  const isAdmin = currentUser?.role === 'admin';

  // 약관 원문 탭을 처음 열면 사용 중 양식을 보여 준다
  useEffect(() => {
    if (tab !== 'terms' || termsTemplateId) return;
    fetch(`${API_HOST}/api/contract-templates`).then((r) => r.json()).then((d) => {
      const active = (d.templates || []).find((t) => t.active) || d.templates?.[0];
      if (active) setTermsTemplateId(active._id);
    }).catch(() => {});
  }, [tab, termsTemplateId]);

  if (openDocId) {
    return <DocumentEditor docId={openDocId} onBack={() => setOpenDocId(null)} showToast={showToast} canWrite={canWrite} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)' }}>
        <button type="button" onClick={() => setTab('docs')} style={tabBtn(tab === 'docs')}>계약서</button>
        <button type="button" onClick={() => setTab('templates')} style={tabBtn(tab === 'templates')}>양식 관리</button>
        <button type="button" onClick={() => setTab('terms')} style={tabBtn(tab === 'terms')}>약관 원문</button>
      </div>
      {tab === 'docs' && <DocumentsPanel showToast={showToast} canWrite={canWrite} onOpen={setOpenDocId} />}
      {tab === 'templates' && <TemplatesPanel showToast={showToast} isAdmin={isAdmin} onOpenTerms={(id) => { setTermsTemplateId(id); setTab('terms'); }} />}
      {tab === 'terms' && <TermsPanel templateId={termsTemplateId} showToast={showToast} />}
    </div>
  );
}

export default ContractDocsView;
