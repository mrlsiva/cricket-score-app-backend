import { Module } from '@nestjs/common';
import { AwardsModule } from '../awards/awards.module';
import { CommentaryModule } from '../commentary/commentary.module';
import { TournamentsModule } from '../tournaments/tournaments.module';
import { PostMatchProcessor } from './post-match.processor';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';

@Module({
  imports: [AwardsModule, TournamentsModule, CommentaryModule],
  controllers: [StatisticsController],
  providers: [StatisticsService, PostMatchProcessor],
  exports: [StatisticsService],
})
export class StatisticsModule {}
