# Этап 2 — справочники, файлы, основа уведомлений — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** администратор IMBC ведёт двенадцать справочников ADM-08 с переводами (обязательность типов сертификатов и документов, вывод из оборота вместо удаления используемого) и загружает образец оргструктуры; любой файл платформы проходит один путь — проверка типа по содержимому, карантин, ClamAV, рабочий бакет — и отдаётся только через API после проверки прав записи-владельца; письма платформы уходят по правилам-данным с журналом `notification`: одно письмо на адрес, язык получателя, без наблюдателей, тексты в языковых файлах (включая NOT-01 в теме писем Keycloak).

**Architecture:** три модуля поверх схемы DBML. Справочники — таблицы `dictionary`, `dictionary_entry`, `dictionary_entry_translation`; наполнение — JSON-файлы в репозитории (`apps/api/reference-data`), которые `migrate` (списки спецификации) и `seed` (временные значения стенда) загружают идемпотентно, только добавляя; администратор правит значения через `/api/v1/dictionaries` с поиском и страницами на сервере. Файлы — `file_object` + `file_version`; API кладёт байты в карантинный бакет за интерфейсом `ObjectStorage` и в той же транзакции, что строки, ставит `file-scan`; worker проверяет через интерфейс `Antivirus` (clamd) и переносит чистое в рабочий бакет; скачивание — только `GET /api/v1/files/:id/content`, решение — правило назначения файла (`FILE_READ_RULES`), выведенное из матрицы. Уведомления — `notification_rule` (17 правил NOT-01…NOT-17, получатели — данные) и журнал `notification`: событие ставит задание `notify` с одними id, worker разрешает получателей, отбрасывает наблюдателей, сводит адреса без учёта регистра, выбирает язык и отправляет каждому адресу ровно один раз (запись журнала и отправка — одна транзакция).

**Tech Stack:** TypeScript, zod 4, NestJS 12 (multer 2.5 через `@nestjs/platform-express`), Drizzle ORM 0.45 / drizzle-kit, PostgreSQL 18 (`pg_trgm`), pg-boss 12, AWS SDK S3 (RustFS), clamd INSTREAM, nodemailer, `file-type` (новая зависимость API), Keycloak 26.4 + Keycloakify 11.16.4, React 19 + Vite, TanStack Query, nuqs, use-intl, shadcn/ui на Base UI (`base-nova`), vitest.

**Spec:** `docs/analyst/2026-11-11/specification-v1.3.md` — раздел 4 (GEN-08, GEN-09, строка «Reference lists, NDA versions, organisation-chart sample»), 5.2 (MAN-09, MAN-10, MAN-11, MAN-13, MAN-19, MAN-23, MAN-24, MAN-25 «10-digit TN VED», MAN-28, MAN-29, MAN-34, MAN-36…MAN-39 — откуда берутся списки и файлы), 6.3 (абзац о статусах документов и скане), 6.9 (ADM-06, ADM-08, ADM-09, ADM-11), 8.1 (AUTH-01, AUTH-03, AUTH-04), 8.2 (вводный абзац о ящике IMBC; NOT-18…NOT-21; таблица NOT-01…NOT-17; NOT-23, NOT-24, NOT-26), 8.3 (LANG-01, LANG-02, LANG-05), 8.4 (AUD-01), 9.1 (записи «Certificate, document», «Reference lists»; DATA-02…DATA-07), 11.4 (NFR-09), NFR-06. DBML `docs/analyst/2026-11-11/imbc-platform.dbml`: `dictionary`, `dictionary_entry`, `dictionary_entry_translation`, `file_object`, `file_version`, `org_chart_sample`, `notification_rule`, `notification`, перечисления `data_class`, `file_purpose`, `scan_state`, `language_code`; заметки к `certificate`, `document`, `personnel`. `docs/development-roadmap.md` — §3, §4.1 (Р-2), «Этап 2», §7, §9. Прототип: `.claude/worktrees/proto/apps/web/src/prototype/administrator/references.tsx`, `shared/reference-list-view.tsx`, `data/references.ts` (ветка прототипа, только чтение).

## Нумерация миграций

На стенде (`demo/prototype-cabinets`) применены `0000`–`0005`; `0006`–`0008` этапа 1 выкачены 13.11.2026 (`306b58e`; ветка `feat/stage-1-accounts`, `f9d7ad7`). Этап добавляет **`0009_stage2_foundation`** (генерируется, задача 1) — expand: новые типы и таблицы; **`0010_stage2_reference_data`** (рукописная, задача 1) — данные: двенадцать справочников, семнадцать правил, перенос `notifications_sent` в `notification`. Ни одна миграция этапа не удаляет и не меняет существующее. Предыдущая версия приложения для NFR-06 — этап 1 (`306b58e` на стенде): её код пишет `notifications_sent` и читает скелетные `file_versions` — обе таблицы остаются до contract (см. «Чего этап не делает»).

## Расхождения и противоречия (прочитать до задач)

| № | Где расходятся | Решение плана (действует до решения владельца или Абая) | Цена, если неверно |
|---|---|---|---|
| 1 | NOT-21 «Observers receive none of these emails» против NOT-24 (наблюдатель получает NOT-01), AUTH-03 (код NOT-02), AUTH-04 (NOT-03). | Наблюдатель получает только письма аккаунта NOT-01, NOT-02, NOT-03 (`ACCOUNT_SECURITY_RULES`); NOT-04…NOT-17 ему не уходят ни по аккаунту, ни на адрес, совпадающий с логином наблюдателя. | Малая: одна константа. |
| 2 | Строка раздела 4 «…organisation-chart sample»: производителю «—»; MAN-19 и DBML `org_chart_sample` — «The file manufacturers may download». | Ведёт образец администратор (`reference.manage`), видят администратор и директор (`reference.read`); производитель (`profile.edit` own) скачивает только **текущий** образец. Матрица не меняется. | Малая: одно правило в `FILE_READ_RULES`. |
| 3 | Строка «Reference lists» — ведение списков; выбирать значения в профиле (MAN-10, MAN-11, MAN-23) и в фильтрах (OPR-02) будут производитель, SME, оператор. | `GET /api/v1/dictionaries/:code/choices` (только действующие, одно название) — любой вошедший пользователь, без действия матрицы; полный список с выведенными и обязательностью — `reference.read`. | Малая. |
| 4 | ADM-08 «maintains … commodity groups, contact roles» против MAN-23 («commodity group A–E»), OPR-02, OPR-32 (A–E) и MAN-13 (ровно management, technical, commercial); каталог ключуется перечислением `commodity_group`. | `CLOSED_DICTIONARIES = ['commodity_group','contact_role']`: коды заданы спецификацией, администратор меняет только названия и порядок (`409 dictionary_closed` на добавление, вывод, удаление). Перечисления PostgreSQL `commodity_group`, `contact_role` остаются до contract: `contact_role` — с заменой `contacts` на DBML `contact` (этап 3), `commodity_group` — с проекцией `catalog_profile` (этап 5). Коды справочников и значения перечислений сверяет тест. | Малая. |
| 5 | Классификаторы ОКЭД, ТН ВЭД, КПВЭД, регионы, типы товаров от IMBC не получены (roadmap §7). | Миграционная загрузка (`reference-data/release`, `status: "specification"`) несёт только списки, которые фиксирует спецификация: правовые формы (MAN-09), товарные группы A–E, роли контактов (MAN-13), типы сертификатов (MAN-34), типы документов (MAN-37, MAN-38, DBML `document`). Регионы, ОКЭД, ТН ВЭД, КПВЭД, типы товаров, процессы, типы оборудования — `reference-data/provisional` (`status: "provisional"`, только значения прототипа и seed) грузит **только** `seed` (`SEED_DEMO=true`): в продакшене эти семь списков пусты, пока IMBC не пришлёт перечни. | Малая: перечень IMBC — новый файл `status: "imbc"` в `release`. |
| 6 | ADM-08 «с переводами», а классификаторы обычно приходят без английского. | Форма администратора требует названия kk, ru, en; файл загрузки — хотя бы одно. Показ: язык пользователя → kk → ru → en → код (`entryDisplayName`). Временные файлы несут только то, что есть в прототипе (ru; у типов товаров — en), без придуманных переводов. | Малая. |
| 7 | Форматы кодов спецификация задаёт только для ТН ВЭД (MAN-25: 10 цифр). | `DICTIONARY_CODE_PATTERNS`: `tn_ved` `^\d{10}$`, `oked` `^\d{5}$`, `kpved` `^\d{2}(\.\d+)*$`, `commodity_group` `^[A-E]$`, остальные — буквы, цифры, пробел, `._-/`, 1–64 символа без пробела по краям. Код неизменяем; уникален в справочнике без учёта регистра. | Малая: одна строка шаблона. |
| 8 | DATA-04 «in use» — таблиц профиля DBML ещё нет; коды сейчас лежат текстом в `catalog_visible` и в скелетных `product_lines`, `certificates`, `documents`, `equipment_items`. | `DICTIONARY_USAGES` — реестр колонок, где хранится код; удаление проверяет его под блокировкой строки значения. С этапа 3 ссылки по внешнему ключу (`… _id → dictionary_entry.id`, `ON DELETE NO ACTION`) ловит и БД: `23503` → `409 entry_in_use`. | Малая. |
| 9 | ADM-09 «applies to profiles submitted afterwards». | Этап меняет только `dictionary_entry.mandatory` с аудитом; снимок обязательных типов при отправке (`submission_requirement`) — этап 3. Обязательное значение нельзя вывести из оборота и удалить (`409 entry_mandatory`), выведенное нельзя сделать обязательным (`409 entry_retired`). | Малая. |
| 10 | DATA-06: «up to 25 MB», «checked from its content, not only its name». | 25 МБ = `MAX_FILE_BYTES` = 26 214 400 байт (уже в contracts). Пустой файл — `400 file_empty`. Тип — по содержимому (`file-type`), и расширение имени обязано ему соответствовать (`pdf`; `jpg`/`jpeg`; `png`; `docx`; `xlsx`), иначе `415 file_type_mismatch`. | Малая. |
| 11 | GEN-09 «same rights check as the record it belongs to», а записей-владельцев профиля (DBML `certificate`, `document`, `personnel`) ещё нет. | `FILE_READ_RULES` — правило на каждое из 15 значений `file_purpose`, по умолчанию отказ. Файлы производителя (`MANUFACTURER_FILE_PURPOSES`, класс `b_manufacturer`): `can(role,'profile.read')` = `own` и та же организация, или `all` (SME, директор). Администратор не читает их никогда (ADM-06); оператор и наблюдатель — с этапа 6 по верифицированной редакции. Этап 3 уточняет правило по редакции-владельцу. | Средняя: правило переписывается в этапе 3, интерфейс не меняется. |
| 12 | Загрузка файлов производителем нужна секциям профиля (этап 3). | Маршрута загрузки для производителя в этапе нет — сирот без записи не появится; `FilesService` готов. Единственная загрузка этапа — образец оргструктуры (ADM-11). | Малая. |
| 13 | DATA-07 и ADM-11: какой образец «текущий», пока новый на проверке. | Новый образец — строка `org_chart_sample` с `is_current = false`; текущим он становится, когда скан прошёл, и только если он загружен позже текущего. Прежний остаётся строкой истории. | Малая. |
| 14 | NOT-18 «one email» против сбоя SMTP после записи в журнал (DBML `notification.sent_at not null`). | Запись журнала и отправка — одна транзакция: `INSERT … ON CONFLICT (dedup_key) DO NOTHING`, затем SMTP, затем `COMMIT`. Сбой SMTP — откат, повтор задания отправит. Дубль возможен только при падении процесса между приёмом письма SMTP и `COMMIT`; потери нет. | Малая. |
| 15 | «Каждая отправка пишется в журнал» (roadmap), а NOT-01 отправляет Keycloak. | В `notification` пишутся письма платформы: NOT-02 (без кода), NOT-03 и всё, что идёт через `notify`. NOT-01 видно в событиях Keycloak (`EXECUTE_ACTIONS`, `SEND_RESET_PASSWORD`). | Малая. |
| 16 | Раздел 8.2: «IMBC emails go to the mailbox the IMBC administrator sets»; в env есть неиспользуемый `IMBC_MAILBOX`. | Ящик — только `organizations.notification_mailbox` (этап 1). Не задан — письма IMBC нет, worker пишет предупреждение без адреса, задание завершается. `IMBC_MAILBOX` удаляется из `env.ts`, `compose.yaml`, `.env.example`. | Средняя: письма IMBC теряются, пока ящик не задан — проверка после выката. |
| 17 | NOT-19 «manufacturer contact … uses the manufacturer account's language»; контактов DBML ещё нет. | Правило языка — в диспетчере (`Recipient.languageAccountId`): контакт несёт id аккаунта производителя; ящик IMBC — `kk`. Части получателей `focal_point`, `manufacturer_contacts` — этап 3, `assigned_sme_or_imbc_mailbox` — этап 5 (`RecipientPartNotReady`). | Малая. |
| 18 | DBML `notification_rule.recipient_rule text` без формата. | Части через `+` из закрытого списка `RECIPIENT_PARTS`; 17 строк кладёт `0010`. Правила меняются только релизом: у роли приложения нет INSERT/UPDATE/DELETE на `notification_rule` и `dictionary`. | Малая. |
| 19 | NOT-19 и LANG-02 для NOT-01: стандартная тема писем Keycloak не знает казахского. | Тема писем `imbc` в пакете `infrastructure/keycloak/identity` (`src/email`, `messages_{en,ru,kk}.properties`); realm `emailTheme` — `${KEYCLOAK_EMAIL_THEME}` (локально `keycloak`, в Azure `imbc`), `sync-realm.py --email-theme`. | Малая. |
| 20 | Р-2: физическая схема по DBML; имя типа `scan_state` занято скелетным перечислением с другими значениями, а `language_code` совпадает по значениям с нашим `locale`. | Новые колонки — имена DBML; тип `file_version.scan_state` — **`file_scan_state`** (`pending, passed, rejected`), язык — существующий тип `locale`. Переименование `file_scan_state` → `scan_state` — в contract вместе с удалением скелета. Прочие отступления — раздел «Отступления от DBML». | Малая. |
| 21 | Очереди `scan-file` и `send-notification` прежней версии понимают только скелетные таблицы и готовый текст письма. | Новые очереди `file-scan` и `notify`; старые имена из `QUEUES` удаляются (у них нет производителей). Worker прежней версии в окне выката не заберёт новые задания. | Нет. |
| 22 | DBML: «Commodity type points at its commodity group»; у типов прототипа группы нет. | `parentCode` у `commodity_type` необязателен; если задан — действующее значение `commodity_group`. | Малая. |

### Отступления от DBML (каждое — с основанием)

- Тип `file_scan_state` вместо `scan_state`; тип `locale` вместо `language_code` (расхождение 20).
- `dictionary_entry`: уникальность `(dictionary_id, lower(code))` вместо `(dictionary_id, code)` — «ISO 9001» и «iso 9001» одно значение; проверка `code = btrim(code)`.
- `notification.rule_code` — внешний ключ на `notification_rule.code` (в DBML ссылки нет): журнал не примет неизвестный код.
- `file_version`: проверки `version_number > 0`, `byte_size between 1 and 26214400` (DATA-06); уникальный `storage_key`; частичный индекс `pending` для зачистки.
- `org_chart_sample.is_current` по умолчанию `true` (DBML), но сервис вставляет `false` до прохождения скана (расхождение 13); уникальный `file_object_id`.
- Индексы поиска, которых нет в DBML: префикс `lower(code) text_pattern_ops`, триграммы `dictionary_entry_translation.name`.
- `dictionary_entry_translation.dictionary_entry_id` — `ON DELETE CASCADE` (перевод не живёт без значения); `notification.sent_at` — `DEFAULT now()`; `notification_rule_code_uq` — ограничение `UNIQUE` в `CREATE TABLE`, а не индекс (на него ссылается внешний ключ журнала); отдельного префиксного индекса нет — префиксный поиск обслуживает уникальный `dictionary_entry_code_uq (dictionary_id, lower(code) text_pattern_ops)` (задача 1, `ad0de3a`).
- Скелетные `dictionaries`, `dictionary_entries`, `file_objects`, `file_versions`, `notifications_sent` и тип `scan_state` живут до contract (NFR-06).

