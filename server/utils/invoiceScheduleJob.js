import BillingSchedule from '../models/BillingSchedule.js';
import Schedule from '../models/Schedule.js';
import { calcSendDate, calcRawSendDate, INVOICE_SEND_LEAD_DAYS } from './billingDate.js';
import { isHoliday } from './koreanHolidays.js';

// 앞으로 며칠 안에 보낼 청구서까지 캘린더에 올릴지.
// 계약 하나에 회차가 36~60개라 전부 올리면 캘린더가 청구서 일정으로만 덮인다.
// 45일로 두는 이유: 청구가 한 달 주기라 30일로 잡으면 발송일이 다음 달 중순인 계약은
// 보름 동안 캘린더에서 사라진다. 45일이면 어느 시점에 봐도 계약마다 다음 발송일이 하나 떠 있다.
const HORIZON_DAYS = 45;

/**
 * 다가오는 청구서 발송 일정을 캘린더(Schedule)에 맞춰 둔다.
 *
 * 청구서는 출금일 10일 전에 보내야 법인이 결재를 올릴 시간이 있다.
 * 그 날짜를 캘린더에 미리 잡아 두면 대시보드 알림(7일 이내)에도 같이 잡혀,
 * 발송 전날 알림이 따로 만들 것 없이 그대로 뜬다.
 *
 * 계약 하나당 가장 가까운 한 건만 올린다. 회차를 전부 올리면 캘린더를 못 쓴다.
 *
 * @returns {Promise<{created: number, skipped: number}>} 만든 일정 수
 */
export const syncInvoiceSendSchedules = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + HORIZON_DAYS);

  const schedules = await BillingSchedule.find({}).select('contract rounds paymentDay').lean();

  let created = 0;
  let movedCount = 0;
  let skipped = 0;

  for (const s of schedules) {
    if (!s.contract) continue;

    // 아직 발행하지 않은 회차 중 발송일이 가장 먼저 오는 것.
    // calcSendDate는 그 날이 주말·공휴일이면 앞의 영업일로 당겨 준다.
    const next = (s.rounds || [])
      .filter((r) => r.status === '예정')
      .map((r) => ({ round: r, sendDate: calcSendDate(r.dueDate), rawSendDate: calcRawSendDate(r.dueDate) }))
      // 지난 발송일은 캘린더에 올리지 않는다. 오래된 계약은 지난 회차가 '예정'으로 남아 있어
      // 걸러내지 않으면 몇 년 전 날짜가 알림으로 뜬다.
      .filter((x) => x.sendDate && x.sendDate >= today && x.sendDate <= horizon)
      .sort((a, b) => a.sendDate - b.sendDate)[0];

    if (!next) { skipped += 1; continue; }

    const moved = next.rawSendDate && isHoliday(next.rawSendDate);
    // 캘린더 칸에 찍히는 이름. 휴일이라 당긴 건은 원래 며칠 건인지 적어 둔다.
    // 당겨진 날짜만 남기면 담당자가 무슨 건인지 알 수 없다.
    const title = moved
      ? `${next.rawSendDate.getMonth() + 1}/${next.rawSendDate.getDate()}일 청구서 발송 (휴일이라 앞당김)`
      : '청구서 발송';

    // 같은 계약·같은 날짜의 일정은 다시 만들지 않는다(하루에 여러 번 돌아도 안전하게).
    // 이름과 회차 정보는 매번 맞춰 둔다. 회차표를 다시 만들면 달라질 수 있다.
    const res = await Schedule.updateOne(
      { type: '청구서발송', targetContract: s.contract, dueDate: next.sendDate },
      {
        $set: {
          title,
          amount: next.round.total || 0,
          invoice: {
            paymentDay: s.paymentDay || '',
            roundNo: next.round.no,
            billingDueDate: next.round.dueDate, // 출금일
            originalSendDate: next.rawSendDate, // 휴일이라 당기기 전의 날짜
            movedForHoliday: Boolean(moved)
          }
        },
        $setOnInsert: { type: '청구서발송', targetContract: s.contract, dueDate: next.sendDate, status: '예정' }
      },
      { upsert: true }
    );
    if (res.upsertedCount) created += 1;
    else if (res.modifiedCount) movedCount += 1;
  }

  console.log(`[청구서 발송 일정] 출금일 ${INVOICE_SEND_LEAD_DAYS}일 전 기준 ${created}건 등록 · ${movedCount}건 갱신 (대상 없음 ${skipped}건)`);
  return { created, updated: movedCount, skipped };
};
