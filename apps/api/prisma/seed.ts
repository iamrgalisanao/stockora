/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  PERMISSION_DEFINITIONS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_DEFINITIONS,
} from '@iw/contracts';

const prisma = new PrismaClient();

async function ensurePermissionCatalog(): Promise<Map<string, string>> {
  for (const def of PERMISSION_DEFINITIONS) {
    await prisma.permission.upsert({
      where: { code: def.code },
      update: { description: def.description },
      create: { code: def.code, description: def.description },
    });
  }
  const all = await prisma.permission.findMany();
  return new Map(all.map((p) => [p.code, p.id]));
}

async function seedDemoOrg(permissionIdByCode: Map<string, string>): Promise<void> {
  const slug = 'demo-trading';
  const existing = await prisma.organization.findUnique({ where: { slug } });
  if (existing) {
    console.log(`Demo organization "${slug}" already exists — skipping.`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: 'Demo Trading Inc.', slug, currency: 'PHP' },
    });

    const roleIdByKey: Record<string, string> = {};
    for (const def of SYSTEM_ROLE_DEFINITIONS) {
      const role = await tx.role.create({
        data: {
          organizationId: org.id,
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
        await tx.rolePermission.createMany({ data: links, skipDuplicates: true });
      }
    }

    const passwordHash = await bcrypt.hash('password123', 12);
    const user = await tx.user.create({
      data: { email: 'admin@demo.test', passwordHash, name: 'Demo Admin' },
    });

    await tx.membership.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        roleId: roleIdByKey[SYSTEM_ROLES.ADMINISTRATOR]!,
        warehouseScope: [],
      },
    });
  });

  console.log('Seeded demo organization:');
  console.log('  org:      Demo Trading Inc. (demo-trading)');
  console.log('  login:    admin@demo.test / password123');
}

async function main(): Promise<void> {
  const permissionIdByCode = await ensurePermissionCatalog();
  console.log(`Permission catalog ensured (${permissionIdByCode.size} permissions).`);
  await seedDemoOrg(permissionIdByCode);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