## Права, аудит, уведомления этапа

**Права.** Новых действий матрицы нет; `POLICY_MATRIX` и снимок `SECTION_4` в `packages/contracts/test/contracts.test.ts` не меняются. `reference.read` — `administrator`, `director`; `reference.manage` — `administrator`. Тесты прав генерируются из матрицы: для маршрута с действием разрешённые роли — `ROLES.filter((r) => can(r, action))` (сервис вызван), отклонённые — остальные (403 problem+json, `outcome: 'denied'`, `action`, `objectType: 'route'`, `objectId` — шаблон пути; сервис не вызван), без сеанса — 401, изменяющий запрос с чужого Origin — `403 bad_origin`. Маршруты без действия (`choices`, скачивание файла) — 401 без сеанса; скачивание решает `FILE_READ_RULES`, отказ — 403 и аудит `file.read` `denied`. Изменяющие действия справочников и образца идут через `actorTransaction` с действием маршрута: исполнитель под блокировкой всё ещё `active` и `can(role, action)`, иначе 403 и запись `denied` после отката.

**Аудит (AUD-01).** В транзакции действия, `isAccountEvent: false`, IP — только колонка `ip`: `dictionary.entry_created` (diff `{ dictionary, code, parentCode, names, mandatory }`), `dictionary.entry_updated` (`{ from: { names, sortOrder, parentCode }, to: … }`), `dictionary.entry_mandatory_changed` (`{ from, to }`), `dictionary.entry_retired`, `dictionary.entry_restored`, `dictionary.entry_deleted` (`{ code, names }` — прежнее значение, DATA-01), `reference.loaded` (загрузчик, `{ inserted, translationsAdded }`, только если что-то добавлено), `org_chart_sample.uploaded` (`{ fileObjectId }`), `file.scan_rejected` (worker, `outcome: 'denied'`, `{ signature }`), `file.downloaded` (`objectType: 'file_version'`, `{ versionNumber }`), `file.read` (`denied`, `objectType: 'file_object'`). Имя файла, почта, ФИО в `diff` не пишутся. Повтор без изменения записи не создаёт.

**Уведомления.** Новых событий-писем этап не вводит: NOT-04…NOT-17 с их текстами приходят со своими этапами (5–9, полный каталог — этап 7). На основу переводятся NOT-03 (блокировка входа: `notify`-диспетчер, правило `person`) и NOT-02 (код входа: прямо из API, но через журнал). NOT-01 — тема писем Keycloak на трёх языках.

## Global Constraints

- Worktree `.claude/worktrees/stage-2`, ветка `feat/stage-2-foundation`. Задачи строго по порядку 1 → 9, один коммит на задачу, в сообщении — ID требований. Без `git push`, без деплоя, без `docker compose up`.
- Конец каждой задачи: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; набор API с базой — `TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/imbc_auth_test pnpm --filter @imbc/api test` (только база `imbc_auth_test`; **одним исполнителем в момент времени**); `pnpm check:requirements`. Если задача трогает Compose — `docker compose config -q`; realm или `sync-realm.py` — `python3 infrastructure/azure/test/sync-realm.test.py`.
- Миграции: `0009` — только `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX`, `ADD CONSTRAINT`; `0010` — только `INSERT … ON CONFLICT DO NOTHING` и `INSERT … SELECT … ON CONFLICT DO NOTHING`. Предыдущая версия (`f9d7ad7`) работает на схеме после `0010` (NFR-06). После каждой миграции `pnpm --filter @imbc/api db:generate` не создаёт нового файла.
- Значения перечислений в SQL — ровно как в `@imbc/contracts`: `FILE_PURPOSES` = `organisation_chart, cv, unified_register_extract, conformity_certificate, production_photo, certificate_file, document_file, site_survey_report, due_diligence_report, enhanced_due_diligence_report, operator_visit_file, technical_requirements, agar_cdp_report, organisation_chart_sample, export` (DBML, порядок тот же); `DATA_CLASSES` = `a_register, b_manufacturer, c_imbc, d_operator, e_administration, f_forecast`; `FILE_SCAN_STATES` = `pending, passed, rejected`; `LOCALES` = `kk, ru, en`; `DICTIONARY_CODES` = `region, legal_form, oked, tn_ved, kpved, commodity_group, commodity_type, process, equipment_type, contact_role, certificate_type, document_type` (порядок ADM-08).
- Коды справочников — `text`, никогда число: в JSON-файлах, схемах zod, полях ввода (`type="text"`), ответах (DATA-03).
- Файлы: только `ALLOWED_FILE_TYPES` (5 типов) и `MAX_FILE_BYTES` из `packages/contracts/src/enums.ts`; байты — только через API, без presigned URL и без публичных бакетов (NFR-09); ключ объекта — случайный UUID без имени файла; бакеты — `S3_BUCKET_QUARANTINE`, `S3_BUCKET_FILES`. ClamAV вызывает только worker. Ответ clamd, кроме `OK` и `FOUND`, — ошибка задания, никогда не «прошёл».
- Имена файлов, почта, ФИО, коды входа не попадают в журналы, тексты ошибок, `diff` аудита и данные заданий pg-boss: задания несут только id, коды правил и строковые параметры без персональных данных.
- В тестах нет сети: `MemoryObjectStorage`, `StubAntivirus`, фиктивный транспорт nodemailer; адреса — `*.local` (`AGENTS.md`). Adata этап не трогает.
- Время — Asia/Almaty (DATA-08); код, зависящий от «сейчас», принимает `now` параметром.
- Тексты — kk, ru, en, одинаковые ключи, английский — источник (LANG-02): интерфейс — `apps/web/messages/*.json`; письма платформы — `apps/api/src/mail/messages/*.json`; NOT-01 — `infrastructure/keycloak/identity/src/email/messages/*.properties`. Новые казахские строки — в список вычитки `docs/handoff/2026-11-11-context.md` §10 (LANG-03). Названия значений справочников — данные, интерфейс их не переводит (LANG-05).
- Web: компоненты только из `src/components/ui`; новые — `pnpm dlx shadcn@4.23.0 add <name>` из `apps/web` после просмотра в MCP shadcn (реестр `@shadcn`) и `pnpm dlx shadcn@4.23.0 view <name>`; правила Base UI из `apps/web/AGENTS.md`; ссылки на `/api/*` — обычный `<a href>`; даты и числа — `useFormat`.
- Новые контроллеры — `@ApiTags`; загрузки — `@ApiConsumes('multipart/form-data')` (OpenAPI соответствует маршрутам).
- ID требований — только из v1.3 (`pnpm check:requirements`); удаляя или правя строку со старым ID (`FILE-03` в `handlers.service.ts`, `GEN-30` в `queues.ts`), — `node scripts/check-requirements.mjs --update-baseline`.
- Не редактировать `docs/analyst/**`, `apps/api/drizzle/0000`–`0008*`, раздел 11 roadmap; не читать `.env*`, кроме `.env.example`.

## Review Focus

1. **Граница размера и подделанный тип.** Файл ровно 26 214 400 байт, на байт больше, пустой; PNG с именем `.pdf`; исполняемый файл с именем `.pdf`; ZIP без `word/` с именем `.docx`. Ожидание: принят / `413 file_too_large` / `400 file_empty` / `415 file_type_mismatch` / `415 file_type_not_allowed` ×2; в хранилище и БД ничего не осталось. Тест — задача 4, «граница 25 МБ и подделанный тип…».
2. **Имя файла на казахском и русском с кавычками, `;`, переводом строки и путём (`C:\docs\Құрылым "IMBC".pdf`).** Ожидание: сохранено базовое имя без пути и управляющих символов, без порчи кириллицы multer-ом (latin1); скачивание отдаёт его в `filename*=UTF-8''…`, заголовок одной строкой; в журнале и аудите имени нет. Тест — задача 4, «имя файла…».
3. **Коды справочника, которые легко испортить.** Ведущий ноль; тот же код другим регистром или с пробелом по краям; поиск со `%` и `_`; вывод из оборота обязательного типа; удаление используемого. Ожидание: код сохраняется как введён; `409 entry_exists`; `%` ищется буквально; `409 entry_mandatory`; `409 entry_in_use`. Тесты — задача 3.
4. **Сбой SMTP посреди рассылки и параллельные повторы одного события.** Ожидание: после повторов каждому адресу ровно одно письмо, ни одно не потеряно. Тесты — задача 6, «сбой SMTP на втором из трёх адресов…», «параллельные задания одного события…».
5. **Ящик IMBC не задан или совпадает с логином наблюдателя; адрес повторяется в другом регистре.** Ожидание: письма нет, предупреждение без адреса, задание не зацикливается; одно письмо на адрес. Тесты — задача 6.

---

### Task 1: модель данных этапа — `0009` expand и `0010` данные справочников и правил (DATA-02, DATA-05, NOT-18, NFR-06)

**Модель:** `opus` · **Независимое ревью:** нет

**Files:**
- Create: `packages/contracts/src/files.ts` (константы `FILE_PURPOSES`, `DATA_CLASSES`, `FILE_SCAN_STATES`, `MANUFACTURER_FILE_PURPOSES` и их типы), `packages/contracts/src/dictionaries.ts` (`DICTIONARY_CODES`, `DictionaryCode`); экспорт из `packages/contracts/src/index.ts`.
- Create: `apps/api/src/database/schema/reference.ts`, `schema/files.ts`, `schema/notifications.ts`; Modify: `schema/enums.ts` (`dataClass`, `filePurpose`, `fileScanState`), `schema/index.ts`.
- Create: `apps/api/drizzle/0009_stage2_foundation.sql` (+снимок) — `pnpm --filter @imbc/api db:generate --name stage2_foundation`; `apps/api/drizzle/0010_stage2_reference_data.sql` (+снимок) — `pnpm --filter @imbc/api exec drizzle-kit generate --custom --name stage2_reference_data`.
- Modify: `apps/api/src/database/app-role.ts`.
- Test: `apps/api/test/migration-stage2.integration.test.ts` (новый); `packages/contracts/test/contracts.test.ts`.

**Interfaces:**
- Consumes: база после `0008_reference_organizations`.
- Produces — TS-имена (Drizzle, `casing: 'snake_case'`), колонки и ограничения:

| Таблица (TS) | Колонки | Ограничения и индексы |
|---|---|---|
| `dictionary` (`dictionary`) | `id` uuid pk `uuidv7()`; `code` text not null; `name` text not null | unique `dictionary_code_uq (code)` |
| `dictionary_entry` (`dictionaryEntry`) | `id`; `dictionaryId` → `dictionary.id`; `code` text not null; `parentEntryId` uuid null → `dictionary_entry.id`; `mandatory` boolean null; `customNameAllowed` boolean not null default false; `sortOrder` integer not null default 0; `retiredAt` timestamptz null | unique `dictionary_entry_code_uq (dictionary_id, lower(code) text_pattern_ops)`; check `dictionary_entry_code_ck`: `code <> '' and code = btrim(code)`; check `dictionary_entry_parent_ck`: `parent_entry_id <> id` |
| `dictionary_entry_translation` (`dictionaryEntryTranslation`) | `dictionaryEntryId` → `dictionary_entry.id` `on delete cascade`; `language` `locale` not null; `name` text not null | pk `(dictionary_entry_id, language)`; GIN `dictionary_entry_translation_name_trgm (name gin_trgm_ops)`; check `name <> '' and name = btrim(name)` |
| `file_object` (`fileObject`) | `id`; `organizationId` uuid null → `organizations.id`; `purpose` `file_purpose` not null; `dataClass` `data_class` not null; `createdAt` | unique `file_object_id_org_uq (id, organization_id)` |
| `file_version` (`fileVersion`) | `id`; `fileObjectId` → `file_object.id`; `versionNumber` integer not null; `originalName` text not null; `byteSize` bigint (`mode: 'number'`) not null; `declaredMediaType` text not null; `detectedMediaType` text null; `checksum` text not null; `scanState` `file_scan_state` not null default `'pending'`; `scannedAt` timestamptz null; `uploadedAt` timestamptz not null default now(); `uploadedBy` uuid null → `user_accounts.id`; `storageKey` text not null | unique `file_version_number_uq (file_object_id, version_number)`; unique `file_version_storage_key_uq (storage_key)`; check `version_number > 0`; check `byte_size between 1 and 26214400`; index `file_version_pending_idx (uploaded_at) where scan_state = 'pending'` |
| `org_chart_sample` (`orgChartSample`) | `id`; `fileObjectId` → `file_object.id` not null; `uploadedBy` → `user_accounts.id` not null; `uploadedAt` timestamptz not null; `isCurrent` boolean not null default true | unique `org_chart_sample_file_uq (file_object_id)`; unique `org_chart_sample_current_uq (is_current) where is_current` |
| `notification_rule` (`notificationRule`) | `id`; `code` text not null; `event` text not null; `recipientRule` text not null; `enabled` boolean not null default true | unique `notification_rule_code_uq (code)` |
| `notification` (`notification`) | `id`; `ruleCode` text not null → `notification_rule.code`; `recipientEmail` text not null; `userAccountId` uuid null → `user_accounts.id`; `language` `locale` not null; `dedupKey` text not null; `relatedObjectType` text null; `relatedObjectId` uuid null; `sentAt` timestamptz not null default now() | unique `notification_dedup_uq (dedup_key)`; index `notification_account_idx (user_account_id, sent_at)`; index `notification_related_idx (related_object_type, related_object_id)` |

  Если drizzle-kit не выражает `lower(code) text_pattern_ops` в уникальном индексе — уникальный индекс `(dictionary_id, lower(code))` в схеме, а префиксный `CREATE INDEX IF NOT EXISTS dictionary_entry_code_prefix_idx ON dictionary_entry (dictionary_id, lower(code) text_pattern_ops)` — в `0010`. Комментарии в схеме называют отступления и их основание.
- Produces (`app-role.ts`): `REVOKE UPDATE, DELETE, TRUNCATE ON notification`; `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON notification_rule, dictionary`.
- Produces (данные `0010`): 12 строк `dictionary`, 17 строк `notification_rule`, перенесённые `notifications_sent`; формат `dedup_key` — `<код>\n<ключ события>\n<адрес в нижнем регистре>` (его же строит `notificationDedupKey`, задача 6).

SQL `0010` (тело задано; разделители `--> statement-breakpoint`):

