import { IsNumber, IsPositive, IsUUID } from 'class-validator';

export class CreateUnitConversionDto {
  @IsUUID()
  fromUomId!: string;

  @IsUUID()
  toUomId!: string;

  // 1 fromUom = <factor> toUom
  @IsNumber({ maxDecimalPlaces: 6 })
  @IsPositive()
  factor!: number;
}
