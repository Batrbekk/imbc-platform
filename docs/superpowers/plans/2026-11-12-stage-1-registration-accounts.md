# Этап 1 — регистрация, организации, аккаунты — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** регистрация производителя идёт по v1.3 (три согласия, текущая NDA, без пароля; профиль Draft и принятие NDA появляются, когда задан пароль), администратор IMBC ведёт организации и аккаунты (организации операторов и наблюдателей, отметка major operator, приглашения, блокировка, смена роли и почты-логина, ящик IMBC), три месяца без входа делают аккаунт inactive, а релиз contract снимает переходное состояние v1.3.

**Architecture:** источник истины — PostgreSQL; Keycloak держит только учётные данные. Регистрация и приглашение — один поток `IdentityProvisioningService` (пользователь Keycloak → строки БД и задание письма в одной транзакции → компенсация). Установка пароля (событие Keycloak или, запасным путём, вход) вызывает `ManufacturerOnboardingService.onPasswordSet`: в одной транзакции создаются Draft-профиль, строка `nda_acceptance` из принятия, хранившегося у аккаунта, и единственная попытка чтения Adata. Действия администратора меняют БД и завершают сеансы BFF в своей транзакции, а Keycloak догоняет БД заданием `identity-sync`. Неактивность — суточное задание worker с управляемым временем по Asia/Almaty. Права — существующее действие `accounts.manage`; матрица не меняется.

**Tech Stack:** TypeScript, zod 4, NestJS 12, Drizzle ORM 0.45 / drizzle-kit, PostgreSQL 18, pg-boss 12, Keycloak Admin REST API, React 19 + Vite, TanStack Query, use-intl, shadcn/ui на Base UI (`base-nova`), vitest.

**Spec:** `docs/analyst/2026-11-11/specification-v1.3.md` — 3.1 (GEN-01, GEN-02, GEN-05, GEN-06), раздел 4 (строка «Accounts of all organisations», GEN-08), 5.1 (MAN-01…MAN-05), 5.4 (FC-02), 6.9 (ADM-01…ADM-06), 8.1 (AUTH-01, AUTH-06, AUTH-07), 8.2 (вводный абзац о ящике IMBC; NOT-01, NOT-19, NOT-23, NOT-24, NOT-26, NOT-31 — правило календарных месяцев), 9.1 (записи «Organisation», «User account», «NDA version and acceptance»), DATA-08, AUD-01, NFR-06. DBML `docs/analyst/2026-11-11/imbc-platform.dbml`: `organization`, `user_account`, `nda_version`, `nda_acceptance`, `manufacturer_profile.registered_at`, `heard_about_us`. `docs/development-roadmap.md` — §3, §4.1 (Р-2, Р-5), §4.2, «Этап 1», §7, §9 (вопросы 3–5, 24, 31). `docs/handoff/2026-11-11-context.md` — §6, §8 шаг 2б.

## Нумерация миграций

На стенде (ветка `demo/prototype-cabinets`, `8c748ea`, выкат 12.11.2026) применены `0000`–`0005`. Этап добавляет три миграции, которые уйдут одним выкатом и одной транзакцией migrate: **`0006_spec_v13_contract`** (рукописная, задача 1) — снятие переходного состояния v1.3 и пустых таблиц каркаса; **`0007_accounts_registration`** (генерируется, задача 2) — expand этапа; **`0008_reference_organizations`** (рукописная, задача 2) — данные: организация IMBC, NCOC, TCO, KPO. Contract идёт раньше expand: частичные индексы 0007 ссылаются на значения пересоздаваемых в 0006 типов `role` и `organization_type`, а `ALTER COLUMN … TYPE` в 0006 не прошёл бы при существующих зависимых индексах. Документы уже называют contract `0006` (`docs/development-roadmap.md:190`, `docs/handoff/2026-11-11-context.md:127`, `README.md:204`, `docs/deployment/azure-dev.md:208`) — номер не меняется; эти строки и `README.md:205`, `381`, `406` задача 1 переписывает из «будет» в «сделано». Исполненные планы `docs/superpowers/plans/2026-11-1*` — история, не правятся.

## Расхождения и противоречия (прочитать до задач)

| № | Где расходятся | Решение плана (действует до решения владельца или Абая) | Цена, если неверно |
|---|---|---|---|
| 1 | Код создаёт Draft при регистрации (`registration.controller.ts:104`). Спецификация: таблица 6.3 — «Created at registration or migration», MAN-03 и NOT-23 — профиль появляется, когда задан пароль; DBML `registered_at` — «Set when the password is set». | По MAN-03, NOT-23 и DBML: профиль — при установке пароля (задача 3). Draft-профили, созданные на стенде прежним потоком, остаются; чтение Adata у них по-прежнему ставит установка пароля. | Малая: точка вызова `onPasswordSet` переносится обратно в регистрацию. |
| 2 | `nda_acceptance.profile_id not null` (DBML), а галочка — при регистрации, до профиля (вопрос 4, roadmap §4.2). | Принятие хранится у аккаунта: `user_accounts.registration_nda_version_id`, `registration_nda_accepted_at`, `registration_ip`; при создании профиля переносится в `nda_acceptance` (время — регистрации, версия, IP запроса регистрации) и колонки очищаются. Туда же — `registration_heard_about_us` (у DBML это колонка профиля). | Средняя: если Абай даст отдельную таблицу, колонки переезжают одной парой expand/contract. |
| 3 | Р-5: первая NDA «загружается миграцией из текста IMBC», текста нет (§7); версии NDA — Release 2 (ADM-10, вопрос 5). | Версия 1 — явная трёхъязычная заглушка, её кладёт **seed** (только при `SEED_DEMO=true`), а не миграция: миграция занесла бы заглушку и в продакшен. Регистрация без текущей версии закрыта: `503 nda_unavailable`. Настоящий текст IMBC придёт миграцией как следующая версия (`version_number = max + 1`, `is_current` переключается в той же миграции). Экрана версий нет. | Малая. |
| 4 | DBML `nda_version.published_by not null`; у версии, загруженной релизом, публикующего администратора нет. | `published_by` допускает null («загружено релизом», Р-5). Seed пишет id `admin@imbc.local`. | Малая. |
| 5 | Тексты условий платформы и политики персональных данных: в DBML только `platform_terms_accepted_at`, `personal_data_accepted_at`, версий нет; текстов нет. | Заглушки в `apps/web/messages/*.json` (LANG-02), принятие — две метки времени DBML. Какой текст принят, видно по дате и истории Git. Вопрос Абаю: нужны ли версии этих двух текстов. | Малая: версия — ещё одна колонка expand. |
| 6 | MAN-01 перечисляет три согласия («platform terms and personal-data policy», «current NDA»); форма — одна галочка. | Три отдельные галочки: две метки DBML и принятие NDA. | Малая. |
| 7 | Код: «Как вы узнали о нас» необязательно; MAN-01 перечисляет ответ среди того, с чем производитель регистрируется. | Обязательное свободное поле, 1–500 символов после `trim`. | Малая. |
| 8 | Р-2 (по умолчанию — физические имена DBML, таблицы с данными — через совместимое представление) против `organizations`, `user_accounts`, `full_name`, `locale`, типов `role`, `locale` (DBML: `organization`, `user_account`, `name`, `language`, `account_role`, `language_code`). | Новые таблицы и колонки — имена DBML (`nda_version`, `nda_acceptance`, `notification_mailbox`, `platform_terms_accepted_at`…). Существующие таблицы этап **не** переименовывает: PostgreSQL не меняет тип колонки, от которой зависит представление, а 0006 меняет типы `user_accounts.role` и `organizations.type` в этом же выкате; к тому же переименование задевает все модули. Отдельная пара expand/contract после этапа; Р-2 владелец не подтверждал. | Средняя: позже переименование обойдётся одной парой миграций. |
| 9 | Каркас уже содержит пустые `nda_versions` и `nda_acceptances` (`schema/exchange.ts:58–88`) другой формы: три колонки текста, ФИО и должность принявшего — DBML прямо исключает «The accepting person's name and position». Как и `external_checks` (Adata). | По Р-2: 0006 удаляет пустые `nda_versions`, `nda_acceptances`, `external_checks` и тип `check_status` (с проверкой, что таблицы пусты); 0007 создаёт `nda_version`, `nda_acceptance` по DBML. Ни одна версия приложения эти таблицы не читает. | Малая. |
| 10 | DBML: «Partial unique index: one row where the organisation type is manufacturer» — частичный индекс не видит колонку другой таблицы. | `user_accounts_manufacturer_org_uq` — уникальный `(organization_id) where role = 'manufacturer'`; роль `manufacturer` создаёт только регистрация, и только в новой организации-производителе; приглашение в организацию производителя запрещено сервисом (задача 5). | Малая: обход возможен только прямой записью в БД. |
| 11 | AUTH-07 «three months» без правила подсчёта; DBML без даты перехода в inactive; код сравнивает время пароля с `updated_at` (`session.service.ts:429`), который сдвигает любая правка аккаунта. | Три календарных месяца по Asia/Almaty от дня последнего входа (у `active`, ни разу не входившего, — от `created_at`) по правилу NOT-31: тот же день месяца или последний день месяца, если такого дня нет. Колонка `inactive_since` (не DBML) — момент перехода; возврат — пароль, заданный не раньше `inactive_since`. `invited` и `blocked` не становятся inactive. Решение 13.11.2026: отсчёт трёх месяцев идёт от более поздней даты из последнего входа и последней смены пароля (`greatest(coalesce(last_sign_in_at, created_at), credentials_changed_at)`). | Малая: правило — одна SQL-функция и её тесты. |
| 12 | Код отказывает во входе inactive-аккаунту до опроса событий (`auth.controller.ts:134`): после сброса пароля человек получает ошибку, пока worker не прочтёт событие (до минуты). | Вход inactive-аккаунта спрашивает у Keycloak время пароля (`GET /users/{id}/credentials`); пароль не старше `inactive_since` — аккаунт снова active и вход продолжается. Решение 13.11.2026: вход со старым паролем отклоняется — путь назад только ссылка сброса, обязательное действие `UPDATE_PASSWORD` пользователю Keycloak не ставится. | Малая. |
| 13 | ADM-05 меняет почту-логин производителя, но не говорит, что с подтверждением адреса, сеансами и письмами. | Keycloak: новый email, `emailVerified: true` (адрес вносит IMBC; при `registrationEmailAsUsername` username следует за ним); сеансы BFF и доверенные устройства удаляются — следующий вход пришлёт NOT-02 на новый адрес, это и есть проверка ящика. Аккаунту `invited` (пароль ещё не задан, частый случай — опечатка при регистрации) NOT-01 уходит на новый адрес. На прежний адрес письма нет. Только аккаунты роли `manufacturer`. | Средняя: если нужно письмо на прежний адрес — новый код письма (этап 2). |
| 14 | AUTH-06 говорит о смене роли, ADM-01 задаёт роль при приглашении; какие роли меняются — нигде. | Меняется только роль аккаунта организации IMBC между `expert`, `administrator`, `director`; у оператора, наблюдателя и производителя роль задана типом организации (`409 role_fixed`). | Малая. |
| 15 | В DBML одно `state`; куда возвращается аккаунт после разблокировки — не сказано. | Разблокировка: не входил (`last_sign_in_at is null`) → `invited`, иначе `active`; если три месяца уже прошли, ближайший запуск `account-inactivity` переведёт в `inactive` и пришлёт сброс. Решение 13.11.2026: разблокировка аккаунта с заданным `inactive_since` возвращает `inactive`. | Малая. |
| 16 | GEN-05: NCOC, TCO, KPO — major operators; ни одной из них в данных нет. Ящик IMBC хранится у организации IMBC (DBML), а её создаёт только seed. Администратор создаёт только операторов и наблюдателей (ADM-03). | 0008 вставляет организацию `IMBC` (тип `imbc`), если её нет, и `NCOC`, `TCO`, `KPO` (тип `operator`, `is_major_operator = true`), если организации-оператора с таким именем нет, и ставит отметку существующим. Организация IMBC одна: `organizations_imbc_uq`. На стенде демо-оператор тоже major (seed) — major operators там четыре. | Малая: полные названия операторов админ впишет сам после решения IMBC — сейчас переименования нет (см. «Чего этап не делает»). |
| 17 | Публичный путь `/kc/realms/imbc/account` (консоль аккаунта Keycloak) открыт через Caddy и nginx: стандартный интерфейс IdP (запрещён `AGENTS.md`) и, при правах профиля пользователя Keycloak, способ сменить свою почту в обход MAN-05. | Закрыть путь `^/kc/realms/[^/]+/account(/|$)` ответом 404 в `infrastructure/azure/Caddyfile` и `infrastructure/nginx/nginx.conf` (задача 6). | Малая. |
| 18 | Действия над собой и одновременная правка двумя администраторами: спецификация молчит. | Себя заблокировать и сменить себе роль нельзя (`409 self_action`). Транзакция действия блокирует строки исполнителя и цели в порядке id и проверяет, что исполнитель всё ещё `active` `administrator` (иначе 403): два администратора не могут понизить друг друга одновременно. | Малая. |
| 19 | Установка пароля у аккаунта, который IMBC уже заблокировал. | `onPasswordSet` пропускает `blocked`: ни профиля, ни квоты Adata; после разблокировки профиль создаст первый вход. | Малая. |
| 20 | Аккаунты seed не привязаны к субъекту Keycloak до первого входа (`idp_subject is null`, `session.service.ts:41`). | Смена почты и повтор приглашения у такого аккаунта — `409 identity_not_bound`; блокировка и роль работают (Keycloak догонит после привязки). | Малая. |
| 21 | Вопрос 24 (NDA платформы против NDA сайта IMBC), вопрос 31 (термин «аккаунт» / «учётная запись»). | Записывается принятие текста платформы (бриф v0.5, §«Open»). Термины меню не меняются; новые казахские тексты — в список вычитки handoff §10 (LANG-03). | Малая. |
| 22 | Регистрации стенда до этапа приняли одну галочку и NDA не принимали. | Строк `nda_acceptance` для них нет; принятие при первом входе — путь мигрированного производителя (FC-02), этап 8. Разделы, которые NDA закрывает, — Release 2. | Нет. |

