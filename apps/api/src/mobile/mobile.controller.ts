import { BadRequestException, Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { PERMISSIONS } from '@iw/contracts';
import type { MobileCommandReceipt, MobileDiagnostics, MobileWorkClaim, MobileWorkItem, MobileWorkType } from '@iw/contracts';
import { CurrentUser, RequirePermissions } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { MobileWorkService } from './mobile-work.service';
import { MobileCommandService } from './mobile-command.service';
import { MobileDiagnosticsService } from './mobile-diagnostics.service';
import { ClaimWorkDto, SubmitCommandDto } from './dto/mobile.dto';

const WORK_TYPES: MobileWorkType[] = ['receiving', 'releases', 'transfers', 'counts', 'returns'];
function parseWorkType(raw: string): MobileWorkType {
  if (!(WORK_TYPES as string[]).includes(raw)) throw new BadRequestException(`Unknown work type ${raw}`);
  return raw as MobileWorkType;
}

/**
 * Mobile worklist + claim + command intake (2D.6B, ADR 0014). Narrow read models scoped to the operator's
 * org + warehouse scope, an advisory claim, and an exactly-once command intake. No endpoint here mutates
 * inventory — capture only; execution is 2D.6C.
 */
@Controller('mobile')
export class MobileController {
  constructor(
    private readonly work: MobileWorkService,
    private readonly commands: MobileCommandService,
    private readonly diagnostics: MobileDiagnosticsService,
  ) {}

  @RequirePermissions(PERMISSIONS.INVENTORY_RECEIVE)
  @Get('work/receiving')
  receiving(@CurrentUser() user: RequestUser): Promise<MobileWorkItem[]> {
    return this.work.receiving(user);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_RELEASE)
  @Get('work/releases')
  releases(@CurrentUser() user: RequestUser): Promise<MobileWorkItem[]> {
    return this.work.releases(user);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_TRANSFER)
  @Get('work/transfers')
  transfers(@CurrentUser() user: RequestUser): Promise<MobileWorkItem[]> {
    return this.work.transfers(user);
  }

  @RequirePermissions(PERMISSIONS.INVENTORY_COUNT)
  @Get('work/counts')
  counts(@CurrentUser() user: RequestUser): Promise<MobileWorkItem[]> {
    return this.work.counts(user);
  }

  @RequirePermissions(PERMISSIONS.RETURN_RECEIVE)
  @Get('work/returns')
  returns(@CurrentUser() user: RequestUser): Promise<MobileWorkItem[]> {
    return this.work.returns(user);
  }

  // Claiming is advisory (ADR 0014 §9) and scope-checked in the service — authenticated org members may claim.
  @Post('work/:type/:id/claim')
  claim(@CurrentUser() user: RequestUser, @Param('type') type: string, @Param('id') id: string, @Body() dto: ClaimWorkDto): Promise<MobileWorkClaim> {
    return this.work.claim(user, parseWorkType(type), id, dto.deviceId, dto.leaseSeconds);
  }

  @Delete('work/:type/:id/claim')
  releaseClaim(@CurrentUser() user: RequestUser, @Param('type') type: string, @Param('id') id: string): Promise<void> {
    return this.work.releaseClaim(user, parseWorkType(type), id);
  }

  // Command intake enforces per-command permission + scope + exactly-once inside the service.
  @Post('commands')
  submit(@CurrentUser() user: RequestUser, @Body() dto: SubmitCommandDto): Promise<MobileCommandReceipt> {
    return this.commands.submit(user, dto);
  }

  // Support/telemetry — org-scoped mobile sync health (2D.6D). Admin/manager read.
  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  @Get('diagnostics')
  diagnosticsSummary(@CurrentUser() user: RequestUser): Promise<MobileDiagnostics> {
    return this.diagnostics.summary(user);
  }
}
