import { useState, useEffect, useRef } from 'react';
import { Upload, X, CheckCircle2, ExternalLink } from 'lucide-react';
import MoneyInput from './MoneyInput.jsx';
import AmountChoices from './AmountChoices.jsx';
import { NOTICE_KINDS, ROUTE_INFO, isReadableFile, readNotice } from './noticeOcr.js';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

// 한꺼번에 읽는 장 수. CLOVA가 몰리는 요청을 거절하지 않을 만큼만 동시에 보낸다.
const READ_CONCURRENCY = 2;

let seq = 0;
const nextId = () => `n${Date.now()}-${seq++}`;

/**
 * 읽은 값으로 한 줄의 입력칸을 채운다.
 * 장기렌트면 계약, 대차면 대여 건의 고객을 미리 골라 둔다. 사람이 바꿀 수 있다.
 */
const formFrom = (data) => {
  const rentalHit = data.rental?.matched || null;
  return {
    route: data.route,
    kind: NOTICE_KINDS.includes(data.kind) ? data.kind : '과태료',
    amount: data.amount || '',
    surcharge: data.surcharge || 0,
    plateNo: data.plateNo || '',
    occurredAt: data.violationDate || '',
    violationTime: data.violationTime || '',
    noticeNo: data.noticeNo || '',
    noticeDueDate: data.noticeDueDate || '',
    contractId: data.matched?.contractId || '',
    vehicleId: data.rental?.vehicleId || '',
    rentalRecord: rentalHit?.rentalId || '',
    rentalType: rentalHit?.rentalType || '',
    customerName: rentalHit?.customerName || '',
    customerContact: rentalHit?.customerContact || '',
    insuranceCompany: rentalHit?.insuranceCompany || ''
  };
};

/**
 * 고지서 여러 장을 한꺼번에 올린다.
 *
 * 스캐너로 한 묶음을 스캔해 끌어다 놓으면 한 장씩 글자를 읽어 표로 늘어놓는다.
 * 서버가 위반일로 장기렌트 계약 / 대차 운행 / 확인 필요를 가르고,
 * 원본과 대조해 [확인]에 체크한 줄만 [확인한 건 한꺼번에 등록]으로 한 번에 저장한다.
 *
 * 읽은 값을 그대로 믿지 않는다. 사람이 줄마다 확인하지 않으면 저장되지 않고,
 * 금액이 없거나 이미 올린 고지서면 체크할 수 없다.
 */
