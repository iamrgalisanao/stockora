import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface SessionContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface IssuedRefresh {
  sessionId: string;
  refreshToken: string;
  expiresAt: Date;
}

interface Principal {
  userId: string;
  organizationId: string;
  membershipId: string;
}

/**
 * Owns refresh-token sessions: creation, rotation, reuse detection, and revocation. Refresh tokens
 * are opaque high-entropy strings persisted only as SHA-256 hashes; each use rotates the token and
 * revokes its predecessor, and presenting an already-rotated token revokes the entire family.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private ttlMs(): number {
    return this.config.get<number>('REFRESH_TOKEN_TTL_DAYS', 30) * 24 * 60 * 60 * 1000;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private mint(): string {
    return randomBytes(32).toString('base64url');
  }

  /** Start a new session family (login / register). */
  async create(principal: Principal, ctx: SessionContext = {}): Promise<IssuedRefresh> {
    const refreshToken = this.mint();
    const expiresAt = new Date(Date.now() + this.ttlMs());
    const session = await this.prisma.session.create({
      data: {
        userId: principal.userId,
        organizationId: principal.organizationId,
        membershipId: principal.membershipId,
        familyId: randomUUID(),
        refreshTokenHash: this.hash(refreshToken),
        ipAddress: ctx.ip ?? null,
        userAgent: ctx.userAgent?.slice(0, 300) ?? null,
        expiresAt,
      },
    });
    return { sessionId: session.id, refreshToken, expiresAt };
  }

  /**
   * Rotate a refresh token. Returns the fresh token + the session's principal. On reuse of a
   * superseded/revoked token, the whole family is revoked and the caller is rejected.
   */
  async rotate(refreshToken: string, ctx: SessionContext = {}): Promise<IssuedRefresh & Principal> {
    const existing = await this.prisma.session.findUnique({ where: { refreshTokenHash: this.hash(refreshToken) } });
    if (!existing) throw new UnauthorizedException('Invalid refresh token');

    if (existing.revokedAt || existing.replacedById) {
      // Reuse of a token that was already rotated/revoked → treat as theft, kill the family.
      await this.prisma.session.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'refresh-token reuse detected' },
      });
      throw new UnauthorizedException('Refresh token has already been used');
    }
    if (existing.expiresAt.getTime() < Date.now()) {
      await this.revoke(existing.id, 'expired');
      throw new UnauthorizedException('Refresh token expired');
    }

    const next = this.mint();
    const expiresAt = new Date(Date.now() + this.ttlMs());
    const created = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.session.create({
        data: {
          userId: existing.userId,
          organizationId: existing.organizationId,
          membershipId: existing.membershipId,
          familyId: existing.familyId, // stay in the same lineage
          refreshTokenHash: this.hash(next),
          ipAddress: ctx.ip ?? existing.ipAddress,
          userAgent: ctx.userAgent?.slice(0, 300) ?? existing.userAgent,
          expiresAt,
        },
      });
      await tx.session.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), revokedReason: 'rotated', replacedById: fresh.id, lastUsedAt: new Date() },
      });
      return fresh;
    });

    return {
      sessionId: created.id,
      refreshToken: next,
      expiresAt,
      userId: created.userId,
      organizationId: created.organizationId,
      membershipId: created.membershipId,
    };
  }

  /** True when a session id refers to a live (unrevoked, unexpired) session — checked per request. */
  async isActive(sessionId: string): Promise<boolean> {
    const s = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { revokedAt: true, expiresAt: true },
    });
    return !!s && s.revokedAt === null && s.expiresAt.getTime() > Date.now();
  }

  async revoke(sessionId: string, reason = 'logout'): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Revoke every active session for a user (sign out everywhere). */
  async revokeAllForUser(userId: string, reason = 'logout-all'): Promise<number> {
    const res = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return res.count;
  }
}