```sql
INSERT INTO dictionary (code, name) VALUES
  ('region','Regions'),('legal_form','Legal forms'),('oked','OKED'),('tn_ved','TN VED'),('kpved','KPVED'),
  ('commodity_group','Commodity groups'),('commodity_type','Commodity types'),('process','Processes'),
  ('equipment_type','Equipment types'),('contact_role','Contact roles'),('certificate_type','Certificate types'),
  ('document_type','Document types')
ON CONFLICT (code) DO NOTHING;
INSERT INTO notification_rule (code, event, recipient_rule) VALUES
  ('NOT-01','password_link','person'),('NOT-02','sign_in_code','person'),('NOT-03','account_locked','person'),
  ('NOT-04','profile_submitted','imbc_mailbox'),('NOT-05','review_result','manufacturer_account+focal_point'),
  ('NOT-06','certificate_expiry_threshold','manufacturer_account+imbc_mailbox'),
  ('NOT-07','imbc_request_received','imbc_mailbox'),('NOT-08','imbc_request_replied','person'),
  ('NOT-09','export_file_ready','person'),('NOT-10','profile_unlocked_in_review','assigned_sme_or_imbc_mailbox'),
  ('NOT-11','profile_site_surveyed','operator_accounts_not_blocked'),
  ('NOT-12','quarter_confirmation_request','manufacturer_account+focal_point'),
  ('NOT-13','operator_request_sent','manufacturer_contacts+imbc_mailbox'),('NOT-14','operator_request_replied','person'),
  ('NOT-15','second_missed_quarter','manufacturer_account+focal_point'),
  ('NOT-16','profile_unresponsive','manufacturer_account+focal_point'),('NOT-17','subscriptions_pause_warning','person')
ON CONFLICT (code) DO NOTHING;
INSERT INTO notification (rule_code, recipient_email, user_account_id, language, dedup_key, sent_at)
  SELECT ns.code, ns.recipient, ua.id,
         CASE WHEN ns.locale IN ('kk','ru','en') THEN ns.locale::locale ELSE 'kk'::locale END,
         ns.code || E'\n' || ns.dedupe_key || E'\n' || lower(ns.recipient), ns.sent_at
  FROM notifications_sent ns LEFT JOIN user_accounts ua ON lower(ua.email) = lower(ns.recipient)
  WHERE ns.code IN (SELECT code FROM notification_rule)
ON CONFLICT (dedup_key) DO NOTHING;
```

- [ ] **Шаг 1. Тесты (сначала).** `migration-stage2.integration.test.ts` (PostgreSQL 18):
  - «0009 и 0010 — expand: база 0008 с данными предыдущей версии мигрирует; запись предыдущей версии проходит (NFR-06)» — `migrateThrough(pool, '0008_reference_organizations')`; SQL-ем аккаунт `locked@stage2.local`, строка `notifications_sent` (`NOT-03`, `sub-1:1700000000000`, `Locked@Stage2.local`, `ru`), скелетные `file_objects` + `file_versions` со `scan_state 'clean'`; `migrateThrough(pool)`; затем ещё одна вставка в `notifications_sent` и `file_versions` (`'infected'`) проходит;
  - «в 0009 нет DROP, RENAME, ALTER COLUMN, SET NOT NULL и ALTER TYPE» — чтение файла, регулярные выражения;
  - «0010: двенадцать справочников с кодами DBML в порядке ADM-08, семнадцать правил; повторный прогон SQL 0010 ничего не добавляет» — `select code from dictionary` как множество = `DICTIONARY_CODES`; `select code, recipient_rule from notification_rule order by code` = таблица SQL выше; тело файла, разбитое по `--> statement-breakpoint`, выполняется ещё раз через `pool.query`, счётчики те же;
  - «0010 переносит письма в журнал: dedup_key = 'NOT-03\nsub-1:1700000000000\nlocked@stage2.local', user_account_id найден без учёта регистра, язык ru, sent_at тот же (NOT-18)»;
  - «ограничения: версия 0 и 26 214 401 байт — 23514; второй текущий образец — 23505; код, отличающийся регистром, в том же справочнике — 23505, в другом — можно; код с пробелом по краям — 23514; второе письмо с тем же dedup_key — 23505; правило с неизвестным кодом — 23503; названия значения — отдельные строки по языку, второй перевод на тот же язык — 23505 (DATA-02)»;
  - «права роли приложения: notification — только SELECT и INSERT; notification_rule и dictionary — только SELECT; dictionary_entry — SELECT, INSERT, UPDATE, DELETE» — `CREATE ROLE imbc_grants_test` (если нет), `applyAppRoleGrants(pool, 'imbc_grants_test')`, `has_table_privilege`.
  `contracts.test.ts`: «FILE_PURPOSES, DATA_CLASSES, FILE_SCAN_STATES — значения DBML; MANUFACTURER_FILE_PURPOSES — подмножество FILE_PURPOSES; DICTIONARY_CODES — двенадцать кодов ADM-08».
- [ ] **Шаг 2.** `TEST_DATABASE_URL=… pnpm --filter @imbc/api exec vitest run test/migration-stage2.integration.test.ts` — падает (нет миграций).
- [ ] **Шаг 3. Реализация.** Константы contracts, схема, `db:generate --name stage2_foundation`, просмотр SQL глазами (только разрешённые операторы), `generate --custom --name stage2_reference_data` с телом выше, затем `db:generate` — изменений нет. `app-role.ts`.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка (Global Constraints).
- [ ] **Шаг 5.** Коммит `Модель этапа 2: справочники, файлы и журнал уведомлений по DBML, двенадцать справочников и семнадцать правил данными, перенос отправленных писем (DATA-02, DATA-05, NOT-18, NFR-06)`.

---

### Task 2: наполнение справочников — файлы в репозитории и идемпотентная загрузка (ADM-08, DATA-03)

**Модель:** `sonnet` · **Независимое ревью:** нет

**Files:**
- Modify: `packages/contracts/src/dictionaries.ts`.
- Create: `apps/api/src/database/reference-data.ts`; `apps/api/reference-data/release/{legal_form,commodity_group,contact_role,certificate_type,document_type}.json`; `apps/api/reference-data/provisional/{region,oked,tn_ved,kpved,commodity_type,process,equipment_type}.json`.
- Modify: `apps/api/src/database/migrate.ts` (после миграций и прав — загрузка `release`); `apps/api/src/database/seed.ts` (загрузка `provisional`); `apps/api/package.json` (`"files"`: + `"reference-data"`).
- Test: `apps/api/test/reference-data.integration.test.ts` (новый); `seed.integration.test.ts`; `packages/contracts/test/contracts.test.ts`.

**Interfaces:**
- Consumes: задача 1 — `dictionary`, `dictionaryEntry`, `dictionaryEntryTranslation`, `DICTIONARY_CODES`.
- Produces (contracts, `dictionaries.ts`):
  ```ts
  export const CLOSED_DICTIONARIES = ['commodity_group', 'contact_role'] as const satisfies readonly DictionaryCode[];
  export const MANDATORY_DICTIONARIES = ['certificate_type', 'document_type'] as const satisfies readonly DictionaryCode[];
  export const DICTIONARY_PARENT: Partial<Record<DictionaryCode, DictionaryCode>> = { commodity_type: 'commodity_group' };
  export const DICTIONARY_CODE_PATTERNS: Record<DictionaryCode, RegExp>; // расхождение 7
  export const REFERENCE_DATA_STATUSES = ['specification', 'imbc', 'provisional'] as const;
  const entryName = z.string().trim().min(1).max(500);
  export const referenceFileSchema = z.object({
    dictionary: z.enum(DICTIONARY_CODES), status: z.enum(REFERENCE_DATA_STATUSES), source: z.string().min(1),
    entries: z.array(z.object({
      code: z.string().trim().min(1).max(64), parent: z.string().trim().min(1).nullable().default(null),
      names: z.object({ kk: entryName.optional(), ru: entryName.optional(), en: entryName.optional() }).strict()
        .refine((n) => n.kk ?? n.ru ?? n.en, { message: 'At least one name' }),
      mandatory: z.boolean().optional(), customNameAllowed: z.boolean().default(false), sortOrder: z.number().int().min(0).default(0),
    }).strict()).min(1),
  }).strict();
  export type ReferenceFile = z.infer<typeof referenceFileSchema>;
  export function entryDisplayName(names: Partial<Record<Locale, string | null>>, lang: Locale, code: string): string; // lang → kk → ru → en → код
  ```
- Produces (API, `reference-data.ts`): `export const REFERENCE_DATA_DIR: string` (`apps/api/reference-data`, и в образе — рядом с `dist`); `export class ReferenceFileError extends Error` (имя файла и правило, без значений); `export interface ReferenceLoadResult { dictionary: DictionaryCode; inserted: number; translationsAdded: number }`; `loadReferenceFile(db: Database, file: ReferenceFile, expect: 'release' | 'provisional'): Promise<ReferenceLoadResult>`; `loadReferenceDirectory(db: Database, dir: string, expect: 'release' | 'provisional'): Promise<ReferenceLoadResult[]>` — файлы `*.json` в порядке `DICTIONARY_CODES` (родительский справочник раньше дочернего).

Правила загрузки (одна транзакция на файл): `expect: 'release'` принимает `status` `specification` | `imbc`, `provisional` — только `provisional`; код — `DICTIONARY_CODE_PATTERNS[dictionary]`; повтор кода в файле без учёта регистра, `mandatory` вне `MANDATORY_DICTIONARIES`, `customNameAllowed` вне `certificate_type`, `parent` вне `DICTIONARY_PARENT` или ненайденный — `ReferenceFileError`, файл не загружается целиком. Значение, которого нет (`lower(code)`), вставляется; у существующего добавляются только недостающие переводы — названия, `mandatory`, `sort_order`, `retired_at` загрузка не меняет (их ведёт администратор). Пачки по 1000 строк, `ON CONFLICT DO NOTHING`. `inserted + translationsAdded > 0` → аудит `reference.loaded`. `migrate.ts` печатает `Справочники: <код> +<inserted> (+<translationsAdded> переводов)` на каждый файл.

Содержимое файлов (`source` — откуда значения):
- `release/legal_form.json` (`specification`, «MAN-09: список включает LLP, LLC, JSC; полный перечень — IMBC»): `LLP` — kk «Жауапкершілігі шектеулі серіктестік (ЖШС)», ru «Товарищество с ограниченной ответственностью (ТОО)», en «Limited liability partnership (LLP)»; `LLC` — «Жауапкершілігі шектеулі қоғам (ЖШҚ)» / «Общество с ограниченной ответственностью (ООО)» / «Limited liability company (LLC)»; `JSC` — «Акционерлік қоғам (АҚ)» / «Акционерное общество (АО)» / «Joint-stock company (JSC)».
- `release/commodity_group.json` (`specification`, «MAN-23, OPR-02: группы A–E; названия временные»): `A`…`E` — kk «{X} тобы», ru «Группа {X}», en «Group {X}», `sortOrder` 0…4.
- `release/contact_role.json` (`specification`, «MAN-13»): `management` «Басшылық» / «Руководство» / «Management»; `technical` «Техникалық» / «Техническое направление» / «Technical»; `commercial` «Коммерциялық» / «Коммерческое направление» / «Commercial».
- `release/certificate_type.json` (`specification`, «MAN-34»): `ISO 9001`, `ISO 14001`, `ISO 45001` — `mandatory: true`, название = код на трёх языках; `ASME`, `API`, `IEC`, `IECEx`, `ATEX` — `mandatory: false`, название = код; `Extract from e-Ondiris` — «e-Ondiris үзінді көшірмесі» / «Выписка из e-Ondiris» / «Extract from e-Ondiris», `false`; `Other` — «Басқа (атауын көрсетіңіз)» / «Другой (укажите название)» / «Other (enter the name)», `false`, `customNameAllowed: true`. `sortOrder` по порядку MAN-34.
- `release/document_type.json` (`specification`, «MAN-37, MAN-38, DBML document»): `registration_certificate` «Тіркеу туралы куәлік» / «Свидетельство о регистрации» / «Registration certificate», `true`; `charter` «Жарғы» / «Устав» / «Charter», `true`; `licence` «Лицензиялар» / «Лицензии» / «Licences», `true`; `financial_statements` «Қаржылық есептілік» / «Финансовая отчётность» / «Financial statements», `false`.
- `provisional/*` (`provisional`, «прототип `data/references.ts`; ждёт перечня IMBC»): регионы `KZ-AKT`, `KZ-ALA`, `KZ-AST`, `KZ-ATY`, `KZ-KAR`, `KZ-KUS`, `KZ-MAN`, `KZ-PAV`, `KZ-ZAP` с ru-названиями прототипа (покрывают регионы каталога seed); ОКЭД `25110`, `28131`, `27320`, `33120`; ТН ВЭД `7308909809`, `8481805190`, `8413702100`, `8544499108`; КПВЭД `25.11.23`, `28.13.14`; типы товаров `steel_structures`, `valves`, `pumps`, `cables`, `workwear` (en прототипа, без группы); процессы `welding`, `machining`, `painting`; типы оборудования `metalworking`, `lifting` — названия ровно как в прототипе, другие языки не добавляются.

- [ ] **Шаг 1. Тесты (сначала).** `contracts.test.ts`: «referenceFileSchema: код-число отклоняется, без названий — отклоняется, неизвестный справочник — отклоняется (DATA-03)»; «entryDisplayName: язык → kk → ru → en → код»; «закрытые справочники = COMMODITY_GROUPS и CONTACT_ROLES; шаблон tn_ved принимает '0101210000' и отклоняет '101210000'». `reference-data.integration.test.ts` (PostgreSQL 18, база после всех миграций):
  - «release: правовые формы LLP, LLC, JSC; группы A–E; роли management, technical, commercial; типы сертификатов — ISO 9001, ISO 14001, ISO 45001 обязательные, Other с customNameAllowed; типы документов — registration_certificate, charter, licence обязательные, financial_statements нет (MAN-09, MAN-13, MAN-34, MAN-37, MAN-38)» — `loadReferenceDirectory(db, REFERENCE_DATA_DIR + '/release', 'release')`;
  - «повторная загрузка ничего не добавляет; название, исправленное администратором, не возвращается; недостающий перевод добавляется»;
  - **«ведущие нули: '0101210000' и '01110' сохраняются текстом и возвращаются как есть (DATA-03)»** — файл-фикстура в тесте;
  - «код не по шаблону, повтор кода другим регистром, mandatory у региона, неизвестный parent — ReferenceFileError, ни одной строки из файла»;
  - «названия — строки dictionary_entry_translation по языку, не одна строка с разделителем (DATA-02)»;
  - «parent: тип товара фикстуры указывает на значение commodity_group B»;
  - «коды закрытых справочников = enum_range(null::commodity_group) и enum_range(null::contact_role)»;
  - «provisional в release — ReferenceFileError; release в provisional — тоже»;
  - «аудит reference.loaded только когда что-то добавлено».
  `seed.integration.test.ts`: «seed загружает временные справочники: после seed — 9 регионов, KZ-ATY есть; после одних миграций с загрузкой release — регионов 0».
- [ ] **Шаг 2.** Прогон — падают.
- [ ] **Шаг 3. Реализация** по Interfaces; вызовы в `migrate.ts` (через `drizzle(pool, { schema, casing: 'snake_case' })`) и `seed.ts`; `"files"` в `package.json`.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка.
- [ ] **Шаг 5.** Коммит `Справочники: файлы в репозитории и идемпотентная загрузка — списки спецификации при миграции, временные значения только в seed, коды текстом (ADM-08, DATA-03)`.

---

### Task 3: справочники — API администратора, поиск и выбор значений (ADM-08, ADM-09, DATA-02, DATA-03, DATA-04, GEN-08)

**Модель:** `opus` · **Независимое ревью:** да

**Files:**
- Modify: `packages/contracts/src/dictionaries.ts`.
- Create: `apps/api/src/common/actor-transaction.ts`; `apps/api/src/modules/dictionaries/dictionaries.service.ts`, `dictionaries.controller.ts`, `usage.ts`.
- Modify: `apps/api/src/modules/admin/organizations.service.ts` (перенос `lockActor`, `auditActorDenial`, `notFound`, `busy`, `isUuid` в `actor-transaction.ts` с реэкспортом прежних имён); `apps/api/src/app.module.ts`.
- Test: `apps/api/test/support/http.ts` (`send` с `'DELETE'`); `apps/api/test/dictionaries.http.test.ts`, `dictionaries.integration.test.ts` (новые); `admin.http.test.ts`, `admin-organizations.integration.test.ts` (остаются зелёными); `packages/contracts/test/contracts.test.ts`.

