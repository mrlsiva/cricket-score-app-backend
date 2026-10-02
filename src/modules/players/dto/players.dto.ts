import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BattingStyle, BowlingArm, BowlingStyle, PlayerRole, RequestStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class UpdatePlayerDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @ApiPropertyOptional({ minimum: 0, maximum: 999 }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(999) jerseyNumber?: number;
  @ApiPropertyOptional({ enum: PlayerRole }) @IsOptional() @IsEnum(PlayerRole) role?: PlayerRole;
  @ApiPropertyOptional({ enum: BattingStyle }) @IsOptional() @IsEnum(BattingStyle) battingStyle?: BattingStyle;
  @ApiPropertyOptional({ enum: BowlingStyle }) @IsOptional() @IsEnum(BowlingStyle) bowlingStyle?: BowlingStyle;
  @ApiPropertyOptional({ enum: BowlingArm }) @IsOptional() @IsEnum(BowlingArm) bowlingArm?: BowlingArm;
}

export class PlayerQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'true = only quick-match temporary players, false = only registered' })
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : value === true || value === 'true'))
  @IsBoolean()
  temporary?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsUUID() teamId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() matchId?: string;
  @ApiPropertyOptional({ enum: PlayerRole }) @IsOptional() @IsEnum(PlayerRole) role?: PlayerRole;
}

export class CreateClaimDto {
  @ApiProperty({ description: 'Temporary (quick match) player whose records you want to claim' })
  @IsUUID()
  temporaryPlayerId!: string;

  @ApiPropertyOptional({ example: 'I played as T3 in the Sunday match' }) @IsOptional() @IsString() @MaxLength(255) message?: string;
}

export class ClaimQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RequestStatus, default: RequestStatus.PENDING }) @IsOptional() @IsEnum(RequestStatus) status?: RequestStatus;
}
