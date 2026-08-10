import express from 'express';
import { lookupCompanyFolder, registerCompanyFolder } from '../controllers/companyFolderController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.get('/lookup', lookupCompanyFolder);
router.post('/', checkWritePermission, registerCompanyFolder);

export default router;
