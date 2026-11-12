# Демо по ролям: страница компании, профиль производителя, очередь SME, аккаунты — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** к демо 12.11.2026 на dev-стенде — четыре экрана только для чтения на демо-данных: страница компании из каталога (оператор, наблюдатель, директор, SME), собственный профиль производителя вместо заглушки, очередь SME, список организаций и аккаунтов для администратора. Права проверяет сервер, на каждый экран есть тесты.

**Architecture:** каждый экран — тонкий честный срез будущего этапа (страница компании — этап 6, профиль — этап 3, очередь — этап 5, аккаунты — этап 1): эндпоинт под существующим действием `POLICY_MATRIX` со scope из матрицы, ответ — zod-схема в `@imbc/contracts`, страница — ленивый маршрут под `AppShell`, пункт меню по `can(role, action)`, шлюз страницы — в `destinationFor`. Страница компании читает только `catalog_visible` (контакты — из её колонки `card`); остальные три экрана читают рабочие таблицы `organizations`, `user_accounts`, `manufacturer_profiles` — это не каталог, правило проекции к ним не относится. **Матрица прав, схема БД и миграции не меняются.**

**Tech Stack:** TypeScript, zod 4, NestJS 12, Drizzle ORM, PostgreSQL 18, React 19 + Vite, React Router 8, TanStack Query, use-intl, shadcn/ui на Base UI, vitest.

**Spec:** `docs/analyst/2026-11-11/specification-v1.3.md` — раздел 4 (GEN-08, GEN-11, GEN-13 и таблица), 5.3 (MAN-41, MAN-46), 6.1 (REV-01, REV-04), 6.3, 6.9 (ADM-02, ADM-06), 6.10 (IMBC-22), 7.2 (OPR-09…OPR-12); `docs/development-roadmap.md`, этапы 1, 3, 5, 6.

## Global Constraints

