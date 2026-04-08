import axios from 'axios';

// DFF: set FUSION_DFF_INVOICE_HEADER / _LINE / _DISTRIBUTION (JSON) and optional FUSION_DFF_*_WRAPPER keys; see mapInvoiceRowToOraclePayload JSDoc.
// Fusion-only default context: docs/oracle-fusion-dff-default-context-and-deploy.md

function oracleMode() {
  return (process.env.ORACLE_MODE || 'mock').trim().toLowerCase();
}

function fusionBaseURL() {
  // UAT/prod Fusion pod base, e.g. https://fa-xxx.fa.ocs.oraclecloud.com
  const fromEnv = process.env.FUSION_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  // Back-compat: allow using ORACLE_BASE_URL for live, but prefer FUSION_BASE_URL.
  const fallback = process.env.ORACLE_BASE_URL?.trim();
  if (fallback) return fallback.replace(/\/$/, '');
  throw new Error('Fusion base URL is not configured. Set FUSION_BASE_URL.');
}

function fusionApiVersion() {
  return (process.env.FUSION_API_VERSION || '11.13.18.05').trim();
}

export function getOracleBaseURL() {
  // Mock/local oracle base (used when ORACLE_MODE=mock)
  const fromEnv = process.env.ORACLE_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const port = process.env.PORT || 4050;
  return `http://127.0.0.1:${port}/mock-oracle`;
}

function commonHeaders() {
  if (oracleMode() === 'live') {
    // Required by Fusion REST; keep casing as header keys, values as strings.
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'REST-Framework-Version': String(process.env.FUSION_REST_FRAMEWORK_VERSION || '2'),
    };
  }
  return { 'Content-Type': 'application/json' };
}

function http() {
  if (oracleMode() === 'live') {
    const username = process.env.FUSION_USERNAME?.trim();
    const password = process.env.FUSION_PASSWORD?.trim();
    if (!username || !password) {
      throw new Error('Fusion credentials not configured. Set FUSION_USERNAME and FUSION_PASSWORD.');
    }
    return axios.create({
      baseURL: fusionBaseURL(),
      timeout: Number(process.env.FUSION_TIMEOUT_MS || 30000),
      headers: commonHeaders(),
      auth: { username, password },
      validateStatus: () => true,
    });
  }
  return axios.create({
    baseURL: getOracleBaseURL(),
    timeout: 30000,
    headers: commonHeaders(),
    validateStatus: () => true,
  });
}

function assertOk(res, label) {
  if (res.status >= 200 && res.status < 300) return res.data;
  const msg = res.data?.message || res.data?.error || `${label} failed (${res.status})`;
  const err = new Error(msg);
  err.status = res.status;
  err.data = res.data;
  throw err;
}

export async function createOracleInvoice(payload) {
  const mode = oracleMode();
  const path =
    mode === 'live'
      ? `/fscmRestApi/resources/${encodeURIComponent(fusionApiVersion())}/invoices`
      : (process.env.ORACLE_MOCK_FORCE_FAIL === 'true' ? '/invoices-fail' : '/invoices');
  const res = await withRetry(() => http().post(path, payload), 'Create Oracle invoice');
  return assertOk(res, 'Create Oracle invoice');
}

export async function calculateTax(payload) {
  const mode = oracleMode();
  const path =
    mode === 'live'
      ? `/fscmRestApi/resources/${encodeURIComponent(fusionApiVersion())}/invoices/action/calculateTax`
      : '/invoices/action/calculateTax';
  const res = await withRetry(() => http().post(path, payload ?? {}), 'Oracle calculateTax');
  return assertOk(res, 'Oracle calculateTax');
}

export async function getOracleInvoice(oracleInvoiceId) {
  const mode = oracleMode();
  const path =
    mode === 'live'
      ? `/fscmRestApi/resources/${encodeURIComponent(fusionApiVersion())}/invoices/${encodeURIComponent(oracleInvoiceId)}`
      : `/invoices/${encodeURIComponent(oracleInvoiceId)}`;
  const res = await withRetry(() => http().get(path), 'Get Oracle invoice');
  return assertOk(res, 'Get Oracle invoice');
}

