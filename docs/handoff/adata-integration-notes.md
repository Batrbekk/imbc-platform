# Adata: заметки для коннектора

Выжимка из `AZhunis/imbc-prototype`: `docs/adata/api.md` (снято с api-docs.adata.kz 10.11.2026), `docs/adata/absent-checks.pdf` (11.11.2026) и кода демо `lib/compliance/*`. Требования: IMBC-07…IMBC-14, EXT-01…EXT-05, MAN-06, MAN-07 спецификации v1.3.

Степень изученности `api.md`: полностью — вводные разделы, каталог операций, «Полная информация» (rate 76); поля операций 14, 15, 17, 24, 36, 37, 40, 53, 112, 119, 120, 122, 125 и описания 126/127. Остальные ~70 операций — только название и URL. Перед реализацией конкретного метода читайте его раздел в `api.md`.

## Как устроен вызов

- База: `https://api.adata.kz`. Токен авторизации — **в пути URL** (`{tokenAuth}`), не в заголовке.
- Long polling в два шага:
  1. Get Request: `GET /api/company/info/{tokenAuth}?iinBin={БИН}` → `{ success, token }` (токен проверки, строка из цифр).
  2. Check Request: `GET /api/company/info/check/{tokenAuth}?token={token}` → пока готовится: HTTP 200, `success: true`, `message: "wait"`, `data: null`; готово: `message: "ready"` и заполненный `data`.
- Опрашивать раз в 5–10 секунд; Adata заявляет максимум 90 секунд. `success: true` не означает готовность — смотреть `message`.
- Check URL общий для большинства операций по компании; для физлиц — `/api/individual/info/check/…`, для схем связей — `/api/company/relation-scheme/check/…`.
- Модуль не входит в токен: HTTP 403, `{ success: false, data: null, message: "modules not connected" }`. Токен проверки не выдаётся.
- Ошибки: 400 (неверный БИН / токен проверки), 500 `Something went wrong`.
- Лимит частоты в документации не описан. По спецификации лимит — не находка (IMBC-07).
- Остаток квоты (в `api.md` нет, взято из кода демо): `GET /api/v1/statistic/token-info/{tokenAuth}` → `data.remaining_requests_number`, `data.default_requests_number`, `data.coming_refresh_date`. Квота — 3 000 БИН в месяц, сброс 4 декабря 2026.

## Следствия для реализации у нас

- Запрос выполняет **worker** (задание pg-boss), а не HTTP-обработчик: ответ может идти до 90 секунд, одна проверка разворачивается в несколько вызовов.
- Токен читать из `ADATA_API_TOKEN` (EXT-02, NFR-10). Так как он в пути URL, URL Adata нельзя писать в логи, тексты ошибок и трассировки как есть — вырезать сегмент токена.
- Недоступность сервиса, `wait` после тайм-аута, 403 по модулю и отсутствие строки — это не «clear» и не находка (IMBC-10, IMBC-14, EXT-04).
- Проверка — при создании профиля (тем же чтением, что и предзаполнение) и раз в квартал от последней проверки; не при каждом открытии профиля (IMBC-07).

## Что есть в «Полной информации» (rate 76)

Единственный модуль, подключённый на текущем токене.

| Блок `data.*` | Содержимое | Для чего |
|---|---|---|
| `basic` | `name_ru`, `name_kz`, `short_name`, `biin`, `legal_address`, `legal_address_kz`, `oked`, `okeds[]`, `secondary_okeds[]`, `fullname_director`, `director_iin`, `director_start_date`, `date_registration`, `legal_form`, `employee_count`, `is_nds_payer`, `krp`, `unreliable_zakup`, `is_non_resident`, `counterparty_type` | Предзаполнение MAN-07: юр. адрес, директор, дата регистрации, правовая форма; название и вид деятельности — только если e-Ondiris пуст (MAN-06). `employee_count` для численности не использовать (MAN-17) |
| `kzCoContact` | `phones[]`, `emails[]`, `websites[]` | Телефон и контактный email компании после e-Ondiris (MAN-06) |
| `founders` | `founders_cnt`, `founders_dtl[]`: `name`, `founder_uin`, `is_company`, `start_date` | Акционеры (MAN-21). **Доли и гражданства нет** — предзаполняется только имя |
| `status` | `company_status`, `pseudo_company`, `bankcrupt`, `inactive`, `absent_at_address`, `registration_invalid`, `violation_tax`, `tax_debt` | Проверки «Company. Enterprise / Finance» |
| `riskFactor.company` | банкротство, ликвидация, запрет выезда, исполнительные производства, аресты, запреты регистрационных и нотариальных действий, `tax_risk_degree`, `irresponsible_taxpayer`, `encumbrance`, решения о банкротстве/реабилитации | То же |
| `riskFactor.head` | терроризм, розыск, алименты, должник, аресты, запреты, `tax_debt`, `litigation` (счётчики дел) | Проверки «Director» |
| `taxDeductions` | `sum`, `details[]: { year, amount }` | «Company. Tax payments»: ноль за последний год — critical (IMBC-14) |
| `litigation` | `total_civil_count`, `total_criminal_count`, `total_administrative_count`, `court_cases[]` | Участие в судах — «shown only», внимание при счётчике > 0 |
| `trustworthyExtended`, `kzCoTrustworthyPlus`, `riskFactorExtended`, `contract`, `connectedDiagram`, `licenseGeneral`, `trustworthyAnalytics`, `requisites`, `taxpayer` | Описаны в схеме ответа | По `absent-checks.pdf` соответствующие модули на текущем токене выключены — на заполненность не рассчитывать, проверить на реальном ответе |