**Interfaces:**
- Consumes: задачи 1–2 — таблицы, `CLOSED_DICTIONARIES`, `MANDATORY_DICTIONARIES`, `DICTIONARY_PARENT`, `DICTIONARY_CODE_PATTERNS`, `entryDisplayName`, загруженные списки.
- Produces (contracts):
  ```ts
  const names = z.object({ kk: entryName, ru: entryName, en: entryName }).strict();
  export const createDictionaryEntrySchema = z.object({ code: z.string().trim().min(1).max(64),
    parentCode: z.string().trim().min(1).max(64).nullable().default(null), names, mandatory: z.boolean().optional() }).strict();
  export const updateDictionaryEntrySchema = z.object({ names, sortOrder: z.number().int().min(0).max(100000),
    parentCode: z.string().trim().min(1).max(64).nullable().default(null) }).strict();
  export const entryMandatorySchema = z.object({ mandatory: z.boolean() }).strict();
  export const DICTIONARY_ENTRY_STATUSES = ['active', 'retired', 'all'] as const;
  const page = z.coerce.number().int().min(1).default(1), pageSize = z.coerce.number().int().min(10).max(100).default(50);
  export const dictionaryEntriesQuerySchema = z.object({ q: z.string().trim().max(100).default(''),
    status: z.enum(DICTIONARY_ENTRY_STATUSES).default('active'), page, pageSize }).strict();
  export const dictionaryChoicesQuerySchema = z.object({ q: z.string().trim().max(100).default(''),
    lang: z.enum(LOCALES).default('kk'), page, pageSize }).strict();
  export const dictionaryEntrySchema = z.object({ id: z.uuid(), code: z.string(), parentCode: z.string().nullable(),
    names: z.object({ kk: z.string().nullable(), ru: z.string().nullable(), en: z.string().nullable() }).strict(),
    mandatory: z.boolean().nullable(), customNameAllowed: z.boolean(), sortOrder: z.number().int(),
    retiredAt: z.string().nullable() }).strict();
  export const dictionarySummarySchema = z.object({ code: z.enum(DICTIONARY_CODES), closed: z.boolean(),
    mandatoryApplicable: z.boolean(), parentDictionary: z.enum(DICTIONARY_CODES).nullable(),
    active: z.number().int(), retired: z.number().int() }).strict();
  export const dictionaryListSchema = z.object({ dictionaries: z.array(dictionarySummarySchema) }).strict();
  export const dictionaryEntriesPageSchema = z.object({ dictionary: dictionarySummarySchema, items: z.array(dictionaryEntrySchema),
    total: z.number().int(), page: z.number().int(), pageSize: z.number().int() }).strict();
  export const dictionaryEntryResultSchema = z.object({ entry: dictionaryEntrySchema }).strict();
  export const dictionaryChoicesPageSchema = z.object({ items: z.array(z.object({ id: z.uuid(), code: z.string(),
    name: z.string(), parentCode: z.string().nullable() }).strict()), total: z.number().int(), page: z.number().int(),
    pageSize: z.number().int() }).strict();
  export const REFERENCE_PROBLEM_CODES = ['validation', 'unauthenticated', 'mfa_required', 'responsibility_required',
    'forbidden', 'bad_origin', 'not_found', 'entry_exists', 'code_format', 'parent_invalid', 'dictionary_closed',
    'mandatory_not_applicable', 'entry_mandatory', 'entry_retired', 'entry_in_use', 'busy', 'internal'] as const;
  // + типы *Input, *Query, *Page, *Result; ReferenceProblemCode
  ```
- Produces (`common/actor-transaction.ts`): `lockActor(tx: Database, actorId: string, targetId?: string, action: Action = 'accounts.manage')` — строки `for no key update` в порядке id, исполнитель `active` и `can(role, action) !== null`, иначе `ActorDenied`; `auditActorDenial<T>(audit, actor: AuthUser, route: string, ip: string | null, run: () => Promise<T>, action: Action = 'accounts.manage'): Promise<T>`; `actorTransaction<T>(pool: pg.Pool, audit: AuditService, actor: AuthUser, opts: { route: string; ip: string | null; action: Action }, run: (tx: Database, queueDb: QueueDb) => Promise<T>): Promise<T>` — `withQueueTransaction` → `boundLockWaits` → `lockActor(tx, actor.id, undefined, opts.action)` → `run`; `lockWaitExceeded` → `busy()`; отказ — `auditActorDenial` с `opts.action`. Поведение маршрутов этапа 1 не меняется.
- Produces (HTTP; ответы — `parseResponse`; `DICTIONARY_ROUTES` — шаблоны путей):

| Маршрут | Право | Тело / query | Успех | Ошибки |
|---|---|---|---|---|
| `GET /api/v1/dictionaries` | `reference.read` | — | 200 `dictionaryListSchema` (порядок `DICTIONARY_CODES`) | — |
| `GET /api/v1/dictionaries/:code/entries` | `reference.read` | `dictionaryEntriesQuerySchema` | 200 `dictionaryEntriesPageSchema` | 404 `not_found` (код не из списка); 400 `validation` |
| `GET /api/v1/dictionaries/:code/choices` | вошедший пользователь | `dictionaryChoicesQuerySchema` | 200 `dictionaryChoicesPageSchema` (только действующие) | 404; 400 |
| `POST /api/v1/dictionaries/:code/entries` | `reference.manage` | `createDictionaryEntrySchema` | 201 `dictionaryEntryResultSchema` | 404; 400 `validation`, `code_format`, `parent_invalid`; 409 `entry_exists`, `dictionary_closed`, `mandatory_not_applicable` |
| `PUT /api/v1/dictionaries/:code/entries/:id` | `reference.manage` | `updateDictionaryEntrySchema` | 200 result | 404; 400 `parent_invalid` |
| `PUT /api/v1/dictionaries/:code/entries/:id/mandatory` | `reference.manage` | `entryMandatorySchema` | 200 result | 404; 409 `mandatory_not_applicable`, `entry_retired` |
| `POST /api/v1/dictionaries/:code/entries/:id/retire` | `reference.manage` | — | 200 result | 404; 409 `dictionary_closed`, `entry_mandatory` |
| `POST /api/v1/dictionaries/:code/entries/:id/restore` | `reference.manage` | — | 200 result | 404; 409 `dictionary_closed` |
| `DELETE /api/v1/dictionaries/:code/entries/:id` | `reference.manage` | — | 204 | 404; 409 `dictionary_closed`, `entry_mandatory`, `entry_in_use` |

  Всем изменяющим: 503 `busy`; исполнитель, переставший быть администратором, — 403 и запись `denied` с действием `reference.manage`. Значение другого справочника по id — 404.
- Produces (тесты): `HttpStand.send(method: 'POST' | 'PUT' | 'DELETE', path: string, role?: Role, body?: unknown): Promise<Response>`.
- Produces (сервис): `DictionariesService` (зависимости `DB`, `PG_POOL`, `AuditService`): `list(): Promise<DictionaryList>`; `entries(code: string, query: DictionaryEntriesQuery): Promise<DictionaryEntriesPage>`; `choices(code: string, query: DictionaryChoicesQuery): Promise<DictionaryChoicesPage>`; `create(actor: AuthUser, code: string, input: CreateDictionaryEntryInput, ip: string | null)`, `update(actor, code, id, input, ip)`, `setMandatory(actor, code, id, mandatory: boolean, ip)`, `retire(actor, code, id, ip)`, `restore(actor, code, id, ip)` — все `Promise<DictionaryEntryResult>`; `remove(actor, code, id, ip): Promise<void>`. Значение — под `for no key update`.
- Produces (`usage.ts`): `export interface DictionaryUsage { table: string; column: string; array: boolean }`; `export const DICTIONARY_USAGES: Record<DictionaryCode, readonly DictionaryUsage[]>` — `region`: `catalog_visible.region`; `oked`: `catalog_visible.oked_codes[]`; `tn_ved`: `catalog_visible.tnved_codes[]`, `catalog_visible.main_tnved`, `product_lines.tnved`; `kpved`: `catalog_visible.kpved_codes[]`, `product_lines.kpved`; `commodity_type`: `catalog_visible.commodity_types[]`, `product_lines.commodity_type`; `certificate_type`: `catalog_visible.certificate_types[]`, `certificates.type_code`; `document_type`: `documents.type_code`; `equipment_type`: `equipment_items.type`; закрытые и прочие — `[]`; `entryInUse(tx: Database, dictionary: DictionaryCode, code: string): Promise<boolean>` (точное совпадение текста, `= any(column)` для массивов). Ошибка `23503` при удалении — тоже `409 entry_in_use`.

