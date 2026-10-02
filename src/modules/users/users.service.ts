import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { orderBy, pageArgs, paginate } from '../../common/dto/pagination.dto';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUserLoader } from '../auth/auth-user.loader';
import { UpdateMeDto, UserQueryDto } from './dto/users.dto';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(
    private readonly repo: UsersRepository,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly loader: AuthUserLoader,
  ) {}

  async search(q: UserQueryDto) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      isActive: true,
      city: q.city ? { contains: q.city } : undefined,
      roles: q.role ? { some: { role: { name: q.role } } } : undefined,
      OR: q.search ? [{ name: { contains: q.search } }, { email: { contains: q.search } }] : undefined,
    };
    const { skip, take } = pageArgs(q);
    const [items, total] = await this.repo.search(where, skip, take, orderBy(q, ['name', 'createdAt', 'city'], 'createdAt'));
    return paginate(items, total, q);
  }

  async getPublic(id: string) {
    const user = await this.repo.findPublic(id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateMe(id: string, dto: UpdateMeDto) {
    const user = await this.repo.update(id, dto);
    if (dto.name) await this.prisma.player.updateMany({ where: { userId: id }, data: { name: dto.name } });
    await this.loader.invalidate(id);
    return user;
  }

  async updatePhoto(id: string, file: Express.Multer.File) {
    const stored = await this.storage.save(file, 'player-photo');
    await this.prisma.player.updateMany({ where: { userId: id }, data: { photoUrl: stored.url } });
    return this.repo.update(id, { photoUrl: stored.url });
  }

  async setStatus(id: string, isActive: boolean) {
    const user = await this.repo.update(id, { isActive });
    if (!isActive) await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.loader.invalidate(id);
    return user;
  }

  /** Soft-deletes the account and revokes all sessions. Player history is preserved. */
  async deleteMe(id: string) {
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, email: `deleted+${id}@deleted.local`, googleId: `deleted-${id}` } }),
      this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.deviceToken.deleteMany({ where: { userId: id } }),
    ]);
    await this.loader.invalidate(id);
    return { deleted: true };
  }
}
