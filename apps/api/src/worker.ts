import 'reflect-metadata';
import { createServer } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { ENV, type Env } from './config/env.js';
import { WorkerModule } from './worker/worker.module.js';

/**
 * Worker — тот же код и тот же образ, что и API, другая точка входа (PROCESS_ROLE=worker).
 * Выполняет задания pg-boss и расписания; наружу открыт только /health для оркестратора.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  const env = app.get<Env>(ENV);

  createServer((req, res) => {
    const ok = req.url === '/health/live' || req.url === '/health/ready';
    res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: ok ? 'ok' : 'not_found' }));
  }).listen(env.WORKER_HEALTH_PORT, '0.0.0.0');
}

void bootstrap();
