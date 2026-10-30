import CalendarInbox from '../models/CalendarInbox.js';
import VehicleService from '../models/VehicleService.js';
import Vehicle from '../models/Vehicle.js';
import Setting from '../models/Setting.js';
import { SERVICE_KINDS } from '../utils/vehicleServicePlan.js';
import { syncVehicleServiceSchedules } from '../utils/vehicleServiceScheduleJob.js';
import { syncCalendarInbox } from '../utils/calendarInboxSync.js';
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
    res.json({ success: true, ...r, message: `캘린더 일정 ${r.read}건을 읽었습니다. 새로 올라온 정비 일정 ${r.waiting + r.noPlate}건.` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 확인 대기 일정을 정비 기록으로 옮긴다. 종류를 여럿 고르면 종류마다 기록을 하나씩 둔다
 * (일괄 이관과 같게, 둘째부터 calendarEventId 뒤에 '#종류'). 금액은 첫 기록에만 넣는다.
 *
 * @route POST /api/vehicle-services/calendar-inbox/:id/import
 * @body {vehicleId?, kinds[], date?, amount?, mileageIn?, mileageOut?, shop?, request?, description?}
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

    const created = [];
    for (const [i, kind] of kinds.entries()) {
      const eventKey = i === 0 ? item.eventId : `${item.eventId}#${kind}`;
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
        status: ymd > kstToday() ? '예정' : '완료',
        mileage: mileageOut || mileageIn,
        mileageIn,
        mileageOut,
        fuelIn: p.fuelIn || '',
        fuelOut: p.fuelOut || '',
        amount: i === 0 ? num(pick('amount')) || 0 : 0,
        shop: String(pick('shop') || ''),
        staff: p.staff || '',
        request: String(pick('request') || ''),
        description: String(b.description !== undefined ? b.description : p.done || ''),
        memo: [`구글 캘린더: ${item.title}`, p.costText ? `비용: ${p.costText}` : ''].filter(Boolean).join(' / '),
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
    item.serviceIds = [...(item.serviceIds || []), ...created.map((r) => r._id)];
    item.handledBy = who;
    item.handledAt = new Date();
    await item.save();
    syncVehicleServiceSchedules().catch((err) => console.error('[정비·검사 일정] 실패:', err.message));

    logActivity({
      req, dept: '차량관리부', action: ACTIONS.VEHICLE_SERVICE_RECORD,
      target: { model: 'CalendarInbox', id: item._id },
      summary: `캘린더 일정 → 정비 기록 ${created.length}건 (${vehicle.plateNo} · ${kinds.join('·')})`,
      meta: { eventId: item.eventId, kinds }
    });
    res.json({ success: true, created: created.length, records: created.map((r) => ({ id: r._id, kind: r.kind })), message: `${vehicle.plateNo} ${kinds.join('·')} 기록 ${created.length}건을 남겼습니다.` });
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
