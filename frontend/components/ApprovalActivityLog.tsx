import React from 'react';
import { User } from '../types';

export interface WorkspaceActivityItem {
  scope: string;
  masterId: string;
  masterName: string;
  workflowStatus: string;
  currentStepIndex: number;
  waitingNote: string;
  workflowStepHistory: { action: string; userId?: string; at?: string; stepIndex?: number }[];
}

function actionLabel(action: string): string {
  switch (action) {
    case 'submit':
      return 'Submitted for approval';
    case 'completeReview':
      return 'Completed review';
    case 'approve':
      return 'Approved';
    case 'reject':
      return 'Rejected';
    default:
      return action;
  }
}

function formatLine(
  e: { action: string; userId?: string; at?: string; stepIndex?: number },
  users: User[]
): string {
  const u = e.userId ? users.find((x) => x.id === e.userId) : null;
  const who = u?.name || u?.email || e.userId || 'Unknown';
  const when = e.at ? new Date(e.at).toLocaleString() : '';
  const step = typeof e.stepIndex === 'number' ? ` (step ${e.stepIndex + 1})` : '';
  return `${when ? `${when} — ` : ''}${who}: ${actionLabel(e.action)}${step}`;
}

export const ApprovalActivityLog: React.FC<{
  items: WorkspaceActivityItem[];
  users: User[];
  title?: string;
  onView?: (masterId: string) => void;
}> = ({ items, users, title = 'Activity & waiting list', onView }) => {
  if (!items.length) {
    return (
      <div className="mt-10 pt-8 border-t border-slate-200">
        <h3 className="text-sm font-black text-slate-500 uppercase tracking-wider mb-4">{title}</h3>
        <p className="text-sm text-slate-400 font-medium">No other workflow activity for you on this screen.</p>
      </div>
    );
  }
  return (
    <div className="mt-10 pt-8 border-t border-slate-200">
      <h3 className="text-sm font-black text-slate-500 uppercase tracking-wider mb-2">{title}</h3>
      <p className="text-xs text-slate-500 mb-4">
        Read-only: waiting on others, already acted, or final outcome. Same rules as above — no actions here.
      </p>
      <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
        {items.map((row) => (
          <div
            key={row.masterId}
            className="border border-slate-100 rounded-xl p-4 bg-slate-50/80 text-left"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-black text-slate-800">{row.masterName || row.masterId}</p>
                {onView && (
                  <button
                    type="button"
                    onClick={() => onView(row.masterId)}
                    className="px-3 py-1 text-[10px] font-black uppercase text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50"
                  >
                    View
                  </button>
                )}
              </div>
              <span
                className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                  row.workflowStatus === 'Pending'
                    ? 'bg-amber-100 text-amber-800'
                    : row.workflowStatus === 'Approved'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-rose-100 text-rose-800'
                }`}
              >
                {row.workflowStatus}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">{row.waitingNote}</p>
            {row.workflowStepHistory?.length ? (
              <ul className="mt-3 text-xs text-slate-600 space-y-1 border-t border-slate-200 pt-2 font-mono leading-relaxed">
                {row.workflowStepHistory.map((e, i) => (
                  <li key={i}>{formatLine(e, users)}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-400 italic">No audit entries yet (older submissions).</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
