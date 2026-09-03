import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { SERIAL_CAPTURE_MODES, type SerialCaptureMode } from '@iw/contracts';

export class UpsertSerialPolicyDto {
  @IsIn(SERIAL_CAPTURE_MODES as unknown as string[])
  captureMode!: SerialCaptureMode;

  @IsOptional() @IsBoolean() requireLotWhenBatchTracked?: boolean;
}
