import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommentaryType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class CommentaryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter by innings number (1, 2, 3 = super over...)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  inningsNumber?: number;

  @ApiPropertyOptional({ enum: CommentaryType, isArray: true, description: 'Comma separated, e.g. WICKET,SIX,BOUNDARY' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsArray()
  @IsEnum(CommentaryType, { each: true })
  types?: CommentaryType[];
}

export class CreateCommentaryDto {
  @ApiProperty({ example: 'Drinks break. Great contest so far.' }) @IsString() @MinLength(1) @MaxLength(2000) text!: string;
}
