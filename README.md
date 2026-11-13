# IMBC Platform

Платформа IMBC — реестр отечественных производителей Казахстана для операторов нефтегазовых проектов, IMBC и самих производителей: регистрация и профиль компании из восьми секций, проверка экспертами IMBC, каталог с фильтрами, выгрузки и подписки, статус актуальности, уведомления, аудит.

Каркас репозитория собран по документу **«Архитектура платформы IMBC — v0.4»** (04.11.2026) и технической спецификации v1.2. С 11.11.2026 источник требований — спецификация v1.3 (`docs/analyst/2026-11-11/specification-v1.3.md`): контракты (`packages/contracts` — роли, перечисления, матрица прав, тир) приведены к ней, предметные модули приводятся к ней по [плану разработки](docs/development-roadmap.md) на своих этапах. Номера требований (`AUTH-03`, `OPR-05`, `UPD-04`…) сверяет со спецификацией v1.3 `pnpm check:requirements`; ссылки нумерации v1.2, которые остались в ещё не переписанных частях (например, в столбце «Требования» таблицы §4), перечислены в `scripts/requirements-baseline.json`. Номера решений (`D-40`, `ADR-06`…) — из архитектуры v0.4.

> Состояние на 13.11.2026: **этапы 0–2 плана разработки и четыре демо-экрана только для чтения**. Развёрнута Azure VM с HTTPS и реальной почтой. Все пользовательские экраны авторизации используют собственную тему IMBC на shadcn/ui; Keycloak обслуживает идентификацию внутри системы. Реализованы вход, email-код, ответственность, регистрация и восстановление пароля; роли и статусы по спецификации v1.3 (`observer`, `unresponsive`), тир 1 и 2 в каталоге и на дашборде, стартовая страница по роли. Только для чтения работают каталог и дашборд, страница компании, собственный профиль производителя и очередь SME. Этап 1 выкачен на стенд 13.11.2026 (`306b58e`): регистрация по v1.3, кабинет администратора с приглашениями, блокировкой, сменой роли и почты-логина и неактивность через три месяца (AUTH-07). Этап 2 («Справочники, файлы, основа уведомлений») сделан в ветке `feat/stage-2-foundation` и на стенд не выкачен: двенадцать справочников администратора и экран `/references`, файлы с проверкой ClamAV и скачиванием только через API, образец оргструктуры, журнал писем `notification` и тема писем Keycloak на трёх языках. Загрузка файлов производителем, действия с профилем, проверка, выгрузки и pull API ещё не реализованы; последовательность — в [плане разработки](docs/development-roadmap.md).

## Быстрый доступ к dev-стенду

