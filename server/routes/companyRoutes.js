import express from 'express';
import {
  getCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  deleteCompany,
  getCompanyCustomers,
  processCompanyOCR,
  uploadCompanyDocument,
  getCompanyDocuments,
  downloadCompanyDocument,
  deleteCompanyDocument
} from '../controllers/companyController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';
import { uploadSingleFile } from '../middleware/uploadMiddleware.js';

const router = express.Router();

router.route('/')
  .get(getCompanies)
  .post(checkWritePermission, createCompany);

router.post('/ocr', checkWritePermission, uploadSingleFile(), processCompanyOCR);

router.route('/:id')
  .get(getCompanyById)
  .put(checkWritePermission, updateCompany)
  .delete(checkWritePermission, deleteCompany);

router.get('/:id/customers', getCompanyCustomers);

router.route('/:id/documents')
  .get(getCompanyDocuments)
  .post(checkWritePermission, uploadSingleFile(), uploadCompanyDocument);

router.get('/:id/documents/:docId/download', downloadCompanyDocument);
router.delete('/:id/documents/:docId', checkWritePermission, deleteCompanyDocument);

export default router;
