
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
  MASTERS = 'Masters Control'
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

export type NavigationTab = 'dashboard' | 'users' | 'roles' | 'workflows' | 'workflow_v2' | 'item_vendor_approval' | 'masters' | 'purchase_request' | 'rate_contract' | 'purchase_order' | 'direct_invoice' | 'budgets';

export type MasterType = 
  | 'Vendor' | 'Vendor Site' | 'Item' | 'Item Type' | 'Department' | 'Subdepartment' 
  | 'COA' | 'TDS' | 'GST' | 'Cost Center'
  | 'Country' | 'Zone' | 'State' | 'City'
  | 'Payment Terms' | 'Terms & Conditions' | 'Center' | 'Entity' | 'Voucher'
  | 'Vendor Category' | 'Applicant Type' | 'Item Category' | 'UOM' | 'Budget';

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

export interface ItemLine {
  id: string;
  itemName: string;
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
  attachments: Attachment[];
  status: 'Draft' | 'Pending' | 'Approved' | 'Rejected' | 'Amended';
  currentStepIndex: number;
  rejectionRemarks?: string;
  createdBy: string;
  createdAt: string;
  requiredDate?: string;
  shippingAddressId?: string;
  billingAddressId?: string;
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
}

export interface Invoice {
  id: string;
  entityName: string;
  grnId: string;
  vendorSiteId?: string;
  location: string;
  department?: string;
  subDepartment?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  items: ItemLine[];
  amount: number;
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
  scope: 'Item' | 'Vendor';
  masterId: string;
  approvalChain: ApprovalStep[];
  isActive: boolean;
}

export interface DepartmentLimit {
  department: string;
  maxLimit: number;
  isActive: boolean;
}
