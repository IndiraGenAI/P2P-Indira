import { Router } from 'express';
import jwt from 'jsonwebtoken';
import pool, { query, rowsToCamel, rowToCamel, objToSnake } from '../db.js';
import * as sessionTracker from '../sessionTracker.js';
import { generateDocumentPdf, pdfUtils } from '../services/pdfService.js';
import {
  createOracleInvoice,
  calculateTax,
  mapInvoiceRowToOraclePayload,
} from '../services/oracleInvoiceService.js';
import { onboardSupplier } from '../services/oracleSupplierService.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'p2p-indira-jwt-secret-change-in-production';

// JSON columns that may be stored as TEXT/JSON (not JSONB) and need parsing after retrieval
const JSON_COLUMNS = {
  workflows: ['approvalChain'],
  workflow_v2_rules: ['approvalChain'],
  roles: ['permissions', 'allowedMasterTypes', 'mastersPermissions'],
  users: ['centerNames', 'departments', 'subDepartments', 'entityNames', 'roleIds'],
  purchase_requests: ['centerNames', 'items', 'attachments', 'workflowStepHistory'],
  rate_contracts: ['items', 'attachments', 'workflowStepHistory'],
  purchase_orders: ['centerNames', 'items', 'attachments', 'workflowStepHistory'],
  grns: ['items', 'attachments', 'workflowStepHistory'],
  invoices: ['items', 'attachments', 'workflowStepHistory', 'oracleSyncResponse', 'oracleTaxResponse', 'oracleSyncError'],
  direct_invoices: ['items', 'attachments', 'workflowStepHistory', 'oracleSyncResponse', 'oracleTaxResponse', 'oracleSyncError'],
  budgets: ['workflowStepHistory'],
};

