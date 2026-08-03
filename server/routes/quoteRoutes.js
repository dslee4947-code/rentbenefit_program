import express from 'express';
import {
  getQuotes,
  getQuoteById,
  createQuote,
  updateQuote,
  convertQuoteToContract,
  deleteQuote
} from '../controllers/quoteController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.route('/')
  .get(getQuotes)
  .post(checkWritePermission, createQuote);

router.route('/:id')
  .get(getQuoteById)
  .put(checkWritePermission, updateQuote)
  .delete(checkWritePermission, deleteQuote);

router.put('/:id/convert', checkWritePermission, convertQuoteToContract);

export default router;
