/**
 * Cycle-counting contracts (Phase 2C.3, ADR 0009). A planning/scheduling layer over the existing
 * lot-aware Physical Count engine: ABC classification (a planning attribute, never inventory state),
 * org/warehouse policy, coverage read model, and cycle-count tasks that delegate execution to a
 * StockCount(type=CYCLE). OVERDUE is a derived view over dueAt, never a persisted status.
 */

export const ABC_CLASSES = ['A', 'B', 'C', 'UNCLASSIFIED'] as const;
export type ABCClass = (typeof ABC_CLASSES)[number];

export const CLASSIFICATION_STRATEGIES = ['MANUAL', 'MOVEMENT_VELOCITY', 'INVENTORY_VALUE'] as const;
export type ClassificationStrategy = (typeof CLASSIFICATION_STRATEGIES)[number];

/** Persisted task lifecycle. OVERDUE is NOT here — it is derived from `dueAt` at read time. */
export const CYCLE_COUNT_TASK_STATUSES = ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type CycleCountTaskStatus = (typeof CYCLE_COUNT_TASK_STATUSES)[number];

export const CYCLE_COUNT_SOURCES = ['SCHEDULED', 'AD_HOC', 'RECOUNT'] as const;
export type CycleCountSource = (typeof CYCLE_COUNT_SOURCES)[number];

/** Default policy template used when no policy row is configured for a scope. */
export const DEFAULT_CYCLE_COUNT_POLICY = {
  strategy: 'MOVEMENT_VELOCITY' as ClassificationStrategy,
  aFrequencyDays: 30,
  bFrequencyDays: 90,
  cFrequencyDays: 180,
  lookbackDays: 90,
  aPercent: 20,
  bPercent: 30,
} as const;

/** Numeric priority for a class (lower = counted more often / higher priority). */
export const ABC_PRIORITY: Record<ABCClass, number> = { A: 1, B: 2, C: 3, UNCLASSIFIED: 4 };

export interface CycleCountPolicyResponse {
  organizationId: string;
  warehouseId: string | null; // null = org-default policy; a value = warehouse override
  strategy: ClassificationStrategy;
  aFrequencyDays: number;
  bFrequencyDays: number;
  cFrequencyDays: number;
  lookbackDays: number;
  aPercent: number;
  bPercent: number;
  enabled: boolean;
  /** true when backed by a stored row; false when these are the implicit template defaults. */
  configured: boolean;
}

export interface ProductClassificationRow {
  warehouseId: string;
  productId: string;
  productSku: string;
  productName: string;
  variantId: string | null;
  abcClass: ABCClass;
  strategy: ClassificationStrategy;
  score: string | null;
  manual: boolean;
  classifiedAt: string;
}

/** One scope in the coverage read model — derived, not persisted. */
export interface CycleCountCoverageRow {
  warehouseId: string;
  productId: string;
  productSku: string;
  productName: string;
  variantId: string | null;
  lotId: string | null;
  lotNumber: string | null;
  abcClass: ABCClass;
  onHand: string;
  lastCountedAt: string | null;
  nextDueAt: string | null; // null = never counted (due now)
  overdue: boolean;
  hasActiveTask: boolean;
}

export interface CycleCountTaskResponse {
  id: string;
  warehouseId: string;
  warehouseCode: string;
  productId: string;
  productSku: string;
  productName: string;
  variantId: string | null;
  lotId: string | null;
  lotNumber: string | null;
  abcClass: ABCClass;
  priority: number;
  status: CycleCountTaskStatus;
  source: CycleCountSource;
  dueAt: string;
  overdue: boolean; // derived from dueAt vs business date, only while the task is still active
  assignedToId: string | null;
  assignedToName: string | null;
  physicalCountId: string | null;
  supersedesTaskId: string | null;
  completedAt: string | null;
  createdAt: string;
}
