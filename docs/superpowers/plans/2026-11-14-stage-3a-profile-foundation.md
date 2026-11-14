# Этап 3а — основа профиля: contract этапа 2, приём файлов, модель данных DBML, первые три секции — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** закрыть остатки этапа 2 до открытия загрузок производителю (релиз contract `0011`, проверка вложенных архивов, документов под паролем и вложений PDF, предел одновременных загрузок, внешние ключи на значения справочников, правило чтения файла по записи-владельцу) и перевести профиль производителя на модель DBML — восемь секций с редакциями copy-on-write, защитой отправленной редакции в БД, полнотой и списком того, чего не хватает; производитель заполняет и сохраняет в любой момент три секции без файлов — «Основные сведения», «Контакты», «Акционеры» — на понятном экране из восьми разделов.

**Architecture:** две поставки. **R1** — только задача 1: миграция `0011_stage2_contract` удаляет скелет этапа 2 и код сверки с ним; выкатывается отдельно, по слову владельца, с резервной копией. **R2** — задачи 2–12: `0012` (причина отказа скана), `0013` (переименование `manufacturer_profiles` → `manufacturer_profile` с совместимым представлением, Р-2), `0014` (таблицы DBML профиля), `0015` (проверка, что в скелете профиля нет данных, восемь секций и рабочая редакция каждому профилю, триггеры неизменяемости). Скелетные таблицы профиля (`profile_sections`, `section_revisions`, `contacts`…) остаются до contract этапа 3 (часть 3в). Секции читаются и сохраняются через один сервис (`ProfileSectionsService`) и реестр обработчиков секций; маршруты — только `/api/v1/profiles/own/...`, идентификатора профиля в пути нет (GEN-11 по построению). Полнота секции и профиля считается одной функцией из `@imbc/contracts` на сервере и в браузере.

**Tech Stack:** TypeScript, zod 4, NestJS 12 (multer 2.5), Drizzle ORM 0.45 / drizzle-kit 0.31, PostgreSQL 18 (триггеры plpgsql), pg-boss 12, `node:zlib`, AWS SDK S3 (RustFS), clamd 1.4, React 19 + Vite, React Router 8 (`useBlocker`), TanStack Query, use-intl, shadcn/ui на Base UI (`base-nova`), vitest.

**Spec:** `docs/analyst/2026-11-11/specification-v1.3.md` — раздел 4 (GEN-08, GEN-09, GEN-11, таблица прав «Own profile»), 5.1 (MAN-04, MAN-05), 5.2 (вводный абзац; MAN-06–MAN-08 — только хранение источника; MAN-09–MAN-15, MAN-21, MAN-22; MAN-12 — граница), 5.3 (MAN-40, MAN-41, MAN-43, MAN-45, MAN-46 — блокировка и статус секции), 6.3 (статусы профиля, документов и сертификатов; абзац о скане), 8.4 (AUD-01), 9.1 (записи «Manufacturer profile», «Section revision», «Contact, shareholder…»; DATA-01–DATA-07), NFR-06. DBML `docs/analyst/2026-11-11/imbc-platform.dbml`: шапка (правила хранения), `manufacturer_profile`, `profile_section`, `section_revision`, `submission_requirement`, `main_information`, `main_information_oked`, `contact`, `personnel`, `personnel_cv`, `shareholder`, `product_line_identity`, `product_line`, `production`, `production_process`, `production_photo`, `equipment_item`, `equipment_product_line`, `certificate`, `document`, `file_object`, перечисления `section_kind`, `revision_state`, `revision_origin`, `record_status`, `product_line_source`, `capacity_unit`, `scan_state`; ссылки строк 1549–1604. `docs/development-roadmap.md` — §3, §4.1 (Р-2), §4.2, «Этап 3» со списком «Перед открытием загрузок производителю», §9 (вопросы 6–8). `docs/handoff/2026-11-11-context.md` §13. Runbook `docs/deployment/azure-dev.md` — «Релиз contract (0006)», «Contract этапа 2». Прототип: `.claude/worktrees/proto/apps/web/src/prototype/manufacturer/` (`profile-page.tsx`, `section-page.tsx`, `forms-company.tsx`, `fields.tsx`, `parts.tsx`, `model.ts`) — ветка прототипа, только чтение. Карта этапа — `docs/superpowers/plans/2026-11-14-stage-3-map.md`.

## Поставки, миграции и зависимости

На стенде (`demo/prototype-cabinets`, `335ef02`) применены `0000`–`0010`.

| Поставка | Задачи | Миграции | Предыдущая версия (NFR-06) | Откат |
|---|---|---|---|---|
| **R1** contract этапа 2 | 1 | `0011_stage2_contract` (рукописная): удаляет `notifications_sent`, `dictionaries`, `dictionary_entries`, `file_objects`, `file_versions`, тип `scan_state` скелета; `file_scan_state` → `scan_state` | этап 2 (`335ef02`) **на новой схеме не работает** (читает `notifications_sent`) | только восстановление `backup-before-0011.dump` |
| **R2** этап 3а | 2–12 | `0012_file_rejection_reason` (генерируется), `0013_profile_rename` (рукописная), `0014_stage3_profile_model` (генерируется), `0015_stage3_profile_data` (рукописная) | R1 (коммит задачи 1) работает на схеме после `0015`: таблицу профиля читает и пишет через представление `manufacturer_profiles`, новых таблиц не знает | кодом на R1 без восстановления базы |

- Задачи 2–12 опираются на коммит задачи 1 (порядок миграций), но **не на её выкат**: разработка идёт дальше, пока R1 ждёт слова владельца.
- **R2 выкатывается только после выката и проверки R1 на стенде.** Иначе выкат R2 применит `0011` вместе с `0012`–`0015` одним прогоном — contract перестанет быть отдельным релизом.
- R1 на стенд — слиянием в ветку стенда **коммита задачи 1**, а не головы ветки этапа.

## Расхождения и противоречия (прочитать до задач)

| № | Где расходятся | Решение плана (действует до решения владельца или Абая) | Цена, если неверно |
|---|---|---|---|
| 1 | Runbook «Contract этапа 2» удаляет `file_objects` и `file_versions`, но на них ссылаются внешние ключи девяти пустых колонок скелета (`certificates.file_id`, `documents.file_id`, `review_decisions.file_version_id`, `site_survey_records.report_file_id`, `due_diligence_records.report_file_id`, `due_diligence_records.enhanced_report_file_id`, `operator_visit_marks.file_id`, `forecast_versions.source_file_id`, `tech_spec_files.file_id`). | `0011` переводит эти ключи на `file_object(id)` / `file_version(id)` до удаления таблиц (непустая колонка невозможна: `file_objects` проверяется на пустоту). Строки очередей `scan-file`, `send-notification` удаляет worker при старте (`retireQueues`), а не SQL по схеме pg-boss. | Малая. |
| 2 | Handoff §13: вложенные архивы (XLSX в DOCX) антивирус может не проверить. | Каждая запись DOCX/XLSX, распакованные данные которой начинаются с `50 4B 03 04`, проверяется той же `zipStructureIssue` рекурсивно (включая `[Content_Types].xml`): не глубже двух уровней вложения, не больше 32 вложенных пакетов, не больше 64 МиБ распакованных данных на файл; сверх — `415 file_too_complex`. Объекты OLE (`*.bin`) внутри OOXML не разбираются (их разбирает ClamAV). | Средняя: тяжёлый документ с множеством вложений получит отказ; остаточный риск — ZIP внутри OLE-объекта. |
| 3 | Handoff §13: «записи вне каталога архива» — решение отложено до настоящих файлов. | Проверка `entries_gap`: локальные записи идут вплотную от смещения 0 до каталога (после данных записи с битом 3 — описатель 12 или 16 байт). Включена сразу; контроллер прогоняет корпус настоящих файлов инструментом `check-upload` до выката R2; ложный отказ — снятие одной проверки. | Малая–средняя: экзотический писатель ZIP с выравниванием получит отказ до правки. |
| 4 | Вопрос 54: документы под паролем — антивирус не видит содержимого; до ответа принимались. | **Отклоняются документы, которые без пароля не открыть.** DOCX/XLSX под паролем (контейнер CFB с потоком `EncryptionInfo` или `EncryptedPackage`) — `415 file_encrypted` при загрузке; прочий CFB (старые `.doc`/`.xls`) — `415 file_type_not_allowed`. PDF с паролем на открытие — отказ ClamAV (`AlertEncryptedDoc yes`, сигнатура `Heuristics.Encrypted.PDF`), причина `encrypted` видна пользователю. PDF только с паролем прав (печать, правка) **принимается**: открывается без пароля, ClamAV его расшифровывает. | Средняя: если IMBC захочет отклонять и PDF с ограничением прав — одна проверка `/Encrypt` при загрузке. |
| 5 | Handoff §13: вложения PDF. | PDF с вложенными файлами отклоняется при загрузке (`415 file_has_attachments`): имена `EmbeddedFile`, `EmbeddedFiles`, `FileAttachment` (с раскрытием `#xx`) в несжатой части или в потоках объектов `/Type /ObjStm` с `FlateDecode`. В зашифрованном PDF потоки объектов не читаются — там вложения проверяет только ClamAV. | Малая: редкий законный PDF с вложением (электронный счёт PDF/A-3) получит отказ с подсказкой. |
| 6 | DATA-07 и §6.3 не называют причину отказа; пользователю нужен понятный текст. | Колонка `file_version.rejection_reason` (`malware`, `encrypted`, `scan_limits`, `unverifiable`) по сигнатуре clamd; производитель и администратор видят причину, сигнатуру — нет. | Малая. |
| 7 | Handoff §13: 25 МБ в памяти API, предела параллельных загрузок нет. | Семафор без очереди: 4 загрузки на процесс (`UPLOAD_CONCURRENCY`), 2 на аккаунт (`UPLOAD_CONCURRENCY_PER_ACCOUNT`); сверх — `503 upload_busy` или `429 upload_parallel_limit` с `Retry-After: 5`. Потоковой загрузки нет: проверка ZIP и PDF читает конец файла. | Малая: под нагрузкой пользователь повторяет; числа — переменные окружения. |
| 8 | Р-2: таблицы с данными переименовываются через совместимое представление; у `manufacturer_profiles` на стенде 12 строк и десяток внешних ключей. | `0013`: `ALTER TABLE manufacturer_profiles RENAME TO manufacturer_profile` + `CREATE VIEW manufacturer_profiles AS SELECT * FROM manufacturer_profile` (автообновляемое: R1 пишет через него) + переименование ограничений под имена Drizzle. Колонки прежние (`completeness_pct`, `has_pending_changes`, `update_status`, `quarter_anchor_at`, `missed_quarters`, `final_notice_due_at`, `source`) — их DBML-форму дают свои этапы; добавляется `accuracy_confirmed_at`. Представление удаляет contract этапа 3. | Средняя: поведение представления на запросах R1 закреплено тестом. |
| 9 | Задача этапа: «перенос скалярных полей из `section_revisions.data`». Писателя этих полей не было ни в одной версии: `ensureDraft` пишет `'{}'`, seed секций не создаёт. | `0015` **доказывает**, что переносить нечего: строка `section_revisions` с `data <> '{}'` или строка в `contacts`, `shareholders`, `product_lines`, `equipment_items`, `equipment_product_links`, `certificates`, `documents` — `RAISE EXCEPTION` до любой правки. Каждому профилю — восемь `profile_section` и рабочая редакция № 1. Профиль, который R1 создаст позже (окно выката, откат), получает секции при первом чтении (`ensureSections`). | Малая. |
| 10 | DBML: обязательные для отправки колонки секций `not null`; MAN-40: секцию сохраняют в любой момент, частично. | Колонки, которые заполняет производитель, — `null` до отправки; обязательность проверяет полнота (MAN-41), отправку — часть 3в. Структурные колонки (`id`, ссылки, `organization_id`, `position_in_list`, `status`, `source`, флаги с умолчанием) остаются `not null`. | Малая. |
| 11 | DATA-01 «every change keeps … the earlier value» против черновика, который правят много раз. | Рабочая редакция правится на месте; аудит каждого сохранения — кто, когда, какие поля (без значений: в них ФИО, почта, телефон). Прежние **отправленные** значения хранят замороженные редакции; триггеры БД запрещают их правку. | Средняя: если IMBC нужна история значений черновика — таблица истории полей. Вопрос 60. |
| 12 | Вопрос 6: где хранить источник, исходное значение и отметку подтверждения (MAN-07); в DBML колонок нет. | Таблица `section_field_source` (поле, источник `adata`/`e_ondiris`, исходные значения `jsonb`, время чтения, кто и когда подтвердил); копируется с редакцией. Неподтверждённое значение не считается заполненным (правило прототипа). Правка значения — подтверждение. Значения в неё пишет этап 4б; в 3а — только seed демо-производителя. | Малая–средняя. |
| 13 | MAN-09 — одно «company legal name»; DBML — `name_en` и `name_ru` `not null`; DATA-09 выгружает оба. | `name_ru` — наименование как в регистрации, без перевода (MAN-09); `name_en` — наименование на английском. Оба обязательны для полноты. | Малая: необязательность `name_en` — одна строка списка. Вопрос 61. |
| 14 | MAN-12 «registered yes or no (mandatory)» — значение выводится из чтения e-Ondiris (этап 4б). | Платформа ставит его сама; в 3а — `false`, в форме только чтение («по данным копии e-Ondiris»), в полноту не входит; выписка — часть 3б. | Малая. Вопрос 63. |
| 15 | MAN-15 «checked for format» без формата. | Телефон: после удаления пробелов, `-`, `.`, `(`, `)` — `+` и 10–15 цифр; `8XXXXXXXXXX` → `+7XXXXXXXXXX`; хранится приведённым. Почта — `z.email()`, хранится в нижнем регистре без пробелов. Сайт — `http(s)`, без схемы дополняется `https://`, хост с точкой. Совпадение контактов (MAN-13) — по приведённым значениям, его же держит уникальный индекс. | Малая. Вопрос 62. |
| 16 | MAN-13, MAN-14: «at least three», «exactly one focal point», дубли «rejected and not saved». | При сохранении отклоняются только дубли почты и телефона и второй focal point (`400`); «не меньше трёх» и «ровно один focal point» — пункты полноты. Роль — значение справочника `contact_role` (внешний ключ). | Малая. |
| 17 | MAN-21, MAN-22 — формат доли не задан. | Доля: больше 0 и не больше 100, не больше двух знаков после запятой; сумма ≠ 100 — предупреждение в ответе (`sharesTotalIs100: false`), отправке не мешает. Гражданство или страна — свободный текст. | Малая. Вопрос 66. |
| 18 | MAN-41 «percentage of its own mandatory fields and files» без веса пунктов. | Пункт — обязательное поле; процент — `floor(заполнено × 100 / пунктов)`, 100 только когда заполнено всё. «Основные сведения» — 11 пунктов; «Контакты» — `max(3, n)` контактов и focal point; «Акционеры» — `max(1, n)` строк. Профиль — `floor` среднего семи секций без производства. Секции, которые в 3а ещё не открыты, дают 0 %. | Малая. Вопрос 67. |
| 19 | MAN-43, MAN-45: блокировка — у Submitted и Under review; про Verified с отправленными изменениями спецификация молчит. | Правка открыта в Draft, Returned и Verified без отправленных изменений; закрыта (`409 profile_locked`) в Submitted, Under review и Verified, у которого есть секция с `pending_revision_id` (как прототип). Переходы статусов — часть 3в. | Малая. Вопрос 65. |
| 20 | DATA-04 «retired hides it from new entries». | Значение справочника, выбранное заново, должно быть действующим и из нужного справочника; уже выбранное в этой секции выведенное значение сохраняется. Иначе `400` с кодом `entry_not_selectable` у поля. | Малая. |
| 21 | GEN-09, MAN-04 («Draft visible only to its manufacturer and to IMBC»), ADM-06. | Правило файла производителя: производитель — файлы своей организации (сохранённые в секции и ещё не сохранённые); SME и директор — только файл, на который ссылается хотя бы одна редакция профиля (любая, включая рабочую); администратор, оператор, наблюдатель — нет (оператор и наблюдатель — этап 6, по верифицированной редакции). | Средняя: если SME должен видеть только отправленное — одно условие на состояние редакции. Вопрос 64. |
| 22 | Два окна или два человека под одним логином компании (GEN-01) правят одну секцию. | У рабочей редакции счётчик `edit_version`; сохранение с устаревшим — `409 section_changed`; время сохранения `saved_at` показывается («Сохранено 14:32»). | Малая. |
| 23 | Секции `section_kind` DBML (`main_information`…) против `PROFILE_SECTIONS` (`main`…) и скелетного типа `profile_section`. | Новые константы `SECTION_KINDS` и тип `section_kind`; `PROFILE_SECTIONS` и `profile_section` живут со скелетом до contract этапа 3. Адрес страницы — `/profile/<kind с дефисами>` (`/profile/main-information`). | Нет. |

