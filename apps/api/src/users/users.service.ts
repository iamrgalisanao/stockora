import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { SYSTEM_ROLES } from '@iw/contracts';
import type { MembershipUserResponse } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestUser } from '../common/request-user';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const BCRYPT_ROUNDS = 12;

type MembershipWithRelations = {
  id: string;
  status: 'ACTIVE' | 'DISABLED';
  warehouseScope: string[];
  createdAt: Date;
  user: { id: string; email: string; name: string; lastLoginAt: Date | null };
  role: { key: string; name: string };
};

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listMembers(organizationId: string): Promise<MembershipUserResponse[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId },
      include: { user: true, role: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => this.toResponse(m));
  }

  async getMember(organizationId: string, userId: string): Promise<MembershipUserResponse> {
    const membership = await this.findMembership(organizationId, userId);
    return this.toResponse(membership);
  }

  async createMember(
    organizationId: string,
    dto: CreateUserDto,
    actor: RequestUser,
  ): Promise<MembershipUserResponse> {
    const email = dto.email.toLowerCase().trim();
    const role = await this.resolveRole(organizationId, dto.roleKey);
    const scope = dto.warehouseScope ?? [];

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      include: { memberships: { where: { organizationId } } },
    });

    if (existingUser && existingUser.memberships.length > 0) {
      throw new ConflictException('This user is already a member of the organization');
    }

    const membershipId = await this.prisma.$transaction(async (tx) => {
      let userId: string;
      if (existingUser) {
        userId = existingUser.id;
      } else {
        if (!dto.password) {
          throw new BadRequestException('password is required for a new user');
        }
        const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
        const created = await tx.user.create({
          data: { email, name: dto.name.trim(), passwordHash },
        });
        userId = created.id;
      }

      const membership = await tx.membership.create({
        data: { organizationId, userId, roleId: role.id, warehouseScope: scope },
      });
      return membership.id;
    });

    await this.audit.record({
      organizationId,
      userId: actor.userId,
      action: 'user.created',
      entityType: 'membership',
      entityId: membershipId,
      newValue: { email, roleKey: role.key, warehouseScope: scope },
    });

    const membership = await this.findMembershipById(membershipId);
    return this.toResponse(membership);
  }

  async updateMember(
    organizationId: string,
    userId: string,
    dto: UpdateUserDto,
    actor: RequestUser,
  ): Promise<MembershipUserResponse> {
    const membership = await this.findMembership(organizationId, userId);

    const willDisable = dto.status === 'DISABLED' && membership.status !== 'DISABLED';
    const willLeaveAdmin =
      dto.roleKey !== undefined &&
      membership.role.key === SYSTEM_ROLES.ADMINISTRATOR &&
      dto.roleKey !== SYSTEM_ROLES.ADMINISTRATOR;

    if ((willDisable || willLeaveAdmin) && membership.role.key === SYSTEM_ROLES.ADMINISTRATOR) {
      await this.assertNotLastAdmin(organizationId, membership.id);
    }
    if (willDisable && userId === actor.userId) {
      throw new ForbiddenException('You cannot disable your own account');
    }

    const roleId =
      dto.roleKey !== undefined
        ? (await this.resolveRole(organizationId, dto.roleKey)).id
        : undefined;

    await this.prisma.$transaction(async (tx) => {
      if (dto.name !== undefined) {
        await tx.user.update({ where: { id: userId }, data: { name: dto.name.trim() } });
      }
      await tx.membership.update({
        where: { id: membership.id },
        data: {
          ...(roleId ? { roleId } : {}),
          ...(dto.warehouseScope !== undefined
            ? { warehouseScope: dto.warehouseScope ?? [] }
            : {}),
          ...(dto.status ? { status: dto.status } : {}),
        },
      });
    });

    await this.audit.record({
      organizationId,
      userId: actor.userId,
      action: 'user.updated',
      entityType: 'membership',
      entityId: membership.id,
      oldValue: {
        roleKey: membership.role.key,
        status: membership.status,
        warehouseScope: membership.warehouseScope,
      },
      newValue: {
        roleKey: dto.roleKey ?? membership.role.key,
        status: dto.status ?? membership.status,
        warehouseScope:
          dto.warehouseScope === undefined
            ? membership.warehouseScope
            : dto.warehouseScope ?? [],
      },
    });

    const updated = await this.findMembershipById(membership.id);
    return this.toResponse(updated);
  }

  // ---- helpers ----

  private async resolveRole(organizationId: string, roleKey: string) {
    const role = await this.prisma.role.findUnique({
      where: { organizationId_key: { organizationId, key: roleKey } },
    });
    if (!role) throw new NotFoundException(`Role "${roleKey}" not found in this organization`);
    return role;
  }

  private async assertNotLastAdmin(organizationId: string, excludeMembershipId: string): Promise<void> {
    const otherAdmins = await this.prisma.membership.count({
      where: {
        organizationId,
        status: 'ACTIVE',
        id: { not: excludeMembershipId },
        role: { key: SYSTEM_ROLES.ADMINISTRATOR },
      },
    });
    if (otherAdmins === 0) {
      throw new BadRequestException(
        'Cannot remove the last active Administrator of the organization',
      );
    }
  }

  private async findMembership(
    organizationId: string,
    userId: string,
  ): Promise<MembershipWithRelations> {
    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: { user: true, role: true },
    });
    if (!membership) throw new NotFoundException('User is not a member of this organization');
    return membership as MembershipWithRelations;
  }

  private async findMembershipById(id: string): Promise<MembershipWithRelations> {
    const membership = await this.prisma.membership.findUnique({
      where: { id },
      include: { user: true, role: true },
    });
    if (!membership) throw new NotFoundException('Membership not found');
    return membership as MembershipWithRelations;
  }

  private toResponse(m: MembershipWithRelations): MembershipUserResponse {
    return {
      userId: m.user.id,
      membershipId: m.id,
      email: m.user.email,
      name: m.user.name,
      roleKey: m.role.key,
      roleName: m.role.name,
      status: m.status,
      warehouseScope: m.warehouseScope.length === 0 ? null : m.warehouseScope,
      lastLoginAt: m.user.lastLoginAt ? m.user.lastLoginAt.toISOString() : null,
      createdAt: m.createdAt.toISOString(),
    };
  }
}
