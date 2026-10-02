import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { ServerOptions } from 'socket.io';
import { RedisService } from '../../infrastructure/redis/redis.service';

/** Socket.IO adapter that fans out broadcasts across API instances through Redis pub/sub. */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(app: INestApplicationContext, private readonly redis: RedisService) {
    super(app);
    const pub = redis.duplicate();
    const sub = redis.duplicate();
    if (pub && sub) this.adapterConstructor = createAdapter(pub, sub);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, { ...options, pingInterval: 25000, pingTimeout: 20000 });
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }
}
