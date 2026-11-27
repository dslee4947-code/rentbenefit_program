import ContractTemplate from '../models/ContractTemplate.js';
import ContractTemplateFile from '../models/ContractTemplateFile.js';
import ContractTemplatePdf from '../models/ContractTemplatePdf.js';
import { buildContractPdf, buildGuarantyPdf } from '../utils/contractPdf.js';
import { guarantyInfoOf } from '../utils/guarantyPage.js';
import { sendGuarantyMail } from '../utils/mailService.js';
import ContractDocument from '../models/ContractDocument.js';
import Contract from '../models/Contract.js';
import { parseContractTemplate, extractTemplateMedia } from '../utils/contractTemplateParser.js';
import { ensureContractDocument, refreshContractDocument, loadContractForDocument } from '../utils/contractDocumentValues.js';
import { looksLikeResidentRegistrationNumber } from '../utils/validators.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';
import { buildExtensionValues } from './contractLifecycleController.js';
import { linkCompanyFromDocument } from '../utils/linkCompanyFromDocument.js';

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

/**
 * 양식의 빈 계약서 PDF(엑셀이 만든 원본 모양, 값 칸 비움). 약관 원문 '장별 전체'에서 보여 준다.
 * @route GET /api/contract-templates/:id/pdf
 */
export const getTemplatePdf = async (req, res) => {
  try {
    const base = await ContractTemplatePdf.findOne({ template: req.params.id }).select('blank').lean();
    if (!base) return res.status(404).json({ success: false, message: '이 양식의 PDF가 아직 없습니다. 엑셀이 있는 PC에서 server/scripts/build-contract-pdf-base.js를 실행해 주세요.' });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent('자동차임대차계약서_양식.pdf')}`);
    res.send(Buffer.from(base.blank.buffer || base.blank));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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

// 연대보증서(계약서 맨 뒤 장)에 차량번호·기간·계약일이 필요하다
const GUARANTY_POPULATE = {
  path: 'contract',
  select: 'contractNo contractDate termMonths rentStartDate endDate vehicles vehicle',
  populate: [{ path: 'vehicles', select: 'plateNo' }, { path: 'vehicle', select: 'plateNo' }]
};

const DOC_POPULATE = {
  path: 'contract',
  select: 'contractNo status partyType customer companyId contractDate termMonths rentStartDate endDate vehicles vehicle',
  // 차량번호·기간은 연대보증서(화면 GuarantyDialog)가 쓴다
  populate: [{ path: 'customer', select: 'name' }, { path: 'companyId', select: 'name' },
    { path: 'vehicles', select: 'plateNo carModel' }, { path: 'vehicle', select: 'plateNo carModel' }]
};

/** @route GET /api/contract-documents?contract=ID  (contract가 없으면 최근 목록) */
export const listDocuments = async (req, res) => {
  try {
    if (req.query.contract) {
      const doc = await ContractDocument.findOne({ contract: req.query.contract, extensionPending: { $ne: true } }).populate(DOC_POPULATE).lean();
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
    const existed = await ContractDocument.exists({ contract: contract._id, extensionPending: { $ne: true } });
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
    const incoming = { ...(req.body.values || {}) };
    // 자손은 양식에 두 칸(같은 값). 화면은 하나만 고치므로 둘째 칸도 같이 맞춘다
    if (incoming.personalInjury !== undefined) incoming.personalInjury_2 = incoming.personalInjury;
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
    // 반영 전 연장 계약서는 이전 계약 + 견적 조건으로 다시 채운다(이전 계약 값만 읽으면 계약번호·기간·렌트료가 되돌아간다)
    let fresh;
    if (doc.extensionPending) {
      const prev = await loadContractForDocument(doc.contract);
      if (!prev) return res.status(404).json({ success: false, message: '이전 계약을 찾을 수 없습니다.' });
      fresh = await buildExtensionValues(prev, doc.extensionTerms || {});
    }
    const { changed } = await refreshContractDocument(doc, { userName: userName(req), fresh });
    res.json({ success: true, document: await ContractDocument.findById(doc._id).populate(DOC_POPULATE).lean(), message: changed ? `${changed}칸을 계약 정보로 다시 채웠습니다.` : '바뀐 칸이 없습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 양식·PDF 바탕은 수백 KB~수 MB라 고쳐지지 않은 동안은 서버 메모리에 담아 둔다
const pdfCache = new Map();
const cachedById = async (Model, filter, key) => {
  const head = await Model.findOne(filter).select('_id updatedAt').lean();
  if (!head) return null;
  const k = `${key}:${head._id}:${new Date(head.updatedAt).getTime()}`;
  if (!pdfCache.has(k)) {
    for (const old of [...pdfCache.keys()].filter((x) => x.startsWith(`${key}:${head._id}:`))) pdfCache.delete(old);
    pdfCache.set(k, await Model.findById(head._id).lean());
  }
  return pdfCache.get(k);
};

/**
 * 계약서 PDF. 엑셀이 만든 빈 계약서 PDF 위에 계약 값을 찍는다(utils/contractPdf.js). 모양이 원본 계약서와 같다.
 * @route GET /api/contract-documents/:id/pdf  (?download=1 이면 파일로 받기)
 */
export const getDocumentPdf = async (req, res) => {
  try {
    const doc = await ContractDocument.findById(req.params.id).populate({ path: 'contract', select: 'contractNo' }).lean();
    if (!doc) return res.status(404).json({ success: false, message: '계약서를 찾을 수 없습니다.' });
    const template = await cachedById(ContractTemplate, { _id: doc.template }, 'tpl');
    const base = await cachedById(ContractTemplatePdf, { template: doc.template }, 'base');
    if (!template || !base) {
      return res.status(409).json({ success: false, message: '이 양식의 PDF 바탕이 아직 없습니다. 엑셀이 있는 PC에서 server/scripts/build-contract-pdf-base.js를 실행해 주세요.' });
    }
    // 연장 계약서는 1·2장 위에 '연장 계약 · 이전 계약번호 · 연장 기간 · 보증금 승계'를 찍는다
    const note = doc.extensionTerms?.note;
    const notes = note ? [{ page: 1, text: note }, { page: 2, text: note }] : [];
    const contractNo = doc.values?.contractNo || doc.contract?.contractNo;
    const values = { ...(doc.values || {}), contractNo };
    const pdf = await buildContractPdf({ template, base, values, documentDate: doc.documentDate || doc.createdAt, notes });
    const party = String(values.partyName || '').trim();
    const name = `장기렌트_${party ? `${party}_` : ''}${contractNo || doc._id}${note ? '_연장' : ''}.pdf`.replace(/[\/:*?"<>|]+/g, ' ');
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.from(pdf));
  } catch (error) {
    res.status(500).json({ success: false, message: `PDF를 만들지 못했습니다: ${error.message}` });
  }
};

/**
 * 연대보증서 한 장을 만든다. 화면에서 아직 저장하지 않은 보증인·최고액은 overrides로 받는다.
 * @returns {Promise<{doc: object, info: object, pdf: Uint8Array, name: string}|null>}
 */
const makeGuaranty = async (id, overrides = {}) => {
  const doc = await ContractDocument.findById(id).populate(GUARANTY_POPULATE).lean();
  if (!doc) return null;
  const values = { ...(doc.values || {}), contractNo: doc.values?.contractNo || doc.contract?.contractNo };
  if (overrides.guarantorName !== undefined) values.guarantorName = String(overrides.guarantorName);
  if (overrides.guarantyMax !== undefined) values.guarantyMax = String(overrides.guarantyMax);
  const info = guarantyInfoOf(values, doc.contract, doc.documentDate || doc.createdAt);
  const pdf = await buildGuarantyPdf(info);
  return { doc, values, info, pdf, name: `연대보증서_${info.partyName || ''}_${info.contractNo || doc._id}.pdf` };
};

/**
 * 연대보증서 한 장. 계약서 PDF에는 붙이지 않는다(대표님 2026-11-27).
 * @route GET /api/contract-documents/:id/guaranty-pdf?guarantorName=&guarantyMax=&download=1
 */
export const getGuarantyPdf = async (req, res) => {
  try {
    const made = await makeGuaranty(req.params.id, req.query);
    if (!made) return res.status(404).json({ success: false, message: '계약서를 찾을 수 없습니다.' });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(made.name)}`);
    res.set('Cache-Control', 'no-store');
    res.send(Buffer.from(made.pdf));
  } catch (error) {
    res.status(500).json({ success: false, message: `연대보증서를 만들지 못했습니다: ${error.message}` });
  }
};

