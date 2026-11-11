# IMBC Platform

Реестр проверенных казахстанских производителей для IMBC, операторов и наблюдателей. Монорепозиторий: `apps/api` (NestJS: API + BFF, worker, migrate), `apps/web` (Next.js App Router, shadcn/ui), `packages/contracts` (общие схемы, перечисления, матрица прав).

@AGENTS.md

## С чего начать

1. `docs/handoff/2026-11-11-context.md` — состояние проекта, принятые решения, разрыв между кодом и спецификацией, открытые вопросы. Читать первым.
2. `docs/development-roadmap.md` — порядок работ и критерии приёмки.
3. `README.md` — архитектура в коде, запуск, конфигурация.

## Источники истины

По убыванию авторитета:

1. `docs/analyst/2026-11-11/specification-v1.3.md` — что строим. Требование читать в тексте, а не по памяти.
2. Глоссарий и остальные документы аналитика — `AZhunis/imbc-prototype` (см. `docs/analyst/README.md`).
3. `docs/analyst/2026-11-11/imbc-platform.dbml` — модель данных аналитика.
4. `docs/analyst/2026-11-11/v0.5-architecture-update-brief.md` и архитектура v0.4.

Снимки в `docs/analyst/<дата>/` не редактировать: новая редакция — новая папка.

## Правила

- Ссылайтесь на ID требований (`MAN-25`, `UPD-04`) в комментариях к коду, тестах и коммитах.
- Термины — из глоссария: observer (не spectator), unresponsive (не inactive для профиля), SME, STR, KTRE, e-Ondiris.
- Права проверяет сервер по `packages/contracts/src/policy.ts`; интерфейс только прячет недоступное (GEN-08).
- Каталог, выгрузки, pull API и дашборд читают только проекцию видимых профилей, не рабочие таблицы.
- Токен Adata передаётся в пути URL: не писать URL Adata в логи и ошибки. Заметки по коннектору — `docs/handoff/adata-integration-notes.md`.
- Запуск проверки Adata расходует квоту заказчика (3 000 БИН в месяц). В тестах — заглушка; реальный вызов только по прямой просьбе.
- Миграции БД совместимы с предыдущей версией приложения: expand → migrate → contract (NFR-06).

## Команды

```bash
pnpm install
pnpm dev                                   # web :3000, api :3001
pnpm typecheck && pnpm test && pnpm build
pnpm --filter @imbc/api db:generate        # SQL-миграция из изменений схемы Drizzle
docker compose config -q                   # проверка compose
```

Интеграционные тесты API требуют PostgreSQL 18 — условия в разделе 14 `README.md`. Развёртывание на dev-стенд — `docs/deployment/azure-dev.md`.
