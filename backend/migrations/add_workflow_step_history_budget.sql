-- Audit trail for budget workflow (who did what when); masters store workflowStepHistory in data JSON
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS workflow_step_history JSONB DEFAULT '[]'::jsonb;
