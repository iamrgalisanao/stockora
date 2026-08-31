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

async function ensureUnit(
  organizationId: string,
  code: string,
  name: string,
  precision: number,
): Promise<string> {
  const existing = await prisma.unitOfMeasure.findUnique({
    where: { organizationId_code: { organizationId, code } },
  });
  if (existing) return existing.id;
  const u = await prisma.unitOfMeasure.create({
    data: { organizationId, code, name, precision },
  });
  return u.id;
}

async function ensureConversion(
  organizationId: string,
  fromUomId: string,
  toUomId: string,
  factor: number,
): Promise<void> {
  const existing = await prisma.unitConversion.findUnique({
    where: { organizationId_fromUomId_toUomId: { organizationId, fromUomId, toUomId } },
  });
  if (!existing) {
    await prisma.unitConversion.create({ data: { organizationId, fromUomId, toUomId, factor } });
  }
}

async function seedDemoCatalog(): Promise<void> {
  const org = await prisma.organization.findUnique({ where: { slug: 'demo-trading' } });
  if (!org) return;

  const pcs = await ensureUnit(org.id, 'PCS', 'Piece', 0);
  const box = await ensureUnit(org.id, 'BOX', 'Box', 0);
  const cas = await ensureUnit(org.id, 'CASE', 'Case', 0);
  await ensureUnit(org.id, 'KG', 'Kilogram', 3);
  await ensureConversion(org.id, box, pcs, 24); // 1 BOX = 24 PCS
  await ensureConversion(org.id, cas, box, 12); // 1 CASE = 12 BOX

  let category = await prisma.productCategory.findFirst({
    where: { organizationId: org.id, name: 'Storage', parentId: null },
  });
  if (!category) {
    category = await prisma.productCategory.create({
      data: { organizationId: org.id, name: 'Storage' },
    });
  }

  const brand =
    (await prisma.brand.findUnique({
      where: { organizationId_name: { organizationId: org.id, name: 'Samsung' } },
    })) ??
    (await prisma.brand.create({ data: { organizationId: org.id, name: 'Samsung' } }));

  const existingProduct = await prisma.product.findUnique({
    where: { organizationId_sku: { organizationId: org.id, sku: 'SSD-SAM-1TB-001' } },
  });
  if (!existingProduct) {
    await prisma.product.create({
      data: {
        organizationId: org.id,
        sku: 'SSD-SAM-1TB-001',
        name: 'Samsung 1TB SSD',
        categoryId: category.id,
        brandId: brand.id,
        baseUomId: pcs,
        purchaseUomId: box,
        salesUomId: pcs,
        cost: 2950,
        sellingPrice: 3600,
        minStock: 10,
        reorderPoint: 15,
        reorderQty: 30,
        leadTimeDays: 7,
      },
    });
    console.log('  product:  SSD-SAM-1TB-001 (Samsung 1TB SSD)');
  }

  // Supplier + link
  const product = await prisma.product.findUnique({
    where: { organizationId_sku: { organizationId: org.id, sku: 'SSD-SAM-1TB-001' } },
  });
  const supplier =
    (await prisma.supplier.findUnique({
      where: { organizationId_code: { organizationId: org.id, code: 'SUP-ACME' } },
    })) ??
    (await prisma.supplier.create({
      data: { organizationId: org.id, code: 'SUP-ACME', companyName: 'ACME Distribution', leadTimeDays: 7 },
    }));
  if (product) {
    const link = await prisma.supplierProduct.findUnique({
      where: {
        organizationId_supplierId_productId: {
          organizationId: org.id,
          supplierId: supplier.id,
          productId: product.id,
        },
      },
    });
    if (!link) {
      await prisma.supplierProduct.create({
        data: {
          organizationId: org.id,
          supplierId: supplier.id,
          productId: product.id,
          cost: 2950,
          leadTimeDays: 7,
          isPreferred: true,
        },
      });
    }
  }

  // Default warehouse
  const existingWh = await prisma.warehouse.findUnique({
    where: { organizationId_code: { organizationId: org.id, code: 'MAIN' } },
  });
  if (!existingWh) {
    await prisma.warehouse.create({
      data: { organizationId: org.id, code: 'MAIN', name: 'Main Warehouse', type: 'MAIN', isDefault: true },
    });
  }

  console.log('Demo data ensured (units, conversions, category, brand, product, supplier, warehouse).');
  console.log('  Tip: post stock via POST /api/inventory/opening-balances.');
}

async function main(): Promise<void> {
  const permissionIdByCode = await ensurePermissionCatalog();
  console.log(`Permission catalog ensured (${permissionIdByCode.size} permissions).`);
  await seedDemoOrg(permissionIdByCode);
  await seedDemoCatalog();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
