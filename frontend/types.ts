
export enum ModuleType {
  ITEM = 'Item',
  VENDOR = 'Vendor',
  RATE_CONTRACT = 'Rate Contract',
  PR = 'Purchase Request (PR)',
  PO = 'Purchase Order (PO)',
  GRN = 'Goods Receipt Note (GRN)',
  INVOICE_GRN = 'Invoice against GRN',
  DIRECT_INVOICE = 'Direct Invoice',
  BUDGET = 'Budget',
  MASTERS = 'Masters Control',
  WORKFLOW_V2 = 'Workflow (V2)',
  ITEM_APPROVAL = 'Item Approval',
  VENDOR_APPROVAL = 'Vendor Approval',
  BUDGET_APPROVAL = 'Budget Approval',
}

export type Permission = 'create' | 'edit' | 'view' | 'delete';

export interface Role {
  id: string;
  name: string;
  permissions: Record<ModuleType, Permission[]>;
  /** When set, only these master sub-modules are visible inside Masters Control. Empty/undefined = all. @deprecated Prefer mastersPermissions. */
  allowedMasterTypes?: MasterType[];
  /** Per master sub-module permissions (create, edit, view, delete). When present, used for Masters Control granular access. */
  mastersPermissions?: Partial<Record<MasterType, Permission[]>>;
  isActive: boolean;
}

export interface User {
  id: string;
  employeeId: string;
  name: string;
  centerNames: string[];
  departments: string[];
  subDepartments: string[];
  phoneNumber: string;
  email: string;
  entityNames: string[];
  roleIds: string[];
  isActive: boolean;
}

export interface MasterRecord {
  id: string;
  name: string;
  status: 'Active' | 'Inactive';
  [key: string]: any;
}

export type NavigationTab = 'dashboard' | 'users' | 'roles' | 'workflows' | 'workflow_v2' | 'item_approval' | 'vendor_approval' | 'budget_approval' | 'masters' | 'purchase_request' | 'rate_contract' | 'purchase_order' | 'direct_invoice' | 'budgets';

export type MasterType = 
  | 'Vendor' | 'Vendor Site' | 'Item' | 'Item Type' | 'Department' | 'Subdepartment' 
  | 'COA' | 'TDS' | 'GST' | 'Cost Center'
  | 'Country' | 'Zone' | 'State' | 'City'
  | 'Payment Terms' | 'Terms & Conditions' | 'Center' | 'Entity' | 'Voucher'
  | 'Vendor Category' | 'Applicant Type' | 'Item Category' | 'UOM' | 'Budget'
  | 'Currency' | 'Invoice Source';

export enum BudgetType {
  OPEX = 'OPEX',
  CAPEX = 'CAPEX'
}

export enum BudgetControlType {
  HARD_STOP = 'Hard Stop',
  SOFT_WARNING = 'Soft Warning'
}

export enum BudgetValidity {
  MONTHLY = 'Monthly',
  QUARTERLY = 'Quarterly',
  ANNUAL = 'Annual'
}

export interface Budget {
  id: string;
  financialYear: string;
  entityName: string;
  locationName: string;
  costCenterName: string;
  coaCode: string; // GL Code
  department?: string;
  subDepartment?: string;
  budgetType: BudgetType;
  amount: number;
  consumedAmount: number;
  controlType: BudgetControlType;
  validity: BudgetValidity;
  isActive: boolean;
  /** Month key -> allocated amount (whole rupees). */
  monthlyAllocation?: Record<string, number>;
  workflowStatus?: 'Draft' | 'Pending' | 'Approved' | 'Rejected';
  workflowCurrentStepIndex?: number;
  workflowRuleId?: string;
  workflowCreatedBy?: string;
  workflowRejectionRemarks?: string;
  /** Server-written audit: submit / completeReview / approve / reject */
  workflowStepHistory?: { action: string; userId?: string; at?: string; stepIndex?: number }[];
}

export interface BudgetAmendment {
  id: string;
  budgetId: string;
  type: 'Increase' | 'Decrease' | 'Transfer';
  amount: number;
  targetBudgetId?: string; // For transfers
  justification: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  requestedBy: string;
  approvedBy?: string;
  createdAt: string;
}

