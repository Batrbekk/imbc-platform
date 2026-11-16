# Этап 3в — отправка, разблокировка и снимки проверки

Редакция: 16 ноября 2026 года, после ревью Astra. Checkpoint 3б: `b3b2222`. Статус: реализация основы схемы и контрактов 3в; Send/Unlock/Review services подключаются после ревью этой основы. Продолжение разработки уже входит в запрос владельца проекта.

## Основания и границы

- [Спецификация v1.4](../../analyst/2026-11-13/specification-v1.4.md), строки 264–270: MAN-40–46, частичное Save, полнота, accuracy confirmation, unlock, Return и изменения Verified. Строки 300–311: REV-01–09, очередь, прежний SME, решения по точным разделам/документам/сертификатам, публикация принятых изменений. Строки 233–235: MAN-23–25, продукты и правило name + TN VED. Строки 239–248: MAN-26–32, производство необязательно. Строки 740–746: DATA-01–07, история и malware scan.
- [DBML v1.4](../../analyst/2026-11-13/imbc-platform.dbml): `manufacturer_profile` с accuracy confirmation, строки 649–670; указатели `profile_section`, 672–687; immutable/COW `section_revision`, 689–708; `submission_requirement`, 710–722; `review_assignment`, 1116–1127; append-only `review_decision` с ровно одним субъектом, 1129–1143.
- [Ответы аналитика 13 ноября](../../analyst/2026-11-13/2026-11-13-replies.md), строки 11–17: исходная матрица в contracts и порождённая из неё `policy_rule`; таблица не является независимо редактируемой второй матрицей. Этот ответ уточняет более ранний ответ от 12 ноября.
- [Карта частей этапа 3](2026-11-14-stage-3-map.md), строки 61–76: граница 3в, test-only review до этапа 5, отдельный contract-релиз. [Общий roadmap](../../development-roadmap.md), строки 244–259: семь секций и различие working / sent pending.
- Авторитетный внешний срез документации: [AZhunis/imbc-prototype@8c0f2a6065d409bbc73f9f2fdd7f86214bdb50e6](https://github.com/AZhunis/imbc-prototype/tree/8c0f2a6065d409bbc73f9f2fdd7f86214bdb50e6). Локальные копии и покрытие чтения описаны в [аудите документации](../../handoff/2026-11-16-abay-documentation-audit.md). Исторические документы не отменяют v1.4 и последние ответы.

3в завершает lifecycle производителя и основы review cycle. Реальный SME интерфейс и полный notification workflow относятся к этапу 5. До него решения воспроизводит закрытая demo-команда. Adata/e-Ondiris ingestion остаётся в 4б; source refresh не получает исключения из immutable guards. LPS, forecast/NDA и due diligence не добавляют выдуманных обязательных полей в Send производителя.

## Текущее состояние, которое нужно сохранить

| Область | Факт в коде 3б | Что требуется в 3в |
|---|---|---|
| Own scope | [profile-store.ts](../../../apps/api/src/modules/profiles/profile-store.ts), строки 14–62: persisted account/organization, profile lock, свои sections/revisions | Та же доверенная область для Send/Unlock; profileId/organizationId из HTTP не выбирают цель |
| Locks | Тот же файл, 66–71: Submitted, Under review и Verified с pending pointers глобально закрывают редактирование | Unlock — отдельная разрешённая операция; Save не обходит lock |
| Save/COW | [profile-sections.service.ts](../../../apps/api/src/modules/profiles/profile-sections.service.ts), 107 и 269; [revision-copy.ts](../../../apps/api/src/modules/profiles/revision-copy.ts), 93 | Сохранить partial draft, no-op, editVersion, полную историю и стабильные identities |
| Frozen graph | [0015_stage3_profile_data.sql](../../../apps/api/drizzle/0015_stage3_profile_data.sql): `stage3_revision_immutable`, content/pointer guards; `SECTION_CONTENT_TABLES` в revision-copy | Не thaw/reparent/update frozen business rows; review state переходы не дают права менять содержание |
| File snapshots | [revision-file-snapshot.ts](../../../apps/api/src/modules/files/revision-file-snapshot.ts), 13–80 | Рабочий capture уже есть, но HTTP Send boundary ещё отсутствует |
| Required types | `submission_requirement`; Certificates/Documents читают current requirements для working и frozen snapshot для отправленной ревизии | Заполнять snapshot при Send; не наследовать его как требования новой рабочей копии |
| Product duplicates | [products.handler.ts](../../../apps/api/src/modules/profiles/products.handler.ts), 337–347: `duplicate_product` входит в mandatoryInputs | Повторно вычислять при Send; legacy draft с дубликатами не становится отправляемым из-за cached 100 |
| Optional production | [production.handler.ts](../../../apps/api/src/modules/profiles/production.handler.ts), 170: mandatoryInputs пуст | Полнота остаётся 100; безопасность всех привязанных фото проверяется отдельно |
| Editor candidates | Отдельный GET `/:kind/choices`; frozen DTO Products/Production сохраняет choices = null | Не использовать editor candidates для гидратации исторического или SME снимка |
| Legacy reviews | [schema/profiles.ts](../../../apps/api/src/database/schema/profiles.ts), 223–248: plural `review_assignments`/`review_decisions`; decision FK ведёт на старые `section_revisions` | Канонический граф review с tenant constraints и текущими section/certificate/document rows; не использовать старый FK молча |
| Recipients | [recipients.ts](../../../apps/api/src/notifications/recipients.ts), 87–98: focal_point/manufacturer_contacts/assigned_sme пока `notReady` | Явные scoped resolvers перед включением соответствующих событий |

Ссылки на строки кода относятся к рабочему срезу 16 ноября перед checkpoint 3б; номера могут измениться в следующем коммите.

## 1. Контракты и канонический review graph

Предложенные HTTP операции: `POST own/submit` и `POST own/unlock`; точные пути согласовать с имеющимся ProfilesController. Send принимает strict тело с `accuracyConfirmed: true` и ожидаемым вектором семи секций `{kind, revisionId, editVersion}`. Поле режима отправки не требуется: сервер выводит initial/resubmit/verified-changes из текущего графа. Клиент не передаёт assignee, source UUID, новые статусы или поля review decision.

Вектор защищает от отправки данных, которые изменились после просмотра формы. Несовпадение revision/editVersion возвращает стабильный conflict с возможностью перечитать профиль. Save с частично пустыми полями по-прежнему разрешён. Тело Send также содержит UUID `operationKey`; assignment хранит этот ключ и вычисленный сервером SHA-256 канонического запроса. Повтор того же ключа и вектора возвращает исходный результат без второго assignment/event; тот же ключ с другим запросом даёт conflict. Unlock содержит собственный operationKey и expectedAssignmentId; его результат закреплён полями закрытия этого exact assignment.

Предлагается добавить канонические `review_assignment` и `review_decision` по DBML, с явной миграцией данных или доказанно пустого скелета. Обязательные ограничения:

- Один открытый assignment на профиль; новый `received_at` для каждого реального цикла отправки; старый assignment закрывается, не переписывается в новую отправку.
- Profile/section/revision/decision связаны в одном manufacturer tenant; reviewer — активный IMBC expert, его organisation не нужно ошибочно приравнивать organisation производителя.
- Decision append-only, ровно один субъект из section revision / certificate row / document row / file version. Для certificate/document доказательство файла разрешается через captured graph, не добавлением второго субъекта в ту же decision row.
- Outcome только verified/rejected; rejected требует непустой комментарий. Изменение решения хранится новой записью, прежний текст и автор не стираются.
- Reviewer право проверяется и по policy, и по текущему assignment. Поле expertId из тела не назначает исполнителя.

Основа реализуется в [profile-review.ts](../../../apps/api/src/database/schema/profile-review.ts) и expand [0020](../../../apps/api/drizzle/0020_stage3_review_foundation.sql). Decision хранит технические profileSectionId + subjectRevisionId с composite FK на exact assignment map; они не считаются дополнительным субъектом. Для file decision технический fileObjectId связывает version → object → tenant, а SQL guard требует passed captured revision_file_version именно mapped revision. Certificate/document row дополнительно проверяется по этой exact revision; ISO absence не получает per-certificate verified решение. Assignment row блокируется при decision insert, сериализуя close/reassign; позже заблокированный эксперт не меняет старую историю.

Порядок assignment/decision назначает БД: assignmentOrder после profile lock, decisionOrder после assignment lock, cache=1 у sequence. Время decidedAt/receivedAt и UUID не выбирают effective latest или previous cycle; переданные SQL order значения guard заменяет. `profile_review_effective_decision` и `profile_review_effective_section_acceptance` дают один scoped latest outcome по exact subject. Старое verified d1 после append-only rejected d2 больше не является current acceptance. Map retention разрешён только из closed source assignment: source SHARE lock сериализует проверку с последним decision/close, а закрытый источник уже не допускает новые решения.

Обычный assignedBy — активный IMBC administrator либо сам назначаемый active SME. Автоматическая повторная отправка хранит immutable reusedFromAssignmentId: closed непосредственный предыдущий assignment по assignmentOrder, тот же профиль/tenant, тот же active SME и точный historical assignedBy. Только эта proven reuse может сохранять уже inactive исторического автора назначения. Произвольный старый assignment, foreign профиль, open source, новый SME или подменённый assignedBy не допускаются. Последующее явное reassignment вновь требует текущих полномочий.

Технический `review_assignment_section` фиксирует assignmentId, profileId, profileSectionId, sectionRevisionId, organizationId, reviewRequired и optional retainedDecisionId. Composite FK связывают exact профиль, tenant, section и revision; deferred constraint требует **все семь выбранных frozen ревизий** к COMMIT, включая неизменённый verified baseline. Map immutable после вставки. reviewRequired отмечает только то, что действительно нужно проверять в этом цикле; retainedDecisionId может указывать только на verified решение по этой exact section revision из прежнего assignment того же профиля, а не на произвольный UUID своего tenant.

Отдельный mutable технический `profile_section_candidate` хранит по одной ссылке section → immutable assignment-section map и nullable acceptedDecisionId по exact section subject. Он не меняет состояния frozen revision и сохраняется после закрытия assignment/очистки pending. Manufacturer resolver выбирает working → pending → durable candidate → verified; очередная Edit создаёт working COW из выбранного кандидата. При новой Send cursor атомарно переключается на новый map. После частичного review acceptedDecisionId можно записать в cursor без UPDATE исходного immutable map. Решения и исходный map остаются историей. Accepted-but-unpublished и rejected candidates таким образом доступны изготовителю и после закрытия assignment; опубликованный указатель от этого не меняется.

[profile-candidate.ts](../../../apps/api/src/modules/profiles/profile-candidate.ts) предоставляет общий current SQL/batch resolver и отдельный scoped immutable assignment-map reader. В current DTO acceptedDecisionId возвращается только когда выбранная revision совпадает с exact cursor revision; новая working COW получает null, даже если сохранённый cursor имеет прежнее accepted решение. Подключить общий current resolver во все readers/guards Main, Products, Certificates, Production и ProfileStore; старый coalesce working/pending/verified не должен выбирать опубликованный baseline вместо retained candidate. Исторический reader принимает одновременно assignmentId + profileId + organizationId, не разрешая scope по одному произвольному UUID.

Raw cursor acceptedDecisionId — **historical hint**, не current approval: d1 может оставаться в технической строке после позднего d2, но общий current resolver дополнительно проверяет shared effective-latest guard и возвращает null. Send и все другие acceptance consumers используют только этот guarded результат; прямой raw cursor fallback запрещён. Cursor write также source-lock/валидирует latest, включая отдельное чтение после ожидания lock. Физический AFTER-decision UPDATE cursor не нужен и не создаёт обратный lock order assignment → cursor против cursor → assignment. Исторические immutable map/decision IDs продолжают показывать решения конкретной прежней отправки, не заменяясь глобальным current outcome.

## 2. Send как одна транзакция

1. Повторно проверить persisted active manufacturer, own organisation, разрешённое действие, global state и ожидаемые версии. Взять account/profile/section/revision locks в согласованном порядке с bounded lock waits.
2. Выбрать единый candidate graph: working изменения и неизменённые frozen accepted baselines. Проверить связи product → site/certificate и equipment → product в **этом** графе, а не по существованию identity или через случайную latest working строку.
3. Для ещё не проверенных/rejected frozen candidates, которые отправляются повторно без Save, создать новую working COW ревизию. Не возвращать rejected/submitted старую ревизию в working и не менять её submittedAt. Unchanged accepted subjects переиспользуются как exact baseline с прежней decision.
4. Повторно вызвать mandatoryInputs всех шести обязательных секций. Считать полноту по неокруглённым значениям; нет applicable inputs — complete. Возвращать missing paths с ссылками на нужные формы. Production не включать в среднее.
5. **При каждой новой Send** определить и заблокировать текущие required certificate/document sets: фиксированные company ISO 9001/14001/45001, фиксированные document baselines и admin mandatory types согласно текущим handler rules. Сравнить их с evidence snapshots всех выбранных Certificates/Documents, включая unchanged accepted frozen и отправку изменений только другого раздела. Старый submission_requirement не переписывается. Если актуальный набор отличается, создать working COW requirement candidate для затронутой section, пересчитать полноту по текущему набору и проверить новые обязательные записи/файлы. При недостатке данных вся Send откатывается с missing paths; при успешной отправке новый candidate получает новый snapshot и reviewRequired=true, прежняя immutable decision не переносится на новый subject. Только совпадающий snapshot разрешает exact unchanged frozen baseline без новой COW. Требования не объявляются применимыми лишь к изменённым разделам.
6. Проверить все непустые file bindings выбранного графа. Для новых working revisions вызвать существующий captureRevisionFileVersions: canonical owners, tenant/purpose/data class, sorted file-object locks, **отдельный statement после ожидания locks**, latest version, passed scan. Optional CV/extract/production/equipment photos также входят в этот gate.
7. Для unchanged frozen subjects проверить captured version existence и passed scan именно captured версии. Не вызывать working-only capture, не дописывать frozen snapshot и не fallback на latest или timestamp. Отсутствующий baseline/snapshot — объяснимый отказ, не скрытое восстановление из текущих справочников/файлов.
8. Записать assignment-section map, freeze newly sent working revisions, атомарно переключить pointers/state/accuracyConfirmedAt, append-only audit и queued event через queueDb. Ошибка на любом шаге откатывает все ревизии, snapshots, pointers и событие.

Особые completeness правила:

- `duplicate_product` пересчитывается по текущему name + exact textual TN VED; сравнение только по коду запрещено. Legacy неизменённые duplicates разрешают Save, но не Send. Registry-registry факты не удаляются/сливаются изготовителем.
- Нехватка source-owned legal/Adata facts не заставляет изготовителя выдумывать юридические сведения или ownership shares.
- ISO notHeld — допустимая декларация по правилам текущего Certificates handler; не требует отсутствующего файла и не превращается в verified held certificate.
- Production остаётся optional даже с unfinished equipment. Наличие pending/rejected привязанной фотографии блокирует Send по DATA-07, а не снижением business completeness или выдуманными обязательными equipment fields.
- Expired display status не добавляет нового самостоятельного Send запрета без требования ТЗ; malware/file permission и validity/business rules не смешиваются.

## 3. Состояния, Unlock и Return

| Переход | Manufacturer graph | Queue / publication |
|---|---|---|
| Draft/Returned → Send | Newly sent sections frozen, pending pointers; accuracy recorded | Initial profile Submitted; fresh current assignment |
| Verified → explicit Edit/Save | Только изменённая section получает working COW; старые verified pointers остаются | Нет assignment/pending pointer/legacy sent-changes flag от одного Save |
| Verified working → Send changes | Отправляются изменённые candidates; unchanged accepted baselines сохраняются | Profile остаётся Verified, появляются sent pending pointers; прежний SME |
| Submitted/Under review → Unlock | Замороженная отправка сохранена; редактор получает своё candidate context | Assignment закрыт, очередь очищена; Draft или Verified согласно серверному baseline |
| Verified with sent pending → Unlock | Последние candidates/decisions сохранены для исправления/повторной отправки | Verified baseline остаётся опубликован; pending pointers очищены |
| Review result rejected | Rejected subjects и comments доступны изготовителю; approved untouched сохранены | Initial result Returned; pending-change rejection сохраняет ранее published values |
| Review result accepted | Проверены все нужные subjects и publication graph | Initial profile Verified либо approved changed pointers заменяют baseline |

Текущий selectedRevision выбирает только working → pending → verified. В 3в между pending и verified добавляется durable candidate cursor, привязанный к exact assignment-section map. Это делает отклонённую новую версию Verified и принятую, но ещё не опубликованную версию доступными после закрытия assignment. Нельзя поместить rejected/verified в pending pointer: существующие DB guards требуют submitted. Save над таким кандидатом всегда создаёт COW; отсутствие working после Unlock само по себе не выбирает старый опубликованный baseline вместо последнего candidate.

Неизменённая принятая section сохраняет исходную immutable decision, точный subject, requirement baseline и файлы. Автоматическая COW копия с другим row/revision ID не считается уже проверенной по сходству значений. Для повторного цикла map может ссылаться на retainedDecisionId только при совпадении exact subject/evidence. Изменение файла, business fields, source record или новой проверяемой requirements baseline снимает перенос решения; старую decision сохраняет история.

Unlock во время частично проведённой проверки Verified изменений не должен публиковать принятый candidate лишь ради сохранения решения. Сохранить candidate + decision в review context; отправка опять идёт прежнему SME. Закрытый assignment не появляется в текущей очереди. Source refresh в 4б создаёт новую working ревизию и не обходится blanket frozen exception.

## 4. Exact related data и публикация

Разделить контексты resolver:

- **Editor:** текущее своё candidate/working состояние; отдельные GET choices. Эти данные не изменяют frozen DTO.
- **Submission / SME / history:** конкретный assignment-section map; site, shared certificate, product и файл разрешаются из указанных ревизий. Ни latest working Main/certificates/source, ни global latest file не допустимы.
- **Current publication:** согласованный граф только approved verified pointers. После принятого исправления Main site текущие товары/карта могут показать новое approved место; историческая отправка продолжает показывать прежний exact graph. Историческая привязка не должна навечно блокировать допустимое обновление текущей публикации.

На Submit result проверить связность **результирующего publication graph**, включая сочетание accepted changed sections и старых baselines rejected секций. Выбрано правило **атомарной публикации dependency-consistent accepted subset**: публикуются все независимые accepted candidates, которые вместе с оставшимися published baselines образуют допустимый граф; accepted кандидаты зависимого компонента, который сейчас нельзя заменить согласованно, остаются отложенными. Пример: Products unlink отклонён, Certificates conversion в company принят — старый опубликованный продукт продолжает ссылаться на прежний held product certificate, принятый Certificates candidate не публикуется. Аналогично откладывается accepted Main с удалением site, если опубликованный Products ещё использует этот site. Транзакция проверяет итоговый граф и переключает subset указателей целиком, не по одному в обход проверки. Если accepted зависимый компонент можно заменить только совместно, он публикуется целиком.

Закрытие assignment не меняет accepted outcome и не теряет отложенный exact candidate: durable cursor сохраняет его section map, append-only decision остаётся verified. Следующая согласованная Send с неизменёнными subject/evidence включает его с retainedDecisionId и reviewRequired=false; изменённые бизнес-данные/файл/текущий requirement baseline создают COW и требуют нового решения. Другая изменённая section сама по себе не стирает решение на unchanged exact subject; связность нового seven-section graph валидируется отдельно. История первоначального assignment продолжает разрешаться через первоначальный map. Нельзя публиковать некорректный mixed graph, автоматически исправлять данные изготовителя или менять outcome SME.

## 5. Policy, аудит и получатели

Существующее manufacturer `profile.edit: own` — основа own lifecycle; отдельные submit/unlock action codes, если вводятся, получают только manufacturer own scope и порождаются из одной contracts matrix. IMBC не отправляет профиль за изготовителя (REV-09). Latest 13 November answer требует отражённую policy_rule; отсутствие таблицы в текущем приложении — явно известное отступление, а не отмена ответа аналитика.

Audit фиксирует actor/time/profile/assignment/revision IDs, before/after pointers и accuracy action в той же транзакции. Review decision/comment append-only. Application logs не получают business rows, raw SQL parameters или документы. Snapshot/audit retention и backup retention — разные требования.

В [0010 notification rules](../../../apps/api/drizzle/0010_stage2_reference_data.sql), строки 17–20: NOT-04 = profile_submitted → imbc_mailbox; NOT-05 = review_result → manufacturer_account + focal_point; NOT-10 = profile_unlocked_in_review → assigned_sme_or_imbc_mailbox. Current imbc_mailbox resolver реализован; остальные связанные resolver ещё частично notReady.

Перед фактической рассылкой:

- NOT-10 находит SME текущего закрываемого assignment/его exact event context; отсутствие назначенного SME использует установленный IMBC mailbox. Поздняя переадресация не должна случайно отправить unlock event другому вновь назначенному reviewer. Источник получателя и fallback тестируются.
- Focal point/manufacturer contacts выбираются из явно заданного профильного графа события, а не legacy contacts и не чужой организации. Для review/return использовать отправленный/доступный изготовителю subject context; не подмешивать непроверенный working replacement в адресатов published события.
- NOT-18: нормализация email и dedup account → contact → mailbox, один event/address; language selection по установленным правилам. Очередь содержит только IDs/event keys/codes/app links, не имена, email или raw comments.
- Enqueue и assignment/state transition атомарны через queueDb. Retry worker не создаёт новое событие и не повторяет уже записанную delivery fact. Тесты только с `.local` recipients/Mailpit; deployment development не является разрешением отправлять тестовые сообщения реальным адресатам.

План частей оставляет полный mail/SME workflow этапу 5. В 3в подготовить и проверить события/resolvers/transaction boundary; не объявлять функцию готовой к реальным событиям, пока связанный notReady resolver не заменён. Спецификация, строка 682, прямо задаёт NOT-28 pending-changes result как **NOT-05**: accepted/rejected sections с комментариями, профиль остаётся Verified, письмо не говорит «Returned», операторов среди получателей нет. Новый rule code NOT-28 не требуется; текущий список NOT-01–17 сам по себе не доказывает наличие нужной ветки renderer. Передать assignment/event IDs, прочитать immutable decisions при рендеринге, не класть raw comments в queue payload.

## 6. Последовательность реализации и приёмки

1. **Checkpoint 3б.** Дождаться общего ревью Astra и root checks; зафиксировать рабочий срез. Последние узкие проверки source_data: Products 39 HTTP/PG + 22 contracts; Production 31 HTTP/PG + 19 contracts, API/contracts typecheck/build. Эти числа не подменяют общий приёмочный запуск root.
2. **Schema/contract design review.** Canonical review tables, assignment-section map, exact candidate/history/publication resolver, immutable guards, FK/unique/check constraints, backward-compatible expand. Назначить владельцев файлов; legacy review FK и политика решения partial acceptance закрываются до mutation кода.
3. **Send service + реальные PG HTTP tests.** Strict accuracy/ETag, actor recheck, mandatory recomputation, types/file snapshots, all-or-nothing concurrency, assignments/pointers/audit/events.
4. **Unlock/Return/Verified lifecycle.** Exact retained decisions, candidate resolver, прежний SME/fresh receivedAt, current queue only, unchanged baseline, no source/frozen write exception.
5. **Закрытая demo review command.** SEED_DEMO=true, persisted active `.local` expert, explicit assignment scope, append-only audit; никакого публичного HTTP endpoint. Проверки per-item decisions и publication dependencies обязательны даже если real UI будет в этапе 5.
6. **Web + E2E.** Accuracy dialog, missing links, отдельное Edit/Send changes, global lock/Unlock, per-section/item status/comments, dirty/conflict; en/ru/kk, 1280/390 px и клавиатура. Полный путь Draft → Send → Return → исправление → Send → Verified → Edit → Send changes → Unlock/resubmit.
7. **Expand deploy/verification.** Использовать уже разрешённый существующий Azure dev server и текущие Compose файлы; новых платных ресурсов этот этап не требует. Проверить migrations, role grants, real file path through proxy/storage/scanner и old-reader compatibility.
8. **Отдельный contract этапа 3.** Удалять только доказанно неиспользуемый legacy skeleton и manufacturer_profiles compatibility view после retirement старого приложения/worker queries, с backup/restore и явной rollback boundary. Не совмещать drop с первым Send release.

Обязательные regression cases:

- Cached/rounded 100, но обязательный field/file отсутствует; legacy duplicate_product; missing source facts и ISO absence не создают false blockers.
- Optional production empty/partial — complete; pending/rejected production/general/equipment/shared photos всё же block Send; shared file capture один exact version.
- Dictionary mandatory change во время Send; old frozen baseline остаётся immutable; новая working отправка получает новый baseline. Отдельная regression: manufacturer изменил только Contacts, а после прежней verification появился обязательный certificate/document type; Send обязан потребовать новый тип через COW соответствующей frozen section, не пропускать gate по unchanged baseline.
- Concurrent Save/Send, two Sends, replacement-before-lock-wait, scan transition; rollback не оставляет часть frozen sections/snapshots, job или assignment.
- Frozen snapshot отсутствует, missing captured version, later latest replacement; никакого latest fallback или retrospective capture.
- Foreign identity/file/site/certificate/equipment link, wrong kind, stale persisted account role/tenant, blocked actor, unauthorized IMBC submit/unlock.
- Unlock после частичных decisions; прежний SME и новый receivedAt; untouched accepted decision остаётся exact, modified/source/file evidence требует проверки снова.
- Append-only verified d1 → rejected d2 по exact subject, включая cursor, созданный до d2: current acceptance null, retention d1 запрещён. Backdated decidedAt/поддельный order не меняют latest; реальный cursor INSERT после lock wait видит committed d2. Forged assignedBy/open/foreign/непосредственно не предыдущий reuse запрещены; proven repeat сохраняет inactive historical administrator при том же active SME.
- Returned/Verified rejected candidate показывает последнюю rejection и comment, а оператор видит старый verified baseline.
- Accepted/rejected linked-section mixture не ломает publication graph; независимый accepted subset публикуется атомарно, зависимый accepted candidate сохраняется после закрытия assignment и приходит в следующую согласованную Send с reviewRequired=false и той же exact decision. Main location corrections обновляют только approved current view, history exact.
- Late queued NOT-10 после reassignment, recipient fallback/dedup/language, no real test recipients, duplicate worker retry, queue/audit atomicity.

Критерий готовности 3в: полный повторяемый lifecycle с проверенными snapshots/tenant/refusal/concurrency cases и отдельной стендовой приёмкой. Наличие кнопки Send или demo verification само по себе не является завершением этого этапа.
