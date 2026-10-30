import Setting from '../models/Setting.js';
import FleetFiling from '../models/FleetFiling.js';
import Vehicle from '../models/Vehicle.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';
import { parseFleetWorkbook } from '../utils/fleetFilingImport.js';
import { parseFleetNoticePdf } from '../utils/fleetNoticeParse.js';
import { DEFAULT_FLEET_INFO, FILING_STATUSES, filingSheetOf, applyFilingToCarTypes, carTypeKey } from '../../shared/fleetFiling.js';

/**
 * 증차·감차 공문 (영업 > 증차·감차 공문).
 *
 * 신고 현황(법인 정보·차고지·차종별 신고 대수)은 설정 한 칸(fleetRegistration)에 두고,
 * 공문은 한 건씩 FleetFiling에 둔다. 구청 처리 완료를 누르면 그 공문의 대수를 신고 현황에 더한다.
 */
const KEY = 'fleetRegistration';
const userName = (req) => req.user?.name || req.user?.email || '';
const ymdText = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

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
 * 구청 처리가 끝난 공문: 제출 때 신고 대수를 남겨 두고(없으면 지금 것), 공문의 대수를 신고 현황에 더한다.
 * info.carTypes가 바뀐 값으로 저장된다. filing은 부른 쪽이 저장한다.
 */