Поиск (`entries`, `choices`): `q` пустой — все; иначе `lower(code) like lower(q) || '%'` или перевод `name ilike '%' || q || '%'`, где `%`, `_`, `\` в `q` экранированы. Порядок: точное совпадение кода, затем совпадение начала кода, затем `sort_order`, `code`. `total` — тем же условием. Страница за последней — пустые `items` с `total`. Выбор: название — `entryDisplayName(names, lang, code)`.

- [ ] **Шаг 1. Тесты (сначала).** `dictionaries.http.test.ts`: таблица `ROUTES` (восемь маршрутов с правом) × роли из матрицы — «%s %s: разрешённая роль — сервис вызван»; «… %s — 403, outcome denied и action в аудите, сервис не вызван (GEN-08)»; «без сеанса — 401»; «чужой Origin — 403 bad_origin»; «choices: шесть ролей — 200, без сеанса — 401». `dictionaries.integration.test.ts` (PostgreSQL 18; справочники `release` загружены):
  - «список: двенадцать справочников в порядке ADM-08 со счётчиками; commodity_group и contact_role — closed, certificate_type и document_type — mandatoryApplicable, у commodity_type parentDictionary commodity_group (ADM-08)»;
  - «поиск по началу кода и по названию на любом языке без учёта регистра; 12 000 значений ТН ВЭД — страницы по 50, total 12000, страница 241 — пустая» (значения — фикстурой через `loadReferenceFile`);
  - **«поиск со знаками % и _ ищет их буквально»**;
  - **«ведущие нули кодов сохраняются: создание '0101210000', ответ создания, список, выбор и поиск по '0101' возвращают '0101210000' (DATA-03)»**;
  - **«создание: тот же код другим регистром или с пробелом по краям — 409 entry_exists; не по шаблону — 400 code_format; обязательность вне типов сертификатов и документов — 409 mandatory_not_applicable; parentCode у commodity_type — действующее значение commodity_group, иначе 400 parent_invalid; аудит entry_created с названиями (ADM-08)»**;
  - «названия сохраняются тремя строками перевода (DATA-02)»;
  - «закрытые справочники: добавить, вывести, удалить — 409 dictionary_closed; переименовать — можно»;
  - «правка названий и порядка: аудит from/to; без изменения — 200 без записи»;
  - «обязательность (ADM-09): меняется только dictionary_entry.mandatory, аудит {from,to}; у выведенного — 409 entry_retired; повтор — без записи»;
  - **«вывод из оборота (DATA-04): выведенное не отдаётся выбору, остаётся в списке «выведенные» и «все»; возврат возвращает в выбор; обязательное вывести и удалить нельзя — 409 entry_mandatory»**;
  - **«значение, использованное в профиле, удалить нельзя: код ТН ВЭД в catalog_visible.tnved_codes и тип сертификата ASME в certificates.type_code — 409 entry_in_use, значение на месте; неиспользуемое удаляется вместе с переводами, аудит entry_deleted с прежними кодом и названиями (DATA-04, DATA-01)»** (строка `certificates` — через минимальную цепочку профиль → секция → редакция);
  - «выбор: только действующие; название на языке lang, запасной порядок kk → ru → en → код; неизвестный справочник — 404»;
  - «удаление одного значения дважды параллельно — 204 и 404, одна запись аудита»;
  - «исполнитель перестал быть администратором до транзакции — 403, запись denied с action reference.manage и путём маршрута».
  `contracts.test.ts`: «createDictionaryEntrySchema: без любого из трёх названий — отклоняется; код — строка»; «REFERENCE_PROBLEM_CODES без повторов».
- [ ] **Шаг 2.** Прогон — падают.
- [ ] **Шаг 3. Реализация** по Interfaces; перенос в `actor-transaction.ts` — прежние тесты администратора не меняются.
- [ ] **Шаг 4.** Прогон — зелёный (включая `admin*.test.ts`); полная проверка.
- [ ] **Шаг 5.** Коммит `Справочники: API администратора с поиском и страницами на сервере, обязательность типов, вывод из оборота вместо удаления используемого, выбор действующих значений (ADM-08, ADM-09, DATA-03, DATA-04)`.

---

### Task 4: файлы — проверка типа, карантин, ClamAV, скачивание с проверкой прав (GEN-09, DATA-05, DATA-06, DATA-07, NFR-09)

**Модель:** `opus` · **Независимое ревью:** да

**Files:**
- Modify: `packages/contracts/src/files.ts`; `apps/api/package.json` (`file-type` — текущая мажорная версия, `@types/multer` в dev).
- Create: `apps/api/src/modules/files/object-storage.ts`, `antivirus.ts`, `file-type.ts`, `upload.ts`, `file-access.ts`, `files.service.ts`, `files.controller.ts`; `apps/api/src/worker/file-scan.job.ts`.
- Modify: `apps/api/src/jobs/queues.ts` (`fileScan`, `fileScanSweep`, расписание; удалить `scanFile`, `ScanFileJob`); `apps/api/src/infra/infra.module.ts` (`OBJECT_STORAGE`, очередь `file-scan` в API); `apps/api/src/worker/handlers.service.ts` (удалить `scanFile`), `worker.module.ts` (маршруты, `ANTIVIRUS`, `FileScanJob`, `SCAN_PASSED_HOOKS = {}`); `apps/api/src/app.module.ts`; `scripts/requirements-baseline.json` (`--update-baseline`).
- Test: `apps/api/test/support/memory-storage.ts`, `support/antivirus-stub.ts`, `support/http.ts` (`upload`), `test/fixtures/files/` (`sample.pdf`, `sample.png`, `sample.jpg`, `sample.docx`, `sample.xlsx`, `plain.zip`, `program.exe` — docx/xlsx/zip собрать `python3 -c` с модулем `zipfile`: docx — `[Content_Types].xml` + `word/document.xml`, xlsx — `[Content_Types].xml` + `xl/workbook.xml`, zip — `a.txt`; exe — два байта `MZ` и нули); `test/file-type.test.ts`, `test/upload.http.test.ts`, `test/files.integration.test.ts` (новые); `test/edge-proxy.test.ts`; `clamd.test.ts` (остаётся).

**Interfaces:**
- Consumes: задача 1 — `fileObject`, `fileVersion`, `FILE_PURPOSES`, `DATA_CLASSES`, `MANUFACTURER_FILE_PURPOSES`; `ALLOWED_FILE_TYPES`, `MAX_FILE_BYTES` (`enums.ts`); задача 3 — `notFound`, `busy`; `withQueueTransaction`, `QueueDb`.
- Produces (contracts): `export type AllowedMediaType = keyof typeof ALLOWED_FILE_TYPES`; `fileExtensionMatches(name: string, mediaType: AllowedMediaType): boolean` (без учёта регистра; `jpeg` = `jpg`); `export const FILE_PROBLEM_CODES = ['validation','unauthenticated','mfa_required','responsibility_required','forbidden','bad_origin','not_found','file_missing','file_empty','file_too_large','file_type_not_allowed','file_type_mismatch','file_pending_scan','file_rejected','storage_unavailable','busy','internal'] as const`; `FileProblemCode`.
- Produces (хранилище и антивирус):
  ```ts
  export interface ObjectStorage {
    put(bucket: string, key: string, body: Buffer, contentType: string): Promise<void>;
    get(bucket: string, key: string): Promise<Readable>;
    copy(fromBucket: string, key: string, toBucket: string): Promise<void>;
    remove(bucket: string, key: string): Promise<void>;
  }
  export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE'); export class S3ObjectStorage implements ObjectStorage { constructor(s3: S3Client) }
  export interface Antivirus { scan(body: Readable): Promise<ScanVerdict> }   // ScanVerdict — из worker/clamd.ts
  export const ANTIVIRUS = Symbol('ANTIVIRUS'); export class ClamdAntivirus implements Antivirus { constructor(env: Env) }
  // test/support: MemoryObjectStorage implements ObjectStorage { readonly objects: Map<string, Buffer> /* `${bucket}/${key}` */; failNext(op: 'put' | 'get' | 'copy' | 'remove'): void }
  //               StubAntivirus implements Antivirus { verdict: ScanVerdict | Error; calls: number }
  ```
- Produces (загрузка): `detectMediaType(bytes: Buffer): Promise<AllowedMediaType | null>` (`fileTypeFromBuffer`, только 5 типов); `uploadInterceptor()` — `FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: 1, fields: 4 } })` с переводом ошибок multer: `LIMIT_FILE_SIZE` → `413 file_too_large`, `LIMIT_FILE_COUNT` / `LIMIT_UNEXPECTED_FILE` → `400 validation`; имя части заголовка — UTF-8 (`defParamCharset: 'utf8'`, если multer 2.5 его принимает, иначе `Buffer.from(name, 'latin1').toString('utf8')`); `export interface AcceptedUpload { originalName: string; declaredMediaType: string; mediaType: AllowedMediaType; bytes: Buffer; checksum: string /* sha256 hex */ }`; `acceptUpload(file: Express.Multer.File | undefined): Promise<AcceptedUpload>` — нет файла → `400 file_missing`; 0 байт → `400 file_empty`; имя — базовое (после последнего `/` или `\`), без управляющих символов, `trim`, до 255 символов; тип не определён → `415 file_type_not_allowed`; расширение не совпало → `415 file_type_mismatch`.
- Produces (сервис): `FilesService` (зависимости `DB`, `QUEUE`, `OBJECT_STORAGE`, `ENV`, `AuditService`):
  - `withStagedObject<T>(upload: AcceptedUpload, run: (storageKey: string) => Promise<T>): Promise<T>` — `put` в `S3_BUCKET_QUARANTINE` под `randomUUID()`; исключение из `run` → `remove` (сбой удаления — `warn` без ключа и имени) и повтор исключения;
  - `recordNew(tx: Database, queueDb: QueueDb, input: { organizationId: string | null; purpose: FilePurpose; dataClass: DataClass; uploadedBy: string; upload: AcceptedUpload; storageKey: string }): Promise<{ fileObjectId: string; versionId: string; versionNumber: 1 }>` — `file_object`, `file_version` (`detected_media_type = upload.mediaType`), задание `file-scan { fileVersionId }` через `queueDb`;
  - `recordVersion(tx, queueDb, fileObjectId: string, input: { uploadedBy: string; upload: AcceptedUpload; storageKey: string }): Promise<{ fileObjectId; versionId; versionNumber: number }>` — строка `file_object` `for update`, номер `max + 1`;
  - `open(auth: AuthContext, fileObjectId: string, version: number | null, ip: string | null): Promise<{ stream: Readable; originalName: string; mediaType: string; byteSize: number; versionNumber: number }>` — порядок: файл есть (иначе 404) → `FILE_READ_RULES[purpose]` (иначе аудит `file.read` `denied` и 403) → версия (по умолчанию последняя; нет — 404) → `pending` — `409 file_pending_scan`, `rejected` — `409 file_rejected` → `get` из `S3_BUCKET_FILES` (сбой — `503 storage_unavailable`) → аудит `file.downloaded`.
- Produces (права): `export type FileReadRule = (ctx: { tx: Database; auth: AuthContext; file: { id: string; organizationId: string | null; purpose: FilePurpose } }) => Promise<boolean>`; `manufacturerFileRule` — `can(role,'profile.read')` = `all`, или `own` и `file.organizationId === auth.user.organizationId`; `denyAll`; `export const FILE_READ_RULES: Record<FilePurpose, FileReadRule>` — `MANUFACTURER_FILE_PURPOSES` → `manufacturerFileRule`, остальные → `denyAll` (задача 5 заменяет `organisation_chart_sample`).
- Produces (тесты): `HttpStand.upload(path: string, role: Role | undefined, form: FormData): Promise<Response>` — POST со своим Origin, без `content-type` (границу ставит `fetch`).
- Produces (HTTP): `GET /api/v1/files/:id/content?version=<int ≥ 1>` (вошедший пользователь, без действия матрицы) → 200 поток; заголовки: `Content-Type` — тип по содержимому, `Content-Length`, `Content-Disposition: attachment; filename="<ASCII: прочие символы, кавычки и \ → _>"; filename*=UTF-8''<RFC 5987>`; ошибки: 404 `not_found` (и не-UUID id), 403 `forbidden`, 409 `file_pending_scan` / `file_rejected`, 503 `storage_unavailable`. `export const FILE_ROUTES = { content: '/api/v1/files/:id/content' }`.
- Produces (worker): `QUEUES.fileScan = 'file-scan'`, `QUEUES.fileScanSweep = 'file-scan-sweep'`; `export interface FileScanJobData { fileVersionId: string }`; расписание `{ queue: QUEUES.fileScanSweep, cron: '*/15 * * * *', note: 'файлы, ждущие скана дольше 15 минут, — снова в file-scan (DATA-07)' }`; `export type ScanPassedHook = (tx: Database, version: { id: string; fileObjectId: string; purpose: FilePurpose }) => Promise<void>`; `export const SCAN_PASSED_HOOKS = Symbol('SCAN_PASSED_HOOKS')` (`Partial<Record<FilePurpose, ScanPassedHook>>`); `FileScanJob` (зависимости `DB`, `OBJECT_STORAGE`, `ANTIVIRUS`, `ENV`, `AuditService`, `QUEUE`, `SCAN_PASSED_HOOKS`): `run({ fileVersionId }: FileScanJobData): Promise<'passed' | 'rejected' | 'skipped'>` — версии нет или не `pending` → `skipped`; `get` из карантина → `scan`; `clean` → `copy` в рабочий бакет → транзакция: `scan_state 'passed'`, `scanned_at`, хук назначения → `remove` из карантина; `FOUND` → транзакция: `'rejected'`, `scanned_at`, аудит `file.scan_rejected { signature }` → `remove`; ошибка clamd или хранилища — исключение (повтор pg-boss); `sweep(now: Date = new Date()): Promise<{ requeued: number }>` — `pending` с `uploaded_at < now − 15 мин` → `send(QUEUES.fileScan, { fileVersionId }, { singletonKey: fileVersionId })`.

- [ ] **Шаг 1. Тесты (сначала).** `file-type.test.ts`: «PDF, JPG, PNG, DOCX, XLSX определяются по содержимому; ZIP без word/ и xl/, exe и текст — null»; «расширение: .JPEG и .jpg — jpg; PNG с именем .pdf и файл без расширения — не совпадает». `upload.http.test.ts` (`startHttp` с тестовым контроллером `POST /api/test/upload` на `uploadInterceptor` + `acceptUpload`, ответ — `{ mediaType, originalName, byteSize }`):
  - **«граница 25 МБ и подделанный тип: PDF ровно 26 214 400 байт — принят; 26 214 401 — 413 file_too_large; пустой — 400 file_empty; без поля file — 400 file_missing; два файла — 400 validation; program.exe с именем .pdf и plain.zip с именем .docx — 415 file_type_not_allowed; sample.png с именем .pdf — 415 file_type_mismatch (DATA-06)»**;
  - **«имя файла: `C:\docs\Құрылым "IMBC"; v1.pdf` с переводом строки приходит базовым именем `Құрылым "IMBC"; v1.pdf` без управляющих символов и без порчи кириллицы»**.
  `files.integration.test.ts` (PostgreSQL 18 + pg-boss `pgboss_auth_test`; `MemoryObjectStorage`; `StubAntivirus`; HTTP — `startHttp({ controllers: [FilesController], providers: [настоящий FilesService], organizationId })`):
  - «recordNew: объект в карантине под UUID без имени; file_object и версия 1 pending с исходным именем, размером, типом по содержимому, sha256 и временем загрузки; задание file-scan в той же транзакции (DATA-05)»;
  - «сбой транзакции после put — объект карантина удалён, строк нет»;
  - «recordVersion: версия 2; версия 1 остаётся и скачивается по ?version=1 (MAN-36)»;
  - **«файл до прохождения скана не открывается никому: pending — 409 file_pending_scan, rejected — 409 file_rejected для производителя-владельца, SME и директора; passed — скачивается (DATA-07)»**;
  - «скан: passed — копия в рабочем бакете, карантин пуст, scanned_at; FOUND — rejected, аудит file.scan_rejected с сигнатурой, объект удалён; ошибка clamd — состояние pending, исключение; повтор после passed — skipped, StubAntivirus не вызван»;
  - «зачистка: pending старше 15 минут — снова в file-scan, моложе — нет; passed и rejected — нет»;
  - **«ссылка на чужой файл возвращает отказ и запись в аудит: производитель другой организации и администратор (ADM-06) — 403, аудит file.read denied с id файла; без сеанса — 401 (GEN-09)»**;
  - «права по назначению: владелец, SME и директор читают файл производителя; оператор и наблюдатель — 403; назначение без правила (site_survey_report) — 403 всем ролям»;
  - **«скачивание: Content-Type по содержимому, Content-Disposition attachment с filename*=UTF-8'' исходного казахского имени и ASCII-запасным filename, заголовок одной строкой; Cache-Control no-store; аудит file.downloaded без имени файла»**;
  - «хранилище недоступно при скачивании — 503 storage_unavailable, в журнале нет ключа и имени».
  `edge-proxy.test.ts`: «S3 не опубликован: Caddyfile и nginx.conf не упоминают rustfs и :9000; у rustfs в compose.yaml нет порта 9000, в compose.azure.yaml — только 127.0.0.1:9001 (NFR-09)».
- [ ] **Шаг 2.** Прогон — падают.
- [ ] **Шаг 3. Реализация** по Interfaces; `@ApiTags('files')`; старый `scanFile` и очередь `scan-file` удалить; `--update-baseline`.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка.
- [ ] **Шаг 5.** Коммит `Файлы: тип по содержимому и предел 25 МБ, карантин и ClamAV в worker, скачивание только через API с проверкой прав и аудитом (GEN-09, DATA-05, DATA-06, DATA-07, NFR-09)`.

---

### Task 5: образец оргструктуры — загрузка администратором, текущий после скана (ADM-11, MAN-19, DATA-07, NFR-09)

**Модель:** `opus` · **Независимое ревью:** да

**Files:**
- Modify: `packages/contracts/src/files.ts`.
- Create: `apps/api/src/modules/files/org-chart-sample.service.ts`, `org-chart-sample.controller.ts`.
- Modify: `apps/api/src/modules/files/file-access.ts` (`organisation_chart_sample`); `apps/api/src/worker/worker.module.ts` (хук в `SCAN_PASSED_HOOKS`); `apps/api/src/app.module.ts`.
- Test: `apps/api/test/org-chart-sample.http.test.ts`, `org-chart-sample.integration.test.ts` (новые).

**Interfaces:**
- Consumes: задача 4 — `uploadInterceptor`, `acceptUpload`, `AcceptedUpload`, `FilesService.withStagedObject`, `recordNew`, `FileReadRule`, `FILE_READ_RULES`, `ScanPassedHook`, `FileScanJob`, `MemoryObjectStorage`, `StubAntivirus`, `HttpStand.upload`; задача 3 — `actorTransaction`.
- Produces (contracts):
  ```ts
  export const orgChartSampleFileSchema = z.object({ fileId: z.uuid(), originalName: z.string(), byteSize: z.number().int(),
    mediaType: z.string(), scanState: z.enum(FILE_SCAN_STATES), uploadedAt: z.string() }).strict();
  export const orgChartSampleStateSchema = z.object({ current: orgChartSampleFileSchema.nullable(),
    latest: orgChartSampleFileSchema.nullable() }).strict(); // latest — последняя загрузка, если она не текущая
  export const orgChartSampleUploadSchema = z.object({ upload: orgChartSampleFileSchema }).strict();
  ```
- Produces (HTTP):

| Маршрут | Право | Тело | Успех | Ошибки |
|---|---|---|---|---|
| `GET /api/v1/org-chart-sample` | `reference.read` | — | 200 `orgChartSampleStateSchema` | — |
| `POST /api/v1/org-chart-sample` | `reference.manage` | multipart, поле `file` | 202 `orgChartSampleUploadSchema` (`pending`) | 400 `file_missing`, `file_empty`, `validation`; 413 `file_too_large`; 415 `file_type_not_allowed`, `file_type_mismatch`; 503 `busy`, `storage_unavailable` |

- Produces (сервис): `OrgChartSampleService` (зависимости `DB`, `PG_POOL`, `FilesService`, `AuditService`): `state(): Promise<OrgChartSampleState>`; `upload(actor: AuthUser, upload: AcceptedUpload, ip: string | null): Promise<OrgChartSampleUpload>` — `withStagedObject` → `actorTransaction(…, { action: 'reference.manage', route: '/api/v1/org-chart-sample' })` → `recordNew({ organizationId: actor.organizationId /* IMBC */, purpose: 'organisation_chart_sample', dataClass: 'e_administration', … })` → строка `org_chart_sample` (`is_current: false`, `uploaded_at = now()`) → аудит `org_chart_sample.uploaded`.
- Produces (правила): `orgChartSamplePassed: ScanPassedHook` — все строки `org_chart_sample` `for update`; строка этого файла становится текущей, только если её `uploaded_at` позже текущей (или текущей нет); прежняя — `is_current = false`. `orgChartSampleReadRule: FileReadRule` — `can(role,'reference.read')` → да; `can(role,'profile.edit') === 'own'` и строка образца этого файла `is_current` → да (MAN-19, расхождение 2); иначе нет.

- [ ] **Шаг 1. Тесты (сначала).** `org-chart-sample.http.test.ts`: таблица из двух маршрутов × роли матрицы (разрешённые — сервис вызван; отклонённые — 403, `denied` в аудите, сервис не вызван); без сеанса — 401; POST с чужого Origin — `403 bad_origin`; POST без файла — 400 `file_missing`. `org-chart-sample.integration.test.ts` (PostgreSQL 18 + pg-boss; `MemoryObjectStorage`; `StubAntivirus`; `FileScanJob.run` вызывается тестом):
  - «загрузка: file_object класса e_administration организации IMBC, строка org_chart_sample не текущая, 202 pending; аудит org_chart_sample.uploaded без имени файла (ADM-11)»;
  - «пока новый на проверке, текущий — прежний; скан прошёл — новый текущий, прежний остаётся строкой истории; не прошёл — текущий прежний, latest — rejected (DATA-07)»;
  - **«два образца: новый прошёл раньше старого — текущим остаётся новый»**;
  - «производитель скачивает текущий образец (MAN-19); прежний образец — 403; SME, оператор и наблюдатель — 403 с записью file.read denied; администратор и директор скачивают любой»;
  - «state: без образцов — current null, latest null; после прохождения — latest null»;
  - «исполнитель перестал быть администратором — 403, объект карантина удалён, строк нет».
- [ ] **Шаг 2.** Прогон — падают.
- [ ] **Шаг 3. Реализация** по Interfaces; `@ApiTags('reference')`, `@ApiConsumes('multipart/form-data')`.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка.
- [ ] **Шаг 5.** Коммит `Образец оргструктуры: загружает администратор, текущим становится после скана, производитель скачивает текущий (ADM-11, MAN-19, DATA-07)`.

---

### Task 6: основа уведомлений — правила-данные, журнал, получатели, язык, тексты в языковых файлах (NOT-18, NOT-19, NOT-20, NOT-21, LANG-02, DATA-02)

**Модель:** `opus` · **Независимое ревью:** да

**Files:**
- Create: `apps/api/src/mail/messages/{en,kk,ru}.json`; `apps/api/src/notifications/rules.ts`, `recipients.ts`, `dispatcher.ts`, `enqueue.ts`, `links.ts`.
- Modify: `apps/api/src/mail/templates.ts` (тексты из JSON; `renderNotification`); `apps/api/src/mail/mail.service.ts` (`sendOnce`; `send` и `sendRaw` удаляются); `apps/api/src/infra/infra.module.ts` (таймауты nodemailer `connectionTimeout: 10_000`, `greetingTimeout: 10_000`, `socketTimeout: 30_000`; очередь `notify` в API); `apps/api/src/jobs/queues.ts` (`QUEUES.notify`; удалить `sendNotification`, `SendNotificationJob`); `apps/api/src/worker/handlers.service.ts` (`keycloakEvents` → диспетчер; удалить `sendNotification` и `notificationsSent`; последний параметр конструктора `notifications: NotificationDispatcher`), `worker.module.ts` (маршрут `notify`, провайдеры `NotificationDispatcher`, `RECIPIENT_RESOLVERS`, `NOTIFICATION_RENDERER`); `apps/api/src/modules/auth/auth.controller.ts` (`sendOtp` → `mail.sendOnce`); `apps/api/src/config/env.ts`, `compose.yaml`, `.env.example` (удалить `IMBC_MAILBOX`).
- Test: `apps/api/test/support/mail.ts` (`fakeTransport()`); `apps/api/test/mail.test.ts`, `mail-messages.test.ts`, `notification-links.test.ts`, `notifications.integration.test.ts` (новые, кроме `mail.test.ts`); конструкторы `JobHandlers` и моки почты — `auth.integration.test.ts` (в т. ч. `:150`, `:225`, `:488`, `:596`), `adata-prefill.integration.test.ts` (`:208`, `:382`–`:410`), `account-inactivity.integration.test.ts:76`, `account-lifecycle.integration.test.ts:214`, `onboarding.integration.test.ts` (`:136`, `:420`–`:428`: `QUEUES.notify` и строки `notification` вместо `sendNotification` и `sendRaw`).

**Interfaces:**
- Consumes: задача 1 — `notificationRule`, `notification`, 17 правил `0010`; `organizations.notificationMailbox` (этап 1); `destinationFor` (`@imbc/contracts`).
- Produces (`rules.ts`):
  ```ts
  export const NOTIFICATION_RULE_CODES = ['NOT-01', /* … */ 'NOT-17'] as const; export type NotificationRuleCode;
  export const ACCOUNT_SECURITY_RULES: readonly NotificationRuleCode[] = ['NOT-01', 'NOT-02', 'NOT-03']; // расхождение 1
  export const RECIPIENT_PARTS = ['person', 'manufacturer_account', 'focal_point', 'manufacturer_contacts',
    'imbc_mailbox', 'assigned_sme_or_imbc_mailbox', 'operator_accounts_not_blocked'] as const; export type RecipientPart;
  export function parseRecipientRule(text: string): RecipientPart[]; // части через '+', неизвестная — Error
  export function notificationDedupKey(rule: string, eventKey: string, email: string): string; // `${rule}\n${eventKey}\n${email.trim().toLowerCase()}`
  ```
- Produces (`enqueue.ts`): `export const notifyJobSchema = z.object({ rule: z.enum(NOTIFICATION_RULE_CODES), eventKey: z.string().min(1).max(200), accountId: z.uuid().optional(), organizationId: z.uuid().optional(), profileId: z.uuid().optional(), related: z.object({ type: z.string().min(1).max(64), id: z.uuid() }).strict().optional(), params: z.record(z.string(), z.string().max(500)).default({}) }).strict()`; `export type NotifyJob = z.infer<typeof notifyJobSchema>`; `enqueueNotification(queue: PgBoss, job: NotifyJob, queueDb?: QueueDb): Promise<void>` — разбор схемой, `send(QUEUES.notify, job, { db: queueDb })`. Почты и ФИО в задании нет — только id, коды и параметры.
- Produces (`recipients.ts`): `export interface Recipient { email: string; source: 'account' | 'contact' | 'imbc_mailbox'; accountId: string | null; languageAccountId: string | null }`; `export type RecipientResolver = (db: Database, job: NotifyJob) => Promise<Recipient[]>`; `export class RecipientPartNotReady extends Error { constructor(part: RecipientPart, stage: '3' | '5') }`; `export const RECIPIENT_RESOLVERS = Symbol('RECIPIENT_RESOLVERS')`; `export const DEFAULT_RECIPIENT_RESOLVERS: Record<RecipientPart, RecipientResolver>` — `person`: аккаунт `job.accountId`; `manufacturer_account`: аккаунт роли `manufacturer` организации `job.organizationId` (или организации профиля `job.profileId`); `imbc_mailbox`: `notification_mailbox` организации IMBC (`languageAccountId: null`); `operator_accounts_not_blocked`: аккаунты организаций `operator` с `state <> 'blocked'`; `focal_point`, `manufacturer_contacts` — `RecipientPartNotReady(part, '3')`; `assigned_sme_or_imbc_mailbox` — `(part, '5')`. У аккаунта `languageAccountId = accountId`.
- Produces (`dispatcher.ts`): `export const NOTIFICATION_RENDERER = Symbol('NOTIFICATION_RENDERER')`; `export type NotificationRenderer = (rule: NotificationRuleCode, language: Locale, params: Record<string, string>) => RenderedMail`; `export interface DispatchResult { sent: number; duplicates: number; skippedObservers: number; invalid: number; skipped: 'disabled' | 'no_recipients' | null }`; `NotificationDispatcher` (зависимости `DB`, `MailService`, `RECIPIENT_RESOLVERS`, `NOTIFICATION_RENDERER`): `dispatch(job: NotifyJob): Promise<DispatchResult>`. Порядок: правило по коду (нет — Error); `enabled = false` → `skipped: 'disabled'`; части `parseRecipientRule` по порядку → получатели; адрес не проходит `z.email()` → `invalid`; если правило не в `ACCOUNT_SECURITY_RULES` — убрать получателей с аккаунтом роли `observer` и любой адрес, совпадающий без учёта регистра с логином аккаунта-наблюдателя (NOT-21); свести по `lower(email)`, при совпадении остаётся `account` → `contact` → `imbc_mailbox` (NOT-18); язык — `locale` аккаунта `languageAccountId`, без него — `kk` (NOT-19); каждому — `render` и `mail.sendOnce`; все адреса пробуются, сбой хотя бы одного — после остальных `Error('notification <rule>: <n> не отправлено')` без адресов. Часть `imbc_mailbox` ничего не дала — `warn 'notification <rule>: ящик IMBC не задан'`. Итог в журнал — `notification <rule>: sent N, duplicates M, observers K` без адресов.
- Produces (почта): `export type MailTemplateCode = 'NOT-02' | 'NOT-03'`; `export interface RenderedMail { subject: string; text: string; html: string }`; `renderNotification(code: MailTemplateCode, language: Locale, params: Record<string, string>): RenderedMail` — подстановки `{name}`, в HTML экранирование; недостающая подстановка — Error; `renderMail(code, locale: string, vars)` остаётся обёрткой (`toLocale`), переменные NOT-03 — `{ minutes: number; link: string }` вместо `publicUrl` (`mail.test.ts` — так же). Файлы `messages/<lang>.json`: `{ "footer": string, "templates": { "NOT-02": { "subject", "lines": string[] }, "NOT-03": { … } } }` — нынешние тексты `templates.ts` дословно; подстановки NOT-02 — `{code}`, `{minutes}`; NOT-03 — `{minutes}`, `{link}`. `MailService` (зависимости `MAILER`, `ENV`, `DB`): `sendOnce(entry: { ruleCode: NotificationRuleCode; eventKey: string; to: string; accountId: string | null; language: Locale; related?: { type: string; id: string } }, mail: RenderedMail): Promise<'sent' | 'duplicate'>` — транзакция: `insert notification … on conflict (dedup_key) do nothing returning id` (нет строки → `duplicate`), `sendMail` с заголовком `X-IMBC-Notification: <ruleCode>`, `COMMIT`; сбой SMTP — откат и исключение.
- Produces (ссылки): `appLink(publicUrl: string, path: string): string` — путь страницы приложения: начинается с `/`, не `//`, не `/api`, не `/kc`, без `?` и `#`, символы `[A-Za-z0-9\-._~/]`; иначе Error; результат `${publicUrl}${path}` (NOT-20).
- Produces (вызовы): `keycloakEvents` — для `USER_DISABLED_BY_TEMPORARY_LOCKOUT`: `notifications.dispatch({ rule: 'NOT-03', eventKey: \`${userId}:${time}\`, accountId, params: { minutes: '15', link: appLink(PUBLIC_URL, '/login') } })` в `try/catch` (`warn` без адреса); аудит `auth.locked_out` — только если `sent > 0`. `AuthController.sendOtp` — `mail.sendOnce({ ruleCode: 'NOT-02', eventKey: \`otp:${issued.id}\`, to, accountId, language: toLocale(locale), related: { type: 'otp_code', id: issued.id } }, renderMail('NOT-02', locale, vars))`; поведение при сбое — прежнее (`503 mail_unavailable`, код отброшен).

