import { Body, Controller, Delete, Get, Param, ParseEnumPipe, ParseUUIDPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AwardType } from '@prisma/client';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Permission } from '../../common/constants/permissions';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { AwardsService } from './awards.service';

class OverrideAwardDto {
  @ApiProperty() @IsUUID() playerId!: string;
  @ApiPropertyOptional({ example: 'Outstanding captaincy' }) @IsOptional() @IsString() @MaxLength(255) note?: string;
}

@ApiTags('Awards')
@ApiBearerAuth()
@Controller()
export class AwardsController {
  constructor(private readonly awards: AwardsService) {}

  @Get('matches/:matchId/awards')
  @ApiOperation({ summary: 'Match awards: Man of the Match, best batsman / bowler / fielder, most sixes / fours, highest partnership' })
  match(@Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.awards.matchAwards(matchId);
  }

  @Put('matches/:matchId/awards/:type')
  @RequirePermissions(Permission.AWARD_OVERRIDE)
  @ApiOperation({ summary: 'Organizer override of a match award (e.g. MAN_OF_THE_MATCH)' })
  override(
    @CurrentUser() user: AuthUser,
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Param('type', new ParseEnumPipe(AwardType)) type: AwardType,
    @Body() dto: OverrideAwardDto,
  ) {
    return this.awards.overrideMatchAward(user, matchId, type, dto.playerId, dto.note);
  }

  @Delete('matches/:matchId/awards/:type/override')
  @RequirePermissions(Permission.AWARD_OVERRIDE)
  @ApiOperation({ summary: 'Remove an override and recompute automatically' })
  clear(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Param('type', new ParseEnumPipe(AwardType)) type: AwardType) {
    return this.awards.clearOverride(user, matchId, type);
  }

  @Get('tournaments/:tournamentId/awards')
  @ApiOperation({ summary: 'Tournament awards: Man of the Tournament, Orange / Purple cap, best batsman / bowler / all-rounder / fielder, records' })
  tournament(@Param('tournamentId', ParseUUIDPipe) tournamentId: string) {
    return this.awards.tournamentAwards(tournamentId);
  }
}
