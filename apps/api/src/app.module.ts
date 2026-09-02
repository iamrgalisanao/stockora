import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { RbacModule } from './rbac/rbac.module';
import { AuthModule } from './auth/auth.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { UsersModule } from './users/users.module';
import { UnitsModule } from './catalog/units/units.module';
import { BrandsModule } from './catalog/brands/brands.module';
import { CategoriesModule } from './catalog/categories/categories.module';
import { ProductsModule } from './catalog/products/products.module';
import { BarcodeModule } from './catalog/barcode/barcode.module';
import { InventoryPolicyModule } from './inventory-policy/inventory-policy.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { InventoryModule } from './inventory/inventory.module';
import { ReceivingModule } from './receiving/receiving.module';
import { ReleasesModule } from './releases/releases.module';
import { TransfersModule } from './transfers/transfers.module';
import { AdjustmentsModule } from './adjustments/adjustments.module';
import { CountsModule } from './counts/counts.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ReportsModule } from './reports/reports.module';
import { HealthController } from './health/health.controller';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
      envFilePath: ['.env'],
    }),
    PrismaModule,
    AuditModule,
    RbacModule,
    AuthModule,
    OrganizationsModule,
    UsersModule,
    UnitsModule,
    BrandsModule,
    CategoriesModule,
    ProductsModule,
    BarcodeModule,
    InventoryPolicyModule,
    SuppliersModule,
    WarehousesModule,
    InventoryModule,
    ReceivingModule,
    ReleasesModule,
    TransfersModule,
    AdjustmentsModule,
    CountsModule,
    AnalyticsModule,
    ReportsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Deny-by-default: authenticate first, then authorize. Order matters.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
