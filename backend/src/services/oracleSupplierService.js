/**
 * Oracle Fusion Supplier Onboarding — 7-step orchestration service.
 *
 * Flow: Create Supplier → Address → Contact → Site → Site Assignment → Bank Account → SOAP BI (EXT_PAYEE_ID)
 *
 * Reads vendor master + related masters from DB, resolves IDs to Fusion-compatible strings,
 * calls Fusion REST APIs in sequence, persists response IDs back to vendor master data.
 */
import axios from 'axios';
import oracleConfig from '../config/oracleConfig.js';
import { extractExtPayeeId } from '../utils/soapHelper.js';
import { query } from '../db.js';

function fusionHttp() {
  return axios.create({
    baseURL: oracleConfig.baseUrl,
    timeout: oracleConfig.timeoutMs,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'REST-Framework-Version': oracleConfig.restFrameworkVersion,
    },
    auth: { username: oracleConfig.username, password: oracleConfig.password },
    validateStatus: () => true,
  });
}

function mockHttp() {
  const port = process.env.PORT || 4050;
  return axios.create({
    baseURL: `http://127.0.0.1:${port}/mock-oracle`,
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
    validateStatus: () => true,
  });
}

function http() {
  return oracleConfig.mode === 'live' ? fusionHttp() : mockHttp();
}

function assertOk(res, label) {
  if (res.status >= 200 && res.status < 300) return res.data;
  const body = res.data;
  const msg =
    body?.message ||
    body?.title ||
    body?.detail ||
    (typeof body === 'string' ? body.substring(0, 300) : '') ||
    `${label} failed (${res.status})`;
  const err = new Error(`[Oracle Supplier] ${label}: ${msg}`);
  err.status = res.status;
  err.data = body;
  throw err;
}

