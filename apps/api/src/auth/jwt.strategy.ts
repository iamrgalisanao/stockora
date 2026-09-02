import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtPayload, RequestUser } from '../common/request-user';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
    private readonly sessions: SessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /** Passport calls this with the verified payload; the return value becomes req.user. */
  async validate(payload: JwtPayload): Promise<RequestUser> {
    // A revoked/expired session invalidates its access tokens immediately (logout, logout-all).
    if (!payload.sid || !(await this.sessions.isActive(payload.sid))) {
      throw new UnauthorizedException('Session is no longer active');
    }
    const principal = await this.authService.loadPrincipal(payload.mid);
    return this.authService.toRequestUser(principal, payload.sid);
  }
}
