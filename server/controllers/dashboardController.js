import Vehicle from '../models/Vehicle.js';
import Customer from '../models/Customer.js';
import Contract from '../models/Contract.js';
import Schedule from '../models/Schedule.js';
import BillingSchedule from '../models/BillingSchedule.js';
import Inquiry from '../models/Inquiry.js';
import Quote from '../models/Quote.js';
import ActivityLog, { DEPARTMENTS } from '../models/ActivityLog.js';
import { resolveScheduleInputs } from './billingScheduleController.js';

// @desc    Get dashboard summary (counts via aggregation + upcoming schedule notifications)
// @route   GET /api/dashboard/summary
// @access  Public
export const getDashboardSummary = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sevenDaysLater = new Date(today);
    sevenDaysLater.setDate(today.getDate() + 7);
    sevenDaysLater.setHours(23, 59, 59, 999);

    const [vehicleAgg, customersCount, contractsCount, schedulesCount, notifications] = await Promise.all([
      // 현재 장기렌트 중인 차량 수 - 목록을 전부 끌어오지 않고 카운트만 계산
      Vehicle.aggregate([
        { $match: { status: '장기렌트' } },
        { $count: 'count' }
      ]),
      Customer.countDocuments({}),
      Contract.countDocuments({ status: '진행중' }),
      Schedule.countDocuments({ status: '예정' }),
      Schedule.find({
        status: '예정',
        dueDate: { $gte: today, $lte: sevenDaysLater }
      })
        .select('type dueDate status assignee targetVehicle targetContract')
        .populate({ path: 'targetVehicle', select: 'carModel plateNo code' })
        .populate({ path: 'targetContract', select: 'customer', populate: { path: 'customer', select: 'name' } })
        .sort({ dueDate: 1 })
        .lean()
    ]);

    const vehiclesCount = vehicleAgg[0]?.count || 0;

    const notificationsWithDDay = notifications.map((sched) => {
      const diffDays = Math.ceil((new Date(sched.dueDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      return { ...sched, dDay: diffDays };
    });

    res.json({
      stats: {
        vehiclesCount,
        customersCount,
        contractsCount,
        schedulesCount
      },
      notifications: notificationsWithDDay
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * 청구가 시작되지 않은 계약을 찾는다.
 *
 * 회차표는 월 대여료 결제일과 렌트료 게시일이 있어야 만들어지는데, 그 둘은 출고 준비에서 정한다.
 * 그래서 계약을 등록만 하고 출고 준비를 저장하지 않으면 회차표가 없고,
 * 회차표가 없으면 청구 대상 목록에 영영 뜨지 않는다. 아무도 모르는 사이에 매달 렌트료가 빠진다.
 *
 * 계약 등록 화면은 회차표를 못 만들어도 등록을 막지 않고 서버 로그만 남기므로,
 * 화면에서 이 상태를 알아차릴 방법이 여기 말고는 없다.
 *
 * 사유 문구는 회차표를 만들 때 쓰는 resolveScheduleInputs가 내는 말을 그대로 쓴다.
 * 청구서 화면에서 회차표를 다시 만들 때 나오는 말과 같아야, 두 화면을 오가며 헷갈리지 않는다.
 *
 * @route GET /api/dashboard/billing-gaps
 */

// 한 번에 살펴볼 계약 수의 상한. 계약마다 조회가 두 번 들어가는데,
// 이 목록은 "밀린 몇 건"을 잡으려는 것이라 수백 건이 걸리면 이미 목록이 아니라 사고다.
const BILLING_GAP_SCAN_LIMIT = 300;

export const getBillingGaps = async (req, res) => {
  try {
    // 회차표가 이미 있는 계약은 볼 것도 없다
    const withSchedule = await BillingSchedule.distinct('contract');
    const withScheduleSet = new Set(withSchedule.map(String));

    // '진행중'만 본다. 임시저장은 아직 작성 중인 계약이라 차량도 없는 게 정상이고,
    // 여기 섞으면 매일 뜨는 알림이 되어 아무도 안 보게 된다.
    const contracts = await Contract.find({ status: '진행중' })
      .select('contractNo customer companyId partyType contractDate termMonths pricing vehicle')
      .populate('customer', 'name')
      .populate('companyId', 'name')
      .populate('vehicle', 'carModel plateNo code deliveryDate rentBillingDate monthlyPaymentDay')
      .sort({ contractDate: -1 })
      .limit(BILLING_GAP_SCAN_LIMIT)
      .lean();

    const missing = contracts.filter((c) => !withScheduleSet.has(String(c._id)));

    const items = [];
    const noBillingNeeded = [];

    for (const c of missing) {
      let reason = '회차표를 만들 수 있는데 아직 만들어지지 않았습니다. 청구서 화면에서 회차표를 만들어 주세요.';
      let code = 'READY';
      try {
        await resolveScheduleInputs(c._id);
      } catch (err) {
        reason = err.message;
        code = err.code || 'UNKNOWN';
      }

      const row = {
        _id: c._id,
        contractNo: c.contractNo,
        partyName: c.companyId?.name || c.customer?.name || '계약자 미상',
        carModel: c.vehicle?.carModel || '',
        plateNo: c.vehicle?.plateNo || '',
        vehicleCode: c.vehicle?.code || '',
        contractDate: c.contractDate,
        termMonths: c.termMonths,
        monthlyFee: c.pricing?.monthlyFee || 0,
        reason,
        code
      };

      // 월 렌트료가 0원인 계약은 완납 등으로 청구할 것이 없는 정상 상태다.
      // 이걸 경고에 섞으면 고쳐지지 않는 항목이 늘 떠 있게 되고, 그러면 사람이 경고 전체를 안 본다.
      // 그렇다고 아예 빼면 잘못 0원으로 저장된 계약을 놓치므로, 세어서 따로 돌려준다.
      // 화면은 이걸 경고로 띄우지 않고, 경고가 이미 떠 있을 때 아래에 한 줄로만 덧붙인다.
      if (code === 'NO_RENT') noBillingNeeded.push(row);
      else items.push(row);
    }

    // 매달 빠지고 있는 금액. 건수만 보여 주면 "나중에 하지"가 되는데, 금액이 붙으면 그날 처리한다.
    const monthlyLoss = items.reduce((sum, it) => sum + (it.monthlyFee || 0), 0);

    res.json({
      count: items.length,
      monthlyLoss,
      scanned: contracts.length,
      truncated: contracts.length === BILLING_GAP_SCAN_LIMIT,
      items,
      // 청구가 필요 없는 계약(완납 등). 경고는 아니지만 몇 건인지는 볼 수 있어야 한다.
      noBillingNeededCount: noBillingNeeded.length,
      noBillingNeeded
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * 대표용 경영 요약.
 *
 * 대표가 대시보드에서 답을 얻어야 하는 질문은 셋이다. 돈이 잘 도나, 회사가 크고 있나, 내가 챙길 게 있나.
 * 여기에는 지금 자료로 정확하게 셀 수 있는 것만 담는다.
 * 입금률·미납·차량 손익은 과거 입금 기록과 납입 개월 수가 채워진 뒤에 붙인다(지금 보여 주면 틀린 숫자다).
 *
 * 18:30 일일 보고도 같은 숫자를 써야 하므로, 나중에 보고 쪽에서 이 함수의 계산을 그대로 가져다 쓴다.
 *
 * @route GET /api/dashboard/executive (관리자만)
 */
export const getExecutiveSummary = async (req, res) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    // 지난달은 "오늘과 같은 날짜까지"로 자른다. 4일에 보는 이번 달과 30일치 지난달을 견주면 늘 줄어 보인다.
    const lastMonthSameDay = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth(), 0).getDate()) + 1);
    const in90 = new Date(today);
    in90.setDate(in90.getDate() + 90);

    const countBetween = (Model, field, from, to, extra = {}) =>
      Model.countDocuments({ ...extra, [field]: { $gte: from, $lt: to } });
    const realContract = { status: { $ne: '임시저장' } };

    const [fleet, newThis, newLast, funnelThis, funnelLast, funnelLastFull, expiring] = await Promise.all([
      // 운용 대수와 월 렌트료 합계. 매달 들어와야 할 렌트료의 크기다.
      Vehicle.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 }, monthlyRent: { $sum: { $ifNull: ['$monthlyFee', 0] } } } }
      ]),
      // 이번 달·지난달 새로 출고한 차. 매출이 얼마나 늘었는지를 보여 준다.
      Vehicle.aggregate([
        { $match: { deliveryDate: { $gte: thisMonth, $lt: new Date(now.getFullYear(), now.getMonth() + 1, 1) } } },
        { $group: { _id: null, count: { $sum: 1 }, monthlyRent: { $sum: { $ifNull: ['$monthlyFee', 0] } } } }
      ]),
      Vehicle.aggregate([
        { $match: { deliveryDate: { $gte: lastMonth, $lt: lastMonthSameDay } } },
        { $group: { _id: null, count: { $sum: 1 }, monthlyRent: { $sum: { $ifNull: ['$monthlyFee', 0] } } } }
      ]),
      Promise.all([
        countBetween(Inquiry, 'createdAt', thisMonth, now),
        countBetween(Quote, 'createdAt', thisMonth, now),
        countBetween(Contract, 'contractDate', thisMonth, now, realContract)
      ]),
      Promise.all([
        countBetween(Inquiry, 'createdAt', lastMonth, lastMonthSameDay),
        countBetween(Quote, 'createdAt', lastMonth, lastMonthSameDay),
        countBetween(Contract, 'contractDate', lastMonth, lastMonthSameDay, realContract)
      ]),
      // 지난달 전체. 월초에는 이번 달 숫자가 거의 0이라, 한 달 단위로 얼마나 하는지 함께 보여 준다.
      Promise.all([
        countBetween(Inquiry, 'createdAt', lastMonth, thisMonth),
        countBetween(Quote, 'createdAt', lastMonth, thisMonth),
        countBetween(Contract, 'contractDate', lastMonth, thisMonth, realContract)
      ]),
      // 90일 안에 끝나는 계약. 재계약·인수를 권할 영업 기회이자, 놓치면 차가 그냥 돌아온다.
      Contract.find({ status: '진행중', endDate: { $gte: today, $lte: in90 } })
        .select('contractNo endDate termMonths companyId customer vehicle pricing.monthlyFee')
        .populate('companyId', 'name')
        .populate('customer', 'name')
        .populate('vehicle', 'carModel plateNo monthlyFee')
        .sort({ endDate: 1 })
        .lean()
    ]);

    // 입금과 미납.
    //
    // 회차 기준으로 센다. 과거 입금은 원장(정산 리스트)에서 옮겨 왔고(2026-10-04), 그 뒤로는 프로그램의 입금 입력이 쌓인다.
    // "미납"은 사람이 미납으로 찍은 회차, "입금 미확인"은 출금일이 지났는데 입금 기록이 없는 회차다.
    // 둘을 섞으면 기록이 늦은 것까지 미납으로 보여 대표가 고객에게 잘못 연락하게 된다.
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const [roundAgg, overdueRows, lastPaid] = await Promise.all([
      BillingSchedule.aggregate([
        { $unwind: '$rounds' },
        { $match: { 'rounds.dueDate': { $gte: lastMonth, $lt: nextMonth } } },
        { $project: {
          month: { $cond: [{ $gte: ['$rounds.dueDate', thisMonth] }, 'this', 'last'] },
          due: { $lt: ['$rounds.dueDate', now] },
          total: { $ifNull: ['$rounds.total', 0] },
          paid: { $cond: [{ $eq: ['$rounds.status', '입금완료'] }, { $ifNull: ['$rounds.paidAmount', '$rounds.total'] }, { $ifNull: ['$rounds.paidAmount', 0] }] },
          done: { $eq: ['$rounds.status', '입금완료'] }
        } },
        { $group: {
          _id: { month: '$month', due: '$due' },
          count: { $sum: 1 }, billed: { $sum: '$total' }, paid: { $sum: '$paid' },
          doneCount: { $sum: { $cond: ['$done', 1, 0] } }
        } }
      ]),
      BillingSchedule.aggregate([
        { $unwind: '$rounds' },
        { $match: { 'rounds.dueDate': { $lt: today }, 'rounds.status': { $ne: '입금완료' } } },
        { $project: { contract: 1, no: '$rounds.no', dueDate: '$rounds.dueDate', status: '$rounds.status',
          unpaid: { $max: [0, { $subtract: [{ $ifNull: ['$rounds.total', 0] }, { $ifNull: ['$rounds.paidAmount', 0] }] }] } } }
      ]),
      BillingSchedule.aggregate([
        { $unwind: '$rounds' },
        { $match: { 'rounds.status': '입금완료' } },
        { $group: { _id: null, at: { $max: '$rounds.paidAt' } } }
      ])
    ]);

    const monthPart = (month, due) => roundAgg.find((r) => r._id.month === month && r._id.due === due)
      || { count: 0, billed: 0, paid: 0, doneCount: 0 };
    const summarizeMonth = (month) => {
      const past = monthPart(month, true);
      const future = monthPart(month, false);
      return {
        billed: past.billed + future.billed, // 이 달에 받을 돈 전체
        dueBilled: past.billed, // 그중 출금일이 지난 돈
        duePaid: past.paid, // 출금일이 지난 돈 중 들어온 돈
        dueCount: past.count,
        dueDoneCount: past.doneCount,
        rate: past.billed ? past.paid / past.billed : null
      };
    };

    const unpaidRows = overdueRows.filter((r) => r.status === '미납');
    const unknownRows = overdueRows.filter((r) => r.status !== '미납');
    const sum = (list) => list.reduce((acc, r) => acc + r.unpaid, 0);

    // 입금 기록이 어디까지 들어와 있는지. 그 뒤에 출금일이 온 회차는 "아직 기록이 안 들어온 것"일 뿐이라
    // 미확인으로 몰아 세면 대표가 멀쩡한 고객을 미납으로 오해한다. 기록이 있는 기간 안의 것만 문제로 센다.
    const recordedUntil = lastPaid[0]?.at ? new Date(lastPaid[0].at) : today;
    const covered = (r) => new Date(r.dueDate) <= recordedUntil;

    // 기록이 있는 기간 안에서 연속 두 회차 이상 입금 기록이 없는 계약.
    // 실제 미납이거나, 원장이 회차표와 연결되지 않아 기록이 빠진 경우다. 어느 쪽이든 자금팀이 확인할 일이다.
    const byContract = new Map();
    for (const r of overdueRows.filter(covered)) {
      const key = String(r.contract);
      if (!byContract.has(key)) byContract.set(key, []);
      byContract.get(key).push(r);
    }
    const streaks = [];
    for (const [contractId, list] of byContract) {
      list.sort((a, b) => b.no - a.no);
      // 가장 최근 회차부터 거꾸로 끊기지 않고 이어진 만큼
      let run = 1;
      while (run < list.length && list[run].no === list[run - 1].no - 1) run += 1;
      if (run >= 2) streaks.push({ contractId, months: run, amount: list.slice(0, run).reduce((a, r) => a + r.unpaid, 0), latest: list[0] });
    }
    streaks.sort((a, b) => b.amount - a.amount);
    const streakContracts = await Contract.find({ _id: { $in: streaks.slice(0, 10).map((x) => x.contractId) } })
      .select('contractNo companyId customer vehicle')
      .populate('companyId', 'name').populate('customer', 'name').populate('vehicle', 'carModel plateNo')
      .lean();
    const contractById = new Map(streakContracts.map((c) => [String(c._id), c]));

    const collections = {
      thisMonth: summarizeMonth('this'),
      lastMonth: summarizeMonth('last'),
      unpaid: { count: unpaidRows.length, amount: sum(unpaidRows) },
      unconfirmed: {
        // 기록 기준일 전인데 입금 기록이 없는 회차. 미납이거나 기록이 빠진 것이다.
        count: unknownRows.filter(covered).length,
        amount: sum(unknownRows.filter(covered)),
        // 기록 기준일 뒤라 아직 입금 기록이 들어오지 않은 회차
        waitingCount: unknownRows.filter((r) => !covered(r)).length,
        waitingAmount: sum(unknownRows.filter((r) => !covered(r)))
      },
      streakCount: streaks.length,
      streaks: streaks.slice(0, 10).map((x) => {
        const c = contractById.get(x.contractId);
        return {
          contractId: x.contractId,
          contractNo: c?.contractNo || '',
          partyName: c?.companyId?.name || c?.customer?.name || '계약자 미상',
          carModel: c?.vehicle?.carModel || '',
          plateNo: c?.vehicle?.plateNo || '',
          months: x.months,
          amount: x.amount,
          sinceDueDate: x.latest.dueDate
        };
      }),
      // 입금 기록이 어디까지 들어와 있는지. 이 날짜 뒤는 기록이 없어서 "미확인"이 늘어난다.
      lastPaidAt: lastPaid[0]?.at || null
    };

    // 부서별 오늘 한 일. 18:30 일일 보고의 "오늘 한 일"과 같은 집계다.
    const todayActivity = await ActivityLog.aggregate([
      { $match: { at: { $gte: today } } },
      { $group: { _id: { dept: '$dept', action: '$action' }, count: { $sum: 1 } } }
    ]);
    const activityByDept = DEPARTMENTS
      .map((dept) => ({
        dept,
        actions: todayActivity.filter((a) => a._id.dept === dept)
          .map((a) => ({ action: a._id.action, count: a.count }))
          .sort((a, b) => b.count - a.count)
      }))
      .filter((d) => d.actions.length);

    const byStatus = Object.fromEntries(fleet.map((f) => [f._id, { count: f.count, monthlyRent: f.monthlyRent }]));
    const pick = (status) => byStatus[status] || { count: 0, monthlyRent: 0 };
    const operating = ['장기렌트', '단기렌트', '사고대차'].map(pick);

    const [inqThis, quoteThis, contractThis] = funnelThis;
    const [inqLast, quoteLast, contractLast] = funnelLast;

    // 만기는 달별로 묶어 "언제 몰리는지"를 보이고, 목록은 가까운 순으로 준다
    const expiringByMonth = {};
    for (const c of expiring) {
      const key = `${c.endDate.getFullYear()}-${String(c.endDate.getMonth() + 1).padStart(2, '0')}`;
      expiringByMonth[key] = (expiringByMonth[key] || 0) + 1;
    }

    res.json({
      success: true,
      asOf: now,
      fleet: {
        operatingCount: operating.reduce((s, f) => s + f.count, 0),
        operatingMonthlyRent: operating.reduce((s, f) => s + f.monthlyRent, 0),
        longTerm: pick('장기렌트'),
        shortTerm: pick('단기렌트'),
        accident: pick('사고대차'),
        waiting: pick('계약중') // 계약했지만 아직 출고 전
      },
      newDeliveries: {
        thisMonth: { count: newThis[0]?.count || 0, monthlyRent: newThis[0]?.monthlyRent || 0 },
        lastMonthSamePeriod: { count: newLast[0]?.count || 0, monthlyRent: newLast[0]?.monthlyRent || 0 }
      },
      funnel: {
        thisMonth: { inquiries: inqThis, quotes: quoteThis, contracts: contractThis },
        lastMonthSamePeriod: { inquiries: inqLast, quotes: quoteLast, contracts: contractLast },
        lastMonthFull: { inquiries: funnelLastFull[0], quotes: funnelLastFull[1], contracts: funnelLastFull[2] },
        pendingInquiries: await Inquiry.countDocuments({ status: '대기' })
      },
      activityToday: activityByDept,
      collections,
      expiring: {
        count: expiring.length,
        monthlyRent: expiring.reduce((s, c) => s + (c.vehicle?.monthlyFee || c.pricing?.monthlyFee || 0), 0),
        byMonth: expiringByMonth,
        items: expiring.map((c) => ({
          _id: c._id,
          contractNo: c.contractNo,
          partyName: c.companyId?.name || c.customer?.name || '계약자 미상',
          carModel: c.vehicle?.carModel || '',
          plateNo: c.vehicle?.plateNo || '',
          endDate: c.endDate,
          dDay: Math.round((new Date(c.endDate).setHours(0, 0, 0, 0) - today.getTime()) / 86400000),
          monthlyFee: c.vehicle?.monthlyFee || c.pricing?.monthlyFee || 0
        }))
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
