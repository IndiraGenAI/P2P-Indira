import { GRN, Invoice, MasterRecord, PurchaseOrder, RateContract } from '../types';

export function inCreatedAtRange(createdAt: string, dateFrom: string, dateTo: string): boolean {
  if (!dateFrom && !dateTo) return true;
  const t = new Date(createdAt).getTime();
  if (Number.isNaN(t)) return true;
  if (dateFrom) {
    const f = new Date(`${dateFrom}T00:00:00`).getTime();
    if (t < f) return false;
  }
  if (dateTo) {
    const x = new Date(`${dateTo}T23:59:59.999`).getTime();
    if (t > x) return false;
  }
  return true;
}

export function matchesVendorFilter(rowVendorId: string | undefined, filterVendorId: string): boolean {
  if (!filterVendorId) return true;
  return rowVendorId === filterVendorId;
}

export function matchesStatusQuickFilter(
  status: string,
  quick: 'all' | 'approved' | 'pending'
): boolean {
  if (quick === 'all') return true;
  if (quick === 'approved') return status === 'Approved';
  if (quick === 'pending') return status === 'Pending';
  return true;
}

export function vendorIdFromSiteId(
  siteId: string | undefined,
  masters: Record<string, MasterRecord[]>
): string | undefined {
  if (!siteId) return undefined;
  const s = (masters['Vendor Site'] || []).find((x) => x.id === siteId) as { vendorId?: string } | undefined;
  return s?.vendorId;
}

export function getGrnVendorId(
  grn: GRN,
  rateContracts: RateContract[],
  purchaseOrders: PurchaseOrder[],
  masters: Record<string, MasterRecord[]>
): string | undefined {
  const fromSite = vendorIdFromSiteId(grn.vendorSiteId, masters);
  if (fromSite) return fromSite;
  if (grn.rateContractId) {
    const rc = rateContracts.find((r) => r.id === grn.rateContractId);
    if (rc?.vendorId) return rc.vendorId;
  }
  if (grn.purchaseOrderId) {
    const po = purchaseOrders.find((p) => p.id === grn.purchaseOrderId);
    if (po?.vendorId) return po.vendorId;
  }
  return undefined;
}

export function getRcInvoiceVendorId(
  inv: Invoice,
  grns: GRN[],
  rateContracts: RateContract[],
  purchaseOrders: PurchaseOrder[],
  masters: Record<string, MasterRecord[]>
): string | undefined {
  if (inv.grnId) {
    const g = grns.find((x) => x.id === inv.grnId);
    if (g) return getGrnVendorId(g, rateContracts, purchaseOrders, masters);
  }
  return vendorIdFromSiteId(inv.vendorSiteId, masters);
}

export function getPoInvoiceVendorId(
  inv: Invoice,
  grns: GRN[],
  rateContracts: RateContract[],
  purchaseOrders: PurchaseOrder[],
  masters: Record<string, MasterRecord[]>
): string | undefined {
  return getRcInvoiceVendorId(inv, grns, rateContracts, purchaseOrders, masters);
}

export function textIncludes(haystack: string, needle: string): boolean {
  if (!needle.trim()) return true;
  return haystack.toLowerCase().includes(needle.trim().toLowerCase());
}
