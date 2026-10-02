import { Injectable, NotFoundException } from '@nestjs/common';
import { CommentaryType, Prisma } from '@prisma/client';
import { paginate, pageArgs } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { LiveEvent } from '../live/live.events';
import { LiveService } from '../live/live.service';
import { CommentaryQueryDto } from './dto/commentary.dto';
import { GeneratedCommentary } from './commentary.generator';

@Injectable()
export class CommentaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveService,
  ) {}

  /** Stores generated commentary and broadcasts it. Replaces any previous auto commentary for the ball. */
  async saveForBall(matchId: string, inningsId: string, ballId: string | null, overLabel: string | null, items: GeneratedCommentary[]) {
    if (ballId) await this.prisma.commentary.deleteMany({ where: { ballId, isAuto: true } });
    if (!items.length) return [];
    const now = Date.now();
    const rows = await this.prisma.$transaction(
      items.map((c, i) =>
        this.prisma.commentary.create({
          // stagger timestamps so ordering within a ball is stable
          data: { matchId, inningsId, ballId, type: c.type, text: c.text, overLabel, createdAt: new Date(now + i) },
        }),
      ),
    );
    this.live.toMatch(matchId, LiveEvent.COMMENTARY_UPDATE, { items: rows });
    return rows;
  }

  async add(matchId: string, inningsId: string | null, type: CommentaryType, text: string, overLabel?: string | null, createdById?: string) {
    const row = await this.prisma.commentary.create({
      data: { matchId, inningsId, type, text, overLabel, isAuto: !createdById, createdById },
    });
    this.live.toMatch(matchId, LiveEvent.COMMENTARY_UPDATE, { items: [row] });
    return row;
  }

  async removeForBall(ballId: string) {
    await this.prisma.commentary.updateMany({ where: { ballId, deletedAt: null }, data: { deletedAt: new Date() } });
  }

  async restoreForBall(ballId: string) {
    await this.prisma.commentary.updateMany({ where: { ballId }, data: { deletedAt: null } });
  }

  async list(matchId: string, q: CommentaryQueryDto) {
    const where: Prisma.CommentaryWhereInput = {
      matchId,
      deletedAt: null,
      type: q.types?.length ? { in: q.types } : undefined,
      innings: q.inningsNumber ? { number: q.inningsNumber } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.commentary.findMany({
        where,
        ...pageArgs(q),
        orderBy: { createdAt: q.sortOrder },
        include: { innings: { select: { number: true, isSuperOver: true } } },
      }),
      this.prisma.commentary.count({ where }),
    ]);
    return paginate(items, total, q);
  }

  async remove(matchId: string, id: string) {
    const res = await this.prisma.commentary.updateMany({ where: { id, matchId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!res.count) throw new NotFoundException('Commentary not found');
    return { deleted: true };
  }
}
