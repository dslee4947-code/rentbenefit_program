import BillingSchedule from '../models/BillingSchedule.js';
import Schedule from '../models/Schedule.js';
import Vehicle from '../models/Vehicle.js';
import { isMaintenanceKind } from './maintenance.js';

// 납부기한이 얼마나 지난 건까지 캘린더에 남길지.
// 기한이 지났다고 바로 지우면 "지난주에 넘긴 게 뭐였지"를 되짚을 수 없다.
// 반대로 계속 남기면 몇 년 치가 쌓여 캘린더를 덮는다.
const KEEP_PAST_DAYS = 60;

/**
 * 고지서 한 건을 가리키는 값.
 *
 * 고지번호가 있으면 그것이 가장 정확하다. 없는 서식이 있어 그때는
 * 차량번호·위반일·금액을 묶어 쓴다. 같은 고지서로 일정이 두 번 생기는 것을 막는 열쇠다.
 *
 * @param {object} att 회차에 붙은 서류
 * @param {string} scheduleId 회차표 id
 * @param {number} roundNo 회차 번호
 * @returns {string}
 */
export const noticeKeyOf = (att, scheduleId, roundNo) => {
  if (att.noticeNo) return `notice:${att.noticeNo}`;
  const at = att.occurredAt ? new Date(att.occurredAt).toISOString().slice(0, 10) : '';
  return `att:${scheduleId}:${roundNo}:${att.plateNo || ''}|${at}|${att.amount || 0}`;
};

/**
 * 캘린더 칸에 찍히는 이름. 계약사_차량번호_납부기한 순서다.
 *
 * 이 순서인 이유: 법인이 전화로 가장 먼저 묻는 것이 "어느 회사, 어느 차"이고,
 * 캘린더는 칸이 좁아 뒤가 잘리므로 중요한 것부터 앞에 둔다.
 *
 * @param {string} partyName 계약사
 * @param {string} plateNo 차량번호
 * @param {Date|string} dueDate 납부기한
 * @returns {string}
 */
export const buildNoticeTitle = (partyName, plateNo, dueDate) => {
  const ymd = dueDate ? new Date(dueDate).toISOString().slice(0, 10) : '';
  return [partyName || '계약사미상', plateNo || '차량번호미상', ymd].filter(Boolean).join('_');
};

/**
 * 방금 올린 고지서 한 건을 캘린더에 바로 올린다.
 *
 * 매일 도는 작업만 두면 올린 고지서가 다음 날 새벽에야 캘린더에 뜬다.
 * 올린 사람이 그 자리에서 확인할 수 있어야 하므로 붙이는 순간 함께 만든다.
 *
 * 캘린더에 못 올려도 청구 자체는 이미 끝난 일이라 막지 않는다. 매일 도는 작업이 다시 챙긴다.
 *
 * @param {object} params
 * @param {object} params.schedule 회차표
 * @param {object} params.round 서류가 붙은 회차
 * @param {object} params.attachment 붙인 서류
 * @param {string} params.partyName 계약사
 * @returns {Promise<void>}
 */
export const upsertNoticeSchedule = async ({ schedule, round, attachment, partyName }) => {
  if (!attachment?.noticeDueDate || isMaintenanceKind(attachment.kind)) return;

  const dueDate = new Date(attachment.noticeDueDate);
  if (Number.isNaN(dueDate.getTime())) return;

  const vehicle = attachment.plateNo
    ? await Vehicle.findOne({ plateNo: attachment.plateNo }).select('_id').lean()
    : null;

  await Schedule.updateOne(
    { 'source.key': noticeKeyOf(attachment, schedule._id, round.no) },
    {
      $set: {
        type: '고지서납부',
        targetContract: schedule.contract?._id || schedule.contract,
        targetVehicle: vehicle?._id,
        dueDate,
        title: buildNoticeTitle(partyName, attachment.plateNo, dueDate),
        amount: Number(attachment.amount) || 0,
        status: attachment.noticeStatus === '고객납부' ? '완료' : '예정',
        'source.billingSchedule': schedule._id,
        'source.roundNo': round.no,
        'source.noticeNo': attachment.noticeNo || '',
        'source.key': noticeKeyOf(attachment, schedule._id, round.no)
      }
    },
    { upsert: true }
  );
};

/**
 * 고지서 납부기한을 캘린더(Schedule)에 맞춰 둔다.
 *
 * 청구서에 붙은 서류 중 납부기한이 적힌 것만 올린다. 정비내역은 고객이 낼 돈이 아니라 뺀다.
 * 고객이 직접 낸 건은 일정을 '완료'로 돌린다. 지우지 않는 이유는 그날 무엇이 있었는지
 * 되짚을 수 있어야 하기 때문이다.
 *
 * 매일 돌아도 같은 결과가 나오게 만들었다(같은 고지서면 만들지 않고 고친다).
 *
 * @returns {Promise<{created: number, updated: number, closed: number}>}
 */
