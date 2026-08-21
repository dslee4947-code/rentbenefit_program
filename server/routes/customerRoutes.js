import express from 'express';
import {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  bulkCreateCustomers,
  triggerOutlookSync,
  lookupCustomerAddresses
} from '../controllers/customerController.js';
import { checkWritePermission } from '../middleware/roleMiddleware.js';

const router = express.Router();

router.post('/bulk', checkWritePermission, bulkCreateCustomers);
router.post('/sync-outlook', checkWritePermission, triggerOutlookSync);
router.post('/lookup-addresses', lookupCustomerAddresses);

router.route('/')
  .get(getCustomers)
  .post(checkWritePermission, createCustomer);

router.route('/:id')
  .get(getCustomerById)
  .put(checkWritePermission, updateCustomer)
  .delete(checkWritePermission, deleteCustomer);



export default router;
