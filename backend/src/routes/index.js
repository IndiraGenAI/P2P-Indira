import { Router } from 'express';
import jwt from 'jsonwebtoken';
import pool, { query, rowsToCamel, rowToCamel, objToSnake } from '../db.js';
import * as sessionTracker from '../sessionTracker.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'p2p-indira-jwt-secret-change-in-production';

// JSON columns that may be stored as TEXT/JSON (not JSONB) and need parsing after retrieval
const JSON_COLUMNS = {
  workflows: ['approvalChain'],
  workflow_v2_rules: ['approvalChain'],
  roles: ['permissions', 'allowedMasterTypes', 'mastersPermissions'],
  users: ['centerNames', 'departments', 'subDepartments', 'entityNames', 'roleIds'],
  purchase_requests: ['centerNames', 'items', 'attachments'],
  rate_contracts: ['items', 'attachments'],
  purchase_orders: ['centerNames', 'items', 'attachments'],
  grns: ['items', 'attachments'],
  invoices: ['items', 'attachments'],
  direct_invoices: ['items', 'attachments'],
};

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
      workflowStatus = 'Pending';
      workflowCurrentStepIndex = 0;
      data.workflowStatus = workflowStatus;
      data.workflowCurrentStepIndex = workflowCurrentStepIndex;
      data.workflowRuleId = ruleRow.id;
      data.workflowCreatedBy = userId;
    } else if (action === 'completeReview' || action === 'approve' || action === 'reject') {
      if (workflowStatus !== 'Pending') return res.status(400).json({ error: 'Not pending' });
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
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }
    await query('UPDATE masters SET data = $1 WHERE master_type = $2 AND id = $3', [JSON.stringify(data), masterType, id]);
    const updated = await query('SELECT * FROM masters WHERE master_type = $1 AND id = $2', [masterType, id]);
    const row = updated.rows[0];
    const rec = { id: row.id, name: row.name, status: row.status, ...(row.data || {}) };
    res.json(rec);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- PURCHASE REQUESTS ---
const PR_COLS = ['id', 'entity_name', 'vendor_id', 'vendor_site_id', 'transaction_type', 'valid_from', 'valid_to', 'frequency', 'department', 'sub_department', 'payment_terms', 'terms_and_conditions_id', 'center_names', 'items', 'amount', 'remarks', 'attachments', 'status', 'current_step_index', 'is_unbudgeted', 'unbudgeted_justification', 'unbudgeted_attachment_url', 'rejection_remarks', 'created_by', 'created_at', 'required_date', 'shipping_address_id', 'billing_address_id'];
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
const RC_COLS = ['id', 'entity_name', 'vendor_id', 'vendor_site_id', 'transaction_type', 'valid_from', 'valid_to', 'frequency', 'department', 'sub_department', 'payment_terms', 'terms_and_conditions_id', 'items', 'amount', 'remarks', 'attachments', 'status', 'current_step_index', 'rejection_remarks', 'created_by', 'created_at', 'required_date', 'shipping_address_id', 'billing_address_id'];
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
const PO_COLS = ['id', 'entity_name', 'vendor_id', 'vendor_site_id', 'transaction_type', 'valid_from', 'valid_to', 'frequency', 'department', 'sub_department', 'payment_terms', 'terms_and_conditions_id', 'center_names', 'items', 'tds', 'gst', 'amount', 'remarks', 'attachments', 'status', 'current_step_index', 'is_unbudgeted', 'unbudgeted_justification', 'unbudgeted_attachment_url', 'rejection_remarks', 'created_by', 'created_at', 'required_date', 'shipping_address_id', 'billing_address_id', 'is_advance_po', 'advance_percentage'];
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

// --- GRNs ---
const GRN_COLS = ['id', 'entity_name', 'rate_contract_id', 'purchase_order_id', 'vendor_site_id', 'location', 'department', 'sub_department', 'invoice_number', 'invoice_date', 'items', 'amount', 'remarks', 'attachments', 'status', 'current_step_index', 'rejection_remarks', 'created_by', 'created_at', 'shipping_address_id', 'billing_address_id', 'tds', 'gst'];
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
    await buildUpsert('grns', 'id', GRN_COLS, body);
    const rows = await getAll('grns');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- INVOICES ---
