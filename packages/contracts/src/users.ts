import { PermissionCode } from './permissions';

/**
 * User-management + role contracts (Phase 02). Users are global identities; a user's
 * access to an organization is a Membership carrying a role and an optional warehouse scope.
 */

export interface CreateUserRequest {
  email: string;
  name: string;
  roleKey: string;
  /** Warehouse ids this member is limited to. Empty/omitted = all warehouses. */
  warehouseScope?: string[];
  /**
   * Required only when the email does not already belong to an existing user.
   * If the email exists, they are added to this organization with their current credentials.
   */
  password?: string;
}

export interface UpdateUserRequest {
  name?: string;
  roleKey?: string;
  /** null = all warehouses; array = restrict to those ids. */
  warehouseScope?: string[] | null;
  status?: 'ACTIVE' | 'DISABLED';
}

export interface MembershipUserResponse {
  userId: string;
  membershipId: string;
  email: string;
  name: string;
  roleKey: string;
  roleName: string;
  status: 'ACTIVE' | 'DISABLED';
  /** null = all warehouses. */
  warehouseScope: string[] | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface RoleResponse {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: PermissionCode[];
}
