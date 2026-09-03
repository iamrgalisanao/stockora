import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import {
  ABC_CLASSES,
  CLASSIFICATION_STRATEGIES,
  CYCLE_COUNT_TASK_STATUSES,
  type ABCClass,
  type ClassificationStrategy,
  type CycleCountTaskStatus,
} from '@iw/contracts';

// A/B/C classes are assignable by hand; UNCLASSIFIED is a system state, not a manual target.
const MANUAL_ABC_CLASSES = ABC_CLASSES.filter((c) => c !== 'UNCLASSIFIED');

export class UpsertCycleCountPolicyDto {
  // Omit warehouseId (or send null) to write the org-default policy; a warehouse id writes an override.
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsIn(CLASSIFICATION_STRATEGIES) strategy?: ClassificationStrategy;
  @IsOptional() @IsInt() @Min(1) @Max(3650) aFrequencyDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(3650) bFrequencyDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(3650) cFrequencyDays?: number;
  @IsOptional() @IsInt() @Min(1) @Max(3650) lookbackDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) aPercent?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) bPercent?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class ClassifyDto {
  @IsUUID() warehouseId!: string;
  // Optional override; defaults to the resolved policy's strategy. MANUAL is not a runnable computation.
  @IsOptional() @IsIn(CLASSIFICATION_STRATEGIES) strategy?: ClassificationStrategy;
}

export class SetClassificationDto {
  @IsUUID() warehouseId!: string;
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() variantId?: string;
  @IsIn(MANUAL_ABC_CLASSES) abcClass!: Exclude<ABCClass, 'UNCLASSIFIED'>;
}

export class GenerateTasksDto {
  @IsUUID() warehouseId!: string;
}

export class CreateAdHocTaskDto {
  @IsUUID() warehouseId!: string;
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() variantId?: string;
  // For batch-tracked products a lot may be named to scope the task to a single lot.
  @IsOptional() @IsUUID() lotId?: string;
}

export class AssignTaskDto {
  @IsUUID() assignedToId!: string;
}

export class TaskQueryDto {
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsIn(CYCLE_COUNT_TASK_STATUSES) status?: CycleCountTaskStatus;
  @IsOptional() @IsBoolean() overdue?: boolean;
}
