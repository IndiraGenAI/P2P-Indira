
import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import { 
  Invoice, MasterRecord, MasterType, 
  Frequency, Attachment, ItemLine,
  User, WorkflowRule, Budget, BudgetControlType, ModuleType, ApprovalType, WorkflowV2Rule
} from '../types';
import { CENTERS } from '../constants';
import { getDepartments, getSubdepartmentsForDepartment, getItemTypesFromMasters } from '../utils/mastersHelpers';
import { getBudgetForDocumentAndCoaCode } from '../utils/budgetHelpers';
import { filterByWorkflowApproval } from '../utils/workflowV2Filters';
import {
  inCreatedAtRange,
  matchesStatusQuickFilter,
  matchesVendorFilter,
  textIncludes,
} from '../utils/transactionListFilters';
import MultiSelect from './MultiSelect';
import TransactionListFilterBar, { ListStatusQuick } from './TransactionListFilterBar';
import DocumentAuditLogModal from './DocumentAuditLogModal';

interface DirectInvoiceModuleProps {
  masters: Record<MasterType, MasterRecord[]>;
  currentUser: User;
  workflows: WorkflowRule[];
  budgets: Budget[];
  setBudgets: React.Dispatch<React.SetStateAction<Budget[]>>;
  directInvoices: Invoice[];
  setDirectInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  workflowV2Rules?: WorkflowV2Rule[];
}

