import ContractTemplate from '../models/ContractTemplate.js';
import ContractTemplateFile from '../models/ContractTemplateFile.js';
import ContractDocument from '../models/ContractDocument.js';
import Contract from '../models/Contract.js';
import { parseContractTemplate, extractTemplateMedia } from '../utils/contractTemplateParser.js';
import { ensureContractDocument, refreshContractDocument } from '../utils/contractDocumentValues.js';
import { looksLikeResidentRegistrationNumber } from '../utils/validators.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';

const KIND = '장기렌트';
// 목록에서는 무거운 해석 결과(칸·글상자·원문)를 빼고 보낸다
const LIST_FIELDS = '-sheets -styles -pages -clauses';

const userName = (req) => req.user?.name || req.user?.email || '';
const fileNameOf = (f) => Buffer.from(f.originalname || '', 'latin1').toString('utf8');

// 주민등록번호는 어떤 칸에도 저장하지 않는다(하이픈 없이 13자리로 적어도 막는다)
const hasResidentNo = (values) => Object.values(values || {}).some((v) => {
  const s = String(v || '').trim();
  const withDash = /^\d{13}$/.test(s) ? `${s.slice(0, 6)}-${s.slice(6)}` : s;
  return looksLikeResidentRegistrationNumber(withDash);
});

// ───────────────────────── 양식 ─────────────────────────

