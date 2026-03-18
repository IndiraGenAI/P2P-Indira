
import React, { useState, useEffect } from 'react';
import { MasterRecord, MasterType, WorkflowV2Rule } from '../types';

/** Seconds after Deploy before Submit for approval appears (covers POST /masters latency). */
const SUBMIT_APPROVAL_DELAY_SEC = 3;
import { COA_CATEGORIES, GST_TYPES, TRANSACTION_TYPES, CENTERS, ENTITIES, MASTER_GROUPS } from '../constants';
import { getAllSubdepartments } from '../utils/mastersHelpers';
import MultiSelect from './MultiSelect';
import { apiPatch } from '../api';

interface MastersManagementProps {
  masters: Record<MasterType, MasterRecord[]>;
  onUpdate: (type: MasterType, records: MasterRecord[]) => void;
  /** null = all sub-modules; [] = none; non-empty = only these. */
  allowedMasterTypes?: MasterType[] | null;
  /** null = full access (e.g. Super Admin). Otherwise per sub-module create/edit/view/delete. */
  mastersPermissions?: Partial<Record<MasterType, ('create' | 'edit' | 'view' | 'delete')[]>> | null;
  onRefreshPendingItemVendor?: () => void;
  refetchMasters?: () => Promise<void>;
  workflowV2Rules?: WorkflowV2Rule[];
}

