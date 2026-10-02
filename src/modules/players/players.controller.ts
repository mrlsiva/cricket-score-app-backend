import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { ReviewDto } from '../teams/dto/teams.dto';
import { ClaimQueryDto, CreateClaimDto, PlayerQueryDto, UpdatePlayerDto } from './dto/players.dto';
import { PlayersService } from './players.service';

@ApiTags('Players')
@ApiBearerAuth()
@Controller('players')
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  @Get()
  @ApiOperation({ summary: 'Search players. Filters: temporary, teamId, matchId, role. Sort: name | createdAt | jerseyNumber' })
  list(@Query() q: PlayerQueryDto) {
    return this.players.list(q);
  }

  @Get('me')
  @ApiOperation({ summary: 'My permanent player profile with career stats (created on first access)' })
  me(@CurrentUser('id') userId: string) {
    return this.players.me(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update my player profile (jersey, role, batting / bowling style...)' })
  updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdatePlayerDto) {
    return this.players.updateMe(userId, dto);
  }

  // ── Claims ──
  @Post('claims')
  @ApiOperation({
    summary: 'Claim records of a temporary quick-match player',
    description: 'Flow: login → request claim → organizer / captain approves → records merged into your profile → career stats recalculated.',
  })
  claim(@CurrentUser() user: AuthUser, @Body() dto: CreateClaimDto) {
    return this.players.requestClaim(user, dto);
  }

  @Get('claims/mine')
  @ApiOperation({ summary: 'My claim requests' })
  myClaims(@CurrentUser('id') userId: string) {
    return this.players.myClaims(userId);
  }

  @Get('claims/review')
  @ApiOperation({ summary: 'Claims I can approve (organizer / captain / manager)' })
  reviewable(@CurrentUser() user: AuthUser, @Query() q: ClaimQueryDto) {
    return this.players.reviewableClaims(user, q);
  }

  @Post('claims/:claimId/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve claim and merge records' })
  approve(@CurrentUser() user: AuthUser, @Param('claimId', ParseUUIDPipe) id: string) {
    return this.players.reviewClaim(user, id, true);
  }

  @Post('claims/:claimId/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject claim' })
  reject(@CurrentUser() user: AuthUser, @Param('claimId', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.players.reviewClaim(user, id, false, dto.reason);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Player profile with career statistics, teams and awards' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.players.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a player (temporary players: by team / match organizer)' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlayerDto) {
    return this.players.update(user, id, dto);
  }
}
