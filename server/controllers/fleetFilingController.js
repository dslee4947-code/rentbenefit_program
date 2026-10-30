import Setting from '../models/Setting.js';
import FleetFiling from '../models/FleetFiling.js';
import Vehicle from '../models/Vehicle.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';
import { parseFleetWorkbook } from '../utils/fleetFilingImport.js';
import { DEFAULT_FLEET_INFO, FILING_STATUSES, filingSheetOf, applyFilingToCarTypes, carTypeKey } from '../../shared/fleetFiling.js';

/**
 * 증차·감차 공문 (영업 > 증차·감차 공문).
 *
 * 신고 현황(법인 정보·차고지·차종별 신고 대수)은 설정 한 칸(fleetRegistration)에 두고,
 * 공문은 한 건씩 FleetFiling에 둔다. 구청 처리 완료를 누르면 그 공문의 대수를 신고 현황에 더한다.
 */
const KEY = 'fleetRegistration';
const userName = (req) => req.user?.name || req.user?.email || '';

const loadInfo = async () => {
  const doc = await Setting.findOne({ key: KEY }).lean();
  const v = doc?.value || {};
  return {
    company: { ...DEFAULT_FLEET_INFO.company, ...(v.company || {}) },
    garage: { ...DEFAULT_FLEET_INFO.garage, ...(v.garage || {}) },
    carTypes: Array.isArray(v.carTypes) ? v.carTypes : [],
    updatedAt: doc?.updatedAt || null,
    updatedBy: doc?.updatedBy || ''
  };
};

const saveInfo = async (info, req) => {
  const value = { company: info.company, garage: info.garage, carTypes: info.carTypes };
  await Setting.findOneAndUpdate({ key: KEY }, { value, updatedBy: userName(req) }, { upsert: true });
};

const cleanCarTypes = (list) => (Array.isArray(list) ? list : [])
  .map((t) => ({ name: String(t.name || '').trim(), width: Number(t.width) || 0, length: Number(t.length) || 0, count: Math.max(0, Math.round(Number(t.count) || 0)) }))
  .filter((t) => t.name);

const cleanItems = (list) => (Array.isArray(list) ? list : [])
  .map((it) => ({
    name: String(it.name || '').trim(),
    width: Number(it.width) || undefined,
    length: Number(it.length) || undefined,
    delta: Math.round(Number(it.delta) || 0),
    plates: String(it.plates || '').trim(),
    note: String(it.note || '').trim()
  }))
  .filter((it) => it.name && it.delta);

const cleanContracts = (list) => (Array.isArray(list) ? list : [])
  .map((c) => ({
    maker: c.maker === '기아' ? '기아' : '현대',
    contractNo: String(c.contractNo || '').trim(),
    model: String(c.model || '').trim(),
    color: String(c.color || '').trim(),
    price: Number(c.price) || undefined,
    deliveryFee: Number(c.deliveryFee) || undefined,
    qty: String(c.qty || '').trim() || '1대',
    deposit: Number(c.deposit) || undefined
  }))
  .filter((c) => c.model || c.contractNo);

const withTotals = (filing, info) => {
  const sheet = filingSheetOf(info, filing);
  filing.beforeTotal = sheet.beforeTotal;
  filing.afterTotal = sheet.afterTotal;
};

// 렌트차량 DB에서 상태별 대수. 계약중(아직 출고 전)은 출고되면 증차 공문이 필요한 차다.
const vehicleStats = async () => {
  const rows = await Vehicle.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [r._id || '미정', r.count]));
};

