# Database ER Diagram

MySQL 8 / MariaDB 10.4+ (`cricket` database). All primary keys are UUID `CHAR(36)`; main entities are soft-deleted through `deletedAt`. Source of truth: [`prisma/schema.prisma`](../prisma/schema.prisma).

```mermaid
erDiagram
    users ||--o{ user_roles : has
    roles ||--o{ user_roles : grants
    users ||--o{ refresh_tokens : owns
    users ||--o| players : "permanent profile"
    users ||--o{ device_tokens : registers
    users ||--o{ notifications : receives

    users ||--o{ tournaments : organizes
    tournaments ||--o{ tournament_teams : "points table"
    teams ||--o{ tournament_teams : enters
    tournaments ||--o| tournament_stats : aggregates

    teams ||--o{ team_players : squad
    players ||--o{ team_players : "member of"
    teams ||--o{ team_join_requests : "QR join"
    users ||--o{ team_join_requests : requests
    teams ||--o| team_stats : aggregates

    players ||--o{ player_claim_requests : "temporary -> permanent"
    players ||--o| player_career_stats : career

    tournaments ||--o{ matches : schedules
    teams ||--o{ matches : "team A / team B"
    matches ||--o{ match_players : "playing XI"
    matches ||--o{ innings : has
    innings ||--o{ balls : "ball log"
    innings ||--o{ partnerships : derived
    matches ||--o{ score_events : timeline
    matches ||--o{ commentary : has
    balls ||--o{ commentary : describes
    matches ||--o{ player_match_stats : derived
    players ||--o{ player_match_stats : "per match"

    matches ||--o{ awards : "match awards"
    tournaments ||--o{ awards : "tournament awards"
    players ||--o{ awards : wins

    matches ||--o{ galleries : media
    matches ||--o| scorer_locks : "single scorer"
    users ||--o{ scorer_locks : holds
    matches ||--o{ scorer_transfer_history : transfers
    matches ||--o{ audit_logs : audited
    users ||--o{ audit_logs : performed

    users {
        char36 id PK
        varchar googleId UK
        varchar email UK
        varchar name
        varchar photoUrl
        varchar mobile
        varchar city
        bool isOnboarded
        datetime lastLoginAt
        datetime deletedAt
    }
    roles {
        char36 id PK
        enum name UK "SUPER_ADMIN..VIEWER"
        json permissions
    }
    players {
        char36 id PK
        char36 userId UK "null = temporary"
        varchar name
        int jerseyNumber
        enum role
        enum battingStyle
        enum bowlingStyle
        enum bowlingArm
        bool isTemporary
        varchar tempCode "T1 / P1"
        char36 mergedIntoId
    }
    teams {
        char36 id PK
        varchar name
        varchar color
        char36 captainId FK
        char36 managerId FK
        char36 wicketKeeperId FK
        varchar joinCode UK
        varchar qrToken UK
        bool isTemporary
    }
    tournaments {
        char36 id PK
        varchar name
        enum type "LEAGUE KNOCKOUT LEAGUE_KNOCKOUT FRIENDLY"
        int overs
        int playersPerTeam
        enum ballType
        varchar season
        char36 organizerId FK
    }
    tournament_teams {
        char36 tournamentId FK
        char36 teamId FK
        int points
        decimal netRunRate
        int runsScored
        int ballsFaced
    }
    matches {
        char36 id PK
        char36 tournamentId FK
        char36 teamAId FK
        char36 teamBId FK
        int overs
        int playersPerTeam
        char36 tossWinnerId FK
        enum tossDecision
        enum status "SCHEDULED..COMPLETED"
        enum stage
        enum resultType
        char36 winnerTeamId FK
        varchar resultText
    }
    innings {
        char36 id PK
        char36 matchId FK
        int number
        bool isSuperOver
        int runs
        int wickets
        int legalBalls
        int target
        char36 strikerId
        char36 nonStrikerId
        char36 bowlerId
    }
    balls {
        char36 id PK "client UUID (offline sync)"
        char36 inningsId FK
        int sequence
        enum kind "DELIVERY PENALTY DISMISSAL OVER_END"
        int overNumber
        int ballInOver
        char36 batsmanId
        char36 bowlerId
        int runsOffBat
        enum extraType
        int extraRuns
        bool isWicket
        enum wicketType
        datetime deletedAt "undo / delete"
    }
    player_match_stats {
        char36 matchId FK
        char36 playerId FK
        int runs
        int ballsFaced
        int wickets
        int runsConceded
        int catches
        decimal mvpPoints
    }
    awards {
        char36 id PK
        enum scope "MATCH TOURNAMENT"
        enum type
        char36 playerId FK
        bool isOverridden
    }
    scorer_locks {
        char36 matchId UK
        char36 userId FK
        datetime heartbeatAt
    }
    scorer_transfer_history {
        char36 matchId FK
        char36 fromUserId FK
        char36 toUserId FK
        enum status
        datetime expiresAt
    }
    audit_logs {
        char36 id PK
        char36 userId FK
        char36 matchId FK
        varchar entityType
        varchar action
        varchar ballLabel
        json oldValue
        json newValue
        varchar reason
    }
```

## Design notes

- **Ball log is the source of truth.** `innings` totals, `partnerships`, `player_match_stats` and ball numbering are derived by replaying non-deleted `balls` in `sequence` order (`src/modules/scoring/engine/scoring-engine.ts`). Undo / edit / delete therefore always leave consistent data.
- **Offline sync.** `balls.id` is generated by the Android client, so resubmitting a ball is idempotent.
- **Career & tournament statistics** are recomputed from `player_match_stats` of *completed* matches after every result (background job), so corrections and record claims propagate automatically.
- **Scorer lock.** `scorer_locks.matchId` is unique (one scorer per match); Redis caches the holder and serialises concurrent writes.

---
Developed by Sling Groups
