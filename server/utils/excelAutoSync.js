import Setting from '../models/Setting.js';
import CompanyTransaction from '../models/CompanyTransaction.js';
import { listChildren, downloadById, uploadFile, deletePath, isOneDriveConfigured } from './oneDriveStorage.js';
import { importLedgersFromExcel, LEDGER_FILE_KINDS } from './ledgerExcelImport.js';
import { applyCompanyBookExcel } from './companyBookApply.js';
import { logActivity, ACTIONS } from './activityLog.js';

/**
 * 자금팀 엑셀(OneDrive) → 프로그램 자동 갱신.
 *
 * 직원은 OneDrive "5. 렌트카_정산서/1.렌트베네핏 갑지" 폴더의 엑셀만 고친다. 프로그램은 그것을 받아 온다
 * (2026-10-18 대표님 결정: 준실시간 방식).
 * - 정산 리스트 3종(장기렌트 / 사고대차 / 판매완료) → 차량 손익 원장(갑지)
 * - 입출금 리스트 → 회사 장부
 *
 * 언제 반영하나 (일정은 index.js)
 * - 직원 근무 시간(09:00~20:00)에 10분마다 폴더를 본다. 수정 시각이 바뀐 파일이 있어도
 *   **마지막 저장 후 10분 동안 손대지 않았을 때만** 반영한다.
 *   엑셀은 고치는 동안에도 몇 초마다 자동 저장되므로, 바로 반영하면 고치다 만 숫자가 들어온다.
 * - 퇴근 뒤 21:00에 그날 고친 것을 한 번 더 전체 맞춘다(빠진 것 잡기).
 * - 화면의 [지금 갱신]은 기다리지 않고 바로 반영한다.
 *
 * 엑셀 연동 끄기
 * - 직원이 익숙해지면 엑셀을 그만 쓰고 프로그램에서 바로 관리한다(2026-10-19 대표님).
 *   그때 관리자가 원장 화면에서 연동을 끄면(switchedOff) 정기 실행도 [지금 갱신]도 아무것도 쓰지 않는다.
 *   끈 뒤에도 엑셀을 받아 오면 프로그램에서 고친 입출금 줄이 엑셀 내용으로 덮이기 때문이다.
 *
 * 안전장치
 * - 쓰기 전에 지금 원장·회사 장부를 JSON으로 OneDrive "_백업/자동갱신"에 남긴다. 백업이 실패하면 쓰지 않는다. 최근 30개만 둔다.
 * - 운영 서버에서만 돈다(EXCEL_AUTO_SYNC=on으로 켤 수 있다). 개발 PC 서버도 운영 DB에 붙어 있어서
 *   두 곳이 같이 돌면 같은 파일을 두 번 반영한다. 여러 서버가 겹쳐도 DB 잠금으로 한 곳만 돈다.
 * - 결과는 활동 기록과 이 설정 문서(lastRun)에 남아 원장 화면에서 보인다.
 */

const FOLDER = (process.env.LEDGER_EXCEL_FOLDER || 'rentbenefit/5. 렌트카_정산서/1.렌트베네핏 갑지').split('/');
const BACKUP_FOLDER = [...FOLDER.slice(0, -1), '_백업', '자동갱신'];
const QUIET_MS = 10 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const KEEP_BACKUPS = 30;
const SETTING_KEY = 'excelAutoSync';

// 파일 이름으로 종류를 가린다. 날짜를 바꿔 새 이름으로 저장해도 같은 종류 중 가장 최근 파일을 쓴다.
const FILE_RULES = [
  { kind: '장기', target: 'ledger', label: '장기렌트 정산 리스트', test: /장기렌트.*정산\s*리스트/ },
  { kind: '단기', target: 'ledger', label: '사고대차 정산 리스트', test: /사고대차.*정산\s*리스트/ },
  { kind: '완료', target: 'ledger', label: '판매완료 정산 리스트', test: /판매완료.*정산\s*리스트/ },
  { kind: '입출금', target: 'companyBook', label: '입출금 리스트', test: /입출금\s*리스트/ }
];

