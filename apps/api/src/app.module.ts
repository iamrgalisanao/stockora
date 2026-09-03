import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { RequestContextModule } from './common/request-context.module';
import { RequestContextInterceptor } from './common/request-context';
import { RateLimitGuard } from './common/rate-limit';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { SecurityHeadersMiddleware } from './common/security-headers.middleware';
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
import { SearchModule } from './search/search.module';
import { ImportModule } from './imports/import.module';
import { ExportModule } from './exports/export.module';
import { ReservationsModule } from './reservations/reservations.module';
import { ReturnsModule } from './returns/returns.module';
import { ShelfLifeModule } from './shelf-life/shelf-life.module';
import { CycleCountModule } from './cycle-count/cycle-count.module';
import { OutboxModule } from './outbox/outbox.module';
import { ProjectionsModule } from './projections/projections.module';
import { NotificationsModule } from './notifications/notifications.module';
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
    RequestContextModule,
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
    SearchModule,
    ImportModule,
    ExportModule,
    ReservationsModule,
    ReturnsModule,
    ShelfLifeModule,
    CycleCountModule,
    OutboxModule,
    ProjectionsModule,
    NotificationsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Consistent error shape + structured logging for every failure.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Rate limit before doing any auth work, so unauthenticated floods are cheap to reject.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    // Deny-by-default: authenticate first, then authorize. Order matters.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Runs after the guards, so req.user is available to snapshot into the request context.
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityHeadersMiddleware).forRoutes('*');
  }
}
