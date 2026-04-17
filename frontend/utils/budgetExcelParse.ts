import * as XLSX from 'xlsx';
import {
  EXCEL_MONTHS,
  type ExcelMonth,
  type PartialExcelMonths,
  roundBudgetAmount,
} from './budgetDistribution';

export interface ParsedBudgetExcelRow {
  sheetRowIndex: number;
  glCode: string;
  glName: string;
  yearlyAmount: number;
  months: PartialExcelMonths;
}

function normHeader(h: unknown): string {
  return String(h ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function parseNumberCell(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const s = String(v).trim().replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse workbook buffer or `File` — sheet **Detail**, header row, data rows.
 */
export function parseBudgetUploadWorkbook(data: ArrayBuffer): {
  ok: true;
  rows: ParsedBudgetExcelRow[];
} | { ok: false; error: string } {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(data, { type: 'array' });
  } catch {
    return { ok: false, error: 'Could not read Excel file' };
  }

  const sheet = wb.Sheets.Detail ?? wb.Sheets.detail;
  if (!sheet) {
    return { ok: false, error: 'Sheet "Detail" not found' };
  }

  const rowsAoA: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
  if (!rowsAoA.length) {
    return { ok: false, error: 'No data found in file' };
  }

  const headerRow = rowsAoA[0] as unknown[];
  const colIndex: Record<string, number> = {};
  headerRow.forEach((cell, idx) => {
    const key = normHeader(cell);
    if (key) colIndex[key] = idx;
  });

  const need = ['glname', 'glcode', 'yearlybudgetedamount', ...EXCEL_MONTHS.map((m) => m.toLowerCase())];
  const missing = need.filter((k) => colIndex[k] === undefined);
  if (missing.length) {
    return {
      ok: false,
      error: `Missing required column(s): ${missing.join(', ')}`,
    };
  }

  const out: ParsedBudgetExcelRow[] = [];
  for (let i = 1; i < rowsAoA.length; i++) {
    const line = rowsAoA[i] as unknown[];
    if (!line || !line.length) continue;
    const glCodeRaw = line[colIndex.glcode];
    const glCode = String(glCodeRaw ?? '').trim();
    if (!glCode) continue;

    const glName = String(line[colIndex.glname] ?? '').trim();
    const yearlyAmount = roundBudgetAmount(parseNumberCell(line[colIndex.yearlybudgetedamount]));
    const months: PartialExcelMonths = {};
    for (const m of EXCEL_MONTHS) {
      const idx = colIndex[m.toLowerCase()];
      if (idx !== undefined) {
        months[m] = roundBudgetAmount(parseNumberCell(line[idx]));
      }
    }

    out.push({
      sheetRowIndex: i + 1,
      glCode,
      glName,
      yearlyAmount,
      months,
    });
  }

  if (out.length === 0) {
    return { ok: false, error: 'No data found in file' };
  }

  return { ok: true, rows: out };
}

export async function parseBudgetUploadFile(file: File): Promise<
  | { ok: true; rows: ParsedBudgetExcelRow[] }
  | { ok: false; error: string }
> {
  const lower = file.name.toLowerCase();
  if (!lower.endsWith('.xlsx')) {
    return { ok: false, error: 'Only .xlsx files are accepted' };
  }
  const buf = await file.arrayBuffer();
  return parseBudgetUploadWorkbook(buf);
}

export function downloadBudgetUploadTemplate(): void {
  const headers = [
    'GL Name',
    'GL Code',
    ...EXCEL_MONTHS,
    'YearlyBudgetedAmount',
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Detail');
  XLSX.writeFile(wb, 'budget_upload_template.xlsx');
}
