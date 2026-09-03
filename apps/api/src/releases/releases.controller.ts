import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { PERMISSIONS, ReleaseListItem, ReleaseResponse } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { ReleasesService } from './releases.service';
import {
  ApproveReleaseDto,
  CreateReleaseDto,
  PostReleaseDto,
  RejectReleaseDto,
  UpdateReleaseDto,
} from './dto/release.dto';

@Controller('releases')
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get()
  list(@CurrentUser() user: RequestUser): Promise<ReleaseListItem[]> {
    return this.releases.list(user.organizationId, user);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<ReleaseResponse> {
    return this.releases.get(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_RELEASE)
  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateReleaseDto): Promise<ReleaseResponse> {
    return this.releases.create(user.organizationId, user, dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_RELEASE)
  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReleaseDto,
  ): Promise<ReleaseResponse> {
    return this.releases.update(user.organizationId, user, id, dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_RELEASE)
  @Post(':id/submit')
  submit(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<ReleaseResponse> {
    return this.releases.submit(user.organizationId, user, id);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_APPROVE)
  @Post(':id/approve')
  approve(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveReleaseDto,
  ): Promise<ReleaseResponse> {
    return this.releases.approve(user.organizationId, user, id, dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_APPROVE)
  @Post(':id/reject')
  reject(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectReleaseDto,
  ): Promise<ReleaseResponse> {
    return this.releases.reject(user.organizationId, user, id, dto);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_RELEASE)
  @Post(':id/post')
  post(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PostReleaseDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<ReleaseResponse> {
    return this.releases.post(user.organizationId, user, id, idempotencyKey, dto?.fefoOverrideReason, dto?.serials);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_RELEASE)
  @Post(':id/cancel')
  cancel(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<ReleaseResponse> {
    return this.releases.cancel(user.organizationId, user, id);
  }
}
