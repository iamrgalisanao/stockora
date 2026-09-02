import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { MovementType } from '@prisma/client';
import {
  BalanceResponse,
  MovementResponse,
  PERMISSIONS,
  ReconciliationResult,
  StockCardResponse,
} from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { InventoryPostingService } from './inventory-posting.service';
import { InventoryQueryService } from './inventory-query.service';
import { LotsService } from '../lots/lots.service';
import { OpeningBalanceDto, ReverseMovementDto } from './dto/opening-balance.dto';

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly posting: InventoryPostingService,
    private readonly query: InventoryQueryService,
    private readonly lots: LotsService,
  ) {}

  // ---- queries ----

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get('balances')
  balances(
    @CurrentUser() user: RequestUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
  ): Promise<BalanceResponse[]> {
    return this.query.listBalances(user.organizationId, user, { warehouseId, productId });
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get('movements')
  movements(
    @CurrentUser() user: RequestUser,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('type') type?: MovementType,
    @Query('lotId') lotId?: string,
    @Query('limit') limit?: string,
  ): Promise<MovementResponse[]> {
    return this.query.listMovements(user.organizationId, user, {
      productId,
      warehouseId,
      type,
      lotId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get('products/:productId/stock-card')
  stockCard(
    @CurrentUser() user: RequestUser,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query('warehouseId') warehouseId?: string,
  ): Promise<StockCardResponse> {
    return this.query.stockCard(user.organizationId, user, productId, { warehouseId });
  }

  // ---- commands ----

  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @Post('opening-balances')
  async openingBalance(
    @CurrentUser() user: RequestUser,
    @Body() dto: OpeningBalanceDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<MovementResponse[]> {
    // Resolve lot metadata → lotId per line (ADR 0007) before posting; the posting layer then enforces
    // the batch-tracked ⟺ lot invariant.
    const lines = await this.lots.resolveEntryLines(user.organizationId, user.userId, dto.lines, 'OPENING');
    const movements = await this.posting.openingBalance(
      { organizationId: user.organizationId, actorId: user.userId, idempotencyKey, reason: dto.reason },
      { warehouseId: dto.warehouseId, lines },
    );
    return this.query.getMovements(user.organizationId, user, movements.map((m) => m.id));
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_ADJUST)
  @Post('movements/:id/reverse')
  async reverse(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReverseMovementDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<MovementResponse[]> {
    const movement = await this.posting.reverseMovement(
      { organizationId: user.organizationId, actorId: user.userId, idempotencyKey },
      id,
      dto.reason,
    );
    return this.query.getMovements(user.organizationId, user, [movement.id]);
  }

  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @Post('reconcile')
  reconcile(@CurrentUser() user: RequestUser): Promise<ReconciliationResult> {
    return this.query.reconcile(user.organizationId);
  }
}