function stepUserIds(step) {
  if (!step) return [];
  return Array.isArray(step.userIds) ? step.userIds : Array.isArray(step.user_ids) ? step.user_ids : [];
}
function userInApprovalChain(chain, userId) {
  return Array.isArray(chain) && chain.some((s) => stepUserIds(s).includes(userId));
}
function appendMasterWorkflowHistory(data, entry) {
  const h = Array.isArray(data.workflowStepHistory) ? [...data.workflowStepHistory] : [];
  h.push({ ...entry, at: entry.at || new Date().toISOString() });
  data.workflowStepHistory = h;
}
function parseBudgetWorkflowHistory(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return [...raw];
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

// Generic handler: GET all from table, return camelCase rows with parsed JSON columns
async function getAll(table) {
  const res = await query(`SELECT * FROM ${table}`);
  const rows = rowsToCamel(res.rows);
  const jsonCols = JSON_COLUMNS[table] || [];
  if (jsonCols.length === 0) return rows;
  return rows.map(row => {
    const out = { ...row };
    for (const col of jsonCols) {
      if (typeof out[col] === 'string') {
        try { out[col] = JSON.parse(out[col]); } catch {}
      }
    }
    return out;
  });
}

function parseDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateOnly(d) {
  return d.toISOString().slice(0, 10);
}

function addMonthsSafe(date, months) {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getFrequencyWindow(today, validFrom, validTo, frequency) {
  const t = parseDateOnly(today);
  const vf = parseDateOnly(validFrom);
  const vt = parseDateOnly(validTo);
  if (!t || !vf || !vt) return { ok: false, reason: 'invalid_date' };
  if (t < vf || t > vt) return { ok: false, reason: 'outside_validity' };
  if (frequency === 'One-Time' || frequency === 'Monthly') {
    return { ok: true, start: vf, end: vt };
  }

  const monthsStep = frequency === 'Quarterly' ? 3 : 12;
  let start = new Date(vf.getTime());
  let end = addMonthsSafe(start, monthsStep);
  end.setDate(end.getDate() - 1);
  while (end < t && start < vt) {
    start = addMonthsSafe(start, monthsStep);
    end = addMonthsSafe(start, monthsStep);
    end.setDate(end.getDate() - 1);
  }
  if (start > vt) return { ok: false, reason: 'outside_validity' };
  if (end > vt) end = new Date(vt.getTime());
  return { ok: t >= start && t <= end, start, end };
}

function normalizeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function lineKey(item, index) {
  const id = item?.sourceItemId || item?.itemId || item?.id;
  if (id != null && String(id).trim() !== '') return `id:${String(id)}`;
  const itemName = String(item?.itemName || '').trim().toLowerCase();
  const center = String(item?.centerName || '').trim().toLowerCase();
  const rate = normalizeNumber(item?.rate);
  return `fallback:${itemName}|${center}|${rate}|${index}`;
}

const PDF_COMPANY = {
  name: process.env.PDF_COMPANY_NAME || 'P2P Admin Elite',
  address1: process.env.PDF_COMPANY_ADDR1 || 'Procurement Operations',
  address2: process.env.PDF_COMPANY_ADDR2 || 'India',
  gst: process.env.PDF_COMPANY_GST || '—',
  pan: process.env.PDF_COMPANY_PAN || '—',
};

async function getMasterMaps() {
  const m = await query("SELECT master_type, id, name, data FROM masters WHERE master_type IN ('Vendor','Vendor Site','Entity','COA','Payment Terms')");
  const vendorById = {};
  const vendorMetaById = {};
  const vendorSiteById = {};
  const entityByName = {};
  const coaOracleByCode = {};
  const paymentTermsById = {};
  for (const row of m.rows) {
    const data = typeof row.data === 'string' ? (() => { try { return JSON.parse(row.data || '{}'); } catch { return {}; } })() : (row.data || {});
    if (row.master_type === 'Vendor') {
      vendorById[row.id] = row.name;
      vendorMetaById[row.id] = {
        oracleSupplierName: data.oracleSupplierName,
        oracleSupplierNumber: data.oracleSupplierNumber,
      };
    }
    if (row.master_type === 'Vendor Site') {
      vendorSiteById[row.id] = {
        name: row.name,
        vendorId: data.vendorId || null,
        code: data.code || null,
        oracleSupplierSiteName: data.oracleSupplierSiteName,
      };
    }
    if (row.master_type === 'Entity') {
      entityByName[row.name] = {
        oracleBusinessUnit: data.oracleBusinessUnit,
        oracleLegalEntity: data.oracleLegalEntity,
        oracleLiabilityDistribution: data.oracleLiabilityDistribution,
      };
    }
    if (row.master_type === 'COA') {
      const code = String(data.code || data.coaCode || data.glCode || row.name || '').trim();
      if (code) {
        coaOracleByCode[code] = data.oracleDistributionCombination || data.distributionCombination || null;
      }
    }
    if (row.master_type === 'Payment Terms') {
      paymentTermsById[row.id] = {
        name: row.name,
        oraclePaymentTerms: data.oraclePaymentTerms || row.name,
      };
    }
  }
  return { vendorById, vendorMetaById, vendorSiteById, entityByName, coaOracleByCode, paymentTermsById };
}

function supplierNameForOracle(maps, invoice) {
  const site = invoice.vendorSiteId ? maps.vendorSiteById[invoice.vendorSiteId] : null;
  const vid = site?.vendorId;
  const meta = vid ? maps.vendorMetaById[vid] : null;
  const fromOracle = meta?.oracleSupplierName;
  const fromVendor = vid ? maps.vendorById[vid] : '';
  return (
    fromOracle
    || site?.oracleSupplierSiteName
    || site?.name
    || fromVendor
    || invoice.vendorSiteId
    || ''
  );
}

function supplierSiteForOracle(maps, invoice) {
  const site = invoice.vendorSiteId ? maps.vendorSiteById[invoice.vendorSiteId] : null;
  return (
    site?.oracleSupplierSiteName
    || site?.code
    || site?.name
    || invoice.vendorSiteId
    || ''
  );
}

function supplierNumberForOracle(maps, invoice) {
  const site = invoice.vendorSiteId ? maps.vendorSiteById[invoice.vendorSiteId] : null;
  const vid = site?.vendorId;
  const meta = vid ? maps.vendorMetaById[vid] : null;
  return meta?.oracleSupplierNumber || '';
}

function businessUnitForOracle(maps, invoice) {
  const ent = invoice.entityName ? maps.entityByName[invoice.entityName] : null;
  return ent?.oracleBusinessUnit || invoice.entityName || invoice.location || '';
}

function legalEntityForOracle(maps, invoice) {
  const ent = invoice.entityName ? maps.entityByName[invoice.entityName] : null;
  return ent?.oracleLegalEntity || '';
}

function defaultDistributionForOracle(maps, invoice) {
  const ent = invoice.entityName ? maps.entityByName[invoice.entityName] : null;
  return ent?.oracleLiabilityDistribution || '';
}

function paymentTermsForOracle(maps, invoice) {
  const ptId = invoice.paymentTerms || invoice.paymentTermsId;
  if (ptId && maps.paymentTermsById[ptId]) {
    return maps.paymentTermsById[ptId].oraclePaymentTerms;
  }
  if (typeof ptId === 'string' && ptId.trim()) return ptId.trim();
  return 'Immediate';
}

function distributionCombinationForItem(maps, item) {
  const code = String(item?.coaCode || '').trim();
  const mapped = code ? maps.coaOracleByCode?.[code] : null;
  return mapped || '';
}

async function getDocByTable(table, id) {
  const res = await query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  if (!res.rows[0]) return null;
  const row = rowToCamel(res.rows[0]);
  const jsonCols = JSON_COLUMNS[table] || [];
  for (const col of jsonCols) {
    if (typeof row[col] === 'string') {
      try { row[col] = JSON.parse(row[col]); } catch {}
    }
  }
  return row;
}

async function runGrnInvoiceOracleSync(id, { force = false } = {}) {
  let createRes = null;
  let oracleId = null;
  try {
    const invoice = await getDocByTable('invoices', id);
    if (!invoice) return { skipped: true, reason: 'not_found' };
    if (invoice.status !== 'Approved') return { skipped: true, reason: 'not_approved' };
    if (!force && invoice.oracleSyncStatus === 'SUCCESS' && invoice.oracleInvoiceId) {
      return { skipped: true, reason: 'already_synced' };
    }

    await query(`UPDATE invoices SET accounting_date = COALESCE(accounting_date, CURRENT_DATE) WHERE id = $1`, [id]);

    const maps = await getMasterMaps();
    const supplierName = supplierNameForOracle(maps, invoice);
    const supplierSite = supplierSiteForOracle(maps, invoice);
    const bu = businessUnitForOracle(maps, invoice);
    const legalEntity = legalEntityForOracle(maps, invoice);
    const defaultDist = defaultDistributionForOracle(maps, invoice);
    const paymentTerms = paymentTermsForOracle(maps, invoice);
    const payload = mapInvoiceRowToOraclePayload(invoice, supplierName, {
      businessUnit: bu,
      supplier: supplierName,
      supplierSite,
      legalEntity,
      paymentTerms,
      defaultDistributionCombination: defaultDist,
      distributionCombinationForItem: (it) => distributionCombinationForItem(maps, it),
    });
    createRes = await createOracleInvoice(payload);
    oracleId = createRes.InvoiceId != null ? String(createRes.InvoiceId) : null;

    let taxRes = null;
    let taxWarning = null;
    try {
      taxRes = await calculateTax({ InvoiceId: oracleId, InvoiceNumber: payload.InvoiceNumber });
    } catch (taxErr) {
      taxWarning = taxErr.message || 'calculateTax failed';
      console.warn('[oracle tax]', id, taxWarning);
    }

    const syncResponse = { create: createRes, syncedAt: new Date().toISOString(), ...(taxWarning ? { taxWarning } : {}) };

    await query(
      `UPDATE invoices SET oracle_invoice_id = $1, oracle_sync_status = $2, oracle_sync_response = $3::jsonb, oracle_tax_response = $4::jsonb, oracle_sync_error = NULL WHERE id = $5`,
      [oracleId, 'SUCCESS', JSON.stringify(syncResponse), JSON.stringify(taxRes), id]
    );

    return { ok: true, oracleInvoiceId: oracleId, createResponse: createRes, taxResponse: taxRes, taxWarning };
  } catch (e) {
    const errPayload = { message: e.message, data: e.data ?? null, at: new Date().toISOString() };
    try {
      if (oracleId) {
        await query(
          `UPDATE invoices SET oracle_sync_status = $1, oracle_invoice_id = COALESCE(oracle_invoice_id, $2), oracle_sync_response = $3::jsonb, oracle_sync_error = $4::jsonb WHERE id = $5`,
          ['FAILED', oracleId, JSON.stringify(createRes ? { create: createRes } : {}), JSON.stringify(errPayload), id]
        );
      } else {
        await query(
          `UPDATE invoices SET oracle_sync_status = $1, oracle_sync_error = $2::jsonb WHERE id = $3`,
          ['FAILED', JSON.stringify(errPayload), id]
        );
      }
    } catch (dbErr) {
      console.error('[oracle sync db]', id, dbErr.message);
    }
    throw e;
  }
}

async function runDirectInvoiceOracleSync(id, { force = false } = {}) {
  let createRes = null;
  let oracleId = null;
  try {
    const invoice = await getDocByTable('direct_invoices', id);
    if (!invoice) return { skipped: true, reason: 'not_found' };
    if (invoice.status !== 'Approved') return { skipped: true, reason: 'not_approved' };
    if (!force && invoice.oracleSyncStatus === 'SUCCESS' && invoice.oracleInvoiceId) {
      return { skipped: true, reason: 'already_synced' };
    }

    await query(`UPDATE direct_invoices SET accounting_date = COALESCE(accounting_date, CURRENT_DATE) WHERE id = $1`, [id]);

    const maps = await getMasterMaps();
    const supplierName = supplierNameForOracle(maps, invoice);
    const supplierSite = supplierSiteForOracle(maps, invoice);
    const bu = businessUnitForOracle(maps, invoice);
    const legalEntity = legalEntityForOracle(maps, invoice);
    const defaultDist = defaultDistributionForOracle(maps, invoice);
    const paymentTerms = paymentTermsForOracle(maps, invoice);
    const payload = mapInvoiceRowToOraclePayload(invoice, supplierName, {
      businessUnit: bu,
      supplier: supplierName,
      supplierSite,
      legalEntity,
      paymentTerms,
      defaultDistributionCombination: defaultDist,
      distributionCombinationForItem: (it) => distributionCombinationForItem(maps, it),
    });
    createRes = await createOracleInvoice(payload);
    oracleId = createRes.InvoiceId != null ? String(createRes.InvoiceId) : null;

    let taxRes = null;
    let taxWarning = null;
    try {
      taxRes = await calculateTax({ InvoiceId: oracleId, InvoiceNumber: payload.InvoiceNumber });
    } catch (taxErr) {
      taxWarning = taxErr.message || 'calculateTax failed';
      console.warn('[oracle direct tax]', id, taxWarning);
    }

    const syncResponse = { create: createRes, syncedAt: new Date().toISOString(), ...(taxWarning ? { taxWarning } : {}) };

    await query(
      `UPDATE direct_invoices SET oracle_invoice_id = $1, oracle_sync_status = $2, oracle_sync_response = $3::jsonb, oracle_tax_response = $4::jsonb, oracle_sync_error = NULL WHERE id = $5`,
      [oracleId, 'SUCCESS', JSON.stringify(syncResponse), JSON.stringify(taxRes), id]
    );

    return { ok: true, oracleInvoiceId: oracleId, createResponse: createRes, taxResponse: taxRes, taxWarning };
  } catch (e) {
    const errPayload = { message: e.message, data: e.data ?? null, at: new Date().toISOString() };
    try {
      if (oracleId) {
        await query(
          `UPDATE direct_invoices SET oracle_sync_status = $1, oracle_invoice_id = COALESCE(oracle_invoice_id, $2), oracle_sync_response = $3::jsonb, oracle_sync_error = $4::jsonb WHERE id = $5`,
          ['FAILED', oracleId, JSON.stringify(createRes ? { create: createRes } : {}), JSON.stringify(errPayload), id]
        );
      } else {
        await query(
          `UPDATE direct_invoices SET oracle_sync_status = $1, oracle_sync_error = $2::jsonb WHERE id = $3`,
          ['FAILED', JSON.stringify(errPayload), id]
        );
      }
    } catch (dbErr) {
      console.error('[oracle direct sync db]', id, dbErr.message);
    }
    throw e;
  }
}

function commonSummaryFromItems(items, totalAmount) {
  const base = (items || []).reduce((s, it) => s + normalizeNumber(it.amount ?? (normalizeNumber(it.quantity) * normalizeNumber(it.rate))), 0);
  const total = normalizeNumber(totalAmount) || base;
  const gst = Math.max(0, total - base);
  return [
    { label: 'Subtotal:', value: pdfUtils.formatCurrency(base) },
    { label: 'GST:', value: pdfUtils.formatCurrency(gst) },
    { label: 'TOTAL:', value: pdfUtils.formatCurrency(total) },
  ];
}

async function getPoRemainingQuantities(poId) {
  const poRes = await query('SELECT * FROM purchase_orders WHERE id = $1', [poId]);
  const poRow = poRes.rows[0];
  if (!poRow) return null;
  const po = rowToCamel(poRow);
  const poItems = typeof po.items === 'string'
    ? (() => { try { return JSON.parse(po.items); } catch { return []; } })()
    : (Array.isArray(po.items) ? po.items : []);

  const grnRes = await query('SELECT * FROM grns WHERE purchase_order_id = $1', [poId]);
  const poGrns = rowsToCamel(grnRes.rows).map((g) => ({
    ...g,
    items: typeof g.items === 'string' ? (() => { try { return JSON.parse(g.items); } catch { return []; } })() : (Array.isArray(g.items) ? g.items : []),
  }));

  const receivedByKey = new Map();
  poGrns.forEach((grn) => {
    (grn.items || []).forEach((it, idx) => {
      const key = lineKey(it, idx);
      receivedByKey.set(key, (receivedByKey.get(key) || 0) + normalizeNumber(it.quantity));
    });
  });

  const items = poItems.map((it, idx) => {
    const key = lineKey(it, idx);
    const orderedQty = normalizeNumber(it.quantity);
    const receivedQty = normalizeNumber(receivedByKey.get(key) || 0);
    const leftQty = Math.max(0, orderedQty - receivedQty);
    return {
      itemName: it.itemName,
      itemId: it.id || null,
      orderedQty,
      receivedQty,
      leftQty,
      rate: normalizeNumber(it.rate),
      center: it.centerName || '',
    };
  });

  return { po, items };
}

// Build upsert for tables with many columns - use raw column list and JSON for jsonb
function buildUpsert(table, pk, columns, body) {
  if (!Array.isArray(body)) return Promise.resolve();
  const cols = columns.map((c) => (c.includes('_') ? c : c.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')));
  return Promise.all(
    body.map((row) => {
      const s = objToSnake(row);
      const vals = cols.map((c) => {
        const v = s[c];
        if (v === undefined) return null;
        if (typeof v === 'object' && v !== null) return JSON.stringify(v);
        return v;
      });
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const setClause = cols.filter((c) => c !== pk).map((c) => `${c} = $${cols.indexOf(c) + 1}`).join(', ');
      return query(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT (${pk}) DO UPDATE SET ${setClause}`,
        vals
      );
    })
  );
}

// --- JWT auth middleware ---
async function getRoleNamesForUser(roleIds) {
  if (!Array.isArray(roleIds) || roleIds.length === 0) return [];
  const result = await query('SELECT id, name FROM roles');
  const roleMap = {};
  result.rows.forEach((r) => { roleMap[r.id] = r.name; });
  return roleIds.map((id) => roleMap[id]).filter(Boolean);
}

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const result = await query('SELECT * FROM users WHERE id = $1', [payload.userId]);
    const row = result.rows[0];
    if (!row || !row.is_active) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const user = rowToCamel(row);
    const { passwordHash, ...userSafe } = user;
    const jsonCols = JSON_COLUMNS.users || [];
    const out = { ...userSafe };
    for (const col of jsonCols) {
      if (typeof out[col] === 'string') {
        try { out[col] = JSON.parse(out[col]); } catch {}
      }
    }
    req.user = out;

    const roleNames = await getRoleNamesForUser(out.roleIds || []);
    if (sessionTracker.isExemptRoleNames(roleNames)) return next();

    const remaining = sessionTracker.getSessionExpiry(out.id);
    if (remaining === null || remaining <= 0) {
      sessionTracker.removeSession(out.id);
      console.log(`[sessionTracker] Session expired for user ${out.id}`);
      return res.status(401).json({ error: 'Your session has expired. Please log in again.', code: 'SESSION_EXPIRED' });
    }
    res.setHeader('X-Session-Remaining', String(remaining));
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

router.use((req, res, next) => {
  if (req.path === '/health' && req.method === 'GET') return next();
  if (req.path === '/login' && req.method === 'POST') return next();
  requireAuth(req, res, next);
});

router.get('/health', (req, res) => {
  res.json({ ok: true, message: 'API is up' });
});

// --- LOGIN (no auth) ---
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || typeof password !== 'string') {
      return res.status(401).send('Invalid email or password. Please try again.');
    }
    const result = await query(
      'SELECT * FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))',
      [email]
    );
    const row = result.rows[0];
    if (!row || !row.is_active) {
      return res.status(401).send('Invalid email or password. Please try again.');
    }
    const storedPassword = row.password_hash;
    if (storedPassword !== password) {
      return res.status(401).send('Password is wrong, please type again.');
    }
    const user = rowToCamel(row);
    const { passwordHash, ...userSafe } = user;
    const jsonCols = JSON_COLUMNS.users || [];
    const out = { ...userSafe };
    for (const col of jsonCols) {
      if (typeof out[col] === 'string') {
        try { out[col] = JSON.parse(out[col]); } catch {}
      }
    }

    const roleRes = await query('SELECT id, name FROM roles');
    const roleMap = {};
    roleRes.rows.forEach((r) => { roleMap[r.id] = r.name; });
    const roleNames = (out.roleIds || []).map((id) => roleMap[id]).filter(Boolean);
    if (!sessionTracker.isExemptRoleNames(roleNames)) {
      if (!sessionTracker.canRegularUserLogin()) {
        console.log('[sessionTracker] Regular user login rejected: concurrent limit reached');
        return res.status(503).json({
          error: 'Concurrent user limit reached. Only 200 users can be logged in at a time. Please try logging in after 10 minutes.',
          code: 'CONCURRENT_LIMIT',
        });
      }
      sessionTracker.registerSession(row.id);
    }

    const token = jwt.sign({ userId: row.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- LOGOUT (auth required; removes session from tracker) ---
router.post('/logout', (req, res) => {
  sessionTracker.removeSession(req.user.id);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json(req.user);
});

// --- ROLES ---
const ROLES_COLS = ['id', 'name', 'is_active', 'permissions', 'allowed_master_types', 'masters_permissions'];
router.get('/roles', async (req, res) => {
  try {
    const rows = await getAll('roles');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.post('/roles', async (req, res) => {
  try {
    await buildUpsert('roles', 'id', ROLES_COLS, req.body);
    const rows = await getAll('roles');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- USERS ---
const USERS_COLS = ['id', 'employee_id', 'name', 'center_names', 'departments', 'sub_departments', 'phone_number', 'email', 'entity_names', 'role_ids', 'is_active', 'password_hash'];

function stripPasswordHash(rows) {
  return (rows || []).map((row) => {
    const { passwordHash, ...rest } = row;
    return rest;
  });
}

router.get('/users', async (req, res) => {
  try {
    const rows = await getAll('users');
    res.json(stripPasswordHash(rows));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/users', async (req, res) => {
  try {
    const body = Array.isArray(req.body) ? req.body : [];
    const withPassword = await Promise.all(
      body.map(async (row) => {
        const { password, confirmPassword, ...rest } = row;
        const out = { ...rest };
        if (password != null && String(password).length > 0) {
          out.passwordHash = password;
        } else if (out.id) {
          const existing = await query('SELECT password_hash FROM users WHERE id = $1', [out.id]);
          if (existing.rows[0]?.password_hash != null) {
            out.passwordHash = existing.rows[0].password_hash;
          }
        }
        return out;
      })
    );
    await buildUpsert('users', 'id', USERS_COLS, withPassword);
    const rows = await getAll('users');
    res.json(stripPasswordHash(rows));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- WORKFLOWS ---
const WORKFLOWS_COLS = ['id', 'entity_name', 'module_type', 'sub_department', 'center_name', 'min_amount', 'max_amount', 'approval_chain', 'is_active'];
router.get('/workflows', async (req, res) => {
  try {
    const rows = await getAll('workflows');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.post('/workflows', async (req, res) => {
  try {
    await query('DELETE FROM workflows');
    await buildUpsert('workflows', 'id', WORKFLOWS_COLS, req.body);
    const rows = await getAll('workflows');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- WORKFLOW V2 (Item / Vendor creation approval — independent of document workflows) ---
const WORKFLOW_V2_COLS = ['id', 'scope', 'master_id', 'approval_chain', 'is_active'];
router.get('/workflow-v2', async (req, res) => {
  try {
    const rows = await getAll('workflow_v2_rules');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.post('/workflow-v2', async (req, res) => {
  try {
    const body = Array.isArray(req.body) ? req.body : [req.body];
    for (const row of body) {
      const { id, scope, masterId, approvalChain, isActive } = row;
      const chain = approvalChain && Array.isArray(approvalChain) ? JSON.stringify(approvalChain) : '[]';
      await query(
        `INSERT INTO workflow_v2_rules (id, scope, master_id, approval_chain, is_active)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (scope, master_id) DO UPDATE SET approval_chain = $4::jsonb, is_active = $5`,
        [id || `wv2-${Math.random().toString(36).slice(2, 11)}`, scope, masterId, chain, isActive !== false]
      );
    }
    const rows = await getAll('workflow_v2_rules');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.get('/workflow-v2/pending', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.json([]);
    const rulesRes = await query('SELECT * FROM workflow_v2_rules WHERE is_active = true');
    const mastersRes = await query("SELECT * FROM masters WHERE master_type IN ('Item', 'Vendor')");
    const budgetsRes = await query('SELECT * FROM budgets');
    const rules = (rulesRes.rows || []).map((r) => ({
      id: r.id,
      scope: r.scope,
      masterId: r.master_id,
      approvalChain: typeof r.approval_chain === 'string' ? JSON.parse(r.approval_chain || '[]') : (r.approval_chain || []),
    }));
    const pending = [];
    for (const row of mastersRes.rows || []) {
      const data = row.data && typeof row.data === 'object' ? row.data : {};
      if (data.workflowStatus !== 'Pending') continue;
      const stepIndex = typeof data.workflowCurrentStepIndex === 'number' ? data.workflowCurrentStepIndex : 0;
      const rule = rules.find((r) => r.scope === row.master_type && r.masterId === '__ALL__');
      if (!rule || !rule.approvalChain.length) continue;
      const step = rule.approvalChain[stepIndex];
      if (!step) continue;
      const userIds = Array.isArray(step.userIds) ? step.userIds : (Array.isArray(step.user_ids) ? step.user_ids : []);
      if (!userIds.includes(userId)) continue;
      pending.push({
        scope: row.master_type,
        masterId: row.id,
        masterName: row.name,
        currentStepIndex: stepIndex,
        ruleId: rule.id,
        stepType: step.type || 'Reviewer',
      });
    }
    for (const row of budgetsRes.rows || []) {
      const wfStatus = row.workflow_status || 'Draft';
      if (wfStatus !== 'Pending') continue;
      const stepIndex = typeof row.workflow_current_step_index === 'number' ? row.workflow_current_step_index : 0;
      const rule = rules.find((r) => r.scope === 'Budget' && r.masterId === '__ALL__');
      if (!rule || !rule.approvalChain.length) continue;
      const step = rule.approvalChain[stepIndex];
      if (!step) continue;
      const userIds = Array.isArray(step.userIds) ? step.userIds : (Array.isArray(step.user_ids) ? step.user_ids : []);
      if (!userIds.includes(userId)) continue;
      pending.push({
        scope: 'Budget',
        masterId: row.id,
        masterName: `${row.coa_code} - ${row.entity_name || row.id}`,
        currentStepIndex: stepIndex,
        ruleId: rule.id,
        stepType: step.type || 'Reviewer',
      });
    }
    res.json(pending);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/workflow-v2/my-workspace', async (req, res) => {
  try {
    const userId = req.user?.id;
    const scope = req.query.scope;
    if (!userId) return res.json({ actionRequired: [], activityLog: [] });
    if (!['Item', 'Vendor', 'Budget'].includes(String(scope || ''))) {
      return res.status(400).json({ error: 'Query scope must be Item, Vendor, or Budget' });
    }
    const rulesRes = await query('SELECT * FROM workflow_v2_rules WHERE is_active = true');
    const rules = (rulesRes.rows || []).map((r) => ({
      id: r.id,
      scope: r.scope,
      masterId: r.master_id,
      approvalChain:
        typeof r.approval_chain === 'string' ? JSON.parse(r.approval_chain || '[]') : r.approval_chain || [],
    }));
    const actionRequired = [];
    const activityLog = [];

    if (scope === 'Budget') {
      const rule = rules.find((r) => r.scope === 'Budget' && r.masterId === '__ALL__');
      const chain = rule?.approvalChain || [];
      const budgetsRes = await query('SELECT * FROM budgets');
      for (const row of budgetsRes.rows || []) {
        const wfStatus = row.workflow_status || 'Draft';
        if (!['Pending', 'Approved', 'Rejected'].includes(wfStatus)) continue;
        const hist = parseBudgetWorkflowHistory(row.workflow_step_history);
        const createdBy = row.workflow_created_by;
        const participated =
          createdBy === userId ||
          userInApprovalChain(chain, userId) ||
          hist.some((e) => e && e.userId === userId);
        if (!participated) continue;
        const stepIndex = typeof row.workflow_current_step_index === 'number' ? row.workflow_current_step_index : 0;
        const masterId = row.id;
        const masterName = `${row.coa_code || ''} — ${row.entity_name || row.id}`.replace(/^ — /, '');
        if (wfStatus === 'Pending' && rule && chain.length) {
          const step = chain[stepIndex];
          const uids = stepUserIds(step);
          if (uids.includes(userId)) {
            actionRequired.push({
              scope: 'Budget',
              masterId,
              masterName,
              currentStepIndex: stepIndex,
              ruleId: rule.id,
              stepType: step?.type || 'Reviewer',
            });
            continue;
          }
        }
        let waitingNote = '';
        if (wfStatus === 'Pending' && chain[stepIndex]) {
          waitingNote = `Current step: ${chain[stepIndex].type || 'Reviewer'} (others)`;
        } else if (wfStatus === 'Approved') waitingNote = 'Approved';
        else if (wfStatus === 'Rejected') waitingNote = 'Rejected';
        const lastAt = hist.length ? hist[hist.length - 1].at : '';
        activityLog.push({
          scope: 'Budget',
          masterId,
          masterName,
          workflowStatus: wfStatus,
          currentStepIndex: stepIndex,
          waitingNote,
          workflowStepHistory: hist,
          sortKey: lastAt || masterId,
        });
      }
    } else {
      const rule = rules.find((r) => r.scope === scope && r.masterId === '__ALL__');
      const chain = rule?.approvalChain || [];
      const mastersRes = await query('SELECT * FROM masters WHERE master_type = $1', [scope]);
      for (const row of mastersRes.rows || []) {
        const data = row.data && typeof row.data === 'object' ? row.data : {};
        const wfStatus = data.workflowStatus || 'Draft';
        if (!['Pending', 'Approved', 'Rejected'].includes(wfStatus)) continue;
        const hist = Array.isArray(data.workflowStepHistory) ? data.workflowStepHistory : [];
        const createdBy = data.workflowCreatedBy;
        const participated =
          createdBy === userId ||
          userInApprovalChain(chain, userId) ||
          hist.some((e) => e && e.userId === userId);
        if (!participated) continue;
        const stepIndex = typeof data.workflowCurrentStepIndex === 'number' ? data.workflowCurrentStepIndex : 0;
        const masterId = row.id;
        const masterName = row.name || row.id;
        if (wfStatus === 'Pending' && rule && chain.length) {
          const step = chain[stepIndex];
          const uids = stepUserIds(step);
          if (uids.includes(userId)) {
            actionRequired.push({
              scope,
              masterId,
              masterName,
              currentStepIndex: stepIndex,
              ruleId: rule.id,
              stepType: step?.type || 'Reviewer',
            });
            continue;
          }
        }
        let waitingNote = '';
        if (wfStatus === 'Pending' && chain[stepIndex]) {
          waitingNote = `Current step: ${chain[stepIndex].type || 'Reviewer'} (others)`;
        } else if (wfStatus === 'Approved') waitingNote = 'Approved';
        else if (wfStatus === 'Rejected') waitingNote = 'Rejected';
        const lastAt = hist.length ? hist[hist.length - 1].at : '';
        activityLog.push({
          scope,
          masterId,
          masterName,
          workflowStatus: wfStatus,
          currentStepIndex: stepIndex,
          waitingNote,
          workflowStepHistory: hist,
          sortKey: lastAt || masterId,
        });
      }
    }
    activityLog.sort((a, b) => String(b.sortKey || '').localeCompare(String(a.sortKey || '')));
    const trimmed = activityLog.map(({ sortKey, ...rest }) => rest);
    res.json({ actionRequired, activityLog: trimmed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/masters/:masterType/:id/workflow', async (req, res) => {
  try {
    const { masterType, id } = req.params;
    if (!['Item', 'Vendor'].includes(masterType)) return res.status(400).json({ error: 'Invalid master type' });
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { action, rejectionRemarks } = req.body || {};
    const masterRes = await query('SELECT * FROM masters WHERE master_type = $1 AND id = $2', [masterType, id]);
    const master = masterRes.rows[0];
    if (!master) return res.status(404).json({ error: 'Master not found' });
    const data = master.data && typeof master.data === 'object' ? { ...master.data } : {};
    let workflowStatus = data.workflowStatus || 'Draft';
    let workflowCurrentStepIndex = typeof data.workflowCurrentStepIndex === 'number' ? data.workflowCurrentStepIndex : 0;
    const ruleRes = await query('SELECT * FROM workflow_v2_rules WHERE scope = $1 AND master_id = $2 AND is_active = true', [masterType, '__ALL__']);
    const ruleRow = ruleRes.rows[0];
    const approvalChain = ruleRow
      ? (typeof ruleRow.approval_chain === 'string' ? JSON.parse(ruleRow.approval_chain || '[]') : ruleRow.approval_chain || [])
      : [];
    if (action === 'submit') {
      if (!ruleRow) return res.status(400).json({ error: 'No workflow rule configured for this master' });

      if (masterType === 'Vendor') {
        const v = data;
        const missing = [];
        if (!v.address1) missing.push('Address Line 1');
        if (!(v.state || v.stateId)) missing.push('State');
        if (!(v.city || v.cityId)) missing.push('City');
        if (!v.pincode) missing.push('Pincode');
        if (!v.countryCode) missing.push('Country');
        if (v.pan && !v.taxpayerCountryCode) missing.push('Taxpayer Country Code');
        if (!(v.contactFirstName || v.contactLastName)) missing.push('Contact Name (First or Last)');
        if (!v.accNo) missing.push('Bank Account Number');
        if (!v.ifsc && !v.bankIdentifier) missing.push('IFSC Code');
        if (missing.length) {
          return res.status(400).json({
            error: `Cannot submit for approval. Missing required Oracle onboarding fields: ${missing.join(', ')}. Please fill them and Sync again.`,
          });
        }
        console.log('[WorkflowV2] Vendor Oracle field validation passed — submitting to workflow');
      }

      workflowStatus = 'Pending';
      workflowCurrentStepIndex = 0;
      data.workflowStatus = workflowStatus;
      data.workflowCurrentStepIndex = workflowCurrentStepIndex;
      data.workflowRuleId = ruleRow.id;
      data.workflowCreatedBy = userId;
      appendMasterWorkflowHistory(data, { action: 'submit', userId });
    } else if (action === 'completeReview' || action === 'approve' || action === 'reject') {
      if (workflowStatus !== 'Pending') return res.status(400).json({ error: 'Not pending' });
      const stepIdxAtAction = workflowCurrentStepIndex;
      const step = approvalChain[workflowCurrentStepIndex];
      if (!step) return res.status(400).json({ error: 'Invalid step' });
      const userIds = Array.isArray(step.userIds) ? step.userIds : (Array.isArray(step.user_ids) ? step.user_ids : []);
      if (!userIds.includes(userId)) return res.status(403).json({ error: 'Not in current step' });
      if (action === 'reject') {
        workflowStatus = 'Rejected';
        data.workflowStatus = workflowStatus;
        if (rejectionRemarks != null) data.workflowRejectionRemarks = rejectionRemarks;
      } else if (step.type === 'Approver' || (approvalChain.length <= 1)) {
        workflowStatus = 'Approved';
        data.workflowStatus = workflowStatus;
      } else {
        workflowCurrentStepIndex += 1;
        if (workflowCurrentStepIndex >= approvalChain.length) {
          workflowStatus = 'Approved';
          data.workflowStatus = workflowStatus;
          data.workflowCurrentStepIndex = 0;
        } else {
          data.workflowCurrentStepIndex = workflowCurrentStepIndex;
        }
      }
      appendMasterWorkflowHistory(data, { action, stepIndex: stepIdxAtAction, userId });
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }
    await query('UPDATE masters SET data = $1 WHERE master_type = $2 AND id = $3', [JSON.stringify(data), masterType, id]);

    if (masterType === 'Vendor' && workflowStatus === 'Approved') {
      console.log(`[WorkflowV2] Vendor "${id}" approved — triggering Oracle Fusion onboarding...`);
      try {
        const result = await onboardSupplier(id);
        if (result.success) {
          console.log(`[WorkflowV2] Auto-onboard SUCCESS for vendor "${id}": ${result.message}`);
        } else {
          console.warn(`[WorkflowV2] Auto-onboard PARTIAL for vendor "${id}": ${result.message}`);
        }
      } catch (e) {
        console.error(`[WorkflowV2] Auto-onboard FAILED for vendor "${id}":`, e.message);
      }
    }

    const updated = await query('SELECT * FROM masters WHERE master_type = $1 AND id = $2', [masterType, id]);
    const row = updated.rows[0];
    const rec = { id: row.id, name: row.name, status: row.status, ...(row.data || {}) };
    res.json(rec);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function normalizeTopVendorParams(rawQuery = {}) {
  const allowedDoc = new Set(['ALL', 'PO', 'RC', 'PR', 'DI']);
  const allowedVendorType = new Set(['all', 'Micro', 'Small', 'Medium', 'Large']);
  const allowedLimit = new Set([10, 20, 30, 50]);
  const allowedSort = new Set([
    'totalAmount',
    'poAmount',
    'rcAmount',
    'prAmount',
    'diAmount',
    'transactionCount',
    'poCount',
    'rcCount',
    'prCount',
    'diCount',
    'vendorName',
  ]);

  const documentType = String(rawQuery.documentType || 'ALL').toUpperCase();
  const vendorTypeRaw = String(rawQuery.vendorType || 'all');
  const vendorType = vendorTypeRaw === 'all' ? 'all' : vendorTypeRaw;
  const limitParsed = Number(rawQuery.limit || 10);
  const limit = allowedLimit.has(limitParsed) ? limitParsed : 10;
  const sortByRaw = String(rawQuery.sortBy || '').trim();
  const sortByDefault = documentType === 'PO'
    ? 'poAmount'
    : documentType === 'RC'
      ? 'rcAmount'
      : documentType === 'PR'
        ? 'prAmount'
        : documentType === 'DI'
          ? 'diAmount'
          : 'totalAmount';
  const sortBy = allowedSort.has(sortByRaw) ? sortByRaw : sortByDefault;
  const sortOrder = String(rawQuery.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

  return {
    documentType: allowedDoc.has(documentType) ? documentType : 'ALL',
    vendorType: allowedVendorType.has(vendorType) ? vendorType : 'all',
    limit,
    sortBy,
    sortOrder,
  };
}

async function fetchTopVendorsData(params) {
  const {
    documentType = 'ALL',
    vendorType = 'all',
    limit = 10,
    sortBy = 'totalAmount',
    sortOrder = 'desc',
  } = params || {};

  const approved = 'Approved';
  const [
    vendorsRes,
    poRes,
    rcRes,
    prRes,
    diRes,
  ] = await Promise.all([
    query(`
      SELECT
        id,
        name,
        COALESCE(data->>'vendorType', '') AS vendor_type
      FROM masters
      WHERE master_type = 'Vendor'
    `),
    query(`
      SELECT
        vendor_id,
        SUM(COALESCE(amount, 0))::numeric AS amount,
        COUNT(*)::int AS count
      FROM purchase_orders
      WHERE status = $1
      GROUP BY vendor_id
    `, [approved]),
    query(`
      SELECT
        vendor_id,
        SUM(COALESCE(amount, 0))::numeric AS amount,
        COUNT(*)::int AS count
      FROM rate_contracts
      WHERE status = $1
      GROUP BY vendor_id
    `, [approved]),
    query(`
      SELECT
        vendor_id,
        SUM(COALESCE(amount, 0))::numeric AS amount,
        COUNT(*)::int AS count
      FROM purchase_requests
      WHERE status = $1
      GROUP BY vendor_id
    `, [approved]),
    query(`
      SELECT
        COALESCE(vs.data->>'vendorId', '') AS vendor_id,
        SUM(COALESCE(di.amount, 0))::numeric AS amount,
        COUNT(*)::int AS count
      FROM direct_invoices di
      LEFT JOIN masters vs
        ON vs.master_type = 'Vendor Site'
       AND vs.id = di.vendor_site_id
      WHERE di.status = $1
      GROUP BY COALESCE(vs.data->>'vendorId', '')
    `, [approved]),
  ]);

  const toNum = (v) => Number(v || 0);
  const poMap = new Map(poRes.rows.map((r) => [String(r.vendor_id || ''), { amount: toNum(r.amount), count: toNum(r.count) }]));
  const rcMap = new Map(rcRes.rows.map((r) => [String(r.vendor_id || ''), { amount: toNum(r.amount), count: toNum(r.count) }]));
  const prMap = new Map(prRes.rows.map((r) => [String(r.vendor_id || ''), { amount: toNum(r.amount), count: toNum(r.count) }]));
  const diMap = new Map(diRes.rows.map((r) => [String(r.vendor_id || ''), { amount: toNum(r.amount), count: toNum(r.count) }]));

  let vendors = vendorsRes.rows.map((v) => {
    const vendorId = String(v.id || '');
    const po = poMap.get(vendorId) || { amount: 0, count: 0 };
    const rc = rcMap.get(vendorId) || { amount: 0, count: 0 };
    const pr = prMap.get(vendorId) || { amount: 0, count: 0 };
    const di = diMap.get(vendorId) || { amount: 0, count: 0 };
    const totalAmount = po.amount + rc.amount + pr.amount + di.amount;
    const transactionCount = po.count + rc.count + pr.count + di.count;
    return {
      vendorId,
      vendorName: String(v.name || 'Unknown Vendor'),
      vendorType: String(v.vendor_type || ''),
      totalAmount,
      poAmount: po.amount,
      rcAmount: rc.amount,
      prAmount: pr.amount,
      diAmount: di.amount,
      transactionCount,
      poCount: po.count,
      rcCount: rc.count,
      prCount: pr.count,
      diCount: di.count,
    };
  });

  if (vendorType !== 'all') {
    vendors = vendors.filter((v) => v.vendorType === vendorType);
  }

  const metricByDoc = {
    ALL: 'totalAmount',
    PO: 'poAmount',
    RC: 'rcAmount',
    PR: 'prAmount',
    DI: 'diAmount',
  };
  const metricField = metricByDoc[documentType] || 'totalAmount';
  vendors = vendors.filter((v) => Number(v[metricField] || 0) > 0);

  const direction = sortOrder === 'asc' ? 1 : -1;
  const numericFields = new Set([
    'totalAmount', 'poAmount', 'rcAmount', 'prAmount', 'diAmount',
    'transactionCount', 'poCount', 'rcCount', 'prCount', 'diCount',
  ]);
  vendors.sort((a, b) => {
    if (!numericFields.has(sortBy)) {
      return direction * String(a.vendorName || '').localeCompare(String(b.vendorName || ''));
    }
    const av = Number(a[sortBy] || 0);
    const bv = Number(b[sortBy] || 0);
    if (av === bv) return String(a.vendorName || '').localeCompare(String(b.vendorName || ''));
    return direction * (av - bv);
  });

  const overallFilteredSpend = vendors.reduce((sum, v) => sum + Number(v.totalAmount || 0), 0);
  const sliced = vendors.slice(0, limit);
  const totalSpend = sliced.reduce((sum, v) => sum + Number(v.totalAmount || 0), 0);
  const avgSpendPerVendor = sliced.length > 0 ? totalSpend / sliced.length : 0;

  return {
    vendors: sliced,
    overallFilteredSpend,
    summary: {
      totalVendors: sliced.length,
      totalSpend,
      avgSpendPerVendor,
    },
  };
}

// --- DASHBOARD AGGREGATES (read-only counts; uses rate_contract_id / purchase_order_id / grn_id) ---
router.get('/dashboard/stats', async (req, res) => {
  try {
    const count = (r) => Number(r.rows[0]?.c ?? 0);
    const [
      prPending,
      rcPending,
      poPending,
      diPending,
      grnPendingFromRC,
      grnPendingFromPO,
      invoicePendingFromRC,
      invoicePendingFromPO,
      totalRC,
      totalGRNFromRC,
      totalInvoiceFromRCGRN,
      totalPO,
      totalGRNFromPO,
      totalInvoiceFromPOGRN,
    ] = await Promise.all([
      query(`SELECT COUNT(*)::int AS c FROM purchase_requests WHERE status = 'Pending'`),
      query(`SELECT COUNT(*)::int AS c FROM rate_contracts WHERE status = 'Pending'`),
      query(`SELECT COUNT(*)::int AS c FROM purchase_orders WHERE status = 'Pending'`),
      query(`SELECT COUNT(*)::int AS c FROM direct_invoices WHERE status = 'Pending'`),
      query(
        `SELECT COUNT(*)::int AS c FROM grns WHERE status = 'Pending' AND rate_contract_id IS NOT NULL`
      ),
      query(
        `SELECT COUNT(*)::int AS c FROM grns WHERE status = 'Pending' AND purchase_order_id IS NOT NULL`
      ),
      query(`
        SELECT COUNT(*)::int AS c FROM invoices i
        INNER JOIN grns g ON i.grn_id = g.id
        WHERE i.status = 'Pending' AND g.rate_contract_id IS NOT NULL
      `),
      query(`
        SELECT COUNT(*)::int AS c FROM invoices i
        INNER JOIN grns g ON i.grn_id = g.id
        WHERE i.status = 'Pending' AND g.purchase_order_id IS NOT NULL
      `),
      query(`SELECT COUNT(*)::int AS c FROM rate_contracts WHERE status = 'Approved'`),
      query(`SELECT COUNT(*)::int AS c FROM grns WHERE rate_contract_id IS NOT NULL`),
      query(`
        SELECT COUNT(*)::int AS c FROM invoices i
        INNER JOIN grns g ON i.grn_id = g.id
        WHERE g.rate_contract_id IS NOT NULL
      `),
      query(`SELECT COUNT(*)::int AS c FROM purchase_orders WHERE status = 'Approved'`),
      query(`SELECT COUNT(*)::int AS c FROM grns WHERE purchase_order_id IS NOT NULL`),
      query(`
        SELECT COUNT(*)::int AS c FROM invoices i
        INNER JOIN grns g ON i.grn_id = g.id
        WHERE g.purchase_order_id IS NOT NULL
      `),
    ]);
    res.json({
      pendingCounts: {
        pr: count(prPending),
        rc: count(rcPending),
        po: count(poPending),
        di: count(diPending),
        grnFromRC: count(grnPendingFromRC),
        grnFromPO: count(grnPendingFromPO),
        invoiceFromRC: count(invoicePendingFromRC),
        invoiceFromPO: count(invoicePendingFromPO),
      },
      rcComparison: {
        totalRC: count(totalRC),
        totalGRNFromRC: count(totalGRNFromRC),
        totalInvoiceFromRCGRN: count(totalInvoiceFromRCGRN),
      },
      poComparison: {
        totalPO: count(totalPO),
        totalGRNFromPO: count(totalGRNFromPO),
        totalInvoiceFromPOGRN: count(totalInvoiceFromPOGRN),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Approved documents idle awaiting the next step (no downstream doc yet). */
router.get('/dashboard/aging', async (req, res) => {
  const approvedExpr = (alias) => `
    COALESCE(
      (
        SELECT MAX((elem->>'at')::timestamptz)
        FROM jsonb_array_elements(COALESCE(${alias}.workflow_step_history, '[]'::jsonb)) AS elem
        WHERE elem->>'action' = 'approve'
      ),
      ${alias}.created_at
    )
  `;

  const mapAgingRows = (rows) =>
    rows.map((row) => {
      const approvedAt = row.approved_at;
      let d = approvedAt;
      if (d instanceof Date) {
        d = d.toISOString().slice(0, 10);
      } else if (typeof d === 'string') {
        d = d.slice(0, 10);
      } else {
        d = new Date().toISOString().slice(0, 10);
      }
      const agingDays = Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(`${d}T12:00:00Z`).getTime()) / (24 * 60 * 60 * 1000)
        )
      );
      return {
        docNo: row.id,
        approvedDate: d,
        vendorName: row.vendor_name || '—',
        amount: Number(row.amount) || 0,
        agingDays,
      };
    });

  try {
    const [prRes, rcRes, poRes, diRes] = await Promise.all([
      query(`
        SELECT
          pr.id,
          pr.amount,
          v.name AS vendor_name,
          ${approvedExpr('pr')} AS approved_at
        FROM purchase_requests pr
        LEFT JOIN masters v ON v.master_type = 'Vendor' AND v.id = pr.vendor_id
        WHERE pr.status = 'Approved'
        ORDER BY ${approvedExpr('pr')} ASC NULLS LAST
      `),
      query(`
        SELECT
          rc.id,
          rc.amount,
          v.name AS vendor_name,
          ${approvedExpr('rc')} AS approved_at
        FROM rate_contracts rc
        LEFT JOIN masters v ON v.master_type = 'Vendor' AND v.id = rc.vendor_id
        WHERE rc.status = 'Approved'
          AND NOT EXISTS (SELECT 1 FROM grns g WHERE g.rate_contract_id = rc.id)
        ORDER BY ${approvedExpr('rc')} ASC NULLS LAST
      `),
      query(`
        SELECT
          po.id,
          po.amount,
          v.name AS vendor_name,
          ${approvedExpr('po')} AS approved_at
        FROM purchase_orders po
        LEFT JOIN masters v ON v.master_type = 'Vendor' AND v.id = po.vendor_id
        WHERE po.status = 'Approved'
          AND NOT EXISTS (SELECT 1 FROM grns g WHERE g.purchase_order_id = po.id)
        ORDER BY ${approvedExpr('po')} ASC NULLS LAST
      `),
      query(`
        SELECT
          di.id,
          di.amount,
          COALESCE(v.name, '—') AS vendor_name,
          ${approvedExpr('di')} AS approved_at
        FROM direct_invoices di
        LEFT JOIN masters mvs ON mvs.master_type = 'Vendor Site' AND mvs.id = di.vendor_site_id
        LEFT JOIN masters v ON v.master_type = 'Vendor' AND v.id = NULLIF(TRIM(mvs.data->>'vendorId'), '')
        WHERE di.status = 'Approved'
        ORDER BY ${approvedExpr('di')} ASC NULLS LAST
      `),
    ]);

    res.json({
      pr: {
        label: 'Awaiting PO/RC Creation',
        documents: mapAgingRows(prRes.rows),
      },
      rc: {
        label: 'Awaiting GRN Creation',
        documents: mapAgingRows(rcRes.rows),
      },
      po: {
        label: 'Awaiting GRN Creation',
        documents: mapAgingRows(poRes.rows),
      },
      di: {
        label: 'Awaiting Processing',
        documents: mapAgingRows(diRes.rows),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/dashboard/top-vendors', async (req, res) => {
  try {
    const params = normalizeTopVendorParams(req.query || {});
    const result = await fetchTopVendorsData(params);
    res.json({
      vendors: result.vendors,
      filters: {
        documentType: params.documentType,
        vendorType: params.vendorType,
        limit: params.limit,
        sortBy: params.sortBy,
        sortOrder: params.sortOrder,
      },
      summary: result.summary,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/dashboard/top-vendors-summary', async (req, res) => {
  try {
    const result = await fetchTopVendorsData({
      documentType: 'ALL',
      vendorType: 'all',
      limit: 3,
      sortBy: 'totalAmount',
      sortOrder: 'desc',
    });
    const topVendors = result.vendors.map((v) => ({
      name: v.vendorName,
      totalAmount: v.totalAmount,
    }));
    res.json({
      topVendors,
      totalVendorSpend: result.overallFilteredSpend,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- PURCHASE REQUESTS ---
const PR_COLS = ['id', 'entity_name', 'vendor_id', 'vendor_site_id', 'transaction_type', 'valid_from', 'valid_to', 'frequency', 'department', 'sub_department', 'payment_terms', 'terms_and_conditions_id', 'center_names', 'items', 'amount', 'remarks', 'overall_summary', 'attachments', 'workflow_step_history', 'status', 'current_step_index', 'is_unbudgeted', 'unbudgeted_justification', 'unbudgeted_attachment_url', 'rejection_remarks', 'created_by', 'created_at', 'required_date', 'shipping_address_id', 'billing_address_id'];
router.get('/purchase-requests', async (req, res) => {
  try {
    const rows = await getAll('purchase_requests');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.post('/purchase-requests', async (req, res) => {
  try {
    await buildUpsert('purchase_requests', 'id', PR_COLS, req.body);
    const rows = await getAll('purchase_requests');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- RATE CONTRACTS ---
const RC_COLS = ['id', 'entity_name', 'vendor_id', 'vendor_site_id', 'transaction_type', 'valid_from', 'valid_to', 'frequency', 'department', 'sub_department', 'payment_terms', 'terms_and_conditions_id', 'items', 'amount', 'remarks', 'overall_summary', 'attachments', 'workflow_step_history', 'status', 'current_step_index', 'rejection_remarks', 'created_by', 'created_at', 'required_date', 'shipping_address_id', 'billing_address_id'];
router.get('/rate-contracts', async (req, res) => {
  try {
    const rows = await getAll('rate_contracts');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.post('/rate-contracts', async (req, res) => {
  try {
    await buildUpsert('rate_contracts', 'id', RC_COLS, req.body);
    const rows = await getAll('rate_contracts');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- PURCHASE ORDERS ---
const PO_COLS = ['id', 'entity_name', 'vendor_id', 'vendor_site_id', 'transaction_type', 'valid_from', 'valid_to', 'frequency', 'department', 'sub_department', 'payment_terms', 'terms_and_conditions_id', 'center_names', 'items', 'tds', 'gst', 'amount', 'remarks', 'overall_summary', 'attachments', 'workflow_step_history', 'status', 'current_step_index', 'is_unbudgeted', 'unbudgeted_justification', 'unbudgeted_attachment_url', 'rejection_remarks', 'created_by', 'created_at', 'required_date', 'shipping_address_id', 'billing_address_id', 'is_advance_po', 'advance_percentage', 'advance_amount', 'expected_invoice_type', 'currency_code'];
router.get('/purchase-orders', async (req, res) => {
  try {
    const rows = await getAll('purchase_orders');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.post('/purchase-orders', async (req, res) => {
  try {
    await buildUpsert('purchase_orders', 'id', PO_COLS, req.body);
    const rows = await getAll('purchase_orders');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/purchase-orders/:id/remaining-quantities', async (req, res) => {
  try {
    const poId = req.params.id;
    const result = await getPoRemainingQuantities(poId);
    if (!result) return res.status(404).json({ error: 'Purchase order not found' });
    res.json({ items: result.items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- GRNs ---
const GRN_COLS = ['id', 'entity_name', 'rate_contract_id', 'purchase_order_id', 'vendor_site_id', 'location', 'department', 'sub_department', 'invoice_number', 'invoice_date', 'items', 'amount', 'remarks', 'overall_summary', 'attachments', 'workflow_step_history', 'status', 'current_step_index', 'rejection_remarks', 'created_by', 'created_at', 'shipping_address_id', 'billing_address_id', 'tds', 'gst'];
router.get('/grns', async (req, res) => {
  try {
    const rows = await getAll('grns');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.post('/grns', async (req, res) => {
  try {
    const body = Array.isArray(req.body)
      ? req.body.map((row) => {
          const r = { ...row };
          if (r.invoiceDate === '') r.invoiceDate = null;
          if (r.createdAt === '') r.createdAt = null;
          return r;
        })
      : (() => {
          const r = { ...req.body };
          if (r.invoiceDate === '') r.invoiceDate = null;
          if (r.createdAt === '') r.createdAt = null;
          return r;
        })();

    const rowsToValidate = Array.isArray(body) ? body : [body];
    const ids = rowsToValidate.map((r) => String(r.id || '')).filter(Boolean);
    let existingIds = new Set();
    if (ids.length > 0) {
      const existingRes = await query('SELECT id FROM grns WHERE id = ANY($1)', [ids]);
      existingIds = new Set(existingRes.rows.map((r) => String(r.id)));
    }
    const newRows = rowsToValidate.filter((r) => !existingIds.has(String(r.id || '')));

    for (const grnRow of newRows) {
      // PO-only validations. Rate Contract GRN flow remains unchanged.
      if (!grnRow.purchaseOrderId) continue;

      const result = await getPoRemainingQuantities(grnRow.purchaseOrderId);
      if (!result) return res.status(400).json({ error: `Purchase order not found for ${grnRow.purchaseOrderId}` });
      const { po, items } = result;

      if (items.every((it) => normalizeNumber(it.leftQty) <= 0)) {
        return res.status(400).json({ error: 'All items have been fully received. No more GRNs can be created.' });
      }

      const basisDate = parseDateOnly(grnRow.invoiceDate) || parseDateOnly(new Date().toISOString());
      const validityFrom = parseDateOnly(po.validFrom);
      const validityTo = parseDateOnly(po.validTo);
      if (!basisDate || !validityFrom || !validityTo) {
        return res.status(400).json({ error: 'PO validity dates are invalid. Cannot create GRN.' });
      }
      if (basisDate < validityFrom || basisDate > validityTo) {
        return res.status(400).json({
          error: `GRN can only be created between ${formatDateOnly(validityFrom)} and ${formatDateOnly(validityTo)}.`,
        });
      }

      const window = getFrequencyWindow(basisDate, po.validFrom, po.validTo, po.frequency || 'One-Time');
      if (!window.ok && window.reason === 'outside_validity') {
        return res.status(400).json({
          error: `GRN can only be created between ${formatDateOnly(validityFrom)} and ${formatDateOnly(validityTo)}.`,
        });
      }
      if (!window.ok) {
        return res.status(400).json({ error: `GRN cannot be created in the current ${po.frequency || 'One-Time'} period.` });
      }

      const leftById = new Map(items.map((it) => [String(it.itemId || ''), it]));
      const leftByName = new Map(items.map((it) => [String(it.itemName || '').trim().toLowerCase(), it]));
      const grnItems = Array.isArray(grnRow.items) ? grnRow.items : [];
      for (const gi of grnItems) {
        const qty = normalizeNumber(gi.quantity);
        const matched =
          leftById.get(String(gi.sourceItemId || gi.itemId || gi.id || '')) ||
          leftByName.get(String(gi.itemName || '').trim().toLowerCase());
        if (!matched) continue;
        if (qty <= 0) {
          return res.status(400).json({ error: 'Quantity must be greater than 0.' });
        }
        if (qty > normalizeNumber(matched.leftQty)) {
          return res.status(400).json({
            error: `Cannot receive more than remaining quantity. Left qty for ${matched.itemName} is ${matched.leftQty}.`,
          });
        }
      }
    }

    await buildUpsert('grns', 'id', GRN_COLS, body);
    const rows = await getAll('grns');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- INVOICES ---
const INV_COLS = ['id', 'entity_name', 'grn_id', 'vendor_site_id', 'location', 'department', 'sub_department', 'invoice_number', 'invoice_date', 'items', 'amount', 'remarks', 'overall_summary', 'workflow_step_history', 'status', 'current_step_index', 'rejection_remarks', 'created_by', 'created_at', 'attachments', 'shipping_address_id', 'billing_address_id', 'tds', 'gst', 'invoice_currency', 'invoice_group', 'accounting_date', 'invoice_source', 'invoice_type'];
router.get('/invoices', async (req, res) => {
  try {
    const rows = await getAll('invoices');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.post('/invoices', async (req, res) => {
  try {
    const raw = Array.isArray(req.body) ? req.body : [req.body];
    const prevStatus = new Map();
    for (const row of raw) {
      if (row?.id) {
        const prev = await query('SELECT status FROM invoices WHERE id = $1', [row.id]);
        if (prev.rows[0]) prevStatus.set(row.id, prev.rows[0].status);
      }
    }
    const body = Array.isArray(req.body)
      ? req.body.map((row) => {
          const r = { ...row };
          if (r.invoiceDate === '') r.invoiceDate = null;
          if (r.createdAt === '') r.createdAt = null;
          if (r.accountingDate === '') r.accountingDate = null;
          return r;
        })
      : (() => {
          const r = { ...req.body };
          if (r.invoiceDate === '') r.invoiceDate = null;
          if (r.createdAt === '') r.createdAt = null;
          if (r.accountingDate === '') r.accountingDate = null;
          return r;
        })();

    const rowsToNormalize = Array.isArray(body) ? body : [body];
    for (const r of rowsToNormalize) {
      const t = String(r.invoiceType ?? r.invoice_type ?? '').trim();
      if (!t) r.invoiceType = 'Standard';
    }

    await buildUpsert('invoices', 'id', INV_COLS, body);
    const rows = await getAll('invoices');
    for (const row of raw) {
      if (!row?.id) continue;
      const old = prevStatus.get(row.id);
      const newStatus = row.status;
      if (newStatus === 'Approved' && old !== 'Approved') {
        runGrnInvoiceOracleSync(row.id).catch((err) => console.error('[oracle auto sync]', row.id, err.message));
      }
    }
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/invoices/:id/sync-oracle', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await runGrnInvoiceOracleSync(id, { force: true });
    if (result?.skipped) {
      if (result.reason === 'not_found') return res.status(404).json({ error: 'Invoice not found' });
      return res.json({
        ok: true,
        skipped: true,
        reason: result.reason,
        message:
          result.reason === 'already_synced'
            ? 'Already synced.'
            : result.reason === 'not_approved'
              ? 'Invoice must be Approved before Oracle sync.'
              : 'Sync skipped.',
      });
    }
    return res.json({
      ok: true,
      message: 'Invoice synced to Oracle.',
      oracleInvoiceId: result.oracleInvoiceId,
      createResponse: result.createResponse,
      taxResponse: result.taxResponse,
      ...(result.taxWarning ? { taxWarning: result.taxWarning } : {}),
    });
  } catch (e) {
    const status = e.status >= 400 && e.status < 600 ? e.status : 502;
    return res.status(status).json({ error: e.message || 'Oracle sync failed', details: e.data });
  }
});

// --- DIRECT INVOICES (standalone; no GRN link) ---
const DIRECT_INV_COLS = ['id', 'entity_name', 'vendor_site_id', 'location', 'department', 'sub_department', 'invoice_number', 'invoice_date', 'items', 'amount', 'remarks', 'overall_summary', 'workflow_step_history', 'status', 'current_step_index', 'rejection_remarks', 'created_by', 'created_at', 'center_names', 'attachments', 'shipping_address_id', 'billing_address_id', 'tds', 'gst', 'invoice_currency', 'invoice_group', 'accounting_date', 'invoice_source', 'invoice_type'];
router.get('/direct-invoices', async (req, res) => {
  try {
    const rows = await getAll('direct_invoices');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.post('/direct-invoices', async (req, res) => {
  try {
    const raw = Array.isArray(req.body) ? req.body : [req.body];
    const prevStatus = new Map();
    for (const row of raw) {
      if (row?.id) {
        const prev = await query('SELECT status FROM direct_invoices WHERE id = $1', [row.id]);
        if (prev.rows[0]) prevStatus.set(row.id, prev.rows[0].status);
      }
    }
    const body = Array.isArray(req.body)
      ? req.body.map((row) => {
          const r = { ...row };
          if (r.invoiceDate === '') r.invoiceDate = null;
          if (r.createdAt === '') r.createdAt = null;
          if (r.accountingDate === '') r.accountingDate = null;
          return r;
        })
      : (() => {
          const r = { ...req.body };
          if (r.invoiceDate === '') r.invoiceDate = null;
          if (r.createdAt === '') r.createdAt = null;
          if (r.accountingDate === '') r.accountingDate = null;
          return r;
        })();
    await buildUpsert('direct_invoices', 'id', DIRECT_INV_COLS, body);
    const rows = await getAll('direct_invoices');
    for (const row of raw) {
      if (!row?.id) continue;
      const old = prevStatus.get(row.id);
      const newStatus = row.status;
      if (newStatus === 'Approved' && old !== 'Approved') {
        runDirectInvoiceOracleSync(row.id).catch((err) => console.error('[oracle auto sync direct]', row.id, err.message));
      }
    }
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/direct-invoices/:id/sync-oracle', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await runDirectInvoiceOracleSync(id, { force: true });
    if (result?.skipped) {
      if (result.reason === 'not_found') return res.status(404).json({ error: 'Direct invoice not found' });
      return res.json({
        ok: true,
        skipped: true,
        reason: result.reason,
        message:
          result.reason === 'already_synced'
            ? 'Already synced.'
            : result.reason === 'not_approved'
              ? 'Invoice must be Approved before Oracle sync.'
              : 'Sync skipped.',
      });
    }
    return res.json({
      ok: true,
      message: 'Direct invoice synced to Oracle.',
      oracleInvoiceId: result.oracleInvoiceId,
      createResponse: result.createResponse,
      taxResponse: result.taxResponse,
      ...(result.taxWarning ? { taxWarning: result.taxWarning } : {}),
    });
  } catch (e) {
    const status = e.status >= 400 && e.status < 600 ? e.status : 502;
    return res.status(status).json({ error: e.message || 'Oracle sync failed', details: e.data });
  }
});

function sendPdfResponse(res, filename, buffer) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}

async function buildPdfPayload(docType, row, masterMaps) {
  const { vendorById, vendorSiteById } = masterMaps;
  const items = Array.isArray(row.items) ? row.items : [];
  const vendorSite = row.vendorSiteId ? vendorSiteById[row.vendorSiteId] : null;
  const vendorName = row.vendorId ? vendorById[row.vendorId] : (vendorSite?.vendorId ? vendorById[vendorSite.vendorId] : '—');
  const common = {
    company: PDF_COMPANY,
    docNo: row.id,
    status: row.status,
    date: row.createdAt || row.invoiceDate || row.validFrom,
    leftDetails: [
      `Vendor: ${vendorName || '—'}`,
      `Vendor Site: ${vendorSite?.name || '—'}`,
      `Department: ${row.department || '—'}`,
      `Sub-Department: ${row.subDepartment || '—'}`,
    ],
    docDetails: [
      `Entity: ${row.entityName || '—'}`,
      `Remarks: ${row.remarks || '—'}`,
      `Summary: ${row.overallSummary || '—'}`,
    ],
    preparedBy: row.createdBy || 'System',
    approvedBy: 'Workflow',
  };

  if (docType === 'purchase-request') {
    return {
      ...common,
      title: 'Purchase Request',
      rightDetails: [
        `Valid From: ${pdfUtils.formatDate(row.validFrom)}`,
        `Valid To: ${pdfUtils.formatDate(row.validTo)}`,
        `Required Date: ${pdfUtils.formatDate(row.requiredDate)}`,
        `Frequency: ${row.frequency || '—'}`,
      ],
      columns: [
        { key: 'itemName', header: 'Item' },
        { key: 'quantity', header: 'Qty', align: 'right' },
        { key: 'rate', header: 'Rate', align: 'right' },
        { key: 'amount', header: 'Amount', align: 'right' },
      ],
      items: items.map((it) => ({ itemName: it.itemName || '—', quantity: normalizeNumber(it.quantity), rate: normalizeNumber(it.rate), amount: normalizeNumber(it.amount) })),
      summary: commonSummaryFromItems(items, row.amount),
    };
  }

  if (docType === 'rate-contract') {
    return {
      ...common,
      title: 'Rate Contract',
      rightDetails: [
        `Valid From: ${pdfUtils.formatDate(row.validFrom)}`,
        `Valid To: ${pdfUtils.formatDate(row.validTo)}`,
        `Required Date: ${pdfUtils.formatDate(row.requiredDate)}`,
        `Frequency: ${row.frequency || '—'}`,
      ],
      columns: [
        { key: 'itemName', header: 'Item' },
        { key: 'centerName', header: 'Center' },
        { key: 'rate', header: 'Rate', align: 'right' },
        { key: 'amount', header: 'Amount', align: 'right' },
      ],
      items: items.map((it) => ({ itemName: it.itemName || '—', centerName: it.centerName || '—', rate: normalizeNumber(it.rate), amount: normalizeNumber(it.amount) })),
      summary: commonSummaryFromItems(items, row.amount),
    };
  }

  if (docType === 'purchase-order') {
    return {
      ...common,
      title: 'Purchase Order',
      rightDetails: [
        `Valid From: ${pdfUtils.formatDate(row.validFrom)}`,
        `Valid To: ${pdfUtils.formatDate(row.validTo)}`,
        `Required Date: ${pdfUtils.formatDate(row.requiredDate)}`,
        `Frequency: ${row.frequency || '—'}`,
      ],
      columns: [
        { key: 'itemName', header: 'Item' },
        { key: 'quantity', header: 'Qty', align: 'right' },
        { key: 'rate', header: 'Rate', align: 'right' },
        { key: 'amount', header: 'Amount', align: 'right' },
      ],
      items: items.map((it) => ({ itemName: it.itemName || '—', quantity: normalizeNumber(it.quantity), rate: normalizeNumber(it.rate), amount: normalizeNumber(it.amount) })),
      summary: commonSummaryFromItems(items, row.amount),
    };
  }

  if (docType === 'grn') {
    return {
      ...common,
      title: 'Goods Receipt Note',
      rightDetails: [
        `Invoice Number: ${row.invoiceNumber || '—'}`,
        `Invoice Date: ${pdfUtils.formatDate(row.invoiceDate)}`,
        `PO/RC Ref: ${row.purchaseOrderId || row.rateContractId || '—'}`,
        `Location: ${row.location || '—'}`,
      ],
      columns: [
        { key: 'itemName', header: 'Item' },
        { key: 'quantity', header: 'Received Qty', align: 'right' },
        { key: 'rate', header: 'Rate', align: 'right' },
        { key: 'amount', header: 'Amount', align: 'right' },
      ],
      items: items.map((it) => ({ itemName: it.itemName || '—', quantity: normalizeNumber(it.quantity), rate: normalizeNumber(it.rate), amount: normalizeNumber(it.amount) })),
      summary: commonSummaryFromItems(items, row.amount),
    };
  }

  if (docType === 'invoice') {
    return {
      ...common,
      title: 'Invoice',
      rightDetails: [
        `Invoice Number: ${row.invoiceNumber || '—'}`,
        `Invoice Date: ${pdfUtils.formatDate(row.invoiceDate)}`,
        `GRN Ref: ${row.grnId || '—'}`,
        `Location: ${row.location || '—'}`,
      ],
      columns: [
        { key: 'itemName', header: 'Item' },
        { key: 'quantity', header: 'Qty', align: 'right' },
        { key: 'rate', header: 'Rate', align: 'right' },
        { key: 'amount', header: 'Amount', align: 'right' },
      ],
      items: items.map((it) => ({ itemName: it.itemName || '—', quantity: normalizeNumber(it.quantity), rate: normalizeNumber(it.rate), amount: normalizeNumber(it.amount) })),
      summary: commonSummaryFromItems(items, row.amount),
    };
  }

  return {
    ...common,
    title: 'Direct Invoice',
    rightDetails: [
      `Invoice Number: ${row.invoiceNumber || '—'}`,
      `Invoice Date: ${pdfUtils.formatDate(row.invoiceDate)}`,
      `Location: ${row.location || '—'}`,
      `Transaction Type: ${row.transactionType || '—'}`,
    ],
    columns: [
      { key: 'itemName', header: 'Item' },
      { key: 'quantity', header: 'Qty', align: 'right' },
      { key: 'rate', header: 'Rate', align: 'right' },
      { key: 'amount', header: 'Amount', align: 'right' },
    ],
    items: items.map((it) => ({ itemName: it.itemName || '—', quantity: normalizeNumber(it.quantity), rate: normalizeNumber(it.rate), amount: normalizeNumber(it.amount) })),
    summary: commonSummaryFromItems(items, row.amount),
  };
}

async function handleDownload(req, res, table, docType, filenamePrefix) {
  try {
    const row = await getDocByTable(table, req.params.id);
    if (!row) return res.status(404).json({ error: 'Document not found' });
    const maps = await getMasterMaps();
    const payload = await buildPdfPayload(docType, row, maps);
    const buffer = await generateDocumentPdf(payload);
    sendPdfResponse(res, `${filenamePrefix}-${row.id}.pdf`, buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

router.get('/purchase-requests/:id/download', async (req, res) => handleDownload(req, res, 'purchase_requests', 'purchase-request', 'purchase-request'));
router.get('/rate-contracts/:id/download', async (req, res) => handleDownload(req, res, 'rate_contracts', 'rate-contract', 'rate-contract'));
router.get('/purchase-orders/:id/download', async (req, res) => handleDownload(req, res, 'purchase_orders', 'purchase-order', 'purchase-order'));
router.get('/grns/:id/download', async (req, res) => handleDownload(req, res, 'grns', 'grn', 'grn'));
router.get('/invoices/:id/download', async (req, res) => handleDownload(req, res, 'invoices', 'invoice', 'invoice'));
router.get('/direct-invoices/:id/download', async (req, res) => handleDownload(req, res, 'direct_invoices', 'direct-invoice', 'direct-invoice'));

// --- BUDGETS ---
const BUDGET_COLS = ['id', 'financial_year', 'entity_name', 'location_name', 'cost_center_name', 'coa_code', 'department', 'sub_department', 'budget_type', 'amount', 'consumed_amount', 'control_type', 'validity', 'is_active', 'monthly_allocation', 'workflow_status', 'workflow_current_step_index', 'workflow_rule_id', 'workflow_created_by', 'workflow_rejection_remarks'];
router.get('/budgets', async (req, res) => {
  try {
    const rows = await getAll('budgets');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.post('/budgets', async (req, res) => {
  try {
    await buildUpsert('budgets', 'id', BUDGET_COLS, req.body);
    const rows = await getAll('budgets');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.patch('/budgets/:id/workflow', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { action, rejectionRemarks } = req.body || {};
    const budgetRes = await query('SELECT * FROM budgets WHERE id = $1', [id]);
    const budget = budgetRes.rows[0];
    if (!budget) return res.status(404).json({ error: 'Budget not found' });
    let workflowStatus = budget.workflow_status || 'Draft';
    let workflowCurrentStepIndex = typeof budget.workflow_current_step_index === 'number' ? budget.workflow_current_step_index : 0;
    const hist = parseBudgetWorkflowHistory(budget.workflow_step_history);
    const now = new Date().toISOString();
    const ruleRes = await query("SELECT * FROM workflow_v2_rules WHERE scope = 'Budget' AND master_id = $1 AND is_active = true", ['__ALL__']);
    const ruleRow = ruleRes.rows[0];
    const approvalChain = ruleRow
      ? (typeof ruleRow.approval_chain === 'string' ? JSON.parse(ruleRow.approval_chain || '[]') : ruleRow.approval_chain || [])
      : [];
    if (action === 'submit') {
      if (!ruleRow) return res.status(400).json({ error: 'No workflow rule configured for Budget' });
      workflowStatus = 'Pending';
      workflowCurrentStepIndex = 0;
      hist.push({ action: 'submit', userId, at: now });
      await query(
        'UPDATE budgets SET workflow_status = $1, workflow_current_step_index = $2, workflow_rule_id = $3, workflow_created_by = $4, workflow_step_history = $5::jsonb WHERE id = $6',
        [workflowStatus, workflowCurrentStepIndex, ruleRow.id, userId, JSON.stringify(hist), id]
      );
    } else if (action === 'completeReview' || action === 'approve' || action === 'reject') {
      if (workflowStatus !== 'Pending') return res.status(400).json({ error: 'Not pending' });
      const stepIdxAtAction = workflowCurrentStepIndex;
      const step = approvalChain[workflowCurrentStepIndex];
      if (!step) return res.status(400).json({ error: 'Invalid step' });
      const userIds = Array.isArray(step.userIds) ? step.userIds : (Array.isArray(step.user_ids) ? step.user_ids : []);
      if (!userIds.includes(userId)) return res.status(403).json({ error: 'Not in current step' });
      hist.push({ action, stepIndex: stepIdxAtAction, userId, at: now });
      if (action === 'reject') {
        workflowStatus = 'Rejected';
        await query(
          'UPDATE budgets SET workflow_status = $1, workflow_rejection_remarks = $2, workflow_step_history = $3::jsonb WHERE id = $4',
          [workflowStatus, rejectionRemarks != null ? rejectionRemarks : budget.workflow_rejection_remarks, JSON.stringify(hist), id]
        );
      } else if (step.type === 'Approver' || (approvalChain.length <= 1)) {
        workflowStatus = 'Approved';
        await query(
          'UPDATE budgets SET workflow_status = $1, workflow_current_step_index = 0, workflow_step_history = $2::jsonb WHERE id = $3',
          [workflowStatus, JSON.stringify(hist), id]
        );
      } else {
        workflowCurrentStepIndex += 1;
        if (workflowCurrentStepIndex >= approvalChain.length) {
          workflowStatus = 'Approved';
          await query(
            'UPDATE budgets SET workflow_status = $1, workflow_current_step_index = 0, workflow_step_history = $2::jsonb WHERE id = $3',
            [workflowStatus, JSON.stringify(hist), id]
          );
        } else {
          await query(
            'UPDATE budgets SET workflow_current_step_index = $1, workflow_step_history = $2::jsonb WHERE id = $3',
            [workflowCurrentStepIndex, JSON.stringify(hist), id]
          );
        }
      }
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }
    const updated = await query('SELECT * FROM budgets WHERE id = $1', [id]);
    const row = updated.rows[0];
    res.json(rowToCamel(row));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- BUDGET AMENDMENTS ---
const AMEND_COLS = ['id', 'budget_id', 'type', 'amount', 'target_budget_id', 'justification', 'status', 'requested_by', 'approved_by', 'created_at'];
router.get('/budget-amendments', async (req, res) => {
  try {
    const rows = await getAll('budget_amendments');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
router.post('/budget-amendments', async (req, res) => {
  try {
    await buildUpsert('budget_amendments', 'id', AMEND_COLS, req.body);
    const rows = await getAll('budget_amendments');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- MASTERS ---
// GET: return { "Vendor": [...], "Vendor Site": [...], ... } (each row = { id, name, status, ...data })
router.get('/masters', async (req, res) => {
  try {
    const res_ = await query('SELECT * FROM masters ORDER BY master_type, id');
    const byType = {};
    for (const row of res_.rows) {
      const { master_type, id, name, status, data } = row;
      const rec = { id, name, status, ...(data || {}) };
      if (!byType[master_type]) byType[master_type] = [];
      byType[master_type].push(rec);
    }
    res.json(byType);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// POST: body = { "Vendor": [...], "Vendor Site": [...], ... }; replace all masters per type (transactional)
// Skip records with falsy id, deduplicate by id per type, use upsert to avoid duplicate key errors
router.post('/masters', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const payload = req.body;
    if (payload && typeof payload === 'object') {
      for (const [masterType, records] of Object.entries(payload)) {
        if (!Array.isArray(records)) continue;
        // Skip records without a valid id; deduplicate by id (keep last)
        const seen = new Map();
        for (const rec of records) {
          const id = rec.id != null && String(rec.id).trim() !== '' ? String(rec.id).trim() : null;
          if (!id) continue;
          seen.set(id, rec);
        }
        const deduped = Array.from(seen.values());
        await client.query('DELETE FROM masters WHERE master_type = $1', [masterType]);
        for (const rec of deduped) {
          const { id, name, status, ...rest } = rec;
          const data = { ...rest };
          await client.query(
            `INSERT INTO masters (master_type, id, name, status, data) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (master_type, id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, data = EXCLUDED.data`,
            [masterType, id, name, status || 'Active', JSON.stringify(data)]
          );
        }
      }
    }
    await client.query('COMMIT');
    const res_ = await query('SELECT * FROM masters ORDER BY master_type, id');
    const byType = {};
    for (const row of res_.rows) {
      const { master_type, id, name, status, data } = row;
      const rec = { id, name, status, ...(data || {}) };
      if (!byType[master_type]) byType[master_type] = [];
      byType[master_type].push(rec);
    }
    res.json(byType);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

export default router;
