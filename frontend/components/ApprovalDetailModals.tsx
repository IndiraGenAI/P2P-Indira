import React from 'react';
import { Budget, MasterRecord } from '../types';

const roBox =
  'w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 text-sm font-semibold min-h-[42px] flex items-center';
const lbl = 'text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1 mb-1 block';

function Ro({ label, children }: { label: string; children: React.ReactNode }) {
  const v = children == null || children === '' ? '—' : children;
  return (
    <div className="space-y-1">
      <span className={lbl}>{label}</span>
      <div className={roBox}>{v}</div>
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl my-8 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
      >
        <div className="sticky top-0 z-10 flex justify-between items-center p-6 border-b border-slate-100 bg-white">
          <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-2xl bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="p-6 space-y-6">{children}</div>
        <div className="p-6 pt-0 flex justify-end border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="px-8 py-3 bg-indigo-600 text-white font-black text-xs uppercase rounded-xl hover:bg-indigo-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function ItemApprovalViewModal({
  masters,
  itemId,
  onClose,
}: {
  masters: Record<string, MasterRecord[]>;
  itemId: string | null;
  onClose: () => void;
}) {
  if (!itemId) return null;
  const r = (masters['Item'] || []).find((x) => x.id === itemId) as Record<string, unknown> | undefined;
  if (!r) {
    return (
      <ModalShell title="Item details" onClose={onClose}>
        <p className="text-slate-600 font-medium">Record not found. Refresh masters and try again.</p>
      </ModalShell>
    );
  }
  const coaList = masters['COA'] || [];
  const coa =
    coaList.find((c: any) => c.id === r.coaId) ?? coaList.find((c: any) => c.code === r.coaCode);
  const cat = (masters['Item Category'] || []).find((c: any) => c.id === r.itemCategoryId);
  const uom = (masters['UOM'] || []).find((u: any) => u.id === r.uomId);
  return (
    <ModalShell title="Item details (read-only)" onClose={onClose}>
      <p className="text-xs text-slate-500 -mt-2">As entered at creation — not editable.</p>
      <div className="grid grid-cols-2 gap-4">
        <Ro label="Item code">{String(r.code ?? '')}</Ro>
        <Ro label="Item type">{String(r.itemType ?? '')}</Ro>
      </div>
      <Ro label="Item name">{String(r.name ?? '')}</Ro>
      <Ro label="COA (accounting)">
        {coa
          ? `${(coa as any).category ? `${(coa as any).category}: ` : ''}${(coa as any).name} (${(coa as any).code})`
          : String(r.coaCode ?? '')}
      </Ro>
      <div className="grid grid-cols-2 gap-4">
        <Ro label="Item category">{cat ? (cat as any).name : ''}</Ro>
        <Ro label="UOM">{uom ? (uom as any).name : ''}</Ro>
      </div>
      <Ro label="Operational status">{String(r.status ?? 'Active')}</Ro>
    </ModalShell>
  );
}

export function VendorApprovalViewModal({
  masters,
  vendorId,
  onClose,
}: {
  masters: Record<string, MasterRecord[]>;
  vendorId: string | null;
  onClose: () => void;
}) {
  if (!vendorId) return null;
  const r = (masters['Vendor'] || []).find((x) => x.id === vendorId) as Record<string, unknown> | undefined;
  if (!r) {
    return (
      <ModalShell title="Vendor details" onClose={onClose}>
        <p className="text-slate-600 font-medium">Record not found. Refresh masters and try again.</p>
      </ModalShell>
    );
  }
  const state = (masters['State'] || []).find((s: any) => s.id === r.stateId);
  const city = (masters['City'] || []).find((c: any) => c.id === r.cityId);
  const tds = (masters['TDS'] || []).find((t: any) => t.id === r.tdsId);
  const pay = (masters['Payment Terms'] || []).find((p: any) => p.id === r.payTermId);
  const appType = (masters['Applicant Type'] || []).find((a: any) => a.id === r.applicantTypeId);
  const vcat = (masters['Vendor Category'] || []).find((c: any) => c.id === r.categoryId);
  const sites = Array.isArray(r.siteIds) ? (r.siteIds as string[]).filter(Boolean) : [];
  const entities = Array.isArray(r.entityIds) ? (r.entityIds as string[]).filter(Boolean) : [];
  return (
    <ModalShell title="Vendor details (read-only)" onClose={onClose}>
      <p className="text-xs text-slate-500 -mt-2">As entered at creation — not editable.</p>
      <div className="grid grid-cols-2 gap-4">
        <Ro label="Vendor code">{String(r.code ?? '')}</Ro>
        <Ro label="Vendor name">{String(r.name ?? '')}</Ro>
      </div>
      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-1">Address</h4>
      <Ro label="Address line 1">{String(r.address1 ?? '')}</Ro>
      <Ro label="Address line 2">{String(r.address2 ?? '')}</Ro>
      <Ro label="Address line 3">{String(r.address3 ?? '')}</Ro>
      <div className="grid grid-cols-3 gap-4">
        <Ro label="State">{state ? (state as any).name : ''}</Ro>
        <Ro label="City">{city ? (city as any).name : ''}</Ro>
        <Ro label="Pincode">{String(r.pincode ?? '')}</Ro>
      </div>
      <Ro label="Assigned sites / centers">{sites.length ? sites.join(', ') : '—'}</Ro>
      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-1 pt-2">
        Contact & compliance
      </h4>
      <div className="grid grid-cols-2 gap-4">
        <Ro label="Phone">{String(r.phone ?? '')}</Ro>
        <Ro label="Email">{String(r.email ?? '')}</Ro>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Ro label="PAN">{String(r.pan ?? '')}</Ro>
        <Ro label="GST">{String(r.gst ?? '')}</Ro>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Ro label="Vendor type (MSME)">{String(r.vendorType ?? '')}</Ro>
        <Ro label="MSME reg no.">{String(r.msmeRegNo ?? '')}</Ro>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Ro label="Contact first name">{String(r.contactFirstName ?? '')}</Ro>
        <Ro label="Contact last name">{String(r.contactLastName ?? '')}</Ro>
      </div>
      <Ro label="Country">{String(r.countryCode ?? '')}</Ro>
      <Ro label="Payment currency">{String(r.paymentCurrencyCode ?? '')}</Ro>
      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-1 pt-2">Bank</h4>
      <Ro label="Account number">{String(r.accNo ?? '')}</Ro>
      <div className="grid grid-cols-2 gap-4">
        <Ro label="Bank name">{String(r.bankName ?? '')}</Ro>
        <Ro label="Branch name">{String(r.bankBranchName ?? '')}</Ro>
      </div>
      <Ro label="IFSC">{String(r.ifsc ?? '')}</Ro>
      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-1 pt-2">Tax & category</h4>
      <div className="grid grid-cols-2 gap-4">
        <Ro label="TDS">{tds ? `${(tds as any).name} (${(tds as any).rate}%)` : ''}</Ro>
        <Ro label="Payment terms">{pay ? (pay as any).name : ''}</Ro>
      </div>
      <Ro label="Entity mapping">{entities.length ? entities.map((eid: string) => {
        const ent = (masters['Entity'] || []).find((e: any) => e.id === eid);
        return ent ? ent.name : eid;
      }).join(', ') : '—'}</Ro>
      <div className="grid grid-cols-2 gap-4">
        <Ro label="Resident status">{String(r.residency ?? '')}</Ro>
        <Ro label="Applicant type">{appType ? (appType as any).name : ''}</Ro>
      </div>
      <Ro label="Vendor category">{vcat ? (vcat as any).name : ''}</Ro>
      <Ro label="Operational status">{String(r.status ?? 'Active')}</Ro>
      {(r.fusionSupplierId || r.fusionOnboardingStatus) && (
        <>
          <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-1 pt-2">Oracle Fusion Onboarding</h4>
          <Ro label="Onboarding status">{String(r.fusionOnboardingStatus ?? '—')}</Ro>
          <div className="grid grid-cols-2 gap-4">
            <Ro label="Supplier ID">{String(r.fusionSupplierId ?? '—')}</Ro>
            <Ro label="Party ID">{String(r.fusionSupplierPartyId ?? '—')}</Ro>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Ro label="Site ID">{String(r.fusionSupplierSiteId ?? '—')}</Ro>
            <Ro label="Bank Account ID">{String(r.fusionBankAccountId ?? '—')}</Ro>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Ro label="EXT Payee ID">{String(r.fusionExtPayeeId ?? '—')}</Ro>
            <Ro label="Onboarded at">{String(r.fusionOnboardedAt ?? '—')}</Ro>
          </div>
          {r.fusionOnboardingError && (
            <Ro label="Last error">{String(r.fusionOnboardingError)}</Ro>
          )}
        </>
      )}
    </ModalShell>
  );
}

export function BudgetApprovalViewModal({
  budget,
  onClose,
}: {
  budget: Budget | null;
  onClose: () => void;
}) {
  if (!budget) {
    return (
      <ModalShell title="Budget details" onClose={onClose}>
        <p className="text-slate-600 font-medium">
          This budget is not in the loaded list. Open Budgets or refresh the page and try again.
        </p>
      </ModalShell>
    );
  }
  return (
    <ModalShell title="Budget details (read-only)" onClose={onClose}>
      <p className="text-xs text-slate-500 -mt-2">As entered at creation — not editable.</p>
      <div className="grid grid-cols-2 gap-4">
        <Ro label="Financial year">{budget.financialYear}</Ro>
        <Ro label="Budget type">{budget.budgetType}</Ro>
      </div>
      <Ro label="GL code (COA)">{budget.coaCode}</Ro>
      <div className="grid grid-cols-2 gap-4">
        <Ro label="Department">{budget.department ?? '—'}</Ro>
        <Ro label="Subdepartment">{budget.subDepartment ?? '—'}</Ro>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Ro label="Entity">{budget.entityName}</Ro>
        <Ro label="Location">{budget.locationName}</Ro>
      </div>
      <Ro label="Cost center">{budget.costCenterName}</Ro>
      <div className="grid grid-cols-2 gap-4">
        <Ro label="Budget amount">₹{Number(budget.amount || 0).toLocaleString()}</Ro>
        <Ro label="Control type">{budget.controlType}</Ro>
      </div>
      <Ro label="Validity">{budget.validity}</Ro>
      <Ro label="Active">{budget.isActive ? 'Yes' : 'No'}</Ro>
    </ModalShell>
  );
}