## Права, аудит, уведомления этапа

**Права.** Новых ключей матрицы нет. Раздел 4: строка «Accounts of all organisations» — IMBC administrator «yes», остальные «—»; GEN-03 добавляет к ней организации операторов и наблюдателей; ящик IMBC — запись организации IMBC. Все новые маршруты администратора — `@Can('accounts.manage')` (у матрицы — только `administrator`); `POLICY_MATRIX` и снимок `SECTION_4` в `packages/contracts/test/contracts.test.ts` не меняются. Тесты прав генерируются из матрицы: для каждого нового маршрута разрешённые роли — `ROLES.filter((r) => can(r, 'accounts.manage'))`, отклонённые — остальные (403, `outcome: 'denied'` в аудите, сервис не вызван), без сеанса — 401, изменяющий запрос с чужого Origin — `403 bad_origin`. Маршруты регистрации публичны.

**Аудит (AUD-01).** Каждое действие — запись в той же транзакции. `isAccountEvent: true` (AUD-03: администратор видит события аккаунтов — экран на этапе 7): `registration.created` (diff `{ ndaVersion }`), `organization.created`, `organization.major_operator_changed`, `organization.mailbox_changed` (`{ from, to }`), `account.invited` (`{ email, role, organizationId }`), `account.invitation_resent`, `account.blocked` (`{ from }`), `account.unblocked` (`{ to }`), `account.role_changed` (`{ from, to }`), `account.email_changed` (`{ from, to }`), `account.became_inactive`, `account.reactivated` (`{ via: 'sign_in' | 'password_event' }`). Без `isAccountEvent`: `profile.created` (`{ origin }`), `nda.accepted` (`{ version }`). IP — только колонка `audit_entries.ip` запроса; в `diff` IP не пишется. Повтор действия без изменения («заблокировать заблокированного») записи не создаёт.

**Уведомления.** Всё в этом этапе — NOT-01 через `execute-actions-email` Keycloak (тексты темы Keycloak, язык — атрибут `locale` пользователя), постановка — pg-boss с `singletonKey`.
- NOT-23: регистрация — NOT-01 только на почту компании (уже так); установка пароля создаёт профиль и **писем не шлёт** — тест задачи 3.
- NOT-24: приглашение IMBC, оператора, наблюдателя — NOT-01 на почту приглашённого; языка в форме ADM-01 нет → `kk` (NOT-19, «Kazakh if they have not chosen one»).
- NOT-26: NOT-02 и NOT-03 уже отправляются по правилу (этап А, тесты `auth.integration.test.ts`); переход в inactive шлёт NOT-01 ссылкой сброса (задача 7); статус актуальности не меняется. NOT-17 — этап 9.
- Ждёт этапа 2: журнал `notification` и правила NOT-18…NOT-21, тексты NOT-01 в языковых файлах, письма на ящик IMBC (по-казахски). Этап только хранит ящик.

## Global Constraints

- Worktree `.claude/worktrees/stage-1`, ветка `feat/stage-1-accounts`. Задачи строго по порядку 1 → 8, один коммит на задачу, в сообщении — ID требований. Без `git push`, без деплоя, без `docker compose up`.
- Конец каждой задачи: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; набор API с базой — `TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/imbc_auth_test pnpm --filter @imbc/api test` (тестовая поддержка принимает только имя `imbc_auth_test`; **этой базой пользуется один исполнитель в момент времени**); `pnpm check:requirements`. Если задача трогает Compose — `docker compose config -q` (только с `-q`).
- Миграции: разрушающие операции — только в 0006 и только после проверки предусловия в той же миграции. 0007 — только `CREATE`/`ADD COLUMN` (nullable или с default)/`ADD CONSTRAINT`/`CREATE INDEX`; 0008 — только `INSERT … WHERE NOT EXISTS` и `UPDATE` отметки. Предыдущая версия приложения (`8c748ea` на стенде — ветка `demo/prototype-cabinets`, в неё влит `20d0431`) работает на схеме после 0008 (NFR-06). После каждой миграции `pnpm --filter @imbc/api db:generate` не создаёт нового файла.
- Значения перечислений в SQL — ровно как в `@imbc/contracts`: `ROLES = ['manufacturer','expert','administrator','director','operator','observer']`, `ORGANIZATION_TYPES = ['manufacturer','operator','observer','imbc']`, `UPDATE_STATUSES = ['active','outdated','unresponsive']`. `account_state` (`invited, active, inactive, blocked`) не трогать: inactive — состояние аккаунта (AUTH-07), unresponsive — профиля.
- Права — сервер, `accounts.manage`; интерфейс только прячет (GEN-08). Матрица не меняется (см. «Права»).
- БД — источник истины; Keycloak — только через `KeycloakAdminService`. Сбой Keycloak после фиксации не откатывает решение администратора: `identity-sync` повторяется. Вход проверяет состояние в БД при каждом запросе (`SessionService.resolve`).
- Срок ссылки NOT-01 — 72 часа (AUTH-01, `PASSWORD_LINK_LIFESPAN_S`). Время — Asia/Almaty (DATA-08); код, зависящий от «сейчас», принимает `now`/`at` параметром, тесты — фиксированные даты.
- Персональные данные (IP регистрации, почта, ответ «Как вы узнали о нас») не попадают в логи и тексты ошибок; ответ «Как вы узнали о нас» не отдаётся ни одному маршруту этапа (MAN-01). Администратор не получает БИН и полей профиля (ADM-06).
- Adata не вызывается ни одним тестом: только заглушка `test/support/adata-stub.ts`; URL и токен Adata не в логах (`CLAUDE.md`).
- Почта в новых тестах — адреса `*.local` (`AGENTS.md`).
- Тексты — `apps/web/messages/{en,kk,ru}.json`, одинаковые ключи, английский — источник; даты и числа — `useFormat`; компоненты — только из `src/components/ui`, новые — `pnpm dlx shadcn@4.23.0 add <name>` из `apps/web` после просмотра в MCP shadcn (`apps/web/AGENTS.md`). Новые казахские строки — в список вычитки `docs/handoff/2026-11-11-context.md` §10 (LANG-03).
- Термины: observer, unresponsive (профиль), inactive (аккаунт), SME, STR, KTRE, e-Ondiris. ID требований в коде, тестах, коммитах — только существующие в v1.3 (`pnpm check:requirements`); при правке строки со старым ID (`AUTH-30` в `queues.ts`) — `node scripts/check-requirements.mjs --update-baseline`.
- Не редактировать `docs/analyst/**`, `apps/api/drizzle/0000`–`0005*`, раздел 11 roadmap; не читать `.env*`, кроме `.env.example`.

## Review Focus

1. **Пароль задан дважды, событие повторено, событие и вход одновременно, позже — сброс пароля.** Ожидание: один профиль, одна строка `nda_acceptance`, одна попытка `profile_created`; регистрация без пароля — ни профиля, ни чтения. Тест — задача 3, «пароль дважды…».
2. **Заблокированный (или сменивший роль) пользователь с открытым сеансом, посреди ввода кода или входа.** Ожидание: следующий запрос — без сеанса, код и доверие устройства не выдаются, callback отказывает. Тест — задача 6, «заблокированный с открытым сеансом…».
3. **Два администратора действуют на один аккаунт или друг на друга одновременно.** Ожидание: действия применяются по очереди, без потерянного `auth_version`; взаимное понижение — ровно одно. Тест — задача 6, «два администратора одновременно…».
4. **Приглашение отправлено дважды, повторено, истекло; адрес занят только в Keycloak.** Ожидание: один аккаунт, понятный 409, лишний пользователь Keycloak удалён, повтор — одно задание. Тесты — задача 5, «одно приглашение дважды параллельно…», «повтор приглашения…».
5. **Две регистрации с одним БИН одновременно; форма со старой версией NDA; второй аккаунт организации-производителя.** Ожидание: один успех и `409 bin_exists`; `409 nda_version_changed` без пользователя Keycloak; 23505 на прямой вставке. Тесты — задача 3 (существующий «simultaneous duplicate BIN» и «устаревшая версия NDA…»), задача 2 («второй аккаунт…»).

---

### Task 1: релиз contract перехода на v1.3 — миграция 0006 и удаление переходного кода (NFR-06, UPD-06, GEN-06)

**Files:**
- Create: `apps/api/drizzle/0006_spec_v13_contract.sql`, `drizzle/meta/0006_snapshot.json`, запись журнала — `pnpm --filter @imbc/api exec drizzle-kit generate --custom --name spec_v13_contract`.
- Delete: `apps/api/src/database/backfill.ts`.
- Modify: `apps/api/src/database/migrate.ts` (вызов `backfillSpecV13` и строка «Перенос v1.3»); `apps/api/src/config/env.ts:21–22` (псевдоним `spectator`); `apps/api/src/database/seed.ts:33, 264–270` (`OBSERVER_EMAIL.legacy` и `UPDATE`); `apps/api/src/database/schema/records.ts:71–88` (`externalChecks`), `schema/enums.ts` (`checkStatus`), `schema/exchange.ts:58–88` (`ndaVersions`, `ndaAcceptances`), `schema/index.ts` (их экспорт); `infrastructure/azure/sync-realm.py` (`LEGACY_DEMO_USERS`, `legacy_user_renames`, переименование, строки печати).
- Test: `apps/api/test/migration-v13.integration.test.ts`, `seed.integration.test.ts`, `development-otp.test.ts`.
- Docs: `docs/deployment/azure-dev.md` (раздел «Переход на спецификацию v1.3», 206–305), `docs/handoff/2026-11-11-context.md` §4 (строка 49), §8 шаг 2б (126–130), `README.md:204, 381, 406`, `docs/development-roadmap.md:190`.

**Interfaces:**
- Consumes: —
- Produces: в БД нет значений `spectator` (`role`, `organization_type`) и `inactive` (`update_status`), нет таблиц `external_checks`, `nda_versions`, `nda_acceptances` и типа `check_status`; TS-схема их тоже не знает. `migrateThrough(pool, '0005_adata_prefill')` — последняя база «до contract» для тестов; `migrateThrough(pool, '0006_spec_v13_contract')` — база задачи 2.

SQL `0006` (тело задано: проверка предусловия до любой правки; разделители `--> statement-breakpoint` между операторами):

