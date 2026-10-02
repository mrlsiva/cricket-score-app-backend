import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class NotificationQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unreadOnly?: boolean;

  @ApiPropertyOptional({ enum: NotificationType }) @IsOptional() @IsEnum(NotificationType) type?: NotificationType;
}

export class RegisterDeviceDto {
  @ApiProperty({ description: 'FCM registration token' }) @IsString() @MinLength(10) @MaxLength(512) token!: string;
  @ApiPropertyOptional({ enum: ['android', 'ios', 'web'], default: 'android' }) @IsOptional() @IsIn(['android', 'ios', 'web']) platform?: string;
}

export class TopicDto {
  @ApiProperty({ example: 'match_2b0c6f0e-0000-0000-0000-000000000000' }) @IsString() topic!: string;
}
