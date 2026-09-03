import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConsumerRegistry } from '../outbox/consumer-registry.service';
import type { DomainEventConsumer, DomainEventEnvelope } from '../outbox/consumer';

/**
 * First internal outbox consumer (2D.1C): projects delivered domain facts into a durable read model. Proves
 * domain-tx → outbox → relay → idempotent consumer → projection, with NO notification semantics. Idempotent
 * both by the relay's per-consumer receipt AND its own unique eventId (createMany + skipDuplicates).
 */
@Injectable()
export class OperationalFactConsumer implements DomainEventConsumer, OnModuleInit {
  readonly consumerName = 'operational-fact-projection';
  // Registered for several event types; `eventType` is unused by the relay for lookup once registered.
  readonly eventType = 'LotExpired';
  private static readonly TYPES = ['LotExpiringSoon', 'LotExpired', 'CycleCountCompleted'];

  constructor(private readonly prisma: PrismaService, private readonly registry: ConsumerRegistry) {}

  onModuleInit(): void {
    for (const eventType of OperationalFactConsumer.TYPES) {
      this.registry.register({ consumerName: this.consumerName, eventType, handle: (e) => this.handle(e) });
    }
  }

  async handle(event: DomainEventEnvelope): Promise<void> {
    const p = event.payload;
    const { entityType, entityId, summary } = this.describe(event);
    await this.prisma.operationalFactProjection.createMany({
      data: [
        {
          eventId: event.id,
          eventType: event.eventType,
          organizationId: event.organizationId,
          entityType,
          entityId,
          occurredAt: event.occurredAt,
          summary,
          metadata: p as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true, // idempotent on replay
    });
  }

  private describe(event: DomainEventEnvelope): { entityType: string; entityId: string; summary: string } {
    const p = event.payload as Record<string, unknown>;
    const s = (k: string) => (p[k] == null ? '' : String(p[k]));
    switch (event.eventType) {
      case 'LotExpiringSoon':
        return { entityType: 'lot', entityId: s('lotId') || event.aggregateId, summary: `Lot ${s('lotNumber')} entered the expiring-soon window (${s('daysRemaining')}d)` };
      case 'LotExpired':
        return { entityType: 'lot', entityId: s('lotId') || event.aggregateId, summary: `Lot ${s('lotNumber')} expired` };
      case 'CycleCountCompleted':
        return { entityType: 'cycle_count_task', entityId: s('cycleCountTaskId') || event.aggregateId, summary: `Cycle count completed with variance ${s('varianceQuantity')}` };
      default:
        return { entityType: event.aggregateType, entityId: event.aggregateId, summary: event.eventType };
    }
  }
}
