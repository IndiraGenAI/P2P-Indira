import * as XLSX from 'xlsx';
import pool, { query } from '../db.js';

const EXCEL_MONTHS = [
  'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December', 'January', 'February', 'March',
];

const ALLOC_KEYS = ['apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar'];

function normHeader(h) {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

function roundMoney(n) {
  return Math.max(0, Math.round(Number(n) || 0));
}

function parseNumberCell(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number' && !Number.isNaN(v)) return v;
  const s = String(v).trim().replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function distributeEqual(y) {
  const base = Math.floor(y / 12);
  const remainder = y - base * 12;
  const out = {};
  ALLOC_KEYS.forEach((k, i) => {
    out[k] = base + (i < remainder ? 1 : 0);
  });
  return out;
}

function resolveAllocation(yearlyAmount, months) {
  const y = roundMoney(yearlyAmount);
  const vals = EXCEL_MONTHS.map((m) => roundMoney(months[m]));
  const allZero = vals.every((v) => v === 0);
  const negMonth = EXCEL_MONTHS.find((m) => roundMoney(months[m]) < 0);
  if (negMonth) {
    return { ok: false, reason: `Month "${negMonth}" has a negative value` };
  }
  if (y <= 0) {
    return { ok: false, reason: 'YearlyBudgetedAmount must be greater than 0' };
  }
  if (allZero) {
    return { ok: true, allocation: distributeEqual(y) };
  }
  const sum = vals.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - y) > 1) {
    return {
      ok: false,
      reason: `Monthly sum does not match yearly amount`,
    };
  }
  const allocation = {};
  EXCEL_MONTHS.forEach((m, i) => {
    allocation[ALLOC_KEYS[i]] = roundMoney(months[m]);
  });
  return { ok: true, allocation };
}

function parseWorkbookBuffer(buffer) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    return { ok: false, error: 'Could not read Excel file' };
  }
  const sheet = wb.Sheets.Detail ?? wb.Sheets.detail;
  if (!sheet) {
    return { ok: false, error: 'Sheet "Detail" not found' };
  }
  const rowsAoA = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (!rowsAoA.length) {
    return { ok: false, error: 'No data found in file' };
  }
  const headerRow = rowsAoA[0];
  const colIndex = {};
  headerRow.forEach((cell, idx) => {
    const key = normHeader(cell);
    if (key) colIndex[key] = idx;
  });
  const need = ['glname', 'glcode', 'yearlybudgetedamount', ...EXCEL_MONTHS.map((m) => m.toLowerCase())];
  const missing = need.filter((k) => colIndex[k] === undefined);
  if (missing.length) {
    return { ok: false, error: `Missing required column(s): ${missing.join(', ')}` };
  }
  const out = [];
  for (let i = 1; i < rowsAoA.length; i++) {
    const line = rowsAoA[i];
    if (!line || !line.length) continue;
    const glCode = String(line[colIndex.glcode] ?? '').trim();
    if (!glCode) continue;
    const glName = String(line[colIndex.glname] ?? '').trim();
    const yearlyAmount = roundMoney(parseNumberCell(line[colIndex.yearlybudgetedamount]));
    const months = {};
    for (const m of EXCEL_MONTHS) {
      months[m] = roundMoney(parseNumberCell(line[colIndex[m.toLowerCase()]]));
    }
    out.push({ sheetRowIndex: i + 1, glCode, glName, yearlyAmount, months });
  }
  if (out.length === 0) {
    return { ok: false, error: 'No data found in file' };
  }
  return { ok: true, rows: out };
}

async function loadCoaCodeSet() {
  const r = await query("SELECT name, data FROM masters WHERE master_type = 'COA'");
  const codes = new Set();
  for (const row of r.rows || []) {
    let data = row.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data || '{}');
      } catch {
        data = {};
      }
    }
    const code = String(data?.code || data?.coaCode || data?.glCode || row.name || '').trim();
    if (code) codes.add(code);
  }
  return codes;
}

function randomBudgetId() {
  return `B-${Math.random().toString(36).slice(2, 11).toUpperCase()}`;
}

/**
 * Express handler: multipart file + financialYear + defaults for INSERT.
 */
