import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface Paginated<T> {
  items: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export const isPaginated = (v: unknown): v is Paginated<unknown> =>
  !!v && typeof v === 'object' && Array.isArray((v as any).items) && !!(v as any).meta;

/**
 * Wraps every JSON response in `{ success: true, data, meta? }`.
 * Paginated service results (`{ items, meta }`) are flattened into data + meta.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile || Buffer.isBuffer(data)) return data;
        if (isPaginated(data)) return { success: true, data: data.items, meta: data.meta };
        return { success: true, data: data ?? null };
      }),
    );
  }
}
