import { ApiPropertyOptional } from '@nestjs/swagger';
import { RoleName } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class UpdateMeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) city?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\+?[0-9]{7,15}$/, { message: 'mobile must be a valid phone number' })
  mobile?: string;
}

export class UserQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional({ enum: RoleName }) @IsOptional() @IsEnum(RoleName) role?: RoleName;
}

export class UpdateUserStatusDto {
  @ApiPropertyOptional() @IsBoolean() isActive!: boolean;
}