export const syncFineNoticeSchedules = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const floor = new Date(today);
  floor.setDate(floor.getDate() - KEEP_PAST_DAYS);

  const schedules = await BillingSchedule.find({ 'rounds.attachments.noticeDueDate': { $ne: null } })
    .select('contract rounds')
    .populate('contract', 'contractNo leaseCompany')
    .lean();

  // 차량번호로 차량을 찾아 일정에 걸어 둔다. 캘린더에서 차량 정보를 바로 열 수 있게 한다.
  const plateNos = [...new Set(schedules.flatMap((s) => (s.rounds || [])
    .flatMap((r) => (r.attachments || []).map((a) => a.plateNo).filter(Boolean))))];
  const vehicles = plateNos.length ? await Vehicle.find({ plateNo: { $in: plateNos } }).select('plateNo').lean() : [];
  const vehicleByPlate = new Map(vehicles.map((v) => [v.plateNo, v._id]));

  let created = 0;
  let updated = 0;
  let closed = 0;

  for (const s of schedules) {
    const partyName = s.contract?.leaseCompany || '';

    for (const round of s.rounds || []) {
      for (const att of round.attachments || []) {
        if (!att.noticeDueDate) continue;
        if (isMaintenanceKind(att.kind)) continue; // 정비는 고객이 기한 안에 낼 돈이 아니다

        const dueDate = new Date(att.noticeDueDate);
        if (Number.isNaN(dueDate.getTime()) || dueDate < floor) continue;

        const key = noticeKeyOf(att, s._id, round.no);
        const title = buildNoticeTitle(partyName, att.plateNo, dueDate);
        // 고객이 직접 낸 건은 더 챙길 일이 없다. 칸에는 남기고 완료로 표시한다.
        const status = att.noticeStatus === '고객납부' ? '완료' : '예정';

        const res = await Schedule.updateOne(
          { 'source.key': key },
          {
            $set: {
              type: '고지서납부',
              targetContract: s.contract?._id,
              targetVehicle: vehicleByPlate.get(att.plateNo),
              dueDate,
              title,
              amount: Number(att.amount) || 0,
              status,
              'source.billingSchedule': s._id,
              'source.roundNo': round.no,
              'source.noticeNo': att.noticeNo || '',
              'source.key': key
            }
          },
          { upsert: true }
        );

        if (res.upsertedCount) created += 1;
        else if (res.modifiedCount) updated += 1;
        if (status === '완료') closed += 1;
      }
    }
  }

  console.log(`[고지서 납부기한] 캘린더 ${created}건 등록 · ${updated}건 갱신 (고객 직접 납부 ${closed}건)`);
  return { created, updated, closed };
};

/**
 * 청구서에 붙은 고지서를 계약을 가로질러 한 줄씩 모은다.
 *
 * 고지서는 매일 오고 계약마다 흩어져 쌓인다. 계약을 하나씩 열어 보게 하면
 * 기한이 지난 건을 놓친다. 전용 화면이 이 목록 하나로 돌아간다.
 *
 * 정비내역은 뺀다. 고객이 기한 안에 낼 돈이 아니다.
 *
 * @returns {Promise<object[]>} 고지서 목록 (납부기한 이른 순)
 */
export const collectNotices = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const schedules = await BillingSchedule.find({ 'rounds.attachments.0': { $exists: true } })
    .select('contract rounds')
    .populate('contract', 'contractNo leaseCompany finesEmail finesEmail2')
    .lean();

  const rows = [];
  for (const s of schedules) {
    for (const round of s.rounds || []) {
      (round.attachments || []).forEach((att, index) => {
        if (isMaintenanceKind(att.kind)) return;

        const due = att.noticeDueDate ? new Date(att.noticeDueDate) : null;
        const hasDue = due && !Number.isNaN(due.getTime());
        // 기한이 없으면 남은 날짜를 셀 수 없다. 0으로 두면 '오늘 마감'으로 잘못 보인다.
        const dday = hasDue
          ? Math.round((Date.UTC(due.getFullYear(), due.getMonth(), due.getDate()) - today.getTime()) / 86400000)
          : null;

        rows.push({
          scheduleId: s._id,
          roundNo: round.no,
          index, // 상태를 바꿀 때 쓰는 순번
          contractId: s.contract?._id,
          contractNo: s.contract?.contractNo || '',
          partyName: s.contract?.leaseCompany || '',
          finesEmail: [s.contract?.finesEmail, s.contract?.finesEmail2].filter(Boolean).join(', '),
          kind: att.kind || '',
          plateNo: att.plateNo || '',
          amount: Number(att.amount) || 0,
          occurredAt: att.occurredAt || null,
          noticeDueDate: att.noticeDueDate || null,
          noticeNo: att.noticeNo || '',
          noticeStatus: att.noticeStatus || '청구예정',
          paidByCustomerAt: att.paidByCustomerAt || null,
          noticeMailSentAt: att.noticeMailSentAt || null,
          noticeMailTo: att.noticeMailTo || '',
          fileName: att.fileName || '',
          uploadedAt: att.uploadedAt || null,
          roundDueDate: round.dueDate,
          roundStatus: round.status,
          issued: Boolean(round.issuedAt), // 발행한 회차는 금액을 바꿀 수 없다
          dday
        });
      });
    }
  }

  // 기한이 급한 것부터. 기한이 없는 건은 맨 뒤에 둔다.
  rows.sort((a, b) => {
    if (a.dday === null) return 1;
    if (b.dday === null) return -1;
    return a.dday - b.dday;
  });
  return rows;
};

/**
 * 납부기한이 지났는데 아직 고객이 내지 않은 고지서.
 *
 * 기한이 지나면 다음 달 렌트료에 얹어 청구한다. 그 금액은 이미 회차에 붙어 있으므로
 * 여기서는 무엇이 넘어갔는지만 알려 준다. 챙길 일을 사람이 알아야 하기 때문이다.
 *
 * @param {number} [graceDays] 기한 뒤 며칠까지 볼지
 * @returns {Promise<object[]>} 넘어간 고지서 목록 (많이 지난 순)
 */
export const findOverdueNotices = async (graceDays = KEEP_PAST_DAYS) => {
  const rows = await collectNotices();
  return rows
    .filter((r) => r.noticeStatus !== '고객납부' && r.dday !== null && r.dday < 0 && -r.dday <= graceDays)
    .map((r) => ({ ...r, overdueDays: -r.dday, title: buildNoticeTitle(r.partyName, r.plateNo, r.noticeDueDate) }))
    .sort((a, b) => b.overdueDays - a.overdueDays);
};