function toYmd(value) {
  if (!value) return '';
  // Accept already yyyy-mm-dd; otherwise Date parse.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseEnvJsonObject(envKey) {
  const raw = process.env[envKey]?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch (e) {
    console.warn(`[oracleInvoiceService] Invalid JSON in ${envKey}: ${e.message}`);
    return null;
  }
}

function dffWrapperKey(envKey, fallback) {
  const k = process.env[envKey]?.trim();
  return k || fallback;
}

/** Replace {{placeholders}} in string leaves; supports nested objects/arrays. */
function applyDffPlaceholders(value, vars) {
  if (value == null) return value;
  if (typeof value === 'string') {
    return Object.keys(vars).reduce((s, key) => {
      const token = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      const rep = vars[key] != null ? String(vars[key]) : '';
      return s.replace(token, rep);
    }, value);
  }
  if (Array.isArray(value)) {
    return value.map((v) => applyDffPlaceholders(v, vars));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = applyDffPlaceholders(v, vars);
    }
    return out;
  }
  return value;
}

function buildDffFromTemplate(template, vars) {
  if (!template || typeof template !== 'object') return null;
  // Deep clone, then apply placeholder substitutions.
  const clone = JSON.parse(JSON.stringify(template));
  const applied = applyDffPlaceholders(clone, vars);
  if (!applied || typeof applied !== 'object' || Object.keys(applied).length === 0) return null;
  return applied;
}

