import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { MediaType } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { Permission } from '../../common/constants/permissions';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ApiFile } from '../../common/decorators/api-file.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { GalleryService } from './gallery.service';

class GalleryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MediaType }) @IsOptional() @IsEnum(MediaType) type?: MediaType;
}

class UploadMetaDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) caption?: string;
}

class CaptionDto {
  @ApiProperty() @IsString() @MaxLength(500) caption!: string;
}

@ApiTags('Gallery')
@ApiBearerAuth()
@Controller('matches/:matchId/gallery')
export class GalleryController {
  constructor(private readonly gallery: GalleryService) {}

  @Post()
  @RequirePermissions(Permission.GALLERY_UPLOAD)
  @ApiFile({ caption: { type: 'string', description: 'Optional caption' } })
  @ApiOperation({ summary: 'Upload a match photo (≤10 MB) or video (≤100 MB). Broadcasts gallery:update' })
  upload(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @UploadedFile() file: Express.Multer.File, @Body() dto: UploadMetaDto) {
    return this.gallery.upload(user, matchId, file, dto.caption);
  }

  @Get()
  @ApiOperation({ summary: 'Match gallery (photos & videos)' })
  list(@Param('matchId', ParseUUIDPipe) matchId: string, @Query() q: GalleryQueryDto) {
    return this.gallery.list(matchId, q);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit caption (uploader / organizer)' })
  caption(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CaptionDto) {
    return this.gallery.updateCaption(user, matchId, id, dto.caption);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete media (uploader / organizer)' })
  remove(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.gallery.remove(user, matchId, id);
  }
}