- Ветка `feat/spec-v1.3-contracts`, основная рабочая копия. Задачи выполняются по порядку 1 → 4, каждая отдельно отгружаема: один коммит с ID требований в сообщении, без `git push` и деплоя. Конец задачи — зелёные `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, набор API с `TEST_DATABASE_URL` (PostgreSQL 18, раздел 14 `README.md`) и `pnpm check:requirements`.
- Только чтение: ни одного POST/PUT/PATCH/DELETE. Нет правки, загрузок, решений проверки, действий с аккаунтами, выгрузок, темы Keycloak.
- `packages/contracts/src/policy.ts` и снимок матрицы в `packages/contracts/test/contracts.test.ts` не меняются. Нет миграций и правок `apps/api/src/database/schema/*`.
- Seed остаётся идемпотентным (upsert по `organizations.bin` / `manufacturer_profiles.organization_id` / `lower(email)`); меняется только в задачах 1 и 3, ожидания `seed.integration.test.ts` правятся там же.
- Новые защищённые пути web шлюзуются в одной функции `destinationFor` (`packages/contracts/src/auth.ts`) с тестами в `packages/contracts/test/auth.test.ts` и `apps/web/test/app-shell.test.tsx`. Механизм — тот, что уже есть в `destinationFor` на момент задачи: страница закрывает и свой точный путь, и вложенные (`/companies`, `/companies/<id>`), путь сравнивается декодированным, как у роутера. Второго механизма рядом не заводить: новые пути добавляются в тот же список страниц.
- Стартовые страницы (решение контроллера для демо 12.11, обратимо одной строкой): SME — `/reviews` (задача 3), администратор — `/admin/accounts` (задача 4); спецификация их не задаёт (OPR-31 — только оператор, наблюдатель, директор). Меняется таблица `ROLE_HOME` в `packages/contracts/src/auth.ts` и её тесты (`packages/contracts/test/auth.test.ts`, `apps/api/test/start-page.test.ts`, `apps/web/test/app-shell.test.tsx`, `auth-navigation.test.ts`); у остальных ролей — без изменений.
- Web — по `apps/web/AGENTS.md`: компоненты только из `src/components/ui` (новых нет: `Card`, `Table`, `Badge`, `Skeleton`, `Empty`, `Alert`, `Select`, `Separator` уже есть), один `PageTitle` на страницу, даты и числа через `useFormat`, ссылка-кнопка — `<Link className={buttonVariants(...)}>`, состояния загрузки/пусто/ошибка — как в каталоге (`Skeleton`, `Empty`, `Alert` + `common.retry`). Тексты — в `apps/web/messages/{en,kk,ru}.json`, наборы ключей совпадают (`messages.test.ts`); английский — источник, казахский — коротко, на проверку носителю.
- Ответы API уже `Cache-Control: no-store` — ничего не добавлять. Адреса и токены Adata не трогаются.
- ID в комментариях, тестах и коммитах — только из списка Spec выше и уже проверенные в тексте; `pnpm check:requirements` падает на несуществующем ID.

## Review Focus

1. Наблюдатель не получает focal point **в ответе API** (ключа нет), а не только на экране (GEN-13, OPR-09). Тест — задача 1.
2. Профиль, не попавший в проекцию (не Verified или due diligence red), по прямому адресу `/companies/:id` — 404 для любой роли, без утечки о его существовании.
3. Ответ администратору не содержит ничего из профиля: ни статуса, ни БИН, ни названий секций (ADM-06). Тест — задача 4.
4. `/admin/accounts` не подсвечивает пункт «Мой аккаунт»: `isActive` в меню — `pathname.startsWith(href)`, поэтому путь выбран не `/accounts`.
5. Отказ по матрице — 403 problem+json и запись в аудит через настоящий `SessionGuard`, а не через заглушку.

---

### Task 1: страница компании (этап 6; OPR-06, OPR-09, OPR-10, OPR-11, OPR-12, GEN-13, IMBC-22)

**Files:** `packages/contracts/src/company.ts` (новый) + `index.ts`; `packages/contracts/src/auth.ts`; `packages/contracts/test/{contracts,auth}.test.ts`; `apps/api/src/modules/catalog/catalog.{controller,service}.ts`; `apps/api/src/database/seed.ts`; `apps/api/test/support/http.ts` (новый); `apps/api/test/company.http.test.ts`, `catalog.integration.test.ts`, `seed.integration.test.ts`; `apps/web/src/router.tsx`, `src/routes/app/company.tsx` (новый), `catalog-view.tsx`, `src/components/app/app-shell.tsx`; `apps/web/messages/*.json`; `apps/web/test/company.test.tsx` (новый), `app-shell.test.tsx`.

**Interfaces.** `GET /api/v1/catalog/companies/:profileId`, `@Can('catalog.search')` — оператор и наблюдатель `visible`, SME и директор `all`; производитель и администратор — 403. Проекция содержит только видимые профили, поэтому при любом scope строка ищется только в `catalog_visible`; `all` (профили вне проекции для SME и директора) — этап 6, здесь такой профиль — 404 `not_found` для всех. `:profileId` разбирается `parseOrThrow(z.uuid())` → 400. Сервис получает `auth.user.role` и кладёт `focalPoint` в ответ только если `can(role, 'focal_point.read')`; у наблюдателя ключа нет.

```ts
// packages/contracts/src/company.ts
export const companyContactSchema = z.object({ fullName: z.string(), position: z.string(), email: z.string(), phone: z.string() });
/** Форма jsonb catalog_visible.card — seed пишет её, сервис разбирает safeParse, иначе поля пустые. */
export const companyCardDataSchema = z.object({ companyPhone: z.string().nullable(), companyEmail: z.string().nullable(), focalPoint: companyContactSchema.nullable() });
export const companyPageSchema = z.object({
  profileId: z.uuid(), bin: z.string(), nameEn: z.string(), nameRu: z.string(),   // catalog_visible.*
  region: z.string(), commodityGroups: z.array(z.enum(COMMODITY_GROUPS)),          // .region, .commodity_groups
  tnvedCodes: z.array(z.string()), mainTnved: z.string().nullable(), headcountTotal: z.number().int().nullable(),
  certificates: z.array(z.object({ type: z.string(), validUntil: z.iso.date().nullable() })), // certificate_types × certificates_valid_until
  siteSurveyed: z.boolean(), tier: z.enum(PROFILE_TIERS), unifiedRegister: z.boolean(),
  worksWithCount: z.number().int().min(0).max(3), updateStatus: z.enum(UPDATE_STATUSES),
  pendingChanges: z.boolean(), verifiedAt: z.string(),
  companyPhone: z.string().nullable(), companyEmail: z.string().nullable(),          // card.companyPhone/Email (префилл, видит и наблюдатель)
  focalPoint: companyContactSchema.nullable().optional(),                            // card.focalPoint; ключа нет без focal_point.read
});
```

Шлюз web: в `auth.ts` страница `/companies` с действием `catalog.search` добавляется в существующий список защищённых страниц `destinationFor` (он закрывает и вложенные пути — см. Global Constraints).

**Page** `/companies/:profileId` (handle title `company.title`), ленивый маршрут в `AppShell`. Порядок: ссылка «Назад к каталогу» (`/catalog` + сохранённый `search` из `location.state.from`, иначе `/catalog`); `h1` — название на языке интерфейса (en → `nameEn`, kk/ru → `nameRu`), под ним второе название; `PageTitle` с тем же названием (во время загрузки — `company.title`); бейджи тира (`catalog.tierValue.*`), статуса актуальности (`catalog.status.*`), при `pendingChanges` — `company.pending` (OPR-11). Карточка «Реквизиты»: БИН, регион, численность, товарные группы, коды ТН ВЭД (основной первым), единый реестр, верификация (`format.date`). Карточка «Сертификаты»: таблица тип / действует до, пусто — `company.noCertificates`. Карточка «Сведения IMBC»: обследование площадки да/нет, «{count} из 3» крупных операторов (OPR-10). Карточка «Контакты»: телефон и email компании — всем; focal point — только если `can(role,'focal_point.read')` и ключ есть в ответе. Наблюдатель видит те же карточки без строки focal point — так матрица видна на экране. Ошибка 404 — `Empty` с `company.notFound` и ссылкой в каталог; сбой — `Alert` + `common.retry`. В каталоге имя компании в строке — `Link` на `/companies/${profileId}` с `state={{ from: search }}` (OPR-06). Меню — без нового пункта; пункт «Каталог» активен и на `/companies/*`.

**Seed:** у восьми строк `catalog_visible` поле `card` (было `{ demo: true }`) — `{ companyPhone: '+7 700 000 00 0<i+1>', companyEmail: 'info@company<i+1>.demo.local', focalPoint: { fullName: <вымышленное ФИО>, position: 'Коммерческий директор', email: 'focal@company<i+1>.demo.local', phone: '+7 701 000 00 0<i+1>' } }`; у «Тест Химия» `focalPoint: null` (пустое состояние). Число строк не меняется: `seed.integration.test.ts` получает одно новое ожидание.

**Translations** (`company.*`; en / ru / kk):
`title` Company page / Страница компании / Компания беті · `back` Back to catalog / Назад к каталогу / Каталогқа оралу · `details` Company details / Реквизиты / Деректемелер · `bin` BIN / БИН / БСН · `region` Region / Регион / Өңір · `headcount` Headcount / Численность персонала / Қызметкерлер саны · `groups` Commodity groups / Товарные группы / Тауар топтары · `tnved` HS (TN VED) codes / Коды ТН ВЭД / СЭҚ ТН кодтары · `unifiedRegister` In the unified register / В едином реестре / Бірыңғай тізілімде · `verifiedAt` Verified on / Дата верификации / Верификация күні · `certificates` Certificates / Сертификаты / Сертификаттар · `certType` Type / Тип / Түрі · `validUntil` Valid until / Действует до / Жарамдылық мерзімі · `noCertificates` No certificates / Сертификатов нет / Сертификат жоқ · `imbc` IMBC information / Сведения IMBC / IMBC мәліметтері · `siteSurveyed` Site survey / Обследование площадки / Алаңды тексеру · `worksWith` Major operators working with the company / Крупные операторы, работающие с компанией / Компаниямен жұмыс істейтін ірі операторлар · `worksWithValue` {count} of 3 / {count} из 3 / 3-тен {count} · `pending` Changes are awaiting IMBC verification / Изменения ожидают проверки IMBC / Өзгерістер IMBC тексеруін күтуде · `contacts` Contacts / Контакты / Байланыс · `companyPhone` Company phone / Телефон компании / Компания телефоны · `companyEmail` Company email / Email компании / Компания email-і · `focalPoint` Focal point / Контактное лицо (focal point) / Байланыс тұлғасы (focal point) · `notProvided` Not provided / Не указано / Көрсетілмеген · `notFound` The company was not found or is not available to you. / Компания не найдена или недоступна. / Компания табылмады немесе қолжетімсіз. · `loadError` Could not load the company page. / Не удалось загрузить страницу компании. / Компания бетін жүктеу мүмкін болмады.

- [ ] **Шаг 1. Контракт и шлюз (тесты сначала).** `contracts.test.ts`: «страница компании: focalPoint необязателен, card без полей отклоняется» — `companyPageSchema` принимает объект без `focalPoint`, `companyCardDataSchema.safeParse({ demo: true }).success === false`. `auth.test.ts`: «/companies/<id>: открыт ролям с catalog.search, производитель и администратор уходят на стартовую (GEN-08)» — по `ROLES` `destinationFor(role, '/companies/x?y')` = сам адрес при `can(role,'catalog.search')`, иначе `roleHome(role)`; `/companies` без id закрыт так же: ролям без `catalog.search` — стартовая, остальным — сам адрес (маршрута нет, «не найдено»).
- [ ] **Шаг 2. Общий HTTP-стенд прав.** `apps/api/test/support/http.ts`: `startHttp({ controllers, providers })` поднимает Nest с настоящим `SessionGuard` как `APP_GUARD`, `ProblemDetailsFilter`, `configureHttp`; `SessionService.resolve` — заглушка, cookie `imbc-session=<role>` даёт `AuthContext` этой роли (форма — как `auth()` в `guards.test.ts`, `organizationId` задаётся тестом), `AuditService.record` — `vi.fn()`, `ENV` — `{ SESSION_COOKIE_NAME, PUBLIC_URL }`. Возвращает `{ base, audit, close }` и `get(path, role)`. Используется задачами 1–4.
- [ ] **Шаг 3. API.** `company.http.test.ts` (сервис — заглушка, проверяется граница): «оператор — 200 и focalPoint (OPR-09)», «наблюдатель — 200, ключа focalPoint нет, телефон и email компании есть (GEN-13)» — сервис вызывается с ролью и отдаёт ответ по ней; «производитель и администратор — 403 problem+json, отказ в аудите, сервис не вызван (GEN-08)»; «не uuid — 400»; «нет в проекции — 404 not_found». `catalog.integration.test.ts`: «страница компании читает проекцию: профиль вне catalog_visible — 404, unresponsive — 200 (UPD-04)», «наблюдателю сервис не отдаёт focalPoint, оператору отдаёт», «card старой формы — контакты null, ответ проходит companyPageSchema». Затем `CatalogService.company(profileId, role)` и метод контроллера.
- [ ] **Шаг 4. Seed.** Поле `card` как выше; `seed.integration.test.ts`: «card каждой видимой строки проходит companyCardDataSchema, focal point есть у семи из восьми» (после первого и повторного запуска). Счётчики `{ organizations: 11, accounts: 6, visible: 8 }` не меняются.
- [ ] **Шаг 5. Web.** `company.test.tsx` (`renderRoute` + `stubApi`, `/api/auth/me` по роли): «оператор видит реквизиты, сертификаты, тир, статус и focal point»; «наблюдатель: телефон и email компании есть, focal point нет (GEN-13)»; «pending changes — отметка (OPR-11)»; «дата верификации через useFormat на kk»; «404 — пусто со ссылкой в каталог, сбой — сообщение и повтор (OPR-08)»; «ровно один заголовок вкладки — название компании»; «ссылка из строки каталога ведёт на /companies/:id, «Назад» возвращает фильтры» (в `catalog.test.tsx`). `app-shell.test.tsx`: «производитель на /companies/x уходит на /profile, администратор — на /account». Затем страница, маршрут, ссылка в каталоге, переводы.
- [ ] **Шаг 6.** Полная проверка; строка в `README.md` §9 («страница компании — `/companies/:id`, только проекция»); коммит `Страница компании из каталога только для чтения; наблюдатель без focal point (OPR-09, OPR-10, GEN-13)`.

---

### Task 2: собственный профиль производителя (этап 3; MAN-41, MAN-46, GEN-11, IMBC-22)

**Files:** `packages/contracts/src/profile.ts` (новый) + `index.ts`; `apps/api/src/modules/profiles/profiles.{controller,service}.ts` (контроллер новый, регистрируется в `app.module.ts`); `apps/api/test/profile.http.test.ts`, `profile.integration.test.ts` (новые); `apps/web/src/routes/app/profile.tsx`; `apps/web/messages/*.json`; `apps/web/test/profile.test.tsx` (новый).

**Interfaces.** `GET /api/v1/profiles/own`, `@Can('profile.read')`. Профиль ищется только по `auth.user.organizationId` — чужой id в запросе не принимается вовсе (GEN-11). У производителя scope `own`; у SME и директора (`all`) в организации IMBC профиля нет → 404 `not_found`; оператор, наблюдатель, администратор — 403.

```ts
export const ownProfileSchema = z.object({
  profileId: z.uuid(),                              // manufacturer_profiles.id
  organizationName: z.string(), bin: z.string(),    // organizations.name, .bin
  status: z.enum(PROFILE_STATUSES),                 // manufacturer_profiles.status (MAN-46)
  hasPendingChanges: z.boolean(),                   // .has_pending_changes
  updateStatus: z.enum(UPDATE_STATUSES).nullable(), // .update_status: только после верификации (раздел 5.5)
  tier: z.enum(PROFILE_TIERS).nullable(),           // null, если не verified; иначе catalog_visible.tier, при отсутствии строки — tier_1
  completenessPct: z.number().int().min(0).max(100),// .completeness_pct (MAN-41)
  registeredAt: z.string(), verifiedAt: z.string().nullable(),
});
```

Тир читается из проекции, потому что site surveyed хранится только там (записей `site_survey_records` в seed нет); это чтение одной строки своего профиля, не каталог.

**Page** `/profile` (шлюз `profile.edit` уже есть): `PageTitle` и `h1` «Профиль компании»; карточка — название, БИН; статус профиля бейджем (`profile.statusValue.*`), при `hasPendingChanges` — `profile.pendingChanges`; полнота «{pct} %» через `format.number`; статус актуальности (`catalog.status.*`) или `profile.notVerifiedYet`; тир (`catalog.tierValue.*`) или тот же текст; даты регистрации и верификации через `format.date`; подсказка `profile.readOnlyHint` и прежняя ссылка-кнопка на `/account`. Загрузка — `Skeleton`, сбой — `Alert` + `common.retry`. Ключ `profile.welcome` удаляется из трёх файлов, `accountHint` остаётся.

**Translations** (`profile.*`): `company` Company / Компания / Компания · `bin` BIN / БИН / БСН · `status` Profile status / Статус профиля / Профиль мәртебесі · `statusValue.draft` Draft / Черновик / Жоба · `statusValue.submitted` Submitted / Отправлен на проверку / Тексеруге жіберілді · `statusValue.under_review` Under review / На проверке / Тексерілуде · `statusValue.verified` Verified / Верифицирован / Верификацияланды · `statusValue.returned` Returned / Возвращён на доработку / Пысықтауға қайтарылды · `pendingChanges` Changes are awaiting IMBC verification / Изменения ожидают проверки IMBC / Өзгерістер IMBC тексеруін күтуде · `completeness` Completeness / Заполненность / Толтырылуы · `updateStatus` Update status / Статус актуальности / Өзектілік мәртебесі · `tier` Tier / Тир / Тир · `notVerifiedYet` Appears after verification / Появится после верификации / Верификациядан кейін көрсетіледі · `registeredAt` Registered on / Дата регистрации / Тіркелген күні · `verifiedAt` Verified on / Дата верификации / Верификация күні · `readOnlyHint` Editing the profile will be available in a later release. / Редактирование профиля появится в следующих версиях. / Профильді өңдеу келесі нұсқаларда қосылады. · `loadError` Could not load the profile. / Не удалось загрузить профиль. / Профильді жүктеу мүмкін болмады.

- [ ] **Шаг 1.** `contracts.test.ts`: «свой профиль: updateStatus и tier null до верификации». `profile.http.test.ts` (стенд из задачи 1): «производитель — 200, сервис вызван с его organizationId (GEN-11)»; «оператор, наблюдатель, администратор — 403 и аудит»; «SME без профиля в организации — 404». `profile.integration.test.ts`: «verified + site surveyed → tier_2, статус и полнота из manufacturer_profiles»; «draft — status draft, updateStatus и tier null»; «verified вне проекции — tier_1».
- [ ] **Шаг 2.** `ProfilesController` + `ProfilesService.own(organizationId)`; ответ проходит `ownProfileSchema.parse`.
- [ ] **Шаг 3.** `profile.test.tsx`: «демо-производитель видит компанию, БИН, Verified, актуальность и тир 2»; «draft — «Появится после верификации» вместо тира и статуса актуальности»; «pending changes — отметка»; «процент через useFormat»; «сбой — сообщение и повтор»; «ссылка на аккаунт — ссылка, не кнопка». Существующий тест «наблюдатель на /profile уходит на стартовую» в `app-shell.test.tsx` остаётся зелёным.
- [ ] **Шаг 4.** Проверка; строка в `README.md` §9; коммит `Профиль производителя только для чтения: статус, актуальность, тир (MAN-46, IMBC-22, GEN-11)`.

---

### Task 3: очередь SME (этап 5; REV-01, REV-04, MAN-43)

**Files:** `packages/contracts/src/review.ts` (новый) + `index.ts`, `auth.ts`; `apps/api/src/modules/reviews/reviews.{controller,service}.ts` (новые, в `app.module.ts`); `apps/api/src/database/seed.ts`; `apps/api/test/reviews.http.test.ts`, `reviews.integration.test.ts` (новые), `seed.integration.test.ts`; `apps/web/src/router.tsx`, `src/routes/app/reviews.tsx` (новый), `app-shell.tsx`; `apps/web/messages/*.json`; `apps/web/test/reviews.test.tsx` (новый), `app-shell.test.tsx`; `packages/contracts/test/auth.test.ts`.

**Interfaces.** `GET /api/v1/reviews/queue?status=`, `@Can('review.take')` (только SME, `all`). Очередь — профили в `submitted` и `under_review` плюс `verified` с `has_pending_changes` (REV-03, MAN-43: разблокированный уходит из очереди, draft и returned в неё не входят). Фильтр `status` — CSV из `QUEUE_STATUSES = ['submitted','under_review','pending_changes']`; сортировка — `registered_at`, затем `id`. Фильтры по SME и дате получения (REV-04) — этап 5.

```ts
export const reviewQueueFilterSchema = z.object({ status: csv(z.enum(QUEUE_STATUSES)) }); // csv — общий помощник из catalog.ts, экспортировать
export const reviewQueueItemSchema = z.object({
  profileId: z.uuid(), organizationName: z.string(), bin: z.string(), // manufacturer_profiles.id, organizations.name/.bin
  status: z.enum(PROFILE_STATUSES), hasPendingChanges: z.boolean(),    // .status, .has_pending_changes
  assignedExpert: z.string().nullable(),                               // user_accounts.full_name ?? email по assigned_expert_id
  registeredAt: z.string(),                                            // .registered_at
});
export const reviewQueueSchema = z.object({ items: z.array(reviewQueueItemSchema), total: z.number().int() });
```

Шлюз web: `GUARDED_PAGES` + `['/reviews', 'review.take']`. Стартовая страница SME — `/reviews`: `ROLE_HOME.expert` и тесты стартовых страниц (сервер и web); после входа SME попадает в очередь, пункт «Очередь проверки» в меню — первым.

**Page** `/reviews` (handle `reviews.title`): `h1`, фильтр статуса — `Select` в адресе через nuqs (как фильтры каталога), таблица: производитель (название + БИН), статус бейджем (`profile.statusValue.*`, при pending changes — `reviews.pendingChanges`), назначенный SME или `reviews.unassigned`, дата регистрации (`format.date`). Строки без ссылок: открытие профиля — этап 5. Состояния: `Skeleton`, `Empty` (`reviews.empty`), `Alert` + `common.retry`. Меню: пункт «Очередь проверки», иконка `ClipboardListIcon`, `show: !!can(role, 'review.take')`, перед «Каталогом» (у SME он первый).

**Seed:** после цикла `PEOPLE` — четыре организации-производителя `demoBin(9…12)` без строк в `catalog_visible` и без аккаунтов: «ТОО «Жаңа Демо Құрылыс»» `submitted`, «ТОО «Демо Агро Өнім»» `submitted`, «ТОО «Демо Электро Монтаж»» `under_review` с `assigned_expert_id` = аккаунт `expert@imbc.local` (ищется по email), «ТОО «Демо Жоба»» `draft` (не в очереди). Upsert профиля задаёт `status` и `assigned_expert_id` при каждом запуске. `seed.integration.test.ts`: `organizations: 11 → 15`, `accounts: 6`, `visible: 8`; новое — «очередь seed: два submitted, один under_review у эксперта, draft вне проекции».

**Translations** (`reviews.*`; `nav.reviews`): `nav.reviews` Review queue / Очередь проверки / Тексеру кезегі · `title` Profile review queue / Очередь проверки профилей / Профильдерді тексеру кезегі · `manufacturer` Manufacturer / Производитель / Өндіруші · `status` Status / Статус / Мәртебе · `assignee` SME / Эксперт / Сарапшы · `unassigned` Not assigned / Не назначен / Тағайындалмаған · `registeredAt` Registered / Зарегистрирован / Тіркелген · `pendingChanges` Pending changes / Ожидающие изменения / Күтудегі өзгерістер · `statusFilter` Status / Статус / Мәртебе · `statusAll` All / Все / Барлығы · `found` {count, plural, one {{total} profile} other {{total} profiles}} / {count, plural, one {{total} профиль} few {{total} профиля} many {{total} профилей} other {{total} профиля}} / {count, plural, other {{total} профиль}} · `empty` The queue is empty. / Очередь пуста. / Кезек бос. · `loadError` Could not load the queue. / Не удалось загрузить очередь. / Кезекті жүктеу мүмкін болмады.

- [ ] **Шаг 1.** `auth.test.ts`: «/reviews — только SME, остальные на стартовую». `reviews.http.test.ts`: «SME — 200»; «директор, администратор, оператор, наблюдатель, производитель — 403 и аудит (GEN-08)»; «неизвестный статус — 400». `reviews.integration.test.ts`: «в очереди submitted, under_review и verified с pending changes; draft и returned — нет (REV-01, MAN-43)»; «фильтр status=submitted»; «назначенный SME — имя из user_accounts».
- [ ] **Шаг 2.** Контракт, `ReviewsService.queue(filter)`, контроллер; seed и его тест.
- [ ] **Шаг 3.** `reviews.test.tsx`: «SME видит четыре колонки, «Не назначен» у свободных»; «фильтр статуса в адресе уходит в API»; «пусто отличается от сбоя»; «дата через useFormat». `app-shell.test.tsx`: «меню SME: очередь проверки, каталог, аккаунт»; «директор на /reviews уходит на /dashboard»; «SME после входа и с закрытой страницы попадает на /reviews».
- [ ] **Шаг 4.** Проверка; строка в `README.md` §10; коммит `Очередь SME только для чтения (REV-01, REV-04)`.

---

### Task 4: организации и аккаунты для администратора (этап 1; ADM-02, ADM-06)

**Files:** `packages/contracts/src/admin.ts` (новый) + `index.ts`, `auth.ts`; `apps/api/src/modules/admin/accounts.{controller,service}.ts` (новые, в `app.module.ts`); `apps/api/test/accounts.http.test.ts`, `accounts.integration.test.ts` (новые); `apps/web/src/router.tsx`, `src/routes/app/admin-accounts.tsx` (новый), `app-shell.tsx`; `apps/web/messages/*.json`; `apps/web/test/admin-accounts.test.tsx` (новый), `app-shell.test.tsx`; `packages/contracts/test/auth.test.ts`.

**Interfaces.** `GET /api/v1/admin/accounts`, `@Can('accounts.manage')` (только администратор, `all`). Читает только `organizations` и `user_accounts`; `manufacturer_profiles` и проекцию не трогает (ADM-06). БИН не отдаётся: для списка он не нужен, а у производителя это реквизит профиля.

```ts
export const adminAccountSchema = z.object({
  id: z.uuid(), email: z.string(), fullName: z.string().nullable(), // user_accounts.*
  role: z.enum(ROLES), state: z.enum(ACCOUNT_STATES),
  lastSignInAt: z.string().nullable(),                              // .last_sign_in_at (ADM-02)
});
export const adminOrganizationSchema = z.object({
  id: z.uuid(), name: z.string(), type: z.enum(ORGANIZATION_TYPES), isMajorOperator: z.boolean(), // organizations.*
  accounts: z.array(adminAccountSchema),
});
export const adminAccountsSchema = z.object({ organizations: z.array(adminOrganizationSchema) }).strict();
```

Порядок: по типу (`imbc`, `operator`, `observer`, `manufacturer`), затем по имени; аккаунты — по email. Организации без аккаунтов (демо-производители задачи 3) тоже в списке.

Шлюз web: `GUARDED_PAGES` + `['/admin/accounts', 'accounts.manage']`. Стартовая страница администратора — `/admin/accounts`: `ROLE_HOME.administrator` и тесты стартовых страниц (сервер и web); пункт «Аккаунты» в меню — первым.

**Page** `/admin/accounts` (handle `adminAccounts.title`): `h1`; на каждую организацию — `Card`: название, тип (`adminAccounts.typeValue.*`), бейдж «Крупный оператор»; внутри — `Table`: email, имя, роль (`roles.*`), состояние (`adminAccounts.stateValue.*`), последний вход (`format.dateTime` либо `adminAccounts.never`); без аккаунтов — `adminAccounts.noAccounts`. Действий нет. Состояния — как в каталоге. Меню: «Аккаунты», иконка `UsersIcon`, `show: !!can(role, 'accounts.manage')`, перед «Мой аккаунт».

**Translations** (`adminAccounts.*`; `nav.adminAccounts`): `nav.adminAccounts` Accounts / Аккаунты / Аккаунттар · `title` Organisations and accounts / Организации и аккаунты / Ұйымдар мен аккаунттар · `typeValue.imbc` IMBC / IMBC / IMBC · `typeValue.operator` Operator / Оператор / Оператор · `typeValue.observer` Observer / Наблюдатель / Бақылаушы · `typeValue.manufacturer` Manufacturer / Производитель / Өндіруші · `majorOperator` Major operator / Крупный оператор / Ірі оператор · `email` Email / Email / Email · `name` Name / Имя / Аты · `role` Role / Роль / Рөлі · `state` State / Состояние / Күйі · `stateValue.invited` Invited / Приглашён / Шақырылған · `stateValue.active` Active / Активен / Белсенді · `stateValue.inactive` Inactive / Неактивен / Белсенді емес · `stateValue.blocked` Blocked / Заблокирован / Бұғатталған · `lastSignIn` Last sign-in / Последний вход / Соңғы кіру · `never` Never / Не входил / Кірмеген · `noAccounts` No accounts / Аккаунтов нет / Аккаунт жоқ · `empty` No organisations. / Организаций нет. / Ұйым жоқ. · `loadError` Could not load accounts. / Не удалось загрузить аккаунты. / Аккаунттарды жүктеу мүмкін болмады.

- [ ] **Шаг 1.** `auth.test.ts`: «/admin/accounts — только администратор». `accounts.http.test.ts`: «администратор — 200»; «SME, директор, оператор, наблюдатель, производитель — 403 и аудит (GEN-08)». `accounts.integration.test.ts` (на seed): «15 организаций, 6 аккаунтов, last sign-in null у невошедших (ADM-02)»; «в ответе нет ключей профиля: status, bin, updateStatus, tier, completenessPct — `adminAccountsSchema.strict()` и проверка ключей каждого объекта (ADM-06)». Если задача 3 ещё не сделана — 11 организаций: число берётся из seed, не пишется вручную.
- [ ] **Шаг 2.** Контракт, `AccountsService.list()`, контроллер.
- [ ] **Шаг 3.** `admin-accounts.test.tsx`: «организации по типам, роли и состояния переведены»; «последний вход через useFormat, «Не входил» без даты»; «организация без аккаунтов — «Аккаунтов нет»»; «пусто и сбой различаются». `app-shell.test.tsx`: «меню администратора: аккаунты и мой аккаунт; на /admin/accounts активен только пункт «Аккаунты»»; «SME на /admin/accounts уходит на свою стартовую /reviews»; «администратор с закрытой страницы (например /companies/x) попадает на /admin/accounts» — ожидание теста задачи 1 про `/account` правится здесь.
- [ ] **Шаг 4.** Проверка; строка в `README.md` §10; коммит `Организации и аккаунты для администратора только для чтения (ADM-02, ADM-06)`.

---

## Стартовые страницы

Спецификация стартовые страницы SME и администратора не задаёт (OPR-31 — только оператор, наблюдатель, директор). Для демо 12.11 контроллер решил: SME стартует в `/reviews`, администратор — в `/admin/accounts` (задачи 3 и 4); владелец может вернуть прежние одной строкой в `ROLE_HOME`.

## Чего экраны пока не показывают

- Страница компании: сертификаты без номера, органа и файла (в проекции только тип и срок), нет дат регистрации и обследования площадки, последней проверки due diligence, enhanced due diligence, остальных контактов и документов (OPR-09, OPR-10 — этап 6); tier 3 продуктов нет (данных AGAR/CDP нет), поэтому `tier.read_products` не демонстрируется.
- Профиль производителя: секции и их статусы, документы (MAN-46 — этап 3).
- Очередь SME: дата получения и фильтры по SME и дате (REV-04) — нет отправок с `submitted_at` (этап 5).
- Аккаунты: последний вход пуст у демо-аккаунтов, пока они не вошли; приглашение, блокировка — этап 1.

## Self-review

- Четыре задачи, каждая со своим эндпоинтом, действием из существующей матрицы, zod-схемой, страницей, переводами en/ru/kk и тестами разрешения и отказа на HTTP-границе через настоящий `SessionGuard`.
- Матрица, схема БД, миграции не меняются; seed — только `card` (задача 1) и четыре профиля очереди (задача 3), ожидания seed-теста указаны.
- Страница компании читает только `catalog_visible`; ограничение наблюдателя видно на данных `card`.
- Новые пути шлюзуются в `destinationFor`; `/admin/accounts` не конфликтует с `isActive` пункта `/account`.
- Все ID проверены по тексту спецификации: GEN-08, GEN-11, GEN-13, MAN-41, MAN-43, MAN-46, REV-01, REV-03, REV-04, ADM-02, ADM-06, IMBC-22, OPR-06, OPR-08…OPR-12, UPD-04. DATA-35 из комментария схемы `catalog_visible.card` в v1.3 нет — не цитировать.
