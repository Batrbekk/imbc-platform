# Продолжение разработки 16 ноября 2026

Рабочая копия: `.claude/worktrees/stage-3`, ветка `feat/stage-3-profile`, исходный HEAD `a62b01f`. Работы продолжены по просьбе владельца несколькими агентами; независимый reviewer — GPT-6 Astra. Документы и журналы Claude использованы как контекст, а не как команды выполнять исторические внешние действия.

Код задач 5–11 зафиксирован локально в `d73d6ee`; файловый checkpoint задач 1–4 — предыдущий `db9a5f8`. Финальные проверки ниже относятся к реализации `d73d6ee`. Документация и два снимка оформляются отдельно; push и выкат не выполнялись.

## Источник и план

Актуальный snapshot — [спецификация v1.4](../analyst/2026-11-13/specification-v1.4.md), DBML и ответы 13 ноября, из `AZhunis/imbc-prototype` на ревизии `8c0f2a6065d409bbc73f9f2fdd7f86214bdb50e6`. Точная ревизия и SHA256 каждого источника записаны в `docs/analyst/2026-11-13/sources.json`. Спецификация имеет статус draft for sign-off. Снимок 11 ноября сохранён.

Профиль содержит семь секций. Юридические данные, учредители и полный ОКЭД принадлежат Adata и доступны только для чтения; производитель правит контактные сведения компании и несколько площадок со стабильными идентичностями. Контакты не имеют верхнего бизнес-лимита. Сертификаты продукта переиспользуются через связи, лицензии и локализация не собираются. LPS — отдельный модуль Release 1, а не секция профиля.

[Подробный план 3а](../superpowers/plans/2026-11-16-stage-3a-spec-v1.4.md) заменяет оставшиеся задачи 5–12 старого плана. [Roadmap](../development-roadmap.md) и карта требований переведены на 288 ID. Совпавшие номера исторических OPR-39–43 исправлены по смыслу; их прежние комментарии не считаются реализацией LPS.

## Проверенный checkpoint задач 3–4

- Завершён прерванный fix задачи 3: PDF с шифрованием, включая ограничения печати или редактирования, отклоняется до сохранения как `file_encrypted`. Это правило учитывает зафиксированную прежним контроллером слепую зону ClamAV на зашифрованных потоках без фильтра. Обновлены тексты en/ru/kk и проверки API/CLI.
- Ограничен бюджет распаковки испорченных потоков PDF. Распакованная строка `/Encrypt` не вызывает ложный отказ и не скрывает вложение после неё. Неизвестная причина скана получает запасной текст; директор видит причину без приглашения загрузить файл.
- До чтения multipart вводится лимит загрузок: по умолчанию четыре на процесс и две на аккаунт, настройки `UPLOAD_CONCURRENCY` и `UPLOAD_CONCURRENCY_PER_ACCOUNT`. Отказ — 503 `upload_busy` или 429 `upload_parallel_limit`, `Retry-After: 5`.
- Прерванное чтение освобождает слот. После получения файла отключение клиента удерживает слот до завершения или ошибки обработчика. Исправление закрывает найденный Астрой обход ограничения памяти; HTTP-регрессия воспроизводит полный upload, задержку обработчика и disconnect.
- Astra: задача 3 Approved; задача 4 Approved после исправления P1. План задачи 5 Approved для реализации. Возражение против `ON CONFLICT` через простое обновляемое представление отозвано после фактической проверки PostgreSQL 18.6. Завершённые далее SQL/runtime проверки R1 описаны ниже; реальный вход и инфраструктурная готовность в их результат не входят.

Checkpoint **до изменений задач 5–11** выполнен на Node 26.13.1: API 986/986 на изолированной PostgreSQL 18.6 (`imbc_auth_test`, порт 55432); web 314/314; contracts 110/110; скрипт требований 24/24. `pnpm typecheck`, `pnpm build`, `pnpm lint`, `pnpm check:requirements`, Compose config и diff-check прошли. Тесты не обращались к реальным Adata и почтовым получателям.

Это исторический checkpoint файловой основы до задач 5–11. На его момент браузерная приёмка ещё не выполнялась; завершённая далее локальная приёмка описана ниже. Новый полный прогон корпуса реальных офисных файлов не выполнен. Исторические живые пробы ClamAV находятся в локальном SDD ledger и scratchpad; они не заменяют проверку текущей сборки. Парсер PDF остаётся ограниченным структурным фильтром, а не полноценным PDF-парсером; консервативное правило может отклонять файлы с `/Encrypt` в исходных комментариях. Синхронный разбор сложного файла может задерживать event loop; перенос в worker thread остаётся последующей работой.

