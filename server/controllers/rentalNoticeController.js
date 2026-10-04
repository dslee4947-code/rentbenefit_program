import crypto from 'crypto';
import RentalNotice, { RENTAL_NOTICE_HANDLINGS, RENTAL_NOTICE_STATUSES, RENTAL_NOTICE_FINISHED } from '../models/RentalNotice.js';
import BillingSchedule from '../models/BillingSchedule.js';
import { saveDocument, readSavedFile } from '../utils/documentStorageService.js';
import { mimeTypeOf } from '../utils/oneDriveStorage.js';
import { ACCIDENT_RENTAL_PARTY } from '../utils/accidentRentalCompany.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';

// 화면에서 고칠 수 있는 항목. 파일 경로·지문은 올릴 때만 정해진다.
const EDITABLE = [
  'plateNo', 'rentalRecord', 'rentalType', 'customerName', 'customerContact', 'insuranceCompany',
  'kind', 'amount', 'occurredAt', 'violationTime', 'noticeNo', 'noticeDueDate',
  'handling', 'status', 'paidByUsAt', 'memo'
];

const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const dateOrUndefined = (v) => (v ? new Date(v) : undefined);

/**
 * 같은 고지서가 장기렌트 청구서나 대차 고지서에 이미 올라가 있는지 본다.
 *
 * 한 장이 두 곳에 들어가면 장기렌트 고객과 대차 고객에게 모두 청구된다.
 * 파일 지문은 다시 스캔하면 달라지므로 고지번호를 먼저 본다.
 *
 * @returns {Promise<string>} 이미 있으면 어디에 있는지 적은 문장, 없으면 빈 값
 */
