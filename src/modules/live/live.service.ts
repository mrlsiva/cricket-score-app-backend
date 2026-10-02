import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { matchRoom, tournamentRoom, userRoom } from './live.events';

type SnapshotProvider = (matchId: string) => Promise<unknown>;

/** Broadcast facade used by feature services. Works across instances via the Socket.IO Redis adapter. */
@Injectable()
export class LiveService {
  private readonly logger = new Logger(LiveService.name);
  private server: Server | null = null;
  private snapshotProvider: SnapshotProvider | null = null;

  attach(server: Server) {
    this.server = server;
  }

  /** The scoring module registers how to build a live snapshot (avoids a circular module import). */
  setSnapshotProvider(provider: SnapshotProvider) {
    this.snapshotProvider = provider;
  }

  snapshot(matchId: string) {
    return this.snapshotProvider ? this.snapshotProvider(matchId) : Promise.resolve(null);
  }

  toMatch(matchId: string, event: string, payload: unknown) {
    this.server?.to(matchRoom(matchId)).emit(event, { matchId, ...((payload as object) ?? {}), at: new Date().toISOString() });
  }

  toTournament(tournamentId: string, event: string, payload: unknown) {
    this.server?.to(tournamentRoom(tournamentId)).emit(event, { tournamentId, ...((payload as object) ?? {}), at: new Date().toISOString() });
  }

  toUser(userId: string, event: string, payload: unknown) {
    this.server?.to(userRoom(userId)).emit(event, payload);
  }

  async roomSize(room: string) {
    if (!this.server) return 0;
    try {
      return (await this.server.in(room).fetchSockets()).length;
    } catch {
      return 0;
    }
  }
}
