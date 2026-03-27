
import React, { useEffect, useState } from 'react';
import { User, Role } from '../types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { apiGet } from '../api';

export interface DashboardStatsPayload {
  pendingCounts: {
    pr: number;
    rc: number;
    po: number;
    di: number;
    grnFromRC: number;
    grnFromPO: number;
    invoiceFromRC: number;
    invoiceFromPO: number;
  };
  rcComparison: { totalRC: number; totalGRNFromRC: number; totalInvoiceFromRCGRN: number };
  poComparison: { totalPO: number; totalGRNFromPO: number; totalInvoiceFromPOGRN: number };
}

export type DashboardNavigatePayload =
  | { tab: 'purchase_request' }
  | { tab: 'direct_invoice' }
  | { tab: 'rate_contract'; viewMode?: 'RC' | 'GRN' | 'Invoice' }
  | { tab: 'purchase_order'; viewMode?: 'PO' | 'GRN' | 'Invoice' };

interface DashboardProps {
  users: User[];
  roles: Role[];
  onNavigateFromDashboard: (nav: DashboardNavigatePayload) => void;
}

function pct(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

function flowBarColor(p: number): string {
  if (p > 70) return 'bg-emerald-500';
  if (p >= 40) return 'bg-amber-500';
  return 'bg-red-500';
}

function countStyle(n: number): string {
  return n > 0 ? 'text-[#D97706] font-bold' : 'text-[#16A34A] font-bold';
}

/** Pending Tasks modal — main row count pill (18px). */
function pendingCountBadgeMain(n: number): string {
  return n > 0
    ? 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-[#FFFBEB] px-3 py-1 text-lg font-bold tabular-nums text-[#D97706]'
    : 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-[#F0FDF4] px-3 py-1 text-lg font-bold tabular-nums text-[#16A34A]';
}

/** Pending Tasks modal — sub-row count pill (15px). */
function pendingCountBadgeSub(n: number): string {
  return n > 0
    ? 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-[#FFFBEB] px-2.5 py-1 text-[15px] font-bold tabular-nums text-[#D97706]'
    : 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-[#F0FDF4] px-2.5 py-1 text-[15px] font-bold tabular-nums text-[#16A34A]';
}

const Dashboard: React.FC<DashboardProps> = ({ users, roles, onNavigateFromDashboard }) => {
  const [dashboardStats, setDashboardStats] = useState<DashboardStatsPayload | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [showPendingModal, setShowPendingModal] = useState(false);

  const stats = [
    { label: 'System Users', value: users.length, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Active Roles', value: roles.length, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Governance Nodes', value: 5, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'Security Protocols', value: 6, color: 'text-amber-600', bg: 'bg-amber-50' },
  ];

  useEffect(() => {
    let alive = true;
    async function loadDashboardData() {
      setStatsLoading(true);
      try {
        const statsData = await apiGet<DashboardStatsPayload>('dashboard/stats');
        if (alive) {
          setDashboardStats(statsData);
        }
      } catch (err) {
        console.error('Failed to fetch dashboard data:', err);
      } finally {
        if (alive) {
          setStatsLoading(false);
        }
      }
    }
    loadDashboardData();
    const interval = setInterval(async () => {
      try {
        const statsData = await apiGet<DashboardStatsPayload>('dashboard/stats');
        if (alive) {
          setDashboardStats(statsData);
        }
      } catch (err) {
        console.error('Failed to refresh dashboard data:', err);
      }
    }, 60000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  const deptMap: Record<string, number> = {};
  users.forEach(u => {
    if (u.subDepartments && u.subDepartments.length > 0) {
      u.subDepartments.forEach(sd => {
        deptMap[sd] = (deptMap[sd] || 0) + 1;
      });
    } else {
      deptMap['Unassigned'] = (deptMap['Unassigned'] || 0) + 1;
    }
  });

  const data = Object.entries(deptMap).map(([name, count]) => ({ name, count })).slice(0, 5);
  if (data.length === 0) {
    data.push({ name: 'N/A', count: 0 });
  }

  const COLORS = ['#4F46E5', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];

  const p = dashboardStats?.pendingCounts;
  const rcC = dashboardStats?.rcComparison;
  const poC = dashboardStats?.poComparison;

  const rcToGrnPct = pct(rcC?.totalGRNFromRC ?? 0, rcC?.totalRC ?? 0);
  const rcGrnToInvPct = pct(rcC?.totalInvoiceFromRCGRN ?? 0, rcC?.totalGRNFromRC ?? 0);
  const poToGrnPct = pct(poC?.totalGRNFromPO ?? 0, poC?.totalPO ?? 0);
  const poGrnToInvPct = pct(poC?.totalInvoiceFromPOGRN ?? 0, poC?.totalGRNFromPO ?? 0);

  const totalPending =
    (p?.pr ?? 0) +
    (p?.rc ?? 0) +
    (p?.po ?? 0) +
    (p?.di ?? 0) +
    (p?.grnFromRC ?? 0) +
    (p?.grnFromPO ?? 0) +
    (p?.invoiceFromRC ?? 0) +
    (p?.invoiceFromPO ?? 0);

  const tileSkeleton = (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 animate-pulse">
          <div className="h-2.5 w-24 bg-slate-200 rounded mb-4" />
          <div className="h-10 w-16 bg-slate-200 rounded mb-6" />
          <div className="h-4 w-20 bg-slate-100 rounded" />
        </div>
      ))}
    </div>
  );

  const pendingSummaryRows = [
    { label: 'PR Pending', n: p?.pr ?? 0 },
    { label: 'RC Pending', n: p?.rc ?? 0 },
    { label: 'PO Pending', n: p?.po ?? 0 },
    { label: 'DI Pending', n: p?.di ?? 0 },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 group hover:shadow-xl transition-all duration-300">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{stat.label}</p>
            <div className="mt-2 flex items-baseline">
              <p className={`text-4xl font-black tracking-tight ${stat.color}`}>{stat.value}</p>
            </div>
            <div className={`mt-6 h-1.5 w-full rounded-full ${stat.bg}`}>
              <div className={`h-1.5 rounded-full ${stat.color.replace('text', 'bg')} transition-all duration-1000`} style={{ width: '75%' }}></div>
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setShowPendingModal(true)}
        className="w-full text-left bg-white p-8 rounded-2xl shadow-sm border border-slate-200 hover:shadow-xl hover:bg-slate-50/80 transition-all duration-300"
      >
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pending tasks</p>
        {statsLoading && !p ? (
          <div className="mt-4 space-y-2 animate-pulse">
            <div className="h-4 bg-slate-100 rounded w-full" />
            <div className="h-4 bg-slate-100 rounded w-full" />
            <div className="h-4 bg-slate-100 rounded w-3/4" />
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {pendingSummaryRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-slate-700">{row.label}</span>
                <span className={`text-sm tabular-nums ${countStyle(row.n)}`}>{row.n}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4">
          <p className="text-xs font-bold text-slate-500">
            Total Pending: <span className="text-slate-900">{statsLoading && !p ? '—' : totalPending}</span>
          </p>
          <p className="text-xs font-bold text-indigo-600 uppercase tracking-wide">View details →</p>
        </div>
      </button>

      <div className="space-y-3">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Document flow</p>
        {statsLoading && !rcC ? (
          tileSkeleton
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">RC → GRN</p>
              <p className="text-xs font-bold text-slate-400 mt-1">Rate contract</p>
              <p className="mt-3 text-2xl font-black text-slate-800 tracking-tight">
                {(rcC?.totalRC ?? 0).toLocaleString()} → {(rcC?.totalGRNFromRC ?? 0).toLocaleString()}
              </p>
              <p className="mt-2 text-sm font-bold text-slate-600">{rcToGrnPct}% converted</p>
              <div className="mt-4 h-1.5 w-full rounded-full bg-slate-100">
                <div className={`h-1.5 rounded-full transition-all ${flowBarColor(rcToGrnPct)}`} style={{ width: `${rcToGrnPct}%` }} />
              </div>
            </div>
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">GRN → Invoice</p>
              <p className="text-xs font-bold text-slate-400 mt-1">Rate contract flow</p>
              <p className="mt-3 text-2xl font-black text-slate-800 tracking-tight">
                {(rcC?.totalGRNFromRC ?? 0).toLocaleString()} → {(rcC?.totalInvoiceFromRCGRN ?? 0).toLocaleString()}
              </p>
              <p className="mt-2 text-sm font-bold text-slate-600">{rcGrnToInvPct}% invoiced</p>
              <div className="mt-4 h-1.5 w-full rounded-full bg-slate-100">
                <div className={`h-1.5 rounded-full transition-all ${flowBarColor(rcGrnToInvPct)}`} style={{ width: `${rcGrnToInvPct}%` }} />
              </div>
            </div>
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">PO → GRN</p>
              <p className="text-xs font-bold text-slate-400 mt-1">Purchase order</p>
              <p className="mt-3 text-2xl font-black text-slate-800 tracking-tight">
                {(poC?.totalPO ?? 0).toLocaleString()} → {(poC?.totalGRNFromPO ?? 0).toLocaleString()}
              </p>
              <p className="mt-2 text-sm font-bold text-slate-600">{poToGrnPct}% converted</p>
              <div className="mt-4 h-1.5 w-full rounded-full bg-slate-100">
                <div className={`h-1.5 rounded-full transition-all ${flowBarColor(poToGrnPct)}`} style={{ width: `${poToGrnPct}%` }} />
              </div>
            </div>
            <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">GRN → Invoice</p>
              <p className="text-xs font-bold text-slate-400 mt-1">Purchase order flow</p>
              <p className="mt-3 text-2xl font-black text-slate-800 tracking-tight">
                {(poC?.totalGRNFromPO ?? 0).toLocaleString()} → {(poC?.totalInvoiceFromPOGRN ?? 0).toLocaleString()}
              </p>
              <p className="mt-2 text-sm font-bold text-slate-600">{poGrnToInvPct}% invoiced</p>
              <div className="mt-4 h-1.5 w-full rounded-full bg-slate-100">
                <div className={`h-1.5 rounded-full transition-all ${flowBarColor(poGrnToInvPct)}`} style={{ width: `${poGrnToInvPct}%` }} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white p-8 rounded-3xl shadow-sm border border-slate-200">
          <div className="flex justify-between items-center mb-10">
            <div>
              <h3 className="text-xl font-black text-slate-800 tracking-tight uppercase">Access Distribution</h3>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Subdepartment Metric</p>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="6 6" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 900}} 
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{fill: '#94a3b8', fontSize: 10, fontWeight: 900}} 
                />
                <Tooltip 
                  cursor={{fill: '#f8fafc'}}
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px', fontWeight: 'bold' }}
                />
                <Bar dataKey="count" radius={[12, 12, 0, 0]} barSize={40}>
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-slate-900 p-8 rounded-3xl shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl -mr-16 -mt-16"></div>
          <h3 className="text-xl font-black text-white tracking-tight uppercase mb-8 relative z-10">Governance Logs</h3>
          <div className="space-y-6 relative z-10">
            <div className="flex items-start space-x-4">
              <div className="w-2 h-2 rounded-full bg-emerald-500 mt-1.5 shadow-lg shadow-emerald-500/50"></div>
              <div>
                <p className="text-sm font-bold text-slate-100">Protocol Assignment Update</p>
                <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mt-1">Multi-Access Synced • 02:45 PM</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showPendingModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 backdrop-blur-sm p-4 md:p-8">
          <div
            className="mt-4 flex w-[90vw] max-w-[800px] min-h-[500px] max-h-[85vh] flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl"
            role="dialog"
            aria-labelledby="pending-tasks-title"
            aria-modal="true"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[#F1F5F9] px-8 py-8">
              <h3 id="pending-tasks-title" className="text-[22px] font-bold leading-tight text-slate-900">
                Pending tasks
              </h3>
              <button
                type="button"
                onClick={() => setShowPendingModal(false)}
                className="flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-lg font-bold text-slate-500 transition-colors duration-150 ease-in-out hover:bg-slate-100 hover:text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                aria-label="Close"
              >
                <span className="text-[18px] leading-none" aria-hidden>
                  ✕
                </span>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-8 py-8">
              <div className="flex flex-col gap-4">
                <button
                  type="button"
                  onClick={() => {
                    onNavigateFromDashboard({ tab: 'purchase_request' });
                    setShowPendingModal(false);
                  }}
                  className="flex min-h-[56px] w-full cursor-pointer items-center justify-between border-b border-[#F1F5F9] bg-white py-4 pl-5 pr-5 text-left transition-colors duration-150 ease-in-out hover:bg-[#EFF6FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                  style={{ borderLeft: '4px solid #3B82F6' }}
                >
                  <span className="text-base font-semibold text-[#0F172A]">Purchase Request Pending</span>
                  <span className={pendingCountBadgeMain(p?.pr ?? 0)}>{p?.pr ?? 0}</span>
                </button>

                <div
                  className="overflow-hidden rounded-xl border-b border-[#F1F5F9] bg-white"
                  style={{ borderLeft: '4px solid #10B981' }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateFromDashboard({ tab: 'rate_contract', viewMode: 'RC' });
                      setShowPendingModal(false);
                    }}
                    className="flex min-h-[56px] w-full cursor-pointer items-center justify-between py-4 pl-5 pr-4 text-left transition-colors duration-150 ease-in-out hover:bg-[#EFF6FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                  >
                    <span className="text-base font-semibold text-[#0F172A]">Rate Contract Pending</span>
                    <div className="flex items-center gap-3">
                      <span className={pendingCountBadgeMain(p?.rc ?? 0)}>{p?.rc ?? 0}</span>
                      <span
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors duration-150 ease-in-out hover:bg-slate-100"
                        aria-hidden
                      >
                        <span className="text-[20px] leading-none">▼</span>
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateFromDashboard({ tab: 'rate_contract', viewMode: 'GRN' });
                      setShowPendingModal(false);
                    }}
                    className="flex min-h-[48px] w-full cursor-pointer items-center justify-between gap-3 border-t border-[#F1F5F9] bg-white py-3 pl-12 pr-5 text-left transition-colors duration-150 ease-in-out hover:bg-[#EFF6FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                    style={{ borderLeft: '3px solid #CBD5E1' }}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-normal text-[#475569]">
                      <span className="shrink-0 text-base text-[#CBD5E1]">├──</span>
                      <span className="leading-snug">GRN Pending (from RC)</span>
                    </span>
                    <span className={pendingCountBadgeSub(p?.grnFromRC ?? 0)}>{p?.grnFromRC ?? 0}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateFromDashboard({ tab: 'rate_contract', viewMode: 'Invoice' });
                      setShowPendingModal(false);
                    }}
                    className="flex min-h-[48px] w-full cursor-pointer items-center justify-between gap-3 border-t border-[#F1F5F9] bg-[#FAFAFA] py-3 pl-12 pr-5 text-left transition-colors duration-150 ease-in-out hover:bg-[#EFF6FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                    style={{ borderLeft: '3px solid #CBD5E1' }}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-normal text-[#475569]">
                      <span className="shrink-0 text-base text-[#CBD5E1]">└──</span>
                      <span className="leading-snug">Invoice Pending (from RC)</span>
                    </span>
                    <span className={pendingCountBadgeSub(p?.invoiceFromRC ?? 0)}>{p?.invoiceFromRC ?? 0}</span>
                  </button>
                </div>

                <div
                  className="overflow-hidden rounded-xl border-b border-[#F1F5F9] bg-white"
                  style={{ borderLeft: '4px solid #8B5CF6' }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateFromDashboard({ tab: 'purchase_order', viewMode: 'PO' });
                      setShowPendingModal(false);
                    }}
                    className="flex min-h-[56px] w-full cursor-pointer items-center justify-between py-4 pl-5 pr-4 text-left transition-colors duration-150 ease-in-out hover:bg-[#EFF6FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                  >
                    <span className="text-base font-semibold text-[#0F172A]">Purchase Order Pending</span>
                    <div className="flex items-center gap-3">
                      <span className={pendingCountBadgeMain(p?.po ?? 0)}>{p?.po ?? 0}</span>
                      <span
                        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors duration-150 ease-in-out hover:bg-slate-100"
                        aria-hidden
                      >
                        <span className="text-[20px] leading-none">▼</span>
                      </span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateFromDashboard({ tab: 'purchase_order', viewMode: 'GRN' });
                      setShowPendingModal(false);
                    }}
                    className="flex min-h-[48px] w-full cursor-pointer items-center justify-between gap-3 border-t border-[#F1F5F9] bg-white py-3 pl-12 pr-5 text-left transition-colors duration-150 ease-in-out hover:bg-[#EFF6FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                    style={{ borderLeft: '3px solid #CBD5E1' }}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-normal text-[#475569]">
                      <span className="shrink-0 text-base text-[#CBD5E1]">├──</span>
                      <span className="leading-snug">GRN Pending (from PO)</span>
                    </span>
                    <span className={pendingCountBadgeSub(p?.grnFromPO ?? 0)}>{p?.grnFromPO ?? 0}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateFromDashboard({ tab: 'purchase_order', viewMode: 'Invoice' });
                      setShowPendingModal(false);
                    }}
                    className="flex min-h-[48px] w-full cursor-pointer items-center justify-between gap-3 border-t border-[#F1F5F9] bg-[#FAFAFA] py-3 pl-12 pr-5 text-left transition-colors duration-150 ease-in-out hover:bg-[#EFF6FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                    style={{ borderLeft: '3px solid #CBD5E1' }}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-normal text-[#475569]">
                      <span className="shrink-0 text-base text-[#CBD5E1]">└──</span>
                      <span className="leading-snug">Invoice Pending (from PO)</span>
                    </span>
                    <span className={pendingCountBadgeSub(p?.invoiceFromPO ?? 0)}>{p?.invoiceFromPO ?? 0}</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onNavigateFromDashboard({ tab: 'direct_invoice' });
                    setShowPendingModal(false);
                  }}
                  className="flex min-h-[56px] w-full cursor-pointer items-center justify-between border-b border-[#F1F5F9] bg-white py-4 pl-5 pr-5 text-left transition-colors duration-150 ease-in-out hover:bg-[#EFF6FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                  style={{ borderLeft: '4px solid #F59E0B' }}
                >
                  <span className="text-base font-semibold text-[#0F172A]">Direct Invoice Pending</span>
                  <span className={pendingCountBadgeMain(p?.di ?? 0)}>{p?.di ?? 0}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
