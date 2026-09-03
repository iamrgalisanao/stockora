import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { COSTING_STRATEGIES, type CostingStrategy } from '@iw/contracts';

export class CostingPolicyDto {
  @IsIn(COSTING_STRATEGIES as unknown as string[])
  strategy!: CostingStrategy;

  /** Omit for the organization default; set for a per-product override. */
  @IsOptional() @IsUUID() productId?: string;
}