function BulkNoticeUpload({ onClose, onDone, showToast, currentUser }) {
  const [rows, setRows] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const fileRef = useRef(null);
  const urlsRef = useRef([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_HOST}/api/billing-schedules`, { cache: 'no-store' });
        const data = await res.json();
        if (data.success) setContracts(data.items || []);
      } catch { /* 계약 목록이 없어도 자동으로 정해진 줄은 올릴 수 있다 */ }
    })();
  }, []);

  // 원본 미리보기 주소는 화면을 닫을 때 풀어 준다
  useEffect(() => () => urlsRef.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const patchRow = (id, patch) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  // 값을 고치면 확인 표시를 푼다. 고친 값을 다시 보고 체크해야 등록된다.
  const patchForm = (id, patch) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, checked: false, form: { ...r.form, ...patch } } : r)));

  /**
   * 차량번호를 고치면 그 번호의 계약이 아닌 선택은 푼다.
   * 예전 번호로 골라 둔 계약이 남으면 엉뚱한 계약의 청구서에 붙는다.
   */
  const changePlate = (row, plateNo) => {
    const plate = plateNo.replace(/\s+/g, '');
    const owner = contracts.find((c) => String(c.contractId) === String(row.form.contractId));
    const keep = owner && (owner.plateNos || []).includes(plate);
    patchForm(row.id, { plateNo, ...(keep ? {} : { contractId: '' }) });
  };

  /** 고른 파일들을 줄로 만들고 차례로 글자를 읽는다. */
  const addFiles = async (fileList) => {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const fresh = files.map((file) => {
      const url = URL.createObjectURL(file);
      urlsRef.current.push(url);
      return { id: nextId(), file, url, status: 'reading', data: null, form: null, message: '', checked: false };
    });
    setRows((prev) => [...prev, ...fresh]);
    if (fileRef.current) fileRef.current.value = '';

    const queue = [...fresh];
    const worker = async () => {
      while (queue.length) {
        const row = queue.shift();
        if (!isReadableFile(row.file)) {
          patchRow(row.id, { status: 'read', data: { route: 'error' }, form: { ...formFrom({ route: 'error' }) }, message: 'JPG·PNG·TIFF·PDF만 읽을 수 있습니다.' });
          continue;
        }
        const data = await readNotice(row.file);
        if (!data.success) {
          patchRow(row.id, { status: 'read', data: { route: 'error' }, form: formFrom({ route: 'error' }), message: data.message });
        } else {
          patchRow(row.id, { status: 'read', data, form: formFrom(data), message: '' });
        }
      }
    };
    await Promise.all(Array.from({ length: READ_CONCURRENCY }, worker));
  };

  /** 이 줄을 지금 바로 등록할 수 있는지. 안 되면 이유를 준다. */
  const blockerOf = (row) => {
    if (row.status !== 'read' || !row.form) return '읽는 중';
    const f = row.form;
    if (row.data?.duplicate) return '이미 올린 고지서';
    if (!f.plateNo) return '차량번호 필요';
    if (!(Number(f.amount) > 0)) return '금액 확인';
    if (f.route === 'longterm' && !f.contractId) return '계약 선택';
    // 대차는 위반일로 누가 탔는지 가른다. 날짜 없이 올리면 나중에 고객을 찾을 수 없다.
    if (f.route === 'rental' && !f.occurredAt) return '위반일 필요';
    if (!['longterm', 'rental'].includes(f.route)) return '갈 곳 선택';
    return '';
  };

  /** 한 줄을 저장한다. 장기렌트는 그 계약의 다음 청구서에, 대차는 대차 고지서로 들어간다. */
  const saveRow = async (row) => {
    const f = row.form;
    const fd = new FormData();
    fd.append('file', row.file);
    fd.append('kind', f.kind);
    fd.append('amount', String(Number(f.amount) || 0));
    fd.append('plateNo', f.plateNo.trim());
    if (f.occurredAt) fd.append('occurredAt', f.occurredAt);
    if (f.noticeNo.trim()) fd.append('noticeNo', f.noticeNo.trim());
    if (f.noticeDueDate) fd.append('noticeDueDate', f.noticeDueDate);

    let url;
    if (f.route === 'longterm') {
      url = `${API_HOST}/api/billing-schedules/contract/${f.contractId}/upcoming/attachments`;
    } else {
      url = `${API_HOST}/api/rental-notices`;
      for (const key of ['violationTime', 'vehicleId', 'rentalRecord', 'rentalType', 'customerName', 'customerContact', 'insuranceCompany']) {
        if (f[key]) fd.append(key, f[key]);
      }
      if (f.surcharge) fd.append('surcharge', String(f.surcharge));
    }

    patchRow(row.id, { status: 'saving' });
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'X-User-Role': currentUser?.role || 'viewer' }, body: fd });
      const data = await res.json();
      if (data.success) {
        patchRow(row.id, { status: 'saved', message: data.message });
        return true;
      }
      patchRow(row.id, { status: 'read', message: data.message || '올리지 못했습니다.' });
    } catch {
      patchRow(row.id, { status: 'read', message: '서버 통신 오류가 발생했습니다.' });
    }
    return false;
  };

  const validRows = rows.filter((r) => r.status === 'read' && !blockerOf(r));
  const readyRows = validRows.filter((r) => r.checked);

  const saveAllReady = async () => {
    if (currentUser?.role === 'viewer') {
      showToast?.('권한이 없습니다. 관리자에게 문의하세요.', 'error');
      return;
    }
    if (!readyRows.length) return;
    const total = readyRows.reduce((s, r) => s + (Number(r.form.amount) || 0), 0);
    if (!window.confirm(`확인한 ${readyRows.length}건 (${total.toLocaleString()}원)을 등록할까요?\n장기렌트 건은 각 계약의 다음 청구서에 붙습니다.`)) return;
    setSavingAll(true);
    let ok = 0;
    // 한 건씩 차례로 올린다. 같은 계약의 회차표를 동시에 고치면 한쪽이 덮어써진다.
    for (const row of readyRows) {
      if (await saveRow(row)) ok += 1;
    }
    setSavingAll(false);
    showToast?.(`${ok}건 등록했습니다.${ok < readyRows.length ? ` ${readyRows.length - ok}건은 실패해 표에 남아 있습니다.` : ''}`, ok ? 'success' : 'error');
    onDone?.();
  };

  const removeRow = (id) => setRows((prev) => prev.filter((r) => r.id !== id));
  const clearSaved = () => setRows((prev) => prev.filter((r) => r.status !== 'saved'));

  /** 차량번호로 계약을 좁힌다. 못 찾으면 전체를 보여 준다. */
  const contractsFor = (plateNo) => {
    const plate = String(plateNo || '').replace(/\s+/g, '');
    const hit = plate ? contracts.filter((c) => (c.plateNos || []).includes(plate)) : [];
    return hit.length ? hit : contracts;
  };

  const counts = rows.reduce((acc, r) => {
    const key = r.status === 'saved' ? 'saved' : (r.form?.route || 'reading');
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const cell = { padding: '0.4rem 0.4rem', verticalAlign: 'top', borderBottom: '1px solid var(--border-color)' };
  const input = { width: '100%', padding: '0.25rem 0.4rem', borderRadius: '5px', border: '1px solid var(--border-color)', background: '#fff', color: 'var(--text-bright)', fontSize: '0.78rem' };

  return (
    <div style={{ background: '#fff', border: '1px solid var(--primary)', borderRadius: '10px', padding: '1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
        <Upload size={15} style={{ color: 'var(--primary)' }} />
        <span style={{ fontWeight: '800', fontSize: '0.9rem', color: 'var(--text-bright)' }}>고지서 여러 장 올리기</span>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          장기렌트·단기렌트·사고대차를 가리지 않고 올리면 위반일로 알아서 나눕니다
        </span>
        <button type="button" onClick={onClose} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
          <X size={16} />
        </button>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? 'var(--primary)' : 'var(--border-color)'}`,
          background: dragOver ? 'var(--primary-glow)' : 'var(--bg-main)',
          borderRadius: '10px', padding: '1.2rem', textAlign: 'center', cursor: 'pointer'
        }}
      >
        <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-bright)' }}>스캔한 고지서를 여기에 끌어다 놓거나 눌러서 고르세요</div>
        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
          한 장에 고지서 한 건 · JPG, PNG, TIFF, PDF · 여러 장을 한 번에 골라도 됩니다
        </div>
        <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" style={{ display: 'none' }} onChange={(e) => addFiles(e.target.files)} />
      </div>

      {rows.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '0.78rem' }}>
            {Object.entries(counts).map(([key, n]) => {
              const info = key === 'saved' ? { label: '등록 완료', color: '#16a34a', bg: '#dcfce7' }
                : key === 'reading' ? { label: '읽는 중', color: '#64748b', bg: '#f1f5f9' }
                  : ROUTE_INFO[key];
              return (
                <span key={key} style={{ padding: '0.15rem 0.55rem', borderRadius: '999px', background: info?.bg, color: info?.color, fontWeight: 800 }}>
                  {info?.label} {n}
                </span>
              );
            })}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
              {counts.saved > 0 && (
                <button type="button" onClick={clearSaved} style={{ border: '1px solid var(--border-color)', background: '#fff', borderRadius: '6px', padding: '0.35rem 0.7rem', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}>
                  등록한 줄 치우기
                </button>
              )}
              <button
                type="button"
                onClick={saveAllReady}
                disabled={!readyRows.length || savingAll}
                style={{ border: 'none', background: readyRows.length ? 'var(--primary)' : '#cbd5e1', color: '#fff', borderRadius: '6px', padding: '0.4rem 0.9rem', fontSize: '0.8rem', fontWeight: 800, cursor: readyRows.length && !savingAll ? 'pointer' : 'not-allowed' }}
              >
                {savingAll ? '등록 중...' : `확인한 건 한꺼번에 등록 (${readyRows.length}/${validRows.length}건)`}
              </button>
            </span>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', minWidth: '1080px' }}>
              <thead style={{ background: 'var(--bg-main)', color: 'var(--text-muted)' }}>
                <tr>
                  {['확인', '원본', '갈 곳', '차량번호', '종류', '금액', '위반일', '납부기한', '청구 대상', '상태', ''].map((h) => (
                    <th key={h} style={{ ...cell, textAlign: 'left', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const f = row.form;
                  const saved = row.status === 'saved';
                  const info = ROUTE_INFO[f?.route] || ROUTE_INFO.review;
                  const blocker = blockerOf(row);
                  // 한꺼번에 등록하는 동안에는 모든 줄을 잠근다. 등록 도중 고친 값은 반영되지 않기 때문이다.
                  const locked = saved || row.status === 'saving' || savingAll;
                  return (
                    <tr key={row.id} style={{ background: saved ? '#f0fdf4' : (f ? info.bg : '#fff'), opacity: saved ? 0.7 : 1 }}>
                      <td style={{ ...cell, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={saved || row.checked}
                          disabled={locked || !f || Boolean(blocker)}
                          onChange={(e) => patchRow(row.id, { checked: e.target.checked })}
                          title={blocker || '원본과 대조했으면 체크하세요'}
                        />
                      </td>
                      <td style={{ ...cell, maxWidth: '140px' }}>
                        <a href={row.url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', color: 'var(--primary)', fontWeight: 700, textDecoration: 'none' }} title="원본을 새 창에서 엽니다">
                          <ExternalLink size={12} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.file.name}</span>
                        </a>
                      </td>

                      {!f ? (
                        <td colSpan={8} style={{ ...cell, color: 'var(--text-muted)' }}>글자를 읽는 중입니다...</td>
                      ) : (
                        <>
                          <td style={cell}>
                            <select
                              value={['longterm', 'rental'].includes(f.route) ? f.route : ''}
                              disabled={locked}
                              onChange={(e) => patchForm(row.id, { route: e.target.value })}
                              style={{ ...input, fontWeight: 800, color: info.color, width: '96px' }}
                            >
                              {!['longterm', 'rental'].includes(f.route) && <option value="">{info.label}</option>}
                              <option value="longterm">장기렌트</option>
                              <option value="rental">대차</option>
                            </select>
                          </td>
                          <td style={cell}>
                            <input value={f.plateNo} disabled={locked} onChange={(e) => changePlate(row, e.target.value)} style={{ ...input, width: '96px' }} />
                          </td>
                          <td style={cell}>
                            <select value={f.kind} disabled={locked} onChange={(e) => patchForm(row.id, { kind: e.target.value })} style={{ ...input, width: '72px' }}>
                              {NOTICE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                            </select>
                          </td>
                          <td style={{ ...cell, minWidth: '150px' }}>
                            <MoneyInput value={f.amount} disabled={locked} onChange={(e) => patchForm(row.id, { amount: e.target.value })} style={input} placeholder="금액" />
                            {!locked && (
                              <div style={{ marginTop: '0.2rem' }}>
                                <AmountChoices candidates={row.data?.candidates} value={f.amount} onPick={(n) => patchForm(row.id, { amount: n })} surcharge={f.surcharge} />
                              </div>
                            )}
                          </td>
                          <td style={cell}>
                            <input type="date" value={f.occurredAt} disabled={locked} onChange={(e) => patchForm(row.id, { occurredAt: e.target.value })} style={{ ...input, width: '124px' }} />
                          </td>
                          <td style={cell}>
                            <input type="date" value={f.noticeDueDate} disabled={locked} onChange={(e) => patchForm(row.id, { noticeDueDate: e.target.value })} style={{ ...input, width: '124px' }} />
                          </td>
                          <td style={{ ...cell, minWidth: '200px' }}>
                            {f.route === 'rental' ? (
                              <>
                                {(row.data?.rental?.candidates || []).length > 1 && (
                                  <select
                                    value={f.rentalRecord}
                                    disabled={locked}
                                    onChange={(e) => {
                                      const c = row.data.rental.candidates.find((x) => String(x.rentalId) === e.target.value);
                                      patchForm(row.id, c
                                        ? { rentalRecord: c.rentalId, rentalType: c.rentalType, customerName: c.customerName, customerContact: c.customerContact, insuranceCompany: c.insuranceCompany }
                                        : { rentalRecord: '' });
                                    }}
                                    style={{ ...input, marginBottom: '0.2rem' }}
                                  >
                                    <option value="">그날 대여 건 고르기</option>
                                    {row.data.rental.candidates.map((c) => (
                                      <option key={c.rentalId} value={c.rentalId}>{c.rentalType} · {c.customerName} ({String(c.deliveredAt).slice(5, 10)}~)</option>
                                    ))}
                                  </select>
                                )}
                                <input
                                  value={f.customerName}
                                  disabled={locked}
                                  onChange={(e) => patchForm(row.id, { customerName: e.target.value })}
                                  placeholder="운전한 고객 (모르면 비워 두세요)"
                                  style={input}
                                />
                                {f.rentalType && <div style={{ color: 'var(--text-muted)', marginTop: '0.15rem' }}>{f.rentalType}{f.insuranceCompany ? ` · ${f.insuranceCompany}` : ''}</div>}
                              </>
                            ) : (
                              <select
                                value={f.contractId}
                                disabled={locked || f.route !== 'longterm'}
                                onChange={(e) => patchForm(row.id, { contractId: e.target.value })}
                                style={input}
                              >
                                <option value="">{f.route === 'longterm' ? '계약 고르기' : '갈 곳을 먼저 고르세요'}</option>
                                {contractsFor(f.plateNo).map((c) => (
                                  <option key={c.contractId} value={c.contractId}>
                                    {c.partyName} · {c.contractNo}{c.upcoming ? ` · 다음 ${c.upcoming.no}회차` : ' · 남은 회차 없음'}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td style={{ ...cell, minWidth: '160px' }}>
                            {saved ? (
                              <span style={{ color: '#16a34a', fontWeight: 800, display: 'flex', gap: '0.2rem', alignItems: 'center' }}><CheckCircle2 size={13} /> {row.message}</span>
                            ) : (
                              <>
                                {blocker && <div style={{ color: info.color, fontWeight: 800 }}>{blocker}</div>}
                                {row.data?.duplicate && (
                                  <div style={{ color: 'var(--error)' }}>
                                    {row.data.duplicate.contractNo
                                      ? `${row.data.duplicate.partyName} ${row.data.duplicate.roundNo}회차에 있음`
                                      : `대차 고지서에 있음 (${row.data.duplicate.plateNo})`}
                                  </div>
                                )}
                                {(row.message || row.data?.reason) && (
                                  <div style={{ color: 'var(--text-muted)' }}>{row.message || row.data.reason}</div>
                                )}
                              </>
                            )}
                          </td>
                        </>
                      )}

                      <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                        {!saved && f && (
                          <button
                            type="button"
                            onClick={() => saveRow(row).then((ok) => ok && onDone?.())}
                            disabled={Boolean(blocker) || !row.checked || locked}
                            title={blocker || (row.checked ? '이 줄만 등록합니다' : '원본과 대조한 뒤 [확인]에 체크하세요')}
                            style={{ border: 'none', background: (blocker || !row.checked) ? '#cbd5e1' : 'var(--primary)', color: '#fff', borderRadius: '5px', padding: '0.25rem 0.55rem', fontSize: '0.74rem', fontWeight: 800, cursor: (blocker || !row.checked) ? 'not-allowed' : 'pointer', marginRight: '0.25rem' }}
                          >
                            {row.status === 'saving' ? '...' : '등록'}
                          </button>
                        )}
                        {row.status !== 'saving' && (
                          <button type="button" onClick={() => removeRow(row.id)} title="표에서 뺍니다" style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                            <X size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <strong style={{ color: ROUTE_INFO.longterm.color }}>장기렌트</strong> 위반일이 계약 기간 안이라 그 계약의 다음 청구서에 붙습니다 ·{' '}
            <strong style={{ color: ROUTE_INFO.rental.color }}>대차</strong> 단기렌트·사고대차 차량 운행 중이라 대차 고지서로 모읍니다 ·{' '}
            <strong style={{ color: ROUTE_INFO.review.color }}>확인 필요</strong> 원본을 열어 보고 갈 곳을 골라 주세요.
            원본을 열어 금액·차량번호·위반일을 대조한 줄만 [확인]에 체크하면 등록됩니다.
            미납통행료는 원금만 청구합니다(부가통행료 제외). 금액은 반드시 원본과 대조해 주세요.
          </div>
        </>
      )}
    </div>
  );
}

export default BulkNoticeUpload;
