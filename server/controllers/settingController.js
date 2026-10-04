import Setting from '../models/Setting.js';
import {
  DOC_KINDS,
  STAGES,
  PATTERN_TOKENS,
  DEFAULT_SETTINGS,
  getDocumentSettings,
  mergeSettings,
  buildPreview,
  invalidateSettingsCache
} from '../utils/documentPath.js';

const SETTING_KEY = 'documentStorage';

/**
 * 문서 저장 경로 설정을 읽는다.
 *
 * 설정값만 주면 화면에서 폴더 목록을 다시 만들어야 해서, 문서 종류·쓸 수 있는 값·미리보기를
 * 함께 준다. 화면과 서버가 같은 규칙으로 경로를 만들도록 미리보기도 서버에서 만든다.
 *
 * @route GET /api/settings/document-storage
 */
export const getDocumentStorageSetting = async (req, res) => {
  try {
    const settings = await getDocumentSettings();
    res.json({
      success: true,
      settings,
      stages: STAGES,
      kinds: DOC_KINDS,
      tokens: PATTERN_TOKENS,
      defaults: DEFAULT_SETTINGS,
      preview: buildPreview(settings)
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 설정을 저장한다.
 *
 * 폴더 이름을 바꿔도 이미 저장된 파일은 옮기지 않는다. 파일을 옮기면 DB에 남긴 경로가
 * 전부 틀어져 예전 청구서를 메일에 붙이지 못한다. 앞으로 저장하는 것부터 새 이름을 쓴다.
 *
 * @route PUT /api/settings/document-storage
 */
export const updateDocumentStorageSetting = async (req, res) => {
  try {
    const merged = mergeSettings(req.body?.settings);

    const invalid = validate(merged);
    if (invalid) return res.status(400).json({ success: false, message: invalid });

    await Setting.findOneAndUpdate(
      { key: SETTING_KEY },
      { value: merged, updatedBy: req.user?.name || req.user?.email || '' },
      { upsert: true, new: true }
    );
    invalidateSettingsCache();

    res.json({
      success: true,
      settings: merged,
      preview: buildPreview(merged),
      message: '저장 경로를 바꿨습니다. 앞으로 저장하는 파일부터 새 규칙을 씁니다.'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 저장하기 전에 결과만 미리 본다.
 *
 * 규칙을 고치는 중에 "이렇게 저장됩니다"를 바로 보여 줘야, 저장하고 나서야 이름이
 * 이상한 걸 알아채는 일이 없다.
 *
 * @route POST /api/settings/document-storage/preview
 */
export const previewDocumentStorageSetting = async (req, res) => {
  try {
    const merged = mergeSettings(req.body?.settings);
    res.json({ success: true, preview: buildPreview(merged), warning: validate(merged) || '' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 저장을 막아야 할 설정인지 본다.
 * @returns {string} 문제가 있으면 그 이유, 없으면 빈 문자열
 */
const validate = (settings) => {
  if (!String(settings.rootFolder || '').trim()) return '최상위 폴더 이름을 비울 수 없습니다.';

  // 견적 단계와 계약 단계는 폴더가 갈려 있어야 한다. 같은 이름을 쓰면 고객 이름 폴더와
  // 법인 이름 폴더가 한 자리에 섞여, 어느 쪽 서류인지 이름만 보고는 알 수 없다.
  const stageNames = new Map();
  for (const stage of STAGES) {
    const folder = String(settings.stageFolders[stage.code] || '').trim();
    if (!folder) return `'${stage.label}' 폴더 이름을 비울 수 없습니다.`;
    if (stageNames.has(folder)) {
      return `'${stageNames.get(folder)}'와 '${stage.label}'이 같은 폴더(${folder})를 씁니다. 서로 다른 이름을 넣어 주세요.`;
    }
    stageNames.set(folder, stage.label);
  }

  // 두 문서 종류가 같은 폴더를 가리키면 서류가 섞인다. 나중에 어느 것이 계약서인지 알 수 없다.
  // 견적서는 폴더를 만들지 않고 고객 이름 폴더에 바로 담기므로 이 검사에서 뺀다.
  const used = new Map();
  for (const kind of DOC_KINDS.filter((k) => !k.flat)) {
    const folder = String(settings.folders[kind.code] || '').trim();
    if (!folder) return `'${kind.label}' 폴더 이름을 비울 수 없습니다.`;
    if (used.has(folder)) return `'${used.get(folder)}'와 '${kind.label}'이 같은 폴더(${folder})를 씁니다. 서로 다른 이름을 넣어 주세요.`;
    used.set(folder, kind.label);
  }

  // 파일명 규칙에서 계약자·회차를 빼면 청구서가 서로 덮인다
  if (!String(settings.fileNames.invoice || '').includes('{회차}')) {
    return '청구서 파일명에는 {회차}가 있어야 합니다. 없으면 회차마다 파일이 서로 덮입니다.';
  }
  if (!String(settings.fileNames.invoiceAttachment || '').includes('{회차}')) {
    return '청구서 첨부 파일명에는 {회차}가 있어야 합니다.';
  }
  if (settings.useContractSubfolder && !String(settings.contractFolderPattern || '').includes('{계약번호}')) {
    return '계약 폴더 이름에는 {계약번호}가 있어야 합니다. 없으면 계약을 구분하지 못합니다.';
  }
  return '';
};