const MastersManagement: React.FC<MastersManagementProps> = ({ masters, onUpdate, allowedMasterTypes = null, mastersPermissions = null, onRefreshPendingItemVendor, refetchMasters, workflowV2Rules = [] }) => {
  const [activeSubTab, setActiveSubTab] = useState<MasterType>('Vendor');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MasterRecord | null>(null);
  
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [submitCooldownUntil, setSubmitCooldownUntil] = useState<Record<string, number>>({});
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const filteredGroups =
    allowedMasterTypes === null || !Array.isArray(allowedMasterTypes)
      ? MASTER_GROUPS
      : MASTER_GROUPS.map((g) => ({
          label: g.label,
          types: g.types.filter((t) => allowedMasterTypes.includes(t)),
        })).filter((g) => g.types.length > 0);

  const allAllowedTypes = filteredGroups.flatMap((g) => g.types);

  useEffect(() => {
    if (allAllowedTypes.length > 0 && !allAllowedTypes.includes(activeSubTab)) {
      setActiveSubTab(allAllowedTypes[0]);
    }
  }, [allAllowedTypes.join(','), activeSubTab]);

  const currentRecords = masters[activeSubTab] || [];

  const canCreate = mastersPermissions == null || (mastersPermissions[activeSubTab] || []).includes('create');
  const canEdit = mastersPermissions == null || (mastersPermissions[activeSubTab] || []).includes('edit');
  const canDelete = mastersPermissions == null || (mastersPermissions[activeSubTab] || []).includes('delete');

  const handleToggleStatus = (id: string) => {
    const updated = currentRecords.map(r => 
      r.id === id ? { ...r, status: r.status === 'Active' ? 'Inactive' : ('Active' as any) } : r
    );
    onUpdate(activeSubTab, updated);
  };

  const handleDelete = (id: string) => {
    if (confirm('Are you sure you want to delete this master record? This action cannot be undone.')) {
      const updated = currentRecords.filter(r => r.id !== id);
      onUpdate(activeSubTab, updated);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    let updated;
    if (editingRecord) {
      updated = currentRecords.map(r => r.id === editingRecord.id ? { ...r, ...formData } : r);
    } else {
      // Fix: Explicitly type finalData to allow dynamic property access like 'code'
      let finalData: Record<string, any> = { 
        status: 'Active',
        ...formData 
      };
      
      // Auto-generate code for Vendor
      if (activeSubTab === 'Vendor' && !finalData.code) {
        const count = (masters['Vendor'] || []).length + 1;
        finalData.code = `VND${count.toString().padStart(4, '0')}`;
      }

      const newRecord: MasterRecord = {
        id: Math.random().toString(36).substr(2, 9),
        name: formData.name || '',
        ...finalData
      } as MasterRecord;
      updated = [...currentRecords, newRecord];
      if (activeSubTab === 'Item' || activeSubTab === 'Vendor') {
        const key = `${activeSubTab}:${newRecord.id}`;
        setSubmitCooldownUntil((prev) => ({
          ...prev,
          [key]: Date.now() + SUBMIT_APPROVAL_DELAY_SEC * 1000,
        }));
      }
    }
    onUpdate(activeSubTab, updated);
    setIsModalOpen(false);
    setEditingRecord(null);
    setFormData({});
  };

  const openAddModal = () => {
    setEditingRecord(null);
    setFormData({ status: 'Active' });
    setIsModalOpen(true);
  };

  const openEditModal = (record: MasterRecord) => {
    setEditingRecord(record);
    let form: Record<string, any> = { ...record };
    if (activeSubTab === 'Item' && !record.coaId && record.coaCode) {
      const coa = (masters['COA'] || []).find((c: any) => c.code === record.coaCode);
      if (coa) form.coaId = coa.id;
    }
    setFormData(form);
    setIsModalOpen(true);
  };

  const renderFormFields = () => {
    const inputClass = "w-full px-4 py-2 bg-white border border-slate-200 rounded-lg focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all font-bold text-slate-700";
    const labelClass = "text-[10px] font-black text-slate-500 uppercase tracking-widest pl-1 mb-1 block";

    const commonName = (label: string = "Name") => (
      <div className="space-y-1">
        <label className={labelClass}>{label}</label>
        <input required value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} className={inputClass} placeholder={`Enter ${label}...`} />
      </div>
    );

    const commonCode = (label: string = "Code / ID", readonly = false) => (
      <div className="space-y-1">
        <label className={labelClass}>{label}</label>
        <input 
          required={!readonly} 
          readOnly={readonly}
          value={formData.code || ''} 
          onChange={e => setFormData({...formData, code: e.target.value})} 
          className={`${inputClass} ${readonly ? 'bg-slate-50 text-slate-400' : ''}`} 
          placeholder={readonly ? "Auto-generated" : "Unique identifier..."} 
        />
      </div>
    );

    const commonStatus = (
      <div className="space-y-1">
        <label className={labelClass}>Operational Status</label>
        <select 
          value={formData.status || 'Active'} 
          onChange={e => setFormData({...formData, status: e.target.value})} 
          className={`${inputClass} ${formData.status === 'Inactive' ? 'text-rose-500' : 'text-emerald-600'}`}
        >
          <option value="Active">Active</option>
          <option value="Inactive">Inactive</option>
        </select>
      </div>
    );

    switch (activeSubTab) {
      case 'Vendor':
        const isMSME = ['Micro', 'Small', 'Medium'].includes(formData.vendorType);
        return (
          <div className="space-y-8">
            <div className="grid grid-cols-2 gap-4">
              {commonCode("Vendor Code (Auto-generated)", true)}
              {commonName("Vendor Name")}
            </div>
            
            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-1">Address Details</h4>
              <div className="grid grid-cols-1 gap-4">
                <input value={formData.address1 || ''} onChange={e => setFormData({...formData, address1: e.target.value})} className={inputClass} placeholder="Address Line 1" />
                <input value={formData.address2 || ''} onChange={e => setFormData({...formData, address2: e.target.value})} className={inputClass} placeholder="Address Line 2" />
                <input value={formData.address3 || ''} onChange={e => setFormData({...formData, address3: e.target.value})} className={inputClass} placeholder="Address Line 3" />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <select value={formData.stateId || ''} onChange={e => setFormData({...formData, stateId: e.target.value})} className={inputClass}>
                  <option value="">Select State...</option>
                  {(masters['State'] || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select value={formData.cityId || ''} onChange={e => setFormData({...formData, cityId: e.target.value})} className={inputClass}>
                  <option value="">Select City...</option>
                  {(masters['City'] || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input value={formData.pincode || ''} onChange={e => setFormData({...formData, pincode: e.target.value})} className={inputClass} placeholder="Pincode" />
              </div>
              <MultiSelect 
                label="Assigned Site(s) / Centers"
                options={CENTERS}
                selected={formData.siteIds || []}
                onChange={val => setFormData({...formData, siteIds: val})}
                placeholder="Multiple sites allowed..."
              />
            </div>

            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-1">Contact & Compliance</h4>
              <div className="grid grid-cols-2 gap-4">
                <input value={formData.phone || ''} onChange={e => setFormData({...formData, phone: e.target.value})} className={inputClass} placeholder="Phone Number" />
                <input value={formData.email || ''} onChange={e => setFormData({...formData, email: e.target.value})} className={inputClass} placeholder="Email ID" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <input value={formData.pan || ''} onChange={e => setFormData({...formData, pan: e.target.value})} className={inputClass} placeholder="PAN Number" />
                <input value={formData.gst || ''} onChange={e => setFormData({...formData, gst: e.target.value})} className={inputClass} placeholder="GST Number" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className={labelClass}>Vendor Type (MSME)</label>
                  <select value={formData.vendorType || ''} onChange={e => setFormData({...formData, vendorType: e.target.value})} className={inputClass}>
                    <option value="">Vendor Type (MSME)...</option>
                    <option value="Micro">Micro</option>
                    <option value="Small">Small</option>
                    <option value="Medium">Medium</option>
                    <option value="Large">Large / Other</option>
                  </select>
                </div>
                {isMSME && (
                  <div className="space-y-1 animate-in slide-in-from-left-2 duration-300">
                    <label className={labelClass}>MSME Registration Number</label>
                    <input 
                      required 
                      value={formData.msmeRegNo || ''} 
                      onChange={e => setFormData({...formData, msmeRegNo: e.target.value})} 
                      className={inputClass} 
                      placeholder="Enter MSME Reg No." 
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-1">Bank details</h4>
              <div className="grid grid-cols-1 gap-4">
                <input value={formData.accNo || ''} onChange={e => setFormData({...formData, accNo: e.target.value})} className={inputClass} placeholder="Account Number" />
                <div className="grid grid-cols-2 gap-4">
                  <input value={formData.bankName || ''} onChange={e => setFormData({...formData, bankName: e.target.value})} className={inputClass} placeholder="Bank Name" />
                  <input value={formData.ifsc || ''} onChange={e => setFormData({...formData, ifsc: e.target.value})} className={inputClass} placeholder="IFSC Code" />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-1">Tax, Entity & Category</h4>
              <div className="grid grid-cols-2 gap-4">
                <select value={formData.tdsId || ''} onChange={e => setFormData({...formData, tdsId: e.target.value})} className={inputClass}>
                  <option value="">Select TDS Section...</option>
                  {(masters['TDS'] || []).map(t => <option key={t.id} value={t.id}>{t.name} ({t.rate}%)</option>)}
                </select>
                <select value={formData.payTermId || ''} onChange={e => setFormData({...formData, payTermId: e.target.value})} className={inputClass}>
                  <option value="">Select Payment Terms...</option>
                  {(masters['Payment Terms'] || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <MultiSelect 
                label="Entity Mapping"
                options={ENTITIES}
                selected={formData.entityIds || []}
                onChange={val => setFormData({...formData, entityIds: val})}
                placeholder="Multiple entities allowed..."
              />
              <div className="grid grid-cols-2 gap-4">
                <select value={formData.residency || ''} onChange={e => setFormData({...formData, residency: e.target.value})} className={inputClass}>
                  <option value="">Resident Status...</option>
                  <option value="Resident">Resident</option>
                  <option value="Non-Resident">Non-Resident</option>
                </select>
                <select value={formData.applicantTypeId || ''} onChange={e => setFormData({...formData, applicantTypeId: e.target.value})} className={inputClass}>
                  <option value="">Applicant Type...</option>
                  {(masters['Applicant Type'] || []).map(at => <option key={at.id} value={at.id}>{at.name}</option>)}
                </select>
              </div>
              <select value={formData.categoryId || ''} onChange={e => setFormData({...formData, categoryId: e.target.value})} className={inputClass}>
                <option value="">Vendor Category...</option>
                {(masters['Vendor Category'] || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            
            <div className="space-y-4 pt-4 border-t border-slate-100">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-1">Governance & Status</h4>
              {commonStatus}
            </div>
            
            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-1">Supporting Documents</h4>
              <input type="file" multiple className="text-xs font-bold text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 transition-all" />
            </div>
          </div>
        );

      case 'Vendor Site':
        return (
          <div className="space-y-8">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className={labelClass}>Link Vendor</label>
                <select 
                  required 
                  value={formData.vendorId || ''} 
                  onChange={e => setFormData({...formData, vendorId: e.target.value})} 
                  className={inputClass}
                >
                  <option value="">Select Vendor...</option>
                  {(masters['Vendor'] || []).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              {commonCode("Site Code")}
            </div>
            {commonName("Site Name")}
            
            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest border-b pb-1">Site Details</h4>
              <div className="grid grid-cols-1 gap-4">
                <textarea 
                  value={formData.address || ''} 
                  onChange={e => setFormData({...formData, address: e.target.value})} 
                  className={`${inputClass} h-24`} 
                  placeholder="Full Address (Shipping / Billing)..." 
                />
                <div className="grid grid-cols-2 gap-4">
                  <input value={formData.contactPerson || ''} onChange={e => setFormData({...formData, contactPerson: e.target.value})} className={inputClass} placeholder="Contact Person" />
                  <input value={formData.contactPhone || ''} onChange={e => setFormData({...formData, contactPhone: e.target.value})} className={inputClass} placeholder="Contact Phone" />
                </div>
                <input value={formData.contactEmail || ''} onChange={e => setFormData({...formData, contactEmail: e.target.value})} className={inputClass} placeholder="Contact Email" />
              </div>
            </div>
            {commonStatus}
          </div>
        );

      case 'Entity':
        return (
          <div className="space-y-8">
            <div className="grid grid-cols-2 gap-4">
              {commonCode("Entity Code")}
              {commonName("Entity Name")}
            </div>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center border-b pb-1">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Shipping Addresses</h4>
                <button 
                  type="button"
                  onClick={() => {
                    const current = formData.shippingAddresses || [];
                    setFormData({
                      ...formData,
                      shippingAddresses: [...current, { id: Math.random().toString(36).substr(2, 9), address: '' }]
                    });
                  }}
                  className="text-indigo-600 text-[10px] font-black uppercase tracking-widest hover:underline"
                >
                  + Add Address
                </button>
              </div>
              <div className="space-y-3">
                {(formData.shippingAddresses || []).map((addr: any, idx: number) => (
                  <div key={addr.id} className="flex gap-2">
                    <input 
                      value={addr.address} 
                      onChange={e => {
                        const updated = [...formData.shippingAddresses];
                        updated[idx].address = e.target.value;
                        setFormData({...formData, shippingAddresses: updated});
                      }}
                      className={inputClass}
                      placeholder={`Shipping Address ${idx + 1}`}
                    />
                    <button 
                      type="button"
                      onClick={() => {
                        const updated = formData.shippingAddresses.filter((_: any, i: number) => i !== idx);
                        setFormData({...formData, shippingAddresses: updated});
                      }}
                      className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                ))}
                {(formData.shippingAddresses || []).length === 0 && <p className="text-[10px] text-slate-400 italic">No shipping addresses added.</p>}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center border-b pb-1">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Billing Addresses</h4>
                <button 
                  type="button"
                  onClick={() => {
                    const current = formData.billingAddresses || [];
                    setFormData({
                      ...formData,
                      billingAddresses: [...current, { id: Math.random().toString(36).substr(2, 9), address: '' }]
                    });
                  }}
                  className="text-indigo-600 text-[10px] font-black uppercase tracking-widest hover:underline"
                >
                  + Add Address
                </button>
              </div>
              <div className="space-y-3">
                {(formData.billingAddresses || []).map((addr: any, idx: number) => (
                  <div key={addr.id} className="flex gap-2">
                    <input 
                      value={addr.address} 
                      onChange={e => {
                        const updated = [...formData.billingAddresses];
                        updated[idx].address = e.target.value;
                        setFormData({...formData, billingAddresses: updated});
                      }}
                      className={inputClass}
                      placeholder={`Billing Address ${idx + 1}`}
                    />
                    <button 
                      type="button"
                      onClick={() => {
                        const updated = formData.billingAddresses.filter((_: any, i: number) => i !== idx);
                        setFormData({...formData, billingAddresses: updated});
                      }}
                      className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                ))}
                {(formData.billingAddresses || []).length === 0 && <p className="text-[10px] text-slate-400 italic">No billing addresses added.</p>}
              </div>
            </div>

            {commonStatus}
          </div>
        );

      case 'COA':
        return (
          <div className="space-y-4">
            <div className="space-y-1">
              <label className={labelClass}>COA Category</label>
              <select 
                required 
                value={formData.category || ''} 
                onChange={e => setFormData({...formData, category: e.target.value})} 
                className={inputClass}
              >
                <option value="">Select Category...</option>
                {COA_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            {commonCode("GL Code")}
            {commonName("GL Name")}
            {commonStatus}
          </div>
        );

      case 'Item Type':
        return (
          <div className="space-y-4">
            {commonCode('Item Type Code')}
            {commonName('Item Type Name')}
            {commonStatus}
          </div>
        );

      case 'Item':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {commonCode("Item Code")}
              <div className="space-y-1">
                <label className={labelClass}>Item Type</label>
                <select 
                  required 
                  value={formData.itemType || ''} 
                  onChange={e => setFormData({...formData, itemType: e.target.value})} 
                  className={inputClass}
                >
                  <option value="">Select Type...</option>
                  {(masters['Item Type'] || []).filter((r: any) => r.status !== 'Inactive').map((r: any) => (
                    <option key={r.id} value={r.name}>{r.name}</option>
                  ))}
                </select>
              </div>
            </div>
            {commonName("Item Name")}
            <div className="space-y-1">
              <label className={labelClass}>COA Mapping (Accounting Category)</label>
              <select 
                required 
                value={formData.coaId || ''} 
                onChange={e => setFormData({...formData, coaId: e.target.value})} 
                className={inputClass}
              >
                <option value="">Select COA Account...</option>
                {(masters['COA'] || []).map(c => (
                  <option key={c.id} value={c.id}>
                    {c.category ? `${c.category}: ` : ''}{c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className={labelClass}>Item Category</label>
                <select 
                  required 
                  value={formData.itemCategoryId || ''} 
                  onChange={e => setFormData({...formData, itemCategoryId: e.target.value})} 
                  className={inputClass}
                >
                  <option value="">Select Category...</option>
                  {(masters['Item Category'] || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className={labelClass}>UOM</label>
                <select 
                  required 
                  value={formData.uomId || ''} 
                  onChange={e => setFormData({...formData, uomId: e.target.value})} 
                  className={inputClass}
                >
                  <option value="">Select UOM...</option>
                  {(masters['UOM'] || []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>
            {commonStatus}
          </div>
        );

      case 'Item Category':
      case 'UOM':
        return (
          <div className="space-y-4">
            {commonCode(`${activeSubTab} Code`)}
            {commonName(`${activeSubTab} Name`)}
            {commonStatus}
          </div>
        );

      case 'TDS':
      case 'GST':
        return (
          <div className="space-y-4">
            {commonCode(`${activeSubTab} Code`)}
            {commonName(`${activeSubTab} Name`)}
            <div className="space-y-1">
              <label className={labelClass}>Percentage (%)</label>
              <input 
                type="number" 
                required 
                step="0.01"
                value={formData.rate || ''} 
                onChange={e => setFormData({...formData, rate: Number(e.target.value)})} 
                className={inputClass} 
                placeholder="Enter percentage..." 
              />
            </div>
            {commonStatus}
          </div>
        );

      case 'Subdepartment':
        return (
          <div className="space-y-4">
            {commonCode(`${activeSubTab} Code`)}
            {commonName(`${activeSubTab} Name`)}
            {commonStatus}
          </div>
        );

      case 'Department': {
        const subdeptRecords = getAllSubdepartments(masters);
        const subdeptOptions = subdeptRecords.map((s) => s.name);
        const selectedSubdeptNames = (formData.subdepartmentIds || []).map(
          (id: string) => subdeptRecords.find((s) => s.id === id)?.name
        ).filter(Boolean) as string[];
        return (
          <div className="space-y-4">
            {commonCode(`${activeSubTab} Code`)}
            {commonName(`${activeSubTab} Name`)}
            {commonStatus}
            <div className="space-y-2">
              <label className={labelClass}>Subdepartments under this department</label>
              <MultiSelect
                label=""
                options={subdeptOptions}
                selected={selectedSubdeptNames}
                onChange={(names) =>
                  setFormData({
                    ...formData,
                    subdepartmentIds: names
                      .map((n) => subdeptRecords.find((s) => s.name === n)?.id)
                      .filter(Boolean),
                  })
                }
                placeholder="Select subdepartments to map..."
              />
            </div>
          </div>
        );
      }

      default:
        return (
          <div className="space-y-4">
            {commonCode()}
            {commonName()}
            {commonStatus}
          </div>
        );
    }
  };

  if (filteredGroups.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-slate-500 font-bold">No master sub-modules are assigned to your role. Contact your administrator to get access to Vendor, Vendor Site, or other master data.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        <aside className="space-y-6">
          {filteredGroups.map(group => (
            <div key={group.label} className="space-y-2">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-2 mb-3">{group.label}</h4>
              <div className="space-y-1">
                {group.types.map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveSubTab(tab)}
                    className={`w-full text-left px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                      activeSubTab === tab 
                        ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-100 translate-x-1' 
                        : 'text-slate-500 hover:text-slate-900 hover:bg-white border border-transparent hover:border-slate-100'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        <div className="md:col-span-3 space-y-6">
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
              <div>
                <h3 className="text-xl font-black text-slate-800 tracking-tight uppercase">{activeSubTab} Governance</h3>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">L4 Master Data Control</p>
              </div>
              <button 
                onClick={openAddModal}
                disabled={!canCreate}
                className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest flex items-center space-x-3 transition-all shadow-xl shadow-indigo-100 active:scale-95 ${canCreate ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4" /></svg>
                <span>{activeSubTab} Creation</span>
              </button>
            </div>

            <div className="overflow-x-auto p-4">
              <table className="w-full text-left border-collapse">
                <thead className="bg-white border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Descriptor</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Integration Link</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Protocol Status</th>
                    {(activeSubTab === 'Item' || activeSubTab === 'Vendor') && (
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Workflow Status</th>
                    )}
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {currentRecords.map((record) => {
                    let integrationInfo = record.code || "N/A";
                    if (activeSubTab === 'COA') {
                      integrationInfo = `${record.category ?? record.name ?? ''} | Code: ${record.code ?? 'N/A'}`;
                    } else if (activeSubTab === 'Vendor Site') {
                      const vendor = (masters['Vendor'] || []).find(v => v.id === record.vendorId);
                      integrationInfo = `Vendor: ${vendor ? vendor.name : 'Unknown'} | Code: ${record.code}`;
                    } else if (activeSubTab === 'Item Type') {
                      integrationInfo = record.code || record.name || '—';
                    } else if (activeSubTab === 'Item') {
                      const coaList = masters['COA'] || [];
                      const coa = coaList.find((c: any) => c.id === record.coaId) ?? coaList.find((c: any) => c.code === record.coaCode);
                      const cat = (masters['Item Category'] || []).find((c: any) => c.id === record.itemCategoryId);
                      const uom = (masters['UOM'] || []).find((u: any) => u.id === record.uomId);
                      integrationInfo = `${record.itemType || 'No Type'} | ${coa ? (coa.category || coa.name) : 'No COA'} | ${cat ? cat.name : 'No Cat'} | ${uom ? uom.name : 'No UOM'}`;
                    } else if (activeSubTab === 'TDS' || activeSubTab === 'GST') {
                      integrationInfo = `${record.code} | Rate: ${record.rate}%`;
                    } else if (activeSubTab === 'Department') {
                      const subIds = (record as any).subdepartmentIds || [];
                      const subNames = subIds.map((id: string) => (masters['Subdepartment'] || []).find((s) => s.id === id)?.name).filter(Boolean);
                      integrationInfo = subNames.length > 0 ? subNames.join(', ') : 'None mapped';
                    }
                    
                    return (
                      <tr key={record.id} className={`hover:bg-slate-50/50 transition-colors group ${record.status === 'Inactive' ? 'opacity-50' : ''}`}>
                        <td className="px-6 py-5">
                          <p className={`text-sm font-black tracking-tight ${record.status === 'Inactive' ? 'text-slate-500' : 'text-slate-800'}`}>{record.name || 'Undefined Identity'}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">{record.id.slice(0, 8)}</p>
                        </td>
                        <td className="px-6 py-5">
                          <span className="text-[11px] font-bold text-slate-600 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200">{integrationInfo}</span>
                        </td>
                        <td className="px-6 py-5 text-center">
                          {canEdit ? (
                            <button 
                              onClick={() => handleToggleStatus(record.id)}
                              className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all ${
                                record.status === 'Active' 
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-100 shadow-sm' 
                                  : 'bg-rose-50 text-rose-600 border-rose-100 hover:bg-rose-100'
                              }`}
                            >
                              {record.status}
                            </button>
                          ) : (
                            <span className="text-[9px] font-black uppercase text-slate-400">{record.status}</span>
                          )}
                        </td>
                        {(activeSubTab === 'Item' || activeSubTab === 'Vendor') && (
                          <td className="px-6 py-5 text-center">
                            <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-lg ${
                              (record as any).workflowStatus === 'Approved' ? 'bg-emerald-100 text-emerald-700' :
                              (record as any).workflowStatus === 'Rejected' ? 'bg-rose-100 text-rose-600' :
                              (record as any).workflowStatus === 'Pending' ? 'bg-amber-100 text-amber-700' :
                              'bg-slate-100 text-slate-500'
                            }`}>
                              {(record as any).workflowStatus || 'Draft'}
                            </span>
                            {((record as any).workflowStatus === 'Draft' || !(record as any).workflowStatus) &&
                             workflowV2Rules.some((r) => r.scope === activeSubTab && r.masterId === '__ALL__' && r.isActive) &&
                             refetchMasters &&
                             onRefreshPendingItemVendor && (() => {
                              const cdKey = `${activeSubTab}:${record.id}`;
                              const until = submitCooldownUntil[cdKey];
                              const secsLeft = until ? Math.max(0, Math.ceil((until - nowTick) / 1000)) : 0;
                              const inCooldown = until != null && nowTick < until;
                              return inCooldown ? (
                                <span className="ml-2 inline-block px-3 py-1 bg-slate-200 text-slate-600 text-[9px] font-black uppercase rounded-lg tabular-nums">
                                  Submit in {secsLeft}s
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await apiPatch(`masters/${activeSubTab}/${record.id}/workflow`, { action: 'submit' });
                                      await refetchMasters();
                                      onRefreshPendingItemVendor();
                                    } catch (e) {
                                      alert((e as Error).message || 'Submit failed');
                                    }
                                  }}
                                  className="ml-2 px-3 py-1 bg-indigo-600 text-white text-[9px] font-black uppercase rounded-lg hover:bg-indigo-700"
                                >
                                  Submit for approval
                                </button>
                              );
                            })()}
                          </td>
                        )}
                        <td className="px-6 py-5 text-right">
                          <div className="flex justify-end space-x-3 opacity-0 group-hover:opacity-100 transition-opacity">
                            {canEdit && (
                              <button onClick={() => openEditModal(record)} className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center hover:bg-indigo-600 hover:text-white transition-all shadow-sm">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                              </button>
                            )}
                            {canDelete && (
                              <button onClick={() => handleDelete(record.id)} className="w-8 h-8 rounded-lg bg-rose-50 text-rose-500 flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all shadow-sm">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {currentRecords.length === 0 && (
                    <tr><td colSpan={activeSubTab === 'Item' || activeSubTab === 'Vendor' ? 5 : 4} className="px-6 py-20 text-center italic text-slate-400">No records found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-2xl my-auto animate-in zoom-in duration-200">
            <div className="p-10 border-b border-slate-100 flex justify-between items-center bg-slate-50/30 sticky top-0 z-10">
              <div>
                <h2 className="text-2xl font-black text-slate-800 tracking-tight uppercase">{editingRecord ? 'Sync' : `${activeSubTab} Creation`}</h2>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="w-10 h-10 bg-white rounded-2xl flex items-center justify-center text-slate-400 hover:text-slate-600 transition-all hover:rotate-90">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <form onSubmit={handleSave} className="p-10 space-y-6">
              {renderFormFields()}
              <div className="flex justify-end space-x-4 pt-10 border-t border-slate-50">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-8 py-4 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 rounded-2xl">Discard</button>
                <button type="submit" className="px-12 py-4 bg-indigo-600 text-white font-black text-[10px] uppercase tracking-[0.3em] rounded-2xl hover:bg-indigo-700 shadow-xl shadow-indigo-100 active:scale-95">
                  {editingRecord ? 'Sync' : 'Deploy'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MastersManagement;
