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
import { MAINTENANCE_RATES_KEY, invalidateMaintenanceRatesCache } from '../utils/maintenanceRates.js';
import { computeInternalRate } from '../../shared/companyFunding.js';

const COMPANY_FUNDING_KEY = 'companyFunding';
import {
  DEFAULT_MAINTENANCE_RATES, VEHICLE_GRADES, MAINTENANCE_ITEMS, mergeMaintenanceRates
} from '../../shared/maintenanceRates.js';

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

// ───────────────────────── 정비 단가표

/**
 * 차종 등급별 정비 단가표를 읽는다. 저장본이 없으면 기본값(근거 포함)을 준다.
 * 견적 화면이 새 견적의 정비 내역을 채울 때와 단가표 화면이 함께 쓴다.
 *
 * @route GET /api/settings/maintenance-rates
 */
export const getMaintenanceRatesSetting = async (req, res) => {
  try {
    const doc = await Setting.findOne({ key: MAINTENANCE_RATES_KEY }).lean();
    res.json({
      success: true,
      rates: mergeMaintenanceRates(doc?.value),
      defaults: DEFAULT_MAINTENANCE_RATES,
      grades: VEHICLE_GRADES,
      items: MAINTENANCE_ITEMS,
      updatedAt: doc?.updatedAt || null,
      updatedBy: doc?.updatedBy || ''
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 단가표를 저장한다. 이미 낸 견적은 그때 단가가 견적서에 함께 저장돼 있어 숫자가 바뀌지 않는다.
 * 렌트차량 DB 이익(견적서가 없는 차)은 다음에 계산할 때부터 새 단가를 쓴다.
 *
 * @route PUT /api/settings/maintenance-rates
 */
export const updateMaintenanceRatesSetting = async (req, res) => {
  try {
    const merged = mergeMaintenanceRates(req.body?.rates);

    // 숫자가 아니거나 음수인 단가는 받지 않는다. 0원은 '해당 없음'(전기차 점화플러그 등)이라 허용한다.
    for (const { key, label } of VEHICLE_GRADES) {
      const grade = merged.grades[key];
      const prices = [...Object.entries(grade.items), ['tire.standard', grade.tire.standard], ['tire.premium', grade.tire.premium], ['tire.alignment', grade.tire.alignment ?? 0]];
      for (const [itemKey, value] of prices) {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) {
          return res.status(400).json({ success: false, message: `${label}의 ${itemKey} 단가가 올바르지 않습니다: ${value}` });
        }
        if (itemKey.startsWith('tire.')) grade.tire[itemKey.slice(5)] = Math.round(n);
        else grade.items[itemKey] = Math.round(n);
      }
    }
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    merged.version = `${today} ${req.user?.name || '관리자'} 수정`;

    const doc = await Setting.findOneAndUpdate(
      { key: MAINTENANCE_RATES_KEY },
      { value: merged, updatedBy: req.user?.name || req.user?.email || '' },
      { upsert: true, new: true }
    ).lean();
    invalidateMaintenanceRatesCache();

    res.json({
      success: true,
      rates: merged,
      updatedAt: doc.updatedAt,
      updatedBy: doc.updatedBy,
      message: '정비 단가표를 저장했습니다. 새로 내는 견적부터 새 단가를 씁니다.'
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ───────────────────────── 회사 자금 (내부 금리)

/**
 * 회사 대출 목록과 내부 금리.
 * 대출 목록(금액·금리)은 관리자만 본다. 다른 사람에게는 손익 원장 계산에 필요한 내부 금리만 준다.
 *
 * @route GET /api/settings/company-funding
 */
export const getCompanyFundingSetting = async (req, res) => {
  try {
    const doc = await Setting.findOne({ key: COMPANY_FUNDING_KEY }).lean();
    const funding = doc?.value || { loans: [], manualRate: null };
    const internal = computeInternalRate(funding);
    const isAdmin = req.user?.role === 'admin';
    res.json({
      success: true,
      internalRate: internal.rate,
      source: internal.source,
      ...(isAdmin ? { funding, updatedAt: doc?.updatedAt || null, updatedBy: doc?.updatedBy || '' } : {})
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** @route PUT /api/settings/company-funding (관리자만) */
export const updateCompanyFundingSetting = async (req, res) => {
  try {
    const body = req.body?.funding || {};
    const loans = (Array.isArray(body.loans) ? body.loans : []).map((l) => ({
      lender: String(l.lender || '').trim(),
      principal: Math.round(Number(l.principal) || 0),
      balance: Math.round(Number(l.balance) || 0),
      annualRate: Number(l.annualRate) || 0,
      startDate: l.startDate || null,
      termMonths: Math.round(Number(l.termMonths) || 0),
      repayment: String(l.repayment || '').trim(),
      memo: String(l.memo || '').trim()
    })).filter((l) => l.lender || l.principal);
    for (const l of loans) {
      if (l.annualRate < 0 || l.annualRate > 0.5) return res.status(400).json({ success: false, message: `${l.lender || '대출'} 금리가 올바르지 않습니다(연 ${l.annualRate * 100}%). 퍼센트가 아니라 소수로 저장됩니다.` });
    }
    const manualRate = body.manualRate === null || body.manualRate === '' || body.manualRate === undefined ? null : Number(body.manualRate);
    const funding = { loans, manualRate: manualRate > 0 ? manualRate : null };
    const doc = await Setting.findOneAndUpdate(
      { key: COMPANY_FUNDING_KEY },
      { value: funding, updatedBy: req.user?.name || req.user?.email || '' },
      { upsert: true, new: true }
    ).lean();
    const internal = computeInternalRate(funding);
    res.json({ success: true, funding, internalRate: internal.rate, source: internal.source, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy, message: '회사 자금 목록을 저장했습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