const INV_COLS = ['id', 'entity_name', 'grn_id', 'vendor_site_id', 'location', 'department', 'sub_department', 'invoice_number', 'invoice_date', 'items', 'amount', 'status', 'current_step_index', 'rejection_remarks', 'created_by', 'created_at', 'attachments', 'shipping_address_id', 'billing_address_id', 'tds', 'gst'];
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
    await buildUpsert('invoices', 'id', INV_COLS, body);
    const rows = await getAll('invoices');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- DIRECT INVOICES (standalone; no GRN link) ---
const DIRECT_INV_COLS = ['id', 'entity_name', 'vendor_site_id', 'location', 'department', 'sub_department', 'invoice_number', 'invoice_date', 'items', 'amount', 'status', 'current_step_index', 'rejection_remarks', 'created_by', 'created_at', 'center_names', 'attachments', 'shipping_address_id', 'billing_address_id', 'tds', 'gst'];
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
    await buildUpsert('direct_invoices', 'id', DIRECT_INV_COLS, body);
    const rows = await getAll('direct_invoices');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- BUDGETS ---
const BUDGET_COLS = ['id', 'financial_year', 'entity_name', 'location_name', 'cost_center_name', 'coa_code', 'department', 'sub_department', 'budget_type', 'amount', 'consumed_amount', 'control_type', 'validity', 'is_active', 'workflow_status', 'workflow_current_step_index', 'workflow_rule_id', 'workflow_created_by', 'workflow_rejection_remarks'];
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
    const ruleRes = await query("SELECT * FROM workflow_v2_rules WHERE scope = 'Budget' AND master_id = $1 AND is_active = true", ['__ALL__']);
    const ruleRow = ruleRes.rows[0];
    const approvalChain = ruleRow
      ? (typeof ruleRow.approval_chain === 'string' ? JSON.parse(ruleRow.approval_chain || '[]') : ruleRow.approval_chain || [])
      : [];
    if (action === 'submit') {
      if (!ruleRow) return res.status(400).json({ error: 'No workflow rule configured for Budget' });
      workflowStatus = 'Pending';
      workflowCurrentStepIndex = 0;
      await query(
        'UPDATE budgets SET workflow_status = $1, workflow_current_step_index = $2, workflow_rule_id = $3, workflow_created_by = $4 WHERE id = $5',
        [workflowStatus, workflowCurrentStepIndex, ruleRow.id, userId, id]
      );
    } else if (action === 'completeReview' || action === 'approve' || action === 'reject') {
      if (workflowStatus !== 'Pending') return res.status(400).json({ error: 'Not pending' });
      const step = approvalChain[workflowCurrentStepIndex];
      if (!step) return res.status(400).json({ error: 'Invalid step' });
      const userIds = Array.isArray(step.userIds) ? step.userIds : (Array.isArray(step.user_ids) ? step.user_ids : []);
      if (!userIds.includes(userId)) return res.status(403).json({ error: 'Not in current step' });
      if (action === 'reject') {
        workflowStatus = 'Rejected';
        await query(
          'UPDATE budgets SET workflow_status = $1, workflow_rejection_remarks = $2 WHERE id = $3',
          [workflowStatus, rejectionRemarks != null ? rejectionRemarks : budget.workflow_rejection_remarks, id]
        );
      } else if (step.type === 'Approver' || (approvalChain.length <= 1)) {
        workflowStatus = 'Approved';
        await query(
          'UPDATE budgets SET workflow_status = $1, workflow_current_step_index = 0 WHERE id = $2',
          [workflowStatus, id]
        );
      } else {
        workflowCurrentStepIndex += 1;
        if (workflowCurrentStepIndex >= approvalChain.length) {
          workflowStatus = 'Approved';
          await query(
            'UPDATE budgets SET workflow_status = $1, workflow_current_step_index = 0 WHERE id = $2',
            [workflowStatus, id]
          );
        } else {
          await query(
            'UPDATE budgets SET workflow_current_step_index = $1 WHERE id = $2',
            [workflowCurrentStepIndex, id]
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
