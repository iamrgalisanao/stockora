import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CountListItem, CountResponse, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { CountsService } from './counts.service';
import { CreateCountDto, EnterCountsDto } from './dto/count.dto';

@Controller('counts')
export class CountsController {
  constructor(private readonly counts: CountsService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get()
  list(@CurrentUser() user: RequestUser): Promise<CountListItem[]> {
    return this.counts.list(user.organizationId, user);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<CountResponse> {
    return this.counts.get(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_COUNT)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateCountDto): Promise<CountResponse> {
    return this.counts.create(user.organizationId, user, dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_COUNT)
  @Post(':id/entries')
  enter(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnterCountsDto,
  ): Promise<CountResponse> {
    return this.counts.enterCounts(user.organizationId, user, id, dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_COUNT)
  @Post(':id/submit')
  submit(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<CountResponse> {
    return this.counts.submit(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_APPROVE)
  @Post(':id/approve')
  approve(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<CountResponse> {
    return this.counts.approve(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_COUNT)
  @Post(':id/post')
  post(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<CountResponse> {
    return this.counts.post(user.organizationId, user, id, idempotencyKey);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_COUNT)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<CountResponse> {
    return this.counts.cancel(user.organizationId, user, id);
  }
}
