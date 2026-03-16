-- Add required_date to purchase_requests and rate_contracts (same as purchase_orders)
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS required_date VARCHAR(32);
ALTER TABLE rate_contracts ADD COLUMN IF NOT EXISTS required_date VARCHAR(32);
