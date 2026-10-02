import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile, UploadedFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Permission } from '../../common/constants/permissions';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ApiFile } from '../../common/decorators/api-file.decorator';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { MAX_IMAGE_BYTES } from '../../infrastructure/storage/storage.service';
import { AddTeamPlayerDto, CreateTeamDto, JoinRequestQueryDto, JoinTeamDto, ReviewDto, TeamQueryDto, UpdateTeamDto } from './dto/teams.dto';
import { TeamsService } from './teams.service';

@ApiTags('Teams')
@ApiBearerAuth()
@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Post()
  @RequirePermissions(Permission.TEAM_CREATE)
  @ApiOperation({ summary: 'Create a team (unique join code + QR token are generated)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTeamDto) {
    return this.teams.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List / search teams. Sort: name | createdAt' })
  list(@CurrentUser() user: AuthUser, @Query() q: TeamQueryDto) {
    return this.teams.list(user, q);
  }

  // ── QR join (static routes before :id) ──
  @Post('join')
  @ApiOperation({
    summary: 'Request to join a team by scanning its QR / entering join code',
    description: 'Creates a PENDING request; the captain / manager must accept it. Idempotent while pending.',
  })
  join(@CurrentUser() user: AuthUser, @Body() dto: JoinTeamDto) {
    return this.teams.join(user, dto);
  }

  @Get('join-requests/mine')
  @ApiOperation({ summary: 'My team join requests and their status' })
  myRequests(@CurrentUser('id') userId: string) {
    return this.teams.myJoinRequests(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Team details' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.teams.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update team (name, color, captain, manager, wicket keeper...)' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTeamDto) {
    return this.teams.update(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete team (soft delete)' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.remove(user, id);
  }

  @Post(':id/logo')
  @ApiFile({}, MAX_IMAGE_BYTES)
  @ApiOperation({ summary: 'Upload team logo' })
  logo(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.teams.setLogo(user, id, file);
  }

  @Get(':id/squad')
  @ApiOperation({ summary: 'Team squad (active players)' })
  squad(@Param('id', ParseUUIDPipe) id: string) {
    return this.teams.squad(id);
  }

  @Post(':id/players')
  @ApiOperation({ summary: 'Add a player directly (existing playerId, or name → temporary player)' })
  addPlayer(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddTeamPlayerDto) {
    return this.teams.addPlayer(user, id, dto);
  }

  @Delete(':id/players/:playerId')
  @ApiOperation({ summary: 'Remove a player (or leave the team yourself)' })
  removePlayer(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('playerId', ParseUUIDPipe) playerId: string) {
    return this.teams.removePlayer(user, id, playerId);
  }

  @Get(':id/qr')
  @ApiOperation({ summary: 'Get team QR (data URL) + join code' })
  qr(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.teams.qr(user, id);
  }

  @Post(':id/qr')
  @ApiOperation({ summary: 'Generate / regenerate team QR (old QR codes stop working)' })
  @ApiQuery({ name: 'regenerate', required: false, type: Boolean })
  generateQr(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('regenerate') regenerate?: string) {
    return this.teams.qr(user, id, regenerate !== 'false');
  }

  @Get(':id/qr.png')
  @ApiProduces('image/png')
  @ApiOperation({ summary: 'Team QR as PNG image (for sharing / printing)' })
  async qrPng(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Type', 'image/png');
    return new StreamableFile(await this.teams.qrPng(user, id));
  }

  @Get(':id/join-requests')
  @ApiOperation({ summary: 'Pending (or filtered) join requests - captain / manager' })
  requests(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: JoinRequestQueryDto) {
    return this.teams.joinRequests(user, id, q);
  }

  @Post(':id/join-requests/:requestId/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept a join request (player added to squad)' })
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('requestId', ParseUUIDPipe) rid: string) {
    return this.teams.reviewRequest(user, id, rid, true);
  }

  @Post(':id/join-requests/:requestId/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject a join request' })
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('requestId', ParseUUIDPipe) rid: string, @Body() dto: ReviewDto) {
    return this.teams.reviewRequest(user, id, rid, false, dto.reason);
  }
}
