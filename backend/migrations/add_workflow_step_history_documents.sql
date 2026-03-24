ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS workflow_step_history JSONB NOT NULL DEFAULT '[]';
ALTER TABLE rate_contracts ADD COLUMN IF NOT EXISTS workflow_step_history JSONB NOT NULL DEFAULT '[]';
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS workflow_step_history JSONB NOT NULL DEFAULT '[]';
ALTER TABLE grns ADD COLUMN IF NOT EXISTS workflow_step_history JSONB NOT NULL DEFAULT '[]';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS workflow_step_history JSONB NOT NULL DEFAULT '[]';
ALTER TABLE direct_invoices ADD COLUMN IF NOT EXISTS workflow_step_history JSONB NOT NULL DEFAULT '[]';
