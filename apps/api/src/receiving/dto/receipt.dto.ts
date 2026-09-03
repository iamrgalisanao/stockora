import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const qty = { maxDecimalPlaces: 4 } as const;

export class ReceiptItemInputDto {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() variantId?: string;
  @IsOptional() @IsNumber(qty) @Min(0) expectedQty?: number;
  @IsOptional() @IsNumber(qty) @Min(0) receivedQty?: number;
  @IsOptional() @IsNumber(qty) @Min(0) rejectedQty?: number;
  @IsOptional() @IsNumber(qty) @Min(0) unitCost?: number;
  @IsOptional() @IsString() @MaxLength(60) batchNumber?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsString() @MaxLength(500) remarks?: string;

  /**
   * Per-unit serial numbers for a serialized product captured at receipt (ADR 0012 §6). In RECEIPT mode
   * the count must match the received quantity; validated and written atomically when the receipt posts.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10000)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  serialNumbers?: string[];
}

export class CreateReceiptDto {
  @IsOptional() @IsUUID() supplierId?: string;
  @IsUUID() warehouseId!: string;
  @IsOptional() @IsString() @MaxLength(60) purchaseOrderRef?: string;
  @IsOptional() @IsString() @MaxLength(60) deliveryReceiptRef?: string;
  @IsOptional() @IsString() @MaxLength(60) supplierInvoiceRef?: string;
  @IsOptional() @IsDateString() receivingDate?: string;
  /** Supplier-analytics capture (2D.4) — optional; enables lead-time and on-time metrics where recorded. */
  @IsOptional() @IsDateString() orderDate?: string;
  @IsOptional() @IsDateString() expectedDeliveryDate?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemInputDto)
  items!: ReceiptItemInputDto[];
}

export class UpdateReceiptDto {
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsString() @MaxLength(60) purchaseOrderRef?: string;
  @IsOptional() @IsString() @MaxLength(60) deliveryReceiptRef?: string;
  @IsOptional() @IsString() @MaxLength(60) supplierInvoiceRef?: string;
  @IsOptional() @IsDateString() receivingDate?: string;
  @IsOptional() @IsDateString() orderDate?: string;
  @IsOptional() @IsDateString() expectedDeliveryDate?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemInputDto)
  items?: ReceiptItemInputDto[];
}
