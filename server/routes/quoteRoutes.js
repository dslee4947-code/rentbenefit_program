import express from 'express';
import {
  getQuotes,
  getQuoteById,
  createQuote,
  updateQuote,
  convertQuoteToContract,
  deleteQuote,
  saveQuoteDocument
} from '../controllers/quoteController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';
import { uploadSingleFile } from '../middleware/uploadMiddleware.js';

const router = express.Router();

router.route('/')
  .get(getQuotes)
  .post(checkWritePermission, createQuote);

router.route('/:id')
  .get(getQuoteById)
  .put(checkWritePermission, updateQuote)
  .delete(checkWritePermission, deleteQuote);

router.put('/:id/convert', checkWritePermission, convertQuoteToContract);

// 인쇄할 때 만든 견적서 PDF를 계약자 폴더에 함께 남긴다
router.post('/:id/document', checkWritePermission, uploadSingleFile(), saveQuoteDocument);

export default router;