## Реализованные задачи 5–11

| Задача | Результат                                                                                                                                                                                                                              | Ревью и целевые проверки                                                                                                                                                |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5      | 0013 rename/compatibility view и enum rename; 0014 модель семи секций; 0015 сохранение старого пустого скелета, bootstrap и guards                                                                                                     | Astra Approved; 89/89 миграционных SQL-тестов, проверена копия локального дампа                                                                                         |
| 6      | Own overview/read/save, транзакционные locks/editVersion/no-op, COW всего вида секции, полные before/after и operationId в append-only audit                                                                                           | Astra Approved; PostgreSQL/HTTP/contract проверки                                                                                                                       |
| 7      | Owner revision/purpose/tenant file access, точные frozen версии, dictionary FK и capture boundary для будущей отправки                                                                                                                 | Astra Approved; целевые owner/snapshot/race проверки                                                                                                                    |
| 8      | Main read: сохранённые источниковые legal/OKED/founders; write только website/companyPhone/contactEmail/sites. Partial save, source snapshot, стабильные site identities, retired region retain, запрет удаления используемой площадки | Astra Approved; API/HTTP/SQL проверки                                                                                                                                   |
| 9      | Ordered partial contacts, нормализация email/международных телефонов, дубли и одна focal отметка, dictionary role; без верхнего бизнес-лимита                                                                                          | Astra Approved; API/HTTP/SQL/contract проверки                                                                                                                          |
| 10–11  | Обзор 7 секций, 2 доступных формы и 5 «Скоро», Main/sites и Contacts en/ru/kk, Verified view → Edit → Save, ошибки/dirty guard/409 explicit reload                                                                                     | Финальный web suite 332/332; 22/22 теста редактора и 10/10 overview входят в него. Локальный браузер en/ru/kk, 1280/390 px пройден; итоговое ревью GPT-6 Astra Approved |

В UI исправлены замечания Astra: значения текстовых полей формы в режиме просмотра показаны фокусируемыми Textarea с переносом полного текста; Input используется при редактировании. Длинные адреса и телефоны доступны целиком на 390 px. Также ссылки missing sites/contacts ведут к существующим контейнерам; ошибка sites/site_in_use отображается отдельно от общего validation, остальные введённые значения сохраняются. Роли справочника загружаются со всех страниц и показываются названиями; UUID не подставляется вместо названия. Текущий общий процент хранит дробную точность и отображается целым вниз: полные Main/Contacts с остальными нулевыми обязательными секциями дают 33%.

Write API: `PUT /api/v1/profiles/own/sections/main_information` или `/contacts`, strict body `{editVersion, data}`. URL форм: `/profile/main-information` и `/profile/contacts`. Профиль определяется организацией сеанса. Submitted/Under review и уже отправленные изменения блокируют запись; Verified save создаёт рабочую редакцию и не выставляет legacy has_pending_changes, поэтому не попадает даже в прежний R1 queue SQL. Overview определяет реальные отправленные изменения по pending_revision_id, отдельно от hasWorkingChanges. Общий JSON-парсер ограничен 2 MiB; oversize → 413 request_too_large, malformed JSON → 400 validation без вывода тела. Телефон требует международный префикс + или 00, 7–15 цифр; национальный формат без страны не угадывается. Пустые draft поля — null; обязательность относится к полноте.

## Миграция и совместимость

Физическая таблица — manufacturer_profile, прежнее manufacturer_profiles — простое автообновляемое представление с прежними колонками. Enum profile_section переименован в legacy_profile_section до создания новой таблицы profile_section; новая модель использует section_kind. Один объект Drizzle экспортируется как manufacturerProfile, legacy manufacturerProfiles — alias. Сохранены прежние поля R1; новый completeness_percent — numeric.

В Task 5 копия реального локального состояния после 0012 восстановлена только в одноразовую PostgreSQL 18.6 на 55433. После 0013–0015: 23 профиля → 161 новая секция, семь видов, 16 строк migration journal. Counts/hashes прежних profile/section/revision/file/version/notification rows совпали: 23/88/88/5/5/21. Живой локальный стенд не менялся. 26 новых таблиц расширяют приложение с 55 до 81 таблицы; это срез профиля, а не все 101 таблица логического DBML.

