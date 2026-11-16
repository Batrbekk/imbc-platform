# Полный план продолжения IMBC до production

Основание: запрос владельца 16 ноября «продолжай по всему плану до production состояния» и уточнение: инфраструктура собирается в Azure по архитектуре проекта; Azure CLI авторизован, GitLab пока отсутствует. Это разрешение на продолжение разработки всех этапов. Дополнительное решение владельца: пока используется только существующий dev-сервер Azure; новых платных ресурсов не создавать. На нём разрешена уменьшенная переносимая поставка по архитектуре. Production-серверы предоставит заказчик; один dev-узел не доказывает HA/SLO production. Реальные письма тестируются только на `.local`; интеграции разрабатываются на записанных ответах до согласованной проверки оплаченных модулей.

Источник: v1.4 от 13 ноября, DBML и ответы 13 ноября, ревизия `8c0f2a6065d409bbc73f9f2fdd7f86214bdb50e6` (повторно проверена 16 ноября). Полная карта 288 требований остаётся в [roadmap](../../development-roadmap.md). У источника ещё статус draft for sign-off: его утверждение и содержательные вводные IMBC не подменяются технической приёмкой.

Исходный код: `653ba1b`, ветка `feat/stage-3-profile`, `.claude/worktrees/stage-3`. Срез 3а принят локально: 1651 тест, независимое ревью GPT-6 Astra, браузер и R1 compatibility. Внешняя приёмка файлов и Azure открыта. Работа идёт последовательными коммитами; schema/UI/инфраструктура имеют отдельных владельцев, общий API и интеграция — у координатора.

## Что означает готовность

- Требования всех этапов 3–10, включая Release 2, реализованы и имеют проверяемые доказательства; демо-заглушки не называются рабочей функцией.
- Серверная матрица прав, tenant isolation, immutable submitted/verified content, source/file snapshots и полный аудит проверены интеграционно.
- Интерфейс и письма en/ru/kk проходят сценарии шести ролей. Производитель проходит регистрацию → заполнение → отправку → возврат → повторную отправку → Verified → изменение.
- Источники и миграции сохраняют происхождение, leading zeros и связи; неуспешное чтение не является finding. Проверенные внешние поля не меняются на непроверенные.
- Kubernetes-поставка с GitLab CI, Argo CD, Vault/OpenBao, observability, backup/restore и эксплуатационными документами проверена в Azure; реальные расходы и доступы соответствуют согласованной конфигурации.
- Полный Office/PDF corpus, ClamAV/storage, 20–25 MB upload, нагрузка NFR-07, ASVS, восстановление и UAT пройдены на фактической поставке. Настоящие legal/NDA тексты, релизные справочники и интеграционные mappings предоставлены и утверждены владельцами данных.

Локальные checkpoints 3б: `b3b2222` backend, `8d48bbd` UI; 1962 теста, build/typecheck/lint/generate/requirements и Astra Approved. [Факты и незавершённая приёмка](../../handoff/2026-11-16-stage3b-continuation.md). На существующем Azure dev развёрнут отдельный свежий K3s-стенд из `8d48bbd`: девять Ready pods, миграции 0000–0019, private storage/SMTP и реальные health/network/ClamAV PONG проверки. [Проверка фактической поставки](../../deployment/verification-2026-11-16-stage3b-k3s.md). Старый публичный релиз `335ef02` сохранён; старый Git HEAD и synced marker имеют отдельные значения. 3в на сервер ещё не поставлен; browser/corpus/restore/R1/edge остаются отдельными шагами.

