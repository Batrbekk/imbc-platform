import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ENV, type Env } from './config/env.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);

  app.useLogger(app.get(Logger));
  app.set('trust proxy', 1); // за ingress/nginx: IP клиента из X-Forwarded-For (NDA, аудит)
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api');
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
