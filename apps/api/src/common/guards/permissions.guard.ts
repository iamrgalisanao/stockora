import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermissionCode } from '@iw/contracts';
import { IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators';
import type { RequestUser } from '../request-user';

/**
 * Authorization guard. Runs after JwtAuthGuard and checks that the authenticated
 * principal holds every permission code declared via @RequirePermissions().
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<PermissionCode[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as
      | RequestUser
      | undefined;
    if (!user) throw new ForbiddenException('Not authenticated');

    const held = new Set(user.permissions);
    const missing = required.filter((code) => !held.has(code));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing required permission(s): ${missing.join(', ')}`,
      );
    }
    return true;
  }
}