```sql
DO $$ DECLARE n bigint; BEGIN
  SELECT (SELECT count(*) FROM organizations WHERE type::text = 'spectator')
       + (SELECT count(*) FROM user_accounts WHERE role::text = 'spectator')
       + (SELECT count(*) FROM manufacturer_profiles WHERE update_status::text = 'inactive')
       + (SELECT count(*) FROM catalog_visible WHERE update_status::text = 'inactive') INTO n;
  IF n > 0 THEN RAISE EXCEPTION 'spec v1.3 contract: % rows still hold spectator or inactive', n; END IF;
  IF EXISTS (SELECT 1 FROM external_checks) OR EXISTS (SELECT 1 FROM nda_acceptances) OR EXISTS (SELECT 1 FROM nda_versions)
    THEN RAISE EXCEPTION 'spec v1.3 contract: skeleton tables external_checks, nda_versions, nda_acceptances are not empty'; END IF;
END $$;
ALTER TYPE "public"."role" RENAME TO "role_legacy";
CREATE TYPE "public"."role" AS ENUM('manufacturer','expert','administrator','director','operator','observer');
ALTER TABLE "user_accounts" ALTER COLUMN "role" TYPE "public"."role" USING "role"::text::"public"."role";
DROP TYPE "public"."role_legacy";
-- то же для organization_type ('manufacturer','operator','observer','imbc') → organizations.type
-- и для update_status ('active','outdated','unresponsive') → manufacturer_profiles.update_status, catalog_visible.update_status
DROP TABLE "external_checks"; DROP TYPE "public"."check_status";
DROP TABLE "nda_acceptances"; DROP TABLE "nda_versions";
```

- [ ] **Шаг 1. Тесты (сначала).** `migration-v13.integration.test.ts`: в блоках «0003: expand» и «0004» каждое `migrateThrough(pool)` после вставки строк со старыми значениями → `migrateThrough(pool, '0005_adata_prefill')`; блоки «перенос данных», «повторный запуск» и тест «чистой базе перенос не нужен» удаляются вместе с `backfill.ts`. Новый `describe('0006: contract')`:
  - «0006 на базе 0005 с данными v1.3: в role, organization_type, update_status нет spectator и inactive, account_state сохраняет inactive (AUTH-07); строки и id целы» — `enum_range(null::role)::text = '{manufacturer,expert,administrator,director,operator,observer}'`, аналогично `organization_type` = `{manufacturer,operator,observer,imbc}`, `update_status` = `{active,outdated,unresponsive}`, `account_state` = `{invited,active,inactive,blocked}`; id организации, аккаунта и профиля до и после совпадают;
  - «0006 удаляет пустые таблицы каркаса» — `to_regclass('external_checks')`, `'nda_versions'`, `'nda_acceptances'` — `null`; `to_regtype('check_status')` — `null`;
  - `it.each` по четырём колонкам: «0006 останавливается, если осталось прежнее значение: %s» — база `0005` + одна строка с `spectator`/`inactive` (значения ещё есть в типах), `migrateThrough(pool)` отклоняется с текстом `spec v1.3 contract`, `enum_range(null::role)` по-прежнему содержит `spectator` (вся пачка миграций откатилась);
  - «0006 останавливается на непустой таблице каркаса» — строка в `nda_versions` → отказ, таблица на месте;
  - «после 0006 значение v1.3 пишется, прежнее — 22P02» — `insert … role 'observer'` проходит, `'spectator'` — `code === '22P02'`.
  `development-otp.test.ts`: тест «accepts the legacy spectator role name…» заменить на «прежнее имя роли spectator в DEV_FIXED_OTP_ACCOUNTS — ошибка конфигурации при старте» (разбор env бросает; в тексте ошибки нет UUID аккаунта). `seed.integration.test.ts`: три теста переименования (`:49`, `:66`, `:81`) удалить; «повторный запуск не создаёт дублей» остаётся.
- [ ] **Шаг 2.** `TEST_DATABASE_URL=… pnpm --filter @imbc/api exec vitest run test/migration-v13.integration.test.ts test/development-otp.test.ts` — новые тесты падают (нет 0006, псевдоним работает).
- [ ] **Шаг 3. Реализация.** Удалить из TS-схемы `externalChecks`, `checkStatus`, `ndaVersions`, `ndaAcceptances`; `drizzle-kit generate --custom --name spec_v13_contract`; вписать SQL выше. Затем `pnpm --filter @imbc/api db:generate` должен сообщить, что изменений нет; если он предлагает `DROP` этих таблиц — снимок `--custom` скопировал прежний: удалить из `0006_snapshot.json` ключи `public.external_checks`, `public.nda_versions`, `public.nda_acceptances` (`tables`) и `public.check_status` (`enums`) и повторить, пока новый файл не создаётся. Удалить `backfill.ts` и его вызов, псевдоним в `env.ts`, переименование в `seed.ts`, `LEGACY_DEMO_USERS` с функцией и веткой переименования в `sync-realm.py` (итоговая строка печати — без «legacy demo users»); `python3 -m py_compile infrastructure/azure/sync-realm.py`; `bash infrastructure/azure/test/vm-deploy.test.sh`.
- [ ] **Шаг 4. Документация.** Runbook, раздел «Переход на спецификацию v1.3»: (а) «Что делает выкат» — перенос данных и переименование больше не выполняются; (б) новый подраздел «Релиз contract (0006)» — **до выката**: SQL-проверка (четыре счётчика из «Проверки после выката» и `select count(*) from external_checks union all … nda_versions union all … nda_acceptances`) — все `0`; `sudo grep -c '"role":"spectator"' .env` — `0` (иначе заменить на `"role":"observer"`: без псевдонима API не стартует); резервная копия `sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres pg_dump -U imbc -d imbc -Fc > /home/imbc/backup-before-0006.dump`; (в) «Откат»: после 0006 код откатывается на любой коммит v1.3 начиная с `851660b` обычным порядком — его код не пишет удалённых значений, `backfillSpecV13` сравнивает текст, Drizzle не применяет миграций старше последней; откат на версию до v1.3 (`d6ea422`) после 0006 — только восстановлением копии `pg_restore --clean`, подраздел текущего отката помечается «только до выката 0006». README:204 — «переход завершён релизом contract `0006`»; `README.md:381, 406`, handoff §4 и §8 2б, roadmap:190 — «сделано», без описания переименования как действующего.
- [ ] **Шаг 5.** Полная проверка (Global Constraints); коммит `Релиз contract v1.3: миграция 0006 убирает spectator и inactive, пустые таблицы каркаса и переходный код (NFR-06, UPD-06, GEN-06)`.

---

### Task 2: модель данных этапа — 0007 expand и 0008 данные организаций (GEN-01, GEN-05, MAN-01, FC-02, AUTH-07, NFR-06)

**Files:**
- Modify: `apps/api/src/database/schema/access.ts` (колонки `organizations`, `userAccounts`, новая `ndaVersion`), `schema/profiles.ts` (новая `ndaAcceptance`), `schema/index.ts` (экспорт).
- Create: `apps/api/drizzle/0007_accounts_registration.sql` (+снимок) — `pnpm --filter @imbc/api db:generate --name accounts_registration`; `apps/api/drizzle/0008_reference_organizations.sql` (+снимок) — `drizzle-kit generate --custom --name reference_organizations`.
- Modify: `apps/api/src/database/migrate.ts` (права на `nda_acceptance`), `apps/api/src/database/seed.ts` (NDA версии 1).
- Test: `apps/api/test/migration-stage1.integration.test.ts` (новый), `seed.integration.test.ts`, `accounts.integration.test.ts` (число и порядок организаций).
- Docs: `README.md` §6 (строки `0006`, `0007`, `0008`; роль `imbc_app` без UPDATE/DELETE на `nda_acceptance`).

**Interfaces:**
- Consumes: база после 0006 (задача 1).
- Produces — TS-имена (Drizzle, `casing: 'snake_case'`) и колонки:

| Таблица | Колонки (новые) | Ограничения | Основание |
|---|---|---|---|
| `organizations` | `notificationMailbox` text null | check `organizations_mailbox_imbc_ck`: `notification_mailbox is null or type = 'imbc'`; unique `organizations_imbc_uq (type) where type = 'imbc'`; unique `organizations_name_uq (type, lower(name)) where bin is null` | DBML `notification_mailbox`; одна организация IMBC; дубль оператора/наблюдателя (ADM-03) |
| `user_accounts` | `platformTermsAcceptedAt`, `personalDataAcceptedAt` timestamptz null (DBML); `registrationNdaVersionId` uuid null → `nda_version.id`; `registrationNdaAcceptedAt` timestamptz null; `registrationIp` inet null; `registrationHeardAboutUs` text null (roadmap §4.2, расхождение 2); `inactiveSince` timestamptz null (расхождение 11) | check `user_accounts_registration_nda_ck`: три колонки `registration_nda_*`/`registration_ip` либо все null, либо все не null; unique `user_accounts_manufacturer_org_uq (organization_id) where role = 'manufacturer'` | GEN-01, MAN-01, FC-02, AUTH-07 |
| `nda_version` (DBML) — `ndaVersion` в `access.ts` | `id` uuid pk `uuidv7()`; `versionNumber` integer not null; `body` text not null; `publishedAt` timestamptz not null default now(); `publishedBy` uuid null → `user_accounts.id` (расхождение 4); `isCurrent` boolean not null default false | unique `nda_version_number_uq (version_number)`; unique `nda_version_current_uq (is_current) where is_current`; check `version_number > 0` | Р-5, FC-02 |
| `nda_acceptance` (DBML) — `ndaAcceptance` в `profiles.ts` | `id`; `profileId` uuid not null → `manufacturer_profiles.id`; `ndaVersionId` uuid not null → `nda_version.id`; `acceptedAt` timestamptz not null; `ipAddress` text not null | unique `nda_acceptance_uq (profile_id, nda_version_id)` | FC-02; append-only (DBML) |

Взаимные ссылки `user_accounts` ↔ `nda_version` в одном файле — `.references((): AnyPgColumn => ndaVersion.id)`. Комментарии в схеме называют отступления от DBML и их основание.

SQL `0008` (тело задано):

```sql
INSERT INTO organizations (type, name) SELECT 'imbc', 'IMBC' WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE type = 'imbc');
INSERT INTO organizations (type, name, is_major_operator)
  SELECT 'operator', v.name, true FROM (VALUES ('NCOC'), ('TCO'), ('KPO')) AS v(name)
  WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o.type = 'operator' AND o.bin IS NULL AND lower(o.name) = lower(v.name));
UPDATE organizations SET is_major_operator = true
  WHERE type = 'operator' AND bin IS NULL AND lower(name) IN ('ncoc', 'tco', 'kpo') AND NOT is_major_operator;
```

Seed: после вставки `PEOPLE`, если в `nda_version` нет строк, — `{ versionNumber: 1, body: NDA_PLACEHOLDER_BODY, isCurrent: true, publishedBy: <id admin@imbc.local> }`. `NDA_PLACEHOLDER_BODY` — три абзаца через пустую строку (точный текст):
`УАҚЫТША МӘТІН — ЗАҢДЫҚ ҚҰЖАТ ЕМЕС. Платформаның құпияны жария етпеу туралы келісімінің (NDA) мәтінін IMBC ұсынады. Бұл мәтін тек сынақ стендіне арналған, оған сүйенуге болмайды.` / `ВРЕМЕННЫЙ ТЕКСТ — НЕ ЮРИДИЧЕСКИЙ ДОКУМЕНТ. Текст соглашения о неразглашении (NDA) платформы предоставит IMBC. Этот текст существует только для тестового стенда, полагаться на него нельзя.` / `PLACEHOLDER — NOT A LEGAL TEXT. IMBC will provide the text of the platform non-disclosure agreement (NDA). This text exists only for the test environment and must not be relied on.`

`migrate.ts`: в блоке `DB_APP_ROLE` добавить `REVOKE UPDATE, DELETE, TRUNCATE ON nda_acceptance FROM ${role}` (append-only, DBML).

- [ ] **Шаг 1. Тесты (сначала).** `migration-stage1.integration.test.ts` (PostgreSQL 18):
  - «0007 и 0008 — expand: база 0006 с данными предыдущей версии мигрирует, строки целы; запись предыдущей версии проходит (NFR-06)» — `migrateThrough(pool, '0006_spec_v13_contract')`, вставка SQL-ем организации-производителя, аккаунта (без новых колонок) и профиля, `migrateThrough(pool)`, затем ещё одна такая же регистрация SQL-ем без новых колонок проходит;
  - «в 0007 нет DROP, RENAME, SET NOT NULL и ALTER TYPE» — чтение файла, регулярные выражения;
  - **«второй аккаунт с ролью manufacturer в одной организации — 23505 user_accounts_manufacturer_org_uq; у оператора аккаунтов сколько угодно (GEN-01, GEN-02)»**;
  - «вторая организация imbc, второй оператор с тем же именем без учёта регистра, вторая текущая NDA, второе принятие той же версии профилем — 23505; два производителя с одним названием — можно»;
  - «ящик только у организации IMBC; принятие NDA у аккаунта — всё или ничего — 23514»;
  - «0008: одна IMBC и NCOC, TCO, KPO с отметкой major (GEN-05); существующая IMBC не дублируется; повторный прогон SQL 0008 ничего не добавляет» — тело файла, разбитое по `--> statement-breakpoint`, выполняется ещё раз через `pool.query`; существующий оператор `ncoc` без отметки получает её.
  `seed.integration.test.ts`: «seed: текущая NDA — версия 1, три абзаца заглушки (kk, ru, en), опубликовал admin@imbc.local; повторный запуск не создаёт вторую версию (FC-02, Р-5)». `accounts.integration.test.ts`: «18 организаций, 6 аккаунтов» (было 15: плюс NCOC, TCO, KPO; IMBC из 0008 seed находит по имени), порядок операторов — по сортировке базы, как в существующем тесте.
