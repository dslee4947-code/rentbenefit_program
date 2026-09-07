import Vehicle from '../models/Vehicle.js';
import Customer from '../models/Customer.js';
import Contract from '../models/Contract.js';
import Schedule from '../models/Schedule.js';
import BillingSchedule from '../models/BillingSchedule.js';
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