export const isExcelAutoSyncEnabled = () => {
  if (process.env.EXCEL_AUTO_SYNC) return process.env.EXCEL_AUTO_SYNC === 'on';
  return process.env.NODE_ENV === 'production' && isOneDriveConfigured();
};

const loadState = async () => (await Setting.findOne({ key: SETTING_KEY }).lean())?.value || {};

/** 다른 서버(또는 겹친 실행)가 돌고 있으면 false. 15분이 지난 잠금은 죽은 것으로 보고 넘겨받는다. */
const acquireLock = async () => {
  const now = Date.now();
  await Setting.updateOne({ key: SETTING_KEY }, { $setOnInsert: { value: {} } }, { upsert: true });
  const res = await Setting.updateOne(
    { key: SETTING_KEY, $or: [{ 'value.lockUntil': { $exists: false } }, { 'value.lockUntil': { $lt: now } }] },
    { $set: { 'value.lockUntil': now + LOCK_MS } }
  );
  return res.modifiedCount === 1;
};
const releaseLock = () => Setting.updateOne({ key: SETTING_KEY }, { $unset: { 'value.lockUntil': '' } });

/** 폴더의 엑셀을 종류별로 가장 최근 것 하나씩 고른다. */
const pickFiles = async () => {
  const items = (await listChildren(FOLDER))
    .filter((i) => !i.isFolder && /\.xlsx?$/i.test(i.name) && !i.name.startsWith('~$'));
  const picked = {};
  const unknown = [];
  for (const item of items) {
    const rule = FILE_RULES.find((r) => r.test.test(item.name));
    if (!rule) { unknown.push(item.name); continue; }
    const prev = picked[rule.kind];
    if (!prev || new Date(item.lastModified) > new Date(prev.lastModified)) picked[rule.kind] = { ...item, ...rule };
  }
  return { picked, unknown };
};

const stamp = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace(/[-:T]/g, '');

/** JSON 백업을 올리고 오래된 것은 지운다. 실패하면 던져서 쓰기를 막는다. */
const backup = async (prefix, data) => {
  const name = `${prefix}_${stamp()}.json`;
  await uploadFile([...BACKUP_FOLDER, name], Buffer.from(JSON.stringify(data)), { keepPrevious: true });
  try {
    const olds = (await listChildren(BACKUP_FOLDER))
      .filter((i) => !i.isFolder && i.name.startsWith(`${prefix}_`))
      .sort((a, b) => b.name.localeCompare(a.name))
      .slice(KEEP_BACKUPS);
    for (const o of olds) await deletePath([...BACKUP_FOLDER, o.name]);
  } catch (err) {
    console.error('[엑셀 자동 갱신] 오래된 백업 정리 실패:', err.message);
  }
  return name;
};

/**
 * 폴더를 보고 필요한 것을 반영한다.
 *
 * @param {object} [options]
 * @param {'interval'|'daily'|'manual'} [options.trigger] 10분 확인 / 06:00 / 화면 버튼
 * @param {boolean} [options.dryRun] 바뀔 내용만 계산하고 쓰지 않는다
 * @param {object} [options.user] 화면에서 누른 사람(활동 기록용)
 * @returns {Promise<object>} 결과
 */
