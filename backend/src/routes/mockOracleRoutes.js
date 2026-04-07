import { Router } from 'express';

const router = Router();

router.post('/invoices-fail', (req, res) => {
  console.log('❌ MOCK ORACLE FAILURE:', req.body);
  return res.status(500).json({ message: 'Mock supplier not found' });
});

router.post('/invoices/action/calculateTax', (req, res) => {
  console.log('🧾 MOCK TAX CALCULATION:', req.body);
  return res.json({
    result: 'Mock tax calculation completed successfully',
    mock: true,
  });
});

router.post('/invoices', (req, res) => {
  const body = req.body || {};
  console.log('📦 MOCK CREATE INVOICE REQUEST:', body);
  return res.status(201).json({
    InvoiceId: Date.now(),
    InvoiceNumber: body.InvoiceNumber,
    InvoiceAmount: body.InvoiceAmount,
    Supplier: body.Supplier,
    BusinessUnit: body.BusinessUnit,
    ValidationStatus: 'Not validated',
    ApprovalStatus: 'Required',
    PaidStatus: 'Unpaid',
    AccountingStatus: 'Unaccounted',
    mock: true,
    message: 'Mock Oracle invoice created successfully',
  });
});

router.get('/invoices/:id', (req, res) => {
  console.log('🔍 MOCK GET INVOICE:', req.params.id);
  return res.json({
    InvoiceId: req.params.id,
    ValidationStatus: 'Validated',
    ApprovalStatus: 'Approved',
    PaidStatus: 'Unpaid',
    AccountingStatus: 'Unaccounted',
    mock: true,
  });
});

// ── Supplier Onboarding Mock Endpoints ──────────────────────

router.post('/suppliers', (req, res) => {
  const supplierId = Date.now();
  const supplierPartyId = supplierId + 1000;
  console.log('📦 MOCK CREATE SUPPLIER:', req.body?.Supplier);
  return res.status(201).json({
    SupplierId: supplierId,
    SupplierPartyId: supplierPartyId,
    Supplier: req.body?.Supplier,
    mock: true,
  });
});

router.post('/suppliers/:supplierId/child/addresses', (req, res) => {
  console.log('📍 MOCK CREATE ADDRESS for supplier', req.params.supplierId);
  return res.status(201).json({
    SupplierAddressId: Date.now(),
    AddressName: req.body?.AddressName || 'Mock Address',
    mock: true,
  });
});

router.post('/suppliers/:supplierId/child/contacts', (req, res) => {
  console.log('👤 MOCK CREATE CONTACT for supplier', req.params.supplierId);
  return res.status(201).json({
    SupplierContactId: Date.now(),
    FirstName: req.body?.FirstName,
    LastName: req.body?.LastName,
    mock: true,
  });
});

router.post('/suppliers/:supplierId/child/sites', (req, res) => {
  console.log('🏢 MOCK CREATE SITE for supplier', req.params.supplierId);
  return res.status(201).json({
    SupplierSiteId: Date.now(),
    SiteName: req.body?.SiteName || 'MOCK_SITE',
    mock: true,
  });
});

router.post('/suppliers/:supplierId/child/sites/:siteId/child/assignments', (req, res) => {
  console.log('🔗 MOCK SITE ASSIGNMENT:', req.params.supplierId, req.params.siteId);
  return res.status(201).json({
    AssignmentId: Date.now(),
    ProcurementBU: req.body?.ProcurementBU,
    mock: true,
  });
});

router.post('/externalBankAccounts', (req, res) => {
  console.log('🏦 MOCK BANK ACCOUNT:', req.body?.BankName);
  return res.status(201).json({
    BankAccountId: Date.now(),
    BankName: req.body?.BankName,
    mock: true,
  });
});

export default router;
