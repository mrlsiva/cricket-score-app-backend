import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { BallType, TournamentStatus, TournamentType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CreateTournamentDto {
  @ApiProperty({ example: 'Chennai Premier League 2026' }) @IsString() @MinLength(3) @MaxLength(150) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) description?: string;
  @ApiProperty({ enum: TournamentType }) @IsEnum(TournamentType) type!: TournamentType;
  @ApiProperty({ example: 20 }) @IsInt() @Min(1) @Max(100) overs!: number;
  @ApiProperty({ example: 11 }) @IsInt() @Min(2) @Max(15) playersPerTeam!: number;
  @ApiPropertyOptional({ enum: BallType, default: BallType.TENNIS }) @IsOptional() @IsEnum(BallType) ballType?: BallType;
  @ApiPropertyOptional({ example: 'Marina Ground' }) @IsOptional() @IsString() @MaxLength(150) ground?: string;
  @ApiPropertyOptional({ example: 'Chennai' }) @IsOptional() @IsString() @MaxLength(100) city?: string;
  @ApiPropertyOptional({ example: '2026', description: 'Defaults to the start year' }) @IsOptional() @IsString() @MaxLength(20) season?: string;
  @ApiProperty({ example: '2026-10-01' }) @IsDateString() startDate!: string;
  @ApiProperty({ example: '2026-10-20' }) @IsDateString() endDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1024) logoUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1024) bannerUrl?: string;
}

export class UpdateTournamentDto extends PartialType(CreateTournamentDto) {
  @ApiPropertyOptional({ enum: TournamentStatus }) @IsOptional() @IsEnum(TournamentStatus) status?: TournamentStatus;
}

export class TournamentQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: TournamentStatus }) @IsOptional() @IsEnum(TournamentStatus) status?: TournamentStatus;
  @ApiPropertyOptional({ enum: TournamentType }) @IsOptional() @IsEnum(TournamentType) type?: TournamentType;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() season?: string;
  @ApiPropertyOptional({ description: 'Tournaments I organize' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  mine?: boolean;
}

export class AddTournamentTeamDto {
  @ApiPropertyOptional({ description: 'Existing team id' })
  @ValidateIf((o) => !o.name)
  @IsUUID()
  teamId?: string;

  @ApiPropertyOptional({ description: 'Or create a new team with this name' })
  @ValidateIf((o) => !o.teamId)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 'A' }) @IsOptional() @IsString() @MaxLength(20) groupName?: string;
  @ApiPropertyOptional({ description: 'Seed for knockout draws (1 = top seed)' }) @IsOptional() @IsInt() @Min(1) seed?: number;
}

export class GenerateFixturesDto {
  @ApiPropertyOptional({ default: 2 }) @IsOptional() @IsInt() @Min(1) @Max(10) matchesPerDay?: number;
  @ApiPropertyOptional({ default: '09:00' }) @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) startTime?: string;
  @ApiPropertyOptional({ default: 240, description: 'Minutes between matches on the same day' }) @IsOptional() @IsInt() @Min(30) @Max(720) gapMinutes?: number;
  @ApiPropertyOptional({ default: false, description: 'League: play each opponent twice' }) @IsOptional() @IsBoolean() doubleRoundRobin?: boolean;
  @ApiPropertyOptional({ default: false, description: 'Delete existing unplayed fixtures and regenerate' }) @IsOptional() @IsBoolean() regenerate?: boolean;
  @ApiPropertyOptional({ default: 4, description: 'League+Knockout: teams qualifying for knockouts (2, 4 or 8)' })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(8)
  qualifiers?: number;
}