export type TransactionType = 'Material' | 'Service' | 'Asset';
export type Frequency = 'Monthly' | 'Quarterly' | 'Yearly' | 'One-Time';

export interface Attachment {
  id: string;
  name: string;
  url: string;
  uploadedAt: string;
  source: 'PR' | 'RC' | 'PO' | 'GRN' | 'Invoice';
}

export interface WorkflowStepHistoryEntry {
  action: 'submit' | 'completeReview' | 'approve' | 'reject' | 'amend' | string;
  userId?: string;
  at?: string;
  stepIndex?: number;
}

export interface ItemLine {
  id: string;
  /** Original source item id for partial receipt tracking. */
  sourceItemId?: string;
  itemName: string;
  desc?: string;
  quantity: number;
  rate: number;
  amount: number; // baseAmount: quantity * rate
  tds?: number; // percentage
  tdsAmount?: number;
  gst?: number; // percentage
  gstAmount?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  totalAmount?: number; // amount + gstAmount - tdsAmount
  centerName?: string;
  /** Multiple centers per line. */
  centerNames?: string[];
  /** Centers set at RC creation; after approval these cannot be removed, only more can be added. */
  centerNamesLocked?: string[];
  coaCode?: string;
  /** PO left quantity before current GRN submit (PO-backed GRN form only). */
  poLeftQty?: number;
  remarks: string;
}

export interface PurchaseRequest {
  id: string;
  entityName: string;
  vendorId?: string;
  vendorSiteId?: string;
  transactionType: string;
  validFrom: string;
  validTo: string;
  frequency: Frequency;
  department: string;
  subDepartment: string;
  paymentTerms: string;
  termsAndConditionsId?: string;
  centerNames: string[];
  items: ItemLine[];
  amount: number;
  remarks: string;
  /** Document-level summary separate from remarks; flows independently PR → PO → GRN → Invoice. */
  overallSummary?: string;
  attachments: Attachment[];
  status: 'Draft' | 'Pending' | 'Approved' | 'Rejected' | 'Amended' | 'Budget Hold';
  currentStepIndex: number;
  isUnbudgeted?: boolean;
  unbudgetedJustification?: string;
  unbudgetedAttachmentUrl?: string;
  rejectionRemarks?: string;
  createdBy: string;
  createdAt: string;
  requiredDate?: string;
  shippingAddressId?: string;
  billingAddressId?: string;
  workflowStepHistory?: WorkflowStepHistoryEntry[];
}

export interface RateContract {
  id: string;
  entityName: string;
  vendorId: string;
  vendorSiteId?: string;
  transactionType: string;
  validFrom: string;
  validTo: string;
  frequency: Frequency;
  department: string;
  subDepartment: string;
  paymentTerms: string;
  termsAndConditionsId?: string;
  items: ItemLine[];
  amount: number;
  remarks: string;
  overallSummary?: string;
  attachments: Attachment[];
  status: 'Draft' | 'Pending' | 'Approved' | 'Rejected' | 'Amended';
  currentStepIndex: number;
  rejectionRemarks?: string;
  createdBy: string;
  createdAt: string;
  requiredDate?: string;
  shippingAddressId?: string;
  billingAddressId?: string;
  workflowStepHistory?: WorkflowStepHistoryEntry[];
  /** PO/RC currency; flows to invoice as Oracle InvoiceCurrency. */
  currencyCode?: string;
}

