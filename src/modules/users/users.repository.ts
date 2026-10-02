import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const PUBLIC_USER_SELECT = {
  id: true,
  name: true,
  photoUrl: true,
  city: true,
  createdAt: true,
  player: { select: { id: true, jerseyNumber: true, role: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActive(id: string) {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null } });
  }

  findPublic(id: string) {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null }, select: PUBLIC_USER_SELECT });
  }

  search(where: Prisma.UserWhereInput, skip: number, take: number, orderBy: Prisma.UserOrderByWithRelationInput) {
    return this.prisma.$transaction([
      this.prisma.user.findMany({ where, skip, take, orderBy, select: { ...PUBLIC_USER_SELECT, email: true } }),
      this.prisma.user.count({ where }),
    ]);
  }

  update(id: string, data: Prisma.UserUpdateInput) {
    return this.prisma.user.update({ where: { id }, data });
  }
}
