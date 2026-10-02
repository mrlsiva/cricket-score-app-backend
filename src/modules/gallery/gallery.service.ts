import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MediaType, Prisma } from '@prisma/client';
import { paginate, pageArgs, PaginationQueryDto } from '../../common/dto/pagination.dto';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { LiveEvent } from '../live/live.events';
import { LiveService } from '../live/live.service';

@Injectable()
export class GalleryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly access: AccessService,
    private readonly live: LiveService,
  ) {}

  private readonly include = { uploadedBy: { select: { id: true, name: true, photoUrl: true } } } satisfies Prisma.GalleryInclude;

  async upload(user: AuthUser, matchId: string, file: Express.Multer.File, caption?: string) {
    const match = await this.prisma.match.findFirst({ where: { id: matchId, deletedAt: null } });
    if (!match) throw new NotFoundException('Match not found');
    if (!(await this.access.isMatchParticipant(user, matchId))) throw new ForbiddenException('Only organizers, scorers and players of this match can upload');
    const stored = await this.storage.save(file, 'gallery');
    const item = await this.prisma.gallery.create({
      data: { matchId, type: stored.mediaType, url: stored.url, storageKey: stored.key, mimeType: stored.mimeType, sizeBytes: stored.size, caption, uploadedById: user.id },
      include: this.include,
    });
    this.live.toMatch(matchId, LiveEvent.GALLERY_UPDATE, { action: 'ADDED', item });
    return item;
  }

  async list(matchId: string, q: PaginationQueryDto & { type?: MediaType }) {
    const where: Prisma.GalleryWhereInput = { matchId, deletedAt: null, type: q.type };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.gallery.findMany({ where, ...pageArgs(q), orderBy: { createdAt: q.sortOrder }, include: this.include }),
      this.prisma.gallery.count({ where }),
    ]);
    return paginate(items, total, q);
  }

  async updateCaption(user: AuthUser, matchId: string, id: string, caption: string) {
    const item = await this.prisma.gallery.findFirst({ where: { id, matchId, deletedAt: null } });
    if (!item) throw new NotFoundException('Gallery item not found');
    if (item.uploadedById !== user.id && !(await this.access.canManageMatch(user, matchId))) throw new ForbiddenException();
    const updated = await this.prisma.gallery.update({ where: { id }, data: { caption }, include: this.include });
    this.live.toMatch(matchId, LiveEvent.GALLERY_UPDATE, { action: 'UPDATED', item: updated });
    return updated;
  }

  async remove(user: AuthUser, matchId: string, id: string) {
    const item = await this.prisma.gallery.findFirst({ where: { id, matchId, deletedAt: null } });
    if (!item) throw new NotFoundException('Gallery item not found');
    if (item.uploadedById !== user.id && !(await this.access.canManageMatch(user, matchId))) throw new ForbiddenException();
    await this.prisma.gallery.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.storage.remove(item.storageKey);
    this.live.toMatch(matchId, LiveEvent.GALLERY_UPDATE, { action: 'DELETED', id });
    return { deleted: true };
  }
}
