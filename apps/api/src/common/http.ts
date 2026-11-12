import { PROTOTYPE_STATE_MAX_BYTES } from '@imbc/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { Express, NextFunction, Request, Response } from 'express';
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

/** После отказа: сколько ещё байт тела и сколько времени соединение ждёт, прежде чем оборваться. */
const LINGER_BYTES = PROTOTYPE_STATE_MAX_BYTES;
const LINGER_MS = 2000;

/**
 * Отказ до чтения или посреди тела. Ответ уходит сразу; остаток тела отбрасывается не дольше
 * `LINGER_BYTES`/`LINGER_MS` (чтобы клиент успел прочитать ответ, а не получил обрыв), затем
 * соединение закрывается — сервер не дочитывает тело сколь угодно большого запроса.
 */
function refuse(req: Request, send: () => void): void {
  const socket = req.socket;
  let extra = 0;
  const count = (chunk: Buffer) => {
    extra += chunk.length;
    if (extra > LINGER_BYTES) socket.destroy();
  };
  const timer = setTimeout(() => socket.destroy(), LINGER_MS);
  timer.unref();
  const done = () => {
    socket.off('data', count);
    clearTimeout(timer);
  };
  socket.on('data', count);
  req.once('end', done);
  socket.once('close', done);
  send();
  req.resume();
}

/**
 * Тело `PUT /api/v1/prototype/state` — до 2 МБ, только этот метод на этом адресе: общий парсер Nest
 * (100 КБ) его пропускает, потому что поток уже прочитан. Запрос без cookie сеанса получает 401, как
 * от guard, и тело не читается. Предел проверяется до разбора и проверки формы; больше предела, не
 * JSON или неверный JSON — 400 problem+json. Тело сверх предела не дочитывается (`refuse`).
 */
function prototypeStateBody(cookieName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.cookies?.[cookieName]) {
      return refuse(req, () =>
        sendProblem(req, res, 401, {
          type: 'https://imbc.kz/problems/unauthenticated',
          title: 'Требуется вход',
          code: 'unauthenticated',
        }),
      );
    }
    const reject = (code: string, title: string) =>
      sendProblem(req, res, 400, { type: `https://imbc.kz/problems/${code}`, title, code });
    const tooLarge = () => refuse(req, () => reject('body_too_large', 'Тело больше 2 МБ'));
    if (!req.is('application/json')) return refuse(req, () => reject('validation', 'Ожидается тело application/json'));
    if (Number(req.get('content-length') ?? 0) > PROTOTYPE_STATE_MAX_BYTES) return tooLarge();
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size <= PROTOTYPE_STATE_MAX_BYTES) return void chunks.push(chunk);
      done = true;
      req.off('data', onData);
      tooLarge();
    };
    req.on('data', onData);
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
  };
}

/**
 * Настройка HTTP, общая для приложения (main.ts) и тестов на границе HTTP:
 * прокси, заголовки безопасности, запрет кеширования, cookie, префикс /api. Предел тела общего
 * состояния прототипа — только при `env.PROTOTYPE_CABINETS` (модуль прототипа — `AppModule.register`).
 */
export function configureHttp(
  app: NestExpressApplication,
  env?: Pick<Env, 'PROTOTYPE_CABINETS' | 'SESSION_COOKIE_NAME'>,
): void {
  app.set('trust proxy', 1); // за ingress/nginx: IP клиента из X-Forwarded-For (NDA, аудит)
  app.use(helmet());
  app.use(noStore);
  app.use(cookieParser());
  // До общих парсеров тела Nest (они подключаются при init): иначе предел 100 КБ сработал бы раньше.
  // Маршрут Express с тем же сравнением путей, что у маршрутов Nest; без флага адреса нет вовсе.
  if (env?.PROTOTYPE_CABINETS) {
    (app.getHttpAdapter().getInstance() as Express).put(
      PROTOTYPE_STATE_PATH,
      prototypeStateBody(env.SESSION_COOKIE_NAME),
    );
  }
  app.setGlobalPrefix('api');
}
