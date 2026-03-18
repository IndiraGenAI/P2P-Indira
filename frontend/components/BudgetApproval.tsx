import React, { useState, useEffect } from 'react';
import { User, Budget } from '../types';
import { apiGet, apiPatch } from '../api';

interface PendingItem {
  scope: string;
  masterId: string;
  masterName: string;
  currentStepIndex: number;
  ruleId: string;
  stepType: string;
}

interface BudgetApprovalProps {
  budgets: Budget[];
  users: User[];
  currentUser: User;
  onAction: () => void;
  setBudgets: React.Dispatch<React.SetStateAction<Budget[]>>;
  refetchMasters?: () => Promise<void>;
}

const BudgetApproval: React.FC<BudgetApprovalProps> = ({ budgets, users, currentUser, onAction, setBudgets, refetchMasters }) => {
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectRemarks, setRejectRemarks] = useState('');

  const fetchPending = async () => {
    try {
      const res = await apiGet<PendingItem[]>('workflow-v2/pending');
      const list = Array.isArray(res) ? res : [];
      setPending(list.filter((p) => p.scope === 'Budget'));
    } catch {
      setPending([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPending();
  }, [currentUser?.id]);

  const handleAction = async (
    budgetId: string,
    action: 'completeReview' | 'approve' | 'reject',
    rejectionRemarks?: string
  ) => {
    try {
      const updated = await apiPatch<Budget>(`budgets/${budgetId}/workflow`, {
        action,
        rejectionRemarks: rejectionRemarks || undefined,
      });
      setBudgets((prev) => prev.map((b) => (b.id === budgetId ? { ...b, ...updated } : b)));
      await fetchPending();
      await refetchMasters?.();
      onAction();
    } catch (e) {
      alert((e as Error).message || 'Action failed');
    } finally {
      setRejectingId(null);
      setRejectRemarks('');
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-12 text-center">
        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
        <p className="mt-4 font-bold text-slate-600">Loading...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
      <div className="p-8 border-b border-slate-200 bg-slate-50/50">
        <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">Budget Approval</h2>
        <p className="text-sm text-slate-500 mt-1">
          Budgets pending your review or approval.
        </p>
      </div>
      <div className="p-6">
        {pending.length === 0 ? (
          <div className="text-center py-16 text-slate-500 font-bold">
            No pending Budget approvals for you.
          </div>
        ) : (
          <div className="space-y-4">
            {pending.map((p) => (
              <div
                key={p.masterId}
                className="border border-slate-200 rounded-xl p-6 bg-white shadow-sm flex flex-wrap items-center justify-between gap-4"
              >
                <div>
                  <p className="text-lg font-black text-slate-800">{p.masterName || p.masterId}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Step {p.currentStepIndex + 1} — {p.stepType}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  {p.stepType === 'Reviewer' && (
                    <button
                      onClick={() => handleAction(p.masterId, 'completeReview')}
                      className="px-6 py-2.5 bg-amber-600 text-white font-black text-xs uppercase rounded-xl hover:bg-amber-700"
                    >
                      Complete Review
                    </button>
                  )}
                  {p.stepType === 'Approver' && (
                    <button
                      onClick={() => handleAction(p.masterId, 'approve')}
                      className="px-6 py-2.5 bg-emerald-600 text-white font-black text-xs uppercase rounded-xl hover:bg-emerald-700"
                    >
                      Approve
                    </button>
                  )}
                  {rejectingId !== p.masterId ? (
                    <button
                      onClick={() => setRejectingId(p.masterId)}
                      className="px-6 py-2.5 bg-rose-100 text-rose-700 font-black text-xs uppercase rounded-xl hover:bg-rose-200"
                    >
                      Reject
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder="Remarks (optional)"
                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
                        value={rejectRemarks}
                        onChange={(e) => setRejectRemarks(e.target.value)}
                      />
                      <button
                        onClick={() => handleAction(p.masterId, 'reject', rejectRemarks)}
                        className="px-4 py-2 bg-rose-600 text-white text-xs font-black rounded-lg"
                      >
                        Confirm Reject
                      </button>
                      <button
                        onClick={() => { setRejectingId(null); setRejectRemarks(''); }}
                        className="px-4 py-2 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default BudgetApproval;
