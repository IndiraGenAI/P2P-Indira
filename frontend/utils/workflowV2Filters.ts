import { WorkflowV2Rule } from '../types';

export function filterByWorkflowApproval<T extends { workflowStatus?: string }>(
  workflowV2Rules: WorkflowV2Rule[],
  scope: 'Item' | 'Vendor' | 'Budget',
  records: T[]
): T[] {
  const hasWorkflow = workflowV2Rules.some(
    (r) => r.scope === scope && r.masterId === '__ALL__' && r.isActive
  );
  if (!hasWorkflow) return records;
  return records.filter((r) => (r as any).workflowStatus === 'Approved');
}