- [ ] **Шаг 2.** Прогон этих файлов — падают.
- [ ] **Шаг 3. Реализация.** Схема, `db:generate --name accounts_registration`, просмотр SQL глазами (только разрешённые операторы), `generate --custom --name reference_organizations` с телом выше, затем `db:generate` — изменений нет. Seed и `migrate.ts`.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка.
- [ ] **Шаг 5.** Коммит `Модель этапа 1: версии и принятия NDA по DBML, согласия и ожидающее принятие у аккаунта, один аккаунт производителя, ящик и major operators (GEN-01, GEN-05, MAN-01, FC-02, NFR-06)`.

---

### Task 3: регистрация v1.3 и профиль при установке пароля — API (MAN-01, MAN-03, FC-02, NOT-23, IMBC-07, GEN-01, AUTH-01)

**Files:**
- Create: `packages/contracts/src/registration.ts` (+ экспорт из `index.ts`); `apps/api/src/modules/auth/identity-provisioning.service.ts`; `apps/api/src/modules/registration/onboarding.service.ts`.
- Modify: `apps/api/src/modules/registration/registration.controller.ts`; `apps/api/src/modules/profiles/profiles.service.ts` (`ensureDraft`, комментарий `:137–139`); `apps/api/src/modules/adata/adata.scheduler.ts`; `apps/api/src/worker/handlers.service.ts` (`keycloakEvents`, `requestAdataRead`); `apps/api/src/modules/auth/auth.controller.ts:168–173`; `apps/api/src/app.module.ts`, `apps/api/src/worker/worker.module.ts` (провайдеры `ProfilesService`, `ManufacturerOnboardingService`, `IdentityProvisioningService`).
- Test: `packages/contracts/test/contracts.test.ts`; `apps/api/test/onboarding.integration.test.ts` (новый); `auth.integration.test.ts` (хелперы `registration`, `registrationBody`, тесты `:565`, `:615`, конструкторы); `adata-prefill.integration.test.ts` (конструкторы, тест `:316`); `start-page.test.ts` (конструктор).
- Docs: `README.md` §7 «Регистрация производителя»; `docs/handoff/2026-11-11-context.md` §6 — строки «`registration.controller.ts`…» и «Регистрация» закрыты.

**Interfaces:**
- Consumes: задача 2 — `ndaVersion`, `ndaAcceptance`, колонки `registration*`, `platformTermsAcceptedAt`, `personalDataAcceptedAt`.
- Produces (contracts):
  ```ts
  export const loginEmailSchema = z.string().trim().pipe(z.email().max(254)).transform((v) => v.toLowerCase());
  export const registrationRequestSchema = z.object({
    companyName: z.string().trim().min(2).max(300), bin: z.string().trim(), email: loginEmailSchema,
    heardAboutUs: z.string().trim().min(1).max(500),
    acceptPlatformTerms: z.literal(true), acceptPersonalData: z.literal(true),
    ndaVersion: z.number().int().positive(), locale: z.enum(LOCALES).default('kk'),
  }).strict();
  export type RegistrationRequest = z.input<typeof registrationRequestSchema>;
  export const registrationTermsSchema = z.object({ nda: z.object({ version: z.number().int().positive(), body: z.string().min(1) }).strict() }).strict();
  export type RegistrationTerms = z.infer<typeof registrationTermsSchema>;
  ```
- Produces (HTTP): `GET /api/v1/registrations/terms` (`@Public`) → `RegistrationTerms` (текущая `nda_version`); нет текущей — `503 nda_unavailable`. `POST /api/v1/registrations` → `202 { status: 'password_email_queued' }`; ошибки: 400 `validation`, `bin_format`, `bin_check_digit`; 409 `bin_exists` (текст «обратитесь в IMBC», MAN-02), `email_exists`, `nda_version_changed` (`ndaVersion` ≠ текущей — до вызова Keycloak); 503 `nda_unavailable`, `identity_unavailable`. `POST /api/v1/registrations/resend` — без изменений.
- Produces (сервисы):
  - `IdentityProvisioningService` (зависимости `PG_POOL`, `QUEUE`, `KeycloakAdminService`): `provision<T>(identity: { email: string; firstName: string | null; locale: Locale }, writeRows: (tx: Database, subject: string) => Promise<T>): Promise<T>` — `keycloak.createUser` → `withQueueTransaction`: `writeRows(tx, subject)`, затем `queue.send(QUEUES.sendPasswordEmail, { subject }, { db: queueDb, singletonKey: subject, singletonSeconds: 60 })` → при ошибке `deleteUser`, иначе задание `cleanup-identity` (как сейчас в контроллере). `export function provisioningConflict(error: unknown): 'email_exists' | 'bin_exists' | null` — нынешняя `registrationConflict` (по constraint `user_accounts_email_uq`, `user_accounts_idp_subject_uq`, `organizations_bin_uq`). Keycloak 409 → `409 email_exists`; иной сбой Keycloak → `503 identity_unavailable`.
  - `ManufacturerOnboardingService` (зависимости `PG_POOL`, `ProfilesService`, `AdataScheduler`, `AuditService`): `onPasswordSet(accountId: string, origin: AdataReadOrigin, at: Date): Promise<{ profile: 'created' | 'existing' | 'skipped'; adata: 'scheduled' | 'requeued' | 'skipped' }>`.
  - `AdataScheduler.requestInTransaction(tx: Database, queueDb: QueueDb, accountId: string, origin: AdataReadOrigin): Promise<'scheduled' | 'requeued' | 'skipped'>` — нынешний приватный `request`; `export type QueueDb`; `requestOnProfileCreated` остаётся обёрткой (её используют тесты Adata).
  - `ProfilesService.ensureDraft(organizationId, authorId, opts: { heardAboutUs?: string | null; registeredAt?: Date; outer?: Database })`.
  - Конструкторы: `RegistrationController(db: Database, queue: PgBoss, provisioning: IdentityProvisioningService, audit: AuditService, rates: AuthRateLimitService)`; `AuthController(oidc, sessions, audit, mail, rates, env, onboarding: ManufacturerOnboardingService)`; `JobHandlers(db, s3, mail, env, audit, keycloak, sessions, onboarding: ManufacturerOnboardingService)` — последний параметр `adata` заменён.

Регистрация: номер текущей версии NDA сверяется с `ndaVersion` дважды — до `provision` (несовпадение → `409 nda_version_changed`, Keycloak не вызывается) и внутри `writeRows` чтением текущей версии `for share` (несовпадение → тот же 409, компенсация удаляет пользователя Keycloak). Внутри `writeRows` — вставка организации (`manufacturer`, `name`, `bin`) и аккаунта (`role 'manufacturer'`, `locale`, `idpSubject`, `platformTermsAcceptedAt = personalDataAcceptedAt = registrationNdaAcceptedAt = now()`, `registrationNdaVersionId`, `registrationIp = req.ip`, `registrationHeardAboutUs`), аудит `registration.created`. Профиль **не** создаётся. Пустой `req.ip` → `503 identity_unavailable` (до Keycloak). IP — из `req.ip` (`trust proxy` 1 в `configureHttp`: адрес, добавленный Caddy/nginx, не значение клиента из `X-Forwarded-For`).

`onPasswordSet`, одна `withQueueTransaction`:
1. `set local lock_timeout = '2s'`, `statement_timeout = '5s'`;
2. аккаунт с организацией `for update of user_accounts`; нет, роль ≠ `manufacturer`, `organizations.bin is null` или `state = 'blocked'` → `{ profile: 'skipped', adata: 'skipped' }`;
3. профиль организации есть → `profile: 'existing'`; иначе `ensureDraft(orgId, accountId, { heardAboutUs: registrationHeardAboutUs, registeredAt: at, outer: tx })`; если `registrationNdaVersionId` не null — `insert into nda_acceptance (profile_id, nda_version_id, accepted_at, ip_address) values (…, registration_nda_accepted_at, host(registration_ip)) on conflict do nothing`; четыре колонки `registration*` → null; аудит `profile.created` и `nda.accepted` → `profile: 'created'`;
4. `adata = adata.requestInTransaction(tx, queueDb, accountId, origin)` — та же транзакция: профиль есть ⇔ попытка поставлена.
Сбой (включая постановку задания) откатывает всё; вызывающий пишет `warn` без данных, следующий вход или опрос событий в пятиминутном окне повторит.

Входы: `JobHandlers.keycloakEvents` — `passwordSet` становится `Map<subject, Date>` с самым ранним временем события пароля в пакете; после всех отзывов для каждого субъекта: аккаунт по `idp_subject` → `onboarding.onPasswordSet(id, 'password_set', at)` в `try/catch` (`warn 'onboarding: профиль после установки пароля не создан'`). `AuthController.callback`, вместо вызова планировщика: для `current.role === 'manufacturer'` — `await this.onboarding.onPasswordSet(current.id, 'sign_in', new Date()).catch(→ warn)`; вход не зависит от результата (вход означает, что пароль задан).

- [ ] **Шаг 1. Тесты (сначала).** `contracts.test.ts`: «регистрация: без любого согласия, без ответа «Как вы узнали», с acceptTerms или password — отклоняется (MAN-01)»; «почта логина в нижнем регистре, больше 254 — отклоняется». `onboarding.integration.test.ts` (PostgreSQL 18, pg-boss в `pgboss_auth_test`, Keycloak — объект с `vi.fn`, своя строка `nda_version` версии 1):
  - «регистрация v1.3: организация и аккаунт без профиля, согласия и ожидающее принятие NDA у аккаунта с IP запроса (MAN-01, MAN-03, FC-02)» — `register(body, { ip: '203.0.113.7' })`: профилей у организации 0, `nda_acceptance` 0, `registration_ip = '203.0.113.7'`, `registration_nda_version_id` = id версии 1, обе метки согласий не null; заданий `send-password-email` 1, `adata-prefill` 0;
  - **«устаревшая версия NDA — 409 nda_version_changed, createUser не вызван; нет текущей версии — terms и регистрация 503 nda_unavailable»**;
  - «событие установки пароля создаёт Draft, принятие NDA и одно чтение Adata одной транзакцией (MAN-03, FC-02, IMBC-07)» — `keycloakEvents` с `UPDATE_PASSWORD` в момент T: профиль `draft`, `registered_at = T`, `heard_about_us` перенесён, `nda_acceptance` (`accepted_at` = время регистрации, версия 1, `ip_address '203.0.113.7'`), колонки `registration*` аккаунта null, одна попытка `queued`, одно задание `adata-prefill`;
  - «установка пароля писем не шлёт (NOT-23)» — после события заданий `send-notification` и новых `send-password-email` нет, `keycloak.sendPasswordEmail` не вызван;
  - «сбой постановки чтения откатывает профиль и принятие; следующий вход создаёт всё» — `queue.send` для `adata-prefill` отклоняется один раз;
  - «вход до опроса событий создаёт профиль; событие после входа — existing, второй попытки нет»;
  - **«пароль дважды, повтор события, событие и вход параллельно, затем сброс пароля — один профиль, одно принятие, одна попытка profile_created (MAN-03, IMBC-07)»** — `Promise.all([onPasswordSet(id,'password_set',T), onPasswordSet(id,'sign_in',T2)])`, повтор пакета событий, позже `RESET_PASSWORD`: счётчики 1/1/1, `stub.requests` Adata не участвует;
  - «оператор, заблокированный производитель, организация без БИН — skipped, профиля нет»;
  - «Draft, созданный при регистрации до этапа 1, получает чтение по событию пароля; принятия NDA нет» — профиль через `ensureDraft` до события.
  `auth.integration.test.ts`: `registrationBody` — новые поля (`heardAboutUs: 'Выставка'`, `ndaVersion: 1`, почта `@stage1.local`), в `beforeAll` — текущая версия NDA; «commits a draft and durable email job…» → «commits the organization and the account without a profile, and a durable email job…» (профилей 0); «rolls back nested draft writes…» → «rolls back account writes when durable enqueue fails and compensates IdP creation»; «simultaneous duplicate BIN» и «IdP duplicate» — без изменения смысла. `adata-prefill.integration.test.ts`: конструкторы `JobHandlers`/`AuthController` получают `ManufacturerOnboardingService`; «регистрация без установки пароля не ставит задание…» дополнительно — профилей у организации 0; хелпер с `ensureDraft` остаётся (так выглядит профиль, созданный до этапа 1).
