-- =============================================================================
-- P2P-Indira PostgreSQL — Schema + Seed Data (single file)
-- Run in PostgreSQL query tool connected to database P2PIndira.
-- Credentials: backend/.env (PG_DATABASE=P2PIndira, PG_USER, PG_PASSWORD, etc.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SCHEMA
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  permissions JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  employee_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  center_names JSONB NOT NULL DEFAULT '[]',
  departments JSONB NOT NULL DEFAULT '[]',
  sub_departments JSONB NOT NULL DEFAULT '[]',
  phone_number VARCHAR(64),
  email VARCHAR(255) NOT NULL,
  entity_names JSONB NOT NULL DEFAULT '[]',
  role_ids JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  password_hash VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS workflows (
  id VARCHAR(64) PRIMARY KEY,
  entity_name VARCHAR(255) NOT NULL,
  module_type VARCHAR(64) NOT NULL,
  sub_department VARCHAR(255) NOT NULL,
  center_name VARCHAR(255),
  min_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  max_amount NUMERIC(18,2),
  approval_chain JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS purchase_requests (
  id VARCHAR(64) PRIMARY KEY,
  entity_name VARCHAR(255) NOT NULL,
  vendor_id VARCHAR(64),
  vendor_site_id VARCHAR(64),
  transaction_type VARCHAR(32) NOT NULL,
  valid_from VARCHAR(32),
  valid_to VARCHAR(32),
  frequency VARCHAR(32),
  department VARCHAR(255),
  sub_department VARCHAR(255),
  payment_terms VARCHAR(255),
  terms_and_conditions_id VARCHAR(64),
  center_names JSONB NOT NULL DEFAULT '[]',
  items JSONB NOT NULL DEFAULT '[]',
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  remarks TEXT,
  overall_summary TEXT,
  attachments JSONB NOT NULL DEFAULT '[]',
  workflow_step_history JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(32) NOT NULL,
  current_step_index INTEGER NOT NULL DEFAULT 0,
  is_unbudgeted BOOLEAN,
  unbudgeted_justification TEXT,
  unbudgeted_attachment_url TEXT,
  rejection_remarks TEXT,
  created_by VARCHAR(64),
  created_at TIMESTAMPTZ,
  shipping_address_id VARCHAR(64),
  billing_address_id VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS rate_contracts (
  id VARCHAR(64) PRIMARY KEY,
  entity_name VARCHAR(255) NOT NULL,
  vendor_id VARCHAR(64) NOT NULL,
  vendor_site_id VARCHAR(64),
  transaction_type VARCHAR(32) NOT NULL,
  valid_from VARCHAR(32),
  valid_to VARCHAR(32),
  frequency VARCHAR(32),
  department VARCHAR(255),
  sub_department VARCHAR(255),
  payment_terms VARCHAR(255),
  terms_and_conditions_id VARCHAR(64),
  items JSONB NOT NULL DEFAULT '[]',
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  remarks TEXT,
  overall_summary TEXT,
  attachments JSONB NOT NULL DEFAULT '[]',
  workflow_step_history JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(32) NOT NULL,
  current_step_index INTEGER NOT NULL DEFAULT 0,
  rejection_remarks TEXT,
  created_by VARCHAR(64),
  created_at TIMESTAMPTZ,
  shipping_address_id VARCHAR(64),
  billing_address_id VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id VARCHAR(64) PRIMARY KEY,
  entity_name VARCHAR(255) NOT NULL,
  vendor_id VARCHAR(64) NOT NULL,
  vendor_site_id VARCHAR(64),
  transaction_type VARCHAR(32) NOT NULL,
  valid_from VARCHAR(32),
  valid_to VARCHAR(32),
  frequency VARCHAR(32),
  department VARCHAR(255),
  sub_department VARCHAR(255),
  payment_terms VARCHAR(255),
  terms_and_conditions_id VARCHAR(64),
  center_names JSONB NOT NULL DEFAULT '[]',
  items JSONB NOT NULL DEFAULT '[]',
  tds NUMERIC(5,2),
  gst NUMERIC(5,2),
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  remarks TEXT,
  overall_summary TEXT,
  attachments JSONB NOT NULL DEFAULT '[]',
  workflow_step_history JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(32) NOT NULL,
  current_step_index INTEGER NOT NULL DEFAULT 0,
  is_unbudgeted BOOLEAN,
  unbudgeted_justification TEXT,
  unbudgeted_attachment_url TEXT,
  rejection_remarks TEXT,
  created_by VARCHAR(64),
  created_at TIMESTAMPTZ,
  required_date VARCHAR(32),
  shipping_address_id VARCHAR(64),
  billing_address_id VARCHAR(64),
  is_advance_po BOOLEAN,
  advance_percentage NUMERIC(5,2),
  advance_amount NUMERIC(18,2),
  expected_invoice_type VARCHAR(50),
  currency_code VARCHAR(8) NOT NULL DEFAULT 'INR'
);

CREATE TABLE IF NOT EXISTS grns (
  id VARCHAR(64) PRIMARY KEY,
  entity_name VARCHAR(255) NOT NULL,
  rate_contract_id VARCHAR(64),
  purchase_order_id VARCHAR(64),
  vendor_site_id VARCHAR(64),
  location VARCHAR(255),
  department VARCHAR(255),
  sub_department VARCHAR(255),
  invoice_number VARCHAR(255),
  invoice_date DATE,
  items JSONB NOT NULL DEFAULT '[]',
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  remarks TEXT,
  overall_summary TEXT,
  attachments JSONB NOT NULL DEFAULT '[]',
  workflow_step_history JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(32) NOT NULL,
  current_step_index INTEGER NOT NULL DEFAULT 0,
  rejection_remarks TEXT,
  created_by VARCHAR(64),
  created_at TIMESTAMPTZ,
  shipping_address_id VARCHAR(64),
  billing_address_id VARCHAR(64),
  tds NUMERIC(5,2),
  gst NUMERIC(5,2)
);

CREATE TABLE IF NOT EXISTS invoices (
  id VARCHAR(64) PRIMARY KEY,
  entity_name VARCHAR(255) NOT NULL,
  grn_id VARCHAR(64) NOT NULL,
  vendor_site_id VARCHAR(64),
  location VARCHAR(255),
  department VARCHAR(255),
  sub_department VARCHAR(255),
  invoice_number VARCHAR(255),
  invoice_date DATE,
  items JSONB NOT NULL DEFAULT '[]',
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  remarks TEXT,
  overall_summary TEXT,
  status VARCHAR(32) NOT NULL,
  current_step_index INTEGER NOT NULL DEFAULT 0,
  rejection_remarks TEXT,
  created_by VARCHAR(64),
  created_at TIMESTAMPTZ,
  attachments JSONB NOT NULL DEFAULT '[]',
  workflow_step_history JSONB NOT NULL DEFAULT '[]',
  shipping_address_id VARCHAR(64),
  billing_address_id VARCHAR(64),
  tds NUMERIC(5,2),
  gst NUMERIC(5,2),
  oracle_invoice_id VARCHAR(64),
  oracle_sync_status VARCHAR(32),
  oracle_sync_response JSONB NOT NULL DEFAULT '{}',
  oracle_tax_response JSONB NOT NULL DEFAULT '{}',
  oracle_sync_error JSONB,
  invoice_currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  invoice_group VARCHAR(255),
  accounting_date DATE,
  invoice_source VARCHAR(64) NOT NULL DEFAULT 'P2P',
  invoice_type VARCHAR(32) NOT NULL DEFAULT 'Standard'
);

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
  gst NUMERIC(5,2),
  remarks TEXT,
  overall_summary TEXT,
  workflow_step_history JSONB NOT NULL DEFAULT '[]',
  invoice_currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  invoice_group VARCHAR(255),
  accounting_date DATE,
  invoice_source VARCHAR(64) NOT NULL DEFAULT 'P2P',
  invoice_type VARCHAR(32) NOT NULL DEFAULT 'Standard',
  oracle_invoice_id VARCHAR(64),
  oracle_sync_status VARCHAR(32),
  oracle_sync_response JSONB NOT NULL DEFAULT '{}',
  oracle_tax_response JSONB NOT NULL DEFAULT '{}',
  oracle_sync_error JSONB
);

CREATE TABLE IF NOT EXISTS budgets (
  id VARCHAR(64) PRIMARY KEY,
  financial_year VARCHAR(32) NOT NULL,
  entity_name VARCHAR(255) NOT NULL,
  location_name VARCHAR(255) NOT NULL,
  cost_center_name VARCHAR(255) NOT NULL,
  coa_code VARCHAR(64) NOT NULL,
  budget_type VARCHAR(32) NOT NULL,
  amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  consumed_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  control_type VARCHAR(32) NOT NULL,
  validity VARCHAR(32) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  monthly_allocation JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS budget_amendments (
  id VARCHAR(64) PRIMARY KEY,
  budget_id VARCHAR(64) NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  type VARCHAR(32) NOT NULL,
  amount NUMERIC(18,2) NOT NULL,
  target_budget_id VARCHAR(64),
  justification TEXT,
  status VARCHAR(32) NOT NULL,
  requested_by VARCHAR(64),
  approved_by VARCHAR(64),
  created_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS masters (
  master_type VARCHAR(64) NOT NULL,
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255),
  status VARCHAR(32),
  data JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (master_type, id)
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_status ON purchase_requests(status);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_grns_status ON grns(status);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_budgets_entity ON budgets(entity_name);
CREATE INDEX IF NOT EXISTS idx_masters_type ON masters(master_type);

-- -----------------------------------------------------------------------------
-- SEED DATA
-- -----------------------------------------------------------------------------

INSERT INTO roles (id, name, is_active, permissions) VALUES
('r1', 'Super Admin', true, '{"Item":["create","edit","view","delete"],"Vendor":["create","edit","view","delete"],"Rate Contract":["create","edit","view","delete"],"Purchase Request (PR)":["create","edit","view","delete"],"Purchase Order (PO)":["create","edit","view","delete"],"Goods Receipt Note (GRN)":["create","edit","view","delete"],"Invoice against GRN":["create","edit","view","delete"],"Direct Invoice":["create","edit","view","delete"],"Budget":["create","edit","view","delete"]}'::jsonb),
('r2', 'Purchaser', true, '{"Item":[],"Vendor":[],"Rate Contract":[],"Purchase Request (PR)":[],"Purchase Order (PO)":[],"Goods Receipt Note (GRN)":[],"Invoice against GRN":[],"Direct Invoice":[],"Budget":[]}'::jsonb),
('r3', 'Manager', true, '{"Item":[],"Vendor":[],"Rate Contract":[],"Purchase Request (PR)":[],"Purchase Order (PO)":[],"Goods Receipt Note (GRN)":[],"Invoice against GRN":[],"Direct Invoice":[],"Budget":[]}'::jsonb),
('r4', 'Finance', true, '{"Item":[],"Vendor":[],"Rate Contract":[],"Purchase Request (PR)":[],"Purchase Order (PO)":[],"Goods Receipt Note (GRN)":[],"Invoice against GRN":[],"Direct Invoice":[],"Budget":[]}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, employee_id, name, center_names, departments, sub_departments, phone_number, email, entity_names, role_ids, is_active) VALUES
('u1', 'USR001', 'John Admin', '["Mumbai"]'::jsonb, '["Procurement"]'::jsonb, '["Sourcing"]'::jsonb, '555-0101', 'user1@example.com', '["Alpha Corp"]'::jsonb, '["r1"]'::jsonb, true),
('u2', 'USR002', 'Sarah Manager', '["London","Mumbai"]'::jsonb, '["Procurement"]'::jsonb, '["Inventory"]'::jsonb, '555-0102', 'user2@example.com', '["Alpha Corp"]'::jsonb, '["r3"]'::jsonb, true),
('u3', 'USR003', 'David Finance', '["Singapore"]'::jsonb, '["Finance"]'::jsonb, '["Accounts Payable"]'::jsonb, '555-0103', 'user3@example.com', '["Beta Logistics"]'::jsonb, '["r4"]'::jsonb, true),
('u4', 'USR004', 'Kevin IT', '["Singapore"]'::jsonb, '["IT"]'::jsonb, '["Infrastructure"]'::jsonb, '555-0104', 'user4@example.com', '["Beta Logistics"]'::jsonb, '["r1"]'::jsonb, true),
('u5', 'USR005', 'Emily Infra', '["New York"]'::jsonb, '["IT"]'::jsonb, '["Infrastructure"]'::jsonb, '555-0105', 'user5@example.com', '["Gamma Industries"]'::jsonb, '["r3"]'::jsonb, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO budgets (id, financial_year, entity_name, location_name, cost_center_name, coa_code, budget_type, amount, consumed_amount, control_type, validity, is_active) VALUES
('b1', '2025-26', 'Main Corporate Entity', 'Mumbai', 'Procurement', '610001', 'OPEX', 500000, 0, 'Hard Stop', 'Annual', true),
('b2', '2025-26', 'Main Corporate Entity', 'Mumbai', 'IT', '620001', 'CAPEX', 2000000, 0, 'Hard Stop', 'Annual', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO masters (master_type, id, name, status, data) VALUES
('Vendor', 'v1', 'Global Supplies Ltd', 'Active', '{"state":"Maharashtra"}'::jsonb),
('Vendor', 'v2', 'Tech Solutions Inc', 'Active', '{"state":"Karnataka"}'::jsonb),
('Vendor', 'v3', 'Office Depot', 'Active', '{"state":"Delhi"}'::jsonb),
('Vendor Site', 'vs1', 'Mumbai Warehouse', 'Active', '{"vendorId":"v1","code":"VS-MUM-01"}'::jsonb),
('Vendor Site', 'vs2', 'Pune Factory', 'Active', '{"vendorId":"v1","code":"VS-PUN-01"}'::jsonb),
('Vendor Site', 'vs3', 'Bangalore HQ', 'Active', '{"vendorId":"v2","code":"VS-BLR-01"}'::jsonb),
('Item Type', 'it1', 'CAPEX', 'Active', '{"code":"CAPEX"}'::jsonb),
('Item Type', 'it2', 'OPEX', 'Active', '{"code":"OPEX"}'::jsonb),
('Item Category', 'ic1', 'Hardware', 'Active', '{"code":"HW"}'::jsonb),
('Item Category', 'ic2', 'Software', 'Active', '{"code":"SW"}'::jsonb),
('Item Category', 'ic3', 'Consumables', 'Active', '{"code":"CONS"}'::jsonb),
('UOM', 'uom1', 'Nos', 'Active', '{"code":"Nos"}'::jsonb),
('UOM', 'uom2', 'Kg', 'Active', '{"code":"Kg"}'::jsonb),
('UOM', 'uom3', 'Ltr', 'Active', '{"code":"Ltr"}'::jsonb),
('UOM', 'uom4', 'Box', 'Active', '{"code":"Box"}'::jsonb),
('Item', 'i1', 'Laptop', 'Active', '{"itemType":"CAPEX","coaCode":"620001"}'::jsonb),
('Item', 'i2', 'Monitor', 'Active', '{"itemType":"OPEX","coaCode":"620001"}'::jsonb),
('Item', 'i3', 'Keyboard', 'Active', '{"itemType":"OPEX","coaCode":"610001"}'::jsonb),
('Department', 'dept-0', 'Procurement', 'Active', '{"subdepartmentIds": ["sub-0", "sub-1", "sub-2"]}'::jsonb),
('Department', 'dept-1', 'Finance', 'Active', '{"subdepartmentIds": ["sub-6", "sub-7", "sub-8"]}'::jsonb),
('Department', 'dept-2', 'IT', 'Active', '{"subdepartmentIds": ["sub-3", "sub-4", "sub-5"]}'::jsonb),
('Department', 'dept-3', 'Operations', 'Active', '{"subdepartmentIds": ["sub-9", "sub-10"]}'::jsonb),
('Department', 'dept-4', 'HR', 'Active', '{"subdepartmentIds": ["sub-11", "sub-12"]}'::jsonb),
('Department', 'dept-5', 'Legal', 'Active', '{"subdepartmentIds": ["sub-13", "sub-14"]}'::jsonb),
('Subdepartment', 'sub-0', 'Sourcing', 'Active', '{}'::jsonb),
('Subdepartment', 'sub-1', 'Inventory', 'Active', '{}'::jsonb),
('Subdepartment', 'sub-2', 'Vendor Management', 'Active', '{}'::jsonb),
('Subdepartment', 'sub-3', 'Infrastructure', 'Active', '{}'::jsonb),
('Subdepartment', 'sub-4', 'Software Licensing', 'Active', '{}'::jsonb),
('Subdepartment', 'sub-5', 'Tech Support', 'Active', '{}'::jsonb),
('Subdepartment', 'sub-6', 'Accounts Payable', 'Active', '{}'::jsonb),
('Subdepartment', 'sub-7', 'Treasury', 'Active', '{}'::jsonb),
('Subdepartment', 'sub-8', 'Taxation', 'Active', '{}'::jsonb),
('Subdepartment', 'sub-9', 'Logistics', 'Active', '{}'::jsonb),
('Subdepartment', 'sub-10', 'Supply Chain', 'Active', '{}'::jsonb),
('Subdepartment', 'sub-11', 'Employee Relations', 'Active', '{}'::jsonb),
('Subdepartment', 'sub-12', 'Recruitment', 'Active', '{}'::jsonb),
('Subdepartment', 'sub-13', 'Compliance', 'Active', '{}'::jsonb),
('Subdepartment', 'sub-14', 'Contracts', 'Active', '{}'::jsonb),
('COA', 'coa1', 'Office Supplies', 'Active', '{"code":"610001"}'::jsonb),
('COA', 'coa2', 'IT Hardware', 'Active', '{"code":"620001"}'::jsonb),
('COA', 'coa3', 'Travel Expenses', 'Active', '{"code":"630001"}'::jsonb),
('TDS', 'tds1', 'TDS @ 10%', 'Active', '{"rate":10}'::jsonb),
('TDS', 'tds2', 'TDS @ 2%', 'Active', '{"rate":2}'::jsonb),
('TDS', 'tds3', 'No TDS', 'Active', '{"rate":0}'::jsonb),
('GST', 'gst1', 'GST @ 18%', 'Active', '{"rate":18}'::jsonb),
('GST', 'gst2', 'GST @ 12%', 'Active', '{"rate":12}'::jsonb),
('GST', 'gst3', 'GST @ 5%', 'Active', '{"rate":5}'::jsonb),
('GST', 'gst4', 'Exempted', 'Active', '{"rate":0}'::jsonb),
('Country', 'c1', 'USA', 'Active', '{}'::jsonb),
('Country', 'c2', 'UK', 'Active', '{}'::jsonb),
('Payment Terms', 'pt1', 'Net 30', 'Active', '{}'::jsonb),
('Payment Terms', 'pt2', 'Net 45', 'Active', '{}'::jsonb),
('Payment Terms', 'pt3', 'Immediate', 'Active', '{}'::jsonb),
('Payment Terms', 'pt4', 'Advance', 'Active', '{}'::jsonb),
('Terms & Conditions', 'tc1', 'Standard T&C', 'Active', '{"content":"Standard terms and conditions apply."}'::jsonb),
('Terms & Conditions', 'tc2', 'Service Level Agreement', 'Active', '{"content":"SLA terms for service contracts."}'::jsonb),
('Terms & Conditions', 'tc3', 'Confidentiality Agreement', 'Active', '{"content":"NDA terms included."}'::jsonb),
('Center', 'ctr1', 'Mumbai', 'Active', '{"state":"Maharashtra"}'::jsonb),
('Center', 'ctr2', 'Bangalore', 'Active', '{"state":"Karnataka"}'::jsonb),
('Center', 'ctr3', 'Delhi', 'Active', '{"state":"Delhi"}'::jsonb),
('Entity', 'ENT-001', 'Main Corporate Entity', 'Active', '{"code":"ENT001","shippingAddresses":[{"id":"SA1","address":"123 Shipping Lane, Mumbai, MH"},{"id":"SA2","address":"456 Delivery Road, Bangalore, KA"}],"billingAddresses":[{"id":"BA1","address":"789 Billing Square, Delhi, DL"}]}'::jsonb),
('Vendor Category', 'vc1', 'Direct Material', 'Active', '{}'::jsonb),
('Vendor Category', 'vc2', 'Indirect Services', 'Active', '{}'::jsonb),
('Vendor Category', 'vc3', 'CapEx Vendor', 'Active', '{}'::jsonb),
('Applicant Type', 'at1', 'Individual', 'Active', '{}'::jsonb),
('Applicant Type', 'at2', 'Proprietorship', 'Active', '{}'::jsonb),
('Applicant Type', 'at3', 'Partnership', 'Active', '{}'::jsonb),
('Applicant Type', 'at4', 'Private Limited', 'Active', '{}'::jsonb)
ON CONFLICT (master_type, id) DO NOTHING;