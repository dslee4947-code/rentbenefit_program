import fs from 'fs';
import path from 'path';

/**
 * OneDrive 대신 이 컴퓨터의 폴더에 서류를 넣고 꺼낸다. 업무 흐름 점검(scripts/flow-check.js) 전용이다.
 *
 * 흐름 점검은 계약 등록부터 청구서 발행까지 실제 순서대로 돌려 본다. 이때 OneDrive를 그대로 쓰면
 * 시험용 폴더와 청구서가 렌트팀 드라이브에 쌓이고, OneDrive를 끄면 청구서 발행이 실패해 끝까지 볼 수 없다.
 * 그래서 환경 변수 DOCUMENT_STORAGE_DIR을 준 경우에만 이 폴더로 대신 저장한다.
 * 운영 서버에는 이 값을 두지 않는다.
 *
 * oneDriveStorage.js와 같은 이름·같은 모양으로 돌려준다. documentStorageService.js가 둘 중 하나를 고른다.
 */

const rootDir = () => path.resolve(process.env.DOCUMENT_STORAGE_DIR);

// 경로 조각이 '..'로 저장 폴더 밖을 가리키지 못하게 막는다
const resolveInside = (segments) => {
  const root = rootDir();
  const target = path.resolve(root, ...segments.filter(Boolean));
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`저장 폴더 밖의 경로입니다: ${segments.join('/')}`);
  return target;
};

/** 같은 이름이 있으면 OneDrive처럼 '파일 1.pdf', '파일 2.pdf'로 이름을 바꾼다 */
const nextFreeName = (dir, fileName) => {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  let n = 1;
  let candidate = fileName;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${stem} ${n}${ext}`;
    n += 1;
  }
  return candidate;
};

export const uploadFile = async (segments, buffer, { keepPrevious = false } = {}) => {
  if (!buffer || buffer.length === 0) throw new Error('올릴 파일 내용이 비어 있습니다.');

  const dir = resolveInside(segments.slice(0, -1));
  fs.mkdirSync(dir, { recursive: true });
  const requested = segments[segments.length - 1];
  const fileName = keepPrevious ? nextFreeName(dir, requested) : requested;
  fs.writeFileSync(path.join(dir, fileName), buffer);

  const relative = [...segments.slice(0, -1), fileName].join('/');
  return { fileName, path: relative, webUrl: '', id: relative };
};

export const ensureFolder = async (segments) => {
  const dir = resolveInside(segments);
  if (fs.existsSync(dir)) return false;
  fs.mkdirSync(dir, { recursive: true });
  return true;
};

export const listChildren = async (segments) => {
  const dir = resolveInside(segments);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).map((entry) => {
    const stat = fs.statSync(path.join(dir, entry.name));
    return {
      name: entry.name,
      isFolder: entry.isDirectory(),
      id: [...segments, entry.name].join('/'),
      size: stat.size,
      lastModified: stat.mtime.toISOString()
    };
  });
};

export const downloadByPath = async (filePath) => {
  const target = resolveInside(String(filePath || '').split('/'));
  if (!fs.existsSync(target)) throw new Error(`파일이 없습니다: ${filePath}`);
  return fs.readFileSync(target);
};

// 이 저장소에서는 id가 곧 경로다
export const downloadById = downloadByPath;
