import dotenv from 'dotenv';
import { listChildren, deletePath } from '../utils/oneDriveStorage.js';

dotenv.config();

/**
 * OneDrive 문서함을 훑어 보고, 원하면 비운다.
 *
 * 테스트로 쌓인 폴더를 새 구조로 다시 시작하기 전에 정리하는 용도다.
 * 파일을 지우는 일은 되돌릴 수 없어, 기본은 "보여 주기만" 한다.
 *
 *   node scripts/onedrive-cleanup.js                 목록만 본다 (아무것도 지우지 않음)
 *   node scripts/onedrive-cleanup.js --confirm        RENT 아래를 전부 지운다
 *   node scripts/onedrive-cleanup.js --confirm --only "RENT/견적"   그 폴더만 지운다
 */

// 문서함 최상위 폴더. 설정에서 바꿨다면 --only 로 그 이름을 넘기면 된다.
const ROOTS = ['RENT'];

const args = process.argv.slice(2);
const confirmed = args.includes('--confirm');
const onlyIndex = args.indexOf('--only');
const only = onlyIndex !== -1 ? args[onlyIndex + 1] : null;

const stat = { folders: 0, files: 0, bytes: 0 };

const walk = async (segments, depth) => {
  let items = [];
  try {
    items = await listChildren(segments);
  } catch (err) {
    console.log(`${'   '.repeat(depth)}(읽지 못함: ${err.message.slice(0, 80)})`);
    return;
  }

  for (const item of items) {
    const pad = '   '.repeat(depth);
    if (item.isFolder) {
      stat.folders += 1;
      console.log(`${pad}[폴더] ${item.name}`);
      await walk([...segments, item.name], depth + 1);
    } else {
      stat.files += 1;
      stat.bytes += item.size || 0;
      const kb = Math.round((item.size || 0) / 1024);
      const when = String(item.lastModified || '').slice(0, 10);
      console.log(`${pad}[파일] ${item.name}  (${kb}KB, ${when})`);
    }
  }
};

const run = async () => {
  const account = process.env.ONEDRIVE_TARGET_EMAIL || process.env.OUTLOOK_TARGET_EMAIL;
  if (!account) {
    console.error('ONEDRIVE_TARGET_EMAIL 환경변수가 없습니다.');
    process.exit(1);
  }
  // 계정이 둘이라 어느 드라이브를 보고 있는지 항상 먼저 찍는다
  console.log(`대상 OneDrive 계정: ${account}\n`);

  // 지울 대상을 정한다. --only를 주면 그 폴더 하나만, 아니면 RENT/AS 아래 전부.
  const targets = [];
  if (only) {
    targets.push(only.split('/').filter(Boolean));
  } else {
    for (const root of ROOTS) {
      let children = [];
      try {
        children = await listChildren([root]);
      } catch { /* 없는 최상위 폴더는 건너뛴다 */ }
      children.forEach((c) => targets.push([root, c.name]));
    }
  }

  console.log('=== 지금 들어 있는 것 ===');
  for (const root of only ? [only.split('/').filter(Boolean)] : ROOTS.map((r) => [r])) {
    console.log(`\n[${root.join('/')}]`);
    await walk(root, 1);
  }
  console.log(`\n합계: 폴더 ${stat.folders}개, 파일 ${stat.files}개, ${(stat.bytes / 1024 / 1024).toFixed(1)}MB`);

  if (!confirmed) {
    console.log('\n--- 보여 주기만 했습니다. 아무것도 지우지 않았습니다. ---');
    console.log(`지우려면: node scripts/onedrive-cleanup.js --confirm${only ? ` --only "${only}"` : ''}`);
    return;
  }

  console.log(`\n=== 삭제 (${targets.length}개 항목) ===`);
  for (const target of targets) {
    try {
      const gone = await deletePath(target);
      console.log(`${gone ? '지움' : '없음'}  ${target.join('/')}`);
    } catch (err) {
      console.log(`실패  ${target.join('/')} - ${err.message.slice(0, 120)}`);
    }
  }
  console.log('\n정리를 끝냈습니다.');
};

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
