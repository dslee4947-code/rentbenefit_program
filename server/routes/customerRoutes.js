import express from 'express';
import {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  bulkCreateCustomers,
  triggerOutlookSync
} from '../controllers/customerController.js';

const router = express.Router();

router.post('/bulk', bulkCreateCustomers);
router.post('/sync-outlook', triggerOutlookSync);

router.route('/')
  .get(getCustomers)
  .post(createCustomer);

router.route('/:id')
  .get(getCustomerById)
  .put(updateCustomer)
  .delete(deleteCustomer);


export default router;