export const runExcelAutoSync = async ({ trigger = 'interval', dryRun = false, user } = {}) => {
  const force = trigger !== 'interval'; // 21:00 마감과 버튼은 10분 대기 없이, 바뀌지 않은 파일도 다시 맞춘다
  if (!dryRun && (await loadState()).switchedOff) {
    return { skipped: true, off: true, message: '엑셀 연동이 꺼져 있습니다. 원장은 프로그램에서 직접 관리합니다.' };
  }
  if (!dryRun && !(await acquireLock())) return { skipped: true, message: '다른 곳에서 갱신 중입니다. 잠시 뒤 다시 확인해 주세요.' };

  const result = { at: new Date(), trigger, dryRun, ledger: null, companyBook: null, waiting: [], errors: [], files: {} };
  try {
    const state = await loadState();
    const applied = state.files || {};
    const { picked, unknown } = await pickFiles();
    if (unknown.length) result.unknownFiles = unknown;
    const now = Date.now();

    const statusOf = (kind) => {
      const f = picked[kind];
      if (!f) return null;
      const changed = applied[kind]?.lastModified !== f.lastModified || applied[kind]?.name !== f.name;
      const quiet = now - new Date(f.lastModified).getTime() >= QUIET_MS;
      return { file: f, changed, quiet };
    };
    FILE_RULES.forEach((r) => {
      const s = statusOf(r.kind);
      result.files[r.kind] = s ? { name: s.file.name, lastModified: s.file.lastModified, changed: s.changed } : { missing: true };
    });

    // ── 차량 손익 원장: 정산 리스트 3종을 함께 읽는다(판매완료 이름 붙이기가 다른 파일을 알아야 한다)
    const ledgerStatus = LEDGER_FILE_KINDS.map(statusOf);
    const ledgerChanged = ledgerStatus.some((s) => s?.changed);
    const ledgerQuiet = ledgerStatus.every((s) => !s?.changed || s.quiet);
    if (ledgerStatus.some((s) => !s)) {
      if (ledgerChanged || force) {
        const missing = LEDGER_FILE_KINDS.filter((k, i) => !ledgerStatus[i]).map((k) => FILE_RULES.find((r) => r.kind === k).label);
        result.errors.push(`정산 리스트 엑셀을 찾지 못했습니다: ${missing.join(', ')}. 원장은 갱신하지 않았습니다.`);
      }
    } else if (force || (ledgerChanged && ledgerQuiet)) {
      try {
        const files = [];
        for (const s of ledgerStatus) files.push({ kind: s.file.kind, fileName: s.file.name, buffer: await downloadById(s.file.id) });
        result.ledger = await importLedgersFromExcel(files, {
          dryRun,
          beforeWrite: async (existingAll) => { result.ledgerBackup = await backup('갑지', existingAll); }
        });
        if (!dryRun) ledgerStatus.forEach((s) => { applied[s.file.kind] = { name: s.file.name, lastModified: s.file.lastModified, appliedAt: new Date() }; });
      } catch (err) {
        result.errors.push(`차량 손익 원장 갱신 실패: ${err.message}`);
      }
    } else if (ledgerChanged) {
      result.waiting.push('정산 리스트를 고치는 중으로 보여, 마지막 저장 후 10분이 지나면 반영합니다.');
    }

    // ── 회사 장부: 입출금 리스트
    const book = statusOf('입출금');
    if (book && (force || (book.changed && book.quiet))) {
      try {
        const buffer = await downloadById(book.file.id);
        const preview = await applyCompanyBookExcel(buffer, { apply: false });
        if (preview.empty) throw new Error('읽을 줄이 없습니다. 시트 모양이 바뀌었는지 확인해 주세요.');
        if (!dryRun && (preview.added || preview.removed || preview.kept)) {
          result.companyBookBackup = await backup('회사장부', await CompanyTransaction.find({ source: 'excel' }).lean());
          result.companyBook = await applyCompanyBookExcel(buffer, { apply: true, userId: user?._id });
        } else {
          result.companyBook = preview;
        }
        if (!dryRun) applied['입출금'] = { name: book.file.name, lastModified: book.file.lastModified, appliedAt: new Date() };
      } catch (err) {
        result.errors.push(`회사 장부 갱신 실패: ${err.message}`);
      }
    } else if (book?.changed) {
      result.waiting.push('입출금 리스트를 고치는 중으로 보여, 마지막 저장 후 10분이 지나면 반영합니다.');
    }

    // 요약 한 줄 (화면·활동 기록용)
    const parts = [];
    if (result.ledger) {
      const l = result.ledger;
      parts.push(`원장 ${l.updated.length}장 고침 · 새 갑지 ${l.created.length}장${l.mismatched.length ? ` · 검산 불일치 ${l.mismatched.length}장` : ''}${l.plateConflict.length ? ` · 차량번호 불일치 ${l.plateConflict.length}장` : ''}`);
    }
    if (result.companyBook && !result.companyBook.empty) {
      parts.push(`회사 장부 새 줄 ${result.companyBook.added}건 · 지운 줄 ${result.companyBook.removed}건`);
    }
    result.message = [...parts, ...result.waiting, ...result.errors].join(' / ') || '바뀐 엑셀이 없습니다.';
    result.ok = result.errors.length === 0;

    if (!dryRun) {
      const touched = result.ledger || result.companyBook || result.errors.length;
      const lastRun = {
        at: result.at, trigger, ok: result.ok, message: result.message,
        ledger: result.ledger && {
          updated: result.ledger.updated.length, created: result.ledger.created, unchanged: result.ledger.unchanged.length,
          mismatched: result.ledger.mismatched, plateConflict: result.ledger.plateConflict, unlinked: result.ledger.unlinked
        },
        companyBook: result.companyBook && { added: result.companyBook.added, removed: result.companyBook.removed, kept: result.companyBook.kept },
        errors: result.errors, waiting: result.waiting, unknownFiles: result.unknownFiles || []
      };
      const set = { 'value.files': applied, 'value.lastCheckAt': result.at, 'value.lastCheck': { message: result.message, waiting: result.waiting } };
      // 아무 일도 없던 10분 확인은 lastRun을 덮지 않는다(마지막으로 실제 반영한 결과가 화면에 남게)
      if (touched) set['value.lastRun'] = lastRun;
      await Setting.updateOne({ key: SETTING_KEY }, { $set: set });

      const changedSomething = (result.ledger && (result.ledger.updated.length || result.ledger.created.length))
        || (result.companyBook && (result.companyBook.added || result.companyBook.removed));
      if (changedSomething || result.errors.length) {
        logActivity({ user, dept: '재무부', action: ACTIONS.SYNC, summary: `엑셀 자동 갱신: ${result.message}`, meta: lastRun });
      }
    }
    return result;
  } finally {
    if (!dryRun) await releaseLock();
  }
};

