import { onboardSupplier } from '../services/oracleSupplierService.js';

export async function handleOnboardSupplier(req, res) {
  try {
    const { vendorMasterId } = req.body;
    if (!vendorMasterId) {
      return res.status(400).json({ success: false, message: 'vendorMasterId is required' });
    }

    console.log(`[Oracle Supplier] Onboard request for vendorMasterId: ${vendorMasterId}`);
    const result = await onboardSupplier(vendorMasterId);

    const statusCode = result.success ? 200 : 207;
    return res.status(statusCode).json(result);
  } catch (err) {
    console.error('[Oracle Supplier] Controller error:', err.message);
    return res.status(500).json({
      success: false,
      message: err.message || 'Internal server error during supplier onboarding',
    });
  }
}
