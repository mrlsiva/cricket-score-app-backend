import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginate, pageArgs } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditQueryDto } from './dto/audit-query.dto';

export interface AuditEntry {
  userId?: string | null;
  matchId?: string | null;
  entityType: string;
  entityId?: string | null;
  action: string;
  ballLabel?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  ip?: string | null;
}

const json = (v: unknown) => (v === undefined || v === null ? Prisma.DbNull : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Records an audit entry. Never throws - auditing must not break the main flow. */
  async log(entry: AuditEntry, tx?: Prisma.TransactionClient) {
    try {
      await (tx ?? this.prisma).auditLog.create({
        data: {
          userId: entry.userId ?? null,
          matchId: entry.matchId ?? null,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          action: entry.action,
          ballLabel: entry.ballLabel ?? null,
          oldValue: json(entry.oldValue),
          newValue: json(entry.newValue),
          reason: entry.reason ?? null,
          ip: entry.ip ?? null,
        },
      });
    } catch (e: any) {
      this.logger.error(`Audit log failed: ${e.message}`);
    }
  }

  async list(q: AuditQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      matchId: q.matchId,
      userId: q.userId,
      entityType: q.entityType,
      entityId: q.entityId,
      action: q.action,
      createdAt: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        ...pageArgs(q),
        orderBy: { createdAt: q.sortOrder },
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paginate(items, total, q);
  }
}
