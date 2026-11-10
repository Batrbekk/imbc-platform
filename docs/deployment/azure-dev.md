# IMBC: dev-среда в Azure

Конфигурация одного dev-сервера для Docker-стека IMBC. Здесь используются вымышленные демо-данные и Mailpit с Azure Communication Services SMTP relay: настоящие адреса получают письма, письма демо-адресам `.local` остаются в Mailpit. Для шести seed-аккаунтов и отдельного тестового администратора задан OTP `000000` без письма; исключение ограничено списком UUID и ожидаемых ролей. Общая авторизация использует собственные экраны IMBC на shadcn/ui; предметные кабинеты ролей ещё разрабатываются. Эта инструкция описывает конфигурацию и обслуживание, а результаты проверки конкретного развёртывания фиксируются отдельно.

## Ресурсы и адреса

| Параметр | Значение |
|---|---|
| Resource group | `imbc-dev-rg` |
| VM | `imbc-dev` |
| Регион | Poland Central, `polandcentral` |
| Размер | `Standard_D4as_v5`: 4 vCPU, 16 ГБ RAM |
| ОС | Ubuntu 24.04 LTS |
| Диск | Standard SSD LRS, 128 ГБ |
| Статический публичный IP | `20.215.209.224` |
| DNS | `imbc-dev-e1cde8dd.polandcentral.cloudapp.azure.com` |
| SSH-пользователь | `imbc` |
| SSH-ключ на локальной машине | `~/.ssh/imbc-dev-azure` |
| Исходники и серверная конфигурация | `/home/imbc/imbc-platform` |