### Отступления от DBML (каждое — с основанием)

- `manufacturer_profile` — переименованная таблица с прежними колонками (расхождение 8); DBML-колонки `completeness_percent`, `migrated`, `bin_check_digit_valid`, `migration_flags` не добавляются (используется `completeness_pct`; миграция — этап 8); добавлены `accuracy_confirmed_at` (DBML) и уникальность `(id, organization_id)` (DBML).
- Обязательные для отправки колонки секций — `null` (расхождение 10).
- Ссылки на файл — составным ключом `(колонка, organization_id) → file_object(id, organization_id)` вместо простого: секция не может сослаться на файл другой организации.
- `section_revision.state` — существующий тип `revision_state` (в нём лишнее `superseded`, CHECK его запрещает; удаляет contract этапа 3); `saved_at`, `edit_version` (расхождение 22); CHECK «рабочая ⇔ `submitted_at` пуст».
- `section_field_source` — новая таблица (расхождение 12).
- `product_line`: `tn_ved_entry_id`, `kpved_entry_id` → `dictionary_entry` (у добавленной вручную линии код выбран из справочника — DATA-04 держит внешний ключ; код текстом — по DBML); `note text` (MAN-23 «optional note», вопрос 7); `e_ondiris_record_id` без внешнего ключа до появления `e_ondiris_record` (этап 4а).
- CHECK-ограничения, которых нет в DBML: доля 0–100 (MAN-21), загрузка 0–100 (MAN-31), количество оборудования > 0, `position_in_list >= 0`, неотрицательная численность, `tn_ved_code` — 10 цифр (MAN-24, MAN-25), у контакта почта в нижнем регистре и телефон `^\+\d{10,15}$`.
- Триггеры БД: строки замороженной редакции не вставляются, не меняются и не удаляются (DBML: «A submitted section revision is immutable»), кроме `status` у `certificate` и `document`; строка секции привязана к редакции своей секции.
- `file_version.rejection_reason` (тип `file_rejection_reason`) — расхождение 6.
- Скелетные `manufacturer_profiles` (представление), `profile_sections`, `section_revisions`, `contacts`, `shareholders`, `product_lines`, `equipment_items`, `equipment_product_links`, `certificates`, `documents`, `review_assignments`, `review_decisions`, `update_confirmations`, типы `profile_section`, `document_status`, `contact_role`, `value_source` живут до contract этапа 3 (NFR-06).

## Права, аудит, уведомления части

**Права.** Новых действий матрицы нет; `POLICY_MATRIX` и снимок `SECTION_4` не меняются. Чтение своего профиля — `profile.read` (производитель `own`; SME и директор проходят шлюз, но своей организации-производителя у них нет — 404); правка — `profile.edit` (только производитель). Маршруты профиля — только `/api/v1/profiles/own/...`: профиль ищется по организации сеанса, идентификатор профиля из запроса не принимается (GEN-11). Тесты прав из матрицы на каждый новый маршрут: разрешённые роли — сервис вызван; остальные — 403 problem+json, `outcome: 'denied'`, `action`, `objectType: 'route'`; без сеанса — 401; изменяющий запрос с чужого Origin — `403 bad_origin`. Сохранение — `actorTransaction` с `action: 'profile.edit'`: исполнитель под блокировкой `active` и с правом, иначе 403 и `denied` после отката. В каждой задаче с данными профиля — тест на две организации-производителя: чужое не читается и не меняется ни через какой маршрут.

**Аудит (AUD-01).** В транзакции действия, `isAccountEvent: false`: `profile.created` (как в этапе 1), `profile.sections_created` (`objectType: 'manufacturer_profile'`, `{ count }` — восемь секций профиля, созданного прежней версией), `profile.revision_created` (`objectType: 'section_revision'`, `{ section, from, to }` — номера редакций), `profile.section_saved` (`objectType: 'section_revision'`, `{ section, revision, fields, confirmed }` — имена полей, без значений). Отказ загрузки (4xx при приёме файла) пишется только строкой журнала с причиной, как в этапе 2. Сохранение без изменений — 200 без записи.

**Уведомления.** Писем часть не отправляет: NOT-04 (отправка) и NOT-10 (разблокировка) — этап 5 по карте требований; отправка и разблокировка — часть 3в.

## Global Constraints

- Worktree `.claude/worktrees/stage-3`, ветка `feat/stage-3-profile`. Задачи строго по порядку 1 → 12, один коммит на задачу, в сообщении — ID требований. Без `git push`, без деплоя, без `docker compose up`.
- Конец каждой задачи: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; набор API с базой — `caffeinate -s -i env TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/imbc_auth_test pnpm --filter @imbc/api test` (только база `imbc_auth_test`, **одним исполнителем в момент времени**); `pnpm check:requirements`. Если задача трогает Compose — `docker compose config -q`; `clamd.conf` — `pnpm --filter @imbc/api exec vitest run test/clamd.test.ts`.
- Миграции: `0011` — единственная, где есть `DROP`; `0012`–`0015` совместимы с R1: только `CREATE TYPE|TABLE|INDEX|VIEW|FUNCTION|TRIGGER`, `ADD COLUMN` (null или с умолчанием), `ADD CONSTRAINT`, `ALTER TABLE manufacturer_profiles RENAME TO manufacturer_profile`, `RENAME CONSTRAINT`, `INSERT … ON CONFLICT DO NOTHING`, блок проверки `DO $$ … RAISE EXCEPTION …`. После каждой миграции `pnpm --filter @imbc/api db:generate` не создаёт нового файла.
- Значения перечислений в SQL — ровно как в `@imbc/contracts`: `SECTION_KINDS` = `main_information, contacts, personnel, shareholders, products, production, certificates, documents`; `REVISION_STATES` = `working, submitted, verified, rejected`; `REVISION_ORIGINS` = `manufacturer, migration`; `RECORD_STATUSES` = `uploaded, under_review, verified, rejected, expired, missing`; `PRODUCT_LINE_SOURCES` = `manual, e_ondiris, migration`; `FILE_SCAN_STATES` = `pending, passed, rejected`; `FILE_REJECTION_REASONS` = `malware, encrypted, scan_limits, unverifiable` (DBML, порядок тот же).
- Коды (БИН, ОКЭД, ТН ВЭД, КПВЭД) — `text`, никогда число: в схемах zod, ответах, полях ввода (`type="text"`) (DATA-03). Многозначные поля — отдельные строки (DATA-02).
- Файлы — только `ALLOWED_FILE_TYPES` и `MAX_FILE_BYTES`; байты только через API; ключ объекта — UUID без имени; ClamAV вызывает только worker. Имена файлов, почта, ФИО, телефоны, значения полей профиля не попадают в журналы, тексты ошибок, `diff` аудита и данные заданий pg-boss.
- В тестах нет сети: `MemoryObjectStorage`, `StubAntivirus`, фиктивный транспорт; адреса — `*.local`. Adata часть не вызывает.
- Время — Asia/Almaty (DATA-08); код, зависящий от «сейчас», принимает `now` параметром (дата регистрации «не в будущем» — по календарной дате Алматы).
- Тексты — kk, ru, en, одинаковые ключи, английский — источник (LANG-02): `apps/web/messages/*.json`. Новые казахские строки — в список вычитки `docs/handoff/2026-11-11-context.md` §10 (задача 12). Значения, введённые пользователем, не переводятся (LANG-05).
- Web: компоненты только из `src/components/ui`; новые — `pnpm dlx shadcn@4.23.0 add <name>` из `apps/web` после просмотра в MCP shadcn (реестр `@shadcn`) и `pnpm dlx shadcn@4.23.0 view <name>`; правила Base UI из `apps/web/AGENTS.md` (`render` вместо `asChild`, `items` у `Select`, `cn(buttonVariants(...))` у ссылок); ссылки на `/api/*` — `<a href>`; даты и числа — `useFormat`.
- Новые контроллеры — `@ApiTags`; загрузки — `@ApiConsumes('multipart/form-data')`.
- ID требований — только из v1.3; в тестах нет строк вида `XXX-NN`, которые не ID требований. Удаляя строку со старым ID — `node scripts/check-requirements.mjs --update-baseline`.
- Не редактировать `docs/analyst/**`, `apps/api/drizzle/0000`–`0010*`, раздел 11 roadmap; не читать `.env*`, кроме `.env.example`.
- Тесты миграций прежних этапов, которые после полного прогона пишут в таблицы, удаляемые `0011` или переименованные `0013`, мигрируют до своей последней миграции явно (`migrateThrough(pool, '0010_stage2_reference_data')`).

## Review Focus

1. **Два окна одной компании сохраняют одну секцию.** Ожидание: первое сохранение — 200, второе с тем же `editVersion` — `409 section_changed`, ничего не потеряно молча; экран предлагает загрузить сохранённую версию. Тесты — задача 6 («параллельные сохранения…») и задача 10 («409 section_changed…»).
2. **Скопированные значения с пробелами, дефисами и регистром.** Ожидание: `+7 701 111-22-33` и `87011112233` — один телефон, `Info@Demo.local ` и `info@demo.local` — одна почта; второй контакт с ними — `400 duplicate_phone` / `duplicate_email` у поля. Тест — задача 9.
3. **Выведенное или чужое значение справочника.** Ожидание: новый выбор выведенного региона — `400 entry_not_selectable`; ранее выбранное выведенное — сохраняется; id значения из другого справочника (регион в правовой форме) — `400`. Тесты — задачи 6 и 8.
4. **Частичное сохранение, очистка поля, длинный и казахский текст.** Ожидание: пустой черновик и одно поле сохраняются; `null` очищает поле; `ЖШС «Құрылыс» "Б"` сохраняется как введено; 501 символ — `400 text_too_long`. Тест — задача 8.
5. **Параллельные и оборванные загрузки.** Ожидание: третья загрузка аккаунта при двух идущих — `429`, сверх предела процесса — `503`; оборванный клиентом запрос освобождает место. Тест — задача 4.

---

### Task 1: релиз contract этапа 2 — `0011_stage2_contract` (NFR-06, NOT-18, DATA-05, DATA-07)

**Модель:** `opus` · **Независимое ревью:** да

**Files:**
- Create: `apps/api/drizzle/0011_stage2_contract.sql` (+снимок) — `pnpm --filter @imbc/api exec drizzle-kit generate --custom --name stage2_contract` после правки схемы.
- Modify: `apps/api/src/database/schema/platform.ts` (удалить `dictionaries`, `dictionaryEntries`, `notificationsSent`), `schema/profiles.ts` (удалить `fileObjects`, `fileVersions`; `certificates.fileId`, `documents.fileId` → `fileObject.id`, `reviewDecisions.fileVersionId` → `fileVersion.id`), `schema/records.ts` (`siteSurveyRecords.reportFileId`, `dueDiligenceRecords.reportFileId`, `enhancedReportFileId`, `operatorVisitMarks.fileId` → `fileObject.id`), `schema/exchange.ts` (`forecastVersions.sourceFileId`, `techSpecFiles.fileId` → `fileObject.id`), `schema/enums.ts` (удалить скелетный `scanState`; `fileScanState` → `scanState = pgEnum('scan_state', FILE_SCAN_STATES)`), `schema/files.ts` (`isCurrent` — `.default(false)`; комментарии), `schema/index.ts`.
- Modify: `apps/api/src/mail/mail.service.ts` (удалить `sentByPreviousVersion` и вызов), `apps/api/src/worker/handlers.service.ts` (удалить сверку с `notifications_sent` в `recordLockout`), `apps/api/src/jobs/queues.ts` (`RETIRED_QUEUES`, `retireQueues`), `apps/api/src/infra/infra.module.ts` (вызов `retireQueues` до `createQueue`), `packages/contracts/src/files.ts` (комментарий `FILE_SCAN_STATES`), `scripts/requirements-baseline.json` (`--update-baseline`, если ушли строки с ID).
- Modify: `docs/deployment/azure-dev.md` — раздел «Contract этапа 2 (следующим релизом)» заменяется разделом «Релиз contract этапа 2 (0011)» (содержание ниже; R1 выкатывается раньше задачи 12).
- Test: `apps/api/test/migration-stage2-contract.integration.test.ts` (новый); `migration-stage2.integration.test.ts` (мигрирует до `0010` явно); `notifications.integration.test.ts` (удалить тесты окна выката с `notifications_sent`); `apps/api/test/queues.integration.test.ts` (новый).

**Interfaces:**
- Consumes: база после `0010`; формат `dedup_key` из `0010` (`code || E'\n' || dedupe_key || E'\n' || lower(recipient)`).
- Produces: схема без скелета этапа 2; тип `scan_state` (`pending, passed, rejected`) на `file_version.scan_state`; TS-имя `scanState` (прежнее `fileScanState` удалено); `export const RETIRED_QUEUES = ['scan-file', 'send-notification'] as const`; `retireQueues(boss: PgBoss): Promise<{ deleted: string[]; kept: string[] }>` — очередь удаляется `boss.deleteQueue`, только если она есть (`getQueue`) и в ней нет заданий `created`, `retry`, `active`; иначе `kept` и `warn` с именем очереди и числом заданий.

Порядок `0011` (одна транзакция мигратора, разделители `--> statement-breakpoint`):
1. Повторный перенос — тот же `INSERT INTO notification … FROM notifications_sent … ON CONFLICT (dedup_key) DO NOTHING`, что третий оператор `0010`.
2. `DO $$ … $$`: строка `notifications_sent` с кодом из `notification_rule`, которой нет в `notification` по `dedup_key`, — `RAISE EXCEPTION 'stage 2 contract: % notifications_sent rows not in notification'`; непустые `dictionaries`, `dictionary_entries`, `file_objects`, `file_versions` — `RAISE EXCEPTION 'stage 2 contract: skeleton tables … are not empty'`.
3. Для девяти колонок расхождения 1: `DROP CONSTRAINT` прежнего ключа, `ADD CONSTRAINT` с именем, которое ждёт Drizzle (`<таблица>_<колонка>_file_object_id_fk` / `…_file_version_id_fk`).
4. `DROP TABLE notifications_sent, dictionary_entries, dictionaries, file_versions, file_objects`; `DROP TYPE scan_state`; `ALTER TYPE file_scan_state RENAME TO scan_state`.
5. `ALTER TABLE org_chart_sample ALTER COLUMN is_current SET DEFAULT false`.

Раздел runbook «Релиз contract этапа 2 (0011)» (по образцу «Релиз contract (0006)»): **до выката** — проверка пяти чисел (запрос из нынешнего раздела «Contract»), `select name, state, count(*) from pgboss.job where name in ('scan-file','send-notification') group by 1, 2` — пусто; резервная копия `backup-before-0011.dump` и пробное восстановление (шаги 5–6 релиза `0006`); **что делает выкат** — `0011`, worker пишет `retired queues: scan-file, send-notification` (или `kept`); **проверки после** — `\dt notifications_sent` и ещё четыре таблицы — нет; `select enum_range(null::scan_state)` — `{pending,passed,rejected}`; `select count(*) from pg_type where typname = 'file_scan_state'` — `0`; ключи девяти колонок ссылаются на `file_object`/`file_version` (`select conrelid::regclass, confrelid::regclass from pg_constraint where contype = 'f' and confrelid in ('file_object'::regclass, 'file_version'::regclass)`); `select column_default from information_schema.columns where table_name = 'org_chart_sample' and column_name = 'is_current'` — `false`; одна блокировка входа — одно письмо NOT-03; **откат** — только восстановление копии (кодом на этап 2 не вернуться: он читает `notifications_sent`); **дальше** — R2 (этап 3а) выкатывается только после этих проверок.

- [ ] **Шаг 1. Тесты (сначала).** `migration-stage2-contract.integration.test.ts` (PostgreSQL 18):
  - «0011 переносит письмо, записанное прежней версией после 0010: строка notifications_sent NOT-03 есть в notification с dedup_key 'NOT-03\nsub-2:1700000000001\nlocked@stage3.local' (NOT-18)» — `migrateThrough(pool, '0010_stage2_reference_data')`, вставка в `notifications_sent`, затем `migrateThrough(pool)`;
  - «строка в dictionaries, dictionary_entries, file_objects или file_versions — миграция падает с 'stage 2 contract', схема прежняя (таблицы на месте, 0011 не записана в журнал)» — по одной таблице на случай;
  - «после 0011 нет notifications_sent, dictionaries, dictionary_entries, file_objects, file_versions и типа file_scan_state; enum_range(null::scan_state) = pending, passed, rejected; file_version.scan_state — тип scan_state (DATA-07)»;
  - «девять внешних ключей ссылаются на file_object и file_version: вставка certificates.file_id с id file_object проходит, с несуществующим — 23503»;
  - «org_chart_sample.is_current по умолчанию false; вставка без колонки даёт false».
  `queues.integration.test.ts` (pg-boss `pgboss_auth_test`): «retireQueues: пустые scan-file и send-notification удаляются, повтор — ничего; очередь с заданием created — остаётся в kept».
  `notifications.integration.test.ts`: тесты «окно выката (NFR-06)…» удаляются; «повтор события не отправляет второе письмо…» и NOT-03 остаются зелёными.
