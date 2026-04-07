import React, { useState, useEffect, useRef } from 'react';
import { User, Role, NavigationTab, ModuleType, MasterRecord, MasterType, WorkflowRule, WorkflowV2Rule, DepartmentLimit, Permission } from './types';
import { ALL_MASTER_TYPES } from './constants';
import { getDepartments } from './utils/mastersHelpers';
import Sidebar from './components/Sidebar';
import Dashboard, { DashboardNavigatePayload } from './components/Dashboard';
import UserManagement from './components/UserManagement';
import RoleConfiguration from './components/RoleConfiguration';
import WorkflowConfiguration from './components/WorkflowConfiguration';
import WorkflowV2 from './components/WorkflowV2';
import ItemApproval from './components/ItemApproval';
import VendorApproval from './components/VendorApproval';
import BudgetApproval from './components/BudgetApproval';
import MastersManagement from './components/MastersManagement';
import RateContractModule from './components/RateContractModule';
import PurchaseRequestModule from './components/PurchaseRequestModule';
import PurchaseOrderModule from './components/PurchaseOrderModule';
import DirectInvoiceModule from './components/DirectInvoiceModule';
import BudgetModule from './components/BudgetModule';
import Login from './components/Login';
import { PurchaseRequest, PurchaseOrder, GRN, Invoice, RateContract, Budget, BudgetAmendment, BudgetType, BudgetControlType, BudgetValidity, ApprovalType } from './types';
import { apiGet, apiPost, apiPatch, clearToken } from './api';

/** Normalize workflows from API so approval steps always have type (Reviewer/Approver) and userIds for correct UI behavior. */
function normalizeWorkflows(rules: WorkflowRule[]): WorkflowRule[] {
  if (!Array.isArray(rules)) return [];
  return rules.map((w) => {
    let rawChain = w.approvalChain;
    if (typeof rawChain === 'string') {
      try { rawChain = JSON.parse(rawChain); } catch { rawChain = []; }
    }
    const chain = Array.isArray(rawChain) ? rawChain : [];
    const len = chain.length;
    const approvalChain = chain.map((step: any, idx: number) => {
      const userIds = Array.isArray(step.userIds) ? step.userIds : (Array.isArray(step.user_ids) ? step.user_ids : []);
      let type = step.type === ApprovalType.REVIEWER || step.type === ApprovalType.APPROVER ? step.type : undefined;
      if (type === undefined) {
        type = len <= 1 ? ApprovalType.APPROVER : idx === len - 1 ? ApprovalType.APPROVER : ApprovalType.REVIEWER;
      }
      return { id: step.id || `step-${idx}`, type, userIds };
    });
    return { ...w, approvalChain };
  });
}

