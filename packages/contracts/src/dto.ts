import { PermissionCode } from './permissions';

/**
 * Shared request/response contracts for the Auth + Organization foundation (Phase 0 §10).
 * These are the stable shapes the web client and any future integration depend on.
 */

/** Registers a brand-new organization together with its first Administrator user. */
export interface RegisterOrganizationRequest {
  organizationName: string;
  organizationSlug?: string;
  currency?: string; // ISO 4217, defaults to 'PHP'
  adminEmail: string;
  adminName: string;
  adminPassword: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  /** Optional: pick a membership when the user belongs to multiple organizations. */
  organizationId?: string;
}

export interface AuthTokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: string;
  user: AuthenticatedUser;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
  roleKey: string;
  roleName: string;
  permissions: PermissionCode[];
  /** null = access to all warehouses; otherwise the set of allowed warehouse ids. */
  warehouseScope: string[] | null;
}

export interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  currency: string;
  status: string;
  createdAt: string;
}
