import express from 'express';
import {
  getSchedules,
  getScheduleById,
  updateSchedule,
  getScheduleNotifications,
  deleteSchedule
} from '../controllers/scheduleController.js';

const router = express.Router();

// Put specific sub-routes BEFORE generic /:id routes so they are matched correctly
router.get('/notifications', getScheduleNotifications);

router.route('/')
  .get(getSchedules);

router.route('/:id')
  .get(getScheduleById)
  .put(updateSchedule)
  .delete(deleteSchedule);

export default router;