- [ ] **Шаг 2.** `caffeinate -s -i env TEST_DATABASE_URL=… pnpm --filter @imbc/api exec vitest run test/migration-stage2-contract.integration.test.ts test/queues.integration.test.ts` — падают.
- [ ] **Шаг 3. Реализация.** Схема → `generate --custom --name stage2_contract` → SQL по порядку выше → `db:generate` — изменений нет; удаление кода сверки; `retireQueues`; раздел runbook.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка (Global Constraints).
- [ ] **Шаг 5.** Коммит `Contract этапа 2: удалены скелетные таблицы справочников, файлов и журнала писем, тип scan_state по DBML, ключи скелета — на file_object; сверка с notifications_sent удалена; runbook релиза 0011 (NFR-06, NOT-18, DATA-05, DATA-07)`.

**Проверка контроллером вживую:** `0011` на копии базы локального стенда и на копии дампа Azure (`pg_restore` в отдельную базу): проверка пяти чисел, применение, повторный запуск мигратора ничего не делает; worker стартует и удаляет две очереди; блокировка входа даёт одно письмо NOT-03 в Mailpit.

---

### Task 2: приём DOCX и XLSX — вложенные пакеты, записи вне каталога, документы под паролем, проверка папки файлов (DATA-06, DATA-07, NFR-09)

**Модель:** `opus` · **Независимое ревью:** да

**Files:**
- Modify: `apps/api/src/modules/files/zip-structure.ts`; `apps/api/src/modules/files/upload.ts` (вынести `inspectFile`, `acceptUpload` вызывает его); `packages/contracts/src/files.ts` (`FILE_PROBLEM_CODES` += `file_encrypted`, `file_too_complex`).
- Create: `apps/api/src/modules/files/cfb.ts`; `apps/api/src/tools/check-upload.ts`.
- Modify: `apps/web/src/routes/app/references-actions.ts` (`REFERENCE_PROBLEM_MESSAGES` — два кода), `apps/web/messages/{en,ru,kk}.json` (`references.errors.file_encrypted`, `references.errors.file_too_complex`).
- Test: `apps/api/test/zip-structure.test.ts`, `upload.http.test.ts`; фикстуры `apps/api/test/fixtures/files/` (собрать `python3 -c` с `zipfile`): `nested.docx` (DOCX с `word/embeddings/sheet.xlsx` — законный XLSX), `nested-zip64.docx` (вложенный XLSX, у записи которого ZIP64 только в локальном заголовке), `nested-deep.docx` (три уровня вложения), `gap.docx` (64 нулевых байта между двумя записями), `descriptor.xlsx` (записи с битом 3 и описателем 16 байт, как пишет Java), `encrypted.docx` (CFB: сигнатура `D0 CF 11 E0 A1 B1 1A E1` и имя потока `EncryptionInfo` в UTF-16LE), `legacy.doc` с именем `.docx` (CFB без этих имён).

**Interfaces:**
- Consumes: `zipStructureIssue`, `detectMediaType`, `fileExtensionMatches`, `cleanFileName` (этап 2).
- Produces (`zip-structure.ts`): `ZipStructureIssue` += `'entries_gap' | 'nested_too_deep' | 'nested_too_many' | 'inflate_limit'`; `export const MAX_NESTED_DEPTH = 2; export const MAX_NESTED_PACKAGES = 32; export const MAX_INFLATED_BYTES = 64 * 1024 * 1024;` `export interface InflateBudget { remainingBytes: number; remainingPackages: number }`; `createInflateBudget(): InflateBudget`; `zipStructureIssue(bytes: Buffer, options?: { budget?: InflateBudget; depth?: number }): ZipStructureIssue | null` — после проверок этапа 2: (а) `entries_gap` — первая локальная запись на смещении 0, конец данных каждой (плюс описатель: 16 байт, если за данными сигнатура `50 4B 07 08`, иначе 12 — только при бите 3) равен началу следующей, конец последней — смещению каталога; (б) у каждой записи первые 4 байта распакованных данных (stored — сами байты; deflate — `inflateRawSync(префикс, { finishFlush: zlib.constants.Z_SYNC_FLUSH })`, префикс 64 байта, при выходе короче 4 — 1 КиБ) — если `50 4B 03 04`: глубина `depth + 1 > MAX_NESTED_DEPTH` → `nested_too_deep`; пакетов сверх бюджета → `nested_too_many`; распаковка с `maxOutputLength = budget.remainingBytes` (превышение → `inflate_limit`), затем рекурсивно `zipStructureIssue(nested, { budget, depth: depth + 1 })` — первая причина вложенного пакета возвращается как есть.
- Produces (`cfb.ts`): `isCfb(bytes: Buffer): boolean`; `isEncryptedOfficeDocument(bytes: Buffer): boolean` — CFB и в байтах есть `EncryptionInfo` или `EncryptedPackage` в UTF-16LE.
- Produces (`upload.ts`): `export type InspectRefusal = 'file_type_not_allowed' | 'file_type_mismatch' | 'file_structure_unsupported' | 'file_encrypted' | 'file_too_complex'` (задача 3 добавит `'file_has_attachments'`); `export type InspectResult = { ok: true; mediaType: AllowedMediaType } | { ok: false; code: InspectRefusal; reason: string | null }`; `inspectFile(bytes: Buffer, originalName: string): Promise<InspectResult>` — порядок: тип по содержимому; нет типа и `isEncryptedOfficeDocument` с расширением `docx`/`xlsx` → `file_encrypted`; нет типа → `file_type_not_allowed`; расширение → `file_type_mismatch`; DOCX/XLSX → `zipStructureIssue` с новым бюджетом: `encrypted` → `file_encrypted`, `nested_too_deep` / `nested_too_many` / `inflate_limit` → `file_too_complex`, прочее → `file_structure_unsupported`. `acceptUpload` — прежние 400/413 и `inspectFile`; отказ — 415 с кодом, причина — строка журнала `File upload: ZIP structure not accepted` с `{ reason }`, без имени.
- Produces (инструмент): `node apps/api/dist/tools/check-upload.js <каталог>` — рекурсивно по файлам каталога (не больше `MAX_FILE_BYTES`, больше — строка `too_large`), печатает `<путь от каталога>\t<accepted|код>\t<reason|->`, итог `accepted N, refused M`, код выхода 0. Хранилища, базы и сети не трогает.

Тексты (en; ru, kk — в том же коммите): `file_encrypted` — «The document is password-protected. Remove the password and upload it again.»; `file_too_complex` — «The file has too many embedded documents to be checked. Save it without embedded objects or split it.».

- [ ] **Шаг 1. Тесты (сначала).** `zip-structure.test.ts`:
  - «вложенный законный XLSX в DOCX принят; вложенный XLSX с ZIP64 в локальном заголовке — zip64_local_values (DATA-07)»;
  - «три уровня вложения — nested_too_deep; 33 вложенных пакета — nested_too_many; вложенный пакет больше 64 МиБ после распаковки — inflate_limit (бюджет общий на файл)»;
  - «64 нулевых байта между записями — entries_gap; байты до первой записи — entries_gap; записи с битом 3 и описателем 12 и 16 байт — приняты»;
  - «фикстуры этапа 2 sample.docx и sample.xlsx по-прежнему приняты».
  `upload.http.test.ts`: «encrypted.docx — 415 file_encrypted; legacy.doc с именем .docx — 415 file_type_not_allowed; nested-deep.docx — 415 file_too_complex; nested-zip64.docx — 415 file_structure_unsupported; в журнале причина без имени файла».
  `apps/api/test/check-upload.test.ts` (новый): «check-upload по каталогу фикстур печатает по строке на файл с кодом и причиной и итог; файл больше 25 МБ — too_large».
  Web: `references.test.tsx` «каждый код FILE_PROBLEM_CODES переведён» — зелёный с новыми кодами.
- [ ] **Шаг 2.** Прогон — падают.
- [ ] **Шаг 3. Реализация** по Interfaces; инструмент в `tsconfig.build.json` попадает в `dist/tools`.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка.
- [ ] **Шаг 5.** Коммит `Приём DOCX и XLSX: вложенные пакеты проверяются рекурсивно с пределами, записи вне каталога и документы под паролем отклоняются, инструмент проверки папки файлов (DATA-06, DATA-07)`.

**Проверка контроллером вживую:** корпус настоящих файлов (Word 365, Excel 365, LibreOffice, Google Docs и Таблицы — экспорт, выгрузка Apache POI или 1С, если найдётся; DOCX с диаграммой Excel; XLSX с вложенным документом; DOCX и XLSX под паролем) через `check-upload` — законные приняты, под паролем — `file_encrypted`; ложный отказ — причина в отчёт, решение по проверке — до выката R2. На ClamAV локального стенда: DOCX с вложенным XLSX, внутри которого тестовый файл EICAR, принят при загрузке и отклонён сканом.

---

### Task 3: PDF — вложения и пароль; причина отказа скана (DATA-06, DATA-07, ADM-11)

**Модель:** `opus` · **Независимое ревью:** да

**Files:**
- Create: `apps/api/src/modules/files/pdf-structure.ts`; `apps/api/drizzle/0012_file_rejection_reason.sql` (+снимок) — `db:generate --name file_rejection_reason`.
- Modify: `apps/api/src/modules/files/upload.ts` (`inspectFile` для PDF), `apps/api/src/worker/file-scan.job.ts` (`rejection_reason` при `rejected`), `apps/api/src/database/schema/enums.ts` (`fileRejectionReason`), `schema/files.ts` (`fileVersion.rejectionReason`), `apps/api/src/modules/files/org-chart-sample.service.ts` (причина в состоянии), `packages/contracts/src/files.ts` (`FILE_REJECTION_REASONS`, `FILE_PROBLEM_CODES` += `file_has_attachments`, `orgChartSampleFileSchema.rejectionReason`), `infrastructure/clamav/clamd.conf` (`AlertEncryptedDoc yes`, `AlertEncryptedArchive yes` с комментарием «документ под паролем не проверить — отказ, вопрос 54»).
- Modify: `apps/web/src/routes/app/org-chart-sample-card.tsx` (текст причины у «Не прошёл проверку»), `references-actions.ts`, `apps/web/messages/{en,ru,kk}.json`.
- Test: `apps/api/test/pdf-structure.test.ts` (новый), `upload.http.test.ts`, `files.integration.test.ts`, `org-chart-sample.integration.test.ts`, `clamd.test.ts`; `apps/web/test/references.test.tsx`; фикстуры `attachment.pdf` (файл в `/EmbeddedFiles`), `attachment-objstm.pdf` (то же в потоке объектов `FlateDecode`), `attachment-escaped.pdf` (`/Embedded#46iles`), `owner-password.pdf` (`/Encrypt` с пустым паролем пользователя), `sample.pdf` этапа 2.

**Interfaces:**
- Consumes: задача 2 — `InflateBudget`, `createInflateBudget`, `inspectFile`, `InspectRefusal`.
- Produces (`pdf-structure.ts`): `export type PdfStructureIssue = 'attachments' | 'inflate_limit'`; `pdfStructureIssue(bytes: Buffer, budget: InflateBudget): PdfStructureIssue | null` — имена PDF (`/` и символы имени до разделителя, `#xx` раскрываются) `EmbeddedFile`, `EmbeddedFiles`, `FileAttachment` в байтах файла → `attachments`; если в файле нет имени `Encrypt`, — то же в распакованных потоках, словарь которых содержит `/Type /ObjStm` и единственный фильтр `/FlateDecode` (распаковка с `maxOutputLength` из бюджета; превышение → `inflate_limit`; поток, который не распаковывается, пропускается). Зашифрованный PDF в потоках не проверяется (расхождение 5).
- Produces (`upload.ts`): `InspectRefusal` += `'file_has_attachments'`; PDF: `attachments` → `file_has_attachments`, `inflate_limit` → `file_too_complex`; журнал `File upload: PDF not accepted` с `{ reason }`.
- Produces (contracts): `export const FILE_REJECTION_REASONS = ['malware', 'encrypted', 'scan_limits', 'unverifiable'] as const; export type FileRejectionReason`; `orgChartSampleFileSchema` += `rejectionReason: z.enum(FILE_REJECTION_REASONS).nullable()` (бывает не `null` только у `rejected`; у `rejected` этапа 2 — `null`).
- Produces (worker): `rejectionReasonFor(signature: string): FileRejectionReason` — `Heuristics.Encrypted.` → `encrypted`; `Heuristics.Limits.Exceeded` → `scan_limits`; `OBJECT_MISSING_SIGNATURE`, `CHECKSUM_MISMATCH_SIGNATURE` → `unverifiable`; иначе `malware`. `FileScanJob.decide` пишет `rejection_reason` вместе с `scan_state = 'rejected'`.
- Produces (БД): тип `file_rejection_reason`; `file_version.rejection_reason file_rejection_reason null`. **CHECK «rejected ⇔ причина есть» не ставится**: worker R1 в окне выката и после отката пишет `rejected` без причины, проверка остановила бы его скан (NFR-06); строки этапа 2 с `rejected` остаются без причины и показываются как «Не прошёл проверку» без уточнения (`rejectionReason: null`). Ограничение может добавить contract этапа 3.

Тексты (en): `references.errors.file_has_attachments` — «The PDF contains attached files. Save it without attachments (for example, print it to PDF) and upload it again.»; карточка образца: `references.sample.rejected.malware` — «The antivirus found a threat in the file.», `.encrypted` — «The file is password-protected: remove the password and upload it again.», `.scan_limits` — «The file is too complex to be checked: save it again or split it.», `.unverifiable` — «The file could not be checked: upload it again.».

- [ ] **Шаг 1. Тесты (сначала).** `pdf-structure.test.ts`: «sample.pdf — null; attachment.pdf, attachment-objstm.pdf, attachment-escaped.pdf — attachments; owner-password.pdf — null (потоки не читаются, вложений в несжатой части нет); поток объектов больше бюджета — inflate_limit». `upload.http.test.ts`: «PDF с вложением — 415 file_has_attachments, в журнале причина без имени». `files.integration.test.ts`: «скан с сигнатурой Heuristics.Encrypted.PDF — rejected с причиной encrypted; Heuristics.Limits.Exceeded.MaxScanSize — scan_limits; object_missing спустя 15 минут — unverifiable; Eicar-Signature — malware; passed — причина null». `org-chart-sample.integration.test.ts`: «latest rejected несёт rejectionReason encrypted; current — null». `clamd.test.ts`: «clamd.conf: AlertEncryptedDoc yes и AlertEncryptedArchive yes». `references.test.tsx`: «образец не прошёл проверку: текст причины encrypted на kk и en; все коды переведены».
- [ ] **Шаг 2.** Прогон — падают.
- [ ] **Шаг 3. Реализация** по Interfaces; `db:generate --name file_rejection_reason` (только `CREATE TYPE` и `ADD COLUMN`).
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка; `docker compose config -q`.
- [ ] **Шаг 5.** Коммит `PDF: вложения отклоняются при загрузке, документ под паролем — отказ антивируса с понятной причиной; причина отказа скана у версии файла (DATA-06, DATA-07, ADM-11)`.

**Проверка контроллером вживую** (ClamAV 1.4 локального стенда, образец оргструктуры под `admin@imbc.local`): PDF с паролем на открытие → «Не прошёл проверку: файл защищён паролем», сигнатура `Heuristics.Encrypted.PDF` в аудите; PDF только с паролем прав → «Текущий образец», скачивается; PDF с вложением → отказ при загрузке с текстом; корпус `check-upload` (PDF из Word, LibreOffice, сканера, «Печать в PDF», PDF реестров) — законные приняты.

---

### Task 4: предел одновременных загрузок на процесс и на аккаунт (DATA-06, NFR-09)

**Модель:** `opus` · **Независимое ревью:** да

**Files:**
- Create: `apps/api/src/modules/files/upload-slots.ts`.
- Modify: `apps/api/src/modules/files/upload.ts` (`uploadInterceptor` занимает место до multer), `apps/api/src/config/env.ts`, `.env.example` (`UPLOAD_CONCURRENCY=4`, `UPLOAD_CONCURRENCY_PER_ACCOUNT=2` с пояснением памяти), `apps/api/src/app.module.ts` (`UPLOAD_SLOTS`), `packages/contracts/src/files.ts` (`FILE_PROBLEM_CODES` += `upload_busy`, `upload_parallel_limit`), `apps/web/src/routes/app/references-actions.ts`, `apps/web/messages/{en,ru,kk}.json`.
- Test: `apps/api/test/upload-slots.test.ts` (новый), `upload.http.test.ts`.

