import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ABCClass, ClassificationStrategy, CycleCountTaskStatus } from '@prisma/client';
import {
  ABC_PRIORITY,
  DEFAULT_CYCLE_COUNT_POLICY,
  type CycleCountCoverageRow,
  type CycleCountPolicyResponse,
  type CycleCountTaskResponse,
  type ProductClassificationRow,
} from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import type { RequestUser } from '../common/request-user';
import { NIL_UUID } from '../inventory/inventory.constants';
import { businessToday, toBusinessDate } from '../common/business-date';
import {
  AssignTaskDto,
  ClassifyDto,
  CreateAdHocTaskDto,
  GenerateTasksDto,
  SetClassificationDto,
  TaskQueryDto,
  UpsertCycleCountPolicyDto,
} from './dto/cycle-count.dto';

const ACTIVE_TASK_STATUSES: CycleCountTaskStatus[] = ['PENDING', 'ASSIGNED', 'IN_PROGRESS'];
const DAY_MS = 86_400_000;
const scopeKey = (productId: string, variantId: string, lotId: string) => `${productId}:${variantId}:${lotId}`;

interface EffectivePolicy {
  strategy: ClassificationStrategy;
  aFrequencyDays: number;
  bFrequencyDays: number;
  cFrequencyDays: number;
  lookbackDays: number;
  aPercent: number;
  bPercent: number;
  enabled: boolean;
  configured: boolean;
}

