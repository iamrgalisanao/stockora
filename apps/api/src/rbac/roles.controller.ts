import { Controller, Get } from '@nestjs/common';
import { PERMISSIONS, RoleResponse } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { RbacService } from './rbac.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly rbac: RbacService) {}

  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  @Get()
  list(@CurrentUser() user: RequestUser): Promise<RoleResponse[]> {
    return this.rbac.listRoles(user.organizationId);
  }
}
