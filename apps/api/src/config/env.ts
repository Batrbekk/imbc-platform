import { existsSync } from 'node:fs';
import { z } from 'zod';

/** Конфигурация из переменных окружения; невалидная конфигурация останавливает старт. */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Runtime optimization mode is independent of the explicitly selected deployment tier. */
    DEPLOYMENT_ENV: z.enum(['development', 'production']).default('production'),
    DEV_FIXED_OTP_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    DEV_FIXED_OTP_USER_ID: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .uuid()
        .transform((value) => value.toLowerCase())
        .optional(),
    ),
    PORT: z.coerce.number().int().default(3001),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** Роль процесса из одного образа: api (HTTP) или worker (очередь и расписание). */
    PROCESS_ROLE: z.enum(['api', 'worker']).default('api'),
    WORKER_HEALTH_PORT: z.coerce.number().int().default(3002),

    /** Публичный адрес платформы, например https://imbc.example.kz. */
    PUBLIC_URL: z.url(),

    DATABASE_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().default(20),
    PGBOSS_SCHEMA: z.string().default('pgboss'),

    VALKEY_URL: z.string().default('redis://valkey:6379'),

    S3_ENDPOINT: z.url(),
    S3_REGION: z.string().default('us-east-1'),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_BUCKET_QUARANTINE: z.string().default('imbc-quarantine'),
    S3_BUCKET_FILES: z.string().default('imbc-files'),
    S3_BUCKET_EXPORTS: z.string().default('imbc-exports'),

    /** Публичный issuer OIDC (как его видит браузер). */
    OIDC_ISSUER: z.url(),
    /** Внутренний адрес того же провайдера для запросов сервер-сервер (в compose — http://keycloak:8080). */
    OIDC_INTERNAL_URL: z.url().optional(),
    OIDC_CLIENT_ID: z.string().default('imbc-bff'),
    OIDC_CLIENT_SECRET: z.string().min(1),
    /** Сервисный клиент для Keycloak Admin API (регистрация, приглашения, required actions). */
    KEYCLOAK_ADMIN_CLIENT_ID: z.string().default('imbc-admin-api'),
    KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().min(1),
    KEYCLOAK_REALM: z.string().default('imbc'),

    SESSION_COOKIE_NAME: z.string().default('__Host-imbc-session'),
    DEVICE_COOKIE_NAME: z.string().default('__Host-imbc-device'),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    SESSION_SECRET: z.string().min(32),

    CLAMAV_HOST: z.string().default('clamav'),
    CLAMAV_PORT: z.coerce.number().int().default(3310),

    SMTP_URL: z.string().default('smtp://mailpit:1025'),
    MAIL_FROM: z.string().default('IMBC Platform <no-reply@imbc.local>'),
    IMBC_MAILBOX: z.string().default('platform@imbc.local'),
  })
  .superRefine((env, context) => {
    if (!env.DEV_FIXED_OTP_ENABLED) return;
    if (env.DEPLOYMENT_ENV !== 'development')
      context.addIssue({
        code: 'custom',
        path: ['DEPLOYMENT_ENV'],
        message: 'Fixed test OTP requires the development deployment tier',
      });
    if (!env.DEV_FIXED_OTP_USER_ID)
      context.addIssue({
        code: 'custom',
        path: ['DEV_FIXED_OTP_USER_ID'],
        message: 'Fixed test OTP requires one immutable account UUID',
      });
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // `pnpm dev` на хосте: переменные из apps/api/.env. В контейнерах файла нет — всё приходит из окружения.
  if (source === process.env && source.NODE_ENV !== 'production' && existsSync('.env')) process.loadEnvFile('.env');
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Некорректная конфигурация окружения:\n${issues}`);
  }
  const env = parsed.data;
  // Префикс __Host- браузер принимает только у Secure-cookie: на http-стенде он снимается автоматически.
  if (!env.COOKIE_SECURE) {
    env.SESSION_COOKIE_NAME = env.SESSION_COOKIE_NAME.replace(/^__Host-/, '');
    env.DEVICE_COOKIE_NAME = env.DEVICE_COOKIE_NAME.replace(/^__Host-/, '');
  }
  return env;
}

export const ENV = Symbol('ENV');
