import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import { listChildren, ensureFolder, moveItem, deletePath, getItemId } from '../utils/oneDriveStorage.js';
import { getDocumentSettings, folderNameOf, sanitizeSegment } from '../utils/documentPath.js';

dotenv.config();

/**
 * 예전 구조로 쌓인 서류를 새 두 갈래 구조로 옮긴다.
 *
 *   예전:  RENT / {계약자} / 01.계약서 …
 *          RENT / 00.사업자등록증 / {법인} / 파일
 *   지금:  RENT / 장기렌트 / {계약자} / 01.계약서 …
 *          RENT / 장기렌트 / {법인} / 00.법인서류 / 파일
 *
 * 폴더는 통째로 자리만 바꾼다(복사 후 삭제가 아니다). 안에 든 파일은 건드리지 않으므로
 * 도중에 멈춰도 파일이 두 벌 생기거나 사라지지 않는다.
 *
 * 범칙금·과태료·통행료는 청구서 폴더에 섞여 있었다. 새 구조에서는 따로 모으므로
 * 파일 이름으로 골라 14.고지서로 옮긴다.
 *
 *   node migrations/2026-09-07_move_to_stage_folders.js              무엇이 바뀌는지만 본다
 *   node migrations/2026-09-07_move_to_stage_folders.js --confirm    실제로 옮긴다
 */

const DRY_RUN = !process.argv.includes('--confirm');

// 법인 폴더가 아니라 최상위에 그대로 둬야 하는 것들
const KEEP_AT_ROOT = new Set([
  '렌터카 DB',   // 법인별이 아닌 공통 엑셀 자료
  '03.청구서',   // 청구서 양식(.xlsm) 한 장이 든 옛 폴더
  '견적',        // 새 구조
  '장기렌트'      // 새 구조
]);

const LEGACY_BIZREG_FOLDER = '00.사업자등록증';

// 파일 이름에 이 말이 들어 있으면 고지서로 본다
const NOTICE_WORDS = ['범칙금', '과태료', '통행료'];
const isNoticeFile = (name) => NOTICE_WORDS.some((w) => name.includes(w));

const log = [];
const say = (line) => { log.push(line); console.log(line); };

const stat = { movedFolders: 0, movedFiles: 0, madeFolders: 0, skipped: 0, failed: 0 };

/**
 * 그 폴더 안에 파일이 하나도 없는지 본다.
 *
 * 폴더만 있고 파일이 없으면 지워도 잃을 것이 없다. 파일이 한 장이라도 있으면 false를 줘서
 * 자동으로 지우지 못하게 한다.
 *
 * @param {string[]} segments 볼 폴더
 * @returns {Promise<boolean>} 폴더가 있고 그 안에 파일이 없으면 true
 */
const isEmptyShell = async (segments) => {
  // 폴더가 아예 없으면 치울 것도 없다. listChildren은 없는 폴더에도 빈 배열을 주므로
  // 여기서 먼저 갈라 놓지 않으면 "빈 껍데기"로 잘못 본다.
  if (!(await getItemId(segments))) return false;

  let entries;
  try {
    entries = await listChildren(segments);
  } catch {
    return false;
  }
  if (!entries.length) return true;

  for (const entry of entries) {
    if (!entry.isFolder) return false;
    if (!(await isEmptyShell([...segments, entry.name]))) return false;
  }
  return true;
};

/** 실제로 옮긴다. 미리보기 모드면 옮기는 시늉만 한다. */
const move = async (from, toParent, label) => {
  if (DRY_RUN) { say(`    [미리보기] ${label}`); return true; }

  const { moved, reason } = await moveItem(from, toParent);
  if (moved) {
    say(`    옮김: ${label}`);
    return true;
  }
  say(`    건너뜀: ${label} - ${reason}`);
  stat.skipped += 1;
  return false;
};

