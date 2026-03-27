
import React, { useState, useRef, useEffect } from 'react';
import { WorkflowRule, User, ApprovalType, ApprovalStep, MasterRecord, ModuleType } from '../types';
import { getAllSubdepartments } from '../utils/mastersHelpers';
import BulkImport from './BulkImport';

interface WorkflowConfigurationProps {
  workflows: WorkflowRule[];
  setWorkflows: React.Dispatch<React.SetStateAction<WorkflowRule[]>>;
  users: User[];
  masters: Record<string, MasterRecord[]>;
}

const MultiUserSelector: React.FC<{
  selectedUserIds: string[];
  users: User[];
  onChange: (userIds: string[]) => void;
}> = ({ selectedUserIds, users, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleUser = (userId: string) => {
    if (selectedUserIds.includes(userId)) {
      onChange(selectedUserIds.filter(id => id !== userId));
    } else {
      onChange([...selectedUserIds, userId]);
    }
  };

  return (
    <div className="relative inline-block" ref={wrapperRef}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="text-[11px] font-bold text-slate-700 bg-transparent border-none focus:ring-0 min-w-[140px] cursor-pointer hover:bg-slate-50 px-2 py-1 rounded transition-colors flex items-center justify-between group"
      >
        <span className="truncate max-w-[120px]">
          {selectedUserIds.length > 0 
            ? `${selectedUserIds.length} User(s) Selected` 
            : 'Select User(s)'}
        </span>
        <svg className={`w-3 h-3 ml-1 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {isOpen && (
        <div className="absolute z-[100] mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="p-2 bg-slate-50 border-b border-slate-100">
            <div className="relative">
              <input 
                autoFocus
                type="text"
                placeholder="Search name or email..."
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500/20 outline-none"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 min-h-[120px] bg-white">
            {filteredUsers.length > 0 ? (
              filteredUsers.map(u => (
                <button
                  key={u.id}
                  onClick={() => toggleUser(u.id)}
                  className={`w-full text-left px-3 py-2 hover:bg-indigo-50 flex items-center justify-between transition-colors ${selectedUserIds.includes(u.id) ? 'bg-indigo-50/50' : ''}`}
                >
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold text-slate-800">{u.name}</span>
                    <span className="text-[9px] text-slate-400 font-medium truncate">{u.email}</span>
                  </div>
                  {selectedUserIds.includes(u.id) && (
                    <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))
            ) : (
              <div className="px-3 py-4 text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest">No matching users</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const RELEVANT_MODULES = [
  ModuleType.RATE_CONTRACT,
  ModuleType.PR,
  ModuleType.PO,
  ModuleType.GRN,
  ModuleType.INVOICE_GRN,
  ModuleType.DIRECT_INVOICE
];

const WORKFLOW_FILTERS_KEY = 'workflow_config_filters_v1';

const WorkflowConfiguration: React.FC<WorkflowConfigurationProps> = ({ workflows, setWorkflows, users, masters }) => {
  const allSubdeptNames = (getAllSubdepartments(masters as Record<string, MasterRecord[]>)).map((s) => s.name);
  const persisted = (() => {
    try {
      const raw = sessionStorage.getItem(WORKFLOW_FILTERS_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as {
        selectedEntity?: string;
        selectedModuleType?: ModuleType;
        selectedSubDept?: string;
        selectedCenter?: string;
      };
    } catch {
      return null;
    }
  })();
  const [selectedEntity, setSelectedEntity] = useState<string>(persisted?.selectedEntity || masters['Entity']?.[0]?.name || '');
  const [selectedModuleType, setSelectedModuleType] = useState<ModuleType>(
    RELEVANT_MODULES.includes((persisted?.selectedModuleType as ModuleType) || RELEVANT_MODULES[0])
      ? ((persisted?.selectedModuleType as ModuleType) || RELEVANT_MODULES[0])
      : RELEVANT_MODULES[0]
  );
  const [selectedSubDept, setSelectedSubDept] = useState<string>(persisted?.selectedSubDept || allSubdeptNames[0] || '');
  const [selectedCenter, setSelectedCenter] = useState<string>(persisted?.selectedCenter || 'All Centers');
  const [isImportOpen, setIsImportOpen] = useState(false);

  useEffect(() => {
    const names = (getAllSubdepartments(masters as Record<string, MasterRecord[]>)).map((s) => s.name);
    if (names.length > 0 && (!selectedSubDept || !names.includes(selectedSubDept))) {
      setSelectedSubDept(names[0]);
    }
  }, [masters, selectedSubDept]);

  useEffect(() => {
    const entityNames = (masters['Entity'] || []).map((e) => e.name);
    if (entityNames.length > 0 && (!selectedEntity || !entityNames.includes(selectedEntity))) {
      setSelectedEntity(entityNames[0]);
    }
    if (!RELEVANT_MODULES.includes(selectedModuleType)) {
      setSelectedModuleType(RELEVANT_MODULES[0]);
    }
    const centers = (masters['Center'] || []).map((c) => c.name);
    if (selectedCenter !== 'All Centers' && !centers.includes(selectedCenter)) {
      setSelectedCenter('All Centers');
    }
  }, [masters, selectedEntity, selectedModuleType, selectedCenter]);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        WORKFLOW_FILTERS_KEY,
        JSON.stringify({
          selectedEntity,
          selectedModuleType,
          selectedSubDept,
          selectedCenter,
        })
      );
    } catch {
      // ignore storage errors
    }
  }, [selectedEntity, selectedModuleType, selectedSubDept, selectedCenter]);

  const activeWorkflows = workflows
    .filter(w => 
      w.entityName === selectedEntity &&
      w.moduleType === selectedModuleType &&
      w.subDepartment === selectedSubDept && 
      (selectedCenter === 'All Centers' ? !w.centerName : w.centerName === selectedCenter)
    )
    .sort((a, b) => a.minAmount - b.minAmount);

  const recalculateRanges = (allWorkflows: WorkflowRule[], entity: string, module: ModuleType, subDept: string, center?: string): WorkflowRule[] => {
    const others = allWorkflows.filter(w => 
      w.entityName !== entity ||
      w.moduleType !== module ||
      w.subDepartment !== subDept || 
      w.centerName !== center
    );
    const current = allWorkflows
      .filter(w => 
        w.entityName === entity &&
        w.moduleType === module &&
        w.subDepartment === subDept && 
        w.centerName === center
      )
      .sort((a, b) => a.minAmount - b.minAmount);

    const updatedCurrent = current.map((wf, idx) => {
      if (idx === 0) return { ...wf, minAmount: 0 };
      const prev = current[idx - 1];
      const newMin = prev.maxAmount !== null ? prev.maxAmount + 1 : wf.minAmount;
      return { ...wf, minAmount: newMin };
    });

    return [...others, ...updatedCurrent];
  };

  const handleAddLimit = () => {
    const lastRule = activeWorkflows[activeWorkflows.length - 1];
    if (lastRule && lastRule.maxAmount === null) {
      alert("Please set a 'Max Amount' for the existing last range before adding a new one.");
      return;
    }
    const suggestedMin = lastRule ? lastRule.maxAmount! + 1 : 0;
    const newRule: WorkflowRule = {
      id: Math.random().toString(36).substr(2, 9),
      entityName: selectedEntity,
      moduleType: selectedModuleType,
      subDepartment: selectedSubDept,
      centerName: selectedCenter === 'All Centers' ? undefined : selectedCenter,
      minAmount: suggestedMin,
      maxAmount: null,
      approvalChain: [{ id: Math.random().toString(36).substr(2, 9), type: ApprovalType.REVIEWER, userIds: [users[0]?.id || ''] }],
      isActive: true
    };
    const newList = [...workflows, newRule];
    setWorkflows(recalculateRanges(newList, selectedEntity, selectedModuleType, selectedSubDept, newRule.centerName));
  };

  const handleUpdateLimit = (id: string, updates: Partial<WorkflowRule>) => {
    const rule = workflows.find(w => w.id === id);
    if (!rule) return;
    const updatedBase = workflows.map(w => w.id === id ? { ...w, ...updates } : w);
    if (updates.hasOwnProperty('maxAmount')) {
      setWorkflows(recalculateRanges(updatedBase, rule.entityName, rule.moduleType, rule.subDepartment, rule.centerName));
    } else {
      setWorkflows(updatedBase);
    }
  };

  const handleDeleteLimit = (id: string) => {
    const rule = workflows.find(w => w.id === id);
    if (!rule) return;
    if (confirm('Delete this amount range and its entire sequence?')) {
      const filtered = workflows.filter(w => w.id !== id);
      setWorkflows(recalculateRanges(filtered, rule.entityName, rule.moduleType, rule.subDepartment, rule.centerName));
    }
  };

  const handleAddUser = (ruleId: string) => {
    setWorkflows(prev => prev.map(w => {
      if (w.id === ruleId) {
        const newStep: ApprovalStep = { id: Math.random().toString(36).substr(2, 9), type: ApprovalType.REVIEWER, userIds: [users[0]?.id || ''] };
        return { ...w, approvalChain: [...w.approvalChain, newStep] };
      }
      return w;
    }));
  };

  const handleUpdateStep = (ruleId: string, stepId: string, updates: Partial<ApprovalStep>) => {
    setWorkflows(prev => prev.map(w => {
      if (w.id === ruleId) {
        return { ...w, approvalChain: w.approvalChain.map(s => s.id === stepId ? { ...s, ...updates } : s) };
      }
      return w;
    }));
  };

  const handleRemoveStep = (ruleId: string, stepId: string) => {
    setWorkflows(prev => prev.map(w => {
      if (w.id === ruleId) {
        return { ...w, approvalChain: w.approvalChain.filter(s => s.id !== stepId) };
      }
      return w;
    }));
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden min-h-[600px] flex flex-col">
      <div className="p-8 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-6 justify-between items-end">
        <div className="flex flex-wrap gap-6">
          <div className="max-w-xs space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Entity</label>
            <select 
              value={selectedEntity} 
              onChange={(e) => setSelectedEntity(e.target.value)}
              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all shadow-sm"
            >
              {(masters['Entity'] || []).map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
            </select>
          </div>

          <div className="max-w-xs space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Transaction Type</label>
            <select 
              value={selectedModuleType} 
              onChange={(e) => setSelectedModuleType(e.target.value as ModuleType)}
              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all shadow-sm"
            >
              {RELEVANT_MODULES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="max-w-xs space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Subdepartment</label>
            <select 
              value={selectedSubDept} 
              onChange={(e) => setSelectedSubDept(e.target.value)}
              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all shadow-sm"
            >
              {allSubdeptNames.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="max-w-xs space-y-2">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Center</label>
            <select 
              value={selectedCenter} 
              onChange={(e) => setSelectedCenter(e.target.value)}
              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all shadow-sm"
            >
              <option value="All Centers">All Centers (Default)</option>
              {(masters['Center'] || []).map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
        </div>
        <button 
          onClick={() => setIsImportOpen(true)}
          className="px-6 py-3 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 font-black text-[10px] uppercase tracking-widest rounded-xl transition-all shadow-sm flex items-center space-x-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
          <span>Bulk Import Logic</span>
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 pb-64">
        <div className="inline-block min-w-full align-middle">
          <div className="border border-slate-200 rounded-xl shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 border-collapse">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 border-r border-slate-200 text-center" colSpan={2}>
                    <button 
                      onClick={handleAddLimit}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase tracking-widest py-2 rounded-lg transition-all shadow-md active:scale-95"
                    >
                      Add Limit
                    </button>
                  </th>
                  <th className="px-6 py-3 border-r border-slate-200 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest" colSpan={2}>
                    Amount Range
                  </th>
                  <th className="px-6 py-3 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest min-w-[300px]">
                    Approval Sequence (Reviewers & Approvers)
                  </th>
                </tr>
                <tr className="bg-white border-t border-slate-100 divide-x divide-slate-100">
                  <th className="w-12 px-2 py-2 text-[9px] font-black text-slate-300 uppercase tracking-tighter text-center">Del</th>
                  <th className="w-24 px-4 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Action</th>
                  <th className="w-32 px-4 py-2 text-[10px] font-bold text-slate-600">Min (Locked)</th>
                  <th className="w-32 px-4 py-2 text-[10px] font-bold text-slate-600 border-r border-slate-200">Max</th>
                  <th className="px-4 py-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Flow Chain</span>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {activeWorkflows.map((wf) => (
                  <tr key={wf.id} className="hover:bg-slate-50/30 transition-all">
                    <td className="px-2 py-4 text-center border-r border-slate-100">
                      <button onClick={() => handleDeleteLimit(wf.id)} className="text-slate-300 hover:text-red-500 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </td>
                    <td className="px-4 py-4 border-r border-slate-100">
                      <button onClick={() => handleAddUser(wf.id)} className="w-full bg-slate-900 hover:bg-slate-800 text-white text-[8px] font-black uppercase tracking-tighter py-1.5 rounded-md shadow-sm transition-all active:scale-95">
                        Add User
                      </button>
                    </td>
                    <td className="px-4 py-4">
                      <input type="number" value={wf.minAmount} readOnly className="w-full px-2 py-2 text-sm font-bold bg-slate-100 border border-slate-200 rounded-lg text-slate-500 cursor-not-allowed outline-none" title="Auto-calculated" />
                    </td>
                    <td className="px-4 py-4 border-r border-slate-200">
                      <input type="number" value={wf.maxAmount === null ? '' : wf.maxAmount} onChange={(e) => handleUpdateLimit(wf.id, { maxAmount: e.target.value === '' ? null : parseInt(e.target.value) })} className="w-full px-2 py-2 text-sm font-bold bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:bg-white transition-all outline-none" placeholder="No Limit" />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap items-center gap-4">
                        {wf.approvalChain.map((step, idx) => {
                          const selectedUsers = users.filter(u => step.userIds.includes(u.id));
                          return (
                            <div key={step.id} className="flex items-center bg-white border border-slate-200 rounded-xl p-2 pr-3 shadow-sm space-x-3 group relative hover:border-indigo-300 transition-all">
                              <div className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-[9px] font-black shadow-lg">{idx + 1}</div>
                              <div className="flex flex-col space-y-1">
                                <div className="flex items-center space-x-2">
                                  <select value={step.type} onChange={(e) => handleUpdateStep(wf.id, step.id, { type: e.target.value as ApprovalType })} className={`text-[9px] font-black uppercase px-2 py-1 rounded-lg border-none focus:ring-0 ${step.type === ApprovalType.REVIEWER ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                    <option value={ApprovalType.REVIEWER}>Reviewer</option>
                                    <option value={ApprovalType.APPROVER}>Approver</option>
                                  </select>
                                  <MultiUserSelector users={users} selectedUserIds={step.userIds} onChange={(userIds) => handleUpdateStep(wf.id, step.id, { userIds })} />
                                </div>
                                {selectedUsers.length > 0 && (
                                  <div className="pl-1 text-[10px] font-bold text-slate-500 flex flex-col space-y-0.5">
                                    {selectedUsers.map(u => (
                                      <span key={u.id} className="truncate max-w-[180px] bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
                                        {u.name}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <button onClick={() => handleRemoveStep(wf.id, step.id)} className="w-5 h-5 flex items-center justify-center text-slate-300 hover:text-red-500 transition-colors">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                              {idx < wf.approvalChain.length - 1 && <div className="absolute -right-3 top-1/2 -translate-y-1/2 z-10"><svg className="w-3 h-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7" /></svg></div>}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="p-8 border-t border-slate-200 bg-slate-50 flex justify-between items-center">
        <span className="text-[10px] font-bold text-slate-400 uppercase">Workflows are continuous: Min = Previous Max + 1</span>
        <button onClick={() => alert('Changes synced.')} className="px-10 py-3 bg-indigo-600 text-white font-black text-xs uppercase tracking-[0.2em] rounded-xl hover:bg-indigo-700 transition-all shadow-xl active:scale-95">Push Changes</button>
      </div>

      {isImportOpen && (
        <BulkImport 
          type="workflows" 
          users={users}
          masters={masters}
          onImport={(data) => {
            setWorkflows(prev => {
              let updated = [...prev];
              data.forEach(importedRule => {
                updated.push(importedRule);
              });
              const groups = Array.from(new Set(updated.map(u => `${u.entityName}|${u.moduleType}|${u.subDepartment}|${u.centerName || ''}`)));
              groups.forEach(g => {
                const [ent, mod, d, c] = g.split('|');
                updated = recalculateRanges(updated, ent, mod as ModuleType, d, c || undefined);
              });
              return updated;
            });
          }}
          onClose={() => setIsImportOpen(false)} 
        />
      )}
    </div>
  );
};

export default WorkflowConfiguration;
