import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FileSignature, Upload, RefreshCw, Printer, Save, CheckCircle2, Unlock, Search, Download, ArrowLeft, BookOpen } from 'lucide-react';
import ContractSheetPage from './ContractSheetPage.jsx';
import { buildSheetContext, FIELD_GROUPS, SOURCE_LABEL } from './contractSheetUtils.js';
import { printFitted } from '../../utils/printFit.js';

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

const PRINT_MARGIN_MM = 6;

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

/**
 * 계약서 미리보기. 장(시트)마다 A4 한 장 크기의 상자에 넣는다.
 * 모든 상자를 가장 넓은 장의 폭과 A4 비율 높이로 맞추고, 장이 상자보다 크면 그 장만 줄인다.
 * 그래서 printFitted가 폭에 맞춰 한 번 줄이면 상자 하나가 종이 한 장이 된다.
 */
// 그림은 로그인 토큰이 있어야 받을 수 있어 <img src>로 바로 걸 수 없다. 받아서 blob 주소로 바꿔 둔다.
const mediaCache = new Map();
const useTemplateMedia = (template) => {
  const [urls, setUrls] = useState({});
  useEffect(() => {
    if (!template?._id) return undefined;
    let alive = true;
    Promise.all((template.media || []).map(async (path) => {
      const key = `${template._id}:${path}`;
      if (!mediaCache.has(key)) {
        mediaCache.set(key, fetch(`${API_HOST}/api/contract-templates/${template._id}/media?path=${encodeURIComponent(path)}`)
          .then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? URL.createObjectURL(b) : '')).catch(() => ''));
      }
      return [path, await mediaCache.get(key)];
    })).then((pairs) => { if (alive) setUrls(Object.fromEntries(pairs)); });
    return () => { alive = false; };
  }, [template]);
  return urls;
};

/** 장이 실제로 차지하는 크기(인쇄 영역이 있으면 그 범위, 없으면 글·그림이 있는 줄까지) */
const sheetSize = (s) => {
  const m = /\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(String(s.printArea || '').split(',')[0]);
  const col = (l) => l.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  let [c1, r1, c2, r2] = m ? [col(m[1]), Number(m[2]) - 1, col(m[3]), Number(m[4]) - 1] : [0, 0, s.cols.length - 1, s.rows.length - 1];
  if (!m) {
    const last = Math.max(0, ...s.cells.filter((c) => c.t !== undefined || c.bind).map((c) => c.r), ...s.shapes.map((x) => (x.to ? x.to.r : x.from.r)));
    r2 = Math.min(r2, last + 2);
  }
  const sum = (arr, a, b) => arr.slice(a, b + 1).reduce((x, y) => x + (y ?? 0), 0);
  // 오른쪽 끝 칸의 글(계약번호 등)이 칸 밖으로 넘쳐 보이므로 폭에 여유를 둔다
  return { w: sum(s.cols, c1, c2) + 60, h: sum(s.rows, r1, r2) };
};