/** 연대보증서 메일의 기본 제목·본문. 화면 발송 창이 이 글을 받아 고친 뒤 보낸다. */
export const guarantyMailDraft = (info, values = {}) => ({
  to: values.email || '',
  subject: `[렌트베네핏] 자동차 임대차 계약 연대보증서 (${info.contractNo || ''}) 날인 요청`,
  body: [
    `${info.partyName || ''} 담당자님 안녕하세요, ㈜렌트베네핏입니다.`,
    `자동차 임대차 계약(계약번호 ${info.contractNo || ''}${info.plateNo ? `, 차량 ${info.plateNo}` : ''})의 대표이사 연대보증서를 보내드립니다.`,
    '연대보증은 법에 따라 전자서명으로는 효력이 없어, 종이 원본으로 받고 있습니다(민법 제428조의2).',
    [
      '1. 첨부 PDF를 A4로 출력해 주세요.',
      '2. 보증인(대표이사)께서 보증 최고액을 자필로 적고, 성명·주소·연락처를 쓴 뒤 자필 서명과 개인 인감을 날인해 주세요.',
      '3. 개인 인감증명서(또는 본인서명사실확인서) 1부와 함께 원본을 당사로 보내 주세요(등기 또는 퀵).'
    ].join('\n'),
    '전자계약서(모두싸인) 서명은 따로 진행됩니다. 궁금하신 점은 언제든 연락 주세요.'
  ].join('\n\n')
});

