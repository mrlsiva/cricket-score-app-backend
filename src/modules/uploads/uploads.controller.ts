import { Controller, ParseEnumPipe, Post, Query, UploadedFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ApiFile } from '../../common/decorators/api-file.decorator';
import { MAX_IMAGE_BYTES, StorageService } from '../../infrastructure/storage/storage.service';

enum ImageKind {
  PLAYER_PHOTO = 'player-photo',
  TEAM_LOGO = 'team-logo',
  TOURNAMENT_LOGO = 'tournament-logo',
  TOURNAMENT_BANNER = 'tournament-banner',
}

/** Generic image upload: returns a URL to pass into create / update DTOs (logoUrl, bannerUrl...). */
@ApiTags('File Upload')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly storage: StorageService) {}

  @Post('images')
  @ApiFile({}, MAX_IMAGE_BYTES)
  @ApiQuery({ name: 'kind', enum: ImageKind })
  @ApiOperation({ summary: 'Upload an image (JPEG/PNG/WEBP/GIF ≤ 10 MB, content-sniffed). Local disk or S3-compatible storage.' })
  image(@Query('kind', new ParseEnumPipe(ImageKind)) kind: ImageKind, @UploadedFile() file: Express.Multer.File) {
    return this.storage.save(file, kind);
  }
}
