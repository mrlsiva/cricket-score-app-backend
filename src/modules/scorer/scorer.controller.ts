import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { ScorerService } from './scorer.service';

class TransferDto {
  @ApiProperty({ description: 'User who will take over scoring' }) @IsUUID() toUserId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

class AssignScorerDto extends TransferDto {
  @ApiPropertyOptional({ description: 'Override the current scorer (organizer force transfer)', default: false })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

@ApiTags('Scorer Management')
@ApiBearerAuth()
@Controller()
export class ScorerController {
  constructor(private readonly scorer: ScorerService) {}

  @Get('matches/:matchId/scorer')
  @ApiOperation({ summary: 'Current scorer, my mode (SCORER / VIEWER) and pending transfer' })
  status(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.scorer.status(user, matchId);
  }

  @Post('matches/:matchId/scorer/claim')
  @HttpCode(200)
  @ApiOperation({ summary: 'Claim a free scorer lock (organizer)' })
  claim(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.scorer.acquire(user, matchId);
  }

  @Post('matches/:matchId/scorer/assign')
  @HttpCode(200)
  @ApiOperation({ summary: 'Organizer assigns the scorer; with force=true performs a force transfer' })
  assign(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: AssignScorerDto) {
    return this.scorer.assign(user, matchId, dto.toUserId, !!dto.force, dto.reason);
  }

  @Post('matches/:matchId/scorer/force-transfer')
  @HttpCode(200)
  @ApiOperation({ summary: 'Organizer force transfer (no acceptance required)' })
  force(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: TransferDto) {
    return this.scorer.assign(user, matchId, dto.toUserId, true, dto.reason);
  }

  @Post('matches/:matchId/scorer/release')
  @HttpCode(200)
  @ApiOperation({ summary: 'Release the scorer lock' })
  release(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.scorer.release(user, matchId);
  }

  @Post('matches/:matchId/scorer/heartbeat')
  @HttpCode(200)
  @ApiOperation({ summary: 'Scorer keep-alive (lets organizers see if the scorer is still active)' })
  heartbeat(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.scorer.heartbeat(user, matchId);
  }

  @Post('matches/:matchId/scorer/transfer')
  @ApiOperation({
    summary: 'Request scorer transfer (current scorer → another user)',
    description: '1. Send request → 2. target accepts (POST /scorer/transfers/:id/accept) → 3. lock changes → 4. `scorer:changed` broadcast. Requests expire after 5 minutes.',
  })
  transfer(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: TransferDto) {
    return this.scorer.requestTransfer(user, matchId, dto.toUserId, dto.reason);
  }

  @Get('matches/:matchId/scorer/history')
  @ApiOperation({ summary: 'Scorer transfer history' })
  history(@Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.scorer.history(matchId);
  }

  @Get('scorer/transfers/pending')
  @ApiOperation({ summary: 'Transfer requests waiting for my response' })
  pending(@CurrentUser('id') userId: string) {
    return this.scorer.myPendingTransfers(userId);
  }

  @Post('scorer/transfers/:transferId/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept a scorer transfer' })
  accept(@CurrentUser() user: AuthUser, @Param('transferId', ParseUUIDPipe) id: string) {
    return this.scorer.respond(user, id, true);
  }

  @Post('scorer/transfers/:transferId/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a scorer transfer' })
  reject(@CurrentUser() user: AuthUser, @Param('transferId', ParseUUIDPipe) id: string) {
    return this.scorer.respond(user, id, false);
  }

  @Post('scorer/transfers/:transferId/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel my outgoing transfer request' })
  cancel(@CurrentUser() user: AuthUser, @Param('transferId', ParseUUIDPipe) id: string) {
    return this.scorer.cancel(user, id);
  }
}
