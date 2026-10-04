import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderTree, RotateCcw, Save, Info, AlertTriangle } from 'lucide-react';
import useSaveShortcut from './useSaveShortcut.js';
import { resetStorageSettingsCache } from './storagePaths.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || '';

/**
 * 파일을 어디에 어떤 이름으로 저장할지 정하는 화면.
 *
 * 예전에는 저장 경로가 코드에 박혀 있어, 폴더 이름 하나 바꾸려면 개발이 필요했다.
 * 여기서 바꾼 값이 프로그램 전체의 저장 위치를 정한다.
 *
 * 규칙을 고치는 동안 오른쪽에 "이렇게 저장됩니다"를 계속 보여 준다.
 * 저장하고 나서야 이름이 이상한 걸 알아채면 이미 파일이 그 이름으로 쌓인 뒤다.
 */
const StorageSettingView = ({ showToast, currentUser }) => {
  const [settings, setSettings] = useState(null);
  const [kinds, setKinds] = useState([]);
  const [stages, setStages] = useState([]);
  const [tokens, setTokens] = useState({});
  const [defaults, setDefaults] = useState(null);
  const [preview, setPreview] = useState([]);
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const isAdmin = currentUser?.role === 'admin';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_HOST}/api/settings/document-storage`);
        const data = await res.json();
        if (cancelled) return;
        if (!data.success) throw new Error(data.message || '설정을 읽지 못했습니다.');
        setSettings(data.settings);
        setKinds(data.kinds || []);
        setStages(data.stages || []);
        setTokens(data.tokens || {});
        setDefaults(data.defaults || null);
        setPreview(data.preview || []);
      } catch (err) {
        if (!cancelled) showToast?.(err.message, 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showToast]);

  // 값을 고칠 때마다 서버에 물어 미리보기를 새로 받는다.
  // 화면에서 직접 만들면 규칙 해석이 서버와 어긋나, 미리보기와 실제 저장 위치가 달라진다.
  const previewTimer = useRef(null);
  useEffect(() => {
    if (!settings || !dirty || !isAdmin) return;
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_HOST}/api/settings/document-storage/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings })
        });
        const data = await res.json();
        if (data.success) {
          setPreview(data.preview || []);
          setWarning(data.warning || '');
        }
      } catch { /* 미리보기는 없어도 저장에 지장이 없다 */ }
    }, 300);
    return () => clearTimeout(previewTimer.current);
  }, [settings, dirty, isAdmin]);

  const patch = (changes) => {
    setSettings((prev) => ({ ...prev, ...changes }));
    setDirty(true);
  };

  const handleSave = useCallback(async () => {
    if (!settings || !isAdmin || saving) return;
    try {
      setSaving(true);
      const res = await fetch(`${API_HOST}/api/settings/document-storage`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || '저장에 실패했습니다.');
      setSettings(data.settings);
      setPreview(data.preview || []);
      setWarning('');
      setDirty(false);
      // 다른 화면이 "저장 위치: ..."로 적어 둔 경로도 새 설정으로 다시 받게 한다
      resetStorageSettingsCache();
      showToast?.(data.message, 'success');
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }, [settings, isAdmin, saving, showToast]);

  useSaveShortcut(isAdmin && dirty, handleSave);

  const handleReset = () => {
    if (!defaults) return;
    if (!window.confirm('모든 항목을 처음 값으로 되돌립니다. 계속할까요?')) return;
    setSettings(JSON.parse(JSON.stringify(defaults)));
    setDirty(true);
  };

  if (loading) return <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>설정을 불러오는 중입니다…</div>;
  if (!settings) return <div style={{ padding: '2rem', color: 'var(--text-muted)' }}>설정을 읽지 못했습니다.</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 420px)', gap: '1.5rem', alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem', minWidth: 0 }}>
        {!isAdmin && (
          <Notice icon={<Info size={16} />} tone="info">
            지금 설정을 보고만 있습니다. 바꾸려면 관리자 권한이 필요합니다.
          </Notice>
        )}

        <Notice icon={<AlertTriangle size={16} />} tone="warn">
          폴더 이름을 바꿔도 <b>이미 저장된 파일은 옮기지 않습니다.</b> 앞으로 저장하는 파일부터
          새 이름을 씁니다. 예전 파일은 탐색기에서 직접 옮겨 주세요.
        </Notice>

        <Card
          title="저장 위치"
          subtitle="장기렌트로 넘어가기 전(견적)과 넘어간 뒤(계약)를 폴더부터 갈라 둡니다."
        >
          <Field label="최상위 폴더" hint="OneDrive 바로 아래에 생기는 폴더입니다.">
            <input
              type="text"
              value={settings.rootFolder}
              disabled={!isAdmin}
              onChange={(e) => patch({ rootFolder: e.target.value })}
              style={inputStyle}
            />
          </Field>

          {stages.map((stage) => (
            <Field
              key={stage.code}
              label={`${stage.label} 폴더`}
              hint={stage.hint}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontFamily: 'Consolas, Menlo, monospace', fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  {settings.rootFolder} \
                </span>
                <input
                  type="text"
                  value={settings.stageFolders[stage.code] || ''}
                  disabled={!isAdmin}
                  onChange={(e) => patch({ stageFolders: { ...settings.stageFolders, [stage.code]: e.target.value } })}
                  style={inputStyle}
                />
                <span style={{ fontFamily: 'Consolas, Menlo, monospace', fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                  \ {`{${stage.keyedBy}}`}
                </span>
              </div>
            </Field>
          ))}

          <Field label="계약 폴더로 한 겹 더 나누기" hint="계약이 여러 건인 법인은 켜 두는 편이 찾기 쉽습니다.">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={settings.useContractSubfolder}
                disabled={!isAdmin}
                onChange={(e) => patch({ useContractSubfolder: e.target.checked })}
              />
              계약서·청구서를 계약번호별 폴더로 나눕니다
            </label>
          </Field>

          {settings.useContractSubfolder && (
            <Field label="계약 폴더 이름" tokens={tokens.contractFolder}>
              <input
                type="text"
                value={settings.contractFolderPattern}
                disabled={!isAdmin}
                onChange={(e) => patch({ contractFolderPattern: e.target.value })}
                style={inputStyle}
              />
            </Field>
          )}
        </Card>

        <Card title="파일 이름 규칙">
          <Field label="청구서" tokens={tokens.invoice}>
            <PatternInput
              value={settings.fileNames.invoice}
              disabled={!isAdmin}
              onChange={(v) => patch({ fileNames: { ...settings.fileNames, invoice: v } })}
            />
          </Field>
          <Field label="청구서 첨부 (고지서·과태료 등)" tokens={tokens.invoiceAttachment}>
            <PatternInput
              value={settings.fileNames.invoiceAttachment}
              disabled={!isAdmin}
              onChange={(v) => patch({ fileNames: { ...settings.fileNames, invoiceAttachment: v } })}
            />
          </Field>
          <Field label="법인 서류" tokens={tokens.companyDoc}>
            <PatternInput
              value={settings.fileNames.companyDoc}
              disabled={!isAdmin}
              onChange={(v) => patch({ fileNames: { ...settings.fileNames, companyDoc: v } })}
            />
          </Field>
          <Field label="견적서" tokens={tokens.quote}>
            <PatternInput
              value={settings.fileNames.quote}
              disabled={!isAdmin}
              onChange={(v) => patch({ fileNames: { ...settings.fileNames, quote: v } })}
            />
          </Field>
        </Card>

        <Card
          title="문서 종류별 폴더 이름"
          subtitle="장기렌트 단계의 법인 폴더 안에 이 폴더들이 만들어집니다. 순서는 이름 앞 번호가 정합니다. 견적서는 고객 이름 폴더에 바로 담기므로 여기에 없습니다."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {kinds.filter((k) => !k.flat).map((kind) => (
              <div key={kind.code} style={{ display: 'grid', gridTemplateColumns: '170px minmax(0, 1fr)', gap: '0.6rem', alignItems: 'center' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-bright)' }}>
                  {kind.label}
                  {kind.hint && <div style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)' }}>{kind.hint}</div>}
                </div>
                <input
                  type="text"
                  value={settings.folders[kind.code] || ''}
                  disabled={!isAdmin}
                  onChange={(e) => patch({ folders: { ...settings.folders, [kind.code]: e.target.value } })}
                  style={inputStyle}
                />
              </div>
            ))}
          </div>
        </Card>

        {isAdmin && (
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
            <button type="button" onClick={handleSave} disabled={saving || !dirty} style={primaryButton(saving || !dirty)}>
              <Save size={16} /> {saving ? '저장 중…' : '저장 (Ctrl+S)'}
            </button>
            <button type="button" onClick={handleReset} style={ghostButton}>
              <RotateCcw size={16} /> 처음 값으로
            </button>
            {dirty && <span style={{ fontSize: '0.8rem', color: '#b45309' }}>아직 저장하지 않은 변경이 있습니다.</span>}
          </div>
        )}
      </div>

      <div style={{ position: 'sticky', top: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem', minWidth: 0 }}>
        <Card title={<span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><FolderTree size={16} /> 이렇게 저장됩니다</span>}>
          {warning && <Notice icon={<AlertTriangle size={16} />} tone="warn">{warning}</Notice>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', marginTop: warning ? '0.7rem' : 0 }}>
            {stages.map((stage) => (
              <div key={stage.code} style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                <div style={{
                  fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-bright)',
                  borderTop: '1px solid var(--border-color)', paddingTop: '0.6rem', marginTop: '0.2rem'
                }}>
                  {stage.label}
                  <span style={{ fontWeight: 500, color: 'var(--text-muted)' }}> · {stage.keyedBy} 기준</span>
                </div>
                {preview.filter((p) => p.stage === stage.code).map((p) => (
              <div key={p.label}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '0.2rem' }}>{p.label}</div>
                <div style={{
                  fontFamily: 'Consolas, Menlo, monospace',
                  fontSize: '0.74rem',
                  lineHeight: 1.5,
                  color: 'var(--text-bright)',
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '0.45rem 0.55rem',
                  wordBreak: 'break-all'
                }}>
                  {p.path}
                </div>
              </div>
                ))}
              </div>
            ))}
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.9rem', marginBottom: 0, lineHeight: 1.6 }}>
            탐색기에서는 <b>OneDrive - CEO</b> 아래 같은 경로로 보입니다.
            계약자 이름은 예시입니다.
          </p>
        </Card>
      </div>
    </div>
  );
};

/* ---------- 작은 조각들 ---------- */

const inputStyle = {
  width: '100%',
  padding: '0.45rem 0.6rem',
  borderRadius: '6px',
  border: '1px solid var(--border-color)',
  background: 'var(--bg-main)',
  color: 'var(--text-bright)',
  fontSize: '0.85rem',
  fontFamily: 'inherit',
  boxSizing: 'border-box'
};

const primaryButton = (disabled) => ({
  display: 'flex', alignItems: 'center', gap: '0.4rem',
  background: disabled ? 'var(--border-color)' : '#111e38',
  color: disabled ? 'var(--text-muted)' : '#fff',
  border: 'none', padding: '0.55rem 1.1rem', borderRadius: '8px',
  fontWeight: 700, fontSize: '0.85rem', cursor: disabled ? 'default' : 'pointer'
});

const ghostButton = {
  display: 'flex', alignItems: 'center', gap: '0.4rem',
  background: 'transparent', color: 'var(--text-muted)',
  border: '1px solid var(--border-color)', padding: '0.55rem 1rem',
  borderRadius: '8px', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer'
};

const Card = ({ title, subtitle, children }) => (
  <section style={{
    background: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    borderRadius: '12px',
    padding: '1.1rem 1.2rem'
  }}>
    <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-bright)' }}>{title}</h3>
    {subtitle && <p style={{ margin: '0.25rem 0 0', fontSize: '0.76rem', color: 'var(--text-muted)' }}>{subtitle}</p>}
    <div style={{ marginTop: '0.9rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>{children}</div>
  </section>
);

const Field = ({ label, hint, tokens, children }) => (
  <div>
    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-bright)', marginBottom: '0.3rem' }}>
      {label}
    </label>
    {children}
    {hint && <p style={{ margin: '0.25rem 0 0', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{hint}</p>}
    {tokens?.length > 0 && (
      <p style={{ margin: '0.3rem 0 0', fontSize: '0.71rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
        쓸 수 있는 값:{' '}
        {tokens.map((t) => (
          <span key={t.token} title={t.desc} style={{
            display: 'inline-block',
            fontFamily: 'Consolas, Menlo, monospace',
            background: 'var(--bg-main)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            padding: '0 0.3rem',
            marginRight: '0.25rem'
          }}>
            {t.token}
          </span>
        ))}
      </p>
    )}
  </div>
);

const PatternInput = ({ value, disabled, onChange }) => (
  <input
    type="text"
    value={value || ''}
    disabled={disabled}
    onChange={(e) => onChange(e.target.value)}
    style={{ ...inputStyle, fontFamily: 'Consolas, Menlo, monospace' }}
  />
);

const Notice = ({ icon, tone, children }) => {
  const colors = tone === 'warn'
    ? { bg: 'rgba(245, 158, 11, 0.08)', border: 'rgba(245, 158, 11, 0.35)', text: '#b45309' }
    : { bg: 'rgba(59, 130, 246, 0.08)', border: 'rgba(59, 130, 246, 0.35)', text: '#1d4ed8' };
  return (
    <div style={{
      display: 'flex', gap: '0.5rem', alignItems: 'flex-start',
      background: colors.bg, border: `1px solid ${colors.border}`,
      borderRadius: '8px', padding: '0.6rem 0.75rem',
      fontSize: '0.78rem', lineHeight: 1.6, color: colors.text
    }}>
      <span style={{ flexShrink: 0, marginTop: '1px' }}>{icon}</span>
      <span>{children}</span>
    </div>
  );
};

export default StorageSettingView;
