import { getGraphAccessToken } from './graphAuth.js';

/**
 * OneDrive에 파일을 직접 올리고 읽는다.
 *
 * 예전에는 서버가 자기 컴퓨터의 'OneDrive - CEO' 폴더에 파일을 썼다. 사장님 PC에서 켤 때는
 * 그 폴더가 실제 OneDrive라 동기화됐지만, 서버(Heroku)에서는 그런 폴더가 없어 서버 안에
 * 가짜 폴더를 만들었고, 서버가 재시작되면(하루 한 번 이상) 그 파일이 전부 사라졌다.
 *
 * 이제 Microsoft에 직접 올린다. 서버가 어디에 있든 사장님 OneDrive에 그대로 쌓이고,
 * 집·회사·직원 PC 어디서나 탐색기로 열어 볼 수 있다.
 */

const GRAPH = 'https://graph.microsoft.com/v1.0';

// Graph의 단순 업로드(PUT) 한도. 이보다 크면 업로드 세션을 따로 열어야 한다.
const MAX_SIMPLE_UPLOAD_BYTES = 4 * 1024 * 1024;

const EXTENSION_MIME = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.hwp': 'application/x-hwp',
  '.txt': 'text/plain'
};

/** 파일 이름에서 종류를 알아낸다. 모르면 그냥 바이트로 보낸다. */
export const mimeTypeOf = (fileName) => {
  const dot = String(fileName || '').lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  return EXTENSION_MIME[String(fileName).slice(dot).toLowerCase()] || 'application/octet-stream';
};

const targetAccount = () => {
  const email = process.env.OUTLOOK_TARGET_EMAIL;
  if (!email) {
    throw new Error('OUTLOOK_TARGET_EMAIL 환경변수가 없습니다. OneDrive 계정을 설정해 주세요.');
  }
  return email;
};

/** 'RENT/법인명/02.청구서' 같은 경로를 주소로 바꾼다 */
const encodePath = (segments) => segments.filter(Boolean).map(encodeURIComponent).join('/');

const request = async (url, options = {}) => {
  const token = await getGraphAccessToken();
  return fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
};

/**
 * 파일을 올린다. 중간 폴더는 OneDrive가 알아서 만든다.
 *
 * @param {string[]} segments 경로 조각. 마지막이 파일명이다. 예: ['RENT','가나상사','02.청구서','1월.pdf']
 * @param {Buffer} buffer 파일 내용
 * @param {object} [options]
 * @param {boolean} [options.keepPrevious=false] true면 같은 이름이 있을 때 덮어쓰지 않고 새 이름으로 남긴다
 * @returns {Promise<{fileName: string, path: string, webUrl: string, id: string}>}
 */
export const uploadFile = async (segments, buffer, { keepPrevious = false } = {}) => {
  if (!buffer || buffer.length === 0) {
    throw new Error('올릴 파일 내용이 비어 있습니다.');
  }
  if (buffer.length > MAX_SIMPLE_UPLOAD_BYTES) {
    throw new Error('파일이 4MB를 넘습니다. 현재는 4MB 이하만 올릴 수 있습니다.');
  }

  const fileName = segments[segments.length - 1];
  // replace: 같은 이름이면 덮어쓴다(최종본 한 장만 남는 편이 찾기 쉽다)
  // rename: 이미 보낸 청구서처럼 이전 파일을 남겨야 할 때. OneDrive가 '파일 1.pdf'처럼 번호를 붙인다.
  const conflict = keepPrevious ? 'rename' : 'replace';
  const url = `${GRAPH}/users/${targetAccount()}/drive/root:/${encodePath(segments)}:/content`
    + `?@microsoft.graph.conflictBehavior=${conflict}`;

  const res = await request(url, {
    method: 'PUT',
    headers: { 'Content-Type': mimeTypeOf(fileName) },
    body: buffer
  });

  if (!res.ok) {
    throw new Error(`OneDrive 저장 실패: ${(await res.text()).slice(0, 300)}`);
  }

  const item = await res.json();
  return {
    fileName: item.name,
    // 사람이 보고 어디에 저장됐는지 알 수 있는 경로. 화면에서 그대로 보여 준다.
    path: [...segments.slice(0, -1), item.name].join('/'),
    webUrl: item.webUrl,
    id: item.id
  };
};

/**
 * 폴더를 만든다. 이미 있으면 그대로 둔다.
 * @param {string[]} segments 만들 폴더까지의 경로
 * @returns {Promise<boolean>} 이번에 새로 만들었으면 true
 */
export const ensureFolder = async (segments) => {
  const name = segments[segments.length - 1];
  const parent = segments.slice(0, -1);
  const parentPath = parent.length ? `root:/${encodePath(parent)}:` : 'root';

  const res = await request(`${GRAPH}/users/${targetAccount()}/drive/${parentPath}/children`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      folder: {},
      // 이미 있으면 실패로 알려 준다. 그래야 '새로 만들었는지'를 구분할 수 있다.
      '@microsoft.graph.conflictBehavior': 'fail'
    })
  });

  if (res.ok) return true;
  if (res.status === 409) return false; // 이미 있음

  throw new Error(`OneDrive 폴더 생성 실패(${name}): ${(await res.text()).slice(0, 200)}`);
};

/**
 * 폴더 안의 항목을 나열한다. 폴더가 없으면 빈 배열.
 * @param {string[]} segments 폴더 경로
 */
export const listChildren = async (segments) => {
  const res = await request(`${GRAPH}/users/${targetAccount()}/drive/root:/${encodePath(segments)}:/children?$top=200`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`OneDrive 목록 조회 실패: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  return (data.value || []).map((item) => ({
    name: item.name,
    isFolder: Boolean(item.folder),
    id: item.id,
    size: item.size,
    lastModified: item.lastModifiedDateTime
  }));
};

/**
 * 파일 내용을 받아 온다.
 * @param {string} itemId listChildren이 준 id
 * @returns {Promise<Buffer>}
 */
export const downloadById = async (itemId) => {
  const res = await request(`${GRAPH}/users/${targetAccount()}/drive/items/${itemId}/content`);
  if (!res.ok) throw new Error(`OneDrive 파일 읽기 실패: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
};

/** OneDrive를 쓸 수 있는 상태인지(계정 설정 여부). 설정이 없으면 저장 기능을 건너뛴다. */
export const isOneDriveConfigured = () => Boolean(process.env.OUTLOOK_TARGET_EMAIL);

/**
 * 경로로 파일 내용을 받아 온다.
 * @param {string} filePath 'RENT/가나상사/02.청구서/1월.pdf' 형태
 * @returns {Promise<Buffer>}
 */
export const downloadByPath = async (filePath) => {
  const segments = String(filePath || '').split('/').filter(Boolean);
  if (!segments.length) throw new Error('받을 파일 경로가 비어 있습니다.');

  const res = await request(`${GRAPH}/users/${targetAccount()}/drive/root:/${encodePath(segments)}:/content`);
  if (!res.ok) throw new Error(`OneDrive 파일 읽기 실패: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
};
