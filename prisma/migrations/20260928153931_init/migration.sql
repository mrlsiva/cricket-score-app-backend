-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `googleId` VARCHAR(64) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `photoUrl` VARCHAR(1024) NULL,
    `mobile` VARCHAR(20) NULL,
    `city` VARCHAR(100) NULL,
    `isOnboarded` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `users_googleId_key`(`googleId`),
    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_deletedAt_idx`(`deletedAt`),
    INDEX `users_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` CHAR(36) NOT NULL,
    `name` ENUM('SUPER_ADMIN', 'ORGANIZER', 'SCORER', 'TEAM_CAPTAIN', 'TEAM_MANAGER', 'PLAYER', 'VIEWER') NOT NULL,
    `description` VARCHAR(255) NULL,
    `permissions` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `roleId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_roles_roleId_idx`(`roleId`),
    UNIQUE INDEX `user_roles_userId_roleId_key`(`userId`, `roleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `userAgent` VARCHAR(255) NULL,
    `ip` VARCHAR(64) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_tokenHash_key`(`tokenHash`),
    INDEX `refresh_tokens_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tournaments` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `logoUrl` VARCHAR(1024) NULL,
    `bannerUrl` VARCHAR(1024) NULL,
    `description` TEXT NULL,
    `type` ENUM('LEAGUE', 'KNOCKOUT', 'LEAGUE_KNOCKOUT', 'FRIENDLY') NOT NULL,
    `status` ENUM('UPCOMING', 'ONGOING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'UPCOMING',
    `overs` INTEGER NOT NULL,
    `playersPerTeam` INTEGER NOT NULL,
    `ballType` ENUM('TENNIS', 'LEATHER', 'RUBBER', 'TAPE', 'OTHER') NOT NULL DEFAULT 'TENNIS',
    `ground` VARCHAR(150) NULL,
    `city` VARCHAR(100) NULL,
    `season` VARCHAR(20) NULL,
    `startDate` DATETIME(3) NOT NULL,
    `endDate` DATETIME(3) NOT NULL,
    `organizerId` CHAR(36) NOT NULL,
    `fixturesGeneratedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `tournaments_organizerId_idx`(`organizerId`),
    INDEX `tournaments_status_startDate_idx`(`status`, `startDate`),
    INDEX `tournaments_season_idx`(`season`),
    INDEX `tournaments_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teams` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `shortName` VARCHAR(10) NULL,
    `logoUrl` VARCHAR(1024) NULL,
    `color` VARCHAR(20) NULL,
    `captainId` CHAR(36) NULL,
    `managerId` CHAR(36) NULL,
    `wicketKeeperId` CHAR(36) NULL,
    `joinCode` VARCHAR(16) NOT NULL,
    `qrToken` VARCHAR(64) NOT NULL,
    `isTemporary` BOOLEAN NOT NULL DEFAULT false,
    `createdById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `teams_joinCode_key`(`joinCode`),
    UNIQUE INDEX `teams_qrToken_key`(`qrToken`),
    INDEX `teams_createdById_idx`(`createdById`),
    INDEX `teams_name_idx`(`name`),
    INDEX `teams_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tournament_teams` (
    `id` CHAR(36) NOT NULL,
    `tournamentId` CHAR(36) NOT NULL,
    `teamId` CHAR(36) NOT NULL,
    `groupName` VARCHAR(20) NULL,
    `seed` INTEGER NULL,
    `played` INTEGER NOT NULL DEFAULT 0,
    `won` INTEGER NOT NULL DEFAULT 0,
    `lost` INTEGER NOT NULL DEFAULT 0,
    `tied` INTEGER NOT NULL DEFAULT 0,
    `noResult` INTEGER NOT NULL DEFAULT 0,
    `points` INTEGER NOT NULL DEFAULT 0,
    `runsScored` INTEGER NOT NULL DEFAULT 0,
    `ballsFaced` INTEGER NOT NULL DEFAULT 0,
    `runsConceded` INTEGER NOT NULL DEFAULT 0,
    `ballsBowled` INTEGER NOT NULL DEFAULT 0,
    `netRunRate` DECIMAL(8, 3) NOT NULL DEFAULT 0,
    `isEliminated` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `tournament_teams_tournamentId_points_netRunRate_idx`(`tournamentId`, `points`, `netRunRate`),
    INDEX `tournament_teams_teamId_idx`(`teamId`),
    UNIQUE INDEX `tournament_teams_tournamentId_teamId_key`(`tournamentId`, `teamId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `players` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NULL,
    `name` VARCHAR(120) NOT NULL,
    `photoUrl` VARCHAR(1024) NULL,
    `jerseyNumber` INTEGER NULL,
    `role` ENUM('BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER') NULL,
    `battingStyle` ENUM('RIGHT_HAND', 'LEFT_HAND') NULL,
    `bowlingStyle` ENUM('FAST', 'MEDIUM_FAST', 'MEDIUM', 'OFF_SPIN', 'LEG_SPIN', 'LEFT_ARM_ORTHODOX', 'LEFT_ARM_WRIST_SPIN', 'NONE') NULL,
    `bowlingArm` ENUM('RIGHT', 'LEFT') NULL,
    `isTemporary` BOOLEAN NOT NULL DEFAULT false,
    `tempCode` VARCHAR(10) NULL,
    `createdById` CHAR(36) NULL,
    `mergedIntoId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `players_userId_key`(`userId`),
    INDEX `players_name_idx`(`name`),
    INDEX `players_isTemporary_idx`(`isTemporary`),
    INDEX `players_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_players` (
    `id` CHAR(36) NOT NULL,
    `teamId` CHAR(36) NOT NULL,
    `playerId` CHAR(36) NOT NULL,
    `status` ENUM('ACTIVE', 'REMOVED') NOT NULL DEFAULT 'ACTIVE',
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `removedAt` DATETIME(3) NULL,

    INDEX `team_players_playerId_idx`(`playerId`),
    UNIQUE INDEX `team_players_teamId_playerId_key`(`teamId`, `playerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_join_requests` (
    `id` CHAR(36) NOT NULL,
    `teamId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `playerId` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `message` VARCHAR(255) NULL,
    `reviewedById` CHAR(36) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `team_join_requests_teamId_status_idx`(`teamId`, `status`),
    INDEX `team_join_requests_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_claim_requests` (
    `id` CHAR(36) NOT NULL,
    `temporaryPlayerId` CHAR(36) NOT NULL,
    `targetPlayerId` CHAR(36) NOT NULL,
    `requestedById` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `message` VARCHAR(255) NULL,
    `reviewedById` CHAR(36) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `player_claim_requests_temporaryPlayerId_status_idx`(`temporaryPlayerId`, `status`),
    INDEX `player_claim_requests_requestedById_idx`(`requestedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `matches` (
    `id` CHAR(36) NOT NULL,
    `tournamentId` CHAR(36) NULL,
    `name` VARCHAR(150) NULL,
    `teamAId` CHAR(36) NOT NULL,
    `teamBId` CHAR(36) NOT NULL,
    `playersPerTeam` INTEGER NOT NULL,
    `overs` INTEGER NOT NULL,
    `ballsPerOver` INTEGER NOT NULL DEFAULT 6,
    `wideRuns` INTEGER NOT NULL DEFAULT 1,
    `noBallRuns` INTEGER NOT NULL DEFAULT 1,
    `ground` VARCHAR(150) NULL,
    `scheduledAt` DATETIME(3) NULL,
    `ballType` ENUM('TENNIS', 'LEATHER', 'RUBBER', 'TAPE', 'OTHER') NULL,
    `pitchType` ENUM('TURF', 'MATTING', 'CEMENT', 'ASTRO_TURF', 'MUD', 'OTHER') NULL,
    `umpireName` VARCHAR(120) NULL,
    `status` ENUM('SCHEDULED', 'TOSS_COMPLETED', 'LIVE', 'INNINGS_BREAK', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `stage` ENUM('FRIENDLY', 'LEAGUE', 'KNOCKOUT', 'QUARTER_FINAL', 'SEMI_FINAL', 'FINAL') NOT NULL DEFAULT 'FRIENDLY',
    `roundNumber` INTEGER NULL,
    `matchNumber` INTEGER NULL,
    `isQuickMatch` BOOLEAN NOT NULL DEFAULT false,
    `tossWinnerId` CHAR(36) NULL,
    `tossDecision` ENUM('BAT', 'BOWL') NULL,
    `currentInningsNo` INTEGER NOT NULL DEFAULT 0,
    `isPaused` BOOLEAN NOT NULL DEFAULT false,
    `pauseReason` VARCHAR(255) NULL,
    `resultType` ENUM('WIN', 'TIE', 'NO_RESULT', 'ABANDONED') NULL,
    `winnerTeamId` CHAR(36) NULL,
    `winMargin` INTEGER NULL,
    `winMarginType` ENUM('RUNS', 'WICKETS', 'SUPER_OVER') NULL,
    `resultText` VARCHAR(255) NULL,
    `mvpPlayerId` CHAR(36) NULL,
    `createdById` CHAR(36) NOT NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `matches_status_scheduledAt_idx`(`status`, `scheduledAt`),
    INDEX `matches_tournamentId_stage_roundNumber_idx`(`tournamentId`, `stage`, `roundNumber`),
    INDEX `matches_teamAId_idx`(`teamAId`),
    INDEX `matches_teamBId_idx`(`teamBId`),
    INDEX `matches_createdById_idx`(`createdById`),
    INDEX `matches_ground_idx`(`ground`),
    INDEX `matches_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `match_players` (
    `id` CHAR(36) NOT NULL,
    `matchId` CHAR(36) NOT NULL,
    `teamId` CHAR(36) NOT NULL,
    `playerId` CHAR(36) NOT NULL,
    `battingOrder` INTEGER NULL,
    `isCaptain` BOOLEAN NOT NULL DEFAULT false,
    `isKeeper` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `match_players_matchId_teamId_idx`(`matchId`, `teamId`),
    INDEX `match_players_playerId_idx`(`playerId`),
    UNIQUE INDEX `match_players_matchId_playerId_key`(`matchId`, `playerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `innings` (
    `id` CHAR(36) NOT NULL,
    `matchId` CHAR(36) NOT NULL,
    `number` INTEGER NOT NULL,
    `isSuperOver` BOOLEAN NOT NULL DEFAULT false,
    `battingTeamId` CHAR(36) NOT NULL,
    `bowlingTeamId` CHAR(36) NOT NULL,
    `status` ENUM('IN_PROGRESS', 'COMPLETED') NOT NULL DEFAULT 'IN_PROGRESS',
    `maxOvers` INTEGER NOT NULL,
    `maxWickets` INTEGER NOT NULL,
    `target` INTEGER NULL,
    `runs` INTEGER NOT NULL DEFAULT 0,
    `wickets` INTEGER NOT NULL DEFAULT 0,
    `legalBalls` INTEGER NOT NULL DEFAULT 0,
    `completedOvers` INTEGER NOT NULL DEFAULT 0,
    `ballsInOver` INTEGER NOT NULL DEFAULT 0,
    `wides` INTEGER NOT NULL DEFAULT 0,
    `noBalls` INTEGER NOT NULL DEFAULT 0,
    `byes` INTEGER NOT NULL DEFAULT 0,
    `legByes` INTEGER NOT NULL DEFAULT 0,
    `penaltyRuns` INTEGER NOT NULL DEFAULT 0,
    `isAllOut` BOOLEAN NOT NULL DEFAULT false,
    `strikerId` CHAR(36) NULL,
    `nonStrikerId` CHAR(36) NULL,
    `bowlerId` CHAR(36) NULL,
    `previousBowlerId` CHAR(36) NULL,
    `endReason` VARCHAR(100) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `innings_matchId_number_key`(`matchId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `balls` (
    `id` CHAR(36) NOT NULL,
    `matchId` CHAR(36) NOT NULL,
    `inningsId` CHAR(36) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `kind` ENUM('DELIVERY', 'PENALTY', 'DISMISSAL', 'OVER_END') NOT NULL DEFAULT 'DELIVERY',
    `overNumber` INTEGER NOT NULL DEFAULT 0,
    `ballInOver` INTEGER NOT NULL DEFAULT 0,
    `isLegal` BOOLEAN NOT NULL DEFAULT true,
    `batsmanId` CHAR(36) NULL,
    `nonStrikerId` CHAR(36) NULL,
    `bowlerId` CHAR(36) NULL,
    `runsOffBat` INTEGER NOT NULL DEFAULT 0,
    `extraType` ENUM('NONE', 'WIDE', 'NO_BALL', 'BYE', 'LEG_BYE', 'PENALTY') NOT NULL DEFAULT 'NONE',
    `extraRuns` INTEGER NOT NULL DEFAULT 0,
    `totalRuns` INTEGER NOT NULL DEFAULT 0,
    `isBoundary` BOOLEAN NOT NULL DEFAULT false,
    `isFour` BOOLEAN NOT NULL DEFAULT false,
    `isSix` BOOLEAN NOT NULL DEFAULT false,
    `isWicket` BOOLEAN NOT NULL DEFAULT false,
    `wicketType` ENUM('BOWLED', 'CAUGHT', 'LBW', 'RUN_OUT', 'STUMPED', 'HIT_WICKET', 'RETIRED_HURT', 'TIMED_OUT') NULL,
    `dismissedPlayerId` CHAR(36) NULL,
    `fielderId` CHAR(36) NULL,
    `scoreAfter` INTEGER NOT NULL DEFAULT 0,
    `wicketsAfter` INTEGER NOT NULL DEFAULT 0,
    `clientSequence` INTEGER NULL,
    `clientCreatedAt` DATETIME(3) NULL,
    `scoredById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `balls_matchId_deletedAt_idx`(`matchId`, `deletedAt`),
    INDEX `balls_batsmanId_idx`(`batsmanId`),
    INDEX `balls_bowlerId_idx`(`bowlerId`),
    UNIQUE INDEX `balls_inningsId_sequence_key`(`inningsId`, `sequence`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `score_events` (
    `id` CHAR(36) NOT NULL,
    `matchId` CHAR(36) NOT NULL,
    `inningsNo` INTEGER NULL,
    `ballId` CHAR(36) NULL,
    `type` ENUM('MATCH_CREATED', 'TOSS_COMPLETED', 'MATCH_STARTED', 'INNINGS_STARTED', 'BALL_ADDED', 'BALL_EDITED', 'BALL_DELETED', 'BALL_UNDONE', 'STRIKER_CHANGED', 'BATSMEN_SET', 'BOWLER_CHANGED', 'OVER_ENDED', 'MATCH_PAUSED', 'MATCH_RESUMED', 'INNINGS_ENDED', 'SUPER_OVER_STARTED', 'MATCH_ENDED', 'RESULT_OVERRIDDEN', 'SCORER_CHANGED') NOT NULL,
    `payload` JSON NULL,
    `userId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `score_events_matchId_createdAt_idx`(`matchId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `commentary` (
    `id` CHAR(36) NOT NULL,
    `matchId` CHAR(36) NOT NULL,
    `inningsId` CHAR(36) NULL,
    `ballId` CHAR(36) NULL,
    `type` ENUM('BALL', 'BOUNDARY', 'SIX', 'WICKET', 'MILESTONE', 'PARTNERSHIP', 'OVER_SUMMARY', 'INNINGS_SUMMARY', 'MATCH_SUMMARY', 'MANUAL') NOT NULL,
    `overLabel` VARCHAR(10) NULL,
    `text` TEXT NOT NULL,
    `isAuto` BOOLEAN NOT NULL DEFAULT true,
    `createdById` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    INDEX `commentary_matchId_deletedAt_createdAt_idx`(`matchId`, `deletedAt`, `createdAt`),
    INDEX `commentary_ballId_idx`(`ballId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `partnerships` (
    `id` CHAR(36) NOT NULL,
    `inningsId` CHAR(36) NOT NULL,
    `matchId` CHAR(36) NOT NULL,
    `wicketNumber` INTEGER NOT NULL,
    `batter1Id` CHAR(36) NOT NULL,
    `batter2Id` CHAR(36) NOT NULL,
    `runs` INTEGER NOT NULL DEFAULT 0,
    `balls` INTEGER NOT NULL DEFAULT 0,
    `batter1Runs` INTEGER NOT NULL DEFAULT 0,
    `batter1Balls` INTEGER NOT NULL DEFAULT 0,
    `batter2Runs` INTEGER NOT NULL DEFAULT 0,
    `batter2Balls` INTEGER NOT NULL DEFAULT 0,
    `isUnbroken` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `partnerships_inningsId_idx`(`inningsId`),
    INDEX `partnerships_matchId_runs_idx`(`matchId`, `runs`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_match_stats` (
    `id` CHAR(36) NOT NULL,
    `matchId` CHAR(36) NOT NULL,
    `playerId` CHAR(36) NOT NULL,
    `teamId` CHAR(36) NOT NULL,
    `batted` BOOLEAN NOT NULL DEFAULT false,
    `battingPosition` INTEGER NULL,
    `runs` INTEGER NOT NULL DEFAULT 0,
    `ballsFaced` INTEGER NOT NULL DEFAULT 0,
    `fours` INTEGER NOT NULL DEFAULT 0,
    `sixes` INTEGER NOT NULL DEFAULT 0,
    `dots` INTEGER NOT NULL DEFAULT 0,
    `isOut` BOOLEAN NOT NULL DEFAULT false,
    `wicketType` ENUM('BOWLED', 'CAUGHT', 'LBW', 'RUN_OUT', 'STUMPED', 'HIT_WICKET', 'RETIRED_HURT', 'TIMED_OUT') NULL,
    `dismissedById` CHAR(36) NULL,
    `fielderId` CHAR(36) NULL,
    `dismissalText` VARCHAR(150) NULL,
    `bowled` BOOLEAN NOT NULL DEFAULT false,
    `ballsBowled` INTEGER NOT NULL DEFAULT 0,
    `runsConceded` INTEGER NOT NULL DEFAULT 0,
    `wickets` INTEGER NOT NULL DEFAULT 0,
    `maidens` INTEGER NOT NULL DEFAULT 0,
    `widesBowled` INTEGER NOT NULL DEFAULT 0,
    `noBallsBowled` INTEGER NOT NULL DEFAULT 0,
    `dotsBowled` INTEGER NOT NULL DEFAULT 0,
    `catches` INTEGER NOT NULL DEFAULT 0,
    `runOuts` INTEGER NOT NULL DEFAULT 0,
    `stumpings` INTEGER NOT NULL DEFAULT 0,
    `battingPoints` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `bowlingPoints` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `fieldingPoints` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `mvpPoints` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `player_match_stats_playerId_idx`(`playerId`),
    INDEX `player_match_stats_teamId_idx`(`teamId`),
    UNIQUE INDEX `player_match_stats_matchId_playerId_key`(`matchId`, `playerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `player_career_stats` (
    `id` CHAR(36) NOT NULL,
    `playerId` CHAR(36) NOT NULL,
    `matches` INTEGER NOT NULL DEFAULT 0,
    `battingInnings` INTEGER NOT NULL DEFAULT 0,
    `notOuts` INTEGER NOT NULL DEFAULT 0,
    `runs` INTEGER NOT NULL DEFAULT 0,
    `ballsFaced` INTEGER NOT NULL DEFAULT 0,
    `highestScore` INTEGER NOT NULL DEFAULT 0,
    `highestScoreNotOut` BOOLEAN NOT NULL DEFAULT false,
    `battingAverage` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `strikeRate` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `fifties` INTEGER NOT NULL DEFAULT 0,
    `hundreds` INTEGER NOT NULL DEFAULT 0,
    `ducks` INTEGER NOT NULL DEFAULT 0,
    `fours` INTEGER NOT NULL DEFAULT 0,
    `sixes` INTEGER NOT NULL DEFAULT 0,
    `bowlingInnings` INTEGER NOT NULL DEFAULT 0,
    `ballsBowled` INTEGER NOT NULL DEFAULT 0,
    `overs` VARCHAR(12) NOT NULL DEFAULT '0.0',
    `runsConceded` INTEGER NOT NULL DEFAULT 0,
    `wickets` INTEGER NOT NULL DEFAULT 0,
    `economy` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `bowlingAverage` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `maidens` INTEGER NOT NULL DEFAULT 0,
    `bestBowlingWickets` INTEGER NOT NULL DEFAULT 0,
    `bestBowlingRuns` INTEGER NOT NULL DEFAULT 0,
    `catches` INTEGER NOT NULL DEFAULT 0,
    `runOuts` INTEGER NOT NULL DEFAULT 0,
    `stumpings` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `player_career_stats_playerId_key`(`playerId`),
    INDEX `player_career_stats_runs_idx`(`runs`),
    INDEX `player_career_stats_wickets_idx`(`wickets`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `team_stats` (
    `id` CHAR(36) NOT NULL,
    `teamId` CHAR(36) NOT NULL,
    `matches` INTEGER NOT NULL DEFAULT 0,
    `won` INTEGER NOT NULL DEFAULT 0,
    `lost` INTEGER NOT NULL DEFAULT 0,
    `tied` INTEGER NOT NULL DEFAULT 0,
    `noResult` INTEGER NOT NULL DEFAULT 0,
    `winPercentage` DECIMAL(6, 2) NOT NULL DEFAULT 0,
    `highestTotal` INTEGER NOT NULL DEFAULT 0,
    `lowestTotal` INTEGER NULL,
    `totalRuns` INTEGER NOT NULL DEFAULT 0,
    `totalWickets` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `team_stats_teamId_key`(`teamId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tournament_stats` (
    `id` CHAR(36) NOT NULL,
    `tournamentId` CHAR(36) NOT NULL,
    `matchesPlayed` INTEGER NOT NULL DEFAULT 0,
    `totalRuns` INTEGER NOT NULL DEFAULT 0,
    `totalWickets` INTEGER NOT NULL DEFAULT 0,
    `totalFours` INTEGER NOT NULL DEFAULT 0,
    `totalSixes` INTEGER NOT NULL DEFAULT 0,
    `highestTotal` INTEGER NOT NULL DEFAULT 0,
    `highestTotalTeamId` CHAR(36) NULL,
    `lowestTotal` INTEGER NULL,
    `leaderboards` JSON NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tournament_stats_tournamentId_key`(`tournamentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `awards` (
    `id` CHAR(36) NOT NULL,
    `scope` ENUM('MATCH', 'TOURNAMENT') NOT NULL,
    `type` ENUM('MAN_OF_THE_MATCH', 'BEST_BATSMAN', 'BEST_BOWLER', 'BEST_FIELDER', 'MOST_SIXES', 'MOST_FOURS', 'HIGHEST_PARTNERSHIP', 'MAN_OF_THE_TOURNAMENT', 'ORANGE_CAP', 'PURPLE_CAP', 'BEST_ALL_ROUNDER', 'HIGHEST_INDIVIDUAL_SCORE', 'BEST_BOWLING_FIGURES', 'BEST_STRIKE_RATE', 'BEST_ECONOMY') NOT NULL,
    `matchId` CHAR(36) NULL,
    `tournamentId` CHAR(36) NULL,
    `playerId` CHAR(36) NULL,
    `secondPlayerId` CHAR(36) NULL,
    `teamId` CHAR(36) NULL,
    `value` VARCHAR(100) NULL,
    `points` DECIMAL(10, 2) NULL,
    `isOverridden` BOOLEAN NOT NULL DEFAULT false,
    `overriddenById` CHAR(36) NULL,
    `note` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `awards_playerId_idx`(`playerId`),
    UNIQUE INDEX `awards_matchId_type_key`(`matchId`, `type`),
    UNIQUE INDEX `awards_tournamentId_type_key`(`tournamentId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `galleries` (
    `id` CHAR(36) NOT NULL,
    `matchId` CHAR(36) NOT NULL,
    `type` ENUM('PHOTO', 'VIDEO') NOT NULL,
    `url` VARCHAR(1024) NOT NULL,
    `storageKey` VARCHAR(512) NOT NULL,
    `mimeType` VARCHAR(100) NOT NULL,
    `sizeBytes` INTEGER NOT NULL,
    `caption` VARCHAR(500) NULL,
    `uploadedById` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    INDEX `galleries_matchId_deletedAt_createdAt_idx`(`matchId`, `deletedAt`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `type` ENUM('MATCH_STARTED', 'TOSS_COMPLETED', 'WICKET', 'SIX', 'FIFTY', 'HUNDRED', 'INNINGS_END', 'MATCH_RESULT', 'SCORER_TRANSFER', 'TOURNAMENT_INVITATION', 'TEAM_JOIN_REQUEST', 'TEAM_JOIN_APPROVAL', 'CLAIM_UPDATE', 'GENERAL') NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `body` VARCHAR(1000) NOT NULL,
    `data` JSON NULL,
    `readAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_userId_readAt_createdAt_idx`(`userId`, `readAt`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `device_tokens` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `token` VARCHAR(512) NOT NULL,
    `platform` VARCHAR(20) NOT NULL DEFAULT 'android',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `device_tokens_token_key`(`token`),
    INDEX `device_tokens_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scorer_locks` (
    `id` CHAR(36) NOT NULL,
    `matchId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `acquiredAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `heartbeatAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `scorer_locks_matchId_key`(`matchId`),
    INDEX `scorer_locks_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scorer_transfer_history` (
    `id` CHAR(36) NOT NULL,
    `matchId` CHAR(36) NOT NULL,
    `fromUserId` CHAR(36) NULL,
    `toUserId` CHAR(36) NOT NULL,
    `actorId` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'FORCED', 'ASSIGNED', 'CLAIMED', 'RELEASED') NOT NULL,
    `reason` VARCHAR(255) NULL,
    `expiresAt` DATETIME(3) NULL,
    `respondedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `scorer_transfer_history_matchId_status_idx`(`matchId`, `status`),
    INDEX `scorer_transfer_history_toUserId_status_idx`(`toUserId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` CHAR(36) NOT NULL,
    `userId` CHAR(36) NULL,
    `matchId` CHAR(36) NULL,
    `entityType` VARCHAR(50) NOT NULL,
    `entityId` CHAR(36) NULL,
    `action` VARCHAR(50) NOT NULL,
    `ballLabel` VARCHAR(10) NULL,
    `oldValue` JSON NULL,
    `newValue` JSON NULL,
    `reason` VARCHAR(255) NULL,
    `ip` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_matchId_createdAt_idx`(`matchId`, `createdAt`),
    INDEX `audit_logs_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `audit_logs_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tournaments` ADD CONSTRAINT `tournaments_organizerId_fkey` FOREIGN KEY (`organizerId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teams` ADD CONSTRAINT `teams_captainId_fkey` FOREIGN KEY (`captainId`) REFERENCES `players`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teams` ADD CONSTRAINT `teams_wicketKeeperId_fkey` FOREIGN KEY (`wicketKeeperId`) REFERENCES `players`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teams` ADD CONSTRAINT `teams_managerId_fkey` FOREIGN KEY (`managerId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teams` ADD CONSTRAINT `teams_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tournament_teams` ADD CONSTRAINT `tournament_teams_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `tournaments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tournament_teams` ADD CONSTRAINT `tournament_teams_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `players` ADD CONSTRAINT `players_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `players` ADD CONSTRAINT `players_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `players` ADD CONSTRAINT `players_mergedIntoId_fkey` FOREIGN KEY (`mergedIntoId`) REFERENCES `players`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_players` ADD CONSTRAINT `team_players_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_players` ADD CONSTRAINT `team_players_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `players`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_join_requests` ADD CONSTRAINT `team_join_requests_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_join_requests` ADD CONSTRAINT `team_join_requests_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_join_requests` ADD CONSTRAINT `team_join_requests_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `players`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_join_requests` ADD CONSTRAINT `team_join_requests_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_claim_requests` ADD CONSTRAINT `player_claim_requests_temporaryPlayerId_fkey` FOREIGN KEY (`temporaryPlayerId`) REFERENCES `players`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_claim_requests` ADD CONSTRAINT `player_claim_requests_targetPlayerId_fkey` FOREIGN KEY (`targetPlayerId`) REFERENCES `players`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_claim_requests` ADD CONSTRAINT `player_claim_requests_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_claim_requests` ADD CONSTRAINT `player_claim_requests_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matches` ADD CONSTRAINT `matches_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `tournaments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matches` ADD CONSTRAINT `matches_teamAId_fkey` FOREIGN KEY (`teamAId`) REFERENCES `teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matches` ADD CONSTRAINT `matches_teamBId_fkey` FOREIGN KEY (`teamBId`) REFERENCES `teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matches` ADD CONSTRAINT `matches_tossWinnerId_fkey` FOREIGN KEY (`tossWinnerId`) REFERENCES `teams`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matches` ADD CONSTRAINT `matches_winnerTeamId_fkey` FOREIGN KEY (`winnerTeamId`) REFERENCES `teams`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `matches` ADD CONSTRAINT `matches_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_players` ADD CONSTRAINT `match_players_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_players` ADD CONSTRAINT `match_players_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `match_players` ADD CONSTRAINT `match_players_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `players`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `innings` ADD CONSTRAINT `innings_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `innings` ADD CONSTRAINT `innings_battingTeamId_fkey` FOREIGN KEY (`battingTeamId`) REFERENCES `teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `innings` ADD CONSTRAINT `innings_bowlingTeamId_fkey` FOREIGN KEY (`bowlingTeamId`) REFERENCES `teams`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `balls` ADD CONSTRAINT `balls_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `balls` ADD CONSTRAINT `balls_inningsId_fkey` FOREIGN KEY (`inningsId`) REFERENCES `innings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `score_events` ADD CONSTRAINT `score_events_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `commentary` ADD CONSTRAINT `commentary_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `commentary` ADD CONSTRAINT `commentary_inningsId_fkey` FOREIGN KEY (`inningsId`) REFERENCES `innings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `commentary` ADD CONSTRAINT `commentary_ballId_fkey` FOREIGN KEY (`ballId`) REFERENCES `balls`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `partnerships` ADD CONSTRAINT `partnerships_inningsId_fkey` FOREIGN KEY (`inningsId`) REFERENCES `innings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_match_stats` ADD CONSTRAINT `player_match_stats_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_match_stats` ADD CONSTRAINT `player_match_stats_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `players`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `player_career_stats` ADD CONSTRAINT `player_career_stats_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `players`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `team_stats` ADD CONSTRAINT `team_stats_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tournament_stats` ADD CONSTRAINT `tournament_stats_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `tournaments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `awards` ADD CONSTRAINT `awards_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `awards` ADD CONSTRAINT `awards_tournamentId_fkey` FOREIGN KEY (`tournamentId`) REFERENCES `tournaments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `awards` ADD CONSTRAINT `awards_playerId_fkey` FOREIGN KEY (`playerId`) REFERENCES `players`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `awards` ADD CONSTRAINT `awards_secondPlayerId_fkey` FOREIGN KEY (`secondPlayerId`) REFERENCES `players`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `awards` ADD CONSTRAINT `awards_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `galleries` ADD CONSTRAINT `galleries_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `galleries` ADD CONSTRAINT `galleries_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `device_tokens` ADD CONSTRAINT `device_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `scorer_locks` ADD CONSTRAINT `scorer_locks_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `scorer_locks` ADD CONSTRAINT `scorer_locks_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `scorer_transfer_history` ADD CONSTRAINT `scorer_transfer_history_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `scorer_transfer_history` ADD CONSTRAINT `scorer_transfer_history_fromUserId_fkey` FOREIGN KEY (`fromUserId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `scorer_transfer_history` ADD CONSTRAINT `scorer_transfer_history_toUserId_fkey` FOREIGN KEY (`toUserId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `scorer_transfer_history` ADD CONSTRAINT `scorer_transfer_history_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_matchId_fkey` FOREIGN KEY (`matchId`) REFERENCES `matches`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