- [ ] **Шаг 1. Тесты (сначала).** `mail-messages.test.ts`: «три файла писем: одинаковые ключи и длина lines; одни и те же подстановки в каждом ключе; нет ICU-форматов `{x, number}`, `#`; английский — источник (LANG-02)»; «renderNotification: экранирует HTML, недостающая подстановка — ошибка». `mail.test.ts` — прежние ожидания на новых файлах. `notification-links.test.ts`: «appLink: '/companies/<uuid>' → PUBLIC_URL + путь; '//evil.local', '/api/v1/files/x/content', '/kc/realms/imbc', '/reviews?token=1', 'https://x' — ошибка (NOT-20)»; «страница по ссылке закрыта без права: destinationFor('observer', '/reviews') → '/dashboard'». `notifications.integration.test.ts` (PostgreSQL 18 + pg-boss; настоящий `MailService` с `fakeTransport()`; резолверы — `DEFAULT_RECIPIENT_RESOLVERS`, где нужно — подмена одной части; рендерер — тестовый, кроме NOT-03):
  - **«повтор события не отправляет второе письмо на тот же адрес: два задания NOT-04 с одним eventKey — одно письмо ящику IMBC, одна строка notification (NOT-18)»**;
  - **«один адрес в разном регистре — одно письмо: аккаунт Maker@Stage2.local и контакт maker@stage2.local — одна строка, источник account, язык аккаунта (NOT-18)»**;
  - **«наблюдателю письмо не уходит: получатель-аккаунт observer и ящик IMBC, равный логину наблюдателя без учёта регистра, пропущены (skippedObservers 2); NOT-03 наблюдателю уходит (NOT-21)»**;
  - **«язык письма (NOT-19): аккаунт ru — ru; аккаунт без выбора — kk; контакт — язык аккаунта производителя en; ящик IMBC — kk при языке администратора ru»**;
  - **«ящик IMBC не задан — письма нет, skipped no_recipients, предупреждение без адреса, задание завершено»**;
  - «правило выключено — писем нет, skipped disabled»;
  - **«сбой SMTP на втором из трёх адресов: первый и третий отправлены, задание падает; повтор отправляет только второй; итог — три строки, три адреса без дублей»** (части `operator_accounts_not_blocked`, три оператора);
  - **«параллельные задания одного события — одно письмо на адрес»** (`Promise.all` двух `dispatch`);
  - «operator_accounts_not_blocked — без blocked, с invited и inactive; manufacturer_account — единственный аккаунт организации производителя; три адреса — три строки журнала (DATA-02)»;
  - «каждое из 17 правил разбирается parseRecipientRule; части этапов 3 и 5 бросают RecipientPartNotReady»;
  - «notifyJobSchema: лишний ключ и почта вне params — отклоняются; enqueueNotification ставит задание в транзакции вызывающего»;
  - «NOT-03 по блокировке входа: одно письмо на языке аккаунта, строка notification и аудит auth.locked_out; повтор пакета событий — ни письма, ни записи» (через `JobHandlers.keycloakEvents` с заглушкой Keycloak);
  - «NOT-02: строка журнала с NOT-02, адресом, языком и related otp_code; кода нет ни в одной колонке; сбой SMTP — строки нет».
  Тесты с `JobHandlers` и `AuthController` — новые конструкторы и `sendOnce` вместо `send`/`sendRaw`; смысл тестов не меняется («отзывы до писем», «SMTP недоступен — отзыв всё равно»).
- [ ] **Шаг 2.** Прогон — падают.
- [ ] **Шаг 3. Реализация** по Interfaces; `IMBC_MAILBOX` удалить из `env.ts`, `compose.yaml`, `.env.example`; `docker compose config -q`.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка.
- [ ] **Шаг 5.** Коммит `Уведомления: правила получателей данными, журнал notification, одно письмо на адрес без учёта регистра, язык получателя, без наблюдателей, тексты писем в языковых файлах (NOT-18, NOT-19, NOT-20, NOT-21, LANG-02)`.

---

### Task 7: NOT-01 на языке получателя — тема писем Keycloak IMBC (NOT-19, NOT-20, AUTH-01, LANG-02)

**Модель:** `sonnet` · **Независимое ревью:** нет

**Files:**
- Create: `infrastructure/keycloak/identity/src/email/theme.properties` (`parent=base`, `locales=kk,ru,en`), `src/email/messages/messages_en.properties`, `messages_ru.properties`, `messages_kk.properties` — сначала `npx keycloakify initialize-email-theme` установленной версии 11.16.4 (если команды нет — каталог по структуре темы писем Keycloak); шаблоны `.ftl` базовой темы не переопределяются.
- Modify: `infrastructure/keycloak/imbc-realm.json` (`"emailTheme": "${KEYCLOAK_EMAIL_THEME}"`); `compose.yaml` (keycloak: `KEYCLOAK_EMAIL_THEME: ${KEYCLOAK_EMAIL_THEME:-keycloak}`); `compose.azure.yaml` (keycloak: `KEYCLOAK_EMAIL_THEME: imbc`); `infrastructure/azure/sync-realm.py` (`emailTheme` в `REALM_FIELDS`, аргумент `--email-theme` по умолчанию `imbc`); `infrastructure/keycloak/identity/README.md` (строка «Keep `emailTheme` unchanged» — тема писем теперь своя).
- Test: `apps/api/test/keycloak-email-theme.test.ts` (новый); `infrastructure/azure/test/sync-realm.test.py`.

**Interfaces:**
- Consumes: Keycloak 26.4 базовая тема `email` (ключи и номера параметров — из её `messages_en.properties`).
- Produces: тема писем `imbc` в том же JAR, что тема входа. Ключи в трёх файлах (имена и параметры `{0}`…`{4}` — как в базовой теме): `executeActionsSubject`, `executeActionsBody`, `executeActionsBodyHtml`, `passwordResetSubject`, `passwordResetBody`, `passwordResetBodyHtml`, `requiredAction.UPDATE_PASSWORD`, `requiredAction.VERIFY_EMAIL`, `linkExpirationFormatter.timePeriodUnit.seconds|minutes|hours|days` (и их формы единственного числа, если они есть в базовой). Темы: en «IMBC Platform: set your password» / «IMBC Platform: reset your password»; ru «Платформа IMBC: установите пароль» / «Платформа IMBC: сброс пароля»; kk «IMBC платформасы: құпиясөзді орнатыңыз» / «IMBC платформасы: құпиясөзді қалпына келтіру». Тело: ссылка, срок ссылки — параметр форматтера (не число в тексте), «пароль в письме не отправляется», «если вы не запрашивали — проигнорируйте письмо»; без адреса поддержки.