const LOGIN_TIME_KEY = 'p2p_login_time';
const SESSION_DURATION_SEC = 600;

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavigationTab>('dashboard');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const initialFetchDone = useRef(false);
  /** Bumped when masters are replaced from GET (load/refetch). Stale POST /masters must not overwrite. */
  const mastersServerEpochRef = useRef(0);
  /** Skip one auto-POST after server-driven setMasters (redundant write + race with stale POST). */
  const skipMastersPostOnceRef = useRef(false);

  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequest[]>([]);
  const [rateContracts, setRateContracts] = useState<RateContract[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [grns, setGrns] = useState<GRN[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [directInvoices, setDirectInvoices] = useState<Invoice[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetAmendments, setBudgetAmendments] = useState<BudgetAmendment[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRule[]>([]);
  const [workflowV2Rules, setWorkflowV2Rules] = useState<WorkflowV2Rule[]>([]);
  const [pendingItemCount, setPendingItemCount] = useState(0);
  const [pendingVendorCount, setPendingVendorCount] = useState(0);
  const [pendingBudgetCount, setPendingBudgetCount] = useState(0);
  const [deptLimits, setDeptLimits] = useState<DepartmentLimit[]>([]);
  const [pendingPOFromPR, setPendingPOFromPR] = useState<PurchaseRequest | null>(null);
  /** One-shot view when opening RC/PO from Dashboard pending modal. Cleared on Sidebar tab change or after module consumes. */
  const [rateContractNavIntent, setRateContractNavIntent] = useState<{
    key: number;
    viewMode: 'RC' | 'GRN' | 'Invoice';
    listStatusQuick: 'all' | 'approved' | 'pending' | 'rejected';
    openDocumentId?: string;
  } | null>(null);
  const [purchaseOrderNavIntent, setPurchaseOrderNavIntent] = useState<{
    key: number;
    viewMode: 'PO' | 'GRN' | 'Invoice';
    listStatusQuick: 'all' | 'approved' | 'pending' | 'rejected';
    openDocumentId?: string;
  } | null>(null);
  const [prNavIntent, setPrNavIntent] = useState<{
    key: number;
    listStatusQuick: 'all' | 'approved' | 'pending' | 'rejected';
    openDocumentId?: string;
  } | null>(null);
  const [diNavIntent, setDiNavIntent] = useState<{
    key: number;
    listStatusQuick: 'all' | 'approved' | 'pending' | 'rejected';
    openDocumentId?: string;
  } | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [masters, setMasters] = useState<Record<MasterType, MasterRecord[]>>({});
  const [sessionRemaining, setSessionRemaining] = useState<number | null>(null);

  const doLogout = () => {
    apiPost('logout').catch(() => {});
    clearToken();
    sessionStorage.removeItem(LOGIN_TIME_KEY);
    setCurrentUser(null);
  };

  const handleLogout = () => {
    doLogout();
  };

  const loadData = async () => {
    try {
      const [rolesRes, usersRes, workflowsRes, wv2Res, prRes, rcRes, poRes, grnsRes, invRes, directInvRes, budgetsRes, amendRes, mastersRes] = await Promise.all([
        apiGet<Role[]>('roles'),
        apiGet<User[]>('users'),
        apiGet<WorkflowRule[]>('workflows'),
        apiGet<WorkflowV2Rule[]>('workflow-v2').catch(() => []),
        apiGet<PurchaseRequest[]>('purchase-requests'),
        apiGet<RateContract[]>('rate-contracts'),
        apiGet<PurchaseOrder[]>('purchase-orders'),
        apiGet<GRN[]>('grns'),
        apiGet<Invoice[]>('invoices'),
        apiGet<Invoice[]>('direct-invoices'),
        apiGet<Budget[]>('budgets'),
        apiGet<BudgetAmendment[]>('budget-amendments'),
        apiGet<Record<string, MasterRecord[]>>('masters'),
      ]);
      setRoles(Array.isArray(rolesRes) ? rolesRes : []);
      setUsers(Array.isArray(usersRes) ? usersRes : []);
      setWorkflows(Array.isArray(workflowsRes) ? normalizeWorkflows(workflowsRes) : []);
      setWorkflowV2Rules(Array.isArray(wv2Res) ? wv2Res : []);
      setPurchaseRequests(Array.isArray(prRes) ? prRes : []);
      setRateContracts(Array.isArray(rcRes) ? rcRes : []);
      setPurchaseOrders(Array.isArray(poRes) ? poRes : []);
      setGrns(Array.isArray(grnsRes) ? grnsRes : []);
      setInvoices(Array.isArray(invRes) ? invRes : []);
      setDirectInvoices(Array.isArray(directInvRes) ? directInvRes : []);
      setBudgets(Array.isArray(budgetsRes) ? budgetsRes.map((b: any) => ({
        ...b,
        amount: Number(b.amount) || 0,
        consumedAmount: Math.max(0, Number(b.consumedAmount) || 0)
      })) : []);
      setBudgetAmendments(Array.isArray(amendRes) ? amendRes : []);
      mastersServerEpochRef.current += 1;
      skipMastersPostOnceRef.current = true;
      setMasters(mastersRes && typeof mastersRes === 'object' ? mastersRes as Record<MasterType, MasterRecord[]> : {});
      initialFetchDone.current = true;
    } catch (e) {
      clearToken();
      setLoadError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('p2p_token');
    if (!token) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const me = await apiGet<User>('me');
        setCurrentUser(me);
        await loadData();
      } catch (e) {
        clearToken();
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!currentUser || initialFetchDone.current) return;
    loadData();
  }, [currentUser]);

  const refreshPendingApprovalCounts = async () => {
    if (!currentUser) return;
    try {
      const res = await apiGet<{ scope: string }[]>('workflow-v2/pending');
      const list = Array.isArray(res) ? res : [];
      setPendingItemCount(list.filter((p) => p.scope === 'Item').length);
      setPendingVendorCount(list.filter((p) => p.scope === 'Vendor').length);
      setPendingBudgetCount(list.filter((p) => p.scope === 'Budget').length);
    } catch {
      setPendingItemCount(0);
      setPendingVendorCount(0);
      setPendingBudgetCount(0);
    }
  };

  const refetchMasters = async () => {
    try {
      const mastersRes = await apiGet<Record<string, MasterRecord[]>>('masters');
      mastersServerEpochRef.current += 1;
      skipMastersPostOnceRef.current = true;
      setMasters(mastersRes && typeof mastersRes === 'object' ? mastersRes as Record<MasterType, MasterRecord[]> : {});
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (!currentUser) return;
    refreshPendingApprovalCounts();
  }, [currentUser?.id, masters]);

  // Refetch users when opening Workflow (V2) so the assignee dropdown shows all current users
  useEffect(() => {
    if (activeTab === 'workflow_v2' && currentUser) {
      apiGet<User[]>('users')
        .then((r) => setUsers(Array.isArray(r) ? r : []))
        .catch(() => {});
    }
  }, [activeTab]);

  useEffect(() => {
    if (!currentUser || !roles.length) return;
    const isExempt = roles.some(
      (r) => currentUser.roleIds?.includes(r.id) && (r.name === 'Super Admin' || r.name === 'Admin')
    );
    if (isExempt) {
      sessionStorage.removeItem(LOGIN_TIME_KEY);
      setSessionRemaining(null);
      return;
    }
    const loginTimeStr = sessionStorage.getItem(LOGIN_TIME_KEY);
    if (!loginTimeStr) {
      setSessionRemaining(null);
      return;
    }
    const loginTime = parseInt(loginTimeStr, 10);
    const tick = () => {
      const elapsed = Math.floor((Date.now() - loginTime) / 1000);
      const remaining = Math.max(0, SESSION_DURATION_SEC - elapsed);
      setSessionRemaining(remaining);
      if (remaining <= 0) {
        doLogout();
        window.location.href = '/login?expired=true';
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [currentUser?.id, roles]);

  useEffect(() => {
    if (!initialFetchDone.current) return;
    apiPost('purchase-requests', purchaseRequests).catch(console.error);
  }, [purchaseRequests]);
  useEffect(() => {
    if (!initialFetchDone.current) return;
    apiPost('rate-contracts', rateContracts).catch(console.error);
  }, [rateContracts]);
  useEffect(() => {
    if (!initialFetchDone.current) return;
    apiPost('purchase-orders', purchaseOrders).catch(console.error);
  }, [purchaseOrders]);
  useEffect(() => {
    if (!initialFetchDone.current) return;
    apiPost('grns', grns).catch(console.error);
  }, [grns]);
  useEffect(() => {
    if (!initialFetchDone.current) return;
    apiPost('invoices', invoices).catch(console.error);
  }, [invoices]);
  useEffect(() => {
    if (!initialFetchDone.current) return;
    apiPost('direct-invoices', directInvoices).catch(console.error);
  }, [directInvoices]);
  useEffect(() => {
    if (!initialFetchDone.current) return;
    apiPost('budgets', budgets.map(b => ({ ...b, costCenterName: b.costCenterName ?? '' }))).catch(console.error);
  }, [budgets]);
  useEffect(() => {
    if (!initialFetchDone.current) return;
    apiPost('budget-amendments', budgetAmendments).catch(console.error);
  }, [budgetAmendments]);
  useEffect(() => {
    if (!initialFetchDone.current) return;
    apiPost('roles', roles).catch(console.error);
  }, [roles]);
  useEffect(() => {
    if (!initialFetchDone.current) return;
    apiPost('users', users).catch(console.error);
  }, [users]);
  useEffect(() => {
    if (!initialFetchDone.current) return;
    apiPost('workflows', workflows).catch(console.error);
  }, [workflows]);
  useEffect(() => {
    if (!initialFetchDone.current) return;
    if (skipMastersPostOnceRef.current) {
      skipMastersPostOnceRef.current = false;
      return;
    }
    const epochAtStart = mastersServerEpochRef.current;
    apiPost('masters', masters)
      .then((res) => {
        if (mastersServerEpochRef.current !== epochAtStart) return;
        if (res && typeof res === 'object' && !('error' in res)) {
          skipMastersPostOnceRef.current = true;
          setMasters(res as Record<MasterType, MasterRecord[]>);
        }
      })
      .catch(console.error);
  }, [masters]);

  useEffect(() => {
    const depts = getDepartments(masters);
    if (depts.length > 0) {
      setDeptLimits(depts.map((d) => ({ department: d.name, maxLimit: 1000000, isActive: true })));
    }
  }, [masters]);

  const updateMasters = (type: MasterType, records: MasterRecord[]) => {
    setMasters(prev => ({ ...prev, [type]: records }));
  };

  const hasPermission = (module: ModuleType, permission: Permission) => {
    if (!currentUser) return false;
    const userRoles = roles.filter(r => currentUser.roleIds.includes(r.id) && r.isActive);
    return userRoles.some(r => r.permissions[module]?.includes(permission));
  };

  const getMastersAllowedTypes = (): MasterType[] | null => {
    if (!currentUser) return null;
    const isSuperAdmin = roles.filter(r => currentUser.roleIds.includes(r.id)).some(r => r.name === 'Super Admin');
    if (isSuperAdmin) return null;
    const userRoles = roles.filter(r => currentUser.roleIds.includes(r.id) && r.isActive);
    const withMastersView = userRoles.filter(r => r.permissions[ModuleType.MASTERS]?.includes('view'));
    if (withMastersView.length === 0) return null;
    const merged = getMastersPermissions();
    if (!merged) return null;
    return (Object.keys(merged) as MasterType[]).filter(t => merged[t]?.includes('view'));
  };

  const getMastersPermissions = (): Partial<Record<MasterType, Permission[]>> | null => {
    if (!currentUser) return null;
    const isSuperAdmin = roles.filter(r => currentUser.roleIds.includes(r.id)).some(r => r.name === 'Super Admin');
    if (isSuperAdmin) return null;
    const userRoles = roles.filter(r => currentUser.roleIds.includes(r.id) && r.isActive);
    const withMastersView = userRoles.filter(r => r.permissions[ModuleType.MASTERS]?.includes('view'));
    if (withMastersView.length === 0) return null;
    const result: Partial<Record<MasterType, Permission[]>> = {};
    const fullPerms: Permission[] = ['create', 'edit', 'view', 'delete'];
    withMastersView.forEach(r => {
      const mp = r.mastersPermissions
        ?? (r.allowedMasterTypes?.length
          ? Object.fromEntries(r.allowedMasterTypes.map(t => [t, ['view'] as Permission[]]))
          : Object.fromEntries(ALL_MASTER_TYPES.map(t => [t, fullPerms])));
      (Object.entries(mp) as [MasterType, Permission[]][]).forEach(([type, perms]) => {
        const set = new Set(result[type] || []);
        (perms || []).forEach(p => set.add(p));
        result[type] = Array.from(set);
      });
    });
    return result;
  };

  const handleSidebarTabChange = (tab: NavigationTab) => {
    setRateContractNavIntent(null);
    setPurchaseOrderNavIntent(null);
    setPrNavIntent(null);
    setDiNavIntent(null);
    setPendingPOFromPR(null);
    setActiveTab(tab);
  };

  const handleDashboardNavigate = (nav: DashboardNavigatePayload) => {
    if (nav.tab === 'rate_contract') {
      setPurchaseOrderNavIntent(null);
      setPrNavIntent(null);
      setDiNavIntent(null);
      setRateContractNavIntent(
        nav.viewMode
          ? {
              key: Date.now(),
              viewMode: nav.viewMode,
              listStatusQuick: nav.openDocumentId ? 'approved' : 'pending',
              openDocumentId: nav.openDocumentId,
            }
          : null
      );
      setActiveTab('rate_contract');
      return;
    }
    if (nav.tab === 'purchase_order') {
      setRateContractNavIntent(null);
      setPrNavIntent(null);
      setDiNavIntent(null);
      setPurchaseOrderNavIntent(
        nav.viewMode
          ? {
              key: Date.now(),
              viewMode: nav.viewMode,
              listStatusQuick: nav.openDocumentId ? 'approved' : 'pending',
              openDocumentId: nav.openDocumentId,
            }
          : null
      );
      setActiveTab('purchase_order');
      return;
    }
    if (nav.tab === 'purchase_request') {
      setRateContractNavIntent(null);
      setPurchaseOrderNavIntent(null);
      setDiNavIntent(null);
      setPrNavIntent(
        nav.focusDocumentId
          ? { key: Date.now(), listStatusQuick: 'approved', openDocumentId: nav.focusDocumentId }
          : null
      );
      setActiveTab('purchase_request');
      return;
    }
    if (nav.tab === 'direct_invoice') {
      setRateContractNavIntent(null);
      setPurchaseOrderNavIntent(null);
      setPrNavIntent(null);
      setDiNavIntent(
        nav.focusDocumentId
          ? { key: Date.now(), listStatusQuick: 'approved', openDocumentId: nav.focusDocumentId }
          : null
      );
      setActiveTab('direct_invoice');
      return;
    }
    setRateContractNavIntent(null);
    setPurchaseOrderNavIntent(null);
    setPrNavIntent(null);
    setDiNavIntent(null);
    setActiveTab(nav.tab);
  };

  const renderContent = () => {
    const isSuperAdmin = roles.filter(r => currentUser?.roleIds.includes(r.id)).some(r => r.name === 'Super Admin');
    const superAdminOnlyTabs: NavigationTab[] = ['users', 'roles', 'workflows'];
    if (superAdminOnlyTabs.includes(activeTab) && !isSuperAdmin) {
      return <div className="p-8 text-center font-bold text-slate-500">Access Denied: Admin privileges required.</div>;
    }
    if (activeTab === 'workflow_v2' && !isSuperAdmin && !hasPermission(ModuleType.WORKFLOW_V2, 'view')) {
      return <div className="p-8 text-center font-bold text-slate-500">Access Denied: Workflow (V2) permission required.</div>;
    }

    switch (activeTab) {
      case 'dashboard': return <Dashboard users={users} roles={roles} onNavigateFromDashboard={handleDashboardNavigate} />;
      case 'users': return <UserManagement users={users} setUsers={setUsers} roles={roles} masters={masters} />;
      case 'roles': return <RoleConfiguration roles={roles} setRoles={setRoles} />;
      case 'workflows': return <WorkflowConfiguration workflows={workflows} setWorkflows={setWorkflows} users={users} masters={masters} />;
      case 'workflow_v2': return <WorkflowV2 workflowV2Rules={workflowV2Rules} setWorkflowV2Rules={setWorkflowV2Rules} users={users} masters={masters} />;
      case 'item_approval': return <ItemApproval masters={masters} users={users} currentUser={currentUser!} onAction={refreshPendingApprovalCounts} refetchMasters={refetchMasters} />;
      case 'vendor_approval': return <VendorApproval masters={masters} users={users} currentUser={currentUser!} onAction={refreshPendingApprovalCounts} refetchMasters={refetchMasters} />;
      case 'budget_approval': return <BudgetApproval budgets={budgets} users={users} currentUser={currentUser!} onAction={refreshPendingApprovalCounts} setBudgets={setBudgets} refetchMasters={refetchMasters} />;
      case 'masters':
        if (!hasPermission(ModuleType.MASTERS, 'view')) return <div className="p-8 text-center font-bold text-slate-500">Access Denied</div>;
        return <MastersManagement masters={masters} onUpdate={updateMasters} allowedMasterTypes={getMastersAllowedTypes()} mastersPermissions={getMastersPermissions()} onRefreshPendingItemVendor={refreshPendingApprovalCounts} refetchMasters={refetchMasters} workflowV2Rules={workflowV2Rules} />;
      case 'purchase_request':
        if (!hasPermission(ModuleType.PR, 'view')) return <div className="p-8 text-center font-bold text-slate-500">Access Denied</div>;
        return (
          <PurchaseRequestModule
            masters={masters}
            purchaseRequests={purchaseRequests}
            setPurchaseRequests={setPurchaseRequests}
            onCreatePO={(pr) => {
              setRateContractNavIntent(null);
              setPurchaseOrderNavIntent(null);
              setPrNavIntent(null);
              setDiNavIntent(null);
              setActiveTab('purchase_order');
              setPendingPOFromPR(pr);
            }}
            currentUser={currentUser!}
            workflows={workflows}
            budgets={budgets}
            workflowV2Rules={workflowV2Rules}
            moduleEntryIntent={prNavIntent}
            onModuleEntryIntentConsumed={() => setPrNavIntent(null)}
          />
        );
      case 'rate_contract':
        if (!hasPermission(ModuleType.RATE_CONTRACT, 'view')) return <div className="p-8 text-center font-bold text-slate-500">Access Denied</div>;
        return (
          <RateContractModule
            masters={masters}
            rateContracts={rateContracts}
            setRateContracts={setRateContracts}
            grns={grns}
            setGrns={setGrns}
            invoices={invoices}
            setInvoices={setInvoices}
            currentUser={currentUser!}
            workflows={workflows}
            workflowV2Rules={workflowV2Rules}
            moduleEntryIntent={rateContractNavIntent}
            onModuleEntryIntentConsumed={() => setRateContractNavIntent(null)}
          />
        );
      case 'purchase_order':
        if (!hasPermission(ModuleType.PO, 'view')) return <div className="p-8 text-center font-bold text-slate-500">Access Denied</div>;
        return (
          <PurchaseOrderModule
            masters={masters}
            purchaseOrders={purchaseOrders}
            setPurchaseOrders={setPurchaseOrders}
            grns={grns}
            setGrns={setGrns}
            invoices={invoices}
            setInvoices={setInvoices}
            pendingPR={pendingPOFromPR}
            onPOCreated={() => setPendingPOFromPR(null)}
            currentUser={currentUser!}
            workflows={workflows}
            budgets={budgets}
            setBudgets={setBudgets}
            workflowV2Rules={workflowV2Rules}
            moduleEntryIntent={purchaseOrderNavIntent}
            onModuleEntryIntentConsumed={() => setPurchaseOrderNavIntent(null)}
          />
        );
      case 'direct_invoice':
        if (!hasPermission(ModuleType.DIRECT_INVOICE, 'view')) return <div className="p-8 text-center font-bold text-slate-500">Access Denied</div>;
        return (
          <DirectInvoiceModule
            masters={masters}
            currentUser={currentUser!}
            workflows={workflows}
            budgets={budgets}
            setBudgets={setBudgets}
            directInvoices={directInvoices}
            setDirectInvoices={setDirectInvoices}
            workflowV2Rules={workflowV2Rules}
            moduleEntryIntent={diNavIntent}
            onModuleEntryIntentConsumed={() => setDiNavIntent(null)}
          />
        );
      case 'budgets':
        if (!hasPermission(ModuleType.BUDGET, 'view')) return <div className="p-8 text-center font-bold text-slate-500">Access Denied</div>;
        return (
          <BudgetModule
            budgets={budgets}
            setBudgets={setBudgets}
            amendments={budgetAmendments}
            setAmendments={setBudgetAmendments}
            masters={masters}
            currentUser={currentUser!}
            purchaseOrders={purchaseOrders}
            purchaseRequests={purchaseRequests}
            workflowV2Rules={workflowV2Rules}
            onRefreshPendingCounts={refreshPendingApprovalCounts}
          />
        );
      default: return <Dashboard users={users} roles={roles} onNavigateFromDashboard={handleDashboardNavigate} />;
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="inline-block h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
          <p className="mt-4 font-semibold text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center max-w-md">
          <p className="font-bold text-rose-700">Failed to load data</p>
          <p className="mt-2 text-sm text-rose-600">{loadError}</p>
          <p className="mt-2 text-xs text-slate-500">Ensure the backend is running and connected to PostgreSQL.</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <Login onLogin={setCurrentUser} />;
  }

  const sessionTimerStr =
    sessionRemaining !== null
      ? `${Math.floor(sessionRemaining / 60)
          .toString()
          .padStart(2, '0')}:${(sessionRemaining % 60).toString().padStart(2, '0')}`
      : null;
  const showSessionWarning = sessionRemaining !== null && sessionRemaining <= 120 && sessionRemaining > 0;

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-slate-50 font-sans text-slate-900">
      <Sidebar activeTab={activeTab} setActiveTab={handleSidebarTabChange} currentUser={currentUser} roles={roles} onLogout={handleLogout} pendingItemCount={pendingItemCount} pendingVendorCount={pendingVendorCount} pendingBudgetCount={pendingBudgetCount} />
      <main className="flex-1 overflow-y-auto p-8 relative">
        {showSessionWarning && (
          <div className="sticky top-0 z-30 mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-bold text-amber-800 shadow-sm">
            Your session will expire in {sessionTimerStr}. Please save your work.
          </div>
        )}
        <header className="mb-8 flex justify-between items-center sticky top-0 bg-slate-50/80 backdrop-blur-md z-20 pb-4">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight capitalize">{activeTab.replace('_', ' ')}</h1>
            <p className="text-slate-500 font-semibold text-sm">Enterprise Governance Dashboard</p>
          </div>
          <div className="flex items-center space-x-6">
            {sessionTimerStr && (
              <span
                className={`text-sm font-mono font-bold ${sessionRemaining !== null && sessionRemaining < 120 ? 'text-rose-600' : 'text-slate-500'}`}
                title="Session time remaining"
              >
                ⏱ {sessionTimerStr}
              </span>
            )}
            <div className="bg-white shadow-xl shadow-slate-200/50 border border-slate-100 rounded-2xl px-5 py-2.5 flex items-center space-x-4">
              <div className="text-right">
                <span className="text-sm font-black text-slate-800 block">{currentUser.name}</span>
                <span className="text-[10px] text-slate-400 font-black uppercase tracking-[0.15em] block">{currentUser.email}</span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-700 flex items-center justify-center text-white text-xs font-black shadow-lg shadow-indigo-200">
                {currentUser.name.split(' ').map(n => n[0]).join('')}
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="p-3 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-rose-500 hover:border-rose-100 transition-all shadow-sm group"
              title="Logout"
            >
              <svg className="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </header>
        <div className="max-w-7xl mx-auto">{renderContent()}</div>
      </main>
    </div>
  );
};

export default App;
