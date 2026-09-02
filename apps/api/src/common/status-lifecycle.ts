import { BadRequestException } from '@nestjs/common';
import { EntityStatus } from '@prisma/client';

/**
 * Master-data lifecycle transitions (ADR 0003):
 *   ACTIVE ⇄ INACTIVE,  ACTIVE/INACTIVE → ARCHIVED.
 * ARCHIVED → * is NOT allowed via normal edits (restore is a separate privileged op, not built yet).
 */
const ALLOWED: Record<EntityStatus, EntityStatus[]> = {
  ACTIVE: ['INACTIVE', 'ARCHIVED'],
  INACTIVE: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

export function assertStatusTransition(from: EntityStatus, to: EntityStatus): void {
  if (from === to) return;
  if (!ALLOWED[from].includes(to)) {
    const detail =
      from === 'ARCHIVED'
        ? 'archived records cannot be reactivated'
        : `cannot change status from ${from} to ${to}`;
    throw new BadRequestException(detail);
  }
}

/** Fields to persist on a status change. */
export function statusChangeData(to: EntityStatus, actorId?: string | null) {
  const now = new Date();
  return {
    status: to,
    statusChangedAt: now,
    archivedAt: to === 'ARCHIVED' ? now : null,
    archivedById: to === 'ARCHIVED' ? actorId ?? null : null,
  };
}