- [ ] **Шаг 1. Тесты (сначала).** `keycloak-email-theme.test.ts`: «тема писем imbc: три файла сообщений с одинаковыми ключами; обязательные ключи на месте; kk и ru не совпадают с en ни в одной теме и теле; в каждом теле есть параметр ссылки и параметр срока, числа часов нет (NOT-19, NOT-20)»; «theme.properties: locales kk,ru,en»; «realm: emailTheme — ${KEYCLOAK_EMAIL_THEME}; compose.yaml — по умолчанию keycloak, compose.azure.yaml — imbc». `sync-realm.test.py`: «emailTheme синхронизируется значением --email-theme (по умолчанию imbc)».
- [ ] **Шаг 2.** `pnpm --filter @imbc/api exec vitest run test/keycloak-email-theme.test.ts`, `python3 infrastructure/azure/test/sync-realm.test.py` — падают.
- [ ] **Шаг 3. Реализация**; `cd infrastructure/keycloak/identity && npm run typecheck`; сборку JAR (`build:theme`, нужны Maven и JDK) не запускать, если их нет, — отметить в отчёте; `docker compose config -q`.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка.
- [ ] **Шаг 5.** Коммит `Письмо установки и сброса пароля на языке получателя: тема писем Keycloak IMBC на казахском, русском и английском (NOT-19, NOT-20, AUTH-01, LANG-02)`.

---

### Task 8: кабинет — страница «Справочники» и образец оргструктуры (ADM-08, ADM-09, ADM-11, DATA-03, DATA-04, GEN-08, LANG-01)

**Модель:** `sonnet` · **Независимое ревью:** нет

**Files:**
- Create: `apps/web/src/routes/app/references.tsx` (`ReferencesPage`), `references-entries.tsx`, `references-dialogs.tsx`, `org-chart-sample-card.tsx`, `references-actions.ts`; `apps/web/src/lib/references-params.ts`; `apps/web/src/components/ui/{pagination,switch,tabs}.tsx` — `pnpm dlx shadcn@4.23.0 add pagination switch tabs`.
- Modify: `apps/web/src/router.tsx` (`references`, `handle: { title: 'references.title' }`); `apps/web/src/components/app/app-shell.tsx` (пункт «Справочники», `BookOpenIcon`, `show: !!can(role, 'reference.read')`, после «Аккаунтов»); `apps/web/src/routes/app/admin-actions.ts` (`useAdminAction({ request, done, invalidate?: QueryKey[] })`, по умолчанию `[ADMIN_ACCOUNTS_KEY]`); `packages/contracts/src/auth.ts` (`GUARDED_PAGES`: `['/references', 'reference.read']`); `apps/web/messages/{en,kk,ru}.json`.
- Test: `apps/web/test/references.test.tsx` (новый); `app-shell.test.tsx`; `packages/contracts/test/auth.test.ts`; `messages.test.ts`, `admin-accounts.test.tsx` (остаются зелёными).

**Interfaces:**
- Consumes: задача 3 — маршруты, `dictionary*Schema`, `REFERENCE_PROBLEM_CODES`, `DICTIONARY_CODES`, `CLOSED_DICTIONARIES`, `MANDATORY_DICTIONARIES`, `DICTIONARY_PARENT`, `DICTIONARY_CODE_PATTERNS`, `DICTIONARY_ENTRY_STATUSES`, `entryDisplayName`; задачи 4–5 — `GET/POST /api/v1/org-chart-sample`, `GET /api/v1/files/:id/content`, `orgChartSampleStateSchema`, `FILE_PROBLEM_CODES`, `ALLOWED_FILE_TYPES`.
- Produces: `references-params.ts` — `referencesParsers = { list: parseAsStringLiteral(DICTIONARY_CODES).withDefault('certificate_type'), q: parseAsString.withDefault(''), status: parseAsStringLiteral(DICTIONARY_ENTRY_STATUSES).withDefault('active'), page: parseAsInteger.withDefault(1) }` (смена списка, поиска или статуса сбрасывает `page`); `references-actions.ts` — `REFERENCES_KEY = ['references'] as const`, `REFERENCE_PROBLEM_MESSAGES: Record<ReferenceProblemCode | FileProblemCode, keyof Messages['references']['errors']>`, `useReferenceProblemMessage()`.

Экран `/references` (заголовок вкладки и `h1` — «Справочники»), сверху вниз:
1. `h1` и строка описания («Значения, из которых выбирают производители и SME. Используемое значение не удаляют — его выводят из оборота»).
2. Строка итога действия — как на `/admin/accounts` (липкая, `aria-live="polite"`, «Скрыть»).
3. `Card` справочника. `CardHeader`: `CardTitle` — название справочника (`references.list.<code>`); `CardDescription` — для закрытых «Коды заданы спецификацией: меняются только названия»; для типов сертификатов и документов «Изменение обязательности действует для профилей, отправленных после него». `CardAction`: `Select` из 12 справочников (`aria-label` «Справочник», `items`, `alignItemWithTrigger={false}`) и кнопка «Добавить значение» (только `can(role,'reference.manage')` и не закрытый). Под шапкой — поле поиска `InputGroup` (значок, плейсхолдер «Код или название», кнопка очистки; задержка 350 мс, затем адрес) и `Tabs` «Действующие (N) · Выведенные (M) · Все» по счётчикам списка.
4. Таблица значений. ≥ 640 px: «Код» (`font-mono`, без переноса), «Название» (`entryDisplayName` на языке интерфейса), «Группа» (только `commodity_type`), «Обязательный» (только типы сертификатов и документов: `Switch` с `aria-label` «Обязательный: {code}» у администратора, «Да/Нет» у директора), «Состояние» (`Badge` «Действует» / «Выведено из оборота»), меню `DropdownMenu` «Действия: {code}» — «Изменить названия», «Вывести из оборота» / «Вернуть в оборот», «Удалить» (через `AlertDialog`); у закрытых — только «Изменить названия»; у директора меню нет. < 640 px (390 px): две колонки — в первой код, название и бейджи (группа, «Обязательный», «Выведено»), переключатель обязательности под названием; во второй — меню; горизонтальной прокрутки нет.
5. Подвал таблицы: «Показано {from}–{to} из {total}» (`format.number`) и `Pagination` (Назад, номера с многоточием, Далее — кнопки, не ссылки); скрыт, если всё помещается на одну страницу.
6. Состояния: загрузка — 8 строк `Skeleton`; ошибка — `Alert` с «Повторить»; пустой справочник — `Empty` «В справочнике пока нет значений» (у администратора — кнопка «Добавить значение»); пустой поиск — `Empty` «Ничего не найдено по запросу «{q}»» и «Сбросить поиск».
7. `Card` «Образец оргструктуры» («Производители скачивают образец в разделе «Персонал». Это пример, а не обязательный шаблон»): текущий файл — имя, размер, дата (`format.dateTime`) и ссылка «Скачать» (`<a href="/api/v1/files/{fileId}/content">` с `buttonVariants`); нет — «Образец не загружен». Последняя загрузка не текущая: `pending` — `Badge` «Проверяется антивирусом» и «Текущий образец доступен, пока новый не прошёл проверку», опрос каждые 5 с (`refetchInterval`) до смены состояния; `rejected` — `Badge` `destructive` «Не прошёл проверку». У администратора — «Загрузить образец» / «Заменить образец» (скрытый `input type="file"`, `accept` из `ALLOWED_FILE_TYPES`, `FormData` с полем `file`); ошибка загрузки — `Alert` в карточке с переводом кода.
8. Диалоги. «Добавить значение»: «Код» (`input type="text"`, `inputMode="numeric"` у `oked` и `tn_ved`, подсказка формата: «10 цифр», «5 цифр»), «Название (қазақша)», «Название (русский)», «Название (English)» — все обязательны; «Группа» (`Select` действующих групп из `choices`) — только `commodity_type`; `Checkbox` «Обязательный тип» — только типы сертификатов и документов. «Изменить названия»: три названия, «Порядок» (число), группа у `commodity_type`. Удаление — `AlertDialog` «Удалить {code}?» с пояснением «Используемое значение удалить нельзя — его можно вывести из оборота». Ошибка — у поля (`entry_exists`, `code_format` — у кода; `parent_invalid` — у группы) или общим `Alert` в диалоге. Успех — строка итога и перечитывание `REFERENCES_KEY`.

Ключи `references.*` (английский — источник; ru и kk — в том же коммите): `title` Reference lists · `description` Values manufacturers and SMEs choose from. A value in use is not deleted: it is retired. · `list` Reference list · `list.<code>` (12: Regions, Legal forms, OKED, TN VED, KPVED, Commodity groups, Commodity types, Processes, Equipment types, Contact roles, Certificate types, Document types; ru/kk — тексты прототипа `shared/texts.ts`) · `closedHint` Codes are set by the specification: only names can be changed. · `mandatoryHint` A change of mandatory types applies to profiles submitted afterwards. · `search` Code or name · `clearSearch` Clear search · `status.active` In use ({count}) · `status.retired` Retired ({count}) · `status.all` All · `code` Code · `name` Name · `group` Commodity group · `mandatory` Mandatory · `state` State · `inUse` In use · `retired` Retired · `yes` / `no` · `actions` Actions: {code} · `add` Add value · `edit` Edit names · `retire` Retire · `restore` Return to use · `delete` Delete · `deleteTitle` Delete {code}? · `deleteText` A value in use cannot be deleted; it can be retired instead. · `nameKk` Name (Kazakh) · `nameRu` Name (Russian) · `nameEn` Name (English) · `sortOrder` Order · `codeHint.tn_ved` 10 digits · `codeHint.oked` 5 digits · `save` / `cancel` · `shown` Showing {from}–{to} of {total} · `empty` The list has no values yet. · `noResults` Nothing found for “{q}”. · `loadError` Could not load the reference list. · `added` / `updated` / `madeMandatory` / `madeOptional` / `retiredDone` / `restoredDone` / `deleted` (строки итога с {code}) · `sample.title` Organisation-chart sample · `sample.hint` Manufacturers download this sample in the Personnel section. It is an example, not a required template. · `sample.none` No sample uploaded. · `sample.download` Download · `sample.upload` Upload sample · `sample.replace` Replace sample · `sample.pending` Being scanned for viruses · `sample.pendingHint` The current sample stays available until the new one passes the scan. · `sample.rejected` Failed the scan · `sample.uploaded` The sample has been uploaded and is being scanned. · `errors.<код>` для каждого кода `REFERENCE_PROBLEM_CODES` и `FILE_PROBLEM_CODES` (`file_too_large` — «The file is larger than 25 MB.», `file_type_not_allowed` — «Allowed types: PDF, JPG, PNG, DOCX, XLSX.», `file_type_mismatch` — «The file content does not match its extension.», `entry_in_use` — «The value is in use: retire it instead of deleting.»). `nav.references` Reference lists.

- [ ] **Шаг 1. Просмотр компонентов.** MCP shadcn, реестр `@shadcn`: `pagination`, `pagination-demo`, `switch`, `switch-demo`, `field-switch`, `tabs`, `tabs-demo`, `input-group`, `empty`, `select`, `dialog`, `alert-dialog`, `dropdown-menu`, `field`, `table`, `data-table-demo` (только образец колонки действий и пустой строки — без `@tanstack/react-table`); `pnpm dlx shadcn@4.23.0 view pagination switch tabs` для кода `base-nova`. Затем `pnpm dlx shadcn@4.23.0 add pagination switch tabs` из `apps/web`; локальная правка `sidebar.tsx` не задевается.
- [ ] **Шаг 2. Тесты (сначала)**, `references.test.tsx` (заглушки `api`):
  - «справочники: Select из двенадцати, выбор меняет адрес ?list= и запрос; загрузка — скелет; ошибка — Alert с повтором; пустой — сообщение; пустой поиск — «Ничего не найдено» и «Сбросить поиск»»;
  - «поиск, статус и страница в адресе: ввод — один запрос через 350 мс с q; «Далее» — page=2; смена статуса — page=1; адрес ?list=tn_ved&q=0101&page=2 воспроизводит запрос»;
  - **«код с ведущими нулями: ввод '0101210000' уходит строкой, в таблице — '0101210000' (DATA-03)»**;
  - «добавление: три названия обязательны; «Обязательный тип» — только у типов сертификатов и документов; «Группа» — только у типов товаров; 409 entry_exists и 400 code_format — у поля кода; успех — строка итога, список перечитан»;
  - «закрытые справочники: нет «Добавить», в меню только «Изменить названия»»;
  - «обязательность: Switch шлёт PUT …/mandatory; 409 entry_retired — сообщение (ADM-09)»;
  - «вывод из оборота и возврат; удаление через подтверждение; 409 entry_in_use — «выведите из оборота» (DATA-04)»;
  - «директор (reference.read): те же данные без кнопок, меню, переключателей и загрузки, обязательность — «Да/Нет» (GEN-08)»;
  - «образец оргструктуры: текущий — ссылка /api/v1/files/{id}/content (getByRole('link')); загрузка — FormData с полем file; pending — «Проверяется антивирусом» и опрос до passed; rejected — сообщение; 413 и 415 — переведённые сообщения (ADM-11)»;
  - «каждый код REFERENCE_PROBLEM_CODES и FILE_PROBLEM_CODES переведён»;
  - «меню, диалоги и переключатели доступны с клавиатуры (Enter, Escape, возврат фокуса)»; «тексты на kk и en».
  `app-shell.test.tsx`: «пункт «Справочники» — у администратора и директора, у остальных ролей нет». `auth.test.ts`: «destinationFor: /references — оператору, наблюдателю, SME, производителю — стартовая; директору и администратору — /references».
- [ ] **Шаг 3.** `pnpm --filter @imbc/web test -- references app-shell` и `pnpm --filter @imbc/contracts test` — падают.
- [ ] **Шаг 4. Реализация** по описанию экрана и Interfaces; переводы.
- [ ] **Шаг 5.** Прогон — зелёный; полная проверка.
- [ ] **Шаг 6. Браузер** (если контроллер поднял локальный стенд): `/references` под `admin@imbc.local` и `director@imbc.local` на 1280 и 390 px — нет горизонтальной прокрутки, таблица и диалоги читаются, загрузка образца доходит до «Текущий»; снимки — в отчёт. Без стенда — в отчёте «в браузере не проверено».
- [ ] **Шаг 7.** Коммит `Кабинет: справочники с поиском и страницами, обязательность типов, вывод из оборота, образец оргструктуры; kk, ru, en, 390 px (ADM-08, ADM-09, ADM-11, DATA-04)`.

---

### Task 9: документы этапа и приёмочный сценарий (ACC-01, NFR-06)

**Модель:** `sonnet` · **Независимое ревью:** нет

**Files:**
- Modify: `README.md` — §1 (правила: файл до скана, уведомления — журнал `notification`), §4 (строки Documents, Notifications, Reference Data: таблицы DBML, требования v1.3, маршруты), §5 (ClamAV — `file-scan`), §6 (`0009`, `0010`; формат `reference-data` — поля, статусы `specification`/`imbc`/`provisional`, порядок загрузки, как добавить перечень IMBC; роли БД: `notification` только добавление, `notification_rule` и `dictionary` только чтение), §7 (новые подразделы «Файл», «Справочники», «Уведомления»; таблица заданий: `file-scan`, `file-scan-sweep`, `notify` вместо `scan-file`, `send-notification`), §8 «Почта» (таблица писем: NOT-02 и NOT-03 в журнале, NOT-01 — тема `imbc`), §13 (`KEYCLOAK_EMAIL_THEME`; `IMBC_MAILBOX` удалён), §14 (строка прогона этапа с числами тестов из вывода).
- Modify: `docs/development-roadmap.md` — §2 и «Этап 2» (состояние на дату, что сделано, что не сделано), §7 (строка классификаторов — какие списки ждут IMBC), §9 (вопросы 43–53 ниже); раздел 11 не трогать.
- Modify: `docs/handoff/2026-11-11-context.md` — §4, §6 (закрытые строки разрыва), §10 (новые ключи `kk`: `references.*`, `nav.references`, `apps/api/src/mail/messages/kk.json`, `messages_kk.properties`, названия значений `release/*.json`), §11; `docs/handoff/2026-11-12-questions-for-abay.md` — вопросы 43–53.
- Modify: `docs/deployment/azure-dev.md` — новый раздел «Справочники, файлы и уведомления (этап 2)»: до выката, что делает выкат, проверки после выката, откат (expand-only: код откатывается на этап 1 без восстановления базы), contract следующим релизом.

