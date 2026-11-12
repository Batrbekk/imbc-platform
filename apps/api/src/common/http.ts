import { PROTOTYPE_STATE_MAX_BYTES } from '@imbc/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import type { Env } from '../config/env.js';

/**
 * Ответы API и BFF зависят от сеанса, поэтому браузер их не хранит: иначе после выхода
 * переход «Назад» рисует страницу из кеша с данными прежнего пользователя (NFR-11).
 * Заголовок ставится до маршрутизации и остаётся на успехе, ошибках problem+json и перенаправлениях.
 */
function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/** Ошибка RFC 9457 в том же виде, что у `ProblemDetailsFilter`, — для ответа до маршрутизации Nest. */
function sendProblem(req: Request, res: Response, status: number, body: { type: string; title: string; code: string }) {
  res
    .status(status)
    .type('application/problem+json')
    .json({ status, instance: req.originalUrl, ...body });
}

/** Адрес общего состояния прототипа кабинетов (`modules/prototype`). */
const PROTOTYPE_STATE_PATH = '/api/v1/prototype/state';

/**
 * Тело `PUT /api/v1/prototype/state` — до 2 МБ, только на этом адресе: общий парсер Nest (100 КБ) его
 * пропускает, потому что поток уже прочитан. Предел проверяется до разбора и проверки формы; больше
 * предела, не JSON или неверный JSON — 400 problem+json.
 */
function prototypeStateBody(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const reject = (code: string, title: string) =>
    sendProblem(req, res, 400, { type: `https://imbc.kz/problems/${code}`, title, code });
  if (!req.is('application/json')) return reject('validation', 'Ожидается тело application/json');
  if (Number(req.get('content-length') ?? 0) > PROTOTYPE_STATE_MAX_BYTES) {
    return reject('body_too_large', 'Тело больше 2 МБ');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  let done = false;
  req.on('data', (chunk: Buffer) => {
    if (done) return;
    size += chunk.length;
    if (size <= PROTOTYPE_STATE_MAX_BYTES) return void chunks.push(chunk);
    done = true;
    reject('body_too_large', 'Тело больше 2 МБ');
  });
  req.on('error', (error) => {
    if (done) return;
    done = true;
    next(error);
  });
  req.on('end', () => {
    if (done) return;
    done = true;
    try {
      req.body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch {
      return reject('validation', 'Тело — неверный JSON');
    }
    next();
  });
}

/**
 * Флаг `PROTOTYPE_CABINETS` выключен — адреса прототипа нет: тот же 404, что у неизвестного маршрута
 * (`Cannot <METHOD> <url>`), до проверки сеанса и разбора тела.
 */
function prototypeAbsent(req: Request, res: Response): void {
  sendProblem(req, res, 404, {
    type: 'about:blank',
    title: `Cannot ${req.method} ${req.originalUrl}`,
    code: 'http_404',
  });
}

/**
 * Настройка HTTP, общая для приложения (main.ts) и тестов на границе HTTP:
 * прокси, заголовки безопасности, запрет кеширования, cookie, префикс /api. Без `env` (или с
 * `PROTOTYPE_CABINETS=false`) адреса общего состояния прототипа нет.
 */
export function configureHttp(app: NestExpressApplication, env?: Pick<Env, 'PROTOTYPE_CABINETS'>): void {
  app.set('trust proxy', 1); // за ingress/nginx: IP клиента из X-Forwarded-For (NDA, аудит)
  app.use(helmet());
  app.use(noStore);
  app.use(cookieParser());
  // До общих парсеров тела Nest (они подключаются при init): иначе предел 100 КБ сработал бы раньше.
  app.use(PROTOTYPE_STATE_PATH, env?.PROTOTYPE_CABINETS ? prototypeStateBody : prototypeAbsent);
  app.setGlobalPrefix('api');
}