@Injectable()
export class CycleCountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly warehouses: WarehousesService,
  ) {}

  // ---- Policy -------------------------------------------------------------

  /** Resolve the effective policy for a warehouse: warehouse override → org default → template defaults. */
  private async effectivePolicy(organizationId: string, warehouseId: string | null): Promise<EffectivePolicy> {
    const rows = await this.prisma.cycleCountPolicy.findMany({
      where: { organizationId, warehouseId: { in: warehouseId ? [warehouseId, NIL_UUID] : [NIL_UUID] } },
    });
    const row = (warehouseId && rows.find((r) => r.warehouseId === warehouseId)) || rows.find((r) => r.warehouseId === NIL_UUID);
    if (!row) {
      return { ...DEFAULT_CYCLE_COUNT_POLICY, enabled: false, configured: false };
    }
    return {
      strategy: row.strategy,
      aFrequencyDays: row.aFrequencyDays,
      bFrequencyDays: row.bFrequencyDays,
      cFrequencyDays: row.cFrequencyDays,
      lookbackDays: row.lookbackDays,
      aPercent: row.aPercent,
      bPercent: row.bPercent,
      enabled: row.enabled,
      configured: true,
    };
  }

  async getPolicy(organizationId: string, user: RequestUser, warehouseId?: string): Promise<CycleCountPolicyResponse> {
    if (warehouseId) await this.warehouses.assertAccess(organizationId, user, warehouseId);
    const eff = await this.effectivePolicy(organizationId, warehouseId ?? null);
    return { organizationId, warehouseId: warehouseId ?? null, ...eff };
  }

  async upsertPolicy(organizationId: string, user: RequestUser, dto: UpsertCycleCountPolicyDto): Promise<CycleCountPolicyResponse> {
    const warehouseId = dto.warehouseId ?? NIL_UUID;
    if (warehouseId !== NIL_UUID) await this.warehouses.assertAccess(organizationId, user, warehouseId);
    if (dto.aPercent !== undefined && dto.bPercent !== undefined && dto.aPercent + dto.bPercent > 100) {
      throw new BadRequestException('aPercent + bPercent cannot exceed 100');
    }
    const data = {
      ...(dto.strategy !== undefined ? { strategy: dto.strategy } : {}),
      ...(dto.aFrequencyDays !== undefined ? { aFrequencyDays: dto.aFrequencyDays } : {}),
      ...(dto.bFrequencyDays !== undefined ? { bFrequencyDays: dto.bFrequencyDays } : {}),
      ...(dto.cFrequencyDays !== undefined ? { cFrequencyDays: dto.cFrequencyDays } : {}),
      ...(dto.lookbackDays !== undefined ? { lookbackDays: dto.lookbackDays } : {}),
      ...(dto.aPercent !== undefined ? { aPercent: dto.aPercent } : {}),
      ...(dto.bPercent !== undefined ? { bPercent: dto.bPercent } : {}),
      ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
    };
    await this.prisma.cycleCountPolicy.upsert({
      where: { organizationId_warehouseId: { organizationId, warehouseId } },
      create: { organizationId, warehouseId, ...data },
      update: data,
    });
    await this.audit.record({
      organizationId, userId: user.userId, action: 'cycle_count_policy.updated', entityType: 'cycle_count_policy',
      entityId: warehouseId, newValue: { ...dto },
    });
    return this.getPolicy(organizationId, user, dto.warehouseId);
  }

  // ---- Classification -----------------------------------------------------

  /** Run automatic ABC classification for a warehouse (MOVEMENT_VELOCITY). Deterministic and transparent. */
  async classify(organizationId: string, user: RequestUser, dto: ClassifyDto): Promise<ProductClassificationRow[]> {
    await this.warehouses.assertAccess(organizationId, user, dto.warehouseId);
    const eff = await this.effectivePolicy(organizationId, dto.warehouseId);
    const strategy = dto.strategy ?? eff.strategy;
    if (strategy === 'MANUAL') {
      throw new BadRequestException('MANUAL strategy has no automatic run; set classes individually via the classification endpoint.');
    }
    if (strategy === 'INVENTORY_VALUE') {
      throw new BadRequestException('INVENTORY_VALUE classification is not implemented yet (2C.3A ships MOVEMENT_VELOCITY).');
    }

    // Candidate universe: distinct (product, variant) with a balance in this warehouse, restricted to ACTIVE products.
    const balances = await this.prisma.inventoryBalance.groupBy({
      by: ['productId', 'variantId'],
      where: { organizationId, warehouseId: dto.warehouseId },
    });
    const productIds = [...new Set(balances.map((b) => b.productId))];
    const products = await this.prisma.product.findMany({
      where: { organizationId, id: { in: productIds } },
      select: { id: true, status: true },
    });
    const activeIds = new Set(products.filter((p) => p.status === 'ACTIVE').map((p) => p.id));
    const candidates = balances.filter((b) => activeIds.has(b.productId));

    // Velocity = Σ |physical movement quantity| within the lookback window, per (product, variant).
    const from = new Date(Date.now() - eff.lookbackDays * DAY_MS);
    const moves = await this.prisma.inventoryMovement.groupBy({
      by: ['productId', 'variantId'],
      where: { organizationId, warehouseId: dto.warehouseId, postedAt: { gte: from } },
      _sum: { quantity: true },
    });
    const velocity = new Map<string, Prisma.Decimal>();
    for (const m of moves) {
      velocity.set(`${m.productId}:${m.variantId ?? NIL_UUID}`, m._sum.quantity ?? new Prisma.Decimal(0));
    }

    // Rank by velocity desc, deterministic tie-break by productId then variantId.
    const ranked = candidates
      .map((c) => ({ productId: c.productId, variantId: c.variantId, score: velocity.get(`${c.productId}:${c.variantId}`) ?? new Prisma.Decimal(0) }))
      .sort((x, y) => y.score.comparedTo(x.score) || x.productId.localeCompare(y.productId) || x.variantId.localeCompare(y.variantId));

    const n = ranked.length;
    const aCount = Math.floor((n * eff.aPercent) / 100);
    const bCount = Math.floor((n * eff.bPercent) / 100);
    const classAt = (i: number): ABCClass => (i < aCount ? 'A' : i < aCount + bCount ? 'B' : 'C');

    const now = new Date();
    await this.prisma.$transaction(
      ranked.map((r, i) =>
        this.prisma.productClassification.upsert({
          where: { organizationId_warehouseId_productId_variantId: { organizationId, warehouseId: dto.warehouseId, productId: r.productId, variantId: r.variantId } },
          create: { organizationId, warehouseId: dto.warehouseId, productId: r.productId, variantId: r.variantId, abcClass: classAt(i), strategy, score: r.score, manual: false, classifiedAt: now },
          update: { abcClass: classAt(i), strategy, score: r.score, manual: false, classifiedAt: now },
        }),
      ),
    );
    await this.audit.record({
      organizationId, userId: user.userId, action: 'cycle_count.classified', entityType: 'warehouse',
      entityId: dto.warehouseId, newValue: { strategy, classified: n, a: aCount, b: bCount, c: n - aCount - bCount },
    });
    return this.listClassifications(organizationId, user, dto.warehouseId);
  }

  /** Manually assign an ABC class to a single scope (overrides any computed class). */
  async setClassification(organizationId: string, user: RequestUser, dto: SetClassificationDto): Promise<ProductClassificationRow> {
    await this.warehouses.assertAccess(organizationId, user, dto.warehouseId);
    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, organizationId }, select: { status: true } });
    if (!product) throw new NotFoundException('Product not found');
    if (product.status !== 'ACTIVE') throw new BadRequestException('Cannot classify an inactive or archived product');
    const variantId = dto.variantId ?? NIL_UUID;
    await this.prisma.productClassification.upsert({
      where: { organizationId_warehouseId_productId_variantId: { organizationId, warehouseId: dto.warehouseId, productId: dto.productId, variantId } },
      create: { organizationId, warehouseId: dto.warehouseId, productId: dto.productId, variantId, abcClass: dto.abcClass, strategy: 'MANUAL', manual: true },
      update: { abcClass: dto.abcClass, strategy: 'MANUAL', manual: true, score: null, classifiedAt: new Date() },
    });
    await this.audit.record({
      organizationId, userId: user.userId, action: 'cycle_count.classified_manual', entityType: 'product',
      entityId: dto.productId, newValue: { warehouseId: dto.warehouseId, abcClass: dto.abcClass },
    });
    const rows = await this.listClassifications(organizationId, user, dto.warehouseId);
    const row = rows.find((r) => r.productId === dto.productId && (r.variantId ?? NIL_UUID) === variantId);
    if (!row) throw new NotFoundException('Classification not found after write');
    return row;
  }

  async listClassifications(organizationId: string, user: RequestUser, warehouseId: string): Promise<ProductClassificationRow[]> {
    await this.warehouses.assertAccess(organizationId, user, warehouseId);
    const rows = await this.prisma.productClassification.findMany({
      where: { organizationId, warehouseId },
      include: { product: { select: { sku: true, name: true } } },
      orderBy: [{ abcClass: 'asc' }, { score: 'desc' }],
    });
    return rows.map((r) => ({
      warehouseId: r.warehouseId,
      productId: r.productId,
      productSku: r.product.sku,
      productName: r.product.name,
      variantId: r.variantId === NIL_UUID ? null : r.variantId,
      abcClass: r.abcClass,
      strategy: r.strategy,
      score: r.score ? r.score.toString() : null,
      manual: r.manual,
      classifiedAt: r.classifiedAt.toISOString(),
    }));
  }

  // ---- Coverage (read model) ---------------------------------------------

  private freqFor(abcClass: ABCClass, p: EffectivePolicy): number {
    return abcClass === 'A' ? p.aFrequencyDays : abcClass === 'B' ? p.bFrequencyDays : p.cFrequencyDays;
  }

  async coverage(organizationId: string, user: RequestUser, warehouseId: string, dueOnly = false): Promise<CycleCountCoverageRow[]> {
    await this.warehouses.assertAccess(organizationId, user, warehouseId);
    const eff = await this.effectivePolicy(organizationId, warehouseId);

    const balances = await this.prisma.inventoryBalance.findMany({
      where: { organizationId, warehouseId, onHand: { gt: 0 } },
      select: { productId: true, variantId: true, lotId: true, onHand: true },
    });
    const productIds = [...new Set(balances.map((b) => b.productId))];
    const products = await this.prisma.product.findMany({
      where: { organizationId, id: { in: productIds } },
      select: { id: true, sku: true, name: true, status: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    const lotIds = [...new Set(balances.map((b) => b.lotId).filter((l) => l !== NIL_UUID))];
    const lots = lotIds.length
      ? await this.prisma.inventoryLot.findMany({ where: { organizationId, id: { in: lotIds } }, select: { id: true, lotNumber: true } })
      : [];
    const lotMap = new Map(lots.map((l) => [l.id, l.lotNumber]));

    const classifications = await this.prisma.productClassification.findMany({
      where: { organizationId, warehouseId },
      select: { productId: true, variantId: true, abcClass: true },
    });
    const classMap = new Map(classifications.map((c) => [`${c.productId}:${c.variantId}`, c.abcClass]));

    const completed = await this.prisma.cycleCountTask.findMany({
      where: { organizationId, warehouseId, status: 'COMPLETED', completedAt: { not: null } },
      select: { productId: true, variantId: true, lotId: true, completedAt: true },
    });
    const lastCounted = new Map<string, Date>();
    for (const t of completed) {
      const k = scopeKey(t.productId, t.variantId, t.lotId);
      const cur = lastCounted.get(k);
      if (t.completedAt && (!cur || t.completedAt > cur)) lastCounted.set(k, t.completedAt);
    }

    const active = await this.prisma.cycleCountTask.findMany({
      where: { organizationId, warehouseId, status: { in: ACTIVE_TASK_STATUSES } },
      select: { productId: true, variantId: true, lotId: true },
    });
    const activeSet = new Set(active.map((t) => scopeKey(t.productId, t.variantId, t.lotId)));

    const today = businessToday();
    const rows: CycleCountCoverageRow[] = [];
    for (const b of balances) {
      const product = productMap.get(b.productId);
      if (!product || product.status !== 'ACTIVE') continue; // inactive/archived excluded
      const abcClass = classMap.get(`${b.productId}:${b.variantId}`) ?? 'UNCLASSIFIED';
      const k = scopeKey(b.productId, b.variantId, b.lotId);
      const last = lastCounted.get(k) ?? null;
      const nextDue = last ? new Date(last.getTime() + this.freqFor(abcClass, eff) * DAY_MS) : null;
      const overdue = !nextDue || toBusinessDate(nextDue) <= today;
      const row: CycleCountCoverageRow = {
        warehouseId,
        productId: b.productId,
        productSku: product.sku,
        productName: product.name,
        variantId: b.variantId === NIL_UUID ? null : b.variantId,
        lotId: b.lotId === NIL_UUID ? null : b.lotId,
        lotNumber: b.lotId === NIL_UUID ? null : lotMap.get(b.lotId) ?? null,
        abcClass,
        onHand: b.onHand.toString(),
        lastCountedAt: last ? last.toISOString() : null,
        nextDueAt: nextDue ? nextDue.toISOString() : null,
        overdue,
        hasActiveTask: activeSet.has(k),
      };
      if (!dueOnly || overdue) rows.push(row);
    }
    rows.sort((x, y) => Number(y.overdue) - Number(x.overdue) || ABC_PRIORITY[x.abcClass] - ABC_PRIORITY[y.abcClass] || x.productSku.localeCompare(y.productSku));
    return rows;
  }

  // ---- Tasks --------------------------------------------------------------

  async generate(organizationId: string, user: RequestUser, dto: GenerateTasksDto): Promise<CycleCountTaskResponse[]> {
    await this.warehouses.assertSelectableForCreate(organizationId, user, dto.warehouseId);
    const eff = await this.effectivePolicy(organizationId, dto.warehouseId);
    if (!eff.configured || !eff.enabled) {
      throw new BadRequestException('No enabled cycle-count policy for this warehouse; configure one before generating tasks.');
    }
    const coverage = await this.coverage(organizationId, user, dto.warehouseId);
    const due = coverage.filter((c) => c.overdue && !c.hasActiveTask && c.abcClass !== 'UNCLASSIFIED');

    const policyContext = {
      strategy: eff.strategy, aFrequencyDays: eff.aFrequencyDays, bFrequencyDays: eff.bFrequencyDays,
      cFrequencyDays: eff.cFrequencyDays, lookbackDays: eff.lookbackDays, aPercent: eff.aPercent, bPercent: eff.bPercent,
    };
    const now = new Date();
    const createdIds: string[] = [];
    for (const c of due) {
      try {
        const task = await this.prisma.cycleCountTask.create({
          data: {
            organizationId, warehouseId: dto.warehouseId, productId: c.productId,
            variantId: c.variantId ?? NIL_UUID, lotId: c.lotId ?? NIL_UUID,
            abcClass: c.abcClass, priority: ABC_PRIORITY[c.abcClass], policyContext,
            status: 'PENDING', source: 'SCHEDULED',
            dueAt: c.nextDueAt ? new Date(c.nextDueAt) : now, createdById: user.userId,
          },
        });
        createdIds.push(task.id);
      } catch (e) {
        // Partial unique index (one active task per scope) — a concurrent/duplicate scope is skipped.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
    await this.audit.record({
      organizationId, userId: user.userId, action: 'cycle_count.generated', entityType: 'warehouse',
      entityId: dto.warehouseId, newValue: { generated: createdIds.length, considered: due.length },
    });
    return this.tasksByIds(organizationId, createdIds);
  }

  async createAdHocTask(organizationId: string, user: RequestUser, dto: CreateAdHocTaskDto): Promise<CycleCountTaskResponse> {
    await this.warehouses.assertSelectableForCreate(organizationId, user, dto.warehouseId);
    const product = await this.prisma.product.findFirst({ where: { id: dto.productId, organizationId }, select: { status: true, isBatchTracked: true } });
    if (!product) throw new NotFoundException('Product not found');
    if (product.status !== 'ACTIVE') throw new BadRequestException('Cannot count an inactive or archived product');

    let lotId = NIL_UUID;
    if (dto.lotId) {
      if (!product.isBatchTracked) throw new BadRequestException('A lot may only be specified for a batch-tracked product');
      const lot = await this.prisma.inventoryLot.findFirst({ where: { id: dto.lotId, organizationId, productId: dto.productId }, select: { id: true } });
      if (!lot) throw new BadRequestException('Lot not found for this product');
      lotId = dto.lotId;
    }
    const variantId = dto.variantId ?? NIL_UUID;
    const cls = await this.prisma.productClassification.findUnique({
      where: { organizationId_warehouseId_productId_variantId: { organizationId, warehouseId: dto.warehouseId, productId: dto.productId, variantId } },
      select: { abcClass: true },
    });
    const abcClass: ABCClass = cls?.abcClass ?? 'UNCLASSIFIED';

    try {
      const task = await this.prisma.cycleCountTask.create({
        data: {
          organizationId, warehouseId: dto.warehouseId, productId: dto.productId, variantId, lotId,
          abcClass, priority: ABC_PRIORITY[abcClass], status: 'PENDING', source: 'AD_HOC',
          dueAt: new Date(), createdById: user.userId,
        },
      });
      await this.audit.record({
        organizationId, userId: user.userId, action: 'cycle_count.ad_hoc_created', entityType: 'cycle_count_task',
        entityId: task.id, newValue: { warehouseId: dto.warehouseId, productId: dto.productId, lotId: lotId === NIL_UUID ? null : lotId },
      });
      return await this.oneTask(organizationId, task.id);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('An active cycle-count task already exists for this scope');
      }
      throw e;
    }
  }

  async assign(organizationId: string, user: RequestUser, id: string, dto: AssignTaskDto): Promise<CycleCountTaskResponse> {
    const task = await this.prisma.cycleCountTask.findFirst({ where: { id, organizationId }, select: { id: true, warehouseId: true, status: true } });
    if (!task) throw new NotFoundException('Cycle-count task not found');
    await this.warehouses.assertAccess(organizationId, user, task.warehouseId);
    if (task.status !== 'PENDING' && task.status !== 'ASSIGNED') {
      throw new BadRequestException(`A ${task.status} task cannot be assigned`);
    }
    const member = await this.prisma.membership.findFirst({ where: { organizationId, userId: dto.assignedToId, status: 'ACTIVE' }, select: { id: true } });
    if (!member) throw new BadRequestException('Assignee is not an active member of this organization');
    await this.prisma.cycleCountTask.update({ where: { id }, data: { assignedToId: dto.assignedToId, status: 'ASSIGNED' } });
    await this.audit.record({
      organizationId, userId: user.userId, action: 'cycle_count.assigned', entityType: 'cycle_count_task',
      entityId: id, newValue: { assignedToId: dto.assignedToId },
    });
    return this.oneTask(organizationId, id);
  }

  async listTasks(organizationId: string, user: RequestUser, query: TaskQueryDto): Promise<CycleCountTaskResponse[]> {
    const scope = user.warehouseScope;
    const where: Prisma.CycleCountTaskWhereInput = { organizationId };
    if (query.warehouseId) {
      await this.warehouses.assertAccess(organizationId, user, query.warehouseId);
      where.warehouseId = query.warehouseId;
    } else if (scope !== null) {
      where.warehouseId = { in: scope };
    }
    if (query.status) where.status = query.status;
    const tasks = await this.prisma.cycleCountTask.findMany({ where, orderBy: [{ status: 'asc' }, { priority: 'asc' }, { dueAt: 'asc' }] });
    let rows = await this.mapTasks(organizationId, tasks);
    if (query.overdue !== undefined) rows = rows.filter((r) => r.overdue === query.overdue);
    return rows;
  }

  async getTask(organizationId: string, user: RequestUser, id: string): Promise<CycleCountTaskResponse> {
    const task = await this.prisma.cycleCountTask.findFirst({ where: { id, organizationId } });
    if (!task) throw new NotFoundException('Cycle-count task not found');
    await this.warehouses.assertAccess(organizationId, user, task.warehouseId);
    return this.oneTask(organizationId, task.id);
  }

  // ---- Mapping helpers ----------------------------------------------------

  private async oneTask(organizationId: string, id: string): Promise<CycleCountTaskResponse> {
    const rows = await this.tasksByIds(organizationId, [id]);
    const row = rows[0];
    if (!row) throw new NotFoundException('Cycle-count task not found');
    return row;
  }

  private async tasksByIds(organizationId: string, ids: string[]): Promise<CycleCountTaskResponse[]> {
    if (ids.length === 0) return [];
    const tasks = await this.prisma.cycleCountTask.findMany({ where: { organizationId, id: { in: ids } } });
    const order = new Map(ids.map((id, i) => [id, i]));
    tasks.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    return this.mapTasks(organizationId, tasks);
  }

  private async mapTasks(
    organizationId: string,
    tasks: Array<{
      id: string; warehouseId: string; productId: string; variantId: string; lotId: string; abcClass: ABCClass;
      priority: number; status: CycleCountTaskStatus; source: string; dueAt: Date; assignedToId: string | null;
      physicalCountId: string | null; supersedesTaskId: string | null; completedAt: Date | null; createdAt: Date;
    }>,
  ): Promise<CycleCountTaskResponse[]> {
    if (tasks.length === 0) return [];
    const whIds = [...new Set(tasks.map((t) => t.warehouseId))];
    const prodIds = [...new Set(tasks.map((t) => t.productId))];
    const lotIds = [...new Set(tasks.map((t) => t.lotId).filter((l) => l !== NIL_UUID))];
    const userIds = [...new Set(tasks.map((t) => t.assignedToId).filter((u): u is string => !!u))];
    const [whs, prods, lots, users] = await Promise.all([
      this.prisma.warehouse.findMany({ where: { organizationId, id: { in: whIds } }, select: { id: true, code: true } }),
      this.prisma.product.findMany({ where: { organizationId, id: { in: prodIds } }, select: { id: true, sku: true, name: true } }),
      lotIds.length ? this.prisma.inventoryLot.findMany({ where: { organizationId, id: { in: lotIds } }, select: { id: true, lotNumber: true } }) : Promise.resolve([]),
      userIds.length ? this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    ]);
    const whMap = new Map(whs.map((w) => [w.id, w.code]));
    const prodMap = new Map(prods.map((p) => [p.id, p]));
    const lotMap = new Map(lots.map((l) => [l.id, l.lotNumber]));
    const userMap = new Map(users.map((u) => [u.id, u.name]));
    const today = businessToday();

    return tasks.map((t) => {
      const active = ACTIVE_TASK_STATUSES.includes(t.status);
      const product = prodMap.get(t.productId);
      return {
        id: t.id,
        warehouseId: t.warehouseId,
        warehouseCode: whMap.get(t.warehouseId) ?? '',
        productId: t.productId,
        productSku: product?.sku ?? '',
        productName: product?.name ?? '',
        variantId: t.variantId === NIL_UUID ? null : t.variantId,
        lotId: t.lotId === NIL_UUID ? null : t.lotId,
        lotNumber: t.lotId === NIL_UUID ? null : lotMap.get(t.lotId) ?? null,
        abcClass: t.abcClass,
        priority: t.priority,
        status: t.status,
        source: t.source as CycleCountTaskResponse['source'],
        dueAt: t.dueAt.toISOString(),
        overdue: active && toBusinessDate(t.dueAt) < today,
        assignedToId: t.assignedToId,
        assignedToName: t.assignedToId ? userMap.get(t.assignedToId) ?? null : null,
        physicalCountId: t.physicalCountId,
        supersedesTaskId: t.supersedesTaskId,
        completedAt: t.completedAt ? t.completedAt.toISOString() : null,
        createdAt: t.createdAt.toISOString(),
      };
    });
  }
}
