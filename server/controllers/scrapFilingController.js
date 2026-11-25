import ScrapFiling from '../models/ScrapFiling.js';
import ScrapFilingFile from '../models/ScrapFilingFile.js';
import Vehicle from '../models/Vehicle.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';
import { SCRAP_STATUSES, scrapCarName } from '../../shared/scrapFiling.js';

/** 대폐차 신고서 (영업 > 증차·감차 공문 > 대폐차 신고 탭, 대표님 2026-11-25). */
const userName = (req) => req.user?.name || req.user?.email || '';
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

const cleanCar = (c) => ({
  vehicle: /^[a-f\d]{24}$/i.test(String(c?.vehicle || '')) ? c.vehicle : undefined,
  carName: String(c?.carName || '').trim(),
  plateNo: String(c?.plateNo || '').replace(/\s+/g, ''),
  vin: String(c?.vin || '').replace(/\s+/g, '').toUpperCase()
});

const bodyOf = (b) => ({
  filedAt: b.filedAt ? new Date(b.filedAt) : new Date(),
  reason: String(b.reason || '').trim(),
  business: String(b.business || '').trim(),
  changedAt: isYmd(b.changedAt) ? b.changedAt : '',
  showDate: !!b.showDate,
  showCheck: !!b.showCheck,
  items: (Array.isArray(b.items) ? b.items : [])
    .map((it) => ({ before: cleanCar(it.before), after: cleanCar(it.after), reason: String(it.reason || '').trim() }))
    .filter((it) => it.before.plateNo || it.after.plateNo),
  memo: String(b.memo || '')
});

const log = (req, filing, what) => logActivity({
  req, dept: '영업부', action: ACTIONS.FLEET_FILING, target: { model: 'ScrapFiling', id: filing._id },
  summary: `대폐차 신고서 ${what}: ${filing.items.map((it) => it.before.plateNo || it.after.plateNo).join(', ')}`
});

export const getScrapFilings = async (req, res) => {
  try {
    const [filings, all] = await Promise.all([
      ScrapFiling.find().sort({ filedAt: -1, createdAt: -1 }).lean(),
      // 이미 팔린 차(거래완료)도 신고 대상이라 상태로 거르지 않는다
      Vehicle.find({ plateNo: { $nin: [null, ''] } }).select('plateNo carModel vin status').sort({ plateNo: 1, updatedAt: -1 }).lean()
    ]);
    // 재렌트로 같은 차가 두세 줄이면 하나만. 운용 중인 줄을 먼저 쓴다.
    const seen = new Map();
    for (const v of all) {
      const key = `${v.plateNo}|${v.vin || ''}`;
      if (!seen.has(key) || (seen.get(key).status === '거래완료' && v.status !== '거래완료')) seen.set(key, v);
    }
    const vehicles = [...seen.values()].map((v) => ({
      vehicle: v._id, plateNo: v.plateNo, vin: v.vin || '', carName: scrapCarName(v.carModel), carModel: v.carModel, status: v.status
    }));
    res.json({ success: true, filings, vehicles });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createScrapFiling = async (req, res) => {
  try {
    const filing = await ScrapFiling.create({ ...bodyOf(req.body), createdBy: userName(req), updatedBy: userName(req) });
    log(req, filing, '작성');
    res.json({ success: true, filing });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateScrapFiling = async (req, res) => {
  try {
    const filing = await ScrapFiling.findById(req.params.id);
    if (!filing) return res.status(404).json({ success: false, message: '신고서를 찾을 수 없습니다.' });
    if (filing.status === '처리완료') return res.status(400).json({ success: false, message: '처리 완료된 신고서는 고칠 수 없습니다. 먼저 되돌려 주세요.' });
    Object.assign(filing, bodyOf(req.body), { updatedBy: userName(req) });
    await filing.save();
    res.json({ success: true, filing });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const setScrapFilingStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!SCRAP_STATUSES.includes(status)) return res.status(400).json({ success: false, message: '알 수 없는 상태입니다.' });
    const filing = await ScrapFiling.findById(req.params.id);
    if (!filing) return res.status(404).json({ success: false, message: '신고서를 찾을 수 없습니다.' });
    filing.status = status;
    if (status === '제출' && !filing.submittedAt) filing.submittedAt = new Date();
    filing.processedAt = status === '처리완료' ? new Date() : undefined;
    filing.updatedBy = userName(req);
    await filing.save();
    log(req, filing, status);
    res.json({ success: true, filing });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteScrapFiling = async (req, res) => {
  try {
    const filing = await ScrapFiling.findById(req.params.id);
    if (!filing) return res.status(404).json({ success: false, message: '신고서를 찾을 수 없습니다.' });
    if (filing.status === '처리완료') return res.status(400).json({ success: false, message: '처리 완료된 신고서는 지울 수 없습니다.' });
    await ScrapFiling.deleteOne({ _id: filing._id });
    await ScrapFilingFile.deleteMany({ filing: filing._id });
    log(req, filing, '삭제');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
