-- Add department and sub_department to budgets for mapping to Masters
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS department VARCHAR(255);
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS sub_department VARCHAR(255);
