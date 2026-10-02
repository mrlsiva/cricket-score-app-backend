import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RoleName } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { ACCOUNT_TYPE_ROLES } from '../../common/constants/permissions';
import { JwtPayload } from '../../common/interfaces/auth-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { RolesService } from '../roles/roles.service';
import { OnboardingDto } from './dto/auth.dto';

interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  photoUrl?: string;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly google = new OAuth2Client();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly roles: RolesService,
  ) {}

  publicConfig() {
    return {
      googleClientId: this.config.get<string[]>('google.clientIds')![0] ?? null,
      devLogin: !!this.config.get<boolean>('auth.devLogin'),
    };
  }

  /** Verifies a Google ID token (signature, expiry, audience, verified email). */
  async verifyGoogleToken(idToken: string): Promise<GoogleProfile> {
    const audience = this.config.get<string[]>('google.clientIds')!;
    if (!audience.length) throw new UnauthorizedException('Google Sign-In is not configured on the server');
    try {
      const ticket = await this.google.verifyIdToken({ idToken, audience });
      const p = ticket.getPayload();
      if (!p?.sub || !p.email) throw new Error('incomplete payload');
      if (!p.email_verified) throw new Error('email not verified');
      return { googleId: p.sub, email: p.email.toLowerCase(), name: p.name ?? p.email.split('@')[0], photoUrl: p.picture };
    } catch (e: any) {
      this.logger.warn(`Google token rejected: ${e.message}`);
      throw new UnauthorizedException('Invalid Google ID token');
    }
  }

  async loginWithGoogle(idToken: string, meta: { ip?: string; userAgent?: string }) {
    const profile = await this.verifyGoogleToken(idToken);
    return this.loginProfile(profile, meta);
  }

  /** Development-only login that bypasses Google (AUTH_DEV_LOGIN=true, never in production). */
  async devLogin(email: string, name: string, meta: { ip?: string; userAgent?: string }) {
    if (!this.config.get<boolean>('auth.devLogin')) throw new ForbiddenException('Dev login is disabled');
    return this.loginProfile({ googleId: `dev-${sha256(email.toLowerCase()).slice(0, 40)}`, email: email.toLowerCase(), name }, meta);
  }

  private async loginProfile(profile: GoogleProfile, meta: { ip?: string; userAgent?: string }) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ googleId: profile.googleId }, { email: profile.email }] },
    });
    if (existing?.deletedAt || existing?.isActive === false) throw new ForbiddenException('Account is disabled');

    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: { googleId: profile.googleId, lastLoginAt: new Date(), photoUrl: existing.photoUrl ?? profile.photoUrl },
        })
      : await this.prisma.user.create({
          data: { googleId: profile.googleId, email: profile.email, name: profile.name, photoUrl: profile.photoUrl, lastLoginAt: new Date() },
        });

    if (this.config.get<string[]>('auth.superAdminEmails')!.includes(user.email)) {
      await this.roles.assign(user.id, [RoleName.SUPER_ADMIN]);
    }
    return this.issueTokens(user.id, meta, !existing);
  }

  async onboard(userId: string, dto: OnboardingDto) {
    const roles = [...new Set(dto.accountTypes.flatMap((t) => ACCOUNT_TYPE_ROLES[t]))];
    await this.roles.assign(userId, roles as RoleName[]);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { isOnboarded: true, city: dto.city, mobile: dto.mobile },
    });
    // Every Individual gets a permanent player profile.
    if (dto.accountTypes.includes('INDIVIDUAL')) {
      await this.prisma.player.upsert({
        where: { userId },
        update: {},
        create: { userId, name: user.name, photoUrl: user.photoUrl, createdById: userId },
      });
    }
    return this.profile(userId);
  }

  async refresh(refreshToken: string, meta: { ip?: string; userAgent?: string }) {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!record || record.expiresAt < new Date()) throw new UnauthorizedException('Invalid refresh token');
    if (record.revokedAt) {
      // Token reuse detected -> revoke the whole family for safety.
      await this.prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Refresh token reuse detected; please sign in again');
    }
    await this.prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    return this.issueTokens(record.userId, meta, false);
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: sha256(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
    return { loggedOut: true };
  }

  async profile(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: { include: { role: true } }, player: true },
    });
    const { roles, ...rest } = user;
    return { ...rest, roles: roles.map((r) => r.role.name) };
  }

  private async issueTokens(userId: string, meta: { ip?: string; userAgent?: string }, isNewUser: boolean) {
    const user = await this.profile(userId);
    const payload: JwtPayload = { sub: user.id, email: user.email, type: 'access' };
    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = randomBytes(48).toString('base64url');
    const days = this.config.get<number>('jwt.refreshExpiresDays')!;
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + days * 86400_000),
        ip: meta.ip?.slice(0, 64),
        userAgent: meta.userAgent?.slice(0, 255),
      },
    });
    const decoded = this.jwt.decode(accessToken) as { exp: number; iat: number };
    return {
      accessToken,
      refreshToken,
      expiresIn: decoded.exp - decoded.iat,
      isNewUser,
      requiresOnboarding: !user.isOnboarded,
      user,
    };
  }
}
