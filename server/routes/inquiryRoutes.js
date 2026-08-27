import express from 'express';
import {
  getInquiries,
  createInquiry,
  updateInquiry,
  deleteInquiry
} from '../controllers/inquiryController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.route('/')
  .get(getInquiries)
  .post(checkWritePermission, createInquiry);

router.route('/:id')
  .put(checkWritePermission, updateInquiry)
  .delete(checkWritePermission, deleteInquiry);

export default router;
