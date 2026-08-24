import express from 'express';
import multer from 'multer';
import { 
  getCompanies, 
  getCompanyById, 
  createCompany, 
  updateCompany, 
  getCompanyCustomers, 
  processCompanyOCR 
} from '../controllers/companyController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = express.Router();

router.route('/')
  .get(getCompanies)
  .post(checkWritePermission, createCompany);

router.post('/ocr', checkWritePermission, upload.single('file'), processCompanyOCR);

router.route('/:id')
  .get(getCompanyById)
  .put(checkWritePermission, updateCompany);

router.get('/:id/customers', getCompanyCustomers);

export default router;
