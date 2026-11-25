import { useCallback, useEffect, useState } from 'react';
import { SCRAP_FILE_TYPES, SCRAP_MAIL_LIMIT, SCRAP_MAIL_TO, scrapMailDraft } from '../../../../shared/scrapFiling.js';

/**
 * 대폐차 신고서: 자동차등록증 첨부 + 조합에 메일 보내기 (대표님 2026-11-25).
 * 등록증은 저장된 신고서에 붙고, [메일 보내기]를 누르면 신고서 PDF와 함께 나간다.
 */
const card = { background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '0.9rem 1.1rem' };
const input = { padding: '0.35rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '0.84rem', background: 'var(--bg-surface)', color: 'var(--text-main)', width: '100%', boxSizing: 'border-box' };
const lab = { fontSize: '0.78rem', fontWeight: 700 };
const btn = (primary) => ({ padding: '0.35rem 0.8rem', borderRadius: '6px', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', border: primary ? 'none' : '1px solid var(--border-color)', background: primary ? 'var(--primary)' : 'var(--bg-surface)', color: primary ? '#fff' : 'var(--text-main)' });
const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const when = (d) => new Date(d).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

// 휴대폰 사진은 커서 메일에 못 붙는다. 글자가 보이는 크기로 줄인다.
const shrink = async (file) => {
  if (!file.type.startsWith('image/') || file.size < 500 * 1024) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1900 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
  return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }) : file;
};

export default function ScrapFilingMail({ api, filing, dirty, canEdit, makePdf, pdfName, onSent, showToast }) {
  const id = filing._id;
  const url = `${api}/${id}`;
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState('');
  const [mail, setMail] = useState(null);

  const load = useCallback(() => (id ? fetch(`${url}/files`)
    .then((r) => r.json())
    .then((d) => { if (!d.success) throw new Error(d.message); setFiles(d.files); })
    .catch((err) => showToast(err.message || '등록증 목록을 불러오지 못했습니다.', 'error')) : Promise.resolve()), [id, url, showToast]);
  useEffect(() => { load(); }, [load]);

  const upload = async (picked, plateNo) => {
    setBusy('upload');
    try {
      for (const raw of picked) {
        if (!SCRAP_FILE_TYPES.includes(raw.type)) throw new Error('PDF, JPG, PNG 파일만 올릴 수 있습니다.');
        const file = await shrink(raw);
        const form = new FormData();
        form.append('file', file);
        form.append('plateNo', plateNo);
        const r = await fetch(`${url}/files`, { method: 'POST', body: form });
        const d = await r.json();
        if (!r.ok || !d.success) throw new Error(d.message);
      }
      showToast('자동차등록증을 붙였습니다.', 'success');
    } catch (err) {
      showToast(err.message || '파일을 올리지 못했습니다.', 'error');
    } finally {
      await load();
      setBusy('');
    }
  };

  const open = async (f) => {
    const win = window.open('', '_blank');
    try {
      const r = await fetch(`${url}/files/${f._id}`);
      if (!r.ok) throw new Error('파일을 열지 못했습니다.');
      const u = URL.createObjectURL(await r.blob());
      win.location.href = u;
      setTimeout(() => URL.revokeObjectURL(u), 60000);
    } catch (err) { win?.close(); showToast(err.message, 'error'); }
  };

  const remove = async (f) => {
    if (!window.confirm(`${f.fileName}을(를) 뺍니다.`)) return;
    try {
      const d = await (await fetch(`${url}/files/${f._id}`, { method: 'DELETE' })).json();
      if (!d.success) throw new Error(d.message);
      await load();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const plates = filing.items.map((it) => it.before?.plateNo).filter(Boolean);
  const missing = plates.filter((p) => !files.some((f) => f.plateNo === p));

  const send = async () => {
    const warn = missing.length ? `\n\n※ 등록증이 없는 차: ${missing.join(', ')}` : '';
    const last = filing.mails?.length ? `\n\n※ ${when(filing.mails.at(-1).sentAt)}에 이미 보낸 신고서입니다.` : '';
    if (!window.confirm(`${mail.to} 로 메일을 보냅니다.\n첨부: ${pdfName}${files.map((f) => `, ${f.fileName}`).join('')}${warn}${last}`)) return;
    setBusy('send');
    try {
      const pdf = await makePdf();
      const total = pdf.size + files.reduce((s, f) => s + f.size, 0);
      if (total > SCRAP_MAIL_LIMIT) throw new Error(`첨부를 합친 크기가 ${kb(total)}라 보낼 수 없습니다(2.8MB까지). 등록증 파일을 줄여 주세요.`);
      const form = new FormData();
      Object.entries(mail).forEach(([k, v]) => form.append(k, v));
      form.append('file', new File([pdf], pdfName, { type: 'application/pdf' }));
      const r = await fetch(`${url}/mail`, { method: 'POST', body: form });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.message);
      showToast(`${mail.to} 로 메일을 보냈습니다.`, 'success');
      setMail(null);
      await onSent();
    } catch (err) {
      showToast(err.message || '메일을 보내지 못했습니다.', 'error');
    } finally {
      setBusy('');
    }
  };

  if (!id) return <div style={{ ...card, fontSize: '0.82rem', color: 'var(--text-muted)' }}>자동차등록증 첨부와 메일 보내기는 신고서를 저장하면 나옵니다.</div>;

  return (
    <div style={card}>
      <b style={{ fontSize: '0.9rem' }}>자동차등록증</b>
      <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>차마다 PDF나 사진을 올리면 메일에 신고서와 함께 붙습니다.</span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', margin: '0.5rem 0' }}>
        {[...plates, ''].map((p) => {
          const mine = files.filter((f) => (p ? f.plateNo === p : !plates.includes(f.plateNo)));
          return (
            <div key={p || 'etc'} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', fontSize: '0.83rem' }}>
              <b style={{ minWidth: '85px' }}>{p || '그 밖의 서류'}</b>
              {mine.map((f) => (
                <span key={f._id} style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}>
                  <button type="button" style={btn()} onClick={() => open(f)}>{f.fileName} ({kb(f.size)})</button>
                  {canEdit && <button type="button" aria-label={`${f.fileName} 빼기`} style={{ ...btn(), padding: '0.2rem 0.45rem' }} onClick={() => remove(f)}>✕</button>}
                </span>
              ))}
              {p && !mine.length && <span style={{ color: '#b45309' }}>없음</span>}
              {canEdit && (
                <label style={{ ...btn(), opacity: busy ? 0.6 : 1 }}>+ 올리기
                  <input type="file" accept=".pdf,image/jpeg,image/png" multiple disabled={!!busy} style={{ display: 'none' }} onChange={(e) => { const list = [...e.target.files]; e.target.value = ''; if (list.length) upload(list, p); }} />
                </label>
              )}
            </div>
          );
        })}
      </div>

      {canEdit && !mail && (
        <button type="button" style={btn(true)} disabled={!!busy || dirty} title={dirty ? '고친 내용을 먼저 저장해 주세요' : ''} onClick={() => setMail({ to: SCRAP_MAIL_TO, cc: '', ...scrapMailDraft(filing) })}>
          메일 보내기 ({SCRAP_MAIL_TO})
        </button>
      )}
      {canEdit && dirty && <span style={{ fontSize: '0.78rem', color: '#b45309', marginLeft: '0.5rem' }}>고친 내용을 먼저 저장해 주세요.</span>}
      {mail && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.6rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.6rem' }}>
            <label style={lab}>받는 사람<input type="email" style={input} value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} /></label>
            <label style={lab}>참조 (없으면 비움)<input type="email" style={input} value={mail.cc} onChange={(e) => setMail({ ...mail, cc: e.target.value })} /></label>
          </div>
          <label style={lab}>제목<input style={input} value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} /></label>
          <label style={lab}>본문 (회사 서명은 아래에 저절로 붙습니다)<textarea rows={11} style={{ ...input, resize: 'vertical', lineHeight: 1.6 }} value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} /></label>
          <div style={{ fontSize: '0.8rem' }}><b>첨부</b> {[pdfName, ...files.map((f) => f.fileName)].join(' · ')}{missing.length > 0 && <span style={{ color: '#b45309' }}> · 등록증 없는 차: {missing.join(', ')}</span>}</div>
          <div style={{ display: 'flex', gap: '0.4rem' }}>
            <button type="button" style={btn(true)} disabled={!!busy || dirty} onClick={send}>{busy === 'send' ? '보내는 중…' : '보내기'}</button>
            <button type="button" style={btn()} disabled={!!busy} onClick={() => setMail(null)}>닫기</button>
          </div>
        </div>
      )}
      {filing.mails?.length > 0 && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.6rem' }}>
          {filing.mails.map((m, i) => <div key={i}>보냄 {when(m.sentAt)} · {m.to}{m.cc ? ` (참조 ${m.cc})` : ''} · 첨부 {m.files?.length || 0}개 · {m.sentBy}</div>)}
        </div>
      )}
    </div>
  );
}
