import path from 'path';
import fs from 'fs';
import { uploadFile, ensureFolder, listChildren, downloadById, downloadByPath } from './oneDriveStorage.js';

/**
 * 사업부(businessLine) -> SharePoint/OneDrive 문서함 최상위 폴더 매핑
 * 렌터카 계약 관련 문서는 RENT 폴더, 신차/리스 AS 관련 문서는 AS 폴더에 저장한다.
 */
const BUSINESS_LINE_FOLDER = {
  rental: 'RENT',
  as: 'AS',
};


// RENT 폴더 바로 아래, 문서 종류별 최상위 폴더 (그 안에 법인명 하위 폴더가 생긴다: RENT/03.청구서/{법인명}/)
export const RENT_DOC_TYPE_ROOT_FOLDER = {
  '사업자등록증': '00.사업자등록증',
  '통장사본': '00.사업자등록증',
  '견적서': '01.견적서',
  '비교견적서': '01.견적서',
  '계약서': '02.계약서',
  '청구서': '03.청구서',
  '차량정비': '04.차량 정비',
  '정기점검': '04.차량 정비',
  '자동차검사': '04.차량 정비',
  '고장수리': '04.차량 정비',
  '사고수리': '04.차량 정비',
};

// 고객(계약자) 폴더 하위에 두는 문서 폴더 묶음.
// 실제로 손으로 만들어 쓰던 폴더 구성을 그대로 옮긴 것이라, 기존 자료와 자리가 어긋나지 않는다.
export const CUSTOMER_DOC_FOLDERS = [
  '01.계약서',
  '02.청구서',
  '03.자동차 정기점검',
  '04.자동차 검사',
  '05.자동차 고장수리',
  '06.자동차 사고수리',
  '07.신차출고사진_등록증_취득세',
  '08.계약만료시준비서류',
  '09.중도해지',
  '10.등록증 및 취득세 고지서',
  '11.미납렌트료 안내 최종통보 폴더',
  '12.사고관련 차량 계약 철회 안내문',
  '13.계약 연장 안내문 및 계약서'
];

