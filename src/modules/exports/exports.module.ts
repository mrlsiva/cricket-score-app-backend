import { Module } from '@nestjs/common';
import { ScoringModule } from '../scoring/scoring.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  imports: [ScoringModule],
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}
