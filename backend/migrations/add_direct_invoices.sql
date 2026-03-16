-- Direct invoices: same as invoices but no GRN link (standalone module)
CREATE TABLE IF NOT EXISTS direct_invoices (
  id VARCHAR(64) PRIMARY KEY,
  entity_name VARCHAR(255) NOT NULL,
  vendor_site_id VARCHAR(64),
  location VARCHAR(255),
  department VARCHAR(255),
  sub_department VARCHAR(255),
  invoice_number VARCHAR(255),
  invoice_date DATE,
  items JSONB NOT NULL DEFAULT '[]',
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL,
  current_step_index INTEGER NOT NULL DEFAULT 0,
  rejection_remarks TEXT,
  created_by VARCHAR(64),
  created_at TIMESTAMPTZ,
  center_names JSONB,
  attachments JSONB NOT NULL DEFAULT '[]',
  shipping_address_id VARCHAR(64),
  billing_address_id VARCHAR(64),
  tds NUMERIC(5,2),
  gst NUMERIC(5,2)
);
