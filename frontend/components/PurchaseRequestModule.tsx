
import React, { useState } from 'react';
import { 
  PurchaseRequest, MasterRecord, MasterType, 
  Attachment, ItemLine, Frequency,
  User, WorkflowRule, Budget, BudgetType, BudgetControlType, ModuleType, ApprovalType
} from '../types';
import { CENTERS } from '../constants';
import { getDepartments, getSubdepartmentsForDepartment, getItemTypesFromMasters } from '../utils/mastersHelpers';
import MultiSelect from './MultiSelect';
import { AlertCircle, Info } from 'lucide-react';

interface PurchaseRequestModuleProps {
  masters: Record<MasterType, MasterRecord[]>;
  purchaseRequests: PurchaseRequest[];
  setPurchaseRequests: React.Dispatch<React.SetStateAction<PurchaseRequest[]>>;
  onCreatePO: (pr: PurchaseRequest) => void;
  currentUser: User;
  workflows: WorkflowRule[];
  budgets: Budget[];
}

const PurchaseRequestModule: React.FC<PurchaseRequestModuleProps> = ({ 
  masters, purchaseRequests, setPurchaseRequests, onCreatePO, currentUser, workflows, budgets
}) => {
  const [showForm, setShowForm] = useState(false);
  const [prForm, setPrForm] = useState<Partial<PurchaseRequest>>({
    entityName: masters.Entity?.[0]?.name || '',
    vendorId: '',
    vendorSiteId: '',
    transactionType: getItemTypesFromMasters(masters)[0]?.name ?? '',
    validFrom: '',
    validTo: '',
    requiredDate: '',
    frequency: 'One-Time',
    department: '',
    subDepartment: '',
    paymentTerms: '',
    centerNames: [],
    items: [{ id: Math.random().toString(), itemName: '', quantity: 1, rate: 0, amount: 0, remarks: '' }],
    amount: 0,
    remarks: '',
    attachments: [],
    isUnbudgeted: false,
    unbudgetedJustification: ''
  });

  const [budgetExceeded, setBudgetExceeded] = useState(false);

  const addItem = () => {
    setPrForm(prev => ({
      ...prev,
      items: [...(prev.items || []), { id: Math.random().toString(), itemName: '', quantity: 1, rate: 0, amount: 0, remarks: '', coaCode: '' }]
    }));
  };

  const removeItem = (id: string) => {
    setPrForm(prev => {
      const updatedItems = (prev.items || []).filter(i => i.id !== id);
      const total = updatedItems.reduce((sum, i) => sum + (i.amount || 0), 0);
      const newForm = { ...prev, items: updatedItems, amount: total };
      const budgetCheck = checkBudget(newForm);
      setBudgetExceeded(!budgetCheck.ok);
      return newForm;
    });
  };

  const updateItem = (id: string, field: keyof ItemLine, value: any) => {
    setPrForm(prev => {
      const updatedItems = (prev.items || []).map(item => {
        if (item.id === id) {
          const updated = { ...item, [field]: value };
          if (field === 'itemName') {
            const itemMaster = masters.Item.find(i => i.name === value);
            updated.coaCode = itemMaster?.coaCode || '';
          }
          if (field === 'quantity' || field === 'rate') {
            updated.amount = (updated.quantity || 0) * (updated.rate || 0);
          }
          return updated;
        }
        return item;
      });
      const total = updatedItems.reduce((sum, i) => sum + (i.amount || 0), 0);
      const newForm = { ...prev, items: updatedItems, amount: total };
      const budgetCheck = checkBudget(newForm);
      setBudgetExceeded(!budgetCheck.ok);
      // If budget is now available, uncheck unbudgeted
      if (budgetCheck.ok) {
        newForm.isUnbudgeted = false;
        newForm.unbudgetedJustification = '';
      }
      return newForm;
    });
  };

  const checkBudget = (pr: Partial<PurchaseRequest>) => {
    if (pr.isUnbudgeted) return { ok: true };

    const errors: string[] = [];
    pr.items?.forEach(item => {
      if (!item.coaCode) return;
      const budget = budgets.find(b => b.coaCode === item.coaCode);
      if (!budget) {
        errors.push(`No budget found for GL Code ${item.coaCode}`);
        return;
      }
      const available = budget.amount - budget.consumedAmount;
      if (item.amount > available && budget.controlType === BudgetControlType.HARD_STOP) {
        errors.push(`Budget exceeded for GL ${item.coaCode} - Available: ₹${available.toLocaleString()} | Required: ₹${item.amount.toLocaleString()}`);
      }
    });

    return { ok: errors.length === 0, errors };
  };

  const handleCreatePR = () => {
    if (!prForm.department || !prForm.subDepartment || (prForm.centerNames || []).length === 0) {
      alert('Please fill all mandatory fields.');
      return;
    }

    if (prForm.isUnbudgeted && !prForm.unbudgetedJustification) {
      alert('Justification is mandatory for unbudgeted expenses.');
      return;
    }

    const budgetCheck = checkBudget(prForm);
    if (!budgetCheck.ok) {
      alert(budgetCheck.errors?.join('\n'));
      return;
    }

    const newPR: PurchaseRequest = {
      ...prForm as PurchaseRequest,
      id: `PR-${Math.floor(Math.random() * 10000)}`,
      status: budgetCheck.ok ? 'Pending' : 'Budget Hold',
      currentStepIndex: 0,
      createdAt: new Date().toISOString(),
      attachments: prForm.attachments || []
    };
    setPurchaseRequests([...purchaseRequests, newPR]);
    setShowForm(false);
    resetForm();
  };

  const resetForm = () => {
    setPrForm({
      entityName: masters.Entity?.[0]?.name || '',
      vendorId: '', vendorSiteId: '', transactionType: getItemTypesFromMasters(masters)[0]?.name ?? '', validFrom: '', validTo: '', requiredDate: '',
      frequency: 'One-Time', department: '', subDepartment: '', paymentTerms: '',
      centerNames: [], items: [{ id: Math.random().toString(), itemName: '', quantity: 1, rate: 0, amount: 0, remarks: '', coaCode: '' }],
      amount: 0, remarks: '', attachments: [],
      isUnbudgeted: false, unbudgetedJustification: ''
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
      source: 'PR'
    };

    setPrForm(prev => ({ ...prev, attachments: [...(prev.attachments || []), newAttachment] }));
    e.target.value = '';
  };

  const canApprove = (pr: PurchaseRequest) => {
    if (pr.status !== 'Pending') return false;
    
    const rule = workflows.find(w => 
      w.entityName === pr.entityName &&
      w.moduleType === ModuleType.PR &&
      w.subDepartment === pr.subDepartment &&
      (!w.centerName || pr.centerNames.includes(w.centerName)) &&
      Number(pr.amount) >= Number(w.minAmount) && 
      (w.maxAmount == null || Number(pr.amount) <= Number(w.maxAmount))
    );

    if (!rule) {
      const anyRuleForModule = workflows.some(w => w.moduleType === ModuleType.PR);
      return !anyRuleForModule;
    }
    if (rule.approvalChain.length === 0) return true;

    const currentStep = rule.approvalChain[pr.currentStepIndex];
    if (!currentStep) return false;

    return currentStep.type === ApprovalType.APPROVER && currentStep.userIds.includes(currentUser.id);
  };

  const canCompleteReview = (pr: PurchaseRequest) => {
    if (pr.status !== 'Pending') return false;
    const rule = workflows.find(w => 
      w.entityName === pr.entityName &&
      w.moduleType === ModuleType.PR &&
      w.subDepartment === pr.subDepartment &&
      (!w.centerName || pr.centerNames.includes(w.centerName)) &&
      Number(pr.amount) >= Number(w.minAmount) && 
      (w.maxAmount == null || Number(pr.amount) <= Number(w.maxAmount))
    );
    if (!rule || rule.approvalChain.length === 0) return false;
    const currentStep = rule.approvalChain[pr.currentStepIndex];
    if (!currentStep) return false;
    return currentStep.type === ApprovalType.REVIEWER && currentStep.userIds.includes(currentUser.id);
  };

  const completeReviewPR = (id: string) => {
    setPurchaseRequests(prev => prev.map(pr => {
      if (pr.id !== id) return pr;
      const rule = workflows.find(w => 
        w.entityName === pr.entityName &&
        w.moduleType === ModuleType.PR &&
        w.subDepartment === pr.subDepartment &&
        (!w.centerName || pr.centerNames.includes(w.centerName)) &&
        Number(pr.amount) >= Number(w.minAmount) && 
        (w.maxAmount == null || Number(pr.amount) <= Number(w.maxAmount))
      );
      if (!rule || pr.currentStepIndex >= rule.approvalChain.length - 1) return pr;
      return { ...pr, currentStepIndex: pr.currentStepIndex + 1 };
    }));
  };

  const approvePR = (id: string) => {
    setPurchaseRequests(prev => prev.map(pr => {
      if (pr.id !== id) return pr;

      const rule = workflows.find(w => 
        w.entityName === pr.entityName &&
        w.moduleType === ModuleType.PR &&
        w.subDepartment === pr.subDepartment &&
        (!w.centerName || pr.centerNames.includes(w.centerName)) &&
        Number(pr.amount) >= Number(w.minAmount) && 
        (w.maxAmount == null || Number(pr.amount) <= Number(w.maxAmount))
      );

      if (!rule || pr.currentStepIndex >= rule.approvalChain.length - 1) {
        return { ...pr, status: 'Approved' };
      }

      return { ...pr, currentStepIndex: pr.currentStepIndex + 1 };
    }));
  };

  const amendPR = (id: string) => {
    setPurchaseRequests(purchaseRequests.map(pr => pr.id === id ? { ...pr, status: 'Pending', currentStepIndex: 0 } : pr));
    alert('PR status reset to Pending for amendment. It will follow the approval workflow again.');
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-black text-slate-800 tracking-tight">Purchase Request Management</h2>
        {!showForm && (
          <button 
            onClick={() => setShowForm(true)}
            className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-black shadow-lg shadow-indigo-200 hover:scale-105 transition-transform"
          >
            + Raise New PR
          </button>
        )}
      </div>

      {showForm ? (
        <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-black text-slate-900">New Purchase Request</h3>
            <button onClick={() => { setShowForm(false); resetForm(); }} className="text-slate-400 hover:text-slate-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Entity</label>
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={prForm.entityName}
                onChange={e => setPrForm({ ...prForm, entityName: e.target.value })}
              >
                {masters.Entity.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Vendor</label>
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={prForm.vendorId}
                onChange={e => setPrForm({ ...prForm, vendorId: e.target.value, vendorSiteId: '' })}
              >
                <option value="">Select Vendor</option>
                {masters.Vendor.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Vendor Site</label>
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={prForm.vendorSiteId}
                onChange={e => setPrForm({ ...prForm, vendorSiteId: e.target.value })}
                disabled={!prForm.vendorId}
              >
                <option value="">Select Vendor Site</option>
                {masters['Vendor Site']?.filter(s => s.vendorId === prForm.vendorId).map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Item type</label>
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={prForm.transactionType}
                onChange={e => setPrForm({ ...prForm, transactionType: e.target.value })}
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
                value={prForm.validFrom}
                onChange={e => setPrForm({ ...prForm, validFrom: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Validity To</label>
              <input 
                type="date" 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={prForm.validTo}
                onChange={e => setPrForm({ ...prForm, validTo: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Required Date</label>
              <input 
                type="date" 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={prForm.requiredDate || ''}
                onChange={e => setPrForm({ ...prForm, requiredDate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Frequency</label>
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={prForm.frequency}
                onChange={e => setPrForm({ ...prForm, frequency: e.target.value as Frequency })}
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
                value={prForm.department}
                onChange={e => setPrForm({ ...prForm, department: e.target.value, subDepartment: '' })}
              >
                <option value="">Select Department</option>
                {getDepartments(masters).map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Sub-Department</label>
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={prForm.subDepartment}
                onChange={e => setPrForm({ ...prForm, subDepartment: e.target.value })}
                disabled={!prForm.department}
              >
                <option value="">Select Sub-Department</option>
                {getSubdepartmentsForDepartment(masters, prForm.department).map(sd => (
                  <option key={sd.id} value={sd.name}>{sd.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Payment Terms</label>
              <select 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={prForm.paymentTerms}
                onChange={e => setPrForm({ ...prForm, paymentTerms: e.target.value })}
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
                value={prForm.termsAndConditionsId}
                onChange={e => setPrForm({ ...prForm, termsAndConditionsId: e.target.value })}
              >
                <option value="">Select Terms & Conditions</option>
                {masters['Terms & Conditions']?.map(tc => (
                  <option key={tc.id} value={tc.id}>{tc.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <MultiSelect 
                label="Centers"
                options={CENTERS}
                selected={prForm.centerNames || []}
                onChange={centers => setPrForm({ ...prForm, centerNames: centers })}
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-black text-slate-500 uppercase tracking-wider">Remarks</label>
              <textarea 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 outline-none font-medium"
                value={prForm.remarks}
                onChange={e => setPrForm({ ...prForm, remarks: e.target.value })}
                placeholder="Reason for request..."
              />
            </div>

            {budgetExceeded && (
              <div className="space-y-4 md:col-span-2 bg-amber-50 p-6 rounded-2xl border border-amber-100 animate-in fade-in slide-in-from-top-2 duration-300">
                <div className="flex items-center gap-3">
                  <input 
                    type="checkbox" 
                    id="unbudgeted"
                    className="w-5 h-5 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                    checked={prForm.isUnbudgeted}
                    onChange={e => setPrForm({ ...prForm, isUnbudgeted: e.target.checked })}
                  />
                  <label htmlFor="unbudgeted" className="text-sm font-black text-amber-900 uppercase tracking-wider">Unbudgeted Expense</label>
                </div>
                {prForm.isUnbudgeted && (
                  <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                    <label className="text-xs font-bold text-amber-700 uppercase tracking-wider">Justification (Mandatory)</label>
                    <textarea 
                      className="w-full bg-white border border-amber-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-amber-500 outline-none font-medium text-sm"
                      value={prForm.unbudgetedJustification}
                      onChange={e => setPrForm({ ...prForm, unbudgetedJustification: e.target.value })}
                      placeholder="Provide justification for emergency/unplanned spend..."
                    />
                  </div>
                )}
              </div>
            )}

            <div className="col-span-2 space-y-4 mt-4">
              <div className="flex justify-between items-center">
                <h4 className="text-sm font-black text-slate-700 uppercase tracking-wider">Requested Items</h4>
                <button onClick={addItem} className="text-indigo-600 text-xs font-black hover:underline">+ Add Item</button>
              </div>
              <div className="space-y-3">
                {prForm.items?.map((item, idx) => (
                  <div key={item.id} className="grid grid-cols-12 gap-4 items-end bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    <div className="col-span-3 space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase">Item Name</label>
                      <select 
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 font-bold"
                        value={item.itemName}
                        onChange={e => updateItem(item.id, 'itemName', e.target.value)}
                      >
                        <option value="">Select Item</option>
                        {masters.Item.filter(i => !prForm.items?.some(selected => selected.id !== item.id && selected.itemName === i.name)).map(i => (
                          <option key={i.id} value={i.name}>{i.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="col-span-1 space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase">Qty</label>
                      <input 
                        type="number"
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                        value={item.quantity}
                        onChange={e => updateItem(item.id, 'quantity', Number(e.target.value))}
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase">Est. Rate</label>
                      <input 
                        type="number"
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                        value={item.rate}
                        onChange={e => updateItem(item.id, 'rate', Number(e.target.value))}
                      />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase">Amount</label>
                      <div className="w-full bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold text-slate-700">
                        ₹{(Number(item.amount) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div className="col-span-3 space-y-1">
                      <label className="text-[10px] font-black text-slate-400 uppercase">Remarks</label>
                      <input 
                        type="text"
                        className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                        value={item.remarks}
                        onChange={e => updateItem(item.id, 'remarks', e.target.value)}
                      />
                    </div>
                    <div className="col-span-1 flex justify-center pb-2">
                      <button onClick={() => removeItem(item.id)} className="text-rose-500 hover:bg-rose-50 p-2 rounded-lg transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="col-span-2 border-t border-slate-100 pt-6 mt-4">
              <div className="flex justify-between items-center mb-6">
                <h4 className="text-sm font-black text-slate-700 uppercase tracking-wider">Summary</h4>
                <div className="text-right">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Net Amount</label>
                  <div className="text-2xl font-black text-indigo-600">₹{prForm.amount?.toLocaleString()}</div>
                </div>
              </div>
              <div className="flex justify-between items-center mb-4">
                <h4 className="text-sm font-black text-slate-700 uppercase tracking-wider">Supporting Documents</h4>
                <label className="cursor-pointer">
                  <span className="text-indigo-600 text-xs font-black hover:underline">+ Upload File</span>
                  <input type="file" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>
              <div className="flex flex-wrap gap-3">
                {prForm.attachments?.map(att => (
                  <div key={att.id} className="flex items-center bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
                    <svg className="w-4 h-4 text-slate-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                    <span className="text-xs font-bold text-slate-600 truncate max-w-[150px]">{att.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-8 flex justify-end space-x-4">
            <button onClick={() => { setShowForm(false); resetForm(); }} className="px-6 py-3 rounded-xl font-black text-slate-500 hover:bg-slate-50 transition-colors">Cancel</button>
            <button 
              onClick={handleCreatePR}
              className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-black shadow-lg shadow-indigo-200 hover:scale-105 transition-transform"
            >
              Submit Purchase Request
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">PR ID</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Dept</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Items</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Net Amount</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {purchaseRequests.map(pr => (
                <tr key={pr.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <span className="text-sm font-black text-slate-900">{pr.id}</span>
                    <div className="text-[10px] text-slate-400 font-bold">{new Date(pr.createdAt).toLocaleDateString()}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-xs text-slate-400 font-medium">{pr.department} - {pr.subDepartment}</div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-slate-700">{pr.items.length} Items</div>
                    <div className="text-xs text-slate-400 truncate max-w-[200px]">{pr.items.map(i => i.itemName).join(', ')}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm font-black text-indigo-600">₹{pr.amount.toLocaleString()}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                      pr.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' :
                      pr.status === 'Rejected' ? 'bg-rose-100 text-rose-700' :
                      pr.status === 'Budget Hold' ? 'bg-red-100 text-red-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {pr.status}
                    </span>
                    {pr.status === 'Pending' && (
                      <div className="mt-1 text-[10px] font-bold text-slate-400">
                        Step {pr.currentStepIndex + 1}
                      </div>
                    )}
                    {pr.isUnbudgeted && (
                      <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-amber-600">
                        <AlertCircle size={10} /> Unbudgeted
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end space-x-2">
                      {canCompleteReview(pr) && (
                        <button 
                          onClick={() => completeReviewPR(pr.id)}
                          className="bg-amber-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider hover:scale-105 transition-transform"
                        >
                          Complete Review
                        </button>
                      )}
                      {canApprove(pr) && (
                        <button 
                          onClick={() => approvePR(pr.id)}
                          className="bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider hover:scale-105 transition-transform"
                        >
                          Approve
                        </button>
                      )}
                      {pr.status === 'Approved' && (
                        <div className="flex space-x-2">
                          <button 
                            onClick={() => onCreatePO(pr)}
                            className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider hover:scale-105 transition-transform"
                          >
                            Create PO
                          </button>
                          <button 
                            onClick={() => amendPR(pr.id)}
                            className="bg-slate-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider hover:scale-105 transition-transform"
                          >
                            Amend
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {purchaseRequests.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center text-slate-400">
                      <svg className="w-12 h-12 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      <p className="text-sm font-bold">No purchase requests found.</p>
                      <p className="text-xs">Raise a new PR to get started.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default PurchaseRequestModule;
