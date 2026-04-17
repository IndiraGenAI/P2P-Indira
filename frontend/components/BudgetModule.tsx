
import React, { useState, useEffect, useRef } from 'react';
import { Budget, BudgetAmendment, BudgetType, BudgetControlType, BudgetValidity, MasterRecord, MasterType, User, PurchaseOrder, PurchaseRequest, WorkflowV2Rule } from '../types';
import { getDepartments, getSubdepartmentsForDepartment } from '../utils/mastersHelpers';
import { apiPatch } from '../api';
import { UploadBudgetButton } from './Budget/UploadBudgetButton';
import { UploadBudgetModal } from './Budget/UploadBudgetModal';
import { Plus, Edit2, History, CheckCircle, XCircle, ArrowRightLeft, TrendingUp, TrendingDown, AlertCircle, BarChart3, PieChart as PieChartIcon, FileText, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface BudgetModuleProps {
  budgets: Budget[];
  setBudgets: React.Dispatch<React.SetStateAction<Budget[]>>;
  amendments: BudgetAmendment[];
  setAmendments: React.Dispatch<React.SetStateAction<BudgetAmendment[]>>;
  masters: Record<MasterType, MasterRecord[]>;
  currentUser: User;
  purchaseOrders: PurchaseOrder[];
  purchaseRequests: PurchaseRequest[];
  workflowV2Rules?: WorkflowV2Rule[];
  onRefreshPendingCounts?: () => void;
}

const BUDGET_AUTO_SUBMIT_MS = 4000;
const FY_MONTHS = [
  { key: 'apr', label: 'April' },
  { key: 'may', label: 'May' },
  { key: 'jun', label: 'June' },
  { key: 'jul', label: 'July' },
  { key: 'aug', label: 'August' },
  { key: 'sep', label: 'September' },
  { key: 'oct', label: 'October' },
  { key: 'nov', label: 'November' },
  { key: 'dec', label: 'December' },
  { key: 'jan', label: 'January' },
  { key: 'feb', label: 'February' },
  { key: 'mar', label: 'March' },
] as const;

const CALENDAR_MONTHS = [
  { key: 'jan', label: 'January' },
  { key: 'feb', label: 'February' },
  { key: 'mar', label: 'March' },
  { key: 'apr', label: 'April' },
  { key: 'may', label: 'May' },
  { key: 'jun', label: 'June' },
  { key: 'jul', label: 'July' },
  { key: 'aug', label: 'August' },
  { key: 'sep', label: 'September' },
  { key: 'oct', label: 'October' },
  { key: 'nov', label: 'November' },
  { key: 'dec', label: 'December' },
] as const;

type MonthDef = typeof FY_MONTHS[number];

function getMonthDefs(financialYear?: string): readonly MonthDef[] {
  const v = String(financialYear || '').trim();
  if (/^\d{4}-\d{2}$/.test(v)) return FY_MONTHS;
  return CALENDAR_MONTHS;
}

function distributeEqually(totalAmount: number, monthDefs: readonly MonthDef[]): Record<string, number> {
  const safeTotal = Math.max(0, Math.round(Number(totalAmount) || 0));
  const len = monthDefs.length || 12;
  const perMonth = Math.floor(safeTotal / len);
  const remainder = safeTotal - perMonth * len;
  const out: Record<string, number> = {};
  monthDefs.forEach((m, idx) => {
    out[m.key] = perMonth + (idx < remainder ? 1 : 0);
  });
  return out;
}

const BudgetModule: React.FC<BudgetModuleProps> = ({ budgets, setBudgets, amendments, setAmendments, masters, currentUser, purchaseOrders, purchaseRequests, workflowV2Rules = [], onRefreshPendingCounts }) => {
  const budgetWorkflowExists = workflowV2Rules.some((r) => r.scope === 'Budget' && r.masterId === '__ALL__' && r.isActive);
  const [budgetAutoSubmitUntil, setBudgetAutoSubmitUntil] = useState<Record<string, number>>({});
  const [budgetWorkflowSubmitting, setBudgetWorkflowSubmitting] = useState<Record<string, boolean>>({});
  const [nowTick, setNowTick] = useState(() => Date.now());
  const budgetAutoSubmitTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const addBudgetActionsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(
    () => () => {
      Object.values(budgetAutoSubmitTimeoutsRef.current).forEach(clearTimeout);
      budgetAutoSubmitTimeoutsRef.current = {};
    },
    []
  );

  const [view, setView] = useState<'list' | 'amendments' | 'reports'>('list');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showAmendModal, setShowAmendModal] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState<Budget | null>(null);

  const [newBudget, setNewBudget] = useState<Partial<Budget>>({
    financialYear: '2025-26',
    budgetType: BudgetType.OPEX,
    controlType: BudgetControlType.HARD_STOP,
    validity: BudgetValidity.ANNUAL,
    isActive: true,
    consumedAmount: 0
  });
  const [expandedBudgetRows, setExpandedBudgetRows] = useState<Record<string, boolean>>({});
  const [addBudgetError, setAddBudgetError] = useState<string>('');
  const monthDefs = getMonthDefs(newBudget.financialYear);
  const [monthlyAllocation, setMonthlyAllocation] = useState<Record<string, number>>(
    () => distributeEqually(0, monthDefs)
  );

  const [newAmendment, setNewAmendment] = useState<Partial<BudgetAmendment>>({
    type: 'Increase',
    amount: 0,
    justification: ''
  });

  const budgetAmountValue = Math.max(0, Math.round(Number(newBudget.amount) || 0));
  const totalAllocated = monthDefs.reduce((sum, m) => sum + (Number(monthlyAllocation[m.key]) || 0), 0);
  const remainingAllocation = budgetAmountValue - totalAllocated;
  const allocationMatches = remainingAllocation === 0;

  const handleBudgetAmountChange = (amount: number) => {
    const safeAmount = Math.max(0, Math.round(Number(amount) || 0));
    setNewBudget({ ...newBudget, amount: safeAmount });
    setMonthlyAllocation(distributeEqually(safeAmount, monthDefs));
    setAddBudgetError('');
  };

  const handleMonthlyAllocationChange = (monthKey: string, value: number) => {
    const safeVal = Math.max(0, Math.round(Number(value) || 0));
    setMonthlyAllocation((prev) => ({ ...prev, [monthKey]: safeVal }));
    setAddBudgetError('');
  };

  const handleResetEqual = () => {
    setMonthlyAllocation(distributeEqually(budgetAmountValue, monthDefs));
    setAddBudgetError('');
  };

  const scrollToAddBudgetActions = () => {
    addBudgetActionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  };

  useEffect(() => {
    setMonthlyAllocation((prev) => {
      const next: Record<string, number> = {};
      monthDefs.forEach((m) => {
        next[m.key] = Number(prev[m.key]) || 0;
      });
      return next;
    });
  }, [newBudget.financialYear]);

  const handleAddBudget = () => {
    if (!newBudget.coaCode || !newBudget.amount || !newBudget.costCenterName) return;
    if (budgetAmountValue > 0) {
      if (!allocationMatches) {
        setAddBudgetError(
          `Monthly allocation (₹${totalAllocated.toLocaleString()}) does not match budget amount (₹${budgetAmountValue.toLocaleString()}). Please adjust.`
        );
        return;
      }
      const hasNegative = monthDefs.some((m) => (Number(monthlyAllocation[m.key]) || 0) < 0);
      if (hasNegative) {
        setAddBudgetError('Monthly allocation cannot contain negative values.');
        return;
      }
    }

    const normalizedMonthly: Record<string, number> = {};
    monthDefs.forEach((m) => {
      normalizedMonthly[m.key] = Math.max(0, Math.round(Number(monthlyAllocation[m.key]) || 0));
    });

    const budget: Budget = {
      ...newBudget as Budget,
      id: `B-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
      costCenterName: newBudget.costCenterName ?? '',
      consumedAmount: 0,
      monthlyAllocation: budgetAmountValue > 0 ? normalizedMonthly : {},
    };
    setBudgets([...budgets, budget]);
    setShowAddModal(false);
    setAddBudgetError('');
    setMonthlyAllocation(distributeEqually(0, monthDefs));
    if (budgetWorkflowExists) {
      setBudgetAutoSubmitUntil((prev) => ({
        ...prev,
        [budget.id]: Date.now() + BUDGET_AUTO_SUBMIT_MS,
      }));
      if (budgetAutoSubmitTimeoutsRef.current[budget.id]) clearTimeout(budgetAutoSubmitTimeoutsRef.current[budget.id]);
      budgetAutoSubmitTimeoutsRef.current[budget.id] = setTimeout(async () => {
        delete budgetAutoSubmitTimeoutsRef.current[budget.id];
        setBudgetAutoSubmitUntil((prev) => {
          const next = { ...prev };
          delete next[budget.id];
          return next;
        });
        setBudgetWorkflowSubmitting((prev) => ({ ...prev, [budget.id]: true }));
        try {
          const updated = await apiPatch<Budget>(`budgets/${budget.id}/workflow`, { action: 'submit' });
          setBudgets((prev) => prev.map((b) => (b.id === budget.id ? { ...b, ...updated } : b)));
          onRefreshPendingCounts?.();
        } catch (e) {
          alert((e as Error).message || 'Auto-submit failed; use Submit for approval.');
        } finally {
          setBudgetWorkflowSubmitting((prev) => {
            const next = { ...prev };
            delete next[budget.id];
            return next;
          });
        }
      }, BUDGET_AUTO_SUBMIT_MS);
    }
  };

  const handleAmendBudget = () => {
    if (!selectedBudget || !newAmendment.amount || !newAmendment.justification) return;
    
    const amendment: BudgetAmendment = {
      id: `BA-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
      budgetId: selectedBudget.id,
      type: newAmendment.type as any,
      amount: Number(newAmendment.amount),
      targetBudgetId: newAmendment.targetBudgetId,
      justification: newAmendment.justification,
      status: 'Pending',
      requestedBy: currentUser.name,
      createdAt: new Date().toISOString()
    };

    setAmendments([...amendments, amendment]);
    setShowAmendModal(false);
  };

  const approveAmendment = (amendment: BudgetAmendment) => {
    setBudgets(prev => prev.map(b => {
      if (b.id === amendment.budgetId) {
        const amt = Number(b.amount) || 0;
        const aAmt = Number(amendment.amount) || 0;
        if (amendment.type === 'Increase') return { ...b, amount: amt + aAmt };
        if (amendment.type === 'Decrease') return { ...b, amount: Math.max(0, amt - aAmt) };
        if (amendment.type === 'Transfer') return { ...b, amount: amt - aAmt };
      }
      if (amendment.type === 'Transfer' && b.id === amendment.targetBudgetId) {
        return { ...b, amount: (Number(b.amount) || 0) + (Number(amendment.amount) || 0) };
      }
      return b;
    }));

    setAmendments(prev => prev.map(a => a.id === amendment.id ? { ...a, status: 'Approved', approvedBy: currentUser.name } : a));
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Budget Management</h1>
          <p className="text-slate-500">Manage financial allocations and control spending</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setView('reports')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 ${view === 'reports' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
          >
            <TrendingUp size={18} /> Reports
          </button>
          <button 
            onClick={() => setView('amendments')}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 ${view === 'amendments' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
          >
            <History size={18} /> Amendments
          </button>
          <UploadBudgetButton
            onClick={() => {
              setView('list');
              setShowUploadModal(true);
            }}
          />
          <button 
            onClick={() => { setView('list'); setShowAddModal(true); }}
            className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 transition-colors"
          >
            <Plus size={18} /> New Budget
          </button>
        </div>
      </div>

      {view === 'list' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-bottom border-slate-200">
                <th className="p-4 font-semibold text-slate-700">GL Code</th>
                <th className="p-4 font-semibold text-slate-700">Type</th>
                <th className="p-4 font-semibold text-slate-700">Entity/Location</th>
                <th className="p-4 font-semibold text-slate-700">Department</th>
                <th className="p-4 font-semibold text-slate-700">Subdepartment</th>
                <th className="p-4 font-semibold text-slate-700">Total Budget</th>
                <th className="p-4 font-semibold text-slate-700">Consumed</th>
                <th className="p-4 font-semibold text-slate-700">Balance</th>
                <th className="p-4 font-semibold text-slate-700">Control</th>
                {budgetWorkflowExists && <th className="p-4 font-semibold text-slate-700">Status</th>}
                <th className="p-4 font-semibold text-slate-700 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {budgets.map(budget => {
                const amt = Number(budget.amount) || 0;
                const consumed = Number(budget.consumedAmount) || 0;
                const balance = amt - consumed;
                const percentConsumed = amt > 0 ? (consumed / amt) * 100 : 0;
                const rowMonthDefs = getMonthDefs(budget.financialYear);
                const rowMonthly = budget.monthlyAllocation || {};
                const rowExpanded = !!expandedBudgetRows[budget.id];
                return (
                  <React.Fragment key={budget.id}>
                  <tr className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="p-4 font-medium text-slate-900">{budget.coaCode}</td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${budget.budgetType === BudgetType.CAPEX ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                        {budget.budgetType}
                      </span>
                    </td>
                    <td className="p-4 text-slate-600 text-sm">
                      {budget.entityName}<br/>
                      <span className="text-xs text-slate-400">{budget.locationName} - {budget.costCenterName}</span>
                    </td>
                    <td className="p-4 text-slate-600 text-sm">{budget.department ?? '—'}</td>
                    <td className="p-4 text-slate-600 text-sm">{budget.subDepartment ?? '—'}</td>
                    <td className="p-4 font-medium">₹{amt.toLocaleString()}</td>
                    <td className="p-4">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm">₹{consumed.toLocaleString()}</span>
                        <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full ${percentConsumed > 90 ? 'bg-red-500' : percentConsumed > 75 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(100, percentConsumed)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className={`p-4 font-semibold ${balance < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      ₹{balance.toLocaleString()}
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${budget.controlType === BudgetControlType.HARD_STOP ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-amber-50 text-amber-600 border border-amber-100'}`}>
                        {budget.controlType}
                      </span>
                    </td>
                    {budgetWorkflowExists && (
                      <td className="p-4">
                        <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-lg ${
                          budget.workflowStatus === 'Approved' ? 'bg-emerald-100 text-emerald-700' :
                          budget.workflowStatus === 'Rejected' ? 'bg-rose-100 text-rose-600' :
                          budget.workflowStatus === 'Pending' ? 'bg-amber-100 text-amber-700' :
                          'bg-slate-100 text-slate-500'
                        }`}>
                          {budget.workflowStatus || 'Draft'}
                        </span>
                        {((budget.workflowStatus === 'Draft' || !budget.workflowStatus) &&
                          (() => {
                            const until = budgetAutoSubmitUntil[budget.id];
                            const secsLeft = until ? Math.max(0, Math.ceil((until - nowTick) / 1000)) : 0;
                            const inCooldown = until != null && nowTick < until;
                            if (budgetWorkflowSubmitting[budget.id]) {
                              return (
                                <span className="ml-2 inline-block px-3 py-1 bg-indigo-100 text-indigo-700 text-[9px] font-black uppercase rounded-lg">
                                  Submitting…
                                </span>
                              );
                            }
                            if (inCooldown) {
                              return (
                                <span className="ml-2 inline-block px-3 py-1 bg-slate-200 text-slate-600 text-[9px] font-black uppercase rounded-lg tabular-nums">
                                  Auto-submit in {secsLeft}s
                                </span>
                              );
                            }
                            return (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const updated = await apiPatch<Budget>(`budgets/${budget.id}/workflow`, { action: 'submit' });
                                    setBudgets((prev) => prev.map((b) => (b.id === budget.id ? { ...b, ...updated } : b)));
                                    onRefreshPendingCounts?.();
                                  } catch (e) {
                                    alert((e as Error).message || 'Submit failed');
                                  }
                                }}
                                className="ml-2 px-3 py-1 bg-indigo-600 text-white text-[9px] font-black uppercase rounded-lg hover:bg-indigo-700"
                              >
                                Submit for approval
                              </button>
                            );
                          })())}
                      </td>
                    )}
                    <td className="p-4 text-right">
                      <button
                        type="button"
                        onClick={() => setExpandedBudgetRows((prev) => ({ ...prev, [budget.id]: !prev[budget.id] }))}
                        className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
                        title={rowExpanded ? 'Hide monthly allocation' : 'View monthly allocation'}
                      >
                        {rowExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                      </button>
                      <button 
                        onClick={() => { setSelectedBudget(budget); setShowAmendModal(true); }}
                        className="p-2 text-slate-400 hover:text-indigo-600 transition-colors"
                        title="Amend Budget"
                      >
                        <ArrowRightLeft size={18} />
                      </button>
                    </td>
                  </tr>
                  {rowExpanded && (
                    <tr className="bg-slate-50/60 border-b border-slate-100">
                      <td colSpan={budgetWorkflowExists ? 11 : 10} className="px-4 py-4">
                        <div className="rounded-xl border border-slate-200 bg-white p-4">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-slate-700">Monthly Allocation</p>
                            <span className="text-xs font-medium text-slate-500">
                              FY {budget.financialYear} • Total ₹{amt.toLocaleString()}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                            {rowMonthDefs.map((m) => (
                              <div key={m.key} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
                                <p className="text-[11px] font-medium text-slate-500">{m.label}</p>
                                <p className="mt-1 text-sm font-semibold text-slate-800">
                                  ₹{(Number(rowMonthly[m.key]) || 0).toLocaleString()}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === 'amendments' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-bottom border-slate-200">
                <th className="p-4 font-semibold text-slate-700">Date</th>
                <th className="p-4 font-semibold text-slate-700">GL Code</th>
                <th className="p-4 font-semibold text-slate-700">Type</th>
                <th className="p-4 font-semibold text-slate-700">Amount</th>
                <th className="p-4 font-semibold text-slate-700">Justification</th>
                <th className="p-4 font-semibold text-slate-700">Status</th>
                <th className="p-4 font-semibold text-slate-700 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {amendments.map(amendment => {
                const budget = budgets.find(b => b.id === amendment.budgetId);
                return (
                  <tr key={amendment.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="p-4 text-sm text-slate-500">{new Date(amendment.createdAt).toLocaleDateString()}</td>
                    <td className="p-4 font-medium">{budget?.coaCode || 'Unknown'}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-1">
                        {amendment.type === 'Increase' ? <TrendingUp size={14} className="text-emerald-500" /> : <TrendingDown size={14} className="text-red-500" />}
                        <span className="text-sm">{amendment.type}</span>
                      </div>
                    </td>
                    <td className="p-4 font-medium">₹{amendment.amount.toLocaleString()}</td>
                    <td className="p-4 text-sm text-slate-600 max-w-xs truncate">{amendment.justification}</td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        amendment.status === 'Approved' ? 'bg-emerald-100 text-emerald-700' : 
                        amendment.status === 'Rejected' ? 'bg-red-100 text-red-700' : 
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {amendment.status}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      {amendment.status === 'Pending' && (
                        <div className="flex justify-end gap-2">
                          <button 
                            onClick={() => approveAmendment(amendment)}
                            className="p-1 text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                          >
                            <CheckCircle size={20} />
                          </button>
                          <button className="p-1 text-red-600 hover:bg-red-50 rounded transition-colors">
                            <XCircle size={20} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {amendments.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400 italic">No amendments found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {view === 'reports' && (
        <div className="space-y-8 animate-in fade-in duration-500">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Budget vs Actuals Chart */}
            <div className="bg-white p-6 rounded-3xl shadow-xl border border-slate-100">
              <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center">
                <BarChart3 className="w-5 h-5 mr-2 text-indigo-600" />
                Budget vs Actuals (by GL Code)
              </h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={budgets.map(b => ({ name: b.coaCode, budget: Number(b.amount) || 0, actual: Number(b.consumedAmount) || 0 }))}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700 }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700 }} />
                    <Tooltip 
                      contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      itemStyle={{ fontWeight: 700 }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                    <Bar dataKey="budget" fill="#6366f1" radius={[4, 4, 0, 0]} name="Allocated" />
                    <Bar dataKey="actual" fill="#10b981" radius={[4, 4, 0, 0]} name="Consumed" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* CAPEX vs OPEX Utilization */}
            <div className="bg-white p-6 rounded-3xl shadow-xl border border-slate-100">
              <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center">
                <PieChartIcon className="w-5 h-5 mr-2 text-indigo-600" />
                CAPEX vs OPEX Utilization
              </h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'OPEX Consumed', value: budgets.filter(b => b.budgetType === BudgetType.OPEX).reduce((sum, b) => sum + (Number(b.consumedAmount) || 0), 0) },
                        { name: 'OPEX Balance', value: budgets.filter(b => b.budgetType === BudgetType.OPEX).reduce((sum, b) => sum + ((Number(b.amount) || 0) - (Number(b.consumedAmount) || 0)), 0) },
                        { name: 'CAPEX Consumed', value: budgets.filter(b => b.budgetType === BudgetType.CAPEX).reduce((sum, b) => sum + (Number(b.consumedAmount) || 0), 0) },
                        { name: 'CAPEX Balance', value: budgets.filter(b => b.budgetType === BudgetType.CAPEX).reduce((sum, b) => sum + ((Number(b.amount) || 0) - (Number(b.consumedAmount) || 0)), 0) },
                      ]}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {[ '#6366f1', '#e2e8f0', '#f59e0b', '#fef3c7' ].map((color, index) => (
                        <Cell key={`cell-${index}`} fill={color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" height={36}/>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Unbudgeted Spend Report */}
            <div className="bg-white p-6 rounded-3xl shadow-xl border border-slate-100">
              <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center">
                <AlertCircle className="w-5 h-5 mr-2 text-amber-500" />
                Unbudgeted Spend Analysis
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">PO ID</th>
                      <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Amount</th>
                      <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Justification</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {purchaseOrders.filter(po => po.isUnbudgeted).map(po => (
                      <tr key={po.id}>
                        <td className="py-3 text-sm font-bold text-slate-700">{po.id}</td>
                        <td className="py-3 text-sm font-black text-slate-900">₹{po.amount.toLocaleString()}</td>
                        <td className="py-3 text-xs text-slate-500 italic">{po.unbudgetedJustification}</td>
                      </tr>
                    ))}
                    {purchaseOrders.filter(po => po.isUnbudgeted).length === 0 && (
                      <tr>
                        <td colSpan={3} className="py-8 text-center text-slate-400 text-sm">No unbudgeted spend recorded.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Budget Amendment Audit Log */}
            <div className="bg-white p-6 rounded-3xl shadow-xl border border-slate-100">
              <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center">
                <FileText className="w-5 h-5 mr-2 text-indigo-600" />
                Amendment Audit Log
              </h3>
              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                {amendments.filter(a => a.status === 'Approved').map(a => {
                  const budget = budgets.find(b => b.id === a.budgetId);
                  return (
                    <div key={a.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <div className="flex justify-between items-start mb-2">
                        <span className="text-xs font-black text-indigo-600 uppercase tracking-widest">{a.type}</span>
                        <span className="text-[10px] text-slate-400 font-bold">{new Date(a.createdAt).toLocaleDateString()}</span>
                      </div>
                      <div className="text-sm font-bold text-slate-700 mb-1">
                        ₹{a.amount.toLocaleString()} for {budget?.coaCode}
                      </div>
                      <div className="text-[10px] text-slate-500 italic">
                        " {a.justification} "
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl shadow-xl border border-slate-100">
            <h3 className="text-lg font-black text-slate-800 mb-6 flex items-center">
              <AlertCircle className="w-5 h-5 mr-2 text-rose-500" />
              POs on Budget Hold (Aging)
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">PO ID</th>
                    <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Amount</th>
                    <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Aging (Days)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {purchaseOrders.filter(po => po.status === 'Budget Hold').map(po => {
                    const aging = Math.floor((new Date().getTime() - new Date(po.createdAt).getTime()) / (1000 * 60 * 60 * 24));
                    return (
                      <tr key={po.id}>
                        <td className="py-3 text-sm font-bold text-slate-700">{po.id}</td>
                        <td className="py-3 text-sm font-black text-slate-900">₹{po.amount.toLocaleString()}</td>
                        <td className="py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black ${aging > 7 ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-600'}`}>
                            {aging} Days
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {purchaseOrders.filter(po => po.status === 'Budget Hold').length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-8 text-center text-slate-400 text-sm">No POs currently on budget hold.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {showUploadModal && (
        <UploadBudgetModal
          open={showUploadModal}
          onClose={() => setShowUploadModal(false)}
          masters={masters}
          budgets={budgets}
          setBudgets={setBudgets}
        />
      )}

      {/* Add Budget Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-900">Create New Budget</h2>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600"><XCircle size={24} /></button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto max-h-[calc(90vh-140px)]">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Financial Year</label>
                  <select 
                    className="w-full p-2 border border-slate-200 rounded-lg"
                    value={newBudget.financialYear}
                    onChange={e => setNewBudget({...newBudget, financialYear: e.target.value})}
                  >
                    <option>2024-25</option>
                    <option>2025-26</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Budget Type</label>
                  <select 
                    className="w-full p-2 border border-slate-200 rounded-lg"
                    value={newBudget.budgetType}
                    onChange={e => setNewBudget({...newBudget, budgetType: e.target.value as BudgetType})}
                  >
                    <option value={BudgetType.OPEX}>OPEX</option>
                    <option value={BudgetType.CAPEX}>CAPEX</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">GL Code (COA)</label>
                <select 
                  className="w-full p-2 border border-slate-200 rounded-lg"
                  value={newBudget.coaCode}
                  onChange={e => setNewBudget({...newBudget, coaCode: e.target.value})}
                >
                  <option value="">Select GL Code</option>
                  {masters.COA.map(coa => (
                    <option key={coa.id} value={coa.code}>{coa.code} - {coa.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Department</label>
                  <select 
                    className="w-full p-2 border border-slate-200 rounded-lg"
                    value={newBudget.department ?? ''}
                    onChange={e => setNewBudget({ ...newBudget, department: e.target.value || undefined, subDepartment: undefined })}
                  >
                    <option value="">Select Department</option>
                    {getDepartments(masters).map(d => (
                      <option key={d.id} value={d.name}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Subdepartment</label>
                  <select 
                    className="w-full p-2 border border-slate-200 rounded-lg"
                    value={newBudget.subDepartment ?? ''}
                    onChange={e => setNewBudget({ ...newBudget, subDepartment: e.target.value || undefined })}
                    disabled={!newBudget.department}
                  >
                    <option value="">Select Subdepartment</option>
                    {getSubdepartmentsForDepartment(masters, newBudget.department ?? '').map(sd => (
                      <option key={sd.id} value={sd.name}>{sd.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Entity</label>
                  <select 
                    className="w-full p-2 border border-slate-200 rounded-lg"
                    value={newBudget.entityName}
                    onChange={e => setNewBudget({...newBudget, entityName: e.target.value})}
                  >
                    <option value="">Select Entity</option>
                    {masters.Entity.map(ent => <option key={ent.id} value={ent.name}>{ent.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Location</label>
                  <select 
                    className="w-full p-2 border border-slate-200 rounded-lg"
                    value={newBudget.locationName}
                    onChange={e => setNewBudget({...newBudget, locationName: e.target.value})}
                  >
                    <option value="">Select Location</option>
                    {masters.Center.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Cost Center</label>
                <select 
                  className="w-full p-2 border border-slate-200 rounded-lg"
                  value={newBudget.costCenterName ?? ''}
                  onChange={e => setNewBudget({ ...newBudget, costCenterName: e.target.value || undefined })}
                >
                  <option value="">Select Cost Center</option>
                  {(masters['Cost Center'] || []).map(cc => (
                    <option key={cc.id} value={cc.name}>{cc.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Budget Amount</label>
                  <input 
                    type="number"
                    className="w-full p-2 border border-slate-200 rounded-lg"
                    placeholder="Enter amount"
                    value={newBudget.amount ?? ''}
                    min={0}
                    onChange={e => handleBudgetAmountChange(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Control Type</label>
                  <select 
                    className="w-full p-2 border border-slate-200 rounded-lg"
                    value={newBudget.controlType}
                    onChange={e => setNewBudget({...newBudget, controlType: e.target.value as BudgetControlType})}
                  >
                    <option value={BudgetControlType.HARD_STOP}>Hard Stop</option>
                    <option value={BudgetControlType.SOFT_WARNING}>Soft Warning</option>
                  </select>
                </div>
              </div>
              {budgetAmountValue > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Monthly Allocation</h4>
                    <button
                      type="button"
                      onClick={handleResetEqual}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                    >
                      <RotateCcw size={12} />
                      Distribute Equally
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {monthDefs.map((month) => (
                      <div key={month.key} className="rounded-lg border border-slate-200 bg-white p-2">
                        <p className="mb-1 text-[11px] font-medium text-slate-500">{month.label}</p>
                        <input
                          type="number"
                          min={0}
                          className="w-full min-w-[90px] rounded-md border border-slate-200 p-1.5 text-right text-sm tabular-nums"
                          value={monthlyAllocation[month.key] ?? 0}
                          onChange={(e) => handleMonthlyAllocationChange(month.key, Number(e.target.value))}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                    <p className="font-medium text-slate-700">Total Allocated: ₹{totalAllocated.toLocaleString()}</p>
                    {remainingAllocation < 0 && (
                      <p className="font-semibold text-red-600">Over-allocated: ₹{remainingAllocation.toLocaleString()}</p>
                    )}
                    {remainingAllocation > 0 && (
                      <p className="font-semibold text-amber-600">Remaining: ₹{remainingAllocation.toLocaleString()} (unallocated)</p>
                    )}
                    {remainingAllocation === 0 && <p className="font-semibold text-emerald-600">Fully allocated ✓</p>}
                  </div>
                </div>
              )}
              {!!addBudgetError && (
                <p className="text-sm font-medium text-red-600">{addBudgetError}</p>
              )}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={scrollToAddBudgetActions}
                  className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-100"
                >
                  ↓ Scroll to actions
                </button>
              </div>
            </div>
            <div ref={addBudgetActionsRef} className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-slate-600 font-medium">Cancel</button>
              <button
                onClick={handleAddBudget}
                disabled={!newBudget.coaCode || !budgetAmountValue || !newBudget.costCenterName || !allocationMatches}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Create Budget
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Amendment Modal */}
      {showAmendModal && selectedBudget && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Amend Budget</h2>
                <p className="text-sm text-slate-500">GL: {selectedBudget.coaCode} | Current: ₹{selectedBudget.amount.toLocaleString()}</p>
              </div>
              <button onClick={() => setShowAmendModal(false)} className="text-slate-400 hover:text-slate-600"><XCircle size={24} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amendment Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {['Increase', 'Decrease', 'Transfer'].map(type => (
                    <button
                      key={type}
                      onClick={() => setNewAmendment({...newAmendment, type: type as any})}
                      className={`py-2 rounded-lg border text-sm font-medium transition-colors ${newAmendment.type === type ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
                <input 
                  type="number"
                  className="w-full p-2 border border-slate-200 rounded-lg"
                  placeholder="Enter amount"
                  value={newAmendment.amount}
                  onChange={e => setNewAmendment({...newAmendment, amount: Number(e.target.value)})}
                />
              </div>

              {newAmendment.type === 'Transfer' && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Target Budget (GL Code)</label>
                  <select 
                    className="w-full p-2 border border-slate-200 rounded-lg"
                    value={newAmendment.targetBudgetId}
                    onChange={e => setNewAmendment({...newAmendment, targetBudgetId: e.target.value})}
                  >
                    <option value="">Select Target Budget</option>
                    {budgets.filter(b => b.id !== selectedBudget.id).map(b => (
                      <option key={b.id} value={b.id}>{b.coaCode} - {b.locationName}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Justification</label>
                <textarea 
                  className="w-full p-2 border border-slate-200 rounded-lg h-24 resize-none"
                  placeholder="Provide reason for amendment..."
                  value={newAmendment.justification}
                  onChange={e => setNewAmendment({...newAmendment, justification: e.target.value})}
                />
              </div>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
              <button onClick={() => setShowAmendModal(false)} className="px-4 py-2 text-slate-600 font-medium">Cancel</button>
              <button onClick={handleAmendBudget} className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700">Submit Request</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BudgetModule;
