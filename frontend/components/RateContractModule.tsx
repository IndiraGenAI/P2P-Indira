
import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import { 
  RateContract, GRN, Invoice, MasterRecord, MasterType, 
  Frequency, Attachment, ItemLine,
  User, WorkflowRule, ModuleType, ApprovalType, WorkflowV2Rule, PurchaseOrder
} from '../types';
import { CENTERS } from '../constants';
import { getDepartments, getSubdepartmentsForDepartment, getItemTypesFromMasters } from '../utils/mastersHelpers';
import { filterByWorkflowApproval } from '../utils/workflowV2Filters';
import {
  getGrnVendorId,
  getRcInvoiceVendorId,
  inCreatedAtRange,
  matchesStatusQuickFilter,
  matchesVendorFilter,
  textIncludes,
} from '../utils/transactionListFilters';
import MultiSelect from './MultiSelect';
import TransactionListFilterBar, { ListStatusQuick } from './TransactionListFilterBar';
import SearchableSelect from './SearchableSelect';

interface RateContractModuleProps {
  masters: Record<MasterType, MasterRecord[]>;
  rateContracts: RateContract[];
  setRateContracts: React.Dispatch<React.SetStateAction<RateContract[]>>;
  grns: GRN[];
  setGrns: React.Dispatch<React.SetStateAction<GRN[]>>;
  invoices: Invoice[];
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  currentUser: User;
  workflows: WorkflowRule[];
  workflowV2Rules?: WorkflowV2Rule[];
}

type ViewMode = 'RC' | 'GRN' | 'Invoice';

