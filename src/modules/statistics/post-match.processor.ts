import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent, MatchCompletedEvent, PlayersMergedEvent } from '../../common/constants/domain-events';
import { JobsService, QUEUES } from '../../infrastructure/jobs/jobs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AwardsService } from '../awards/awards.service';
import { CommentaryService } from '../commentary/commentary.service';
import { LiveEvent } from '../live/live.events';
import { LiveService } from '../live/live.service';
import { TournamentsService } from '../tournaments/tournaments.service';
import { PointsTableService } from '../tournaments/points-table.service';
import { StatisticsService } from './statistics.service';

/**
 * Post-match pipeline (runs as a background job):
 *   awards + impact points → career stats → team stats → points table → knockout progression
 *   → tournament stats & awards → spectator broadcast.
 * Every step is idempotent, so re-running after corrections is safe.
 */
@Injectable()
export class PostMatchProcessor implements OnModuleInit {
  private readonly logger = new Logger(PostMatchProcessor.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly prisma: PrismaService,
    private readonly stats: StatisticsService,
    private readonly awards: AwardsService,
    private readonly tournaments: TournamentsService,
    private readonly points: PointsTableService,
    private readonly commentary: CommentaryService,
    private readonly live: LiveService,
  ) {}

  onModuleInit() {
    this.jobs.register(QUEUES.STATS, 'match-completed', (d: MatchCompletedEvent) => this.processMatch(d.matchId));
    this.jobs.register(QUEUES.STATS, 'players-merged', (d: PlayersMergedEvent) => this.processMerge(d));
  }

  @OnEvent(DomainEvent.MATCH_COMPLETED)
  onMatchCompleted(e: MatchCompletedEvent) {
    return this.jobs.add(QUEUES.STATS, 'match-completed', e);
  }

  @OnEvent(DomainEvent.PLAYERS_MERGED)
  onPlayersMerged(e: PlayersMergedEvent) {
    return this.jobs.add(QUEUES.STATS, 'players-merged', e);
  }

  async processMatch(matchId: string) {
    const started = Date.now();
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) return;
    const playerIds = (await this.prisma.playerMatchStats.findMany({ where: { matchId }, select: { playerId: true } })).map((r) => r.playerId);

    const awards = await this.awards.computeMatchAwards(matchId);
    await this.stats.refreshCareers(playerIds);
    await this.stats.refreshTeams([match.teamAId, match.teamBId]);

    if (match.tournamentId) {
      const table = await this.points.recalculate(match.tournamentId);
      await this.tournaments.progress(match.tournamentId);
      await this.stats.refreshTournament(match.tournamentId);
      const tAwards = await this.awards.computeTournamentAwards(match.tournamentId);
      this.live.toTournament(match.tournamentId, LiveEvent.POINTS_TABLE_UPDATED, { table });
      this.live.toTournament(match.tournamentId, LiveEvent.AWARDS_UPDATED, { awards: tAwards });
    }

    if (awards?.length) {
      this.live.toMatch(matchId, LiveEvent.AWARDS_UPDATED, { awards });
      const mom = awards.find((a) => a.type === 'MAN_OF_THE_MATCH');
      const already = await this.prisma.commentary.count({ where: { matchId, type: 'MATCH_SUMMARY', text: { startsWith: 'Player of the Match' } } });
      if (mom?.player && !already) {
        await this.commentary.add(matchId, null, 'MATCH_SUMMARY', `Player of the Match: ${mom.player.name} (${mom.value}). ${match.resultText ?? ''}`.trim());
      }
    }
    this.logger.log(`Post-match processing for ${matchId} done in ${Date.now() - started}ms`);
  }

  async processMerge(e: PlayersMergedEvent) {
    await this.stats.refreshCareers(e.playerIds);
    const matches = await this.prisma.match.findMany({ where: { id: { in: e.matchIds } }, select: { id: true, tournamentId: true, status: true } });
    for (const m of matches.filter((x) => x.status === 'COMPLETED')) await this.awards.computeMatchAwards(m.id);
    for (const tid of new Set(matches.map((m) => m.tournamentId).filter(Boolean) as string[])) {
      await this.stats.refreshTournament(tid);
      await this.awards.computeTournamentAwards(tid);
    }
  }
}
