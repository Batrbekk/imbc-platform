import { PROFILE_JSON_MAX_BYTES } from '@imbc/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { ProblemException } from './problem.js';

/**
 * Ответы API и BFF зависят от сеанса, поэтому браузер их не хранит: иначе после выхода
 * переход «Назад» рисует страницу из кеша с данными прежнего пользователя (NFR-11).
 * Заголовок ставится до маршрутизации и остаётся на успехе, ошибках problem+json и перенаправлениях.
 */
function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/**
 * Настройка HTTP, общая для приложения (main.ts) и тестов на границе HTTP:
 * прокси, заголовки безопасности, запрет кеширования, cookie, префикс /api.
 */
export function configureHttp(app: NestExpressApplication): void {
  app.set('trust proxy', 1); // за ingress/nginx: IP клиента из X-Forwarded-For (NDA, аудит)
  app.use(helmet());
  app.use(noStore);
  app.use(cookieParser());
  // MAN-13: contacts have no row limit. A bounded JSON body allows large lists without unbounded allocation.
  app.useBodyParser('json', { limit: PROFILE_JSON_MAX_BYTES });
  app.use((error: unknown, _req: Request, _res: Response, next: NextFunction) => {
    const type = (error as { type?: unknown } | null)?.type;
    if (type === 'entity.too.large')
      next(new ProblemException(413, 'request_too_large', 'Данные превышают допустимый размер запроса.'));
    else if (type === 'entity.parse.failed') next(new ProblemException(400, 'validation', 'Некорректный JSON.'));
    else next(error);
  });
  app.setGlobalPrefix('api');
}
