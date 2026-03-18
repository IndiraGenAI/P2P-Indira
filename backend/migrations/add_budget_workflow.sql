-- Budget workflow: add workflow state columns to budgets table
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS workflow_status VARCHAR(32) DEFAULT 'Draft';
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS workflow_current_step_index INTEGER DEFAULT 0;
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS workflow_rule_id VARCHAR(64);
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS workflow_created_by VARCHAR(64);
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS workflow_rejection_remarks TEXT;

-- Allow 'Budget' scope in workflow_v2_rules (universal rule: master_id = '__ALL__')
ALTER TABLE workflow_v2_rules DROP CONSTRAINT IF EXISTS workflow_v2_rules_scope_check;
ALTER TABLE workflow_v2_rules ADD CONSTRAINT workflow_v2_rules_scope_check CHECK (scope IN ('Item', 'Vendor', 'Budget'));
