import { IsIn } from 'class-validator';
import { ENTITY_STATUSES, type EntityStatus } from '@iw/contracts';

export class ChangeStatusDto {
  @IsIn(ENTITY_STATUSES)
  status!: EntityStatus;
}
