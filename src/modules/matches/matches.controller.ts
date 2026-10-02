import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '../../common/constants/permissions';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { ReasonDto } from '../scoring/dto/scoring.dto';
import {
  CreateMatchDto,
  ListByStatusQueryDto,
  MatchQueryDto,
  QuickMatchDto,
  ResultOverrideDto,
  SquadDto,
  TimelineQueryDto,
  TossDto,
  UpdateMatchDto,
} from './dto/matches.dto';
import { MatchesService } from './matches.service';

@ApiTags('Matches')
@ApiBearerAuth()
@Controller('matches')
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a match',
    description: 'Mandatory: teams, players per team, overs, toss winner and bat/bowl decision. Tournament matches require the tournament organizer.',
  })
  @ApiCreatedResponse({ description: 'Match created with status TOSS_COMPLETED' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMatchDto) {
    return this.matches.create(user, dto);
  }

  @Post('quick')
  @RequirePermissions(Permission.MATCH_CREATE)
  @ApiOperation({ summary: 'Quick match: temporary teams with placeholder players (T1..Tn / P1..Pn), renameable and claimable later' })
  quick(@CurrentUser() user: AuthUser, @Body() dto: QuickMatchDto) {
    return this.matches.quick(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Search matches. Filters: status (comma list), tournament, team, player, ground, date range, mine. Sort: scheduledAt | createdAt | completedAt | startedAt' })
  list(@CurrentUser() user: AuthUser, @Query() q: MatchQueryDto) {
    return this.matches.list(user, q);
  }

  @Get('live')
  @ApiOperation({ summary: 'Live matches (LIVE + INNINGS_BREAK)' })
  live(@CurrentUser() user: AuthUser, @Query() q: ListByStatusQueryDto) {
    return this.matches.list(user, { ...q, status: ['LIVE', 'INNINGS_BREAK'], includeQuick: true } as MatchQueryDto);
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'Upcoming matches (SCHEDULED + TOSS_COMPLETED), soonest first' })
  upcoming(@CurrentUser() user: AuthUser, @Query() q: ListByStatusQueryDto) {
    return this.matches.list(user, { ...q, status: ['SCHEDULED', 'TOSS_COMPLETED'], sortBy: q.sortBy ?? 'scheduledAt', sortOrder: q.sortBy ? q.sortOrder : 'asc' } as MatchQueryDto);
  }

  @Get('completed')
  @ApiOperation({ summary: 'Completed matches, most recent first' })
  completed(@CurrentUser() user: AuthUser, @Query() q: ListByStatusQueryDto) {
    return this.matches.list(user, { ...q, status: ['COMPLETED'], sortBy: q.sortBy ?? 'completedAt' } as MatchQueryDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Match details (teams, squads, innings summary, scorer, awards)' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.matches.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit match (format fields only before start)' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMatchDto) {
    return this.matches.update(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete match (soft delete; statistics are recalculated)' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.matches.remove(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel match' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.matches.cancel(user, id, dto.reason);
  }

  @Post(':id/toss')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record toss for a scheduled match' })
  toss(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TossDto) {
    return this.matches.toss(user, id, dto);
  }

  @Post(':id/squads')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set playing XI of a team (batting order). During play, players can only be added.' })
  squad(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SquadDto) {
    return this.matches.setSquad(user, id, dto);
  }

  @Post(':id/result')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set / override result (no result, abandoned, awarded...) - organizer, audited' })
  result(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResultOverrideDto) {
    return this.matches.overrideResult(user, id, dto);
  }

  @Get(':id/timeline')
  @ApiOperation({ summary: 'Match timeline: every scoring event (ball added / edited / undone, strike & bowler changes, pauses...)' })
  timeline(@Param('id', ParseUUIDPipe) id: string, @Query() q: TimelineQueryDto) {
    return this.matches.timeline(id, q);
  }
}
