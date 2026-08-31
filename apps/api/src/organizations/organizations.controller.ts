import { Body, Controller, Get, Patch } from '@nestjs/common';
import { OrganizationResponse, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { OrganizationsService } from './organizations.service';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  /** Returns the caller's own organization (tenant-scoped by the JWT). */
  @Get('current')
  getCurrent(@CurrentUser() user: RequestUser): Promise<OrganizationResponse> {
    return this.organizations.getById(user.organizationId);
  }

  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @Patch('current')
  update(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateOrganizationDto,
  ): Promise<OrganizationResponse> {
    return this.organizations.update(user.organizationId, dto);
  }
}