Реализация 3в зафиксирована и отправлена в GitHub: `03c4722` backend/contracts и `0b3dbec` web. Итоговый набор — 1477 API + 396 web + 251 contracts + 24 checker = 2148/2148; build/typecheck/lint/generate/map прошли, GPT-6 Astra Approved. Два P2 по историческим названиям предметов и stale reload исправлены и повторно проверены. [Подробный срез и открытые runtime gates](../../handoff/2026-11-16-stage3c-continuation.md). Local browser cycle завершён:93 API requests, desktop1280/mobile390, en/ru/kk, ноль HTTP/console errors; auth — fixture, реальные OIDC/files/storage ещё предстоят. Canonical NDA evidence0022:40 PG/HTTP +2 contracts, Astra Approved. [Release policy0023](2026-11-16-release-policy.md):83 PG/HTTP, единый dataset/SQL startup engine, Astra Approved. [Auth/source checkpoint](../../handoff/2026-11-16-stage3d-auth-sources.md): `c7e6dab`/`6dad01a`,2468 checks across isolated runners; NDA0022, policy0023 and MAN-02 Approved. Generic invitation compensation `c31796d` adds9 PG cases and separate Astra approval. Изолированный слой e-Ondiris:65 pure +17 PG, Astra Approved после исправлений legal-name ownership и registry/manual collision;0024 queue/COW integration принята bounded GPT-6 Astra после трёх P2 fixes;44 targeted default-runner checks прошли. LPS backend и Stage4b per-field ownership продолжаются, real daily transport не подтверждён. Portable same-VM restore catalog принят; actual-old-image R1 проверяется на отдельной копии. Production goal остаётся активным.

## 3б. Все секции и вложения

Порядок API: общие файлы → personnel/documents → shared certificates → products → production. Затем UI и общий сценарий. PostgreSQL integration files запускаются последовательно на отдельной `imbc_auth_test`; параллельные исполнители используют разные порты 55432/55433.

- [x] Общий контракт `profile-files.ts`: метаданные без storage keys; рабочая редакция читает latest, frozen — только capture; binding проверяет tenant/purpose/data class и блокирует file objects в порядке UUID.
- [x] Producer upload controller/service: права своего профиля, ограничения до multipart, 25 MB/type/structure validation, quarantine → scan → passed. Re-upload получает новый file object и меняет ссылку редакции; история старого файла и версии сохраняется. Публичной замены версии старого объекта без изменения edit intent нет.
- [x] Personnel contracts/handler: четыре nullable draft count, total computed, nonresident subset, >=1 passed chart, optional CV, ordered files. CV не снижает required completeness; готовность всех прикреплённых файлов к отправке проверяется отдельно.
- [x] Certificates contracts/handler: stable identity, company/product/other, одна file reference; три fixed company ISO held или explicit absence плюс дополнительные admin-required types. Other name зависит от dictionary.custom_name_allowed. Нет CT-KZ/industrial/extract как certificate types.
- [x] Documents contracts/handler: registration/charter и актуальные admin-required types; дополнительные именные документы; licensing исключён.
- [x] Products contracts/handler: stable identities, manual EN/RU names, type→group, TN VED/KPVED, capacity/unit, saved site, optional note, shared held product certificates. Manual DVC=0. Source product facts readonly и не удаляются; локальные site/certificate связи доступны. Extract optional и один на products section.
- [x] Production contracts/handler: optional area/processes/workshops/utilisation/equipment/photos; equipment связывает stable product identity. Неполная optional production не запрещает весь submit; present file safety проверяется отдельно.
- [x] Typed registry/общая полнота для пяти новых handlers; необходимые migrations только expand, frozen guards сохраняются.
- [x] Общий attachment UI: pending/rejected/passed, причины, сохранённые/несохранённые ссылки, retry/re-upload, явная версия frozen download, безопасные ошибки размера/структуры/лимитов.
- [x] Формы personnel/certificates/documents/products/production, существующие Base UI компоненты, partial save/409/dirty guard, en/ru/kk.
- [x] Поддержка notification recipient parts этапа 3: одна явно выбранная contact revision, без смешивания COW-истории; работоспособна для Draft/Returned/Verified по событию.
- [x] Интеграционная приёмка 100% шести обязательных секций, optional production, чужих файлов/профилей, file-only re-upload COW, retired dictionary values и shared certificate/site isolation; GPT-6 Astra review и браузер 1280/390.
- [ ] Настоящий свежий корпус Office/LibreOffice/Google Docs/PDF и ClamAV/storage до открытия upload на стенде.

