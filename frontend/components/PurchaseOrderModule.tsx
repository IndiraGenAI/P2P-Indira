
import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import { 
  PurchaseOrder, GRN, Invoice, MasterRecord, MasterType, 
  Frequency, Attachment, ItemLine, PurchaseRequest,
  User, WorkflowRule, Budget, BudgetType, BudgetControlType, ModuleType, ApprovalType, WorkflowV2Rule, RateContract
} from '../types';
import { CENTERS } from '../constants';
import { getDepartments, getSubdepartmentsForDepartment, getItemTypesFromMasters } from '../utils/mastersHelpers';
import { getBudgetForDocumentAndCoaCode } from '../utils/budgetHelpers';
import { filterByWorkflowApproval } from '../utils/workflowV2Filters';
import {
  getGrnVendorId,
  getPoInvoiceVendorId,
  inCreatedAtRange,
  matchesStatusQuickFilter,
  matchesVendorFilter,
  textIncludes,
} from '../utils/transactionListFilters';
import TransactionListFilterBar, { ListStatusQuick } from './TransactionListFilterBar';
import SearchableSelect from './SearchableSelect';
import { AlertCircle, Info, ShieldCheck, ShieldAlert } from 'lucide-react';
import { apiGet } from '../api';
import DocumentAuditLogModal from './DocumentAuditLogModal';

const PO_LINE_GST_USE_HEADER = '__HEADER__' as const;

type ViewMode = 'PO' | 'GRN' | 'Invoice';

interface PurchaseOrderModuleProps {
  masters: Record<MasterType, MasterRecord[]>;
  purchaseOrders: PurchaseOrder[];
  setPurchaseOrders: React.Dispatch<React.SetStateAction<PurchaseOrder[]>>;
  grns: GRN[];
  setGrns: React.Dispatch<React.SetStateAction<GRN[]>>;
  invoices: Invoice[];
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  pendingPR: PurchaseRequest | null;
  onPOCreated: () => void;
  currentUser: User;
  workflows: WorkflowRule[];
  budgets: Budget[];
  setBudgets: React.Dispatch<React.SetStateAction<Budget[]>>;
  workflowV2Rules?: WorkflowV2Rule[];
  /** One-shot navigation from Dashboard (view + list filter); consumed after apply. */
  moduleEntryIntent?: { key: number; viewMode: ViewMode; listStatusQuick: ListStatusQuick } | null;
  onModuleEntryIntentConsumed?: () => void;
}

type PoRemainingItem = {
  itemName: string;
  itemId: string | null;
  orderedQty: number;
  receivedQty: number;
  leftQty: number;
  rate: number;
  center: string;
};

