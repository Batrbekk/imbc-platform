# Canonical due diligence backend: acceptance handoff

Дата: 2026-11-16. Ветка: `feat/stage-3-profile`. Эта поставка закрывает backend DD этапа 4a; она не означает завершение всей production-программы.

## Реализовано

- Migration 0027 создаёт отдельные canonical current/check rows, неизменяемые normalized source snapshots, durable refresh outbox и sealed operations. Legacy plural records, ссылки и исходная severity сохранены; непроверенные старые catalog projections скрыты без выдуманного преобразования результатов.
- Automatic replacement, SME override и enhanced save сохраняют полные before/after record + ordered checks в одном audit operation и одной транзакции с business rows и catalog projection. Deferred SQL seal проверяет итог при COMMIT. SQL функции имеют fixed `search_path=pg_catalog,public,pg_temp`; повторное использование старой операции и temp-table подмена не дают удалить record без настоящего аудита.
- Technical terminal failures/no answer сохраняют прежний business result, checked date, source pin и независимый enhanced report. Ordered checks сохраняют exact numeric strings, subject grouping, `attention` отдельно от просто показанных tax/partial-contract rows.
- Persisted active actor/policy проверки обеспечивают Class C доступ только SME/Director. Только SME пишет, загружает и запускает rerun; остальные роли не читают DD/report bytes. Exact UTC6 token обеспечивает optimistic 409.
- Отчёт получает ownership только при explicit save после clean scan, с tenant/purpose/Class C/latest version проверками. Current/history возвращают numeric version number закреплённого version ID; rejected поздний upload не заменяет доступную историческую версию.
- Current `checkedAt`/`sourceIsTestData` получены из закреплённого source snapshot, независимо от последней неудачной попытки. History `actorName` берётся только из account full name; immutable actor ID и полные исходные audit values не изменены.
- `/v1/profiles/:profileId/due-diligence` и `/history`, `/override`, `/enhanced`, `/runs`, report upload/metadata endpoints подключены к AppModule. Rerun и ClamAV jobs записываются вместе с audit; provider HTTP не вызывается из read endpoint.
- Catalog rebuild использует ровно семь verified section revision IDs, исключает current working/unverified provider/Class C content и публикует только public DD checkedOn/enhancedDone. Red скрывает row атомарно. Profile review publisher и реальный refreshCatalog pg-boss handler вызывают тот же writer.

## Историческая проверка первоначального frozen candidate

На изолированной PostgreSQL 55433 / `imbc_auth_test`:

- DD core 29 + actions 19 + boundary 7 = **55/55 PASS**.
- File access 41 + notification worker 3, вместе с DD: **99/99 PASS**, 12:34:08, 20.19 s.
- Actual profile-review integration: **19/19 PASS**, 12:35:02, 10.41 s. Итого затронутые PG/HTTP checks: **118/118 PASS**.
- API typecheck и build: PASS. Contracts build: PASS. `db:generate`: No schema changes; migration 0028 не создана.
- Независимый Astra gate до последней read/actions/seal delta: canonical **34/34 PASS**, включая BIGINT 6,442,450,941, NULL permanent certificate, signed survey proof, legacy hiding и unchanged clean report pin. Последняя delta передана на отдельное независимое review.

Frozen SHA256:

- `apps/api/drizzle/0027_canonical_due_diligence.sql`: `25aa5075b155e0bcb2d4c0ab549fa941c35c92858431aef8a8483390706697e0`
- `apps/api/drizzle/meta/0027_snapshot.json`: `f6a2daf44e36003f18ea3f9f59e7eb42ac3d3940b3b61e51920c2d546cf42ffb`
- `apps/api/src/modules/due-diligence/diligence.service.ts`: `a9af4d479cdea6f6efe849f0c6372dd7ce61750f41cf772fb61f769ad1ee5566`
- `apps/api/test/diligence.integration.test.ts`: `16dbefd77c57c25493e94e8899cfc96352f10f941712f8269d86b3d615db8bda`
- `apps/api/test/diligence-actions.integration.test.ts`: `08028e471f3cb257ef619ce2c03d7f94244fd3539b58fea87a6ce57ebd2a2e11`

Backend агент не выполнял staging, commits, VM mutations, paid provider calls или внешнюю публикацию. Все PG процессы агента завершены; 55433 свободен.

## Остальная production-программа

Нужны frontend DD workflow/полный кабинет, combined независимый gate с последним Adata seam, согласованные квартальные automation/reminders этапа 7, full legacy migration acceptance этапа 8 и проверка delivery/restore/security/real environment. Эти работы координирует root по полному canonical плану; они не считаются выполненными этим backend checkpoint.

## Итоговое независимое принятие и provenance delta

Последняя actions/read/seal delta прошла независимые118 PG/HTTP +62 contracts; Astra выявил lost-COMMIT-ACK компенсацию. Исправление проверено независимо21/21 actual actions: известный rollback и отсутствие регистрации позволяют cleanup; неизвестный COMMIT/ROLLBACK сохраняет байты. Root120/120 DD/affected проверок passed перед отдельной source provenance delta. Новая DD history передаёт required sourceSnapshots для точных before/after pins, checkedAt UTC6/isTestData; неизменяемый full diff не переписан. Root58 DD PG/HTTP и Astra58 DD PG/HTTP +12 contracts passed; UI488 web/typecheck/lint/build и Astra визуальное повторное ревью закрыли mock-provenance P2. Общее API regression ещё выполняется перед коммитом.

Актуальные SHA256 (supersede соответствующие старые hashes выше):

- `apps/api/drizzle/0027_canonical_due_diligence.sql`: `25aa5075b155e0bcb2d4c0ab549fa941c35c92858431aef8a8483390706697e0`
- `apps/api/drizzle/meta/0027_snapshot.json`: `f6a2daf44e36003f18ea3f9f59e7eb42ac3d3940b3b61e51920c2d546cf42ffb`
- `apps/api/src/modules/due-diligence/diligence.service.ts`: `e1abafd82681c3f69e31ab09f563a2aa1445230c7ec227f8d3fd3468dbb61494`
- `apps/api/src/database/transaction.ts`: `66a76e0e6687dcbd4d84005b46929368bcd9cf5cf32de66183b7bb117621554a`
- `apps/api/src/modules/files/files.service.ts`: `73a502dbda672075962107246f1a52f7b96aa6ffe333e7924a3a08926afb7f4d`
- `apps/api/test/diligence.integration.test.ts`: `53e87290cd4ce8f60915e6b7a06c89bc4224baf05aab19aa030ad6143daf9106`
- `apps/api/test/diligence-actions.integration.test.ts`: `614bfefeadbf321374d75d436689a864acbdf6e55e8f1543b65ee7a67ac0c944`

General regression: initialNode26 fullAPI1936 pass/3 stale-test failures/76 skipped; exact release-reference, historical0010 and static reader inventory corrections passed21 targetedPG checks and independent Astra review. CompleteNode26 rerun is active before publication. No business permissions or migration SQL were changed to satisfy those tests.

Final Node26 complete API regression:104 files passed/4 skipped;1939 passed/76 skipped (2015 inventory),13:09:47,252.71s. The exact52-file backend/contracts/acceptance manifest excludes DD web, infrastructure, Stage5 drafts and restricted analyst originals. API typecheck/build, contracts build354 tests, requirements288-ID map and diff checks passed. No provider/live deployment/OIDC/corpus acceptance is inferred from this checkpoint.