async function withRetry(fn, label) {
  const retries = oracleConfig.retryCount;
  const baseDelay = oracleConfig.retryDelayMs;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = e?.status || e?.response?.status;
      const retryable = status == null || status === 429 || (status >= 500 && status <= 599);
      if (!retryable || attempt === retries) throw e;
      const delay = baseDelay * Math.pow(2, attempt);
      console.log(`[Oracle Supplier] ${label} attempt ${attempt + 1} failed, retry in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function parseMasterData(row) {
  if (!row) return {};
  const d = row.data;
  if (d == null) return {};
  if (typeof d === 'string') {
    try { return JSON.parse(d || '{}'); } catch { return {}; }
  }
  return typeof d === 'object' ? d : {};
}

async function loadVendorAndMasters(vendorMasterId) {
  const vendorRes = await query(
    `SELECT id, name, data FROM masters WHERE master_type = 'Vendor' AND id = $1`,
    [vendorMasterId]
  );
  const vendorRow = vendorRes.rows?.[0];
  if (!vendorRow) throw new Error(`Vendor master '${vendorMasterId}' not found.`);

  const relatedRes = await query(
    `SELECT master_type, id, name, data FROM masters
     WHERE master_type IN ('Vendor Site','Entity','City','State','Country','Currency','Payment Terms')`
  );

  const maps = { entities: [], cities: {}, states: {}, countries: {}, currencies: {}, paymentTerms: {}, vendorSites: [] };
  for (const r of relatedRes.rows || []) {
    const rd = parseMasterData(r);
    switch (r.master_type) {
      case 'Entity':
        maps.entities.push({ id: r.id, name: r.name, ...rd });
        break;
      case 'City':
        maps.cities[r.id] = r.name;
        break;
      case 'State':
        maps.states[r.id] = r.name;
        break;
      case 'Country':
        maps.countries[r.id] = { code: rd.countryCode || rd.code || '', name: r.name };
        break;
      case 'Currency':
        maps.currencies[r.id] = rd.code || r.name;
        break;
      case 'Payment Terms':
        maps.paymentTerms[r.id] = { name: r.name, oraclePaymentTerms: rd.oraclePaymentTerms || r.name };
        break;
      case 'Vendor Site':
        maps.vendorSites.push({ id: r.id, name: r.name, ...rd });
        break;
    }
  }

  return { vendorRow, vendorData: parseMasterData(vendorRow), maps };
}

function resolveBusinessUnit(vendorData, entities) {
  const entityIds = Array.isArray(vendorData.entityIds) ? vendorData.entityIds : [];
  for (const sel of entityIds) {
    const raw = String(sel ?? '').trim();
    if (!raw) continue;
    const lower = raw.toLowerCase();
    const ent =
      entities.find((e) => e.id === raw) ||
      entities.find((e) => e.name && e.name.toLowerCase() === lower);
    if (ent?.oracleBusinessUnit) return ent.oracleBusinessUnit;
  }
  return null;
}

function resolveEntityOracleConfig(vendorData, entities) {
  const entityIds = Array.isArray(vendorData.entityIds) ? vendorData.entityIds : [];
  for (const sel of entityIds) {
    const raw = String(sel ?? '').trim();
    if (!raw) continue;
    const lower = raw.toLowerCase();
    const ent =
      entities.find((e) => e.id === raw) ||
      entities.find((e) => e.name && e.name.toLowerCase() === lower);
    if (ent?.oracleBusinessUnit) {
      return {
        bu: ent.oracleBusinessUnit,
        liabilityDistribution: ent.oracleLiabilityDistribution || '',
        prepaymentDistribution: ent.oraclePrepaymentDistribution || '',
      };
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Individual API step functions
// ═══════════════════════════════════════════════════════════════

async function createSupplier(vendorData, vendorName) {
  const ver = encodeURIComponent(oracleConfig.apiVersion);
  const path = oracleConfig.mode === 'live'
    ? `/fscmRestApi/resources/${ver}/suppliers`
    : '/suppliers';

  const payload = {
    Supplier: vendorData.oracleSupplierName || vendorName,
    TaxOrganizationType: vendorData.fusionTaxOrganizationType || 'Corporation',
    SupplierType: vendorData.fusionSupplierType || 'Services',
    BusinessRelationship: vendorData.fusionBusinessRelationship || 'Spend Authorized',
    TaxpayerId: vendorData.pan || '',
    ...(vendorData.pan ? { TaxpayerCountryCode: vendorData.taxpayerCountryCode || '' } : {}),
  };

  console.log('[Oracle Supplier] Step 1: Creating Supplier... Payload:', JSON.stringify(payload));
  const res = await withRetry(() => http().post(path, payload), 'Create Supplier');
  const data = assertOk(res, 'Create Supplier');

  const supplierId = data.SupplierId ?? data.supplierId ?? data.id;
  const supplierPartyId = data.SupplierPartyId ?? data.supplierPartyId ?? data.partyId;
  console.log(`[Oracle Supplier] Supplier created: SupplierId=${supplierId}, SupplierPartyId=${supplierPartyId}`);

  return { supplierId: String(supplierId), supplierPartyId: String(supplierPartyId), raw: data };
}

async function createAddress(supplierId, vendorData, maps) {
  const ver = encodeURIComponent(oracleConfig.apiVersion);
  const sid = encodeURIComponent(supplierId);
  const path = oracleConfig.mode === 'live'
    ? `/fscmRestApi/resources/${ver}/suppliers/${sid}/child/addresses`
    : `/suppliers/${sid}/child/addresses`;

  const cityName = vendorData.city || (vendorData.cityId ? (maps.cities[vendorData.cityId] || '') : '');
  const stateName = vendorData.state || (vendorData.stateId ? (maps.states[vendorData.stateId] || '') : '');

  let countryFullName = '';
  const vendorCC = vendorData.countryCode || '';
  if (vendorCC) {
    const match = Object.values(maps.countries).find((c) => c.code === vendorCC);
    countryFullName = match ? match.name : vendorCC;
  } else if (vendorData.countryId && maps.countries[vendorData.countryId]) {
    countryFullName = maps.countries[vendorData.countryId].name || '';
  }
  if (!countryFullName) countryFullName = 'India';

  const payload = {
    AddressName: vendorData.fusionAddressName || vendorData.oracleSupplierName || 'Main Address',
    AddressLine1: vendorData.address1 || '',
    ...(cityName ? { City: cityName } : {}),
    ...(stateName ? { State: stateName } : {}),
    ...(vendorData.pincode ? { PostalCode: vendorData.pincode } : {}),
    Country: countryFullName,
    AddressPurposeOrderingFlag: true,
    AddressPurposeRemitToFlag: true,
  };

  console.log('[Oracle Supplier] Step 2: Creating Address... Payload:', JSON.stringify(payload));
  const res = await withRetry(() => http().post(path, payload), 'Create Address');
  const data = assertOk(res, 'Create Address');

  const supplierAddressId = data.SupplierAddressId ?? data.supplierAddressId ?? data.id;
  const addressName = data.AddressName ?? data.addressName ?? payload.AddressName;
  console.log(`[Oracle Supplier] Address created: SupplierAddressId=${supplierAddressId}`);

  return { supplierAddressId: String(supplierAddressId), addressName: String(addressName), raw: data };
}

async function createContact(supplierId, vendorData) {
  const ver = encodeURIComponent(oracleConfig.apiVersion);
  const sid = encodeURIComponent(supplierId);
  const path = oracleConfig.mode === 'live'
    ? `/fscmRestApi/resources/${ver}/suppliers/${sid}/child/contacts`
    : `/suppliers/${sid}/child/contacts`;

  let firstName = vendorData.contactFirstName || '';
  let lastName = vendorData.contactLastName || '';
  if (!firstName && vendorData.name) {
    const parts = String(vendorData.name).trim().split(/\s+/);
    firstName = parts[0] || '';
    lastName = parts.slice(1).join(' ') || '';
  }

  const payload = {
    FirstName: firstName,
    LastName: lastName,
    Email: vendorData.email || '',
    PhoneNumber: vendorData.phone || '',
  };

  console.log('[Oracle Supplier] Step 3: Creating Contact...');
  const res = await withRetry(() => http().post(path, payload), 'Create Contact');
  const data = assertOk(res, 'Create Contact');

  const supplierContactId = data.SupplierContactId ?? data.supplierContactId ?? data.id;
  console.log(`[Oracle Supplier] Contact created: SupplierContactId=${supplierContactId}`);

  return { supplierContactId: String(supplierContactId), raw: data };
}

async function createSite(supplierId, vendorData, addressName, maps) {
  const ver = encodeURIComponent(oracleConfig.apiVersion);
  const sid = encodeURIComponent(supplierId);
  const path = oracleConfig.mode === 'live'
    ? `/fscmRestApi/resources/${ver}/suppliers/${sid}/child/sites`
    : `/suppliers/${sid}/child/sites`;

  const bu = resolveBusinessUnit(vendorData, maps.entities);

  const payload = {
    SupplierSite: vendorData.oracleSupplierSiteName || addressName || 'MAIN_SITE',
    SupplierAddressName: addressName,
    ...(bu ? { ProcurementBU: bu } : {}),
    SitePurposePurchasingFlag: true,
    SitePurposePayFlag: true,
    CommunicationMethodCode: 'EMAIL',
    Email: vendorData.email || '',
  };

  console.log('[Oracle Supplier] Step 4: Creating Site... Payload:', JSON.stringify(payload));
  const res = await withRetry(() => http().post(path, payload), 'Create Site');
  const data = assertOk(res, 'Create Site');

  const supplierSiteId = data.SupplierSiteId ?? data.supplierSiteId ?? data.id;
  console.log(`[Oracle Supplier] Site created: SupplierSiteId=${supplierSiteId}`);

  return { supplierSiteId: String(supplierSiteId), raw: data };
}

async function createSiteAssignment(supplierId, siteId, vendorData, maps) {
  const ver = encodeURIComponent(oracleConfig.apiVersion);
  const sid = encodeURIComponent(supplierId);
  const stid = encodeURIComponent(siteId);
  const path = oracleConfig.mode === 'live'
    ? `/fscmRestApi/resources/${ver}/suppliers/${sid}/child/sites/${stid}/child/assignments`
    : `/suppliers/${sid}/child/sites/${stid}/child/assignments`;

  const entityConfig = resolveEntityOracleConfig(vendorData, maps.entities);
  if (!entityConfig?.bu) {
    throw new Error('Cannot resolve Fusion Business Unit. Ensure Vendor is mapped to an Entity with Business Unit (Oracle) filled.');
  }

  const payload = {
    BillToBU: entityConfig.bu,
    ClientBU: entityConfig.bu,
    UseWithholdingTaxFlag: 'N',
    ...(entityConfig.liabilityDistribution ? { LiabilityDistribution: entityConfig.liabilityDistribution } : {}),
    ...(entityConfig.prepaymentDistribution ? { PrepaymentDistribution: entityConfig.prepaymentDistribution } : {}),
  };

  console.log('[Oracle Supplier] Step 5: Creating Site Assignment... Payload:', JSON.stringify(payload));
  const res = await withRetry(() => http().post(path, payload), 'Create Site Assignment');
  const data = assertOk(res, 'Create Site Assignment');

  const assignmentId = data.AssignmentId ?? data.assignmentId ?? data.id;
  console.log(`[Oracle Supplier] Site Assignment created: AssignmentId=${assignmentId}`);

  return { assignmentId: String(assignmentId), raw: data };
}

async function lookupBranchByIfsc(ifscCode) {
  if (!ifscCode || oracleConfig.mode !== 'live') return null;
  const ver = encodeURIComponent(oracleConfig.apiVersion);
  const path = `/fscmRestApi/resources/${ver}/cashBankBranches?q=BranchNumber='${ifscCode}'`;
  console.log(`[Oracle Supplier] Looking up branch by IFSC: ${ifscCode}`);
  try {
    const res = await fusionHttp().get(path);
    const items = res.data?.items || [];
    if (items.length === 0) return null;
    const branch = items[0];
    console.log(`[Oracle Supplier] Found branch: BankName=${branch.BankName}, BranchPartyId=${branch.BranchPartyId}, BankPartyNumber=${branch.BankPartyNumber}`);
    return {
      branchPartyId: branch.BranchPartyId,
      bankName: branch.BankName,
      branchName: branch.BankBranchName,
      bankPartyNumber: branch.BankPartyNumber,
    };
  } catch (e) {
    console.warn(`[Oracle Supplier] Branch IFSC lookup failed: ${e.message}`);
    return null;
  }
}

async function lookupBankByPartyNumber(bankPartyNumber) {
  if (!bankPartyNumber || oracleConfig.mode !== 'live') return null;
  const ver = encodeURIComponent(oracleConfig.apiVersion);
  const path = `/fscmRestApi/resources/${ver}/cashBanks?q=BankPartyNumber='${bankPartyNumber}'`;
  try {
    const res = await fusionHttp().get(path);
    const items = res.data?.items || [];
    if (items.length === 0) return null;
    return { bankPartyId: items[0].BankPartyId, bankName: items[0].BankName };
  } catch (e) {
    console.warn(`[Oracle Supplier] Bank lookup failed: ${e.message}`);
    return null;
  }
}

/** Escape single quotes for Oracle REST q= string literals */
function escapeOracleQ(value) {
  return String(value).replace(/'/g, "''");
}

/**
 * Find an existing cash bank by display name + country (avoids CE-660205 duplicate).
 */
async function lookupBankByNameAndCountry(bankName, countryName) {
  if (!bankName?.trim() || oracleConfig.mode !== 'live') return null;
  const ver = encodeURIComponent(oracleConfig.apiVersion);
  const nameNorm = bankName.trim();
  const countryNorm = (countryName || 'India').trim();
  const nameEsc = escapeOracleQ(nameNorm);
  const queries = [`BankName='${nameEsc}'`, `BankName LIKE '${nameEsc}%'`];
  for (const q of queries) {
    try {
      const path = `/fscmRestApi/resources/${ver}/cashBanks?q=${encodeURIComponent(q)}`;
      const res = await fusionHttp().get(path);
      const items = res.data?.items || [];
      const exact = items.find((b) => {
        const bn = (b.BankName || '').trim().toLowerCase();
        if (bn !== nameNorm.toLowerCase()) return false;
        const cn = (b.CountryName || '').trim();
        if (!cn) return true;
        return cn === countryNorm || cn.toLowerCase() === countryNorm.toLowerCase();
      });
      if (exact) {
        console.log(
          `[Oracle Supplier] Found existing bank by name+country: ${exact.BankName} BankPartyId=${exact.BankPartyId}`
        );
        return { bankPartyId: exact.BankPartyId, bankName: exact.BankName };
      }
    } catch (e) {
      console.warn(`[Oracle Supplier] lookupBankByNameAndCountry: ${e.message}`);
    }
  }
  return null;
}

async function createOracleBank(bankName, countryName) {
  const existing = await lookupBankByNameAndCountry(bankName, countryName);
  if (existing) {
    console.log(`[Oracle Supplier] Reusing existing Oracle bank: ${existing.bankName} (${existing.bankPartyId})`);
    return existing;
  }

  const ver = encodeURIComponent(oracleConfig.apiVersion);
  const path = `/fscmRestApi/resources/${ver}/cashBanks`;
  const payload = { BankName: bankName, CountryName: countryName || 'India' };
  console.log(`[Oracle Supplier] Auto-creating bank in Oracle: ${bankName}`);
  const res = await fusionHttp().post(path, payload);
  if (res.status >= 200 && res.status < 300) {
    const data = res.data;
    console.log(`[Oracle Supplier] Bank created: BankPartyId=${data.BankPartyId}`);
    return { bankPartyId: data.BankPartyId, bankName: data.BankName };
  }

  const body = res.data;
  const msg = String(
    body?.message || body?.title || body?.detail || (typeof body === 'string' ? body : '') || ''
  );
  if (msg.includes('CE-660205') || msg.toLowerCase().includes('already that combination')) {
    const fallback = await lookupBankByNameAndCountry(bankName, countryName);
    if (fallback) {
      console.log(`[Oracle Supplier] Duplicate bank (CE-660205); reusing from lookup: ${fallback.bankName}`);
      return fallback;
    }
  }

  assertOk(res, 'Auto-create Bank');
}

async function createOracleBranch(bankName, branchName, ifscCode, countryName) {
  const ver = encodeURIComponent(oracleConfig.apiVersion);
  const path = `/fscmRestApi/resources/${ver}/cashBankBranches`;
  const payload = {
    BankName: bankName,
    BankBranchName: branchName || ifscCode,
    BranchNumber: ifscCode,
    CountryName: countryName || 'India',
  };
  console.log(`[Oracle Supplier] Auto-creating branch in Oracle: ${branchName || ifscCode}`);
  const res = await fusionHttp().post(path, payload);
  const data = assertOk(res, 'Auto-create Branch');
  console.log(`[Oracle Supplier] Branch created: BranchPartyId=${data.BranchPartyId}`);
  return { branchPartyId: data.BranchPartyId, branchName: data.BankBranchName };
}

async function resolveOracleBankBranch(vendorData) {
  const ifsc = String(vendorData.ifsc || '').trim();
  if (!ifsc) {
    console.log('[Oracle Supplier] No IFSC code provided, using manual Oracle identifiers if available');
    return {
      bankIdentifier: vendorData.bankIdentifier ? Number(vendorData.bankIdentifier) : undefined,
      bankBranchIdentifier: vendorData.bankBranchIdentifier ? Number(vendorData.bankBranchIdentifier) : undefined,
      resolvedBankName: vendorData.bankName || '',
      resolvedBranchName: vendorData.bankBranchName || '',
      method: 'manual',
    };
  }

  const branch = await lookupBranchByIfsc(ifsc);
  if (branch) {
    const bank = await lookupBankByPartyNumber(branch.bankPartyNumber);
    return {
      bankIdentifier: bank?.bankPartyId || undefined,
      bankBranchIdentifier: branch.branchPartyId,
      resolvedBankName: bank?.bankName || branch.bankName,
      resolvedBranchName: branch.branchName,
      method: 'ifsc-lookup',
    };
  }

  console.log(`[Oracle Supplier] IFSC ${ifsc} not found in Oracle. Auto-creating bank & branch...`);
  const bankDisplayName = vendorData.bankName || ifsc.substring(0, 4);
  const branchDisplayName = vendorData.bankBranchName || ifsc;

  let countryFullName = 'India';
  const cc = vendorData.countryCode || 'IN';
  if (cc === 'IN') countryFullName = 'India';

  const bank = await createOracleBank(bankDisplayName, countryFullName);
  const newBranch = await createOracleBranch(bank.bankName, branchDisplayName, ifsc, countryFullName);

  return {
    bankIdentifier: bank.bankPartyId,
    bankBranchIdentifier: newBranch.branchPartyId,
    resolvedBankName: bank.bankName,
    resolvedBranchName: newBranch.branchName,
    method: 'auto-created',
  };
}

async function createExternalBankAccount(supplierPartyId, vendorData, vendorName) {
  const ver = encodeURIComponent(oracleConfig.apiVersion);
  const path = oracleConfig.mode === 'live'
    ? `/fscmRestApi/resources/${ver}/externalBankAccounts`
    : '/externalBankAccounts';

  const supplierName = vendorData.oracleSupplierName || vendorName;
  const partyId = Number(supplierPartyId);

  const rawCurrency = String(vendorData.paymentCurrencyCode || '').trim().toUpperCase();
  const currencyCode = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : 'INR';

  const bankAcctNum = String(vendorData.accNo || vendorData.bankAccountNumber || '').trim() || ('ACC' + Date.now());

  const resolved = oracleConfig.mode === 'live'
    ? await resolveOracleBankBranch(vendorData)
    : { bankIdentifier: vendorData.bankIdentifier, bankBranchIdentifier: vendorData.bankBranchIdentifier, resolvedBankName: vendorData.bankName || '', resolvedBranchName: vendorData.bankBranchName || '', method: 'mock' };

  console.log(`[Oracle Supplier] Bank/Branch resolved via "${resolved.method}": Bank=${resolved.resolvedBankName}, Branch=${resolved.resolvedBranchName}`);

  const payload = {
    BankAccountNumber: bankAcctNum,
    CountryCode: vendorData.countryCode || 'IN',
    CurrencyCode: currencyCode,
    AccountType: vendorData.bankAccountType || 'SAVINGS',
    AllowInternationalPaymentIndicator: 'Y',
    Intent: 'Supplier',
    PartyId: partyId,
    BankAccountName: supplierName + ' Bank Account',
    PayeeCreation: 'Y',
    accountOwners: [
      {
        AccountOwnerPartyIdentifier: partyId,
        Intent: 'Supplier',
      },
    ],
  };

  if (resolved.bankIdentifier) payload.BankIdentifier = Number(resolved.bankIdentifier);
  if (resolved.bankBranchIdentifier) payload.BankBranchIdentifier = Number(resolved.bankBranchIdentifier);

  console.log('[Oracle Supplier] Step 6: Creating External Bank Account... Payload:', JSON.stringify(payload));
  const res = await withRetry(() => http().post(path, payload), 'Create External Bank Account');
  const data = assertOk(res, 'Create External Bank Account');

  const bankAccountId = data.BankAccountId ?? data.bankAccountId ?? data.id;
  const bankResolution = resolved.method;
  console.log(`[Oracle Supplier] Bank Account created: BankAccountId=${bankAccountId}, resolution=${bankResolution}`);

  return { bankAccountId: String(bankAccountId), bankResolution, resolvedBankName: resolved.resolvedBankName, resolvedBranchName: resolved.resolvedBranchName, raw: data };
}

async function fetchExtPayeeId(supplierPartyId, supplierSiteId) {
  console.log('[Oracle Supplier] Step 7: Extracting EXT_PAYEE_ID via SOAP BI...');

  if (oracleConfig.mode !== 'live') {
    const mockId = 'EXTPAY-' + Date.now();
    console.log(`[Oracle Supplier] Mock EXT_PAYEE_ID: ${mockId}`);
    return mockId;
  }

  const extPayeeId = await extractExtPayeeId(supplierPartyId, supplierSiteId);
  return extPayeeId;
}

// ═══════════════════════════════════════════════════════════════
// Persist results back to vendor master data
// ═══════════════════════════════════════════════════════════════

async function persistOnboardingResult(vendorMasterId, oracleIds, status, completedStep, error) {
  const vendorRes = await query(
    `SELECT data FROM masters WHERE master_type = 'Vendor' AND id = $1`,
    [vendorMasterId]
  );
  const existing = parseMasterData(vendorRes.rows?.[0]);

  const updated = {
    ...existing,
    fusionSupplierId: oracleIds.supplierId || existing.fusionSupplierId || null,
    fusionSupplierPartyId: oracleIds.supplierPartyId || existing.fusionSupplierPartyId || null,
    fusionSupplierAddressId: oracleIds.supplierAddressId || existing.fusionSupplierAddressId || null,
    fusionSupplierContactId: oracleIds.supplierContactId || existing.fusionSupplierContactId || null,
    fusionSupplierSiteId: oracleIds.supplierSiteId || existing.fusionSupplierSiteId || null,
    fusionSiteAssignmentId: oracleIds.assignmentId || existing.fusionSiteAssignmentId || null,
    fusionBankAccountId: oracleIds.bankAccountId || existing.fusionBankAccountId || null,
    fusionBankResolution: oracleIds.bankResolution || existing.fusionBankResolution || null,
    fusionResolvedBankName: oracleIds.resolvedBankName || existing.fusionResolvedBankName || null,
    fusionResolvedBranchName: oracleIds.resolvedBranchName || existing.fusionResolvedBranchName || null,
    fusionExtPayeeId: oracleIds.extPayeeId || existing.fusionExtPayeeId || null,
    fusionOnboardingStatus: status,
    fusionOnboardingCompletedStep: completedStep,
    fusionOnboardingError: error || null,
    fusionOnboardedAt: (status === 'COMPLETE' || status === 'COMPLETE_PARTIAL') ? new Date().toISOString() : (existing.fusionOnboardedAt || null),
  };

  await query(
    `UPDATE masters SET data = $1 WHERE master_type = 'Vendor' AND id = $2`,
    [JSON.stringify(updated), vendorMasterId]
  );
}

// ═══════════════════════════════════════════════════════════════
// Main orchestrator
// ═══════════════════════════════════════════════════════════════

export async function onboardSupplier(vendorMasterId) {
  const { vendorRow, vendorData, maps } = await loadVendorAndMasters(vendorMasterId);
  const vendorName = vendorRow.name || '';

  const missing = [];
  if (!vendorData.address1) missing.push('Address Line 1');
  if (!(vendorData.state || vendorData.stateId)) missing.push('State');
  if (!(vendorData.city || vendorData.cityId)) missing.push('City');
  if (!vendorData.pincode) missing.push('Pincode');
  if (!vendorData.countryCode) missing.push('Country');
  if (vendorData.pan && !vendorData.taxpayerCountryCode) missing.push('Taxpayer Country Code');
  if (!(vendorData.contactFirstName || vendorData.contactLastName)) missing.push('Contact Name (First or Last)');
  if (missing.length) {
    throw new Error(`Missing required fields for Oracle onboarding: ${missing.join(', ')}. Please fill them in the Vendor form and Sync before onboarding.`);
  }

  const oracleIds = {};
  let completedStep = null;

  try {
    // Step 1
    const s1 = await createSupplier(vendorData, vendorName);
    oracleIds.supplierId = s1.supplierId;
    oracleIds.supplierPartyId = s1.supplierPartyId;
    completedStep = 'supplier';

    // Step 2
    const s2 = await createAddress(s1.supplierId, vendorData, maps);
    oracleIds.supplierAddressId = s2.supplierAddressId;
    completedStep = 'address';

    // Step 3
    const s3 = await createContact(s1.supplierId, vendorData);
    oracleIds.supplierContactId = s3.supplierContactId;
    completedStep = 'contact';

    // Step 4
    const s4 = await createSite(s1.supplierId, vendorData, s2.addressName, maps);
    oracleIds.supplierSiteId = s4.supplierSiteId;
    completedStep = 'site';

    // Step 5
    const s5 = await createSiteAssignment(s1.supplierId, s4.supplierSiteId, vendorData, maps);
    oracleIds.assignmentId = s5.assignmentId;
    completedStep = 'siteAssignment';

    // Step 6
    const s6 = await createExternalBankAccount(s1.supplierPartyId, vendorData, vendorName);
    oracleIds.bankAccountId = s6.bankAccountId;
    oracleIds.bankResolution = s6.bankResolution;
    oracleIds.resolvedBankName = s6.resolvedBankName;
    oracleIds.resolvedBranchName = s6.resolvedBranchName;
    completedStep = 'bankAccount';

    // Step 7 — graceful: if SOAP BI fails, onboarding still counts as complete
    let extPayeeWarning = null;
    try {
      const extPayeeId = await fetchExtPayeeId(s1.supplierPartyId, s4.supplierSiteId);
      oracleIds.extPayeeId = extPayeeId;
      completedStep = 'extPayeeId';
    } catch (soapErr) {
      extPayeeWarning = soapErr.message;
      console.warn(`[Oracle Supplier] Step 7 (EXT_PAYEE_ID) failed but onboarding continues: ${soapErr.message}`);
      completedStep = 'bankAccount';
    }

    const status = oracleIds.extPayeeId ? 'COMPLETE' : 'COMPLETE_PARTIAL';
    await persistOnboardingResult(vendorMasterId, oracleIds, status, completedStep, extPayeeWarning);

    const bankNote = 'NOTE: Bank account created in Oracle but must be manually assigned via Supplier → Payments → Bank Accounts → + button.';
    const msg = oracleIds.extPayeeId
      ? `Supplier onboarded successfully. ${bankNote}`
      : `Supplier onboarded (Steps 1-6 complete). EXT_PAYEE_ID extraction failed — can be retried later. ${bankNote}`;

    console.log(`[Oracle Supplier] Onboarding ${status} for`, vendorName);
    return {
      success: true,
      message: msg,
      warning: extPayeeWarning || undefined,
      data: {
        supplierId: oracleIds.supplierId,
        supplierPartyId: oracleIds.supplierPartyId,
        supplierAddressId: oracleIds.supplierAddressId,
        supplierContactId: oracleIds.supplierContactId,
        supplierSiteId: oracleIds.supplierSiteId,
        assignmentId: oracleIds.assignmentId,
        bankAccountId: oracleIds.bankAccountId,
        extPayeeId: oracleIds.extPayeeId || null,
      },
    };
  } catch (err) {
    console.error(`[Oracle Supplier] Failed at step '${completedStep || 'init'}':`, err.message);
    await persistOnboardingResult(vendorMasterId, oracleIds, 'FAILED', completedStep, err.message).catch((e) =>
      console.error('[Oracle Supplier] Failed to persist error state:', e.message)
    );

    return {
      success: false,
      message: err.message,
      completedStep,
      oracleIds,
    };
  }
}
