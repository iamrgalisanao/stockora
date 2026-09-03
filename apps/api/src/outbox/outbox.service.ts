import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DomainEventType } from '@iw/contracts';
import { RequestContextService } from '../common/request-context';

/** Input to enqueue a domain event. correlationId/source come from the ambient RequestContext. */
export interface EnqueueInput {
  organizationId: string;
  eventType: DomainEventType;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  schemaVersion?: number;
  /** Idempotency key — a replayed command with the same key does not enqueue a duplicate logical event. */
  dedupeKey?: string;
  /** The event/command id that caused this event, when it is a chained fact. */
  causationId?: string;
  occurredAt?: Date;
}

@Injectable()
export class OutboxService {
  constructor(private readonly context: RequestContextService) {}

  /**
   * Append a domain event to the outbox INSIDE the caller's transaction (ADR 0010 §1). Pass the same
   * `tx` client used for the business mutation so the event commits or rolls back atomically with it.
   * Uses INSERT … ON CONFLICT DO NOTHING (via createMany + skipDuplicates) so a duplicate `dedupeKey`
   * is a no-op that never aborts the surrounding transaction.
   */
  async enqueue(tx: Prisma.TransactionClient, input: EnqueueInput): Promise<void> {
    const ctx = this.context.get();
    await tx.outboxEvent.createMany({
      data: [
        {
          organizationId: input.organizationId,
          eventType: input.eventType,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          occurredAt: input.occurredAt ?? new Date(),
          correlationId: ctx?.correlationId ?? null,
          causationId: input.causationId ?? null,
          source: ctx?.source ?? 'SYSTEM',
          schemaVersion: input.schemaVersion ?? 1,
          payload: input.payload as Prisma.InputJsonValue,
          dedupeKey: input.dedupeKey ?? null,
        },
      ],
      skipDuplicates: true,
    });
  }
}