const findDuplicate = async ({ noticeNo, fileHash, excludeId, plateNo, occurredAt, amount }) => {
  const or = [{ fileHash }];
  if (noticeNo) or.push({ noticeNo });
  // 고지번호가 없는 서식은 재스캔하면 파일 지문도 달라진다. 차량·위반일·금액이 모두 같으면 같은 건으로 본다.
  if (plateNo && occurredAt && Number(amount) > 0) or.push({ plateNo, occurredAt: new Date(occurredAt), amount: Number(amount) });
  const own = await RentalNotice.findOne({ $or: or, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).lean();
  if (own) return `이미 대차 고지서로 올라가 있습니다. (${own.plateNo} · ${own.kind} · ${own.fileName || ''})`;

  const longOr = [{ 'rounds.attachments.fileHash': fileHash }];
  if (noticeNo) longOr.push({ 'rounds.attachments.noticeNo': noticeNo });
  const schedule = await BillingSchedule.findOne({ $or: longOr }).populate('contract', 'contractNo leaseCompany').lean();
  if (schedule) {
    return `이미 장기렌트 청구서에 붙어 있습니다. (${schedule.contract?.leaseCompany || ''} ${schedule.contract?.contractNo || ''})`;
  }
  return '';
};

/**
 * 대차 고지서 목록. 기본은 아직 끝나지 않은 건만 준다.
 *
 * @route GET /api/rental-notices?all=1
 */
export const listRentalNotices = async (req, res) => {
  try {
    const filter = req.query.all ? {} : { status: { $nin: RENTAL_NOTICE_FINISHED } };
    const items = await RentalNotice.find(filter).sort({ noticeDueDate: 1, createdAt: -1 }).limit(500).lean();
    res.json({ success: true, items, handlings: RENTAL_NOTICE_HANDLINGS, statuses: RENTAL_NOTICE_STATUSES });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 대차 고지서를 올린다. 파일은 렌트베네핏 폴더의 고지서 폴더에 차량번호별로 저장한다.
 *
 * @route POST /api/rental-notices
 */
export const createRentalNotice = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '올릴 파일이 없습니다.' });
    const plateNo = String(req.body.plateNo || '').replace(/\s+/g, '');
    if (!plateNo) return res.status(400).json({ success: false, message: '차량번호를 적어 주세요.' });

    const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const noticeNo = String(req.body.noticeNo || '').trim();
    const duplicate = await findDuplicate({
      noticeNo, fileHash, plateNo, occurredAt: req.body.occurredAt, amount: req.body.amount
    });
    if (duplicate) return res.status(409).json({ success: false, duplicate: true, message: duplicate });

    const kind = String(req.body.kind || '과태료').trim();
    const ext = (req.file.originalname.match(/\.[^.]+$/) || ['.pdf'])[0];
    // 차량번호_위반일_종류: 같은 차의 고지서가 폴더에서 날짜순으로 늘어선다
    const fileName = `${plateNo}_${ymd(req.body.occurredAt) || '위반일미상'}_${kind}${ext}`;
    const saved = await saveDocument({
      partyName: ACCIDENT_RENTAL_PARTY.name,
      kind: 'notice',
      subFolder: plateNo,
      fileName,
      fileBuffer: req.file.buffer,
      keepPrevious: true // 같은 차·같은 날 고지서가 두 장이면 이름이 같다. 덮어쓰지 않고 이름을 바꿔 남긴다
    });

    const notice = await RentalNotice.create({
      plateNo,
      vehicle: req.body.vehicleId || undefined,
      rentalRecord: req.body.rentalRecord || undefined,
      rentalType: req.body.rentalType || '',
      customerName: req.body.customerName || '',
      customerContact: req.body.customerContact || '',
      insuranceCompany: req.body.insuranceCompany || '',
      kind,
      amount: Number(req.body.amount) || 0,
      surcharge: Number(req.body.surcharge) || 0,
      occurredAt: dateOrUndefined(req.body.occurredAt),
      violationTime: req.body.violationTime || '',
      noticeNo,
      noticeDueDate: dateOrUndefined(req.body.noticeDueDate),
      handling: RENTAL_NOTICE_HANDLINGS.includes(req.body.handling) ? req.body.handling : '고객청구',
      fileName: saved.fileName,
      savedPath: saved.localPath,
      fileHash,
      uploadedBy: req.user?.name || req.user?.email || ''
    });

    logActivity({
      req, dept: '차량관리부', action: ACTIONS.NOTICE_REGISTER,
      target: { model: 'RentalNotice', id: notice._id },
      summary: `대차 ${kind} 고지서 등록 (${plateNo}${notice.customerName ? ` · ${notice.customerName}` : ''})`,
      meta: { kind, amount: notice.amount, noticeDueDate: notice.noticeDueDate, rental: true }
    });

    res.json({ success: true, notice, message: `대차 고지서로 올렸습니다. (${plateNo} · ${kind})` });
  } catch (error) {
    // 같은 고지번호를 동시에 두 번 올리면 유일 색인에서 걸린다
    if (error.code === 11000) {
      return res.status(409).json({ success: false, duplicate: true, message: '같은 고지번호의 고지서가 이미 올라가 있습니다.' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 대차 고지서의 값을 고친다(고객·금액·처리 방식·진행 단계 등).
 *
 * @route PATCH /api/rental-notices/:id
 */
export const updateRentalNotice = async (req, res) => {
  try {
    const notice = await RentalNotice.findById(req.params.id);
    if (!notice) return res.status(404).json({ success: false, message: '고지서를 찾을 수 없습니다.' });

    for (const key of EDITABLE) {
      if (req.body[key] === undefined) continue;
      if (key === 'handling' && !RENTAL_NOTICE_HANDLINGS.includes(req.body[key])) continue;
      if (key === 'status' && !RENTAL_NOTICE_STATUSES.includes(req.body[key])) continue;
      notice[key] = req.body[key] === '' && ['rentalRecord', 'occurredAt', 'noticeDueDate', 'paidByUsAt'].includes(key)
        ? undefined
        : req.body[key];
    }
    // 끝난 날을 남긴다. 되돌리면 지운다.
    if (req.body.status !== undefined) {
      notice.settledAt = RENTAL_NOTICE_FINISHED.includes(notice.status) ? (notice.settledAt || new Date()) : undefined;
    }
    if (req.body.noticeNo !== undefined && notice.noticeNo) {
      const duplicate = await findDuplicate({ noticeNo: notice.noticeNo, fileHash: notice.fileHash, excludeId: notice._id });
      if (duplicate) return res.status(409).json({ success: false, duplicate: true, message: duplicate });
    }
    await notice.save();
    res.json({ success: true, notice });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, duplicate: true, message: '같은 고지번호의 고지서가 이미 있습니다.' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 목록에서 뺀다. OneDrive에 저장한 파일은 지우지 않는다(잘못 지워도 원본은 남게).
 *
 * @route DELETE /api/rental-notices/:id
 */
export const deleteRentalNotice = async (req, res) => {
  try {
    const notice = await RentalNotice.findByIdAndDelete(req.params.id);
    if (!notice) return res.status(404).json({ success: false, message: '고지서를 찾을 수 없습니다.' });
    res.json({ success: true, message: '목록에서 뺐습니다. 저장된 파일은 남아 있습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 고지서 원본을 연다.
 *
 * @route GET /api/rental-notices/:id/file
 */
export const getRentalNoticeFile = async (req, res) => {
  try {
    const notice = await RentalNotice.findById(req.params.id).lean();
    if (!notice?.savedPath) return res.status(404).json({ success: false, message: '저장된 파일이 없습니다.' });
    const buffer = await readSavedFile(notice.savedPath);
    if (!buffer) return res.status(410).json({ success: false, message: '파일이 OneDrive에서 옮겨졌거나 지워져 열 수 없습니다.' });
    const fileName = notice.fileName || 'file';
    res.setHeader('Content-Type', mimeTypeOf(fileName));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
