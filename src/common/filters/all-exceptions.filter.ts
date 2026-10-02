import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

/**
 * Global exception filter producing a consistent error envelope:
 * { success: false, statusCode, error, message, details?, path, timestamp }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw exception;
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string = 'Internal server error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') message = body;
      else {
        const b = body as { message?: string | string[]; details?: unknown };
        if (Array.isArray(b.message)) {
          message = 'Validation failed';
          details = b.message;
        } else {
          message = b.message ?? exception.message;
          details = b.details;
        }
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          message = 'Resource already exists';
          details = { fields: exception.meta?.target };
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'Resource not found';
          break;
        case 'P2003':
          status = HttpStatus.BAD_REQUEST;
          message = 'Related resource does not exist';
          details = { field: exception.meta?.field_name };
          break;
        default:
          message = 'Database error';
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      message = 'Invalid query parameters';
    }

    if (status >= 500) {
      const err = exception as Error;
      this.logger.error(`${req.method} ${req.url} -> ${err?.message}`, err?.stack);
    }

    res.status(status).json({
      success: false,
      statusCode: status,
      error: HttpStatus[status] ?? 'ERROR',
      message,
      ...(details !== undefined ? { details } : {}),
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }
}
