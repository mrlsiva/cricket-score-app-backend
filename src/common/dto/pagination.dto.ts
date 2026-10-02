import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Paginated } from '../interceptors/response.interceptor';

export class PaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Free-text search' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Field to sort by (see endpoint for allowed values)' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder: 'asc' | 'desc' = 'desc';
}

export function pageArgs(q: PaginationQueryDto) {
  return { skip: (q.page - 1) * q.limit, take: q.limit };
}

/** Resolves a safe orderBy from a whitelist. */
export function orderBy(q: PaginationQueryDto, allowed: string[], fallback: string) {
  const field = q.sortBy && allowed.includes(q.sortBy) ? q.sortBy : fallback;
  return { [field]: q.sortOrder };
}

export function paginate<T>(items: T[], total: number, q: PaginationQueryDto): Paginated<T> {
  return { items, meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) } };
}
