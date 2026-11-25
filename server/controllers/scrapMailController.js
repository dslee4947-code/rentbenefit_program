import ScrapFiling from '../models/ScrapFiling.js';
import ScrapFilingFile from '../models/ScrapFilingFile.js';
import VehicleRegCert from '../models/VehicleRegCert.js';
import { sendScrapFilingMail } from '../utils/mailService.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';
import { SCRAP_FILE_TYPES, SCRAP_MAIL_LIMIT, certFileName } from '../../shared/scrapFiling.js';

/** 대폐차 신고서의 자동차등록증 첨부와 조합 메일 (대표님 2026-11-25). 메일은 [메일 보내기]를 눌렀을 때만 나간다. */
const userName = (req) => req.user?.name || req.user?.email || '';
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
// multer는 파일 이름을 latin1로 읽는다(한글이 깨진다)
const nameOf = (file) => Buffer.from(file.originalname || '', 'latin1').toString('utf8').replace(/[\\/:*?"<>|\r\n]/g, '_');

export const listScrapFiles = async (req, res) => {
  try {
    res.json({ success: true, files: await ScrapFilingFile.find({ filing: req.params.id }).sort({ createdAt: 1 }).lean() });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const uploadScrapFile = async (req, res) => {
  try {
    const { file } = req;
    if (!file) return res.status(400).json({ success: false, message: '자동차등록증 파일을 골라 주세요.' });
    if (!SCRAP_FILE_TYPES.includes(file.mimetype)) return res.status(400).json({ success: false, message: 'PDF, JPG, PNG 파일만 올릴 수 있습니다.' });
    if (file.size > SCRAP_MAIL_LIMIT) return res.status(400).json({ success: false, message: '파일이 너무 커서 메일에 붙일 수 없습니다. 2.8MB보다 작게 줄여 주세요.' });
    const filing = await ScrapFiling.findById(req.params.id);
    if (!filing) return res.status(404).json({ success: false, message: '신고서를 찾을 수 없습니다. 먼저 저장해 주세요.' });
    const plateNo = String(req.body.plateNo || '').replace(/\s+/g, '');
    const saved = await ScrapFilingFile.create({
      filing: filing._id, plateNo, contentType: file.mimetype, size: file.size, data: file.buffer, uploadedBy: userName(req),
      fileName: plateNo ? certFileName(plateNo, file.mimetype) : nameOf(file)
    });
    const { data, ...rest } = saved.toObject();
    res.json({ success: true, file: rest });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getScrapFile = async (req, res) => {
  try {
    const file = await ScrapFilingFile.findOne({ _id: req.params.fileId, filing: req.params.id }).select('+data');
    if (!file) return res.status(404).json({ success: false, message: '파일을 찾을 수 없습니다.' });
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    res.send(file.data);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteScrapFile = async (req, res) => {
  try {
    await ScrapFilingFile.deleteOne({ _id: req.params.fileId, filing: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/* ── 차량번호별 자동차등록증 ───────────────────────────────── */

export const listRegCerts = async (req, res) => {
  try {
    res.json({ success: true, certs: await VehicleRegCert.find().sort({ plateNo: 1 }).lean() });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const uploadRegCert = async (req, res) => {
  try {
    const { file } = req;
    const plateNo = String(req.body.plateNo || '').replace(/\s+/g, '');
    if (!file) return res.status(400).json({ success: false, message: '파일이 없습니다.' });
    if (!/^\d{2,3}[가-힣]\d{4}$/.test(plateNo)) return res.status(400).json({ success: false, message: '차량번호를 확인해 주세요.' });
    if (!SCRAP_FILE_TYPES.includes(file.mimetype)) return res.status(400).json({ success: false, message: 'PDF, JPG, PNG 파일만 올릴 수 있습니다.' });
    if (file.size > SCRAP_MAIL_LIMIT) return res.status(400).json({ success: false, message: '2.8MB가 넘는 파일입니다.' });
    await VehicleRegCert.findOneAndUpdate({ plateNo }, {
      plateNo, sourceName: String(req.body.sourceName || ''), sourceKey: String(req.body.sourceKey || ''), sourceTime: Number(req.body.sourceTime) || 0,
      contentType: file.mimetype, size: file.size, data: file.buffer, updatedBy: userName(req)
    }, { upsert: true });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getRegCert = async (req, res) => {
  try {
    const cert = await VehicleRegCert.findOne({ plateNo: req.params.plateNo }).select('+data');
    if (!cert) return res.status(404).json({ success: false, message: '등록증이 없습니다.' });
    res.setHeader('Content-Type', cert.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(certFileName(cert.plateNo, cert.contentType))}`);
    res.send(cert.data);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const sendScrapMail = async (req, res) => {
  try {
    const filing = await ScrapFiling.findById(req.params.id);
    if (!filing) return res.status(404).json({ success: false, message: '신고서를 찾을 수 없습니다.' });
    if (!req.file || req.file.mimetype !== 'application/pdf') return res.status(400).json({ success: false, message: '신고서 PDF를 만들지 못했습니다.' });
    const to = String(req.body.to || '').trim();
    const cc = String(req.body.cc || '').trim();
    const subject = String(req.body.subject || '').trim();
    const body = String(req.body.body || '').trim();
    if (!EMAIL.test(to)) return res.status(400).json({ success: false, message: '받는 사람 이메일을 확인해 주세요.' });
    if (cc && !EMAIL.test(cc)) return res.status(400).json({ success: false, message: '참조 이메일을 확인해 주세요. 한 주소만 적을 수 있습니다.' });
    if (!subject || !body) return res.status(400).json({ success: false, message: '제목과 본문을 적어 주세요.' });

    const own = await ScrapFilingFile.find({ filing: filing._id }).select('+data').sort({ createdAt: 1 });
    // 신고서에 따로 올린 등록증이 있으면 그것을, 없으면 등록증 보관함의 것을 붙인다
    const need = filing.items.map((it) => it.before?.plateNo).filter((p) => p && !own.some((f) => f.plateNo === p));
    const stored = need.length ? await VehicleRegCert.find({ plateNo: { $in: need } }).select('+data') : [];
    const files = [
      ...own,
      ...need.map((p) => stored.find((c) => c.plateNo === p)).filter(Boolean)
        .map((c) => ({ fileName: certFileName(c.plateNo, c.contentType), contentType: c.contentType, size: c.size, data: c.data }))
    ];
    const total = req.file.size + files.reduce((s, f) => s + f.size, 0);
    if (total > SCRAP_MAIL_LIMIT) return res.status(400).json({ success: false, message: `첨부를 합친 크기가 ${(total / 1048576).toFixed(1)}MB라 메일로 보낼 수 없습니다(2.8MB까지). 등록증 파일을 줄여 주세요.` });

    const attachments = [
      { fileName: nameOf(req.file), buffer: req.file.buffer, contentType: 'application/pdf' },
      ...files.map((f) => ({ fileName: f.fileName, buffer: Buffer.from(f.data), contentType: f.contentType }))
    ];
    const mail = await sendScrapFilingMail({ to, cc, mailSubject: subject, mailBody: body, files: attachments });

    filing.mails.push({ to, cc, subject: mail.subject, files: attachments.map((a) => a.fileName), sentAt: new Date(), sentBy: userName(req) });
    if (filing.status === '작성중') { filing.status = '제출'; filing.submittedAt = filing.submittedAt || new Date(); }
    filing.updatedBy = userName(req);
    await filing.save();
    logActivity({ req, dept: '영업부', action: ACTIONS.FLEET_FILING, target: { model: 'ScrapFiling', id: filing._id }, summary: `대폐차 신고서 메일 보냄: ${to} (첨부 ${attachments.length}개)` });
    res.json({ success: true, filing });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