**Interfaces:**
- Consumes: `uploadInterceptor`, `uploadFailure` (этап 2); `AuthContext` из `req.auth`.
- Produces: `export const UPLOAD_SLOTS = Symbol('UPLOAD_SLOTS')`; `export class UploadSlots { constructor(limits: { process: number; account: number }); tryAcquire(accountId: string): { release(): void } | 'busy' | 'account_limit'; get inUse(): number }` — без очереди; `release` идемпотентен. Env: `UPLOAD_CONCURRENCY` — целое 1–32, по умолчанию 4; `UPLOAD_CONCURRENCY_PER_ACCOUNT` — 1–8, по умолчанию 2. `uploadInterceptor()` берёт `UploadSlots` из контейнера (`moduleRef` или внедрение в класс-миксин), занимает место **до** чтения тела multer-ом, освобождает по `res.once('close')`; `'busy'` → `503 upload_busy`, `'account_limit'` → `429 upload_parallel_limit`, обоим заголовок `Retry-After: 5`; тело запроса не читается.

Тексты (en): `upload_busy` — «Too many files are being uploaded right now. Try again in a few seconds.»; `upload_parallel_limit` — «Wait until your other uploads finish, then try again.».

- [ ] **Шаг 1. Тесты (сначала).** `upload-slots.test.ts`: «два места на аккаунт и четыре на процесс: третье место аккаунта — account_limit, пятое на процесс — busy; release освобождает, повторный release ничего не меняет». `upload.http.test.ts` (`UPLOAD_CONCURRENCY=1`, тело первой загрузки — `ReadableStream`, который тест держит открытым, `duplex: 'half'`):
  - **«вторая загрузка при занятом месте — 503 upload_busy с Retry-After 5, тело не прочитано»**;
  - **«оборванная клиентом загрузка (AbortController) освобождает место: следующая принята»**;
  - «третья загрузка одного аккаунта при двух идущих — 429 upload_parallel_limit; другой аккаунт — принят» (`UPLOAD_CONCURRENCY=4`).
- [ ] **Шаг 2.** Прогон — падают.
- [ ] **Шаг 3. Реализация** по Interfaces.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка; `docker compose config -q`.
- [ ] **Шаг 5.** Коммит `Загрузки: предел одновременных загрузок на процесс и на аккаунт до чтения тела, понятный отказ с Retry-After (DATA-06, NFR-09)`.

**Проверка контроллером вживую:** на локальном стенде три параллельных `curl` с файлом 24 МБ под одним сеансом администратора → два приняты, третий `429`; память контейнера `api` (`docker stats`) во время загрузки не растёт сверх ожидаемого.

---

### Task 5: модель данных профиля по DBML — `0013` переименование, `0014` таблицы, `0015` данные и триггеры (DATA-01, DATA-02, DATA-03, DATA-04, NFR-06, MAN-40)

**Модель:** `opus` · **Независимое ревью:** да

**Files:**
- Create: `apps/api/src/database/schema/profile.ts` (`manufacturerProfile` и `ndaAcceptance` — перенос из `profiles.ts`; `profileSection`, `sectionRevision`, `submissionRequirement`, `sectionFieldSource`), `schema/profile-content.ts` (14 таблиц содержимого и `product_line_identity`); `apps/api/drizzle/0013_profile_rename.sql`, `0014_stage3_profile_model.sql`, `0015_stage3_profile_data.sql` (+снимки).
- Create: `packages/contracts/src/profile-sections.ts` (константы модели — ниже; задача 6 дополняет); экспорт из `index.ts`.
- Modify: `schema/profiles.ts` (только скелет, комментарий «удаляет contract этапа 3»), `schema/enums.ts` (`sectionKind`, `revisionOrigin`, `recordStatus`, `productLineSource`), `schema/index.ts`, `schema/platform.ts`, `schema/records.ts`, `schema/exchange.ts` (импорт `manufacturerProfile`); все места кода и тестов с `manufacturerProfiles` → `manufacturerProfile` (`seed.ts`, `onboarding.service.ts`, `adata.scheduler.ts`, `reviews.service.ts`, `notifications/recipients.ts`, `profiles.service.ts`, тесты — сырой SQL `manufacturer_profiles` в тестах переименовать, кроме тестов миграций до `0013`); `apps/api/src/database/app-role.ts`.
- Test: `apps/api/test/migration-stage3.integration.test.ts` (новый); `packages/contracts/test/contracts.test.ts`.

**Interfaces:**
- Consumes: база после `0012`; `dictionary_entry`, `file_object (id, organization_id)` (уникальность `file_object_id_org_uq`), `user_accounts`, тип `revision_state`, `capacity_unit`, `prefill_source`.
- Produces (contracts, `profile-sections.ts`):
  ```ts
  export const SECTION_KINDS = ['main_information', 'contacts', 'personnel', 'shareholders', 'products', 'production', 'certificates', 'documents'] as const;
  export type SectionKind = (typeof SECTION_KINDS)[number];
  export const COMPLETENESS_SECTIONS = SECTION_KINDS.filter((k) => k !== 'production'); // MAN-41
  export const REVISION_STATES = ['working', 'submitted', 'verified', 'rejected'] as const;
  export const REVISION_ORIGINS = ['manufacturer', 'migration'] as const;
  export const RECORD_STATUSES = ['uploaded', 'under_review', 'verified', 'rejected', 'expired', 'missing'] as const;
  export const PRODUCT_LINE_SOURCES = ['manual', 'e_ondiris', 'migration'] as const;
  export const PROVENANCE_FIELDS = {
    main_information: ['name_ru', 'legal_form', 'director_full_name', 'state_registered_on', 'oked', 'legal_address', 'production_address', 'company_phone', 'contact_email'],
    shareholders: ['shareholders'],
  } as const;
  export type ProvenanceField = (typeof PROVENANCE_FIELDS)[keyof typeof PROVENANCE_FIELDS][number];
  // + типы RevisionState, RevisionOrigin, RecordStatus, ProductLineSource
  ```
- Produces (БД, `0013`, рукописная, TS: `manufacturerProfile = pgTable('manufacturer_profile', …)`, затем `generate --custom --name profile_rename`): `ALTER TABLE manufacturer_profiles RENAME TO manufacturer_profile`; `RENAME CONSTRAINT` каждого внешнего ключа, имя которого Drizzle строит из имени таблицы (ключи `catalog_visible`, `nda_acceptance`, `external_check`, `prefilled_value`, таблиц `records.ts` и собственный ключ на `organizations` — список из `pg_constraint`); явные имена индексов (`manufacturer_profiles_org_uq`, `manufacturer_profiles_status_idx`) не меняются; `CREATE VIEW manufacturer_profiles AS SELECT * FROM manufacturer_profile`.
- Produces (БД, `0014`, генерируется после описания таблиц в TS): типы `section_kind`, `revision_origin`, `record_status`, `product_line_source`; `manufacturer_profile.accuracy_confirmed_at timestamptz null`, unique `manufacturer_profile_id_org_uq (id, organization_id)`; таблицы:

| Таблица (TS) | Колонки (имена и типы — DBML, кроме названного) | Ключи, уникальность, CHECK |
|---|---|---|
| `profile_section` (`profileSection`) | id, profile_id, organization_id, kind `section_kind`, verified_revision_id, pending_revision_id, completeness_percent numeric(5,2) null | FK `(profile_id, organization_id)` → `manufacturer_profile(id, organization_id)`; FK указателей → `section_revision.id`; unique `profile_section_kind_uq (profile_id, kind)`, `profile_section_id_org_uq (id, organization_id)` |
| `section_revision` (`sectionRevision`) | id, profile_section_id, organization_id, revision_number int, state `revision_state`, origin default `manufacturer`, author_id → `user_accounts`, completeness_percent numeric(5,2) null, created_at, submitted_at; **+ saved_at timestamptz null, edit_version int not null default 0** | FK `(profile_section_id, organization_id)` → `profile_section(id, organization_id)`; unique `(profile_section_id, revision_number)`, `(id, organization_id)`; partial unique `section_revision_working_uq (profile_section_id) where state = 'working'`; CHECK `state <> 'superseded'`, `revision_number > 0`, `edit_version >= 0`, `(state = 'working') = (submitted_at is null)` |
| `submission_requirement` | DBML | FK `(section_revision_id, organization_id)`; `dictionary_entry_id` → `dictionary_entry`; unique `(section_revision_id, dictionary_entry_id)` |
| `section_field_source` (`sectionFieldSource`), **новая** | id, section_revision_id, organization_id, field text, source `prefill_source`, original_items jsonb not null, read_at timestamptz not null, confirmed_at timestamptz null, confirmed_by uuid null → `user_accounts` | FK `(section_revision_id, organization_id)`; unique `(section_revision_id, field)`; CHECK `field` из 10 значений `PROVENANCE_FIELDS`; CHECK `(confirmed_at is null) = (confirmed_by is null)` |
| `main_information` | DBML; `null`: name_en, name_ru, legal_form_id, region_id, city, legal_address, production_address, company_phone; unified_register_registered default false | FK `(section_revision_id, organization_id)`; `legal_form_id`, `region_id` → `dictionary_entry`; `(unified_register_extract_id, organization_id)` → `file_object(id, organization_id)`; unique `section_revision_id`, `(id, organization_id)`, `(section_revision_id, organization_id)` |
| `main_information_oked` | DBML | FK `(main_information_id, organization_id)` → `main_information(id, organization_id)`; `oked_entry_id` → `dictionary_entry`; unique `(main_information_id, oked_entry_id)`; CHECK `position >= 0` |
| `contact` | DBML; `null`: full_name, position, email, phone, role_id | FK `(section_revision_id, organization_id)`; `role_id` → `dictionary_entry`; unique `contact_email_uq (section_revision_id, email)`, `contact_phone_uq (section_revision_id, phone)`; partial unique `contact_focal_point_uq (section_revision_id) where is_focal_point`; CHECK `email = lower(btrim(email))`, `phone ~ '^\+\d{10,15}$'`, `position_in_list >= 0` |
| `personnel` | DBML; четыре счётчика `null` | FK `(section_revision_id, organization_id)`; `(organisation_chart_id, organization_id)` → `file_object`; unique `section_revision_id`, `(id, organization_id)`; CHECK счётчики `>= 0` |
| `personnel_cv` | DBML | FK `(personnel_id, organization_id)` → `personnel`; `(file_object_id, organization_id)` → `file_object`; CHECK `position_in_list >= 0` |
| `shareholder` | DBML; `null`: name, share_percent, citizenship_or_country | FK `(section_revision_id, organization_id)`; CHECK `share_percent > 0 and share_percent <= 100`, `position_in_list >= 0` |
| `product_line_identity` | DBML | FK `(profile_id, organization_id)` → `manufacturer_profile`; unique `(id, organization_id)` |
| `product_line` | DBML; `null`: name_ru, commodity_group_id, commodity_type_id, tn_ved_code; **+ tn_ved_entry_id, kpved_entry_id → `dictionary_entry`, note text**; `e_ondiris_record_id` без FK | FK `(section_revision_id, organization_id)`, `(identity_id, organization_id)` → `product_line_identity`; группа и тип → `dictionary_entry`; `(conformity_file_id, organization_id)` → `file_object`; индексы DBML; unique `(section_revision_id, identity_id)`; CHECK `tn_ved_code ~ '^\d{10}$'`, доля 0–100, `capacity_quantity > 0`, `0 <= localization_steps_done <= localization_steps_total` |
| `production` | DBML | FK `(section_revision_id, organization_id)`; unique `section_revision_id`, `(id, organization_id)`; CHECK `area_sqm > 0`, `workshop_count >= 0`, `utilisation_percent between 0 and 100` |
| `production_process` | DBML, pk `(production_id, process_entry_id)` | FK `(production_id, organization_id)` → `production`; `process_entry_id` → `dictionary_entry` |
| `production_photo` | DBML | FK `(production_id, organization_id)`; `(file_object_id, organization_id)` → `file_object` |
| `equipment_item` | DBML; `null`: name, equipment_type_id, quantity | FK `(section_revision_id, organization_id)`; `equipment_type_id` → `dictionary_entry`; unique `(id, organization_id)`; CHECK `quantity > 0` |
| `equipment_product_line` | DBML, pk `(equipment_item_id, product_line_identity_id)` | FK `(equipment_item_id, organization_id)`, `(product_line_identity_id, organization_id)` |
| `certificate` | DBML; `null`: number, issuing_body, issued_on; status default `uploaded` | FK `(section_revision_id, organization_id)`; `certificate_type_id` → `dictionary_entry`; `(file_object_id, organization_id)` → `file_object`; unique `(id, organization_id)`; CHECK `expires_on >= issued_on` |
| `document` | DBML; status default `uploaded` | FK `(section_revision_id, organization_id)`; `document_type_id` → `dictionary_entry`; `(file_object_id, organization_id)` → `file_object`; unique `(id, organization_id)` |

  Все ссылки на `dictionary_entry` и `file_object` — `ON DELETE NO ACTION` (`23503` → `409 entry_in_use` уже ловит сервис справочников). Если drizzle-kit не выражает составной ключ на неуникальную в TS пару — уникальность `(id, organization_id)` объявляется в TS у родителя.
- Produces (БД, `0015`, рукописная): (1) `DO $$` — проверка расхождения 9 (`section_revisions.data <> '{}'::jsonb`; строки в семи таблицах) → `RAISE EXCEPTION 'stage 3 profile model: skeleton profile tables hold data (%)'`; (2) `INSERT INTO profile_section (profile_id, organization_id, kind) SELECT p.id, p.organization_id, k FROM manufacturer_profile p CROSS JOIN unnest(enum_range(null::section_kind)) k ON CONFLICT (profile_id, kind) DO NOTHING`; (3) рабочая редакция № 1 каждой секции без редакций: `state 'working'`, `origin` — `'migration'`, если `p.source = 'migration'`, иначе `'manufacturer'`; `author_id` — аккаунт роли `manufacturer` организации или `null`; (4) функции и триггеры (ниже); (5) `REVOKE` — в `app-role.ts`, не в SQL.
- Produces (триггеры): `section_content_guard()` — `BEFORE INSERT OR UPDATE OR DELETE FOR EACH ROW` на 14 таблицах содержимого (все таблицы `profile-content.ts`, кроме `product_line_identity`) и `section_field_source`: редакция строки (через родителя у `main_information_oked`, `personnel_cv`, `production_process`, `production_photo`, `equipment_product_line`) не в состоянии `working` → `RAISE EXCEPTION 'section revision % is frozen'` (SQLSTATE `P0001`); исключение — `UPDATE` у `certificate` и `document`, меняющий только `status`; вид секции редакции не совпадает с таблицей (`main_information*` → `main_information`, `contact` → `contacts`, `personnel*` → `personnel`, `shareholder` → `shareholders`, `product_line` → `products`, `production*` и `equipment_*` → `production`, `certificate` → `certificates`, `document` → `documents`) → `RAISE EXCEPTION 'row does not belong to section kind %'`. `section_revision_guard()` — `BEFORE UPDATE OR DELETE` на `section_revision`: у строки с `OLD.state <> 'working'` меняться может только `state` (`submitted` → `verified` | `rejected`); `DELETE` такой строки — исключение.
- Produces (`app-role.ts`): `REVOKE DELETE, TRUNCATE ON section_revision, submission_requirement`; `REVOKE UPDATE ON submission_requirement`.

