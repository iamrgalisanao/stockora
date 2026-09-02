import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { RequestContextService } from './request-context';

export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
  correlationId: string | null;
}

/**
 * One consistent error shape for every failure, and structured server-side logging. 5xx are logged
 * at error with their correlation id (so a failure in the logs ties to the request and its audit
 * trail); 4xx are expected client errors and logged at debug. Internal details never leak to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  constructor(private readonly context: RequestContextService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const correlationId = this.context.get()?.correlationId ?? null;

    // Errors thrown by express middleware (e.g. body-parser's 413) aren't HttpExceptions but carry a
    // numeric status — honor it so a payload-too-large stays a 413, not a masked 500.
    const raw = exception as { status?: number; statusCode?: number; message?: string };
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : typeof raw?.status === 'number'
          ? raw.status
          : typeof raw?.statusCode === 'number'
            ? raw.statusCode
            : HttpStatus.INTERNAL_SERVER_ERROR;
    let error = 'Internal Server Error';
    let message: string | string[] = 'Something went wrong';

    if (!(exception instanceof HttpException) && status < 500 && typeof raw?.message === 'string') {
      message = raw.message;
      error = HttpStatus[status] ? String(HttpStatus[status]).replace(/_/g, ' ') : 'Error';
    }

    if (exception instanceof HttpException) {
      const r = exception.getResponse();
      if (typeof r === 'string') {
        message = r;
        error = exception.name.replace(/Exception$/, '');
      } else if (r && typeof r === 'object') {
        const body = r as { message?: string | string[]; error?: string };
        message = body.message ?? exception.message;
        error = body.error ?? exception.name.replace(/Exception$/, '');
      }
    }

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} ${status} cid=${correlationId ?? '-'}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.debug(`${req.method} ${req.originalUrl} ${status} cid=${correlationId ?? '-'}`);
    }

    const payload: ErrorBody = {
      statusCode: status,
      error,
      // Never surface internal exception detail on a 500.
      message: status >= 500 ? 'Internal server error' : message,
      path: req.originalUrl,
      timestamp: new Date().toISOString(),
      correlationId,
    };
    res.status(status).json(payload);
  }
}
