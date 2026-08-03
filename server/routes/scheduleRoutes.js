import express from 'express';
import {
  getSchedules,
  getScheduleById,
  updateSchedule,
  getScheduleNotifications,
  deleteSchedule
} from '../controllers/scheduleController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const router = express.Router();

// Put specific sub-routes BEFORE generic /:id routes so they are matched correctly
router.get('/notifications', getScheduleNotifications);

router.route('/')
  .get(getSchedules);

router.route('/:id')
  .get(getScheduleById)
  .put(checkWritePermission, updateSchedule)
  .delete(checkWritePermission, deleteSchedule);

export default router;
