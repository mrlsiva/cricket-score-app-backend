import { Module } from '@nestjs/common';
import { CommentaryModule } from '../commentary/commentary.module';
import { MatchesModule } from '../matches/matches.module';
import { ScorerModule } from '../scorer/scorer.module';
import { InningsService } from './innings.service';
import { MatchStateService } from './match-state.service';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';

@Module({
  imports: [ScorerModule, CommentaryModule, MatchesModule],
  controllers: [ScoringController],
  providers: [ScoringService, InningsService, MatchStateService],
  exports: [MatchStateService, InningsService],
})
export class ScoringModule {}
