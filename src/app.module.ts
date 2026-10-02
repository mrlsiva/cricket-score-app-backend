import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { AccessModule } from './modules/access/access.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { AwardsModule } from './modules/awards/awards.module';
import { CommentaryModule } from './modules/commentary/commentary.module';
import { ExportsModule } from './modules/exports/exports.module';
import { GalleryModule } from './modules/gallery/gallery.module';
import { HealthController } from './modules/health/health.controller';
import { LiveModule } from './modules/live/live.module';
import { MatchesModule } from './modules/matches/matches.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PlayersModule } from './modules/players/players.module';
import { RolesModule } from './modules/roles/roles.module';
import { ScorerModule } from './modules/scorer/scorer.module';
import { ScoringModule } from './modules/scoring/scoring.module';
import { StatisticsModule } from './modules/statistics/statistics.module';
import { TeamsModule } from './modules/teams/teams.module';
import { TournamentsModule } from './modules/tournaments/tournaments.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnv, cache: true }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [{ ttl: config.get<number>('throttle.ttl')!, limit: config.get<number>('throttle.limit')! }],
    }),
    EventEmitterModule.forRoot(),
    // infrastructure & cross-cutting (global)
    PrismaModule,
    InfrastructureModule,
    RolesModule,
    AccessModule,
    AuditModule,
    NotificationsModule,
    LiveModule,
    // features
    AuthModule,
    UsersModule,
    PlayersModule,
    TeamsModule,
    TournamentsModule,
    MatchesModule,
    ScorerModule,
    CommentaryModule,
    ScoringModule,
    AwardsModule,
    StatisticsModule,
    GalleryModule,
    UploadsModule,
    ExportsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