const DirectInvoiceModule: React.FC<DirectInvoiceModuleProps> = ({ masters, currentUser, workflows, budgets, setBudgets, directInvoices, setDirectInvoices, workflowV2Rules = [] }) => {
  const vendorsForDropdown = filterByWorkflowApproval(workflowV2Rules, 'Vendor', masters.Vendor ?? []) as MasterRecord[];
  const itemsForDropdown = filterByWorkflowApproval(workflowV2Rules, 'Item', masters.Item ?? []) as MasterRecord[];
  const budgetsForDeduction = filterByWorkflowApproval<Budget>(workflowV2Rules, 'Budget', budgets);
  const [showForm, setShowForm] = useState(false);

  const [listStatusQuick, setListStatusQuick] = useState<ListStatusQuick>('pending');
  const [listDateFrom, setListDateFrom] = useState('');
  const [listDateTo, setListDateTo] = useState('');
  const [listVendorId, setListVendorId] = useState('');
  const [colInvId, setColInvId] = useState('');
  const [colInvVendor, setColInvVendor] = useState('');
  const [colInvDate, setColInvDate] = useState('');
  const [colInvAmt, setColInvAmt] = useState('');
  const [colInvStatus, setColInvStatus] = useState('');
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [selectedAuditDoc, setSelectedAuditDoc] = useState<Invoice | null>(null);

  const addAuditEntry = (doc: Invoice, action: string) => ({
    ...(doc as any),
    workflowStepHistory: [
      ...((doc as any).workflowStepHistory || []),
      { action, userId: currentUser.id, at: new Date().toISOString(), stepIndex: doc.currentStepIndex }
    ]
  });

  const diApprovedCount = useMemo(
    () => directInvoices.filter((i) => i.status === 'Approved').length,
    [directInvoices]
  );
  const diPendingCount = useMemo(
    () => directInvoices.filter((i) => i.status === 'Pending').length,
    [directInvoices]
  );
  const diRejectedCount = useMemo(
    () => directInvoices.filter((i) => i.status === 'Rejected').length,
    [directInvoices]
  );

  const vendorOptionsForList = useMemo(
    () => vendorsForDropdown.map((v) => ({ id: v.id, name: v.name })),
    [vendorsForDropdown]
  );

  const filteredDirectInvoices = useMemo(() => {
    return directInvoices.filter((inv) => {
      const vendorId = (inv as { vendorId?: string }).vendorId;
      if (!inCreatedAtRange(inv.createdAt, listDateFrom, listDateTo)) return false;
      if (!matchesVendorFilter(vendorId, listVendorId)) return false;
      if (!matchesStatusQuickFilter(inv.status, listStatusQuick)) return false;
      const vendorName = (masters.Vendor ?? []).find((v) => v.id === vendorId)?.name || '';
      if (!textIncludes(inv.id, colInvId)) return false;
      if (!textIncludes(vendorName, colInvVendor)) return false;
      if (!textIncludes(new Date(inv.createdAt).toLocaleDateString(), colInvDate)) return false;
      if (!textIncludes(String(inv.amount), colInvAmt)) return false;
      if (!textIncludes(inv.status, colInvStatus)) return false;
      return true;
    });
  }, [
    directInvoices,
    masters,
    listDateFrom,
    listDateTo,
    listVendorId,
    listStatusQuick,
    colInvId,
    colInvVendor,
    colInvDate,
    colInvAmt,
    colInvStatus,
  ]);
  
  // Form states
  const [invoiceForm, setInvoiceForm] = useState<any>({
    entityName: masters.Entity?.[0]?.name || '',
    vendorId: '',
    vendorSiteId: '',
    transactionType: getItemTypesFromMasters(masters)[0]?.name ?? '',
    invoiceDate: new Date().toISOString().split('T')[0],
    invoiceNumber: '',
    department: '',
    subDepartment: '',
    centerNames: [],
    items: [{ id: Math.random().toString(), itemName: '', desc: '', quantity: 1, rate: 0, amount: 0, tds: 0, gst: 0, remarks: '', coaCode: '' }],
    tds: 0,
    gst: 0,
    amount: 0,
    remarks: '',
    overallSummary: '',
    attachments: [],
    shippingAddressId: '',
    billingAddressId: '',
    isUnbudgeted: false,
    unbudgetedJustification: ''
  });

  // Update total amount whenever items change
  useEffect(() => {
    const total = (invoiceForm.items || []).reduce((sum: number, item: any) => sum + (item.totalAmount || 0), 0);
    setInvoiceForm((prev: any) => ({ ...prev, amount: total }));
  }, [invoiceForm.items]);

  const addItem = () => {
    setInvoiceForm((prev: any) => ({
      ...prev,
      items: [...(prev.items || []), { id: Math.random().toString(), itemName: '', desc: '', quantity: 1, rate: 0, amount: 0, tds: 0, gst: 0, remarks: '', coaCode: '' }]
    }));
  };

  const removeItem = (id: string) => {
    setInvoiceForm((prev: any) => ({
      ...prev,
      items: (prev.items || []).filter((i: any) => i.id !== id)
    }));
  };

  const updateItem = (id: string, field: keyof ItemLine, value: any) => {
    setInvoiceForm((prev: any) => {
      const vendor = (masters.Vendor ?? []).find((v: any) => v.id === prev.vendorId);
      const center = (masters.Center ?? []).find((c: any) => c.name === prev.centerNames?.[0]);
      const isIntraState = vendor && center && (vendor as any).state === (center as any).state;

      return {
        ...prev,
        items: (prev.items || []).map((item: any) => {
          if (item.id !== id) return item;
          const updated = { ...item, [field]: value };
          if (field === 'itemName') {
            const itemMaster = (masters.Item ?? []).find((i: any) => i.name === value);
            const coa = (masters.COA ?? []).find((c: any) => c.id === itemMaster?.coaId);
            updated.coaCode = (coa?.code ?? itemMaster?.coaCode ?? '') || '';
          }
          if (field === 'itemName' || field === 'desc' || field === 'remarks' || field === 'coaCode') return updated;
          const qty = Number(updated.quantity) || 0;
          const rate = Number(updated.rate) || 0;
          const baseAmount = qty * rate;
          const tdsPercent = Number(updated.tds) || 0;
          const gstPercent = Number(updated.gst) || 0;
          const tdsAmount = baseAmount * (tdsPercent / 100);
          const gstAmount = baseAmount * (gstPercent / 100);
          updated.amount = baseAmount;
          updated.tdsAmount = tdsAmount;
          updated.gstAmount = gstAmount;
          if (isIntraState) {
            updated.cgst = gstAmount / 2;
            updated.sgst = gstAmount / 2;
            updated.igst = 0;
          } else {
            updated.cgst = 0;
            updated.sgst = 0;
            updated.igst = gstAmount;
          }
          updated.totalAmount = baseAmount + gstAmount - tdsAmount;
          return updated;
        })
      };
    });
  };

  const downloadTemplate = () => {
    const headers = 'Item Name,Desc,Qty,Rate,Remarks';
    const blob = new Blob([headers], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', `Direct_Invoice_Template.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleBulkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
        complete: (results) => {
        const data = results.data as any[];
        const newItems: ItemLine[] = data.map((row: any) => {
          const itemName = row['Item Name'] || row['itemName'] || '';
          const desc = row['Desc'] || row['desc'] || row['Description'] || row['description'] || '';
          const qty = parseFloat(row['Qty'] || row['quantity'] || '0');
          const rate = parseFloat(row['Rate'] || row['rate'] || '0');
          const itemMaster = (masters.Item ?? []).find((i: any) => i.name === itemName);
          const coa = (masters.COA ?? []).find((c: any) => c.id === itemMaster?.coaId);
          const coaCode = (coa?.code ?? itemMaster?.coaCode ?? '') || '';

          const base = qty * rate;
          const tdsPercent = invoiceForm.tds || 0;
          const gstPercent = invoiceForm.gst || 0;
          const tdsAmount = base * (tdsPercent / 100);
          const gstAmount = base * (gstPercent / 100);

          return {
            id: Math.random().toString(),
            itemName,
            desc,
            quantity: qty,
            rate,
            amount: base,
            tds: tdsPercent,
            gst: gstPercent,
            tdsAmount,
            gstAmount,
            totalAmount: base + gstAmount - tdsAmount,
            remarks: row['Remarks'] || row['remarks'] || '',
            coaCode
          };
        });

        setInvoiceForm((prev: any) => ({ ...prev, items: newItems }));
        alert(`Bulk upload processed: ${newItems.length} items found.`);
      },
      error: (error) => {
        alert(`Error parsing CSV: ${error.message}`);
      }
    });

    e.target.value = '';
  };

  const handleCreateInvoice = () => {
    // Validation
    if (!invoiceForm.vendorId || !invoiceForm.invoiceNumber || !invoiceForm.department || !invoiceForm.subDepartment || (invoiceForm.centerNames || []).length === 0) {
      alert('Please fill all mandatory header fields.');
      return;
    }
    if ((invoiceForm.items || []).some((i: any) => !i.itemName || !i.remarks)) {
      alert('Item Name and Remarks are mandatory for all item lines.');
      return;
    }

    if (invoiceForm.isUnbudgeted && !invoiceForm.unbudgetedJustification) {
      alert('Justification is mandatory for unbudgeted expenses.');
      return;
    }

    const budgetCheck = checkBudget(invoiceForm);
    if (!budgetCheck.ok) {
      alert(budgetCheck.errors?.join('\n'));
      return;
    }

    const newInvoice: any = {
      ...invoiceForm,
      id: `DINV-${Math.floor(Math.random() * 10000)}`,
      status: budgetCheck.ok ? 'Pending' : 'Budget Hold',
      currentStepIndex: 0,
      createdAt: new Date().toISOString(),
      workflowStepHistory: [{ action: 'submit', userId: currentUser.id, at: new Date().toISOString(), stepIndex: 0 }],
    };
    setDirectInvoices([...directInvoices, newInvoice]);
    setShowForm(false);
    resetForm();
  };

  const checkBudget = (inv: any) => {
    if (inv.isUnbudgeted) return { ok: true };

    const errors: string[] = [];
    inv.items?.forEach((item: any) => {
      if (!item.coaCode) return;
      const budget = getBudgetForDocumentAndCoaCode(budgetsForDeduction, item.coaCode, inv);
      if (!budget) {
        errors.push(`No budget found for GL Code ${item.coaCode}`);
        return;
      }
      const available = Number(budget.amount) - Number(budget.consumedAmount);
      const itemAmount = Number(item.totalAmount) || Number(item.amount) || 0;
      if (itemAmount > available && budget.controlType === BudgetControlType.HARD_STOP) {
        errors.push(`Budget exceeded for GL ${item.coaCode} - Available: ₹${available.toLocaleString()} | Required: ₹${itemAmount.toLocaleString()}`);
      }
    });

    return { ok: errors.length === 0, errors };
  };

  const deductBudget = (inv: Invoice) => {
    if ((inv as any).isUnbudgeted) return;

    setBudgets(prev => prev.map(budget => {
      const chosen = getBudgetForDocumentAndCoaCode(prev, budget.coaCode, inv);
      if (chosen?.id !== budget.id) return budget;
      const invItemsForGL = inv.items?.filter(i => i.coaCode === budget.coaCode) ?? [];
      if (invItemsForGL.length > 0) {
        const totalForGL = invItemsForGL.reduce((sum, i) => sum + (Number(i.totalAmount) || Number(i.amount) || 0), 0);
        const newConsumed = Math.max(0, Number(budget.consumedAmount) + totalForGL);
        return { ...budget, consumedAmount: newConsumed };
      }
      return budget;
    }));
  };

  const resetForm = () => {
    setInvoiceForm({
      entityName: masters.Entity?.[0]?.name || '',
      vendorId: '',
      vendorSiteId: '',
      transactionType: getItemTypesFromMasters(masters)[0]?.name ?? '',
      invoiceDate: new Date().toISOString().split('T')[0],
      invoiceNumber: '',
      department: '',
      subDepartment: '',
      centerNames: [],
      items: [{ id: Math.random().toString(), itemName: '', desc: '', quantity: 1, rate: 0, amount: 0, tds: 0, gst: 0, remarks: '', coaCode: '' }],
      tds: 0,
      gst: 0,
      amount: 0,
      remarks: '',
      overallSummary: '',
      attachments: [],
      shippingAddressId: '',
      billingAddressId: '',
      isUnbudgeted: false,
      unbudgetedJustification: ''
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const newAttachment: Attachment = {
      id: `att-${Math.random()}`,
      name: file.name,
      url: URL.createObjectURL(file),
      uploadedAt: new Date().toISOString(),
      source: 'Invoice'
    };

    setInvoiceForm((prev: any) => ({ ...prev, attachments: [...(prev.attachments || []), newAttachment] }));
    e.target.value = '';
  };

  const canApprove = (doc: Invoice) => {
    if (doc.status !== 'Pending') return false;
    
    const rule = workflows.find(w => 
      w.entityName === doc.entityName &&
      w.moduleType === ModuleType.DIRECT_INVOICE &&
      w.subDepartment === doc.subDepartment &&
      (!w.centerName || (doc as any).centerNames?.includes(w.centerName) || doc.location === w.centerName) &&
      Number(doc.amount) >= Number(w.minAmount) && 
      (w.maxAmount == null || Number(doc.amount) <= Number(w.maxAmount))
    );

    if (!rule) {
      const anyRuleForModule = workflows.some(w => w.moduleType === ModuleType.DIRECT_INVOICE);
      return !anyRuleForModule;
    }
    if (rule.approvalChain.length === 0) return true;

    const currentStep = rule.approvalChain[doc.currentStepIndex];
    if (!currentStep) return false;

    return currentStep.type === ApprovalType.APPROVER && currentStep.userIds.includes(currentUser.id);
  };

  const canCompleteReview = (doc: Invoice) => {
    if (doc.status !== 'Pending') return false;
    const rule = workflows.find(w =>
      w.entityName === doc.entityName &&
      w.moduleType === ModuleType.DIRECT_INVOICE &&
      w.subDepartment === doc.subDepartment &&
      (!w.centerName || (doc as any).centerNames?.includes(w.centerName) || doc.location === w.centerName) &&
      Number(doc.amount) >= Number(w.minAmount) &&
      (w.maxAmount == null || Number(doc.amount) <= Number(w.maxAmount))
    );
    if (!rule) return false;
    const currentStep = rule.approvalChain[doc.currentStepIndex];
    if (!currentStep) return false;
    return currentStep.type === ApprovalType.REVIEWER && currentStep.userIds.includes(currentUser.id);
  };

  const completeReviewInvoice = (id: string) => {
    setDirectInvoices(directInvoices.map(inv => {
      if (inv.id !== id) return inv;
      const rule = workflows.find(w =>
        w.entityName === inv.entityName &&
        w.moduleType === ModuleType.DIRECT_INVOICE &&
        w.subDepartment === inv.subDepartment &&
        (!w.centerName || (inv as any).centerNames?.includes(w.centerName) || inv.location === w.centerName) &&
        Number(inv.amount) >= Number(w.minAmount) &&
        (w.maxAmount == null || Number(inv.amount) <= Number(w.maxAmount))
      );
      if (!rule || inv.currentStepIndex >= rule.approvalChain.length - 1) return inv;
      return addAuditEntry({ ...inv, currentStepIndex: inv.currentStepIndex + 1 }, 'completeReview');
    }));
  };

  const approveInvoice = (id: string) => {
    setDirectInvoices(directInvoices.map(inv => {
      if (inv.id !== id) return inv;

      const rule = workflows.find(w => 
        w.entityName === inv.entityName &&
        w.moduleType === ModuleType.DIRECT_INVOICE &&
        w.subDepartment === inv.subDepartment &&
        (!w.centerName || (inv as any).centerNames?.includes(w.centerName) || inv.location === w.centerName) &&
        Number(inv.amount) >= Number(w.minAmount) && 
        (w.maxAmount == null || Number(inv.amount) <= Number(w.maxAmount))
      );

      if (!rule || inv.currentStepIndex >= rule.approvalChain.length - 1) {
        // Final budget check before approval
        const budgetCheck = checkBudget(inv);
        if (!budgetCheck.ok) {
          alert(`Cannot approve Invoice: ${budgetCheck.errors?.join('\n')}`);
          return addAuditEntry({ ...inv, status: 'Budget Hold' }, 'approve');
        }
        deductBudget(inv);
        return addAuditEntry({ ...inv, status: 'Approved' }, 'approve');
      }

      return addAuditEntry({ ...inv, currentStepIndex: inv.currentStepIndex + 1 }, 'approve');
    }));
  };

  const reverseInvoice = (id: string) => {
    setDirectInvoices(directInvoices.map(inv => inv.id === id ? { ...inv, status: 'Reversed' } : inv));
    alert('Direct Invoice reversed. You can now recreate it.');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h2 className="text-xl font-black text-slate-800">Direct Invoice Management</h2>
        {!showForm && (
          <div className="flex flex-wrap items-center gap-2 justify-end">
            <TransactionListFilterBar
              approvedCount={diApprovedCount}
              pendingCount={diPendingCount}
              rejectedCount={diRejectedCount}
              statusQuick={listStatusQuick}
              onStatusQuick={setListStatusQuick}
              dateFrom={listDateFrom}
              dateTo={listDateTo}
              onDateFrom={setListDateFrom}
              onDateTo={setListDateTo}
              vendorId={listVendorId}
              onVendorId={setListVendorId}
              vendors={vendorOptionsForList}
            />
            <button
              onClick={() => setShowForm(true)}
              className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-black shadow-lg shadow-indigo-200 hover:scale-105 transition-transform shrink-0"
            >
              + Create Direct Invoice
            </button>
          </div>
        )}
      </div>

      {showForm ? (
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-black text-slate-900">New Direct Invoice</h3>
            <button onClick={() => { setShowForm(false); resetForm(); }} className="text-slate-400 hover:text-slate-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Entity</label>
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={invoiceForm.entityName}
                onChange={e => setInvoiceForm({ ...invoiceForm, entityName: e.target.value })}
              >
                {(masters.Entity ?? []).map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Vendor</label>
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={invoiceForm.vendorId}
                onChange={e => setInvoiceForm({ ...invoiceForm, vendorId: e.target.value, vendorSiteId: '' })}
              >
                <option value="">Select Vendor</option>
                {vendorsForDropdown.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Vendor Site</label>
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={invoiceForm.vendorSiteId}
                onChange={e => setInvoiceForm({ ...invoiceForm, vendorSiteId: e.target.value })}
                disabled={!invoiceForm.vendorId}
              >
                <option value="">Select Vendor Site</option>
                {(masters['Vendor Site'] ?? []).filter(s => s.vendorId === invoiceForm.vendorId).map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Shipping Address</label>
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={invoiceForm.shippingAddressId}
                onChange={e => setInvoiceForm({ ...invoiceForm, shippingAddressId: e.target.value })}
              >
                <option value="">Select Shipping Address</option>
                {(masters.Entity ?? []).flatMap(ent => ent.shippingAddresses || []).map((addr: any) => (
                  <option key={addr.id} value={addr.id}>{addr.address}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Billing Address</label>
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={invoiceForm.billingAddressId}
                onChange={e => setInvoiceForm({ ...invoiceForm, billingAddressId: e.target.value })}
              >
                <option value="">Select Billing Address</option>
                {(masters.Entity ?? []).flatMap(ent => ent.billingAddresses || []).map((addr: any) => (
                  <option key={addr.id} value={addr.id}>{addr.address}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Invoice Number</label>
              <input 
                type="text" 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={invoiceForm.invoiceNumber}
                onChange={e => setInvoiceForm({ ...invoiceForm, invoiceNumber: e.target.value })}
                placeholder="INV/2024/001"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Invoice Date</label>
              <input 
                type="date" 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={invoiceForm.invoiceDate}
                onChange={e => setInvoiceForm({ ...invoiceForm, invoiceDate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Item type</label>
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={invoiceForm.transactionType}
                onChange={e => setInvoiceForm({ ...invoiceForm, transactionType: e.target.value })}
              >
                <option value="">Select Item type...</option>
                {getItemTypesFromMasters(masters).map(r => (
                  <option key={r.id} value={r.name}>{r.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Department</label>
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={invoiceForm.department}
                onChange={e => setInvoiceForm({ ...invoiceForm, department: e.target.value, subDepartment: '' })}
              >
                <option value="">Select Department</option>
                {getDepartments(masters).map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Sub-Department</label>
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={invoiceForm.subDepartment}
                onChange={e => setInvoiceForm({ ...invoiceForm, subDepartment: e.target.value })}
              >
                <option value="">Select Sub-Department</option>
                {getSubdepartmentsForDepartment(masters, invoiceForm.department).map(sd => <option key={sd.id} value={sd.name}>{sd.name}</option>)}
              </select>
            </div>
            <div className="space-y-4 col-span-2 bg-amber-50 p-6 rounded-3xl border border-amber-100">
              <div className="flex items-center space-x-3">
                <input 
                  type="checkbox" 
                  id="isUnbudgeted"
                  className="w-5 h-5 text-amber-600 border-amber-300 rounded focus:ring-amber-500"
                  checked={invoiceForm.isUnbudgeted || false}
                  onChange={e => setInvoiceForm({ ...invoiceForm, isUnbudgeted: e.target.checked })}
                />
                <label htmlFor="isUnbudgeted" className="text-sm font-black text-amber-900 uppercase tracking-wider cursor-pointer">Unbudgeted Expense</label>
              </div>
              {invoiceForm.isUnbudgeted && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                  <label className="text-xs font-black text-amber-700 uppercase tracking-wider">Justification (Mandatory)</label>
                  <textarea 
                    className="w-full bg-white border border-amber-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-amber-500 outline-none font-medium text-sm"
                    placeholder="Provide justification for emergency/unplanned spend..."
                    value={invoiceForm.unbudgetedJustification || ''}
                    onChange={e => setInvoiceForm({ ...invoiceForm, unbudgetedJustification: e.target.value })}
                  />
                </div>
              )}
            </div>
            <div className="space-y-2 md:col-span-2">
              <MultiSelect 
                label="Centers"
                options={CENTERS}
                selected={invoiceForm.centerNames || []}
                onChange={centers => setInvoiceForm({ ...invoiceForm, centerNames: centers })}
              />
            </div>

            {/* Items Section */}
            <div className="col-span-2 space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-sm font-black text-slate-700 uppercase tracking-wider">Invoice Items</h4>
                <div className="flex items-center space-x-4">
                  <button 
                    onClick={downloadTemplate}
                    className="text-indigo-600 text-xs font-black hover:underline flex items-center"
                  >
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    Download Template
                  </button>
                  <label className="cursor-pointer text-indigo-600 text-xs font-black hover:underline flex items-center">
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                    Bulk Upload
                    <input type="file" className="hidden" onChange={handleBulkUpload} />
                  </label>
                  <button onClick={addItem} className="text-indigo-600 text-xs font-black hover:underline">+ Add Item</button>
                </div>
              </div>
              <div className="space-y-4">
                {invoiceForm.items?.map((item: any) => (
                  <div key={item.id} className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-4">
                    <div className="grid grid-cols-12 gap-3 items-end">
                      <div className="col-span-2 space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Item Name</label>
                        <select 
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                          value={item.itemName}
                          onChange={e => updateItem(item.id, 'itemName', e.target.value)}
                        >
                          <option value="">Select Item</option>
                          {itemsForDropdown.filter((i: any) => !invoiceForm.items?.some((selected: any) => selected.id !== item.id && selected.itemName === i.name)).map((i: any) => <option key={i.id} value={i.name}>{i.name}</option>)}
                        </select>
                      </div>
                      <div className="col-span-2 space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Desc</label>
                        <input
                          type="text"
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                          value={item.desc ?? ''}
                          onChange={e => updateItem(item.id, 'desc', e.target.value)}
                          placeholder="Description"
                        />
                      </div>
                      <div className="col-span-1 space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Qty</label>
                        <input 
                          type="number"
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                          value={item.quantity}
                          onChange={e => updateItem(item.id, 'quantity', Number(e.target.value))}
                        />
                      </div>
                      <div className="col-span-1 space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Rate</label>
                        <input 
                          type="number"
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                          value={item.rate}
                          onChange={e => updateItem(item.id, 'rate', Number(e.target.value))}
                        />
                      </div>
                      <div className="col-span-1 space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Base Amount</label>
                        <input 
                          type="text"
                          readOnly
                          className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-sm font-black text-slate-600"
                          value={(Number(item.amount) || 0).toFixed(2)}
                        />
                      </div>
                      <div className="col-span-1 space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">GST %</label>
                        <select 
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                          value={item.gst ?? ''}
                          onChange={e => updateItem(item.id, 'gst', Number(e.target.value))}
                        >
                          <option value="">Select GST</option>
                          {(masters.GST ?? []).map((g: any) => <option key={g.id} value={g.rate}>{g.name}</option>)}
                        </select>
                      </div>
                      <div className="col-span-1 space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">GST Amount</label>
                        <div className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-sm font-black text-emerald-600">₹{(Number(item.gstAmount) || 0).toFixed(2)}</div>
                      </div>
                      <div className="col-span-1 space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">TDS Section</label>
                        <select 
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                          value={item.tds ?? ''}
                          onChange={e => updateItem(item.id, 'tds', Number(e.target.value))}
                        >
                          <option value="">Select TDS</option>
                          {(masters.TDS ?? []).map((t: any) => <option key={t.id} value={t.rate}>{t.name}</option>)}
                        </select>
                      </div>
                      <div className="col-span-1 space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">TDS amount</label>
                        <div className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-sm font-black text-red-600">₹{(Number(item.tdsAmount) || 0).toFixed(2)}</div>
                      </div>
                      <div className="col-span-1 space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Net Amount</label>
                        <div className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-sm font-black text-indigo-600">₹{(Number(item.totalAmount) || 0).toFixed(2)}</div>
                      </div>
                      <div className="col-span-1 space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Remarks <span className="text-red-500">*</span></label>
                        <input 
                          type="text"
                          placeholder="Remarks"
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                          value={item.remarks}
                          onChange={e => updateItem(item.id, 'remarks', e.target.value)}
                        />
                      </div>
                      <div className="col-span-1 flex justify-center pb-1">
                        {invoiceForm.items.length > 1 && (
                          <button onClick={() => removeItem(item.id)} className="text-red-400 hover:text-red-600 transition-colors p-2 hover:bg-red-50 rounded-xl" title="Remove item">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Summary Section */}
              <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200 mt-6 space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Base Amount</label>
                    <div className="text-sm font-bold text-slate-700">₹{(invoiceForm.items || []).reduce((sum: number, i: any) => sum + (Number(i.amount) || 0), 0).toFixed(2)}</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total TDS</label>
                    <div className="text-sm font-bold text-red-500">-₹{(invoiceForm.items || []).reduce((sum: number, i: any) => sum + (Number(i.tdsAmount) || 0), 0).toFixed(2)}</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total GST</label>
                    <div className="text-sm font-bold text-emerald-500">+₹{(invoiceForm.items || []).reduce((sum: number, i: any) => sum + (Number(i.gstAmount) || 0), 0).toFixed(2)}</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Net Amount</label>
                    <div className="text-lg font-black text-indigo-700">₹{(Number(invoiceForm.amount) || 0).toFixed(2)}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Remarks</label>
              <textarea 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={invoiceForm.remarks}
                onChange={e => setInvoiceForm({ ...invoiceForm, remarks: e.target.value })}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Overall summary</label>
              <textarea
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium min-h-[88px]"
                value={invoiceForm.overallSummary ?? ''}
                onChange={e => setInvoiceForm({ ...invoiceForm, overallSummary: e.target.value })}
                placeholder="Summary..."
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Attachments</label>
              <div className="flex items-center space-x-4">
                <label className="cursor-pointer bg-white border-2 border-dashed border-slate-200 rounded-xl px-6 py-4 flex-1 flex flex-col items-center justify-center hover:border-indigo-300 transition-colors">
                  <svg className="w-8 h-8 text-slate-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                  <span className="text-xs font-bold text-slate-400">Click to upload invoice copy</span>
                  <input type="file" className="hidden" onChange={handleFileUpload} />
                </label>
                {invoiceForm.attachments?.length > 0 && (
                  <div className="flex-1 space-y-2">
                    {invoiceForm.attachments.map((att: Attachment) => (
                      <div key={att.id} className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
                        <span className="text-xs font-bold text-slate-600 truncate max-w-[150px]">{att.name}</span>
                        <button onClick={() => setInvoiceForm((prev: any) => ({ ...prev, attachments: prev.attachments.filter((a: any) => a.id !== att.id) }))} className="text-red-400 hover:text-red-600">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-8 flex justify-end space-x-4">
            <button onClick={() => { setShowForm(false); resetForm(); }} className="px-6 py-3 rounded-xl font-black text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
            <button 
              onClick={handleCreateInvoice}
              className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-indigo-200 hover:scale-105 transition-transform"
            >
              Submit Invoice
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden">
          <div
            className="grid w-full gap-0 border-b border-slate-100 bg-slate-50/80"
            style={{
              gridTemplateColumns: 'minmax(0, 12%) minmax(0, 22%) minmax(0, 12%) minmax(0, 12%) minmax(0, 14%) minmax(0, 28%)',
            }}
            role="search"
            aria-label="Column filters"
          >
            <div className="px-6 py-2 min-w-0">
              <input
                type="text"
                placeholder="Filter…"
                value={colInvId}
                onChange={(e) => setColInvId(e.target.value)}
                className="w-full min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium"
              />
            </div>
            <div className="px-6 py-2 min-w-0">
              <input
                type="text"
                placeholder="Filter…"
                value={colInvVendor}
                onChange={(e) => setColInvVendor(e.target.value)}
                className="w-full min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium"
              />
            </div>
            <div className="px-6 py-2 min-w-0">
              <input
                type="text"
                placeholder="Filter…"
                value={colInvDate}
                onChange={(e) => setColInvDate(e.target.value)}
                className="w-full min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium"
              />
            </div>
            <div className="px-6 py-2 min-w-0">
              <input
                type="text"
                placeholder="Filter…"
                value={colInvAmt}
                onChange={(e) => setColInvAmt(e.target.value)}
                className="w-full min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium"
              />
            </div>
            <div className="px-6 py-2 min-w-0">
              <input
                type="text"
                placeholder="Filter…"
                value={colInvStatus}
                onChange={(e) => setColInvStatus(e.target.value)}
                className="w-full min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium"
              />
            </div>
            <div className="px-6 py-2 min-w-0" aria-hidden="true" />
          </div>

          <table className="w-full table-fixed text-left border-collapse">
            <colgroup>
              <col style={{ width: '12%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '28%' }} />
            </colgroup>
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Invoice ID</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Vendor</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Amount</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {directInvoices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400 font-medium italic">No direct invoices found. Create one to get started.</td>
                </tr>
              ) : filteredDirectInvoices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500 text-sm font-bold">
                    No direct invoices match your filters.
                  </td>
                </tr>
              ) : (
                filteredDirectInvoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 font-black text-slate-700">{inv.id}</td>
                    <td className="px-6 py-4 font-bold text-slate-600">{(masters.Vendor ?? []).find(v => v.id === (inv as any).vendorId)?.name || 'Unknown'}</td>
                    <td className="px-6 py-4 text-slate-500 font-medium">{new Date(inv.createdAt).toLocaleDateString()}</td>
                    <td className="px-6 py-4 font-black text-indigo-600">₹{(Number(inv.amount) || 0).toFixed(2)}</td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col space-y-1">
                        <button
                          onClick={() => { setSelectedAuditDoc(inv); setShowAuditModal(true); }}
                          className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider w-fit ${
                            inv.status === 'Approved' ? 'bg-emerald-100 text-emerald-600' : 
                            inv.status === 'Budget Hold' ? 'bg-rose-100 text-rose-700' :
                            'bg-amber-100 text-amber-600'
                          }`}
                          title="View audit log"
                        >
                          {inv.status}
                        </button>
                        {inv.status === 'Pending' && (
                          <div className="text-[10px] font-bold text-slate-400">
                            Step {inv.currentStepIndex + 1}
                          </div>
                        )}
                        {(inv as any).isUnbudgeted && (
                          <span className="px-2 py-0.5 bg-amber-50 text-amber-600 text-[8px] font-black uppercase border border-amber-200 rounded w-fit">
                            Unbudgeted
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col space-y-2">
                        <div className="flex space-x-2">
                          {canCompleteReview(inv) && (
                            <button 
                              onClick={() => completeReviewInvoice(inv.id)}
                              className="text-amber-600 text-xs font-black hover:underline"
                            >
                              Complete Review
                            </button>
                          )}
                          {canApprove(inv) && (
                            <button 
                              onClick={() => approveInvoice(inv.id)}
                              className="text-indigo-600 text-xs font-black hover:underline"
                            >
                              Approve
                            </button>
                          )}
                          {inv.status === 'Approved' && (
                            <button 
                              onClick={() => reverseInvoice(inv.id)}
                              className="text-rose-600 text-xs font-black hover:underline"
                            >
                              Reverse
                            </button>
                          )}
                        </div>

                        {/* Budget Visibility during Approval */}
                        {inv.status === 'Pending' && !(inv as any).isUnbudgeted && (
                          <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 space-y-1 mt-1">
                            <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Budget Check</div>
                            {inv.items.map((item, idx) => {
                              const budget = getBudgetForDocumentAndCoaCode(budgetsForDeduction, item.coaCode, inv);
                              if (!budget) return null;
                              const balance = Number(budget.amount) - Number(budget.consumedAmount);
                              const itemAmount = Number(item.totalAmount) || Number(item.amount) || 0;
                              const isExceeded = itemAmount > balance;
                              return (
                                <div key={idx} className="flex justify-between items-center text-[9px]">
                                  <span className="font-bold text-slate-600">{item.coaCode}:</span>
                                  <span className={`font-black ${isExceeded ? 'text-rose-500' : 'text-emerald-600'}`}>
                                    Bal: ₹{balance.toLocaleString()}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      <DocumentAuditLogModal
        isOpen={showAuditModal}
        onClose={() => setShowAuditModal(false)}
        title={selectedAuditDoc ? `Audit Log - ${selectedAuditDoc.id}` : 'Audit Log'}
        status={selectedAuditDoc?.status}
        history={(selectedAuditDoc as any)?.workflowStepHistory || []}
        users={[currentUser]}
      />
    </div>
  );
};

export default DirectInvoiceModule;
