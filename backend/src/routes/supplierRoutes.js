import { Router } from 'express';
import { handleOnboardSupplier } from '../controllers/supplierController.js';

const router = Router();

router.post('/vendors/onboard', handleOnboardSupplier);

export default router;