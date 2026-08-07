import express from 'express';
import {
  getInvoices,
  getInvoiceById,
  createInvoice,
  deleteInvoice
} from '../controllers/invoiceController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.route('/')
  .get(getInvoices)
  .post(checkWritePermission, createInvoice);

router.route('/:id')
  .get(getInvoiceById)
  .delete(checkWritePermission, deleteInvoice);

export default router;