const markProcessed = async (filing, info, processedAt, req) => {
  if (!filing.snapshot || !filing.snapshot.length) filing.snapshot = info.carTypes;
  info.carTypes = applyFilingToCarTypes(info.carTypes, filing.items, 1);
  filing.applied = true;
  filing.status = '처리완료';
  filing.processedAt = processedAt || filing.processedAt || new Date();
  await saveInfo(info, req);
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

    if (status === '처리완료' && !filing.applied) {
      await markProcessed(filing, info, req.body.processedAt ? new Date(req.body.processedAt) : null, req);
    } else if (status !== '처리완료' && filing.applied) {
      // 이 공문으로 처음 들어온 차종(제출 때 표에 없던 줄)은 0대가 되면 다시 뺀다
      const before = new Set((filing.snapshot || []).map((t) => carTypeKey(t.name)));
      info.carTypes = applyFilingToCarTypes(info.carTypes, filing.items, -1)
        .filter((t) => t.count > 0 || before.has(carTypeKey(t.name)));
      filing.applied = false;
      filing.processedAt = undefined;
      await saveInfo(info, req);
    }
    if (status !== '작성중' && (!filing.snapshot || !filing.snapshot.length)) filing.snapshot = info.carTypes;
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
            memo: `엑셀(${Buffer.from(req.file.originalname || '', 'latin1').toString('utf8')})에 적힌 변경`,
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

const noticeOf = (parsed, req) => ({
  ...parsed,
  // multer는 파일 이름을 latin1로 읽는다(한글이 깨진다)
  fileName: Buffer.from(req.file.originalname || '', 'latin1').toString('utf8') || '구청 처리 알림.pdf',
  uploadedAt: new Date(),
  uploadedBy: userName(req)
});

const openSummary = (f) => ({ _id: f._id, filedAt: f.filedAt, status: f.status, beforeTotal: f.beforeTotal, afterTotal: f.afterTotal, items: f.items });

/**
 * 구청 "변경등록신청 처리 알림" PDF 올리기(대표님 2026-10-30 "이게 오면 항상 업로드 해줄께 그러면 최신화를 해줘").
 *
 * 알림의 변경 전·후 총대수(141 → 142)로 아직 처리 안 된 공문을 찾아 [구청 처리 완료]로 바꾸고 신고 대수에 더한다.
 * 알림 PDF는 그 공문에 붙여 둔다.
 * - 맞는 공문이 둘 이상이거나 없으면 고르게 돌려준다(filingId로 다시 보낸다).
 * - mode=history: 프로그램 전에 처리된 지난 알림. 대수는 이미 신고 현황에 들어 있어 더하지 않고, 같은 날 처리된 지난 기록에 붙이거나 새 기록으로 남긴다.
 * - 같은 민원번호를 다시 올리면 대수는 다시 더하지 않는다(구청이 고쳐 다시 보낸 알림이면 파일만 바꾼다).
 */
export const uploadFleetNotice = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: '구청 처리 알림 PDF를 골라 주세요.' });
    const parsed = await parseFleetNoticePdf(req.file.buffer);
    const notice = noticeOf(parsed, req);
    const history = req.body.mode === 'history';

    const dup = await FleetFiling.findOne({ 'notice.minwonNo': parsed.minwonNo });
    if (dup && !req.body.filingId) {
      if (dup.notice.noticeNo === parsed.noticeNo) {
        return res.status(409).json({ success: false, message: `이미 올린 알림입니다 (민원 ${parsed.minwonNo}, ${ymdText(dup.filedAt)} 공문).`, filingId: dup._id });
      }
      dup.notice = notice;
      dup.noticeFile = req.file.buffer;
      await dup.save();
      return res.json({ success: true, result: { filingId: dup._id, replaced: true, notice: parsed } });
    }

    const info = await loadInfo();
    let filing = null;
    let applied = false;

    if (req.body.filingId) {
      filing = await FleetFiling.findById(req.body.filingId);
      if (!filing) return res.status(404).json({ success: false, message: '고른 공문을 찾지 못했습니다.' });
    } else if (!history) {
      const open = await FleetFiling.find({ source: '', applied: false, status: { $in: ['제출', '작성중'] } }).sort({ filedAt: -1 });
      const exact = open.filter((f) => f.beforeTotal === parsed.before && f.afterTotal === parsed.after);
      const sameNet = open.filter((f) => f.afterTotal - f.beforeTotal === parsed.after - parsed.before);
      filing = exact.length === 1 ? exact[0] : (!exact.length && sameNet.length === 1 ? sameNet[0] : null);
      if (!filing) {
        return res.status(422).json({
          success: false,
          needPick: true,
          message: open.length
            ? `알림(${parsed.before}대 → ${parsed.after}대)에 딱 맞는 공문을 고르지 못했습니다. 어느 공문의 처리 알림인지 골라 주세요.`
            : `알림(${parsed.before}대 → ${parsed.after}대)에 맞는, 구청에 낸 공문이 없습니다. 공문을 먼저 만들거나, 기록만 남기세요.`,
          notice: parsed,
          candidates: open.map(openSummary)
        });
      }
    } else {
      // 지난 알림: 같은 무렵(앞뒤 7일)에 처리됐고 변경 후 대수가 같은 지난 기록에 붙인다
      const day = 7 * 86400000;
      const near = await FleetFiling.find({
        notice: { $exists: false },
        processedAt: { $gte: new Date(parsed.processedAt - day), $lte: new Date(+parsed.processedAt + day) }
      });
      filing = near.find((f) => f.afterTotal === parsed.after) || null;
    }

    if (!filing) {
      filing = new FleetFiling({
        filedAt: parsed.appliedAt || parsed.processedAt,
        processedAt: parsed.processedAt,
        status: '처리완료',
        applied: true,
        beforeTotal: parsed.before,
        afterTotal: parsed.after,
        memo: parsed.summary,
        source: '구청 처리 알림',
        createdBy: userName(req),
        updatedBy: userName(req)
      });
    } else if (!filing.applied && !filing.source) {
      await markProcessed(filing, info, parsed.processedAt, req);
      withTotals(filing, info);
      applied = true;
    }
    if (!filing.processedAt) filing.processedAt = parsed.processedAt;
    filing.notice = notice;
    filing.noticeFile = req.file.buffer;
    filing.updatedBy = userName(req);
    await filing.save();

    // 구청이 적은 변경 후 대수와 프로그램 신고 대수가 다르면 알린다
    const now = (await loadInfo()).carTypes.reduce((s, t) => s + t.count, 0);
    const mismatch = applied && now !== parsed.after ? { program: now, notice: parsed.after } : null;
    if (!history) {
      logActivity({ req, dept: '영업부', action: ACTIONS.FLEET_FILING, target: { model: 'FleetFiling', id: filing._id }, summary: `구청 처리 알림 반영: 민원 ${parsed.minwonNo} ${parsed.before}대 → ${parsed.after}대` });
    }
    res.json({ success: true, result: { filingId: filing._id, applied, notice: parsed, registered: now, mismatch } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getFleetNoticeFile = async (req, res) => {
  try {
    const filing = await FleetFiling.findById(req.params.id).select('+noticeFile notice');
    if (!filing?.noticeFile) return res.status(404).json({ success: false, message: '붙은 구청 처리 알림이 없습니다.' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filing.notice?.fileName || 'notice.pdf')}`);
    res.send(filing.noticeFile);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
