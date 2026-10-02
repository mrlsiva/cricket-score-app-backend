import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import {
  AddBallDto,
  BallQueryDto,
  ChangeBowlerDto,
  EditBallDto,
  NonDeliveryDismissalDto,
  PenaltyDto,
  ReasonDto,
  RequiredReasonDto,
  SetBatsmenDto,
  StartInningsDto,
  SyncDto,
} from './dto/scoring.dto';
import { InningsService } from './innings.service';
import { MatchStateService } from './match-state.service';
import { ScoringService } from './scoring.service';

const WRITE_NOTE = 'Requires the scorer lock (viewers get 403). Response contains the updated live snapshot, which is also broadcast on `score:updated`.';

@ApiTags('Live Scoring')
@ApiBearerAuth()
@Controller('matches/:matchId')
export class ScoringController {
  constructor(
    private readonly scoring: ScoringService,
    private readonly innings: InningsService,
    private readonly state: MatchStateService,
  ) {}

  // ─────────────── read (spectators) ───────────────

  @Get('live')
  @ApiOperation({ summary: 'Live score snapshot (score, CRR, target, RRR, batters, bowler, this over, partnership)' })
  live(@Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.state.snapshot(matchId);
  }

  @Get('scorecard')
  @ApiOperation({ summary: 'Full scorecard for every innings' })
  scorecard(@Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.state.scorecard(matchId);
  }

  @Get('graphs')
  @ApiOperation({ summary: 'Worm & Manhattan graph data per innings' })
  graphs(@Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.state.graphs(matchId);
  }

  @Get('balls')
  @ApiOperation({ summary: 'Ball log (incremental with afterSequence)' })
  balls(@Param('matchId', ParseUUIDPipe) matchId: string, @Query() q: BallQueryDto) {
    return this.scoring.listBalls(matchId, q);
  }

  @Get('resume-state')
  @ApiOperation({ summary: 'Resume interrupted match: snapshot, scorer status, active innings, last ball, squads and synced ball ids' })
  resumeState(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.scoring.resumeState(user, matchId);
  }

  // ─────────────── innings lifecycle ───────────────

  @Post('start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start match: acquires the scorer lock and opens innings 1 with openers & bowler', description: WRITE_NOTE })
  start(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: StartInningsDto) {
    return this.innings.startMatch(user, matchId, dto);
  }

  @Post('innings')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start the next innings after an innings break (target is set automatically)', description: WRITE_NOTE })
  nextInnings(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: StartInningsDto) {
    return this.innings.startNextInnings(user, matchId, dto);
  }

  @Post('innings/end')
  @HttpCode(200)
  @ApiOperation({ summary: 'End the current innings (End Innings button)', description: WRITE_NOTE })
  endInnings(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: ReasonDto) {
    return this.innings.manualEnd(user, matchId, dto.reason);
  }

  @Post('super-over')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start a super over after a tie (team batting second bats first)', description: WRITE_NOTE })
  superOver(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: StartInningsDto) {
    return this.innings.startSuperOver(user, matchId, dto);
  }

  @Post('pause')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pause match (rain, bad light...)' })
  pause(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: ReasonDto) {
    return this.innings.setPaused(user, matchId, true, dto.reason);
  }

  @Post('resume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resume a paused match' })
  resume(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: ReasonDto) {
    return this.innings.setPaused(user, matchId, false, dto.reason);
  }

  // ─────────────── ball by ball ───────────────

  @Post('balls')
  @ApiOperation({
    summary: 'Score a ball',
    description:
      WRITE_NOTE +
      '\n\nExamples:\n- Dot: `{ "runs": 0 }`\n- Four: `{ "runs": 4 }`\n- Wide + 1 run: `{ "runs": 1, "extraType": "WIDE" }`\n' +
      '- No-ball hit for six: `{ "runs": 6, "extraType": "NO_BALL" }`\n- Leg byes: `{ "runs": 2, "extraType": "LEG_BYE" }`\n' +
      '- Caught: `{ "runs": 0, "wicketType": "CAUGHT", "fielderId": "..." }`\n- Run out of non-striker on 1st run: `{ "runs": 0, "wicketType": "RUN_OUT", "dismissedPlayerId": "...", "fielderId": "..." }`\n\n' +
      'Send a client `id` (UUID) to make retries idempotent.',
  })
  addBall(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: AddBallDto) {
    return this.scoring.addBall(user, matchId, dto);
  }

  @Post('balls/undo')
  @HttpCode(200)
  @ApiOperation({ summary: 'Undo last ball (restores batters / bowler, re-opens an innings it had ended)', description: WRITE_NOTE })
  undo(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: ReasonDto) {
    return this.scoring.undo(user, matchId, dto.reason);
  }

  @Patch('balls/:ballId')
  @ApiOperation({ summary: 'Edit any ball (innings is replayed; audited with reason)', description: WRITE_NOTE })
  edit(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Param('ballId', ParseUUIDPipe) ballId: string, @Body() dto: EditBallDto) {
    return this.scoring.editBall(user, matchId, ballId, dto);
  }

  @Delete('balls/:ballId')
  @ApiOperation({ summary: 'Delete any ball (innings is replayed; audited with reason)', description: WRITE_NOTE })
  remove(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Param('ballId', ParseUUIDPipe) ballId: string, @Body() dto: RequiredReasonDto) {
    return this.scoring.deleteBall(user, matchId, ballId, dto.reason);
  }

  @Post('balls/sync')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Offline sync: upload balls recorded without internet',
    description: 'Balls are applied in clientSequence order; ids already stored are reported as DUPLICATE; processing stops at the first REJECTED ball (later ones SKIPPED).',
  })
  sync(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: SyncDto) {
    return this.scoring.sync(user, matchId, dto);
  }

  @Post('penalty')
  @ApiOperation({ summary: 'Award penalty runs to the batting side', description: WRITE_NOTE })
  penalty(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: PenaltyDto) {
    return this.scoring.addPenalty(user, matchId, dto);
  }

  @Post('dismissal')
  @ApiOperation({ summary: 'Retired hurt / timed out (not a delivery)', description: WRITE_NOTE })
  dismissal(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: NonDeliveryDismissalDto) {
    return this.scoring.addDismissal(user, matchId, dto);
  }

  @Post('strike/swap')
  @HttpCode(200)
  @ApiOperation({ summary: 'Change striker (swap ends)', description: WRITE_NOTE })
  swap(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.scoring.swapStrike(user, matchId);
  }

  @Post('batsmen')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set batters (new batter after a wicket, returning retired batter...)', description: WRITE_NOTE })
  batsmen(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: SetBatsmenDto) {
    return this.scoring.setBatsmen(user, matchId, dto);
  }

  @Post('bowler')
  @HttpCode(200)
  @ApiOperation({ summary: 'Change bowler (new over or mid-over replacement)', description: WRITE_NOTE })
  bowler(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: ChangeBowlerDto) {
    return this.scoring.changeBowler(user, matchId, dto);
  }

  @Post('over/end')
  @HttpCode(200)
  @ApiOperation({ summary: 'End over early (short over): swaps ends and asks for a new bowler', description: WRITE_NOTE })
  endOver(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.scoring.endOver(user, matchId);
  }
}