- [ ] **Шаг 1. Тесты (сначала).** `migration-stage3.integration.test.ts` (PostgreSQL 18):
  - **«запросы предыдущей версии (R1) проходят через представление manufacturer_profiles после 0015 (NFR-06)»** — `migrateThrough(pool, '0012_file_rejection_reason')`, данные; `migrateThrough(pool)`; затем ровно эти операторы: `insert into manufacturer_profiles (organization_id) values ($1) on conflict (organization_id) do nothing returning id`; `insert … on conflict (organization_id) do update set status = excluded.status`; `select … from manufacturer_profiles p join organizations o on … for update of p`; `update manufacturer_profiles set completeness_pct = 10 where id = $1`; вставка в скелетные `profile_sections` и `section_revisions` с `profile_id` нового профиля;
  - «в 0013–0015 нет DROP, ALTER COLUMN TYPE, SET NOT NULL; единственный RENAME TABLE — manufacturer_profiles» — чтение файлов;
  - **«скелет с данными: section_revisions.data = '{"city":"x"}' или строка contacts — 0015 падает с 'skeleton profile tables hold data', схема и журнал прежние»**;
  - «каждому профилю — восемь profile_section в порядке SECTION_KINDS и по одной рабочей редакции № 1; origin migration у профиля source = migration; повторный прогон 0015 ничего не добавляет»;
  - **«составные ключи: контакт с organization_id другой организации на редакции этой — 23503; ссылка personnel.organisation_chart_id на file_object другой организации — 23503 (GEN-11, GEN-09)»**;
  - «ключи справочников: удаление значения, на которое ссылается main_information.region_id, — 23503 (DATA-04)»;
  - «ограничения: вторая рабочая редакция секции — 23505; два контакта с одной почтой или телефоном на редакции — 23505; два focal point — 23505; почта не в нижнем регистре и телефон не '+' с цифрами — 23514; доля 0 и 100.01 — 23514; tn_ved_code '101210000' — 23514, '0101210000' — проходит и читается текстом (DATA-03)»;
  - **«замороженная редакция неизменна (DATA-01): для каждой из 15 таблиц (14 таблиц содержимого и section_field_source) — INSERT, UPDATE, DELETE строки редакции в состоянии submitted дают P0001; UPDATE certificate.status на такой редакции проходит; UPDATE section_revision.saved_at замороженной — P0001; submitted → verified проходит; DELETE замороженной — P0001»**;
  - «строка чужого вида секции: контакт на редакции main_information — P0001»;
  - «права роли приложения: section_revision — без DELETE и TRUNCATE; submission_requirement — только SELECT и INSERT» (`applyAppRoleGrants`, `has_table_privilege`).
  `contracts.test.ts`: «SECTION_KINDS, REVISION_STATES, REVISION_ORIGINS, RECORD_STATUSES, PRODUCT_LINE_SOURCES — значения DBML; RECORD_STATUSES = DOCUMENT_STATUSES; PROVENANCE_FIELDS — 10 значений, совпадают с CHECK section_field_source».
- [ ] **Шаг 2.** Прогон — падают.
- [ ] **Шаг 3. Реализация** строго в порядке: TS-переименование → `generate --custom --name profile_rename` → SQL `0013` → таблицы в TS → `db:generate --name stage3_profile_model` (просмотр SQL глазами) → `generate --custom --name stage3_profile_data` → SQL `0015` → `db:generate` — изменений нет; переименование `manufacturerProfiles` по коду и тестам.
- [ ] **Шаг 4.** Прогон — зелёный (все прежние тесты — тоже); полная проверка.
- [ ] **Шаг 5.** Коммит `Модель профиля по DBML: manufacturer_profile с совместимым представлением, восемь секций с редакциями, таблицы секций со ссылками на справочники и файлы своей организации, неизменяемость отправленной редакции в БД (DATA-01, DATA-02, DATA-03, DATA-04, NFR-06, MAN-40)`.

**Проверка контроллером вживую:** `0013`–`0015` на копии базы локального стенда и на копии дампа Azure после `0011`: проверка скелета проходит, профилей × 8 = строк `profile_section`; образ R1 (коммит задачи 1) стартует на этой базе — вход производителя, `/profile`, регистрация нового производителя (Draft создаётся через представление), очередь SME.

---

### Task 6: ядро секций — создание и чтение, copy-on-write, блокировка, полнота, выбор значений справочника (MAN-04, MAN-40, MAN-41, MAN-43, MAN-46, DATA-01, DATA-04, GEN-11)

**Модель:** `opus` · **Независимое ревью:** да

**Files:**
- Modify: `packages/contracts/src/profile-sections.ts`.
- Create: `apps/api/src/modules/profiles/profile-store.ts`, `revision-copy.ts`, `dictionary-choice.ts`, `section-handler.ts`, `section-errors.ts`, `profile-sections.service.ts`, `profile-sections.controller.ts`.
- Modify: `apps/api/src/modules/profiles/profiles.service.ts` (`ensureDraft` — новые таблицы), `apps/api/src/app.module.ts` (`SECTION_HANDLERS` — пустой список; задачи 8, 9 добавляют).
- Test: `apps/api/test/support/section-handler.ts` (тестовый обработчик `fakeSectionHandler`), `apps/api/test/profile-sections.http.test.ts`, `profile-sections.integration.test.ts`, `revision-copy.integration.test.ts` (новые); `onboarding.integration.test.ts`, `profile.integration.test.ts` (остаются зелёными); `packages/contracts/test/profile-sections.test.ts` (новый).

**Interfaces:**
- Consumes: задача 5 — таблицы, константы, триггеры; `actorTransaction`, `notFound`, `busy` (этап 2); `entryDisplayName`, `DictionaryCode`, `prefilledItemSchema`, `PREFILL_SOURCES`, `PROFILE_STATUSES`.
- Produces (contracts):
  ```ts
  export const SECTION_SLUGS: Record<SectionKind, string>; // kind с '_' → '-'
  export function sectionKindFromSlug(slug: string): SectionKind | null;
  export const SECTION_STATES = ['not_sent', 'changed', 'submitted', 'under_review', 'verified', 'rejected', 'pending_sent'] as const;
  export const PROFILE_LOCKS = ['submitted', 'under_review', 'changes_sent'] as const;
  export function profileLock(status: ProfileStatus, changesSent: boolean): ProfileLock | null;
  export function deriveSectionState(s: { profileStatus: ProfileStatus; hasWorking: boolean;
    lastFrozen: 'submitted' | 'verified' | 'rejected' | null; pendingSent: boolean }): SectionState;
  export const MISSING_KEYS = ['field_empty', 'field_unconfirmed', 'contacts_too_few', 'contact_incomplete',
    'focal_point_missing', 'shareholders_none', 'shareholder_incomplete', 'section_not_available'] as const;
  export const missingItemSchema = z.object({ key: z.enum(MISSING_KEYS), field: z.string().nullable(),
    index: z.number().int().nullable(), count: z.number().int().nullable() }).strict();
  export interface SectionCompleteness { percent: number | null; missing: MissingItem[] }
  export function percentOf(done: number, total: number): number; // floor(done*100/total), total 0 → 100
  export function profilePercent(percents: Partial<Record<SectionKind, number | null>>): number; // floor среднего COMPLETENESS_SECTIONS, нет — 0
  export const provenanceSchema = z.object({ field: z.string(), source: z.enum(PREFILL_SOURCES), readAt: z.iso.datetime(),
    items: z.array(prefilledItemSchema).min(1), confirmedAt: z.iso.datetime().nullable() }).strict();
  export const dictionaryRefSchema = z.object({ id: z.uuid(), code: z.string(), name: z.string(), retired: z.boolean() }).strict();
  export const sectionSummarySchema = z.object({ kind: z.enum(SECTION_KINDS), available: z.boolean(), state: z.enum(SECTION_STATES),
    percent: z.number().int().min(0).max(100).nullable(), missing: z.array(missingItemSchema), savedAt: z.iso.datetime().nullable() }).strict();
  export const ownSectionsSchema = z.object({ profileStatus: z.enum(PROFILE_STATUSES), hasPendingChanges: z.boolean(),
    editable: z.boolean(), lock: z.enum(PROFILE_LOCKS).nullable(), profilePercent: z.number().int().min(0).max(100),
    sections: z.array(sectionSummarySchema).length(8) }).strict();
  export const sectionRevisionInfoSchema = z.object({ number: z.number().int(), state: z.enum(REVISION_STATES),
    savedAt: z.iso.datetime().nullable(), editVersion: z.number().int() }).strict();
  export function sectionEnvelopeSchema<T extends z.ZodType>(data: T): z.ZodObject<…>; // { kind, state, editable, lock, revision, completeness: { percent, missing }, provenance: Provenance[], data: T }, strict
  export function sectionSaveSchema<T extends z.ZodType>(input: T): z.ZodObject<…>; // { editVersion: int ≥ 0, data: T, confirm: string[] ≤ 20, default [] }, strict
  export const PROFILE_PROBLEM_CODES = ['validation', 'unauthenticated', 'mfa_required', 'responsibility_required', 'forbidden',
    'bad_origin', 'not_found', 'section_not_available', 'profile_locked', 'section_changed', 'revision_frozen', 'busy', 'internal'] as const;
  export const SECTION_FIELD_ERRORS = ['text_too_long', 'phone_format', 'email_format', 'website_format', 'date_format',
    'date_in_future', 'entry_not_selectable', 'duplicate_entry', 'duplicate_email', 'duplicate_phone', 'focal_point_multiple',
    'share_range', 'share_precision', 'too_many_rows', 'confirm_unknown'] as const;
  export const sectionText = z.string().trim().max(500, 'text_too_long').transform((v) => v || null).nullable(); // '' → null; общее для секций
  export function normalizePhone(raw: string): string | null; // расхождение 15
  export function normalizeEmail(raw: string): string;          // trim + lower
  export function normalizeWebsite(raw: string): string | null; // расхождение 15
  ```
  `deriveSectionState`: профиль `submitted` / `under_review` → то же; `pendingSent` → `pending_sent`; есть рабочая → `changed`, если есть замороженная, иначе `not_sent`; иначе `lastFrozen` (`submitted` → `pending_sent`). `profileLock`: `submitted`, `under_review` → то же; `verified` и `changesSent` → `changes_sent`; иначе `null` (расхождение 19). Часть 3в добавит решения и комментарии SME.
- Produces (обработчик, `section-handler.ts`):
  ```ts
  export interface SectionContext { tx: Database; organizationId: string; profileId: string; revisionId: string; locale: Locale; now: Date }
  export interface SectionHandler<D = unknown, I = unknown> {
    readonly kind: SectionKind; readonly inputSchema: z.ZodType<I>; readonly dataSchema: z.ZodType<D>;
    load(tx: Database, revisionId: string, locale: Locale): Promise<D>;
    normalize(ctx: SectionContext, input: I, before: D): Promise<D>;       // 400 validation через sectionValidation
    write(tx: Database, revision: { id: string; organizationId: string }, data: D): Promise<void>;
    changedFields(before: D, after: D): string[];
    completeness(data: D, provenance: Provenance[]): SectionCompleteness;   // функция из @imbc/contracts
  }
  export const SECTION_HANDLERS = Symbol('SECTION_HANDLERS'); // SectionHandler[]
  ```
  `section-errors.ts`: `sectionValidation(errors: { path: (string | number)[]; code: SectionFieldError }[]): ProblemException` — `400 validation`, `errors: [{ path: 'data.contacts.1.email', message: <код> }]` (формат ZodError фильтра); схемы ввода секций пишут код в `message` своих проверок.
- Produces (хранилище, `profile-store.ts`; типы строк — `typeof manufacturerProfile.$inferSelect`, `typeof profileSection.$inferSelect`, `typeof sectionRevision.$inferSelect` под именами `OwnProfileRow`, `SectionRow`, `RevisionRow`): `ensureSections(tx: Database, profile: { id: string; organizationId: string; source: string }, authorId: string | null): Promise<number>` — то же, что `0015` (2)–(3), возвращает число созданных секций; `lockOwnProfile(tx, organizationId): Promise<OwnProfileRow>` (`for no key update`, нет — `notFound()`); `latestRevisions(tx, profileId): Promise<Map<SectionKind, { section: SectionRow; working: RevisionRow | null; lastFrozen: RevisionRow | null }>>`; `workingRevisionForEdit(tx, section: SectionRow, authorId: string): Promise<{ revision: RevisionRow; created: boolean }>` — рабочей нет → новая с номером `max + 1`, `copyRevisionContent` из последней редакции, аудит `profile.revision_created`.
- Produces (`revision-copy.ts`): `copyRevisionContent(tx: Database, kind: SectionKind, fromRevisionId: string, toRevisionId: string): Promise<void>` — строки всех таблиц своего вида: дочерние с новыми id родителя (`main_information_oked`, `personnel_cv`, `production_process`, `production_photo`, `equipment_product_line`), `product_line.identity_id` и ссылки на файлы — прежние, `section_field_source` — вместе с подтверждением; `submission_requirement` не копируется.
- Produces (`dictionary-choice.ts`): `assertSelectable(tx: Database, dictionary: DictionaryCode, picks: { path: (string | number)[]; id: string }[], keep: ReadonlySet<string>, locale: Locale): Promise<Map<string, DictionaryRef>>` — значение есть, из этого справочника и действующее — или выведенное, но в `keep`; иначе ошибка `entry_not_selectable` по `path` (все ошибки разом).
- Produces (сервис): `ProfileSectionsService` (зависимости `DB`, `PG_POOL`, `AuditService`, `SECTION_HANDLERS`): `overview(auth: AuthContext): Promise<OwnSections>`; `read(auth: AuthContext, kind: string): Promise<SectionEnvelope>`; `save(auth: AuthContext, kind: string, body: unknown, ip: string | null): Promise<SectionEnvelope>`. Чтение: профиль организации сеанса (нет — 404), `ensureSections` (создало — аудит `profile.sections_created`), состояние по `deriveSectionState`, полнота по обработчику для доступных видов, для остальных — `{ percent: 0, missing: [{ key: 'section_not_available' }] }` (`production` — `null`); `available` = есть обработчик. Сохранение — `actorTransaction(pool, audit, actor, { route: '/api/v1/profiles/own/sections/:kind', ip, action: 'profile.edit' })` → вид известен и есть обработчик (иначе 404 `not_found` / `section_not_available`) → `sectionSaveSchema(handler.inputSchema)` → `lockOwnProfile` → `profileLock` (не `null` → `409 profile_locked` с `{ lock }`) → строка `profile_section` `for update` → `workingRevisionForEdit` → `editVersion` ≠ `revision.edit_version` → `409 section_changed` → `normalize` (с `before = load(...)`) → `confirm` — поля из `PROVENANCE_FIELDS[kind]` (иначе `400 confirm_unknown`), у которых есть строка источника; изменённое поле источника подтверждается само → нет изменений и подтверждений — 200 без записи → `write`, `confirmed_at/by`, `saved_at = now`, `edit_version + 1`, `completeness_percent` редакции и секции, `manufacturer_profile.completeness_pct = profilePercent(...)` по сохранённым процентам секций → аудит `profile.section_saved` → конверт. `P0001` из триггера — `409 revision_frozen` (журнал без значений). Ожидание блокировки сверх предела — `503 busy`.
- Produces (HTTP; ответы — `parseResponse`):

| Маршрут | Право | Успех | Ошибки |
|---|---|---|---|
| `GET /api/v1/profiles/own/sections` | `profile.read` | 200 `ownSectionsSchema` | 404 `not_found` |
| `GET /api/v1/profiles/own/sections/:kind` | `profile.read` | 200 конверт секции | 404 `not_found`, `section_not_available` |
| `PUT /api/v1/profiles/own/sections/:kind` | `profile.edit` | 200 конверт секции | 400 `validation`; 404; 409 `profile_locked`, `section_changed`, `revision_frozen`; 503 `busy` |

- Produces (`ProfilesService.ensureDraft`): та же сигнатура; профиль + `ensureSections` (скелетные секции больше не пишутся).

- [ ] **Шаг 1. Тесты (сначала).** `profile-sections.test.ts` (contracts): «deriveSectionState — таблица из 10 случаев»; «profileLock: draft, returned, verified без отправки — null; submitted, under_review, verified с отправкой — свой код (MAN-43, MAN-45)»; «percentOf и profilePercent: 7 секций по 100 — 100, одна 99 — 99, production не входит (MAN-41)»; «normalizePhone: '+7 701 111-22-33' и '87011112233' → '+77011112233'; '12345' и '+7 (701) abc' → null; normalizeEmail; normalizeWebsite: 'demo.kz' → 'https://demo.kz', 'ftp://x.kz' и 'localhost' → null»; «SECTION_SLUGS обратимы». `profile-sections.http.test.ts`: таблица трёх маршрутов × роли матрицы (разрешённые — сервис вызван; отклонённые — 403, `denied` и `action` в аудите, сервис не вызван); без сеанса — 401; PUT с чужого Origin — `403 bad_origin`. `profile-sections.integration.test.ts` (PostgreSQL 18; `fakeSectionHandler` для `shareholders`):
  - «ensureDraft: профиль, восемь секций, рабочие редакции № 1; повтор — тот же id (MAN-03)»;
  - **«профиль, созданный предыдущей версией (только строка manufacturer_profile и скелетные секции), при первом чтении получает восемь секций; аудит profile.sections_created; второе чтение ничего не создаёт (NFR-06)»**;
  - «обзор: восемь секций в порядке SECTION_KINDS, available только у зарегистрированных обработчиков, остальные 0 % и section_not_available, production — null; profilePercent»;
  - **«аккаунт другой организации видит только свой профиль: обзор и секции организации B не содержат значений A; сохранение B не меняет строк A (GEN-11)»**;
  - **«параллельные сохранения одной секции с одним editVersion — 200 и 409 section_changed; edit_version вырос на 1»**;
  - «copy-on-write: редакция submitted у профиля returned — сохранение создаёт рабочую № 2 с копией, № 1 не изменилась, аудит profile.revision_created {from: 1, to: 2} (DATA-01)»;
  - «блокировка: профиль submitted, under_review и verified с pending_revision_id — 409 profile_locked с кодом; draft, returned, verified без отправки — сохраняется (MAN-43)»;
  - **«assertSelectable: действующее — да; выведенное новое — entry_not_selectable; выведенное из keep — да; значение другого справочника — entry_not_selectable; несуществующий id — entry_not_selectable (DATA-04)»**;
  - «сохранение без изменений — 200, аудита и роста edit_version нет»;
  - «исполнитель стал blocked до транзакции — 403, запись denied с action profile.edit»;
  - «Draft не виден оператору и наблюдателю: страница компании draft-профиля — 404 (MAN-04)».
  `revision-copy.integration.test.ts`: «для каждого вида секции строки (с дочерними, файлами своей организации и источником) копируются в новую редакцию, идентичность линии та же, исходная редакция не изменилась».
