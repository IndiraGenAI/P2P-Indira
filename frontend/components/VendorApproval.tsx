import React, { useState, useEffect, useCallback } from 'react';
import { User, MasterRecord } from '../types';
import { apiGet, apiPatch } from '../api';
import { ApprovalActivityLog, WorkspaceActivityItem } from './ApprovalActivityLog';
import { VendorApprovalViewModal } from './ApprovalDetailModals';

interface PendingItem {
  scope: string;
  masterId: string;
  masterName: string;
  currentStepIndex: number;
  ruleId: string;
  stepType: string;
}

interface WorkspaceResponse {
  actionRequired: PendingItem[];
  activityLog: WorkspaceActivityItem[];
}

interface VendorApprovalProps {
  masters: Record<string, MasterRecord[]>;
  users: User[];
  currentUser: User;
  onAction: () => void;
  refetchMasters?: () => Promise<void>;
}

const VendorApproval: React.FC<VendorApprovalProps> = ({ masters, users, currentUser, onAction, refetchMasters }) => {
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [activityLog, setActivityLog] = useState<WorkspaceActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectRemarks, setRejectRemarks] = useState('');
  const [viewVendorId, setViewVendorId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const fetchWorkspace = useCallback(async () => {
    try {
      const res = await apiGet<WorkspaceResponse>('workflow-v2/my-workspace?scope=Vendor');
      if (res && typeof res === 'object' && Array.isArray(res.actionRequired)) {
        setPending(res.actionRequired);
        setActivityLog(Array.isArray(res.activityLog) ? res.activityLog : []);
      } else {
        setPending([]);
        setActivityLog([]);
      }
    } catch {
      setPending([]);
      setActivityLog([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchWorkspace();
  }, [currentUser?.id, fetchWorkspace]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [pending.map((p) => p.masterId).join(',')]);

  const hasReviewer = pending.some((p) => p.stepType === 'Reviewer');
  const hasApprover = pending.some((p) => p.stepType === 'Approver');

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllPending = () => {
    if (pending.length === 0) return;
    if (selectedIds.size === pending.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(pending.map((p) => p.masterId)));
  };

  const runBulkReview = async () => {
    const reviewerPending = pending.filter((p) => p.stepType === 'Reviewer');
    const anyChecked = reviewerPending.some((p) => selectedIds.has(p.masterId));
    const rows = anyChecked ? reviewerPending.filter((p) => selectedIds.has(p.masterId)) : reviewerPending;
    if (!rows.length) return;
    setBulkBusy(true);
    const failed: string[] = [];
    for (const p of rows) {
      try {
        await apiPatch(`masters/Vendor/${p.masterId}/workflow`, { action: 'completeReview' });
      } catch {
        failed.push(p.masterName || p.masterId);
      }
    }
    await fetchWorkspace();
    await refetchMasters?.();
    onAction();
    setBulkBusy(false);
    setSelectedIds(new Set());
    if (failed.length) alert(`Could not complete review for: ${failed.join(', ')}`);
  };

  const runBulkApprove = async () => {
    const approverPending = pending.filter((p) => p.stepType === 'Approver');
    const anyChecked = approverPending.some((p) => selectedIds.has(p.masterId));
    const rows = anyChecked ? approverPending.filter((p) => selectedIds.has(p.masterId)) : approverPending;
    if (!rows.length) return;
    setBulkBusy(true);
    const failed: string[] = [];
    for (const p of rows) {
      try {
        await apiPatch(`masters/Vendor/${p.masterId}/workflow`, { action: 'approve' });
      } catch {
        failed.push(p.masterName || p.masterId);
      }
    }
    await fetchWorkspace();
    await refetchMasters?.();
    onAction();
    setBulkBusy(false);
    setSelectedIds(new Set());
    if (failed.length) alert(`Could not approve: ${failed.join(', ')}`);
  };

  const handleAction = async (
    masterId: string,
    action: 'completeReview' | 'approve' | 'reject',
    rejectionRemarks?: string
  ) => {
    try {
      await apiPatch(`masters/Vendor/${masterId}/workflow`, {
        action,
        rejectionRemarks: rejectionRemarks || undefined,
      });
      await fetchWorkspace();
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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">Vendor Approval</h2>
            <p className="text-sm text-slate-500 mt-1">
              <span className="font-semibold text-slate-700">Needs your action</span> — complete review, approve, or reject.
            </p>
          </div>
          {pending.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={bulkBusy}
                onClick={selectAllPending}
                className="px-4 py-2 text-[10px] font-black uppercase rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                {selectedIds.size === pending.length ? 'Clear selection' : 'Select all'}
              </button>
              {hasReviewer && (
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={runBulkReview}
                  className="px-4 py-2 text-[10px] font-black uppercase rounded-xl bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {bulkBusy ? 'Working…' : 'Review all'}
                </button>
              )}
              {hasApprover && (
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={runBulkApprove}
                  className="px-4 py-2 text-[10px] font-black uppercase rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {bulkBusy ? 'Working…' : 'Approve all'}
                </button>
              )}
            </div>
          )}
        </div>
        {pending.length > 0 && (hasReviewer || hasApprover) && (
          <p className="text-[11px] text-slate-500 mt-3">
            <strong>Review all</strong> runs on checked reviewer rows, or every reviewer item if none checked.{' '}
            <strong>Approve all</strong> does the same for approver rows.
          </p>
        )}
      </div>
      <div className="p-6">
        {pending.length === 0 ? (
          <div className="text-center py-8 text-slate-500 font-bold">
            Nothing waiting on you right now.
          </div>
        ) : (
          <div className="space-y-4">
            {pending.map((p) => (
              <div
                key={p.masterId}
                className="border border-slate-200 rounded-xl p-6 bg-white shadow-sm flex flex-wrap items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <input
                    type="checkbox"
                    className="mt-1.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
                    checked={selectedIds.has(p.masterId)}
                    onChange={() => toggleSelect(p.masterId)}
                    disabled={bulkBusy}
                    aria-label={`Select ${p.masterName || p.masterId}`}
                  />
                  <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-black text-slate-800">{p.masterName || p.masterId}</p>
                    <button
                      type="button"
                      onClick={() => setViewVendorId(p.masterId)}
                      className="px-3 py-1.5 text-[10px] font-black uppercase text-indigo-600 border border-indigo-200 rounded-xl hover:bg-indigo-50"
                    >
                      View
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Step {p.currentStepIndex + 1} — {p.stepType}
                  </p>
                  </div>
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
                        onClick={() => {
                          setRejectingId(null);
                          setRejectRemarks('');
                        }}
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
        <ApprovalActivityLog items={activityLog} users={users} onView={(id) => setViewVendorId(id)} />
      </div>
      {viewVendorId && (
        <VendorApprovalViewModal masters={masters} vendorId={viewVendorId} onClose={() => setViewVendorId(null)} />
      )}
    </div>
  );
};

export default VendorApproval;