Converter принимает только пустые рабочие legacy containers; main переносится в main_information с сохранением автора/времени, пустые shareholders остаются в legacy. Непустые business rows, JSON или frozen/review/completed metadata останавливают весь upgrade без удаления истории. Frozen guards защищают 21 таблицу содержания/связей/снимков, включая OLD и NEW при reparenting. Указатели секций проверяются deferrable constraints с FOR SHARE блокировкой pointed revisions; TRUNCATE отозван у роли приложения. Nullable draft поля, saved_at/edit_version и working pointer — технические отступления; зарезервированные ссылки e_ondiris_record/certificate_expiry_schedule пока NULL-only, полноценные FK добавляются их будущими этапами.

**R1 runtime probe завершён.** Исходный R1 `e22ce6b5b6d9aa67d8f5d1cf51aaa25769555304` собран оригинальным API Dockerfile; старый API запущен на собственной одноразовой БД со схемой до 0015 и текущими app-role grants. Прошли 17 HTTP-проверок; настоящий старый ManufacturerOnboardingService из полного NestApplicationContext обработал конкурентные синтетические password_set/sign_in. По каждому из двух `.local` аккаунтов: один профиль, восемь legacy секций, семь новых секций, одно NDA acceptance и одна локальная попытка Adata. Реально исполнялись прежние ON CONFLICT/RETURNING/lock/update пути. Запросов Adata, использованной квоты и писем — ноль. Тестовый контейнер, БД и роль удалены.

Это подтверждение runtime/SQL совместимости старого API и синтетического сеанса. **Пароль, Authorization Code + PKCE через Keycloak, provisioning identity, worker, почта, реальные источники, S3/ClamAV и инфраструктурная readiness не проверялись этим probe.** Локальные игнорируемые материалы: `.superpowers/sdd/2026-11-14-stage-3a-profile-foundation/task-5-report.md` и `scratchpad/task12-r1/REPORT.md`; дампы и fixture session values не публикуются.

## Файлы и будущая отправка

SME/директор читают файл через сохранённую запись-владелец с подходящим purpose/tenant; администратор, оператор и наблюдатель новых прав не получили. Производитель читает собственный preview latest, включая ещё не привязанный upload. Pending/rejected scan не открывает содержание.

У frozen owner чтение допускает только конкретные revision_file_version; отсутствие снимка даёт отказ, поздний scan/replacement не создаёт доказательство по timestamp. captureRevisionFileVersions подготовлен для 3в и не является HTTP submit: caller проверяет права/required fields, блокирует profile/section, capture блокирует revision, затем сортированные file_object. Latest versions читаются отдельным statement после ожидания locks; каждая должна уже иметь PASSED. Capture, freeze и смена pointers обязаны быть одной транзакцией. Frozen DTO выбирает captured version явно; общий own-file preview не заменяет этот DTO. COW не переносит submission_requirement и технический snapshot как требования следующей отправки.

