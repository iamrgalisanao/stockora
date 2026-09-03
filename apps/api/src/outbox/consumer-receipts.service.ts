import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Per-consumer delivery receipts (ADR 0010 §4) — the reusable idempotency primitive. A consumer runs its
 * side effect only when no receipt exists, then records one; a retry skips already-receipted consumers.
 */
@Injectable()
export class ConsumerReceipts {
  constructor(private readonly prisma: PrismaService) {}

  async has(consumerName: string, eventId: string): Promise<boolean> {
    const row = await this.prisma.consumerReceipt.findUnique({
      where: { consumerName_eventId: { consumerName, eventId } },
      select: { id: true },
    });
    return row !== null;
  }

  /** Records a receipt; a concurrent duplicate is a no-op (ON CONFLICT DO NOTHING). */
  async record(consumerName: string, eventId: string): Promise<void> {
    await this.prisma.consumerReceipt.createMany({ data: [{ consumerName, eventId }], skipDuplicates: true });
  }
}