- [x] Durable append-only `profile_file_history`, exact versions, retained replaced files, transaction locks and batched captures; upload-state API and safe orphan cleanup after persisted tombstone/all-FK checks. Storage-key orphan sweep after failed cleanup without DB object remains Stage 10.
- [x] Четыре release-единицы годовой мощности MAN-23: pieces/tonnes/metres/sets, миграция отдельного `unit` справочника; не использовать «per_year» как пятую единицу.

## 3в. Отправка, возврат, проверенные редакции

- [x] Новые/мигрированные review_assignment/review_decision: immutable subject links к новым section_revision/certificate/document/file_version; старые plural записи остаются до совместимого contract.
- [x] Статус certificate/document получается из состояния редакции, immutable decisions и даты; status updater не переписывает frozen content.
- [x] Resolver связанных секций: для текущей отправки её submitted revisions, затем соответствующие verified; operator читает verified, никогда latest working по одной identity.
- [x] Submit: locked profile/sections, fresh completeness, accuracy confirmation, mandatory-type snapshot, все referenced PASSED versions capture, freeze/pointers/assignment received_at/audit и идемпотентное enqueue одной транзакцией.
- [x] Frozen completeness использует snapshot отправки, а не текущий dictionary.mandatory. Каждый новый Send проверяет сегодняшнюю membership всех required types, включая frozen unchanged sections. Resubmit получает новые требования; COW не наследует старый submission snapshot.
- [x] Unlock закрывает assignment и сохраняет получателя NOT-10 до закрытия; Draft или Verified working возвращается без утраты проверенных данных/решений.
- [x] Returned/resubmit/Verified changes: только Send создаёт pending pointers/queue; unchanged decisions сохраняются, received_at обновляется; старые verified values/files остаются оператору.
- [x] Test-only review command с `.local` actor, SEED_DEMO, audit и без HTTP endpoint; полнофункциональный SME UI — этап 5.
- [x] UI подтверждения/комментарии/пропуски/переходы статусов и сквозной цикл, включая конкурентную замену/scan/send.
- [ ] Contract старого скелета — отдельная поставка после retirement R1, backup/restore и проверки rollback boundary.

## Дополнительные обязательства канонической модели

Повторный аудит полного GitHub Абая зафиксирован в [handoff](../../handoff/2026-11-16-abay-documentation-audit.md). Исходные файлы initial-data и дополнительных документов сохранены с hash/provenance.

- [x] Expand0022: append-only `account_nda_acceptance` и composite link из `nda_acceptance`; исторические согласия не перезаписываются. Unresolved legacy bridge остаётся до R1 retirement/contract; NDA UI отдельно.
- [x] Release-seeded `policy_rule` по DBML; кодовая матрица и seed сохраняют один проверяемый источник правил.
- [ ] `dictionary_alias` для классификаций/источников, без выдуманных сопоставлений.

## 4а/4б. Источники и due diligence

- [x] Нормализованная immutable e_ondiris_record копия, ingestion и change-by-BIN jobs, metadata/synchronisation/retry; необходимые version links заменяют NULL-only placeholders. Migration0024 и bounded source-COW/outbox integration приняты GPT-6 Astra после трёх P2 fixes;24 profile cases,17 storage и3 worker cases проходят в default runner. [Подробности](2026-11-16-stage4a-profile-integration.md).
- [ ] Утверждённый live-протокол e-Ondiris и реальная приёмка ежедневного обновления; disabled connector и записанные captures этого не доказывают.
- [ ] Каталог IMBC-10 проверок и connector modules/allowance/result semantics; unavailable/no-answer/finding раздельны; worker-only calls, no secrets in logs.
- [x] Product-source reconciliation по имени+TN VED, stable identity/local associations сохраняются, включая явно снятую связь с площадкой; порядок разных кодов не угадывает связи. Runtime/browser acceptance полного Stage4b остаётся.
- [ ] Audited refresh legal/OKED/founders, source contact/site prefills не стирают сохранённые правки производителя; verified/pending source snapshots разделены.
- [ ] DD current record/checklist с атомарным full before/after, ordered checks и SME override; оплаченные модули и source contracts подтверждены до live acceptance.

