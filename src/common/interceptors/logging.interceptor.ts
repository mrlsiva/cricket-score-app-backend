import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

/** Structured access log: method, path, status, duration, user. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest();
    const started = Date.now();
    const log = (status: number) =>
      this.logger.log({
        method: req.method,
        path: req.originalUrl,
        status,
        durationMs: Date.now() - started,
        userId: req.user?.id,
        ip: req.ip,
      });
    return next.handle().pipe(
      tap({
        next: () => log(ctx.switchToHttp().getResponse().statusCode),
        error: (e) => log(e?.status ?? 500),
      }),
    );
  }
}
