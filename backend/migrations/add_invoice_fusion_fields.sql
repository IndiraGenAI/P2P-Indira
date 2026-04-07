-- Fusion-aligned invoice fields + PO currency + direct invoice oracle audit
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_currency VARCHAR(8) NOT NULL DEFAULT 'INR';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_group VARCHAR(255);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS accounting_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_source VARCHAR(64) NOT NULL DEFAULT 'P2P';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_type VARCHAR(32) NOT NULL DEFAULT 'Standard';

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS currency_code VARCHAR(8) NOT NULL DEFAULT 'INR';

ALTER TABLE direct_invoices ADD COLUMN IF NOT EXISTS invoice_currency VARCHAR(8) NOT NULL DEFAULT 'INR';
ALTER TABLE direct_invoices ADD COLUMN IF NOT EXISTS invoice_group VARCHAR(255);
ALTER TABLE direct_invoices ADD COLUMN IF NOT EXISTS accounting_date DATE;
ALTER TABLE direct_invoices ADD COLUMN IF NOT EXISTS invoice_source VARCHAR(64) NOT NULL DEFAULT 'P2P';
ALTER TABLE direct_invoices ADD COLUMN IF NOT EXISTS invoice_type VARCHAR(32) NOT NULL DEFAULT 'Standard';
ALTER TABLE direct_invoices ADD COLUMN IF NOT EXISTS oracle_invoice_id VARCHAR(64);
ALTER TABLE direct_invoices ADD COLUMN IF NOT EXISTS oracle_sync_status VARCHAR(32);
ALTER TABLE direct_invoices ADD COLUMN IF NOT EXISTS oracle_sync_response JSONB NOT NULL DEFAULT '{}';
ALTER TABLE direct_invoices ADD COLUMN IF NOT EXISTS oracle_tax_response JSONB NOT NULL DEFAULT '{}';
ALTER TABLE direct_invoices ADD COLUMN IF NOT EXISTS oracle_sync_error JSONB;

INSERT INTO masters (master_type, id, name, status, data) VALUES
  ('Currency', 'cur-inr', 'INR', 'Active', '{}'::jsonb),
  ('Invoice Source', 'src-p2p', 'P2P', 'Active', '{}'::jsonb)
ON CONFLICT (master_type, id) DO NOTHING;
