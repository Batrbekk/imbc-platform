# Срез 3б и продолжение до production

Основание — запрос владельца продолжить весь план с несколькими агентами и независимым GPT-6 Astra. В Azure разрешён только существующий dev-сервер; новые платные ресурсы не создавать. Production-серверы предоставят позже. Это разрешение сохраняется для последующих согласованных по архитектуре dev-фаз; повторное подтверждение уже разрешённой установки не требуется.

## Зафиксированный код

- `b3b2222`: все семь draft API, producer uploads, shared certificates/documents, units, append-only file history, safe orphan cleanup и очистка логов до stdout/transport.
- `8d48bbd`: пять дополнительных форм, все семь маршрутов, точные числа и версии файлов, история, образец оргструктуры, сохранение параллельных правок и статусов сканирования.
- Ветка `feat/stage-3-profile`; рабочий checkout `.claude/worktrees/stage-3`. Старые checkout не изменяются. Оба коммита отправлены в [GitHub](https://github.com/Batrbekk/imbc-platform/tree/8d48bbd197a95abd9501584a3c64be177bc3e6b9); публичный dev-сайт пока обслуживает прежнее приложение. Из этого exact commit собирается отдельный изолированный стек, без незакоммиченной основы 3в.

## Проверки этого среза

| Проверка | Результат |
|---|---|
| API, PostgreSQL 18.6, полный набор | 1335/1335, 79 файлов |
| Web, полный набор после всех исправлений | 376/376, 34 файла |
| Shared contracts | 227/227 |
| Requirements checker tests | 24/24 |
| Сумма четырёх независимых наборов | 1962/1962 |
| API/contracts build и API/web/contracts typecheck | PASS |
| Web build и ESLint | PASS |
| Drizzle generate | 83 таблицы, no changes |
| Карта v1.4 | 288 ID, каждый ровно в одном этапе |
| GPT-6 Astra: backend, upload/cleanup, files, UI | Approved в границах реализованного среза |

Особые регрессии: 39 Products HTTP/PG; 31 Production HTTP/PG; 19 React/BFF attachment cases; 16 producer sample UI/BFF. Sibling upload race, dirty-draft scan updates, in-flight equipment upload across equivalent refetch, exact frozen version and late row callbacks проверены. Четыре новые UI-регрессии сначала воспроизвели ошибки, затем прошли после исправления.

В режиме просмотра используются сохранённые факты источника/классификаций. Отдельный own-profile editor-choices endpoint позволяет выбирать текущие площадки/сертификаты/товары до первого COW; он не подменяет frozen DTO. Сканирование обновляется только для того же fileId/versionId без замены dirty draft/editVersion. Оба поля файлов получают атомарные локальные patches даже при одной React batch.

## Фактический Azure

На `imbc-dev` установлен K3s `v1.37.2+k3s1`: Ready, системные компоненты Running, pressure=false, 3 CPU / 6.06 GiB allocatable. Kubeconfig/token `0600`; внешний 6443 недоступен. Существующие 11 контейнеров, их image IDs/uptimes/health, source и приложение `335ef02` сохранены, web/API HTTPS 200. Private app/Keycloak/globals/config copies проверены SHA и `pg_restore --list`; полного restore drill этот факт не заменяет.

Подробности: [runtime report](../deployment/verification-2026-11-16-k3s.md), [runbook](../deployment/kubernetes-dev-azure.md), [inventory](2026-11-16-azure-production-inventory.md). Новые app workloads, данные, GitLab, Argo/ESO/OpenBao/addons и Caddy cutover ещё не выполнены. Новых Azure-ресурсов и правил NSG нет.

Offline infrastructure: 14 защитных проверок, 51 core object без пропусков; 228 Helm objects — 146 core valid, 82 custom-resource schemas требуют cluster admission. Actual locked Alloy fixture, Caddy и nginx syntax PASS. Исправлены worker entrypoint, private same-inbox Mailpit, OTLP redaction и cold CI chart download. Чистое дерево без tools/chart cache также проверено.

## Следующая работа

Полный план — [production delivery](../superpowers/plans/2026-11-16-production-delivery.md). Следующая функциональная часть — [3в submission](../superpowers/plans/2026-11-16-stage3c-submission.md): канонические review tables, immutable seven-section map, точные decisions, every-Send current required-set validation, submit/unlock/return, dependency-consistent publication и recipient resolvers. Save сейчас не отправляет профиль. Реальный SME кабинет следует в этапе 5.

При каждом новом Send текущие обязательные типы сравниваются также с неизменёнными frozen sections. Старые snapshots сохраняются; новые требования требуют нового COW candidate и проверки, включая отправку только Contacts changes. Принятые, но зависимые от ещё не принятых изменений кандидаты/точные decisions удерживаются после закрытия assignment; SME outcome не переписывается, в следующем coherent cycle повторное review не требуется для того же exact subject.

До фактической приёмки 3б остаются браузерные сценарии 1280/390 и полноценный свежий Office/PDF/ClamAV/storage corpus. После новых migrations 0016–0019 повторить R1 runtime/restore/identity/hash границу перед переносом данных и edge switching; старое 3а evidence относится только к схеме через 0015.

Из источников Абая сохранены originals/hash/provenance: [аудит документации](2026-11-16-abay-documentation-audit.md), [аудит исходных данных](2026-11-16-source-data-audit.md). Это анализ источников, а не утверждение legal/NDA/UAT или подтверждение текущего доступа e-Öndiris/Adata. Canonical account NDA acceptance, policy_rule и dictionary_alias включены в полный план и ещё не реализованы.

Ни срез 3б, ни установка одного K3s-узла не завершают production goal. Открыты этапы 3в–10, Release 2, реальные источники/mappings, legal/reference/proofreading approvals, CI/GitOps/secrets reconciliation, performance/ASVS/restore/UAT на предоставленных серверах.
