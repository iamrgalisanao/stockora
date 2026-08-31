import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS } from '@iw/contracts';
import { PermissionsGuard } from './permissions.guard';
import type { RequestUser } from '../request-user';

function contextWithUser(user: RequestUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

const baseUser: RequestUser = {
  userId: 'u1',
  email: 'a@b.c',
  membershipId: 'm1',
  organizationId: 'o1',
  roleKey: 'warehouse_staff',
  roleName: 'Warehouse Staff',
  permissions: [PERMISSIONS.INVENTORY_VIEW, PERMISSIONS.INVENTORY_RECEIVE],
  warehouseScope: null,
};

describe('PermissionsGuard', () => {
  function guardWith(required: string[] | undefined, isPublic = false): PermissionsGuard {
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === 'isPublic' ? isPublic : required,
    } as unknown as Reflector;
    return new PermissionsGuard(reflector);
  }

  it('allows when no permissions are required', () => {
    expect(guardWith(undefined).canActivate(contextWithUser(baseUser))).toBe(true);
  });

  it('allows public routes without a user', () => {
    expect(guardWith([PERMISSIONS.INVENTORY_RELEASE], true).canActivate(contextWithUser(undefined))).toBe(true);
  });

  it('allows when the user holds the required permission', () => {
    const guard = guardWith([PERMISSIONS.INVENTORY_RECEIVE]);
    expect(guard.canActivate(contextWithUser(baseUser))).toBe(true);
  });

  it('denies when a required permission is missing', () => {
    const guard = guardWith([PERMISSIONS.INVENTORY_RELEASE]);
    expect(() => guard.canActivate(contextWithUser(baseUser))).toThrow(ForbiddenException);
  });

  it('denies when there is no authenticated user', () => {
    const guard = guardWith([PERMISSIONS.INVENTORY_VIEW]);
    expect(() => guard.canActivate(contextWithUser(undefined))).toThrow(ForbiddenException);
  });
});