- [ ] **Шаг 2.** Прогон — падают.
- [ ] **Шаг 3. Реализация** по Interfaces; `@ApiTags('profiles')`.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка.
- [ ] **Шаг 5.** Коммит `Ядро секций профиля: восемь секций на модели DBML, copy-on-write редакций, блокировка на проверке, полнота и чего не хватает, выбор действующих значений справочников, только свой профиль (MAN-04, MAN-40, MAN-41, MAN-43, MAN-46, DATA-01, DATA-04, GEN-11)`.

---

### Task 7: файлы производителя — правило чтения по записи-владельцу; использование значений справочников — внешними ключами (GEN-09, MAN-04, ADM-06, DATA-04)

**Модель:** `opus` · **Независимое ревью:** да

**Files:**
- Create: `apps/api/src/modules/files/file-owner.ts`.
- Modify: `apps/api/src/modules/files/file-access.ts` (`manufacturerFileRule`), `apps/api/src/modules/dictionaries/usage.ts` (убрать текстовые колонки скелета профиля).
- Test: `apps/api/test/file-owner.integration.test.ts` (новый), `files.integration.test.ts`, `dictionaries.integration.test.ts`.

**Interfaces:**
- Consumes: задача 5 — таблицы содержимого; `FileReadRule`, `FILE_READ_RULES`, `MANUFACTURER_FILE_PURPOSES` (этап 2).
- Produces: `export const FILE_OWNER_LINKS: Record<ManufacturerFilePurpose, { table: string; column: string; parent?: { table: string; key: string } }>` — `unified_register_extract` → `main_information.unified_register_extract_id`; `organisation_chart` → `personnel.organisation_chart_id`; `cv` → `personnel_cv.file_object_id` через `personnel`; `conformity_certificate` → `product_line.conformity_file_id`; `production_photo` → `production_photo.file_object_id` через `production`; `certificate_file` → `certificate.file_object_id`; `document_file` → `document.file_object_id`. `fileOwnerRevisions(tx: Database, file: { id: string; purpose: ManufacturerFilePurpose }): Promise<{ revisionId: string; state: RevisionState; kind: SectionKind; profileId: string; organizationId: string }[]>`. `manufacturerFileRule`: `can(role,'profile.read') === 'own'` → файл своей организации (сохранённый и ещё не сохранённый); `=== 'all'` → `fileOwnerRevisions(...)` не пуст; иначе `false` (расхождение 21). Сигнатура `FileReadRule` не меняется.
- Produces: `DICTIONARY_USAGES` — только `catalog_visible.*` (проекция; этап 5 заменит); ссылки профиля держат внешние ключи `0014`.

- [ ] **Шаг 1. Тесты (сначала).** `file-owner.integration.test.ts` (PostgreSQL 18; строки секций — SQL-ем):
  - **«производитель читает свой файл, сохранённый в секции и ещё не сохранённый; производитель другой организации — 403 и аудит file.read denied с id файла (GEN-09, GEN-11)»**;
  - **«SME и директор читают файл, на который ссылается рабочая редакция черновика (MAN-04), и файл замороженной редакции; файл без записи-владельца — 403»**;
  - «администратор — 403 всегда (ADM-06); оператор и наблюдатель — 403»;
  - «для каждого из семи назначений fileOwnerRevisions находит редакцию через свою колонку; файл назначения cv, на который ссылается certificate.file_object_id, для SME не читается».
  `dictionaries.integration.test.ts`: **«значение, использованное в профиле, удалить нельзя: для каждой из 11 ссылок на незакрытые справочники (legal_form_id, region_id, oked_entry_id, commodity_type_id, tn_ved_entry_id, kpved_entry_id, process_entry_id, equipment_type_id, certificate_type_id, document_type_id, submission_requirement.dictionary_entry_id) — 409 entry_in_use, значение на месте; у закрытых (contact.role_id, product_line.commodity_group_id) API отвечает 409 dictionary_closed, а удаление SQL-ем — 23503 (DATA-04)»**; прежние тесты `catalog_visible` зелёные.
- [ ] **Шаг 2.** Прогон — падают.
- [ ] **Шаг 3. Реализация** по Interfaces.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка.
- [ ] **Шаг 5.** Коммит `Файлы производителя читаются по записи-владельцу: свой — производитель, сохранённый в редакции — SME и директор; значения справочников в профиле защищены внешними ключами (GEN-09, MAN-04, ADM-06, DATA-04)`.

---

### Task 8: секция «Основные сведения» — API, источник значения и подтверждение (MAN-09, MAN-10, MAN-11, MAN-15, MAN-06, MAN-07, MAN-40, MAN-41, DATA-02, DATA-03)

**Модель:** `opus` · **Независимое ревью:** да

**Files:**
- Create: `packages/contracts/src/sections/main-information.ts` (экспорт из `index.ts`); `apps/api/src/modules/profiles/sections/main-information.handler.ts`.
- Modify: `apps/api/src/app.module.ts` (обработчик в `SECTION_HANDLERS`); `apps/api/src/database/seed.ts` (демо-данные — ниже).
- Test: `apps/api/test/section-main-information.integration.test.ts` (новый); `seed.integration.test.ts`; `packages/contracts/test/profile-sections.test.ts`.

**Interfaces:**
- Consumes: задача 6 — `SectionHandler`, `assertSelectable`, `sectionValidation`, `normalizePhone`, `normalizeEmail`, `normalizeWebsite`, `percentOf`, `dictionaryRefSchema`, `provenanceSchema`; задача 5 — `main_information`, `main_information_oked`, `section_field_source`.
- Produces (contracts):
  ```ts
  const text = sectionText; // задача 6
  export const mainInformationInputSchema = z.object({
    nameRu: text, nameEn: text, legalFormId: z.uuid().nullable(), directorFullName: text,
    stateRegisteredOn: z.iso.date('date_format').nullable(), website: text, okedEntryIds: z.array(z.uuid()).max(50, 'too_many_rows'),
    regionId: z.uuid().nullable(), city: text, legalAddress: text, productionAddress: text, companyPhone: text, contactEmail: text,
  }).strict();
  export const mainInformationDataSchema = z.object({
    nameRu, nameEn, directorFullName, stateRegisteredOn, website, city, legalAddress, productionAddress, companyPhone, contactEmail: z.string().nullable(),
    legalForm: dictionaryRefSchema.nullable(), region: dictionaryRefSchema.nullable(), okeds: z.array(dictionaryRefSchema),
    bin: z.string(), login: z.string(),                                         // только чтение (MAN-05, MAN-09)
    unifiedRegister: z.object({ registered: z.boolean(), firstInclusionOn: z.string().nullable() }).strict(), // MAN-12, этап 4б
    registryOked: z.object({ code: z.string(), name: z.string() }).nullable(),  // MAN-12, этап 4б
  }).strict();
  export const MAIN_INFORMATION_REQUIRED = ['name_ru', 'name_en', 'legal_form', 'director_full_name', 'state_registered_on',
    'oked', 'region', 'city', 'legal_address', 'production_address', 'company_phone'] as const; // 11 пунктов, расхождения 13, 14
  export function mainInformationCompleteness(data: MainInformationData, provenance: Provenance[]): SectionCompleteness;
  // пустое — field_empty; заполненное, но с неподтверждённым источником — field_unconfirmed; percent = percentOf(заполнено и подтверждено, 11)
  ```
- Produces (обработчик): `mainInformationHandler: SectionHandler<MainInformationData, MainInformationInput>` — `normalize`: телефон — `normalizePhone` (не приводится → `phone_format`), почта — `z.email()` и `normalizeEmail` (`email_format`), сайт — `normalizeWebsite` (`website_format`), дата — не позже сегодняшней даты Алматы (`ctx.now`, `date_in_future`); `legalFormId` — `assertSelectable('legal_form')`, `regionId` — `'region'`, `okedEntryIds` — `'oked'` (повтор id → `duplicate_entry`), `keep` — значения из `before`; БИН — `organizations.bin`, логин — почта аккаунта `manufacturer` организации; строка `main_information` создаётся при первом сохранении; ОКЭД — строки `main_information_oked` с `position` по порядку ввода (DATA-02). `changedFields` — ключи `MAIN_INFORMATION_REQUIRED` и `website`, `contact_email`. Названия значений — `entryDisplayName` на языке сеанса.
- Produces (seed, только `SEED_DEMO=true`, идемпотентно — если у демо-производителя `manufacturer@demo.local` ещё нет строки `main_information`): в рабочей редакции «Основных сведений» — `nameRu`, `nameEn`, регион из `COMPANIES[0]`; `legalAddress` с источником `adata` и `productionAddress` с источником `e_ondiris`, оба неподтверждённые (`read_at` — время seed); комментарий «демонстрационные значения; настоящие придут с этапом 4б».

- [ ] **Шаг 1. Тесты (сначала).** `section-main-information.integration.test.ts` (PostgreSQL 18, справочники `release` и фикстуры регионов, ОКЭД):
  - **«частичное сохранение: пустой черновик и одно поле nameRu — 200, полнота 9 %, в missing 10 полей; null очищает поле; ЖШС «Құрылыс» "Б" сохраняется как введено; 501 символ — 400 text_too_long по пути data.nameRu (MAN-40)»**;
  - «все 11 пунктов — 100 % (MAN-41); сайт и контактная почта не влияют»;
  - «БИН и логин в теле — 400 validation (strict); в ответе БИН организации и логин аккаунта (MAN-05, MAN-09)»;
  - «телефон '8 (701) 111 22 33' хранится '+77011112233'; 'abc' — phone_format; почта ' Info@Demo.local ' → 'info@demo.local'; 'info@' — email_format; сайт 'demo.kz' → 'https://demo.kz'; дата завтра по Алматы — date_in_future (MAN-15, DATA-08)»;
  - **«правовая форма — id значения из справочника регионов — 400 entry_not_selectable по data.legalFormId; выведенный регион новым выбором — 400; ранее выбранный регион, выведенный потом, сохраняется при правке другого поля (DATA-04)»**;
  - «ОКЭД: три кода отдельными строками в порядке ввода; повтор id — duplicate_entry; код '01110' возвращается текстом (DATA-02, DATA-03, MAN-10)»;
  - «источник: legalAddress с источником adata без подтверждения — field_unconfirmed, полнота без него; confirm ['legal_address'] — подтверждено, аудит confirmed; правка значения подтверждает сама; confirm ['bin'] — 400 confirm_unknown; исходное значение в ответе provenance (MAN-07)»;
  - «аудит profile.section_saved: section, revision, fields — имена полей; в diff нет телефона, адреса и ФИО»;
  - **«организация B не видит и не меняет «Основные сведения» организации A (GEN-11)»**;
  - «конверт проходит строгую схему; unifiedRegister.registered false, registryOked null (MAN-12 — этап 4б)».
  `seed.integration.test.ts`: «seed: у демо-производителя два неподтверждённых значения с источником adata и e_ondiris; второй seed ничего не меняет». `profile-sections.test.ts`: «mainInformationCompleteness: 11 пунктов, неподтверждённое не считается».
- [ ] **Шаг 2.** Прогон — падают.
- [ ] **Шаг 3. Реализация** по Interfaces.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка.
- [ ] **Шаг 5.** Коммит `Секция «Основные сведения»: правовая форма, регион и ОКЭД из справочников, форматы телефона, почты и сайта, БИН и логин только для чтения, источник значения и подтверждение (MAN-09, MAN-10, MAN-11, MAN-15, MAN-07, MAN-41, DATA-02, DATA-03)`.

---

### Task 9: секции «Контакты» и «Акционеры» — API (MAN-13, MAN-14, MAN-15, MAN-21, MAN-22, MAN-41, DATA-02)

**Модель:** `sonnet` · **Независимое ревью:** да

**Files:**
- Create: `packages/contracts/src/sections/contacts.ts`, `sections/shareholders.ts`; `apps/api/src/modules/profiles/sections/contacts.handler.ts`, `shareholders.handler.ts`.
- Modify: `apps/api/src/app.module.ts`.
- Test: `apps/api/test/section-contacts.integration.test.ts`, `section-shareholders.integration.test.ts` (новые); `packages/contracts/test/profile-sections.test.ts`.

**Interfaces:**
- Consumes: задачи 6 и 8 — образец обработчика, `assertSelectable`, нормализаторы, `sectionValidation`.
- Produces (contracts):
  ```ts
  export const MAX_ROWS = 50;
  const text = sectionText; // задача 6
  export const contactsInputSchema = z.object({ contacts: z.array(z.object({ fullName: text, position: text, email: text, phone: text,
    roleId: z.uuid().nullable(), isFocalPoint: z.boolean() }).strict()).max(MAX_ROWS, 'too_many_rows') }).strict();
  export const contactsDataSchema = z.object({ contacts: z.array(z.object({ fullName, position, email, phone: z.string().nullable(),
    role: dictionaryRefSchema.nullable(), isFocalPoint: z.boolean() }).strict()) }).strict();
  export function contactComplete(c: ContactRow): boolean; // ФИО, должность, почта, телефон, роль
  export function contactsCompleteness(data: ContactsData): SectionCompleteness;
  // пункты: max(3, n) контактов + focal point; contact_incomplete {index} на каждый неполный; contacts_too_few {count}; focal_point_missing
  export const shareholdersInputSchema = z.object({ shareholders: z.array(z.object({ name: text,
    sharePercent: z.number().gt(0, 'share_range').lte(100, 'share_range').nullable(), citizenshipOrCountry: text }).strict())
    .max(MAX_ROWS, 'too_many_rows') }).strict(); // > 2 знаков после запятой — share_precision
  export const shareholdersDataSchema = z.object({ shareholders: z.array(…), sharesTotal: z.number(), sharesTotalIs100: z.boolean() }).strict();
  export function sharesTotal(rows: { sharePercent: number | null }[]): { total: number; is100: boolean }; // в сотых долях, без ошибки float
  export function shareholdersCompleteness(data: ShareholdersData, provenance: Provenance[]): SectionCompleteness;
  // пункты: max(1, n) строк; shareholders_none; shareholder_incomplete {index}; неподтверждённый источник shareholders — field_unconfirmed
  ```
- Produces (обработчики): `contactsHandler` — `normalize`: почта (`email_format`, `normalizeEmail`), телефон (`phone_format`, `normalizePhone`), дубли по приведённым значениям — `duplicate_email` / `duplicate_phone` на втором и следующих (путь `data.contacts.<i>.email`), больше одного focal point — `focal_point_multiple` на втором, роль — `assertSelectable('contact_role')`; `write` — строки редакции заменяются целиком (`position_in_list` по порядку), id строк от клиента не принимаются. `shareholdersHandler` — доли с точностью 0,01, `write` — так же целиком; `sharesTotal` в данных ответа (MAN-22).

- [ ] **Шаг 1. Тесты (сначала).** `section-contacts.integration.test.ts`:
  - «три полных контакта и один focal point — 100 %; два — contacts_too_few {count: 2}; без focal point — focal_point_missing; неполный третий — contact_incomplete {index: 2}; пять контактов, один неполный — 83 % (MAN-13, MAN-14, MAN-41)»;
  - **«дубли по приведённым значениям: '+7 701 111-22-33' и '87011112233' — 400 duplicate_phone по data.contacts.1.phone; 'Info@Demo.local ' и 'info@demo.local' — duplicate_email; ничего не сохранено (MAN-13)»**;
  - «два focal point — 400 focal_point_multiple; роль из справочника регионов — entry_not_selectable; почта 'a@' и телефон '123' — email_format, phone_format (MAN-15)»;
  - «повторное сохранение заменяет строки; порядок — порядок ввода; почта хранится в нижнем регистре, телефон — '+77011112233'»;
  - **«организация B не видит и не меняет контакты A; в diff аудита нет почты, телефона и ФИО (GEN-11, AUD-01)»**.
  `section-shareholders.integration.test.ts`: «одна полная строка — 100 %; ни одной — shareholders_none; неполная — shareholder_incomplete»; «доля 0, 100.01 — share_range, 33.333 — share_precision; 33.33 + 33.33 + 33.33 — sharesTotal 99.99, sharesTotalIs100 false, сохранено (MAN-21, MAN-22)»; «источник shareholders неподтверждён — field_unconfirmed; confirm ['shareholders'] — подтверждено»; «организация B не видит акционеров A». `profile-sections.test.ts`: «contactsCompleteness и shareholdersCompleteness — таблица случаев; sharesTotal(0.1 + 0.2) = 0.3».