**Interfaces:**
- Consumes: всё выше; числа тестов — из вывода последних прогонов.
- Produces: документы; вопросы Абаю 43–53:
  43. NOT-21 «Observers receive none of these emails» и NOT-24/AUTH-03/AUTH-04: наблюдатель получает NOT-01–NOT-03 и только их?
  44. Строка раздела 4 «organisation-chart sample» — производителю «—», а MAN-19 и DBML дают ему скачать образец. Верно ли, что производитель скачивает текущий образец?
  45. Названия товарных групп A–E на трёх языках; принадлежит ли каждый тип товара ровно одной группе?
  46. Товарные группы и роли контактов — закрытые списки (администратор меняет только названия)?
  47. Форматы кодов в перечнях IMBC: ОКЭД — 5 цифр, ТН ВЭД — 10, КПВЭД — с точками; нужны ли уровни иерархии (разделы, группы)?
  48. На каких языках придут названия ОКЭД, ТН ВЭД, КПВЭД (английского у ТН ВЭД обычно нет)?
  49. Полный список правовых форм сверх LLP, LLC, JSC (MAN-09 «includes»).
  50. Типы документов сверх свидетельства, устава, лицензий и финансовой отчётности; обязательна ли финансовая отчётность?
  51. 25 МБ — это 25 × 1024 × 1024 байт? Отклонять ли файл, у которого расширение не совпадает с содержимым?
  52. Письмо IMBC при незаданном ящике: теряется (сейчас) или ждёт, пока ящик не зададут?
  53. Можно ли вывести из оборота обязательный тип сертификата или документа (сейчас — сначала снять обязательность)?

Раздел runbook (содержание задано):
- **До выката:** `pg_dump` (как перед `0006`); ClamAV принимает 25 МБ — `sudo docker compose -f compose.yaml -f compose.azure.yaml exec clamav clamconf | grep -iE 'StreamMaxLength|MaxFileSize|MaxScanSize'` — каждое ≥ 26 214 400 байт, иначе смонтировать свой `clamd.conf`; ящик IMBC задан (`select notification_mailbox from organizations where type = 'imbc'`) — иначе письма IMBC не уйдут.
- **Что делает выкат:** `0009`, `0010`; `migrate` грузит `reference-data/release` (строки «Справочники: …»); `seed` — `provisional`; `sync-realm.py` ставит `emailTheme imbc`; очереди `file-scan`, `notify`, расписание `file-scan-sweep`.
- **Проверки после выката:** `select d.code, count(e.*) filter (where e.retired_at is null) from dictionary d left join dictionary_entry e on e.dictionary_id = d.id group by d.code order by d.code;` — 12 строк; `legal_form 3`, `commodity_group 5`, `contact_role 3`, `certificate_type 10`, `document_type 4`; на стенде с seed — `region 9`, `oked 4`, `tn_ved 4`, `kpved 2`, `commodity_type 5`, `process 3`, `equipment_type 2`; `select count(*) from notification_rule` — 17; `select count(*) from notifications_sent` = `select count(*) from notification where rule_code = 'NOT-03'` (на момент выката); `\dp notification`, `\dp notification_rule` — у `imbc_app` нет лишних прав; S3 закрыт: `curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:9000/` на VM — нет ответа (порт не опубликован), `sudo docker compose … exec api wget -qO- http://rustfs:9000/imbc-files/` — `AccessDenied`; Keycloak: `emailTheme` realm — `imbc`.
- **Contract (первая задача этапа 3, отдельный релиз):** `0011_stage2_contract` — сначала повторный перенос `INSERT INTO notification … FROM notifications_sent … ON CONFLICT DO NOTHING` и проверка, что каждая строка `notifications_sent` есть в `notification` по `dedup_key`; пустота `dictionaries`, `dictionary_entries`, `file_objects`, `file_versions` (иначе `RAISE EXCEPTION`); затем удаление этих таблиц, типа `scan_state` (скелет), переименование `file_scan_state` → `scan_state`; `contact_role` — вместе с заменой `contacts` (этап 3), `commodity_group` — с `catalog_profile` (этап 5).

- [ ] **Шаг 1.** Документы по Files; `pnpm check:requirements` (новые ID в документах — только из v1.3); `node --test scripts/check-requirements.test.mjs`.
- [ ] **Шаг 2.** Полная проверка (Global Constraints) на последнем коммите; числа тестов — в README §14.
- [ ] **Шаг 3.** Коммит `Документы этапа 2: справочники, файлы, уведомления — README, план разработки, handoff, runbook и вопросы Абаю (ACC-01, NFR-06)`.

---

## Чего этап не делает

- Загрузка файлов производителем, привязка к секциям, очистка непривязанных файлов, правило чтения по редакции-владельцу (этап 3); чтение оператором и наблюдателем файлов видимого профиля (этап 6); файлы обследований и due diligence (этап 5); просмотр STR и KTRE без скачивания (этап 9).
- Снимок обязательных типов при отправке — `submission_requirement` (ADM-09, этап 3).
- Официальные перечни регионов, ОКЭД, ТН ВЭД, КПВЭД, типов товаров, процессов, типов оборудования — ждут IMBC; в продакшене эти списки пусты (на стенде — временные значения seed). Названия значений в каталоге и на дашборде (этап 6).
- Тексты и события NOT-04…NOT-17 (этапы 5–9; полный каталог — этап 7); части получателей `focal_point`, `manufacturer_contacts` (этап 3), `assigned_sme_or_imbc_mailbox` (этап 5); экрана правил и входящих нет (раздел 8.2: «There is no notification inbox»).
- Contract: `notifications_sent`, скелетные `dictionaries`, `dictionary_entries`, `file_objects`, `file_versions`, тип `scan_state` — следующим релизом; перечисления `contact_role` и `commodity_group` — с этапами 3 и 5 (runbook, «Contract»).
- Импорт перечней из интерфейса: перечень приходит файлом в репозитории и релизом.
- Кабинет директора, кроме чтения справочников (этап 6).

## Приёмка

Roadmap, этап 2: «Файл до прохождения скана не открывается никому. Ссылка на чужой файл возвращает отказ и запись в аудит. Ведущие нули кодов сохраняются. Значение, использованное в профиле, удалить нельзя. Повтор события не отправляет второе письмо на тот же адрес. Наблюдателю письмо не уходит.» Плюс язык письма (NOT-19) и ссылка за входом (NOT-20).

**Автоматически** (обязательное условие; тесты названы поимённо в задачах): «файл до прохождения скана не открывается никому…» (4), «ссылка на чужой файл возвращает отказ и запись в аудит…» (4), «ведущие нули кодов сохраняются…» (2, 3, 8), «значение, использованное в профиле, удалить нельзя…» (3), «повтор события не отправляет второе письмо…» (6), «один адрес в разном регистре — одно письмо…» (6), «наблюдателю письмо не уходит…» (6), «язык письма (NOT-19)…» (6, 7), «appLink…» и «страница по ссылке закрыта без права…» (6); зелёные проверки Global Constraints на последнем коммите.

**На стенде** — только по команде владельца, после слияния ветки в ветку стенда и выката `./infrastructure/azure/deploy.sh redeploy` из чистого checkout. Входы демо-ролей — код `000000`; новые адреса — `*.local`, письма — в Mailpit (`/dev-mail/`). Результат — `docs/deployment/verification-<дата>.md`.
0. **До выката** — runbook, «До выката»: резервная копия, ClamAV ≥ 26 214 400 байт, ящик IMBC задан.
1. **После выката** — runbook, «Проверки после выката».
2. **Справочники** (`admin@imbc.local`, `/references`): ТН ВЭД → «Добавить значение» `0101210000` с тремя названиями → в таблице `0101210000`; поиск `0101` находит; «Вывести из оборота» — пропадает из «Действующих», есть в «Выведенных»; вернуть; удалить. `ISO 9001` — «Удалить» и «Вывести» отклонены с понятным сообщением (обязательный); снять обязательность → «Удалить» снова отклонено: значение используется (оно в каталоге seed); вернуть обязательность. `ASME` — сделать обязательным и обратно. Товарные группы — нет «Добавить», переименовать «Group A» можно. Телефон 390 px — без горизонтальной прокрутки.
3. **Директор** (`director@imbc.local`): пункт «Справочники», те же данные без кнопок; образец скачивается.
4. **Образец оргструктуры:** загрузить PDF → «Проверяется антивирусом» → «Текущий образец», «Скачать» отдаёт файл с тем же именем. Загрузить `eicar.docx` (`cp любой.docx eicar.docx`, файл `eicar.com` со строкой EICAR, `zip eicar.docx eicar.com`) → «Не прошёл проверку», текущий образец прежний; в аудите `file.scan_rejected`. Пока файл в проверке, `GET /api/v1/files/<id>/content` под администратором — 409.
5. **Права на файл:** `operator@operator.local` открывает `/api/v1/files/<id текущего образца>/content` — 403, в аудите `file.read` `denied`; `manufacturer@demo.local` — скачивает текущий образец, прежний — 403.
6. **Уведомления:** десять неверных паролей у `stage2-lock@demo.local` (зарегистрировать) → одно письмо NOT-03 на казахском; `select rule_code, language from notification order by sent_at desc limit 1;` — `NOT-03 | kk`; следующий опрос событий — второго письма нет. То же у `observer@observer.local` — письмо приходит (письмо аккаунта). Вход с нового устройства — письмо NOT-02 и строка `NOT-02` в журнале без кода.
7. **NOT-01 по-казахски:** регистрация `stage2-maker@demo.local` с интерфейсом на казахском → письмо установки пароля на казахском со сроком ссылки; на английском интерфейсе (`locale en`) — по-английски.

**Что нужно от владельца и IMBC:** команда на выкат и шаг 0; перечни регионов, ОКЭД, ТН ВЭД, КПВЭД, типов товаров, процессов и типов оборудования, названия товарных групп; полный список правовых форм и типов документов; образец оргструктуры; адрес ящика IMBC для продакшена; ответы на вопросы 43–53; вычитка новых казахских текстов (LANG-03); снятие блокировки GitHub Actions.

## Pre-flight: общие файлы и интерфейсы задач

| Пара | Общее | Производит → потребляет |
|---|---|---|
| 1 → 2, 3 | `packages/contracts/src/dictionaries.ts`, схема `reference.ts` | 1: `DICTIONARY_CODES`, таблицы → 2: файл-схема и константы → 3: схемы API |
| 1 → 4, 5 | `packages/contracts/src/files.ts`, схема `files.ts` | 1: `FILE_PURPOSES`, `DATA_CLASSES`, `FILE_SCAN_STATES`, `MANUFACTURER_FILE_PURPOSES` → 4: `FILE_PROBLEM_CODES`, `fileExtensionMatches` → 5: схемы образца |
| 1 → 6 | схема `notifications.ts`, 17 правил `0010`, формат `dedup_key` | `notificationDedupKey` (6) обязан давать ту же строку, что SQL переноса в `0010` |
| 2 → 3, 8 | загруженные списки | `release` — в тестах 3; коды справочников — в тестах 8 |
| 3 → 5 | `common/actor-transaction.ts` | `actorTransaction(pool, audit, actor, { route, ip, action }, run)` |
| 3 ↔ этап 1 | `organizations.service.ts`, `admin.http.test.ts`, `test/support/http.ts` | перенос `lockActor` и `auditActorDenial` с реэкспортом; `send` получает `'DELETE'` |
| 4 → 5 | `FilesService`, `FILE_READ_RULES`, `SCAN_PASSED_HOOKS`, `uploadInterceptor`, `HttpStand.upload` | 5 заменяет правило `organisation_chart_sample` и добавляет хук |
| 4, 6 | `jobs/queues.ts`, `infra/infra.module.ts`, `worker/worker.module.ts`, `worker/handlers.service.ts` | 4: `fileScan`, `fileScanSweep`, удаление `scanFile` → 6: `notify`, удаление `sendNotification`, конструктор `JobHandlers(…, notifications)`; `Record<QueueName, …>` требует маршрут каждой очереди |
| 4, 5, 6 | `app.module.ts` | 4: `FilesController`, `FilesService`, `OBJECT_STORAGE`; 5: `OrgChartSample*`; 6: `MailService` с `DB` |
| 6 ↔ 7 | NOT-19 | 6 — письма платформы; 7 — NOT-01 в Keycloak; язык Keycloak — атрибут `locale` пользователя (этап 1) |
| 3, 4, 5 → 8 | HTTP | маршруты и коды ошибок таблиц задач 3–5 |
| 8 ↔ этап 1 | `admin-actions.ts`, `messages/*.json`, `app-shell.tsx` | `useAdminAction` с `invalidate`; ключи `references.*`, `nav.references` не пересекаются с `adminAccounts.*` |
| 1–8 → 9 | документы | README, roadmap, handoff, runbook — только в задаче 9 |

## Self-review

- **Покрытие.** GEN-09 — правила по назначению и тест чужого файла (4), правило образца (5); ADM-08 — двенадцать справочников с переводами (1, 2), ведение (3), экран (8); ADM-09 — обязательность типов (3, 8), снимок при отправке — граница этапа 3; ADM-11 — образец (5, 8); NOT-18 — журнал и одно письмо на адрес (1, 6); NOT-19 — язык письма (6), NOT-01 (7); NOT-20 — ссылки страниц приложения (6), срок ссылки пароля (7); NOT-21 — фильтр наблюдателей (6); DATA-02 — переводы и письма строками (1, 2, 3, 6); DATA-03 — коды текстом (2, 3, 8); DATA-04 — вывод из оборота и запрет удаления используемого (3, 8); DATA-05 — метаданные версии (4); DATA-06 — типы и предел (4); DATA-07 — скан и запрет открытия (4, 5); NFR-09 — S3 не опубликован, загрузка и скачивание с правами (4, 5).
- **Согласованность имён.** `DICTIONARY_CODES` (1) → 2, 3, 8; `CLOSED_DICTIONARIES`, `MANDATORY_DICTIONARIES`, `DICTIONARY_PARENT`, `DICTIONARY_CODE_PATTERNS`, `entryDisplayName` (2) → 3, 8; `actorTransaction` (3) → 5; `FilesService.withStagedObject` / `recordNew` / `open`, `FileReadRule`, `FILE_READ_RULES`, `ScanPassedHook`, `SCAN_PASSED_HOOKS`, `uploadInterceptor`, `acceptUpload`, `AcceptedUpload` (4) → 5; `notificationDedupKey` (6) = SQL `0010` (1); `MailService.sendOnce` (6) — в `AuthController` и диспетчере; `QUEUES.fileScan`, `QUEUES.fileScanSweep` (4) и `QUEUES.notify` (6) — в `queues.ts`, `infra.module.ts`, `worker.module.ts`.
- **Review Focus.** Пять пунктов — тесты в задачах 4, 4, 3, 6, 6; сверх списка — порядок прохождения скана двух образцов (5) и параллельное удаление значения (3).
- **Пропорция.** Код дан только там, где сигнатура и тест его не определяют: SQL `0010`, схемы zod контрактов, формат `dedup_key`, правила загрузки и порядок диспетчера; остальное — сигнатуры, таблицы маршрутов, имена тестов и описание экрана.
- **Открытые вопросы и поведение до ответа:** 43 — наблюдатель получает только письма аккаунта (расхождение 1); 44 — производитель скачивает текущий образец (2); 45, 46 — закрытые списки, названия групп временные (4, 22); 47, 48 — шаблоны кодов и запасной язык названий (6, 7); 49, 50 — списки спецификации как минимум (5); 51 — 25 MiB и проверка расширения (10); 52 — письма без ящика не отправляются (16); 53 — обязательное нельзя вывести (9).
