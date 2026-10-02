import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../../common/interfaces/auth-user.interface';
import { AuthUserLoader } from '../auth/auth-user.loader';
import { LiveEvent, matchRoom, tournamentRoom, userRoom } from './live.events';
import { LiveService } from './live.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Live score gateway. Connect to namespace `/live` with `auth: { token: <accessToken> }`.
 * Spectators join `match:join` rooms; all scoring writes go through REST (scorer lock enforced there).
 */
@WebSocketGateway({ namespace: '/live', cors: { origin: '*' }, transports: ['websocket', 'polling'] })
export class LiveGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(LiveGateway.name);
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly loader: AuthUserLoader,
    private readonly live: LiveService,
  ) {}

  afterInit(server: Server) {
    this.live.attach(server);
  }

  async handleConnection(client: Socket) {
    try {
      const raw =
        (client.handshake.auth?.token as string | undefined) ??
        (client.handshake.headers.authorization as string | undefined)?.replace(/^Bearer /, '') ??
        (client.handshake.query?.token as string | undefined);
      if (!raw) throw new Error('missing token');
      const payload = await this.jwt.verifyAsync<JwtPayload>(raw);
      const user = await this.loader.load(payload.sub);
      if (!user) throw new Error('unknown user');
      client.data.user = { id: user.id, name: user.name };
      await client.join(userRoom(user.id));
    } catch (e: any) {
      client.emit(LiveEvent.ERROR, { code: 'UNAUTHORIZED', message: 'A valid access token is required' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage(LiveEvent.JOIN_MATCH)
  async joinMatch(@ConnectedSocket() client: Socket, @MessageBody() body: { matchId: string }) {
    if (!UUID_RE.test(body?.matchId ?? '')) return { ok: false, error: 'invalid matchId' };
    await client.join(matchRoom(body.matchId));
    const snapshot = await this.live.snapshot(body.matchId).catch(() => null);
    if (snapshot) client.emit(LiveEvent.SCORE_UPDATED, snapshot);
    return { ok: true, room: matchRoom(body.matchId), spectators: await this.live.roomSize(matchRoom(body.matchId)) };
  }

  @SubscribeMessage(LiveEvent.LEAVE_MATCH)
  async leaveMatch(@ConnectedSocket() client: Socket, @MessageBody() body: { matchId: string }) {
    await client.leave(matchRoom(body?.matchId));
    return { ok: true };
  }

  @SubscribeMessage(LiveEvent.JOIN_TOURNAMENT)
  async joinTournament(@ConnectedSocket() client: Socket, @MessageBody() body: { tournamentId: string }) {
    if (!UUID_RE.test(body?.tournamentId ?? '')) return { ok: false, error: 'invalid tournamentId' };
    await client.join(tournamentRoom(body.tournamentId));
    return { ok: true, room: tournamentRoom(body.tournamentId) };
  }

  @SubscribeMessage(LiveEvent.LEAVE_TOURNAMENT)
  async leaveTournament(@ConnectedSocket() client: Socket, @MessageBody() body: { tournamentId: string }) {
    await client.leave(tournamentRoom(body?.tournamentId));
    return { ok: true };
  }
}