export const getFleetFilings = async (req, res) => {
  try {
    const [info, filings, stats] = await Promise.all([
      loadInfo(),
      FleetFiling.find().sort({ filedAt: -1, createdAt: -1 }).lean(),
      vehicleStats()
    ]);
    res.json({ success: true, info, filings, vehicleStats: stats });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateFleetInfo = async (req, res) => {
  try {
    const info = await loadInfo();
    if (req.body.company) info.company = { ...info.company, ...req.body.company };
    if (req.body.garage) {
      const g = req.body.garage;
      info.garage = {
        ...info.garage,
        ...g,
        area: Number(g.area ?? info.garage.area) || 0,
        requiredArea: Number(g.requiredArea ?? info.garage.requiredArea) || 0,
        reductionRate: Number(g.reductionRate ?? info.garage.reductionRate) || 0,
        contractArea: Number(g.contractArea ?? info.garage.contractArea) || 0
      };
    }
    if (req.body.carTypes) info.carTypes = cleanCarTypes(req.body.carTypes);
    await saveInfo(info, req);
    logActivity({ req, dept: '영업부', action: ACTIONS.FLEET_FILING, summary: `증차·감차 신고 현황 수정 (${info.carTypes.reduce((s, t) => s + t.count, 0)}대)` });
    res.json({ success: true, info: await loadInfo() });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const createFleetFiling = async (req, res) => {
  try {
    const info = await loadInfo();
    const filing = new FleetFiling({
      filedAt: req.body.filedAt ? new Date(req.body.filedAt) : new Date(),
      kind: req.body.kind,
      reason: req.body.reason || '',
      registrationLabel: req.body.registrationLabel || '',
      items: cleanItems(req.body.items),
      contracts: cleanContracts(req.body.contracts),
      memo: req.body.memo || '',
      createdBy: userName(req),
      updatedBy: userName(req)
    });
    withTotals(filing, info);
    await filing.save();
    logActivity({ req, dept: '영업부', action: ACTIONS.FLEET_FILING, target: { model: 'FleetFiling', id: filing._id }, summary: `증차·감차 공문 작성: ${filing.beforeTotal}대 → ${filing.afterTotal}대` });
    res.status(201).json({ success: true, filing });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateFleetFiling = async (req, res) => {
  try {
    const filing = await FleetFiling.findById(req.params.id);
    if (!filing) return res.status(404).json({ success: false, message: '공문을 찾지 못했습니다.' });
    const touchesCounts = req.body.items !== undefined;
    if (filing.applied && touchesCounts) {
      return res.status(400).json({ success: false, message: '구청 처리가 끝나 대수가 이미 반영된 공문입니다. 상태를 제출로 되돌린 뒤 고쳐 주세요.' });
    }
    ['kind', 'reason', 'registrationLabel', 'memo'].forEach((k) => {
      if (req.body[k] !== undefined) filing[k] = req.body[k];
    });
    if (req.body.filedAt) filing.filedAt = new Date(req.body.filedAt);
    if (req.body.processedAt !== undefined) filing.processedAt = req.body.processedAt ? new Date(req.body.processedAt) : undefined;
    if (touchesCounts) filing.items = cleanItems(req.body.items);
    if (req.body.contracts !== undefined) filing.contracts = cleanContracts(req.body.contracts);
    filing.updatedBy = userName(req);
    if (!filing.source) withTotals(filing, await loadInfo());
    await filing.save();
    res.json({ success: true, filing });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

/**
 * 상태 바꾸기.
 * - 작성중 → 제출: 지금 신고 대수를 공문에 찍어 둔다. 나중에 대수가 바뀌어도 낸 서류는 그대로 다시 뽑힌다.
 * - → 처리완료: 공문의 대수를 신고 현황에 더한다.
 * - 처리완료 → 다른 상태: 더했던 대수를 뺀다(잘못 누른 것을 되돌리기).
 */
export const setFleetFilingStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!FILING_STATUSES.includes(status)) return res.status(400).json({ success: false, message: '알 수 없는 상태입니다.' });
    const filing = await FleetFiling.findById(req.params.id);
    if (!filing) return res.status(404).json({ success: false, message: '공문을 찾지 못했습니다.' });
    if (filing.source) return res.status(400).json({ success: false, message: '엑셀 등록현황에서 옮긴 지난 기록은 상태를 바꾸지 않습니다.' });

    const info = await loadInfo();
    if (status === '작성중') filing.snapshot = undefined;
    else if (!filing.snapshot || !filing.snapshot.length) filing.snapshot = info.carTypes;

    if (status === '처리완료' && !filing.applied) {
      info.carTypes = applyFilingToCarTypes(info.carTypes, filing.items, 1);
      filing.applied = true;
      filing.processedAt = req.body.processedAt ? new Date(req.body.processedAt) : (filing.processedAt || new Date());
      await saveInfo(info, req);
    } else if (status !== '처리완료' && filing.applied) {
      // 이 공문으로 처음 들어온 차종(제출 때 표에 없던 줄)은 0대가 되면 다시 뺀다
      const before = new Set((filing.snapshot || []).map((t) => carTypeKey(t.name)));
      info.carTypes = applyFilingToCarTypes(info.carTypes, filing.items, -1)
        .filter((t) => t.count > 0 || before.has(carTypeKey(t.name)));
      filing.applied = false;
      filing.processedAt = undefined;
      await saveInfo(info, req);
    }
    filing.status = status;
    filing.updatedBy = userName(req);
    withTotals(filing, info);
    await filing.save();
    logActivity({ req, dept: '영업부', action: ACTIONS.FLEET_FILING, target: { model: 'FleetFiling', id: filing._id }, summary: `증차·감차 공문 ${status}: ${filing.beforeTotal}대 → ${filing.afterTotal}대` });
    res.json({ success: true, filing, info: await loadInfo() });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const deleteFleetFiling = async (req, res) => {
  try {
    const filing = await FleetFiling.findById(req.params.id);
    if (!filing) return res.status(404).json({ success: false, message: '공문을 찾지 못했습니다.' });
    if (filing.applied && !filing.source) {
      return res.status(400).json({ success: false, message: '대수가 반영된 공문입니다. 상태를 제출로 되돌린 뒤 지워 주세요.' });
    }
    await filing.deleteOne();
    logActivity({ req, dept: '영업부', action: ACTIONS.FLEET_FILING, target: { model: 'FleetFiling', id: filing._id }, summary: '증차·감차 공문 삭제' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const PLATE = /\d{2,3}\s?[가-힣]\s?\d{4}/;
// 'G90(101하5090)' → 'G90'. '그랜저(H)'처럼 괄호가 차종 이름의 일부면 그대로 둔다.
const nameWithoutPlate = (name) => {
  const m = name.match(/^(.*?)\(([^)]*)\)$/);
  return m && PLATE.test(m[2]) && m[1].trim() ? m[1].trim() : name;
};

/**
 * 엑셀 올리기.
 * 증차공문 엑셀이면 신고 현황(법인·차고지·차종별 대수)을 엑셀 값으로 바꾸고, 엑셀에 적어 둔 이번 변경(AA열)이 있으면 작성중 공문을 만든다.
 * 구청 등록현황 엑셀이면 지난 처리 기록을 옮긴다(같은 날·같은 구분은 한 건, 이미 옮긴 것은 건너뜀).
 */
export const importFleetWorkbook = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '엑셀 파일을 골라 주세요.' });
    const parsed = parseFleetWorkbook(req.file.buffer);
    const result = { carTypes: 0, total: 0, draft: null, history: 0 };

    if (parsed.info) {
      const before = await Setting.findOne({ key: KEY }).lean();
      if (before) await Setting.findOneAndUpdate({ key: `${KEY}.backup` }, { value: before.value, updatedBy: userName(req) }, { upsert: true });
      await saveInfo(parsed.info, req);
      result.carTypes = parsed.info.carTypes.length;
      result.total = parsed.info.carTypes.reduce((s, t) => s + t.count, 0);

      if (parsed.pending.length) {
        const open = await FleetFiling.findOne({ status: { $in: ['작성중', '제출'] }, source: '' }).lean();
        if (!open) {
          const filing = new FleetFiling({
            filedAt: new Date(),
            items: parsed.pending,
            contracts: parsed.contract ? [parsed.contract] : [],
            memo: `엑셀(${req.file.originalname || ''})에 적힌 변경`,
            createdBy: userName(req),
            updatedBy: userName(req)
          });
          withTotals(filing, parsed.info);
          await filing.save();
          result.draft = filing._id;
        }
      }
    }

    if (parsed.history.length) {
      const groups = new Map();
      parsed.history.forEach((h) => {
        const key = `${h.date.toISOString().slice(0, 10)}|${h.kind}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(h);
      });
      for (const [key, rows] of groups) {
        const importKey = `등록현황|${key}|${rows.map((r) => r.name).join(',')}`;
        if (await FleetFiling.exists({ importKey })) continue;
        const sign = rows[0].kind === '감차' ? -1 : 1;
        const afterTotal = rows[rows.length - 1].total;
        await FleetFiling.create({
          filedAt: rows[0].date,
          processedAt: rows[0].date,
          kind: '증차·감차',
          status: '처리완료',
          applied: true,
          items: rows.map((r) => ({ name: nameWithoutPlate(r.name), delta: sign, plates: (r.name.match(PLATE) || [''])[0] })),
          afterTotal: afterTotal ?? undefined,
          beforeTotal: afterTotal != null ? afterTotal - sign * rows.length : undefined,
          memo: rows.map((r) => r.name).join(', '),
          source: '구청 등록현황 엑셀',
          importKey,
          createdBy: userName(req),
          updatedBy: userName(req)
        });
        result.history += 1;
      }
    }

    logActivity({ req, dept: '영업부', action: ACTIONS.FLEET_FILING, summary: `증차공문 엑셀 올림: 차종 ${result.carTypes}개 ${result.total}대, 지난 기록 ${result.history}건` });
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