- [ ] **Шаг 2.** Прогон — падают.
- [ ] **Шаг 3. Реализация** по Interfaces.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка; README §7 — порядок регистрации и создания профиля (одной транзакцией с попыткой Adata), handoff §6.
- [ ] **Шаг 5.** Коммит `Регистрация v1.3: три согласия и текущая NDA, профиль Draft и принятие NDA при установке пароля одной транзакцией с чтением Adata (MAN-01, MAN-03, FC-02, NOT-23, IMBC-07)`.

---

### Task 4: форма регистрации — три согласия, текущая NDA, обязательный ответ (MAN-01, FC-02, LANG-01)

**Files:**
- Modify: `apps/web/src/routes/auth/register-form.tsx`; `apps/web/messages/{en,kk,ru}.json`.
- Create: `apps/web/src/routes/auth/legal-dialog.tsx`.
- Test: `apps/web/test/auth-routes.test.tsx` (`describe('регистрация производителя…')`), `messages.test.ts` (остаётся зелёным).
- Docs: handoff §10 — новые ключи `kk` на вычитку.

**Interfaces:**
- Consumes: задача 3 — `registrationTermsSchema`, `RegistrationRequest`, коды `nda_version_changed`, `nda_unavailable`, `bin_*`, `email_exists`.
- Produces: `LegalDialog({ title: string; body: string; placeholder: boolean; trigger: ReactElement })` — `Dialog` с текстом `whitespace-pre-line`, прокруткой и `Badge` «Заглушка» при `placeholder`.

Поведение: `useQuery(['registration','terms'], () => api<RegistrationTerms>('/v1/registrations/terms'))`; до ответа — `Skeleton` на месте галочки NDA; сбой или 503 — `Alert` (`register.termsLoadError` с повтором или `register.ndaUnavailable`), кнопка отправки недоступна. Три `Checkbox` (`acceptPlatformTerms`, `acceptPersonalData`, `acceptNda`), у каждого — кнопка «Прочитать» с `LegalDialog`: условия и политика — тексты `legal.terms.body`, `legal.privacy.body` (`placeholder: true`), NDA — `nda.body` из API с заголовком `legal.nda.title` и `placeholder: true` (пока версия 1). Поле «Как вы узнали о нас» обязательное (без «(необязательно)»). Тело запроса — ровно `{ companyName, bin, email, heardAboutUs, acceptPlatformTerms: true, acceptPersonalData: true, ndaVersion, locale }`. Ответ `409 nda_version_changed` — `refetch` терминов, галочка NDA снимается, `register.errors.nda_version_changed` под ней. Прежние ключи `register.acceptTerms`, `register.errors.terms_required`, `register.optional` (если больше не используется) удаляются из трёх файлов.

Тексты (en / ru / kk):
`register.acceptPlatformTerms` I accept the platform terms of use / Я принимаю условия использования платформы / Платформаны пайдалану шарттарын қабылдаймын · `register.acceptPersonalData` I agree to the personal data policy / Я согласен с политикой обработки персональных данных / Дербес деректерді өңдеу саясатымен келісемін · `register.acceptNda` I accept the non-disclosure agreement (NDA), version {version} / Я принимаю соглашение о неразглашении (NDA), версия {version} / Құпияны жария етпеу туралы келісімді (NDA) қабылдаймын, {version} нұсқа · `register.ndaHint` The NDA covers the demand forecast and the technical requirements (STR and KTRE). They open once IMBC verifies your profile. / NDA распространяется на прогноз спроса и технические требования (STR и KTRE). Они откроются после верификации профиля IMBC. / NDA сұраныс болжамы мен техникалық талаптарға (STR және KTRE) қолданылады. Олар профильді IMBC верификациялағаннан кейін ашылады. · `register.read` Read / Прочитать / Оқу · `register.termsLoadError` Could not load the agreement texts. / Не удалось загрузить тексты соглашений. / Келісім мәтіндерін жүктеу мүмкін болмады. · `register.ndaUnavailable` Registration is temporarily unavailable: the NDA text has not been published. Contact IMBC. / Регистрация временно недоступна: текст NDA ещё не опубликован. Обратитесь в IMBC. / Тіркелу уақытша қолжетімсіз: NDA мәтіні әлі жарияланбаған. IMBC-ге хабарласыңыз. · `register.errors.platform_terms_required` Accept the platform terms of use. / Примите условия использования платформы. / Платформаны пайдалану шарттарын қабылдаңыз. · `register.errors.personal_data_required` Agree to the personal data policy. / Подтвердите согласие с политикой персональных данных. / Дербес деректер саясатымен келісіміңізді растаңыз. · `register.errors.nda_required` Accept the NDA. / Примите NDA. / NDA-ны қабылдаңыз. · `register.errors.heard_about_us_required` Tell us how you heard about the platform. / Укажите, как вы узнали о платформе. / Платформа туралы қалай білгеніңізді көрсетіңіз. · `register.errors.nda_version_changed` The NDA has been updated. Read the new version and accept it again. / NDA обновлено. Прочитайте новую версию и примите её снова. / NDA жаңартылды. Жаңа нұсқасын оқып, қайта қабылдаңыз. · `legal.placeholder` Placeholder / Заглушка / Уақытша мәтін · `legal.terms.title` Platform terms of use / Условия использования платформы / Платформаны пайдалану шарттары · `legal.privacy.title` Personal data policy / Политика обработки персональных данных / Дербес деректерді өңдеу саясаты · `legal.nda.title` Non-disclosure agreement (NDA), version {version} / Соглашение о неразглашении (NDA), версия {version} / Құпияны жария етпеу туралы келісім (NDA), {version} нұсқа · `legal.terms.body` (точный текст) PLACEHOLDER — NOT A LEGAL TEXT. IMBC will provide the platform terms of use. This text exists only for the test environment and must not be relied on. / ВРЕМЕННЫЙ ТЕКСТ — НЕ ЮРИДИЧЕСКИЙ ДОКУМЕНТ. Текст условий использования платформы предоставит IMBC. Этот текст существует только для тестового стенда, полагаться на него нельзя. / УАҚЫТША МӘТІН — ЗАҢДЫҚ ҚҰЖАТ ЕМЕС. Платформаны пайдалану шарттарының мәтінін IMBC ұсынады. Бұл мәтін тек сынақ стендіне арналған, оған сүйенуге болмайды. · `legal.privacy.body` (точный текст) PLACEHOLDER — NOT A LEGAL TEXT. IMBC will provide the personal data policy. This text exists only for the test environment and must not be relied on. / ВРЕМЕННЫЙ ТЕКСТ — НЕ ЮРИДИЧЕСКИЙ ДОКУМЕНТ. Текст политики обработки персональных данных предоставит IMBC. Этот текст существует только для тестового стенда, полагаться на него нельзя. / УАҚЫТША МӘТІН — ЗАҢДЫҚ ҚҰЖАТ ЕМЕС. Дербес деректерді өңдеу саясатының мәтінін IMBC ұсынады. Бұл мәтін тек сынақ стендіне арналған, оған сүйенуге болмайды.

- [ ] **Шаг 1. Тесты (сначала)**, `auth-routes.test.tsx` (заглушка `GET /api/v1/registrations/terms` → `{ nda: { version: 1, body: 'NDA body' } }`): «три согласия и NDA с номером версии; без любой галочки или без ответа «Как вы узнали» форма не уходит, ошибка у поля (MAN-01)»; «тело запроса — ровно восемь полей, без acceptTerms и пароля, ndaVersion из API»; «тексты: условия и политика — заглушки с отметкой «Заглушка», NDA — тело из API в диалоге; Escape закрывает диалог и возвращает фокус на кнопку»; «409 nda_version_changed — термины перечитаны (второй вызов заглушки), галочка NDA снята, сообщение»; «terms 503 — «Регистрация временно недоступна», сбой сети — повтор; кнопка отправки недоступна»; «галочка ставится кликом по подписи и пробелом» (существующий тест — для трёх); «тексты на kk и en» (подпись NDA с версией). Существующие тесты БИН, занятой почты и 429 — на новых полях.
- [ ] **Шаг 2.** `pnpm --filter @imbc/web test -- auth-routes` — падают.
- [ ] **Шаг 3.** Компонент, форма, переводы.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка.
- [ ] **Шаг 5.** Коммит `Форма регистрации: условия платформы, политика персональных данных и текущая версия NDA, ответ «Как вы узнали» обязателен (MAN-01, FC-02, LANG-01)`.

---

### Task 5: организации, приглашения и ящик IMBC — API администратора (ADM-01, ADM-03, ADM-06, GEN-02, GEN-05, GEN-06, NOT-24, AUTH-01)

**Files:**
- Modify: `packages/contracts/src/admin.ts`; `apps/api/src/modules/admin/accounts.controller.ts`, `accounts.service.ts` (`imbcMailbox` в списке); `apps/api/src/app.module.ts`.
- Create: `apps/api/src/modules/admin/organizations.controller.ts`, `organizations.service.ts`, `invitations.service.ts`.
- Test: `apps/api/test/support/http.ts` (`send`); `apps/api/test/admin.http.test.ts` (новый), `admin-organizations.integration.test.ts` (новый); `accounts.http.test.ts`, `accounts.integration.test.ts` (ключи ответа); `packages/contracts/test/contracts.test.ts`.
- Docs: `README.md` §4 (модуль администратора: маршруты), §7 (приглашение — тот же поток, что регистрация).

**Interfaces:**
- Consumes: задача 2 — `notificationMailbox`, индексы `organizations_name_uq`, `organizations_imbc_uq`; задача 3 — `IdentityProvisioningService.provision`, `provisioningConflict`, `loginEmailSchema`.
- Produces (contracts, `admin.ts`):
  ```ts
  export const CREATABLE_ORGANIZATION_TYPES = ['operator', 'observer'] as const;
  export const INVITABLE_ROLES = { imbc: ['expert', 'administrator', 'director'], operator: ['operator'], observer: ['observer'] } as const
    satisfies Record<Exclude<OrganizationType, 'manufacturer'>, readonly Role[]>;
  export const createOrganizationSchema = z.object({ name: z.string().trim().min(2).max(300), type: z.enum(CREATABLE_ORGANIZATION_TYPES),
    isMajorOperator: z.boolean().default(false) }).strict().refine((v) => v.type === 'operator' || !v.isMajorOperator, { path: ['isMajorOperator'] });
  export const majorOperatorSchema = z.object({ isMajorOperator: z.boolean() }).strict();
  export const imbcMailboxSchema = z.object({ email: loginEmailSchema.nullable() }).strict();
  export const inviteAccountSchema = z.object({ email: loginEmailSchema, fullName: z.string().trim().min(2).max(200),
    organizationId: z.uuid(), role: z.enum(ROLES) }).strict();
  export const adminAccountResultSchema = z.object({ account: adminAccountSchema }).strict();
  export const adminOrganizationResultSchema = z.object({ organization: adminOrganizationSchema.omit({ accounts: true }) }).strict();
  // adminAccountsSchema: { organizations, imbcMailbox: z.string().nullable() }.strict()
  ```
- Produces (HTTP, все `@Can('accounts.manage')`, ответы через `parseResponse`):

| Маршрут | Тело | Успех | Ошибки |
|---|---|---|---|
| `POST /api/v1/admin/organizations` | `createOrganizationSchema` | 201 `adminOrganizationResultSchema` | 400 `validation`; 409 `organization_exists` (`organizations_name_uq`) |
| `PUT /api/v1/admin/organizations/:id/major-operator` | `majorOperatorSchema` | 200 `adminOrganizationResultSchema` | 404 `not_found`; 409 `not_operator` |
| `PUT /api/v1/admin/imbc-mailbox` | `imbcMailboxSchema` | 200 `{ imbcMailbox: string \| null }` | 400 `validation` |
| `POST /api/v1/admin/accounts` | `inviteAccountSchema` | 201 `adminAccountResultSchema` (`state 'invited'`) | 404 `not_found`; 409 `organization_not_invitable` (производитель); 400 `role_not_allowed` (роль не из `INVITABLE_ROLES[type]`); 409 `email_exists`; 503 `identity_unavailable` |
| `POST /api/v1/admin/accounts/:id/invitation` | — | 202 `{ status: 'password_email_queued' }` | 404; 409 `not_invited`, `identity_not_bound` |