export interface PurchaseOrder {
  id: string;
  entityName: string;
  vendorId: string;
  vendorSiteId?: string;
  transactionType: string;
  validFrom: string;
  validTo: string;
  frequency: Frequency;
  department: string;
  subDepartment: string;
  paymentTerms: string;
  termsAndConditionsId?: string;
  centerNames: string[];
  items: ItemLine[];
  tds?: number; // top-level percentage
  gst?: number; // top-level percentage
  amount: number;
  remarks: string;
  overallSummary?: string;
  attachments: Attachment[];
  status: 'Draft' | 'Pending' | 'Approved' | 'Rejected' | 'Amended' | 'Budget Hold';
  currentStepIndex: number;
  isUnbudgeted?: boolean;
  unbudgetedJustification?: string;
  unbudgetedAttachmentUrl?: string;
  rejectionRemarks?: string;
  createdBy: string;
  createdAt: string;
  requiredDate?: string;
  shippingAddressId?: string;
  billingAddressId?: string;
  isAdvancePO?: boolean;
  advancePercentage?: number;
  /** PO amount × advance % / 100 when advance PO. */
  advanceAmount?: number;
  /** e.g. PREPAYMENT when advance PO with pct > 0. */
  expectedInvoiceType?: string;
  /** PO currency; flows to invoice as Oracle InvoiceCurrency. */
  currencyCode?: string;
  workflowStepHistory?: WorkflowStepHistoryEntry[];
}

export interface GRN {
  id: string;
  entityName: string;
  rateContractId?: string;
  purchaseOrderId?: string;
  vendorSiteId?: string;
  location: string;
  department?: string;
  subDepartment?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  items: ItemLine[];
  amount: number;
  remarks: string;
  overallSummary?: string;
  attachments: Attachment[];
  status: 'Draft' | 'Pending' | 'Approved' | 'Rejected' | 'Reversed';
  currentStepIndex: number;
  rejectionRemarks?: string;
  createdBy: string;
  createdAt: string;
  shippingAddressId?: string;
  billingAddressId?: string;
  tds?: number;
  gst?: number;
  workflowStepHistory?: WorkflowStepHistoryEntry[];
}

export interface Invoice {
  id: string;
  entityName: string;
  /** Set for PO/GRN-based invoices; absent for direct invoices. */
  grnId?: string;
  vendorSiteId?: string;
  location: string;
  department?: string;
  subDepartment?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  items: ItemLine[];
  amount: number;
  /** Header remarks (GRN-based and direct invoices). */
  remarks?: string;
  overallSummary?: string;
  status: 'Draft' | 'Pending' | 'Approved' | 'Rejected' | 'Reversed';
  currentStepIndex: number;
  rejectionRemarks?: string;
  createdBy: string;
  createdAt: string;
  attachments: Attachment[];
  shippingAddressId?: string;
  billingAddressId?: string;
  tds?: number;
  gst?: number;
  workflowStepHistory?: WorkflowStepHistoryEntry[];
  /** Set after POST .../invoices/:id/sync-oracle (mock or real ERP). */
  oracleInvoiceId?: string;
  oracleSyncStatus?: string;
  oracleSyncResponse?: Record<string, unknown>;
  oracleTaxResponse?: Record<string, unknown>;
  oracleSyncError?: Record<string, unknown>;
  /** Oracle Fusion InvoiceCurrency (e.g. INR). */
  invoiceCurrency?: string;
  invoiceGroup?: string;
  /** Set on final approval; GL accounting date. */
  accountingDate?: string;
  invoiceSource?: string;
  /** Standard | Prepayment | Debit memo */
  invoiceType?: string;
}

// Workflow specific types
export enum ApprovalType {
  REVIEWER = 'Reviewer',
  APPROVER = 'Approver'
}

export interface ApprovalStep {
  id: string;
  type: ApprovalType;
  userIds: string[]; // Multiple users allowed, any one can approve
}

export interface WorkflowRule {
  id: string;
  entityName: string;
  moduleType: ModuleType;
  subDepartment: string;
  centerName?: string;
  minAmount: number;
  maxAmount: number | null; // null means no upper limit
  approvalChain: ApprovalStep[];
  isActive: boolean;
}

/** Item/Vendor creation approval rules (independent of PO/RC/GRN/Invoice workflows). */
export interface WorkflowV2Rule {
  id: string;
  scope: 'Item' | 'Vendor' | 'Budget';
  masterId: string;
  approvalChain: ApprovalStep[];
  isActive: boolean;
}

export interface DepartmentLimit {
  department: string;
  maxLimit: number;
  isActive: boolean;
}
