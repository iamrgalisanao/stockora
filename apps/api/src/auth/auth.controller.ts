import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser, AuthTokenResponse } from '@iw/contracts';
import { Public, CurrentUser } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { AuthService } from './auth.service';
import { RegisterOrganizationDto } from './dto/register-organization.dto';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(
    @Body() dto: RegisterOrganizationDto,
    @Req() req: Request,
  ): Promise<AuthTokenResponse> {
    return this.authService.register(dto, req.ip);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request): Promise<AuthTokenResponse> {
    return this.authService.login(dto, req.ip);
  }

  @Get('me')
  async me(@CurrentUser() user: RequestUser): Promise<AuthenticatedUser> {
    const principal = await this.authService.loadPrincipal(user.membershipId);
    return {
      id: principal.userId,
      email: principal.email,
      name: principal.name,
      organizationId: principal.organizationId,
      organizationName: principal.organizationName,
      roleKey: principal.roleKey,
      roleName: principal.roleName,
      permissions: principal.permissions,
      warehouseScope: principal.warehouseScope,
    };
  }
}