## Покрытие IMBC-10

В таблицах IMBC-10 116 строк: предприятие 41, финансы 5, закупки 13, директор 23, учредитель/бенефициар 34 (101 «scored», 15 «shown only»). Демо на текущем токене читает 47 проверок.

**В API нет поля (9 строк отчёта):** финансовая пирамида ×3 (расследование идёт / закрыто / приговор); юрлицо с офшорным участием; реестр получающих деньги из-за рубежа; перерегистрация признана недействительной; реестр доверенного ПО и электроники; неблагонадёжный поставщик Назарбаев Университета; личное банкротство физлица.

**Метод есть, модуль выключен — 403 (31 строка отчёта):**

| Модуль | Метод | Строки |
|---|---|---|
| Благонадёжность, расширенные признаки+ | `GET /api/company/trustworthy-plus/{tokenAuth}` | массовый адрес; таможенные проверки; профилактический контроль; реестр торгов арестованного имущества; объявления о реабилитации и собраниях кредиторов; проблема в другой компании руководителя |
| Благонадёжность, неблагонадёжные реестры | `GET /api/company/trustworthy-extended/{tokenAuth}` | исключён из stat.gov; крупные налогоплательщики; приостановлены ЭСФ; долг > 150 МРП; арест транспорта; меры воздействия и санкции; банкротство завершено; начат реабилитационный период |
| Реестр проверок и имущества | `GET /api/company/risk-check/{tokenAuth}` | проверки по труду; исключён из списка финансирования терроризма |
| Штрафы | `GET /api/company/fine/{tokenAuth}` | административные штрафы |
| Участие в закупках | `GET /api/company/participation-in-purchases/{tokenAuth}` | участие в госзакупках; топ-100; участник и товаропроизводитель Самрук-Казына; ненадёжный поставщик Самрук-Казына, НИШ, Нацбанка, Mitwork; подробный реестр недобросовестных |
| Государственные контракты | `GET /api/company/contract/{tokenAuth}` | количество и сумма контрактов |
| Налоговая информация | `GET /api/company/tax-mode/{tokenAuth}` | режим налогообложения |
| Аффилированность | `GET /api/company/relation-scheme/affiliation-by-type/{tokenAuth}` | сестринские компании (в результат не входят, IMBC-12) |
| Санкции | `GET /api/company/sanction/{tokenAuth}`, `GET /api/v2/company/sanction/{tokenAuth}` (поиск по `keyword`, без опроса) | санкционные списки |
| Физические лица | `GET /api/individual/basic|trustworthy|court-case/{tokenAuth}` (по ИИН) | все реестры учредителя и бенефициара как физлица |

Вывод: пока модули не подключены, автоматический результат опирается на меньшую часть списка IMBC-10, а таблица «Founder, and each beneficiary» не читается совсем. Это вопрос к IMBC/Абаю (issue #2 в его репозитории: «get requirements for adata's due diligence process»).

## Расхождения демо со спецификацией

| Что | Демо | Спецификация |
|---|---|---|
| Налоги за последний год = 0 | attention | critical (IMBC-14) |
| Ожидание ответа | 35 секунд, шаг 2 секунды, внутри HTTP-запроса | Adata: до 90 секунд, шаг 5–10 секунд |
| Группы | Enterprise, Finance, Procurement, Tax, Director | группы отчёта из IMBC-10, плюс Founder/Beneficiary |
| Метки строк | critical / attention / clear | clear / finding / shown only / no answer (IMBC-10), а critical/attention — производные (IMBC-14) |
| Хранение | не хранит | `due_diligence_record` + `due_diligence_check` |

## Наблюдение по квоте

11.11.2026 запуск демо по БИН 160940010447 (образец из спецификации) уменьшил остаток с 2 992 до 2 991, хотя подсказка на экране говорит, что повторный БИН в периоде не списывается. Не проверено, читался ли этот БИН ранее в текущем периоде. До выяснения считать, что каждый запуск может списывать квоту; квартальную перепроверку и миграцию (~816 БИН разом, IMBC-07) планировать с учётом лимита.
