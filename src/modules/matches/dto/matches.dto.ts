import { ApiProperty, ApiPropertyOptional, OmitType, PartialType, PickType } from '@nestjs/swagger';
import { BallType, MatchStage, MatchStatus, PitchType, ResultType, TossDecision, WinMarginType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

class MatchOptionsDto {
  @ApiPropertyOptional({ example: 'Sunday Friendly' }) @IsOptional() @IsString() @MaxLength(150) name?: string;
  @ApiPropertyOptional({ example: 'Marina Ground' }) @IsOptional() @IsString() @MaxLength(150) ground?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() scheduledAt?: string;
  @ApiPropertyOptional({ enum: BallType }) @IsOptional() @IsEnum(BallType) ballType?: BallType;
  @ApiPropertyOptional({ enum: PitchType }) @IsOptional() @IsEnum(PitchType) pitchType?: PitchType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) umpireName?: string;
  @ApiPropertyOptional({ default: 1, description: 'Runs awarded for a wide (0 for some local formats)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  wideRuns?: number;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(0) @Max(2) noBallRuns?: number;
  @ApiPropertyOptional({ default: 6 }) @IsOptional() @IsInt() @Min(4) @Max(8) ballsPerOver?: number;
}

export class CreateMatchDto extends MatchOptionsDto {
  @ApiProperty() @IsUUID() teamAId!: string;
  @ApiProperty() @IsUUID() teamBId!: string;
  @ApiProperty({ example: 11, minimum: 2, maximum: 15 }) @IsInt() @Min(2) @Max(15) playersPerTeam!: number;
  @ApiProperty({ example: 20, minimum: 1, maximum: 100 }) @IsInt() @Min(1) @Max(100) overs!: number;
  @ApiProperty({ description: 'Toss winner team id (teamAId or teamBId)' }) @IsUUID() tossWinnerId!: string;
  @ApiProperty({ enum: TossDecision }) @IsEnum(TossDecision) tossDecision!: TossDecision;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tournamentId?: string;
  @ApiPropertyOptional({ enum: MatchStage }) @IsOptional() @IsEnum(MatchStage) stage?: MatchStage;
  @ApiPropertyOptional({ type: [String], description: 'Playing XI of team A in batting order' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  teamAPlayerIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) teamBPlayerIds?: string[];
  @ApiPropertyOptional({ description: 'Create temporary players (T1.. / P1..) to fill squads up to playersPerTeam', default: false })
  @IsOptional()
  @IsBoolean()
  fillWithTemporaryPlayers?: boolean;
}

export class QuickMatchDto extends MatchOptionsDto {
  @ApiProperty({ example: 'Team A' }) @IsString() @MinLength(1) @MaxLength(120) teamAName!: string;
  @ApiProperty({ example: 'Team B' }) @IsString() @MinLength(1) @MaxLength(120) teamBName!: string;
  @ApiProperty({ example: 8 }) @IsInt() @Min(2) @Max(15) playersPerTeam!: number;
  @ApiProperty({ example: 6 }) @IsInt() @Min(1) @Max(100) overs!: number;
  @ApiProperty({ enum: ['A', 'B'] }) @IsIn(['A', 'B']) tossWinner!: 'A' | 'B';
  @ApiProperty({ enum: TossDecision }) @IsEnum(TossDecision) tossDecision!: TossDecision;
  @ApiPropertyOptional({ default: 'T', description: 'Placeholder prefix for team A players (T → T1, T2 / BT → BT1...)' })
  @IsOptional()
  @Matches(/^[A-Z]{1,3}$/)
  prefixA?: string;
  @ApiPropertyOptional({ default: 'P', description: 'Placeholder prefix for team B players (P → P1 / BW → BW1...)' })
  @IsOptional()
  @Matches(/^[A-Z]{1,3}$/)
  prefixB?: string;
  @ApiPropertyOptional({ type: [String], description: 'Optional real names for team A (rest are placeholders)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @IsString({ each: true })
  teamAPlayerNames?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(15) @IsString({ each: true }) teamBPlayerNames?: string[];
}

export class UpdateMatchDto extends PartialType(MatchOptionsDto) {
  @ApiPropertyOptional({ description: 'Only before the match starts' }) @IsOptional() @IsInt() @Min(1) @Max(100) overs?: number;
  @ApiPropertyOptional({ description: 'Only before the match starts' }) @IsOptional() @IsInt() @Min(2) @Max(15) playersPerTeam?: number;
}

export class TossDto extends PickType(CreateMatchDto, ['tossWinnerId', 'tossDecision'] as const) {}

export class SquadDto {
  @ApiProperty() @IsUUID() teamId!: string;
  @ApiProperty({ type: [String], description: 'Players in batting order' }) @IsArray() @ArrayUnique() @ArrayMaxSize(20) @IsUUID('all', { each: true }) playerIds!: string[];
  @ApiPropertyOptional() @IsOptional() @IsUUID() captainId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() keeperId?: string;
}

export class MatchQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MatchStatus, isArray: true, description: 'Comma separated' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @IsEnum(MatchStatus, { each: true })
  status?: MatchStatus[];

  @ApiPropertyOptional() @IsOptional() @IsUUID() tournamentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() playerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() ground?: string;
  @ApiPropertyOptional({ enum: MatchStage }) @IsOptional() @IsEnum(MatchStage) stage?: MatchStage;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;

  @ApiPropertyOptional({ description: 'Matches I created, score, or play in' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  mine?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeQuick?: boolean;
}

export class ListByStatusQueryDto extends OmitType(MatchQueryDto, ['status'] as const) {}

export class ResultOverrideDto {
  @ApiProperty({ enum: ResultType }) @IsEnum(ResultType) resultType!: ResultType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() winnerTeamId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) winMargin?: number;
  @ApiPropertyOptional({ enum: WinMarginType }) @IsOptional() @IsEnum(WinMarginType) winMarginType?: WinMarginType;
  @ApiPropertyOptional({ example: 'Match abandoned due to rain' }) @IsOptional() @IsString() @MaxLength(255) resultText?: string;
  @ApiProperty({ example: 'Rain stopped play' }) @IsString() @MinLength(3) @MaxLength(255) reason!: string;
}

export class TimelineQueryDto extends PaginationQueryDto {}
