import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureHttp } from './common/http.js';
import { loadEnv } from './config/env.js';

async function bootstrap(): Promise<void> {
  // Конфигурация до сборки модулей: от флага PROTOTYPE_CABINETS зависит, есть ли модуль прототипа.
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register({ prototypeCabinets: env.PROTOTYPE_CABINETS }),
    { bufferLogs: true },
  );

  app.useLogger(app.get(Logger));
  configureHttp(app, env);
  app.enableShutdownHooks();

  // OpenAPI 3.1 — контракт для Web UI и операторов (раздел 13 спецификации).
  const openapi = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('IMBC Platform API')
      .setDescription('REST /api/v1 — ошибки в формате RFC 9457 (application/problem+json)')
      .setVersion('0.1.0')
      .addCookieAuth(env.SESSION_COOKIE_NAME)
      .setOpenAPIVersion('3.1.0')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, openapi, { jsonDocumentUrl: 'api/openapi.json' });

  await app.listen(env.PORT, '0.0.0.0');
}

void bootstrap();
