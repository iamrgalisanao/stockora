import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import {
  AuthenticatedUser,
  AuthTokenResponse,
  DEFAULT_ADJUSTMENT_REASONS,
  PermissionCode,
  SYSTEM_ROLES,
} from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { AuditService } from '../audit/audit.service';
import type { JwtPayload, RequestUser } from '../common/request-user';
import { RegisterOrganizationDto } from './dto/register-organization.dto';
import { LoginDto } from './dto/login.dto';

const BCRYPT_ROUNDS = 12;

/** Fully-resolved principal loaded from a membership; source for both DTO shapes. */
interface Principal {
  userId: string;
  email: string;
  name: string;
  membershipId: string;
  organizationId: string;
  organizationName: string;
  roleKey: string;
  roleName: string;
  permissions: PermissionCode[];
  warehouseScope: string[] | null;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // -------------------------------------------------------------------------
  // Registration: create an organization + its first Administrator, atomically.
  // -------------------------------------------------------------------------
  async register(dto: RegisterOrganizationDto, ip?: string): Promise<AuthTokenResponse> {
    const email = dto.adminEmail.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('A user with this email already exists');
    }

    const slug = await this.resolveUniqueSlug(dto.organizationSlug ?? dto.organizationName);
    const passwordHash = await bcrypt.hash(dto.adminPassword, BCRYPT_ROUNDS);

    const membershipId = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: dto.organizationName.trim(),
          slug,
          currency: dto.currency ?? 'PHP',
        },
      });

      const roleIdByKey = await this.rbac.seedSystemRolesForOrg(org.id, tx);
      const adminRoleId = roleIdByKey[SYSTEM_ROLES.ADMINISTRATOR];
      if (!adminRoleId) {
        throw new Error('Administrator role was not seeded');
      }

      const user = await tx.user.create({
        data: { email, passwordHash, name: dto.adminName.trim() },
      });

      const membership = await tx.membership.create({
        data: {
          organizationId: org.id,
          userId: user.id,
          roleId: adminRoleId,
          warehouseScope: [], // empty = access to all warehouses
        },
      });

      // Seed default (editable) adjustment reasons for the new organization.
      await tx.adjustmentReason.createMany({
        data: DEFAULT_ADJUSTMENT_REASONS.map((r) => ({ organizationId: org.id, code: r.code, name: r.name })),
      });

      return membership.id;
    });

    const principal = await this.loadPrincipal(membershipId);
    await this.audit.record({
      organizationId: principal.organizationId,
      userId: principal.userId,
      action: 'organization.registered',
      entityType: 'organization',
      entityId: principal.organizationId,
      newValue: { name: principal.organizationName, slug },
      ipAddress: ip,
    });

    return this.buildTokenResponse(principal);
  }

  // -------------------------------------------------------------------------
  // Login
  // -------------------------------------------------------------------------
  async login(dto: LoginDto, ip?: string): Promise<AuthTokenResponse> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { where: { status: 'ACTIVE' } } },
    });

    // Constant-ish work regardless of user existence to reduce enumeration signal.
    const passwordOk = user
      ? await bcrypt.compare(dto.password, user.passwordHash)
      : await bcrypt.compare(dto.password, '$2a$12$0000000000000000000000000000000000000000000000000000');

    if (!user || user.status !== 'ACTIVE' || !passwordOk) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const memberships = user.memberships;
    if (memberships.length === 0) {
      throw new UnauthorizedException('This account has no active organization access');
    }

    let membership = memberships[0]!;
    if (dto.organizationId) {
      const match = memberships.find((m) => m.organizationId === dto.organizationId);
      if (!match) {
        throw new UnauthorizedException('No access to the requested organization');
      }
      membership = match;
    } else if (memberships.length > 1) {
      throw new BadRequestException(
        'Multiple organizations found for this account — specify organizationId',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const principal = await this.loadPrincipal(membership.id);
    await this.audit.record({
      organizationId: principal.organizationId,
      userId: principal.userId,
      action: 'auth.login',
      entityType: 'user',
      entityId: principal.userId,
      ipAddress: ip,
    });

    return this.buildTokenResponse(principal);
  }

  // -------------------------------------------------------------------------
  // Used by JwtStrategy on every request, and to build /me responses.
  // -------------------------------------------------------------------------
  async loadPrincipal(membershipId: string): Promise<Principal> {
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
      include: {
        organization: true,
        user: true,
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });

    if (
      !membership ||
      membership.status !== 'ACTIVE' ||
      membership.user.status !== 'ACTIVE' ||
      membership.organization.status !== 'ACTIVE'
    ) {
      throw new UnauthorizedException('Access has been revoked');
    }

    const permissions = membership.role.permissions.map(
      (rp) => rp.permission.code as PermissionCode,
    );

    return {
      userId: membership.userId,
      email: membership.user.email,
      name: membership.user.name,
      membershipId: membership.id,
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      roleKey: membership.role.key,
      roleName: membership.role.name,
      permissions,
      warehouseScope:
        membership.warehouseScope.length === 0 ? null : membership.warehouseScope,
    };
  }

  toRequestUser(p: Principal): RequestUser {
    return {
      userId: p.userId,
      email: p.email,
      name: p.name,
      membershipId: p.membershipId,
      organizationId: p.organizationId,
      roleKey: p.roleKey,
      roleName: p.roleName,
      permissions: p.permissions,
      warehouseScope: p.warehouseScope,
    };
  }

  private toAuthenticatedUser(p: Principal): AuthenticatedUser {
    return {
      id: p.userId,
      email: p.email,
      name: p.name,
      organizationId: p.organizationId,
      organizationName: p.organizationName,
      roleKey: p.roleKey,
      roleName: p.roleName,
      permissions: p.permissions,
      warehouseScope: p.warehouseScope,
    };
  }

  private async buildTokenResponse(p: Principal): Promise<AuthTokenResponse> {
    const payload: JwtPayload = {
      sub: p.userId,
      email: p.email,
      mid: p.membershipId,
      org: p.organizationId,
    };
    const accessToken = await this.jwt.signAsync(payload);
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.get<string>('JWT_EXPIRES_IN', '1d'),
      user: this.toAuthenticatedUser(p),
    };
  }

  private async resolveUniqueSlug(source: string): Promise<string> {
    const base =
      source
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'org';

    let candidate = base;
    let suffix = 1;
    // Bounded loop; collisions are rare.
    while (await this.prisma.organization.findUnique({ where: { slug: candidate } })) {
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
    return candidate;
  }
}