function ContractPreview({ template, values, documentDate, highlightKey, previewRef }) {
  const ctx = useMemo(() => buildSheetContext(template, values, documentDate), [template, values, documentDate]);
  const media = useTemplateMedia(template);
  const sheets = (template?.sheets || []).filter((s) => s.name !== '법인정보');
  const sizes = sheets.map(sheetSize);
  // 모든 장을 같은 크기(A4 비율) 상자에 넣고, 장마다 상자를 가득 채우도록 키우거나 줄인다
  const pageW = 820;
  const pageH = Math.floor(pageW * ((297 - PRINT_MARGIN_MM * 2) / (210 - PRINT_MARGIN_MM * 2)) * 0.995);
  const mediaUrl = (path) => media[path] || '';

  return (
    <div ref={previewRef} className="contract-preview print-fit" style={{ width: pageW, margin: '0 auto' }}>
      {sheets.map((sheet, i) => {
        const { w, h } = sizes[i];
        const scale = Math.min(pageW / w, pageH / h);
        return (
          <div key={sheet.name} className="contract-print-page" style={{ width: pageW, height: pageH, background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.12)', marginBottom: 16, overflow: 'hidden', position: 'relative' }}>
            <div className="no-print" style={{ position: 'absolute', right: 6, top: 4, ...small, zIndex: 10 }}>{sheet.name}</div>
            <div style={{ transform: `scale(${scale})`, transformOrigin: 'top center', width: w, margin: '0 auto' }}>
              <ContractSheetPage sheet={sheet} styles={template.styles} ctx={ctx} mediaUrl={mediaUrl} highlightKey={highlightKey} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 계약서 한 건: 왼쪽 입력란 + 오른쪽 미리보기 */
function DocumentEditor({ docId, onBack, showToast, canWrite }) {
  const [doc, setDoc] = useState(null);
  const [template, setTemplate] = useState(null);
  const [values, setValues] = useState({});
  const [dirty, setDirty] = useState({});
  const [focusKey, setFocusKey] = useState(null);
  const [busy, setBusy] = useState(false);
  const previewRef = useRef(null);

  const apply = useCallback(async (d) => {
    setDoc(d);
    setValues(d.values || {});
    setDirty({});
    try {
      setTemplate(await fetchTemplate(d.template));
    } catch (e) {
      showToast?.(e.message, 'error');
    }
  }, [showToast]);

  useEffect(() => {
    fetch(`${API_HOST}/api/contract-documents/${docId}`).then((r) => r.json()).then((data) => {
      if (data.success) apply(data.document);
      else showToast?.(data.message || '계약서를 불러오지 못했습니다.', 'error');
    }).catch(() => showToast?.('서버 통신 오류가 발생했습니다.', 'error'));
  }, [docId, apply, showToast]);

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
  const print = () => printFitted(previewRef.current, {
    onePage: false, marginMm: PRINT_MARGIN_MM,
    title: `자동차임대차계약서_${partyOf(doc)}_${doc?.contract?.contractNo || ''}`
  });

  if (!doc || !template) return <div style={{ padding: '2rem', ...small }}>불러오는 중...</div>;
  const locked = doc.status === '확정' || !canWrite;
  const fieldByKey = Object.fromEntries((template.fields || []).map((f) => [f.key, f]));
  const grouped = new Set(FIELD_GROUPS.flatMap((g) => g.keys));
  const groups = [...FIELD_GROUPS, { title: '기타', keys: (template.fields || []).map((f) => f.key).filter((k) => !grouped.has(k)) }]
    .map((g) => ({ ...g, keys: g.keys.filter((k) => fieldByKey[k]) }))
    .filter((g) => g.keys.length);
  const emptyCount = (template.fields || []).filter((f) => !String(values[f.key] || '').trim()).length;

  return (
    <div className="contract-doc-editor" style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
      <div className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} style={btn()}><ArrowLeft size={13} /> 목록</button>
        <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-bright)' }}>
          {partyOf(doc)} · {doc.contract?.contractNo}
        </div>
        <span style={{ fontSize: '0.72rem', fontWeight: 800, padding: '0.15rem 0.5rem', borderRadius: 999, background: doc.status === '확정' ? '#dcfce7' : '#fef9c3', color: doc.status === '확정' ? '#15803d' : '#a16207' }}>{doc.status}</span>
        <span style={small}>양식 {doc.templateName} (버전 {doc.templateVersion}) · 빈칸 {emptyCount}개</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {!locked && <button type="button" disabled={busy} onClick={refresh} style={btn()} title="계약·견적·고객·차량 정보를 다시 읽어 칸을 채웁니다. 직접 고친 칸은 그대로 둡니다."><RefreshCw size={13} /> 계약 정보 다시 불러오기</button>}
          {!locked && <button type="button" disabled={busy || !Object.keys(dirty).length} onClick={save} style={btn('#2563eb', Boolean(Object.keys(dirty).length))}><Save size={13} /> 저장{Object.keys(dirty).length ? ` (${Object.keys(dirty).length})` : ''}</button>}
          {canWrite && doc.status !== '확정' && <button type="button" disabled={busy} onClick={() => confirm(false)} style={btn('#15803d', true)}><CheckCircle2 size={13} /> 확정</button>}
          {canWrite && doc.status === '확정' && <button type="button" disabled={busy} onClick={() => confirm(true)} style={btn('#a16207')}><Unlock size={13} /> 확정 풀기</button>}
          <button type="button" onClick={print} style={btn('#0f172a', true)}><Printer size={13} /> 인쇄 / PDF</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
        <div className="no-print" style={{ width: 330, flexShrink: 0, position: 'sticky', top: 8, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 8, background: '#fff', padding: '0.7rem' }}>
          <div style={{ ...small, marginBottom: '0.5rem', lineHeight: 1.5 }}>
            칸을 누르면 오른쪽 계약서에서 그 자리가 파랗게 표시됩니다. 주민등록번호는 저장하지 않습니다(개인 고객은 서명 때 직접 적음).
          </div>
          {groups.map((g) => (
            <div key={g.title} style={{ marginBottom: '0.8rem' }}>
              <div style={{ fontWeight: 800, fontSize: '0.8rem', color: 'var(--text-bright)', marginBottom: '0.3rem' }}>{g.title}</div>
              {g.keys.map((key) => {
                const f = fieldByKey[key];
                const source = dirty[key] !== undefined ? 'manual' : doc.sources?.[key];
                const v = values[key] ?? '';
                return (
                  <label key={key} style={{ display: 'block', marginBottom: '0.35rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', ...small }}>
                      <span style={{ fontWeight: 700, color: v ? 'var(--text-muted)' : '#b45309' }}>{f.label}{v ? '' : ' (빈칸)'}</span>
                      {source && <span style={{ color: source === 'manual' ? '#2563eb' : 'var(--text-muted)' }}>{SOURCE_LABEL[source] || source}</span>}
                    </div>
                    <input
                      value={v}
                      disabled={locked}
                      onFocus={() => setFocusKey(key)}
                      onChange={(e) => {
                        const next = e.target.value;
                        setValues((prev) => ({ ...prev, [key]: next }));
                        setDirty((prev) => ({ ...prev, [key]: next }));
                      }}
                      style={{ ...input, background: locked ? '#f8fafc' : '#fff' }}
                    />
                    {f.note && <div style={small}>{f.note}</div>}
                  </label>
                );
              })}
            </div>
          ))}
        </div>

        <div className="contract-preview-scroll print-fit-scroll" style={{ flex: 1, overflowX: 'auto', background: '#f1f5f9', borderRadius: 8, padding: '0.8rem' }}>
          <ContractPreview template={template} values={values} documentDate={doc.documentDate || doc.createdAt} highlightKey={focusKey} previewRef={previewRef} />
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 0 !important; }
          body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          aside, header, nav, footer, button, .no-print, body .desktop-sidebar, body .mobile-header { display: none !important; }
          main, body .main-content, body .admin-container { padding: 0 !important; margin: 0 !important; overflow: visible !important; background: #fff !important; }
          .contract-doc-editor { position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; }
          .contract-preview-scroll { padding: 0 !important; background: #fff !important; overflow: visible !important; }
          .contract-print-page { box-shadow: none !important; margin: 0 !important; break-after: page; page-break-after: always; }
          .contract-print-page:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>
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

/** 약관 원문: 조항별 + 장별 전체 글. 원문 그대로(줄바꿈 포함) 보여 주고 .txt로도 받는다 */
function TermsPanel({ templateId, showToast }) {
  const [template, setTemplate] = useState(null);
  const [mode, setMode] = useState('clauses');
  useEffect(() => {
    if (!templateId) return;
    fetchTemplate(templateId).then(setTemplate).catch((e) => showToast?.(e.message, 'error'));
  }, [templateId, showToast]);

  if (!templateId) return <div style={{ padding: '1.5rem', ...small }}>양식 관리에서 [약관 원문]을 눌러 주세요.</div>;
  if (!template) return <div style={{ padding: '1.5rem', ...small }}>불러오는 중...</div>;

  const saveText = () => {
    const text = [
      `${template.name} (버전 ${template.version}) · ${template.fileName}`,
      `원본 확인값(SHA-256): ${template.sha256}`,
      '',
      ...template.pages.map((p) => `######## ${p.sheet}\n${p.text}`)
    ].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `계약서_약관원문_v${template.version}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>{template.name}</strong><span style={small}>버전 {template.version} · 약관 {template.clauses.length}개 조항</span>
        <button type="button" onClick={() => setMode('clauses')} style={btn(mode === 'clauses' ? '#2563eb' : '#334155', mode === 'clauses')}>조항별</button>
        <button type="button" onClick={() => setMode('pages')} style={btn(mode === 'pages' ? '#2563eb' : '#334155', mode === 'pages')}>장별 전체</button>
        <button type="button" onClick={saveText} style={{ ...btn(), marginLeft: 'auto' }}><Download size={12} /> 원문 .txt 받기</button>
      </div>
      <div style={{ ...small, lineHeight: 1.5 }}>
        엑셀의 셀 글과 글상자(조항 제목·계산식·동의 상자) 글을 원문 그대로 모았습니다. 두 단으로 된 약관 장은 왼쪽 단을 끝까지 읽은 뒤 오른쪽 단을 읽습니다. 계약자 정보가 들어가는 칸은 [항목 이름]으로 표시했습니다.
      </div>
      {mode === 'clauses' ? template.clauses.map((c, i) => (
        <div key={`${c.part}-${c.no}-${i}`} style={{ border: '1px solid var(--border-color)', borderRadius: 8, background: '#fff', padding: '0.7rem 0.9rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
            <strong style={{ color: 'var(--text-bright)' }}>{c.heading}</strong>
            <span style={small}>{c.part} · {c.page} · {c.text.length.toLocaleString()}자</span>
          </div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem', lineHeight: 1.6, marginTop: '0.4rem', color: 'var(--text-bright)' }}>{c.text}</div>
        </div>
      )) : template.pages.map((p) => (
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