/**
 * 엑셀 연동을 끄거나 다시 켠다(관리자). 끄면 원장·회사 장부는 프로그램에서 직접 관리한다.
 * @param {{on: boolean, user?: object}} params
 */
export const setExcelSyncSwitch = async ({ on, user }) => {
  await Setting.updateOne(
    { key: SETTING_KEY },
    { $set: { 'value.switchedOff': !on, 'value.switchedAt': new Date(), 'value.switchedBy': user?.name || '' }, updatedBy: user?.name || '' },
    { upsert: true }
  );
  logActivity({
    user, dept: '재무부', action: ACTIONS.SYNC,
    summary: on ? '엑셀 연동을 다시 켰습니다 (OneDrive 엑셀이 원장의 원본)' : '엑셀 연동을 껐습니다 (이제 원장은 프로그램에서 직접 관리)'
  });
};

/** 원장 화면에 보여 줄 상태 */
export const getExcelAutoSyncStatus = async () => {
  const state = await loadState();
  return {
    enabled: isExcelAutoSyncEnabled(),
    switchedOff: Boolean(state.switchedOff),
    switchedAt: state.switchedAt || null,
    switchedBy: state.switchedBy || '',
    folder: FOLDER.join('/'),
    files: state.files || {},
    lastCheckAt: state.lastCheckAt || null,
    lastCheck: state.lastCheck || null,
    lastRun: state.lastRun || null,
    running: Boolean(state.lockUntil && state.lockUntil > Date.now())
  };
};
