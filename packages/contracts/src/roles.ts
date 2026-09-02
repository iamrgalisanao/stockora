import { PERMISSIONS, PermissionCode } from './permissions';

/**
 * System role keys (Phase 0 §2). These are the default role bundles seeded per organization.
 * Organizations may create custom roles with arbitrary permission sets.
 */
export const SYSTEM_ROLES = {
  ADMINISTRATOR: 'administrator',
  INVENTORY_MANAGER: 'inventory_manager',
  WAREHOUSE_MANAGER: 'warehouse_manager',
  WAREHOUSE_STAFF: 'warehouse_staff',
  PURCHASING: 'purchasing',
  FINANCE: 'finance',
  APPROVER: 'approver',
  AUDITOR: 'auditor',
  VIEWER: 'viewer',
} as const;

export type SystemRoleKey = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

const P = PERMISSIONS;

/** Default permission bundles per system role (Phase 0 §11 permission matrix). */
export const ROLE_PERMISSIONS: Record<SystemRoleKey, PermissionCode[]> = {
  [SYSTEM_ROLES.ADMINISTRATOR]: [
    P.INVENTORY_VIEW, P.INVENTORY_RECEIVE, P.INVENTORY_RELEASE, P.INVENTORY_TRANSFER,
    P.INVENTORY_COUNT, P.INVENTORY_ADJUST, P.INVENTORY_APPROVE_ADJUSTMENT, P.INVENTORY_APPROVE,
    P.INVENTORY_RESERVE, P.OVERRIDE_NEGATIVE, P.COST_VIEW, P.VALUATION_VIEW, P.PRODUCT_MANAGE,
    P.WAREHOUSE_MANAGE, P.SUPPLIER_MANAGE, P.USER_MANAGE, P.ROLE_MANAGE, P.SETTINGS_MANAGE,
    P.REPORT_VIEW, P.REPORT_EXPORT, P.AUDIT_VIEW,
  ],
  [SYSTEM_ROLES.INVENTORY_MANAGER]: [
    P.INVENTORY_VIEW, P.INVENTORY_RECEIVE, P.INVENTORY_RELEASE, P.INVENTORY_TRANSFER,
    P.INVENTORY_COUNT, P.INVENTORY_ADJUST, P.INVENTORY_APPROVE_ADJUSTMENT, P.INVENTORY_APPROVE,
    P.INVENTORY_RESERVE, P.COST_VIEW, P.VALUATION_VIEW, P.PRODUCT_MANAGE, P.WAREHOUSE_MANAGE,
    P.SUPPLIER_MANAGE, P.REPORT_VIEW, P.REPORT_EXPORT, P.AUDIT_VIEW,
  ],
  [SYSTEM_ROLES.WAREHOUSE_MANAGER]: [
    P.INVENTORY_VIEW, P.INVENTORY_RECEIVE, P.INVENTORY_RELEASE, P.INVENTORY_TRANSFER,
    P.INVENTORY_COUNT, P.INVENTORY_ADJUST, P.INVENTORY_APPROVE_ADJUSTMENT, P.INVENTORY_APPROVE,
    P.INVENTORY_RESERVE, P.COST_VIEW, P.WAREHOUSE_MANAGE, P.REPORT_VIEW, P.REPORT_EXPORT, P.AUDIT_VIEW,
  ],
  [SYSTEM_ROLES.WAREHOUSE_STAFF]: [
    P.INVENTORY_VIEW, P.INVENTORY_RECEIVE, P.INVENTORY_RELEASE, P.INVENTORY_TRANSFER,
    P.INVENTORY_COUNT,
  ],
  [SYSTEM_ROLES.PURCHASING]: [
    P.INVENTORY_VIEW, P.COST_VIEW, P.SUPPLIER_MANAGE, P.REPORT_VIEW, P.REPORT_EXPORT,
  ],
  [SYSTEM_ROLES.FINANCE]: [
    P.INVENTORY_VIEW, P.INVENTORY_APPROVE_ADJUSTMENT, P.INVENTORY_APPROVE, P.COST_VIEW,
    P.VALUATION_VIEW, P.REPORT_VIEW, P.REPORT_EXPORT, P.AUDIT_VIEW,
  ],
  [SYSTEM_ROLES.APPROVER]: [
    P.INVENTORY_VIEW, P.INVENTORY_APPROVE_ADJUSTMENT, P.INVENTORY_APPROVE, P.REPORT_VIEW,
  ],
  [SYSTEM_ROLES.AUDITOR]: [
    P.INVENTORY_VIEW, P.COST_VIEW, P.VALUATION_VIEW, P.REPORT_VIEW, P.REPORT_EXPORT, P.AUDIT_VIEW,
  ],
  [SYSTEM_ROLES.VIEWER]: [
    P.INVENTORY_VIEW, P.REPORT_VIEW,
  ],
};

export interface SystemRoleDefinition {
  key: SystemRoleKey;
  name: string;
  description: string;
  permissions: PermissionCode[];
}

export const SYSTEM_ROLE_DEFINITIONS: SystemRoleDefinition[] = [
  { key: SYSTEM_ROLES.ADMINISTRATOR, name: 'Administrator', description: 'Full access within the organization', permissions: ROLE_PERMISSIONS[SYSTEM_ROLES.ADMINISTRATOR] },
  { key: SYSTEM_ROLES.INVENTORY_MANAGER, name: 'Inventory Manager', description: 'All inventory operations across assigned warehouses', permissions: ROLE_PERMISSIONS[SYSTEM_ROLES.INVENTORY_MANAGER] },
  { key: SYSTEM_ROLES.WAREHOUSE_MANAGER, name: 'Warehouse Manager', description: 'Operations within assigned warehouses', permissions: ROLE_PERMISSIONS[SYSTEM_ROLES.WAREHOUSE_MANAGER] },
  { key: SYSTEM_ROLES.WAREHOUSE_STAFF, name: 'Warehouse Staff', description: 'Execute receive/pick/count within assigned warehouses', permissions: ROLE_PERMISSIONS[SYSTEM_ROLES.WAREHOUSE_STAFF] },
  { key: SYSTEM_ROLES.PURCHASING, name: 'Purchasing', description: 'Suppliers and reorder recommendations', permissions: ROLE_PERMISSIONS[SYSTEM_ROLES.PURCHASING] },
  { key: SYSTEM_ROLES.FINANCE, name: 'Finance', description: 'Cost, valuation, reports; high-value approvals', permissions: ROLE_PERMISSIONS[SYSTEM_ROLES.FINANCE] },
  { key: SYSTEM_ROLES.APPROVER, name: 'Approver', description: 'Approve adjustments and documents', permissions: ROLE_PERMISSIONS[SYSTEM_ROLES.APPROVER] },
  { key: SYSTEM_ROLES.AUDITOR, name: 'Auditor', description: 'Read-only access including audit log', permissions: ROLE_PERMISSIONS[SYSTEM_ROLES.AUDITOR] },
  { key: SYSTEM_ROLES.VIEWER, name: 'Viewer', description: 'Dashboards and reports only', permissions: ROLE_PERMISSIONS[SYSTEM_ROLES.VIEWER] },
];
