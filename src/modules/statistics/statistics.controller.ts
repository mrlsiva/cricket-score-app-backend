import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { LEADERBOARD_CATEGORIES, LeaderboardCategory, StatisticsService } from './statistics.service';

class LeaderboardQueryDto {
  @ApiProperty({ enum: LEADERBOARD_CATEGORIES }) @IsIn(LEADERBOARD_CATEGORIES as unknown as string[]) category!: LeaderboardCategory;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tournamentId?: string;
  @ApiPropertyOptional({ example: '2026' }) @IsOptional() @IsString() @MaxLength(20) season?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) ground?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional({ default: 10 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

class HeadToHeadQueryDto {
  @ApiProperty() @IsUUID() teamA!: string;
  @ApiProperty() @IsUUID() teamB!: string;
}

class GroundQueryDto {
  @ApiProperty({ example: 'Marina Ground' }) @IsString() @MaxLength(150) name!: string;
}

@ApiTags('Statistics')
@ApiBearerAuth()
@Controller('statistics')
export class StatisticsController {
  constructor(private readonly stats: StatisticsService) {}

  @Get('leaderboards')
  @ApiOperation({ summary: 'Leaderboards (runs, wickets, sixes, fours, strikeRate, economy, catches, dismissals, mvp) scoped by tournament / season / ground / team' })
  leaderboard(@Query() q: LeaderboardQueryDto) {
    return this.stats.leaderboard(q.category, { tournamentId: q.tournamentId, season: q.season, ground: q.ground, teamId: q.teamId }, q.limit ?? 10);
  }

  @Get('players/:playerId')
  @ApiOperation({ summary: 'Player statistics: career batting / bowling / fielding + recent form' })
  player(@Param('playerId', ParseUUIDPipe) id: string) {
    return this.stats.player(id);
  }

  @Get('players/:playerId/matches')
  @ApiOperation({ summary: 'Player match-by-match statistics' })
  playerMatches(@Param('playerId', ParseUUIDPipe) id: string, @Query() q: PaginationQueryDto) {
    return this.stats.playerMatches(id, q);
  }

  @Get('teams/:teamId')
  @ApiOperation({ summary: 'Team statistics: results, form, totals, top performers' })
  team(@Param('teamId', ParseUUIDPipe) id: string) {
    return this.stats.team(id);
  }

  @Get('tournaments/:tournamentId')
  @ApiOperation({ summary: 'Tournament statistics & leaderboards' })
  tournament(@Param('tournamentId', ParseUUIDPipe) id: string) {
    return this.stats.tournament(id);
  }

  @Get('seasons/:season')
  @ApiOperation({ summary: 'Season statistics (all tournaments of a season)' })
  season(@Param('season') season: string) {
    return this.stats.season(season);
  }

  @Get('grounds')
  @ApiOperation({ summary: 'Ground statistics (averages, bat-first win %, top performers)' })
  ground(@Query() q: GroundQueryDto) {
    return this.stats.ground(q.name);
  }

  @Get('head-to-head')
  @ApiOperation({ summary: 'Head-to-head record between two teams' })
  h2h(@Query() q: HeadToHeadQueryDto) {
    return this.stats.headToHead(q.teamA, q.teamB);
  }
}
