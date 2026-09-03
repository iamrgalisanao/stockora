import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  PERMISSIONS,
  CYCLE_COUNT_TASK_STATUSES,
  type CycleCountCoverageRow,
  type CycleCountPolicyResponse,
  type CycleCountTaskResponse,
  type CycleCountTaskStatus,
  type ProductClassificationRow,
} from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { CycleCountService } from './cycle-count.service';
import {
  AssignTaskDto,
  ClassifyDto,
  CreateAdHocTaskDto,
  GenerateTasksDto,
  SetClassificationDto,
  UpsertCycleCountPolicyDto,
} from './dto/cycle-count.dto';

@Controller('cycle-count')
export class CycleCountController {
  constructor(private readonly service: CycleCountService) {}

  // ---- Policy ----
  @RequirePermissions(PERMISSIONS.CYCLE_COUNT_VIEW)
  @Get('policy')
  getPolicy(@CurrentUser() user: RequestUser, @Query('warehouseId') warehouseId?: string): Promise<CycleCountPolicyResponse> {
    return this.service.getPolicy(user.organizationId, user, warehouseId);
  }

  @RequirePermissions(PERMISSIONS.CYCLE_COUNT_MANAGE_POLICY)
  @Put('policy')
  upsertPolicy(@CurrentUser() user: RequestUser, @Body() dto: UpsertCycleCountPolicyDto): Promise<CycleCountPolicyResponse> {
    return this.service.upsertPolicy(user.organizationId, user, dto);
  }

  // ---- Classification ----
  @RequirePermissions(PERMISSIONS.CYCLE_COUNT_VIEW)
  @Get('classifications')
  listClassifications(@CurrentUser() user: RequestUser, @Query('warehouseId', ParseUUIDPipe) warehouseId: string): Promise<ProductClassificationRow[]> {
    return this.service.listClassifications(user.organizationId, user, warehouseId);
  }

  @RequirePermissions(PERMISSIONS.CYCLE_COUNT_CLASSIFY)
  @Post('classify')
  classify(@CurrentUser() user: RequestUser, @Body() dto: ClassifyDto): Promise<ProductClassificationRow[]> {
    return this.service.classify(user.organizationId, user, dto);
  }

  @RequirePermissions(PERMISSIONS.CYCLE_COUNT_CLASSIFY)
  @Put('classification')
  setClassification(@CurrentUser() user: RequestUser, @Body() dto: SetClassificationDto): Promise<ProductClassificationRow> {
    return this.service.setClassification(user.organizationId, user, dto);
  }

  // ---- Coverage ----
  @RequirePermissions(PERMISSIONS.CYCLE_COUNT_VIEW)
  @Get('coverage')
  coverage(
    @CurrentUser() user: RequestUser,
    @Query('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Query('dueOnly') dueOnly?: string,
  ): Promise<CycleCountCoverageRow[]> {
    return this.service.coverage(user.organizationId, user, warehouseId, dueOnly === 'true');
  }

  // ---- Tasks ----
  @RequirePermissions(PERMISSIONS.CYCLE_COUNT_VIEW)
  @Get('tasks')
  listTasks(
    @CurrentUser() user: RequestUser,
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: string,
    @Query('overdue') overdue?: string,
  ): Promise<CycleCountTaskResponse[]> {
    const parsedStatus = status && (CYCLE_COUNT_TASK_STATUSES as readonly string[]).includes(status) ? (status as CycleCountTaskStatus) : undefined;
    const parsedOverdue = overdue === undefined ? undefined : overdue === 'true';
    return this.service.listTasks(user.organizationId, user, { warehouseId, status: parsedStatus, overdue: parsedOverdue });
  }

  @RequirePermissions(PERMISSIONS.CYCLE_COUNT_SCHEDULE)
  @Post('generate')
  generate(@CurrentUser() user: RequestUser, @Body() dto: GenerateTasksDto): Promise<CycleCountTaskResponse[]> {
    return this.service.generate(user.organizationId, user, dto);
  }

  @RequirePermissions(PERMISSIONS.CYCLE_COUNT_SCHEDULE)
  @Post('tasks')
  createAdHoc(@CurrentUser() user: RequestUser, @Body() dto: CreateAdHocTaskDto): Promise<CycleCountTaskResponse> {
    return this.service.createAdHocTask(user.organizationId, user, dto);
  }

  @RequirePermissions(PERMISSIONS.CYCLE_COUNT_ASSIGN)
  @Post('tasks/:id/assign')
  assign(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignTaskDto): Promise<CycleCountTaskResponse> {
    return this.service.assign(user.organizationId, user, id, dto);
  }

  @RequirePermissions(PERMISSIONS.CYCLE_COUNT_VIEW)
  @Get('tasks/:id')
  getTask(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<CycleCountTaskResponse> {
    return this.service.getTask(user.organizationId, user, id);
  }
}
