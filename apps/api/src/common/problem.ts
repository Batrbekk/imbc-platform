import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError, type z } from 'zod';

/** Ошибка в формате RFC 9457 (архитектура §11). `code` — машинный код правила. */
export class ProblemException extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super({ code, title, detail }, status);
  }
}

export function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw result.error;
  return result.data;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Problem');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: Record<string, unknown> = { type: 'about:blank', title: 'Internal Server Error', code: 'internal' };

    if (exception instanceof ProblemException) {
      status = exception.getStatus();
      body = {
        type: `https://imbc.kz/problems/${exception.code}`,
        title: exception.title,
        detail: exception.detail,
        code: exception.code,
        ...exception.extra,
      };
    } else if (exception instanceof ZodError) {
      status = HttpStatus.BAD_REQUEST;
      body = {
        type: 'https://imbc.kz/problems/validation',
        title: 'Validation failed',
        code: 'validation',
        errors: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      body = {
        type: 'about:blank',
        title: typeof response === 'string' ? response : exception.message,
        code: `http_${status}`,
      };
    } else {
      this.logger.error(exception);
    }

    if (status === 429 && typeof body.retryAfter === 'number') {
      res.setHeader('Retry-After', String(body.retryAfter));
    }
    res
      .status(status)
      .type('application/problem+json')
      .json({ status, instance: req.originalUrl, ...body });
  }
}