- [ ] **Шаг 2.** Прогон — падают.
- [ ] **Шаг 3. Реализация** по Interfaces.
- [ ] **Шаг 4.** Прогон — зелёный; полная проверка.
- [ ] **Шаг 5.** Коммит `Секции «Контакты» и «Акционеры»: не меньше трёх контактов и один focal point, дубли почты и телефона отклоняются, доли и предупреждение о сумме (MAN-13, MAN-14, MAN-15, MAN-21, MAN-22, MAN-41)`.

---

### Task 10: кабинет — обзор профиля, экран секции и форма «Основные сведения» (MAN-09, MAN-10, MAN-11, MAN-40, MAN-41, MAN-46, GEN-11, LANG-01, NFR-15)

**Модель:** `sonnet` · **Независимое ревью:** нет

**Files:**
- Create: `apps/web/src/routes/app/profile-section.tsx` (`ProfileSectionPage`), `profile-section-nav.tsx`, `profile-save-bar.tsx`, `profile-missing.tsx`, `profile-state-badge.tsx`, `profile-provenance.tsx`, `profile-fields.tsx`, `profile-main-form.tsx`, `profile-actions.ts`; `apps/web/src/components/ui/{progress,combobox,item}.tsx` — `pnpm dlx shadcn@4.23.0 add progress combobox item`.
- Modify: `apps/web/src/routes/app/profile.tsx` (обзор вместо карточки только для чтения; `AdataReadCard` остаётся внизу), `apps/web/src/router.tsx` (`profile/:section`, lazy), `apps/web/messages/{en,kk,ru}.json`.
- Test: `apps/web/test/profile.test.tsx` (переписать), `apps/web/test/profile-section.test.tsx` (новый); `messages.test.ts`, `app-shell.test.tsx` (зелёные).

**Interfaces:**
- Consumes: задачи 6, 8 — маршруты, `ownSectionsSchema`, `sectionEnvelopeSchema(mainInformationDataSchema)`, `sectionSaveSchema`, `SECTION_KINDS`, `SECTION_SLUGS`, `sectionKindFromSlug`, `SECTION_STATES`, `PROFILE_LOCKS`, `MISSING_KEYS`, `PROFILE_PROBLEM_CODES`, `SECTION_FIELD_ERRORS`, `mainInformationCompleteness`, `PROVENANCE_FIELDS`; `GET /api/v1/dictionaries/:code/choices` (этап 2).
- Produces (`profile-actions.ts`): `PROFILE_KEY = ['profile'] as const`; `useOwnSections()`; `useSection<D>(kind: SectionKind, schema)`; `useSectionSave(kind)` — PUT, при успехе кладёт конверт в кэш и инвалидирует `['profile', 'sections']`; `PROFILE_PROBLEM_MESSAGES: Record<ProfileProblemCode, …>`, `FIELD_ERROR_MESSAGES: Record<SectionFieldError, …>`; `fieldErrors(problem): Record<string, SectionFieldError | 'invalid'>` (путь `data.x.y` → ключ поля формы). `profile-fields.tsx`: `TextField`, `DateField`, `ChoiceField` (Select по `choices`, текущее выведенное значение — отдельным пунктом с пометкой «выведено из оборота»), `ReadOnlyField` — на `Field`, `FieldLabel`, `FieldDescription`, `FieldError`, обязательность — `*` с `aria-hidden` и `aria-required`. `profile-save-bar.tsx`: `SaveBar({ dirty, saving, savedAt, error, onSave })`. `profile-section.tsx`: `useBlocker(dirty)` → `AlertDialog`.

**Обзор `/profile`** (заголовок вкладки и `h1` — «Профиль компании»), сверху вниз:
1. `Card` шапки: наименование (из «Основных сведений», иначе название организации), БИН (`font-mono`), `Badge` статуса профиля и «Изменения на проверке», у Verified — статус актуальности и тир (как сейчас). Блок полноты — главный акцент страницы (NFR-15): крупное «43 %», `Progress`, подпись «Отправить на проверку можно, когда профиль заполнен на 100 %»; кнопка «Продолжить: <раздел>» (`Link` с `buttonVariants`) — первый доступный раздел с процентом < 100; всё доступное заполнено — кнопки нет.
2. `Alert` по состоянию: `lock` — «Профиль на проверке IMBC. Правка закрыта, пока проверка не закончится» (`submitted`, `under_review`) или «Изменения отправлены на проверку» (`changes_sent`); Verified без блокировки — «Операторы видят проверенные значения. Ваши правки сохраняются отдельно и будут отправлены на проверку отдельно».
3. `Card` «Разделы»: `ItemGroup` из восьми `Item` (образец `item-link`): значок раздела, название, `Badge` состояния, процент («Необязательный» у производства), тонкий `Progress`, шеврон. Недоступный в 3а раздел — без ссылки, приглушён, `Badge` «Скоро» и строка «Откроется в следующем выпуске».
4. `Card` «Чего не хватает» (если в доступных разделах есть пункты): по разделам, ссылка раздела ведёт на `/profile/<slug>#<поле>`; больше пяти пунктов в разделе — «Ещё N» раскрывает остальные.
5. Карточка Adata (как есть) и ссылка на страницу аккаунта.
Состояния: загрузка — `Skeleton` шапки и восьми строк; ошибка — `Alert` с «Повторить»; 404 — `Empty` «Профиль не найден». 390 px: одна колонка, строка раздела — название и статус в первой строке, процент и полоса во второй, кнопка «Продолжить» во всю ширину, без горизонтальной прокрутки.

**Экран секции `/profile/:section`** (заголовок — «<Раздел> — Профиль компании»):
1. Ссылка «← Профиль компании» (`buttonVariants` ghost sm).
2. Навигация по разделам: ≥ 1024 px — липкая колонка слева (восемь разделов: точка состояния, название, процент, текущий выделен, недоступные — неактивны); < 1024 px — `Select` «Раздел» над заголовком с теми же пунктами.
3. Шапка: `h1` раздела, `Badge` состояния, «Заполнено N %» с маленьким `Progress` (пересчитывается по мере ввода той же функцией полноты), «Сохранено <dateTime>» или «Ещё не сохранялся».
4. `Alert`: блокировка (форма только для чтения, поля `disabled`, панели сохранения нет); Verified — как в обзоре; конфликт `409 section_changed` — «Раздел изменили в другом окне. Загрузите сохранённую версию — ваши несохранённые правки будут потеряны» с кнопкой «Загрузить сохранённую»; ошибки поля — «Исправьте полей: N», фокус на первое поле с ошибкой.
5. «Чего не хватает» раздела (свёрнуто «Чего не хватает (N)», раскрывается; пункты — ссылки на поля).
6. Форма (группы `FieldSet` + `FieldLegend`, сетка 2 колонки от 768 px).
7. Панель сохранения — липкая внизу (на 390 px во всю ширину с отступом под системную полосу): «Есть несохранённые изменения» / «Сохраняем…» (`Spinner`) / «Сохранено» / ошибка; кнопка «Сохранить раздел» (неактивна без изменений); `aria-live="polite"` у строки состояния.
8. Внизу — «← Предыдущий раздел» и «Следующий раздел →».
9. Уход со страницы с несохранёнными изменениями — `AlertDialog` «Уйти без сохранения?» [Остаться] [Уйти].
Состояния: загрузка — `Skeleton`; ошибка — `Alert` с повтором; неизвестный адрес — `Empty` «Такого раздела нет» и ссылка на профиль; недоступный в 3а раздел — `Empty` «Раздел откроется в следующем выпуске».

**Форма «Основные сведения»:** 1) «Компания»: «Наименование (как в регистрации)» с подсказкой «Не переводите: как в свидетельстве или реестре»; «Наименование на английском»; «Правовая форма» (`Select`); «БИН» — только чтение, «БИН не меняется. Ошибка в БИН — напишите IMBC»; «Сайт» (необязательный, `type="url"`). 2) «Руководитель и регистрация»: «ФИО руководителя»; «Дата государственной регистрации» (`type="date"`, `max` — сегодня по Алматы). 3) «Виды деятельности (ОКЭД)»: `Combobox` с поиском по `choices` (задержка 300 мс; пункт — «код — название»); выбранные — чипами (`ComboboxChips`, если они есть в `base-nova`; иначе список `Item` с кнопкой «Убрать»), порядок — порядок выбора; подсказка «Начните вводить код или название». 4) «Адреса и связь»: «Регион» (`Select`), «Город», «Юридический адрес», «Адрес производства» («Это другой адрес: где находится производство»), «Телефон компании» (`type="tel"`, плейсхолдер `+7 701 123 45 67`), «Контактная почта компании» (необязательная, «Не логин»), «Логин (почта входа)» — только чтение, «Логин меняет только администратор IMBC». 5) «Единый реестр (e-Ondiris)» — только чтение: «Зарегистрирован: нет данных реестра», «Дата первого включения: —», «Заполняется по данным копии e-Ondiris. Выписку можно будет приложить в следующем выпуске».
Источник значения (`profile-provenance.tsx`) под полем: `Badge variant="outline"` «Adata · <date>» или «e-Ondiris · <date>»; не подтверждено — «Проверьте значение» и кнопка «Подтвердить» (кладёт поле в `confirm` и делает форму изменённой); подтверждено — «Подтверждено»; значение изменено — «В источнике: <исходное>».

Ключи `profile.*` (английский — источник, ru и kk — в том же коммите; тексты выше — русские формулировки): `sections.<kind>` (8), `state.<state>` (7), `lock.<lock>` (3), `missing.<key>` (8), `fields.<field>` (поля «Основных сведений»), `fieldErrors.<code>` (15 + `invalid`), `errors.<code>` (13), `overview.*`, `section.*`, `saveBar.*`, `provenance.*`, `leave.*`, `unavailable`, `continue`. Прежние `profile.readOnlyHint` и `profile.adata.confirmLater` убрать.

- [ ] **Шаг 1. Просмотр компонентов.** MCP shadcn, реестр `@shadcn`: `progress`, `progress-demo`, `item`, `item-link`, `item-group`, `item-icon`, `combobox`, `combobox-demo`, `combobox-popover`, `field`, `field-fieldset`, `field-group`, `field-responsive`, `field-select`, `badge`, `alert`, `alert-dialog`, `empty`, `skeleton`, `select`, `spinner`; `pnpm dlx shadcn@4.23.0 view progress combobox item` — код `base-nova`. Затем `pnpm dlx shadcn@4.23.0 add progress combobox item` из `apps/web`; локальная правка `sidebar.tsx` не задевается.
- [ ] **Шаг 2. Тесты (сначала)**, заглушки `api`. `profile.test.tsx`:
  - «обзор: восемь разделов по порядку с состоянием и процентом; production — «Необязательный»; недоступные — «Скоро» без ссылки; профиль 43 %; «Продолжить» ведёт на первый неполный доступный раздел (MAN-41, MAN-46)»;
  - «чего не хватает: пункты по разделам со ссылками /profile/main-information#legal-address»;
  - «блокировка submitted — Alert и нет «Продолжить»; Verified — пояснение о проверенных значениях»;
  - «загрузка — скелет; ошибка — повтор; 404 — «Профиль не найден»»; «тексты на kk и en».
  `profile-section.test.tsx`:
  - «неизвестный адрес — «Такого раздела нет»; недоступный раздел — «Откроется в следующем выпуске»»;
  - «сохранение: PUT с editVersion и data; успех — «Сохранено», обзор перечитан; без изменений кнопка неактивна»;
  - **«409 section_changed — Alert и «Загрузить сохранённую» сбрасывает форму к ответу сервера»**;
  - «400: ошибки у полей по путям data.companyPhone → «Телефон компании», фокус на первое; неизвестный код — общий текст»;
  - «уход с несохранёнными изменениями — диалог; «Остаться» оставляет, «Уйти» уходит»;
  - «блокировка — поля disabled, панели сохранения нет»;
  - «Основные сведения: БИН и логин только для чтения; ОКЭД — поиск один запрос через 300 мс, выбор добавляет чип, «Убрать» удаляет; код '01110' отображается и уходит строкой (DATA-03); регион и правовая форма из choices; выведенное текущее значение показано с пометкой»;
  - «источник: «Adata · дата», «Подтвердить» делает форму изменённой и шлёт confirm ['legal_address']; полнота в шапке растёт после подтверждения»;
  - «навигация: Select разделов на узком экране меняет адрес; «Следующий раздел» пропускает недоступные»;
  - «каждый код PROFILE_PROBLEM_CODES и SECTION_FIELD_ERRORS переведён; тексты на kk и en; меню, Combobox, Select и диалог доступны с клавиатуры».
- [ ] **Шаг 3.** `pnpm --filter @imbc/web test -- profile` — падают.
- [ ] **Шаг 4. Реализация** по описанию экранов и Interfaces; переводы.
- [ ] **Шаг 5.** Прогон — зелёный; полная проверка.
- [ ] **Шаг 6. Браузер** (если контроллер поднял локальный стенд) — `/profile` и `/profile/main-information` под `manufacturer@demo.local` и новым зарегистрированным производителем на 1280 и 390 px; снимки — в отчёт. Без стенда — «в браузере не проверено».
- [ ] **Шаг 7.** Коммит `Кабинет производителя: обзор профиля с полнотой и чего не хватает, экран раздела с навигацией и сохранением, форма «Основные сведения» с источником значения; kk, ru, en, 390 px (MAN-09, MAN-10, MAN-11, MAN-40, MAN-41, MAN-46)`.

---

### Task 11: кабинет — формы «Контакты» и «Акционеры» (MAN-13, MAN-14, MAN-15, MAN-21, MAN-22, LANG-01)

**Модель:** `sonnet` · **Независимое ревью:** нет

**Files:**
- Create: `apps/web/src/routes/app/profile-contacts-form.tsx`, `profile-shareholders-form.tsx`; `apps/web/src/components/ui/radio-group.tsx` — `pnpm dlx shadcn@4.23.0 add radio-group`.
- Modify: `apps/web/src/routes/app/profile-section.tsx` (две формы), `apps/web/messages/{en,kk,ru}.json`.
- Test: `apps/web/test/profile-section.test.tsx`.

**Interfaces:**
- Consumes: задача 9 — `contactsDataSchema`, `contactsInputSchema`, `contactsCompleteness`, `shareholdersDataSchema`, `shareholdersCompleteness`, `sharesTotal`, `normalizePhone`, `normalizeEmail`; задача 10 — `useSection`, `useSectionSave`, `SaveBar`, `profile-fields.tsx`, `fieldErrors`.
- Produces: `ContactsForm`, `ShareholdersForm` (свойства как у `MainInformationForm`).

**Форма «Контакты»:** вверху — пояснение «Не меньше трёх контактов. Один из них — контактное лицо (focal point): через него IMBC и операторы связываются с компанией в первую очередь. Почта и телефон не повторяются» и счётчик «Контактов: 2 — нужно не меньше 3». Каждый контакт — `fieldset` с легендой «Контакт 1»: «ФИО», «Должность», «Почта» (`type="email"`), «Телефон» (`type="tel"`), «Роль» (`Select` из `contact_role`), переключатель «Контактное лицо (focal point)» (`RadioGroup` на всю форму: одно значение — ключ строки), кнопка «Удалить контакт» (ghost; удаление focal point снимает отметку). Кнопка «Добавить контакт». Дубль почты или телефона подсвечивается сразу, до отправки (по `normalizeEmail` / `normalizePhone`), и сервером — у поля. 390 px: поля контакта в одну колонку, кнопка удаления — в строке легенды.

**Форма «Акционеры»:** строки: «Наименование или ФИО», «Доля, %» (`type="text"`, `inputMode="decimal"`, принимает `,` и `.`), «Гражданство или страна регистрации»; «Удалить», «Добавить акционера». Под строками — «Итого: 99,99 %» (`format.number`); сумма ≠ 100 — `Alert` «Сумма долей не равна 100 %. Отправке это не мешает» (MAN-22). Источник `shareholders` — одна отметка над списком (как в задаче 10). Пусто — `Empty` «Акционеров пока нет» и «Добавить акционера».