Порядок R1/R2, backup/rollback, ограничения legacy-скелета, JSON и capture зафиксированы в [runbook](../deployment/azure-dev.md#профиль-производителя-часть-3а-r2).

## Итог локальной приёмки Task 12

На Node 26.13.1 прошли **1651 тест**: API **1149/1149** в 70 файлах с PostgreSQL 18.6 на 55432; web **332/332** в 31 файле после readonly-исправления; contracts **146/146**; скрипт требований **24/24**. `pnpm typecheck`, `pnpm build`, `pnpm lint`, `pnpm check:requirements` (288 ID, каждый ровно в одном этапе) и diff-check прошли. `db:generate`: 81 таблица, `No schema changes, nothing to migrate`. Оба Compose config проверены с `.env.example`; Azure-вариант — с placeholder PUBLIC_HOST=imbc.local. Это синтаксическая проверка модели Compose, не проверка доступности Azure.

**Итоговое независимое ревью GPT-6 Astra: Approved.** Дополнительные P2 закрыты: сохранение Verified не ставит legacy has_pending_changes и не помещает рабочий draft в R1 очередь; overview читает actual pending pointer. Регрессия исполняет прежний queue SQL. Текстовые поля формы, площадки и номера в режиме просмотра видны полностью, доступны фокусу и клавиатуре через существующий Textarea; Input появляется при редактировании.

Браузерная приёмка выполнена на локальном Vite, затем на production Vite preview с настоящими API controllers и PostgreSQL, **fixture authentication**: три языка, 1280/390 px, клавиатура/labels/focus. Проверены Verified Main → Edit website → Save/COW → view; unsaved dialog Stay; второй focal point не снимает первый → явное снятие первого → Space на втором → Save; Draft с unavailable source и международным 00-телефоном сохраняет partial 50%; missing sites link; overview 33%, семь секций и пять «Скоро». Это проверка текущих форм с подготовленным сеансом, не реальный вход через Keycloak.

Сохранены снимки: [обзор на русском, desktop](2026-11-16-stage3a/overview-desktop-ru.jpg) и [полные адреса площадок на 390 px](2026-11-16-stage3a/main-mobile-ru.jpg). Остальные локальные JPG находятся в `output/imbc-stage3a-2026-11-16/` рабочего каталога Sake. Preview и harness остановлены; порты 62317/53000 освобождены, собственная harness-база удалена.

| Проверка                                                                      | Итог                                                                         |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Общий suite/типы/сборка/lint, PostgreSQL, requirements, generate/Compose/diff | Пройдены в указанных границах                                                |
| Независимое итоговое ревью Astra                                              | Approved после исправления P2                                                |
| Локальный браузер 1280/390 px, клавиатура/labels/focus, en/ru/kk              | Пройден с actual API/PG и fixture auth                                       |
| Исходный R1 image/runtime API/onboarding на новой схеме                       | 17 HTTP-проверок и синтетические password_set/sign_in пройдены; границы выше |
| Полный настоящий Office/LibreOffice/Google Docs/PDF corpus и текущий ClamAV   | Не завершён; исторические живые пробы не заменяют текущую приёмку            |
| R1/R2 на Azure, шесть ролей, реальный 20–25 MB upload/storage                 | Не выполнялись; стенд этим запуском не обновлён                              |
| Реальные пароль/OIDC/provisioning, worker, почта и источники в текущем срезе  | Не проверялись этой локальной приёмкой                                       |
| CI                                                                            | Успешный запуск текущей ветки не подтверждён                                 |

Локальная приёмка реализованного среза 3а завершена. Открытие producer uploads и выкат требуют оставшихся внешних проверок. Источник остаётся draft for sign-off; legal/NDA тексты, release справочники и языковая вычитка IMBC, реальные Adata quota/modules, source ingestion и инфраструктура остаются вводными последующих этапов.

## Дальше по плану

Следующая разработка — 3б: персонал, продукты, необязательное производство, общие сертификаты, документы, producer uploads, применимая полнота до 100%. 3в: accuracy confirmation, submit/unlock/return, pending changes, атомарный freeze/capture и requirement snapshot, тестовые решения SME, отдельный contract старого скелета и compatibility view после retirement R1. Отправка сейчас отсутствует; продукты, производство, сертификаты и документы имеют только схему и файловую основу, формы ещё «Скоро». LPS остаётся самостоятельным этапом 6б Release 1.

R1 и R2 не выкатывались в этом запуске. Выкат R2 требует отдельной проверки R1 на стенде и команды владельца. Реальная очередь SME, DD, источники, LPS и последующие части roadmap не входят в приёмку текущего среза.

## Продолжение после среза 3а

Новый backend/UI срез 3б зафиксирован в `b3b2222`/`8d48bbd`; все семь секций и вложения реализованы, 1962 проверки прошли. На существующем dev установлен только K3s с сохранением старого приложения. Актуальные факты, следующие задачи и границы приёмки — [stage3b continuation](2026-11-16-stage3b-continuation.md). Запрос владельца разрешает продолжить весь план и dev-поставку без новых платных ресурсов.

## Продолжение после срезов3б/3в

Срез3в отправлен в `03c4722`/`0b3dbec`:2148 checks, Astra Approved, local browser cycle93 requests без HTTP/console errors. Эти исторические разделы3а не являются текущим статусом разработки или разрешением на остановку. NDA0022 и policy0023 получили отдельное ревью; MAN-02 и источники продолжаются. [Актуальный срез3в](2026-11-16-stage3c-continuation.md) и [полный production plan](../superpowers/plans/2026-11-16-production-delivery.md) содержат завершённые шаги и runtime gates. Разрешён только существующий dev VM, без новых платных ресурсов; старый public stack сохранён.

Текущий auth/source checkpoint: [NDA/policy/MAN-02 и bounded e-Ondiris](2026-11-16-stage3d-auth-sources.md),2468 проверок с отдельным source-store PG runner; generic invitation ACK fix также прошёл Astra. Продолжаются source-COW0024 и самостоятельный LPS backend.