- Produces (сервисы): `OrganizationsService.create(actor: AuthUser, input): Promise<AdminOrganizationResult>`, `.setMajorOperator(actor, id: string, value: boolean)`, `.setImbcMailbox(actor, email: string | null): Promise<{ imbcMailbox: string | null }>`; `InvitationsService.invite(actor: AuthUser, input, ip: string | null): Promise<AdminAccountResult>` — `provision({ email, firstName: fullName, locale: 'kk' }, (tx, subject) => insert user_accounts { organizationId, email, fullName, role, state 'invited', locale 'kk', idpSubject } + аудит)`; `.resend(actor, accountId)` — `queue.send(sendPasswordEmail, { subject }, { singletonKey: subject, singletonSeconds: 60 })` + аудит. Неизменившаяся отметка или ящик — 200 без записи аудита.
- Produces (тесты): `HttpStand.send(method: 'POST' | 'PUT', path: string, role?: Role, body?: unknown): Promise<Response>` — с заголовками `origin: https://imbc.example.kz` и `content-type: application/json`. Запрос с чужим Origin тест делает сам через `fetch(\`${http.base}${path}\`, …)`.

- [ ] **Шаг 1. Тесты (сначала).** `admin.http.test.ts`: таблица `ROUTES` (пять строк выше) × роли из матрицы — «%s %s: администратор — сервис вызван»; «… %s — 403 problem+json, `outcome 'denied'` и `action 'accounts.manage'` в аудите, сервис не вызван (GEN-08)»; «без сеанса — 401»; «чужой Origin — 403 bad_origin». `admin-organizations.integration.test.ts` (PostgreSQL 18 + pg-boss, Keycloak — `vi.fn`):
  - «оператор и наблюдатель создаются; major только у оператора; тот же тип и имя без учёта регистра — 409 organization_exists; тип manufacturer или imbc — 400 (ADM-03, GEN-05)»;
  - «отметка major ставится и снимается только у оператора; наблюдателю — 409 not_operator; повтор без изменения — без второй записи аудита»;
  - «ящик IMBC: адрес в нижнем регистре, null снимает, неверный — 400; аудит from/to; в списке аккаунтов — imbcMailbox (раздел 8.2)»;
  - «приглашение: пользователь Keycloak с firstName и locale kk, аккаунт invited в организации, одно задание send-password-email на субъект в той же транзакции (ADM-01, NOT-24, AUTH-01)»;
  - «IMBC — три роли, оператор — operator, наблюдатель — observer, иначе 400 role_not_allowed; организация производителя — 409 organization_not_invitable; чужой id — 404»;
  - «у организации-оператора несколько аккаунтов, по одному на адрес (GEN-02); у наблюдателя — так же (GEN-06)»;
  - **«одно приглашение дважды параллельно — один 201, один 409 email_exists, пользователь Keycloak проигравшего удалён; адрес занят только в Keycloak (createUser 409) — 409 email_exists»**;
  - **«повтор приглашения: invited — одно задание и при двух повторах подряд (singletonKey); active и blocked — 409 not_invited; аккаунт seed без субъекта — 409 identity_not_bound»**;
  - «ответы не содержат БИН и полей профиля (ADM-06)» — `JSON.stringify` ответов не содержит `bin`, `status`, `completenessPct`, `heardAboutUs`.
  `accounts.integration.test.ts` и `accounts.http.test.ts`: ключи ответа — `['organizations', 'imbcMailbox']`. `contracts.test.ts`: «INVITABLE_ROLES: производителя нет, у IMBC три роли (раздел 3.1)»; «наблюдатель с отметкой major — отклоняется (GEN-05)».
- [ ] **Шаг 2.** Прогон — падают.
- [ ] **Шаг 3. Реализация.** Проверки типа и роли — до `provision` (до Keycloak). Строка организации для отметки — `select … for update`.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка; README §4, §7.
- [ ] **Шаг 5.** Коммит `Администратор: организации операторов и наблюдателей, отметка major operator, приглашения тем же потоком, что регистрация, ящик IMBC (ADM-01, ADM-03, GEN-05, NOT-24, ADM-06)`.

---

### Task 6: блокировка, смена роли и почты-логина; сеансы и Keycloak (ADM-02, ADM-05, AUTH-06, MAN-05, GEN-08)

**Files:**
- Create: `apps/api/src/modules/admin/account-lifecycle.service.ts`.
- Modify: `apps/api/src/modules/admin/accounts.controller.ts`; `packages/contracts/src/admin.ts`; `apps/api/src/modules/auth/keycloak-admin.service.ts` (`updateUser`, `logoutUser`; `disableUser` удаляется); `apps/api/src/jobs/queues.ts`; `apps/api/src/infra/infra.module.ts` (очередь `identity-sync` в API); `apps/api/src/worker/handlers.service.ts`, `worker.module.ts`; `infrastructure/azure/Caddyfile`, `infrastructure/nginx/nginx.conf`; `apps/api/src/app.module.ts`.
- Test: `apps/api/test/account-lifecycle.integration.test.ts` (новый); `admin.http.test.ts` (строки `ROUTES`); `contracts.test.ts`.
- Docs: `README.md` §7 (блокировка, роль, почта и `identity-sync`), §8 (консоль аккаунта Keycloak закрыта), `docs/deployment/azure-dev.md` («Статус и логи»: задание `identity-sync`).

**Interfaces:**
- Consumes: задача 5 — `adminAccountResultSchema`, `INVITABLE_ROLES`, `HttpStand.send`, `ROUTES` в `admin.http.test.ts`; задача 2 — `inactiveSince`.
- Produces (contracts): `changeRoleSchema = z.object({ role: z.enum(ROLES) }).strict()`; `changeEmailSchema = z.object({ email: loginEmailSchema }).strict()`.
- Produces (HTTP, `@Can('accounts.manage')`, ответ 200 `adminAccountResultSchema`):

| Маршрут | Ошибки |
|---|---|
| `POST /api/v1/admin/accounts/:id/block` | 404; 409 `self_action` |
| `POST /api/v1/admin/accounts/:id/unblock` | 404 |
| `PUT /api/v1/admin/accounts/:id/role` (`changeRoleSchema`) | 404; 409 `self_action`, `role_fixed` (организация не IMBC); 400 `role_not_allowed` |
| `PUT /api/v1/admin/accounts/:id/email` (`changeEmailSchema`) | 404; 409 `not_manufacturer_account`, `identity_not_bound`, `email_exists`; 503 `identity_unavailable` |

Всем: исполнитель, переставший быть `active` `administrator` к моменту блокировки строк, — 403 `forbidden`.
- Produces (сервис): `AccountLifecycleService` (зависимости `PG_POOL`, `QUEUE`, `KeycloakAdminService`, `AuditService`): `block(actor: AuthUser, id: string)`, `unblock(actor, id)`, `changeRole(actor, id, role: Role)`, `changeEmail(actor, id, email: string)` — все `Promise<AdminAccountResult>`. Внутри: `withQueueTransaction` → строки исполнителя и цели `for update` в порядке id → проверка исполнителя → изменение. «Завершить сеансы» = `auth_version + 1` и `delete from sessions where user_id = $1` в той же транзакции (`resolve` отказывает и по одному, и по другому).
- Produces (Keycloak): `updateUser(subject: string, patch: { email?: string; emailVerified?: boolean; enabled?: boolean; requiredActions?: string[] }): Promise<void>` (`PUT /users/{id}`, `!ok` → `KeycloakRequestError`); `logoutUser(subject: string): Promise<void>` (`POST /users/{id}/logout`, 404 — не ошибка).
- Produces (очередь): `QUEUES.identitySync = 'identity-sync'`; `export interface IdentitySyncJob { accountId: string; logout: boolean }`; `JobHandlers.syncIdentity(job: IdentitySyncJob): Promise<void>` — аккаунт без `idp_subject` → выход; `updateUser(subject, { enabled: state !== 'blocked', email })`; `logout` → `logoutUser`. Идемпотентно: всегда приводит Keycloak к текущей строке БД. Опции очереди — как у прочих (до 5 повторов).

Действия:
- `block`: уже `blocked` → без изменений; иначе `state 'blocked'`, сеансы завершены, аудит `account.blocked { from }`, задание `identity-sync { logout: true }`.
- `unblock`: не `blocked` → без изменений; иначе `state = last_sign_in_at is null ? 'invited' : 'active'`, `inactive_since = null`, аудит, `identity-sync { logout: false }`.
- `changeRole`: та же роль → без изменений; иначе роль, сеансы завершены, аудит `{ from, to }`. Keycloak не меняется: роль живёт в БД.
- `changeEmail`: роль ≠ `manufacturer` → 409; `idp_subject is null` → 409; тот же адрес → без изменений; адрес занят в БД (`lower(email)`) → 409; **сначала** `updateUser(subject, { email, emailVerified: true })` (409 → `email_exists`, иной сбой → 503) — конфликт адреса виден только Keycloak; затем транзакция: `email`, сеансы завершены, `delete from trusted_devices where user_id` (следующий вход шлёт NOT-02 на новый адрес), аудит `{ from, to }`, `identity-sync { logout: true }`; у `invited` — ещё `send-password-email { subject }` (NOT-01 на новый адрес). Сбой транзакции → `updateUser(subject, { email: прежний })`, при его сбое — `queue.send(identitySync, { accountId, logout: true })` вне транзакции; 23505 → 409 `email_exists`.

Прокси: `Caddyfile` — в `route` до `@keycloak`: `@accountConsole path_regexp accountConsole (?i)^/kc/realms/[^/]+/account(?:/|$)` и `respond @accountConsole 404`; `nginx.conf` — `location ~* ^/kc/realms/[^/]+/account(/|$) { return 404; }` перед `location /kc/`.

- [ ] **Шаг 1. Тесты (сначала).** `admin.http.test.ts` — четыре строки в `ROUTES` (права генерируются тем же циклом). `account-lifecycle.integration.test.ts` (PostgreSQL 18 + pg-boss; настоящий `SessionService`; Keycloak — `vi.fn`):
  - «блокировка: blocked, auth_version +1, сеансы удалены, resolve прежнего токена — null, задание identity-sync с logout (ADM-02, AUTH-06)»;
  - **«заблокированный с открытым сеансом: следующий запрос — нет сеанса; verifyOtp не ok, trustDevice — null, callback — /login?error=no_account; сеанс, созданный после блокировки, не выдаётся»** (callback — `AuthController` с заглушкой `oidc.exchange`, как в `adata-prefill.integration.test.ts`);
  - «разблокировка: invited, если не входил; active после входа; inactive_since очищен; прежние сеансы не возвращаются; identity-sync без logout»;
  - «смена роли: роль и auth_version, сеансы завершены (AUTH-06); оператор, наблюдатель, производитель — 409 role_fixed; роль вне IMBC — 400 role_not_allowed; та же роль — без записи аудита»;
  - «себя заблокировать и сменить себе роль — 409 self_action»;
  - **«два администратора одновременно: блокировка и смена роли одного аккаунта — обе применены, auth_version +2, две записи аудита; блокировка дважды параллельно — одна запись; взаимное понижение двух администраторов — ровно одно применено, второе 403 forbidden»**;
  - «смена почты производителя: updateUser(subject, { email, emailVerified: true }), user_accounts.email, сеансы и доверенные устройства удалены, аудит from/to; invited — задание send-password-email на субъект (ADM-05, MAN-05)»;
  - «почта занята в БД — 409 без вызова Keycloak; занята в Keycloak — 409, БД без изменений; сбой БД после Keycloak — updateUser с прежним адресом»;
  - «не производитель — 409 not_manufacturer_account; без субъекта — 409 identity_not_bound»;
  - «identity-sync: enabled = state ≠ blocked, email из БД, logout по флагу; без субъекта — ни одного вызова; повтор задания даёт тот же вызов»;
  - «граница MAN-05: смена почты — только `PUT /api/v1/admin/accounts/:id/email`» — по метаданным маршрутов контроллеров `AppModule` (`Reflect.getMetadata('path'/'method')`): среди изменяющих маршрутов путь с `email` — один.
  `contracts.test.ts`: «changeEmailSchema приводит к нижнему регистру».
- [ ] **Шаг 2.** Прогон — падают.
- [ ] **Шаг 3. Реализация** по Interfaces; `docker compose config -q`.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка; README §7, §8, runbook.
- [ ] **Шаг 5.** Коммит `Аккаунты: блокировка, смена роли и почты-логина сразу завершают сеансы, Keycloak догоняет заданием identity-sync, консоль аккаунта Keycloak закрыта (ADM-02, ADM-05, AUTH-06, MAN-05)`.

---

