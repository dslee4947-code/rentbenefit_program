import Vehicle from '../models/Vehicle.js';
import Customer from '../models/Customer.js';
import Contract from '../models/Contract.js';
import Schedule from '../models/Schedule.js';

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
      // 현재 운행 중(rented)인 차량 수 - 목록을 전부 끌어오지 않고 카운트만 계산
      Vehicle.aggregate([
        { $match: { status: 'rented' } },
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
