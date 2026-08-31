import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { MembershipUserResponse, PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@RequirePermissions(PERMISSIONS.USER_MANAGE)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: RequestUser): Promise<MembershipUserResponse[]> {
    return this.users.listMembers(user.organizationId);
  }

  @Get(':userId')
  get(
    @CurrentUser() user: RequestUser,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<MembershipUserResponse> {
    return this.users.getMember(user.organizationId, userId);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateUserDto,
  ): Promise<MembershipUserResponse> {
    return this.users.createMember(user.organizationId, dto, user);
  }

  @Patch(':userId')
  update(
    @CurrentUser() user: RequestUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateUserDto,
  ): Promise<MembershipUserResponse> {
    return this.users.updateMember(user.organizationId, userId, dto, user);
  }
}
