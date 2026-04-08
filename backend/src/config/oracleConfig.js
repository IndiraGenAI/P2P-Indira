/**
 * Centralized Oracle Fusion configuration.
 * Reuses FUSION_* env vars already used by oracleInvoiceService.
 */

const config = {
  get baseUrl() {
    const url = (process.env.FUSION_BASE_URL || process.env.ORACLE_BASE_URL || '').trim();
    if (!url) throw new Error('Fusion base URL not configured. Set FUSION_BASE_URL.');
    return url.replace(/\/$/, '');
  },

  get apiVersion() {
    return (process.env.FUSION_API_VERSION || process.env.ORACLE_API_VERSION || '11.13.18.05').trim();
  },

  get username() {
    const u = (process.env.FUSION_USERNAME || process.env.ORACLE_USERNAME || '').trim();
    if (!u) throw new Error('Fusion username not configured. Set FUSION_USERNAME.');
    return u;
  },

  get password() {
    const p = (process.env.FUSION_PASSWORD || process.env.ORACLE_PASSWORD || '').trim();
    if (!p) throw new Error('Fusion password not configured. Set FUSION_PASSWORD.');
    return p;
  },

  get biReportPath() {
    return (process.env.ORACLE_BI_REPORT_PATH || '/Custom/Financials/Invoices/BANK_ACCOUNT_ID_RPT.xdo').trim();
  },

  get timeoutMs() {
    return Number(process.env.FUSION_TIMEOUT_MS || 30000);
  },

  get retryCount() {
    return Math.max(0, Number(process.env.FUSION_RETRY_COUNT || 2));
  },

  get retryDelayMs() {
    return Math.max(50, Number(process.env.FUSION_RETRY_DELAY_MS || 400));
  },

  get restFrameworkVersion() {
    return String(process.env.FUSION_REST_FRAMEWORK_VERSION || '2');
  },

  get mode() {
    return (process.env.ORACLE_MODE || 'mock').trim().toLowerCase();
  },
};

export default config;