Платформа: [https://imbc-dev-e1cde8dd.polandcentral.cloudapp.azure.com](https://imbc-dev-e1cde8dd.polandcentral.cloudapp.azure.com).

| Сервис | Ссылка |
|---|---|
| OpenAPI | [API docs](https://imbc-dev-e1cde8dd.polandcentral.cloudapp.azure.com/api/docs) |
| API readiness | [Health ready](https://imbc-dev-e1cde8dd.polandcentral.cloudapp.azure.com/api/health/ready) |
| Mailpit | [Письма и коды входа](https://imbc-dev-e1cde8dd.polandcentral.cloudapp.azure.com/dev-mail/) |
| Keycloak admin | [Консоль Keycloak](https://imbc-dev-e1cde8dd.polandcentral.cloudapp.azure.com/kc/admin/) |

## Доступ и секреты

HTTPS/443 доступен всем получателям ссылок, в том числе с мобильных устройств и из других сетей. SSH/22 ограничен в NSG адресами из `ALLOW_FROM` (по умолчанию текущий IP разработчика). HTTP/80 доступен для ACME-проверок сертификата и перенаправления на HTTPS. Caddy завершает TLS и передаёт запросы прямо в API, Web, Keycloak или Mailpit. Сервисы данных не имеют публичных портов; диагностические порты nginx/8080, Mailpit/8025 и RustFS console/9001 слушают только localhost VM.

Caddy разрешает `/dev-mail/`, `/kc/admin/` и `/kc/realms/master/` только адресам из серверной `ADMIN_ALLOWED_IPS`. Проверяется адрес TCP-соединения, а не переданный клиентом `X-Forwarded-For`; регистр, завершающие слеши и неоднозначные пути не обходят ограничение. При отсутствии переменной разрешён только loopback. Пользовательский realm IMBC, формы входа, ресурсы темы и регистрация остаются публичными. Mailpit дополнительно требует свой пароль.

Подключение из локального репозитория:

```bash
./infrastructure/azure/deploy.sh ssh
```

Или напрямую:

```bash
ssh -i ~/.ssh/imbc-dev-azure imbc@20.215.209.224
```

Основная конфигурация и секреты хранятся на VM в `/home/imbc/imbc-platform/.env` с правами `0600`. Отдельный SMTP relay-секрет находится в `infrastructure/mailpit/.env.smtp-relay.yaml`, также `0600`. Скрипт создаёт основную `.env` при первом запуске, сохраняет серверные файлы при обновлениях и не выводит секреты через `info`. Нужные значения основной `.env` доступны через SSH:

- `KEYCLOAK_DEV_USER_PASSWORD` — начальный пароль демо-пользователей; адреса и роли перечислены в разделе 11 README.
- `ADMIN_ALLOWED_IPS` — разрешённые IP/CIDR через пробел для служебных страниц; при первой настройке берётся `ALLOW_FROM` и loopback, после этого значение сохраняется.
- `MAILPIT_UI_AUTH` — логин и пароль Mailpit в формате `логин:пароль`. После входа откройте письмо адресату и используйте код для входа в платформу.
- `KEYCLOAK_ADMIN_USER` / `KEYCLOAK_ADMIN_PASSWORD` — отдельная консоль администрирования Keycloak.
- `S3_ACCESS_KEY` / `S3_SECRET_KEY` — консоль S3.

Mailpit хранит копии отправленных кодов входа и ссылок установки пароля. OTP для явно настроенных демо-аккаунтов не отправляется и в Mailpit не появляется; остальные письма этим адресам сохраняются в Mailpit. Для реальных получателей доставка уже подключена через Azure SMTP relay; адреса `.local` наружу не пересылаются. Настройки и ограничения описаны в разделе «Реальная почта» ниже.

Консоль S3 доступна через туннель, который нужно оставить работающим:

```bash
ssh -i ~/.ssh/imbc-dev-azure -N -L 9001:127.0.0.1:9001 imbc@20.215.209.224
```

Затем откройте [http://127.0.0.1:9001](http://127.0.0.1:9001) на своей машине.

## Обновление приложения

Из корня локального репозитория с действующим `az login`:

```bash
./infrastructure/azure/deploy.sh redeploy
```

Команда отправляет текущие локальные исходники, включая ещё не закоммиченные изменения, пересобирает контейнеры, синхронизирует управляемые настройки realm и проверяет готовность Compose и HTTPS API. Локальные `.env*`, `.git`, зависимости и результаты сборки не загружаются; версионируемые `.env.example` передаются отдельно. Существующие серверные `.env` и relay-секрет, Docker volumes с данными и тома TLS Caddy сохраняются. Автоматическое применение миграций выполняет сервис `migrate`.

Если внешний IP изменился, выполните `up` с новым `ALLOW_FROM`: он обновляет только SSH allowlist. Для доступа к служебным страницам одновременно задайте `ADMIN_ALLOWED_IPS`; существующее значение не заменяется автоматически. Публичный сайт не привязан к этим IP.

```bash
./infrastructure/azure/deploy.sh up
```

Для заранее заданного адреса:

```bash
ALLOW_FROM=1.2.3.4/32 ADMIN_ALLOWED_IPS="1.2.3.4/32 127.0.0.1/32 ::1/128" ./infrastructure/azure/deploy.sh up
```

Сначала `up` применяет и проверяет Caddy, включая отказ служебных маршрутов для недоверенного Docker-клиента, и только затем открывает HTTPS/443 в NSG для Internet. Обычный `redeploy` не меняет NSG и сохраняет `ADMIN_ALLOWED_IPS`, если новое значение не передано явно. Все остальные ключи и секреты `.env` сохраняются.

`up` использует существующую VM, если она найдена; остановленную и освобождённую VM сначала запустите командой из раздела ниже. Посмотреть актуальные адреса без вывода секретов:

```bash
./infrastructure/azure/deploy.sh info
```

Realm Keycloak импортируется только при первом создании. После каждого развёртывания `infrastructure/azure/sync-realm.py --theme imbc` обновляет разрешённый набор настроек темы, политик, событий, SMTP и клиента BFF из `imbc-realm.json` и серверной `.env`. Пользователи, client secrets и посторонние настройки сохраняются; повторный импорт realm не выполняется. Изменения управляемых полей только в консоли будут заменены следующей синхронизацией.

Смена домена или OIDC-секретов требует согласованной миграции Keycloak и серверной `.env`. Скрипт сохраняет существующую конфигурацию и останавливается, если её HTTPS-параметры не соответствуют ожидаемым.

## Статус и логи на VM

После подключения по SSH:

```bash
cd /home/imbc/imbc-platform
sudo docker compose -f compose.yaml -f compose.azure.yaml ps -a
sudo docker compose -f compose.yaml -f compose.azure.yaml logs --tail 100 api worker caddy
sudo docker compose -f compose.yaml -f compose.azure.yaml logs --tail 100 keycloak migrate
sudo docker stats --no-stream
df -h /
```

Для всех операций на этом сервере указывайте оба файла Compose. Обычные команды `make up` и `docker compose up` используют базовую конфигурацию без Azure HTTPS-overlay и не заменяют приведённые команды.

Проверка публичного API из любой сети:

```bash
curl --fail --show-error https://imbc-dev-e1cde8dd.polandcentral.cloudapp.azure.com/api/health/ready
```

## Временная остановка и стоимость

Ориентир при непрерывной работе — около **165 USD в месяц** за VM, диск 128 ГБ и статический публичный IP по розничным тарифам Azure. Переменные расходы, в том числе исходящий трафик и доставка почты ACS, в эту оценку не включены. Кредиты и скидки применяются согласно условиям подписки; её фактическая стоимость и остаток кредитов здесь не проверены.

Чтобы остановить среду и прекратить оплату вычислений, выполните локально:

```bash
az vm deallocate -g imbc-dev-rg -n imbc-dev
```

При состоянии `VM deallocated` вычисления не тарифицируются; диск и статический IP продолжают оплачиваться. Данные и серверная `.env` сохраняются. Остановка только гостевой ОС или контейнеров не освобождает вычислительный ресурс Azure.

Возобновить работу:

```bash
az vm start -g imbc-dev-rg -n imbc-dev
./infrastructure/azure/deploy.sh up
```

Второй шаг обновляет SSH-доступ для текущего IP, разворачивает текущий код и проверяет готовность. Для обычной остановки удаление контейнеров, Docker volumes или resource group не требуется.

## Реальная почта

Azure Email Service `imbc-dev-email`, Communication Service `imbc-dev-acs` и управляемый Azure-домен находятся в той же resource group. API и Keycloak отправляют SMTP в Mailpit; Mailpit v1.33.1 пересылает настоящие адреса через `smtp.azurecomm.net:587` с STARTTLS. Демо-адреса `.local` и другие зарезервированные тестовые домены остаются в Mailpit. Получение первого тестового письма во входящих подтверждено пользователем.

Relay-секрет хранится только на VM: `infrastructure/mailpit/.env.smtp-relay.yaml` (0600). Переменные `.env`: `MAILPIT_RELAY_CONFIG=/etc/mailpit/.env.smtp-relay.yaml`, `MAILPIT_RELAY_ALL=true`. Файл исключён из Git, Docker-контекста и загрузки исходников. Пароль принадлежит выделенному Entra-приложению `imbc-dev-smtp`; права ограничены созданным Communication Service. Секрет выдан на один год, его необходимо заменить до истечения.

У временного Azure-managed домена лимит 5 писем в минуту и 10 в час на подписку. Автоматические тесты используйте с `.local`; перед активным приглашением пользователей подключите собственный домен.

## Компоненты UI и MCP

В Codex настроен официальный MCP `shadcn`, запускаемый через `npx -y shadcn@latest mcp --cwd <repository>/apps/web`. Сервер проверен настоящими вызовами tools/list, поиска и чтения компонентов. Если MCP отсутствует в списке инструментов уже открытого чата, он загрузится при следующем запуске клиента; сервер также доступен обычным MCP-клиентам через STDIO.

Формы приложения используют shadcn/ui; видимые экраны идентификации для всех ролей собираются отдельно из React + Keycloakify + shadcn/ui в `infrastructure/keycloak/identity` и входят в образ `imbc/keycloak:dev`. Стандартные формы провайдера пользователю не показываются. Начальный вход ведёт через BFF на собственную форму IMBC; успешный выход возвращает на подтверждение `/login?logged_out=1`.

Источники: [shadcn MCP](https://ui.shadcn.com/docs/mcp), [Codex MCP](https://developers.openai.com/codex/mcp/), [ACS SMTP](https://learn.microsoft.com/en-us/azure/communication-services/quickstarts/email/send-email-smtp/smtp-authentication), [Mailpit relay](https://mailpit.axllent.org/docs/configuration/smtp-relay/).

Автоматические проверки общего auth-среза: 83 теста API (из них 28 на отдельной PostgreSQL 18), 23 contracts и 4 web. Они не подтверждают прохождение всех браузерных сценариев конкретного развёртывания. Объём дальнейшей работы и критерии приёмки по ролям — в [development-roadmap.md](../development-roadmap.md).

Результаты приёмки работающего стенда: [verification-2026-11-10.md](verification-2026-11-10.md).

<a id="тестовый-администратор-с-фиксированным-кодом"></a>

## Демо-аккаунты с фиксированным кодом

На текущем dev-стенде OTP `000000` без отправки письма доступен семи аккаунтам. UI для всех ролей прямо сообщает: «Тестовый аккаунт: код 000000. Письмо не отправляется».

| Аккаунт | Ожидаемая роль в конфигурации | Источник настройки |
|---|---|---|
| `expert@imbc.local` | `expert` | `DEV_FIXED_OTP_ACCOUNTS` |
| `admin@imbc.local` | `administrator` | `DEV_FIXED_OTP_ACCOUNTS` |
| `director@imbc.local` | `director` | `DEV_FIXED_OTP_ACCOUNTS` |
| `operator@operator.local` | `operator` | `DEV_FIXED_OTP_ACCOUNTS` |
| `spectator@spectator.local` | `spectator` | `DEV_FIXED_OTP_ACCOUNTS` |
| `manufacturer@demo.local` | `manufacturer` | `DEV_FIXED_OTP_ACCOUNTS` |
| `test-admin@imbc.local` | `administrator` | совместимый `DEV_FIXED_OTP_USER_ID` |

Пароли остаются прежними и обязательными. Начальный пароль seed-аккаунтов хранится в `KEYCLOAK_DEV_USER_PASSWORD` серверной `.env`; пароль отдельного тестового администратора — в локальном файле владельца `~/.config/imbc/test-admin-access.md` (0600), вне Git. Права ролей, принятие ответственности, сроки сеанса, лимит пяти попыток, срок кода 10 минут и пауза повторного запроса 60 секунд сохраняются. Производитель открывает `/profile`, администраторы — `/account`, остальные роли — `/catalog`. Каталог, dashboard и профиль производителя администраторам недоступны; интерфейс управления другими аккаунтами ещё не реализован.

Исключение включается явными серверными настройками. Формат примера ниже требует подстановки настоящих UUID из `user_accounts`; email вместо UUID не подходит:

```dotenv
DEPLOYMENT_ENV=development
DEV_FIXED_OTP_ENABLED=true
DEV_FIXED_OTP_ACCOUNTS='[{"id":"<UUID expert@imbc.local>","role":"expert"},{"id":"<UUID admin@imbc.local>","role":"administrator"},{"id":"<UUID director@imbc.local>","role":"director"},{"id":"<UUID operator@operator.local>","role":"operator"},{"id":"<UUID spectator@spectator.local>","role":"spectator"},{"id":"<UUID manufacturer@demo.local>","role":"manufacturer"}]'
DEV_FIXED_OTP_USER_ID=<UUID test-admin@imbc.local>
```

По умолчанию tier — `production`, флаг выключен, `DEV_FIXED_OTP_ACCOUNTS=[]`. Список содержит объекты строго с полями `id` и `role`. Неверный JSON, недопустимые UUID/роли, повтор UUID и совпадение UUID из списка с legacy-настройкой отклоняются при старте даже при выключенном флаге. Включённый флаг требует `development` и хотя бы одну запись в списке или legacy UUID. `DEV_FIXED_OTP_USER_ID` остаётся совместимым способом разрешить отдельного администратора и не даёт исключения другим ролям. `NODE_ENV=production` означает оптимизированную сборку и не заменяет явный deployment tier.

При выдаче и проверке OTP сервер требует точное совпадение UUID и текущей роли с разрешённой парой. Выбор не зависит от email, домена `.local` или самого наличия роли: остальные аккаунты, включая новых производителей, получают случайные коды по почте. Включение `SEED_DEMO` само по себе список не заполняет и фиксированный OTP не разрешает.

Для отключения всего исключения задайте `DEV_FIXED_OTP_ENABLED=false`. Для отдельного seed-аккаунта удалите его пару из `DEV_FIXED_OTP_ACCOUNTS`; для отдельного тестового администратора очистите `DEV_FIXED_OTP_USER_ID`. Если после удаления не осталось разрешённых аккаунтов, также выключите флаг. Примените окружение пересозданием API/worker с обоими Compose-файлами или через `redeploy`. Удаление разрешения, выключение флага либо несовпадение текущей и ожидаемой роли делает уже выданный фиксированный код недействительным.

Отключение фиксированного OTP не блокирует аккаунты и не отзывает уже созданные сеансы или доверенные устройства. Для полного прекращения доступа нужна отдельная операторская деактивация аккаунта и отзыв его сеансов и устройств; пользовательского интерфейса для этой операции пока нет.
