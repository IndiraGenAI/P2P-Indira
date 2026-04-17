/** Excel / template month names in Indian FY order (April → March). */
export const EXCEL_MONTHS = [
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
  'January',
  'February',
  'March',
] as const;

export type ExcelMonth = (typeof EXCEL_MONTHS)[number];

/** Keys stored in `Budget.monthlyAllocation` and used by BudgetModule expanded row. */
export const ALLOC_MONTH_KEYS = [
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
  'jan',
  'feb',
  'mar',
] as const;

export type BudgetAllocMonthKey = (typeof ALLOC_MONTH_KEYS)[number];

export type MonthlyAllocationByKey = Record<BudgetAllocMonthKey, number>;

const EXCEL_TO_KEY: Record<string, BudgetAllocMonthKey> = {};
EXCEL_MONTHS.forEach((m, i) => {
  EXCEL_TO_KEY[m.toLowerCase()] = ALLOC_MONTH_KEYS[i];
});

export function excelMonthToKey(monthLabel: string): BudgetAllocMonthKey | undefined {
  return EXCEL_TO_KEY[String(monthLabel || '').trim().toLowerCase()];
}

export function roundBudgetAmount(n: unknown): number {
  return Math.max(0, Math.round(Number(n) || 0));
}

/** Equal split with remainder spread across first N FY months (same as BudgetModule `distributeEqually`). */
export function distributeMonthlyBudgetEqual(yearlyAmount: number): MonthlyAllocationByKey {
  const y = roundBudgetAmount(yearlyAmount);
  const base = Math.floor(y / 12);
  const remainder = y - base * 12;
  const result = {} as MonthlyAllocationByKey;
  ALLOC_MONTH_KEYS.forEach((k, i) => {
    result[k] = base + (i < remainder ? 1 : 0);
  });
  return result;
}

export type PartialExcelMonths = Partial<Record<ExcelMonth, number>>;

/**
 * From Excel month columns + yearly total, produce `apr`…`mar` allocation.
 * - All months zero/missing and yearly &gt; 0 → equal distribution.
 * - Otherwise monthly sum must match yearly within ₹1.
 */
export function resolveMonthlyAllocationFromExcel(
  yearlyAmount: number,
  months: PartialExcelMonths
): { ok: true; allocation: MonthlyAllocationByKey } | { ok: false; reason: string } {
  const y = roundBudgetAmount(yearlyAmount);
  const vals = EXCEL_MONTHS.map((m) => roundBudgetAmount(months[m]));
  const allZero = vals.every((v) => v === 0);

  const negMonth = EXCEL_MONTHS.find((m) => roundBudgetAmount(months[m]) < 0);
  if (negMonth) {
    return { ok: false, reason: `Month "${negMonth}" has a negative value` };
  }

  if (y <= 0) {
    return { ok: false, reason: 'YearlyBudgetedAmount must be greater than 0' };
  }

  if (allZero) {
    return { ok: true, allocation: distributeMonthlyBudgetEqual(y) };
  }

  const sum = vals.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - y) > 1) {
    return {
      ok: false,
      reason: `Monthly sum (₹${sum.toLocaleString('en-IN')}) does not match yearly amount (₹${y.toLocaleString('en-IN')})`,
    };
  }

  const allocation = {} as MonthlyAllocationByKey;
  EXCEL_MONTHS.forEach((m, i) => {
    allocation[ALLOC_MONTH_KEYS[i]] = roundBudgetAmount(months[m]);
  });
  return { ok: true, allocation };
}

export function coaCodesFromMasters(coaRecords: { code?: string }[]): string[] {
  const set = new Set<string>();
  for (const r of coaRecords) {
    const c = String(r.code ?? '').trim();
    if (c) set.add(c);
  }
  return [...set];
}

export function validateBudgetUploadRow(
  row: {
    glCode: string | number;
    yearlyAmount: number;
    months: PartialExcelMonths;
  },
  coaCodes: string[],
  duplicateBudgetCountForGlAndFy: number,
  duplicateGlInUploadFile: boolean
): string[] {
  const errors: string[] = [];
  const codeStr = String(row.glCode ?? '').trim();
  if (!codeStr) {
    errors.push('GL Code is required');
    return errors;
  }

  if (duplicateGlInUploadFile) {
    errors.push('Duplicate GL Code in upload file');
  }

  const coaNorm = coaCodes.map((c) => String(c).trim());
  if (!coaNorm.includes(codeStr)) {
    errors.push(`GL Code "${codeStr}" not found in COA master`);
  }

  if (!row.yearlyAmount || row.yearlyAmount <= 0) {
    errors.push('YearlyBudgetedAmount must be greater than 0');
  }

  if (duplicateBudgetCountForGlAndFy > 1) {
    errors.push('Multiple budgets exist for this GL Code and financial year — resolve manually');
  }

  if (row.yearlyAmount > 0) {
    const resolved = resolveMonthlyAllocationFromExcel(row.yearlyAmount, row.months);
    if (resolved.ok === false) {
      errors.push(resolved.reason);
    }
  }

  return errors;
}

export function formatIndianCurrency(amount: number): string {
  const n = Number(amount) || 0;
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}
