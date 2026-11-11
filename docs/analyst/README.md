# Материалы бизнес-аналитика

Снимки документов Абая Жуниса (репозиторий `AZhunis/imbc-prototype`, приватный). **Живой источник — его репозиторий**; здесь лежит копия на дату папки, чтобы контекст был в одном месте. Перед работой над требованием сверяйте дату: если у Абая вышла новая редакция, обновите снимок новой папкой, старую не правьте.

## 2026-11-11

Состояние `AZhunis/imbc-prototype@b9d97f9` («Record the 11 November specification, architecture brief, and data model»).

| Файл | Что это | sha256 |
|---|---|---|
| `specification-v1.3.md` | Техническая спецификация фазы 1, v1.3 (draft for sign-off), 11.11.2026. **Источник того, что строим.** 272 требования | `f406777f…33b9ea` |
| `imbc-platform.dbml` | Логическая схема данных, 76 таблиц | `0ad4ad5e…06b973` |
| `imbc-platform.sql` | Та же схема как DDL PostgreSQL (сгенерирована из DBML) | `44d70750…a4d7` |
| `v0.5-architecture-update-brief.md` | Бриф на обновление архитектуры v0.4 → v0.5 | `911fe53f…780e0c` |

Проверено 11.11.2026: `specification-v1.3.md` побайтно совпадает с `docs/technical-specification/specification.md` в репозитории Абая; PDF спецификации содержит тот же текст и те же 272 ID; SQL загружается в PostgreSQL 18.6 без ошибок (76 таблиц, 148 внешних ключей, 38 enum).

## Чего здесь нет (читать в репозитории Абая)

| Путь в `AZhunis/imbc-prototype` | Что это |
|---|---|
| `GLOSSARY.md` | Термины и запрещённые синонимы (SME, Observer, unresponsive, STR, KTRE, e-Ondiris…) |
| `docs/adata/api.md` | Полное описание API Adata: 91 операция, 8,5 тыс. строк. Выжимка для нашего коннектора — в `docs/handoff/adata-integration-notes.md` |
| `docs/adata/absent-checks.pdf` | Какие проверки из IMBC-10 недоступны через API или на текущем токене |
| `docs/notes/2026-11-11/spec-changelog.md` | Что и почему изменили встречи 11 ноября |
| `docs/todo.md` | Открытые вопросы и сроки |
| `lib/compliance/*`, `app/api/compliance/*` | Код демо-коннектора Adata (Next.js) |
| `docs/initial-data/*` | SoW, Excel-база производителей, справочник полей e-Ondiris, образцы STR операторов |

Чтобы Claude Code видел их локально, клонируйте репозиторий рядом: `git clone https://github.com/AZhunis/imbc-prototype ../imbc-prototype` и добавьте каталог в сессию (`claude --add-dir ../imbc-prototype`).

Порядок авторитета (из брифа): спецификация → `GLOSSARY.md` → `spec-changelog.md`. Журнал решений от 2 ноября и `descoped.md` описывают прежнюю модель — поверх спецификации их не применять.