const run = async () => {
  await connectDB();
  const settings = await getDocumentSettings();

  const ROOT = sanitizeSegment(settings.rootFolder);
  const RENT_STAGE = sanitizeSegment(settings.stageFolders.contract);
  const COMPANY_DOC = sanitizeSegment(folderNameOf(settings, 'company'));
  const INVOICE_DOC = sanitizeSegment(folderNameOf(settings, 'invoice'));
  const NOTICE_DOC = sanitizeSegment(folderNameOf(settings, 'notice'));

  const account = process.env.ONEDRIVE_TARGET_EMAIL || process.env.OUTLOOK_TARGET_EMAIL;
  say(`대상 OneDrive 계정: ${account}`);
  say(`옮겨 갈 자리: ${ROOT}\\${RENT_STAGE}\\{계약자}`);
  say(DRY_RUN ? '\n*** 미리보기입니다. 아무것도 옮기지 않습니다. ***\n' : '\n*** 실제로 옮깁니다. ***\n');

  const top = await listChildren([ROOT]);
  const companyFolders = top.filter((i) => i.isFolder && !KEEP_AT_ROOT.has(i.name) && i.name !== LEGACY_BIZREG_FOLDER);

  say(`최상위 항목 ${top.length}개 · 옮길 계약자 폴더 ${companyFolders.length}개`);
  say(`그대로 둘 것: ${top.filter((i) => KEEP_AT_ROOT.has(i.name)).map((i) => i.name).join(', ') || '없음'}`);

  // 옮겨 갈 자리를 먼저 만든다. 없으면 옮기기가 통째로 실패한다.
  if (!DRY_RUN) await ensureFolder([ROOT, RENT_STAGE]);

  say('\n=== 1) 계약자 폴더를 장기렌트 아래로 ===');
  const moved = [];
  for (const folder of companyFolders) {
    // 옮겨 갈 자리에 파일 없는 빈 껍데기가 먼저 만들어져 있으면 이름이 겹쳐 옮기지 못한다.
    // (앞선 시도가 폴더만 만들어 놓고 멈춘 경우) 파일이 하나도 없을 때만 치운다.
    const dest = [ROOT, RENT_STAGE, folder.name];
    if (await isEmptyShell(dest)) {
      say(`    빈 껍데기 정리: ${RENT_STAGE}\\${folder.name}`);
      if (!DRY_RUN) await deletePath(dest);
    }

    const ok = await move([ROOT, folder.name], [ROOT, RENT_STAGE], `${folder.name}`);
    if (ok) { moved.push(folder.name); stat.movedFolders += 1; }
  }

  say('\n=== 2) 00.사업자등록증 안의 서류를 각 법인의 00.법인서류로 ===');
  const bizRegCompanies = await listChildren([ROOT, LEGACY_BIZREG_FOLDER]).catch(() => []);
  if (!bizRegCompanies.length) {
    say('    옮길 것이 없습니다.');
  }
  for (const company of bizRegCompanies.filter((c) => c.isFolder)) {
    const files = await listChildren([ROOT, LEGACY_BIZREG_FOLDER, company.name]);
    if (!files.length) continue;

    const dest = [ROOT, RENT_STAGE, company.name, COMPANY_DOC];
    if (!DRY_RUN) { await ensureFolder(dest); stat.madeFolders += 1; }

    for (const file of files.filter((f) => !f.isFolder)) {
      const ok = await move([ROOT, LEGACY_BIZREG_FOLDER, company.name, file.name], dest,
        `${company.name} / ${file.name}`);
      if (ok) stat.movedFiles += 1;
    }
  }

  say('\n=== 3) 청구서 폴더에 섞인 고지서를 14.고지서로 ===');
  for (const party of moved) {
    // 미리보기에서는 1단계가 실제로 안 옮겨졌으므로 원래 자리를 본다.
    // 그래야 무엇이 옮겨질지 미리 정확히 보여 줄 수 있다.
    const base = DRY_RUN ? [ROOT, party] : [ROOT, RENT_STAGE, party];
    const contractFolders = await listChildren([...base, INVOICE_DOC]).catch(() => []);

    for (const entry of contractFolders) {
      // 계약 폴더 안에 있는 것과 청구서 폴더에 바로 있는 것 둘 다 본다
      const inFolder = entry.isFolder
        ? await listChildren([...base, INVOICE_DOC, entry.name])
        : [entry];
      const notices = inFolder.filter((f) => !f.isFolder && isNoticeFile(f.name));
      if (!notices.length) continue;

      const dest = entry.isFolder
        ? [ROOT, RENT_STAGE, party, NOTICE_DOC, entry.name]
        : [ROOT, RENT_STAGE, party, NOTICE_DOC];
      if (!DRY_RUN) { await ensureFolder([ROOT, RENT_STAGE, party, NOTICE_DOC]); await ensureFolder(dest); }

      for (const file of notices) {
        const from = entry.isFolder
          ? [...base, INVOICE_DOC, entry.name, file.name]
          : [...base, INVOICE_DOC, file.name];
        const ok = await move(from, dest, `${party} / ${entry.isFolder ? `${entry.name} / ` : ''}${file.name}`);
        if (ok) stat.movedFiles += 1;
      }
    }
  }
  if (!stat.movedFiles) say('    옮길 고지서가 없습니다.');

  say('\n=== 정리 ===');
  say(`폴더 이동 ${stat.movedFolders}개 · 파일 이동 ${stat.movedFiles}개 · 건너뜀 ${stat.skipped}개`);
  if (DRY_RUN) {
    say('\n미리보기였습니다. 실제로 옮기려면 --confirm 을 붙여 주세요.');
    say('  node migrations/2026-09-07_move_to_stage_folders.js --confirm');
  } else {
    say('\n다 옮겼습니다. 빈 채로 남은 00.사업자등록증 폴더는 탐색기에서 지우셔도 됩니다.');
  }

  await mongoose.disconnect();
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('실패:', err.message);
    process.exit(1);
  });
