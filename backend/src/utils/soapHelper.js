/**
 * SOAP helper for Oracle BI Publisher EXT_PAYEE_ID extraction.
 * Builds SOAP XML, calls with basic auth, decodes base64 CSV response.
 */
import axios from 'axios';
import oracleConfig from '../config/oracleConfig.js';

function buildRunReportXml(partyId, siteId) {
  const reportPath = oracleConfig.biReportPath;
  return `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"
  xmlns:pub="http://xmlns.oracle.com/oxp/service/PublicReportService">
  <soap:Body>
    <pub:runReport>
      <pub:reportRequest>
        <pub:reportAbsolutePath>${reportPath}</pub:reportAbsolutePath>
        <pub:parameterNameValues>
          <pub:item>
            <pub:name>PARTY_ID</pub:name>
            <pub:values><pub:item>${partyId}</pub:item></pub:values>
          </pub:item>
          <pub:item>
            <pub:name>SUPPLIER_SITE_ID</pub:name>
            <pub:values><pub:item>${siteId}</pub:item></pub:values>
          </pub:item>
        </pub:parameterNameValues>
        <pub:sizeOfDataChunkDownload>-1</pub:sizeOfDataChunkDownload>
      </pub:reportRequest>
    </pub:runReport>
  </soap:Body>
</soap:Envelope>`;
}

function decodeReportBytes(soapXml) {
  if (!soapXml || typeof soapXml !== 'string') return null;
  const match = soapXml.match(/<(?:\w+:)?reportBytes>([^<]+)<\/(?:\w+:)?reportBytes>/);
  if (!match || !match[1]) return null;
  return Buffer.from(match[1], 'base64').toString('utf-8');
}

function extractSoapFault(soapXml) {
  if (!soapXml || typeof soapXml !== 'string') return null;
  const faultMatch = soapXml.match(/<(?:\w+:)?faultstring>([^<]*)<\/(?:\w+:)?faultstring>/);
  return faultMatch?.[1] || null;
}

function parseExtPayeeIdFromCsv(csvText) {
  if (!csvText) return null;
  const lines = csvText.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return null;
  const headers = lines[0].split(',').map((h) => h.trim().replace(/"/g, ''));
  const payeeIdx = headers.findIndex(
    (h) => h.toUpperCase() === 'EXT_PAYEE_ID'
  );
  if (payeeIdx === -1) {
    const vals = lines[1].split(',').map((v) => v.trim().replace(/"/g, ''));
    return vals[0] || null;
  }
  const vals = lines[1].split(',').map((v) => v.trim().replace(/"/g, ''));
  return vals[payeeIdx] || null;
}

/**
 * Extract EXT_PAYEE_ID from Oracle BI Publisher SOAP report.
 * @param {string|number} partyId - SupplierPartyId
 * @param {string|number} siteId - SupplierSiteId (Fusion)
 * @returns {Promise<string>} extPayeeId
 */
export async function extractExtPayeeId(partyId, siteId) {
  const soapBody = buildRunReportXml(partyId, siteId);
  const url = `${oracleConfig.baseUrl}/xmlpserver/services/ExternalReportWSSService`;

  console.log(`[Oracle Supplier] SOAP BI request: URL=${url}, PARTY_ID=${partyId}, SUPPLIER_SITE_ID=${siteId}`);

  const retries = oracleConfig.retryCount;
  const baseDelayMs = oracleConfig.retryDelayMs;
  let lastErr = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await axios.post(url, soapBody, {
        headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' },
        auth: { username: oracleConfig.username, password: oracleConfig.password },
        timeout: oracleConfig.timeoutMs,
      });

      const responseBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      console.log(`[Oracle Supplier] SOAP RESPONSE >>> status=${response.status}, body(500chars)=${responseBody.substring(0, 500)}`);

      const csvText = decodeReportBytes(responseBody);
      if (!csvText) {
        const fault = extractSoapFault(responseBody);
        throw new Error(
          fault
            ? `SOAP BI Report fault: ${fault}`
            : `SOAP response missing reportBytes — check report path (${oracleConfig.biReportPath}) and parameters.`
        );
      }

      console.log(`[Oracle Supplier] SOAP decoded CSV: ${csvText.substring(0, 300)}`);

      const extPayeeId = parseExtPayeeIdFromCsv(csvText);
      if (!extPayeeId) {
        throw new Error(`Could not parse EXT_PAYEE_ID from report CSV. Raw CSV: ${csvText.substring(0, 200)}`);
      }

      console.log(`[Oracle Supplier] EXT_PAYEE_ID extracted: ${extPayeeId}`);
      return extPayeeId;
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;

      if (status && e.response?.data) {
        const errBody = typeof e.response.data === 'string' ? e.response.data : JSON.stringify(e.response.data);
        console.error(`[Oracle Supplier] SOAP ERROR >>> status=${status}, body(500chars)=${errBody.substring(0, 500)}`);
      }

      const retryable = status == null || status === 429 || (status >= 500 && status <= 599);
      if (!retryable || attempt === retries) {
        const fault = e?.response?.data ? extractSoapFault(String(e.response.data)) : null;
        const msg = fault || e.message || `SOAP BI Report failed (${status || 'unknown'})`;
        const err = new Error(msg);
        err.status = status;
        throw err;
      }

      const delay = baseDelayMs * Math.pow(2, attempt);
      console.log(`[Oracle Supplier] SOAP BI attempt ${attempt + 1} failed (${status || e.message}), retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export { buildRunReportXml, decodeReportBytes, parseExtPayeeIdFromCsv };