export async function postBudgetUpload(req, res) {
  const file = req.file;
  const {
    financialYear,
    defaultEntityName,
    defaultLocationName,
    defaultCostCenterName,
    defaultBudgetType,
    defaultControlType,
  } = req.body || {};

  const fy = String(financialYear || '').trim();
  if (!fy) {
    return res.status(400).json({
      success: false,
      created: 0,
      updated: 0,
      errors: [{ row: 0, glCode: '', reason: 'Financial year is required' }],
      message: 'Financial year is required',
    });
  }
  if (!file || !file.buffer) {
    return res.status(400).json({
      success: false,
      created: 0,
      updated: 0,
      errors: [{ row: 0, glCode: '', reason: 'Excel file is required' }],
      message: 'Excel file is required',
    });
  }

  const parsed = parseWorkbookBuffer(file.buffer);
  if (!parsed.ok) {
    return res.status(400).json({
      success: false,
      created: 0,
      updated: 0,
      errors: [{ row: 0, glCode: '', reason: parsed.error }],
      message: parsed.error,
    });
  }

  let coaSet;
  try {
    coaSet = await loadCoaCodeSet();
  } catch (e) {
    return res.status(500).json({
      success: false,
      created: 0,
      updated: 0,
      errors: [],
      message: e.message || 'Failed to load COA masters',
    });
  }

  const budgetRes = await query(
    'SELECT id, coa_code, financial_year FROM budgets WHERE financial_year = $1',
    [fy]
  );
  const byCoa = new Map();
  for (const row of budgetRes.rows || []) {
    const code = String(row.coa_code || '').trim();
    if (!byCoa.has(code)) byCoa.set(code, []);
    byCoa.get(code).push(row);
  }

  const glCountInFile = new Map();
  for (const row of parsed.rows) {
    const c = String(row.glCode).trim();
    glCountInFile.set(c, (glCountInFile.get(c) || 0) + 1);
  }

  const validationErrors = [];
  for (const row of parsed.rows) {
    const codeStr = String(row.glCode).trim();
    if (!coaSet.has(codeStr)) {
      validationErrors.push({
        row: row.sheetRowIndex,
        glCode: codeStr,
        reason: `GL Code "${codeStr}" not found in COA master`,
      });
      continue;
    }
    if ((glCountInFile.get(codeStr) || 0) > 1) {
      validationErrors.push({
        row: row.sheetRowIndex,
        glCode: codeStr,
        reason: 'Duplicate GL Code in upload file',
      });
      continue;
    }
    const matches = byCoa.get(codeStr) || [];
    if (matches.length > 1) {
      validationErrors.push({
        row: row.sheetRowIndex,
        glCode: codeStr,
        reason: 'Multiple budgets exist for this GL Code and financial year — resolve manually',
      });
      continue;
    }
    const resolved = resolveAllocation(row.yearlyAmount, row.months);
    if (!resolved.ok) {
      validationErrors.push({
        row: row.sheetRowIndex,
        glCode: codeStr,
        reason: resolved.reason,
      });
    }
  }

  if (validationErrors.length > 0) {
    return res.status(400).json({
      success: false,
      created: 0,
      updated: 0,
      errors: validationErrors,
      message: 'Upload failed. Fix errors and retry.',
    });
  }

  const needInsert = parsed.rows.filter((r) => (byCoa.get(String(r.glCode).trim()) || []).length === 0);
  if (needInsert.length > 0) {
    const ent = String(defaultEntityName || '').trim();
    const loc = String(defaultLocationName || '').trim();
    const cc = String(defaultCostCenterName || '').trim();
    if (!ent || !loc || !cc) {
      return res.status(400).json({
        success: false,
        created: 0,
        updated: 0,
        errors: [
          {
            row: 0,
            glCode: '',
            reason:
              'Default Entity, Location, and Cost Center are required when the file contains new GL budgets for this financial year',
          },
        ],
        message:
          'Default Entity, Location, and Cost Center are required for new budget rows',
      });
    }
  }

  const budgetType = String(defaultBudgetType || 'OPEX').trim() || 'OPEX';
  const controlType = String(defaultControlType || 'Hard Stop').trim() || 'Hard Stop';

  const client = await pool.connect();
  let created = 0;
  let updated = 0;
  try {
    await client.query('BEGIN');
    for (const row of parsed.rows) {
      const codeStr = String(row.glCode).trim();
      const resolved = resolveAllocation(row.yearlyAmount, row.months);
      if (!resolved.ok) {
        throw new Error(resolved.reason);
      }
      const allocationJson = JSON.stringify(resolved.allocation);
      const amount = roundMoney(row.yearlyAmount);
      const matches = byCoa.get(codeStr) || [];

      if (matches.length === 1) {
        await client.query(
          'UPDATE budgets SET amount = $1, monthly_allocation = $2::jsonb WHERE id = $3',
          [amount, allocationJson, matches[0].id]
        );
        updated += 1;
      } else {
        const ent = String(defaultEntityName || '').trim();
        const loc = String(defaultLocationName || '').trim();
        const cc = String(defaultCostCenterName || '').trim();
        const id = randomBudgetId();
        await client.query(
          `INSERT INTO budgets (
            id, financial_year, entity_name, location_name, cost_center_name, coa_code,
            department, sub_department, budget_type, amount, consumed_amount, control_type, validity, is_active,
            monthly_allocation, workflow_status, workflow_current_step_index, workflow_rule_id, workflow_created_by, workflow_rejection_remarks
          ) VALUES ($1,$2,$3,$4,$5,$6,null,null,$7,$8,0,$9,'Annual',true,$10::jsonb,'Draft',0,null,null,null)`,
          [id, fy, ent, loc, cc, codeStr, budgetType, amount, controlType, allocationJson]
        );
        created += 1;
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return res.status(500).json({
      success: false,
      created: 0,
      updated: 0,
      errors: [{ row: 0, glCode: '', reason: e.message || 'Database error' }],
      message: e.message || 'Upload failed',
    });
  } finally {
    client.release();
  }

  return res.json({
    success: true,
    created,
    updated,
    errors: [],
    message: `Budget upload successful. ${created} created, ${updated} updated.`,
  });
}