/**
 * 연대보증서를 메일로 보낸다. 담당자가 화면에서 [메일 보내기]를 눌렀을 때만 나간다(자동 발송 없음).
 * @route POST /api/contract-documents/:id/guaranty-mail  { to, cc, subject, body, guarantorName, guarantyMax }
 */
export const sendGuarantyMailHandler = async (req, res) => {
  try {
    const { to, cc, subject, body, guarantorName, guarantyMax } = req.body || {};
    const made = await makeGuaranty(req.params.id, { guarantorName, guarantyMax });
    if (!made) return res.status(404).json({ success: false, message: '계약서를 찾을 수 없습니다.' });
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.test(String(to || '').trim())) return res.status(400).json({ success: false, message: '받는 사람 이메일을 확인해 주세요.' });
    if (cc && !email.test(String(cc).trim())) return res.status(400).json({ success: false, message: '참조 이메일을 확인해 주세요.' });
    const draft = guarantyMailDraft(made.info, made.values);
    const sent = await sendGuarantyMail({
      to: String(to).trim(),
      cc: cc ? String(cc).trim() : undefined,
      mailSubject: subject || draft.subject,
      mailBody: body || draft.body,
      files: [{ fileName: made.name, buffer: Buffer.from(made.pdf), contentType: 'application/pdf' }]
    });
    const sentAt = new Date();
    await ContractDocument.updateOne({ _id: made.doc._id }, { $set: { guarantyMail: { to: sent.to, cc: cc || '', sentAt, by: req.user?.name || '' } } });
    await logActivity({ req, dept: '계약·출고부', action: ACTIONS.CONTRACT_TEMPLATE, target: { model: 'ContractDocument', id: made.doc._id },
      summary: `연대보증서 메일 발송 (${made.info.contractNo} → ${sent.to})` });
    res.json({ success: true, to: sent.to, sentAt });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/** @route GET /api/contract-documents/:id/guaranty-mail  보낼 메일의 기본 받는 사람·제목·본문과 지난 발송 */
export const getGuarantyMailDraft = async (req, res) => {
  try {
    const made = await makeGuaranty(req.params.id, req.query);
    if (!made) return res.status(404).json({ success: false, message: '계약서를 찾을 수 없습니다.' });
    res.json({ success: true, draft: guarantyMailDraft(made.info, made.values), last: made.doc.guarantyMail || null });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 전자계약서를 지운다. 확정된 계약서는 [확정 풀기] 뒤에만 지운다. 계약·서명 완료본은 그대로 둔다.
 * 지운 뒤 같은 계약에서 [계약서 만들기]를 누르면 계약 정보로 새로 만든다.
 * @route DELETE /api/contract-documents/:id
 */
export const deleteDocument = async (req, res) => {
  try {
    const doc = await ContractDocument.findById(req.params.id).populate('contract', 'contractNo');
    if (!doc) return res.status(404).json({ success: false, message: '계약서를 찾을 수 없습니다.' });
    if (doc.status === '확정') return res.status(409).json({ success: false, message: '확정된 계약서입니다. [확정 풀기]를 누른 뒤 지워 주세요.' });
    const contractNo = (doc.extensionPending ? doc.values?.contractNo : '') || doc.contract?.contractNo || '';
    await ContractDocument.deleteOne({ _id: doc._id });
    await logActivity({
      req, dept: '계약·출고부', action: ACTIONS.CONTRACT_TEMPLATE, target: { model: 'ContractDocument', id: doc._id },
      summary: `전자계약서 삭제 (${contractNo}${doc.extensionOf ? ' · 연장' : ''})`
    });
    res.json({ success: true, message: `${contractNo} 전자계약서를 지웠습니다.` });
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
    // 계약에 법인이 빠져 있으면 확정한 계약서의 계약사로 잇는다
    const link = reopen ? { linked: false } : await linkCompanyFromDocument(doc);
    await logActivity({
      req, dept: '계약·출고부', action: ACTIONS.CONTRACT_TEMPLATE, target: { model: 'ContractDocument', id: doc._id },
      summary: `전자계약서 ${reopen ? '확정 풀기' : '확정'} (${doc.contract?.contractNo || ''})${link.linked ? ` · 계약사 ${link.company.name} 연결` : ''}`
    });
    const message = reopen ? '다시 고칠 수 있습니다.'
      : link.linked ? `계약서를 확정했습니다. 계약에 계약사 ${link.company.name}${link.created ? '(새로 등록)' : ''}을(를) 연결했습니다.` : '계약서를 확정했습니다.';
    res.json({ success: true, document: await ContractDocument.findById(doc._id).populate(DOC_POPULATE).lean(), message });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
