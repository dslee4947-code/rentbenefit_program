import { useEffect, useState } from 'react';
import { X, FileCheck2, Upload, ExternalLink } from 'lucide-react';
import useBackClose from '../../utils/useBackClose.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const ymdHm = (d) => {
  if (!d) return '-';
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
};

/**
 * 서명 완료본 창. 모두싸인 등에서 서명을 마친 계약서 PDF를 올리고, 올린 버전을 열어 본다.
 *
 * 신차·중고·연장 계약 모두 같은 창이다(대표님 2026-10-26, 계약 연장 절차 1차).
 * 파일은 계약자 폴더 01.계약서/{계약 폴더}에 '{계약번호}_계약서_서명완료_v{n}.pdf'로 저장된다.
 * 다시 올리면 새 버전이 붙고 예전 것은 그대로 남는다.
 *
 * @param {object} props
 * @param {object} props.contract 목록의 계약(_id, contractNo)
 * @param {() => void} props.onClose
 * @param {() => void} [props.onDone] 올린 뒤(목록 새로 고침)
 * @param {Function} props.showToast
 */
function SignedDocsDialog({ contract, onClose, onDone, showToast }) {
  const [info, setInfo] = useState(null);
  const [file, setFile] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useBackClose(true, onClose);

  const fetchInfo = async () => {
    const res = await fetch(`${API_HOST}/api/contracts/${contract._id}/signed`);
    return res.json();
  };
  const load = async () => {
    try {
      const data = await fetchInfo();
      if (data.success) setInfo(data);
      else showToast?.(data.message || '서명 완료본을 불러오지 못했습니다.', 'error');
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  };
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await fetchInfo();
        if (!alive) return;
        if (data.success) setInfo(data);
        else showToast?.(data.message || '서명 완료본을 불러오지 못했습니다.', 'error');
      } catch {
        if (alive) showToast?.('서버 통신 오류가 발생했습니다.', 'error');
      }
    })();
    return () => { alive = false; };
    // 계약이 바뀔 때만 불러온다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract._id]);

  const upload = async () => {
    if (!file) { showToast?.('서명 완료본 PDF를 골라 주세요.', 'error'); return; }
    try {
      setSaving(true);
      const form = new FormData();
      form.append('file', file);
      form.append('note', note);
      const res = await fetch(`${API_HOST}/api/contracts/${contract._id}/signed`, { method: 'POST', body: form });
      const data = await res.json();
      if (!data.success) { showToast?.(data.message || '올리지 못했습니다.', 'error'); return; }
      showToast?.(data.message, 'success');
      setFile(null);
      setNote('');
      await load();
      onDone?.();
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // 파일은 로그인이 필요한 주소라 새 창에서 바로 열지 못한다. 받아서 열어 준다
  const open = async (version) => {
    try {
      const res = await fetch(`${API_HOST}/api/contracts/${contract._id}/signed/${version}/file`);
      if (!res.ok) { showToast?.((await res.json()).message || '파일을 열지 못했습니다.', 'error'); return; }
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  const docs = [...(info?.signedDocuments || [])].sort((a, b) => b.version - a.version);
  const btn = { display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.45rem 0.9rem', borderRadius: '6px', fontWeight: 700, cursor: 'pointer', fontSize: '0.82rem' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 1rem', overflowY: 'auto' }}>
      <div style={{ background: '#fff', borderRadius: '12px', width: 'min(560px, 100%)', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.2rem', borderBottom: '1px solid var(--border-color)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, fontSize: '1.02rem' }}>
            <FileCheck2 size={18} style={{ color: '#16a34a' }} /> 서명 완료본 · {contract.contractNo}
            {info?.contractKind === '연장' && <span style={{ fontSize: '0.72rem', color: '#7c3aed', border: '1px solid #c4b5fd', borderRadius: '4px', padding: '0 0.3rem' }}>연장</span>}
          </div>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>

        <div style={{ padding: '1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {info?.signedOverride?.reason && !docs.length && (
            <div style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: '8px', padding: '0.6rem 0.75rem', fontSize: '0.8rem', color: '#9a3412' }}>
              서명 완료본 없이 먼저 반영한 연장입니다 ({info.signedOverride.by || '관리자'} · {ymdHm(info.signedOverride.at)}) — 사유: {info.signedOverride.reason}
              <div style={{ marginTop: '0.2rem', fontWeight: 700 }}>서명을 받으면 아래에서 올려 주세요.</div>
            </div>
          )}

          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}>올린 서명 완료본</div>
            {!info ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>불러오는 중...</div>
            ) : !docs.length ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0.6rem', background: 'var(--bg-main)', borderRadius: '6px' }}>아직 없습니다.</div>
            ) : (
              <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                {docs.map((d, i) => (
                  <div key={d.version} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.55rem 0.7rem', borderTop: i ? '1px solid var(--border-color)' : 'none', background: i ? '#fff' : '#f0fdf4' }}>
                    <b style={{ fontSize: '0.8rem', color: i ? 'var(--text-muted)' : '#16a34a', minWidth: '2.2rem' }}>v{d.version}</b>
                    <div style={{ flex: 1, minWidth: 0, fontSize: '0.78rem' }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>{d.fileName}</div>
                      <div style={{ color: 'var(--text-muted)' }}>{ymdHm(d.uploadedAt)} · {d.uploadedBy || '-'}{d.note ? ` · ${d.note}` : ''}{i ? '' : ' · 최신'}</div>
                    </div>
                    <button type="button" onClick={() => open(d.version)} style={{ ...btn, padding: '0.3rem 0.6rem', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--primary)' }}>
                      <ExternalLink size={13} /> 열기
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.8rem' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.35rem' }}>{docs.length ? '새 버전 올리기' : '서명 완료본 올리기'}</div>
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ fontSize: '0.82rem' }} />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="메모 (예: 모두싸인 완료 10/26, 재서명)"
              style={{ width: '100%', boxSizing: 'border-box', marginTop: '0.45rem', padding: '0.45rem 0.6rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.82rem' }} />
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
              계약자 폴더 01.계약서/{contract.contractNo}… 에 '{contract.contractNo}_계약서_서명완료_v{(docs[0]?.version || 0) + 1}.pdf'로 저장됩니다. 예전 버전은 지우지 않습니다.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.7rem' }}>
              <button type="button" onClick={onClose} style={{ ...btn, border: '1px solid var(--border-color)', background: '#fff' }}>닫기</button>
              <button type="button" onClick={upload} disabled={saving || !file} style={{ ...btn, border: 'none', background: file ? '#16a34a' : '#9ca3af', color: '#fff' }}>
                <Upload size={14} /> {saving ? '올리는 중...' : '올리기'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SignedDocsDialog;
