import { useState, useEffect, useRef } from 'react';
import { Mail, X, Save, Image as ImageIcon, Trash2 } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

// 제목·본문에 넣을 수 있는 자리. 보낼 때 실제 값으로 바뀐다.
const PLACEHOLDERS = [
  { tag: '{{계약자}}', sample: '신흥정보통신㈜' },
  { tag: '{{계약번호}}', sample: '21100001' },
  { tag: '{{회차}}', sample: '58' },
  { tag: '{{총회차}}', sample: '60' },
  { tag: '{{출금일}}', sample: '2026-09-05' },
  { tag: '{{청구액}}', sample: '6,853,000원' }
];

const fillSample = (text) => PLACEHOLDERS.reduce(
  (acc, p) => acc.split(p.tag).join(p.sample),
  String(text || '')
);

/**
 * 청구서 메일 양식 편집.
 *
 * 문구를 코드에 두면 담당자가 바뀔 때마다 배포해야 해서 화면에서 고치게 한다.
 * 서명은 회사에서 쓰던 그림을 그대로 올린다. 글자로 다시 짜면 줄 간격과 로고가 어긋난다.
 */
function MailTemplateEditor({ onClose, showToast, currentUser }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [hasSignature, setHasSignature] = useState(false);
  const [signatureFileName, setSignatureFileName] = useState('');
  const [signatureVersion, setSignatureVersion] = useState(Date.now()); // 바꾼 그림이 바로 보이도록
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const bodyRef = useRef(null);

  const load = async () => {
    try {
      const res = await fetch(`${API_HOST}/api/mail-templates/invoice`);
      const data = await res.json();
      if (data.success) {
        setSubject(data.template.subject || '');
        setBody(data.template.body || '');
        setHasSignature(data.template.hasSignature);
        setSignatureFileName(data.template.signatureFileName || '');
      }
    } catch {
      showToast?.('메일 양식을 불러오지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const handleSave = async () => {
    if (currentUser?.role === 'viewer') {
      showToast?.('권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    try {
      setSaving(true);
      const res = await fetch(`${API_HOST}/api/mail-templates/invoice`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-User-Role': currentUser?.role || 'viewer' },
        body: JSON.stringify({ subject, body })
      });
      const data = await res.json();
      showToast?.(data.message || (data.success ? '저장했습니다.' : '저장하지 못했습니다.'), data.success ? 'success' : 'error');
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (file) => {
    if (!file) return;
    try {
      setUploading(true);
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_HOST}/api/mail-templates/invoice/signature`, {
        method: 'POST', headers: { 'X-User-Role': currentUser?.role || 'viewer' }, body: fd
      });
      const data = await res.json();
      if (data.success) {
        setHasSignature(true);
        setSignatureFileName(data.fileName);
        setSignatureVersion(Date.now());
      }
      showToast?.(data.message, data.success ? 'success' : 'error');
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDeleteSignature = async () => {
    if (!window.confirm('서명 이미지를 지울까요?\n지우면 기본 로고가 대신 들어갑니다.')) return;
    try {
      const res = await fetch(`${API_HOST}/api/mail-templates/invoice/signature`, {
        method: 'DELETE', headers: { 'X-User-Role': currentUser?.role || 'viewer' }
      });
      const data = await res.json();
      if (data.success) { setHasSignature(false); setSignatureFileName(''); }
      showToast?.(data.message, data.success ? 'success' : 'error');
    } catch {
      showToast?.('서버 통신 오류가 발생했습니다.', 'error');
    }
  };

  /** 커서 자리에 치환 항목을 끼워 넣는다 */
  const insertTag = (tag) => {
    const el = bodyRef.current;
    if (!el) { setBody((v) => v + tag); return; }
    const s = el.selectionStart ?? body.length;
    const e = el.selectionEnd ?? body.length;
    setBody(body.slice(0, s) + tag + body.slice(e));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + tag.length, s + tag.length); });
  };

  const inputStyle = { width: '100%', padding: '0.5rem 0.65rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-bright)', fontSize: '0.88rem' };
  const labelStyle = { fontSize: '0.78rem', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '0.3rem' };

  return (
    <div style={{ background: '#fff', border: '1px solid var(--primary)', borderRadius: '10px', padding: '1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <Mail size={15} style={{ color: 'var(--primary)' }} />
        <span style={{ fontWeight: '800', fontSize: '0.9rem', color: 'var(--text-bright)' }}>청구서 메일 양식</span>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>모든 청구서 메일에 함께 적용됩니다</span>
        <button type="button" onClick={onClose} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <X size={16} />
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>불러오는 중...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.2rem', alignItems: 'start' }}>
          {/* 왼쪽 - 편집 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            <div>
              <label style={labelStyle}>제목</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} style={inputStyle} />
            </div>

            <div>
              <label style={labelStyle}>본문</label>
              <textarea
                ref={bodyRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }}
              />
            </div>

            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.3rem' }}>
                누르면 본문에 들어갑니다. 보낼 때 실제 값으로 바뀝니다.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                {PLACEHOLDERS.map((p) => (
                  <button
                    key={p.tag}
                    type="button"
                    onClick={() => insertTag(p.tag)}
                    title={`예: ${p.sample}`}
                    style={{ border: '1px dashed var(--border-color)', background: 'var(--bg-main)', color: 'var(--primary)', padding: '0.25rem 0.5rem', borderRadius: '5px', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer' }}
                  >
                    {p.tag}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '0.7rem' }}>
              <label style={labelStyle}>
                <ImageIcon size={12} style={{ verticalAlign: '-2px', marginRight: '0.25rem' }} />
                서명 이미지 (본문 맨 아래)
              </label>
              {hasSignature && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {signatureFileName || '서명 이미지'}
                  </span>
                  <button type="button" onClick={handleDeleteSignature} title="지우기" style={{ border: 'none', background: 'none', color: 'var(--error)', cursor: 'pointer' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                disabled={uploading}
                onChange={(e) => handleUpload(e.target.files?.[0])}
                style={{ ...inputStyle, padding: '0.3rem' }}
              />
              <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '0.3rem' }}>
                지금 메일에 붙이시는 서명 그림을 그대로 올리세요. 올리면 기본 로고 대신 이 그림이 들어갑니다.
              </div>
            </div>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', background: 'var(--primary)', color: '#fff', border: 'none', padding: '0.6rem', borderRadius: '8px', fontWeight: '700', fontSize: '0.85rem', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
            >
              <Save size={15} /> {saving ? '저장 중...' : '제목 · 본문 저장'}
            </button>
          </div>

          {/* 오른쪽 - 미리보기 */}
          <div>
            <label style={labelStyle}>미리보기 (예시 값으로 채운 모습)</label>
            <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
              <div style={{ background: 'var(--bg-main)', padding: '0.5rem 0.7rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.78rem' }}>
                <div style={{ color: 'var(--text-muted)' }}>보내는 사람 <strong style={{ color: 'var(--text-bright)' }}>rent@sdibenefit.com</strong></div>
                <div style={{ marginTop: '0.2rem', fontWeight: '700', color: 'var(--text-bright)' }}>{fillSample(subject) || '(제목 없음)'}</div>
              </div>
              <div style={{ padding: '0.9rem', background: '#fff', fontSize: '0.85rem', lineHeight: 1.7, color: '#222', minHeight: '160px' }}>
                {fillSample(body).split('\n').map((line, i) => (
                  <div key={i}>{line || ' '}</div>
                ))}
                {hasSignature ? (
                  <img
                    src={`${API_HOST}/api/mail-templates/invoice/signature?v=${signatureVersion}`}
                    alt="서명"
                    style={{ maxWidth: '100%', marginTop: '18px' }}
                  />
                ) : (
                  <div style={{ marginTop: '18px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                    서명 이미지가 없어 기본 로고가 들어갑니다.
                  </div>
                )}
              </div>
              <div style={{ background: 'var(--bg-main)', padding: '0.5rem 0.7rem', borderTop: '1px solid var(--border-color)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                첨부: 신흥정보통신㈜_청구서_58회차.pdf (+ 범칙금 등 올려 둔 서류)
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default MailTemplateEditor;
