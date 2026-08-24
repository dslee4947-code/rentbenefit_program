import express from 'express';
import { getCompanies, getCompanyById, createCompany, updateCompany, getCompanyCustomers } from '../controllers/companyController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.route('/')
  .get(getCompanies)
  .post(checkWritePermission, createCompany);

router.route('/:id')
  .get(getCompanyById)
  .put(checkWritePermission, updateCompany);

router.get('/:id/customers', getCompanyCustomers);

export default router;
