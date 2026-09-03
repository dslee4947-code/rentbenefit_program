import express from 'express';
import {
  getLedgers,
  getLedgerById,
  createLedger,
  updateLedger,
  saveLedgerEntries,
  syncLedger,
  linkVehicle,
  deleteLedger,
  getLinkableVehicles,
  extendLedger,
  searchContracts,
  getLedgerLabels
} from '../controllers/ledgerController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const router = express.Router();

// 고정 경로를 :id 보다 먼저 선언해야 'linkable-vehicles'가 id로 잘못 해석되지 않는다
router.get('/linkable-vehicles', getLinkableVehicles);
router.get('/contract-search', searchContracts);
router.get('/labels', getLedgerLabels);

router.route('/')
  .get(getLedgers)
  .post(checkWritePermission, createLedger);

router.route('/:id')
  .get(getLedgerById)
  .put(checkWritePermission, updateLedger)
  .delete(checkWritePermission, deleteLedger);

router.put('/:id/entries', checkWritePermission, saveLedgerEntries);
router.post('/:id/sync', checkWritePermission, syncLedger);
router.post('/:id/link-vehicle', checkWritePermission, linkVehicle);
router.post('/:id/extend', checkWritePermission, extendLedger);

export default router;