## 5/6/6б. Рабочие кабинеты

- [ ] SME assignment/open/decisions/return/verify и pending changes workflow; выбор recipient revision и NOT-05/28 без дублей.
- [ ] Site survey/DD/enhanced DD, IMBC engagements/status/shortlist/execution, records и совместимые миграции.
- [ ] Verified projection, tier 1/2, visibility green/amber, update status, certificate validity, multi-site region facets/distinct manufacturers.
- [ ] Operator company/files/works-with/visit/note/request с собственной организацией; observer разрешённый readonly без focal/confidential/export/API.
- [ ] Director: все profiles в company/catalog, visible verified dashboard; administrator только разрешённые account/reference действия.
- [ ] Отдельный LPS: SME CRUD, stable records, operator/director readonly table/dashboard, свои filters/totals; без manufacturer/NDA/export/pull API.
- [ ] Полные API/OpenAPI/UI/permissions/audit tests и приёмка шести ролей, нагрузка NFR-07.

## 7/8/9. Актуальность, миграция, Release 2

- [ ] Quarter confirmations, expiry schedule generations, active/outdated/unresponsive rules, NOT reminders/deadlines/Almaty time и полный каталог событий.
- [ ] Audit UI по разрешённому scope, safe full diff/history, отсутствие notification inbox по ТЗ.
- [ ] Manufacturer/PDF migration staging/reconciliation/approval; отдельная LPS migration с 57 source rows; неопределённые связи в review queue, не silent positional mapping.
- [ ] Search exports/subscriptions/pull API по разрешённым verified projections, credentials/revocation/data class/expiry/privacy.
- [ ] Forecast horizon 2031, approved STR product mappings, KTRE/AGAR/CDP контракты, разрешённые документы и новые NDA versions; без Release 1 подмены scope.
- [ ] Воспроизводимая миграционная приёмка и Release 2 сценарии, которые требуют данных IMBC/операторов.

## 10. Azure production поставка

- [x] Read-only Azure inventory и конкретный topology/cost plan: сохранить существующий dev-стенд, определить production/UAT, network/storage/identity/DNS/backup/SKU.
- [ ] GitLab CI pipeline со строгими Node 26/contracts/web/API/PG checks и container images; отсутствующий GitLab разворачивается или подключается по выбранной конфигурации.
- [ ] Kubernetes manifests/Helm, API/worker/web/Keycloak/PostgreSQL/queues/storage/ClamAV, readiness/resource limits/rollout/migrations, Argo CD и secrets из Vault/OpenBao.
- [ ] Prometheus/Grafana/Loki/Alloy/OTel, dashboards/alerts/log redaction; backup PostgreSQL/object/identity/Vault, PITR и реальная restore drill.
- [ ] ASVS/access review, rotation/least privilege/TLS/CSP/rate limits, dependency/container checks, limits/retention/orphan cleanup.
- [ ] Production/UAT deploy, real role/login/upload/scan/mail tests в согласованном scope; k6 2000 profiles/200 concurrent users, SLO из NFR-07.
- [ ] Runbooks, operator ownership, incident/rollback/restore, approved legal/reference/source/migration inputs, IMBC UAT/sign-off и окончательная карта доказательств 288 требований.

## Текущие владельцы и вводные

Координатор: shared files, certificates, все формы, integration и план. Агенты реализовали personnel/documents/products/production, upload/cleanup и логирование; новые задачи назначаются после проверки. Независимый reviewer: GPT-6 Astra. Infrastructure-agent готовит k3s/GitLab/Argo/OpenBao/observability для существующего dev-узла; до установки проверяются финальный комплект, сохранение действующего Compose и резервная копия. PostgreSQL-тесты параллельно используют разные изолированные порты 55432/55433/55434.

Внешние вводные не останавливают независимую разработку: предоставляемые production-серверы и доступы, утверждённые legal/NDA/reference тексты, оплаченные Adata modules/квота, source data/mappings и миграционные наборы. Отсутствие этих вводных не превращает fixture test в live acceptance; goal остаётся активным до выполнения фактических критериев.
