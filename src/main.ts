import { ConsoleLogger, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response } from 'express';
import { existsSync } from 'fs';
import helmet from 'helmet';
import { join } from 'path';
import { AppModule } from './app.module';
import { BRANDING } from './config/configuration';
import { setupSwagger } from './docs/swagger';
import { RedisService } from './infrastructure/redis/redis.service';
import { StorageService } from './infrastructure/storage/storage.service';
import { RedisIoAdapter } from './modules/live/redis-io.adapter';

/**
 * Serves the web app (web/dist, built with `npm run web:build`) at "/".
 * Unknown non-API GET routes fall back to index.html so client-side routes deep-link correctly.
 * The build is detected at startup: restart the server after the first `npm run web:build`.
 */
function serveWebApp(app: NestExpressApplication, prefix: string) {
  const dist = join(process.cwd(), 'web', 'dist');
  const index = join(dist, 'index.html');
  if (!existsSync(index)) {
    new Logger('Bootstrap').warn('Web app not built (run `npm run web:build`); only the API is served');
    return;
  }
  app.useStaticAssets(dist, { index: false, maxAge: '1h' });
  const reserved = [`/${prefix}`, '/docs', '/uploads', '/health', '/socket.io'];
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || reserved.some((p) => req.path === p || req.path.startsWith(`${p}/`))) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}

async function bootstrap() {
  const json = process.env.LOG_JSON === 'true';
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new ConsoleLogger({ json, colors: !json, prefix: 'CricketAPI' }),
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  const prefix = config.get<string>('apiPrefix')!;

  app.set('trust proxy', 1);
  // COOP must allow popups, otherwise the Google Sign-In popup can't post the credential back
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
      contentSecurityPolicy: false,
    }),
  );
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    res.setHeader('X-Developed-By', 'Sling Groups');
    next();
  });
  const origins = config.get<string[]>('corsOrigins')!;
  app.enableCors({ origin: origins.includes('*') ? true : origins, credentials: true });
  app.setGlobalPrefix(prefix, { exclude: ['health'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableShutdownHooks();

  // local uploads are served statically; S3 URLs point at the bucket / CDN directly
  const storage = app.get(StorageService);
  if (config.get('storage.driver') === 'local') app.useStaticAssets(storage.localDir, { prefix: '/uploads', maxAge: '7d' });

  const redis = app.get(RedisService);
  if (redis.enabled) app.useWebSocketAdapter(new RedisIoAdapter(app, redis));

  setupSwagger(app, prefix);
  serveWebApp(app, prefix);

  const port = config.get<number>('port')!;
  await app.listen(port, '0.0.0.0');
  const url = await app.getUrl();
  new Logger('Bootstrap').log(`API ${url}/${prefix} | Docs ${url}/docs | WS ${url}/live | ${BRANDING}`);
}

bootstrap();
