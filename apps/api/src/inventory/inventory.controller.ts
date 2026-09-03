import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CostLayerStatus, MovementType } from '@prisma/client';
import {
  BalanceResponse,
  type CostLayerConsumptionResponse,
  type CostLayerResponse,
  type CostValuationRow,
  type CostingPolicyResponse,
  type CostingStrategy,
  InventoryPositionRow,
  MovementResponse,
  PERMISSIONS,
  POSITION_FILTERS,
  PositionFilter,
  ReconciliationResult,
  StockCardResponse,
} from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { InventoryPostingService } from './inventory-posting.service';
import { InventoryQueryService } from './inventory-query.service';
import { CostingService } from './costing.service';
import { LotsService } from '../lots/lots.service';
import { OpeningBalanceDto, ReverseMovementDto } from './dto/opening-balance.dto';
import { CostingPolicyDto } from './dto/costing-policy.dto';

@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly posting: InventoryPostingService,
    private readonly query: InventoryQueryService,
    private readonly costing: CostingService,
    private readonly lots: LotsService,
  ) {}

  // ---- FIFO costing (2D.5A, ADR 0013) — cost figures are cost.view-gated ----

  @RequirePermissions(PERMISSIONS.INVENTORY_VIEW)
  @Get('costing-policy')
  costingPolicy(@CurrentUser() user: RequestUser, @Query('productId') productId?: string): Promise<CostingPolicyResponse> {
    return this.costing.getPolicy(user.organizationId, productId);
  }

  @RequirePermissions(PERMISSIONS.SETTINGS_MANAGE)
  @Post('costing-policy')
  setCostingPolicy(@CurrentUser() user: RequestUser, @Body() dto: CostingPolicyDto): Promise<CostingPolicyResponse> {
    return this.costing.upsertPolicy(user.organizationId, dto.strategy as CostingStrategy, dto.productId);
  }

  @RequirePermissions(PERMISSIONS.COST_VIEW)
  @Get('cost-layers')
  costLayers(
    @CurrentUser() user: RequestUser,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: CostLayerStatus,
  ): Promise<CostLayerResponse[]> {
    return this.costing.listLayers(user.organizationId, user, { productId, warehouseId, status });
  }

  @RequirePermissions(PERMISSIONS.VALUATION_VIEW)
  @Get('cost-valuation')
  costValuation(
    @CurrentUser() user: RequestUser,
    @Query('productId') productId?: string,
    @Query('warehouseId') warehouseId?: string,
  ): Promise<CostValuationRow[]> {
    return this.costing.valuation(user.organizationId, user, { productId, warehouseId });
  }

  @RequirePermissions(PERMISSIONS.COST_VIEW)
  @Get('movements/:id/cost-layers')
  movementConsumptions(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<CostLayerConsumptionResponse[]> {
    return this.costing.consumptionsForMovement(user.organizationId, id);
  }

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
  @Get('positions')
  positions(
    @CurrentUser() user: RequestUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
    @Query('q') q?: string,
    @Query('filter') filter?: string,
    @Query('hasStock') hasStock?: string,
  ): Promise<InventoryPositionRow[]> {
    const parsed = filter && (POSITION_FILTERS as readonly string[]).includes(filter) ? (filter as PositionFilter) : undefined;
    return this.query.listPositions(user.organizationId, user, { warehouseId, productId, q, filter: parsed, hasStock: hasStock === 'true' });
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
    // A short-shelf-life override on any line requires the expiry-override permission (ADR 0008).
    if (dto.lines.some((l) => l.allowShortShelfLife) && !user.permissions.includes(PERMISSIONS.INVENTORY_EXPIRY_OVERRIDE)) {
      throw new ForbiddenException('inventory.expiry_override is required to accept a short-dated lot');
    }
    // Resolve lot metadata → lotId per line (ADR 0007) before posting; the posting layer then enforces
    // the batch-tracked ⟺ lot invariant, and lot resolution enforces shelf-life policy (ADR 0008).
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