### Task 7: неактивность — три месяца без входа и возврат через сброс пароля (AUTH-07, NOT-26, DATA-08)

**Files:**
- Create: `apps/api/src/worker/account-inactivity.job.ts`.
- Modify: `apps/api/src/jobs/queues.ts` (строка расписания `accountInactivity`: заметка `AUTH-07`; `QUEUES.inactivityReset`); `apps/api/src/worker/worker.module.ts` (маршруты `accountInactivity` → `AccountInactivityJob.run()`, `inactivityReset` → `JobHandlers.sendInactivityReset`), `handlers.service.ts`; `apps/api/src/modules/auth/keycloak-admin.service.ts` (`passwordUpdatedAt`, параметр действий у `sendPasswordEmail`); `apps/api/src/modules/auth/session.service.ts` (`revokeForPasswordChange:429`, `reactivateAfterReset`); `apps/api/src/modules/auth/auth.controller.ts:134`; `scripts/requirements-baseline.json` (`--update-baseline`).
- Test: `apps/api/test/account-inactivity.integration.test.ts` (новый); `auth.integration.test.ts` (тест `:400` — reset сохраняет смысл).
- Docs: `README.md` §7 (таблица заданий: `account-inactivity` — работает; `inactivity-reset`).

**Interfaces:**
- Consumes: задача 2 — `inactiveSince`; задача 6 — `logoutUser`, `updateUser`.
- Produces:
  - `AccountInactivityJob.run(now: Date = new Date()): Promise<{ deactivated: number }>` (зависимости `PG_POOL`, `QUEUE`, `AuditService`). Кандидат: `state = 'active'` и `(timezone('Asia/Almaty', coalesce(last_sign_in_at, created_at))::date + interval '3 months')::date <= timezone('Asia/Almaty', $now)::date` (PostgreSQL сам берёт последний день месяца — правило NOT-31). Пачками по 200 до исчерпания; на аккаунт — своя `withQueueTransaction`: `update … set state 'inactive', inactive_since = $now, auth_version = auth_version + 1 where id = $1 and state = 'active' and <то же условие>` (повторная проверка — вход в последний момент выигрывает), `delete from sessions`, аудит `account.became_inactive`, задание `inactivity-reset { accountId }` (`singletonKey: accountId`).
  - `QUEUES.inactivityReset = 'inactivity-reset'`; `export interface AccountJob { accountId: string }`; `JobHandlers.sendInactivityReset({ accountId }: AccountJob)` — аккаунт не `inactive` или без субъекта → выход; `updateUser(subject, { requiredActions: ['UPDATE_PASSWORD'] })`, `logoutUser(subject)`, `sendPasswordEmail(subject, ['UPDATE_PASSWORD'])` (NOT-01 ссылкой сброса, 72 часа). Существующий `requirePasswordReset` заменяется этим вызовом `updateUser`.
  - `KeycloakAdminService.sendPasswordEmail(userId: string, actions: ReadonlyArray<'VERIFY_EMAIL' | 'UPDATE_PASSWORD'> = ['VERIFY_EMAIL', 'UPDATE_PASSWORD'])`; `passwordUpdatedAt(subject: string): Promise<Date | null>` — `GET /users/{id}/credentials`, наибольший `createdDate` (мс) среди `type === 'password'`.
  - `SessionService.reactivateAfterReset(accountId: string, passwordSetAt: Date, via: 'sign_in' | 'password_event'): Promise<boolean>` — `update … set state 'active', inactive_since = null where id and state = 'inactive' and inactive_since <= $passwordSetAt` + аудит `account.reactivated { via }`; `revokeForPasswordChange` вызывает ту же логику вместо условия `at >= account.updatedAt`.
  - `AuthController.callback`, вместо `if (account.state === 'inactive') return redirect(account_inactive)`: `passwordUpdatedAt(identity.subject)` (сбой → как «не обновлён»); не старше `inactive_since` → `reactivateAfterReset(account.id, t, 'sign_in')`, затем вход продолжается обычным путём; иначе `/login?error=account_inactive`.

- [ ] **Шаг 1. Тесты (сначала)**, `account-inactivity.integration.test.ts` (PostgreSQL 18 + pg-boss; `run(now)` с фиксированными датами; Keycloak — `vi.fn`):
  - «граница трёх месяцев по Алматы (AUTH-07, DATA-08)» — вход `2026-11-12T05:00:00Z` (10:00 по Алматы): `run(2027-02-11T18:59:59Z)` — active, `run(2027-02-11T19:00:00Z)` (00:00 12.02 по Алматы) — inactive;
  - «день по Алматы, а не по UTC: вход 2026-11-11T20:00:00Z (12.11 по Алматы) — inactive только с 2027-02-12»;
  - «конец месяца: вход 30.11.2026 — inactive с 28.02.2027; 31.05.2027 — с 31.08.2027; 31.08.2026 — с 30.11.2026» (полдень по Алматы, `run` в 00:00 и за секунду до);
  - «active без входа — от created_at; invited и blocked не меняются»;
  - «переход: inactive, inactive_since = now, auth_version +1, сеансы удалены, аудит, одно задание inactivity-reset; второй run — ничего нового (NOT-26)»;
  - «статус актуальности и дата квартала профиля не меняются (NOT-26, NOT-31)» — строка `manufacturer_profiles` до и после `run` одинакова;
  - «вход до трёх месяцев — ни перехода, ни задания»; «вход и run одновременно — нет состояния inactive с живым сеансом» (`Promise.all([markSignedIn + create, run(boundary)])`: либо active с сеансом, либо inactive без сеансов);
  - «inactivity-reset: requiredActions UPDATE_PASSWORD, logoutUser, sendPasswordEmail(subject, ['UPDATE_PASSWORD']); аккаунт уже active или без субъекта — ни одного вызова»;
  - «возврат по событию пароля после inactive_since — active, аудит account.reactivated { via: password_event }; событие раньше inactive_since — остаётся inactive»;
  - «вход неактивного: пароль обновлён после inactive_since — вход проходит, аккаунт active; не обновлён или Keycloak недоступен — /login?error=account_inactive».
  `auth.integration.test.ts:400` («revokes old sessions/devices on reset…») — проходит без правки смысла.
- [ ] **Шаг 2.** Прогон — падают.
- [ ] **Шаг 3. Реализация**; строка расписания `{ queue: QUEUES.accountInactivity, cron: '0 2 * * *', note: 'три месяца без входа → inactive и ссылка сброса (AUTH-07, NOT-26)' }`; `node scripts/check-requirements.mjs --update-baseline`.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка; README §7.
- [ ] **Шаг 5.** Коммит `Неактивность: три месяца без входа по Алматы переводят аккаунт в inactive со ссылкой сброса, возврат — новым паролем (AUTH-07, NOT-26, DATA-08)`.

---

### Task 8: кабинет администратора — организации и аккаунты в web; документы этапа (ADM-01, ADM-02, ADM-03, ADM-05, ADM-06, GEN-05, AUTH-06, LANG-01)

**Files:**
- Modify: `apps/web/src/routes/app/admin-accounts.tsx`; `apps/web/messages/{en,kk,ru}.json`.
- Create: `apps/web/src/routes/app/admin-dialogs.tsx` (создание организации, приглашение, ящик, смена роли, смена почты); `apps/web/src/routes/app/admin-account-actions.tsx`; `apps/web/src/components/ui/alert-dialog.tsx` — `pnpm dlx shadcn@4.23.0 add alert-dialog` (сначала просмотр в MCP shadcn).
- Test: `apps/web/test/admin-accounts.test.tsx`.
- Docs: `docs/development-roadmap.md` §2 и «Этап 1» — состояние; `docs/handoff/2026-11-11-context.md` §4, §6, §10 (казахские ключи на вычитку), §11 (аккаунты — уже не только чтение); `README.md` §14 — строка прогона этапа с числами тестов из вывода.

**Interfaces:**
- Consumes: задачи 5–7 — маршруты и коды ошибок из их таблиц, `adminAccountsSchema` с `imbcMailbox`, `INVITABLE_ROLES`, `CREATABLE_ORGANIZATION_TYPES`; `useMe()` (`src/lib/session.ts`) — id текущего пользователя.
- Produces: страница `/admin/accounts` — над списком карточка «Ящик IMBC» (адрес или «не задан», кнопка «Изменить» → диалог; пустое поле снимает) и кнопки «Создать организацию», «Пригласить пользователя». Диалог организации: название, тип (оператор/наблюдатель), галочка major — только для оператора. Диалог приглашения: почта, имя, организация (`Select`, организации типов IMBC, оператор, наблюдатель), роль (`Select`, `INVITABLE_ROLES[тип]`; у оператора и наблюдателя — единственная, выбрана). В карточке оператора — кнопка «Отметить как major operator» / «Снять отметку». В строке аккаунта — `DropdownMenu` с подписью «Действия: {email}»: «Отправить приглашение снова» (`invited`), «Заблокировать» (не `blocked`, через `AlertDialog` с пояснением, что сеансы завершатся сразу), «Разблокировать» (`blocked`), «Сменить роль» (организация IMBC), «Сменить почту для входа» (роль `manufacturer`); в своей строке — без блокировки и смены роли. После успеха — `invalidateQueries(['admin','accounts'])`; ошибки — `Alert` в диалоге с переводом кода (`organization_exists`, `email_exists`, `role_not_allowed`, `organization_not_invitable`, `not_invited`, `identity_not_bound`, `self_action`, `role_fixed`, `not_manufacturer_account`, `identity_unavailable`, прочее — `requestError`). Состояние `inactive` — существующий бейдж.

Ключи `adminAccounts.*` (английский — источник; ru и kk — в том же коммите): `createOrganization` Create organisation · `inviteUser` Invite user · `imbcMailbox` IMBC mailbox for notifications · `imbcMailboxNotSet` Not set · `imbcMailboxHint` IMBC emails will be sent to this address. · `change` Change · `organizationName` Organisation name · `organizationType` Type · `markMajor` Mark as major operator · `unmarkMajor` Remove major operator mark · `email` / `name` / `role` (есть) · `organization` Organisation · `actions` Actions: {email} · `resendInvitation` Send the invitation again · `invitationResent` The invitation email has been queued. · `block` Block · `blockConfirmTitle` Block {email}? · `blockConfirmText` The account's open sessions end at once. The person cannot sign in until the account is unblocked. · `unblock` Unblock · `changeRole` Change role · `changeRoleHint` Open sessions end at once; the person signs in again with the new role. · `changeEmail` Change login email · `changeEmailHint` Open sessions end. The next sign-in sends a code to the new address. · `save` Save · `cancel` Cancel · `errors.<код>` для кодов выше.

- [ ] **Шаг 1. Тесты (сначала)**, `admin-accounts.test.tsx` (заглушки `api`): «ящик IMBC: показан, меняется, пустое значение отправляет null, неверный адрес — ошибка поля»; «создание организации: тип оператор/наблюдатель, галочка major только у оператора; тело запроса; 409 organization_exists — сообщение в диалоге; после успеха список перечитан»; «приглашение: в списке организаций нет производителей, роли по типу (IMBC — три), тело запроса; 409 email_exists — сообщение»; «действия по состоянию: invited — повтор приглашения; active — блокировка через подтверждение; blocked — разблокировка; IMBC — смена роли; производитель — смена почты; своя строка — без блокировки и смены роли»; «отметка major у оператора переключается PUT-запросом»; «ошибки self_action, identity_not_bound, not_invited переведены»; «на странице нет БИН и полей профиля (ADM-06)»; «меню и диалоги доступны с клавиатуры (Enter, Escape, возврат фокуса)»; «тексты на kk и en».
- [ ] **Шаг 2.** `pnpm --filter @imbc/web test -- admin-accounts` — падают.
- [ ] **Шаг 3.** `alert-dialog` через CLI; компоненты; переводы.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка; документы этапа (Files → Docs).
- [ ] **Шаг 5.** Коммит `Кабинет администратора: организации, отметка major operator, приглашения, блокировка, смена роли и почты, ящик IMBC (ADM-01, ADM-02, ADM-03, ADM-05, GEN-05, ADM-06)`.

---

## Чего этап не делает

