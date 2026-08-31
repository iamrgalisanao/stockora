import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  SYSTEM_ROLES,
} from '@iw/contracts';

describe('System role permission bundles', () => {
  it('grants the Administrator every permission', () => {
    const admin = new Set(ROLE_PERMISSIONS[SYSTEM_ROLES.ADMINISTRATOR]);
    for (const code of ALL_PERMISSIONS) {
      expect(admin.has(code)).toBe(true);
    }
  });

  it('limits Warehouse Staff to operational permissions without cost/valuation', () => {
    const staff = ROLE_PERMISSIONS[SYSTEM_ROLES.WAREHOUSE_STAFF];
    expect(staff).toContain(PERMISSIONS.INVENTORY_RECEIVE);
    expect(staff).not.toContain(PERMISSIONS.COST_VIEW);
    expect(staff).not.toContain(PERMISSIONS.VALUATION_VIEW);
    expect(staff).not.toContain(PERMISSIONS.INVENTORY_APPROVE_ADJUSTMENT);
  });

  it('limits Viewer to read-only capabilities', () => {
    const viewer = ROLE_PERMISSIONS[SYSTEM_ROLES.VIEWER];
    expect(viewer).toEqual(
      expect.arrayContaining([PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.REPORT_VIEW]),
    );
    expect(viewer).not.toContain(PERMISSIONS.INVENTORY_RECEIVE);
    expect(viewer).not.toContain(PERMISSIONS.INVENTORY_ADJUST);
  });

  it('only Administrator holds the negative-inventory override by default', () => {
    for (const [key, perms] of Object.entries(ROLE_PERMISSIONS)) {
      const hasOverride = perms.includes(PERMISSIONS.OVERRIDE_NEGATIVE);
      expect(hasOverride).toBe(key === SYSTEM_ROLES.ADMINISTRATOR);
    }
  });
});
