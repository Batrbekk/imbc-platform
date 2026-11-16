# Срез 3в: отправка и проверка анкеты

Владелец поручил продолжать весь план до production с несколькими агентами и независимым GPT-6 Astra. Разрешён только существующий Azure dev-сервер; новых платных ресурсов не создавать. Рабочий checkout: `/Users/batyrbekkuandyk/Desktop/imbc-platform/.claude/worktrees/stage-3`, ветка `feat/stage-3-profile`.

## Зафиксированный код и проверка

- Backend/contracts: `03c4722`, 63 явно выбранных файла.
- Web: `0b3dbec741c92dfe5d65390f6cd546a863c9cce6`, 17 файлов.
- Оба checkpoint отправлены в [GitHub](https://github.com/Batrbekk/imbc-platform/tree/0b3dbec741c92dfe5d65390f6cd546a863c9cce6). Последующие изменения NDA и инфраструктурные файлы не входят в этот срез.

| Проверка                                                    | Результат                                 |
| ----------------------------------------------------------- | ----------------------------------------- |
| Полный API, реальный PostgreSQL 18.6                        | 1477/1477, 87 файлов                      |
| Полный web после исправления замечаний                      | 396/396                                   |
| Contracts                                                   | 251/251                                   |
| Тесты requirements checker                                  | 24/24                                     |
| Сумма четырёх наборов                                       | 2148/2148                                 |
| API/contracts build и typecheck; web build/typecheck/ESLint | PASS                                      |
| Drizzle generate                                            | 87 таблиц; no changes                     |
| Карта v1.4 после добавления новых файлов в Git              | 288 ID, каждый ровно в одном этапе        |
| Независимый GPT-6 Astra review                              | Approved в границах реализации checkpoint |

Astra читал код и интеграционные assertions независимо; полный запуск тестов выполнял координатор. После финального полного прогона изменено только форматирование уже проверенных API/contracts файлов; build/typecheck и diff-check повторно прошли. Проверка миграционного SQL выполнена реальным PostgreSQL, а не Prettier.

## Поведение среза

Send требует отдельной галочки точности и фиксирует показанный вектор семи редакций. Один ключ операции воспроизводит первоначальный результат, включая после сетевого сбоя; конфликт требует успешного перечитывания и нового подтверждения. Закрытие диалога не снимает это требование. Сервер заново проверяет обязательные поля, сегодняшние required type sets всех разделов, точные PASSED версии файлов и согласованность связанных разделов. Отправка, captures, immutable map, pointers, аудит и NOT-04 фиксируются одной транзакцией.

Canonical `review_assignment` и `review_decision` добавлены миграцией `0020`. Полная карта отправки неизменяема; database-managed assignment/decision order определяет действительно последнее решение. `0021` сериализует изменение состава обязательных справочников с Send. Старые plural таблицы и R1 view сохранены. Working, pending и durable candidate имеют отдельное значение; новая COW-редакция не наследует решение старой строки.

Unlock закрывает текущую проверку, сохраняет кандидатов и точные принятые решения, очищает только pending pointers и ставит NOT-10 вместе с аудитом. Уже опубликованные verified values не заменяются. Повторная отправка может использовать принятую, но ещё не опубликованную редакцию без лишней COW; активная canonical assignment блокирует редактирование даже при отсутствии pending pointers.

Внутренний SME service реализует take, точные решения и окончательный результат. Первичная полная проверка публикует семь принятых разделов; возврат сохраняет принятые кандидаты. Изменения Verified публикуют максимальное согласованное множество принятых разделов. Зависимые принятые кандидаты сохраняются для следующего цикла; их outcome не переписывается. NOT-05 и аудит входят в ту же pg-boss transaction. Публичный SME кабинет и его HTTP workflow остаются этапом 5.

Demo CLI закрыт `SEED_DEMO=true`, persisted `.local` SME/producer и immutable contact checks; он не запускает worker или автоматическую проверку. Producer own review DTO возвращает исходную позицию, названия/номер из точной исторической строки и имя captured file version. UI не подставляет текущую COW-строку. Статусы документов/сертификатов учитывают exact item/file decisions, доступность evidence и срок действия; legacy frozen status сохраняется до retirement R1.

NOT-31: первая Verified начинается с active; начальный anchor — день создания профиля в Asia/Almaty. Новый принятый SME change сдвигает anchor, включая сохранённый зависимый кандидат; unchanged retained acceptance, Save, Send и Unlock этого не делают. Outdated/unresponsive автоматически не сбрасываются.

## Границы runtime и следующая работа

Локальный cached R1 `imbc/api:r1-e22ce6b-acceptance` прошёл семь HTTP/DTO/SQL probes через `0021`: создание восьми legacy sections, идемпотентный Draft bootstrap, два own scopes, игнорирование чужого selector и anonymous 401. Это закрытая fixture auth и SELECT role; она не подтверждает OIDC, worker, фактический public image `335ef02` или полный rollback. Реальная граница старого сервера устанавливается по восстановленному journal и его actual OCI image.

Локальный browser cycle завершён на настоящем compiled API, PostgreSQL и pg-boss: desktop1280×900, mobile390×844, en/ru/kk; Draft → Send → Submitted → take → UnderReview → Unlock → Send → Return → Contacts COW → resubmit → Verified. Зафиксированы93 API requests, ноль HTTP/console errors, три закрытых assignments и шесть ID-only queue jobs без email payload. Это закрытая fixture session auth: проверка не подтверждает OIDC/MFA, реальные file bytes/scanner/storage/SMTP. Временные servers остановлены, QA tab закрыт; приватный harness `/tmp/imbc-3c-browser-8f6iqvgs` содержит report и screenshot без Git-публикации.

В Azure свежий отдельный K3s-стенд остаётся на `8d48bbd`, миграциях0000–0019. [Фактическая проверка3б](../deployment/verification-2026-11-16-stage3b-k3s.md) подтверждает девять Ready pods, private buckets, ClamAV PONG, capture SMTP и сохранность старого публичного стека. 3в ещё не поставлен на сервер. Реальная OIDC/Office/PDF/storage приёмка, R1 и edge switching остаются отдельными действиями. Same-VM restore подтвердил row/PK evidence и167 FK; расширенная сверка schema catalogs проходит уточнение после замечания Astra и пока не объявлена полной.

Следующий NDA expand0022 реализован отдельно: durable `account_nda_acceptance`, original registration ticks, все версии и composite profile links;40 real PG/HTTP +2 contracts passed, Astra Approved. Неизвестный actor старого согласия не угадывается. Для повторного законного принятия той же версии при unresolved append-only legacy row сохранён expand-only bridge; новые читаемые consent facts всегда происходят из canonical account evidence. Этот срез не входит в указанные2148 tests/commits3в; MAN-02 registration resend, NDA UI и contract R1 остаются отдельными задачами. DB-authoritative release policy0023 проходит отдельное ревью и проверки; изолированный слой e-Ondiris получил Astra Approved после двух исправлений,65 pure +17 PG тестов, без ещё не выполненной queue/COW/live integration.

Далее — источники/DD, полноценные SME/operator/director/observer/LPS кабинеты, актуальность, миграции, Release 2 и эксплуатационная поставка по [полному плану](../superpowers/plans/2026-11-16-production-delivery.md). Это готовая реализация checkpoint 3в, а не production/UAT acceptance всего проекта.
