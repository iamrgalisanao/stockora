import type { PermissionCode } from '@iw/contracts';

/**
 * The authenticated principal attached to every request (`req.user`) after JWT validation.
 * `organizationId` is the tenant boundary — services MUST scope all queries by it.
 */
export interface RequestUser {
  userId: string;
  email: string;
  name: string;
  membershipId: string;
  organizationId: string;
  roleKey: string;
  roleName: string;
  permissions: PermissionCode[];
  /** null = all warehouses; otherwise the set of allowed warehouse ids. */
  warehouseScope: string[] | null;
}

/** Shape of the signed JWT payload. */
export interface JwtPayload {
  sub: string; // user id
  email: string;
  mid: string; // membership id
  org: string; // organization id
}
