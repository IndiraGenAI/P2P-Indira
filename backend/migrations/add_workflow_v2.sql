-- Workflow V2: Item and Vendor creation approval (independent of PO/RC/GRN/Invoice workflows)
CREATE TABLE IF NOT EXISTS workflow_v2_rules (
  id VARCHAR(64) PRIMARY KEY,
  scope VARCHAR(32) NOT NULL CHECK (scope IN ('Item', 'Vendor')),
  master_id VARCHAR(64) NOT NULL,
  approval_chain JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(scope, master_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_v2_scope_master ON workflow_v2_rules(scope, master_id);
