import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

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
  app.setGlobalPrefix('api');
}