const RateContractModule: React.FC<RateContractModuleProps> = ({ 
  masters, rateContracts, setRateContracts, grns, setGrns, invoices, setInvoices, currentUser, workflows, workflowV2Rules = []
}) => {
  const vendorsForDropdown = filterByWorkflowApproval(workflowV2Rules, 'Vendor', masters.Vendor ?? []) as MasterRecord[];
  const itemsForDropdown = filterByWorkflowApproval(workflowV2Rules, 'Item', masters.Item ?? []) as MasterRecord[];
  const [viewMode, setViewMode] = useState<ViewMode>('RC');
  
  const [showForm, setShowForm] = useState(false);
  const [updateSuccessMessage, setUpdateSuccessMessage] = useState(false);
  const [selectedRC, setSelectedRC] = useState<RateContract | null>(null);
  const [selectedGRN, setSelectedGRN] = useState<GRN | null>(null);

  // Form states
  const [rcForm, setRcForm] = useState<Partial<RateContract>>({
    entityName: masters.Entity?.[0]?.name || '',
    vendorId: '',
    vendorSiteId: '',
    transactionType: getItemTypesFromMasters(masters)[0]?.name ?? '',
    validFrom: '',
    validTo: '',
    requiredDate: '',
    frequency: 'Monthly',
    department: '',
    subDepartment: '',
    paymentTerms: '',
    items: [{ id: Math.random().toString(), itemName: '', quantity: 1, rate: 0, amount: 0, centerName: '', remarks: '' }],
    amount: 0,
    remarks: '',
    attachments: [],
    shippingAddressId: '',
    billingAddressId: ''
  });

  const [grnForm, setGrnForm] = useState<Partial<GRN>>({
    entityName: masters.Entity?.[0]?.name || '',
    vendorSiteId: '',
    location: '',
    items: [],
    amount: 0,
    remarks: '',
    attachments: [],
    shippingAddressId: '',
    billingAddressId: '',
    tds: 0,
    gst: 0
  });

  const [invoiceForm, setInvoiceForm] = useState<Partial<Invoice>>({
    entityName: masters.Entity?.[0]?.name || '',
    vendorSiteId: '',
    location: '',
    attachments: [],
    shippingAddressId: '',
    billingAddressId: '',
    tds: 0,
    gst: 0,
    items: []
  });

  const [bulkUploadType, setBulkUploadType] = useState<'RC' | 'GRN' | 'Invoice' | null>(null);

  const [listStatusQuick, setListStatusQuick] = useState<ListStatusQuick>('all');
  const [listDateFrom, setListDateFrom] = useState('');
  const [listDateTo, setListDateTo] = useState('');
  const [listVendorId, setListVendorId] = useState('');
  const [colRcId, setColRcId] = useState('');
  const [colRcDetails, setColRcDetails] = useState('');
  const [colRcStatus, setColRcStatus] = useState('');
  const [colGrnId, setColGrnId] = useState('');
  const [colGrnDetails, setColGrnDetails] = useState('');
  const [colGrnStatus, setColGrnStatus] = useState('');
  const [colInvId, setColInvId] = useState('');
  const [colInvDetails, setColInvDetails] = useState('');
  const [colInvStatus, setColInvStatus] = useState('');

  useEffect(() => {
    setListStatusQuick('all');
    setListDateFrom('');
    setListDateTo('');
    setListVendorId('');
    setColRcId('');
    setColRcDetails('');
    setColRcStatus('');
    setColGrnId('');
    setColGrnDetails('');
    setColGrnStatus('');
    setColInvId('');
    setColInvDetails('');
    setColInvStatus('');
  }, [viewMode]);

  // Update total amount whenever items change
  useEffect(() => {
    const total = (rcForm.items || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    setRcForm(prev => ({ ...prev, amount: total }));
  }, [rcForm.items]);

  // Recalculate GRN items when form-level TDS or GST changes (preserve per-line GST)
  useEffect(() => {
    if (grnForm.id || !selectedRC || !grnForm.items?.length) return;
    const vendor = (masters.Vendor ?? []).find((v: any) => v.id === selectedRC.vendorId);
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
  }, [grnForm.tds, grnForm.gst, grnForm.location, selectedRC?.vendorId, selectedRC?.id]);

  // Recalculate Invoice items when form-level TDS or GST changes (preserve per-line GST/TDS)
  useEffect(() => {
    if (invoiceForm.id || !selectedGRN || !invoiceForm.items?.length) return;
    const rc = rateContracts.find(r => r.id === selectedGRN.rateContractId);
    const vendor = rc ? (masters.Vendor ?? []).find((v: any) => v.id === rc.vendorId) : null;
    const center = (masters.Center ?? []).find((c: any) => c.name === invoiceForm.location);
    const isIntraState = vendor && center && (vendor as any).state === (center as any).state;

    setInvoiceForm(prev => {
      const updatedItems = (prev.items || []).map((item: ItemLine) => {
        const qty = Number(item.quantity) || 0;
        const rate = Number(item.rate) || 0;
        const base = qty * rate;
        const tdsPercent = item.tds ?? prev.tds ?? 0;
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
  }, [invoiceForm.tds, invoiceForm.gst, invoiceForm.location, selectedGRN?.id, rateContracts]);

  const updateInvoiceItem = (itemId: string, field: 'quantity' | 'gst' | 'tds' | 'remarks', value: number | string) => {
    if (!selectedGRN) return;
    if (field === 'remarks') {
      setInvoiceForm(prev => ({
        ...prev,
        items: (prev.items || []).map(i => i.id === itemId ? { ...i, remarks: String(value ?? '') } : i)
      }));
      return;
    }
    const rc = rateContracts.find(r => r.id === selectedGRN.rateContractId);
    const vendor = rc ? (masters.Vendor ?? []).find((v: any) => v.id === rc.vendorId) : null;
    const center = (masters.Center ?? []).find((c: any) => c.name === invoiceForm.location);
    const isIntraState = vendor && center && (vendor as any).state === (center as any).state;

    setInvoiceForm(prev => {
      const items = (prev.items || []).map(i => {
        if (i.id !== itemId) return i;
        const qty = field === 'quantity' ? (value as number) : (Number(i.quantity) || 0);
        const rate = Number(i.rate) || 0;
        const base = qty * rate;
        const gstPercent = field === 'gst' ? (value as number) : (i.gst ?? prev.gst ?? 0);
        const tdsPercent = field === 'tds' ? (value as number) : (i.tds ?? prev.tds ?? 0);
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

  const updateGrnItem = (itemId: string, field: 'quantity' | 'remarks' | 'gst', value: number | string) => {
    if (!selectedRC) return;
    const vendor = (masters.Vendor ?? []).find((v: any) => v.id === selectedRC.vendorId);
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
        return { ...i, remarks: String(value ?? '') };
      });
      const amount = items.reduce((sum, i) => sum + (Number(i.totalAmount) || 0), 0);
      return { ...prev, items, amount };
    });
  };

  const downloadTemplate = (type: 'RC' | 'GRN' | 'Invoice') => {
    let headers = '';
    if (type === 'RC') headers = 'Item Name,Center,Rate,Remarks';
    else headers = 'Item Name,Qty,Rate,Remarks';

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

  const addItem = () => {
    setRcForm(prev => ({
      ...prev,
      items: [...(prev.items || []), { id: Math.random().toString(), itemName: '', quantity: 1, rate: 0, amount: 0, centerName: '', remarks: '' }]
    }));
  };

  const removeItem = (id: string) => {
    setRcForm(prev => ({
      ...prev,
      items: (prev.items || []).filter(i => i.id !== id)
    }));
  };

  const updateItem = (id: string, field: keyof ItemLine, value: any) => {
    setRcForm(prev => {
      return {
        ...prev,
        items: (prev.items || []).map(item => {
          if (item.id !== id) return item;
          const updated = { ...item, [field]: value };
          if (field === 'centerNames') {
            updated.centerName = Array.isArray(value) && value.length > 0 ? value[0] : undefined;
          }
          if (field === 'quantity' || field === 'rate') {
            const qty = updated.quantity || 0;
            const rate = updated.rate || 0;
            updated.amount = qty * rate;
          }
          return updated;
        })
      };
    });
  };

  const handleBulkUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'RC' | 'GRN' | 'Invoice') => {
    const file = e.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
        complete: (results) => {
        const data = results.data as any[];
        const newItems: ItemLine[] = data.map((row: any) => {
          const itemName = row['Item Name'] || row['itemName'] || '';
          const qty = type === 'RC' ? 1 : parseFloat(row['Qty'] || row['quantity'] || '0');
          const rate = parseFloat(row['Rate'] || row['rate'] || '0');
          const centerName = row['Center'] || row['centerName'] || '';
          const base = qty * rate;
          return {
            id: Math.random().toString(),
            itemName,
            quantity: qty,
            rate,
            amount: base,
            centerName,
            centerNames: centerName ? [centerName] : [],
            remarks: row['Remarks'] || row['remarks'] || ''
          };
        });

        if (type === 'RC') {
          setRcForm(prev => ({ ...prev, items: newItems }));
        } else if (type === 'GRN' && selectedRC) {
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

  const handleCreateRC = () => {
    // Validation
    if (!rcForm.vendorId || !rcForm.department || !rcForm.subDepartment) {
      alert('Please fill all mandatory header fields.');
      return;
    }
    if ((rcForm.items || []).some(i => !i.itemName || !i.remarks || (!(i.centerNames?.length) && !i.centerName))) {
      alert('Item Name, Center, and Remarks are mandatory for all item lines.');
      return;
    }

    const itemsWithLocked = (rcForm.items || []).map(item => ({
      ...item,
      centerNames: getItemCenters(item),
      centerNamesLocked: getItemCenters(item),
      centerName: getItemCenters(item)[0]
    }));
    const newRC: RateContract = {
      ...rcForm as RateContract,
      id: `RC-${Math.floor(Math.random() * 10000)}`,
      status: 'Pending',
      currentStepIndex: 0,
      createdAt: new Date().toISOString(),
      createdBy: currentUser.id,
      attachments: rcForm.attachments || [],
      items: itemsWithLocked
    };
    setRateContracts([...rateContracts, newRC]);
    setShowForm(false);
    resetForms();
  };

  const handleCreateGRN = () => {
    if (!selectedRC) return;
    const newGRN: GRN = {
      ...grnForm as GRN,
      id: `GRN-${Math.floor(Math.random() * 10000)}`,
      entityName: selectedRC.entityName,
      rateContractId: selectedRC.id,
      status: 'Pending',
      currentStepIndex: 0,
      createdAt: new Date().toISOString(),
      createdBy: currentUser.id,
      attachments: grnForm.attachments || []
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
      department: selectedGRN.department,
      subDepartment: selectedGRN.subDepartment,
      status: 'Pending',
      currentStepIndex: 0,
      createdAt: new Date().toISOString(),
      createdBy: currentUser.id,
      attachments: invoiceForm.attachments || []
    };
    setInvoices([...invoices, newInvoice]);
    setShowForm(false);
    resetForms();
  };

  const resetForms = () => {
    setRcForm({
      entityName: masters.Entity?.[0]?.name || '',
      vendorId: '', vendorSiteId: '', transactionType: getItemTypesFromMasters(masters)[0]?.name ?? '', validFrom: '', validTo: '', requiredDate: '',
      frequency: 'Monthly', department: '', subDepartment: '', paymentTerms: '',
      items: [{ id: Math.random().toString(), itemName: '', quantity: 1, rate: 0, amount: 0, centerName: '', remarks: '' }],
      amount: 0, remarks: '', attachments: [],
      shippingAddressId: '', billingAddressId: ''
    });
    setGrnForm({ vendorSiteId: '', location: '', items: [], amount: 0, remarks: '', attachments: [], shippingAddressId: '', billingAddressId: '', tds: 0, gst: 0, invoiceNumber: '', invoiceDate: '' });
    setInvoiceForm({ vendorSiteId: '', location: '', attachments: [], shippingAddressId: '', billingAddressId: '', tds: 0, gst: 0, items: [], invoiceNumber: '', invoiceDate: '' });
    setSelectedRC(null);
    setSelectedGRN(null);
  };

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

    if (source === 'RC') setRcForm(prev => ({ ...prev, attachments: [...(prev.attachments || []), newAttachment] }));
    if (source === 'GRN') setGrnForm(prev => ({ ...prev, attachments: [...(prev.attachments || []), newAttachment] }));
    if (source === 'Invoice') setInvoiceForm(prev => ({ ...prev, attachments: [...(prev.attachments || []), newAttachment] }));
    
    // Reset input
    e.target.value = '';
  };

  const canApprove = (doc: RateContract | GRN | Invoice) => {
    if (doc.status !== 'Pending') return false;
    
    let moduleType: ModuleType;
    if ('grnId' in doc) {
      moduleType = ModuleType.INVOICE_GRN;
    } else if ('rateContractId' in doc) {
      moduleType = ModuleType.GRN;
    } else {
      moduleType = ModuleType.RATE_CONTRACT;
    }

    const rule = workflows.find(w => 
      w.entityName === doc.entityName &&
      w.moduleType === moduleType &&
      w.subDepartment === doc.subDepartment &&
      (!w.centerName || (doc as any).items?.some((i: any) => ((i.centerNames?.length ? i.centerNames : (i.centerName ? [i.centerName] : [])).includes(w.centerName))) || (doc as any).location === w.centerName) &&
      Number(doc.amount) >= Number(w.minAmount) && 
      (w.maxAmount == null || Number(doc.amount) <= Number(w.maxAmount))
    );

    if (!rule) {
      const anyRuleForModule = workflows.some(w => w.moduleType === moduleType);
      return !anyRuleForModule;
    }
    if (rule.approvalChain.length === 0) return true;

    const currentStep = rule.approvalChain[doc.currentStepIndex];
    if (!currentStep) return false;

    return currentStep.type === ApprovalType.APPROVER && currentStep.userIds.includes(currentUser.id);
  };

  const canCompleteReview = (doc: RateContract | GRN | Invoice) => {
    if (doc.status !== 'Pending') return false;
    let moduleType: ModuleType;
    if ('grnId' in doc) {
      moduleType = ModuleType.INVOICE_GRN;
    } else if ('rateContractId' in doc) {
      moduleType = ModuleType.GRN;
    } else {
      moduleType = ModuleType.RATE_CONTRACT;
    }
    const rule = workflows.find(w =>
      w.entityName === doc.entityName &&
      w.moduleType === moduleType &&
      w.subDepartment === doc.subDepartment &&
      (!w.centerName || (doc as any).items?.some((i: any) => ((i.centerNames?.length ? i.centerNames : (i.centerName ? [i.centerName] : [])).includes(w.centerName))) || (doc as any).location === w.centerName) &&
      Number(doc.amount) >= Number(w.minAmount) &&
      (w.maxAmount == null || Number(doc.amount) <= Number(w.maxAmount))
    );
    if (!rule) return false;
    const currentStep = rule.approvalChain[doc.currentStepIndex];
    if (!currentStep) return false;
    return currentStep.type === ApprovalType.REVIEWER && currentStep.userIds.includes(currentUser.id);
  };

  const completeReviewRC = (id: string) => {
    setRateContracts(rateContracts.map(rc => {
      if (rc.id !== id) return rc;
      const rule = workflows.find(w =>
        w.entityName === rc.entityName &&
        w.moduleType === ModuleType.RATE_CONTRACT &&
        w.subDepartment === rc.subDepartment &&
        (!w.centerName || rc.items.some(i => getItemCenters(i).includes(w.centerName))) &&
        Number(rc.amount) >= Number(w.minAmount) &&
        (w.maxAmount == null || Number(rc.amount) <= Number(w.maxAmount))
      );
      if (!rule || rc.currentStepIndex >= rule.approvalChain.length - 1) return rc;
      return { ...rc, currentStepIndex: rc.currentStepIndex + 1 };
    }));
  };

  const completeReviewGRN = (id: string) => {
    setGrns(grns.map(grn => {
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
      return { ...grn, currentStepIndex: grn.currentStepIndex + 1 };
    }));
  };

  const completeReviewInvoice = (id: string) => {
    setInvoices(invoices.map(inv => {
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
      return { ...inv, currentStepIndex: inv.currentStepIndex + 1 };
    }));
  };

  const [rejectionRemarks, setRejectionRemarks] = useState('');
  const [showRejectionModal, setShowRejectionModal] = useState<{ id: string, type: 'RC' | 'GRN' | 'Invoice' } | null>(null);

  const handleReject = (id: string, type: 'RC' | 'GRN' | 'Invoice') => {
    if (!rejectionRemarks) {
      alert('Please provide rejection remarks.');
      return;
    }

    if (type === 'RC') {
      setRateContracts(prev => prev.map(rc => rc.id === id ? { ...rc, status: 'Rejected', rejectionRemarks, currentStepIndex: 0 } : rc));
    } else if (type === 'GRN') {
      setGrns(prev => prev.map(grn => grn.id === id ? { ...grn, status: 'Rejected', rejectionRemarks, currentStepIndex: 0 } : grn));
    } else if (type === 'Invoice') {
      setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, status: 'Rejected', rejectionRemarks, currentStepIndex: 0 } : inv));
    }

    setRejectionRemarks('');
    setShowRejectionModal(null);
    setShowForm(false);
  };

  const approveRC = (id: string) => {
    setRateContracts(rateContracts.map(rc => {
      if (rc.id !== id) return rc;

      const rule = workflows.find(w => 
        w.entityName === rc.entityName &&
        w.moduleType === ModuleType.RATE_CONTRACT &&
        w.subDepartment === rc.subDepartment &&
        (!w.centerName || rc.items.some(i => getItemCenters(i).includes(w.centerName))) &&
        Number(rc.amount) >= Number(w.minAmount) && 
        (w.maxAmount == null || Number(rc.amount) <= Number(w.maxAmount))
      );

      if (!rule || rc.currentStepIndex >= rule.approvalChain.length - 1) {
        return { ...rc, status: 'Approved' };
      }

      return { ...rc, currentStepIndex: rc.currentStepIndex + 1 };
    }));
  };

  const amendRC = (id: string) => {
    setRateContracts(rateContracts.map(rc => rc.id === id ? { ...rc, status: 'Pending', currentStepIndex: 0 } : rc));
    alert('RC status reset to Pending for amendment. It will follow the approval workflow again.');
  };

  const approveGRN = (id: string) => {
    setGrns(grns.map(grn => {
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
        return { ...grn, status: 'Approved' };
      }

      return { ...grn, currentStepIndex: grn.currentStepIndex + 1 };
    }));
  };

  const reverseGRN = (id: string) => {
    setGrns(grns.map(grn => grn.id === id ? { ...grn, status: 'Reversed' } : grn));
    alert('GRN reversed. You can now recreate it against the same RC.');
  };

  const approveInvoice = (id: string) => {
    setInvoices(invoices.map(inv => {
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
        return { ...inv, status: 'Approved' };
      }

      return { ...inv, currentStepIndex: inv.currentStepIndex + 1 };
    }));
  };

  const reverseInvoice = (id: string) => {
    setInvoices(invoices.map(inv => inv.id === id ? { ...inv, status: 'Reversed' } : inv));
    alert('Invoice reversed. You can now recreate it against the same GRN.');
  };

  const isRcReadOnly = !!rcForm.id && !(rcForm.status === 'Rejected' && rcForm.createdBy === currentUser.id);
  const isGrnReadOnly = !!grnForm.id && !(grnForm.status === 'Rejected' && grnForm.createdBy === currentUser.id);
  const isInvoiceReadOnly = !!invoiceForm.id && !(invoiceForm.status === 'Rejected' && invoiceForm.createdBy === currentUser.id);
  const isInvoiceCreatingFromGRN = !!selectedGRN && !invoiceForm.id;
  const invoiceFieldsLocked = isInvoiceReadOnly || isInvoiceCreatingFromGRN;
  const isApprovedRcView = !!(rcForm.id && rcForm.status === 'Approved');
  const rcGrns = grns.filter(g => g.rateContractId);
  const rcInvoices = invoices.filter(inv => {
    const g = grns.find(grn => grn.id === inv.grnId);
    return !!g?.rateContractId;
  });

  const getItemCenters = (item: ItemLine): string[] =>
    (item.centerNames && item.centerNames.length > 0) ? item.centerNames : (item.centerName ? [item.centerName] : []);

  const noPurchaseOrders: PurchaseOrder[] = [];

  const vendorOptionsForList = useMemo(
    () => vendorsForDropdown.map((v) => ({ id: v.id, name: v.name })),
    [vendorsForDropdown]
  );

  const rcListCounts = useMemo(
    () => ({
      approved: rateContracts.filter((r) => r.status === 'Approved').length,
      pending: rateContracts.filter((r) => r.status === 'Pending').length,
    }),
    [rateContracts]
  );
  const grnListCounts = useMemo(
    () => ({
      approved: rcGrns.filter((g) => g.status === 'Approved').length,
      pending: rcGrns.filter((g) => g.status === 'Pending').length,
    }),
    [rcGrns]
  );
  const invListCounts = useMemo(
    () => ({
      approved: rcInvoices.filter((i) => i.status === 'Approved').length,
      pending: rcInvoices.filter((i) => i.status === 'Pending').length,
    }),
    [rcInvoices]
  );

  const filteredRateContracts = useMemo(() => {
    return rateContracts.filter((rc) => {
      if (!inCreatedAtRange(rc.createdAt, listDateFrom, listDateTo)) return false;
      if (!matchesVendorFilter(rc.vendorId, listVendorId)) return false;
      if (!matchesStatusQuickFilter(rc.status, listStatusQuick)) return false;
      const vendorName = (masters['Vendor'] || []).find((v) => v.id === rc.vendorId)?.name || '';
      const details = `${vendorName} ${rc.items.length} ${(Number(rc.amount) || 0).toFixed(2)}`;
      if (!textIncludes(rc.id, colRcId)) return false;
      if (!textIncludes(details, colRcDetails)) return false;
      if (!textIncludes(rc.status, colRcStatus)) return false;
      return true;
    });
  }, [rateContracts, masters, listDateFrom, listDateTo, listVendorId, listStatusQuick, colRcId, colRcDetails, colRcStatus]);

  const filteredRcGrns = useMemo(() => {
    return rcGrns.filter((grn) => {
      if (!inCreatedAtRange(grn.createdAt, listDateFrom, listDateTo)) return false;
      const vid = getGrnVendorId(grn, rateContracts, noPurchaseOrders, masters);
      if (!matchesVendorFilter(vid, listVendorId)) return false;
      if (!matchesStatusQuickFilter(grn.status, listStatusQuick)) return false;
      const details = `${grn.location} ${grn.rateContractId || ''} ${grn.items.length} ${(Number(grn.amount) || 0).toFixed(2)}`;
      if (!textIncludes(grn.id, colGrnId)) return false;
      if (!textIncludes(details, colGrnDetails)) return false;
      if (!textIncludes(grn.status, colGrnStatus)) return false;
      return true;
    });
  }, [rcGrns, rateContracts, masters, listDateFrom, listDateTo, listVendorId, listStatusQuick, colGrnId, colGrnDetails, colGrnStatus]);

  const filteredRcInvoices = useMemo(() => {
    return rcInvoices.filter((inv) => {
      if (!inCreatedAtRange(inv.createdAt, listDateFrom, listDateTo)) return false;
      const vid = getRcInvoiceVendorId(inv, grns, rateContracts, noPurchaseOrders, masters);
      if (!matchesVendorFilter(vid, listVendorId)) return false;
      if (!matchesStatusQuickFilter(inv.status, listStatusQuick)) return false;
      const details = `${inv.location} ${inv.grnId || ''} ${(Number(inv.amount) || 0).toFixed(2)}`;
      if (!textIncludes(inv.id, colInvId)) return false;
      if (!textIncludes(details, colInvDetails)) return false;
      if (!textIncludes(inv.status, colInvStatus)) return false;
      return true;
    });
  }, [rcInvoices, grns, rateContracts, masters, listDateFrom, listDateTo, listVendorId, listStatusQuick, colInvId, colInvDetails, colInvStatus]);

  const normalizeRcForForm = (rc: RateContract): RateContract => ({
    ...rc,
    items: (rc.items || []).map(item => {
      const centers = item.centerNames?.length ? item.centerNames : (item.centerName ? [item.centerName] : []);
      const locked = item.centerNamesLocked?.length ? item.centerNamesLocked : centers;
      return {
        ...item,
        centerNames: centers,
        centerNamesLocked: locked
      };
    })
  });

  const handleUpdateApprovedRcCenters = () => {
    if (!rcForm.id) return;
    const items = (rcForm.items || []).map(item => {
      const centers = getItemCenters(item);
      return {
        ...item,
        centerNames: centers,
        centerNamesLocked: centers,
        centerName: centers[0]
      };
    });
    setRateContracts(prev => prev.map(rc => rc.id === rcForm.id ? { ...rc, items } : rc));
    setRcForm(prev => prev.items ? { ...prev, items } : prev);
    setUpdateSuccessMessage(true);
    setTimeout(() => {
      setShowForm(false);
      resetForms();
      setUpdateSuccessMessage(false);
    }, 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3 border-b border-slate-200 pb-4">
        <div className="flex flex-wrap gap-2">
          {(['RC', 'GRN', 'Invoice'] as ViewMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => { setViewMode(mode); setShowForm(false); }}
              className={`px-4 py-2 rounded-lg font-bold transition-all ${
                viewMode === mode ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {mode === 'RC' ? 'Rate Contracts' : mode === 'GRN' ? 'GRN' : 'Invoices'}
            </button>
          ))}
        </div>
        {!showForm && (
          <TransactionListFilterBar
            approvedCount={viewMode === 'RC' ? rcListCounts.approved : viewMode === 'GRN' ? grnListCounts.approved : invListCounts.approved}
            pendingCount={viewMode === 'RC' ? rcListCounts.pending : viewMode === 'GRN' ? grnListCounts.pending : invListCounts.pending}
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
            gridTemplateColumns: 'minmax(0, 18%) minmax(0, 42%) minmax(0, 18%) minmax(0, 22%)',
          }}
          role="search"
          aria-label="Column filters"
        >
          <div className="px-6 py-2 min-w-0">
            <input
              type="text"
              placeholder="Filter…"
              value={viewMode === 'RC' ? colRcId : viewMode === 'GRN' ? colGrnId : colInvId}
              onChange={(e) => {
                const v = e.target.value;
                if (viewMode === 'RC') setColRcId(v);
                else if (viewMode === 'GRN') setColGrnId(v);
                else setColInvId(v);
              }}
              className="w-full min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium"
            />
          </div>
          <div className="px-6 py-2 min-w-0">
            <input
              type="text"
              placeholder="Filter…"
              value={viewMode === 'RC' ? colRcDetails : viewMode === 'GRN' ? colGrnDetails : colInvDetails}
              onChange={(e) => {
                const v = e.target.value;
                if (viewMode === 'RC') setColRcDetails(v);
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
              value={viewMode === 'RC' ? colRcStatus : viewMode === 'GRN' ? colGrnStatus : colInvStatus}
              onChange={(e) => {
                const v = e.target.value;
                if (viewMode === 'RC') setColRcStatus(v);
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
          {viewMode === 'RC' ? 'Rate Contract Management' : viewMode === 'GRN' ? 'Goods Receipt Notes' : 'Invoice Processing'}
        </h2>
        {viewMode === 'RC' && !showForm && (
          <button 
            onClick={() => setShowForm(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-black shadow-lg shadow-indigo-200 hover:scale-105 transition-transform"
          >
            + Create New RC
          </button>
        )}
      </div>

      {showForm ? (
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-black text-slate-900">
              {rcForm.id ? 'Rate Contract Details' : 
               grnForm.id ? 'GRN Details' : 
               invoiceForm.id ? 'Invoice Details' : 
               selectedRC ? (selectedGRN ? 'New Invoice' : 'New GRN') : 
               'New Rate Contract'}
            </h3>
            <button onClick={() => { setShowForm(false); resetForms(); setUpdateSuccessMessage(false); }} className="text-slate-400 hover:text-slate-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          {updateSuccessMessage && (
            <div className="mb-6 p-4 rounded-xl bg-emerald-100 border border-emerald-200 text-emerald-800 font-semibold flex items-center gap-2">
              <svg className="w-5 h-5 flex-shrink-0 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
              <span>Rate contract centers updated. Returning to list...</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* RC Form Fields */}
            {!selectedRC && (
              <>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Entity</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                    value={rcForm.entityName}
                    onChange={e => setRcForm({ ...rcForm, entityName: e.target.value })}
                    disabled={isRcReadOnly}
                  >
                    {(masters['Entity'] || []).map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Vendor</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                    value={rcForm.vendorId}
                    onChange={e => setRcForm({ ...rcForm, vendorId: e.target.value, vendorSiteId: '' })}
                    disabled={isRcReadOnly}
                  >
                    <option value="">Select Vendor</option>
                    {vendorsForDropdown.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Vendor Site</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                    value={rcForm.vendorSiteId}
                    onChange={e => setRcForm({ ...rcForm, vendorSiteId: e.target.value })}
                    disabled={!!rcForm.id && rcForm.status === 'Approved'}                  >
                    <option value="">Select Vendor Site</option>
                    {(masters['Vendor Site'] || []).filter(s => s.vendorId === rcForm.vendorId).map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Shipping Address</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                    value={rcForm.shippingAddressId}
                    onChange={e => setRcForm({ ...rcForm, shippingAddressId: e.target.value })}
                    disabled={isRcReadOnly}
                  >
                    <option value="">Select Shipping Address</option>
                    {(masters['Entity'] || []).flatMap(ent => ent.shippingAddresses || []).map((addr: any) => (
                      <option key={addr.id} value={addr.id}>{addr.address}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Billing Address</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                    value={rcForm.billingAddressId}
                    onChange={e => setRcForm({ ...rcForm, billingAddressId: e.target.value })}
                    disabled={isRcReadOnly}
                  >
                    <option value="">Select Billing Address</option>
                    {(masters['Entity'] || []).flatMap(ent => ent.billingAddresses || []).map((addr: any) => (
                      <option key={addr.id} value={addr.id}>{addr.address}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Item type</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                    value={rcForm.transactionType}
                    onChange={e => setRcForm({ ...rcForm, transactionType: e.target.value })}
                    disabled={isRcReadOnly}
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
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                    value={rcForm.validFrom}
                    onChange={e => setRcForm({ ...rcForm, validFrom: e.target.value })}
                    disabled={isRcReadOnly}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Validity To</label>
                  <input 
                    type="date" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                    value={rcForm.validTo}
                    onChange={e => setRcForm({ ...rcForm, validTo: e.target.value })}
                    disabled={isRcReadOnly}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Required Date</label>
                  <input 
                    type="date" 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                    value={rcForm.requiredDate || ''}
                    onChange={e => setRcForm({ ...rcForm, requiredDate: e.target.value })}
                    disabled={isRcReadOnly}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Frequency</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={rcForm.frequency}
                    onChange={e => setRcForm({ ...rcForm, frequency: e.target.value as Frequency })}
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
                    value={rcForm.department}
                    onChange={e => setRcForm({ ...rcForm, department: e.target.value, subDepartment: '' })}
                  >
                    <option value="">Select Department</option>
                    {getDepartments(masters).map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Sub-Department</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={rcForm.subDepartment}
                    onChange={e => setRcForm({ ...rcForm, subDepartment: e.target.value })}
                  >
                    <option value="">Select Sub-Department</option>
                    {getSubdepartmentsForDepartment(masters, rcForm.department).map(sd => <option key={sd.id} value={sd.name}>{sd.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Payment Terms</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={rcForm.paymentTerms}
                    onChange={e => setRcForm({ ...rcForm, paymentTerms: e.target.value })}
                  >
                    <option value="">Select Payment Terms</option>
                    {(masters['Payment Terms'] || []).map(pt => <option key={pt.id} value={pt.name}>{pt.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Terms & Conditions</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                    value={rcForm.termsAndConditionsId}
                    onChange={e => setRcForm({ ...rcForm, termsAndConditionsId: e.target.value })}
                  >
                    <option value="">Select Terms & Conditions</option>
                    {(masters['Terms & Conditions'] || []).map(tc => <option key={tc.id} value={tc.id}>{tc.name}</option>)}
                  </select>
                </div>
                {/* Items Section */}
                <div className="col-span-2 space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="text-sm font-black text-slate-700 uppercase tracking-wider">Items</h4>
                    {!isApprovedRcView && (
                      <div className="flex items-center space-x-4">
                        <button 
                          onClick={() => downloadTemplate('RC')}
                          className="text-indigo-600 text-xs font-black hover:underline flex items-center"
                        >
                          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          Download Template
                        </button>
                        <label className="cursor-pointer text-indigo-600 text-xs font-black hover:underline flex items-center">
                          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                          Bulk Upload
                          <input type="file" className="hidden" onChange={e => handleBulkUpload(e, 'RC')} />
                        </label>
                        <button 
                          onClick={addItem}
                          className="text-indigo-600 text-xs font-black hover:underline"
                        >
                          + Add Item
                        </button>
                      </div>
                    )}
                    {isApprovedRcView && (
                      <p className="text-xs text-slate-500 font-medium">Only Center can be edited. Use Update below to save.</p>
                    )}
                  </div>
                  <div className="space-y-6">
                    {rcForm.items?.map((item, index) => (
                      <div key={item.id} className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-4">
                        <div className="grid grid-cols-12 gap-4 items-end">
                          <div className="col-span-2 space-y-1">
                            <SearchableSelect
                              label="Item Name"
                              options={itemsForDropdown.map(i => ({ id: i.id, name: i.name }))}
                              value={item.itemName ?? ''}
                              onChange={v => updateItem(item.id, 'itemName', v)}
                              placeholder="Select Item"
                              disabled={!!isApprovedRcView}
                            />
                          </div>
                          <div className="col-span-2 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Center <span className="text-red-500">*</span></label>
                            {isApprovedRcView ? (
                              <>
                                <MultiSelect
                                  options={CENTERS}
                                  selected={item.centerNames || (item.centerName ? [item.centerName] : [])}
                                  onChange={v => {
                                    const locked = item.centerNamesLocked || [];
                                    const next = [...new Set([...locked, ...v])];
                                    updateItem(item.id, 'centerNames', next);
                                  }}
                                  placeholder="Select centers (locked ones cannot be removed)"
                                  label=""
                                />
                                {(item.centerNamesLocked?.length ?? 0) > 0 && (
                                  <p className="text-[10px] text-slate-500 mt-1">Locked at creation (cannot remove): {item.centerNamesLocked!.join(', ')}</p>
                                )}
                              </>
                            ) : (
                              <MultiSelect
                                options={CENTERS}
                                selected={item.centerNames || (item.centerName ? [item.centerName] : [])}
                                onChange={v => updateItem(item.id, 'centerNames', v)}
                                placeholder="Select centers"
                                label=""
                              />
                            )}
                          </div>
                          <div className="col-span-2 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Rate (INR)</label>
                            <input 
                              type="number"
                              className={`w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold ${isApprovedRcView ? 'bg-slate-100 cursor-not-allowed' : 'bg-white'}`}
                              value={item.rate}
                              onChange={e => updateItem(item.id, 'rate', Number(e.target.value))}
                              disabled={isApprovedRcView}
                            />
                          </div>
                          <div className="col-span-2 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Base Amount</label>
                            <input 
                              type="number"
                              readOnly
                              className="w-full bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-black text-slate-600"
                              value={(Number(item.amount) || 0).toFixed(2)}
                            />
                          </div>
                          <div className="col-span-3 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Remarks <span className="text-red-500">*</span></label>
                            <input 
                              type="text"
                              placeholder="Remarks"
                              className={`w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold ${isApprovedRcView ? 'bg-slate-100 cursor-not-allowed' : 'bg-white'}`}
                              value={item.remarks}
                              onChange={e => updateItem(item.id, 'remarks', e.target.value)}
                              disabled={isApprovedRcView}
                            />
                          </div>
                          <div className="col-span-1 flex justify-center pb-1">
                            {rcForm.items!.length > 1 && !isApprovedRcView && (
                              <button onClick={() => removeItem(item.id)} className="text-red-400 hover:text-red-600 transition-colors p-2 hover:bg-red-50 rounded-xl">
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
                    <h4 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em] border-b border-slate-200 pb-2">Amount Summary (INR)</h4>
                    <div className="grid grid-cols-2 md:grid-cols-2 gap-6">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Base Amount</label>
                        <div className="text-sm font-bold text-slate-700">
                          ₹{(rcForm.items || []).reduce((sum, i) => sum + (Number(i.amount) || 0), 0).toFixed(2)}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">Net Total Amount</label>
                        <div className="text-lg font-black text-indigo-700">
                          ₹{(Number(rcForm.amount) || 0).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <textarea 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                    value={rcForm.remarks}
                    onChange={e => setRcForm({ ...rcForm, remarks: e.target.value })}
                    disabled={isRcReadOnly}
                  />
                </div>

                {isApprovedRcView && (
                  <div className="md:col-span-2 flex justify-end">
                    <button
                      type="button"
                      onClick={handleUpdateApprovedRcCenters}
                      className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg transition-colors"
                    >
                      Update
                    </button>
                  </div>
                )}
              </>
            )}

            {/* GRN Form Fields */}
            {selectedRC && !selectedGRN && (
              <>
                <div className="col-span-2 bg-indigo-50 p-4 rounded-2xl border border-indigo-100 mb-4">
                  <p className="text-sm font-bold text-indigo-900">Auto-populated from {selectedRC.id}</p>
                  <div className="mt-2 space-y-1">
                    <div className="text-xs"><span className="text-indigo-400 uppercase font-black">Vendor:</span> {(masters['Vendor'] || []).find(v => v.id === selectedRC.vendorId)?.name}</div>
                    <div className="text-xs"><span className="text-indigo-400 uppercase font-black">Vendor Site:</span> {(masters['Vendor Site'] || []).find(s => s.id === selectedRC.vendorSiteId)?.name || 'N/A'}</div>
                    <div className="text-xs"><span className="text-indigo-400 uppercase font-black">Centers:</span> {Array.from(new Set(selectedRC.items.flatMap(i => getItemCenters(i)))).join(', ')}</div>
                    <div className="text-xs"><span className="text-indigo-400 uppercase font-black">Required Date:</span> {selectedRC.requiredDate || 'N/A'}</div>
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
                      disabled={isGrnReadOnly || selectedRC?.status === 'Approved'}
                    >
                      <option value="">Select Vendor Site</option>
                      {(masters['Vendor Site'] || []).filter(s => s.vendorId === selectedRC.vendorId).map(s => (
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
                      {Array.from(new Set(selectedRC.items.flatMap(i => getItemCenters(i)))).map(c => <option key={c} value={c}>{c}</option>)}
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
                      {(masters['Entity'] || []).flatMap(ent => ent.shippingAddresses || []).map((addr: any) => (
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
                      {(masters['Entity'] || []).flatMap(ent => ent.billingAddresses || []).map((addr: any) => (
                        <option key={addr.id} value={addr.id}>{addr.address}</option>
                      ))}
                    </select>
                  </div>
                  {/* Row 4: Department | Subdepartment */}
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
                  {/* Row 6: Payment Terms | Terms & Conditions */}
                  <div className="space-y-2">
                    <label className="text-sm font-black text-slate-600 uppercase tracking-wider">Payment Terms</label>
                    <div className="w-full min-h-[56px] bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 text-base font-bold text-slate-700">
                      {selectedRC?.paymentTerms || '—'}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-black text-slate-600 uppercase tracking-wider">Terms & Conditions</label>
                    <div className="w-full min-h-[56px] bg-slate-50 border border-slate-200 rounded-xl px-4 py-4 text-base font-bold text-slate-700">
                      {(masters['Terms & Conditions'] || []).find((tc: any) => tc.id === selectedRC?.termsAndConditionsId)?.name || selectedRC?.termsAndConditionsId || '—'}
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
                  <div className="bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden">
                    {/* Table header row */}
                    <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-slate-200 bg-slate-100/80">
                      <div className="col-span-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">Item Name</div>
                      <div className="col-span-1 text-[10px] font-black text-slate-500 uppercase tracking-widest">Qty</div>
                      <div className="col-span-1 text-[10px] font-black text-slate-500 uppercase tracking-widest">Rate (INR)</div>
                      <div className="col-span-1 text-[10px] font-black text-slate-500 uppercase tracking-widest">Base Amount</div>
                      <div className="col-span-1 text-[10px] font-black text-slate-500 uppercase tracking-widest">GST</div>
                      <div className="col-span-1 text-[10px] font-black text-slate-500 uppercase tracking-widest">GST Amount</div>
                      <div className="col-span-1 text-[10px] font-black text-slate-500 uppercase tracking-widest">Net Amount</div>
                      <div className="col-span-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">Remarks</div>
                    </div>
                    {/* Data rows */}
                    {(grnForm.items || []).map((grnItem) => (
                      <div key={grnItem.id} className="grid grid-cols-12 gap-2 items-center px-4 py-3 border-b border-slate-100 last:border-b-0 bg-white hover:bg-slate-50/50">
                        <div className="col-span-2 min-w-0">
                          <div className="text-sm font-bold text-slate-700 truncate">{grnItem.itemName}</div>
                        </div>
                        <div className="col-span-1">
                          <input
                            type="number"
                            min={0}
                            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold bg-white"
                            value={grnItem.quantity}
                            onChange={e => updateGrnItem(grnItem.id, 'quantity', Number(e.target.value))}
                            disabled={!!grnForm.id}
                          />
                        </div>
                        <div className="col-span-1 text-sm font-bold text-slate-700">₹{(Number(grnItem.rate) || 0).toFixed(2)}</div>
                        <div className="col-span-1 text-sm font-bold text-slate-700">₹{(Number(grnItem.amount) || 0).toFixed(2)}</div>
                        <div className="col-span-1">
                          <select
                            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold bg-white"
                            value={grnItem.gst ?? ''}
                            onChange={e => updateGrnItem(grnItem.id, 'gst', Number(e.target.value))}
                            disabled={!!grnForm.id}
                          >
                            <option value="">Select</option>
                            {(masters.GST ?? masters['GST'] ?? []).map((g: { id: string; name: string; rate: number }) => (
                              <option key={g.id} value={g.rate}>{g.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-1 text-sm font-bold text-slate-700">₹{(Number(grnItem.gstAmount) || 0).toFixed(2)}</div>
                        <div className="col-span-1 text-sm font-bold text-slate-700">₹{(Number(grnItem.totalAmount ?? grnItem.amount) || 0).toFixed(2)}</div>
                        <div className="col-span-2 min-w-0">
                          <input
                            type="text"
                            placeholder="Remarks"
                            className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold bg-white"
                            value={grnItem.remarks ?? ''}
                            onChange={e => updateGrnItem(grnItem.id, 'remarks', e.target.value)}
                            disabled={!!grnForm.id}
                          />
                        </div>
                      </div>
                    ))}
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

              </>
            )}

            {/* Invoice Form Fields */}
            {selectedGRN && (
              <>
                <div className="col-span-2 bg-emerald-50 p-4 rounded-2xl border border-emerald-100 mb-4">
                  <p className="text-sm font-bold text-emerald-900">Auto-populated from {selectedGRN.id}</p>
                  <div className="grid grid-cols-3 gap-4 mt-2 text-xs">
                    <div><span className="text-emerald-400 uppercase">Qty:</span> {selectedGRN.items.reduce((sum, i) => sum + (i.quantity || 0), 0)}</div>
                    <div><span className="text-emerald-400 uppercase">Amount:</span> ₹{(Number(selectedGRN.amount) || 0).toFixed(2)}</div>
                    <div><span className="text-emerald-400 uppercase">Vendor Site:</span> {(masters['Vendor Site'] || []).find(s => s.id === selectedGRN.vendorSiteId)?.name || 'N/A'}</div>
                    <div><span className="text-emerald-400 uppercase">Location:</span> {selectedGRN.location}</div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Invoice No</label>
                    <input
                      type="text"
                      placeholder="Invoice number"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                      value={invoiceForm.invoiceNumber ?? ''}
                      onChange={e => setInvoiceForm({ ...invoiceForm, invoiceNumber: e.target.value })}
                      disabled={invoiceFieldsLocked}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Invoice Date</label>
                    <input
                      type="date"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                      value={invoiceForm.invoiceDate ?? ''}
                      onChange={e => setInvoiceForm({ ...invoiceForm, invoiceDate: e.target.value })}
                      disabled={invoiceFieldsLocked}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Vendor Site</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                    value={invoiceForm.vendorSiteId}
                    onChange={e => setInvoiceForm({ ...invoiceForm, vendorSiteId: e.target.value })}
                    disabled={invoiceFieldsLocked}
                  >
                    <option value="">Select Vendor Site</option>
                    {(masters['Vendor Site'] || []).filter(s => s.vendorId === selectedRC.vendorId).map(s => (
                      <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Shipping Address</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                    value={invoiceForm.shippingAddressId}
                    onChange={e => setInvoiceForm({ ...invoiceForm, shippingAddressId: e.target.value })}
                    disabled={invoiceFieldsLocked}
                  >
                    <option value="">Select Shipping Address</option>
                    {(masters['Entity'] || []).flatMap(ent => ent.shippingAddresses || []).map((addr: any) => (
                      <option key={addr.id} value={addr.id}>{addr.address}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Billing Address</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                    value={invoiceForm.billingAddressId}
                    onChange={e => setInvoiceForm({ ...invoiceForm, billingAddressId: e.target.value })}
                    disabled={invoiceFieldsLocked}
                  >
                    <option value="">Select Billing Address</option>
                    {(masters['Entity'] || []).flatMap(ent => ent.billingAddresses || []).map((addr: any) => (
                      <option key={addr.id} value={addr.id}>{addr.address}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Invoice Location</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                    value={invoiceForm.location}
                    onChange={e => setInvoiceForm({ ...invoiceForm, location: e.target.value })}
                    disabled={invoiceFieldsLocked}
                  >
                    <option value="">Select Location</option>
                    {CENTERS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                {/* <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">TDS</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                    value={invoiceForm.tds}
                    onChange={e => setInvoiceForm({ ...invoiceForm, tds: Number(e.target.value) })}
                    disabled={isInvoiceReadOnly}
                  >
                    <option value="0">Select TDS</option>
                    {(masters['TDS'] || []).map(t => <option key={t.id} value={t.rate}>{t.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500 uppercase tracking-wider">GST</label>
                  <select 
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium disabled:opacity-50"
                    value={invoiceForm.gst}
                    onChange={e => setInvoiceForm({ ...invoiceForm, gst: Number(e.target.value) })}
                    disabled={isInvoiceReadOnly}
                  >
                    <option value="0">Select GST</option>
                    {(masters['GST'] || []).map(g => <option key={g.id} value={g.rate}>{g.name}</option>)}
                  </select>
                </div> */}

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
                  <div className="bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden">
                    {/* Table header row */}
                    <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-slate-200 bg-slate-100/80">
                      <div className="col-span-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">Item Name</div>
                      <div className="col-span-1 text-[10px] font-black text-slate-500 uppercase tracking-widest">Qty</div>
                      <div className="col-span-1 text-[10px] font-black text-slate-500 uppercase tracking-widest">Base Amount</div>
                      <div className="col-span-1 text-[10px] font-black text-slate-500 uppercase tracking-widest">GST</div>
                      <div className="col-span-1 text-[10px] font-black text-slate-500 uppercase tracking-widest">GST Amount</div>
                      <div className="col-span-1 text-[10px] font-black text-slate-500 uppercase tracking-widest">TDS</div>
                      <div className="col-span-1 text-[10px] font-black text-slate-500 uppercase tracking-widest">TDS Amount</div>
                      <div className="col-span-1 text-[10px] font-black text-slate-500 uppercase tracking-widest">Net Amount</div>
                      <div className="col-span-2 text-[10px] font-black text-slate-500 uppercase tracking-widest">Remark</div>
                    </div>
                    {/* Data rows */}
                    {selectedGRN.items.map((grnItem) => {
                      const invItem = invoiceForm.items?.find(i => i.id === grnItem.id) || { ...grnItem, quantity: grnItem.quantity, gst: grnItem.gst ?? 0, tds: grnItem.tds ?? 0 };
                      const base = (Number(invItem.quantity) || 0) * (Number(invItem.rate) || 0);
                      return (
                        <div key={grnItem.id} className="grid grid-cols-12 gap-2 items-center px-4 py-3 border-b border-slate-100 last:border-b-0 bg-white hover:bg-slate-50/50">
                          <div className="col-span-2 min-w-0 text-sm font-bold text-slate-700 truncate">{invItem.itemName}</div>
                          <div className="col-span-1">
                            <input
                              type="number"
                              min={0}
                              className={`w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold bg-white disabled:opacity-50 ${(Number(invItem.quantity) || 0) > grnItem.quantity ? 'border-red-500' : 'border-slate-200'}`}
                              value={invItem.quantity}
                              disabled={isInvoiceReadOnly}
                              onChange={e => {
                                const qty = Number(e.target.value);
                                if (qty > grnItem.quantity) {
                                  alert(`Invoice quantity (${qty}) cannot be greater than GRN quantity (${grnItem.quantity})`);
                                  return;
                                }
                                updateInvoiceItem(grnItem.id, 'quantity', qty);
                              }}
                            />
                          </div>
                          <div className="col-span-1 text-sm font-bold text-slate-700">₹{(Number(invItem.amount) || base).toFixed(2)}</div>
                          <div className="col-span-1">
                            <select
                              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold bg-white disabled:opacity-50"
                              value={invItem.gst ?? ''}
                              onChange={e => updateInvoiceItem(grnItem.id, 'gst', Number(e.target.value))}
                              disabled={isInvoiceReadOnly}
                            >
                              <option value="">Select</option>
                              {(masters['GST'] || masters.GST || []).map((g: { id: string; name: string; rate: number }) => (
                                <option key={g.id} value={g.rate}>{g.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-1 text-sm font-bold text-slate-700">₹{(Number(invItem.gstAmount) || 0).toFixed(2)}</div>
                          <div className="col-span-1">
                            <select
                              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold bg-white disabled:opacity-50"
                              value={invItem.tds ?? ''}
                              onChange={e => updateInvoiceItem(grnItem.id, 'tds', Number(e.target.value))}
                              disabled={isInvoiceReadOnly}
                            >
                              <option value="">Select</option>
                              {(masters['TDS'] || masters.TDS || []).map((t: { id: string; name: string; rate: number }) => (
                                <option key={t.id} value={t.rate}>{t.name}</option>
                              ))}
                            </select>
                          </div>
                          <div className="col-span-1 text-sm font-bold text-red-600">₹{(Number(invItem.tdsAmount) || 0).toFixed(2)}</div>
                          <div className="col-span-1 text-sm font-black text-indigo-600">₹{(Number(invItem.totalAmount) ?? base).toFixed(2)}</div>
                          <div className="col-span-2 min-w-0">
                            <input
                              type="text"
                              placeholder="Remark"
                              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold bg-white disabled:opacity-50"
                              value={invItem.remarks ?? ''}
                              onChange={e => updateInvoiceItem(grnItem.id, 'remarks', e.target.value)}
                              disabled={isInvoiceReadOnly}
                            />
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
                    onChange={(e) => handleFileUpload(e, selectedRC ? (selectedGRN ? 'Invoice' : 'GRN') : 'RC')}
                  />
                </label>
              </div>
              
              <div className="space-y-2">
                {/* Show inherited documents */}
                {selectedRC && selectedRC.attachments.map(att => (
                  <div key={att.id} className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <div className="flex items-center space-x-3">
                      <div className="bg-indigo-100 p-2 rounded-lg text-indigo-600">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      </div>
                      <span className="text-sm font-medium text-slate-600">{att.name} <span className="text-[10px] text-indigo-400 font-black uppercase ml-2">From RC</span></span>
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
                {(selectedRC ? (selectedGRN ? invoiceForm : grnForm) : rcForm).attachments?.map(att => (
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
              onClick={() => { setShowForm(false); resetForms(); setUpdateSuccessMessage(false); }}
              className="px-6 py-3 rounded-xl font-black text-slate-500 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            
            {/* Reviewer/Approver Actions */}
            {showForm && (
              <>
                {viewMode === 'RC' && rcForm.id && (canCompleteReview(rcForm as RateContract) || canApprove(rcForm as RateContract)) && (
                  <div className="flex space-x-4">
                    {canCompleteReview(rcForm as RateContract) && (
                      <button onClick={() => completeReviewRC(rcForm.id!)} className="bg-amber-600 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-amber-200 hover:scale-105 transition-transform">Complete Review</button>
                    )}
                    {canApprove(rcForm as RateContract) && (
                      <button onClick={() => approveRC(rcForm.id!)} className="bg-emerald-600 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-emerald-200 hover:scale-105 transition-transform">Approve</button>
                    )}
                    <button onClick={() => setShowRejectionModal({ id: rcForm.id!, type: 'RC' })} className="bg-rose-600 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-rose-200 hover:scale-105 transition-transform">Reject</button>
                  </div>
                )}
                {viewMode === 'GRN' && grnForm.id && (canCompleteReview(grnForm as GRN) || canApprove(grnForm as GRN)) && (
                  <div className="flex space-x-4">
                    {canCompleteReview(grnForm as GRN) && (
                      <button onClick={() => completeReviewGRN(grnForm.id!)} className="bg-amber-600 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-amber-200 hover:scale-105 transition-transform">Complete Review</button>
                    )}
                    {canApprove(grnForm as GRN) && (
                      <button onClick={() => approveGRN(grnForm.id!)} className="bg-emerald-600 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-emerald-200 hover:scale-105 transition-transform">Approve</button>
                    )}
                    <button onClick={() => setShowRejectionModal({ id: grnForm.id!, type: 'GRN' })} className="bg-rose-600 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-rose-200 hover:scale-105 transition-transform">Reject</button>
                  </div>
                )}
                {viewMode === 'Invoice' && invoiceForm.id && (canCompleteReview(invoiceForm as Invoice) || canApprove(invoiceForm as Invoice)) && (
                  <div className="flex space-x-4">
                    {canCompleteReview(invoiceForm as Invoice) && (
                      <button onClick={() => completeReviewInvoice(invoiceForm.id!)} className="bg-amber-600 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-amber-200 hover:scale-105 transition-transform">Complete Review</button>
                    )}
                    {canApprove(invoiceForm as Invoice) && (
                      <button onClick={() => approveInvoice(invoiceForm.id!)} className="bg-emerald-600 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-emerald-200 hover:scale-105 transition-transform">Approve</button>
                    )}
                    <button onClick={() => setShowRejectionModal({ id: invoiceForm.id!, type: 'Invoice' })} className="bg-rose-600 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-rose-200 hover:scale-105 transition-transform">Reject</button>
                  </div>
                )}
              </>
            )}

            {/* Submit Button (only for creators in editable mode) */}
            {((viewMode === 'RC' && !isRcReadOnly) || 
              (viewMode === 'GRN' && !isGrnReadOnly) || 
              (viewMode === 'Invoice' && !isInvoiceReadOnly)) && (
              <button 
                onClick={selectedRC ? (selectedGRN ? handleCreateInvoice : handleCreateGRN) : handleCreateRC}
                className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-indigo-200 hover:scale-105 transition-transform"
              >
                Submit for Approval
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden">
          <table className="w-full table-fixed text-left border-collapse">
            <colgroup>
              <col style={{ width: '18%' }} />
              <col style={{ width: '42%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '22%' }} />
            </colgroup>
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">ID / Date</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Vendor Name</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Status</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {viewMode === 'RC' && filteredRateContracts.map(rc => (
                <tr key={rc.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="text-sm font-black text-slate-900">{rc.id}</div>
                    <div className="text-[10px] text-slate-400 font-bold">{new Date(rc.createdAt).toLocaleDateString()}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-slate-700">{(masters['Vendor'] || []).find(v => v.id === rc.vendorId)?.name}</div>
                    <div className="text-xs text-slate-500">{rc.items.length} Items • {Array.from(new Set(rc.items.flatMap(i => getItemCenters(i)))).length} Centers • ₹{(Number(rc.amount) || 0).toFixed(2)}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col space-y-1">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider w-fit ${
                        rc.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : 
                        rc.status === 'Rejected' ? 'bg-rose-100 text-rose-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {rc.status}
                      </span>
                      {rc.status === 'Pending' && (
                        <div className="text-[10px] font-bold text-slate-400">
                          Step {rc.currentStepIndex + 1}
                        </div>
                      )}
                      {rc.status === 'Rejected' && rc.rejectionRemarks && (
                        <div className="text-[10px] font-bold text-rose-500 italic">
                          "{rc.rejectionRemarks}"
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex space-x-2">
                      <button 
                        onClick={() => {
                          setRcForm(normalizeRcForForm(rc));
                          setShowForm(true);
                        }}
                        className="text-xs font-black text-slate-600 hover:underline"
                      >
                        View
                      </button>
                      {canCompleteReview(rc) && (
                        <button onClick={() => completeReviewRC(rc.id)} className="text-xs font-black text-amber-600 hover:underline">Complete Review</button>
                      )}
                      {canApprove(rc) && (
                        <button onClick={() => approveRC(rc.id)} className="text-xs font-black text-emerald-600 hover:underline">Approve</button>
                      )}
                      {(canCompleteReview(rc) || canApprove(rc)) && (
                        <button onClick={() => setShowRejectionModal({ id: rc.id, type: 'RC' })} className="text-xs font-black text-rose-600 hover:underline">Reject</button>
                      )}
                      {rc.status === 'Approved' && rc.createdBy === currentUser.id && (
                        <>
                          <button 
                            onClick={() => {
                              setSelectedRC(rc);
                              setGrnForm({
                                entityName: rc.entityName,
                                rateContractId: rc.id,
                                vendorSiteId: rc.vendorSiteId || '',
                                shippingAddressId: rc.shippingAddressId || '',
                                billingAddressId: rc.billingAddressId || '',
                                location: Array.from(new Set(rc.items.flatMap(i => getItemCenters(i))))[0] || '',
                                department: rc.department || '',
                                subDepartment: rc.subDepartment || '',
                                invoiceNumber: '',
                                invoiceDate: '',
                                remarks: rc.remarks || '',
                                items: (rc.items || []).map(item => ({
                                  ...item,
                                  quantity: item.quantity ?? 1,
                                  amount: (Number(item.rate) || 0) * (Number(item.quantity) || 1),
                                  remarks: item.remarks ?? '',
                                  gst: (item as ItemLine).gst ?? 0
                                })),
                                amount: 0,
                                attachments: [],
                                tds: 0,
                                gst: 0
                              });
                              setShowForm(true);
                            }}
                            className="text-xs font-black text-indigo-600 hover:underline"
                          >
                            Create GRN
                          </button>
                          <button 
                            onClick={() => amendRC(rc.id)}
                            className="text-xs font-black text-slate-600 hover:underline"
                          >
                            Amend
                          </button>
                        </>
                      )}
                      {rc.status === 'Rejected' && rc.createdBy === currentUser.id && (
                        <button 
                          onClick={() => {
                            setRcForm(normalizeRcForForm(rc));
                            setShowForm(true);
                          }}
                          className="text-xs font-black text-amber-600 hover:underline"
                        >
                          Resubmit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {viewMode === 'GRN' && filteredRcGrns.map(grn => {
                const rc = rateContracts.find(r => r.id === grn.rateContractId);
                return (
                  <tr key={grn.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="text-sm font-black text-slate-900">{grn.id}</div>
                      <div className="text-[10px] text-slate-400 font-bold">Against {grn.rateContractId}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-slate-700">{grn.location}</div>
                      <div className="text-xs text-slate-500">{grn.items.length} Items • Total: ₹{(Number(grn.amount) || 0).toFixed(2)}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col space-y-1">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider w-fit ${
                          grn.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : 
                          grn.status === 'Rejected' ? 'bg-rose-100 text-rose-700' :
                          'bg-amber-100 text-amber-700'
                        }`}>
                          {grn.status}
                        </span>
                        {grn.status === 'Pending' && (
                          <div className="text-[10px] font-bold text-slate-400">
                            Step {grn.currentStepIndex + 1}
                          </div>
                        )}
                        {grn.status === 'Rejected' && grn.rejectionRemarks && (
                          <div className="text-[10px] font-bold text-rose-500 italic">
                            "{grn.rejectionRemarks}"
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex space-x-2">
                        <button 
                          onClick={() => {
                            setGrnForm(grn);
                            setSelectedRC(rateContracts.find(r => r.id === grn.rateContractId) || null);
                            setShowForm(true);
                          }}
                          className="text-xs font-black text-slate-600 hover:underline"
                        >
                          View
                        </button>
                        {canCompleteReview(grn) && (
                          <button onClick={() => completeReviewGRN(grn.id)} className="text-xs font-black text-amber-600 hover:underline">Complete Review</button>
                        )}
                        {canApprove(grn) && (
                          <button onClick={() => approveGRN(grn.id)} className="text-xs font-black text-emerald-600 hover:underline">Approve</button>
                        )}
                        {(canCompleteReview(grn) || canApprove(grn)) && (
                          <button onClick={() => setShowRejectionModal({ id: grn.id, type: 'GRN' })} className="text-xs font-black text-rose-600 hover:underline">Reject</button>
                        )}
                        {grn.status === 'Approved' && grn.createdBy === currentUser.id && (
                          <>
                            <button 
                              onClick={() => { 
                                setSelectedRC(rc || null); 
                                setSelectedGRN(grn);
                                setInvoiceForm({
                                  entityName: grn.entityName,
                                  vendorSiteId: grn.vendorSiteId || '',
                                  location: grn.location || '',
                                  shippingAddressId: grn.shippingAddressId || '',
                                  billingAddressId: grn.billingAddressId || '',
                                  department: grn.department || '',
                                  subDepartment: grn.subDepartment || '',
                                  invoiceNumber: grn.invoiceNumber ?? '',
                                  invoiceDate: grn.invoiceDate ?? '',
                                  tds: grn.tds ?? 0,
                                  gst: grn.gst ?? 0,
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
                        {grn.status === 'Rejected' && grn.createdBy === currentUser.id && (
                          <button 
                            onClick={() => {
                              setGrnForm(grn);
                              setSelectedRC(rateContracts.find(r => r.id === grn.rateContractId) || null);
                              setShowForm(true);
                            }}
                            className="text-xs font-black text-amber-600 hover:underline"
                          >
                            Resubmit
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {viewMode === 'Invoice' && filteredRcInvoices.map(inv => (
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
                      <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider w-fit ${
                        inv.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : 
                        inv.status === 'Rejected' ? 'bg-rose-100 text-rose-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {inv.status}
                      </span>
                      {inv.status === 'Pending' && (
                        <div className="text-[10px] font-bold text-slate-400">
                          Step {inv.currentStepIndex + 1}
                        </div>
                      )}
                      {inv.status === 'Rejected' && inv.rejectionRemarks && (
                        <div className="text-[10px] font-bold text-rose-500 italic">
                          "{inv.rejectionRemarks}"
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex space-x-2">
                      <button 
                        onClick={() => {
                          setInvoiceForm(inv);
                          const grn = grns.find(g => g.id === inv.grnId);
                          setSelectedGRN(grn || null);
                          if (grn) {
                            setSelectedRC(rateContracts.find(r => r.id === grn.rateContractId) || null);
                          }
                          setShowForm(true);
                        }}
                        className="text-xs font-black text-slate-600 hover:underline"
                      >
                        View
                      </button>
                      {canCompleteReview(inv) && (
                        <button onClick={() => completeReviewInvoice(inv.id)} className="text-xs font-black text-amber-600 hover:underline">Complete Review</button>
                      )}
                      {canApprove(inv) && (
                        <button onClick={() => approveInvoice(inv.id)} className="text-xs font-black text-emerald-600 hover:underline">Approve</button>
                      )}
                      {(canCompleteReview(inv) || canApprove(inv)) && (
                        <button onClick={() => setShowRejectionModal({ id: inv.id, type: 'Invoice' })} className="text-xs font-black text-rose-600 hover:underline">Reject</button>
                      )}
                      {inv.status === 'Approved' && inv.createdBy === currentUser.id && (
                        <button 
                          onClick={() => reverseInvoice(inv.id)}
                          className="text-xs font-black text-rose-600 hover:underline"
                        >
                          Reverse
                        </button>
                      )}
                      {inv.status === 'Rejected' && inv.createdBy === currentUser.id && (
                        <button 
                          onClick={() => {
                            setInvoiceForm(inv);
                            setSelectedGRN(grns.find(g => g.id === inv.grnId) || null);
                            setShowForm(true);
                          }}
                          className="text-xs font-black text-amber-600 hover:underline"
                        >
                          Resubmit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {((viewMode === 'RC' && rateContracts.length === 0) ||
                (viewMode === 'GRN' && rcGrns.length === 0) ||
                (viewMode === 'Invoice' && rcInvoices.length === 0)) && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-400 font-medium">
                    No records found for {viewMode}
                  </td>
                </tr>
              )}
              {viewMode === 'RC' && rateContracts.length > 0 && filteredRateContracts.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-500 text-sm font-bold">
                    No records match your filters.
                  </td>
                </tr>
              )}
              {viewMode === 'GRN' && rcGrns.length > 0 && filteredRcGrns.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-500 text-sm font-bold">
                    No records match your filters.
                  </td>
                </tr>
              )}
              {viewMode === 'Invoice' && rcInvoices.length > 0 && filteredRcInvoices.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-500 text-sm font-bold">
                    No records match your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {showRejectionModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-black text-slate-900 mb-4">Reject {showRejectionModal.type}</h3>
            <p className="text-slate-500 text-sm mb-6 font-medium">Please provide a reason for rejecting this {showRejectionModal.type}. This will be visible to the creator.</p>
            <textarea
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 focus:ring-2 focus:ring-rose-500 outline-none font-medium text-sm mb-6"
              rows={4}
              placeholder="Enter rejection remarks..."
              value={rejectionRemarks}
              onChange={e => setRejectionRemarks(e.target.value)}
            />
            <div className="flex space-x-4">
              <button 
                onClick={() => { setShowRejectionModal(null); setRejectionRemarks(''); }}
                className="flex-1 px-6 py-3 rounded-xl font-black text-slate-500 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => handleReject(showRejectionModal.id, showRejectionModal.type)}
                className="flex-1 bg-rose-600 text-white px-6 py-3 rounded-xl font-black shadow-lg shadow-rose-200 hover:scale-105 transition-transform"
              >
                Confirm Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RateContractModule;
