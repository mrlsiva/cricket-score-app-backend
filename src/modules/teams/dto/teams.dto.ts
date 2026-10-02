import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { RequestStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsHexColor, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CreateTeamDto {
  @ApiProperty({ example: 'Chennai Strikers' }) @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiPropertyOptional({ example: 'CHS' }) @IsOptional() @IsString() @MaxLength(10) shortName?: string;
  @ApiPropertyOptional({ example: '#FFCC00' }) @IsOptional() @IsHexColor() color?: string;
  @ApiPropertyOptional({ description: 'Logo URL (or upload via POST /teams/:id/logo)' }) @IsOptional() @IsString() @MaxLength(1024) logoUrl?: string;
  @ApiPropertyOptional({ description: 'Player id of captain (must be in squad)' }) @IsOptional() @IsUUID() captainId?: string;
  @ApiPropertyOptional({ description: 'User id of team manager' }) @IsOptional() @IsUUID() managerId?: string;
  @ApiPropertyOptional({ description: 'Player id of wicket keeper (must be in squad)' }) @IsOptional() @IsUUID() wicketKeeperId?: string;
  @ApiPropertyOptional({ description: 'Add my own player profile to the squad', default: false })
  @IsOptional()
  @IsBoolean()
  joinAsPlayer?: boolean;
}

export class UpdateTeamDto extends PartialType(CreateTeamDto) {}

export class TeamQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Only teams I created/manage/play for' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  mine?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsUUID() tournamentId?: string;

  @ApiPropertyOptional({ description: 'Include temporary quick-match teams', default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  includeTemporary?: boolean;
}

export class JoinTeamDto {
  @ApiProperty({ description: 'Join code or QR token scanned from the team QR', example: 'K7M2QX9A' })
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  code!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) message?: string;
}

export class AddTeamPlayerDto {
  @ApiPropertyOptional({ description: 'Existing player id' })
  @ValidateIf((o) => !o.name)
  @IsUUID()
  playerId?: string;

  @ApiPropertyOptional({ description: 'Create a temporary (unregistered) player with this name' })
  @ValidateIf((o) => !o.playerId)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;
}

export class JoinRequestQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: RequestStatus, default: RequestStatus.PENDING })
  @IsOptional()
  @IsEnum(RequestStatus)
  status?: RequestStatus;
}

export class ReviewDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) reason?: string;
}
