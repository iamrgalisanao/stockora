import { Injectable } from '@nestjs/common';
import {
  PERMISSION_DEFINITIONS,
  SYSTEM_ROLE_DEFINITIONS,
} from '@iw/contracts';
import type { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** A Prisma client or an interactive-transaction client — both expose the same model API. */
type Db = PrismaService | Prisma.TransactionClient;

@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Upserts the global permission catalog. Idempotent — safe to call on every
   * org registration and from the seed script.
   */
  async ensurePermissionCatalog(db: Db = this.prisma): Promise<void> {
    for (const def of PERMISSION_DEFINITIONS) {
      await db.permission.upsert({
        where: { code: def.code },
        update: { description: def.description },
        create: { code: def.code, description: def.description },
      });
    }
  }

  /**
   * Seeds the 9 system roles for a freshly created organization and links each
   * role to its default permission bundle. Returns a map of roleKey -> roleId.
   */
  async seedSystemRolesForOrg(
    organizationId: string,
    db: Db = this.prisma,
  ): Promise<Record<string, string>> {
    await this.ensurePermissionCatalog(db);

    const permissions = await db.permission.findMany();
    const permissionIdByCode = new Map(permissions.map((p) => [p.code, p.id]));

    const roleIdByKey: Record<string, string> = {};

    for (const def of SYSTEM_ROLE_DEFINITIONS) {
      const role = await db.role.create({
        data: {
          organizationId,
          key: def.key,
          name: def.name,
          description: def.description,
          isSystem: true,
        },
      });
      roleIdByKey[def.key] = role.id;

      const links = def.permissions
        .map((code) => permissionIdByCode.get(code))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId }));

      if (links.length > 0) {
        await db.rolePermission.createMany({ data: links, skipDuplicates: true });
      }
    }

    return roleIdByKey;
  }
}

// Re-export for convenience where a plain client type is needed.
export type { PrismaClient };
