/**
 * Permission catalog — the authoritative list of capability codes (Phase 0 §11).
 * Roles are bundles of these codes. Guards check a user's effective permission set
 * against a required code. Codes are stable strings: never renamed, only added/deprecated.
 */
export const PERMISSIONS = {
  // Inventory operations
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_RECEIVE: 'inventory.receive',
  INVENTORY_RELEASE: 'inventory.release',
  INVENTORY_TRANSFER: 'inventory.transfer',
  INVENTORY_COUNT: 'inventory.count',
  INVENTORY_ADJUST: 'inventory.adjust',
  INVENTORY_APPROVE_ADJUSTMENT: 'inventory.approve_adjustment',
  // Generic document approval (releases, transfers) — distinct from creating them,
  // so a document's creator cannot also approve it.
  INVENTORY_APPROVE: 'inventory.approve',
  INVENTORY_RESERVE: 'inventory.reserve',
  OVERRIDE_NEGATIVE: 'override.negative',

  // Sensitive visibility
  COST_VIEW: 'cost.view',
  VALUATION_VIEW: 'valuation.view',

  // Master data & administration
  PRODUCT_MANAGE: 'product.manage',
  WAREHOUSE_MANAGE: 'warehouse.manage',
  SUPPLIER_MANAGE: 'supplier.manage',
  USER_MANAGE: 'user.manage',
  ROLE_MANAGE: 'role.manage',
  SETTINGS_MANAGE: 'settings.manage',

  // Reporting
  REPORT_VIEW: 'report.view',
  REPORT_EXPORT: 'report.export',

  // Audit
  AUDIT_VIEW: 'audit.view',

  // Bulk import / export (2A.3)
  IMPORT_PRODUCTS: 'import.products',
  IMPORT_SUPPLIERS: 'import.suppliers',
  IMPORT_OPENING_INVENTORY: 'import.opening_inventory',
  EXPORT_CATALOG: 'export.catalog',
  EXPORT_INVENTORY: 'export.inventory',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** All permission codes as a flat array (useful for seeding the catalog table). */
export const ALL_PERMISSIONS: PermissionCode[] = Object.values(PERMISSIONS);

export interface PermissionDefinition {
  code: PermissionCode;
  description: string;
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  { code: PERMISSIONS.INVENTORY_VIEW, description: 'View inventory balances and stock' },
  { code: PERMISSIONS.INVENTORY_RECEIVE, description: 'Receive goods into inventory' },
  { code: PERMISSIONS.INVENTORY_RELEASE, description: 'Release/issue stock out of inventory' },
  { code: PERMISSIONS.INVENTORY_TRANSFER, description: 'Transfer stock between warehouses' },
  { code: PERMISSIONS.INVENTORY_COUNT, description: 'Perform physical / cycle counts' },
  { code: PERMISSIONS.INVENTORY_ADJUST, description: 'Submit stock adjustments' },
  { code: PERMISSIONS.INVENTORY_APPROVE_ADJUSTMENT, description: 'Approve stock adjustments' },
  { code: PERMISSIONS.INVENTORY_APPROVE, description: 'Approve releases and transfers' },
  { code: PERMISSIONS.INVENTORY_RESERVE, description: 'Reserve stock against demand' },
  { code: PERMISSIONS.OVERRIDE_NEGATIVE, description: 'Authorize negative-inventory overrides' },
  { code: PERMISSIONS.COST_VIEW, description: 'View item cost' },
  { code: PERMISSIONS.VALUATION_VIEW, description: 'View inventory valuation' },
  { code: PERMISSIONS.PRODUCT_MANAGE, description: 'Manage product master data' },
  { code: PERMISSIONS.WAREHOUSE_MANAGE, description: 'Manage warehouses and locations' },
  { code: PERMISSIONS.SUPPLIER_MANAGE, description: 'Manage suppliers' },
  { code: PERMISSIONS.USER_MANAGE, description: 'Manage users and memberships' },
  { code: PERMISSIONS.ROLE_MANAGE, description: 'Manage roles and permissions' },
  { code: PERMISSIONS.SETTINGS_MANAGE, description: 'Manage organization settings' },
  { code: PERMISSIONS.REPORT_VIEW, description: 'View reports' },
  { code: PERMISSIONS.REPORT_EXPORT, description: 'Export reports' },
  { code: PERMISSIONS.AUDIT_VIEW, description: 'View the audit log' },
  { code: PERMISSIONS.IMPORT_PRODUCTS, description: 'Bulk-import products, variants, and barcodes' },
  { code: PERMISSIONS.IMPORT_SUPPLIERS, description: 'Bulk-import suppliers and supplier-product links' },
  { code: PERMISSIONS.IMPORT_OPENING_INVENTORY, description: 'Bulk-import opening inventory balances' },
  { code: PERMISSIONS.EXPORT_CATALOG, description: 'Export catalog data (products, suppliers)' },
  { code: PERMISSIONS.EXPORT_INVENTORY, description: 'Export inventory data (stock balances)' },
];