async function withRetry(fn, label) {
  const retries = Math.max(0, Number(process.env.FUSION_RETRY_COUNT || 2));
  const baseDelayMs = Math.max(50, Number(process.env.FUSION_RETRY_DELAY_MS || 400));
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      // Axios network errors typically have no response.
      const status = e?.response?.status;
      const retryable =
        status == null || status === 429 || (status >= 500 && status <= 599);
      if (!retryable || attempt === retries) {
        // Surface a consistent error back to caller
        const err = new Error(e?.message || `${label} failed`);
        err.status = status;
        err.data = e?.response?.data;
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr || new Error(`${label} failed`);
}

/**
 * Builds payload for Fusion POST .../invoices.
 * IMPORTANT: `invoiceLines` and nested `invoiceDistributions` casing must match exactly.
 *
 * Expected opts:
 * - businessUnit: string
 * - supplier: string
 * - supplierSite: string
 * - legalEntity: string (Oracle Legal Entity name)
 * - paymentTerms: string (Oracle Payment Terms lookup, e.g. "Immediate")
 * - defaultDistributionCombination: string (fallback GL combination from Entity master)
 * - distributionCombinationForItem: (item) => string
 *
 * Env — descriptive flexfields (JSON objects, same shape as Fusion GET DFF bodies):
 * - FUSION_DFF_INVOICE_HEADER — under FUSION_DFF_HEADER_WRAPPER (default invoiceDff)
 * - FUSION_DFF_INVOICE_LINE — per line, under FUSION_DFF_LINE_WRAPPER (default invoiceLineDff)
 * - FUSION_DFF_INVOICE_DISTRIBUTION — per distribution, under FUSION_DFF_DISTRIBUTION_WRAPPER
 *   (default invoiceDistributionDff)
 *
 * Optional string placeholders (in env JSON values): {{invoiceDate}}, {{accountingDate}}, {{lineAccountingDate}},
 * {{todayYmd}}, {{lineNumber}}.
 */
export function mapInvoiceRowToOraclePayload(invoice, _supplierDisplayName, opts = {}) {
  const bu = opts.businessUnit || invoice.entityName || invoice.location || '';
  const supplier = opts.supplier || _supplierDisplayName || invoice.vendorSiteId || '';
  const supplierSite = opts.supplierSite || '';
  const currency = invoice.invoiceCurrency || 'INR';
  const invoiceDate = toYmd(invoice.invoiceDate) || toYmd(new Date());
  const accountingDate =
    toYmd(invoice.accountingDate) || toYmd(invoice.invoiceDate) || toYmd(new Date());
  const todayYmd = toYmd(new Date());

  const headerDffTemplate = parseEnvJsonObject('FUSION_DFF_INVOICE_HEADER');
  const lineDffTemplate = parseEnvJsonObject('FUSION_DFF_INVOICE_LINE');
  const distributionDffTemplate = parseEnvJsonObject('FUSION_DFF_INVOICE_DISTRIBUTION');
  const headerWrapper = dffWrapperKey('FUSION_DFF_HEADER_WRAPPER', 'invoiceDff');
  const lineWrapper = dffWrapperKey('FUSION_DFF_LINE_WRAPPER', 'invoiceLineDff');
  const distributionWrapper = dffWrapperKey(
    'FUSION_DFF_DISTRIBUTION_WRAPPER',
    'invoiceDistributionDff',
  );

  const headerDffVars = {
    invoiceDate,
    accountingDate,
    lineAccountingDate: accountingDate,
    todayYmd,
    lineNumber: '',
  };
  const headerDff = buildDffFromTemplate(headerDffTemplate, headerDffVars);

  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const distType = String(process.env.FUSION_DISTRIBUTION_LINE_TYPE || 'ITEM');

  const invoiceLines = items.map((it, idx) => {
    const lineNumber = idx + 1;
    const lineAmount = normalizeNumber(it?.amount ?? it?.totalAmount ?? (normalizeNumber(it?.quantity) * normalizeNumber(it?.rate)));
    const lineDesc = String(it?.desc || it?.itemName || it?.remarks || '').trim();
    const lineAccountingDate =
      toYmd(it?.accountingDate) || toYmd(it?.lineDate) || accountingDate;
    const combination =
      (typeof opts.distributionCombinationForItem === 'function'
        ? opts.distributionCombinationForItem(it)
        : '') || String(it?.oracleDistributionCombination || it?.distributionCombination || it?.coaCode || '').trim()
      || opts.defaultDistributionCombination || '';

    const dffVars = {
      invoiceDate,
      accountingDate,
      lineAccountingDate,
      todayYmd,
      lineNumber: String(lineNumber),
    };
    const lineDff = buildDffFromTemplate(lineDffTemplate, dffVars);
    const distDff = buildDffFromTemplate(distributionDffTemplate, dffVars);

    const distributionRow = {
      DistributionLineNumber: lineNumber,
      DistributionLineType: distType,
      AccountingDate: lineAccountingDate,
      DistributionAmount: lineAmount,
      DistributionCombination: combination,
    };
    if (distDff) {
      distributionRow[distributionWrapper] = [distDff];
    }

    const lineRow = {
      LineNumber: lineNumber,
      AccountingDate: lineAccountingDate,
      LineAmount: lineAmount,
      Description: lineDesc,
      invoiceDistributions: [
        distributionRow,
      ],
    };
    if (lineDff) {
      lineRow[lineWrapper] = [lineDff];
    }
    return lineRow;
  });

  const legalEntity = opts.legalEntity || '';
  const paymentTerms = opts.paymentTerms || invoice.paymentTerms || 'Immediate';
  const paymentMethod = invoice.paymentMethod || 'Electronic';

  const typeRaw = String(invoice.invoiceType || 'Standard').trim();
  const isPrepayment = typeRaw.toLowerCase() === 'prepayment';

  const payload = {
    InvoiceNumber: invoice.invoiceNumber || invoice.id,
    InvoiceCurrency: currency,
    PaymentCurrency: currency,
    InvoiceAmount: normalizeNumber(invoice.amount) || invoiceLines.reduce((s, l) => s + normalizeNumber(l.LineAmount), 0),
    InvoiceDate: invoiceDate,
    BusinessUnit: bu,
    Supplier: supplier,
    SupplierSite: supplierSite,
    ...(legalEntity ? { LegalEntity: legalEntity } : {}),
    PaymentTerms: paymentTerms,
    TermsDate: invoiceDate,
    PaymentMethod: paymentMethod,
    AccountingDate: accountingDate,
    Description: invoice.overallSummary || invoice.remarks || '',
    InvoiceSource: invoice.invoiceSource || 'P2P',
    InvoiceType: isPrepayment ? 'Prepayment' : typeRaw || 'Standard',
    ...(isPrepayment ? { InvoiceTypeMeaning: 'Prepayment' } : {}),
    invoiceLines,
  };

  if (headerDff) {
    payload[headerWrapper] = [headerDff];
  }

  return payload;
}
