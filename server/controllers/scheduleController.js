import Schedule from '../models/Schedule.js';

// @desc    Get all schedules (with calendar range & type filters)
// @route   GET /api/schedules
// @access  Public
export const getSchedules = async (req, res) => {
  try {
    const { startDate, endDate, type, status } = req.query;
    let query = {};

    if (startDate && endDate) {
      query.dueDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    if (type) {
      query.type = type;
    }

    if (status) {
      query.status = status;
    }

    const schedules = await Schedule.find(query)
      .populate({
        path: 'targetContract',
        populate: { path: 'customer' }
      })
      .populate('targetVehicle')
      .sort({ dueDate: 1 });

    res.json(schedules);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get schedule by ID
// @route   GET /api/schedules/:id
// @access  Public
export const getScheduleById = async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id)
      .populate({
        path: 'targetContract',
        populate: { path: 'customer' }
      })
      .populate('targetVehicle');
    if (schedule) {
      res.json(schedule);
    } else {
      res.status(404).json({ message: 'Schedule not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Update schedule status/assignee
// @route   PUT /api/schedules/:id
// @access  Public
export const updateSchedule = async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id);

    if (schedule) {
      schedule.status = req.body.status || schedule.status;
      schedule.assignee = req.body.assignee || schedule.assignee;
      schedule.dueDate = req.body.dueDate || schedule.dueDate;

      const updated = await schedule.save();
      const populated = await Schedule.findById(updated._id)
        .populate({
          path: 'targetContract',
          populate: { path: 'customer' }
        })
        .populate('targetVehicle');

      res.json(populated);
    } else {
      res.status(404).json({ message: 'Schedule not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get near-due schedules (D-7 to D-1)
// @route   GET /api/schedules/notifications
// @access  Public
export const getScheduleNotifications = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const sevenDaysLater = new Date(today);
    sevenDaysLater.setDate(today.getDate() + 7);
    sevenDaysLater.setHours(23, 59, 59, 999);

    // Fetch pending schedules due within the next 7 days
    const schedules = await Schedule.find({
      status: '예정',
      dueDate: {
        $gte: today,
        $lte: sevenDaysLater
      }
    })
    .populate({
      path: 'targetContract',
      populate: { path: 'customer' }
    })
    .populate('targetVehicle')
    .sort({ dueDate: 1 });

    // Mark as D-X day value
    const schedulesWithRemainingDays = schedules.map(sched => {
      const dueTime = new Date(sched.dueDate).getTime();
      const diffTime = dueTime - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      return {
        ...sched.toObject(),
        dDay: diffDays
      };
    });

    res.json(schedulesWithRemainingDays);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Delete schedule
// @route   DELETE /api/schedules/:id
// @access  Public
export const deleteSchedule = async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id);
    if (schedule) {
      await Schedule.deleteOne({ _id: req.params.id });
      res.json({ message: 'Schedule removed successfully' });
    } else {
      res.status(404).json({ message: 'Schedule not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
