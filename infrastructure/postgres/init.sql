-- Выполняется один раз при создании тома PostgreSQL (docker-entrypoint-initdb.d).
-- Владелец схемы приложения — POSTGRES_USER (imbc): от его имени идут миграции.
-- Приложение работает под отдельной ролью imbc_app без UPDATE/DELETE на журнале аудита (AUD-02).

\set app_password `echo "$DB_APP_PASSWORD"`
\set kc_password `echo "$KEYCLOAK_DB_PASSWORD"`

CREATE ROLE imbc_app LOGIN PASSWORD :'app_password';
GRANT CONNECT, CREATE ON DATABASE imbc TO imbc_app;   -- CREATE: схема pg-boss создаётся при старте
GRANT USAGE ON SCHEMA public TO imbc_app;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Keycloak держит свои данные в отдельной базе того же кластера (dev-стенд).
CREATE ROLE keycloak LOGIN PASSWORD :'kc_password';
CREATE DATABASE keycloak OWNER keycloak;