Состояние на **13 ноября 2026 года**: на стенде коммит `306b58e` ветки стенда `demo/prototype-cabinets` (выкат этапа 1, `deploy.sh redeploy`; [проверка выката](docs/deployment/verification-2026-11-13.md), переход на v1.3 — [runbook](docs/deployment/azure-dev.md#переход-на-спецификацию-v13)). Сайт доступен по HTTPS из любой сети — ссылкой можно делиться с участниками тестирования. Вход под каждой ролью на самом стенде после выкатов не проверялся (кабинеты проверены на локальном стенде того же коммита); проверка от 10.11 описывает предыдущую версию.

| Действие | Ссылка |
|---|---|
| Войти в платформу | [Вход IMBC](https://imbc-dev-e1cde8dd.polandcentral.cloudapp.azure.com/login) |
| Зарегистрировать производителя | [Регистрация](https://imbc-dev-e1cde8dd.polandcentral.cloudapp.azure.com/register) |
| Развернуть или обслуживать стенд | [Инструкция Azure dev](docs/deployment/azure-dev.md) · [конвейер развёртывания](docs/deployment/azure-dev.md#конвейер-развёртывания) |
| Посмотреть результаты проверок | [Проверка стенда от 10.11.2026](docs/deployment/verification-2026-11-10.md) |

**Новые пользователи:** производитель регистрируется самостоятельно: компания, БИН и email → письмо → подтверждение email, имя/фамилия и установка пароля → вход и почтовый код → принятие ответственности. Выбрать административную или другую служебную роль при регистрации нельзя. Остальных пользователей приглашает администратор на `/admin/accounts` (с выката этапа 1).

**Демо-вход:** все шесть seed-аккаунтов по ролям и отдельный `test-admin@imbc.local` используют OTP **`000000`** на текущем dev-стенде; [полный список](#демо-учётные-записи) приведён ниже. Пароли остаются прежними и обязательными, письмо с фиксированным кодом не отправляется. Исключение задаётся точными парами UUID и ожидаемой роли; совпадение email или домена `.local` его не включает. Пользователи вне списка, в том числе новые производители, получают случайные коды по почте. [Настройка и отключение тестового кода](docs/deployment/azure-dev.md#демо-аккаунты-с-фиксированным-кодом).

Временный отправитель Azure ограничен **5 письмами в минуту и 10 в час на подписку**; это общая квота регистрации, восстановления и кодов входа. Mailpit и консоль Keycloak доступны только с разрешённых IP. Для Chrome на iPhone зафиксировано предупреждение Google Safe Browsing: обращение отправлено, снятие предупреждения пока не подтверждено; подробности — в отчёте проверки выше.

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
  N -->|/| W[Web UI<br/>React + Vite SPA]
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
| Поиск каталога, страница компании и все показатели дашборда читают только проекцию видимых профилей `catalog_visible`, отдельного счётчика нет: unresponsive входит в выдачу и в счётчики (UPD-04, OPR-33). Собственный профиль производителя берёт из неё только тир своей строки. Выгрузки и pull API ещё не реализованы (§10) | `catalog.service.ts`, `profiles.service.ts`, `schema/platform.ts` |
| Файл недоступен, пока ClamAV не признал его чистым (DATA-07); байты отдаёт только API после проверки прав записи-владельца (GEN-09, NFR-09) | `worker/file-scan.job.ts`, `modules/files/*` (`FilesService.open`, `FILE_READ_RULES`) |
| Журнал аудита и принятия NDA только дополняются: у роли приложения нет UPDATE/DELETE (AUD-02, FC-02) | `database/app-role.ts` (вызывает `migrate.ts`), `infrastructure/postgres/init.sql` |
| Одно письмо на событие и адрес без учёта регистра: запись в журнал `notification` и отправка — одна транзакция; получатели — данные `notification_rule`; наблюдатель получает только письма аккаунта NOT-01–NOT-03 (NOT-18, NOT-21, ADR-22) | `notifications/*`, `mail/mail.service.ts`, `worker/handlers.service.ts` |
| Все расписания — по Asia/Almaty, независимо от часового пояса сервера | `jobs/queues.ts` |

## 2. Отличия от документа архитектуры

Отличия согласованы при старте сборки; в следующей редакции архитектуры их нужно отразить.

| Тема | Архитектура v0.4 | В репозитории | Почему |
|---|---|---|---|
| Библиотека компонентов | «по NFR-43» | **shadcn/ui на Base UI, пресет `base-nova`**, MCP-сервер shadcn в репозитории | Решение владельца 11.11.2026, как в прототипе аналитика |
| Очередь | pg-boss 10.x | pg-boss **12** | Актуальная мажорная версия на момент сборки |
| Авторизация | CASL в процессе API | Функция `can(role, action)` над `POLICY_MATRIX` | Пока правила не зависят от полей объекта, матрицы достаточно. Переход на CASL — когда появятся условия вида «своя организация» на уровне записей; матрица останется источником правил |
| Worker | «один код, два процесса» | Тот же пакет `apps/api`, точка входа `src/worker.ts`, один образ | Ровно то, что сказано в §5; отдельного пакета нет |
| S3 | Продукт выбирается с ИТ IMBC (ADR-13) | **RustFS** на dev-стенде | Лицензия Apache-2.0, совместимость с S3 API. Выбор для production по-прежнему за ИТ IMBC; код использует только S3 API |
| Платформа | Kubernetes, Argo CD | **Docker Compose** | Среда «разработка» в §15 — Docker Compose. Манифесты Kubernetes — этап 1 |

С 11.11.2026 Web UI — одностраничное приложение React + Vite, как в архитектуре (§5, §14) и спецификации (11.1); сеансы, OIDC и права по-прежнему в NestJS BFF.

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
│  │  ├─ src/common/           RFC 9457 (problem+json), аудит, no-store, проверка ответа по схеме, транзакция действия исполнителя
│  │  ├─ src/notifications/    правила получателей, диспетчер письма, постановка задания, ссылки; тексты писем — src/mail/messages/*.json
│  │  ├─ src/jobs/             имена очередей и расписания
│  │  ├─ src/worker/           обработчики заданий, проверка файла (file-scan.job.ts), клиент clamd
│  │  ├─ src/modules/          auth, registration, profiles, catalog, reviews, admin, adata, dictionaries, files, health
│  │  ├─ drizzle/              SQL-миграции (генерирует drizzle-kit)
│  │  ├─ reference-data/       значения справочников JSON: release (списки спецификации и перечни IMBC), provisional (временные, только seed)
│  │  └─ test/                 Vitest
│  └─ web/                     React 19 + Vite SPA, React Router, shadcn/ui (Base UI), TanStack Query, nuqs, use-intl
│     ├─ messages/             kk.json (по умолчанию), ru.json, en.json (исходный)
│     ├─ src/
│     │  ├─ main.tsx, app.tsx  старт: язык из cookie, переводы, провайдеры, роутер
│     │  ├─ router.tsx         все маршруты приложения
│     │  ├─ routes/            корень, «/», «не найдено», экран ошибки маршрута
│     │  ├─ routes/auth/       вход, регистрация, email-код, диалог ответственности
│     │  ├─ routes/app/        каталог, страница компании, дашборд, профиль, очередь SME, аккаунты, справочники, мой аккаунт — за AppShell
│     │  ├─ components/ui/     компоненты shadcn/ui (правятся в проекте, это не зависимость)
│     │  ├─ components/app/    оболочка, переключатель языка, логотип, заголовок вкладки, провайдеры
│     │  ├─ components/auth/   проверка сеанса, выход со страниц кода и ответственности
│     │  ├─ hooks/             use-mobile (shadcn)
│     │  ├─ i18n/              язык из cookie, загрузка переводов, IntlProvider, форматы дат и чисел
│     │  ├─ assets/            логотип IMBC
│     │  └─ lib/               клиент BFF, сеанс, параметры каталога, переходы в BFF, перезагрузка при сбое
│     └─ test/                 Vitest + Testing Library
├─ packages/
│  └─ contracts/               общее для API и UI: перечисления, фильтры каталога (zod),
│                              проверка БИН, нормализация названий, PolicyMatrix, стартовая страница роли,
│                              схемы ответов (страница компании, профиль, очередь, аккаунты, справочники, файлы)
├─ infrastructure/
│  ├─ docker/                  api.Dockerfile (Node 26, multi-stage), web.Dockerfile (сборка на Node 26 → nginx без root)
│  ├─ azure/                   deploy.sh, vm-deploy.sh (шаги на VM), setup-github-deploy.sh, Caddyfile, cloud-init, синхронизация realm
│  ├─ keycloak/imbc-realm.json realm: клиенты, политика паролей, блокировка, сеансы, языки, демо-пользователи
│  ├─ keycloak/identity/       React + Keycloakify + shadcn/ui: собственные экраны IMBC и тема писем `imbc` (src/email)
│  ├─ clamav/clamd.conf        настройки clamd: пределы проверки файла (монтируется в контейнер clamav только для чтения)
│  ├─ mailpit/                 шаблон SMTP relay; секретный файл существует только на VM
│  ├─ nginx/nginx.conf         единая точка входа локального стенда
│  ├─ nginx/web.conf           раздача web: SPA-fallback, CSP, кеширование
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

Модули и их таблицы — по §6 архитектуры. Граница модуля: публичный вход `index.ts`, запись в чужие таблицы только через метод владельца. Каталог, страница компании, выгрузки, pull API и дашборд читают только проекцию видимых профилей `catalog_visible`. Экраны только для чтения производителя, SME и администратора читают рабочие таблицы в пределах своих прав: `ProfilesService.own` — `manufacturer_profiles` и `organizations` своей организации (плюс тир из её строки проекции), `ProfilesService.ownAdata` — `external_check`, `external_check_attempt` и `prefilled_value` своей организации, `ReviewsService` — `manufacturer_profiles`, `organizations` и `user_accounts`, сервисы администратора (аккаунты, организации, приглашения) — `organizations` и `user_accounts`.

| Модуль | Отвечает за | Таблицы | Требования | В каркасе |
|---|---|---|---|---|
| Organizations | Типы организаций, БИН с контрольным разрядом, ящик IMBC | `organizations` | GEN-01–06, ADM-03 | схема, проверка БИН; администратор создаёт организации операторов и наблюдателей и ставит отметку major operator, задаёт ящик IMBC (маршруты — ниже) |
| Identity and Access | Вход, сеансы BFF, email-код, доверенные устройства, ответственность, PolicyMatrix | `user_accounts`, `sessions`, `otp_codes`, `trusted_devices`, `responsibility_acceptances`, `auth_rate_limits`, `auth_security_events`, `auth_sync_state`, `revoked_idp_sessions`, `api_access` | AUTH-01–10, GEN-10–15 | общий auth-срез реализован; список организаций и аккаунтов для администратора (`GET /api/v1/admin/accounts`, с ящиком IMBC `imbcMailbox`; ADM-06), приглашение и его повтор (ADM-01, NOT-24); блокировка, смена роли и почты-логина с завершением сеансов (ADM-02, ADM-05, AUTH-06); неактивность через три месяца (AUTH-07, `account-inactivity`); кабинет администратора `/admin/accounts` |
| Profiles | Профиль из восьми секций, редакции, полнота | `manufacturer_profiles`, `profile_sections`, `section_revisions`, `contacts`, `shareholders`, `product_lines`, `equipment_*` | MAN-01–96 | черновик при регистрации; свой профиль только для чтения (`GET /api/v1/profiles/own`, GEN-11); данные Adata своего профиля только для чтения (`GET /api/v1/profiles/own/adata`) |
| Review | Назначение, решения по секциям и документам | `review_assignments`, `review_decisions` | REV-01–20 | схема; очередь SME только для чтения (`GET /api/v1/reviews/queue`, REV-04) |
| Documents | Карантин, скан, версии файла, образец оргструктуры; сертификаты и документы профиля — этап 3 | `file_object`, `file_version`, `org_chart_sample` (по DBML); `certificates`, `documents` — скелет (скелетные `file_objects` и `file_versions` живут до contract) | GEN-09, DATA-05–07, ADM-11, NFR-09; MAN-34, MAN-37–39 — этап 3 | Файл: загрузка (тип по содержимому, 25 МБ, структура DOCX и XLSX), карантин → ClamAV → рабочий бакет, `GET /api/v1/files/:id/content`; образец: `GET`/`POST /api/v1/org-chart-sample`, `GET /api/v1/org-chart-sample/current` и `/current/content` (раздел 7, «Файл»); истечение сертификатов |
| IMBC Records | Обследования, due diligence, заметки IMBC | `site_survey_records`, `due_diligence_records`, `imbc_notes`, `external_check`, `external_check_attempt`, `prefilled_value`, `adata_allowance` | IMBC-01–32 | схема |
| Operator Records | Works with, визиты, заметки оператора | `works_with_marks`, `operator_visit_marks`, `operator_notes` | OPR-30–52 | схема |
| Requests | Запросы к IMBC и к производителю | `imbc_requests`, `operator_requests` | OPR-60–65 | схема |
| Update Status | Квартальный цикл active → outdated → unresponsive; профиль в любом статусе остаётся видимым, unresponsive сортируется ниже (UPD-04) | поля профиля, `update_confirmations` | UPD-01–06 | статусы v1.3 в БД, API и UI; расписание 09:00, обработчик — заглушка |
| Catalog and Dashboard | Поиск, фильтры, страница компании, дашборд | `catalog_visible` | OPR-01–13, OPR-31–35 | **поиск, тир, страница компании (только чтение) и дашборд работают** на данных seed |
| Exchange | Выгрузки XLSX/CSV, подписки, pull API | `export_files`, `export_subscriptions`, `api_access` | OPR-20–24, OPR-80–82 | очистка файлов старше 90 дней |
| Demand and NDA | NDA, версии прогноза (R2) | `nda_version`, `nda_acceptance`, `forecast_*`, `tech_spec_files` | FC-01–10 | схема |
| Notifications | Правила писем данными, журнал отправленных, получатели, язык, ссылки | `notification_rule`, `notification` (по DBML); `notifications_sent` — прежний журнал, живёт до contract | NOT-18–21; NOT-01–03; NOT-04–17 — по этапам 5–9 | Диспетчер `notify`; NOT-02 и NOT-03 на журнале, NOT-01 — тема писем Keycloak (раздел 7, «Уведомления»; раздел 8, «Почта») |
| Audit and Snapshots | Журнал, снимки активности | `audit_entries`, `activity_snapshots` | AUD-01–04 | запись событий входа и отказов |
| Reference Data | Двенадцать справочников и переводы значений | `dictionary`, `dictionary_entry`, `dictionary_entry_translation` (по DBML); `dictionaries`, `dictionary_entries` — скелет, живёт до contract | ADM-08, ADM-09, DATA-02–04 | `GET /api/v1/dictionaries`, `…/:code/entries`, `…/:code/choices`; изменения значений — `POST`, `PUT`, `DELETE` (раздел 7, «Справочники»); экран `/references` |
| Import and Migration | Staging, mapping, приглашение мигрированных | — | MIG-01–15 | этап миграции |

## 5. Контейнеры стенда

Базовый локальный `docker compose up -d --build` поднимает следующие сервисы. Для Azure обязательно добавляется `compose.azure.yaml`: снаружи работают Caddy/80 и 443, диагностические порты привязаны к localhost VM, Keycloak собирается с темой IMBC, Mailpit подключается к SMTP relay.

| Сервис | Образ | Назначение | Порт наружу |
|---|---|---|---|
| `nginx` | nginx 1.29 | Единый origin: `/` → web, `/api` → api, `/kc` → keycloak | `8080` |
| `web` | `imbc/web` (nginx, статика Vite, CSP) | Интерфейс; внутри сети — `web:3000` | — |
| `api` | `imbc/api` | REST `/api/v1`, BFF `/api/auth`, OpenAPI `/api/docs` | — |
| `worker` | `imbc/api` (`node dist/worker.js`) | Очереди и расписания pg-boss | — |
| `migrate` | `imbc/api` (одноразовый) | Миграции Drizzle, права роли приложения, демо-данные | — |
| `postgres` | postgres 18 | Данные, сеансы, очередь; база `keycloak` для IdP | — |
| `valkey` | valkey 8 | Кеш дашборда и справочников; без снапшотов и AOF | — |
| `rustfs` | rustfs | S3: `imbc-quarantine`, `imbc-files`, `imbc-exports` | `9001` (консоль) |
| `buckets` | aws-cli (одноразовый) | Создаёт бакеты | — |
| `keycloak` | Keycloak 26 | OIDC, пароли, блокировка, письма установки пароля | — |
| `clamav` | clamav 1.4 | Антивирус (clamd :3310); настройки — `infrastructure/clamav/clamd.conf`, проверку вызывает только worker (`file-scan`). У образа нет сборки под arm64: на Mac с Apple Silicon контейнер идёт только под эмуляцией `platform: linux/amd64` (локальная настройка, в репозитории её нет) | — |
| `mailpit` | mailpit | Сохраняет письма; базовый локальный Compose не отправляет их наружу | `8025` |

Порядок старта задают `depends_on` и healthcheck: postgres → migrate → api/worker; keycloak healthy → api → nginx. ClamAV при первом запуске несколько минут скачивает сигнатуры — задания `file-scan` в это время повторяются (до 5 раз с нарастающей паузой), версии, оставшиеся `pending`, подбирает зачистка `file-scan-sweep` раз в 15 минут. Файл `clamd.conf` примонтирован как файл: после его правки контейнер `clamav` нужно пересоздать (`docker compose up -d --force-recreate clamav`).

## 6. Данные

- **PostgreSQL 18**, идентификаторы — `uuidv7()` на стороне БД (упорядочены по времени, без отдельной последовательности).
- **Схема** — `apps/api/src/database/schema/*.ts` (Drizzle), разбита по модулям: `access`, `profiles`, `records`, `exchange`, `platform`. Перечисления генерируются из `@imbc/contracts`, поэтому значения в БД, API и UI совпадают.
- **Миграции** — `pnpm --filter @imbc/api db:generate` создаёт SQL в `apps/api/drizzle/`; применяет их сервис `migrate` (`src/database/migrate.ts`), затем при `SEED_DEMO=true` — `seed.ts`. Правило — expand → перенос данных → contract (NFR-06): каждая миграция совместима с предыдущей версией приложения, значения перечислений удаляются только релизом после переноса данных.
- **Переход на v1.3 завершён релизом contract `0006`.** Миграция `0003_spec_v13_expand` добавила в типы PostgreSQL значения `observer` (`role`, `organization_type`) и `unresponsive` (`update_status`), перенос данных предыдущих релизов заменил прежние значения, `0004_catalog_tier` добавила вычисляемую колонку `catalog_visible.tier`. Рукописная миграция `0006_spec_v13_contract` сначала проверяет, что строк со `spectator` и `inactive` и строк в пустых таблицах каркаса нет, затем пересоздаёт три типа без прежних значений и удаляет `external_checks`, `nda_versions`, `nda_acceptances` и тип `check_status`; переходный код (перенос данных, псевдоним роли, переименование демо-наблюдателя) удалён. Проверка до выката, резервная копия и откат — в [runbook](docs/deployment/azure-dev.md#переход-на-спецификацию-v13).
- `0005_adata_prefill` — таблицы чтения Adata (expand).
- `0007_accounts_registration` — expand этапа 1: таблицы `nda_version` и `nda_acceptance` по DBML; у организации — ящик IMBC `notification_mailbox` (только у организации IMBC); у аккаунта — согласия регистрации (`platform_terms_accepted_at`, `personal_data_accepted_at`), ожидающее принятие NDA до появления профиля (`registration_nda_*`, `registration_ip` — все или ни одной), ответ «Как вы узнали о нас» и `inactive_since` (AUTH-07). Уникальные индексы: одна организация IMBC, один аккаунт роли manufacturer на организацию (GEN-01), имя оператора или наблюдателя без учёта регистра.
- `0008_reference_organizations` — только данные: организация IMBC и major operators NCOC, TCO, KPO (GEN-05), если их нет; существующему оператору с таким именем ставится отметка. Повторное выполнение ничего не меняет. Версию 1 NDA — трёхъязычную заглушку — кладёт только seed (`SEED_DEMO=true`): настоящий текст IMBC придёт миграцией следующей версией.
- `0009_stage2_foundation` — expand этапа 2 (только `CREATE TYPE`, `CREATE TABLE`, индексы и внешние ключи): типы `file_purpose`, `data_class`, `file_scan_state`; таблицы по DBML `dictionary`, `dictionary_entry`, `dictionary_entry_translation`, `file_object`, `file_version`, `org_chart_sample`, `notification_rule`, `notification`. Отступления от DBML описаны комментариями в схеме (`schema/reference.ts`, `files.ts`, `notifications.ts`): тип состояния проверки файла — `file_scan_state` (имя `scan_state` занято скелетным перечислением), язык — существующий тип `locale`, уникальность кода значения без учёта регистра, проверки номера версии и размера файла (1 байт — 25 МБ), внешний ключ журнала писем на правило. Скелетные `dictionaries`, `dictionary_entries`, `file_objects`, `file_versions`, `notifications_sent` и тип `scan_state` остаются до релиза contract: их читает или пишет предыдущая версия приложения (NFR-06).
- `0010_stage2_reference_data` — только данные (`INSERT … ON CONFLICT DO NOTHING`, повторное выполнение ничего не меняет): двенадцать строк `dictionary` (коды `DICTIONARY_CODES` в порядке ADM-08), семнадцать правил `notification_rule` (NOT-01…NOT-17: событие и части получателей через `+`; правила меняются только релизом), перенос строк `notifications_sent` в `notification` (`dedup_key = <код>\n<ключ события>\n<адрес в нижнем регистре>`; язык вне kk, ru, en — kk; коды вне правил не переносятся). Релиз contract этапа 2 — следующий (`0011`, [runbook](docs/deployment/azure-dev.md#справочники-файлы-и-уведомления-этап-2), «Contract»).
- **Значения справочников — файлы `apps/api/reference-data/<release|provisional>/<код справочника>.json`** (в образе — `/app/reference-data`, пакет API включает каталог в `files`). Формат — `referenceFileSchema` (`@imbc/contracts`): `{ dictionary, status, source, entries: [{ code, parent?, names: { kk?, ru?, en? }, mandatory?, customNameAllowed?, sortOrder? }] }`. `dictionary` — один из двенадцати кодов; `status` — `specification` (список, который фиксирует спецификация), `imbc` (перечень, присланный IMBC) или `provisional` (временные значения прототипа и демо, только для стенда); `source` — откуда значения; `code` — всегда строка JSON, ведущие нули не теряются (DATA-03), вид кода — по справочнику (`DICTIONARY_CODE_PATTERNS`: ТН ВЭД — десять цифр, ОКЭД — пять, КПВЭД — две цифры и группы через точку, товарная группа — `A`–`E`, остальные — латиница, цифры, пробел и `._-/`, до 64 символов), без повторов без учёта регистра; хотя бы одно название (классификаторы приходят без части языков, переводы не выдумываются); `mandatory` — только у типов сертификатов и документов; `parent` — код товарной группы у типа товара; `sortOrder` — по порядку записи. Сейчас: `release` — `legal_form` (3 значения), `commodity_group` (5), `contact_role` (3), `certificate_type` (10), `document_type` (4); `provisional` — `region` (9), `oked` (4), `tn_ved` (4), `kpved` (2), `commodity_type` (5), `process` (3), `equipment_type` (2).
- **Порядок загрузки значений.** `migrate` после миграций и выдачи прав загружает `release` (в журнале — строки «Справочники: <код> +N (+M переводов)»); `seed` при `SEED_DEMO=true` — `provisional` (строки «Справочники (временные): …»); `provisional` в продакшене не грузится, поэтому регионы, ОКЭД, ТН ВЭД, КПВЭД, типы товаров, процессы и типы оборудования там пусты, пока IMBC не пришлёт перечни. Загрузка идемпотентна и только добавляет: значение, которого нет (код без учёта регистра), вставляется; у существующего добавляются недостающие переводы; названия, обязательность, порядок и вывод из оборота, заданные администратором, не затираются; ничего не удаляется. Все файлы каталога разбираются и проверяются до первой вставки: нарушение схемы или вида кода останавливает `migrate` (новые `api` и `worker` не стартуют), в тексте ошибки — файл и правило, без значений. Первая вставка пишет в аудит `reference.loaded`.
- **Как добавить перечень IMBC.** Положить файл `apps/api/reference-data/release/<код справочника>.json` со `status: "imbc"` и выкатить релизом (`release` грузится при каждом выкате). Правила репозитория, которые держит тест `reference-data.integration.test.ts` («файлы репозитория…»): имя файла — код справочника; справочник лежит ровно в одном файле на оба каталога, поэтому временный `provisional/<код>.json` этого справочника удаляется (в тесте при этом правится ожидаемый состав файлов, а в `seed.integration.test.ts` — число временных значений). Для справочника, у которого уже есть список спецификации (например, `legal_form`), дополняется существующий файл `release`, его `status` и `source` приводятся к происхождению списка. Временные значения, уже загруженные `seed` на стенде, остаются в базе — загрузка ничего не удаляет: администратор выводит их из оборота или удаляет на `/references`, если они нигде не использованы.
- **Редакции секций.** У каждой секции профиля три указателя: верифицированная, ожидающая проверки и рабочая редакция. Операторы видят только верифицированную — так «изменения на проверке» (pending changes) не попадают в каталог.
- **Проекция `catalog_visible`** — одна строка на видимый профиль: Verified и due diligence green/amber при любом статусе актуальности (раздел 4 спецификации, IMBC-11); unresponsive остаётся в выдаче и сортируется ниже active и outdated (UPD-04). Собирается только из верифицированных редакций; `tier` вычисляется из `site_surveyed` (`tier_1` или `tier_2`, IMBC-19, IMBC-20) и не записывается. Пока проекцию заполняет только seed: пересборки по событиям и результата due diligence в схеме ещё нет (этап 5). Контакты страницы компании — в jsonb `card`. GIN-индексы: триграммы по нормализованному названию, массивы групп, типов, сертификатов, ОКЭД.
- **Нормализация названий** (`normalizeCompanyName`): казахские буквы сводятся к базовым (ә→а, қ→к, ң→н, ө→о, ұ/ү→у, і→и…), кавычки и одна организационно-правовая форма по краям убираются. «ТОО «Қазақ Металл»» и «казак металл» находят одну компанию.
- **Роли БД.** `imbc` — владелец схемы, от него идут миграции. `imbc_app` — роль приложения: SELECT/INSERT/UPDATE/DELETE, кроме UPDATE/DELETE/TRUNCATE на `audit_entries`, `nda_acceptance` и `notification` (только добавление: журнал писем пишется вместе с отправкой, NOT-18) и INSERT/UPDATE/DELETE/TRUNCATE на `notification_rule` и `dictionary` (только чтение: правила писем и справочники — данные релиза, миграция `0010`). Значения справочников (`dictionary_entry`, переводы) ведёт администратор через API — на них права обычные. Права выдаёт `applyAppRoleGrants` (`database/app-role.ts`) после каждого прогона миграций.
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

Сеанс BFF: простой 30 минут, абсолютный срок 12 часов от аутентификации в IdP. Подписанный backchannel logout отзывает связанные сеансы по `sid` и предотвращает их повторное создание запоздавшим callback. События смены пароля обрабатываются worker раз в минуту: старые сеансы и доверие к устройствам отзываются до постановки заданий уведомлений. Выход выполняется между BFF и IdP; браузер получает только локальный адрес страницы подтверждения выхода. Проверки состояния аккаунта и `auth_version` действуют на каждом запросе; блокировка и смена роли администратором завершают сеансы сразу (AUTH-06, ниже).

Маршруты администратора — все `@Can('accounts.manage')` (в матрице — только `administrator`; отказ — `403` и запись аудита `outcome: 'denied'`, GEN-08), ответы сверяются со строгими схемами `@imbc/contracts` и не содержат БИН, полей профиля и регистрации (ADM-06):

| Маршрут | Тело | Успех | Ошибки |
|---|---|---|---|
| `POST /api/v1/admin/organizations` | `{ name, type: operator \| observer, isMajorOperator? }` (major — только оператор) | `201 { organization }` | `400 validation`; `409 organization_exists` (тот же тип и имя без учёта регистра) |
| `PUT /api/v1/admin/organizations/:id/major-operator` | `{ isMajorOperator }` | `200 { organization }` | `404 not_found`; `409 not_operator` |
| `PUT /api/v1/admin/imbc-mailbox` | `{ email \| null }` (null снимает) | `200 { imbcMailbox }` | `400 validation` |
| `POST /api/v1/admin/accounts` | `{ email, fullName, organizationId, role }` | `201 { account }` (`invited`) | `404 not_found`; `409 organization_not_invitable` (производитель); `400 role_not_allowed`; `409 email_exists`; `503 identity_unavailable` |
| `POST /api/v1/admin/accounts/:id/invitation` | — | `202 { status: 'password_email_queued' }` | `404`; `409 not_invited`, `identity_not_bound` |
| `POST /api/v1/admin/accounts/:id/block` | — | `200 { account }` | `404`; `409 self_action` |
| `POST /api/v1/admin/accounts/:id/unblock` | — | `200 { account }` | `404` |
| `PUT /api/v1/admin/accounts/:id/role` | `{ role }` | `200 { account }` | `404`; `409 self_action`, `role_fixed` (организация не IMBC); `400 role_not_allowed` |
| `PUT /api/v1/admin/accounts/:id/email` | `{ email }` | `200 { account }` | `404`; `409 not_manufacturer_account`, `identity_not_bound`, `email_exists`; `503 identity_unavailable` |

Каждое изменение пишет запись аудита с `isAccountEvent: true` в своей транзакции (`organization.created`, `organization.major_operator_changed` и `organization.mailbox_changed` с `{ from, to }`, `account.invited` с `{ email, role, organizationId }`, `account.invitation_resent` с `{ queued }` — `false`, если pg-boss в этом минутном окне уже держал задание); `objectType` — `organization` и `account`, как у прежних записей; IP запроса — только колонка `audit_entries.ip`. Повтор отметки или ящика без изменения — `200` без записи. Транзакция блокирует строки исполнителя и цели в порядке id (`lockActor`, `for no key update`: взаимные действия двух администраторов идут по очереди, без 40P01) и проверяет, что исполнитель всё ещё `active` `administrator`; иначе `403` и после отката — запись `accounts.manage` с `outcome: 'denied'` и путём маршрута, как у `SessionGuard`. Строка организации для отметки и ящика — тоже `for no key update`. Ожидание блокировок ограничено `boundLockWaits` (`apps/api/src/database/lock-waits.ts`), превышение — `503 busy`. Коды ошибок этих маршрутов — `ADMIN_PROBLEM_CODES` в `@imbc/contracts`.

### Неактивность (AUTH-07, NOT-26, DATA-08)

`account-inactivity` (worker, 02:00 по Алматы) переводит в `inactive` аккаунт `active`, у которого прошло три календарных месяца по Asia/Almaty с более поздней даты из последнего входа (у ни разу не входившего — создания) и последней смены пароля — возврат новым паролем без входа не отменяется следующей ночью: тот же день месяца или последний день месяца, если такого дня нет (правило NOT-31; `(timezone('Asia/Almaty', greatest(coalesce(last_sign_in_at, created_at), credentials_changed_at))::date + interval '3 months')::date <= timezone('Asia/Almaty', $now)::date` считает PostgreSQL). `invited` и `blocked` не меняются. «Сейчас» — параметр `AccountInactivityJob.run(now)`: worker вызывает без аргумента, тесты — с фиксированными датами. Каждый аккаунт — своя транзакция: условие проверяется снова под блокировкой строки (вход в последний момент выигрывает), `inactive_since = now`, `auth_version + 1`, сеансы удалены, аудит `account.became_inactive { from: 'active' }`, задание `inactivity-reset`. Сбой одного аккаунта не останавливает прогон (задание завершается ошибкой, повтор pg-boss доделывает остальных); повтор в тот же день и после пропущенного дня ничего не удваивает. Статус актуальности и дата квартала профиля не меняются (NOT-26, NOT-31).

`inactivity-reset` завершает сеансы IdP и шлёт NOT-01 ссылкой сброса (`execute-actions-email` только с `UPDATE_PASSWORD`, 72 часа, язык — атрибут `locale` пользователя Keycloak). Обязательное действие пользователю Keycloak не ставится — оно только в токене ссылки: иначе вход со старым паролем сразу попросил бы новый и вернул аккаунт мимо ящика. Пользователь Keycloak остаётся включённым (`identity-sync` выключает только `blocked`), вход отклоняет BFF. Аккаунт seed до первого входа — `invited` и неактивным не становится; `active` без субъекта IdP на практике не бывает (`markSignedIn` привязывает субъект при входе), а если встретится — письма ему нет, задание просто завершается. Повторно отправить ссылку сброса неактивному аккаунту администратор не может (повтор приглашения отвечает `409 not_invited`); через 72 часа ссылки человек пользуется «Забыли пароль» на странице входа.

Возврат — новый пароль, заданный не раньше `inactive_since` (допуск — минута на расхождение часов Keycloak и платформы, `REACTIVATION_CLOCK_SKEW_MS`), по одному правилу `SessionService.reactivateAfterReset` с двух сторон: событие пароля из `keycloak-events` и вход. Callback неактивного аккаунта спрашивает у Keycloak время текущего пароля (`GET /users/{id}/credentials`); пароль новее — аккаунт снова `active` и вход продолжается обычным путём, иначе или при сбое Keycloak — `/login?error=account_inactive`, и сеанс IdP отклонённого входа завершается без ожидания ответа Keycloak (отказ приходит сразу; сбой выхода ответа не меняет и попадает только в журнал, без адреса Keycloak и данных пользователя). Вход со старым паролем аккаунт не возвращает: путь назад — ссылка сброса или «Забыли пароль». Кто первый, пишет аудит `account.reactivated { via: 'sign_in' | 'password_event' }`, второй ничего не пишет. Предупреждение NOT-17 за 14 дней и пауза подписок (OPR-18) — вместе с подписками.

### Блокировка, роль и почта-логин (ADM-02, ADM-05, AUTH-06, MAN-05)

`AccountLifecycleService`: каждое действие — одна транзакция под `lockActor` (исполнитель — всё ещё `active` `administrator`, иначе `403` и запись `denied`). «Завершить сеансы» — `auth_version + 1` и удаление строк `sessions` аккаунта в той же транзакции: следующий запрос открытой вкладки получает `401`, а вход «в полёте» не завершается — `SessionService` проверяет `state` и `auth_version` под блокировкой строки аккаунта в `verifyOtp`, `trustDevice`, `issueOtp` и `create`, callback отказывает заблокированному (`/login?error=no_account`). Роль сеанс не хранит: `resolve` читает её из `user_accounts` на каждом запросе. Повтор без изменения — `200` без записи и задания. Себя заблокировать и сменить себе роль нельзя (`409 self_action`).

- **Блокировка** — `blocked`, сеансы завершены, доверенные устройства удалены (после разблокировки первый вход снова подтверждается кодом NOT-02), аудит `account.blocked { from }`, задание `identity-sync { logout: true }`. **Разблокировка** — `invited`, если аккаунт не входил, иначе `active`; аккаунт, ставший `inactive` до блокировки (задан `inactive_since`), возвращается в `inactive` с той же отметкой — вернёт его только новый пароль (AUTH-07); аудит `account.unblocked { to }`, `identity-sync { logout: false }`. Прежние сеансы не возвращаются.
- **Роль** меняется только у аккаунта организации IMBC и только на `expert`, `administrator`, `director` (`INVITABLE_ROLES.imbc`); у оператора, наблюдателя и производителя роль задана типом организации (`409 role_fixed`). Сеансы завершены, аудит `account.role_changed { from, to }`; Keycloak не меняется.
- **Почта-логин** — только у производителя (MAN-05: сам он её не меняет; это единственный маршрут, меняющий почту) и только у аккаунта, связанного с пользователем Keycloak. Адрес, занятый в БД, — `409` без Keycloak. Затем сначала Keycloak (`updateUser` с `emailVerified: true`; `409` → `email_exists`, иной сбой → `503 identity_unavailable` и `identity-sync`, который вернёт Keycloak к адресу БД), потом транзакция: почта, сеансы и доверенные устройства (следующий вход пришлёт код NOT-02 на новый адрес), аудит `account.email_changed { from, to }`, `identity-sync { logout: true }`, у `invited` — `send-password-email` (NOT-01 на новый адрес). Сбой транзакции сразу возвращает в Keycloak прежний адрес и всегда ставит `identity-sync { logout: false }` вне транзакции — неудачная попытка не завершает сеансы производителя: прежний адрес прочитан без блокировки, а исход `COMMIT` при обрыве неизвестен — задание приводит Keycloak к тому, что в строке БД на самом деле. Адрес — только в `diff` аудита: в журнал и тексты ошибок не попадает. Приглашённому, но заблокированному аккаунту письмо установки пароля при смене почты не уходит (его ставят только аккаунту в состоянии `invited`), и разблокировка его не шлёт: после разблокировки такого аккаунта администратор повторяет приглашение.
- **`identity-sync`** (worker) всегда приводит Keycloak к текущей строке БД — `enabled = state ≠ blocked`, почта из БД, `logout` по флагу задания (`POST /users/{id}/logout`, 404 — не ошибка). Задание несёт только `accountId`; без субъекта IdP — ничего не делает. Сбой Keycloak не отменяет решение администратора: задание повторяется до 5 раз, а вход и так проверяет состояние в БД.

### Регистрация производителя (MAN-01…MAN-03, FC-02, AUTH-01)

`GET /api/v1/registrations/terms` (публичный) отдаёт номер и текст текущей версии NDA; текущей нет — `503 nda_unavailable`. `POST /api/v1/registrations` принимает название, БИН, почту компании, ответ «Как вы узнали о нас» (обязателен, до 500 символов), два согласия (условия платформы, политика персональных данных) и номер принятой версии NDA; пароля и лишних полей нет. Порядок: проверка БИН (формат и контрольный разряд, в браузере и на сервере) → номер NDA сверяется с текущей (`409 nda_version_changed` до Keycloak) → занятые БИН или почта (`409 bin_exists` с текстом «обратитесь в IMBC», `409 email_exists`) → пользователь в Keycloak через Admin API (`IdentityProvisioningService`, общий поток с приглашением) → в одной транзакции снова сверка версии NDA под `for share`, организация, аккаунт с метками двух согласий и ожидающим принятием NDA (версия, время, IP запроса — `req.ip` за прокси), запись аудита `registration.created` и задание `send-password-email` на письмо подтверждения email и установки пароля со сроком 72 часа. Профиль при регистрации **не** создаётся. Ответ `202 password_email_queued` означает постановку в очередь. Worker повторяет доставку при ошибке SMTP; `POST /api/v1/registrations/resend` возвращает нейтральный ответ независимо от наличия и состояния аккаунта. Если транзакция не прошла, пользователь в Keycloak удаляется; неудачная компенсация ставится в `cleanup-identity`. Запрос без разбираемого IP — `503 identity_unavailable` до Keycloak.

Профиль появляется, когда задан пароль (MAN-03, NOT-23): событие пароля из `keycloak-events` (после всех отзывов сеансов пакета, до постановки заданий NOT-03) или, если событие ещё не пришло, вход производителя вызывают `ManufacturerOnboardingService.onPasswordSet`. В одной транзакции под блокировкой строки аккаунта: Draft-профиль из восьми секций (`registered_at` — время пароля, `heard_about_us` из регистрации), строка `nda_acceptance` (время и версия регистрации, IP запроса регистрации; FC-02), очистка ожидающего принятия у аккаунта, записи аудита `profile.created` и `nda.accepted` и попытка чтения Adata с заданием. Сбой откатывает всё, следующий вход или повтор события создаёт заново; повтор события или вход после профиля дают `existing`. Писем установка пароля не шлёт. Заблокированный аккаунт, организация без БИН и не производитель — `skipped`. Draft, созданный регистрацией до этапа 1, получает только чтение Adata, без принятия NDA.

Чтение Adata (IMBC-07, MAN-03, NOT-23) привязано к установке пароля, а не к регистрации: БИН регистрации, не ставшей профилем, не запрашивается. Планировщик ставит одну попытку `profile_created` и задание `adata-prefill` по событию пароля из `keycloak-events` или при любом входе производителя, если попытки ещё нет; оба входа сериализуются блокировкой строки профиля. Повтор при попытке в пути или с результатом даёт `skipped`; попытку в `quota_exhausted` или `not_configured` любой вход и любое событие пароля в пятиминутном окне опроса ставят снова (`requeued`: новое задание и запись аудита). Seed-профиль не в Draft и мигрированный профиль (`source = migration`) не читаются. Worker резервирует единицу квоты периода, делает один Get Request и опрашивает Check Request до 120 секунд; повтор задания продолжает опрос по сохранённому токену проверки и Get Request не повторяет. Состояния попытки: `queued` → `polling` → `received` | `unavailable (<сбой>)`, без запроса — `not_configured` (нет `ADATA_API_TOKEN`) и `quota_exhausted`; из двух последних следующий вход ставит попытку снова. В логе worker одна строка на исход: `adata attempt <id>: <состояние>[ (<сбой>)]` — без БИН, значений и адреса.

### Приглашение (ADM-01, NOT-24, AUTH-01)

Приглашение сотрудника IMBC, оператора или наблюдателя идёт тем же потоком, что регистрация (`IdentityProvisioningService`). До Keycloak: организация существует (`404`), она не производителя (`409 organization_not_invitable` — единственный аккаунт производителя создаёт регистрация, GEN-01), роль из `INVITABLE_ROLES` её типа (IMBC — `expert`, `administrator`, `director`; оператор — `operator`; наблюдатель — `observer`; иначе `400 role_not_allowed`), почта свободна (`409 email_exists`). Затем пользователь Keycloak с `firstName` = ФИО и `locale` `kk` (в форме нет языка, NOT-19) → в одной транзакции аккаунт `invited` с тем же языком, запись аудита `account.invited` и задание `send-password-email` (`singletonKey` — субъект). Сбой транзакции, в том числе одновременное приглашение того же адреса (`409 email_exists` проигравшему), удаляет пользователя Keycloak или ставит `cleanup-identity`; адрес, занятый только в Keycloak, — тоже `409 email_exists`. Повтор (`POST /api/v1/admin/accounts/:id/invitation`) ставит то же задание с тем же `singletonKey` — только аккаунту `invited` (`409 not_invited`) с привязанным субъектом (у аккаунтов seed до первого входа его нет — `409 identity_not_bound`).

### Файл (DATA-05…07)

Загрузка (`modules/files/upload.ts`): один файл в поле `file`, до 25 МБ (`413 file_too_large`), пустой — `400 file_empty`; тип — по содержимому (`file-type`, только PDF, JPG, PNG, DOCX, XLSX, иначе `415 file_type_not_allowed`), расширение имени обязано ему соответствовать (`415 file_type_mismatch`); DOCX и XLSX, которые антивирус и Office прочитали бы по-разному (ZIP64, комментарий архива, шифрование, локальный заголовок расходится с каталогом по флагам, методу или размерам, метод не stored и не deflate), и повреждённый архив — `415 file_structure_unsupported` (`modules/files/zip-structure.ts`); имя — базовое, без управляющих символов, до 255 символов (DATA-06). `FilesService.withStagedObject` кладёт байты в `imbc-quarantine` под случайным UUID, `recordNew` / `recordVersion` в транзакции действия пишут `file_object` и `file_version` (`pending`, имя, размер, оба типа, sha256, время; DATA-05) и задание `file-scan`; сбой транзакции удаляет объект. Worker (`FileScanJob`) читает объект из карантина и передаёт поток в clamd (INSTREAM), по тому же потоку сверяя sha256 с `checksum` загрузки: чистый копируется в `imbc-files` и становится `passed`, найденная сигнатура — `rejected` с аудитом `file.scan_rejected`; карантинная копия удаляется. Объекта в карантине нет (`NoSuchKey`) или sha256 не совпала — пока версии не больше 15 минут, ошибка задания (повтор), старше — `rejected` с сигнатурой `object_missing` или `checksum_mismatch`. Ответ clamd, кроме OK и FOUND, прочий сбой хранилища и ожидание блокировки сверх `boundLockWaits` — ошибка задания, версия остаётся `pending`. clamd настроен файлом `infrastructure/clamav/clamd.conf` (`AlertExceedsMax yes`): превышение предела проверки распакованного содержимого — `FOUND Heuristics.Limits.Exceeded…`, файл отклоняется. Скачивание — только `GET /api/v1/files/:id/content[?version=N]`: правило назначения `FILE_READ_RULES` (файлы профиля — `profile.read` own/all; администратор их не читает, ADM-06; образец оргструктуры — своё правило, см. «Образец оргструктуры» ниже; прочие назначения — отказ до своего этапа), отказ — `403` и аудит `file.read`; `pending` и `rejected` — `409`; поток из `imbc-files`, `Content-Disposition: attachment` с `filename*=UTF-8''…`, аудит `file.downloaded`; HEAD — те же проверки и заголовки без чтения объекта и без `file.downloaded`. Маршрутов загрузки для производителя пока нет — они придут с секциями профиля.

### Образец оргструктуры (ADM-11, MAN-19)

Образец загружает администратор (`reference.manage`) на `/references`; он не обязательный шаблон. Маршруты (тег OpenAPI `reference`):

| Маршрут | Кто | Что делает |
|---|---|---|
| `POST /api/v1/org-chart-sample` | `reference.manage` (администратор) | Один файл в поле `file` (multipart); `202`, `upload.scanState` — `pending`. Ошибки — как у загрузки файла (раздел «Файл»), плюс `503 busy`. Права проверяются до разбора тела |
| `GET /api/v1/org-chart-sample` | `reference.read` (администратор, директор) | `{ current, latest }`: текущий образец (всегда прошедший скан) и последняя загрузка, если она не текущая (`pending` или `rejected`); прежние образцы в ответ не попадают |
| `GET /api/v1/org-chart-sample/current` | администратор, директор, производитель (`profile.edit` = `own`) | `{ current: { originalName, byteSize, mediaType, uploadedAt } \| null }` — без идентификатора файла, истории и имени загрузившего |
| `GET` и `HEAD /api/v1/org-chart-sample/current/content` | те же | Байты текущего образца (стабильная ссылка скачивания, её же использует карточка на `/references`; этап 3 ставит её в секцию «Персонал»); `404 not_found`, если текущего нет; `HEAD` — заголовки без чтения объекта и без записи «скачано» |

SME, оператор и наблюдатель на `current` и `current/content` получают `403` и запись аудита `file.read` `denied`. Новая загрузка — строка `org_chart_sample` с `is_current = false` (даже если в схеме по DBML умолчание `true`); текущим образец становится в транзакции перехода версии в `passed` (хук `SCAN_PASSED_HOOKS`, `org-chart-sample.rules.ts`): прежний текущий снимается, если новый загружен позже, строки сериализованы `for update`. Пока новый образец на проверке, остаётся прежний; отклонённый скан текущим не становится. Через `/api/v1/files/:id/content` администратор и директор читают любой образец (непроверенный — `409`), производитель — только текущий, остальным — `403`. Аудит: `org_chart_sample.uploaded` (`{ fileObjectId }`), `file.scan_rejected`, `file.downloaded`, `file.read`.

### Справочники (ADM-08, ADM-09, DATA-02…04)

Двенадцать справочников в порядке требования: регионы, правовые формы, ОКЭД, ТН ВЭД, КПВЭД, товарные группы, типы товаров, процессы, типы оборудования, роли контактов, типы сертификатов и документов (`DICTIONARY_CODES`). Строки `dictionary` кладёт миграция `0010`, значения — файлы `reference-data` (раздел 6) и администратор. Название значения — отдельная строка перевода на каждом языке (DATA-02); показ — язык пользователя → kk → ru → en → код (`entryDisplayName`); код — текст, неизменяем, уникален в справочнике без учёта регистра, только ASCII (DATA-03). Тексты интерфейса — в языковых файлах, названия значений интерфейс не переводит (LANG-05).

Маршруты `DictionariesController` (`/api/v1/dictionaries`; изменяющие идут через `actorTransaction`: исполнитель под блокировкой всё ещё `active` и имеет право, иначе `403` и запись `denied`; ожидание блокировок ограничено, `503 busy`):

| Маршрут | Право | Что делает |
|---|---|---|
| `GET /api/v1/dictionaries` | `reference.read` | Двенадцать справочников: закрыт ли, есть ли обязательность, родительский справочник, число действующих и выведенных значений |
| `GET …/:code/entries?q&status&page&pageSize` | `reference.read` | Страница значений с поиском и страницами на сервере: `q` — начало кода или часть названия на любом языке без учёта регистра (`%` и `_` ищутся буквально); `status` — `active` (по умолчанию), `retired`, `all`; страница 10–100 значений, по умолчанию 50 |
| `GET …/:code/choices?q&lang&page&pageSize` | любой вошедший, без действия матрицы | Только действующие значения с одним названием на языке `lang` — для форм и фильтров (MAN-10, MAN-11, OPR-02) |
| `POST …/:code/entries` | `reference.manage` | Новое значение: код, три названия (kk, ru, en — все обязательны), группа у типа товара, обязательность у типов сертификатов и документов; встаёт в конец списка (`sort_order` = максимум + 1); `201` |
| `PUT …/:code/entries/:id` | `reference.manage` | Названия, порядок (0–100000) и группа; код не меняется |
| `PUT …/:code/entries/:id/mandatory` | `reference.manage` | Обязательность типа сертификата или документа (ADM-09); действует на профили, отправленные позже, — снимок при отправке появится в этапе 3 |
| `POST …/:code/entries/:id/retire`, `…/restore` | `reference.manage` | Вывод из оборота и возврат (DATA-04): выведенное значение скрыто из выбора, в профилях остаётся |
| `DELETE …/:code/entries/:id` | `reference.manage` | Удаление неиспользуемого значения; `204` |

Правила и коды ошибок (`REFERENCE_PROBLEM_CODES`): товарные группы A–E и роли контактов — закрытые списки, администратор меняет только названия и порядок (`409 dictionary_closed` на добавление, вывод и удаление); обязательность есть только у типов сертификатов и документов (`409 mandatory_not_applicable`); обязательное значение нельзя вывести и удалить (`409 entry_mandatory`), выведенное нельзя сделать обязательным (`409 entry_retired`); используемое значение нельзя удалить (`409 entry_in_use`) — «в использовании» определяет реестр колонок `DICTIONARY_USAGES` (`modules/dictionaries/usage.ts`) под блокировкой строки значения, у справочников без записи в реестре (`legal_form`, `commodity_group`, `process`, `contact_role`) использование пока не проверяется; повтор кода — `409 entry_exists`; неверный вид кода — `400 code_format`; неверная группа типа товара — `400 parent_invalid`; неизвестный справочник, значение другого справочника и неверный UUID — `404`. Аудит (AUD-01): `dictionary.entry_created`, `entry_updated`, `entry_mandatory_changed`, `entry_retired`, `entry_restored`, `entry_deleted` (прежние название и код) — в транзакции действия; повтор без изменения записи не пишет.

Экран `/references` (`reference.read`): администратор ведёт значения и образец оргструктуры, директор читает те же данные без кнопок; поиск, вкладки «Действующие / Выведенные / Все», страницы, диалоги добавления и правки, подтверждение удаления; на узкой карточке (до 640 px) значения идут списком вместо таблицы, горизонтальной прокрутки нет; kk, ru, en.

### Уведомления (NOT-18…NOT-21, раздел 8.2)

Событие не шлёт письмо само: в своей транзакции оно ставит задание `notify` (`enqueueNotification`, `notifications/enqueue.ts`) — только код правила, ключ события, идентификаторы и параметры-коды, без адресов и имён (задание хранится в pg-boss; строка, похожая на адрес, в задании — ошибка постановщика). Worker (`NotificationDispatcher`, `notifications/dispatcher.ts`):

1. Читает правило из `notification_rule` (17 строк `0010`: событие и части получателей через `+`; `enabled = false` — письма нет). Части: `person`, `manufacturer_account`, `imbc_mailbox` (ящик, который администратор задал на `/admin/accounts`; не задан — письма нет, предупреждение «ящик IMBC не задан» без адреса), `operator_accounts_not_blocked` — реализованы; `focal_point`, `manufacturer_contacts` (этап 3) и `assigned_sme_or_imbc_mailbox` (этап 5) — нет.
2. Отбрасывает наблюдателей (NOT-21): письма правил, кроме NOT-01–NOT-03, не уходят ни аккаунту-наблюдателю, ни на адрес, совпадающий с его логином без учёта регистра; письма аккаунта NOT-01–NOT-03 наблюдатель получает (решение по умолчанию, вопрос 43).
3. Сводит адреса без учёта регистра (NOT-18): один адрес — одно письмо; при совпадении остаётся источник «аккаунт» перед «контактом» и «ящиком IMBC».
4. Определяет язык (NOT-19): язык аккаунта получателя (`locale`), контакта — язык аккаунта производителя, ящика IMBC и неизвестного — `kk`.
5. Собирает текст из языковых файлов `apps/api/src/mail/messages/{kk,ru,en}.json` (английский — исходный; сейчас только NOT-02 и NOT-03) и отправляет `MailService.sendOnce`: в одной транзакции строка журнала `notification` (`INSERT … ON CONFLICT (dedup_key) DO NOTHING`, `dedup_key = <код>\n<ключ события>\n<адрес в нижнем регистре>`), затем SMTP, затем `COMMIT`. Повтор задания и параллельные задания письмо не удваивают; сбой SMTP откатывает строку, повтор отправит недостающее. Дубль возможен только при обрыве между приёмом письма сервером SMTP и `COMMIT`. В окне выката новый код сверяет NOT-03 и со старой таблицей `notifications_sent` (два места в коде помечены «Убрать в contract»).

Ссылки в письмах строит `appLink(PUBLIC_URL, путь)` (`notifications/links.ts`): только страницы приложения, не `/api` и не `/kc`; страница по ссылке требует входа и права (NOT-20). Повторы: у очереди `notify` 10 попыток с нарастающей паузой (около 8,5 часа), затем задание `failed` — письмо этого события не досылается. Постоянный отказ (неверное задание, нет правила, текста или подстановки, неготовая часть получателей) завершает задание сразу строкой `error` в журнале worker (код правила и причина, без адресов), без повторов.

NOT-03 (блокировка входа, AUTH-04): опрос событий Keycloak `keycloak-events` в одной транзакции ставит отметку события (`auth_security_events`, ключ `lockout:<sha256>`, хранится 32 дня), задание `notify` и аудит `auth.locked_out`; сбой почты курсор опроса не держит. NOT-02 (код входа, AUTH-03): письмо уходит вне транзакции базы (`MailService.sendImmediate`), затем строка журнала без кода; сбой SMTP — `503 mail_unavailable`, как раньше. NOT-01 (ссылка установки и сброса пароля) отправляет Keycloak, в `notification` он не пишется: тема писем `imbc` (`infrastructure/keycloak/identity/src/email`, `messages_{kk,ru,en}.properties`) ставится realm-настройкой `emailTheme` (`KEYCLOAK_EMAIL_THEME`, `sync-realm.py --email-theme`), язык письма — атрибут `locale` пользователя Keycloak, срок ссылки Keycloak печатает сам («3 дня», 72 часа). NOT-04…NOT-17 приходят со своими этапами (5–9). Как добавить письмо:

1. Текст — в `apps/api/src/mail/messages/en.json` (исходный), затем `kk.json` и `ru.json`: `templates["NOT-xx"] = { subject, lines[] }`, одни и те же ключи и подстановки `{name}` во всех трёх файлах (числа и даты подставляются готовыми строками); код — в `MAIL_TEMPLATE_CODES` (`mail/templates.ts`): без шаблона тип не соберётся, а тест `mail-messages.test.ts` сверит ключи и подстановки; новые казахские строки — в список вычитки (LANG-03). Нет шаблона или подстановки — постоянный отказ.
2. Событие — в транзакции, которая его фиксирует, `enqueueNotification(queue, { rule, eventKey, accountId \| organizationId \| profileId, related, params }, queueDb)`: в `params` только коды, идентификаторы, числа и ссылки `appLink`; `eventKey` однозначно задаёт событие (повтор того же события обязан дать тот же ключ). Если событие может прийти повторно (опрос, повтор задания), его отмечают уникальной строкой в той же транзакции — образец `JobHandlers.recordLockout`.
3. Получатели — если часть правила ещё не готова (`focal_point`, `manufacturer_contacts`, `assigned_sme_or_imbc_mailbox`), реализовать её в `DEFAULT_RECIPIENT_RESOLVERS` (`notifications/recipients.ts`); контакт производителя — источник `contact`, язык — через `languageAccountId` аккаунта производителя. Сведение адресов, фильтр наблюдателей и язык диспетчер делает сам. Копия NOT-13 для ящика IMBC называет организацию оператора и отправившего пользователя (NOT-32), а рендерер получает только `params` без имён, поэтому этапу 7 понадобится рендерер с чтением из базы.

### Задания и расписания (ADR-06)

API ставит задания, выполняет их worker. Для `send-password-email`, `cleanup-identity`, `inactivity-reset` и `notify` настроено до 10 повторов, для `adata-prefill` — до 3 (срок задания 300 секунд), для остальных очередей, включая `file-scan`, — до 5; начальная пауза 30 секунд увеличивается при ошибках. Письма платформы дедуплицирует журнал `notification` (раздел «Уведомления»); доставка письма установки пароля Keycloak при повторе задания может повториться. Строки очередей `scan-file` и `send-notification`, созданных прежней версией, остаются в `pgboss.queue` (pg-boss очередь сам не удаляет): их маршруты удалены, новый код заданий в них не ставит; убрать их можно при релизе contract.

| Очередь | Когда (Asia/Almaty) | Что делает | Состояние |
|---|---|---|---|
| `file-scan` | загрузка файла; зачистка | Проверка ClamAV, перенос из карантина в рабочий бакет (DATA-07). Очередь `exclusive`: одно задание версии в очереди или в работе | работает |
| `file-scan-sweep` | каждые 15 минут | Версии `pending` старше 15 минут — снова в `file-scan` | работает |
| `notify` | по событию (в транзакции события) | Письмо правила `notification_rule`: получатели, язык, без наблюдателей, одно письмо на адрес и событие в журнале `notification` (NOT-18…NOT-21). Сейчас ставится только NOT-03; остальные правила — со своими этапами | работает |
| `send-password-email` | регистрация или повтор приглашения | Вызов Keycloak для подтверждения email и установки пароля приглашённому аккаунту | работает |
| `cleanup-identity` | неудачная компенсация регистрации | Удаление пользователя IdP, если аккаунт платформы не был создан | работает |
| `identity-sync` | блокировка, разблокировка, смена почты; неудачная компенсация почты | Keycloak приводится к строке БД: включён ли пользователь, почта, выход из сеансов IdP | работает |
| `inactivity-reset` | переход аккаунта в `inactive` | Keycloak: выход из сеансов IdP и письмо NOT-01 со ссылкой сброса пароля (NOT-26). Обязательное действие пользователю не ставится: вход со старым паролем получает `account_inactive`. Возврат по ссылке без входа зависит от того, дочитает ли опрос `keycloak-events` событие пароля Keycloak; иначе аккаунт вернётся при входе | работает |
| `certificate-expiry` | 00:30 ежедневно | Сертификаты с истёкшим сроком → `expired` (профиль не скрывается, REV-20) | работает |
| `purge-export-files` | 01:00 ежедневно | Удаление файлов выгрузок старше 90 дней (OPR-23) | работает |
| `purge-sessions` | каждый час, :15 | Просроченные сеансы, коды, доверенные устройства и служебные записи защиты входа | работает |
| `account-inactivity` | 02:00 ежедневно | Три месяца без входа по Алматы → `inactive`, сеансы завершены, задание `inactivity-reset` (AUTH-07) | работает |
| `run-subscriptions` | 06:00 ежедневно | Подписки на выгрузки (OPR-20) | заглушка |
| `update-status` | 09:00 ежедневно | Квартальный цикл актуализации (UPD-01…05) | заглушка |
| `keycloak-events` | каждую минуту | Смена пароля → отзыв доступа; блокировка → отметка события, задание `notify` (NOT-03) и аудит `auth.locked_out` одной транзакцией (AUTH-04) | работает |
| `adata-prefill` | установка пароля или вход производителя без попытки (и с попыткой `quota_exhausted` / `not_configured`) | одно чтение «Полной информации» Adata, квота периода | работает |
| `activity-snapshot-*` | пн 03:00 / 1-е число 03:00 | Снимки активности (OPR-74) | заглушка |
| `refresh-catalog`, `build-export` | по событию | Пересборка проекции, файл выгрузки | заглушка |

## 8. Доступ и защита

- **PolicyMatrix** (`packages/contracts/src/policy.ts`) — роли × действия из раздела 4 спецификации. Значение — условие доступа: `own`, `visible`, `all`, `after_nda`, `account_events`. Контроллер помечает маршрут `@Can('catalog.search')`; `SessionGuard` проверяет сеанс, второй фактор, принятие ответственности и право, а условие кладёт в контекст запроса для сервиса. Отказ пишется в аудит.
- **Шесть ролей** (раздел 3.1 спецификации): производитель (`manufacturer`), SME (`expert`), администратор IMBC (`administrator`), генеральный директор IMBC (`director`) — у IMBC без суперпользователя, ADR-19, — оператор (`operator`), наблюдатель (`observer`). Роль хранится в платформе, не в Keycloak: IdP отвечает только за «кто это».
- **Тир и focal point** — действия строки «Tier, AGAR, and CDP» раздела 4: `tier.read` (производитель — свой, SME и директор — все, оператор и наблюдатель — видимые), `tier.read_products` (то же без наблюдателя; оператору — только какие продукты в tier 3, IMBC-22), `tier.request` (производитель), `tier.edit` (SME). `focal_point.read` есть у производителя, SME, директора и оператора; у наблюдателя его нет (GEN-13), поэтому в ответе страницы компании для наблюдателя нет ключа `focalPoint`. Тесты contracts закрепляют матрицу целиком.
- **CSRF**: изменяющие запросы принимаются только со своего Origin; cookie `SameSite=Lax`, `HttpOnly`, на HTTPS — `Secure` и префикс `__Host-`.
- **Ошибки** — RFC 9457 `application/problem+json` с машинным `code` (`bin_exists`, `mfa_required`, `forbidden`…); UI переводит их по коду.
- **Логи** — pino; из строки журнала запроса вырезаются cookies, заголовки авторизации и `Set-Cookie`, а также IP клиента — заголовки `X-Forwarded-For`, `X-Real-IP`, `Forwarded`, адрес и порт сокета (`apps/api/src/common/logging.ts`; IP — персональные данные, FC-02; NFR-10, NFR-11). Непредвиденная ошибка базы (ошибка Drizzle или PostgreSQL в цепочке `cause`) пишется в журнал API и в `output` задания pg-boss только сводкой — SQLSTATE, ограничение, таблица, функция PostgreSQL и классы ошибок (`apps/api/src/database/pg-errors.ts`): текст, стек, запрос и параметры Drizzle, `detail` PostgreSQL несут почту, ФИО, БИН и IP. Секреты — только в переменных окружения.
- **Консоль аккаунта Keycloak закрыта**: `/kc/realms/<realm>/account` и всё под ним отвечают `404` на обоих edge-прокси (`infrastructure/azure/Caddyfile` — `@accountConsole` до общего `@keycloak`, `infrastructure/nginx/nginx.conf` — `location ~*` до `location /kc/`). Стандартный интерфейс IdP не показывается (`AGENTS.md`), и сменить почту-логин в обход администратора нельзя (MAN-05). Открытыми остаются OIDC (`/protocol/openid-connect/*`, `/.well-known/*`), действия входа (`/login-actions/*`) и ресурсы темы (`/kc/resources/*`); консоль администратора и realm `master` закрывает `@private`. Локальный `pnpm dev` (`apps/web/dev-proxy.ts`) консоль не закрывает.
- **Почту-логин и имя пользователя Keycloak меняет только администратор**: профиль пользователя realm (`components` → `declarative-user-profile` в `imbc-realm.json`; на существующем realm — шаг `sync-realm.py`) разрешает `email` и `username` смотреть `admin` и `user`, а менять — только `admin` (Admin API платформы: `updateUser` при ADM-05). Имя и фамилия в Keycloak необязательны: ФИО платформа хранит сама (`user_accounts.full_name`; приглашение передаёт его в Keycloak как `firstName`, регистрация — нет), и после установки пароля по ссылке нет шага «Данные учётной записи» — сразу «Всё готово» (MAN-01, MAN-03, ADM-01 ничего больше не спрашивают). Через `kc_action=UPDATE_PROFILE` пользователь может заполнить имя и фамилию, но не почту: Keycloak не передаёт странице атрибут, недоступный для правки, и игнорирует подставленные поля `email` и `username` (проверено на Keycloak 26.4); тема на случай, если атрибут придёт, выводит его текстом, без поля формы (MAN-05).
- **Keycloak 26.4** проверяет пароли штатными механизмами; все видимые пользователю формы входа, установки и восстановления пароля — собственная тема IMBC на React и shadcn/ui из `infrastructure/keycloak/identity`. Политика паролей (≥ 12 символов), блокировка 10/15 минут, сеансы 30 минут / 12 часов и ссылки установки/сброса пароля 72 часа заданы в `imbc-realm.json`. Email-код, доверенное устройство и диалог ответственности — в BFF (таблица §5 архитектуры).

### Почта

Почта нужна уже для входа, поэтому почтовый сервис — часть стенда, а не «потом».

| Письмо | Кто отправляет | Когда | Как |
|---|---|---|---|
| Подтверждение email и установка пароля, ссылка 72 часа (AUTH-01, NOT-01) | Keycloak по заданию worker | Регистрация, приглашение и его повтор, смена почты приглашённого производителя (ADM-05) | `send-password-email` → Admin API `execute-actions-email`; текст — тема писем Keycloak `imbc` на языке пользователя (kk, ru, en; NOT-19), в журнал `notification` не пишется |
| Сброс пароля (AUTH-08) | Keycloak | «Забыли пароль?» на странице входа IMBC | Штатный поток сброса, письмо — та же тема писем `imbc` |
| Код входа, 6 цифр, 10 минут (AUTH-03, NOT-02) | API | Вход с недоверенного устройства | Сразу, без очереди — пользователь ждёт код; письмо уходит вне транзакции базы, затем строка в журнале `notification` (без кода) |
| Блокировка после 10 ошибок (AUTH-04, NOT-03) | Worker | Событие `USER_DISABLED_BY_TEMPORARY_LOCKOUT` в Keycloak, проверка раз в минуту | Задание `notify`, одно письмо на блокировку и адрес в журнале `notification`; наблюдатель получает его как письмо аккаунта |
| Уведомления NOT-04…NOT-17 (профиль, проверка, сертификаты, статус актуальности) | Worker | Диспетчер `notify` и правила получателей готовы; тексты и постановка — вместе с предметными процессами этапов 5–9 | Журнал `notification`: одно письмо на событие и адрес без учёта регистра (NOT-18); наблюдателям не уходят (NOT-21) |

- Письма платформы — на языке получателя (kk по умолчанию, ru, en; ящик IMBC — kk), текст и HTML; тексты — языковые файлы `apps/api/src/mail/messages/{kk,ru,en}.json`, сборка — `mail/templates.ts`, отправка — `MailService`, получатели и журнал — раздел 7, «Уведомления». Письма Keycloak (NOT-01) берут текст из темы `imbc` (`infrastructure/keycloak/identity/src/email`): встроенный казахский пакет Keycloak 26.4 пишет в текстах писем буквальные `\n\n` вместо переводов строки, тема `imbc` перекрывает эти ключи; тема писем подключена только в стеке с `compose.azure.yaml` (образ `imbc/keycloak` с JAR темы), на одном `compose.yaml` действует стандартная тема `keycloak`. При старте API и worker проверяют SMTP (`verify`) и пишут результат в лог, но не падают: письма из очереди повторятся.
- **Azure dev:** API и Keycloak передают письма в **Mailpit**, который сохраняет копию и пересылает реальные адреса через Azure Communication Services SMTP (STARTTLS). Адреса `.local`, `.localhost`, `.invalid`, `.test`, `.example` остаются только в Mailpit. Интерфейс — `/dev-mail/` на HTTPS-домене, с IP из `ADMIN_ALLOWED_IPS` и паролем `MAILPIT_UI_AUTH`. Письма хранятся в томе `mailpit-data` (до 5 000 штук).
- Relay-конфигурация находится только на сервере: `infrastructure/mailpit/.env.smtp-relay.yaml` с правами `0600`; шаблон — `relay.example.yaml`. В `.env`: `MAILPIT_RELAY_CONFIG=/etc/mailpit/.env.smtp-relay.yaml`, `MAILPIT_RELAY_ALL=true`. Временный домен Azure допускает до 5 писем в минуту и 10 в час на подписку; для более активной разработки нужен свой домен. Локальный Compose без Azure-overlay сохраняет прежний режим перехвата без отправки.
- **Реальная доставка** (test/acceptance/prod или проверка на настоящих ящиках) — две настройки в `.env`:
  - платформа: `SMTP_URL=smtps://user:password@smtp.imbc.kz:465` (или `smtp://…:587` для STARTTLS), `MAIL_FROM`;
  - Keycloak: `KEYCLOAK_SMTP_HOST`, `KEYCLOAK_SMTP_PORT`, `KEYCLOAK_SMTP_AUTH=true`, `KEYCLOAK_SMTP_USER`, `KEYCLOAK_SMTP_PASSWORD`, `KEYCLOAK_SMTP_SSL` или `KEYCLOAK_SMTP_STARTTLS`.

  На Azure-стенде `deploy.sh` после запуска обновляет управляемые SMTP-настройки существующего realm через `infrastructure/azure/sync-realm.py`. Источник — серверная `.env` и `imbc-realm.json`; изменения только в консоли будут заменены следующим развёртыванием.
- Для доставляемости с домена IMBC нужны SPF, DKIM и DMARC на стороне почтового релея — это вопрос ИТ IMBC, не кода.

## 9. Каталог: фильтры в адресе страницы

Требование OPR-05 — выбранные фильтры передаются ссылкой. Поэтому состояние фильтров живёт **только в адресе**:

```
/catalog?q=металл&region=KZ-ATY,KZ-MAN&group=A,B&tier=tier_2&tnved=7308&sort=verified_at&page=2
```

- `apps/web/src/lib/catalog-params.ts` описывает параметры для **nuqs** с адаптером React Router; формат совпадает с `catalogFilterSchema` из `@imbc/contracts` — списки через запятую, логические `true/false`.
- Запрос в `GET /api/v1/catalog/search` строится из этих параметров: ключи, которые знает интерфейс, уходят в API в формате, который разбирает `catalogFilterSchema` (тот же zod-парсер на сервере), остальные ключи адреса отбрасываются. Ключи схемы, для которых в интерфейсе ещё нет поля (расширенные фильтры OPR-03, тип продукции и сертификата, размер страницы), перечислены в `apps/web/test/catalog.test.tsx`; тест проверяет, что каждый ключ схемы либо обрабатывается, либо назван там.
- **TanStack Query** кеширует результат по ключу `["catalog", query]`: «назад» в браузере показывает прошлый поиск мгновенно, `keepPreviousData` не даёт таблице мигать при смене фильтра. Текстовые поля обновляют адрес с задержкой 350 мс, а запрос строится из адреса, поэтому набранное слово даёт один запрос.
- Между фильтрами — AND, внутри одного фильтра — OR (OPR-04). Сертификаты по умолчанию учитываются только действующие.
- Тир — фильтр `tier` (`tier_1`, `tier_2`; OPR-02), колонка результатов и плитки дашборда (OPR-06, OPR-32). Неизвестное значение в адресе интерфейс в API не передаёт, сервер на него отвечает отказом.
- Порядок выдачи: unresponsive ниже active и outdated при любой сортировке (`name`, `verified_at`, `region`) и на каждой странице (UPD-04, OPR-01, OPR-33), затем ключи выбранной сортировки, последним — `profile_id`, чтобы страницы не перемешивались при равных ключах (`catalogOrder` в `catalog.service.ts`).
- Кнопка «Скопировать ссылку» копирует текущий адрес; плитки дашборда ведут в каталог с соответствующим фильтром.
- Страница компании — `/companies/:id` (`GET /api/v1/catalog/companies/:profileId`), только проекция видимых профилей: профиль вне неё — 404 для любой роли; наблюдатель не получает focal point (GEN-13). «Назад к каталогу» возвращает фильтры, с которыми страницу открыли.
- Профиль производителя — `/profile` (`GET /api/v1/profiles/own`), только для чтения и только своей организации (GEN-11): статус профиля, заполненность, статус актуальности и тир — последние два после верификации; тир берётся из строки своего профиля в `catalog_visible`, вне проекции — tier 1.
- Язык интерфейса — в cookie, не в адресе: одна и та же ссылка открывается на казахском, русском или английском у разных пользователей.

## 10. Web UI: shadcn/ui, языки, MCP

- **React 19 + Vite** — одностраничное приложение без серверного рендеринга (спецификация 11.1). Маршруты — React Router 8 (data router), все в `apps/web/src/router.tsx`; адреса прежние: `/`, `/login`, `/register`, `/auth/verify`, `/auth/responsibility`, `/catalog`, `/dashboard`, `/account`, `/profile`, а также новые `/companies/:profileId`, `/reviews`, `/admin/accounts` и `/references`. Адреса `/api/*` и `/kc/*` открываются обычным переходом браузера: их обслуживают BFF и Keycloak, а не приложение.
- **Очередь проверки SME** — `/reviews` (только для чтения, REV-01, REV-04): профили Submitted, Under review и Verified с ожидающими изменениями из `GET /api/v1/reviews/queue`, фильтр статуса в адресе (`?status=`); это стартовая страница SME, другим ролям страница и API закрыты (GEN-08). Seed добавляет три профиля очереди и один Draft вне неё.
- **Организации и аккаунты** — `/admin/accounts`, кабинет администратора (ADM-01–03, ADM-05, ADM-06, GEN-05, AUTH-06): над списком — «Пригласить пользователя», «Создать организацию» (оператор или наблюдатель; отметка major — только у оператора) и карточка ящика IMBC (пустое поле снимает адрес). Организации — разделами по типу (IMBC, операторы, наблюдатели, производители; заголовок h2 с числом организаций, пустой раздел не выводится), внутри — карточками с числом аккаунтов; производитель без аккаунта карточки не получает, под разделом — строка «Ещё n производителей без аккаунта»; аккаунт — строка с почтой, именем, ролью, состоянием с пояснением и последним входом, на узком экране переносится без горизонтальной прокрутки. Меню строки предлагает только возможное: повтор приглашения (`invited`; у `inactive` его нет — человек возвращается через «Забыли пароль?»), разблокировку, смену роли (сотрудник IMBC), смену почты-логина (производитель) и отдельно — блокировку с подтверждением; своя строка помечена «Вы», без блокировки и смены роли. У оператора — кнопка отметки major. Итог действия — строка состояния над списком (`aria-live="polite"`), список перечитывается; ошибка — в диалоге у поля или общим сообщением, у каждого кода `ADMIN_PROBLEM_CODES` есть текст на трёх языках. Если почту приглашённого сменили, пока аккаунт был заблокирован, письмо установки пароля не уходит: после разблокировки — «Отправить приглашение снова». БИН и профиль производителя в ответе и на странице нет. Это стартовая страница администратора, «Мой аккаунт» (`/account`) остаётся в меню; другим ролям страница и API закрыты (GEN-08).
- **Справочники** — `/references` (`reference.read`: администратор и директор; GEN-08): выбор одного из двенадцати справочников (подпись «Справочник»; смена справочника сбрасывает поиск, вкладку и страницу), поиск по коду и названию, вкладки «Действующие (N) / Выведенные (M) / Все», страницы с «Показано 1–50 из N»; администратор добавляет значение, правит названия на трёх языках и порядок, переключает «Обязательный» у типов сертификатов и документов, выводит значение из оборота, возвращает его и удаляет неиспользуемое; директор видит то же без кнопок. Товарные группы и роли контактов закрыты: только правка названий. Над ними — карточка «Образец оргструктуры» (четыре состояния: не загружен, текущий, проверяется антивирусом, не прошёл проверку; загрузка — у администратора, «Скачать» — у обеих ролей). Для кодов ошибок `REFERENCE_PROBLEM_CODES` и `FILE_PROBLEM_CODES` в `references.errors.*` есть сообщения на трёх языках (близкие по смыслу коды делят один текст). Ширина карточки до 640 px — список вместо таблицы, без горизонтальной прокрутки.
- **Образ `imbc/web`** — сборка на Node 26, раздача статики через `nginxinc/nginx-unprivileged` без root, адрес внутри сети `web:3000`. Любой адрес приложения получает `index.html`, отсутствующий файл `/assets/*` — 404. `Content-Security-Policy` (`script-src 'self'`, inline-скриптов нет) и `Cache-Control` (`no-store` для всех адресов, которые отвечают `index.html`, год и `immutable` для хешированных `/assets/*`) задаёт `infrastructure/nginx/web.conf`. `no-store` не даёт браузеру хранить страницу: после выхода кнопка «Назад» не показывает данные прежнего пользователя (NFR-11); вкладку, которую браузер всё же восстановил из back/forward cache, приложение перезагружает, и сеанс проверяется заново. `X-Content-Type-Options`, `Referrer-Policy` и `X-Frame-Options` ставит edge — nginx локально и Caddy в Azure; HSTS и `Permissions-Policy` ставит только Caddy. Каждый ответ API и BFF — данные, ошибки problem+json и перенаправления входа — несёт `Cache-Control: no-store` (`apps/api/src/common/http.ts`), а клиент BFF в web шлёт запросы с `cache: "no-store"`, поэтому браузер не рисует данные прежнего пользователя из своего HTTP-кеша (NFR-11).
- **shadcn/ui на Base UI** (`@base-ui/react`), пресет `base-nova`, Tailwind CSS 4. Компоненты лежат в `apps/web/src/components/ui` и правятся как свой код. В `sidebar.tsx` есть отмеченная комментарием локальная правка — переводимые заголовок и описание мобильной панели; при повторном добавлении компонента её нужно сохранить. Тема IMBC — синий, белый, чёрный (NFR-15) — задана CSS-переменными поверх пресета в `apps/web/src/index.css`; размеры контролов и радиусы — пресета `base-nova`.
- **Логотип IMBC** — файл заказчика `apps/web/src/assets/imbc-logo.png` (PNG 736×212, серебристый на прозрачном фоне). На светлых поверхностях он лежит на тёмно-синей подложке. В свёрнутом сайдбаре знака нет, иконки сайта тоже: квадратного знака IMBC пока нет.
- **Формы идентификации IMBC** — отдельный пакет React + Keycloakify в `infrastructure/keycloak/identity` с собственными компонентами shadcn/ui. Azure-overlay собирает его в образ `imbc/keycloak:dev`; пользовательские экраны всех ролей не используют стандартное оформление Keycloak. Пакет имеет отдельный `package-lock.json` и сборку внутри Docker. Его компоненты пока на Radix (стиль `new-york`); перевод на Base UI и `base-nova` — отдельным планом.
- На обычной форме входа после загрузки темы адресная строка показывает `/login`. Параметры OIDC и PKCE сохраняются в процессе входа; действия форм не меняются. Обновление страницы или открытие скопированного `/login` начинает новый вход со стартовой страницей по роли. Одноразовые ссылки из писем сохраняют свой адрес.
- **Языки** — use-intl: казахский по умолчанию, русский, английский (LANG-01); исходный файл — английский (LANG-02). Язык хранится в cookie `NEXT_LOCALE`, не в адресе. То же имя пишет тема Keycloak, поэтому выбранный язык общий для экранов приложения и Keycloak. Переводы загружаются в браузере, и язык меняется без перезагрузки страницы. Даты и числа форматируются по языку (LANG-04), часовой пояс — Asia/Almaty. Шрифт Inter (с казахскими глифами) поставляется npm-пакетом, без обращения к Google Fonts при сборке.
- **Что работает иначе, чем до перехода на Vite SPA:**
  - `/login` без ошибки переходит ко входу через BFF и Keycloak после загрузки приложения; на долю секунды видна надпись «Проверяем доступ…».
  - Неизвестный адрес отвечает HTTP 200 и показывает переведённую страницу «не найдено».
  - Ссылка, оформленная как кнопка, остаётся ссылкой: её можно открыть в новой вкладке, экранный диктор называет её ссылкой.
  - Оболочка и рабочие страницы загружаются отдельными файлами при первом переходе на них; экраны входа входят в основную сборку.
  - Если после выката новой версии часть приложения не загрузилась, страница один раз перезагружается сама; если не помогло — экран ошибки на языке пользователя с кнопкой «Перезагрузить страницу». Если приложение не смогло запуститься (не загрузился файл переводов), тоже одна перезагрузка, затем статичное сообщение сразу на казахском, русском и английском.
  - Каталог отправляет запрос по адресу страницы после задержки ввода: одно набранное слово — один запрос, а не запрос на каждую клавишу. «Сбросить» очищает и текстовые поля.
  - Дашборд при ошибке загрузки показывает сообщение и кнопку повтора.
  - Если при принятии ответственности сервер ответил `mfa_required`, сведения о сеансе перечитываются до перехода на `/auth/verify`, и страница кода не возвращает пользователя обратно.
  - Кнопки и поля — размеров пресета `base-nova`.
  - Даты и числа на казахском форматирует само приложение, без данных локали из браузера (в Chrome их для `kk` нет): даты — `15.10.2026` и `15.10.2026, 14:30`, числа — `1 234 567,5` с пробелом между разрядами и запятой; русский и английский — по правилам браузера, как раньше.
- **MCP-сервер shadcn** подключён в `.mcp.json` (Claude Code), `.cursor/mcp.json` и `.vscode/mcp.json`:

  ```json
  { "mcpServers": { "shadcn": { "command": "npx", "args": ["shadcn@latest", "mcp", "--cwd", "apps/web"] } } }
  ```

  Ассистент в редакторе может искать компоненты реестра и смотреть примеры; добавляются компоненты командой `pnpm dlx shadcn@4.23.0 add <имя>` из `apps/web` — версия зафиксирована в `pnpm-lock.yaml` (в `apps/web/package.json` — диапазон `^4.23.0`), стиль `base-nova` берётся из `components.json`. MCP-сервер запускается с `shadcn@latest`, потому что он только читает реестр; файлы добавляет закреплённая версия CLI, чтобы сгенерированный код воспроизводился.

  В текущем Codex-клиенте официальный MCP также установлен и проверен вызовами реестра: примеры `input-otp`, компоненты `field` и контрольный список аудита применены при работе над авторизацией. Локальная настройка Codex находится вне репозитория.

## 11. Запуск на dev-сервере

Для Azure используется один Ubuntu 24.04 VM с Docker Compose и HTTPS через Caddy. Скрипт [infrastructure/azure/deploy.sh](infrastructure/azure/deploy.sh) работает с текущей подпиской `az login`; нужны Azure CLI, Python 3, Git, SSH и tar на вашей машине. Docker и Compose устанавливаются на VM через cloud-init.

### Dev-сервер в Azure

Запускайте из корня репозитория:

```bash
./infrastructure/azure/deploy.sh up        # создать или обновить VM, ограничить SSH по IP, открыть сайт всем
./infrastructure/azure/deploy.sh info      # адреса и способ подключения, без паролей
./infrastructure/azure/deploy.sh redeploy  # загрузить текущие локальные исходники, пересобрать и проверить стенд
./infrastructure/azure/deploy.sh ssh       # подключиться к VM
./infrastructure/azure/deploy.sh preview <sha>  # что синхронизация конвейера удалит и изменит; ничего не меняет
```

По умолчанию: `imbc-dev-rg` / `imbc-dev`, `polandcentral`, `Standard_D4as_v5` (4 vCPU, 16 ГБ RAM), Standard SSD 128 ГБ. SSH-ключ хранится локально в `~/.ssh/imbc-dev-azure`, приложение на VM — в `/home/imbc/imbc-platform`. Подробные адреса, команды обслуживания и стоимость: [runbook Azure dev](docs/deployment/azure-dev.md).

**Конвейер развёртывания.** После настройки скриптом `infrastructure/azure/setup-github-deploy.sh` (`plan` — только чтение, затем `apply --yes --subscription-name "<имя подписки>"`) workflow [deploy-dev.yml](.github/workflows/deploy-dev.yml) обновляет стенд сам после успешного CI для push в `main`. Вручную: Actions → Deploy dev → Run workflow из `main` с полем `ref` (ветка, тег или SHA). Вход в Azure — через GitHub OIDC без секретов, без SSH: управляемая идентичность может только читать VM `imbc-dev` и запускать на ней run-command. Шаги на VM выполняет `infrastructure/azure/vm-deploy.sh` из развёртываемого коммита — тот же скрипт вызывает `deploy.sh redeploy`. Конвейер работает только с публичным репозиторием (архив коммита VM скачивает анонимно); журналы Actions видны всем, поэтому наружу выводится только краткая сводка, полный журнал остаётся на VM в `/var/log/imbc-deploy/`. Перед первым запуском посмотрите, что синхронизация удалит: `./infrastructure/azure/deploy.sh preview <sha>`. Первое развёртывание новой VM, создание `.env` и смена `ADMIN_ALLOWED_IPS` остаются за `deploy.sh`. Подробности, откат и отключение — в [разделе «Конвейер развёртывания»](docs/deployment/azure-dev.md#конвейер-развёртывания).

- Caddy получает и обновляет TLS-сертификат для `PUBLIC_HOST`. HTTPS/443 доступен всем получателям ссылок; SSH/22 ограничен текущим внешним IP (`ALLOW_FROM`). HTTP/80 открыт для ACME и перенаправления. Mailpit, Keycloak admin и master realm доступны только с IP из серверной `ADMIN_ALLOWED_IPS`; Mailpit дополнительно требует пароль. При первом запуске список берётся из `ALLOW_FROM`, затем сохраняется. После смены сети задайте оба списка явно: `ALLOW_FROM=1.2.3.4/32 ADMIN_ALLOWED_IPS="1.2.3.4/32 127.0.0.1/32 ::1/128" ./infrastructure/azure/deploy.sh up`. Публичный HTTPS открывается после проверки ограничений Caddy; обычный `redeploy` не меняет NSG.
- Запуск всегда объединяет `compose.yaml` и `compose.azure.yaml`. API, Keycloak, Web и Mailpit доступны через Caddy; PostgreSQL, Valkey и S3 API остаются в Docker-сети. Порты nginx, Mailpit и консоли S3 привязаны к localhost VM.
- Серверная `.env` создаётся со случайными секретами и правами `0600`. В ней включены `COOKIE_SECURE=true`, cookie с префиксом `__Host-` и `KEYCLOAK_SSL_REQUIRED=external`. Повторное развёртывание сохраняет `.env`, данные и TLS-сертификаты; `info` не печатает пароли.
- Realm Keycloak импортируется один раз. После каждого запуска `sync-realm.py --theme imbc` обновляет разрешённый набор настроек темы, политик, событий, SMTP и клиента BFF; пользователи и client secrets сохраняются. Изменение hostname, секретов или переход существующего HTTP-стенда на HTTPS требует согласованной миграции; скрипт останавливается при несовместимой `.env`.
- На dev используются демо-данные и Mailpit с Azure SMTP relay: настоящие адреса получают письма, адреса демо-пользователей `.local` остаются в Mailpit.

| Что | Адрес относительно HTTPS-домена |
|---|---|
| Платформа | `/` |
| OpenAPI | `/api/docs` |
| Консоль Keycloak | `/kc/admin/`, IP из `ADMIN_ALLOWED_IPS` |
| Почта с кодами входа | `/dev-mail/`, IP из `ADMIN_ALLOWED_IPS` и пароль из `MAILPIT_UI_AUTH` |
| Консоль S3 | SSH-туннель на `127.0.0.1:9001`, см. runbook |

### Демо-учётные записи

Шесть seed-аккаунтов создаются при `SEED_DEMO=true`; отдельный `test-admin@imbc.local` создан при настройке Azure-стенда. Для всех семи аккаунтов на текущем dev включён код `000000` без отправки письма. Пароли не меняются: общий начальный пароль seed-аккаунтов находится в `KEYCLOAK_DEV_USER_PASSWORD` серверной `.env`, а отдельного тестового администратора — в локальном файле владельца `~/.config/imbc/test-admin-access.md`, вне Git.

| Почта | Роль | OTP на текущем dev |
|---|---|---|
| `expert@imbc.local` | эксперт IMBC | `000000` |
| `admin@imbc.local` | администратор IMBC | `000000` |
| `director@imbc.local` | директор IMBC | `000000` |
| `operator@operator.local` | оператор | `000000` |
| `observer@observer.local` | наблюдатель (`observer`) | `000000` |
| `manufacturer@demo.local` | производитель | `000000` |
| `test-admin@imbc.local` | отдельный тестовый администратор IMBC | `000000` |

Демо-наблюдатель до спецификации v1.3 назывался `spectator@spectator.local`; выкат v1.3 переименовал его на месте (UUID, пароль и пара в `DEV_FIXED_OTP_ACCOUNTS` сохранились), прежний адрес для входа не работает. С релиза contract `0006` переименования больше нет, а прежнее имя роли `"role":"spectator"` в `DEV_FIXED_OTP_ACCOUNTS` — ошибка конфигурации при старте ([переход на v1.3](docs/deployment/azure-dev.md#переход-на-спецификацию-v13)).

Шесть seed-аккаунтов включены по UUID и роли через `DEV_FIXED_OTP_ACCOUNTS`; отдельный `test-admin@imbc.local` сохраняет совместимую настройку `DEV_FIXED_OTP_USER_ID` только для роли `administrator`. Один `SEED_DEMO=true` не включает фиксированный OTP: нужны явные настройки dev-режима и списка, описанные в [runbook](docs/deployment/azure-dev.md#демо-аккаунты-с-фиксированным-кодом). Аккаунт администратора открывает `/admin/accounts` — организации и аккаунты; каталог, dashboard и профиль производителя ему недоступны. Действия с аккаунтами (приглашение, блокировка, смена роли и почты) есть на стенде с выката этапа 1 (13.11.2026); справочники, образец оргструктуры и письма на журнале — этап 2, на стенд не выкачен.

Первый вход: пароль → `000000` для перечисленных демо-аккаунтов или почтовый код для остальных → диалог ответственности → стартовая страница по роли: `/dashboard` для оператора, наблюдателя и директора, `/reviews` для SME, `/profile` для производителя, `/admin/accounts` для администратора. Права роли, срок кода, лимит попыток и доверие к устройству сохраняются. Письма установки и восстановления пароля для демо-адресов по-прежнему доступны в Mailpit. Seed создаёт 15 организаций (IMBC, демо-оператор, демо-наблюдатель, восемь компаний каталога и четыре производителя для очереди SME) и шесть аккаунтов. Каталог содержит восемь вымышленных компаний с контактами на странице компании (у одной нет focal point); очередь SME — два профиля Submitted и один Under review, назначенный демо-SME; ещё один профиль Draft в очередь не входит. Наличие стартовой страницы не означает готовность предметного кабинета: демо-экраны только читают данные. Все видимые формы авторизации используют shadcn/ui в теме IMBC; Keycloak остаётся внутренним сервисом учётных записей. Языки: kk, ru, en.

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

Vite проксирует `/api` на `API_PROXY_URL` (`localhost:3001`) и `/kc` на `KEYCLOAK_PROXY_URL` (Keycloak, `localhost:8180`) — переменные в `apps/web/.env.local`, правило в `apps/web/dev-proxy.ts`. Поэтому браузер, как и на стенде, работает с одним origin `http://localhost:3000`.

| Команда | Что делает |
|---|---|
| `pnpm dev` | Все приложения в режиме разработки |
| `pnpm build` | Сборка всех пакетов (turbo, с кешем) |
| `pnpm typecheck` | Проверка типов |
| `pnpm lint` | ESLint (web) |
| `pnpm test` | Тесты пакетов через Turbo: Vitest в API, contracts и web |
| `pnpm --filter @imbc/api db:generate` | SQL-миграция из изменений схемы |
| `pnpm --filter @imbc/api db:migrate` | Применить миграции (нужен `DATABASE_URL` владельца) |
| `cd apps/web && pnpm dlx shadcn@4.23.0 add <компонент>` | Добавить компонент shadcn/ui (`base-nova`) |
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
| `DEPLOYMENT_ENV` | `production` по умолчанию; `development` явно разрешает настройки тестового стенда. Не заменяет `NODE_ENV` оптимизированной сборки |
| `DEV_FIXED_OTP_ENABLED` | Фиксированный OTP для явно настроенных демо-аккаунтов; по умолчанию `false`. Включение требует `DEPLOYMENT_ENV=development` и хотя бы одной записи в списке или legacy UUID |
| `DEV_FIXED_OTP_ACCOUNTS` | JSON-массив `[{"id":"<UUID user_accounts>","role":"<роль>"}]`, по умолчанию `[]`. При выдаче и проверке кода требуется точное совпадение UUID и ожидаемой роли; email и `.local` не используются |
| `DEV_FIXED_OTP_USER_ID` | Совместимая настройка UUID отдельного тестового администратора, только с ролью `administrator`. Необязательна при непустом списке; тот же UUID нельзя дублировать в `DEV_FIXED_OTP_ACCOUNTS` |
| `SMTP_URL`, `MAIL_FROM` | Почта платформы (по умолчанию Mailpit). Ящик IMBC в переменной не задаётся: его вводит администратор на `/admin/accounts` (раздел 8.2 спецификации); прежняя `IMBC_MAILBOX` удалена, оставшаяся в серверной `.env` строка не читается |
| `KEYCLOAK_SMTP_*` | Почта Keycloak: установка и сброс пароля |
| `KEYCLOAK_EMAIL_THEME` | Тема писем Keycloak (NOT-01) для импорта realm: `compose.azure.yaml` задаёт `imbc`, `compose.yaml` — `keycloak` по умолчанию (образ без JAR темы). На существующем realm `emailTheme` выставляет `infrastructure/azure/sync-realm.py --email-theme` (по умолчанию `imbc`) при каждом выкате; из серверной `.env` значение не читается |
| `MAILPIT_UI_AUTH` | Пароль на интерфейс Mailpit |
| `ADMIN_ALLOWED_IPS` | IP/CIDR через пробел для Mailpit и Keycloak admin в Azure; без настройки разрешён только loopback |
| `MAILPIT_RELAY_CONFIG`, `MAILPIT_RELAY_ALL` | Конфигурация и автоматическая пересылка Mailpit в Azure-overlay; SMTP-секрет хранится отдельно на VM |
| `CLAMAV_HOST`, `CLAMAV_PORT` | clamd; пределы проверки — не переменные, а файл `infrastructure/clamav/clamd.conf` |
| `SEED_DEMO` | Демо-данные при миграции (только dev) |
| `ADATA_API_TOKEN` | Токен Adata (EXT-02, NFR-10): только сервис `worker`, только серверная `.env`; в Git, логи и вывод не попадает. Без значения чтение выключено — попытка `not_configured` |
| `ADATA_MONTHLY_LIMIT` | Наша граница квоты Adata за период (IMBC-07): по умолчанию 3000; на Azure-стенде 0 — чтение закрыто, владелец открывает его на одно чтение строкой `ADATA_MONTHLY_LIMIT=1` в серверной `.env` (порядок — `docs/deployment/azure-dev.md`, «Чтение Adata»); `0` — не запрашивать; больше 3000 — ошибка конфигурации, пустое значение — 3000 |

На `worker` никогда не включайте отладку запросов Node (`NODE_DEBUG=fetch`, `NODE_DEBUG=undici` или подписчик diagnostics-channel, например трассировку исходящих HTTP-запросов): она печатает в stderr адрес Adata вместе с токеном (EXT-02, NFR-10).

## 14. Качество и проверки

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm check:requirements                      # ID требований и карта этапов roadmap сверяются со спецификацией v1.3 (NFR-12)
node --test scripts/check-requirements.test.mjs
TEST_DATABASE_URL=postgres://postgres:<пароль>@127.0.0.1:<порт>/imbc_auth_test pnpm --filter @imbc/api test   # с интеграционными
docker compose config -q
docker run --rm --add-host web:127.0.0.1 --add-host api:127.0.0.1 --add-host keycloak:127.0.0.1 -v "$PWD/infrastructure/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" nginx:1.29-alpine nginx -t   # синтаксис nginx.conf (в CI — шаг «nginx -t for nginx.conf»)
bash infrastructure/azure/test/vm-deploy.test.sh   # скрипт развёртывания; не на Linux — в контейнере ubuntu:24.04
bash infrastructure/azure/test/setup-github-deploy.test.sh   # скрипт настройки конвейера с заглушками az и gh
```

Прогон ветки `feat/spec-v1.3-contracts` **12 ноября 2026 года** (коммит `74f1812` и документация поверх него), macOS, PostgreSQL 18.6 в Docker:

- `@imbc/contracts` — **87 тестов** в 2 файлах: БИН, нормализация названий, фильтры каталога с тиром, перечисления v1.3, матрица прав раздела 4 целиком, безопасный `returnTo`, стартовая страница роли и шлюз страниц по матрице.
- `@imbc/api` — **206 тестов** в 21 файле, из них **80 интеграционных на PostgreSQL 18** в 7 файлах: вход и сеансы (параллельные OTP и лимиты, истечение и отзыв, backchannel logout, смена пароля, отказ SMTP, транзакционная регистрация с pg-boss и компенсация IdP), миграции 0003 и 0004 и перенос данных v1.3 на базе прежней версии, seed и переименование демо-наблюдателя, каталог (порядок unresponsive, тир, дашборд), свой профиль, очередь SME, организации и аккаунты. HTTP-тесты проходят через настоящий `SessionGuard`: права ролей на каждом новом маршруте, отсутствие `focalPoint` у наблюдателя, `Cache-Control: no-store`. Без `TEST_DATABASE_URL` — 126 прошли, 80 пропущены.
- `@imbc/web` — **185 тестов Vitest** в 26 файлах (jsdom, Testing Library): маршруты и переходы по состоянию сеанса, экраны входа, оболочка по матрице прав, шлюз роли, каталог с тиром, страница компании, дашборд, профиль, очередь, аккаунты, языки и форматы, одинаковые ключи трёх файлов переводов, правила `web.conf`, dev-прокси.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm check:requirements`, `node --test scripts/check-requirements.test.mjs`, `docker compose config -q`, `vm-deploy.test.sh` и `setup-github-deploy.test.sh` проходят.
- Сборочный конвейер GitHub Actions на этой ветке не запускался: Actions на аккаунте владельца заблокирован (см. [конвейер развёртывания](docs/deployment/azure-dev.md#конвейер-развёртывания)).

Интеграционные API-тесты запускаются только при заданном `TEST_DATABASE_URL` с отдельной одноразовой БД **`imbc_auth_test`**: тестовый набор пересоздаёт её схемы. Все интеграционные файлы работают с одной и той же базой, поэтому при заданной переменной Vitest запускает файлы последовательно (`fileParallelism` в `apps/api/vitest.config.ts`); параллельный запуск нескольких наборов на одну базу недопустим. Без этой переменной интеграционные тесты пропускаются, и обычный `pnpm test` их выполнение не подтверждает; в CI отдельный шаг падает, если они пропущены. Внешние IdP/SMTP-вызовы в этих тестах подменены, поэтому доставка настоящего письма и весь браузерный путь проверяются отдельно.

Прогон ветки `feat/stage-1-accounts` **13 ноября 2026 года** (итоговая правка этапа 1 поверх `be77b11`), macOS, PostgreSQL 18 в Docker (`postgres:18-alpine`, одноразовая база `imbc_auth_test`, `TEST_DATABASE_URL=postgres://postgres:<пароль>@127.0.0.1:55432/imbc_auth_test`; файлы набора идут последовательно):

- `@imbc/contracts` — **100 тестов** в 2 файлах.
- `@imbc/api` — **485 прошли** в 39 файлах с базой, из них интеграционные — файлы `*.integration.test.ts`; без `TEST_DATABASE_URL` — 297 прошли, 188 пропущены. Новое в итоговой правке: `edge-proxy.test.ts` проверяет, что шаблон `location ~` / `~*` с `;`, `{` или `}` в `nginx.conf` заключён в кавычки, а `account-inactivity.integration.test.ts` — что отказ неактивному не ждёт выхода из IdP.
- `@imbc/web` — **240 тестов** в 29 файлах; кабинет администратора — `test/admin-accounts.test.tsx` (29): ящик IMBC, создание организации, приглашение, разделы по типу и строка о производителях без аккаунта, действия по состоянию аккаунта, смена роли и почты, диалоги без потери итога и «Сохранить» только при изменении, отметка major, перевод каждого кода ошибки, ADM-06 (в том числе запросы страницы: сеанс и список), клавиатура, kk и en.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm check:requirements` проходят. `nginx -t` для `infrastructure/nginx/nginx.conf` в `nginx:1.29-alpine` проходит. Сборочный конвейер на ветке не запускался (GitHub Actions заблокирован); на стенд ветка не выкачена.

Прогон ветки `feat/stage-2-foundation` **13 ноября 2026 года** (код — `b8cf0b1`, задачи 1–8 плана этапа; документы — коммит поверх него), macOS; что запускалось в этой работе и что взято из отчётов задач — названо у каждого числа:

- `@imbc/contracts` — **108 тестов** в 2 файлах (прогон 13.11.2026 на `b8cf0b1`).
- `@imbc/api` без `TEST_DATABASE_URL` — **517 прошли, 280 пропущены** в 55 файлах (прогон 13.11.2026 на `b8cf0b1`); **с PostgreSQL 18 (`postgres:18-alpine`, база `imbc_auth_test`, файлы идут последовательно) — 797 тестов в 55 файлах, все зелёные** — это прогон исполнителя задачи 7 на `37dfb3f`: после него `apps/api` не менялся (`git diff 37dfb3f..b8cf0b1` его не затрагивает), но набор с базой на `b8cf0b1` при подготовке документов не перезапускался. Новое этапа: миграции `0009` и `0010` на базе предыдущей версии с данными (`migration-stage2.integration.test.ts`), загрузчик справочников и seed (`reference-data.integration.test.ts`, `seed.integration.test.ts`), API справочников (`dictionaries.http.test.ts`, `dictionaries.integration.test.ts`: права по матрице, ведущие нули, параллельное удаление и вывод, поиск), файлы (`file-type.test.ts`, `upload.http.test.ts`, `zip-structure.test.ts`, `files.integration.test.ts`, `clamd.test.ts`, `object-storage.test.ts`: граница 25 МБ, подделанный тип, имя на казахском, файл до скана и чужой файл с записью в аудит), образец (`org-chart-sample.http.test.ts`, `org-chart-sample.integration.test.ts`), уведомления (`notifications.integration.test.ts`, `mail-messages.test.ts`, `notification-links.test.ts`, `notification-worker.test.ts`: одно письмо на адрес и событие, сбой SMTP посреди рассылки, параллельные повторы, наблюдатели, язык получателя), тема писем Keycloak (`keycloak-email-theme.test.ts`), пределы clamd и закрытый S3 (`edge-proxy.test.ts`).
- `@imbc/web` — **276 тестов** в 30 файлах (прогон 13.11.2026 на `b8cf0b1`); новое — `references.test.tsx` (35 тестов: экран справочников, образец, диалоги, директор без кнопок, kk, ru, en).
- `pnpm typecheck`, `pnpm lint`, `pnpm build` — без ошибок на `b8cf0b1` (прогон 13.11.2026; turbo взял результат из кеша), `pnpm check:requirements` — OK на коммите документов. `python3 infrastructure/azure/test/sync-realm.test.py` (12 тестов) и `bash infrastructure/azure/test/vm-deploy.test.sh` (75) — по отчёту задачи 7, при подготовке документов не перезапускались.
- Не проверено: сборка JAR темы писем в Docker и письма на трёх языках на живом Keycloak сделаны контроллером на локальном стенде (образы из `37dfb3f`), исполнитель задачи 7 Docker не запускал; на Azure этап не выкатывался; сборочный конвейер не запускался (GitHub Actions заблокирован).

**Проверки перехода web на Vite SPA** (ветка `feat/web-vite-spa`, 12.11.2026, до слияния):

- Образ `imbc/web` собран из этой ветки: процесс nginx работает от пользователя `nginx` (uid 101), в `/usr/share/nginx/html` только сборка Vite, `GET /50x.html` отдаёт `index.html` приложения.
- На локальном Compose-стенде ветки (`HTTP_PORT=8088`, nginx на `http://localhost:8088`; по умолчанию порт `8080`) проверено `curl`: `/`, `/catalog` и несуществующий адрес отвечают 200 с `index.html`, одним заголовком `Cache-Control: no-store` (edge второго не добавляет) и `Content-Security-Policy`; хешированный файл из `/assets/` — `Cache-Control: public, max-age=31536000, immutable`; отсутствующий файл в `/assets/` — 404; заголовки edge `X-Content-Type-Options`, `Referrer-Policy` и `X-Frame-Options` на месте; `GET /api/auth/login?returnTo=/catalog` отвечает 302 на `http://localhost:8088/kc/realms/imbc/…` — Keycloak на том же origin, PKCE S256.
- Проход в браузере: Chrome 156 на macOS и headless Chrome 157 с эмуляцией ширины 390 px, локальный стенд. Проверены вход (BFF → Keycloak → код из письма → ответственность → стартовая страница), каталог (фильтры из адреса, запрос в API равен адресу страницы, один запрос после ввода, «Назад»), смена языка без перезагрузки и её сохранение, прямое открытие /dashboard и /account, страница «не найдено», переход с плитки дашборда в каталог, выход, ограничение производителя страницей профиля, регистрация с адресом .local и письмо в Mailpit, вёрстка на 390 px без горизонтальной прокрутки и меню шторкой; нарушений Content-Security-Policy в консоли нет. Не проверены: копирование ссылки, экран ошибки при сбое загрузки чанка, сообщение о сбое старта, Safari и Firefox.

**Демо-экраны по ролям** (12.11.2026): шесть ролей пройдены в браузере на локальном стенде, собранном из тех же коммитов, что выкачены на Azure.

**Azure dev-стенд.** 13.11.2026 выкачен этап 1 (`306b58e`, [проверка выката](docs/deployment/verification-2026-11-13.md)). 12.11.2026 ветка перехода на v1.3 выкачена пять раз командой `deploy.sh redeploy` (последний — `8fe0fd4`), каждый раз с итогом `IMBC_DEPLOY_RESULT=ok`; первый выкат применил миграции 0003 и 0004 и перенос данных. Снаружи без входа проверены: readiness 200, закрытые маршруты 401, `Cache-Control: no-store`. Не проверены на стенде: вход под каждой ролью после этих выкатов, заголовки Caddy (HSTS, `Permissions-Policy`) для нового образа web.

Проверка 10.11.2026, до перехода на v1.3: на работающем стенде все семь демо-аккаунтов прошли пароль → `000000` → разрешённую стартовую страницу → выход (наблюдатель — под прежним адресом `spectator@spectator.local`). Проверены ограничения OTP, права ролей и отсутствие OTP-писем для этого списка; остальные аккаунты сохраняют почтовый режим. Ранее получение реального письма и личный вход подтвердил владелец. Также проверены публичный HTTPS и ограничения служебных страниц, в том числе при подмене forwarding-заголовков. Результаты и известное предупреждение мобильного Chrome — в [отчёте проверки](docs/deployment/verification-2026-11-10.md).

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
