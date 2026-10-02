import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { ScorerService } from '../scorer/scorer.service';
import { CommentaryService } from './commentary.service';
import { CommentaryQueryDto, CreateCommentaryDto } from './dto/commentary.dto';

@ApiTags('Commentary')
@ApiBearerAuth()
@Controller('matches/:matchId/commentary')
export class CommentaryController {
  constructor(
    private readonly commentary: CommentaryService,
    private readonly scorer: ScorerService,
    private readonly access: AccessService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Ball-by-ball commentary (newest first by default). Filter by inningsNumber / types' })
  list(@Param('matchId', ParseUUIDPipe) matchId: string, @Query() q: CommentaryQueryDto) {
    return this.commentary.list(matchId, q);
  }

  @Post()
  @ApiOperation({ summary: 'Add a manual commentary line (active scorer or organizer)' })
  async add(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: CreateCommentaryDto) {
    if (!(await this.access.canManageMatch(user, matchId))) await this.scorer.assertScorer(user, matchId);
    const innings = await this.prisma.innings.findFirst({ where: { matchId }, orderBy: { number: 'desc' } });
    const label = innings ? `${innings.completedOvers}.${innings.ballsInOver}` : null;
    return this.commentary.add(matchId, innings?.id ?? null, 'MANUAL', dto.text, label, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a commentary line (organizer)' })
  async remove(@CurrentUser() user: AuthUser, @Param('matchId', ParseUUIDPipe) matchId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.access.assertCanManageMatch(user, matchId);
    return this.commentary.remove(matchId, id);
  }
}
