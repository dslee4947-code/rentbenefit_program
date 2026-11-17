import CarAgeFiling from '../models/CarAgeFiling.js';
import VehicleService from '../models/VehicleService.js';
import Vehicle from '../models/Vehicle.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';
import { CAR_AGE_STATUSES, DEFAULT_CAR_AGE_APPLICANT } from '../../shared/carAgeFiling.js';

/**
 * 사업용자동차 차령조정 신청서 (영업 > 증차·감차 공문 > 차령연장 신청서 탭, 대표님 2026-11-17).
 * 별지 제55호서식 앞쪽·뒤쪽과 별첨 차량 목록을 한 건으로 저장한다.
 * 후보 차량은 정비·검사 기록에서 [차령 연장 신청]을 체크한 자동차검사(carAgeExtended)로 찾는다.
 */
const userName = (req) => req.user?.name || req.user?.email || '';
const kstYmd = (d) => {
  if (!d) return '';
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? '' : new Date(t.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
};
// "더 뉴 기아 레이 가솔린 1.0" → "레이"처럼 앞머리를 떼어 차명 칸을 짧게
const shortCarName = (model) => String(model || '')
  .replace(/^(디\s*올\s*뉴|더\s*뉴|올\s*뉴|뉴)\s+/, '')
  .replace(/^(현대|기아|제네시스)\s+/, '')
  .split(/\s+/)[0] || '';

const cleanApplicant = (a = {}) => Object.fromEntries(
  Object.keys(DEFAULT_CAR_AGE_APPLICANT).map((k) => [k, String(a[k] ?? DEFAULT_CAR_AGE_APPLICANT[k] ?? '').trim()])
);

const cleanItems = (list) => (Array.isArray(list) ? list : [])
  .map((it) => ({
    vehicle: /^[a-f\d]{24}$/i.test(String(it.vehicle || '')) ? it.vehicle : undefined,
    carName: String(it.carName || '').trim(),
    plateNo: String(it.plateNo || '').replace(/\s+/g, ''),
    passedAt: /^\d{4}-\d{2}-\d{2}$/.test(String(it.passedAt || '')) ? it.passedAt : '',
    note: String(it.note || '').trim()
  }))
  .filter((it) => it.plateNo);

// 차령 연장으로 검사받은 차 중 아직 신청서에 안 들어간 차 (최근 1년)
const candidatesOf = async (filings) => {
  const since = new Date(Date.now() - 365 * 24 * 3600e3);
  const records = await VehicleService.find({ kind: '자동차검사', carAgeExtended: true, date: { $gte: since } })
    .populate('vehicle', 'plateNo carModel status')
    .select('vehicle date')
    .sort({ date: -1 })
    .lean();
  const used = new Set(filings.filter((f) => f.status !== '취소').flatMap((f) => (f.items || []).map((it) => it.plateNo)));
  const seen = new Set();
  const out = [];
  for (const r of records) {
    const v = r.vehicle;
    if (!v?.plateNo || v.status === '거래완료' || used.has(v.plateNo) || seen.has(v.plateNo)) continue;
    seen.add(v.plateNo);
    out.push({ vehicle: v._id, plateNo: v.plateNo, carName: shortCarName(v.carModel), carModel: v.carModel, passedAt: kstYmd(r.date), status: v.status });
  }
  return out;
};

export const getCarAgeFilings = async (req, res) => {
  try {
    const filings = await CarAgeFiling.find().sort({ filedAt: -1, createdAt: -1 }).lean();
    const [candidates, vehicles] = await Promise.all([
      candidatesOf(filings),
      Vehicle.find({ status: { $in: ['장기렌트', '단기렌트', '재고'] }, plateNo: { $nin: [null, ''] } }).select('plateNo carModel').lean()
    ]);
    res.json({
      success: true,
      filings,
      candidates,
      vehicles: vehicles.map((v) => ({ vehicle: v._id, plateNo: v.plateNo, carName: shortCarName(v.carModel), carModel: v.carModel })),
      defaults: { applicant: { ...DEFAULT_CAR_AGE_APPLICANT, ...(filings[0]?.applicant || {}) } }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const bodyOf = (b) => ({
  filedAt: b.filedAt ? new Date(b.filedAt) : new Date(),
  applicant: cleanApplicant(b.applicant),
  items: cleanItems(b.items),
  stamp: b.stamp !== false,
  memo: String(b.memo || '')
});

export const createCarAgeFiling = async (req, res) => {
  try {
    const filing = await CarAgeFiling.create({ ...bodyOf(req.body), createdBy: userName(req), updatedBy: userName(req) });
    logActivity({ req, dept: '영업부', action: ACTIONS.FLEET_FILING, target: { model: 'CarAgeFiling', id: filing._id }, summary: `차령조정 신청서 작성: ${filing.items.length}대` });
    res.json({ success: true, filing });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateCarAgeFiling = async (req, res) => {
  try {
    const filing = await CarAgeFiling.findById(req.params.id);
    if (!filing) return res.status(404).json({ success: false, message: '신청서를 찾을 수 없습니다.' });
    if (filing.status === '처리완료') return res.status(400).json({ success: false, message: '처리 완료된 신청서는 고칠 수 없습니다. 먼저 되돌려 주세요.' });
    Object.assign(filing, bodyOf(req.body), { updatedBy: userName(req) });
    await filing.save();
    res.json({ success: true, filing });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const setCarAgeFilingStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!CAR_AGE_STATUSES.includes(status)) return res.status(400).json({ success: false, message: '알 수 없는 상태입니다.' });
    const filing = await CarAgeFiling.findById(req.params.id);
    if (!filing) return res.status(404).json({ success: false, message: '신청서를 찾을 수 없습니다.' });
    filing.status = status;
    if (status === '제출' && !filing.submittedAt) filing.submittedAt = new Date();
    if (status === '처리완료') filing.processedAt = req.body.processedAt ? new Date(req.body.processedAt) : new Date();
    if (status !== '처리완료') filing.processedAt = undefined;
    filing.updatedBy = userName(req);
    await filing.save();
    logActivity({ req, dept: '영업부', action: ACTIONS.FLEET_FILING, target: { model: 'CarAgeFiling', id: filing._id }, summary: `차령조정 신청서 ${status}: ${filing.items.length}대` });
    res.json({ success: true, filing });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteCarAgeFiling = async (req, res) => {
  try {
    const filing = await CarAgeFiling.findById(req.params.id);
    if (!filing) return res.status(404).json({ success: false, message: '신청서를 찾을 수 없습니다.' });
    if (filing.status === '처리완료') return res.status(400).json({ success: false, message: '처리 완료된 신청서는 지울 수 없습니다.' });
    await CarAgeFiling.deleteOne({ _id: filing._id });
    logActivity({ req, dept: '영업부', action: ACTIONS.FLEET_FILING, target: { model: 'CarAgeFiling', id: filing._id }, summary: `차령조정 신청서 삭제: ${filing.items.length}대` });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
