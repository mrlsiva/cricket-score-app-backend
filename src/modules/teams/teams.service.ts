import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType, Prisma, RoleName } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as QRCode from 'qrcode';
import { orderBy, pageArgs, paginate } from '../../common/dto/pagination.dto';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { randomCode } from '../../common/utils/cricket.util';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlayersService } from '../players/players.service';
import { RolesService } from '../roles/roles.service';
import { AddTeamPlayerDto, CreateTeamDto, JoinRequestQueryDto, JoinTeamDto, TeamQueryDto, UpdateTeamDto } from './dto/teams.dto';
import { TeamsRepository } from './teams.repository';

@Injectable()
export class TeamsService {
  constructor(
    private readonly repo: TeamsRepository,
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly players: PlayersService,
    private readonly roles: RolesService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  static newCodes() {
    return { joinCode: randomCode(8), qrToken: randomBytes(24).toString('base64url') };
  }

  async create(user: AuthUser, dto: CreateTeamDto) {
    const { joinAsPlayer, captainId, wicketKeeperId, managerId, ...data } = dto;
    const team = await this.prisma.$transaction(async (tx) => {
      const t = await tx.team.create({ data: { ...data, ...TeamsService.newCodes(), createdById: user.id, managerId: managerId ?? null } });
      if (joinAsPlayer) {
        const player = await this.players.ensureForUser(user.id, tx);
        await this.repo.addMember(t.id, player.id, tx);
      }
      return t;
    });
    if (captainId || wicketKeeperId) await this.update(user, team.id, { captainId, wicketKeeperId });
    await this.grantContextRoles(team.id);
    await this.audit.log({ userId: user.id, entityType: 'TEAM', entityId: team.id, action: 'CREATE', newValue: dto });
    return this.get(team.id);
  }

  async list(user: AuthUser, q: TeamQueryDto) {
    const mine: Prisma.TeamWhereInput[] = [
      { createdById: user.id },
      { managerId: user.id },
      ...(user.playerId ? [{ players: { some: { playerId: user.playerId, status: 'ACTIVE' as const } } }] : []),
    ];
    const where: Prisma.TeamWhereInput = {
      deletedAt: null,
      isTemporary: q.includeTemporary ? undefined : false,
      name: q.search ? { contains: q.search } : undefined,
      tournaments: q.tournamentId ? { some: { tournamentId: q.tournamentId } } : undefined,
      OR: q.mine ? mine : undefined,
    };
    const { skip, take } = pageArgs(q);
    const [items, total] = await this.repo.search(where, skip, take, orderBy(q, ['name', 'createdAt'], 'createdAt'));
    return paginate(items, total, q);
  }

  async get(id: string) {
    const team = await this.repo.findById(id);
    if (!team) throw new NotFoundException('Team not found');
    const { qrToken, joinCode, ...rest } = team;
    return rest;
  }

  async update(user: AuthUser, id: string, dto: UpdateTeamDto) {
    await this.access.assertCanManageTeam(user, id);
    const before = await this.repo.findById(id);
    for (const pid of [dto.captainId, dto.wicketKeeperId].filter(Boolean) as string[]) {
      if (!(await this.repo.isMember(id, pid))) throw new BadRequestException('Captain / wicket keeper must be in the team squad');
    }
    const { joinAsPlayer, ...data } = dto;
    await this.prisma.team.update({ where: { id }, data });
    await this.grantContextRoles(id);
    await this.audit.log({ userId: user.id, entityType: 'TEAM', entityId: id, action: 'UPDATE', oldValue: before, newValue: dto });
    return this.get(id);
  }

  async remove(user: AuthUser, id: string) {
    await this.access.assertCanManageTeam(user, id);
    const live = await this.prisma.match.count({
      where: { deletedAt: null, status: { in: ['LIVE', 'INNINGS_BREAK', 'TOSS_COMPLETED'] }, OR: [{ teamAId: id }, { teamBId: id }] },
    });
    if (live) throw new ConflictException('Team has matches in progress');
    await this.prisma.team.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, entityType: 'TEAM', entityId: id, action: 'DELETE' });
    return { deleted: true };
  }

  async setLogo(user: AuthUser, id: string, file: Express.Multer.File) {
    await this.access.assertCanManageTeam(user, id);
    const stored = await this.storage.save(file, 'team-logo');
    await this.prisma.team.update({ where: { id }, data: { logoUrl: stored.url } });
    return this.get(id);
  }

  squad(id: string) {
    return this.repo.squad(id);
  }

  // ─────────────── QR / join code ───────────────

  private deepLink(team: { id: string; joinCode: string; qrToken: string }) {
    return `cricketapp://team/join?teamId=${team.id}&code=${team.joinCode}&t=${team.qrToken}`;
  }

  /** Returns QR (PNG data URL) + join code. `regenerate` invalidates previous QR codes. */
  async qr(user: AuthUser, id: string, regenerate = false) {
    await this.access.assertCanManageTeam(user, id);
    let team = await this.prisma.team.findFirstOrThrow({ where: { id, deletedAt: null } });
    if (regenerate) {
      team = await this.prisma.team.update({ where: { id }, data: TeamsService.newCodes() });
      await this.audit.log({ userId: user.id, entityType: 'TEAM', entityId: id, action: 'QR_REGENERATED' });
    }
    const payload = this.deepLink(team);
    return {
      teamId: team.id,
      teamName: team.name,
      joinCode: team.joinCode,
      qrPayload: payload,
      qrImage: await QRCode.toDataURL(payload, { width: 512, margin: 2, errorCorrectionLevel: 'M' }),
    };
  }

  async qrPng(user: AuthUser, id: string) {
    const { qrPayload } = await this.qr(user, id);
    return QRCode.toBuffer(qrPayload, { width: 768, margin: 2 });
  }

  async join(user: AuthUser, dto: JoinTeamDto) {
    const team = await this.repo.findByCode(dto.code.trim());
    if (!team || team.isTemporary) throw new NotFoundException('Invalid or expired team code');
    const player = await this.players.ensureForUser(user.id);
    if (await this.repo.isMember(team.id, player.id)) throw new ConflictException('You are already in this team');
    const pending = await this.prisma.teamJoinRequest.findFirst({ where: { teamId: team.id, userId: user.id, status: 'PENDING' } });
    if (pending) return pending;

    const request = await this.prisma.teamJoinRequest.create({
      data: { teamId: team.id, userId: user.id, playerId: player.id, message: dto.message },
      include: { team: { select: { id: true, name: true } } },
    });
    await this.notifications.notifyUsers(await this.teamAdmins(team.id), {
      type: NotificationType.TEAM_JOIN_REQUEST,
      title: `Join request - ${team.name}`,
      body: `${user.name} wants to join ${team.name}`,
      data: { teamId: team.id, requestId: request.id },
    });
    return request;
  }

  async joinRequests(user: AuthUser, teamId: string, q: JoinRequestQueryDto) {
    await this.access.assertCanManageTeam(user, teamId);
    const where: Prisma.TeamJoinRequestWhereInput = { teamId, status: q.status ?? 'PENDING' };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.teamJoinRequest.findMany({
        where,
        ...pageArgs(q),
        orderBy: { createdAt: q.sortOrder },
        include: { user: { select: { id: true, name: true, photoUrl: true, city: true } }, player: true },
      }),
      this.prisma.teamJoinRequest.count({ where }),
    ]);
    return paginate(items, total, q);
  }

  async myJoinRequests(userId: string) {
    return this.prisma.teamJoinRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { team: { select: { id: true, name: true, logoUrl: true } } },
    });
  }

  async reviewRequest(user: AuthUser, teamId: string, requestId: string, accept: boolean, reason?: string) {
    await this.access.assertCanManageTeam(user, teamId);
    const req = await this.prisma.teamJoinRequest.findFirst({ where: { id: requestId, teamId }, include: { team: true } });
    if (!req) throw new NotFoundException('Join request not found');
    if (req.status !== 'PENDING') throw new ConflictException(`Request already ${req.status.toLowerCase()}`);

    await this.prisma.$transaction(async (tx) => {
      await tx.teamJoinRequest.update({
        where: { id: requestId },
        data: { status: accept ? 'ACCEPTED' : 'REJECTED', reviewedById: user.id, reviewedAt: new Date() },
      });
      if (accept) await this.repo.addMember(teamId, req.playerId, tx);
    });
    await this.notifications.notifyUsers([req.userId], {
      type: NotificationType.TEAM_JOIN_APPROVAL,
      title: accept ? `Welcome to ${req.team.name}!` : `Join request declined`,
      body: accept ? `Your request to join ${req.team.name} was approved` : `${req.team.name} declined your request${reason ? `: ${reason}` : ''}`,
      data: { teamId, requestId, status: accept ? 'ACCEPTED' : 'REJECTED' },
    });
    await this.audit.log({ userId: user.id, entityType: 'TEAM_JOIN_REQUEST', entityId: requestId, action: accept ? 'ACCEPT' : 'REJECT', reason });
    return { requestId, status: accept ? 'ACCEPTED' : 'REJECTED' };
  }

  async addPlayer(user: AuthUser, teamId: string, dto: AddTeamPlayerDto) {
    await this.access.assertCanManageTeam(user, teamId);
    const player = dto.playerId
      ? await this.prisma.player.findFirst({ where: { id: dto.playerId, deletedAt: null } })
      : await this.players.createTemporary(dto.name!, user.id);
    if (!player) throw new NotFoundException('Player not found');
    await this.repo.addMember(teamId, player.id);
    await this.audit.log({ userId: user.id, entityType: 'TEAM', entityId: teamId, action: 'ADD_PLAYER', newValue: { playerId: player.id } });
    return player;
  }

  async removePlayer(user: AuthUser, teamId: string, playerId: string) {
    const isSelf = user.playerId === playerId;
    if (!isSelf) await this.access.assertCanManageTeam(user, teamId);
    const res = await this.prisma.teamPlayer.updateMany({
      where: { teamId, playerId, status: 'ACTIVE' },
      data: { status: 'REMOVED', removedAt: new Date() },
    });
    if (!res.count) throw new NotFoundException('Player is not in this team');
    await this.prisma.team.updateMany({ where: { id: teamId, captainId: playerId }, data: { captainId: null } });
    await this.prisma.team.updateMany({ where: { id: teamId, wicketKeeperId: playerId }, data: { wicketKeeperId: null } });
    await this.audit.log({ userId: user.id, entityType: 'TEAM', entityId: teamId, action: isSelf ? 'LEAVE' : 'REMOVE_PLAYER', oldValue: { playerId } });
    return { removed: true };
  }

  /** Users that can approve requests for this team (captain, manager, creator). */
  async teamAdmins(teamId: string) {
    const t = await this.prisma.team.findUnique({ where: { id: teamId }, select: { createdById: true, managerId: true, captain: { select: { userId: true } } } });
    return [t?.createdById, t?.managerId, t?.captain?.userId].filter(Boolean) as string[];
  }

  private async grantContextRoles(teamId: string) {
    const t = await this.prisma.team.findUnique({ where: { id: teamId }, select: { managerId: true, captain: { select: { userId: true } } } });
    if (t?.captain?.userId) await this.roles.assign(t.captain.userId, [RoleName.TEAM_CAPTAIN]);
    if (t?.managerId) await this.roles.assign(t.managerId, [RoleName.TEAM_MANAGER]);
  }
}
