import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExtraType, WicketType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const DELIVERY_EXTRAS = ['NONE', 'WIDE', 'NO_BALL', 'BYE', 'LEG_BYE'] as const;
export const DELIVERY_WICKETS = ['BOWLED', 'CAUGHT', 'LBW', 'RUN_OUT', 'STUMPED', 'HIT_WICKET'] as const;

export class StartInningsDto {
  @ApiProperty() @IsUUID() strikerId!: string;
  @ApiProperty() @IsUUID() nonStrikerId!: string;
  @ApiProperty() @IsUUID() bowlerId!: string;
}

export class AddBallDto {
  @ApiPropertyOptional({ description: 'Client generated UUID (required for offline sync; makes the call idempotent)' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({
    minimum: 0,
    maximum: 7,
    description: 'NONE: runs off bat. WIDE: extra runs ran/boundary beyond the wide. NO_BALL: runs off bat (or byes, see noBallRunsType). BYE/LEG_BYE: runs.',
    example: 1,
  })
  @IsInt()
  @Min(0)
  @Max(7)
  runs!: number;

  @ApiPropertyOptional({ enum: DELIVERY_EXTRAS, default: 'NONE' })
  @IsOptional()
  @IsIn(DELIVERY_EXTRAS as unknown as string[])
  extraType?: Exclude<ExtraType, 'PENALTY'>;

  @ApiPropertyOptional({ enum: ['BAT', 'BYE', 'LEG_BYE'], default: 'BAT' })
  @IsOptional()
  @IsIn(['BAT', 'BYE', 'LEG_BYE'])
  noBallRunsType?: 'BAT' | 'BYE' | 'LEG_BYE';

  @ApiPropertyOptional({ description: 'Defaults to true for 4 / 6. Set false for an all-run four.' })
  @IsOptional()
  @IsBoolean()
  isBoundary?: boolean;

  @ApiPropertyOptional({ enum: DELIVERY_WICKETS })
  @IsOptional()
  @IsIn(DELIVERY_WICKETS as unknown as string[])
  wicketType?: WicketType;

  @ApiPropertyOptional({ description: 'Defaults to striker. For run outs may be the non-striker.' })
  @IsOptional()
  @IsUUID()
  dismissedPlayerId?: string;

  @ApiPropertyOptional({ description: 'Catcher / run-out fielder / wicket keeper' }) @IsOptional() @IsUUID() fielderId?: string;

  @ApiPropertyOptional({ description: 'Overrides current striker (always send when scoring offline)' }) @IsOptional() @IsUUID() strikerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() nonStrikerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() bowlerId?: string;

  @ApiPropertyOptional({ description: 'Allow the previous over bowler to bowl consecutive overs', default: false })
  @IsOptional()
  @IsBoolean()
  allowConsecutiveOvers?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsDateString() clientCreatedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) clientSequence?: number;
}

export class EditBallDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 7 }) @IsOptional() @IsInt() @Min(0) @Max(7) runs?: number;
  @ApiPropertyOptional({ enum: DELIVERY_EXTRAS }) @IsOptional() @IsIn(DELIVERY_EXTRAS as unknown as string[]) extraType?: Exclude<ExtraType, 'PENALTY'>;
  @ApiPropertyOptional({ enum: ['BAT', 'BYE', 'LEG_BYE'] }) @IsOptional() @IsIn(['BAT', 'BYE', 'LEG_BYE']) noBallRunsType?: 'BAT' | 'BYE' | 'LEG_BYE';
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isBoundary?: boolean;
  @ApiPropertyOptional({ enum: DELIVERY_WICKETS, nullable: true, description: 'null removes the wicket' })
  @IsOptional()
  @IsIn([...DELIVERY_WICKETS, null])
  wicketType?: WicketType | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() dismissedPlayerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() fielderId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() batsmanId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() nonStrikerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() bowlerId?: string;
  @ApiProperty({ example: 'Scorer mis-tapped 4 instead of 1' }) @IsString() @MinLength(3) @MaxLength(255) reason!: string;
}

export class ReasonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

export class RequiredReasonDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(255) reason!: string;
}

export class SetBatsmenDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() strikerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() nonStrikerId?: string;
}

export class ChangeBowlerDto {
  @ApiProperty() @IsUUID() bowlerId!: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() allowConsecutiveOvers?: boolean;
}

export class PenaltyDto {
  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 10 }) @IsOptional() @IsInt() @Min(1) @Max(10) runs?: number;
  @ApiProperty({ example: 'Ball hit fielding helmet' }) @IsString() @MinLength(3) @MaxLength(255) reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() id?: string;
}

export class NonDeliveryDismissalDto {
  @ApiProperty() @IsUUID() playerId!: string;
  @ApiProperty({ enum: ['RETIRED_HURT', 'TIMED_OUT'] }) @IsIn(['RETIRED_HURT', 'TIMED_OUT']) wicketType!: 'RETIRED_HURT' | 'TIMED_OUT';
  @ApiPropertyOptional() @IsOptional() @IsUUID() id?: string;
}

export class SyncBallDto extends AddBallDto {
  @ApiProperty() @IsUUID() declare id: string;
  @ApiProperty({ description: 'Order in which the ball was recorded offline' }) @IsInt() @Min(0) declare clientSequence: number;
  @ApiPropertyOptional({ description: 'Innings the ball belongs to (rejected if it no longer matches)' }) @IsOptional() @IsInt() @Min(1) inningsNumber?: number;
}

export class SyncDto {
  @ApiProperty({ type: [SyncBallDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => SyncBallDto)
  balls!: SyncBallDto[];
}

export class BallQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) inningsNumber?: number;
  @ApiPropertyOptional({ description: 'Only balls with sequence greater than this (incremental fetch)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  afterSequence?: number;
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeDeleted?: boolean;
}
