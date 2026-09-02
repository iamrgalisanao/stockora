import { BadRequestException, Controller, Get, Header, Param } from '@nestjs/common';
import { PERMISSIONS } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { ExportService } from './export.service';
import { RateLimit } from '../common/rate-limit';

const TEMPLATE_TYPES = ['products', 'suppliers', 'opening-inventory'];

@RateLimit('sensitive')
@Controller('exports')
export class ExportController {
  constructor(private readonly exports: ExportService) {}

  @RequirePermissions(PERMISSIONS.EXPORT_CATALOG)
  @Get('products')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="products.csv"')
  products(@CurrentUser() user: RequestUser): Promise<string> {
    return this.exports.products(user.organizationId, user);
  }

  @RequirePermissions(PERMISSIONS.EXPORT_CATALOG)
  @Get('suppliers')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="suppliers.csv"')
  suppliers(@CurrentUser() user: RequestUser): Promise<string> {
    return this.exports.suppliers(user.organizationId, user);
  }

  @RequirePermissions(PERMISSIONS.EXPORT_INVENTORY)
  @Get('stock-balances')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="stock-balances.csv"')
  stockBalances(@CurrentUser() user: RequestUser): Promise<string> {
    return this.exports.stockBalances(user.organizationId, user);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get('templates/:type')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  template(@Param('type') type: string): string {
    if (!TEMPLATE_TYPES.includes(type)) throw new BadRequestException(`Unknown template "${type}"`);
    return this.exports.template(type);
  }
}
