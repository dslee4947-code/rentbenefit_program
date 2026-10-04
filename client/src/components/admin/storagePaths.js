const API_HOST = import.meta.env.VITE_API_BASE_URL || '';

/**
 * "저장 위치: ..." 처럼 화면에 경로를 적어 주는 곳에서 쓰는 값.
 *
 * 예전에는 화면마다 'RENT\{계약자}\02.청구서'를 글자로 박아 뒀다. 그래서 설정에서 폴더 이름을
 * 바꾸면 실제 저장 위치와 화면에 적힌 위치가 달라졌고, 담당자가 없는 폴더를 찾아 헤맸다.
 *
 * 설정은 거의 바뀌지 않아 한 번만 받아 두고 모든 화면이 나눠 쓴다.
 */
let pending = null;

/** 저장 경로 설정을 받아 온다. 읽지 못하면 null (화면은 경로 안내만 생략한다) */
export const loadStorageSettings = () => {
  if (!pending) {
    pending = fetch(`${API_HOST}/api/settings/document-storage`)
      .then((res) => res.json())
      .then((data) => (data.success ? data.settings : null))
      .catch(() => null);
  }
  return pending;
};

/** 설정을 바꾼 뒤 다시 받아 오게 한다 */
export const resetStorageSettingsCache = () => {
  pending = null;
};

/**
 * 장기렌트 단계의 폴더 경로를 탐색기에서 보이는 모양으로 만든다.
 *
 * @param {object|null} settings loadStorageSettings가 준 값
 * @param {object} params
 * @param {string} params.partyName 법인명
 * @param {string} params.kind 문서 종류 코드 ('invoice', 'contract' 등)
 * @param {string} [params.subFolder] 계약 폴더
 * @returns {string} 'RENT\장기렌트\신흥정보통신㈜\02.청구서\21100001\' (설정이 없으면 빈 문자열)
 */
export const contractFolderPath = (settings, { partyName, kind, subFolder }) => {
  if (!settings) return '';

  const parts = [
    settings.rootFolder,
    settings.stageFolders?.contract,
    partyName,
    settings.folders?.[kind]
  ].filter(Boolean);

  if (subFolder && settings.useContractSubfolder) parts.push(subFolder);
  return `${parts.join('\\')}\\`;
};
