import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { CurrentUser, Public } from '../../common/decorators';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { AuthService } from './auth.service';
import { AuthResponseDto, DevLoginDto, GoogleLoginDto, OnboardingDto, RefreshTokenDto } from './dto/auth.dto';

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('config')
  @ApiOperation({ summary: 'Public sign-in configuration for clients (Google client id, whether dev login is enabled)' })
  config() {
    return this.auth.publicConfig();
  }

  @Public()
  @Post('google')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Sign in with Google',
    description:
      '1. Android obtains a Google **ID token** (audience = Web client ID configured in GOOGLE_CLIENT_IDS).\n' +
      '2. POST it here → receive `accessToken` (JWT, short-lived) + `refreshToken` (opaque, rotating).\n' +
      '3. If `requiresOnboarding` is true, call `POST /auth/onboarding` to pick Organizer / Individual.\n' +
      '4. Send `Authorization: Bearer <accessToken>` on every request; refresh via `POST /auth/refresh`.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid Google ID token' })
  google(@Body() dto: GoogleLoginDto, @Req() req: Request) {
    return this.auth.loginWithGoogle(dto.idToken, meta(req));
  }

  @Public()
  @Post('dev-login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Development-only login without Google (disabled unless AUTH_DEV_LOGIN=true and not production)' })
  @ApiOkResponse({ type: AuthResponseDto })
  devLogin(@Body() dto: DevLoginDto, @Req() req: Request) {
    return this.auth.devLogin(dto.email, dto.name, meta(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate refresh token and obtain a new access token' })
  @ApiOkResponse({ type: AuthResponseDto })
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, meta(req));
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke a refresh token' })
  logout(@Body() dto: RefreshTokenDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Post('onboarding')
  @HttpCode(200)
  @ApiOperation({ summary: 'First-login account type selection (Organizer and/or Individual)' })
  onboarding(@CurrentUser('id') userId: string, @Body() dto: OnboardingDto) {
    return this.auth.onboard(userId, dto);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: 'Current user profile with roles and player profile' })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.profile(user.id);
  }
}
