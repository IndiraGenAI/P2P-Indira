import React from 'react';

export type ListStatusQuick = 'all' | 'approved' | 'pending';

export interface TransactionListFilterBarProps {
  approvedCount: number;
  pendingCount: number;
  statusQuick: ListStatusQuick;
  onStatusQuick: (v: ListStatusQuick) => void;
  dateFrom: string;
  dateTo: string;
  onDateFrom: (v: string) => void;
  onDateTo: (v: string) => void;
  vendorId: string;
  onVendorId: (v: string) => void;
  vendors: { id: string; name: string }[];
  className?: string;
}

const TransactionListFilterBar: React.FC<TransactionListFilterBarProps> = ({
  approvedCount,
  pendingCount,
  statusQuick,
  onStatusQuick,
  dateFrom,
  dateTo,
  onDateFrom,
  onDateTo,
  vendorId,
  onVendorId,
  vendors,
  className = '',
}) => {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 text-xs ${className}`}
      role="group"
      aria-label="List filters"
    >
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => onStatusQuick(statusQuick === 'approved' ? 'all' : 'approved')}
          className={`px-2.5 py-1 rounded-lg font-black uppercase tracking-wider border transition-colors ${
            statusQuick === 'approved'
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50'
          }`}
        >
          Approved ({approvedCount})
        </button>
        <button
          type="button"
          onClick={() => onStatusQuick(statusQuick === 'pending' ? 'all' : 'pending')}
          className={`px-2.5 py-1 rounded-lg font-black uppercase tracking-wider border transition-colors ${
            statusQuick === 'pending'
              ? 'bg-amber-500 text-white border-amber-500'
              : 'bg-white text-amber-800 border-amber-200 hover:bg-amber-50'
          }`}
        >
          Pending ({pendingCount})
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-l border-slate-200 pl-2 ml-0.5">
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider hidden sm:inline">Created</span>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => onDateFrom(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-700 max-w-[128px]"
          title="From date (created)"
        />
        <span className="text-slate-400">–</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => onDateTo(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-700 max-w-[128px]"
          title="To date (created)"
        />
      </div>
      <div className="flex items-center gap-1 border-l border-slate-200 pl-2">
        <label className="sr-only" htmlFor="txn-list-vendor">
          Vendor
        </label>
        <select
          id="txn-list-vendor"
          value={vendorId}
          onChange={(e) => onVendorId(e.target.value)}
          className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-700 max-w-[160px] sm:max-w-[200px]"
        >
          <option value="">All vendors</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

export default TransactionListFilterBar;
