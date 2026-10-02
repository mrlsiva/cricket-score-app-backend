import { Module } from '@nestjs/common';
import { ScorerModule } from '../scorer/scorer.module';
import { CommentaryController } from './commentary.controller';
import { CommentaryService } from './commentary.service';

@Module({
  imports: [ScorerModule],
  controllers: [CommentaryController],
  providers: [CommentaryService],
  exports: [CommentaryService],
})
export class CommentaryModule {}
