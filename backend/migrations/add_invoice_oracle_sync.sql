-- Oracle / ERP sync audit (mock or real). Run once on existing DBs.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS oracle_invoice_id VARCHAR(64);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS oracle_sync_status VARCHAR(32);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS oracle_sync_response JSONB NOT NULL DEFAULT '{}';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS oracle_tax_response JSONB NOT NULL DEFAULT '{}';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS oracle_sync_error JSONB;
