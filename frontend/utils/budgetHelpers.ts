import type { Budget } from '../types';

/**
 * Returns the single budget to use for a given document and GL (coaCode).
 * When multiple budgets share the same coaCode, prefers exact department/subDepartment match,
 * then catch-all (null department), then first in list.
 */
export function getBudgetForDocumentAndCoaCode(
  budgets: Budget[],
  coaCode: string,
  doc: { department?: string | null; subDepartment?: string | null }
): Budget | undefined {
  const withCoa = budgets.filter(b => b.coaCode === coaCode);
  if (withCoa.length === 0) return undefined;
  if (withCoa.length === 1) return withCoa[0];
  const docDept = doc.department ?? null;
  const docSub = doc.subDepartment ?? null;
  const exactMatch = withCoa.find(b => (b.department ?? null) === docDept && (b.subDepartment ?? null) === docSub);
  if (exactMatch) return exactMatch;
  const catchAll = withCoa.find(b => b.department == null && b.subDepartment == null);
  if (catchAll) return catchAll;
  return withCoa[0];
}
