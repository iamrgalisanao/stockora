import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { MobileCommandReceipt, MobileCommandType, PermissionCode } from '@iw/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { COMMAND_SCHEMA_VERSION, MIN_APP_VERSION } from '../common/mobile.constants';
import type { RequestUser } from '../common/request-user';
import type { SubmitCommandDto } from './dto/mobile.dto';

/** Which permission a command type requires — the operator must be able to perform the underlying action. */
const COMMAND_PERMISSION: Record<MobileCommandType, PermissionCode> = {
  RECEIVE: 'inventory.receive',
  RELEASE_PICK: 'inventory.release',
  TRANSFER_DISPATCH: 'inventory.transfer',
  TRANSFER_RECEIVE: 'inventory.transfer',
  COUNT_SUBMIT: 'inventory.count',
  RETURN_RECEIVE: 'return.receive',
};

/** Compare dotted numeric build strings (e.g. "2.6.0"). Returns a<0, 0, or >0. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Mobile command intake (2D.6B, ADR 0014 §3). Accepts a captured command and durably RECEIVES it with
 * server-enforced exactly-once on (org, idempotencyKey). A timeout-driven retry with the same key returns the
 * existing receipt (ALREADY_PROCESSED) — never a second business transaction. 2D.6B only ACKNOWLEDGES the
 * command; execution against inventory, staleness revalidation, and conflict resolution are 2D.6C.
 */
@Injectable()
export class MobileCommandService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(user: RequestUser, dto: SubmitCommandDto): Promise<MobileCommandReceipt> {
    // Compatibility gates (ADR 0014 §14): refuse builds/schemas the server can no longer accept.
    if (dto.schemaVersion !== COMMAND_SCHEMA_VERSION) {
      throw new BadRequestException(`Unsupported command schema ${dto.schemaVersion}; server expects ${COMMAND_SCHEMA_VERSION}`);
    }
    if (compareVersions(dto.appVersion, MIN_APP_VERSION) < 0) {
      throw new BadRequestException(`App build ${dto.appVersion} is below the minimum ${MIN_APP_VERSION}; please update`);
    }
    const perm = COMMAND_PERMISSION[dto.commandType];
    if (!perm) throw new BadRequestException(`Unknown command type ${dto.commandType}`);
    if (!user.permissions.includes(perm)) throw new ForbiddenException(`Missing permission ${perm} for ${dto.commandType}`);
    // Warehouse scope: the command must target a warehouse the operator is allowed to act in (ADR 0014 §12).
    if (user.warehouseScope !== null && !user.warehouseScope.includes(dto.warehouseId)) {
      throw new ForbiddenException('Command targets a warehouse outside your scope');
    }

    // Exactly-once by (org, idempotencyKey). If it already exists, return the existing receipt unchanged so a
    // timeout retry cannot double-record — even if the client sent a different commandId the second time.
    const existing = await this.prisma.mobileCommand.findUnique({
      where: { organizationId_idempotencyKey: { organizationId: user.organizationId, idempotencyKey: dto.idempotencyKey } },
    });
    if (existing) {
      return {
        commandId: existing.id,
        idempotencyKey: existing.idempotencyKey,
        outcome: 'ALREADY_PROCESSED',
        applyStatus: 'ACKNOWLEDGED',
        receivedAt: existing.receivedAt.toISOString(),
      };
    }

    try {
      const created = await this.prisma.mobileCommand.create({
        data: {
          id: dto.commandId,
          organizationId: user.organizationId,
          idempotencyKey: dto.idempotencyKey,
          deviceId: dto.deviceId,
          userId: user.userId,
          warehouseId: dto.warehouseId,
          commandType: dto.commandType,
          aggregateId: dto.aggregateId ?? null,
          expectedVersion: dto.expectedVersion !== undefined ? BigInt(dto.expectedVersion) : null,
          schemaVersion: dto.schemaVersion,
          appVersion: dto.appVersion,
          payload: dto.payload as Prisma.InputJsonValue,
          capturedAt: new Date(dto.capturedAt),
        },
      });
      return {
        commandId: created.id,
        idempotencyKey: created.idempotencyKey,
        outcome: 'RECEIVED',
        applyStatus: 'ACKNOWLEDGED',
        receivedAt: created.receivedAt.toISOString(),
      };
    } catch (e) {
      // A concurrent submit of the same key raced us to the unique index — treat as already processed.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const row = await this.prisma.mobileCommand.findUnique({
          where: { organizationId_idempotencyKey: { organizationId: user.organizationId, idempotencyKey: dto.idempotencyKey } },
        });
        if (row) {
          return {
            commandId: row.id, idempotencyKey: row.idempotencyKey, outcome: 'ALREADY_PROCESSED',
            applyStatus: 'ACKNOWLEDGED', receivedAt: row.receivedAt.toISOString(),
          };
        }
      }
      throw e;
    }
  }
}