- [ ] **Шаг 1. Просмотр компонентов.** MCP shadcn: `radio-group`, `radio-group-demo`, `field-radio`, `field-choice-card`, `field-fieldset`, `input`, `empty`; `pnpm dlx shadcn@4.23.0 view radio-group`; затем `pnpm dlx shadcn@4.23.0 add radio-group`.
- [ ] **Шаг 2. Тесты (сначала)** в `profile-section.test.tsx`:
  - «контакты: добавить, удалить, выбрать focal point — один на форму; PUT с contacts в порядке ввода; счётчик и пункты полноты (MAN-13, MAN-14)»;
  - **«дубль телефона '+7 701 111-22-33' и '87011112233' подсвечен до отправки; 400 duplicate_email по data.contacts.1.email — у поля второго контакта»**;
  - «акционеры: '33,33' уходит числом 33.33; итог «99,99 %» на ru и «99.99%» на en через format.number; предупреждение не блокирует сохранение (MAN-21, MAN-22)»;
  - «пусто — Empty с кнопкой; удаление последней строки — снова Empty»;
  - «тексты на kk и en; RadioGroup и кнопки доступны с клавиатуры».
- [ ] **Шаг 3.** Прогон — падают.
- [ ] **Шаг 4. Реализация**; переводы.
- [ ] **Шаг 5.** Прогон — зелёный; полная проверка.
- [ ] **Шаг 6. Браузер** — обе формы на 1280 и 390 px, клавиатура, kk; снимки — в отчёт.
- [ ] **Шаг 7.** Коммит `Кабинет производителя: формы «Контакты» и «Акционеры» — focal point, дубли до отправки, доли с запятой и предупреждение о сумме; kk, ru, en, 390 px (MAN-13, MAN-14, MAN-15, MAN-21, MAN-22)`.

---

### Task 12: документы части и приёмочный сценарий (ACC-01, NFR-06)

**Модель:** `sonnet` · **Независимое ревью:** нет

**Files:**
- Modify: `README.md` — §1 (профиль на модели DBML, маршруты `/profiles/own`), §4 (строка Profile: таблицы DBML, требования, маршруты), §6 (`0011`–`0015`, представление `manufacturer_profiles`, триггеры неизменяемости, права роли), §7 (подразделы «Профиль: секции», «Файл» — вложенные пакеты, PDF, пароль, причина отказа, пределы загрузок; инструмент `check-upload`), §13 (`UPLOAD_CONCURRENCY`, `UPLOAD_CONCURRENCY_PER_ACCOUNT`), §14 (строка прогона с числами из вывода).
- Modify: `docs/development-roadmap.md` — §2 и «Этап 3» (состояние части 3а, ссылка на карту этапа; список «Перед открытием загрузок производителю» — что закрыто), §9 (вопросы 57–67 — ссылка на файл вопросов); раздел 11 не трогать.
- Modify: `docs/handoff/2026-11-11-context.md` — §4, §6 (схема: новые таблицы, представление), §10 (новые ключи `kk`: `profile.*`, `references.errors.file_encrypted|file_too_complex|file_has_attachments|upload_busy|upload_parallel_limit`, `references.sample.rejected.*`), §13 (закрытые пункты и что осталось — вход в часть 3б); `docs/handoff/2026-11-12-questions-for-abay.md` — раздел «Профиль производителя (этап 3)»: вопросы 57–67 (ниже), ответ по умолчанию на вопросы 6 и 54.
- Modify: `docs/deployment/azure-dev.md` — новый раздел «Профиль: основа (этап 3а)»: **до выката** — R1 выкачен и проверен; проверка скелета (`select count(*) from section_revisions where data <> '{}'::jsonb` и семь таблиц — нули); `pg_dump` `backup-before-stage3a.dump`; прогон `check-upload` на корпусе — результат в запись проверки; **что делает выкат** — `0012`–`0015`, новый `clamd.conf` (ClamAV пересоздаётся), переменные `UPLOAD_*` по умолчанию; **проверки после** — `select count(*) from profile_section` = `8 × select count(*) from manufacturer_profile`; `\dv manufacturer_profiles`; триггеры (`select tgname from pg_trigger where tgname like 'section_%'` — по таблицам); права (`has_table_privilege('imbc_app', 'section_revision', 'DELETE')` — `f`); `clamconf | grep -E 'AlertEncrypted(Doc|Archive)'`; **откат** — кодом на R1 без восстановления (R1 пишет через представление; новые таблицы остаются); **посмотреть при первом выкате** — вход демо-производителя, сохранение раздела, PDF с паролем в образце оргструктуры.

**Interfaces:**
- Consumes: всё выше; числа тестов — из вывода последних прогонов.
- Produces: вопросы Абаю и владельцу 57–67:
  57. Документы под паролем (к вопросу 54): отклоняем те, что без пароля не открыть (DOCX/XLSX — сразу, PDF — антивирусом); PDF только с паролем прав принимаем. Верно?
  58. PDF с вложенными файлами отклоняются при загрузке с подсказкой. Допустимо?
  59. Вложенные документы (Excel в Word): до двух уровней вложения, до 32 документов и 64 МБ распакованных данных, сверх — отказ «слишком сложный файл». Пределы подходят?
  60. DATA-01 для черновика: история сохранений до отправки не хранится — аудит пишет, какие поля изменены, без значений; прежние значения хранятся в отправленных редакциях. Достаточно?
  61. MAN-09 — одно наименование, DBML — `name_en` и `name_ru`, DATA-09 выгружает оба. Наименование на английском обязательно для отправки?
  62. Формат телефона (MAN-15): «+» и 10–15 цифр, `8XXXXXXXXXX` приводится к `+7XXXXXXXXXX`, совпадение контактов — по приведённому номеру. Подходит? Иностранные номера допустимы?
  63. MAN-12: «зарегистрирован в Едином реестре» ставит только платформа по копии e-Ondiris, производитель не меняет. Верно?
  64. MAN-04: SME и директор видят черновик и его файлы (сохранённые в разделе) или только отправленное?
  65. Верифицированный профиль с отправленными изменениями закрыт для правки до решения SME (как в прототипе)?
  66. Гражданство или страна регистрации акционера (MAN-21) — свободный текст или справочник стран?
  67. Полнота раздела (MAN-41): каждое обязательное поле — равный вес; «Контакты» — три контакта и focal point, больше контактов — больше пунктов; «Акционеры» — по строкам. Подходит?

- [ ] **Шаг 1.** Документы по Files; `pnpm check:requirements`; `node --test scripts/check-requirements.test.mjs`.
- [ ] **Шаг 2.** Полная проверка (Global Constraints) на последнем коммите; числа тестов — в README §14.
- [ ] **Шаг 3.** Коммит `Документы части 3а: основа профиля, приём файлов, runbook выката, вопросы 57–67 (ACC-01, NFR-06)`.

---

## Чего часть не делает

- Загрузка файлов производителем и секции с файлами — «Персонал» (оргструктура, CV, ссылка на образец `/api/v1/org-chart-sample/current/content`), «Продукты», «Производство», «Сертификаты», «Документы», выписка e-Ondiris в «Основных сведениях», история версий (MAN-36), очистка несохранённых файлов — часть 3б.
- Отправка, подтверждение достоверности, снимок обязательных типов (`submission_requirement`, ADM-09), разблокировка, возврат с комментарием, pending changes, тестовая команда решений SME, сквозной сценарий в браузере, contract этапа 3 (скелет профиля, представление `manufacturer_profiles`, типы `profile_section`, `document_status`, `contact_role`, `value_source`, значение `superseded`) — часть 3в.
- Значения из e-Ondiris и Adata в разделах, MAN-12, линии из реестра (этап 4б); письма NOT-04, NOT-10 (этап 5); чтение профиля SME и директором через интерфейс (этап 5), оператором и наблюдателем (этап 6).

## Приёмка

Roadmap, этап 3 (для части 3а): «Производитель заполняет профиль… видит, чего не хватает… Аккаунт одной компании не читает и не меняет профиль другой ни через интерфейс, ни через API. Отправленная редакция не изменяется. Загрузка файлов производителю не открывается, пока не закрыты пункты списка «Перед открытием загрузок производителю»».

**Автоматически** (тесты названы поимённо): «0011 переносит письмо…» и «строка в … — миграция падает…» (1); «вложенный XLSX с ZIP64…», «encrypted.docx — 415 file_encrypted…» (2); «PDF с вложением…», «скан с сигнатурой Heuristics.Encrypted.PDF…» (3); «вторая загрузка при занятом месте…», «оборванная клиентом загрузка…» (4); «запросы предыдущей версии (R1)…», «составные ключи…», «замороженная редакция неизменна…» (5); «профиль, созданный предыдущей версией…», «аккаунт другой организации видит только свой профиль…», «параллельные сохранения…», «assertSelectable…» (6); «производитель читает свой файл…», «значение, использованное в профиле, удалить нельзя…» (7); «частичное сохранение…», «организация B не видит…» (8, 9); «дубли по приведённым значениям…» (9); «409 section_changed…» (10); зелёные проверки Global Constraints.

**На стенде** — только по команде владельца, R1 и R2 отдельными выкатами по runbook. Входы демо-ролей — код `000000`; новые адреса — `*.local`, письма — в Mailpit. Результат — `docs/deployment/verification-<дата>.md`.
0. **R1** — runbook «Релиз contract этапа 2 (0011)» целиком; одна блокировка входа — одно письмо NOT-03.
1. **R2, до выката** — runbook «Профиль: основа (этап 3а)», включая корпус `check-upload`.
2. **Новый производитель:** регистрация `stage3-maker@demo.local` (на Azure учесть квоту Adata: предел стенда — runbook, «Чтение Adata») → установка пароля → `/profile`: восемь разделов, 0 %, «Продолжить: Основные сведения». Заполнить «Основные сведения» частично → сохранить → выйти и войти → значения на месте, «Сохранено …»; заполнить всё → 100 % у раздела. «Контакты»: два контакта → «нужно не меньше 3»; третий с тем же телефоном в другой записи → ошибка у поля; исправить, отметить focal point → 100 %. «Акционеры»: 33,33 × 3 → «Итого 99,99 %» и предупреждение, сохранение проходит. Профиль — 42 % (три раздела из семи), остальные разделы «Скоро». Телефон 390 px — без горизонтальной прокрутки, панель сохранения у нижнего края.
3. **Демо-производитель** `manufacturer@demo.local`: в «Основных сведениях» — «Adata · …» и «e-Ondiris · …» у двух адресов, «Подтвердить» → полнота растёт (значения демонстрационные).
4. **Два окна:** один раздел в двух вкладках, сохранить в первой, затем во второй → «Раздел изменили в другом окне».
5. **Чужой профиль:** под производителем A — `GET /api/v1/profiles/own/sections/contacts` возвращает только A; id файла профиля B в `/api/v1/files/<id>/content` — 403, в аудите `file.read` `denied`.
6. **Блокировка:** профиль демо-организации переводится SQL-ем в `submitted` (только на локальном стенде) → разделы только для чтения, `PUT` — 409.
7. **Файлы:** образец оргструктуры (администратор) — PDF с паролем → «Не прошёл проверку: файл защищён паролем»; DOCX под паролем → отказ при загрузке; PDF с вложением → отказ при загрузке.

**Что нужно от владельца и IMBC:** слово на выкат R1, затем R2; ответы на вопросы 57–67; корпус настоящих документов производителей (Word, Excel, PDF из их систем) для проверки на ложные отказы; вычитка новых казахских текстов (LANG-03).

## Pre-flight: общие файлы и интерфейсы задач

| Пара | Общее | Производит → потребляет |
|---|---|---|
| 1 → 2–12 | номер миграции и имя типа `scan_state` | 1: `0011`, `scanState`; 3 генерирует `0012` поверх снимка `0011` |
| 1 ↔ ветка стенда | коммит задачи 1 — отдельная поставка R1 | слияние в ветку стенда только этого коммита; конфликт `migrate.ts` — как в этапе 2 (миграции → таблица прототипа → права → `release`) |
| 2 → 3 | `upload.ts` (`inspectFile`, `InspectRefusal`), `zip-structure.ts` (`InflateBudget`) | 3 добавляет `file_has_attachments` и PDF |
| 2, 3, 4 → web | `FILE_PROBLEM_CODES`, `references-actions.ts`, `messages/*.json` | каждая задача переводит свои коды: тест «каждый код переведён» |
| 3 ↔ 1 | `schema/files.ts`, `enums.ts` | 1 переименовал тип; 3 добавляет `file_rejection_reason` |
| 5 → 6–9 | таблицы, `SECTION_KINDS`, `PROVENANCE_FIELDS`, триггеры | 6: `ensureSections` повторяет `0015` (2)–(3); copy-on-write знает 14 таблиц содержимого и `section_field_source` |
| 5 ↔ этапы 1–2 | переименование `manufacturerProfiles` → `manufacturerProfile` | `seed.ts`, `onboarding.service.ts`, `adata.scheduler.ts`, `reviews.service.ts`, `recipients.ts`, тесты |
| 6 → 8, 9 | `SectionHandler`, `SECTION_HANDLERS`, `assertSelectable`, `sectionValidation`, нормализаторы | 8, 9 регистрируют обработчики в `app.module.ts` |
| 6 → 10, 11 | маршруты, `ownSectionsSchema`, `sectionEnvelopeSchema`, `sectionSaveSchema`, коды | web строит конверты схемами contracts |
| 7 ↔ 5 | `FILE_OWNER_LINKS` — те же колонки, что ссылки на `file_object` в `0014` | 3б использует при загрузке и привязке |
| 8 → 9, 10 | образец обработчика, `dictionaryRefSchema`, `mainInformation*` | 9 повторяет приёмы; 10 — форма |
| 10 → 11 | `profile-section.tsx`, `profile-fields.tsx`, `SaveBar`, `fieldErrors` | 11 добавляет две формы |
| 1–11 → 12 | документы | README, roadmap, handoff, вопросы — в 12; runbook R1 — в 1 |

## Self-review

- **Покрытие.** GEN-11 — маршруты `own`, тесты двух организаций (6, 8, 9), файлы (7); MAN-04 — Draft вне проекции (6), файлы черновика для IMBC (7); MAN-09–MAN-11 — секция (8), форма (10); MAN-13–MAN-15 — секция (9), форма (11), форматы (6, 8, 9); MAN-21, MAN-22 — (9, 11); MAN-40 — частичное сохранение (6, 8); MAN-41 — функции полноты (6, 8, 9), экран (10); MAN-43 — блокировка правки (6), переходы — 3в; MAN-46 — состояние секции (6, 10), документы и сертификаты — 3б; DATA-01 — триггеры (5), copy-on-write (6); DATA-02–DATA-04 — (5, 6, 7, 8); MAN-06–MAN-08 — хранение источника и подтверждение (5, 8), значения — 4б; MAN-12 — только чтение (8, 10), 4б. Остатки этапа 2: contract (1), вложенные архивы и записи вне каталога (2), пароль и вложения PDF (2, 3), память (4), внешние ключи справочников (5, 7), правило чтения по записи-владельцу (7).
- **Согласованность имён.** `SECTION_KINDS`, `PROVENANCE_FIELDS` (5) → 6, 8, 9, 10; `ensureSections`, `workingRevisionForEdit`, `copyRevisionContent`, `assertSelectable`, `SectionHandler`, `SECTION_HANDLERS`, `sectionValidation`, `profileLock`, `deriveSectionState`, `percentOf`, `profilePercent` (6) → 8, 9, 10; `inspectFile`, `InspectRefusal`, `InflateBudget` (2) → 3; `FILE_REJECTION_REASONS` (3) → web; `UploadSlots`, `UPLOAD_SLOTS` (4); `FILE_OWNER_LINKS`, `fileOwnerRevisions` (7) → 3б; `manufacturerProfile` (5) — по всему коду.
- **Review Focus.** Пять пунктов — тесты в задачах 6, 8, 10 (два окна), 9, 11 (дубли), 6, 8 (справочники), 8 (частичное сохранение), 4 (загрузки).
- **Пропорция.** Код дан там, где сигнатура и тест его не определяют: схемы контрактов, порядок `0011`, правила триггеров, таблица колонок с отступлениями, правила нормализации и полноты; остальное — сигнатуры, таблицы маршрутов, имена тестов и описание экранов.
- **Открытые вопросы и поведение до ответа:** 6 — `section_field_source` (расхождение 12); 7 — `product_line.note` (отступления); 8 — процент полноты показывается (MAN-41), подсказки к полям — тексты LANG, учредительные документы по типу компании — 3б; 54, 57 — пароль (4); 58 — вложения PDF (5); 59 — пределы вложений (2); 60 — история черновика (11); 61 — наименование на английском (13); 62 — телефон (15); 63 — MAN-12 (14); 64 — файлы черновика для IMBC (21); 65 — блокировка Verified с отправкой (19); 66 — гражданство (17); 67 — веса полноты (18).
