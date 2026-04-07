import { ModuleType, MasterType } from './types';

export const ENTITIES = ['Alpha Corp', 'Beta Logistics', 'Gamma Industries', 'Delta Global'];

/** Master sub-module groups used in Masters Control and Role Config. Single source of truth. */
export const MASTER_GROUPS: { label: string; types: MasterType[] }[] = [
  { label: 'Purchasing', types: ['Vendor', 'Vendor Site', 'Vendor Category', 'Applicant Type', 'Item', 'Item Type', 'Item Category', 'UOM', 'Payment Terms'] },
  { label: 'Organization', types: ['Department', 'Subdepartment', 'Cost Center', 'Entity', 'Center'] },
  { label: 'Finance & Tax', types: ['COA', 'TDS', 'GST', 'Voucher', 'Currency', 'Invoice Source'] },
  { label: 'Geography', types: ['Country', 'Zone', 'State', 'City'] },
];
export const ALL_MASTER_TYPES = MASTER_GROUPS.flatMap((g) => g.types);
export const DEPARTMENTS = ['Procurement', 'Finance', 'IT', 'Operations', 'HR', 'Legal'];

export const DEPT_SUBDEPT_MAP: Record<string, string[]> = {
  'Procurement': ['Sourcing', 'Inventory', 'Vendor Management'],
  'IT': ['Infrastructure', 'Software Licensing', 'Tech Support'],
  'Finance': ['Accounts Payable', 'Treasury', 'Taxation'],
  'Operations': ['Logistics', 'Supply Chain'],
  'HR': ['Employee Relations', 'Recruitment'],
  'Legal': ['Compliance', 'Contracts']
};

export const ALL_SUBDEPARTMENTS = Object.values(DEPT_SUBDEPT_MAP).flat();
export const CENTERS = ['New York', 'London', 'Singapore', 'Mumbai', 'Berlin'];

export const ALL_MODULES = Object.values(ModuleType);
/** Modules shown in Role Config main table (Item and Vendor are only in Masters Control sub-modules). */
export const ROLE_CONFIG_MODULES = ALL_MODULES.filter(
  (m) => m !== ModuleType.ITEM && m !== ModuleType.VENDOR
);
export const ALL_PERMISSIONS: ('create' | 'edit' | 'view' | 'delete')[] = ['create', 'edit', 'view', 'delete'];

export const COA_CATEGORIES = ['Assets', 'Liabilities', 'Expenses', 'Income'];
export const GST_TYPES = ['CGST', 'SGST', 'IGST'];
export const TRANSACTION_TYPES = ['PO', 'Invoice', 'Contract'];