- Справочники, файлы, основа уведомлений (этап 2): журнал `notification` вместо `notifications_sent`, правила NOT-18…NOT-21, тексты NOT-01 в языковых файлах (сейчас — тема писем Keycloak), письма на ящик IMBC по-казахски. Этап хранит ящик и не шлёт на него ничего.
- Секции профиля и запрет правки БИН и почты в интерфейсе профиля (этап 3); предзаполнение и due diligence по чтению Adata (этап 4б).
- Экран версий NDA, новая версия и повторное принятие (ADM-10, FC-03 — Release 2, этап 9); принятие NDA мигрированным производителем при первом входе (FC-02 — этап 8; так же получат NDA регистрации стенда до этапа 1). Разделы прогноза, STR и KTRE.
- NOT-17 и пауза подписок при неактивности (OPR-18, NOT-26 — этап 9); экран журнала «account events only» для администратора (AUD-03 — этап 7; этап только пишет `is_account_event`).
- «Invite all migrated manufacturers» (ADM-04 — этап 8), ключи pull API (ADM-07 — этап 6).
- Переименование таблиц и колонок под DBML (Р-2) — отдельная пара expand/contract после этапа.
- Переименование и удаление организаций, перевод аккаунта в другую организацию, удаление аккаунтов, письмо на прежний адрес при смене почты — в спецификации их нет.
- Первый администратор продакшена (без seed) — поставка, этап 10. Перевод темы Keycloak на Base UI — отдельная работа.
- Сквозные браузерные сценарии (roadmap 3.4 — с этапа 3); реальный вызов Adata.

## Приёмка

Roadmap, этап 1: «Администратор приглашает пользователя нужной организации и роли, тот активирует доступ по письму. Блокировка и смена роли действуют на открытые сеансы. Границы трёх месяцев проверяются управляемым временем. Администратор не видит содержимого профилей, документов и записей IMBC (ADM-06). У организации-производителя не может появиться второй аккаунт.» Плюс регистрация v1.3 и релиз contract.

**Автоматически** (обязательное условие): зелёные проверки Global Constraints на последнем коммите; границы трёх месяцев — задача 7; второй аккаунт производителя — задача 2.

**На стенде** — только по команде владельца, после слияния ветки этапа в ветку стенда `demo/prototype-cabinets` и выката `./infrastructure/azure/deploy.sh redeploy` из чистого checkout. Входы демо-ролей — фиксированный код `000000`; новые адреса — `*.local`, письма и коды — в Mailpit (`/dev-mail/`). Результат — `docs/deployment/verification-<дата>.md`.
0. **До выката** (владелец, runbook «Релиз contract (0006)»): SQL-проверка — все нули; в серверной `.env` нет `"role":"spectator"`; резервная копия `pg_dump`. Предел Adata — решение владельца: 12.11.2026 он открыт (`ADATA_MONTHLY_LIMIT=25` в серверной `.env`), и каждая регистрация приёмки, дошедшая до установки пароля, тратит платную единицу и отправляет в Adata БИН из формы. На время приёмки предел закрывается (строка удаляется, `up -d worker`; `sudo grep -c '^ADATA_MONTHLY_LIMIT=' .env` — `0`) либо владелец прямо подтверждает расход.
1. **После выката:** в журнале `migrate` нет строки «Перенос v1.3»; `select enum_range(null::role), enum_range(null::update_status);` — без `spectator` и `inactive`; `select name, is_major_operator from organizations where type in ('imbc','operator') order by name;` — IMBC, KPO, NCOC, TCO (major) и демо-оператор; `select version_number, is_current from nda_version;` — `1 | t`; `\dp nda_acceptance` — у `imbc_app` нет UPDATE и DELETE; `curl -s -o /dev/null -w '%{http_code}' https://<стенд>/kc/realms/imbc/account/` — `404`.
2. **Регистрация:** `/register`, БИН с верным контрольным разрядом не из seed, `stage1-maker@demo.local`; три галочки, NDA «версия 1» с отметкой «Заглушка». В Mailpit — одно письмо, на этот адрес. В БД — организация и аккаунт, профиля нет, `registration_ip` — внешний IP владельца. Установить пароль по ссылке, войти: `/profile` — Draft; `nda_acceptance` — версия 1, время регистрации, тот же IP; попытка Adata — `quota_exhausted` без запроса при закрытом пределе (при открытом — настоящее чтение, шаг 0). Второй регистрации `stage1-abandoned@demo.local` пароль не задавать — профиля и попытки нет.
3. **Организации и приглашения** (`admin@imbc.local`): создать наблюдателя «Наблюдатель (приёмка)», пригласить `stage1-observer@demo.local` → письмо → пароль → вход → `/dashboard`. Пригласить `stage1-operator@demo.local` в NCOC и `stage1-sme@demo.local` как SME в IMBC → оба входят на свои стартовые страницы. Отметить «Наблюдатель (приёмка)» как major — нельзя; созданного оператора — можно. Задать ящик IMBC `imbc-mail@demo.local`.
4. **Сеансы:** в другом браузере вошёл `stage1-operator@demo.local`; администратор блокирует → следующий клик оператора уводит на вход, новый вход — «доступ ограничен». Разблокировать → вход проходит. `stage1-sme@demo.local` открыл `/reviews`; администратор меняет роль на директора → следующий запрос — на вход, после входа — `/dashboard`.
5. **Почта-логин:** администратор меняет почту `stage1-maker@demo.local` на `stage1-maker2@demo.local` → открытый сеанс производителя завершён; вход новым адресом с прежним паролем, код приходит на новый адрес; прежний адрес не входит (сверка поведения `registrationEmailAsUsername`).
6. **ADM-06 и роль:** на `/admin/accounts` нет БИН и статусов профилей; `GET /api/v1/profiles/own` под администратором — 403. Пригласить в организацию производителя нельзя (её нет в списке; API — `409 organization_not_invitable`).
7. **Неактивность (необязательно):** `update user_accounts set last_sign_in_at = now() - interval '3 months 1 day' where lower(email) = 'stage1-observer@demo.local';` — после запуска 02:00 по Алматы аккаунт `inactive`, в Mailpit — ссылка сброса; вход прежним паролем — «аккаунт неактивен»; сброс по ссылке — вход проходит, аккаунт `active`.

**Что нужно от владельца и IMBC:** команда на выкат и шаг 0 (правка серверной `.env`, резервная копия); тексты условий платформы, политики персональных данных и NDA от IMBC (заглушки заменяются: NDA — миграцией версии 2, условия и политика — правкой переводов); адрес ящика IMBC для продакшена; решения по Р-2 и вопросам 4, 5, 24, 31 и новым из «Расхождений» (5, 13, 14, 15) — отправить Абаю; вычитка казахских текстов (LANG-03); снятие блокировки GitHub Actions — без неё сборочный конвейер этапа не запускается.

## Pre-flight: общие файлы и интерфейсы задач

| Пара | Общее | Производит → потребляет |
|---|---|---|
| 1 → 2 | цепочка `drizzle/meta`, `schema/*.ts`, `migrate.ts`, `seed.ts` | 1: снимок 0006 = TS-схема без `externalChecks`/`ndaVersions`/`ndaAcceptances`, `db:generate` пуст; `migrate.ts` без переноса → 2: 0007 генерируется от снимка 0006; `REVOKE` на `nda_acceptance` рядом с `audit_entries`; seed без переименования, с NDA |
| 1 → 2 | тесты миграций | 1: `migrateThrough(pool, '0005_adata_prefill')` — база до contract → 2: `migrateThrough(pool, '0006_spec_v13_contract')` — база до expand |
| 2 → 3 | схема | `ndaVersion`, `ndaAcceptance`, `registrationNdaVersionId`, `registrationNdaAcceptedAt`, `registrationIp`, `registrationHeardAboutUs`, `platformTermsAcceptedAt`, `personalDataAcceptedAt` |
| 2 → 5, 6, 7 | схема | `notificationMailbox`, `organizations_name_uq`, `organizations_imbc_uq` (5); `inactiveSince` (6 — сброс при разблокировке, 7) |
| 3 → 4 | контракт | `registrationRequestSchema` (восемь полей), `registrationTermsSchema`, коды `nda_version_changed`, `nda_unavailable` |
| 3 → 5 | сервис | `IdentityProvisioningService.provision(identity, writeRows)`, `provisioningConflict`, `loginEmailSchema` |
| 3 ↔ 7 | `auth.controller.ts` `callback` | 3: `onboarding.onPasswordSet` после `markSignedIn` для производителя → 7: проверка `inactive` до `markSignedIn`; порядок: блокировка → неактивность → `credentialsChangedAt` → `markSignedIn` → онбординг |
| 3, 6, 7 | `handlers.service.ts`, `worker.module.ts` | 3: `JobHandlers(…, onboarding)`, `ProfilesService` и онбординг в провайдерах worker → 6: `syncIdentity`, маршрут `identity-sync` → 7: `sendInactivityReset`, маршруты `account-inactivity`, `inactivity-reset`; `Record<QueueName, …>` требует маршрут для каждой очереди |
| 6 ↔ 7 | `keycloak-admin.service.ts`, `queues.ts` | 6: `updateUser`, `logoutUser`, `QUEUES.identitySync`, `IdentitySyncJob` → 7: использует оба метода, добавляет `passwordUpdatedAt`, параметр `sendPasswordEmail`, `QUEUES.inactivityReset`, `AccountJob`, заменяет `requirePasswordReset` |
| 6 ↔ 7 | `session.service.ts` | 6 не меняет; 7: `reactivateAfterReset`, правка `revokeForPasswordChange` |
| 5 → 6 | `accounts.controller.ts`, `admin.ts`, `admin.http.test.ts`, `test/support/http.ts` | 5: маршруты приглашений, `adminAccountResultSchema`, `INVITABLE_ROLES`, таблица `ROUTES`, `HttpStand.send` → 6: добавляет маршруты и строки `ROUTES`, `changeRoleSchema`, `changeEmailSchema` |
| 5, 6, 7 → 8 | HTTP | маршруты и коды ошибок таблиц задач 5 и 6; `adminAccountsSchema.imbcMailbox`; состояния `invited/active/inactive/blocked` |
| 4 ↔ 8 | `messages/*.json` | 4: `register.*`, `legal.*` → 8: `adminAccounts.*`; пересечений ключей нет, `messages.test.ts` после каждой |
| 3, 5, 6, 7 | `README.md` §7 | каждая — свой абзац; таблица заданий — 6 (`identity-sync`) и 7 (`account-inactivity`, `inactivity-reset`) |

## Self-review

- **Покрытие.** GEN-01 — индекс одного аккаунта (2), подсказка о почте компании (4); GEN-02, GEN-06 — несколько аккаунтов оператора и наблюдателя по одному на адрес (5); GEN-05 — NCOC, TCO, KPO в 0008 и отметка (2, 5, 8); AUTH-06 — блокировка и роль (6); AUTH-07 — неактивность и возврат (7); MAN-01 — три согласия, NDA, ответ (3, 4); MAN-03 — профиль при пароле (3); MAN-05 — почту меняет только администратор, консоль Keycloak закрыта (6); FC-02 — время, версия, IP (2, 3); ADM-01 — приглашение (5, 8); ADM-02 — блокировка, последний вход (6, 8); ADM-03 — организации и major (5, 8); ADM-05 — смена почты (6, 8); ADM-06 — тесты ответов (5) и страницы (8); NOT-23 — без писем при пароле (3); NOT-24 — письмо приглашённому, `kk` (5); NOT-26 — сброс при неактивности, статус актуальности не меняется (7), NOT-02/NOT-03 — уже покрыты этапом А. Релиз contract — задача 1.
- **Согласованность имён.** `ndaVersion`/`ndaAcceptance` (2) → онбординг и регистрация (3); `registration*` (2) пишет 3 и очищает 3; `provision` (3) → `invite` (5); `INVITABLE_ROLES` (5) → `changeRole` (6) и диалоги (8); `updateUser`/`logoutUser` (6) → `sendInactivityReset` (7); `inactiveSince` (2) → `unblock` (6), `run`/`reactivateAfterReset` (7); `onPasswordSet(accountId, origin, at)` с `AdataReadOrigin` — одинаково в 3 и в вызовах из `keycloakEvents` и `callback`.
- **Review Focus.** Пять пунктов — тесты в задачах 3, 6, 5, 3 и 2; сверх списка — гонка входа и неактивности (7) и сбой постановки чтения (3).
- **Пропорция.** Код дан только там, где сигнатура и тест не определяют его: SQL 0006 и 0008, правило трёх месяцев, точные тексты заглушек; остальное — сигнатуры, таблицы маршрутов и имена тестов.
- **Открытые вопросы, с которыми этап сталкивается, и поведение до ответа:** 4 — принятие у аккаунта (расхождение 2); 5 и Р-5 — заглушка версии 1 через seed (3); 24 — принимается текст платформы; 31 — термины меню не меняются; Р-2 — новые имена по DBML, старые таблицы не переименовываются (8); новые — версии условий и политики (5), письма при смене почты (13), объём смены роли (14), состояние после разблокировки (15).
