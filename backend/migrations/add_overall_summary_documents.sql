-- Independent overall_summary (and invoice remarks where missing) for document chain: PR → PO → GRN → Invoice; also RC and direct invoices.

ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS overall_summary TEXT;
ALTER TABLE rate_contracts ADD COLUMN IF NOT EXISTS overall_summary TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS overall_summary TEXT;
ALTER TABLE grns ADD COLUMN IF NOT EXISTS overall_summary TEXT;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS remarks TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS overall_summary TEXT;

ALTER TABLE direct_invoices ADD COLUMN IF NOT EXISTS remarks TEXT;
ALTER TABLE direct_invoices ADD COLUMN IF NOT EXISTS overall_summary TEXT;