// SharePoint/OneDrive 경로에 쓸 수 없는 문자 제거
export const sanitizePathSegment = (segment) => {
  return String(segment || '')
    .replace(/[\\/:*?"<>|#%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '미지정';
};

// 현재 서버가 실행 중인 경로에서 "OneDrive - CEO" 루트 폴더를 찾는다 (로컬 동기화 폴더에 직접 저장하는 방식)
export const getOneDriveRoot = () => {
  const currentPath = process.cwd();
  const targetFolderKeyword = 'OneDrive - CEO';
  const idx = currentPath.indexOf(targetFolderKeyword);
  if (idx !== -1) {
    return currentPath.substring(0, idx + targetFolderKeyword.length);
  }
  const homeDir = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\RentBenefit';
  return path.join(homeDir, 'OneDrive - CEO');
};

/**
 * PDF(또는 기타) 문서를 OneDrive의 사업부별/고객사별/문서종류별 폴더에 업로드한다.
 * 사전 준비 필요: OUTLOOK_TARGET_EMAIL 환경변수, Azure 앱에 Files.ReadWrite.All 권한 + 관리자 동의.
 *
 * @param {Object} params
 * @param {'rental'|'as'} params.businessLine - RENT 또는 AS 사업부
 * @param {string} params.customerName - 고객사명 또는 고객명 (폴더명으로 사용)
 * @param {string} params.docType - 문서 종류 (예: '견적서', '계약서', '청구서', '정비내역서')
 * @param {string} params.fileName - 저장할 파일명 (확장자 포함)
 * @param {Buffer} params.fileBuffer - 파일 바이트
 * @param {string} [params.mimeType='application/pdf']
 * @returns {Promise<{ id: string, webUrl: string }>}
 */
export const uploadDocumentToSharePoint = async ({
  businessLine,
  customerName,
  docType,
  fileName,
  fileBuffer,
}) => {
  const folder = BUSINESS_LINE_FOLDER[businessLine];
  if (!folder) {
    throw new Error(`알 수 없는 사업부입니다: ${businessLine} (rental 또는 as만 허용)`);
  }

  const saved = await uploadFile([
    folder,
    sanitizePathSegment(customerName),
    sanitizePathSegment(docType),
    sanitizePathSegment(fileName)
  ], fileBuffer);

  return { id: saved.id, webUrl: saved.webUrl };
};


/**
 * PDF(또는 기타) 문서를 OneDrive 로컬 동기화 폴더에 "문서종류/법인명/파일" 구조로 저장한다.
 * 동일 파일명이 이미 있으면 "_ver1", "_ver2"... 를 붙여 기존 파일을 덮어쓰지 않는다.
 * saveDocumentLocal(레거시 견적서/계약서/청구서 업로드)과 법인 문서함 기능이 이 함수를 공유한다.
 *
 * @param {Object} params
 * @param {'rental'|'as'} params.businessLine
 * @param {string} params.companySubfolderName - 법인 하위 폴더명 (Company.folderName 또는 법인명)
 * @param {string} params.docType - RENT_DOC_TYPE_ROOT_FOLDER의 키 (매핑 없으면 "법인명/문서종류" 구조로 저장)
 * @param {string} params.fileName - 저장할 파일명 (확장자 포함)
 * @param {Buffer} params.fileBuffer
 * @returns {{ fileName: string, localPath: string }} 실제 저장된 파일명(중복 시 버전 접미사 포함)과 절대 경로
 */
/**
 * 계약자 폴더와 그 안의 문서 폴더들을 만든다. 이미 있으면 그대로 둔다.
 *
 * 계약을 등록하는 순간 만들어 두면, 나중에 계약서·청구서·정비 자료를 넣을 자리가 미리 잡힌다.
 * 폴더 이름은 계약자명만 쓴다. 결제일 같은 값을 앞에 붙이면 그 값이 바뀔 때 폴더를 옮겨야 하고,
 * 그러면 이미 저장된 파일 경로가 전부 틀어진다.
 *
 * @param {string} partyName 계약자명 (법인이면 법인명)
 * @returns {{root: string, created: boolean}} 만들어진 계약자 폴더 경로
 */
export const ensureCustomerFolders = async (partyName) => {
  const root = ['RENT', sanitizePathSegment(partyName)];
  const created = await ensureFolder(root);

  for (const folder of CUSTOMER_DOC_FOLDERS) {
    await ensureFolder([...root, folder]);
  }
  return { root: root.join('/'), created };
};


/**
 * 계약 폴더 이름을 만든다. "계약번호_차종_N대" 형태다.
 *
 * 계약번호만으로는 폴더를 열어 보기 전까지 무슨 차가 몇 대인지 알 수 없어 함께 적는다.
 * 한 계약에 차종이 섞여 있으면(20대 중 밴이 섞이는 식) 가장 많은 차종에 "외 N종"을 붙인다.
 * 대수는 한 대뿐이어도 적는다. 모든 폴더가 같은 모양이라야 목록에서 눈으로 훑기 쉽다.
 *
 * 예: 21100001_Ray Van_20대 / 21110022_Ray 외 1종_2대 / 22030013_K9_1대
 *
 * @param {string} contractNo 계약번호
 * @param {Array<{carModel?: string}>} vehicles 계약에 묶인 차량
 * @returns {string} 폴더 이름
 */
export const buildContractFolderName = (contractNo, vehicles = []) => {
  const no = String(contractNo || '계약번호미상').trim();
  const models = vehicles.map((v) => (v.carModel || '').trim()).filter(Boolean);
  if (!vehicles.length) return sanitizePathSegment(no);
  if (!models.length) return sanitizePathSegment(`${no}_${vehicles.length}대`);

  // 가장 많이 나온 차종을 대표로 쓴다
  const count = new Map();
  models.forEach((m) => count.set(m, (count.get(m) || 0) + 1));
  const [top] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  const kinds = count.size;
  const label = kinds > 1 ? `${top} 외 ${kinds - 1}종` : top;
  return sanitizePathSegment(`${no}_${label}_${vehicles.length}대`);
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
 * @returns {{fileName: string, localPath: string}|null} 찾은 계약서
 */
export const findContractDocument = async (partyName, contractNo) => {
  if (!partyName) return null;

  const dir = ['RENT', sanitizePathSegment(partyName), '01.계약서'];
  const no = contractNo ? String(contractNo).trim() : '';

  // 계약서는 계약 폴더('26060149_GV80_1대') 안에 넣는다. 계약이 여러 건인 법인이 많아
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
 * 계약자 폴더 안의 문서 폴더에 파일을 저장한다.
 *
 * @param {object} params
 * @param {string} params.partyName 계약자명 (폴더명)
 * @param {string} params.docFolder CUSTOMER_DOC_FOLDERS 중 하나 (예: '02.청구서')
 * @param {string} [params.subFolder] 그 아래 한 단계 더 (예: 계약번호)
 * @param {string} params.fileName 저장할 파일명
 * @param {Buffer} params.fileBuffer 파일 내용
 * @returns {{fileName: string, localPath: string}}
 */
export const saveToCustomerFolder = async ({ partyName, docFolder, subFolder, fileName, fileBuffer, keepPrevious = false }) => {
  const segments = ['RENT', sanitizePathSegment(partyName), docFolder];
  if (subFolder) segments.push(sanitizePathSegment(subFolder));
  segments.push(sanitizePathSegment(fileName));

  // 기본은 덮어쓰기다. 같은 회차를 다시 저장하면 최종본 한 장만 남는 편이 찾기 쉽다.
  // keepPrevious를 준 경우(이미 메일로 보낸 회차)에만 이전 파일을 남긴다. 보낸 청구서는
  // 고객이 받은 그 문서라, 사라지면 나중에 무엇을 보냈는지 댈 수 없다.
  const saved = await uploadFile(segments, fileBuffer, { keepPrevious });

  // localPath라는 이름은 예전 이름 그대로 둔다. 화면과 DB가 이 이름으로 경로를 보여 준다.
  return { fileName: saved.fileName, localPath: saved.path, webUrl: saved.webUrl };
};


export const saveFileLocally = async ({ businessLine, companySubfolderName, docType, fileName, fileBuffer }) => {
  const businessDir = businessLine === 'rental' ? 'RENT' : 'AS';
  const docRootFolder = businessLine === 'rental' ? RENT_DOC_TYPE_ROOT_FOLDER[docType] : null;
  const companySubfolder = sanitizePathSegment(companySubfolderName);

  const segments = docRootFolder
    ? [businessDir, docRootFolder, companySubfolder]
    : [businessDir, companySubfolder, sanitizePathSegment(docType)];
  segments.push(sanitizePathSegment(fileName));

  // 법인 서류는 같은 이름으로 다시 올리는 일이 잦고(재발급 사업자등록증 등)
  // 이전 것도 남겨 둬야 해서 새 이름으로 저장한다.
  const saved = await uploadFile(segments, fileBuffer, { keepPrevious: true });

  return { fileName: saved.fileName, localPath: saved.path, webUrl: saved.webUrl };
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
  const looksLocal = /^[a-zA-Z]:[\/]/.test(target) || target.startsWith('/');
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

/**
 * 계약자 폴더 안에 계약별 폴더를 만든다. ('가나상사/01.계약서/26060149_GV80_1대')
 *
 * 계약이 여러 건인 법인이 많아 계약서를 계약 폴더로 나눠 담는다.
 *
 * @param {string} partyName 계약자명
 * @param {string} contractFolderName buildContractFolderName이 만든 폴더 이름
 * @returns {Promise<string>} 만들어진 폴더 경로
 */
export const ensureContractFolder = async (partyName, contractFolderName) => {
  const segments = ['RENT', sanitizePathSegment(partyName), '01.계약서', sanitizePathSegment(contractFolderName)];
  await ensureFolder(segments);
  return segments.join('/');
};
