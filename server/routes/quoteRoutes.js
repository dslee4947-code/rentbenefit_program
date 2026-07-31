import express from 'express';
import {
  getQuotes,
  getQuoteById,
  createQuote,
  updateQuote,
  convertQuoteToContract,
  deleteQuote
} from '../controllers/quoteController.js';

const router = express.Router();

router.route('/')
  .get(getQuotes)
  .post(createQuote);

router.route('/:id')
  .get(getQuoteById)
  .put(updateQuote)
  .delete(deleteQuote);

router.put('/:id/convert', convertQuoteToContract);

export default router;
