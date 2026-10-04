import fs from 'fs';
import * as oneDriveStorage from './oneDriveStorage.js';
import * as localDocumentStorage from './localDocumentStorage.js';
import {
  DOC_KINDS,
  buildDocumentPath,
  buildContractFolderName,
  getDocumentSettings,
  contractPartyRoot,
  folderNameOf,
  fillPattern,
  sanitizeSegment
} from './documentPath.js';

/**
 * 문서를 OneDrive에 넣고 꺼내는 곳.
 *
 * 경로를 정하는 일은 documentPath.js가 혼자 맡는다. 여기서는 "어디에" 대신
 * "어떻게 넣고 꺼내는지"만 다룬다. 예전에는 저장 함수마다 경로를 따로 만들어
 * 같은 서류가 두 자리에 생기고, 경로를 바꾸려면 여러 파일을 고쳐야 했다.
 */

export { buildContractFolderName, sanitizeSegment, fillPattern, getDocumentSettings };

// 업무 흐름 점검 때만 OneDrive 대신 이 컴퓨터의 폴더를 쓴다(localDocumentStorage.js 참고).
// 운영 서버에는 DOCUMENT_STORAGE_DIR이 없으므로 언제나 OneDrive다.
const storage = process.env.DOCUMENT_STORAGE_DIR ? localDocumentStorage : oneDriveStorage;
const { uploadFile, ensureFolder, listChildren, downloadById, downloadByPath } = storage;
if (process.env.DOCUMENT_STORAGE_DIR) {
  console.log(`[문서] OneDrive 대신 로컬 폴더에 저장합니다: ${process.env.DOCUMENT_STORAGE_DIR}`);
}

/** 예전 이름을 쓰던 코드가 남아 있을 수 있어 함께 둔다 */
export const sanitizePathSegment = sanitizeSegment;

/**
 * 계약자(법인) 폴더와 그 안의 문서 폴더들을 만든다. 이미 있으면 그대로 둔다.
 *
 * 'RENT/장기렌트/{법인명}' 아래에 만든다. 견적 단계의 'RENT/견적/{고객명}'과 자리가 다르다.
 * 견적은 상담한 사람 앞으로, 계약은 서류가 나가는 법인 앞으로 모아야 각각 찾기 쉽다.
 *
 * 계약을 등록하는 순간 만들어 두면, 나중에 계약서·청구서·정비 자료를 넣을 자리가 미리 잡힌다.
 * 폴더 이름은 계약자명만 쓴다. 결제일 같은 값을 앞에 붙이면 그 값이 바뀔 때 폴더를 옮겨야 하고,
 * 그러면 이미 저장된 파일 경로가 전부 틀어진다.
 *
 * @param {string} partyName 계약자명 (법인이면 법인명)
 * @returns {Promise<{root: string, created: boolean}>}
 */
export const ensureCustomerFolders = async (partyName) => {
  const settings = await getDocumentSettings();
  const root = contractPartyRoot(settings, partyName);
  const created = await ensureFolder(root);

  // 계약 단계 서류만 만든다. 견적서는 계약 전 단계라 고객 이름 폴더에 따로 담긴다.
  for (const kind of DOC_KINDS.filter((k) => k.stage === 'contract')) {
    await ensureFolder([...root, sanitizeSegment(folderNameOf(settings, kind.code))]);
  }
  return { root: root.join('/'), created };
};

/**
 * 계약자 폴더 안에 계약별 폴더를 만든다.
 * ('장기렌트/신흥정보통신㈜/01.계약서/21100001_Ray Van_20대')
 *
 * 계약이 여러 건인 법인이 많아 계약서를 계약 폴더로 나눠 담는다.
 * 계약서 파일 자체는 프로그램이 만들지 않는다. 사람이 탐색기에서 이 폴더에 넣고,
 * 명의변경 메일을 보낼 때 findContractDocument가 여기서 찾아 붙인다.
 *
 * @param {string} partyName 계약자명
 * @param {string} contractFolderName buildContractFolderName이 만든 폴더 이름
 * @returns {Promise<string>} 만들어진 폴더 경로
 */
export const ensureContractFolder = async (partyName, contractFolderName) => {
  const settings = await getDocumentSettings();
  const segments = [
    ...contractPartyRoot(settings, partyName),
    sanitizeSegment(folderNameOf(settings, 'contract')),
    sanitizeSegment(contractFolderName)
  ];
  await ensureFolder(segments);
  return segments.join('/');
};

