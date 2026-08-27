import path from 'path';
import fs from 'fs';
import { getGraphAccessToken } from './graphAuth.js';

/**
 * 사업부(businessLine) -> SharePoint/OneDrive 문서함 최상위 폴더 매핑
 * 렌터카 계약 관련 문서는 RENT 폴더, 신차/리스 AS 관련 문서는 AS 폴더에 저장한다.
 */
const BUSINESS_LINE_FOLDER = {
  rental: 'RENT',
  as: 'AS',
};

const MAX_SIMPLE_UPLOAD_BYTES = 4 * 1024 * 1024; // Graph 단순 업로드(PUT) 한도

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
  mimeType = 'application/pdf',
}) => {
  const folder = BUSINESS_LINE_FOLDER[businessLine];
  if (!folder) {
    throw new Error(`알 수 없는 사업부입니다: ${businessLine} (rental 또는 as만 허용)`);
  }

  const targetEmail = process.env.OUTLOOK_TARGET_EMAIL;
  if (!targetEmail) {
    throw new Error('OUTLOOK_TARGET_EMAIL 환경변수가 설정되지 않았습니다. OneDrive 계정 설정 후 다시 시도해주세요.');
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    throw new Error('업로드할 파일 내용이 비어 있습니다.');
  }

  if (fileBuffer.length > MAX_SIMPLE_UPLOAD_BYTES) {
    throw new Error('파일이 4MB를 초과합니다. 현재는 4MB 이하 문서만 업로드를 지원합니다.');
  }

  const accessToken = await getGraphAccessToken();

  const pathSegments = [
    folder,
    sanitizePathSegment(customerName),
    sanitizePathSegment(docType),
    sanitizePathSegment(fileName),
  ];
  const encodedPath = pathSegments.map(encodeURIComponent).join('/');

  const uploadUrl = `https://graph.microsoft.com/v1.0/users/${targetEmail}/drive/root:/${encodedPath}:/content`;

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': mimeType,
    },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    const errorText = await uploadRes.text();
    throw new Error(`OneDrive 업로드 실패: ${errorText}`);
  }

  const uploaded = await uploadRes.json();
  return { id: uploaded.id, webUrl: uploaded.webUrl };
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
export const saveFileLocally = ({ businessLine, companySubfolderName, docType, fileName, fileBuffer }) => {
  const oneDriveRoot = getOneDriveRoot();
  const businessDir = businessLine === 'rental' ? 'RENT' : 'AS';
  const docRootFolder = businessLine === 'rental' ? RENT_DOC_TYPE_ROOT_FOLDER[docType] : null;
  const companySubfolder = sanitizePathSegment(companySubfolderName);

  const targetDir = docRootFolder
    ? path.join(oneDriveRoot, businessDir, docRootFolder, companySubfolder)
    : path.join(oneDriveRoot, businessDir, companySubfolder, sanitizePathSegment(docType));

  fs.mkdirSync(targetDir, { recursive: true });

  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);

  let finalFileName = sanitizePathSegment(fileName);
  let counter = 1;
  let targetFilePath = path.join(targetDir, finalFileName);

  while (fs.existsSync(targetFilePath)) {
    finalFileName = sanitizePathSegment(`${baseName}_ver${counter}${ext}`);
    targetFilePath = path.join(targetDir, finalFileName);
    counter++;
  }

  fs.writeFileSync(targetFilePath, fileBuffer);

  return { fileName: finalFileName, localPath: targetFilePath };
};
