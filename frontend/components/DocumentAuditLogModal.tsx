import React from 'react';
import { User, WorkflowStepHistoryEntry } from '../types';

interface DocumentAuditLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  status?: string;
  history?: WorkflowStepHistoryEntry[];
  users: User[];
}

const actionLabel = (action: string) => {
  if (action === 'submit') return 'Submitted for approval';
  if (action === 'completeReview') return 'Completed review';
  if (action === 'approve') return 'Approved';
  if (action === 'reject') return 'Rejected';
  if (action === 'amend') return 'Amended and resubmitted';
  return action;
};

const formatLine = (e: WorkflowStepHistoryEntry, users: User[]) => {
  const u = e.userId ? users.find((x) => x.id === e.userId) : null;
  const who = u?.name || u?.email || e.userId || 'Unknown';
  const when = e.at ? new Date(e.at).toLocaleString() : '';
  const step = typeof e.stepIndex === 'number' ? ` (step ${e.stepIndex + 1})` : '';
  return `${when ? `${when} - ` : ''}${who}: ${actionLabel(e.action)}${step}`;
};

const DocumentAuditLogModal: React.FC<DocumentAuditLogModalProps> = ({
  isOpen,
  onClose,
  title,
  status,
  history = [],
  users,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-[1px] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="text-base font-black text-slate-900">{title}</h3>
            {status && <p className="text-xs font-bold text-slate-500 mt-1">Current status: {status}</p>}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg font-black leading-none">x</button>
        </div>
        <div className="px-6 py-4 max-h-[420px] overflow-y-auto">
          {history.length ? (
            <ul className="text-xs text-slate-700 space-y-2 font-mono leading-relaxed">
              {history.map((e, i) => (
                <li key={i}>{formatLine(e, users)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400 italic">No audit entries yet.</p>
          )}
        </div>
        <div className="px-6 py-3 border-t border-slate-200 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-black text-slate-600 hover:bg-slate-100">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default DocumentAuditLogModal;
