import { ForbiddenException } from '@nestjs/common';
import type { RequestUser } from './request-user';

/**
 * Warehouse-scoped access (Phase 0 §2, §11). A membership may restrict a user to a
 * subset of warehouses. `warehouseScope === null` means unrestricted (all warehouses).
 *
 * This is the plumbing: operational modules (receiving, transfers, releases, counts)
 * will call `assertWarehouseAllowed` once warehouses exist (Roadmap step 06). Until then
 * scopes are stored on the membership and surfaced in the principal.
 */
export function isWarehouseAllowed(
  user: Pick<RequestUser, 'warehouseScope'>,
  warehouseId: string,
): boolean {
  if (user.warehouseScope === null) return true;
  return user.warehouseScope.includes(warehouseId);
}

export function assertWarehouseAllowed(
  user: Pick<RequestUser, 'warehouseScope'>,
  warehouseId: string,
): void {
  if (!isWarehouseAllowed(user, warehouseId)) {
    throw new ForbiddenException('You do not have access to this warehouse');
  }
}

/** Filters a list of warehouse ids down to those the user may access. */
export function filterAllowedWarehouses(
  user: Pick<RequestUser, 'warehouseScope'>,
  warehouseIds: string[],
): string[] {
  if (user.warehouseScope === null) return warehouseIds;
  const allowed = new Set(user.warehouseScope);
  return warehouseIds.filter((id) => allowed.has(id));
}
