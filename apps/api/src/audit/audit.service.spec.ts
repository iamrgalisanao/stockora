import { PrismaService } from '../prisma/prisma.service';
import { RequestContextService } from '../common/request-context';
import type { RequestUser } from '../common/request-user';
import { AuditService } from './audit.service';

describe('AuditService (unit)', () => {
  function make(ctx?: { correlationId: string; actorId: string | null; actorDisplayName: string | null; source: 'USER' }) {
    const created: Record<string, unknown>[] = [];
    const rows: unknown[] = [];
    const prisma = {
      auditLog: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { created.push(data); return data; }),
        findMany: jest.fn(async () => rows),
      },
    };
    const context = { get: () => ctx } as unknown as RequestContextService;
    const service = new AuditService(prisma as unknown as PrismaService, context);
    return { service, prisma, created, rows };
  }

  const user = (scope: string[] | null): RequestUser => ({
    userId: 'u1', email: 'u@x', name: 'Admin', sessionId: 's1', membershipId: 'm1', organizationId: 'org1',
    roleKey: 'admin', roleName: 'Admin', permissions: [], warehouseScope: scope,
  });

  it('redacts protected fields before persisting', async () => {
    const { service, created } = make();
    await service.record({
      organizationId: 'org1', action: 'user.updated',
      newValue: { email: 'a@b.c', password: 'hunter2', nested: { apiKey: 'sk-123', ok: 1 }, token: 'abc' },
    });
    const persisted = created[0]!.newValue as Record<string, unknown>;
    expect(persisted.email).toBe('a@b.c');
    expect(persisted.password).toBe('[REDACTED]');
    expect(persisted.token).toBe('[REDACTED]');
    expect((persisted.nested as Record<string, unknown>).apiKey).toBe('[REDACTED]');
    expect((persisted.nested as Record<string, unknown>).ok).toBe(1);
  });

  it('truncates oversized payloads instead of copying the whole document', async () => {
    const { service, created } = make();
    await service.record({ organizationId: 'org1', action: 'x', newValue: { blob: 'y'.repeat(20_000) } });
    expect(created[0]!.newValue).toEqual({ _truncated: true });
  });

  it('inherits correlation, actor, and display name from the request context', async () => {
    const { service, created } = make({ correlationId: 'corr-1', actorId: 'ctx-user', actorDisplayName: 'Ctx Person', source: 'USER' });
    await service.record({ organizationId: 'org1', action: 'product.created' });
    expect(created[0]!.correlationId).toBe('corr-1');
    expect(created[0]!.userId).toBe('ctx-user');
    expect(created[0]!.actorDisplayName).toBe('Ctx Person');
  });

  it('builds a field-level change diff from old/new snapshots', async () => {
    const { service, prisma } = make();
    prisma.auditLog.findMany.mockResolvedValueOnce([
      {
        id: '1', createdAt: new Date('2026-01-01T00:00:00Z'), userId: 'u1', actorDisplayName: 'Admin',
        source: 'USER', action: 'supplier.updated', entityType: 'supplier', entityId: 's1', entityDisplay: 'ACME',
        organizationId: 'org1', warehouseId: null, correlationId: null,
        oldValue: { companyName: 'ACME', status: 'ACTIVE' }, newValue: { companyName: 'ACME Industrial', status: 'ACTIVE' },
        reference: null,
      },
    ]);
    const page = await service.search(user(null), {});
    expect(page.entries[0]!.changes).toEqual({ companyName: { from: 'ACME', to: 'ACME Industrial' } });
  });

  it('returns an empty page when a warehouse filter falls outside the user scope', async () => {
    const { service, prisma } = make();
    const page = await service.search(user(['whX']), { warehouseId: 'whY' });
    expect(page.entries).toEqual([]);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('emits a nextCursor only when more rows exist', async () => {
    const { service, prisma } = make();
    const row = (id: string) => ({
      id, createdAt: new Date(), userId: null, actorDisplayName: null, source: 'USER', action: 'a',
      entityType: null, entityId: null, entityDisplay: null, organizationId: 'org1', warehouseId: null,
      correlationId: null, oldValue: null, newValue: null, reference: null,
    });
    prisma.auditLog.findMany.mockResolvedValueOnce([row('1'), row('2'), row('3')]); // limit 2 + 1
    const page = await service.search(user(null), { limit: 2 });
    expect(page.entries).toHaveLength(2);
    expect(page.nextCursor).toBeTruthy();
  });
});
