import CalendarInbox from '../models/CalendarInbox.js';
import VehicleService from '../models/VehicleService.js';
import Vehicle from '../models/Vehicle.js';
import Setting from '../models/Setting.js';
import { SERVICE_KINDS } from '../utils/vehicleServicePlan.js';
import { hasResult, isOpenRecord, SAME_JOB_DAYS } from '../utils/serviceBooking.js';
import { syncVehicleServiceSchedules } from '../utils/vehicleServiceScheduleJob.js';
import { syncCalendarInbox, refreshInboxSuggestions } from '../utils/calendarInboxSync.js';
import { isGoogleCalendarConfigured } from '../utils/googleCalendar.js';
import { logActivity, ACTIONS } from '../utils/activityLog.js';

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const kstYmd = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const num = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

/**
 * 캘린더 '확인 대기' 목록. 옮긴 뒤 캘린더에서 고치거나 지운 일정도 함께 보여 준다.
 *
 * @route GET /api/vehicle-services/calendar-inbox
 */
export const getCalendarInbox = async (req, res) => {
  try {
    // 화면에서 방금 적은 기록도 바로 '이미 기록 있음'으로 보이게 열 때마다 다시 맞춘다
    await refreshInboxSuggestions();
    const items = await CalendarInbox.find({
      $or: [{ status: { $in: ['대기', '번호없음'] } }, { status: '옮김', $or: [{ changedAfterImport: true }, { eventDeleted: true }] }]
    })
      .populate('vehicle', 'plateNo carModel status')
      .sort({ start: -1 })
      .limit(300)
      .lean();
    const state = await Setting.findOne({ key: 'googleCalendarSync' }).lean();
    res.json({
      success: true,
      configured: isGoogleCalendarConfigured(),
      lastSyncAt: state?.value?.lastSyncAt || null,
      items,
      kinds: SERVICE_KINDS
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 지금 캘린더를 읽는다. 정기 작업을 기다리지 않고 직원이 바로 확인할 때.
 *
 * @route POST /api/vehicle-services/calendar-inbox/sync
 */
export const syncCalendarInboxNow = async (req, res) => {
  try {
    const r = await syncCalendarInbox();
    if (r.skipped) return res.status(400).json({ success: false, message: r.reason });
    const waiting = await CalendarInbox.countDocuments({ status: { $in: ['대기', '번호없음'] } });
    res.json({ success: true, ...r, message: `구글 일정을 읽었습니다. 지난번 뒤로 바뀐 일정 ${r.read}건, 그중 새 정비 일정 ${r.waiting + r.noPlate}건. 확인 대기는 모두 ${waiting}건입니다.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 확인 대기 일정을 정비 기록으로 옮긴다. 종류를 여럿 고르면 종류마다 기록을 하나씩 둔다
 * (일괄 이관과 같게, 둘째부터 calendarEventId 뒤에 '#종류'). 금액은 첫 기록에만 넣는다.
 *
 * @route POST /api/vehicle-services/calendar-inbox/:id/import
 * 같은 종류로 잡아 둔 '예정' 기록이 앞뒤 14일 안에 있으면 새로 만들지 않고 그 기록을 채운다(2026-11-25).
 * reuseDone: 이미 끝난 같은 종류 기록이 있으면 새로 만들지 않고 잇기만 한다(목록의 [완료 기록]).
 *
 * @body {vehicleId?, kinds[], date?, reuseDone?, amount?, mileageIn?, mileageOut?, shop?, request?, description?}
 */
export const importCalendarInbox = async (req, res) => {
  try {
    const item = await CalendarInbox.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: '일정을 찾을 수 없습니다.' });
    if (item.status === '옮김') return res.status(400).json({ success: false, message: '이미 옮긴 일정입니다.' });
    const b = req.body || {};
    const vehicle = await Vehicle.findById(b.vehicleId || item.vehicle).select('plateNo currentMileage').lean();
    if (!vehicle) return res.status(400).json({ success: false, message: '차량을 골라 주세요.' });
    const kinds = [...new Set((Array.isArray(b.kinds) ? b.kinds : item.parsed?.kinds || []).filter((k) => SERVICE_KINDS.includes(k)))];
    if (!kinds.length) return res.status(400).json({ success: false, message: '종류를 골라 주세요.' });

    const ymd = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? b.date : kstYmd(item.start || new Date());
    const p = item.parsed || {};
    const pick = (key) => (b[key] !== undefined ? b[key] : p[key]);
    const mileageIn = num(pick('mileageIn'));
    const mileageOut = num(pick('mileageOut'));
    const who = req.user?.name || req.user?.email || '';

    // 오늘 일정은 결과가 적혔을 때만 끝난 것으로 본다
    const day = new Date(`${ymd}T00:00:00+09:00`);
    const finished = ymd < kstToday() || (ymd === kstToday() && hasResult(p.done));
    const span = SAME_JOB_DAYS * 24 * 3600e3;
    const nearby = await VehicleService.find({
      kind: { $in: kinds },
      $and: [
        { $or: [{ vehicle: vehicle._id }, ...(vehicle.plateNo ? [{ plateNo: vehicle.plateNo }] : [])] },
        { $or: [
          { calendarEventId: { $in: [item.eventId, ...kinds.map((k) => `${item.eventId}#${k}`)] } },
          { date: { $gte: new Date(day.getTime() - span), $lte: new Date(day.getTime() + span) } }
        ] }
      ]
    });
    const isMine = (r) => String(r.calendarEventId || '').split('#')[0] === item.eventId;
    // 다른 구글 일정에 이어진 기록은 다른 일이다
    const usable = nearby.filter((r) => !r.calendarEventId || isMine(r)).sort((x, y) => Number(isMine(y)) - Number(isMine(x)));

    const created = [];
    const reused = [];
    for (const [i, kind] of kinds.entries()) {
      const eventKey = i === 0 ? item.eventId : `${item.eventId}#${kind}`;
      const open = usable.find((r) => r.kind === kind && isOpenRecord(r));
      const closed = b.reuseDone ? usable.find((r) => r.kind === kind && !isOpenRecord(r)) : null;
      const hit = open || closed;
      if (hit) {
        // eslint-disable-next-line no-await-in-loop
        if (!hit.calendarEventId && !(await VehicleService.exists({ calendarEventId: eventKey, vehicle: hit.vehicle }))) hit.calendarEventId = eventKey;
        if (open) {
          hit.date = day;
          if (finished) hit.status = '완료';
          if (mileageIn) hit.mileageIn = mileageIn;
          if (mileageOut) hit.mileageOut = mileageOut;
          if (mileageOut || mileageIn) hit.mileage = mileageOut || mileageIn;
          if (i === 0 && num(pick('amount')) && !hit.amount) hit.amount = num(pick('amount'));
          // 화면에서 적어 둔 값은 덮지 않고 빈 칸만 채운다
          const fill = {
            shop: String(pick('shop') || ''), staff: p.staff, request: String(pick('request') || ''),
            description: String(b.description !== undefined ? b.description : p.done || ''), fuelIn: p.fuelIn, fuelOut: p.fuelOut,
            contactName: p.contactName, contactPhone: p.contactPhone, callAfterIn: p.callAfterIn, callGuide: p.callGuide, callAfterOut: p.callAfterOut
          };
          Object.entries(fill).forEach(([key, v]) => { if (v && !hit[key]) hit[key] = v; });
          if (!String(hit.memo || '').includes('구글 캘린더:')) {
            hit.memo = [hit.memo, p.notes ? `특이사항: ${p.notes}` : '', `구글 캘린더: ${item.title}`, p.costText ? `비용: ${p.costText}` : ''].filter(Boolean).join(' / ');
          }
          if (kind === '정기점검' && !hit.checkRound) {
            // eslint-disable-next-line no-await-in-loop
            hit.checkRound = (await VehicleService.countDocuments({ kind, _id: { $ne: hit._id }, $or: [{ vehicle: vehicle._id }, { plateNo: vehicle.plateNo }] })) + 1;
          }
        }
        // eslint-disable-next-line no-await-in-loop
        await hit.save();
        reused.push(hit);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      if (await VehicleService.exists({ calendarEventId: eventKey, vehicle: vehicle._id })) continue;
      const checkRound = kind === '정기점검'
        // eslint-disable-next-line no-await-in-loop
        ? (await VehicleService.countDocuments({ kind: '정기점검', $or: [{ vehicle: vehicle._id }, { plateNo: vehicle.plateNo }] })) + 1
        : undefined;
      // eslint-disable-next-line no-await-in-loop
      const rec = await VehicleService.create({
        vehicle: vehicle._id,
        plateNo: vehicle.plateNo || '',
        kind,
        date: new Date(`${ymd}T00:00:00+09:00`),
        status: finished ? '완료' : '예정',
        mileage: mileageOut || mileageIn,
        mileageIn,
        mileageOut,
        fuelIn: p.fuelIn || '',
        fuelOut: p.fuelOut || '',
        amount: i === 0 ? num(pick('amount')) || 0 : 0,
        shop: String(pick('shop') || ''),
        staff: p.staff || '',
        contactName: p.contactName || '',
        contactPhone: p.contactPhone || '',
        callAfterIn: p.callAfterIn || '',
        callGuide: p.callGuide || '',
        callAfterOut: p.callAfterOut || '',
        ...(p.pickupPlace ? { transport: { in: { from: p.pickupPlace }, out: { to: p.pickupPlace } } } : {}),
        request: String(pick('request') || ''),
        description: String(b.description !== undefined ? b.description : p.done || ''),
        memo: [p.notes ? `특이사항: ${p.notes}` : '', `구글 캘린더: ${item.title}`, p.costText ? `비용: ${p.costText}` : ''].filter(Boolean).join(' / '),
        source: 'calendar',
        calendarEventId: eventKey,
        checkRound,
        createdBy: who
      });
      created.push(rec);
    }
    const km = mileageOut || mileageIn;
    if (km) await Vehicle.updateOne({ _id: vehicle._id, currentMileage: { $lt: km } }, { $set: { currentMileage: km } });

    item.status = '옮김';
    item.vehicle = vehicle._id;
    item.serviceIds = [...(item.serviceIds || []), ...[...created, ...reused].map((r) => r._id)];
    item.suggested = [];
    item.handledBy = who;
    item.handledAt = new Date();
    await item.save();
    syncVehicleServiceSchedules().catch((err) => console.error('[정비·검사 일정] 실패:', err.message));

    logActivity({
      req, dept: '차량관리부', action: ACTIONS.VEHICLE_SERVICE_RECORD,
      target: { model: 'CalendarInbox', id: item._id },
      summary: `캘린더 일정 → 정비 기록 ${created.length + reused.length}건 (${vehicle.plateNo} · ${kinds.join('·')})`,
      meta: { eventId: item.eventId, kinds }
    });
    res.json({ success: true, created: created.length, records: created.map((r) => ({ id: r._id, kind: r.kind })), reused: reused.length, message: `${vehicle.plateNo} ${kinds.join('·')} ${finished ? '완료' : '예약'} 기록을 남겼습니다${reused.length ? ` (있던 기록 ${reused.length}건에 반영)` : ''}.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 확인 대기 일정을 이미 있는 기록과 잇는다. 새 기록을 만들지 않는다.
 *
 * 기록을 화면에서 먼저 적었는데 캘린더 일정이 다른 날짜(예약일)로 들어와 두 건이 되는 것을 막는다.
 * 기록에 이 일정의 id를 적어 두어, 다음에 캘린더를 읽을 때도 같은 일정으로 안다.
 *
 * @route POST /api/vehicle-services/calendar-inbox/:id/link
 * @body {serviceIds?: string[]} 비우면 서버가 찾아 둔 기록(suggested) 전부
 */
export const linkCalendarInbox = async (req, res) => {
  try {
    const item = await CalendarInbox.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: '일정을 찾을 수 없습니다.' });
    if (item.status === '옮김') return res.status(400).json({ success: false, message: '이미 옮긴 일정입니다.' });
    const wanted = Array.isArray(req.body?.serviceIds) && req.body.serviceIds.length
      ? req.body.serviceIds.map(String)
      : (item.suggested || []).map((s) => String(s.serviceId));
    if (!wanted.length) return res.status(400).json({ success: false, message: '이을 기록이 없습니다.' });
    const records = await VehicleService.find({ _id: { $in: wanted } });
    if (!records.length) return res.status(400).json({ success: false, message: '기록을 찾을 수 없습니다.' });
    if (item.vehicle && records.some((r) => String(r.vehicle) !== String(item.vehicle) && r.plateNo !== item.parsed?.plateNo)) {
      return res.status(400).json({ success: false, message: '다른 차의 기록과는 이을 수 없습니다.' });
    }

    // 기록에 일정 id를 남긴다(이미 다른 일정 id가 있는 기록은 그대로 둔다). 둘째부터는 '#종류'를 붙여 겹치지 않게 한다.
    let first = true;
    for (const r of records) {
      if (r.calendarEventId) continue;
      const key = first ? item.eventId : `${item.eventId}#${r.kind}`;
      // eslint-disable-next-line no-await-in-loop
      if (await VehicleService.exists({ calendarEventId: key, vehicle: r.vehicle })) continue;
      r.calendarEventId = key;
      // eslint-disable-next-line no-await-in-loop
      await r.save();
      first = false;
    }

    const who = req.user?.name || req.user?.email || '';
    item.status = '옮김';
    item.serviceIds = [...new Set([...(item.serviceIds || []).map(String), ...records.map((r) => String(r._id))])];
    item.suggested = [];
    item.handledBy = who;
    item.handledAt = new Date();
    await item.save();

    logActivity({
      req, dept: '차량관리부', action: ACTIONS.VEHICLE_SERVICE_RECORD,
      target: { model: 'CalendarInbox', id: item._id },
      summary: `캘린더 일정 → 이미 있는 기록 ${records.length}건과 연결 (${item.parsed?.plateNo || ''})`,
      meta: { eventId: item.eventId, serviceIds: records.map((r) => r._id) }
    });
    res.json({ success: true, linked: records.length, message: `이미 있는 기록 ${records.length}건과 연결했습니다. 새 기록은 만들지 않았습니다.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 정비 기록이 아닌 일정을 목록에서 뺀다(되돌릴 수 있게 지우지 않는다).
 * 옮긴 뒤 바뀜·지움 표시를 확인했을 때도 이걸로 표시를 내린다.
 *
 * @route POST /api/vehicle-services/calendar-inbox/:id/dismiss
 */
export const dismissCalendarInbox = async (req, res) => {
  try {
    const item = await CalendarInbox.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: '일정을 찾을 수 없습니다.' });
    const who = req.user?.name || req.user?.email || '';
    if (item.status === '옮김') {
      await CalendarInbox.updateOne({ _id: item._id }, { $set: { changedAfterImport: false, eventDeleted: false, handledBy: who, handledAt: new Date() } });
      return res.json({ success: true, message: '확인했습니다.' });
    }
    await CalendarInbox.updateOne({ _id: item._id }, { $set: { status: '제외', handledBy: who, handledAt: new Date() } });
    res.json({ success: true, message: '목록에서 뺐습니다.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
