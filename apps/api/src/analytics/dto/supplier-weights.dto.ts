import { IsNumber, Min } from 'class-validator';

/** Org supplier-scoring weights (2D.4B). Relative — need not sum to 1; the scorer renormalizes. */
export class SupplierWeightsDto {
  @IsNumber() @Min(0) fillRate!: number;
  @IsNumber() @Min(0) onTime!: number;
  @IsNumber() @Min(0) leadTime!: number;
  @IsNumber() @Min(0) price!: number;
  @IsNumber() @Min(0) quality!: number;
}
