import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '../../common/constants/permissions';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { ApiFile } from '../../common/decorators/api-file.decorator';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { MAX_IMAGE_BYTES } from '../../infrastructure/storage/storage.service';
import { AddTournamentTeamDto, CreateTournamentDto, GenerateFixturesDto, TournamentQueryDto, UpdateTournamentDto } from './dto/tournaments.dto';
import { TournamentsService } from './tournaments.service';

@ApiTags('Tournaments')
@ApiBearerAuth()
@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournaments: TournamentsService) {}

  @Post()
  @RequirePermissions(Permission.TOURNAMENT_CREATE)
  @ApiOperation({ summary: 'Create tournament (Organizer)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTournamentDto) {
    return this.tournaments.create(user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List tournaments. Filters: status, type, city, season, mine. Sort: startDate | endDate | createdAt | name' })
  list(@CurrentUser() user: AuthUser, @Query() q: TournamentQueryDto) {
    return this.tournaments.list(user, q);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Tournament details' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tournaments.get(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update tournament (organizer)' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTournamentDto) {
    return this.tournaments.update(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete tournament (soft delete)' })
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tournaments.remove(user, id);
  }

  @Post(':id/logo')
  @ApiFile({}, MAX_IMAGE_BYTES)
  @ApiOperation({ summary: 'Upload tournament logo' })
  logo(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.tournaments.setImage(user, id, file, 'logo');
  }

  @Post(':id/banner')
  @ApiFile({}, MAX_IMAGE_BYTES)
  @ApiOperation({ summary: 'Upload tournament banner' })
  banner(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    return this.tournaments.setImage(user, id, file, 'banner');
  }

  @Get(':id/teams')
  @ApiOperation({ summary: 'Teams in the tournament' })
  teams(@Param('id', ParseUUIDPipe) id: string) {
    return this.tournaments.teams(id);
  }

  @Post(':id/teams')
  @ApiOperation({ summary: 'Add an existing team or create a new one (sends a tournament invitation notification)' })
  addTeam(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AddTournamentTeamDto) {
    return this.tournaments.addTeam(user, id, dto);
  }

  @Delete(':id/teams/:teamId')
  @ApiOperation({ summary: 'Remove a team (only before it has played)' })
  removeTeam(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('teamId', ParseUUIDPipe) teamId: string) {
    return this.tournaments.removeTeam(user, id, teamId);
  }

  @Post(':id/fixtures')
  @ApiOperation({
    summary: 'Generate fixtures automatically',
    description: 'LEAGUE: round robin. KNOCKOUT: seeded bracket with byes, next rounds auto-created as results arrive. LEAGUE_KNOCKOUT: round robin (per group if groups set), then top teams seeded into semis / final.',
  })
  fixtures(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateFixturesDto) {
    return this.tournaments.generateFixtures(user, id, dto);
  }

  @Get(':id/fixtures')
  @ApiOperation({ summary: 'All fixtures / matches by round' })
  listFixtures(@Param('id', ParseUUIDPipe) id: string) {
    return this.tournaments.fixtures(id);
  }

  @Get(':id/points-table')
  @ApiOperation({ summary: 'Points table with Net Run Rate' })
  points(@Param('id', ParseUUIDPipe) id: string) {
    return this.tournaments.pointsTable(id);
  }

  @Post(':id/points-table/recalculate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Force points table recalculation (organizer)' })
  recalc(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tournaments.recalculatePoints(user, id);
  }
}