const PurchaseOrderModule: React.FC<PurchaseOrderModuleProps> = ({ 
  masters, purchaseOrders, setPurchaseOrders, grns, setGrns, invoices, setInvoices, pendingPR, onPOCreated, currentUser, workflows, budgets, setBudgets, workflowV2Rules = [],
  moduleEntryIntent = null,
  onModuleEntryIntentConsumed,
}) => {
  const getTodayISTDate = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const year = parts.find((p) => p.type === 'year')?.value ?? '';
    const month = parts.find((p) => p.type === 'month')?.value ?? '';
    const day = parts.find((p) => p.type === 'day')?.value ?? '';
    return `${year}-${month}-${day}`;
  };

  const vendorsForDropdown = filterByWorkflowApproval(workflowV2Rules, 'Vendor', masters.Vendor ?? []) as MasterRecord[];
  const itemsForDropdown = filterByWorkflowApproval(workflowV2Rules, 'Item', masters.Item ?? []) as MasterRecord[];
  const budgetsForDeduction = filterByWorkflowApproval<Budget>(workflowV2Rules, 'Budget', budgets);
  const [viewMode, setViewMode] = useState<ViewMode>('PO');
  
  const [showForm, setShowForm] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [selectedGRN, setSelectedGRN] = useState<GRN | null>(null);

  const [bulkUploadType, setBulkUploadType] = useState<'PO' | 'GRN' | 'Invoice' | null>(null);
  const [showPoGrnItemModal, setShowPoGrnItemModal] = useState(false);
  const [poForGrnSelection, setPoForGrnSelection] = useState<PurchaseOrder | null>(null);
  const [poRemainingItems, setPoRemainingItems] = useState<PoRemainingItem[]>([]);
  const [poReceiveQtyByKey, setPoReceiveQtyByKey] = useState<Record<string, number>>({});
  const [poSelectedByKey, setPoSelectedByKey] = useState<Record<string, boolean>>({});
  const [poRemainingLoading, setPoRemainingLoading] = useState(false);
  const [poRemainingError, setPoRemainingError] = useState<string | null>(null);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [selectedAuditDoc, setSelectedAuditDoc] = useState<PurchaseOrder | GRN | Invoice | null>(null);

  const [listStatusQuick, setListStatusQuick] = useState<ListStatusQuick>('pending');
  const [listDateFrom, setListDateFrom] = useState('');
  const [listDateTo, setListDateTo] = useState('');
  const [listVendorId, setListVendorId] = useState('');
  const [colPoId, setColPoId] = useState('');
  const [colPoDetails, setColPoDetails] = useState('');
  const [colPoDate, setColPoDate] = useState('');
  const [colPoStatus, setColPoStatus] = useState('');
  const [colGrnId, setColGrnId] = useState('');
  const [colGrnDetails, setColGrnDetails] = useState('');
  const [colGrnStatus, setColGrnStatus] = useState('');
  const [colInvId, setColInvId] = useState('');
  const [colInvDetails, setColInvDetails] = useState('');
  const [colInvStatus, setColInvStatus] = useState('');

  const addAuditEntry = <T extends PurchaseOrder | GRN | Invoice>(doc: T, action: string): T => ({
    ...(doc as any),
    workflowStepHistory: [
      ...((doc as any).workflowStepHistory || []),
      { action, userId: currentUser.id, at: new Date().toISOString(), stepIndex: doc.currentStepIndex }
    ]
  } as T);

  const toDate = (value?: string) => {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const addMonthsSafe = (date: Date, months: number) => {
    const d = new Date(date.getTime());
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    if (d.getDate() < day) d.setDate(0);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const formatDate = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const getPoWindowInfo = (po: PurchaseOrder) => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const vf = toDate(po.validFrom);
    const vt = toDate(po.validTo);
    if (!vf || !vt) {
      return { canCreate: true, message: 'Delivery window: no validity range configured' };
    }
    if (now < vf) {
      return { canCreate: false, message: `Contract validity starts on ${formatDate(vf)}` };
    }
    if (now > vt) {
      return { canCreate: false, message: `Contract validity expired on ${formatDate(vt)}` };
    }
    const frequency = po.frequency || 'One-Time';
    if (frequency === 'One-Time' || frequency === 'Monthly') {
      return { canCreate: true, message: `Delivery window: ${formatDate(vf)} - ${formatDate(vt)} (${frequency})` };
    }
    const step = frequency === 'Quarterly' ? 3 : 12;
    let start = new Date(vf.getTime());
    let end = addMonthsSafe(start, step);
    end.setDate(end.getDate() - 1);
    while (end < now && start < vt) {
      start = addMonthsSafe(start, step);
      end = addMonthsSafe(start, step);
      end.setDate(end.getDate() - 1);
    }
    if (end > vt) end = new Date(vt.getTime());
    const inside = now >= start && now <= end;
    if (inside) return { canCreate: true, message: `Delivery window: ${formatDate(start)} - ${formatDate(end)} (${frequency})` };
    const nextStart = addMonthsSafe(start, step);
    if (nextStart <= vt) {
      let nextEnd = addMonthsSafe(nextStart, step);
      nextEnd.setDate(nextEnd.getDate() - 1);
      if (nextEnd > vt) nextEnd = new Date(vt.getTime());
      return { canCreate: false, message: `Next delivery window: ${formatDate(nextStart)} - ${formatDate(nextEnd)}` };
    }
    return { canCreate: false, message: `Contract validity expired on ${formatDate(vt)}` };
  };

  useEffect(() => {
    setListStatusQuick('pending');
    setListDateFrom('');
    setListDateTo('');
    setListVendorId('');
    setColPoId('');
    setColPoDetails('');
    setColPoDate('');
    setColPoStatus('');
    setColGrnId('');
    setColGrnDetails('');
    setColGrnStatus('');
    setColInvId('');
    setColInvDetails('');
    setColInvStatus('');
  }, [viewMode]);

  useEffect(() => {
    if (!moduleEntryIntent) return;
    setViewMode(moduleEntryIntent.viewMode);
    setListStatusQuick(moduleEntryIntent.listStatusQuick);
    onModuleEntryIntentConsumed?.();
  }, [moduleEntryIntent?.key]);

  // Form states
  const [poForm, setPoForm] = useState<Partial<PurchaseOrder>>({
    entityName: masters.Entity?.[0]?.name || '',
    vendorId: '',
    vendorSiteId: '',
    transactionType: getItemTypesFromMasters(masters)[0]?.name ?? '',
    validFrom: getTodayISTDate(),
    validTo: '',
    frequency: 'One-Time',
    department: '',
    subDepartment: '',
    paymentTerms: '',
    centerNames: [],
    items: [{ id: Math.random().toString(), itemName: '', desc: '', quantity: 1, rate: 0, amount: 0, remarks: '', centerName: '' }],
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

  // Handle pending PR
  useEffect(() => {
    if (pendingPR) {
      setShowForm(true);
      setPoForm({
        entityName: pendingPR.entityName,
        vendorId: pendingPR.vendorId || '',
        vendorSiteId: pendingPR.vendorSiteId || '',
        transactionType: pendingPR.transactionType || (getItemTypesFromMasters(masters)[0]?.name ?? ''),
        validFrom: pendingPR.validFrom || getTodayISTDate(),
        validTo: pendingPR.validTo || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        frequency: pendingPR.frequency || 'One-Time',
        department: pendingPR.department,
        subDepartment: pendingPR.subDepartment,
        paymentTerms: pendingPR.paymentTerms || '',
        centerNames: pendingPR.centerNames,
        items: pendingPR.items.map(item => ({
          ...item,
          id: Math.random().toString(), // New IDs for PO items
          centerName: item.centerName || pendingPR.centerNames?.[0] || '',
        })),
        remarks: pendingPR.remarks ?? '',
        overallSummary: pendingPR.overallSummary ?? '',
        amount: pendingPR.amount,
        attachments: pendingPR.attachments.map(att => ({ ...att, source: 'PO' })),
        tds: 0,
        gst: 0,
        shippingAddressId: pendingPR.shippingAddressId || '',
        billingAddressId: pendingPR.billingAddressId || '',
        isUnbudgeted: pendingPR.isUnbudgeted,
        unbudgetedJustification: pendingPR.unbudgetedJustification
      });
    }
  }, [pendingPR]);

  const [grnForm, setGrnForm] = useState<Partial<GRN>>({
    entityName: masters.Entity?.[0]?.name || '',
    vendorSiteId: '',
    location: '',
    invoiceNumber: '',
    invoiceDate: '',
    department: '',
    subDepartment: '',
    tds: 0,
    gst: 0,
    items: [],
    amount: 0,
    remarks: '',
    overallSummary: '',
    attachments: [],
    shippingAddressId: '',
    billingAddressId: ''
  });

  // Recalculate GRN items when form-level TDS or GST changes (preserve per-line GST)
  useEffect(() => {
    if (grnForm.id || !selectedPO || selectedGRN || !grnForm.items?.length) return;
    const vendor = (masters.Vendor ?? []).find((v: any) => v.id === selectedPO.vendorId);
    const center = (masters.Center ?? []).find((c: any) => c.name === grnForm.location);
    const isIntraState = vendor && center && (vendor as any).state === (center as any).state;
    const tdsPercent = grnForm.tds ?? 0;

    setGrnForm(prev => {
      const updatedItems = (prev.items || []).map((item: ItemLine) => {
        const qty = Number(item.quantity) || 0;
        const rate = Number(item.rate) || 0;
        const base = qty * rate;
        const gstPercent = item.gst ?? prev.gst ?? 0;
        const tdsAmount = base * (tdsPercent / 100);
        const gstAmount = base * (gstPercent / 100);
        const totalAmount = base + gstAmount - tdsAmount;
        const updated: ItemLine = {
          ...item,
          amount: base,
          tds: tdsPercent,
          gst: gstPercent,
          tdsAmount,
          gstAmount,
          totalAmount
        };
        if (isIntraState) {
          updated.cgst = gstAmount / 2;
          updated.sgst = gstAmount / 2;
          updated.igst = 0;
        } else {
          updated.cgst = 0;
          updated.sgst = 0;
          updated.igst = gstAmount;
        }
        return updated;
      });
      const amount = updatedItems.reduce((sum, i) => sum + (Number(i.totalAmount) || 0), 0);
      return { ...prev, items: updatedItems, amount };
    });
  }, [grnForm.tds, grnForm.gst, grnForm.location, selectedPO?.id, selectedGRN]);

  /** Per-line centre names only — avoids re-running PO tax recalc on every qty/rate edit */
  const poLineCentersSignature = useMemo(
    () => (poForm.items || []).map((i) => `${i.id}:${i.centerName ?? ''}`).join('|'),
    [poForm.items]
  );

  const updateGrnItem = (itemId: string, field: 'quantity' | 'remarks' | 'gst' | 'desc', value: number | string) => {
    if (!selectedPO) return;
    const vendor = (masters.Vendor ?? []).find((v: any) => v.id === selectedPO.vendorId);
    const center = (masters.Center ?? []).find((c: any) => c.name === grnForm.location);
    const isIntraState = vendor && center && (vendor as any).state === (center as any).state;
    const tdsPercent = grnForm.tds ?? 0;

    setGrnForm(prev => {
      const items = (prev.items || []).map(i => {
        if (i.id !== itemId) return i;
        if (field === 'quantity') {
          const qty = Number(value) || 0;
          const rate = Number(i.rate) || 0;
          const base = qty * rate;
          const gstPercent = i.gst ?? prev.gst ?? 0;
          const tdsAmount = base * (tdsPercent / 100);
          const gstAmount = base * (gstPercent / 100);
          const totalAmount = base + gstAmount - tdsAmount;
          const updated: ItemLine = { ...i, quantity: qty, amount: base, tds: tdsPercent, gst: gstPercent, tdsAmount, gstAmount, totalAmount };
          if (isIntraState) {
            updated.cgst = gstAmount / 2;
            updated.sgst = gstAmount / 2;
            updated.igst = 0;
          } else {
            updated.cgst = 0;
            updated.sgst = 0;
            updated.igst = gstAmount;
          }
          return updated;
        }
        if (field === 'gst') {
          const gstPercent = Number(value) || 0;
          const base = Number(i.amount) || (Number(i.quantity) || 0) * (Number(i.rate) || 0);
          const tdsAmount = base * (tdsPercent / 100);
          const gstAmount = base * (gstPercent / 100);
          const totalAmount = base + gstAmount - tdsAmount;
          const updated: ItemLine = { ...i, gst: gstPercent, amount: base, tds: tdsPercent, tdsAmount, gstAmount, totalAmount };
          if (isIntraState) {
            updated.cgst = gstAmount / 2;
            updated.sgst = gstAmount / 2;
            updated.igst = 0;
          } else {
            updated.cgst = 0;
            updated.sgst = 0;
            updated.igst = gstAmount;
          }
          return updated;
        }
        return { ...i, [field]: String(value ?? '') };
      });
      const amount = items.reduce((sum, i) => sum + (Number(i.totalAmount) || 0), 0);
      return { ...prev, items, amount };
    });
  };

  // Recalculate all items when GST changes. PO lines have no TDS (always 0). Line `gst` undefined = follow header; explicit line gst preserved. CGST/SGST/IGST use each line's centre.
  useEffect(() => {
    setPoForm(prev => {
      const vendor = (masters.Vendor ?? []).find(v => v.id === prev.vendorId);
      const tdsPercent = 0;
      const headerGst = Number(prev.gst) || 0;

      const updatedItems = (prev.items || []).map(item => {
        const centerRow = (masters.Center ?? []).find((c: any) => c.name === item.centerName);
        const isIntraState = !!(vendor && centerRow && (vendor as any).state === (centerRow as any).state);
        const qty = item.quantity || 0;
        const rate = item.rate || 0;
        const baseAmount = qty * rate;
        const tdsAmount = 0;
        const gstPercent =
          item.gst !== undefined && item.gst !== null ? Number(item.gst) : headerGst;
        const gstAmount = baseAmount * (gstPercent / 100);

        const updated: ItemLine = {
          ...item,
          amount: baseAmount,
          tds: tdsPercent,
          tdsAmount,
          gstAmount,
        };
        if (item.gst !== undefined && item.gst !== null) {
          updated.gst = item.gst;
        } else {
          delete (updated as any).gst;
        }

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
      });

      return { ...prev, items: updatedItems };
    });
  }, [poForm.gst, poForm.vendorId, poLineCentersSignature, masters]);

  const addItem = () => {
    setPoForm(prev => ({
      ...prev,
      items: [
        ...(prev.items || []),
        { id: Math.random().toString(), itemName: '', desc: '', quantity: 1, rate: 0, amount: 0, remarks: '', coaCode: '', centerName: '' },
      ],
    }));
  };

  const removeItem = (id: string) => {
    setPoForm(prev => ({
      ...prev,
      items: (prev.items || []).filter(i => i.id !== id)
    }));
  };

  const updateItem = (id: string, field: keyof ItemLine, value: any) => {
    setPoForm(prev => {
      const vendor = (masters.Vendor ?? []).find(v => v.id === prev.vendorId);
      const tdsPercent = 0;

      return {
        ...prev,
        items: (prev.items || []).map(item => {
          if (item.id === id) {
            const updated = { ...item, [field]: value };
            if (field === 'itemName') {
              const itemMaster = (masters.Item ?? []).find((i: any) => i.name === value);
              if (itemMaster) {
                const coa = (masters.COA ?? []).find((c: any) => c.id === itemMaster.coaId);
                updated.coaCode = (coa?.code ?? itemMaster.coaCode ?? '') || '';
              } else {
                updated.coaCode = '';
              }
            }
            const lineCenterName =
              field === 'centerName' ? String(value ?? '') : (updated.centerName ?? item.centerName ?? '');
            const centerRow = (masters.Center ?? []).find((c: any) => c.name === lineCenterName);
            const isIntraState = !!(vendor && centerRow && (vendor as any).state === (centerRow as any).state);

            if (field === 'quantity' || field === 'rate' || field === 'gst' || field === 'centerName') {
              if (field === 'gst') {
                if (value === PO_LINE_GST_USE_HEADER || value === '' || value === undefined || value === null) {
                  delete (updated as any).gst;
                } else {
                  updated.gst = Number(value);
                }
              }
              const qty = updated.quantity || 0;
              const rate = updated.rate || 0;
              const baseAmount = qty * rate;
              const tdsAmount = 0;
              const headerGst = Number(prev.gst) || 0;
              const gstPercent =
                updated.gst !== undefined && updated.gst !== null ? Number(updated.gst) : headerGst;
              const gstAmount = baseAmount * (gstPercent / 100);

              updated.amount = baseAmount;
              updated.tds = tdsPercent;
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
            }
            return updated;
          }
          return item;
        })
      };
    });
  };

  const [invoiceForm, setInvoiceForm] = useState<Partial<Invoice>>({
    entityName: masters.Entity?.[0]?.name || '',
    vendorSiteId: '',
    location: '',
    remarks: '',
    overallSummary: '',
    attachments: [],
    shippingAddressId: '',
    billingAddressId: ''
  });

  // Update total amount whenever items change
  useEffect(() => {
    const total = (poForm.items || []).reduce((sum, item) => sum + (item.totalAmount || 0), 0);
    setPoForm(prev => ({ ...prev, amount: total }));
  }, [poForm.items]);

  // Keep PO-level centerNames as union of line centres (workflow / list still use po.centerNames)
  useEffect(() => {
    const derived = [...new Set((poForm.items || []).map((i) => i.centerName).filter(Boolean))] as string[];
    setPoForm((prev) => {
      const cur = prev.centerNames || [];
      if (
        derived.length === cur.length &&
        derived.every((c) => cur.includes(c)) &&
        cur.every((c) => derived.includes(c))
      ) {
        return prev;
      }
      return { ...prev, centerNames: derived };
    });
  }, [poForm.items]);

  const updateInvoiceItem = (itemId: string, field: 'quantity' | 'gst' | 'tds' | 'desc', value: number | string) => {
    if (!selectedGRN || !selectedPO) return;
    if (field === 'desc') {
      setInvoiceForm(prev => ({
        ...prev,
        items: (prev.items || []).map(i => i.id === itemId ? { ...i, desc: String(value ?? '') } : i)
      }));
      return;
    }
    const vendor = (masters.Vendor ?? []).find((v: any) => v.id === selectedPO.vendorId);
    const center = (masters.Center ?? []).find((c: any) => c.name === invoiceForm.location);
    const isIntraState = vendor && center && (vendor as any).state === (center as any).state;

    setInvoiceForm(prev => {
      const items = (prev.items || []).map(i => {
        if (i.id !== itemId) return i;
        const qty = field === 'quantity' ? Number(value) : (Number(i.quantity) || 0);
        const rate = Number(i.rate) || 0;
        const base = qty * rate;
        const gstPercent = field === 'gst' ? Number(value) : (i.gst ?? prev.gst ?? 0);
        const tdsPercent = field === 'tds' ? Number(value) : (i.tds ?? prev.tds ?? 0);
        const gstAmount = base * (gstPercent / 100);
        const tdsAmount = base * (tdsPercent / 100);
        const totalAmount = base + gstAmount - tdsAmount;
        const updated: ItemLine = { ...i, quantity: qty, amount: base, gst: gstPercent, tds: tdsPercent, gstAmount, tdsAmount, totalAmount };
        if (isIntraState) {
          updated.cgst = gstAmount / 2;
          updated.sgst = gstAmount / 2;
          updated.igst = 0;
        } else {
          updated.cgst = 0;
          updated.sgst = 0;
          updated.igst = gstAmount;
        }
        return updated;
      });
      const amount = items.reduce((sum, i) => sum + (Number(i.totalAmount) || 0), 0);
      return { ...prev, items, amount };
    });
  };

  const downloadTemplate = (type: 'PO' | 'GRN' | 'Invoice') => {
    const headers = type === 'PO' ? 'Item Name,Desc,Qty,Rate,Center,Remarks' : 'Item Name,Desc,Qty,Rate,Remarks';
    const blob = new Blob([headers], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', `${type}_Template.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleBulkUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'PO' | 'GRN' | 'Invoice') => {
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
          const centerName = row['Center'] || row['center'] || row['Centre'] || '';
          
          const base = qty * rate;
          const tdsPercent = type === 'PO' ? 0 : (poForm.tds || 0);
          const gstPercent = poForm.gst || 0;
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
            centerName: String(centerName || ''),
          };
        });

        if (type === 'PO') {
          setPoForm(prev => ({ ...prev, items: newItems }));
        } else if (type === 'GRN' && selectedPO) {
          // For GRN, we might want to validate against PO items
          setGrnForm(prev => ({ 
            ...prev, 
            items: newItems, 
            amount: newItems.reduce((sum, i) => sum + (i.totalAmount || 0), 0) 
          }));
        } else if (type === 'Invoice' && selectedGRN) {
          setInvoiceForm(prev => ({ ...prev, items: newItems }));
        }
        
        alert(`Bulk upload for ${type} processed: ${newItems.length} items found.`);
      },
      error: (error) => {
        alert(`Error parsing CSV: ${error.message}`);
      }
    });

    e.target.value = '';
  };

  const handleCreatePO = () => {
    // Validation
    if (!poForm.vendorId || !poForm.department || !poForm.subDepartment) {
      alert('Please fill all mandatory header fields.');
      return;
    }
    if ((poForm.items || []).some((i) => !String(i.centerName || '').trim())) {
      alert('Centre is mandatory for every item line.');
      return;
    }
    if ((poForm.items || []).some(i => !i.itemName || !i.remarks)) {
      alert('Item Name and Remarks are mandatory for all item lines.');
      return;
    }

    if (poForm.isUnbudgeted && !poForm.unbudgetedJustification) {
      alert('Justification is mandatory for unbudgeted expenses.');
      return;
    }

    const budgetCheck = checkBudget(poForm);
    if (!budgetCheck.ok) {
      alert(budgetCheck.errors?.join('\n'));
      return;
    }

    const centerNamesFromLines = [
      ...new Set((poForm.items || []).map((i) => i.centerName).filter(Boolean)),
    ] as string[];
    const headerGstNum = Number(poForm.gst) || 0;
    const itemsForSave = (poForm.items || []).map((i) => ({
      ...i,
      gst: i.gst !== undefined && i.gst !== null ? i.gst : headerGstNum,
    }));
    const newPO: PurchaseOrder = {
      ...(poForm as PurchaseOrder),
      items: itemsForSave,
      centerNames: centerNamesFromLines,
      id: `PO-${Math.floor(Math.random() * 10000)}`,
      status: budgetCheck.ok ? 'Pending' : 'Budget Hold',
      currentStepIndex: 0,
      createdAt: new Date().toISOString(),
      attachments: poForm.attachments || [],
      workflowStepHistory: [{ action: 'submit', userId: currentUser.id, at: new Date().toISOString(), stepIndex: 0 }]
    };
    setPurchaseOrders([...purchaseOrders, newPO]);
    setShowForm(false);
    resetForms();
    if (pendingPR) onPOCreated();
  };

  const checkBudget = (po: Partial<PurchaseOrder>) => {
    if (po.isUnbudgeted) return { ok: true };

    const errors: string[] = [];
    po.items?.forEach(item => {
      if (!item.coaCode) return;
      const budget = getBudgetForDocumentAndCoaCode(budgetsForDeduction, item.coaCode, po) as Budget | undefined;
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

  const deductBudget = (po: PurchaseOrder) => {
    if (po.isUnbudgeted) return;

    setBudgets(prev => prev.map(budget => {
      const chosen = getBudgetForDocumentAndCoaCode(prev, budget.coaCode, po);
      if (chosen?.id !== budget.id) return budget;
      const poItemsForGL = po.items.filter(i => i.coaCode === budget.coaCode);
      if (poItemsForGL.length > 0) {
        const totalForGL = poItemsForGL.reduce((sum, i) => sum + (Number(i.totalAmount) || Number(i.amount) || 0), 0);
        const newConsumed = Math.max(0, Number(budget.consumedAmount) + totalForGL);
        return { ...budget, consumedAmount: newConsumed };
      }
      return budget;
    }));
  };

  const poRemainingKey = (it: PoRemainingItem, idx: number) => `${it.itemId || it.itemName || 'item'}::${idx}`;

  const openPoGrnSelectionModal = async (po: PurchaseOrder) => {
    const windowInfo = getPoWindowInfo(po);
    if (!windowInfo.canCreate) {
      alert(windowInfo.message);
      return;
    }
    setPoRemainingLoading(true);
    setPoRemainingError(null);
    setPoForGrnSelection(po);
    try {
      const res = await apiGet<{ items: PoRemainingItem[] }>(`purchase-orders/${po.id}/remaining-quantities`);
      const items = Array.isArray(res?.items) ? res.items : [];
      const receiveDefaults: Record<string, number> = {};
      const selectedDefaults: Record<string, boolean> = {};
      items.forEach((it, idx) => {
        const key = poRemainingKey(it, idx);
        receiveDefaults[key] = Number(it.leftQty) || 0;
        selectedDefaults[key] = (Number(it.leftQty) || 0) > 0;
      });
      setPoRemainingItems(items);
      setPoReceiveQtyByKey(receiveDefaults);
      setPoSelectedByKey(selectedDefaults);
      setShowPoGrnItemModal(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load remaining quantities';
      setPoRemainingError(msg);
      alert(msg);
    } finally {
      setPoRemainingLoading(false);
    }
  };

  const closePoGrnSelectionModal = () => {
    setShowPoGrnItemModal(false);
    setPoForGrnSelection(null);
    setPoRemainingItems([]);
    setPoReceiveQtyByKey({});
    setPoSelectedByKey({});
    setPoRemainingError(null);
  };

  const proceedPoGrnSelection = () => {
    if (!poForGrnSelection) return;
    const selectedRows = poRemainingItems
      .map((it, idx) => ({ it, idx, key: poRemainingKey(it, idx) }))
      .filter((r) => poSelectedByKey[r.key]);
    if (selectedRows.length === 0) {
      alert('Select at least one item for GRN.');
      return;
    }
    const poItems = poForGrnSelection.items || [];
    const prepared: ItemLine[] = [];
    for (const row of selectedRows) {
      const receiveQty = Number(poReceiveQtyByKey[row.key] ?? 0);
      const leftQty = Number(row.it.leftQty) || 0;
      if (receiveQty <= 0) {
        alert(`Receive qty must be greater than 0 for ${row.it.itemName}.`);
        return;
      }
      if (receiveQty > leftQty) {
        alert(`Cannot receive more than remaining quantity. Left qty for ${row.it.itemName} is ${leftQty}.`);
        return;
      }
      const baseFromPo = poItems.find((i) => (row.it.itemId && i.id === row.it.itemId) || i.itemName === row.it.itemName);
      const rate = Number(baseFromPo?.rate ?? row.it.rate) || 0;
      prepared.push({
        ...(baseFromPo || {
          id: row.it.itemId || Math.random().toString(),
          itemName: row.it.itemName,
          desc: '',
          rate,
          remarks: '',
          centerName: row.it.center || '',
        }),
        id: row.it.itemId || baseFromPo?.id || Math.random().toString(),
        quantity: receiveQty,
        amount: receiveQty * rate,
        rate,
        desc: baseFromPo?.desc ?? '',
        remarks: baseFromPo?.remarks ?? '',
        centerName: baseFromPo?.centerName || row.it.center || '',
        poLeftQty: leftQty,
        sourceItemId: row.it.itemId || baseFromPo?.id,
      });
    }

    setSelectedPO(poForGrnSelection);
    setGrnForm({
      entityName: poForGrnSelection.entityName,
      purchaseOrderId: poForGrnSelection.id,
      vendorSiteId: poForGrnSelection.vendorSiteId || '',
      shippingAddressId: poForGrnSelection.shippingAddressId || '',
      billingAddressId: poForGrnSelection.billingAddressId || '',
      location: (poForGrnSelection.centerNames && poForGrnSelection.centerNames[0]) || '',
      department: poForGrnSelection.department || '',
      subDepartment: poForGrnSelection.subDepartment || '',
      remarks: poForGrnSelection.remarks || '',
      overallSummary: poForGrnSelection.overallSummary || '',
      invoiceNumber: '',
      invoiceDate: '',
      tds: poForGrnSelection.tds ?? 0,
      gst: poForGrnSelection.gst ?? 0,
      items: prepared,
      amount: 0,
      attachments: [],
    });
    setShowForm(true);
    closePoGrnSelectionModal();
  };

  const handleCreateGRN = () => {
    if (!selectedPO) return;
    const items = grnForm.items || [];
    if (items.length === 0) {
      alert('Select at least one item for GRN.');
      return;
    }
    for (const it of items) {
      const qty = Number(it.quantity) || 0;
      const max = Number(it.poLeftQty ?? 0) || 0;
      if (qty <= 0) {
        alert('Quantity must be greater than 0.');
        return;
      }
      if (max > 0 && qty > max) {
        alert(`Cannot exceed remaining quantity. Left qty for ${it.itemName} is ${max}.`);
        return;
      }
    }
    const newGRN: GRN = {
      ...grnForm as GRN,
      id: `GRN-${Math.floor(Math.random() * 10000)}`,
      entityName: selectedPO.entityName,
      purchaseOrderId: selectedPO.id,
      status: 'Pending',
      currentStepIndex: 0,
      createdAt: new Date().toISOString(),
      createdBy: currentUser.id,
      attachments: grnForm.attachments || [],
      workflowStepHistory: [{ action: 'submit', userId: currentUser.id, at: new Date().toISOString(), stepIndex: 0 }]
    };
    setGrns([...grns, newGRN]);
    setShowForm(false);
    resetForms();
  };

  const handleCreateInvoice = () => {
    if (!selectedGRN) return;
    const newInvoice: Invoice = {
      ...invoiceForm as Invoice,
      id: `INV-${Math.floor(Math.random() * 10000)}`,
      entityName: selectedGRN.entityName,
      grnId: selectedGRN.id,
      status: 'Pending',
      currentStepIndex: 0,
      createdAt: new Date().toISOString(),
      createdBy: currentUser.id,
      attachments: invoiceForm.attachments || [],
      workflowStepHistory: [{ action: 'submit', userId: currentUser.id, at: new Date().toISOString(), stepIndex: 0 }]
    };
    setInvoices([...invoices, newInvoice]);
    setShowForm(false);
    resetForms();
  };

  const resetForms = () => {
    setPoForm({
      entityName: masters.Entity?.[0]?.name || '',
      vendorId: '', vendorSiteId: '', transactionType: getItemTypesFromMasters(masters)[0]?.name ?? '', validFrom: getTodayISTDate(), validTo: '',
      frequency: 'One-Time', department: '', subDepartment: '', paymentTerms: '',
      centerNames: [], items: [{ id: Math.random().toString(), itemName: '', desc: '', quantity: 1, rate: 0, amount: 0, remarks: '', coaCode: '', centerName: '' }], // line gst omitted = follow header
      tds: 0, gst: 0, amount: 0, remarks: '', overallSummary: '', attachments: [],
      shippingAddressId: '', billingAddressId: '',
      isUnbudgeted: false, unbudgetedJustification: ''
    });
    setGrnForm({ vendorSiteId: '', location: '', invoiceNumber: '', invoiceDate: '', department: '', subDepartment: '', tds: 0, gst: 0, items: [], amount: 0, remarks: '', overallSummary: '', attachments: [], shippingAddressId: '', billingAddressId: '' });
    setInvoiceForm({ vendorSiteId: '', location: '', remarks: '', overallSummary: '', attachments: [], shippingAddressId: '', billingAddressId: '' });
    setSelectedPO(null);
    setSelectedGRN(null);
  };

  const poGrns = grns.filter(g => g.purchaseOrderId);
  const poInvoices = invoices.filter((inv) => {
    const g = grns.find((x) => x.id === inv.grnId);
    return !!g?.purchaseOrderId;
  });
  const noRateContracts: RateContract[] = [];

  const isPoFullyReceived = (po: PurchaseOrder) => {
    const receivedByKey = new Map<string, number>();
    poGrns
      .filter((g) => g.purchaseOrderId === po.id)
      .forEach((g) => {
        (g.items || []).forEach((it, idx) => {
          const key = `${it.sourceItemId || it.id || `${String(it.itemName || '').toLowerCase()}::${idx}`}`;
          receivedByKey.set(key, (receivedByKey.get(key) || 0) + (Number(it.quantity) || 0));
        });
      });
    return (po.items || []).every((it, idx) => {
      const key = `${it.id || `${String(it.itemName || '').toLowerCase()}::${idx}`}`;
      const ordered = Number(it.quantity) || 0;
      const received = receivedByKey.get(key) || 0;
      return received >= ordered;
    });
  };

  const vendorOptionsForList = useMemo(
    () => vendorsForDropdown.map((v) => ({ id: v.id, name: v.name })),
    [vendorsForDropdown]
  );

  const poListCounts = useMemo(
    () => ({
      approved: purchaseOrders.filter((p) => p.status === 'Approved').length,
      pending: purchaseOrders.filter((p) => p.status === 'Pending').length,
      rejected: purchaseOrders.filter((p) => p.status === 'Rejected').length,
    }),
    [purchaseOrders]
  );
  const grnListCounts = useMemo(
    () => ({
      approved: poGrns.filter((g) => g.status === 'Approved').length,
      pending: poGrns.filter((g) => g.status === 'Pending').length,
      rejected: poGrns.filter((g) => g.status === 'Rejected').length,
    }),
    [poGrns]
  );
  const invListCounts = useMemo(
    () => ({
      approved: poInvoices.filter((i) => i.status === 'Approved').length,
      pending: poInvoices.filter((i) => i.status === 'Pending').length,
      rejected: poInvoices.filter((i) => i.status === 'Rejected').length,
    }),
    [poInvoices]
  );

  const filteredPurchaseOrders = useMemo(() => {
    return purchaseOrders.filter((po) => {
      if (!inCreatedAtRange(po.createdAt, listDateFrom, listDateTo)) return false;
      if (!matchesVendorFilter(po.vendorId, listVendorId)) return false;
      if (!matchesStatusQuickFilter(po.status, listStatusQuick)) return false;
      const vendorName = (masters.Vendor ?? []).find((v) => v.id === po.vendorId)?.name || '';
      const details = `${vendorName} ${po.items.length} ${po.centerNames.length} ${(Number(po.amount) || 0).toFixed(2)}`;
      if (!textIncludes(po.id, colPoId)) return false;
      if (!textIncludes(details, colPoDetails)) return false;
      const poCreatedDateStr = po.createdAt ? new Date(po.createdAt).toLocaleDateString() : '';
      if (!textIncludes(poCreatedDateStr, colPoDate)) return false;
      if (!textIncludes(po.status, colPoStatus)) return false;
      return true;
    });
  }, [purchaseOrders, masters, listDateFrom, listDateTo, listVendorId, listStatusQuick, colPoId, colPoDetails, colPoDate, colPoStatus]);

  const filteredPoGrns = useMemo(() => {
    return poGrns.filter((grn) => {
      if (!inCreatedAtRange(grn.createdAt, listDateFrom, listDateTo)) return false;
      const vid = getGrnVendorId(grn, noRateContracts, purchaseOrders, masters);
      if (!matchesVendorFilter(vid, listVendorId)) return false;
      if (!matchesStatusQuickFilter(grn.status, listStatusQuick)) return false;
      const details = `${grn.location} ${grn.purchaseOrderId || ''} ${grn.invoiceNumber || ''} ${grn.items.length} ${(Number(grn.amount) || 0).toFixed(2)}`;
      if (!textIncludes(grn.id, colGrnId)) return false;
      if (!textIncludes(details, colGrnDetails)) return false;
      if (!textIncludes(grn.status, colGrnStatus)) return false;
      return true;
    });
  }, [poGrns, purchaseOrders, masters, listDateFrom, listDateTo, listVendorId, listStatusQuick, colGrnId, colGrnDetails, colGrnStatus]);

  const filteredPoInvoices = useMemo(() => {
    return poInvoices.filter((inv) => {
      if (!inCreatedAtRange(inv.createdAt, listDateFrom, listDateTo)) return false;
      const vid = getPoInvoiceVendorId(inv, grns, noRateContracts, purchaseOrders, masters);
      if (!matchesVendorFilter(vid, listVendorId)) return false;
      if (!matchesStatusQuickFilter(inv.status, listStatusQuick)) return false;
      const details = `${inv.location} ${inv.grnId || ''} ${(Number(inv.amount) || 0).toFixed(2)}`;
      if (!textIncludes(inv.id, colInvId)) return false;
      if (!textIncludes(details, colInvDetails)) return false;
      if (!textIncludes(inv.status, colInvStatus)) return false;
      return true;
    });
  }, [poInvoices, grns, purchaseOrders, masters, listDateFrom, listDateTo, listVendorId, listStatusQuick, colInvId, colInvDetails, colInvStatus]);

  const isGrnReadOnly = !!grnForm.id && !(grnForm.status === 'Rejected' && grnForm.createdBy === currentUser.id);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, source: Attachment['source']) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const newAttachment: Attachment = {
      id: `att-${Math.random()}`,
      name: file.name,
      url: URL.createObjectURL(file),
      uploadedAt: new Date().toISOString(),
      source
    };

    if (source === 'PO') setPoForm(prev => ({ ...prev, attachments: [...(prev.attachments || []), newAttachment] }));
    if (source === 'GRN') setGrnForm(prev => ({ ...prev, attachments: [...(prev.attachments || []), newAttachment] }));
    if (source === 'Invoice') setInvoiceForm(prev => ({ ...prev, attachments: [...(prev.attachments || []), newAttachment] }));
    
    // Reset input
    e.target.value = '';
  };

  const canApprove = (doc: PurchaseOrder | GRN | Invoice) => {
    if (doc.status !== 'Pending') return false;
    
    let moduleType: ModuleType;
    if ('grnId' in doc) {
      moduleType = ModuleType.INVOICE_GRN;
    } else if ('purchaseOrderId' in doc) {
      moduleType = ModuleType.GRN;
    } else {
      moduleType = ModuleType.PO;
    }

    const rule = workflows.find(w => 
      w.entityName === doc.entityName &&
      w.moduleType === moduleType &&
      w.subDepartment === doc.subDepartment &&
      (!w.centerName || (doc as any).centerNames?.includes(w.centerName) || (doc as any).location === w.centerName) &&
      Number(doc.amount) >= Number(w.minAmount) && 
      (w.maxAmount == null || Number(doc.amount) <= Number(w.maxAmount))
    );

    if (!rule) {
      // Only auto-approve if NO workflow rules exist at all for this module type
      // If rules exist but none match this document, block approval (prevents silent bypass)
      const anyRuleForModule = workflows.some(w => w.moduleType === moduleType);
      return !anyRuleForModule;
    }
    if (rule.approvalChain.length === 0) return true;

    const currentStep = rule.approvalChain[doc.currentStepIndex];
    if (!currentStep) return false;

    return currentStep.type === ApprovalType.APPROVER && currentStep.userIds.includes(currentUser.id);
  };

  const canCompleteReview = (doc: PurchaseOrder | GRN | Invoice) => {
    if (doc.status !== 'Pending') return false;
    let moduleType: ModuleType;
    if ('grnId' in doc) {
      moduleType = ModuleType.INVOICE_GRN;
    } else if ('purchaseOrderId' in doc) {
      moduleType = ModuleType.GRN;
    } else {
      moduleType = ModuleType.PO;
    }
    const rule = workflows.find(w =>
      w.entityName === doc.entityName &&
      w.moduleType === moduleType &&
      w.subDepartment === doc.subDepartment &&
      (!w.centerName || (doc as any).centerNames?.includes(w.centerName) || (doc as any).location === w.centerName) &&
      Number(doc.amount) >= Number(w.minAmount) &&
      (w.maxAmount == null || Number(doc.amount) <= Number(w.maxAmount))
    );
    if (!rule || rule.approvalChain.length === 0) return false;
    const currentStep = rule.approvalChain[doc.currentStepIndex];
    if (!currentStep) return false;
    return currentStep.type === ApprovalType.REVIEWER && currentStep.userIds.includes(currentUser.id);
  };

  const completeReviewPO = (id: string) => {
    setPurchaseOrders(prev => prev.map(po => {
      if (po.id !== id) return po;
      const rule = workflows.find(w =>
        w.entityName === po.entityName &&
        w.moduleType === ModuleType.PO &&
        w.subDepartment === po.subDepartment &&
        (!w.centerName || po.centerNames?.includes(w.centerName)) &&
        Number(po.amount) >= Number(w.minAmount) &&
        (w.maxAmount == null || Number(po.amount) <= Number(w.maxAmount))
      );
      if (!rule || po.currentStepIndex >= rule.approvalChain.length - 1) return po;
      return addAuditEntry({ ...po, currentStepIndex: po.currentStepIndex + 1 }, 'completeReview');
    }));
  };

  const completeReviewGRN = (id: string) => {
    setGrns(prev => prev.map(grn => {
      if (grn.id !== id) return grn;
      const rule = workflows.find(w =>
        w.entityName === grn.entityName &&
        w.moduleType === ModuleType.GRN &&
        w.subDepartment === grn.subDepartment &&
        (!w.centerName || grn.location === w.centerName) &&
        Number(grn.amount) >= Number(w.minAmount) &&
        (w.maxAmount == null || Number(grn.amount) <= Number(w.maxAmount))
      );
      if (!rule || grn.currentStepIndex >= rule.approvalChain.length - 1) return grn;
      return addAuditEntry({ ...grn, currentStepIndex: grn.currentStepIndex + 1 }, 'completeReview');
    }));
  };

  const completeReviewInvoice = (id: string) => {
    setInvoices(prev => prev.map(inv => {
      if (inv.id !== id) return inv;
      const rule = workflows.find(w =>
        w.entityName === inv.entityName &&
        w.moduleType === ModuleType.INVOICE_GRN &&
        w.subDepartment === inv.subDepartment &&
        (!w.centerName || inv.location === w.centerName) &&
        Number(inv.amount) >= Number(w.minAmount) &&
        (w.maxAmount == null || Number(inv.amount) <= Number(w.maxAmount))
      );
      if (!rule || inv.currentStepIndex >= rule.approvalChain.length - 1) return inv;
      return addAuditEntry({ ...inv, currentStepIndex: inv.currentStepIndex + 1 }, 'completeReview');
    }));
  };

  const approvePO = (id: string) => {
    setPurchaseOrders(prev => prev.map(po => {
      if (po.id !== id) return po;

      const rule = workflows.find(w => 
        w.entityName === po.entityName &&
        w.moduleType === ModuleType.PO &&
        w.subDepartment === po.subDepartment &&
        (!w.centerName || po.centerNames?.includes(w.centerName)) &&
        Number(po.amount) >= Number(w.minAmount) && 
        (w.maxAmount == null || Number(po.amount) <= Number(w.maxAmount))
      );

      if (!rule || po.currentStepIndex >= rule.approvalChain.length - 1) {
        // Final budget check before approval
        const budgetCheck = checkBudget(po);
        if (!budgetCheck.ok) {
          alert(`Cannot approve PO: ${budgetCheck.errors?.join('\n')}`);
          return addAuditEntry({ ...po, status: 'Budget Hold' }, 'approve');
        }
        deductBudget(po);
        return addAuditEntry({ ...po, status: 'Approved' }, 'approve');
      }

      return addAuditEntry({ ...po, currentStepIndex: po.currentStepIndex + 1 }, 'approve');
    }));
  };

  const creditBudget = (po: PurchaseOrder) => {
    if (po.isUnbudgeted) return;

    setBudgets(prev => prev.map(budget => {
      const chosen = getBudgetForDocumentAndCoaCode(prev, budget.coaCode, po);
      if (chosen?.id !== budget.id) return budget;
      const poItemsForGL = po.items.filter(i => i.coaCode === budget.coaCode);
      if (poItemsForGL.length > 0) {
        const totalForGL = poItemsForGL.reduce((sum, i) => sum + (Number(i.totalAmount) || Number(i.amount) || 0), 0);
        const newConsumed = Math.max(0, Number(budget.consumedAmount) - totalForGL);
        return { ...budget, consumedAmount: newConsumed };
      }
      return budget;
    }));
  };

  const amendPO = (id: string) => {
    const po = purchaseOrders.find(p => p.id === id);
    if (po && po.status === 'Approved') {
      creditBudget(po);
    }
    setPurchaseOrders(purchaseOrders.map(po => po.id === id ? addAuditEntry({ ...po, status: 'Pending', currentStepIndex: 0 }, 'amend') : po));
    alert('PO status reset to Pending for amendment. Budget has been credited back and will be re-validated upon re-approval.');
  };

  const approveGRN = (id: string) => {
    setGrns(prev => prev.map(grn => {
      if (grn.id !== id) return grn;

      const rule = workflows.find(w => 
        w.entityName === grn.entityName &&
        w.moduleType === ModuleType.GRN &&
        w.subDepartment === grn.subDepartment &&
        (!w.centerName || grn.location === w.centerName) &&
        Number(grn.amount) >= Number(w.minAmount) && 
        (w.maxAmount == null || Number(grn.amount) <= Number(w.maxAmount))
      );

      if (!rule || grn.currentStepIndex >= rule.approvalChain.length - 1) {
        return addAuditEntry({ ...grn, status: 'Approved' }, 'approve');
      }

      return addAuditEntry({ ...grn, currentStepIndex: grn.currentStepIndex + 1 }, 'approve');
    }));
  };

  const reverseGRN = (id: string) => {
    setGrns(grns.map(grn => grn.id === id ? { ...grn, status: 'Reversed' } : grn));
    alert('GRN reversed. You can now recreate it against the same PO.');
  };

  const approveInvoice = (id: string) => {
    setInvoices(prev => prev.map(inv => {
      if (inv.id !== id) return inv;

      const rule = workflows.find(w => 
        w.entityName === inv.entityName &&
        w.moduleType === ModuleType.INVOICE_GRN &&
        w.subDepartment === inv.subDepartment &&
        (!w.centerName || inv.location === w.centerName) &&
        Number(inv.amount) >= Number(w.minAmount) && 
        (w.maxAmount == null || Number(inv.amount) <= Number(w.maxAmount))
      );

      if (!rule || inv.currentStepIndex >= rule.approvalChain.length - 1) {
        return addAuditEntry({ ...inv, status: 'Approved' }, 'approve');
      }

      return addAuditEntry({ ...inv, currentStepIndex: inv.currentStepIndex + 1 }, 'approve');
    }));
  };

  const reverseInvoice = (id: string) => {
    setInvoices(invoices.map(inv => inv.id === id ? { ...inv, status: 'Reversed' } : inv));
    alert('Invoice reversed. You can now recreate it against the same GRN.');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3 border-b border-slate-200 pb-4">
        <div className="flex flex-wrap gap-2">
          {(['PO', 'GRN', 'Invoice'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => { setViewMode(mode); setShowForm(false); }}
              className={`px-4 py-2 rounded-lg font-bold transition-all ${
                viewMode === mode ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {mode === 'PO' ? 'Purchase Orders' : mode === 'GRN' ? 'GRN' : 'Invoices'}
            </button>
          ))}
        </div>
        {!showForm && (
          <TransactionListFilterBar
            approvedCount={viewMode === 'PO' ? poListCounts.approved : viewMode === 'GRN' ? grnListCounts.approved : invListCounts.approved}
            pendingCount={viewMode === 'PO' ? poListCounts.pending : viewMode === 'GRN' ? grnListCounts.pending : invListCounts.pending}
            rejectedCount={viewMode === 'PO' ? poListCounts.rejected : viewMode === 'GRN' ? grnListCounts.rejected : invListCounts.rejected}
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
        )}
      </div>

      {!showForm && (
        <div
          className="grid w-full gap-0 border-b border-slate-100 bg-slate-50/80"
          style={{
            gridTemplateColumns: 'minmax(0, 14%) minmax(0, 28%) minmax(0, 14%) minmax(0, 14%) minmax(0, 30%)',
          }}
          role="search"
          aria-label="Column filters"
        >
          <div className="px-6 py-2 min-w-0">
            <input
              type="text"
              placeholder="Filter…"
              value={viewMode === 'PO' ? colPoId : viewMode === 'GRN' ? colGrnId : colInvId}
              onChange={(e) => {
                const v = e.target.value;
                if (viewMode === 'PO') setColPoId(v);
                else if (viewMode === 'GRN') setColGrnId(v);
                else setColInvId(v);
              }}
              className="w-full min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium"
            />
          </div>
          <div className="px-6 py-2 min-w-0">
            {viewMode === 'PO' ? (
              <input
                type="text"
                placeholder="Filter…"
                value={colPoDate}
                onChange={(e) => setColPoDate(e.target.value)}
                className="w-full min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium"
              />
            ) : (
              <span className="text-[10px] text-slate-400 font-bold block py-1">—</span>
            )}
          </div>
          <div className="px-6 py-2 min-w-0">
            <input
              type="text"
              placeholder="Filter…"
              value={viewMode === 'PO' ? colPoDetails : viewMode === 'GRN' ? colGrnDetails : colInvDetails}
              onChange={(e) => {
                const v = e.target.value;
                if (viewMode === 'PO') setColPoDetails(v);
                else if (viewMode === 'GRN') setColGrnDetails(v);
                else setColInvDetails(v);
              }}
              className="w-full min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium"
            />
          </div>
          <div className="px-6 py-2 min-w-0">
            <input
              type="text"
              placeholder="Filter…"
              value={viewMode === 'PO' ? colPoStatus : viewMode === 'GRN' ? colGrnStatus : colInvStatus}
              onChange={(e) => {
                const v = e.target.value;
                if (viewMode === 'PO') setColPoStatus(v);
                else if (viewMode === 'GRN') setColGrnStatus(v);
                else setColInvStatus(v);
              }}
              className="w-full min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium"
            />
          </div>
          <div className="px-6 py-2 min-w-0" aria-hidden="true" />
        </div>
      )}

      <div className="flex justify-between items-center">
        <h2 className="text-xl font-black text-slate-800">
          {viewMode === 'PO' ? 'Purchase Order Management' : viewMode === 'GRN' ? 'Goods Receipt Notes' : 'Invoice Processing'}
        </h2>
        {viewMode === 'PO' && !showForm && (
          <button 
            onClick={() => setShowForm(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-black shadow-lg shadow-indigo-200 hover:scale-105 transition-transform"
          >
            + Create New PO
          </button>
        )}
      </div>

      {showForm ? (
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-black text-slate-900">
              {selectedPO ? (selectedGRN ? 'Create Invoice' : 'Create GRN') : 'New Purchase Order'}
            </h3>
            <button onClick={() => { setShowForm(false); resetForms(); }} className="text-slate-400 hover:text-slate-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* PO Form Fields */}
            {!selectedPO && !selectedGRN && (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Entity</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={poForm.entityName}
                    onChange={e => setPoForm({ ...poForm, entityName: e.target.value })}
                  >
                    {(masters.Entity ?? []).map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Vendor</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={poForm.vendorId}
                    onChange={e => setPoForm({ ...poForm, vendorId: e.target.value, vendorSiteId: '' })}
                  >
                    <option value="">Select Vendor</option>
                    {vendorsForDropdown.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Vendor Site</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={poForm.vendorSiteId}
                    onChange={e => setPoForm({ ...poForm, vendorSiteId: e.target.value })}
                    disabled={!poForm.vendorId}
                  >
                    <option value="">Select Vendor Site</option>
                    {(masters['Vendor Site'] ?? []).filter(s => s.vendorId === poForm.vendorId).map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Shipping Address</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={poForm.shippingAddressId}
                    onChange={e => setPoForm({ ...poForm, shippingAddressId: e.target.value })}
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
                    value={poForm.billingAddressId}
                    onChange={e => setPoForm({ ...poForm, billingAddressId: e.target.value })}
                  >
                    <option value="">Select Billing Address</option>
                    {(masters.Entity ?? []).flatMap(ent => ent.billingAddresses || []).map((addr: any) => (
                      <option key={addr.id} value={addr.id}>{addr.address}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">GST %</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={poForm.gst}
                    onChange={e => setPoForm({ ...poForm, gst: Number(e.target.value) })}
                  >
                    <option value="0">Select GST</option>
                    {(masters.GST ?? []).map(g => <option key={g.id} value={g.rate}>{g.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Item type</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={poForm.transactionType}
                    onChange={e => setPoForm({ ...poForm, transactionType: e.target.value })}
                  >
                    <option value="">Select Item type...</option>
                    {getItemTypesFromMasters(masters).map(r => (
                      <option key={r.id} value={r.name}>{r.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Validity From</label>
                  <input 
                    type="date" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={poForm.validFrom}
                    onChange={e => setPoForm({ ...poForm, validFrom: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Validity To</label>
                  <input 
                    type="date" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={poForm.validTo}
                    onChange={e => setPoForm({ ...poForm, validTo: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Required Date</label>
                  <input 
                    type="date" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={poForm.requiredDate || ''}
                    onChange={e => setPoForm({ ...poForm, requiredDate: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Frequency</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={poForm.frequency}
                    onChange={e => setPoForm({ ...poForm, frequency: e.target.value as Frequency })}
                  >
                    <option value="Monthly">Monthly</option>
                    <option value="Quarterly">Quarterly</option>
                    <option value="Yearly">Yearly</option>
                    <option value="One-Time">One-Time</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Department</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={poForm.department}
                    onChange={e => setPoForm({ ...poForm, department: e.target.value, subDepartment: '' })}
                  >
                    <option value="">Select Department</option>
                    {getDepartments(masters).map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Sub-Department</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={poForm.subDepartment}
                    onChange={e => setPoForm({ ...poForm, subDepartment: e.target.value })}
                  >
                    <option value="">Select Sub-Department</option>
                    {getSubdepartmentsForDepartment(masters, poForm.department).map(sd => <option key={sd.id} value={sd.name}>{sd.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Payment Terms</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={poForm.paymentTerms}
                    onChange={e => setPoForm({ ...poForm, paymentTerms: e.target.value })}
                  >
                    <option value="">Select Payment Terms</option>
                    {masters['Payment Terms']?.map(pt => (
                      <option key={pt.id} value={pt.name}>{pt.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Terms & Conditions</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={poForm.termsAndConditionsId}
                    onChange={e => setPoForm({ ...poForm, termsAndConditionsId: e.target.value })}
                  >
                    <option value="">Select Terms & Conditions</option>
                    {masters['Terms & Conditions']?.map(tc => (
                      <option key={tc.id} value={tc.id}>{tc.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-4 col-span-2 bg-amber-50 p-6 rounded-3xl border border-amber-100">
                  <div className="flex items-center space-x-3">
                    <input 
                      type="checkbox" 
                      id="isUnbudgeted"
                      className="w-5 h-5 text-amber-600 border-amber-300 rounded focus:ring-amber-500"
                      checked={poForm.isUnbudgeted || false}
                      onChange={e => setPoForm({ ...poForm, isUnbudgeted: e.target.checked })}
                    />
                    <label htmlFor="isUnbudgeted" className="text-sm font-black text-amber-900 uppercase tracking-wider cursor-pointer">Unbudgeted Expense</label>
                  </div>
                  {poForm.isUnbudgeted && (
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                      <label className="text-xs font-black text-amber-700 uppercase tracking-wider">Justification (Mandatory)</label>
                      <textarea 
                        className="w-full bg-white border border-amber-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-amber-500 outline-none font-medium text-sm"
                        placeholder="Provide justification for emergency/unplanned spend..."
                        value={poForm.unbudgetedJustification || ''}
                        onChange={e => setPoForm({ ...poForm, unbudgetedJustification: e.target.value })}
                      />
                    </div>
                  )}
                </div>
                <div className="space-y-4 col-span-2 bg-slate-50 p-6 rounded-3xl border border-slate-200">
                  <div className="flex items-center space-x-3">
                    <input 
                      type="checkbox" 
                      id="isAdvancePO"
                      className="w-5 h-5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                      checked={poForm.isAdvancePO || false}
                      onChange={e => setPoForm({ ...poForm, isAdvancePO: e.target.checked })}
                    />
                    <label htmlFor="isAdvancePO" className="text-sm font-black text-slate-700 uppercase tracking-wider cursor-pointer">Advance PO</label>
                  </div>
                  {poForm.isAdvancePO && (
                    <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                      <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Advance Percentage (%)</label>
                      <input 
                        type="number" 
                        className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                        placeholder="e.g. 10"
                        value={poForm.advancePercentage || ''}
                        onChange={e => setPoForm({ ...poForm, advancePercentage: Number(e.target.value) })}
                      />
                    </div>
                  )}
                </div>
                {/* Items Section */}
                <div className="col-span-2 space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-sm font-black text-slate-700 uppercase tracking-wider">Items</h4>
                    <div className="flex items-center space-x-4">
                      <button 
                        onClick={() => downloadTemplate('PO')}
                        className="text-indigo-600 text-xs font-black hover:underline flex items-center"
                      >
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        Download Template
                      </button>
                      <label className="cursor-pointer text-indigo-600 text-xs font-black hover:underline flex items-center">
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                        Bulk Upload
                        <input type="file" className="hidden" onChange={e => handleBulkUpload(e, 'PO')} />
                      </label>
                      <button 
                        onClick={addItem}
                        className="text-indigo-600 text-xs font-black hover:underline"
                      >
                        + Add Item
                      </button>
                    </div>
                  </div>
                  <div className="space-y-6">
                    {poForm.items?.map((item, index) => (
                      <div key={item.id} className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-4">
                        <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-2 items-end">
                          <div className="col-span-2 space-y-1 min-w-0">
                            <SearchableSelect
                              label="Item Name"
                              options={itemsForDropdown.map((i) => ({ id: i.id, name: i.name }))}
                              value={item.itemName ?? ''}
                              onChange={(v) => updateItem(item.id, 'itemName', v)}
                              placeholder="Select Item"
                            />
                          </div>
                          <div className="col-span-2 space-y-1 min-w-0">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Desc</label>
                            <input
                              type="text"
                              placeholder="Description"
                              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                              value={item.desc ?? ''}
                              onChange={e => updateItem(item.id, 'desc', e.target.value)}
                            />
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">GL Code</label>
                            <input
                              type="text"
                              readOnly
                              className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-600 cursor-not-allowed"
                              value={item.coaCode ? `${item.coaCode}` : 'Select'}
                              title={item.coaCode ? 'Locked from Masters → Item → COA Mapping' : 'Select an item to see mapped GL code'}
                            />
                          </div>
                          <div className="col-span-1 space-y-1 min-w-0">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Centre <span className="text-red-500">*</span></label>
                            <select
                              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                              value={item.centerName ?? ''}
                              onChange={e => updateItem(item.id, 'centerName', e.target.value)}
                            >
                              <option value="">Select</option>
                              {CENTERS.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
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
                            <div className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-sm font-black text-slate-600">
                              {Number(item.amount || 0).toFixed(2)}
                            </div>
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">GST</label>
                            <select 
                              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                              value={
                                item.gst !== undefined && item.gst !== null
                                  ? String(item.gst)
                                  : PO_LINE_GST_USE_HEADER
                              }
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === PO_LINE_GST_USE_HEADER) {
                                  updateItem(item.id, 'gst', PO_LINE_GST_USE_HEADER);
                                } else {
                                  updateItem(item.id, 'gst', Number(v));
                                }
                              }}
                            >
                              <option value={PO_LINE_GST_USE_HEADER}>
                                {Number(poForm.gst)
                                  ? `GST`
                                  : 'GST'}
                              </option>
                              {(masters.GST ?? []).map((g) => (
                                <option key={g.id} value={String(g.rate)}>{g.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">GST Amount</label>
                            <div className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-sm font-black text-slate-600">
                              {Number(item.gstAmount || 0).toFixed(2)}
                            </div>
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Net Amount</label>
                            <div className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-sm font-black text-slate-600">
                              {Number(item.totalAmount ?? item.amount ?? 0).toFixed(2)}
                            </div>
                          </div>
                          <div className="col-span-1 space-y-1 min-w-0">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Remarks <span className="text-red-500">*</span></label>
                            <input 
                              type="text"
                              placeholder="Remarks"
                              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                              value={item.remarks}
                              onChange={e => updateItem(item.id, 'remarks', e.target.value)}
                            />
                          </div>
                          <div className="col-span-1 flex justify-end pb-1">
                            {poForm.items!.length > 1 && (
                              <button onClick={() => removeItem(item.id)} className="flex-shrink-0 text-red-400 hover:text-red-600 transition-colors p-2 hover:bg-red-50 rounded-xl">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Consolidated Summary Section */}
                  <div className="bg-slate-50 p-6 rounded-3xl border border-slate-200 mt-6 space-y-4">
                    <h4 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] border-b border-slate-200 pb-2">Tax & Amount Summary (INR)</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Base Amount</label>
                        <div className="text-sm font-bold text-slate-700">
                          ₹{(poForm.items || []).reduce((sum, i) => sum + (i.amount || 0), 0).toFixed(2)}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total GST Amount</label>
                        <div className="text-sm font-bold text-emerald-500">
                          +₹{(poForm.items || []).reduce((sum, i) => sum + (i.gstAmount || 0), 0).toFixed(2)}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Net Total Amount</label>
                        <div className="text-lg font-black text-indigo-700">
                          ₹{poForm.amount?.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Overall summary</label>
                  <textarea
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium min-h-[88px]"
                    value={poForm.overallSummary ?? ''}
                    onChange={e => setPoForm({ ...poForm, overallSummary: e.target.value })}
                    placeholder="Summary..."
                  />
                </div>
              </>
            )}

            {/* GRN Form Fields — same layout as Rate Contract Create GRN */}
            {selectedPO && !selectedGRN && (
              <>
                <div className="col-span-2 bg-indigo-50 p-4 rounded-2xl border border-indigo-100 mb-4">
                  <p className="text-sm font-bold text-indigo-900">Auto-populated from {selectedPO.id}</p>
                  <div className="mt-2 space-y-1">
                    <div className="text-xs"><span className="text-indigo-400 uppercase font-black">Vendor:</span> {(masters['Vendor'] ?? []).find((v: any) => v.id === selectedPO.vendorId)?.name || '—'}</div>
                    <div className="text-xs"><span className="text-indigo-400 uppercase font-black">Vendor Site:</span> {(masters['Vendor Site'] ?? []).find((s: any) => s.id === selectedPO.vendorSiteId)?.name || 'N/A'}</div>
                    <div className="text-xs"><span className="text-indigo-400 uppercase font-black">Centers:</span> {(selectedPO.centerNames || []).join(', ') || '—'}</div>
                  </div>
                </div>
                <div className="col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Row 1: Invoice No | Invoice Date */}
                  <div className="space-y-2">
                    <label className="text-sm font-black text-slate-600 uppercase tracking-wider">Invoice No</label>
                    <input
                      type="text"
                      placeholder="Enter invoice number"
                      className="w-full min-h-[56px] bg-white border border-slate-200 rounded-xl px-4 py-4 text-base font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none disabled:opacity-50"
                      value={grnForm.invoiceNumber ?? ''}
                      onChange={e => setGrnForm({ ...grnForm, invoiceNumber: e.target.value })}
                      disabled={!!grnForm.id}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-black text-slate-600 uppercase tracking-wider">Invoice Date</label>
                    <input
                      type="date"
                      className="w-full min-h-[56px] bg-white border border-slate-200 rounded-xl px-4 py-4 text-base font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none disabled:opacity-50"
                      value={grnForm.invoiceDate ?? ''}
                      onChange={e => setGrnForm({ ...grnForm, invoiceDate: e.target.value })}
                      disabled={!!grnForm.id}
                    />
                  </div>
                  {/* Row 2: Vendor Site | Location */}
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Vendor Site</label>
                    <select
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                      value={grnForm.vendorSiteId}
                      onChange={e => setGrnForm({ ...grnForm, vendorSiteId: e.target.value })}
                      disabled={isGrnReadOnly || selectedPO?.status === 'Approved'}
                    >
                      <option value="">Select Vendor Site</option>
                      {(masters['Vendor Site'] ?? []).filter((s: any) => s.vendorId === selectedPO.vendorId).map((s: any) => (
                        <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Location</label>
                    <select
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                      value={grnForm.location}
                      onChange={e => setGrnForm({ ...grnForm, location: e.target.value })}
                      disabled={isGrnReadOnly}
                    >
                      <option value="">Select Location</option>
                      {(selectedPO.centerNames || []).map((c: string) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  {/* Row 3: Shipping Address | Billing Address */}
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Shipping Address</label>
                    <select
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                      value={grnForm.shippingAddressId}
                      onChange={e => setGrnForm({ ...grnForm, shippingAddressId: e.target.value })}
                      disabled={isGrnReadOnly}
                    >
                      <option value="">Select Shipping Address</option>
                      {(masters['Entity'] ?? []).flatMap((ent: any) => ent.shippingAddresses || []).map((addr: any) => (
                        <option key={addr.id} value={addr.id}>{addr.address}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Billing Address</label>
                    <select
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                      value={grnForm.billingAddressId}
                      onChange={e => setGrnForm({ ...grnForm, billingAddressId: e.target.value })}
                      disabled={isGrnReadOnly}
                    >
                      <option value="">Select Billing Address</option>
                      {(masters['Entity'] ?? []).flatMap((ent: any) => ent.billingAddresses || []).map((addr: any) => (
                        <option key={addr.id} value={addr.id}>{addr.address}</option>
                      ))}
                    </select>
                  </div>
                  {/* Row 4: Department | Subdepartment (read-only) */}
                  <div className="space-y-2">
                    <label className="text-sm font-black text-slate-600 uppercase tracking-wider">Department</label>
                    <div className="w-full min-h-[56px] bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 text-base font-bold text-slate-700">
                      {grnForm.department || '—'}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-black text-slate-600 uppercase tracking-wider">Subdepartment</label>
                    <div className="w-full min-h-[56px] bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 text-base font-bold text-slate-700">
                      {grnForm.subDepartment || '—'}
                    </div>
                  </div>
                  {/* Row 5: GST */}
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-wider">GST</label>
                    <select
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                      value={grnForm.gst}
                      onChange={e => setGrnForm({ ...grnForm, gst: Number(e.target.value) })}
                      disabled={isGrnReadOnly}
                    >
                      <option value="0">Select GST</option>
                      {(masters['GST'] || []).map((g: any) => <option key={g.id} value={g.rate}>{g.name}</option>)}
                    </select>
                  </div>
                  {/* Row 6: Payment Terms | Terms & Conditions (read-only) */}
                  <div className="space-y-2">
                    <label className="text-sm font-black text-slate-600 uppercase tracking-wider">Payment Terms</label>
                    <div className="w-full min-h-[56px] bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 text-base font-bold text-slate-700">
                      {selectedPO?.paymentTerms || '—'}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-black text-slate-600 uppercase tracking-wider">Terms & Conditions</label>
                    <div className="w-full min-h-[56px] bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 text-base font-bold text-slate-700">
                      {(masters['Terms & Conditions'] ?? []).find((t: any) => t.id === selectedPO?.termsAndConditionsId)?.name || selectedPO?.termsAndConditionsId || '—'}
                    </div>
                  </div>
                </div>

                <div className="col-span-2 space-y-4 mt-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-sm font-black text-slate-700 uppercase tracking-wider">GRN Items</h4>
                    <div className="flex items-center space-x-4">
                      <button
                        onClick={() => downloadTemplate('GRN')}
                        className="text-indigo-600 text-xs font-black hover:underline flex items-center"
                      >
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        Download Template
                      </button>
                      <label className="cursor-pointer text-indigo-600 text-xs font-black hover:underline flex items-center">
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                        Bulk Upload
                        <input type="file" className="hidden" onChange={e => handleBulkUpload(e, 'GRN')} />
                      </label>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {(grnForm.items || []).map((grnItem) => {
                      const poItem = selectedPO.items?.find((i: ItemLine) => i.id === grnItem.id || i.id === grnItem.sourceItemId);
                      const maxQty = Number(grnItem.poLeftQty ?? (poItem ? Number(poItem.quantity) : 0)) || 0;
                      return (
                        <div key={grnItem.id} className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-2 items-end bg-slate-50 p-4 rounded-2xl border border-slate-100">
                          <div className="col-span-2 space-y-1 min-w-0">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Item Name</label>
                            <div className="text-sm font-bold text-slate-700 truncate">{grnItem.itemName}</div>
                          </div>
                          <div className="col-span-2 space-y-1 min-w-0">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Desc</label>
                            <input
                              type="text"
                              placeholder="Description"
                              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold bg-white disabled:opacity-50"
                              value={grnItem.desc ?? ''}
                              onChange={e => updateGrnItem(grnItem.id, 'desc', e.target.value)}
                              disabled={!!grnForm.id}
                            />
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Qty</label>
                            <input
                              type="number"
                              min={0}
                              className={`w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold bg-white disabled:opacity-50 ${(Number(grnItem.quantity) || 0) > maxQty ? 'border-red-500' : ''}`}
                              value={grnItem.quantity}
                              onChange={e => {
                                const qty = Number(e.target.value);
                                if (maxQty > 0 && qty > maxQty) {
                                  alert(`Cannot exceed remaining quantity of ${maxQty}`);
                                  return;
                                }
                                updateGrnItem(grnItem.id, 'quantity', qty);
                              }}
                              disabled={!!grnForm.id}
                            />
                            {maxQty > 0 && (Number(grnItem.quantity) || 0) > maxQty && (
                              <div className="text-[9px] font-bold text-rose-600">Cannot exceed remaining quantity of {maxQty}</div>
                            )}
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">PO Left Qty</label>
                            <div className="text-sm font-black text-indigo-700">{maxQty}</div>
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Rate (INR)</label>
                            <div className="text-sm font-bold text-slate-700">₹{(Number(grnItem.rate) || 0).toFixed(2)}</div>
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Base Amount</label>
                            <div className="text-sm font-bold text-slate-700">₹{(Number(grnItem.amount) || 0).toFixed(2)}</div>
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">GST</label>
                            <select
                              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold bg-white disabled:opacity-50"
                              value={grnItem.gst ?? ''}
                              onChange={e => updateGrnItem(grnItem.id, 'gst', Number(e.target.value))}
                              disabled={!!grnForm.id}
                            >
                              <option value="">Select GST</option>
                              {(masters.GST ?? masters['GST'] ?? []).map((g: { id: string; name: string; rate: number }) => (
                                <option key={g.id} value={g.rate}>{g.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">GST Amount</label>
                            <div className="text-sm font-bold text-slate-700">₹{(Number(grnItem.gstAmount) || 0).toFixed(2)}</div>
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Net Amount</label>
                            <div className="text-sm font-bold text-slate-700">₹{(Number(grnItem.totalAmount ?? grnItem.amount) || 0).toFixed(2)}</div>
                          </div>
                          <div className="col-span-2 space-y-1 min-w-0">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Remarks</label>
                            <input
                              type="text"
                              placeholder="Remarks"
                              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold bg-white disabled:opacity-50"
                              value={grnItem.remarks ?? ''}
                              onChange={e => updateGrnItem(grnItem.id, 'remarks', e.target.value)}
                              disabled={!!grnForm.id}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Tax & Amount Summary (INR) - GRN */}
                <div className="col-span-2 bg-slate-50 p-6 rounded-3xl border border-slate-200 mt-4 space-y-4">
                  <h4 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] border-b border-slate-200 pb-2">Tax & Amount Summary (INR)</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Base Amount</label>
                      <div className="text-sm font-bold text-slate-700">
                        ₹{(grnForm.items || []).reduce((sum, i) => sum + (Number(i.amount) || 0), 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total GST Amount</label>
                      <div className="text-sm font-bold text-emerald-500">
                        +₹{(grnForm.items || []).reduce((sum, i) => sum + (i.gstAmount || 0), 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Net Total Amount</label>
                      <div className="text-lg font-black text-indigo-700">
                        ₹{(grnForm.items || []).reduce((sum, i) => sum + (Number(i.totalAmount) || 0), 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="space-y-2 md:col-span-2 mt-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Overall summary</label>
                  <textarea
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium min-h-[80px] disabled:opacity-50"
                    value={grnForm.overallSummary ?? ''}
                    onChange={e => setGrnForm({ ...grnForm, overallSummary: e.target.value })}
                    disabled={!!grnForm.id && isGrnReadOnly}
                    placeholder="Overall summary (from PO by default; editable)"
                  />
                </div>
              </>
            )}

            {/* Invoice Form Fields */}
            {selectedGRN && (
              <>
                {(() => {
                  const invoiceVendorId =
                    selectedPO?.vendorId ||
                    purchaseOrders.find((p) => p.id === selectedGRN.purchaseOrderId)?.vendorId ||
                    '';
                  return (
                    <>
                <div className="col-span-2 bg-emerald-50 p-4 rounded-2xl border border-emerald-100 mb-4">
                  <p className="text-sm font-bold text-emerald-900">Auto-populated from {selectedGRN.id}</p>
                  <div className="grid grid-cols-3 gap-4 mt-2 text-xs">
                    <div><span className="text-emerald-400 uppercase">Invoice #:</span> {selectedGRN.invoiceNumber}</div>
                    <div><span className="text-emerald-400 uppercase">Qty:</span> {selectedGRN.items.reduce((sum, i) => sum + (i.quantity || 0), 0)}</div>
                    <div><span className="text-emerald-400 uppercase">Amount:</span> ₹{(Number(selectedGRN.amount) || 0).toFixed(2)}</div>
                    <div><span className="text-emerald-400 uppercase">Vendor Site:</span> {masters['Vendor Site']?.find(s => s.id === selectedGRN.vendorSiteId)?.name || 'N/A'}</div>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Vendor Site</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={invoiceForm.vendorSiteId}
                    onChange={e => setInvoiceForm({ ...invoiceForm, vendorSiteId: e.target.value })}
                    disabled={!invoiceVendorId}
                  >
                    <option value="">Select Vendor Site</option>
                    {(masters['Vendor Site'] ?? []).filter(s => s.vendorId === invoiceVendorId).map(s => (
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
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Invoice Location</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={invoiceForm.location}
                    onChange={e => setInvoiceForm({ ...invoiceForm, location: e.target.value })}
                  >
                    <option value="">Select Location</option>
                    {CENTERS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div className="col-span-2 space-y-4 mt-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-sm font-black text-slate-700 uppercase tracking-wider">Invoice Items</h4>
                    <div className="flex items-center space-x-4">
                      <button 
                        onClick={() => downloadTemplate('Invoice')}
                        className="text-indigo-600 text-xs font-black hover:underline flex items-center"
                      >
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                        Download Template
                      </button>
                      <label className="cursor-pointer text-indigo-600 text-xs font-black hover:underline flex items-center">
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                        Bulk Upload
                        <input type="file" className="hidden" onChange={e => handleBulkUpload(e, 'Invoice')} />
                      </label>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {selectedGRN.items.map((grnItem) => {
                      const invItem = invoiceForm.items?.find(i => i.id === grnItem.id) || { ...grnItem, quantity: grnItem.quantity, gst: grnItem.gst ?? 0, tds: grnItem.tds ?? 0 };
                      const base = (Number(invItem.quantity) || 0) * (Number(invItem.rate) || 0);
                      return (
                        <div key={grnItem.id} className="grid grid-cols-12 gap-2 items-end bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                          <div className="col-span-2 space-y-1 min-w-0">
                            <label className="text-[10px] font-black text-slate-400 uppercase">Item Name</label>
                            <div className="text-sm font-bold text-slate-700 truncate">{invItem.itemName}</div>
                          </div>
                          <div className="col-span-1 space-y-1 min-w-0">
                            <label className="text-[10px] font-black text-slate-400 uppercase">Desc</label>
                            <input
                              type="text"
                              placeholder="Description"
                              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                              value={invItem.desc ?? ''}
                              onChange={e => updateInvoiceItem(grnItem.id, 'desc', e.target.value)}
                            />
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase">Qty</label>
                            <input
                              type="number"
                              min={0}
                              className={`w-full bg-white border rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 ${(Number(invItem.quantity) || 0) > grnItem.quantity ? 'border-red-500' : 'border-slate-200'}`}
                              value={invItem.quantity}
                              onChange={e => {
                                const qty = Number(e.target.value);
                                if (qty > grnItem.quantity) {
                                  alert(`Invoice quantity (${qty}) cannot be greater than GRN quantity (${grnItem.quantity})`);
                                  return;
                                }
                                updateInvoiceItem(grnItem.id, 'quantity', qty);
                              }}
                            />
                            {(Number(invItem.quantity) || 0) > grnItem.quantity && <div className="text-[8px] text-red-500 font-bold uppercase">Exceeds GRN Qty</div>}
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase">Base Amount</label>
                            <div className="text-sm font-bold text-slate-700">₹{(Number(invItem.amount) || base).toFixed(2)}</div>
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase">GST</label>
                            <select
                              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                              value={invItem.gst ?? ''}
                              onChange={e => updateInvoiceItem(grnItem.id, 'gst', Number(e.target.value))}
                            >
                              <option value="">Select GST</option>
                              {(masters['GST'] ?? masters.GST ?? []).map((g: { id: string; name: string; rate: number }) => (
                                <option key={g.id} value={g.rate}>{g.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase">GST Amount</label>
                            <div className="text-sm font-bold text-slate-700">₹{(Number(invItem.gstAmount) || 0).toFixed(2)}</div>
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase">TDS</label>
                            <select
                              className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                              value={invItem.tds ?? ''}
                              onChange={e => updateInvoiceItem(grnItem.id, 'tds', Number(e.target.value))}
                            >
                              <option value="">Select TDS</option>
                              {(masters['TDS'] ?? masters.TDS ?? []).map((t: { id: string; name: string; rate: number }) => (
                                <option key={t.id} value={t.rate}>{t.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase">TDS Amount</label>
                            <div className="text-sm font-bold text-red-600">₹{(Number(invItem.tdsAmount) || 0).toFixed(2)}</div>
                          </div>
                          <div className="col-span-1 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase">Net Amount</label>
                            <div className="text-sm font-black text-indigo-600">₹{(Number(invItem.totalAmount) ?? base).toFixed(2)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Tax & Amount Summary (INR) - Invoice */}
                <div className="col-span-2 bg-slate-50 p-6 rounded-3xl border border-slate-200 mt-4 space-y-4">
                  <h4 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] border-b border-slate-200 pb-2">Tax & Amount Summary (INR)</h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Base Amount</label>
                      <div className="text-sm font-bold text-slate-700">
                        ₹{(invoiceForm.items || []).reduce((sum, i) => sum + (Number(i.amount) || 0), 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total TDS Amount</label>
                      <div className="text-sm font-bold text-red-500">
                        -₹{(invoiceForm.items || []).reduce((sum, i) => sum + (i.tdsAmount || 0), 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total GST Amount</label>
                      <div className="text-sm font-bold text-emerald-500">
                        +₹{(invoiceForm.items || []).reduce((sum, i) => sum + (i.gstAmount || 0), 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Net Total Amount</label>
                      <div className="text-lg font-black text-indigo-700">
                        ₹{(invoiceForm.items || []).reduce((sum, i) => sum + (Number(i.totalAmount) || 0), 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="space-y-2 col-span-2 mt-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Overall summary</label>
                  <textarea
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium min-h-[80px]"
                    value={invoiceForm.overallSummary ?? ''}
                    onChange={e => setInvoiceForm({ ...invoiceForm, overallSummary: e.target.value })}
                    placeholder="Overall summary (from GRN by default; editable)"
                  />
                </div>
                    </>
                  );
                })()}
              </>
            )}

            {/* Document Upload Section */}
            <div className="col-span-2 border-t border-slate-100 pt-6 mt-4">
              <div className="flex justify-between items-center mb-4">
                <h4 className="text-sm font-black text-slate-700 uppercase tracking-wider">Supporting Documents</h4>
                <label className="cursor-pointer">
                  <span className="text-indigo-600 text-xs font-black hover:underline">+ Upload File</span>
                  <input 
                    type="file" 
                    className="hidden" 
                    onChange={(e) => handleFileUpload(e, selectedPO ? (selectedGRN ? 'Invoice' : 'GRN') : 'PO')}
                  />
                </label>
              </div>
              
              <div className="space-y-2">
                {/* Show inherited documents */}
                {selectedPO && selectedPO.attachments.map(att => (
                  <div key={att.id} className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <div className="flex items-center space-x-3">
                      <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </div>
                      <span className="text-sm font-medium text-slate-600">{att.name} <span className="text-[10px] text-indigo-400 font-black uppercase ml-2">From PO</span></span>
                    </div>
                  </div>
                ))}
                {selectedGRN && selectedGRN.attachments.map(att => (
                  <div key={att.id} className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <div className="flex items-center space-x-3">
                      <div className="bg-emerald-100 p-2 rounded-lg text-emerald-600">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </div>
                      <span className="text-sm font-medium text-slate-600">{att.name} <span className="text-[10px] text-emerald-400 font-black uppercase ml-2">From GRN</span></span>
                    </div>
                  </div>
                ))}
                {/* Show current form documents */}
                {(selectedPO ? (selectedGRN ? invoiceForm : grnForm) : poForm).attachments?.map(att => (
                  <div key={att.id} className="flex items-center justify-between bg-white p-3 rounded-xl border-2 border-indigo-100 border-dashed">
                    <div className="flex items-center space-x-3">
                      <div className="bg-indigo-600 p-2 rounded-lg text-white">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </div>
                      <span className="text-sm font-bold text-slate-800">{att.name}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-8 flex justify-end space-x-4">
            <button 
              onClick={() => { setShowForm(false); resetForms(); }}
              className="px-6 py-3 rounded-xl font-black text-slate-500 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button 
              onClick={selectedPO ? (selectedGRN ? handleCreateInvoice : handleCreateGRN) : handleCreatePO}
              className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-indigo-200 hover:scale-105 transition-transform"
            >
              Submit for Approval
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden">
          <table className="w-full table-fixed text-left border-collapse">
            <colgroup>
              <col style={{ width: '14%' }} />
              <col style={{ width: '28%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '30%' }} />
            </colgroup>
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Transaction No.</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Date</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Vendor Name</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Status</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {viewMode === 'PO' && filteredPurchaseOrders.map(po => (
                <tr key={po.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="text-sm font-black text-slate-900">{po.id}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-slate-700">{po.createdAt ? new Date(po.createdAt).toLocaleDateString() : '—'}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-slate-700">{(masters.Vendor ?? []).find(v => v.id === po.vendorId)?.name}</div>
                    <div className="text-xs text-slate-500">{po.items.length} Items • {po.centerNames.length} Centers • ₹{(Number(po.amount) || 0).toFixed(2)}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col space-y-1">
                      <button
                        onClick={() => { setSelectedAuditDoc(po); setShowAuditModal(true); }}
                        className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider w-fit ${
                        po.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : 
                        po.status === 'Budget Hold' ? 'bg-rose-100 text-rose-700' :
                        'bg-amber-100 text-amber-700'
                        }`}
                        title="View audit log"
                      >
                        {po.status}
                      </button>
                      {po.status === 'Pending' && (
                        <div className="text-[10px] font-bold text-slate-400">
                          Step {po.currentStepIndex + 1}
                        </div>
                      )}
                      {po.isUnbudgeted && (
                        <span className="px-2 py-0.5 bg-amber-50 text-amber-600 text-[8px] font-black uppercase border border-amber-200 rounded w-fit">
                          Unbudgeted
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col space-y-2">
                      <div className="flex space-x-2">
                        {canCompleteReview(po) && (
                          <button onClick={() => completeReviewPO(po.id)} className="text-xs font-black text-amber-600 hover:underline">Complete Review</button>
                        )}
                        {canApprove(po) && (
                          <button onClick={() => approvePO(po.id)} className="text-xs font-black text-emerald-600 hover:underline">Approve</button>
                        )}
                        {po.status === 'Approved' && (
                          <>
                            {(() => {
                              const fullyReceived = isPoFullyReceived(po);
                              const windowInfo = getPoWindowInfo(po);
                              const disabled = fullyReceived || !windowInfo.canCreate;
                              return (
                                <button
                                  onClick={() => {
                                    if (disabled) return;
                                    openPoGrnSelectionModal(po);
                                  }}
                                  disabled={disabled || poRemainingLoading}
                                  className={`text-xs font-black hover:underline ${disabled ? 'text-slate-400 cursor-not-allowed' : 'text-indigo-600'}`}
                                  title={disabled ? (fullyReceived ? 'All items fully received' : windowInfo.message) : 'Create GRN'}
                                >
                                  {fullyReceived ? 'Fully Received' : 'Create GRN'}
                                </button>
                              );
                            })()}
                            {!isPoFullyReceived(po) && (
                              <button 
                                onClick={() => amendPO(po.id)}
                                className="text-xs font-black text-slate-600 hover:underline"
                              >
                                Amend
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      {po.status === 'Approved' && (
                        <div className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                          <Info className="w-3 h-3" />
                          {getPoWindowInfo(po).message}
                        </div>
                      )}
                      
                      {/* Budget Visibility during Approval */}
                      {po.status === 'Pending' && !po.isUnbudgeted && (
                        <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 space-y-1 mt-1">
                          <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Budget Check</div>
                          {po.items.map((item, idx) => {
                            const budget = getBudgetForDocumentAndCoaCode(budgetsForDeduction, item.coaCode, po) as Budget | undefined;
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
              ))}

              {viewMode === 'GRN' && filteredPoGrns.map(grn => {
                const po = purchaseOrders.find(p => p.id === grn.purchaseOrderId);
                return (
                  <tr key={grn.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="text-sm font-black text-slate-900">{grn.id}</div>
                      <div className="text-[10px] text-slate-400 font-bold">Against {grn.purchaseOrderId}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-slate-700">{grn.location}</div>
                      <div className="text-xs text-slate-500">Inv: {grn.invoiceNumber} • {grn.items.length} Items • Total: ₹{(Number(grn.amount) || 0).toFixed(2)}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col space-y-1">
                        <button
                          onClick={() => { setSelectedAuditDoc(grn); setShowAuditModal(true); }}
                          className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider w-fit ${
                          grn.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                          }`}
                          title="View audit log"
                        >
                          {grn.status}
                        </button>
                        {grn.status === 'Pending' && (
                          <div className="text-[10px] font-bold text-slate-400">
                            Step {grn.currentStepIndex + 1}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex space-x-2">
                        {canCompleteReview(grn) && (
                          <button onClick={() => completeReviewGRN(grn.id)} className="text-xs font-black text-amber-600 hover:underline">Complete Review</button>
                        )}
                        {canApprove(grn) && (
                          <button onClick={() => approveGRN(grn.id)} className="text-xs font-black text-emerald-600 hover:underline">Approve</button>
                        )}
                        {grn.status === 'Approved' && (
                          <>
                            <button 
                              onClick={() => { 
                                const resolvedPO = po || purchaseOrders.find(p => p.id === grn.purchaseOrderId) || null;
                                setSelectedPO(resolvedPO); 
                                setSelectedGRN(grn);
                                setInvoiceForm({
                                  entityName: grn.entityName,
                                  vendorSiteId: grn.vendorSiteId || '',
                                  location: grn.location || '',
                                  shippingAddressId: grn.shippingAddressId || '',
                                  billingAddressId: grn.billingAddressId || '',
                                  remarks: grn.remarks || '',
                                  overallSummary: grn.overallSummary || '',
                                  items: (grn.items || []).map(i => ({ ...i })),
                                  amount: Number(grn.amount) || 0,
                                  attachments: []
                                });
                                setShowForm(true); 
                              }}
                              className="text-xs font-black text-indigo-600 hover:underline"
                            >
                              Create Invoice
                            </button>
                            <button 
                              onClick={() => reverseGRN(grn.id)}
                              className="text-xs font-black text-rose-600 hover:underline"
                            >
                              Reverse
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {viewMode === 'Invoice' && filteredPoInvoices.map(inv => (
                <tr key={inv.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="text-sm font-black text-slate-900">{inv.id}</div>
                    <div className="text-[10px] text-slate-400 font-bold">Against {inv.grnId}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-slate-700">{inv.location}</div>
                    <div className="text-xs text-slate-500">{new Date(inv.createdAt).toLocaleDateString()}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col space-y-1">
                      <button
                        onClick={() => { setSelectedAuditDoc(inv); setShowAuditModal(true); }}
                        className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider w-fit ${
                        inv.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
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
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex space-x-2">
                      {canCompleteReview(inv) && (
                        <button onClick={() => completeReviewInvoice(inv.id)} className="text-xs font-black text-amber-600 hover:underline">Complete Review</button>
                      )}
                      {canApprove(inv) && (
                        <button onClick={() => approveInvoice(inv.id)} className="text-xs font-black text-emerald-600 hover:underline">Approve</button>
                      )}
                      {inv.status === 'Approved' && (
                        <button 
                          onClick={() => reverseInvoice(inv.id)}
                          className="text-xs font-black text-rose-600 hover:underline"
                        >
                          Reverse
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {((viewMode === 'PO' && purchaseOrders.length === 0) ||
                (viewMode === 'GRN' && poGrns.length === 0) ||
                (viewMode === 'Invoice' && poInvoices.length === 0)) && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400 font-medium">
                    No records found for {viewMode}
                  </td>
                </tr>
              )}
              {viewMode === 'PO' && purchaseOrders.length > 0 && filteredPurchaseOrders.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500 text-sm font-bold">
                    No records match your filters.
                  </td>
                </tr>
              )}
              {viewMode === 'GRN' && poGrns.length > 0 && filteredPoGrns.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500 text-sm font-bold">
                    No records match your filters.
                  </td>
                </tr>
              )}
              {viewMode === 'Invoice' && poInvoices.length > 0 && filteredPoInvoices.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500 text-sm font-bold">
                    No records match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showPoGrnItemModal && poForGrnSelection && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="w-full max-w-6xl bg-white rounded-3xl border border-slate-200 shadow-2xl max-h-[90vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900">Select Items for GRN</h3>
                <p className="text-xs font-bold text-slate-500 mt-1">PO: {poForGrnSelection.id}</p>
                <p className="text-xs font-bold text-indigo-600 mt-1 flex items-center gap-1"><Info className="w-3 h-3" />{getPoWindowInfo(poForGrnSelection).message}</p>
              </div>
              <button onClick={closePoGrnSelectionModal} className="text-slate-400 hover:text-slate-600 font-black">✕</button>
            </div>
            <div className="p-6 overflow-auto max-h-[65vh]">
              {poRemainingLoading && <div className="text-sm font-bold text-slate-500">Loading remaining quantities...</div>}
              {poRemainingError && <div className="text-sm font-bold text-rose-600">{poRemainingError}</div>}
              {!poRemainingLoading && !poRemainingError && (
                <table className="w-full table-fixed border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-y border-slate-200">
                      <th className="px-2 py-2 text-left text-[10px] font-black text-slate-500 uppercase">Select</th>
                      <th className="px-2 py-2 text-left text-[10px] font-black text-slate-500 uppercase">Item Name</th>
                      <th className="px-2 py-2 text-left text-[10px] font-black text-slate-500 uppercase">Ordered Qty</th>
                      <th className="px-2 py-2 text-left text-[10px] font-black text-slate-500 uppercase">Received Qty</th>
                      <th className="px-2 py-2 text-left text-[10px] font-black text-slate-500 uppercase">Left Qty</th>
                      <th className="px-2 py-2 text-left text-[10px] font-black text-slate-500 uppercase">Receive Qty</th>
                      <th className="px-2 py-2 text-left text-[10px] font-black text-slate-500 uppercase">Center</th>
                      <th className="px-2 py-2 text-left text-[10px] font-black text-slate-500 uppercase">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {poRemainingItems.map((it, idx) => {
                      const key = poRemainingKey(it, idx);
                      const left = Number(it.leftQty) || 0;
                      const selected = !!poSelectedByKey[key];
                      const receive = Number(poReceiveQtyByKey[key] ?? 0);
                      const invalid = selected && (receive <= 0 || receive > left);
                      return (
                        <tr key={key} className={`border-b border-slate-100 ${left <= 0 ? 'bg-slate-50 opacity-70' : ''}`}>
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={selected}
                              disabled={left <= 0}
                              onChange={(e) => setPoSelectedByKey((prev) => ({ ...prev, [key]: e.target.checked }))}
                            />
                          </td>
                          <td className="px-2 py-2 text-sm font-bold text-slate-800">
                            {it.itemName} {left <= 0 && <span className="text-[10px] text-slate-400 ml-1">Fully received</span>}
                          </td>
                          <td className="px-2 py-2 text-sm font-bold text-slate-700">{it.orderedQty}</td>
                          <td className="px-2 py-2 text-sm font-bold text-slate-700">{it.receivedQty}</td>
                          <td className="px-2 py-2 text-sm font-black text-indigo-700">{left}</td>
                          <td className="px-2 py-2">
                            <input
                              type="number"
                              min={0}
                              max={left}
                              disabled={left <= 0}
                              className={`w-24 border rounded-lg px-2 py-1 text-sm font-bold ${invalid ? 'border-rose-500' : 'border-slate-200'}`}
                              value={receive}
                              onChange={(e) => setPoReceiveQtyByKey((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                            />
                            {invalid && <div className="text-[10px] text-rose-600 font-bold mt-1">Must be 1 to {left}</div>}
                          </td>
                          <td className="px-2 py-2 text-sm font-bold text-slate-700">{it.center || '-'}</td>
                          <td className="px-2 py-2 text-sm font-bold text-slate-700">₹{(Number(it.rate) || 0).toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={closePoGrnSelectionModal} className="px-5 py-2 rounded-xl font-black text-slate-600 hover:bg-slate-100">Cancel</button>
              <button onClick={proceedPoGrnSelection} className="px-5 py-2 rounded-xl font-black text-white bg-indigo-600 hover:bg-indigo-700">Proceed to GRN</button>
            </div>
          </div>
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

export default PurchaseOrderModule;
