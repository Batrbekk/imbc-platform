# IMBC Platform

Платформа IMBC — реестр отечественных производителей Казахстана для операторов нефтегазовых проектов, IMBC и самих производителей: регистрация и профиль компании из восьми секций, проверка экспертами IMBC, каталог с фильтрами, выгрузки и подписки, статус актуальности, уведомления, аудит.

Репозиторий собран по документу **«Архитектура платформы IMBC — v0.4»** (04.11.2026) и технической спецификации v1.2. Номера требований (`AUTH-03`, `OPR-05`, `UPD-01`…) и решений (`D-40`, `ADR-06`…) в коде и в этом файле — оттуда.

> Состояние: **dev-стенд и общий auth-срез**. Развёрнута Azure VM с HTTPS и реальной почтой. Все пользовательские экраны авторизации используют собственную тему IMBC на shadcn/ui; Keycloak обслуживает идентификацию внутри системы. Реализованы вход, email-код, ответственность, регистрация и восстановление пароля; каталог, дашборд, очереди и антивирус остаются основой каркаса. Административный кабинет, автоматическая обработка неактивности (AUTH-07) и предметные кабинеты всех ролей ещё не завершены; последовательность — в [плане ролей](docs/development-roadmap.md).

---

## Содержание

1. [Архитектура в одном экране](#1-архитектура-в-одном-экране)
2. [Отличия от документа архитектуры](#2-отличия-от-документа-архитектуры)
3. [Структура репозитория](#3-структура-репозитория)
4. [Предметные модули](#4-предметные-модули)
5. [Контейнеры стенда](#5-контейнеры-стенда)
6. [Данные](#6-данные)
7. [Процессы](#7-процессы)
8. [Доступ и защита](#8-доступ-и-защита) · [Почта](#почта)
9. [Каталог: фильтры в адресе страницы](#9-каталог-фильтры-в-адресе-страницы)
10. [Web UI: shadcn/ui, языки, MCP](#10-web-ui-shadcnui-языки-mcp)
11. [Запуск на dev-сервере](#11-запуск-на-dev-сервере)
12. [Локальная разработка](#12-локальная-разработка)
13. [Конфигурация](#13-конфигурация)
14. [Качество и проверки](#14-качество-и-проверки)
15. [Что дальше](#15-что-дальше)

---

## 1. Архитектура в одном экране

Модульный монолит на NestJS с отдельным процессом worker. PostgreSQL — единственный источник истины: данные, сеансы, очередь заданий и поиск. Файлы — в закрытом S3-хранилище, Valkey — только кеш, вход — через OpenID Connect (Keycloak) с сеансом на стороне BFF. Kafka, OpenSearch, API Gateway и service mesh для этого масштаба (≈2 000 производителей, 200 одновременных пользователей) не нужны — архитектура, §5.

```mermaid
flowchart LR
  B([Браузер]) -->|HTTPS, один origin| N[Caddy в Azure<br/>nginx локально]
  N -->|/| W[Web UI<br/>Next.js App Router]
  N -->|/api| A[API + BFF<br/>NestJS]
  N -->|/kc| K[Keycloak 26<br/>OIDC]
  A -->|OIDC back-channel,<br/>Admin API| K
  A --> P[(PostgreSQL 18<br/>данные · сеансы · очередь pg-boss)]
  A --> V[(Valkey<br/>только кеш)]
  A --> S[(S3 / RustFS<br/>quarantine · files · exports)]
  WK[Worker<br/>NestJS + pg-boss] --> P
  WK --> S
  WK -->|INSTREAM| C[ClamAV]
  WK -->|SMTP| M[Mailpit]
  A -->|SMTP: email-код| M
  K -->|SMTP: установка и сброс пароля| M
  M -->|реальные адреса на Azure dev| E[Azure Communication Services<br/>SMTP STARTTLS]
```

Главные правила, которые держит код:

| Правило | Где в коде |
|---|---|
| Браузер не видит токенов IdP: OIDC-поток и сеанс в BFF, в браузере только HttpOnly-cookie (ADR-04) | `apps/api/src/modules/auth/*` |
| Задание ставится в той же транзакции, что и изменение данных — очередь в PostgreSQL (ADR-06) | `apps/api/src/infra/infra.module.ts`, `src/jobs/queues.ts` |
| Права — одна матрица ролей и действий из раздела 4 спецификации, общая для API и UI (GEN-10) | `packages/contracts/src/policy.ts`, `SessionGuard` |
| Поиск каталога и основные показатели дашборда читают `catalog_visible`; отдельный счётчик неактивных профилей читает только их число. Выгрузки и pull API ещё не реализованы (§10, DATA-34) | `catalog.service.ts`, `schema/platform.ts` |
| Файл недоступен, пока ClamAV не признал его чистым (DATA-07) | `worker/handlers.service.ts → scanFile` |
| Журнал аудита только дополняется: у роли приложения нет UPDATE/DELETE (AUD-02) | `database/migrate.ts`, `infrastructure/postgres/init.sql` |
| Уведомления `send-notification` дедуплицируются по событию и адресу (NOT-20, ADR-22) | `notifications_sent` + `sendNotification` |
| Все расписания — по Asia/Almaty, независимо от часового пояса сервера | `jobs/queues.ts` |

## 2. Отличия от документа архитектуры

Отличия согласованы при старте сборки; в следующей редакции архитектуры их нужно отразить.

| Тема | Архитектура v0.4 | В репозитории | Почему |
|---|---|---|---|
| Web UI | React 19 + Vite, SPA (§5, §14) | **Next.js 16 App Router**, `output: standalone` | Решение команды. SSR не используется для данных: сеанс, OIDC и права остаются в NestJS BFF, Next.js только рендерит страницы и проксирует `/api` в dev. Фильтры каталога живут в адресе (nuqs), данные — TanStack Query |
| Библиотека компонентов | «по NFR-43» | **shadcn/ui** (new-york, Radix), MCP-сервер shadcn в репозитории | Решение команды |
| Очередь | pg-boss 10.x | pg-boss **12** | Актуальная мажорная версия на момент сборки |
| Авторизация | CASL в процессе API | Функция `can(role, action)` над `POLICY_MATRIX` | Пока правила не зависят от полей объекта, матрицы достаточно. Переход на CASL — когда появятся условия вида «своя организация» на уровне записей; матрица останется источником правил |
| Worker | «один код, два процесса» | Тот же пакет `apps/api`, точка входа `src/worker.ts`, один образ | Ровно то, что сказано в §5; отдельного пакета нет |
| S3 | Продукт выбирается с ИТ IMBC (ADR-13) | **RustFS** на dev-стенде | Лицензия Apache-2.0, совместимость с S3 API. Выбор для production по-прежнему за ИТ IMBC; код использует только S3 API |
| Платформа | Kubernetes, Argo CD | **Docker Compose** | Среда «разработка» в §15 — Docker Compose. Манифесты Kubernetes — этап 1 |

## 3. Структура репозитория

```
imbc-platform/
├─ apps/
│  ├─ api/                     NestJS 12 (ESM): API + BFF, worker и миграции — один образ, три роли
│  │  ├─ src/main.ts           HTTP-процесс (PROCESS_ROLE=api)
│  │  ├─ src/worker.ts         процесс заданий и расписаний (PROCESS_ROLE=worker)
│  │  ├─ src/config/           переменные окружения, проверка zod при старте
│  │  ├─ src/database/         Drizzle: схема по модулям, migrate.ts, seed.ts
│  │  ├─ src/infra/            Valkey, S3, SMTP, pg-boss
│  │  ├─ src/common/           RFC 9457 (problem+json), аудит
│  │  ├─ src/jobs/             имена очередей и расписания
│  │  ├─ src/worker/           обработчики заданий, клиент clamd
│  │  ├─ src/modules/          auth, registration, profiles, catalog, health
│  │  ├─ drizzle/              SQL-миграции (генерирует drizzle-kit)
│  │  └─ test/                 Vitest
│  └─ web/                     Next.js 16 App Router + shadcn/ui + TanStack Query + nuqs + next-intl
│     ├─ messages/             kk.json (по умолчанию), ru.json, en.json
│     └─ src/
│        ├─ app/(auth)/        вход, регистрация, email-код, диалог ответственности
│        ├─ app/(app)/         каталог, дашборд, профиль, аккаунт — за AppShell
│        ├─ components/ui/     компоненты shadcn/ui (правятся в проекте, это не зависимость)
│        ├─ components/app/    оболочка, переключатель языка, провайдеры
│        └─ lib/               клиент BFF, сеанс, параметры каталога
├─ packages/
│  └─ contracts/               общее для API и UI: перечисления, фильтры каталога (zod),
│                              проверка БИН, нормализация названий, PolicyMatrix
├─ infrastructure/
│  ├─ docker/                  api.Dockerfile, web.Dockerfile (Node 26, multi-stage)
│  ├─ azure/                   deploy.sh, Caddyfile, cloud-init, синхронизация настроек realm
│  ├─ keycloak/imbc-realm.json realm: клиенты, политика паролей, блокировка, сеансы, языки, демо-пользователи
│  ├─ keycloak/identity/       React + Keycloakify + shadcn/ui: собственные экраны IMBC
│  ├─ mailpit/                 шаблон SMTP relay; секретный файл существует только на VM
│  ├─ nginx/nginx.conf         единая точка входа локального стенда
│  └─ postgres/init.sql        роль приложения, база Keycloak, pg_trgm
├─ compose.yaml                весь стенд
├─ compose.azure.yaml          HTTPS, тема IMBC, SMTP relay, диагностические порты на localhost
├─ compose.dev.yaml            публикация портов инфраструктуры для `pnpm dev`
├─ .mcp.json                   MCP-сервер shadcn (Claude Code); копии в .cursor/ и .vscode/
├─ Makefile                    короткие команды
└─ turbo.json, pnpm-workspace.yaml
```

Монорепозиторий на **pnpm workspaces + Turborepo**. Общий код между фронтендом и бэкендом — только `@imbc/contracts`: одна схема фильтров разбирает и адрес страницы, и query string API, одна матрица прав прячет пункты меню и проверяет запрос.

## 4. Предметные модули

Модули и их таблицы — по §6 архитектуры. Граница модуля: публичный вход `index.ts`, запись в чужие таблицы только через метод владельца; чтение — через разрешённые SQL-проекции (каталог, выгрузки, pull API, дашборд).

| Модуль | Отвечает за | Таблицы | Требования | В каркасе |
|---|---|---|---|---|
| Organizations | Типы организаций, БИН с контрольным разрядом | `organizations` | GEN-01–06 | схема, проверка БИН |
| Identity and Access | Вход, сеансы BFF, email-код, доверенные устройства, ответственность, PolicyMatrix | `user_accounts`, `sessions`, `otp_codes`, `trusted_devices`, `responsibility_acceptances`, `auth_rate_limits`, `auth_security_events`, `auth_sync_state`, `revoked_idp_sessions`, `api_access` | AUTH-01–10, GEN-10–15 | общий auth-срез реализован; кабинет администратора и автоматическая неактивность AUTH-07 впереди |
| Profiles | Профиль из восьми секций, редакции, полнота | `manufacturer_profiles`, `profile_sections`, `section_revisions`, `contacts`, `shareholders`, `product_lines`, `equipment_*` | MAN-01–96 | черновик при регистрации |
| Review | Назначение, решения по секциям и документам | `review_assignments`, `review_decisions` | REV-01–20 | схема |
| Documents | Карантин, скан, версии, сертификаты и документы | `file_objects`, `file_versions`, `certificates`, `documents` | MAN-70–83, DATA-05–07 | скан ClamAV, истечение сертификатов |
| IMBC Records | Обследования, due diligence, заметки IMBC | `site_survey_records`, `due_diligence_records`, `imbc_notes`, `external_checks` | IMBC-01–32 | схема |
| Operator Records | Works with, визиты, заметки оператора | `works_with_marks`, `operator_visit_marks`, `operator_notes` | OPR-30–52 | схема |
| Requests | Запросы к IMBC и к производителю | `imbc_requests`, `operator_requests` | OPR-60–65 | схема |
| Update Status | Квартальный цикл active → outdated → inactive | поля профиля, `update_confirmations` | UPD-01–06 | расписание 09:00; обработчик — заглушка |
| Catalog and Dashboard | Поиск, фильтры, страница компании, дашборд | `catalog_visible` | OPR-01–14, OPR-70–73 | **поиск и дашборд работают** |
| Exchange | Выгрузки XLSX/CSV, подписки, pull API | `export_files`, `export_subscriptions`, `api_access` | OPR-20–24, OPR-80–82 | очистка файлов старше 90 дней |
| Demand and NDA | NDA, версии прогноза (R2) | `nda_*`, `forecast_*`, `tech_spec_files` | FC-01–10 | схема |
| Notifications | Письма с дедупликацией | `notifications_sent` | NOT-01–42 | отправка с дедупликацией |
| Audit and Snapshots | Журнал, снимки активности | `audit_entries`, `activity_snapshots` | AUD-01–04 | запись событий входа и отказов |
| Reference Data | Справочники и переводы | `dictionaries`, `dictionary_entries` | ADM-10/11 | схема |
| Import and Migration | Staging, mapping, приглашение мигрированных | — | MIG-01–15 | этап миграции |

## 5. Контейнеры стенда

Базовый локальный `docker compose up -d --build` поднимает следующие сервисы. Для Azure обязательно добавляется `compose.azure.yaml`: снаружи работают Caddy/80 и 443, диагностические порты привязаны к localhost VM, Keycloak собирается с темой IMBC, Mailpit подключается к SMTP relay.

| Сервис | Образ | Назначение | Порт наружу |
|---|---|---|---|
| `nginx` | nginx 1.29 | Единый origin: `/` → web, `/api` → api, `/kc` → keycloak | `8080` |
| `web` | `imbc/web` (Next.js standalone) | Интерфейс | — |
| `api` | `imbc/api` | REST `/api/v1`, BFF `/api/auth`, OpenAPI `/api/docs` | — |
| `worker` | `imbc/api` (`node dist/worker.js`) | Очереди и расписания pg-boss | — |
| `migrate` | `imbc/api` (одноразовый) | Миграции Drizzle, права роли приложения, демо-данные | — |
| `postgres` | postgres 18 | Данные, сеансы, очередь; база `keycloak` для IdP | — |
| `valkey` | valkey 8 | Кеш дашборда и справочников; без снапшотов и AOF | — |
| `rustfs` | rustfs | S3: `imbc-quarantine`, `imbc-files`, `imbc-exports` | `9001` (консоль) |
| `buckets` | aws-cli (одноразовый) | Создаёт бакеты | — |
| `keycloak` | Keycloak 26 | OIDC, пароли, блокировка, письма установки пароля | — |
| `clamav` | clamav 1.4 | Антивирус (clamd :3310) | — |
| `mailpit` | mailpit | Сохраняет письма; базовый локальный Compose не отправляет их наружу | `8025` |

Порядок старта задают `depends_on` и healthcheck: postgres → migrate → api/worker; keycloak healthy → api → nginx. ClamAV при первом запуске несколько минут скачивает сигнатуры — задания проверки файлов ждут в очереди и повторяются.

## 6. Данные

- **PostgreSQL 18**, идентификаторы — `uuidv7()` на стороне БД (упорядочены по времени, без отдельной последовательности).
- **Схема** — `apps/api/src/database/schema/*.ts` (Drizzle), разбита по модулям: `access`, `profiles`, `records`, `exchange`, `platform`. Перечисления генерируются из `@imbc/contracts`, поэтому значения в БД, API и UI совпадают.
- **Миграции** — `pnpm --filter @imbc/api db:generate` создаёт SQL в `apps/api/drizzle/`; применяет их сервис `migrate`. Правило — expand → migrate → contract (NFR-13): каждая миграция совместима с предыдущей версией приложения.
- **Редакции секций.** У каждой секции профиля три указателя: верифицированная, ожидающая проверки и рабочая редакция. Операторы видят только верифицированную — так «изменения на проверке» (pending changes) не попадают в каталог.
- **Проекция `catalog_visible`** — одна строка на видимый профиль (Verified и статус актуальности active/outdated), собранная только из верифицированных редакций. GIN-индексы: триграммы по нормализованному названию, массивы групп, типов, сертификатов, ОКЭД.
- **Нормализация названий** (`normalizeCompanyName`): казахские буквы сводятся к базовым (ә→а, қ→к, ң→н, ө→о, ұ/ү→у, і→и…), кавычки и одна организационно-правовая форма по краям убираются. «ТОО «Қазақ Металл»» и «казак металл» находят одну компанию.
- **Роли БД.** `imbc` — владелец схемы, от него идут миграции. `imbc_app` — роль приложения: SELECT/INSERT/UPDATE/DELETE, кроме UPDATE/DELETE/TRUNCATE на `audit_entries`.
- **Valkey** — только кеш (ADR-11). Его потеря ничего не ломает: API продолжает работать, дашборд считается из БД.

## 7. Процессы

### Вход (AUTH-01…AUTH-10, ADR-04, ADR-20)

```mermaid
sequenceDiagram
  participant B as Браузер
  participant A as BFF (NestJS)
  participant K as Keycloak
  participant M as Почта
  B->>A: GET /api/auth/login?returnTo=/catalog
  A-->>B: 302 на Keycloak (PKCE S256, state в подписанной cookie)
  B->>K: логин и пароль (блокировка: 10 ошибок → 15 минут)
  K-->>B: 302 /api/auth/callback?code=…
  A->>K: обмен code → токены (back-channel)
  A->>A: учётная запись по sub/email, сеанс в PostgreSQL
  alt устройство не доверенное
    A-->>B: 302 /auth/verify
    B->>A: POST /api/auth/otp/send
    A->>M: код из 6 цифр (10 минут, 5 попыток, не чаще раза в минуту)
    B->>A: POST /api/auth/otp/verify → cookie устройства на 30 дней
  end
  opt первый вход
    B->>A: POST /api/auth/responsibility (запись в аудит)
  end
  B->>A: запросы /api/v1/* с cookie сеанса
```

Сеанс BFF: простой 30 минут, абсолютный срок 12 часов от аутентификации в IdP. Подписанный backchannel logout отзывает связанные сеансы по `sid` и предотвращает их повторное создание запоздавшим callback. События смены пароля обрабатываются worker раз в минуту: старые сеансы и доверие к устройствам отзываются до попыток отправить уведомления. Выход выполняется между BFF и IdP; браузер получает только локальный адрес страницы подтверждения выхода. Проверки состояния аккаунта и `auth_version` уже действуют на каждом запросе; административные операции блокировки и смены роли будут реализованы следующим этапом (AUTH-06).

Автоматическое предупреждение и перевод аккаунтов в `inactive` после трёх месяцев без входа (AUTH-07) пока не реализованы: очередь `account-inactivity` имеет расписание и обработчик-заглушку.

### Регистрация производителя (REG, AUTH-01)

`POST /api/v1/registrations` → проверка БИН (формат и контрольный разряд, в браузере и на сервере) → пользователь в Keycloak через Admin API → в одной транзакции организация, учётная запись, черновик профиля из восьми секций и задание `send-password-email` на письмо подтверждения email и установки пароля со сроком 72 часа. Ответ `202 password_email_queued` означает постановку в очередь. Worker повторяет доставку при ошибке SMTP; `POST /api/v1/registrations/resend` возвращает нейтральный ответ независимо от наличия и состояния аккаунта. Если транзакция не прошла, пользователь в Keycloak удаляется; неудачная компенсация ставится в `cleanup-identity`. Повтор БИН — `409 bin_exists` с текстом «обратитесь в IMBC».

### Файл (DATA-05…07)

Для задания `scan-file` worker читает объект из `imbc-quarantine` и передаёт поток в clamd (INSTREAM): чистый файл копируется в `imbc-files`, заражённый помечается `infected` и пишется в аудит; карантинная копия удаляется в обоих случаях. Пользовательские загрузка и скачивание через авторизованный API ещё входят в план разработки профиля.

### Задания и расписания (ADR-06)

API ставит задания, выполняет их worker. Для `send-password-email` и `cleanup-identity` настроено до 10 повторов, для остальных очередей — до 5; начальная пауза 30 секунд увеличивается при ошибках. Уведомления имеют отдельную дедупликацию; доставка письма установки пароля при повторе задания может повториться.

| Очередь | Когда (Asia/Almaty) | Что делает | Состояние |
|---|---|---|---|
| `scan-file` | по событию | Проверка ClamAV, перенос из карантина | работает |
| `send-notification` | по событию | Письмо с дедупликацией по коду, ключу и адресу | работает |
| `send-password-email` | регистрация или повтор приглашения | Вызов Keycloak для подтверждения email и установки пароля приглашённому аккаунту | работает |
| `cleanup-identity` | неудачная компенсация регистрации | Удаление пользователя IdP, если аккаунт платформы не был создан | работает |
| `certificate-expiry` | 00:30 ежедневно | Сертификаты с истёкшим сроком → `expired` (профиль не скрывается, REV-20) | работает |
| `purge-export-files` | 01:00 ежедневно | Удаление файлов выгрузок старше 90 дней (OPR-23) | работает |
| `purge-sessions` | каждый час, :15 | Просроченные сеансы, коды, доверенные устройства и служебные записи защиты входа | работает |
| `account-inactivity` | 02:00 ежедневно | Неактивные учётные записи (AUTH-07) | заглушка |
| `run-subscriptions` | 06:00 ежедневно | Подписки на выгрузки (OPR-20) | заглушка |
| `update-status` | 09:00 ежедневно | Квартальный цикл актуализации (UPD-01…05) | заглушка |
| `keycloak-events` | каждую минуту | Смена пароля → отзыв доступа; блокировка → аудит и письмо (AUTH-04) | работает |
| `activity-snapshot-*` | пн 03:00 / 1-е число 03:00 | Снимки активности (OPR-74) | заглушка |
| `refresh-catalog`, `build-export` | по событию | Пересборка проекции, файл выгрузки | заглушка |

## 8. Доступ и защита

- **PolicyMatrix** (`packages/contracts/src/policy.ts`) — роли × действия из раздела 4 спецификации. Значение — условие доступа: `own`, `visible`, `all`, `after_nda`, `account_events`. Контроллер помечает маршрут `@Can('catalog.search')`; `SessionGuard` проверяет сеанс, второй фактор, принятие ответственности и право, а условие кладёт в контекст запроса для сервиса. Отказ пишется в аудит.
- **Шесть ролей**: производитель, эксперт, администратор, директор (IMBC — без суперпользователя, ADR-19), оператор, наблюдатель. Роль хранится в платформе, не в Keycloak: IdP отвечает только за «кто это».
- **CSRF**: изменяющие запросы принимаются только со своего Origin; cookie `SameSite=Lax`, `HttpOnly`, на HTTPS — `Secure` и префикс `__Host-`.
- **Ошибки** — RFC 9457 `application/problem+json` с машинным `code` (`bin_exists`, `mfa_required`, `forbidden`…); UI переводит их по коду.
- **Логи** — pino, cookies и заголовки авторизации вырезаются (NFR-32). Секреты — только в переменных окружения.
- **Keycloak 26.4** проверяет пароли штатными механизмами; все видимые пользователю формы входа, установки и восстановления пароля — собственная тема IMBC на React и shadcn/ui из `infrastructure/keycloak/identity`. Политика паролей (≥ 12 символов), блокировка 10/15 минут, сеансы 30 минут / 12 часов и ссылки установки/сброса пароля 72 часа заданы в `imbc-realm.json`. Email-код, доверенное устройство и диалог ответственности — в BFF (таблица §5 архитектуры).

### Почта

Почта нужна уже для входа, поэтому почтовый сервис — часть стенда, а не «потом».

| Письмо | Кто отправляет | Когда | Как |
|---|---|---|---|
| Подтверждение email и установка пароля, ссылка 72 часа (AUTH-01, NOT-01) | Keycloak по заданию worker | Регистрация или повторная отправка приглашения; административное приглашение — следующий этап | `send-password-email` → Admin API `execute-actions-email` |
| Сброс пароля (AUTH-08) | Keycloak | «Забыли пароль?» на странице входа IMBC | Штатный поток сброса с собственной темой IMBC |
| Код входа, 6 цифр, 10 минут (AUTH-03, NOT-02) | API | Вход с недоверенного устройства | Сразу, без очереди — пользователь ждёт код |
| Блокировка после 10 ошибок (AUTH-04, NOT-03) | Worker | Событие `USER_DISABLED_BY_TEMPORARY_LOCKOUT` в Keycloak, проверка раз в минуту | Очередь, одно письмо на блокировку |
| Уведомления каталога NOT (профиль, проверка, сертификаты, статус актуальности) | Worker | Обработчик `send-notification` готов; постановка из предметных процессов добавляется вместе с ними | Дедупликация `code + dedupe_key + адрес` (NOT-20) |

- Письма платформы — на языке учётной записи (kk по умолчанию, ru, en), текст и HTML; шаблоны в `apps/api/src/mail/templates.ts`, отправка — `MailService`. При старте API и worker проверяют SMTP (`verify`) и пишут результат в лог, но не падают: письма из очереди повторятся.
- **Azure dev:** API и Keycloak передают письма в **Mailpit**, который сохраняет копию и пересылает реальные адреса через Azure Communication Services SMTP (STARTTLS). Адреса `.local`, `.localhost`, `.invalid`, `.test`, `.example` остаются только в Mailpit. Интерфейс — `/dev-mail/` на HTTPS-домене, с `MAILPIT_UI_AUTH`. Письма хранятся в томе `mailpit-data` (до 5 000 штук).
- Relay-конфигурация находится только на сервере: `infrastructure/mailpit/.env.smtp-relay.yaml` с правами `0600`; шаблон — `relay.example.yaml`. В `.env`: `MAILPIT_RELAY_CONFIG=/etc/mailpit/.env.smtp-relay.yaml`, `MAILPIT_RELAY_ALL=true`. Временный домен Azure допускает до 5 писем в минуту и 10 в час на подписку; для более активной разработки нужен свой домен. Локальный Compose без Azure-overlay сохраняет прежний режим перехвата без отправки.
- **Реальная доставка** (test/acceptance/prod или проверка на настоящих ящиках) — две настройки в `.env`:
  - платформа: `SMTP_URL=smtps://user:password@smtp.imbc.kz:465` (или `smtp://…:587` для STARTTLS), `MAIL_FROM`;
  - Keycloak: `KEYCLOAK_SMTP_HOST`, `KEYCLOAK_SMTP_PORT`, `KEYCLOAK_SMTP_AUTH=true`, `KEYCLOAK_SMTP_USER`, `KEYCLOAK_SMTP_PASSWORD`, `KEYCLOAK_SMTP_SSL` или `KEYCLOAK_SMTP_STARTTLS`.

  На Azure-стенде `deploy.sh` после запуска обновляет управляемые SMTP-настройки существующего realm через `infrastructure/azure/sync-realm.py`. Источник — серверная `.env` и `imbc-realm.json`; изменения только в консоли будут заменены следующим развёртыванием.
- Для доставляемости с домена IMBC нужны SPF, DKIM и DMARC на стороне почтового релея — это вопрос ИТ IMBC, не кода.

## 9. Каталог: фильтры в адресе страницы

Требование OPR-05 — выбранные фильтры передаются ссылкой. Поэтому состояние фильтров живёт **только в адресе**:

```
/catalog?q=металл&region=KZ-ATY,KZ-MAN&group=A,B&surveyed=true&tnved=7308&sort=verified_at&page=2
```

- `lib/catalog-params.ts` описывает параметры для **nuqs**; формат совпадает с `catalogFilterSchema` из `@imbc/contracts` — списки через запятую, логические `true/false`.
- Query string страницы без преобразований уходит в `GET /api/v1/catalog/search`, и тот же zod-парсер разбирает его на сервере.
- **TanStack Query** кеширует результат по ключу `["catalog", query]`: «назад» в браузере показывает прошлый поиск мгновенно, `keepPreviousData` не даёт таблице мигать при смене фильтра. Текстовые поля обновляют адрес с задержкой 350 мс.
- Между фильтрами — AND, внутри одного фильтра — OR (OPR-04). Сертификаты по умолчанию учитываются только действующие.
- Кнопка «Скопировать ссылку» копирует текущий адрес; плитки дашборда ведут в каталог с соответствующим фильтром.
- Язык интерфейса — в cookie, не в адресе: одна и та же ссылка открывается на казахском, русском или английском у разных пользователей.

## 10. Web UI: shadcn/ui, языки, MCP

- **Next.js 16 App Router**, Turbopack, `output: "standalone"` — в образе один процесс `node server.js` без dev-зависимостей.
- **shadcn/ui** (стиль new-york, Radix, Tailwind CSS 4, CSS-переменные). Компоненты лежат в `apps/web/src/components/ui` и правятся как свой код. Тема — синий, белый, чёрный (NFR-60) в `src/app/globals.css`; меняются только переменные.
- **Формы идентификации IMBC** — отдельный пакет React + Keycloakify в `infrastructure/keycloak/identity` с собственными компонентами shadcn/ui. Azure-overlay собирает его в образ `imbc/keycloak:dev`; пользовательские экраны всех ролей не используют стандартное оформление Keycloak. Пакет имеет отдельный `package-lock.json` и сборку внутри Docker.
- **Языки** — next-intl: казахский по умолчанию (GEN-20), русский, английский; часовой пояс Asia/Almaty. Шрифт Inter (с казахскими глифами) поставляется npm-пакетом, без обращения к Google Fonts при сборке.
- **MCP-сервер shadcn** подключён в `.mcp.json` (Claude Code), `.cursor/mcp.json` и `.vscode/mcp.json`:

  ```json
  { "mcpServers": { "shadcn": { "command": "npx", "args": ["shadcn@latest", "mcp", "--cwd", "apps/web"] } } }
  ```

  Ассистент в редакторе может искать компоненты реестра, смотреть примеры и добавлять их командой `npx shadcn@latest add <имя>` (из `apps/web`).

  В текущем Codex-клиенте официальный MCP также установлен и проверен вызовами реестра: примеры `input-otp`, компоненты `field` и контрольный список аудита применены при работе над авторизацией. Локальная настройка Codex находится вне репозитория.

## 11. Запуск на dev-сервере

Для Azure используется один Ubuntu 24.04 VM с Docker Compose и HTTPS через Caddy. Скрипт [infrastructure/azure/deploy.sh](infrastructure/azure/deploy.sh) работает с текущей подпиской `az login`; нужны Azure CLI, Git, SSH и tar на вашей машине. Docker и Compose устанавливаются на VM через cloud-init.

### Dev-сервер в Azure

Запускайте из корня репозитория:

```bash
./infrastructure/azure/deploy.sh up        # создать или обновить VM, разрешить текущий IP, развернуть HTTPS-стенд
./infrastructure/azure/deploy.sh info      # адреса и способ подключения, без паролей
./infrastructure/azure/deploy.sh redeploy  # загрузить текущие локальные исходники, пересобрать и проверить стенд
./infrastructure/azure/deploy.sh ssh       # подключиться к VM
```

По умолчанию: `imbc-dev-rg` / `imbc-dev`, `polandcentral`, `Standard_D4as_v5` (4 vCPU, 16 ГБ RAM), Standard SSD 128 ГБ. SSH-ключ хранится локально в `~/.ssh/imbc-dev-azure`, приложение на VM — в `/home/imbc/imbc-platform`. Подробные адреса, команды обслуживания и стоимость: [runbook Azure dev](docs/deployment/azure-dev.md).

- Caddy получает и обновляет TLS-сертификат для `PUBLIC_HOST`. HTTPS/443 и SSH/22 разрешены только с текущего внешнего IP; HTTP/80 открыт для ACME и перенаправления на HTTPS. После смены сети повторите `up`: он обновит IP в NSG и заново развернёт текущий код. Для заданного адреса используйте `ALLOW_FROM=1.2.3.4/32 ./infrastructure/azure/deploy.sh up`.
- Запуск всегда объединяет `compose.yaml` и `compose.azure.yaml`. API, Keycloak, Web и Mailpit доступны через Caddy; PostgreSQL, Valkey и S3 API остаются в Docker-сети. Порты nginx, Mailpit и консоли S3 привязаны к localhost VM.
- Серверная `.env` создаётся со случайными секретами и правами `0600`. В ней включены `COOKIE_SECURE=true`, cookie с префиксом `__Host-` и `KEYCLOAK_SSL_REQUIRED=external`. Повторное развёртывание сохраняет `.env`, данные и TLS-сертификаты; `info` не печатает пароли.
- Realm Keycloak импортируется один раз. После каждого запуска `sync-realm.py --theme imbc` обновляет разрешённый набор настроек темы, политик, событий, SMTP и клиента BFF; пользователи и client secrets сохраняются. Изменение hostname, секретов или переход существующего HTTP-стенда на HTTPS требует согласованной миграции; скрипт останавливается при несовместимой `.env`.
- На dev используются демо-данные и Mailpit с Azure SMTP relay: настоящие адреса получают письма, адреса демо-пользователей `.local` остаются в Mailpit.

| Что | Адрес относительно HTTPS-домена |
|---|---|
| Платформа | `/` |
| OpenAPI | `/api/docs` |
| Консоль Keycloak | `/kc/admin/` |
| Почта с кодами входа | `/dev-mail/`, пароль из `MAILPIT_UI_AUTH` в серверной `.env` |
| Консоль S3 | SSH-туннель на `127.0.0.1:9001`, см. runbook |

**Демо-учётные записи** при `SEED_DEMO=true`; общий начальный пароль находится в `KEYCLOAK_DEV_USER_PASSWORD` серверной `.env`:

| Почта | Роль |
|---|---|
| `expert@imbc.local` | эксперт IMBC |
| `admin@imbc.local` | администратор IMBC |
| `director@imbc.local` | директор IMBC |
| `operator@operator.local` | оператор |
| `spectator@spectator.local` | наблюдатель |
| `manufacturer@demo.local` | производитель |

Первый вход: пароль → код из письма → диалог ответственности → стартовая страница по роли: `/profile` для производителя, `/account` для администратора, `/catalog` для остальных. Демо-коды читаются в Mailpit, реальные адреса получают их на почту. Каталог содержит восемь вымышленных компаний. Наличие стартовой страницы не означает готовность предметного кабинета. Все видимые формы авторизации используют shadcn/ui в теме IMBC; Keycloak остаётся внутренним сервисом учётных записей. Языки: kk, ru, en.

Для временной остановки и прекращения оплаты вычислений используйте `az vm deallocate -g imbc-dev-rg -n imbc-dev`. Диск и статический IP продолжают тарифицироваться; возобновление — `az vm start -g imbc-dev-rg -n imbc-dev`. Данные сохраняются. Ориентир при непрерывной работе — около 165 USD/месяц без переменных расходов, подробности в runbook.

## 12. Локальная разработка

Инфраструктура в Docker, приложения на хосте с hot reload. Нужны Node.js 26 (`.nvmrc`) и pnpm 10.

```bash
pnpm install
make env && make secrets
# в корневом .env: PUBLIC_URL=http://localhost:3000 — до первого старта keycloak
make infra                                   # postgres, valkey, rustfs, keycloak, clamav, mailpit + миграции
cp apps/api/.env.example apps/api/.env       # перенести пароли из корневого .env
cp apps/web/.env.example apps/web/.env.local
pnpm dev                                     # web :3000, api :3001 (turbo)
pnpm --filter @imbc/api dev:worker           # worker, если нужен
```

Next.js проксирует `/api` на `localhost:3001` и `/kc` на Keycloak (`localhost:8180`), поэтому браузер, как и на стенде, работает с одним origin `http://localhost:3000`.

| Команда | Что делает |
|---|---|
| `pnpm dev` | Все приложения в режиме разработки |
| `pnpm build` | Сборка всех пакетов (turbo, с кешем) |
| `pnpm typecheck` | Проверка типов |
| `pnpm test` | Тесты пакетов через Turbo: Vitest в API/contracts, Node test runner в web |
| `pnpm --filter @imbc/api db:generate` | SQL-миграция из изменений схемы |
| `pnpm --filter @imbc/api db:migrate` | Применить миграции (нужен `DATABASE_URL` владельца) |
| `cd apps/web && npx shadcn@latest add <компонент>` | Добавить компонент shadcn/ui |
| `make help` | Все цели Makefile |

## 13. Конфигурация

Все параметры — переменные окружения; API проверяет их zod-схемой при старте и не запускается с неверной конфигурацией (`apps/api/src/config/env.ts`). Шаблоны: `.env.example` (стенд), `apps/api/.env.example`, `apps/web/.env.example` (разработка на хосте).

| Переменная | Назначение |
|---|---|
| `PUBLIC_URL` | Адрес, который видит браузер; из него строятся issuer, redirect URI, ссылки в письмах |
| `PROCESS_ROLE` | `api` или `worker` — какой процесс запускает образ |
| `DATABASE_URL` | Подключение роли приложения `imbc_app` |
| `DB_OWNER_PASSWORD`, `DB_APP_PASSWORD`, `KEYCLOAK_DB_PASSWORD` | Пароли ролей PostgreSQL |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_*` | S3-хранилище и бакеты |
| `OIDC_ISSUER`, `OIDC_INTERNAL_URL` | Публичный issuer и внутренний адрес Keycloak для back-channel |
| `OIDC_CLIENT_SECRET`, `KEYCLOAK_ADMIN_CLIENT_SECRET` | Секреты клиентов `imbc-bff` и `imbc-admin-api` |
| `SESSION_SECRET` | Подпись cookie OIDC-потока (≥ 32 символа) |
| `SESSION_COOKIE_NAME`, `DEVICE_COOKIE_NAME`, `COOKIE_SECURE` | Cookies сеанса и доверенного устройства |
| `SMTP_URL`, `MAIL_FROM`, `IMBC_MAILBOX` | Почта платформы (по умолчанию Mailpit) |
| `KEYCLOAK_SMTP_*` | Почта Keycloak: установка и сброс пароля |
| `MAILPIT_UI_AUTH` | Пароль на интерфейс Mailpit |
| `MAILPIT_RELAY_CONFIG`, `MAILPIT_RELAY_ALL` | Конфигурация и автоматическая пересылка Mailpit в Azure-overlay; SMTP-секрет хранится отдельно на VM |
| `CLAMAV_HOST`, `CLAMAV_PORT` | clamd |
| `SEED_DEMO` | Демо-данные при миграции (только dev) |

## 14. Качество и проверки

```bash
pnpm typecheck && pnpm test && pnpm build
docker compose config -q
```

Для текущего auth-среза прошли:

- `@imbc/contracts` — **23 теста**: БИН, нормализация названий, фильтры, матрица прав, безопасный `returnTo` и стартовая страница роли.
- `@imbc/api` — **45 тестов**, включая **16 интеграционных на PostgreSQL 18**: параллельные OTP и лимиты, истечение и отзыв сеансов, подписанный backchannel logout, смена пароля, отказ SMTP, транзакционная регистрация с pg-boss и компенсация IdP. Также проверяются guard/Origin, clamd и шаблоны писем.
- `@imbc/web` — **4 теста** переходов по ролям, ограничения назначения и безопасного возврата. Проверки типов, lint web и сборки API/web выполнены отдельно.

Интеграционные API-тесты запускаются только при заданном `TEST_DATABASE_URL` с отдельной одноразовой БД **`imbc_auth_test`**: тестовый набор пересоздаёт её схемы. Без этой переменной 16 тестов пропускаются; обычный `pnpm test` не подтверждает их выполнение. Внешние IdP/SMTP-вызовы в этих тестах подменены, поэтому доставка настоящего письма и весь браузерный путь проверяются отдельно на dev-стенде.

Для проверки Azure Compose используйте `docker compose -f compose.yaml -f compose.azure.yaml config -q` с серверной конфигурацией. Приёмочные сценарии общего входа и будущих ролей перечислены в [roadmap](docs/development-roadmap.md); они не считаются пройденными автоматически по результатам unit/integration-тестов. Полный набор браузерных сценариев и нагрузочный тест k6 (NFR-20) остаются отдельной работой.

## 15. Что дальше

Критерии и последовательность по ролям — в [development-roadmap.md](docs/development-roadmap.md): общий auth → минимальное администрирование → производитель → эксперт → оператор → наблюдатель → директор. Предметные задачи по §18 архитектуры:

1. **Минимальное администрирование**: приглашения, блокировка и смена роли, аудит аккаунтов; автоматическая неактивность AUTH-07 и восстановление доступа.
2. **Профиль производителя**: восемь секций, редакции, полнота, отправка на проверку, загрузка файлов через авторизованный API и карантин (MAN, DATA-05…07).
3. **Проверка экспертом**: очередь, назначение, решения по секциям, pending changes, пересборка `catalog_visible` по событию `ProfileVerified` (REV), затем записи IMBC.
4. **Кабинет оператора**: справочники и фильтры, страница компании и PDF, записи своей организации, запросы, стандартные выгрузки и pull API (OPR).
5. **Наблюдатель**: завершённое чтение разрешённых данных с проверкой серверных запретов изменений и выгрузок.
6. **Директор**: разрешённое чтение профилей и записей, дашборд, выгрузки и полный аудит.
7. **Сквозные процессы**: статус актуальности и уведомления (UPD, NOT), миграция данных и приглашения (MIG); прогноз спроса, NDA и подписки — отдельный Release 2.
8. **Эксплуатация**: резервное копирование и восстановление, нагрузка и наблюдаемость; для production — Helm/Kustomize, Argo CD, Vault/OpenBao, Grafana Alloy.

Открытые вопросы, которые архитектура не решает сама, — раздел 23 документа архитектуры.
