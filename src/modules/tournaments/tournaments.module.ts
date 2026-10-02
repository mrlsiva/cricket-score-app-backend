import { Module } from '@nestjs/common';
import { PointsTableService } from './points-table.service';
import { TournamentsController } from './tournaments.controller';
import { TournamentsRepository } from './tournaments.repository';
import { TournamentsService } from './tournaments.service';

@Module({
  controllers: [TournamentsController],
  providers: [TournamentsService, TournamentsRepository, PointsTableService],
  exports: [TournamentsService, PointsTableService],
})
export class TournamentsModule {}
