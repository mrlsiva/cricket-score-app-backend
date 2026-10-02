import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleName } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { ApiFile } from '../../common/decorators/api-file.decorator';
import { MAX_IMAGE_BYTES } from '../../infrastructure/storage/storage.service';
import { UpdateMeDto, UpdateUserStatusDto, UserQueryDto } from './dto/users.dto';
import { UsersService } from './users.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Search users (e.g. to pick a scorer or team manager). Sort: name | createdAt | city' })
  search(@Query() q: UserQueryDto) {
    return this.users.search(q);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update my profile' })
  updateMe(@CurrentUser('id') id: string, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(id, dto);
  }

  @Post('me/photo')
  @ApiFile({}, MAX_IMAGE_BYTES)
  @ApiOperation({ summary: 'Upload my profile / player photo' })
  photo(@CurrentUser('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.users.updatePhoto(id, file);
  }

  @Delete('me')
  @ApiOperation({ summary: 'Delete my account (soft delete, statistics are kept)' })
  deleteMe(@CurrentUser('id') id: string) {
    return this.users.deleteMe(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Public user profile' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.getPublic(id);
  }

  @Patch(':id/status')
  @Roles(RoleName.SUPER_ADMIN)
  @ApiOperation({ summary: 'Activate / deactivate a user (Super Admin)' })
  status(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserStatusDto) {
    return this.users.setStatus(id, dto.isActive);
  }
}