/**
 * 문서를 저장한다. 프로그램에서 파일을 넣는 곳은 전부 이 함수를 지난다.
 *
 * 중간 폴더는 OneDrive가 알아서 만든다.
 *
 * @param {object} params
 * @param {string} params.partyName 계약자명
 * @param {string} params.kind DOC_KINDS의 code ('invoice', 'company', 'quote' 등)
 * @param {string} [params.subFolder] 계약 폴더 등 한 겹 더
 * @param {string} params.fileName 확장자까지 붙인 파일명
 * @param {Buffer} params.fileBuffer 파일 내용
 * @param {boolean} [params.keepPrevious=false] true면 같은 이름이 있을 때 덮지 않고 새 이름으로 남긴다
 * @returns {Promise<{fileName: string, localPath: string, webUrl: string}>}
 */
export const saveDocument = async ({ partyName, kind, subFolder, fileName, fileBuffer, keepPrevious = false }) => {
  const segments = await buildDocumentPath({ partyName, kind, subFolder, fileName });
  const saved = await uploadFile(segments, fileBuffer, { keepPrevious });

  // localPath라는 이름은 예전 그대로 둔다. DB와 화면이 이 이름으로 경로를 담고 있다.
  return { fileName: saved.fileName, localPath: saved.path, webUrl: saved.webUrl };
};

/**
 * 계약자 폴더에 넣어 둔 계약서 사본을 찾는다.
 *
 * 명의 변경을 요청할 때 관공서가 계약서를 함께 요구한다. 담당자가 매번 폴더를 열어
 * 찾아 붙이면 엉뚱한 계약서를 붙이는 일이 생겨, 계약번호로 골라 준다.
 *
 * 계약번호가 든 파일을 먼저 찾고, 없으면 그 폴더에서 가장 최근 것을 쓴다.
 * 폴더에 계약서를 넣어 두지 않았으면 null을 준다(메일 자체를 막지는 않는다).
 *
 * @param {string} partyName 계약자명 (폴더명)
 * @param {string} [contractNo] 계약번호
 * @returns {Promise<{fileName: string, localPath: string, buffer: Buffer}|null>}
 */
export const findContractDocument = async (partyName, contractNo) => {
  if (!partyName) return null;

  const settings = await getDocumentSettings();
  const dir = [
    ...contractPartyRoot(settings, partyName),
    sanitizeSegment(folderNameOf(settings, 'contract'))
  ];
  const no = contractNo ? String(contractNo).trim() : '';

  // 계약서는 계약 폴더('21100001_Ray Van_20대') 안에 넣는다. 계약이 여러 건인 법인이 많아
  // 한 단계 아래 폴더까지 훑는다. 폴더 이름은 차종·대수가 붙어 계약번호와 정확히 같지 않다.
  const found = [];
  const walk = async (segments, depth) => {
    let entries;
    try {
      entries = await listChildren(segments);
    } catch {
      return; // 폴더가 없거나 읽지 못하면 건너뛴다
    }

    for (const entry of entries) {
      const full = [...segments, entry.name];
      if (entry.isFolder) {
        if (depth > 0) await walk(full, depth - 1);
      } else if (/\.(pdf|jpg|jpeg|png)$/i.test(entry.name)) {
        found.push({
          fileName: entry.name,
          id: entry.id,
          path: full.join('/'),
          modified: new Date(entry.lastModified || 0).getTime(),
          // 계약번호는 폴더 이름에 붙는 일이 많아 경로 전체에서 찾는다
          matchesNo: Boolean(no) && full.join('/').includes(no)
        });
      }
    }
  };

  await walk(dir, 2);
  if (!found.length) return null;

  // 계약번호가 든 것이 있으면 그것부터, 없으면 가장 최근 것
  const matched = found.filter((f) => f.matchesNo);
  const pick = (matched.length ? matched : found).sort((a, b) => b.modified - a.modified)[0];

  return { fileName: pick.fileName, localPath: pick.path, buffer: await downloadById(pick.id) };
};

/**
 * 저장해 둔 파일을 다시 읽는다.
 *
 * 예전에 저장한 기록에는 'C:\Users\...' 같은 이 PC의 경로가 들어 있고,
 * 지금부터 저장하는 것에는 'RENT/법인명/02.청구서/...' 같은 OneDrive 경로가 들어간다.
 * 둘 다 읽을 수 있어야 예전 청구서도 메일에 붙일 수 있다.
 *
 * @param {string} savedPath 저장 당시 남겨 둔 경로
 * @returns {Promise<Buffer|null>} 읽지 못하면 null (메일 자체를 막지는 않는다)
 */
export const readSavedFile = async (savedPath) => {
  const target = String(savedPath || '').trim();
  if (!target) return null;

  // 이 PC에 실제로 있는 파일이면 그대로 읽는다(예전 기록)
  const looksLocal = /^[a-zA-Z]:[/\\]/.test(target) || target.startsWith('/');
  if (looksLocal) {
    try {
      return fs.existsSync(target) ? fs.readFileSync(target) : null;
    } catch {
      return null;
    }
  }

  try {
    return await downloadByPath(target);
  } catch (err) {
    console.error('[문서] OneDrive에서 파일을 읽지 못했습니다:', err.message);
    return null;
  }
};
