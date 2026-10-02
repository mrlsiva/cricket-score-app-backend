import { Module } from '@nestjs/common';
import { ScorerController } from './scorer.controller';
import { ScorerService } from './scorer.service';

@Module({
  controllers: [ScorerController],
  providers: [ScorerService],
  exports: [ScorerService],
})
export class ScorerModule {}
