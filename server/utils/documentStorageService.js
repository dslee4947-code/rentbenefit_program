import { getGraphAccessToken } from './graphAuth.js';

/**
 * 사업부(businessLine) -> SharePoint 문서함 최상위 폴더 매핑
 * 렌터카 계약 관련 문서는 RENT 폴더, 신차/리스 AS 관련 문서는 AS 폴더에 저장한다.
 */
const BUSINESS_LINE_FOLDER = {
  rental: 'RENT',
  as: 'AS',
};

const MAX_SIMPLE_UPLOAD_BYTES = 4 * 1024 * 1024; // Graph 단순 업로드(PUT) 한도

// SharePoint/OneDrive 경로에 쓸 수 없는 문자 제거
const sanitizePathSegment = (segment) => {
  return String(segment || '')
    .replace(/[\\/:*?"<>|#%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '미지정';
};

/**
 * PDF(또는 기타) 문서를 회사 SharePoint 문서함의 사업부별/고객사별/문서종류별 폴더에 업로드한다.
 * 사전 준비 필요: SHAREPOINT_SITE_ID 환경변수, Azure 앱에 Sites.ReadWrite.All(or Sites.Selected) 권한 + 관리자 동의.
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

  const siteId = process.env.SHAREPOINT_SITE_ID;
  if (!siteId) {
    throw new Error('SHAREPOINT_SITE_ID 환경변수가 설정되지 않았습니다. SharePoint 사이트 설정 후 다시 시도해주세요.');
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

  const uploadUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${encodedPath}:/content`;

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
    throw new Error(`SharePoint 업로드 실패: ${errorText}`);
  }

  const uploaded = await uploadRes.json();
  return { id: uploaded.id, webUrl: uploaded.webUrl };
};