/** @route GET /api/contract-templates */
export const listTemplates = async (req, res) => {
  try {
    const templates = await ContractTemplate.find({ kind: KIND }).select(LIST_FIELDS).sort({ version: -1 }).lean();
    const counts = await ContractDocument.aggregate([{ $group: { _id: '$template', n: { $sum: 1 } } }]);
    const used = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json({ success: true, templates: templates.map((t) => ({ ...t, documentCount: used.get(String(t._id)) || 0 })) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** @route GET /api/contract-templates/:id  (계약서 화면을 그릴 때 쓰는 전체) */
export const getTemplate = async (req, res) => {
  try {
    const t = await ContractTemplate.findById(req.params.id).lean();
    if (!t) return res.status(404).json({ success: false, message: '양식을 찾을 수 없습니다.' });
    res.json({ success: true, template: t });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 엑셀 양식을 올린다. 새 버전으로 쌓이고, 그 종류의 첫 양식이면 바로 '사용 중'이 된다.
 * 같은 파일(내용이 한 글자도 같은 파일)을 다시 올리면 새로 만들지 않는다.
 * @route POST /api/contract-templates  (form-data: file, name, note)
 */
export const uploadTemplate = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '엑셀 파일(.xlsx)을 골라 주세요.' });
    const fileName = fileNameOf(req.file);
    if (!/\.xlsx$/i.test(fileName)) return res.status(400).json({ success: false, message: '.xlsx 파일만 올릴 수 있습니다.' });

    let parsed;
    try {
      parsed = parseContractTemplate(req.file.buffer, fileName);
    } catch (err) {
      return res.status(400).json({ success: false, message: `엑셀을 읽지 못했습니다: ${err.message}` });
    }
    if (!parsed.fields.length) {
      return res.status(400).json({ success: false, message: "입력 칸('법인정보' 시트)을 찾지 못했습니다. 전자계약서 양식이 맞는지 확인해 주세요." });
    }

    const same = await ContractTemplate.findOne({ kind: KIND, sha256: parsed.sha256 }).select(LIST_FIELDS).lean();
    if (same) {
      return res.status(409).json({ success: false, message: `같은 파일이 이미 올라가 있습니다 (버전 ${same.version} · ${same.name}).`, template: same });
    }

    const last = await ContractTemplate.findOne({ kind: KIND }).sort({ version: -1 }).select('version').lean();
    const version = (last?.version || 0) + 1;
    const anyActive = await ContractTemplate.exists({ kind: KIND, active: true });
    const template = await ContractTemplate.create({
      name: String(req.body.name || '').trim() || fileName.replace(/\.xlsx$/i, ''),
      kind: KIND,
      version,
      fileName,
      sha256: parsed.sha256,
      size: req.file.size,
      active: !anyActive,
      note: req.body.note || '',
      uploadedBy: userName(req),
      sheets: parsed.sheets,
      styles: parsed.styles,
      fields: parsed.fields,
      pages: parsed.pages,
      clauses: parsed.clauses,
      media: parsed.media,
      stats: parsed.stats
    });
    await ContractTemplateFile.create({ template: template._id, data: req.file.buffer });

    await logActivity({
      req, dept: '계약·출고부', action: ACTIONS.CONTRACT_TEMPLATE, target: { model: 'ContractTemplate', id: template._id },
      summary: `전자계약서 양식 버전 ${version} 등록 (${fileName}) · 약관 ${parsed.stats.clauses}개 조항 · ${parsed.stats.textChars.toLocaleString()}자`
    });
    const { sheets, styles, pages, clauses, ...summary } = template.toObject();
    res.status(201).json({ success: true, template: summary, message: `양식 버전 ${version}을 올렸습니다.${template.active ? ' 새 계약서부터 이 양식을 씁니다.' : ''}` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** 이 양식을 새 계약서에 쓰도록 정한다. @route PATCH /api/contract-templates/:id/activate */
export const activateTemplate = async (req, res) => {
  try {
    const t = await ContractTemplate.findById(req.params.id).select('kind version name');
    if (!t) return res.status(404).json({ success: false, message: '양식을 찾을 수 없습니다.' });
    await ContractTemplate.updateMany({ kind: t.kind, _id: { $ne: t._id } }, { $set: { active: false } });
    t.active = true;
    await t.save();
    await logActivity({ req, dept: '계약·출고부', action: ACTIONS.CONTRACT_TEMPLATE, target: { model: 'ContractTemplate', id: t._id }, summary: `전자계약서 양식 버전 ${t.version} 사용 시작` });
    res.json({ success: true, message: `버전 ${t.version}을 새 계약서에 씁니다. 이미 만든 계약서는 그대로입니다.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 양식 그림은 바뀌지 않으므로 서버 메모리에 담아 둔다
const mediaCache = new Map();
/** @route GET /api/contract-templates/:id/media?path=xl/media/image2.png */
export const getTemplateMedia = async (req, res) => {
  try {
    const path = String(req.query.path || '');
    if (!/^xl\/media\/[\w.-]+$/.test(path)) return res.status(400).json({ message: '그림 경로가 올바르지 않습니다.' });
    const key = `${req.params.id}:${path}`;
    let data = mediaCache.get(key);
    if (!data) {
      const file = await ContractTemplateFile.findOne({ template: req.params.id }).lean();
      if (!file) return res.status(404).json({ message: '양식 파일이 없습니다.' });
      data = extractTemplateMedia(Buffer.from(file.data.buffer || file.data), path);
      if (!data) return res.status(404).json({ message: '그림을 찾을 수 없습니다.' });
      mediaCache.set(key, data);
    }
    const ext = path.split('.').pop().toLowerCase();
    res.set('Content-Type', ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/** 엑셀 원본 내려받기. @route GET /api/contract-templates/:id/file */
export const downloadTemplateFile = async (req, res) => {
  try {
    const t = await ContractTemplate.findById(req.params.id).select('fileName').lean();
    const file = await ContractTemplateFile.findOne({ template: req.params.id }).lean();
    if (!t || !file) return res.status(404).json({ message: '양식 파일이 없습니다.' });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(t.fileName || 'contract.xlsx')}`);
    res.send(Buffer.from(file.data.buffer || file.data));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ───────────────────────── 계약서 ─────────────────────────

const DOC_POPULATE = {
  path: 'contract',
  select: 'contractNo status partyType customer companyId contractDate termMonths',
  populate: [{ path: 'customer', select: 'name' }, { path: 'companyId', select: 'name' }]
};

/** @route GET /api/contract-documents?contract=ID  (contract가 없으면 최근 목록) */
export const listDocuments = async (req, res) => {
  try {
    if (req.query.contract) {
      const doc = await ContractDocument.findOne({ contract: req.query.contract }).populate(DOC_POPULATE).lean();
      return res.json({ success: true, document: doc || null });
    }
    const docs = await ContractDocument.find({}).sort({ updatedAt: -1 }).limit(300).populate(DOC_POPULATE).lean();
    res.json({ success: true, documents: docs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** @route GET /api/contract-documents/:id */
export const getDocument = async (req, res) => {
  try {
    const doc = await ContractDocument.findById(req.params.id).populate(DOC_POPULATE).lean();
    if (!doc) return res.status(404).json({ success: false, message: '계약서를 찾을 수 없습니다.' });
    res.json({ success: true, document: doc });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** 계약의 전자계약서를 만든다(있으면 그것). @route POST /api/contract-documents  { contractId } */
export const createDocument = async (req, res) => {
  try {
    const contract = await Contract.findById(req.body.contractId).select('_id contractNo').lean();
    if (!contract) return res.status(404).json({ success: false, message: '계약을 찾을 수 없습니다.' });
    const existed = await ContractDocument.exists({ contract: contract._id });
    const doc = await ensureContractDocument(contract._id, { user: req.user });
    if (!doc) return res.status(400).json({ success: false, message: '사용 중인 계약서 양식이 없습니다. 계약서 양식 화면에서 엑셀 양식을 먼저 올려 주세요.' });
    if (!existed) {
      await logActivity({ req, dept: '계약·출고부', action: ACTIONS.CONTRACT_TEMPLATE, target: { model: 'ContractDocument', id: doc._id }, summary: `전자계약서 작성 시작 (${contract.contractNo})` });
    }
    const populated = await ContractDocument.findById(doc._id).populate(DOC_POPULATE).lean();
    res.status(existed ? 200 : 201).json({ success: true, document: populated });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 입력 칸을 고친다. 고친 칸은 'manual'로 표시해 다시 불러오기에서 덮지 않는다.
 * @route PATCH /api/contract-documents/:id  { values: {key: text}, documentDate }
 */
export const updateDocument = async (req, res) => {
  try {
    const doc = await ContractDocument.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: '계약서를 찾을 수 없습니다.' });
    if (doc.status === '확정') return res.status(409).json({ success: false, message: '확정된 계약서입니다. [확정 풀기]를 누른 뒤 고쳐 주세요.' });
    const incoming = req.body.values || {};
    if (hasResidentNo(incoming)) {
      return res.status(400).json({ success: false, message: '주민등록번호는 저장할 수 없습니다. 개인 고객은 그 칸을 비워 두고 서명 때 직접 적게 해 주세요.' });
    }
    const values = { ...(doc.values || {}) };
    const sources = { ...(doc.sources || {}) };
    for (const [key, raw] of Object.entries(incoming)) {
      const v = raw === null || raw === undefined ? '' : String(raw);
      if ((values[key] || '') === v) continue;
      values[key] = v;
      sources[key] = 'manual';
    }
    doc.values = values;
    doc.sources = sources;
    if (req.body.documentDate) doc.documentDate = new Date(req.body.documentDate);
    doc.updatedBy = userName(req);
    doc.markModified('values');
    doc.markModified('sources');
    await doc.save();
    res.json({ success: true, document: await ContractDocument.findById(doc._id).populate(DOC_POPULATE).lean(), message: '저장했습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 계약·견적·고객·차량 정보를 다시 읽어 빈칸을 채운다. 직원이 고친 칸(manual)은 그대로 둔다.
 * @route POST /api/contract-documents/:id/refresh
 */
export const refreshDocument = async (req, res) => {
  try {
    const doc = await ContractDocument.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: '계약서를 찾을 수 없습니다.' });
    if (doc.status === '확정') return res.status(409).json({ success: false, message: '확정된 계약서는 다시 불러오지 않습니다.' });
    const { changed } = await refreshContractDocument(doc, { userName: userName(req) });
    res.json({ success: true, document: await ContractDocument.findById(doc._id).populate(DOC_POPULATE).lean(), message: changed ? `${changed}칸을 계약 정보로 다시 채웠습니다.` : '바뀐 칸이 없습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** @route POST /api/contract-documents/:id/confirm  { reopen: true면 확정 풀기 } */
export const confirmDocument = async (req, res) => {
  try {
    const doc = await ContractDocument.findById(req.params.id).populate('contract', 'contractNo');
    if (!doc) return res.status(404).json({ success: false, message: '계약서를 찾을 수 없습니다.' });
    const reopen = Boolean(req.body.reopen);
    doc.status = reopen ? '작성중' : '확정';
    doc.confirmedAt = reopen ? undefined : new Date();
    doc.confirmedBy = reopen ? undefined : userName(req);
    await doc.save();
    await logActivity({
      req, dept: '계약·출고부', action: ACTIONS.CONTRACT_TEMPLATE, target: { model: 'ContractDocument', id: doc._id },
      summary: `전자계약서 ${reopen ? '확정 풀기' : '확정'} (${doc.contract?.contractNo || ''})`
    });
    res.json({ success: true, document: await ContractDocument.findById(doc._id).populate(DOC_POPULATE).lean(), message: reopen ? '다시 고칠 수 있습니다.' : '계약서를 확정했습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
