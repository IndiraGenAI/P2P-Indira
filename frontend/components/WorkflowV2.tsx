import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { WorkflowV2Rule, User, ApprovalType, ApprovalStep, MasterRecord } from '../types';
import { apiPost } from '../api';

const MENU_WIDTH = 256;

const MultiUserSelector: React.FC<{
  selectedUserIds: string[];
  users: User[];
  onChange: (userIds: string[]) => void;
}> = ({ selectedUserIds, users, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, maxListH: 320 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const updateMenuPosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - MENU_WIDTH - margin));
    const top = r.bottom + 4;
    const maxListH = Math.max(200, Math.min(384, window.innerHeight - top - margin - 52));
    setMenuPos({ top, left, maxListH });
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    updateMenuPosition();
    window.addEventListener('scroll', updateMenuPosition, true);
    window.addEventListener('resize', updateMenuPosition);
    return () => {
      window.removeEventListener('scroll', updateMenuPosition, true);
      window.removeEventListener('resize', updateMenuPosition);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleMouseDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (dropdownRef.current?.contains(t)) return;
      setIsOpen(false);
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen]);

  const filteredUsers = users.filter((u) => {
    const n = (u.name || '').toLowerCase();
    const e = (u.email || '').toLowerCase();
    const q = searchTerm.toLowerCase();
    return n.includes(q) || e.includes(q);
  });

  const toggleUser = (userId: string) => {
    if (selectedUserIds.includes(userId)) onChange(selectedUserIds.filter((id) => id !== userId));
    else onChange([...selectedUserIds, userId]);
  };

  const dropdown = isOpen ? (
    <div
      ref={dropdownRef}
      className="fixed z-[10000] bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden"
      style={{ top: menuPos.top, left: menuPos.left, width: MENU_WIDTH }}
      role="listbox"
    >
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
      <div
        className="overflow-y-auto scrollbar-thin scrollbar-thumb-slate-200 min-h-[120px] bg-white"
        style={{ maxHeight: menuPos.maxListH }}
      >
        {filteredUsers.length > 0 ? (
          filteredUsers.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => toggleUser(u.id)}
              className={`w-full text-left px-3 py-2 hover:bg-indigo-50 flex items-center justify-between transition-colors ${selectedUserIds.includes(u.id) ? 'bg-indigo-50/50' : ''}`}
            >
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[11px] font-bold text-slate-800 truncate">{u.name || '—'}</span>
                <span className="text-[9px] text-slate-400 font-medium truncate">{u.email || ''}</span>
              </div>
              {selectedUserIds.includes(u.id) && (
                <svg className="w-4 h-4 text-indigo-600 flex-shrink-0 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
  ) : null;

  const toggleOpen = () => {
    setIsOpen((o) => {
      if (o) return false;
      const el = triggerRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const margin = 8;
        const left = Math.max(margin, Math.min(r.left, window.innerWidth - MENU_WIDTH - margin));
        const top = r.bottom + 4;
        const maxListH = Math.max(200, Math.min(384, window.innerHeight - top - margin - 52));
        setMenuPos({ top, left, maxListH });
      }
      return true;
    });
  };

  return (
    <>
      <div
        ref={triggerRef}
        onClick={toggleOpen}
        className="text-[11px] font-bold text-slate-700 bg-transparent border-none focus:ring-0 min-w-[140px] cursor-pointer hover:bg-slate-50 px-2 py-1 rounded transition-colors flex items-center justify-between group inline-flex"
      >
        <span className="truncate max-w-[120px]">
          {selectedUserIds.length > 0 ? `${selectedUserIds.length} User(s) Selected` : 'Select User(s)'}
        </span>
        <svg className={`w-3 h-3 ml-1 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      {dropdown && createPortal(dropdown, document.body)}
    </>
  );
};

interface WorkflowV2Props {
  workflowV2Rules: WorkflowV2Rule[];
  setWorkflowV2Rules: React.Dispatch<React.SetStateAction<WorkflowV2Rule[]>>;
  users: User[];
  masters: Record<string, MasterRecord[]>;
}

const SCOPE_LABELS: Record<string, string> = { Item: 'Items', Vendor: 'Vendors', Budget: 'Budgets' };

const WorkflowV2: React.FC<WorkflowV2Props> = ({ workflowV2Rules, setWorkflowV2Rules, users, masters }) => {
  const [scope, setScope] = useState<'Item' | 'Vendor' | 'Budget'>('Item');
  const [approvalChain, setApprovalChain] = useState<ApprovalStep[]>([]);
  const [saving, setSaving] = useState(false);

  const existingRule = workflowV2Rules.find((r) => r.scope === scope && r.masterId === '__ALL__') ?? null;

  useEffect(() => {
    if (existingRule && existingRule.approvalChain?.length) {
      setApprovalChain(existingRule.approvalChain);
    } else {
      setApprovalChain([{ id: `step-${Date.now()}`, type: ApprovalType.REVIEWER, userIds: [users[0]?.id || ''] }]);
    }
  }, [scope, existingRule?.id]);

  const handleAddStep = () => {
    setApprovalChain((prev) => [
      ...prev,
      { id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, type: ApprovalType.REVIEWER, userIds: [users[0]?.id || ''] },
    ]);
  };

  const handleUpdateStep = (stepId: string, updates: Partial<ApprovalStep>) => {
    setApprovalChain((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...updates } : s)));
  };

  const handleRemoveStep = (stepId: string) => {
    setApprovalChain((prev) => prev.filter((s) => s.id !== stepId));
  };

  const handleSave = async () => {
    if (approvalChain.length === 0 || approvalChain.some((s) => !s.userIds?.length)) {
      alert('Add at least one step with at least one user.');
      return;
    }
    setSaving(true);
    try {
      const id = existingRule?.id || `wv2-${scope}-__ALL__-${Date.now()}`;
      const payload = [{ id, scope, masterId: '__ALL__', approvalChain, isActive: true }];
      const res = await apiPost<WorkflowV2Rule[]>('workflow-v2', payload);
      setWorkflowV2Rules(Array.isArray(res) ? res : []);
      alert('Workflow saved.');
    } catch (e) {
      alert((e as Error).message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden min-h-[500px] flex flex-col">
      <div className="p-8 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-6 items-end">
        <div className="max-w-xs space-y-2">
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Scope</label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as 'Item' | 'Vendor' | 'Budget')}
            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl font-bold text-slate-800 focus:ring-4 focus:ring-indigo-500/10 outline-none"
          >
            <option value="Item">Item</option>
            <option value="Vendor">Vendor</option>
            <option value="Budget">Budget</option>
          </select>
        </div>
      </div>

      <div className="flex-1 p-8">
        <p className="text-slate-500 font-bold mb-4">
          Configure the approval chain for all {SCOPE_LABELS[scope] || scope}.
        </p>
        <>
            <h3 className="text-sm font-black text-slate-700 uppercase tracking-wider mb-4">
              Approval sequence for all {SCOPE_LABELS[scope] || scope}
            </h3>
            <div className="flex flex-wrap items-center gap-4">
              {approvalChain.map((step, idx) => {
                const selectedUsers = users.filter((u) => step.userIds?.includes(u.id));
                return (
                  <div
                    key={step.id}
                    className="flex items-center bg-white border border-slate-200 rounded-xl p-2 pr-3 shadow-sm space-x-3 group relative"
                  >
                    <div className="w-6 h-6 rounded-full bg-slate-900 text-white flex items-center justify-center text-[9px] font-black">
                      {idx + 1}
                    </div>
                    <div className="flex flex-col space-y-1">
                      <div className="flex items-center space-x-2">
                        <select
                          value={step.type}
                          onChange={(e) => handleUpdateStep(step.id, { type: e.target.value as ApprovalType })}
                          className={`text-[9px] font-black uppercase px-2 py-1 rounded-lg border-none focus:ring-0 ${
                            step.type === ApprovalType.REVIEWER ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          <option value={ApprovalType.REVIEWER}>Reviewer</option>
                          <option value={ApprovalType.APPROVER}>Approver</option>
                        </select>
                        <MultiUserSelector
                          users={users}
                          selectedUserIds={step.userIds || []}
                          onChange={(userIds) => handleUpdateStep(step.id, { userIds })}
                        />
                      </div>
                      {selectedUsers.length > 0 && (
                        <div className="pl-1 text-[10px] font-bold text-slate-500">
                          {selectedUsers.map((u) => (
                            <span key={u.id} className="mr-1 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100">
                              {u.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveStep(step.id)}
                      className="w-5 h-5 flex items-center justify-center text-slate-300 hover:text-red-500"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    {idx < approvalChain.length - 1 && (
                      <div className="absolute -right-3 top-1/2 -translate-y-1/2 z-10">
                        <svg className="w-3 h-3 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                onClick={handleAddStep}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black uppercase rounded-lg"
              >
                Add Step
              </button>
            </div>
        </>
      </div>

      <div className="p-8 border-t border-slate-200 bg-slate-50 flex justify-end">
        <button
          onClick={handleSave}
          disabled={approvalChain.length === 0 || approvalChain.some((s) => !s.userIds?.length) || saving}
          className="px-10 py-3 bg-indigo-600 text-white font-black text-xs uppercase tracking-[0.2em] rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : 'Save Workflow'}
        </button>
      </div>
    </div>
  );
};

export default WorkflowV2;
