# IMBC: dev-среда в Azure

Конфигурация одного dev-сервера для Docker-стека IMBC. Здесь используются вымышленные демо-данные и Mailpit с Azure Communication Services SMTP relay: настоящие адреса получают письма, письма демо-адресам `.local` остаются в Mailpit. Для шести seed-аккаунтов и отдельного тестового администратора задан OTP `000000` без письма; исключение ограничено списком UUID и ожидаемых ролей. Общая авторизация использует собственные экраны IMBC на shadcn/ui; у ролей есть стартовые страницы и демо-экраны только для чтения, предметные кабинеты ещё разрабатываются. С 12.11.2026 стенд работает на спецификации v1.3 — см. [Переход на спецификацию v1.3](#переход-на-спецификацию-v13); этап 1 (регистрация, организации, аккаунты) выкачен 13.11.2026 (`306b58e`), этап 2 (справочники, файлы, уведомления) реализован в ветке `feat/stage-2-foundation` и на стенд не выкачен — [порядок выката](#справочники-файлы-и-уведомления-этап-2). Эта инструкция описывает конфигурацию и обслуживание, а результаты проверки конкретного развёртывания фиксируются отдельно.

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

Исходники сначала попадают во временный каталог на VM, затем `deploy.sh` запускает от root `infrastructure/azure/vm-deploy.sh` — тот же скрипт, что и [конвейер](#конвейер-развёртывания): блокировка от параллельного развёртывания, проверка `.env`, дополнение каталога приложения через `rsync` (файлы, удалённые локально, на сервере, как и раньше, остаются), Compose, realm и проверки. Ход выводится в терминал и сохраняется в `/var/log/imbc-deploy/`; в `.deployed-source-commit` записывается локальный `HEAD`. На VM нужен `rsync` (на новых VM ставится cloud-init).

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

Realm Keycloak импортируется только при первом создании. После каждого развёртывания `infrastructure/azure/sync-realm.py --theme imbc` обновляет разрешённый набор настроек темы, политик, событий, SMTP и клиента BFF из `imbc-realm.json` и серверной `.env`. Ещё один шаг — профиль пользователя realm (MAN-05): скрипт читает его (`kcadm.sh get users/profile`), у атрибутов `email` и `username` ставит `edit: ["admin"]` (просмотр — `admin` и `user`), у `firstName` и `lastName` снимает `required`, всё остальное оставляет как есть и записывает профиль обратно, только если что-то изменилось; в выводе — строка `User profile: email and username editable by admin only, first and last name optional (updated: email, username; optional: firstName, lastName)` или `… (already set)` при повторе. Пользователи, client secrets и посторонние настройки сохраняются. Повторный импорт realm не выполняется. Изменения управляемых полей только в консоли будут заменены следующей синхронизацией.

Смена домена или OIDC-секретов требует согласованной миграции Keycloak и серверной `.env`. Скрипт сохраняет существующую конфигурацию и останавливается, если её HTTPS-параметры не соответствуют ожидаемым.

## Конвейер развёртывания

Workflow [`.github/workflows/deploy-dev.yml`](../../.github/workflows/deploy-dev.yml) обновляет стенд без SSH и без хранимых секретов — процедура развёртывания по NFR-05. Секретов, которые нужно было бы хранить, у конвейера нет; менеджер секретов из NFR-10 он не заменяет — секреты приложения по-прежнему хранятся только в серверной `.env`.

**Состояние на 12.11.2026.** Конвейер настроен в Azure и GitHub (идентичность `imbc-dev-github-deploy`, окружение `dev` только для `main`, защита `main` с двумя обязательными проверками), но ни разу не запускался: GitHub Actions на аккаунте владельца заблокирован из-за оплаты («The job was not started because your account is locked due to a billing issue»), поэтому не запускались и проверки CI. Снять блокировку может только владелец аккаунта. Не проверены: вход конвейера в Azure через OIDC, достаточность трёх действий собственной роли для `az vm run-command`, первое развёртывание конвейером и `deploy.sh preview`. Все выкаты 12.11 выполнены вручную: `deploy.sh redeploy` из чистого checkout нужного коммита.

### Как это работает

1. **Запуск.** Автоматически — после успешного workflow `CI` для push в `main` этого репозитория. Если CI не прошёл, запуск относится к pull request или за время CI в `main` появился более новый коммит, развёртывание не начинается (новый коммит развернёт собственный запуск). Вручную — `workflow_dispatch` из ветки `main` с полем `ref`. Одновременно идёт не больше одного развёртывания: группа `deploy-dev` без отмены, `flock` на VM и ограничение Azure «один run-command на VM».
2. **Выбор коммита** (задание без доступа к Azure). `ref` превращается в полный SHA; при ручном запуске коммит должен входить в ветку или тег `Batrbekk/imbc-platform`.
3. **Вход в Azure** (задание в окружении GitHub `dev`, которое принимает только ветку `main`). `azure/login` получает OIDC-токен GitHub для окружения `dev` и входит как управляемая идентичность `imbc-dev-github-deploy`, которая доверяет ровно одному subject — тому, который GitHub выдаёт этому репозиторию (см. «Настройка»). Её роль «IMBC dev deploy» назначена только на VM `imbc-dev` и разрешает три действия: чтение VM, чтение её состояния и `runCommand`. NSG, другие ресурсы и другие проекты подписки ей недоступны.
4. **Проверка VM.** Если VM освобождена (`deallocated`) или не запущена, задание завершается с подсказкой `az vm start`.
5. **Развёртывание.** `az vm run-command invoke` выполняет от root `infrastructure/azure/vm-deploy.sh` из развёртываемого коммита с аргументами `pipeline <sha> Batrbekk/imbc-platform <хост>`. Скрипт проверяет аргументы, берёт блокировку, скачивает архив коммита `https://api.github.com/repos/Batrbekk/imbc-platform/tarball/<sha>`, сверяет SHA в заголовке архива и безопасно распаковывает его от имени `imbc`. Архив с путями `..`, абсолютными путями, ссылками за пределы каталога, жёсткими ссылками или устройствами отклоняется; коммит без `compose.yaml`, `compose.azure.yaml`, `.env.example`, `Caddyfile` или `sync-realm.py` — тоже, до любых изменений. Коммит без `vm-deploy.sh` и `check-deploy-result.sh` отклоняет ещё workflow. Далее — те же шаги, что у `deploy.sh redeploy`: проверка серверной `.env`, синхронизация в `/home/imbc/imbc-platform`, `docker compose -f compose.yaml -f compose.azure.yaml config` и `up -d --build --remove-orphans --wait`, reload Caddy, `sync-realm.py --theme imbc`, готовность HTTPS/API и отказ закрытых маршрутов.
6. **Результат.** run-command не передаёт код выхода и возвращает только около 4 КБ вывода, поэтому скрипт печатает краткую сводку и последнюю строку `IMBC_DEPLOY_RESULT=ok revision=<sha>` или `IMBC_DEPLOY_RESULT=failed step=<шаг>`. Строку разбирает `infrastructure/azure/check-deploy-result.sh` (команды workflow `::…::` в выводе VM при печати отключаются). Задание успешно только при `ok` с ожидаемым SHA и ответе `https://imbc-dev-e1cde8dd.polandcentral.cloudapp.azure.com/api/health/ready` с runner GitHub.

Синхронизация конвейера приводит каталог приложения к коммиту: файлы, удалённые из репозитория, удаляются и на сервере. Правила те же, что у `deploy.sh`: не передаются и не удаляются `.env*` (кроме `.env.example`), `infrastructure/mailpit/.env.smtp-relay.yaml`, `.git`, `node_modules`, результаты сборки, `*.pem`, `*.key`, `*.log`. Docker volumes с данными и TLS-данные Caddy находятся вне каталога и не затрагиваются. Владелец файлов — `imbc`. Маркеры в `/home/imbc/imbc-platform`: `.synced-revision` — какой коммит синхронизирован на диск (`<sha> pipeline|local`, пишется сразу после синхронизации); `.deployed-revision` — коммит, развёрнутый конвейером, пишется **только после успешной** проверки состояния (после сбоя Compose там остаётся прежнее значение); после успешного `deploy.sh redeploy` вместо него — `.deployed-source-commit`. Миграции применяет сервис `migrate` стека, как и при ручном развёртывании (expand → migrate → contract, NFR-06); своей логики миграций у конвейера нет.

### Публичный репозиторий

Репозиторий `Batrbekk/imbc-platform` публичный, и **конвейер работает только с публичным репозиторием**: если репозиторий закрыт, workflow останавливается на первом шаге с понятной ошибкой. Для конвейера из публичности следует:

- **Журналы Actions видит любой.** Поэтому скрипт на VM выводит только названия шагов, длительность и безопасные сообщения; вывод сборки, Compose и контейнеров остаётся в журнале на VM. Секретов в конвейере нет. Переменные `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` — идентификаторы, а не секреты: без OIDC-токена этого репозитория и окружения `dev` они не дают входа.
- **Архив коммита скачивается анонимно.** Токены на VM не передаются: параметры run-command могут оставаться в настройках расширения на диске VM.
- **Форки и pull request не развёртывают.** CI для pull request выполняется с токеном только для чтения и без доступа к окружению `dev`. Автоматический запуск принимает только push в `main` этого репозитория; ручной запуск доступен пользователям с правом записи и только из `main`. OIDC-токен с нужным subject выдаётся только заданию в окружении `dev`.
- **Всё, что попало в `main`, исполняется на VM от root** — и скрипт развёртывания, и сборка контейнеров. Рекомендуется (настройки репозитория, скрипт их не меняет): защитить `main` правилами ветки — обязательный CI и ревью (12.11 включена защита с двумя обязательными проверками); ограничить разрешённые actions репозитория (Settings → Actions → «Allow select actions») теми, что используются; `deploy-dev.yml` закрепляет `actions/checkout` и `azure/login` по SHA коммита.

### Настройка

Один раз, с машины, где выполнены `az login` (Owner на `imbc-dev-rg`; либо User Access Administrator вместе с Managed Identity Contributor — одного User Access Administrator для создания идентичности недостаточно) и `gh auth login` (администратор репозитория):

```bash
./infrastructure/azure/setup-github-deploy.sh plan   # только чтение: подписка, состояние, subject, порядок действий
./infrastructure/azure/setup-github-deploy.sh apply --yes --subscription-name "<имя подписки>"   # создать; повторный запуск безопасен
```

Без `--yes` (или `IMBC_SETUP_CONFIRM=yes`) `apply` и `destroy` только печатают цель — подписку, resource group, VM, репозиторий и subject — и останавливаются.

**Проверка подписки.** Скрипт работает в текущей подписке `az account`, но идентификатор подписки берёт из ID найденной VM `imbc-dev` в `imbc-dev-rg` и останавливается, если он не совпадает с контекстом `az` или RG и VM там нет. GUID подписки в репозитории не хранится. Кроме того, `apply` и `destroy` требуют, чтобы оператор сам назвал подписку: `--subscription-name "<имя>"` или `IMBC_SETUP_SUBSCRIPTION_NAME`. Имя сравнивается с `az account show --query name`; если имя не указано или не совпадает, скрипт останавливается до любых изменений. `plan` печатает имя текущей подписки.

**Роль и назначения.** Роль «IMBC dev deploy» `apply` обновляет, а `destroy` удаляет только если это собственная роль (CustomRole) с областью назначения ровно `imbc-dev-rg`. Роль с тем же именем, но в другом состоянии, не трогается: скрипт останавливается и называет её ID. У идентичности должно быть ровно одно назначение — эта роль на VM. Любые другие `plan` показывает как проблему, `apply` с ними не начинается и проверяет это же в конце. Если назначение уже создано, но ещё не видно в списке (`RoleAssignmentExists`), это считается успехом. Ошибка `az` при чтении всегда останавливает скрипт — она не выглядит как «ресурса нет».

**Subject federated credential** скрипт не задаёт литералом, а читает из настроек OIDC репозитория (`GET repos/Batrbekk/imbc-platform/actions/oidc/customization/sub`): при `use_immutable_subject: true` это `<sub_claim_prefix>:environment:dev` (сейчас — `repo:Batrbekk@31662578/imbc-platform@1452122366:environment:dev`), иначе `repo:Batrbekk/imbc-platform:environment:dev`. Если настройки не читаются или задан собственный шаблон (`use_default: false`), скрипт останавливается. `plan` печатает subject и его источник. Если настройки OIDC репозитория изменятся, повторите `apply`.

**Порядок `apply`:** сначала окружение GitHub `dev` (custom branch policies, единственная политика — ветка `main`) и его проверка; только затем в Azure — идентичность `imbc-dev-github-deploy` в `imbc-dev-rg`, один federated credential (issuer `https://token.actions.githubusercontent.com`, audience `api://AzureADTokenExchange`, вычисленный subject; остальные удаляются), роль «IMBC dev deploy» с областью назначения `imbc-dev-rg` и её назначение на VM `imbc-dev`; затем переменные окружения `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`. В конце состояние перечитывается, и `apply` завершается ошибкой, если окружение не ограничено веткой `main` или subject не совпадает. Скрипт отказывается работать с другими resource group, VM, идентичностью или репозиторием без явного `IMBC_SETUP_ALLOW_OTHER_TARGET=yes`, различает «ресурса нет» (HTTP 404) и ошибки доступа и не выводит токены.

Выполните `apply` до того, как `deploy-dev.yml` попадёт в `main`: GitHub создаёт окружение, упомянутое в workflow, автоматически и без ограничения веток. Перед первым запуском убедитесь, что на VM есть `rsync` (`command -v rsync`) и что серверная `.env` содержит `ADMIN_ALLOWED_IPS`; иначе сначала выполните `deploy.sh redeploy`.

### Предпросмотр синхронизации

**Перед первым запуском конвейера обязательно посмотрите предпросмотр.** Каталог на VM до сих пор заполнялся с машины разработчика и может содержать файлы, которых нет в репозитории; первая синхронизация конвейера удалит все такие файлы, кроме защищённых правилами (`.env*`, relay-секрет, `node_modules`, результаты сборки и т. д.).

```bash
./infrastructure/azure/deploy.sh preview "$(git rev-parse origin/main)"   # любой отправленный в GitHub SHA
```

Команда работает по SSH: скачивает на VM архив этого коммита и запускает `vm-deploy.sh preview` — `rsync -n --delete` с теми же параметрами и правилами из того же определения, что и настоящая синхронизация. Выводится число и список удалений (`*deleting`) и изменений (`>f+++…` — новый файл, `>fc…` — другое содержимое, `.f…p…` — права). Каталог приложения, контейнеры, журналы и блокировка не затрагиваются; временный каталог загрузки удаляется. На VM передаётся `vm-deploy.sh` из самого этого коммита (`git show <sha>:infrastructure/azure/vm-deploy.sh`), поэтому правила совпадают с теми, что применит конвейер; коммит должен быть в локальном репозитории (`git fetch`) и уже содержать режим `preview`.

### Развернуть ветку или коммит вручную

Actions → **Deploy dev** → **Run workflow**, ветка workflow — `main`, в поле `ref` — ветка, тег или полный SHA. Из терминала:

```bash
gh workflow run deploy-dev.yml --repo Batrbekk/imbc-platform --ref main -f ref=<ветка|тег|SHA>
```

Коммит должен быть отправлен в репозиторий и содержать `infrastructure/azure/vm-deploy.sh` и `infrastructure/azure/check-deploy-result.sh`. Стенд остаётся на этом коммите до следующего push в `main`, который снова развернёт `main`.

### Журналы

- **GitHub Actions** — краткая сводка шагов и строка результата в задании «Deploy to Azure dev».
- **VM** — полный журнал каждого запуска: `/var/log/imbc-deploy/deploy-<время>-<режим>-<sha>-<pid>.log`, каталог `0700` и файлы `0600` root, хранятся последние 20. Сюда же пишет `deploy.sh redeploy`.

```bash
./infrastructure/azure/deploy.sh ssh
sudo ls -t /var/log/imbc-deploy/
sudo less "/var/log/imbc-deploy/$(sudo ls -t /var/log/imbc-deploy/ | head -n 1)"
cat /home/imbc/imbc-platform/.deployed-revision /home/imbc/imbc-platform/.synced-revision
```

Без SSH, с правами владельца подписки (вывод — только у вас в терминале; журнал не публикуйте целиком):

```bash
az vm run-command invoke -g imbc-dev-rg -n imbc-dev --command-id RunShellScript \
  --scripts 'tail -n 60 "$(ls -t /var/log/imbc-deploy/*.log | head -n 1)"' --query 'value[0].message' -o tsv
```

### Откат

Запустите ручное развёртывание с `ref` = SHA предыдущего рабочего коммита (история запусков Deploy dev, `git log`). Откатывается код, а не схема БД: миграции идут только вперёд, и схема совместима с предыдущей версией приложения (NFR-06), поэтому безопасен откат на непосредственно предыдущую версию; при откате дальше проверьте миграции между версиями. Коммиты старше конвейера (без `vm-deploy.sh`) workflow отклоняет — разверните их через `deploy.sh redeploy` из checkout нужного коммита. Следующий push в `main` вернёт стенд на `main`; чтобы этого не произошло, временно отключите workflow.

### Отключение

- **Временно:** Actions → Deploy dev → ⋯ → Disable workflow или `gh workflow disable deploy-dev.yml --repo Batrbekk/imbc-platform`. Обратно — `gh workflow enable`.
- **Полностью:** `./infrastructure/azure/setup-github-deploy.sh destroy --yes --subscription-name "<имя подписки>"` — в обратном порядке: сначала доверие Azure (назначение роли, federated credentials и идентичность, затем роль по её ID), потом окружение `dev` с переменными. Без `--yes` только показывает, что будет удалено. Ручной `deploy.sh` продолжает работать.

### Что остаётся вручную

- Создание VM и первое развёртывание с генерацией серверной `.env`: `deploy.sh up`.
- `ALLOW_FROM` и `ADMIN_ALLOWED_IPS`: их значения — IP разработчика, конвейер их не знает. Если в `.env` нет `ADMIN_ALLOWED_IPS`, конвейер останавливается на шаге `env`.
- NSG, открытие HTTPS/443 после первой проверки Caddy (`up`), запуск освобождённой VM (`az vm start`).
- Ротация relay-секрета Mailpit, смена домена или OIDC-секретов с миграцией Keycloak.
- Смена DNS-имени стенда: оно задано в `deploy-dev.yml` (`DEV_HOST`) и должно совпадать с `PUBLIC_HOST` серверной `.env`.
- **Ограничение: только публичный репозиторий.** Если репозиторий станет закрытым, конвейер остановится; прежде чем снова запускать его, нужен другой канал исходников без токена в параметрах run-command — например, ключ развёртывания только для чтения на VM или управляемый run-command с защищёнными параметрами. Ручной `deploy.sh` от этого не зависит.

## Переход на спецификацию v1.3

Спецификация v1.3 (раздел 3.1, UPD-06) переименовала роль и тип организации `spectator` в `observer` и статус актуальности профиля `inactive` в `unresponsive`; профиль unresponsive остаётся видимым и сортируется ниже (UPD-04). Демо-наблюдатель `spectator@spectator.local` стал `observer@observer.local`. Переход шёл по правилу expand → перенос данных → contract (NFR-06) и завершается релизом contract — миграцией `0006_spec_v13_contract` этапа 1.

- **Expand и перенос данных** выполнены на dev-стенде 12.11.2026 первым выкатом ветки `feat/spec-v1.3-contracts` (`851660b`): миграция `0003_spec_v13_expand` добавила новые значения, прежние остались в типах; перенос `backfillSpecV13()` после миграций заменил данные, а seed и `sync-realm.py` переименовали демо-наблюдателя на месте (id, пароль и пара в `DEV_FIXED_OTP_ACCOUNTS` сохранились). В журнале `migrate` была строка «Перенос v1.3: organizations 1, user_accounts 1, manufacturer_profiles 0, catalog_visible 0». Стенд работает на ветке `demo/prototype-cabinets` (`8c748ea`), миграции `0000`–`0005` применены.
- **Contract** (`0006`): из типов `role`, `organization_type` и `update_status` удаляются `spectator` и `inactive`, удаляются пустые таблицы каркаса `external_checks`, `nda_versions`, `nda_acceptances` и тип `check_status`. Вместе с ним из кода удалены перенос данных (`backfill.ts`), псевдоним роли `spectator` в `DEV_FIXED_OTP_ACCOUNTS` и переименование демо-наблюдателя в seed и `sync-realm.py`. Состояние аккаунта `inactive` (тип `account_state`, AUTH-07) не меняется: это другое понятие.

### Релиз contract (0006)

Миграция сначала проверяет данные: если в `organizations.type` или `user_accounts.role` осталось `spectator`, в `manufacturer_profiles.update_status` или `catalog_visible.update_status` — `inactive`, или в одной из таблиц каркаса есть строка, она останавливается с ошибкой `spec v1.3 contract: …` до любой правки. Миграции выката мигратор применяет одной транзакцией, поэтому база остаётся в прежнем состоянии, `migrate` завершается ошибкой, а новые `api` и `worker` не стартуют (`service_completed_successfully`). Прямой выкат на базу версии до v1.3 так и остановится: переноса данных в этой версии больше нет — сначала нужен выкат любой версии v1.3 до contract (например, `8c748ea`).

**Что выкатывается на стенд.** Стенд работает на ветке стенда `demo/prototype-cabinets` (`8c748ea`): в её дереве есть прототип кабинетов (`apps/api/src/modules/prototype/*`, `apps/api/src/database/prototype-store.ts`, `packages/contracts/src/prototype.ts`, `apps/web/src/prototype/**`). Ручной выкат загружает дерево через `rsync` без `--delete` (`sync_tree` в `infrastructure/azure/vm-deploy.sh`), поэтому файлы прототипа на VM остаются, даже если в загружаемом дереве их нет. Дерево без прототипа на сборке образа остановится: `prototype.controller.ts` импортирует `prototypeWriteSchema`, а `@imbc/contracts` этой ветки его не экспортирует. Поэтому этот релиз выкатывается на стенд **из ветки стенда `demo/prototype-cabinets`, в которую влита ветка этапа**: прототип остаётся в дереве, сборка проходит. `apps/api/src/database/migrate.ts` при слиянии конфликтует: в ветке стенда он вызывает `backfillSpecV13` и сам выдаёт права, в ветке этапа перенос удалён, а права выдаёт `applyAppRoleGrants`. После слияния в нём должно быть: миграции Drizzle → при `PROTOTYPE_CABINETS=true` `createPrototypeTable(pool)` (таблица прототипа создаётся **до** выдачи прав, чтобы `GRANT` её захватил) → `applyAppRoleGrants(pool, appRole)` из `./app-role.js` (выдаёт права и отзывает UPDATE/DELETE на `audit_entries` и `nda_acceptance`); импорта `./backfill.js` и вызова `backfillSpecV13` нет — файл удалён. До выката в чистом checkout слитой ветки стенда должны пройти `pnpm install --frozen-lockfile && pnpm typecheck && pnpm build`: оставшийся на VM старый `backfill.ts` (ручной выкат его не удаляет) иначе спрятал бы забытый импорт — сборка на VM прошла бы, а локальная бы упала. Общее правило для любого выката дерева, в котором нет части файлов, лежащих на VM: до `redeploy` удалить на VM файлы, которых нет в выкатываемом коммите (см. «[Файлы, которых нет в выкатываемом коммите](#файлы-которых-нет-в-выкатываемом-коммите)»).

**До выката** — в `/home/imbc/imbc-platform` на VM (`./infrastructure/azure/deploy.sh ssh`). Команды можно вставлять блоком: у каждой `docker compose exec -T` без входного файла стоит `</dev/null`, иначе она прочитала бы следующие строки вставленного текста. Успех команд, которые создают или меняют что-то, виден по строке `…-ok` после `&&`; если её нет, дальше не идти.

1. Строк со старыми значениями и строк в таблицах каркаса нет — все семь чисел `0`:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -v ON_ERROR_STOP=1 -c "
     select 'organizations' as t, count(*) from organizations where type::text = 'spectator'
     union all select 'user_accounts', count(*) from user_accounts where role::text = 'spectator'
     union all select 'manufacturer_profiles', count(*) from manufacturer_profiles where update_status::text = 'inactive'
     union all select 'catalog_visible', count(*) from catalog_visible where update_status::text = 'inactive'
     union all select 'external_checks', count(*) from external_checks
     union all select 'nda_versions', count(*) from nda_versions
     union all select 'nda_acceptances', count(*) from nda_acceptances;" </dev/null
   ```

   Если в первых четырёх строках не `0` — данные не перенесены: выкатите версию v1.3 до contract и повторите проверку. Если не `0` в таблицах каркаса — выкат остановить и разобраться: ни одна версия приложения эти таблицы не заполняет.

   Вторая проверка — данные не нарушают уникальные индексы `0007_accounts_registration` того же выката: организация IMBC одна (`organizations_imbc_uq`), у организаций, кроме производителей, нет двух одного типа с одинаковым названием без учёта регистра (`organizations_name_uq`), у организации нет двух аккаунтов роли manufacturer (`user_accounts_manufacturer_org_uq`). На стенде есть строки, внесённые руками (личный аккаунт администратора владельца, остатки сценариев регистрации — [проверка 10.11.2026](verification-2026-11-10.md)). Типы до `0006` ещё прежние, поэтому сравнение — через `::text`:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -v ON_ERROR_STOP=1 -c "
     select 'imbc_orgs' as t, count(*) from organizations where type::text = 'imbc'
     union all select 'dup_name_non_manufacturer', count(*) from (select 1 from organizations where type::text <> 'manufacturer' group by type::text, lower(name) having count(*) > 1) d
     union all select 'dup_manufacturer_acc', count(*) from (select 1 from user_accounts where role::text = 'manufacturer' group by organization_id having count(*) > 1) d;" </dev/null
   ```

   Ожидается: `imbc_orgs` — `1` (`0` на пустой базе: тогда организацию IMBC создаст `0008`), `dup_name_non_manufacturer` и `dup_manufacturer_acc` — `0`. При любом другом результате выкат не начинать: лишние строки разобрать с владельцем; ограничения не ослаблять. Иначе выкат упадёт так: `migrate` завершится ошибкой `23505` (`duplicate key value violates unique constraint …` с именем индекса), вся пачка `0006`–`0008` откатится, новые `api` и `worker` не стартуют, а прежние `api` и `worker` продолжат работать.

2. Демо-наблюдателя под прежним адресом нет ни в базе, ни в Keycloak. Проверка в базе — ожидается `0`:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -At -v ON_ERROR_STOP=1 -c "
     select count(*) from user_accounts where lower(email) = 'spectator@spectator.local';" </dev/null
   ```

   Проверка в Keycloak: консоль `/kc/admin/` (с IP из `ADMIN_ALLOWED_IPS`, вход — `KEYCLOAK_ADMIN_USER` из серверной `.env`), realm `imbc`, Users, поиск `spectator@spectator.local` — пользователя нет. Почему это важно: адрес переименовывал удалённый теперь код seed и `sync-realm.py`. Если переименование не состоялось, после `0006` seed создаст второй аккаунт `observer@observer.local` в состоянии `invited`, а прежний аккаунт и пользователь Keycloak останутся под старым адресом. Если адрес найден, переименуйте его до выката так же, как это делал удалённый код. В базе:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -v ON_ERROR_STOP=1 -c "
     UPDATE user_accounts SET email = 'observer@observer.local'
     WHERE lower(email) = 'spectator@spectator.local'
       AND NOT EXISTS (SELECT 1 FROM user_accounts WHERE lower(email) = 'observer@observer.local');" </dev/null
   ```

   В Keycloak у этого пользователя заменить email на `observer@observer.local` (username меняется вместе с ним: `registrationEmailAsUsername`; проверьте оба поля, id и пароль не меняются). Если `UPDATE` изменил 0 строк, потому что `observer@observer.local` уже есть, выкат остановить: два аккаунта нужно разобрать вручную (см. «Если второй аккаунт всё же появился»).

3. В серверной `.env` нет прежнего имени роли. Команда печатает только число строк, не содержимое файла:

   ```bash
   sudo grep -c spectator .env
   ```

   Ожидается `0`. Иначе откройте `.env` в редакторе (не выводя его в терминал) и замените в `DEV_FIXED_OTP_ACCOUNTS` роль `spectator` на `observer` в той записи кавычек, что используется в файле (`"role":"spectator"` или `\"role\":\"spectator\"`); UUID не менять. Без псевдонима `api` и `worker` с прежним именем роли не стартуют: в журнале `api` — ошибка конфигурации `DEV_FIXED_OTP_ACCOUNTS.N.role`. Если это всё же случилось при выкате, `migrate` уже применил `0006`: исправьте `.env` и повторите `redeploy` — ничего не потеряно.

4. Аккаунтов в состоянии `inactive` нет — ожидается `0`. Проверка стоит до резервной копии: найденные аккаунты разбирают с владельцем до выката, и копию снимают уже с разобранными данными, а не повторяют. Колонки `inactive_since` до выката ещё нет (её добавляет `0007`), а вернуть аккаунт `inactive` без этой отметки новым паролем нельзя (AUTH-07: возврат — пароль, заданный не раньше `inactive_since`); ни одна прежняя версия такие аккаунты не создавала:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -At -v ON_ERROR_STOP=1 -c "
     select count(*) from user_accounts where state = 'inactive';" </dev/null
   ```

   Если не `0` — выкат остановить и разобрать эти аккаунты с владельцем.

5. Резервная копия базы — единственный способ вернуться после `0006` на версию до v1.3 (см. «Откат»). `umask 077` делает файл доступным только пользователю `imbc`; `&& echo dump-ok` печатается, только если `pg_dump` завершился успешно — без `dump-ok` дальше не идти. Проверьте, что на диске хватит места на копию и на пробную базу (`df -h /`):

   ```bash
   umask 077
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres pg_dump -U imbc -d imbc -Fc </dev/null > /home/imbc/backup-before-0006.dump && echo dump-ok
   ls -lh /home/imbc/backup-before-0006.dump
   ```

   Файл хранится на VM вне каталога приложения и Git; удалить его можно, когда откат на версию до v1.3 больше не нужен.

6. Копия проверяется полным пробным восстановлением в отдельную базу того же сервера. Оглавление (`pg_restore --list`) копию не проверяет: при `-Fc` в поток оно пишется до данных, и копия, оборванная посреди данных, его проходит. Пробное восстановление — это и репетиция отката:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres createdb -U imbc -O imbc imbc_restore_check </dev/null && echo createdb-ok
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres pg_restore -U imbc -d imbc_restore_check --exit-on-error --single-transaction < /home/imbc/backup-before-0006.dump && echo restore-ok
   for db in imbc imbc_restore_check; do
     printf '%s: ' "$db"
     sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d "$db" -At -v ON_ERROR_STOP=1 -c "
       select (select count(*) from user_accounts) || ' user_accounts, ' || (select count(*) from manufacturer_profiles) || ' manufacturer_profiles';" </dev/null
   done
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres dropdb -U imbc imbc_restore_check </dev/null && echo dropdb-ok
   ```

   Ожидается `createdb-ok`, `restore-ok`, две одинаковые строки чисел и `dropdb-ok`. Запишите эти два числа: по ним проверяется восстановление при откате. Если числа разошлись, а между копией и проверкой на стенде регистрировались или создавались профили, повторите шаги 5 и 6. Если `restore-ok` нет, копия негодна: снимите её заново и не выкатывайте, пока пробное восстановление не пройдёт. `dropdb` здесь удаляет только пробную базу `imbc_restore_check`.

7. Предел чтения Adata. На стенде чтение **открыто**: в серверной `.env` стоит `ADATA_MONTHLY_LIMIT=25` (решение владельца от 12.11.2026, чтобы участники тестирования регистрировались сами); раздел «[Чтение Adata](#чтение-adata-imbc-07-ext-02)» описывает состояние по умолчанию — предел `0`, и этот выкат строку не убирает. Каждая приёмочная регистрация этапа 1, дошедшая до установки пароля, запускает платное чтение по БИН из формы: одну единицу квоты заказчика (3 000 БИН в месяц), даже если БИН вымышленный. Перед приёмкой с вымышленными БИН оператор выбирает одно из двух: либо временно ставит предел `0` (строка `ADATA_MONTHLY_LIMIT=0` в серверной `.env`, `sudo docker compose -f compose.yaml -f compose.azure.yaml up -d worker`, `ps worker` — `healthy`) и возвращает прежнее значение после приёмки тем же способом, либо осознанно тратит квоту. Попытки, закрытые пределом, получают `quota_exhausted` без запроса и ставятся снова при следующем входе, поэтому после возврата предела их расходуют следующие вошедшие производители с Draft-профилем. Значение токена `ADATA_API_TOKEN` не выводить: серверную `.env` не печатать, команды из раздела «Токен не печатать» не выполнять. Записать, каким был предел до и после.

### Что делает выкат

Шаги одинаковы для `./infrastructure/azure/deploy.sh redeploy` и для [конвейера](#конвейер-развёртывания): оба запускают на VM `infrastructure/azure/vm-deploy.sh`. Отдельной команды для перехода нет.

1. **Compose** (`up -d --build --wait`, шаг `compose-up`). Одноразовый сервис `migrate` выполняет `node dist/database/migrate.js`: применяет миграции, которых нет в базе, — на стенде с `0000`–`0005` это `0006_spec_v13_contract` и следующие миграции выката. Переноса данных больше нет: строка «Перенос v1.3: …» не печатается, в конце — «Миграции применены».
2. Затем, при `SEED_DEMO=true`, `seed.js` создаёт недостающие демо-данные; демо-наблюдатель — `observer@observer.local`, прежний адрес seed больше не переименовывает.
3. `api` и `worker` новой версии стартуют только после успешного `migrate` (`service_completed_successfully`).
4. Шаг `realm-sync`: `sync-realm.py --theme imbc` обновляет только настройки realm и клиента BFF; пользователей Keycloak он не переименовывает.
5. Готовность HTTPS/API и отказ закрытых маршрутов, как при любом выкате.

**Блокировки.** `0006` меняет тип колонок `user_accounts`, `organizations`, `manufacturer_profiles` и `catalog_visible` и берёт на них исключительные блокировки. Они держатся, пока не зафиксируется вся пачка миграций выката (`0006`–`0008`). Всё это время запросы прежнего `api`, который ещё работает, к этим таблицам ждут. Возможна взаимоблокировка с транзакцией прежнего `api`: PostgreSQL прервёт одну из них. Если жертвой окажется `migrate`, пачка откатится целиком, `migrate` завершится ошибкой, новые `api` и `worker` не стартуют, а прежний `api` продолжит работать — выкат не удался безопасно, и его можно повторить. Ручной выкат не удаляет на VM файлы, удалённые из репозитория (раздел «Обновление приложения»): оставшийся `apps/api/src/database/backfill.ts` собирается, но ничем не вызывается.

### Проверка после выката

```bash
./infrastructure/azure/deploy.sh ssh
cd /home/imbc/imbc-platform
sudo docker compose -f compose.yaml -f compose.azure.yaml logs migrate </dev/null | grep 'Миграции применены'
sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -c "
  select enum_range(null::role) as role, enum_range(null::organization_type) as organization_type,
         enum_range(null::update_status) as update_status, to_regclass('external_checks') as external_checks,
         to_regclass('nda_versions') as nda_versions, to_regclass('nda_acceptances') as nda_acceptances,
         to_regtype('check_status') as check_status;" </dev/null
sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -c "
  select email, role from user_accounts where lower(email) in ('spectator@spectator.local', 'observer@observer.local');" </dev/null
```

Ожидается: в `role` — `{manufacturer,expert,administrator,director,operator,observer}`, в `organization_type` — `{manufacturer,operator,observer,imbc}`, в `update_status` — `{active,outdated,unresponsive}`, четыре последние колонки пусты; третий запрос возвращает одну строку `observer@observer.local | observer`.

Неактивность (AUTH-07): аккаунт `inactive` без `inactive_since` никогда не вернётся новым паролем — код таких не создаёт, ожидается `0`:

```bash
sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -At -v ON_ERROR_STOP=1 -c "
  select count(*) from user_accounts where state = 'inactive' and inactive_since is null;" </dev/null
```

Первые переходы в `inactive` на стенде случатся не раньше 09.02.2027: аккаунты не старше 09.11.2026. С этого дня задание `inactivity-reset` шлёт письма сброса на настоящие адреса аккаунтов через почтовый отправитель стенда (адреса `.local` остаются в Mailpit).

Ожидаемый вход: `observer@observer.local` с прежним паролем демо-аккаунтов (`KEYCLOAK_DEV_USER_PASSWORD`) и кодом `000000` открывает `/dashboard`; страница компании не показывает focal point.

**Проверки этапа 1** (регистрация, организации, аккаунты). Все команды, кроме `curl`, — на VM в `/home/imbc/imbc-platform`.

1. Организации NCOC, TCO и KPO есть и отмечены major operator (`0008`) — три строки, в каждой `t`:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -At -v ON_ERROR_STOP=1 -c "
     select name, type, is_major_operator from organizations where type = 'operator' and name in ('NCOC', 'TCO', 'KPO') order by name;" </dev/null
   ```

   Ожидается: `KPO|operator|t`, `NCOC|operator|t`, `TCO|operator|t`.

2. Версия NDA 1 есть и текущая (её создаёт seed при `SEED_DEMO=true`, если таблица пуста):

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -At -v ON_ERROR_STOP=1 -c "
     select version_number, is_current from nda_version order by version_number;" </dev/null
   ```

   Ожидается одна строка `1|t`; другая — разобрать до приёмки регистрации: без текущей версии принять NDA при регистрации нельзя (`nda_unavailable`).

3. У роли приложения на журнале принятия NDA только `SELECT` и `INSERT` (`applyAppRoleGrants`, append-only):

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -v ON_ERROR_STOP=1 -c '\dp nda_acceptance' </dev/null
   ```

   В столбце прав у `imbc_app` — `ar` (`a` — INSERT, `r` — SELECT): `imbc_app=ar/imbc`. Букв `w` (UPDATE) и `d` (DELETE) нет.

4. Консоль аккаунта Keycloak снаружи закрыта: `/kc/realms/<realm>/account` и `/kc/realms/<realm>/account/` отвечают 404 (Caddy; `realm` стенда — `imbc`). Команда — с локальной машины, не с VM; третья строка — контроль: страница OIDC остаётся открытой:

   ```bash
   for path in account account/ .well-known/openid-configuration; do
     curl -sS -o /dev/null -w "%{http_code} /kc/realms/imbc/$path\n" "https://imbc-dev-e1cde8dd.polandcentral.cloudapp.azure.com/kc/realms/imbc/$path"
   done
   ```

   Ожидается `404`, `404` и `200`.

5. Контейнер `nginx` (он стоит за Caddy на `127.0.0.1:8080`) в состоянии `Up`, а не `Restarting`: файл `infrastructure/nginx/nginx.conf` с ошибкой синтаксиса (например, `;` в шаблоне `location` без кавычек) не даёт ему стартовать, и контейнер уходит в перезапуск:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml ps nginx </dev/null
   ```

   В столбце `STATUS` — `Up …`; `Restarting (…)` — выкат не принят: `sudo docker compose -f compose.yaml -f compose.azure.yaml logs --tail 20 nginx` покажет `[emerg]` с номером строки.

### Файлы, которых нет в выкатываемом коммите

`deploy.sh redeploy` дополняет каталог приложения и ничего в нём не удаляет. Сборка образа (`tsc` по всему `src`) подхватывает файлы, оставшиеся от прежних выкатов. Поэтому перед выкатом дерева, в котором части файлов VM нет (откат, выкат другой ветки), эти файлы удаляют на VM. Удаляются файлы, добавленные после целевого коммита, — по всем коммитам, которые выкатывались на VM. Защищённых файлов (`.env*`, relay-секрет) в списке быть не может: Git их не отслеживает.

Развёрнутые коммиты записывает `vm-deploy.sh`: `.deployed-source-commit` (последний успешный `deploy.sh redeploy`), `.deployed-revision` (конвейер), `.synced-revision` (что синхронизировано на диск, `<sha> pipeline|local`) в `/home/imbc/imbc-platform`, а также имена журналов `/var/log/imbc-deploy/deploy-<время>-<режим>-<sha12>-<pid>.log` (последние 20). Список строится локально, в чистом checkout репозитория с актуальными ветками (`git fetch`), из корня:

```bash
TARGET=   # целевой коммит, например TARGET=d6ea422
(
  set -eo pipefail
  : "${TARGET:?задайте целевой коммит}"
  ssh -i ~/.ssh/imbc-dev-azure imbc@20.215.209.224 'cd /home/imbc/imbc-platform && cat .deployed-source-commit .deployed-revision .synced-revision 2>/dev/null; sudo ls /var/log/imbc-deploy/' </dev/null \
    | sed -nE 's/^([0-9a-f]{7,40})( .*)?$/\1/p; s/^deploy-[0-9TZ]+-[a-z]+-([0-9a-f]{7,40})-[0-9]+\.log$/\1/p' | sort -u > /tmp/imbc-revs.txt
  cat /tmp/imbc-revs.txt
  while read -r rev; do
    git rev-parse -q --verify "$rev^{commit}" >/dev/null || { echo "нет в локальном репозитории: $rev" >&2; continue; }
    git diff --name-only --no-renames --diff-filter=A "$TARGET" "$rev"
  done < /tmp/imbc-revs.txt | sort -u > /tmp/imbc-added.txt
  wc -l < /tmp/imbc-added.txt
)
```

Блок выполняется в подоболочке `( set -eo pipefail; … )`: при вставке в терминал пустой `TARGET` или сбой `ssh` останавливают его на первой же строке, а не только печатают ошибку и идут дальше, к списку, построенному по пустому значению. `TARGET` остаётся в вашей оболочке — он нужен следующей команде.

Строка «нет в локальном репозитории» означает, что коммит не получен (`git fetch` нужной ветки). На стенде к этому списку должны попасть `8c748ea` и выкатываемый сейчас коммит ветки стенда. Просмотрите `/tmp/imbc-added.txt` и удалите эти файлы на VM:

```bash
ssh -i ~/.ssh/imbc-dev-azure imbc@20.215.209.224 'cd /home/imbc/imbc-platform && sudo xargs -d "\n" rm -f -- && echo rm-ok' < /tmp/imbc-added.txt
```

Если журналы старше последних 20 выкатов уже удалены, а целевой коммит содержит режим `preview`, сверьте результат: `./infrastructure/azure/deploy.sh preview <целевой коммит>` (коммит должен быть отправлен в GitHub) сравнивает дерево VM с целевым и печатает в строках `*deleting` всё, что осталось лишним, с теми же правилами защиты.

### Откат

GitHub Actions на аккаунте владельца заблокирован (раздел «Конвейер развёртывания»), поэтому любой откат делается вручную: чистый checkout целевого коммита (`git switch --detach <коммит>`, `git status --short` пуст) → удаление лишних файлов на VM («[Файлы, которых нет в выкатываемом коммите](#файлы-которых-нет-в-выкатываемом-коммите)», `TARGET` — целевой коммит) → `./infrastructure/azure/deploy.sh redeploy` из этого checkout → последняя строка `IMBC_DEPLOY_RESULT=ok`.

**После `0006` — на версию v1.3 до contract** (любой коммит, начиная с `851660b`; на стенде — `8c748ea` ветки `demo/prototype-cabinets`). Схема назад не откатывается и не нужна: код этих версий не пишет удалённых значений, его `backfillSpecV13()` сравнивает текст (`type::text = 'spectator'`) и на базе после `0006` ничего не меняет, Drizzle не применяет миграций старше последней применённой, а удалённые таблицы каркаса этот код не читает. Порядок — ручной, описанный выше; серверную `.env` менять не нужно, эти версии принимают роль `observer`. `migrate` прежней версии снова выдаёт роли приложения UPDATE и DELETE на `nda_acceptance` (его список прав не знает об отзыве для этой таблицы); следующий выкат этого релиза снимает их снова.

**После `0006` — на версию до v1.3** (`d6ea422`). Только восстановлением резервной копии `/home/imbc/backup-before-0006.dump` (шаги 5–6 «До выката»): типам базы нужны прежние значения, а `0006` их удалила. Всё, что записано после копии, теряется. Копия восстанавливается в новую базу; живая база `imbc` не удаляется, пока замена не проверена и прежняя версия не выкачена. Команды — в `/home/imbc/imbc-platform` на VM; база Keycloak `keycloak` и роли кластера не затрагиваются.

1. Остановить новую версию:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml stop api worker </dev/null && echo stop-ok
   ```

2. Восстановить копию в новую базу `imbc_restore` и проверить её: те же два числа, что записаны при пробном восстановлении (шаг 6 «До выката»), и прежние значения в типе `role` (`spectator` есть — это копия до `0006`):

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres createdb -U imbc -O imbc imbc_restore </dev/null && echo createdb-ok
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres pg_restore -U imbc -d imbc_restore --exit-on-error --single-transaction < /home/imbc/backup-before-0006.dump && echo restore-ok
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc_restore -At -v ON_ERROR_STOP=1 -c "
     select (select count(*) from user_accounts) || ' user_accounts, ' || (select count(*) from manufacturer_profiles)
       || ' manufacturer_profiles, role ' || enum_range(null::role)::text;" </dev/null
   ```

3. Выдать роли приложения `imbc_app` то, что ей выдают `infrastructure/postgres/init.sql` и `migrate.ts`. Права на уровне базы копия `-Fc` не содержит; права на схемы и таблицы в копии есть, но выдаются повторно, чтобы не зависеть от этого:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc_restore -v ON_ERROR_STOP=1 \
     -c 'GRANT CONNECT, CREATE ON DATABASE imbc_restore TO imbc_app' \
     -c 'GRANT USAGE ON SCHEMA public TO imbc_app' \
     -c 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO imbc_app' \
     -c 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_entries FROM imbc_app' </dev/null && echo grants-ok
   ```

   Права на базу переходят вместе с ней при переименовании.

4. Убедиться, что к `imbc` никто не подключён (ожидается `0`), и поменять базы местами. Переименование выполняется из служебной базы `postgres`:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d postgres -At -v ON_ERROR_STOP=1 -c "
     select count(*) from pg_stat_activity where datname = 'imbc';" </dev/null
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d postgres -v ON_ERROR_STOP=1 \
     -c 'ALTER DATABASE imbc RENAME TO imbc_after_0006' \
     -c 'ALTER DATABASE imbc_restore RENAME TO imbc' </dev/null && echo swap-ok
   ```

   Если подключения есть, посмотрите, чьи они (`select pid, usename, application_name, state from pg_stat_activity where datname = 'imbc'`), и остановите их источник. Если первое переименование прошло, а второе нет, `swap-ok` не печатается: верните базу командой `ALTER DATABASE imbc_after_0006 RENAME TO imbc` и разберитесь. После `swap-ok` новую версию не запускать: её `migrate` применил бы `0006` к восстановленной базе снова.

5. Сверить Keycloak с восстановленной базой. База Keycloak `keycloak` при восстановлении копии не откатывается: пользователи, созданные или изменённые после времени копии (регистрации, приглашения, смена почты-логина администратором), остаются в Keycloak без строк в базе платформы или с другим адресом. Повторная регистрация или приглашение с тем же адресом получат отказ «адрес занят», а почта-логин, сменённая после копии, не совпадёт со строкой `user_accounts`. Консоль `/kc/admin/` (IP из `ADMIN_ALLOWED_IPS`), realm `imbc`, Users: просмотрите пользователей, созданных или изменённых после времени копии (время файла — `ls -l --time-style=full-iso /home/imbc/backup-before-0006.dump`), и сравните с восстановленной базой:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -At -v ON_ERROR_STOP=1 \
     -c 'select email, idp_subject from user_accounts order by email' </dev/null
   ```

   Пользователя без строки в базе удалите; у пользователя с другой почтой верните адрес из базы (email и username — `registrationEmailAsUsername`). На dev-стенде допустимо принять это расхождение без правки — тогда запишите в отчёт выката, какие адреса заняты только в Keycloak.

6. Дальше — шаги 2–6 подраздела ниже (шаг 1 уже выполнен): база в состоянии до `0006`, данные — v1.3, прежние значения снова есть в типах. Лишние файлы (шаг 5) считаются для `TARGET=d6ea422`.

7. Только после того, как прежняя версия выкачена и проверена (вход, данные), удалить базу после `0006`. До этого она — полная копия данных на момент отката, и обратный путь — остановить `api` и `worker` и переименовать базы обратно:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres dropdb -U imbc imbc_after_0006 </dev/null && echo dropdb-ok
   ```

#### Откат на версию до v1.3 — только до выката 0006

Откат на версию до v1.3 (последний такой коммит этой ветки — `d6ea422`; его код в `apps`, `packages`, `infrastructure` и `compose.yaml` совпадает с концом ветки `azure-dev-deployment`, `71a2df5`) делается только вручную: эти коммиты старше конвейера. Схема не откатывается: до `0006` прежние значения `spectator` и `inactive` остаются в типах, поэтому прежняя версия работает с этой базой, если вернуть ей данные и адрес демо-наблюдателя. Откат на стенде не выполнялся; порядок ниже выведен из кода.

Почему порядок именно такой:

- Прежняя версия сама ничего не возвращает. Её `migrate.js` не содержит переноса данных, а `sync-realm.py` пользователей не трогает: в версии `d6ea422` нет ни `LEGACY_DEMO_USERS`, ни переименования, скрипт обновляет только настройки realm и клиента.
- Прежний seed выполняется внутри самого выката: сервис `migrate` запускает `migrate.js && seed.js` (`compose.yaml`). Он вставляет `spectator@spectator.local` с `onConflictDoNothing`. Если к этому моменту адрес не возвращён, появляется второй аккаунт (`invited`, без `idp_subject`), и обратный `UPDATE` адреса упадёт на уникальном индексе `user_accounts_email_uq` (`lower(email)`).
- Вход сверяет адрес: прежняя версия находит аккаунт по `idp_subject` и пускает, только если его email совпадает с email в Keycloak (`findAccountForLogin`). Поэтому адрес меняется и в `user_accounts`, и в Keycloak.
- Значения перечислений лучше вернуть до выката, остановив `api` и `worker` новой версии. Новая версия не знает `spectator` и `inactive`, прежняя — `observer` и `unresponsive`: роль читается из `user_accounts` при каждом запросе, и для неизвестной роли запрос завершается ошибкой 500. С остановленными `api` и `worker` до конца выката API не отвечает вовсе, зато ни одна версия не видит чужих значений.
- Ручной выкат дополняет каталог приложения и файлов не удаляет (раздел «Обновление приложения»). Сборка `api` прежней версии (`tsc` по всему `src`) подхватила бы оставшиеся новые модули (`modules/reviews`, `modules/admin` и другие). Они импортируют из `@imbc/contracts` то, чего в прежней версии нет, и сборка остановится. Поэтому файлы, добавленные после целевого коммита, удаляются до выката.

Шаги:

1. Остановить новую версию: `sudo docker compose -f compose.yaml -f compose.azure.yaml stop api worker </dev/null` в `/home/imbc/imbc-platform`.
2. Вернуть данные одной транзакцией. Значения и колонки — как в схеме `d6ea422` (`organizations.type`, `user_accounts.role`, `manufacturer_profiles.update_status`, `catalog_visible.update_status`); в типах базы есть и прежние, и новые значения:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -v ON_ERROR_STOP=1 --single-transaction \
     -c "UPDATE user_accounts SET email = 'spectator@spectator.local'
           WHERE lower(email) = 'observer@observer.local'
             AND NOT EXISTS (SELECT 1 FROM user_accounts WHERE lower(email) = 'spectator@spectator.local')" \
     -c "UPDATE organizations SET type = 'spectator' WHERE type::text = 'observer'" \
     -c "UPDATE user_accounts SET role = 'spectator' WHERE role::text = 'observer'" \
     -c "UPDATE manufacturer_profiles SET update_status = 'inactive' WHERE update_status::text = 'unresponsive'" \
     -c "UPDATE catalog_visible SET update_status = 'inactive' WHERE update_status::text = 'unresponsive'" \
     </dev/null && echo revert-ok
   ```

   `--single-transaction` объединяет все `-c` в одну транзакцию; psql печатает число строк каждого `UPDATE`, `revert-ok` — только после фиксации. Первый `UPDATE` должен изменить одну строку; если он изменил 0 строк, а аккаунт `spectator@spectator.local` уже есть, см. «Если второй аккаунт всё же появился».
3. Переименовать пользователя Keycloak обратно: консоль `/kc/admin/` (IP из `ADMIN_ALLOWED_IPS`), realm `imbc`, Users, `observer@observer.local`. Email заменить на `spectator@spectator.local`. В realm включено `registrationEmailAsUsername`, поэтому username должен смениться вместе с email; после сохранения проверьте оба поля. Это обратный вызов к тому, что делал `sync-realm.py` версий v1.3 до contract: `kcadm.sh update users/<id> -s username=… -s email=…`. id и пароль пользователя не меняются.
4. Серверная `.env`: если пара демо-наблюдателя в `DEV_FIXED_OTP_ACCOUNTS` уже переписана на `"role":"observer"`, вернуть `"role":"spectator"`. Прежняя версия не знает роли `observer`, и `api` с такой `.env` не запустится. UUID в паре менять не нужно.
5. Удалить на VM файлы, добавленные после целевого коммита, — по всем коммитам, которые выкатывались на VM (на стенде — и `8c748ea` с прототипом, и откатываемая голова ветки стенда): «[Файлы, которых нет в выкатываемом коммите](#файлы-которых-нет-в-выкатываемом-коммите)» с `TARGET=d6ea422`. Развёрнутые коммиты берутся из маркеров и журналов на VM, а не из записанного в runbook SHA.

6. Выкатить прежнюю версию: `./infrastructure/azure/deploy.sh redeploy` из checkout `d6ea422`. Прежний seed найдёт `spectator@spectator.local` и второго аккаунта не создаст. Строки демо-компаний в `catalog_visible` он перезапишет со статусом `active`.

**Сеансы при откате не отзываются.** Обратный `UPDATE` не меняет `auth_version`, а роль читается из `user_accounts` на каждом запросе. Открытые сеансы и доверенные устройства наблюдателя остаются действительными и после выката прежней версии работают с ролью `spectator`. Закрыть их можно отдельно: `DELETE FROM sessions WHERE user_id = '<UUID аккаунта>'`.

**Если второй аккаунт всё же появился** (прежнюю версию выкатили до шага 2): у дубля адрес `spectator@spectator.local`, состояние `invited`, `idp_subject` и `last_sign_in_at` пусты, `created_at` — время выката. Исходный аккаунт по-прежнему `observer@observer.local`, и именно его UUID стоит в `DEV_FIXED_OTP_ACCOUNTS`. Проверить:

```sql
SELECT id, email, role, state, idp_subject, last_sign_in_at, created_at
FROM user_accounts WHERE lower(email) IN ('spectator@spectator.local', 'observer@observer.local');
```

Удалить только дубль. Условие ниже не даст удалить аккаунт, который уже входил. Сеансы, доверенные устройства, файлы и подписки выгрузок удалились бы каскадом, но у аккаунта, который ни разу не входил, их нет; остальные внешние ключи на `user_accounts` без каскада и остановят удаление, если на дубль что-то ссылается. Затем выполнить шаг 2 и шаг 3:

```sql
DELETE FROM user_accounts
WHERE lower(email) = 'spectator@spectator.local' AND state = 'invited'
  AND idp_subject IS NULL AND last_sign_in_at IS NULL;
```

После `0006` этот подраздел применяется только после восстановления копии (см. «После `0006` — на версию до v1.3» выше).

## Справочники, файлы и уведомления (этап 2)

Этап 2 — миграции `0009_stage2_foundation` и `0010_stage2_reference_data`, двенадцать справочников с загрузкой значений из файлов репозитория, файлы с проверкой ClamAV и образец оргструктуры, журнал писем `notification` с диспетчером `notify`, тема писем Keycloak `imbc` (план — `docs/superpowers/plans/2026-11-13-stage-2-dictionaries-files-notifications.md`). **Состояние на 13.11.2026: этап реализован в ветке `feat/stage-2-foundation` и на стенд не выкатывался; на стенде работает этап 1 (`306b58e`, ветка стенда `demo/prototype-cabinets`).** Выкат — только по отдельной команде владельца. Раздел написан по коду и схеме ветки: команды ниже на стенде ещё не выполнялись; отмечено, что проверялось на живых системах и что нет. Результат выката записывается в `docs/deployment/verification-<дата>.md`.

Миграции этапа только добавляют (`0009` — `CREATE TYPE`, `CREATE TABLE`, индексы и внешние ключи; `0010` — `INSERT … ON CONFLICT DO NOTHING`), поэтому код откатывается на этап 1 без восстановления базы (NFR-06); таблицы, которые читает или пишет прежняя версия, остаются до отдельного релиза contract («Contract этапа 2» ниже).

### До выката этапа 2

Команды — в `/home/imbc/imbc-platform` на VM (`./infrastructure/azure/deploy.sh ssh`); формат тот же, что в разделе «[Релиз contract (0006)](#релиз-contract-0006)»: блоки можно вставлять целиком, у каждой `docker compose exec -T` стоит `</dev/null`.

1. **Что выкатывается.** Выкат — из ветки стенда `demo/prototype-cabinets`, в которую влита ветка этапа (как при выкате этапа 1: прототип остаётся в дереве, ручной выкат файлов на VM не удаляет). Два места конфликтуют при слиянии. В `apps/api/src/database/migrate.ts` порядок должен быть: миграции Drizzle → при `PROTOTYPE_CABINETS=true` `createPrototypeTable(pool)` → `applyAppRoleGrants(pool, appRole)` → `loadReferenceDirectory(…, 'release')` (таблица прототипа создаётся до выдачи прав, а справочники грузятся после прав). В меню прототипа администратора есть свой пункт «Справочники» — дубль убирается так же, как пункт «Организации и аккаунты» в `306b58e`. До выката в чистом checkout слитой ветки проходят `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test && pnpm build` и `docker compose config -q` (с оверлеем Azure — `PUBLIC_HOST=<хост> docker compose -f compose.yaml -f compose.azure.yaml config -q`: без `PUBLIC_HOST` оверлей не собирается). Этап 2 не удаляет файлов ветки этапа 1 (`git diff --diff-filter=D --name-only f453d39..<коммит>` пуст), но список «[Файлы, которых нет в выкатываемом коммите](#файлы-которых-нет-в-выкатываемом-коммите)» всё равно проходят: он строится по маркерам на VM.

2. **На стенде этап 1 и девять миграций** (после выката их будет 11):

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -At -v ON_ERROR_STOP=1 -c "
     select count(*) from drizzle.__drizzle_migrations;" </dev/null
   ```

   Ожидается `9`. Другое число — стенд не на этапе 1: выяснить, что выкачено (`.deployed-source-commit`, `.deployed-revision`), и не продолжать.

3. **Очереди прежней версии пусты.** Новый worker не обслуживает `scan-file` и `send-notification` (их маршруты удалены), задание, оставшееся в них, не будет выполнено. Прежний код ничего в них не ставил, поэтому строк быть не должно:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -At -v ON_ERROR_STOP=1 -c "
     select name, state, count(*) from pgboss.job where name in ('scan-file', 'send-notification') group by name, state;" </dev/null
   ```

   Ожидается пустой вывод. Строки в состояниях `created`, `retry`, `active` — выкат отложить и разобрать, чьи это задания.

4. **Ящик IMBC задан.** Письма для IMBC (NOT-04 и далее, этапы 5–9) идут только на ящик, который администратор задал на `/admin/accounts`; не задан — письма нет, worker пишет предупреждение «ящик IMBC не задан» без адреса (раздел 8.2 спецификации, вопрос 52). Адрес не печатается:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -At -v ON_ERROR_STOP=1 -c "
     select (notification_mailbox is not null and btrim(notification_mailbox) <> '') as mailbox_set from organizations where type = 'imbc';" </dev/null
   ```

   Ожидается `t`. `f` — задать ящик под администратором до приёмки (на выкат это не влияет; на 13.11.2026 ящик на стенде не задан — [проверка выката этапа 1](verification-2026-11-13.md)).

5. **В Keycloak нет ручных «Realm overrides»** для писем: консоль `/kc/admin/` (IP из `ADMIN_ALLOWED_IPS`), realm `imbc`, Realm settings → Localization → Realm overrides; для языков kk, ru и en фильтр по `executeActions`, `passwordReset`, `emailVerification`, `requiredAction`, `linkExpirationFormatter` должен быть пуст: переопределения накладываются поверх темы писем `imbc` и вернули бы старые тексты. В репозитории таких переопределений нет, на самом стенде это ещё не проверялось.

6. **Резервная копия** — общий порядок, как перед `0006`; для отката этапа она не нужна (миграции только добавляют). Проверьте место на диске (`df -h /`: пересобираются образы, в том числе Keycloak с темой) и снимите копию:

   ```bash
   umask 077
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres pg_dump -U imbc -d imbc -Fc </dev/null > /home/imbc/backup-before-0009.dump && echo dump-ok
   ls -lh /home/imbc/backup-before-0009.dump
   ```

   Без `dump-ok` дальше не идти. Пробное восстановление — шаг 6 релиза `0006` с именем файла `backup-before-0009.dump`. Удалить копию можно, когда она больше не нужна; копия перед релизом contract (`0011`) обязательна — после него возврата кодом нет.

7. **Образ ClamAV.** `clamav/clamav:1.4` не имеет сборки под arm64: на VM (`Standard_D4as_v5`, amd64) это не важно, а на Mac с Apple Silicon контейнер идёт только под эмуляцией (`platform: linux/amd64`, локальная настройка вне репозитория) — важно для локальной проверки.

### Что делает выкат этапа 2

Шаги одинаковы для `./infrastructure/azure/deploy.sh redeploy` и для [конвейера](#конвейер-развёртывания) (оба запускают `infrastructure/azure/vm-deploy.sh`).

1. **Compose** (`up -d --build --remove-orphans --wait --wait-timeout 600`):
   - одноразовый `migrate` применяет `0009` и `0010` (в `drizzle.__drizzle_migrations` — 11 строк), выдаёт права роли приложения (`notification` — только добавление; `notification_rule` и `dictionary` — только чтение) и загружает `apps/api/reference-data/release`: в журнале по строке «Справочники: <код> +N (+M переводов)» — при первой загрузке `legal_form +3 (+9 переводов)`, `commodity_group +5 (+15 переводов)`, `contact_role +3 (+9 переводов)`, `certificate_type +10 (+30 переводов)`, `document_type +4 (+12 переводов)`;
   - затем при `SEED_DEMO=true` (на стенде так) `seed` грузит временные значения `provisional`, строки «Справочники (временные): <код> +N (+M переводов)»: `region +9`, `oked +4`, `tn_ved +4`, `kpved +2`, `commodity_type +5`, `process +3`, `equipment_type +2` (у каждого переводов столько же, сколько значений: в файлах одно название). Без `SEED_DEMO` эти семь списков остаются пустыми — как в продакшене. Повторный выкат везде показывает `+0`;
   - новые `api` и `worker` стартуют только после успешного `migrate`; `worker` создаёт очереди `file-scan` (политика `exclusive`), `file-scan-sweep`, `notify` и расписание `file-scan-sweep` (`*/15 * * * *`, Asia/Almaty); очереди `scan-file` и `send-notification` остаются в `pgboss.queue` без обработчиков;
   - **`clamav` пересоздаётся**: в его конфигурации появился том с `infrastructure/clamav/clamd.conf` (файл монтируется только для чтения и заменяет файл образа целиком: `AlertExceedsMax yes`, `MaxScanSize 1024M`, `MaxFileSize 512M`, `MaxScanTime 120000`, `StreamMaxLength 100M`). После старта контейнер заново поднимает clamd на сигнатурах из тома `clamav-db`; пока он не здоров (проверка здоровья даёт `start_period` 300 секунд), проверка файлов недоступна, задания `file-scan` повторяются (до 5 раз с нарастающей паузой), остальное подберёт зачистка `file-scan-sweep`. До выката на стенде работали настройки образа (проверка 13.11.2026 командой `clamconf`, только чтение: `StreamMaxLength` 104857600, `MaxFileSize` 104857600, `MaxScanSize` 419430400, `AlertExceedsMax` выключен);
   - `keycloak` пересобирается (в образ входит JAR темы с новой темой писем `imbc`) и пересоздаётся, `api` и `worker` — тоже: вход и письма пароля недоступны на время старта Keycloak.
2. **`realm-sync`**: `sync-realm.py --theme imbc` ставит realm-настройку `emailTheme` = `imbc` (аргумент `--email-theme` по умолчанию `imbc`; значение из серверной `.env` не читается); в журнале выката строка `Updated realm settings: …` с `emailTheme` в списке.
3. Готовность HTTPS/API и отказ закрытых маршрутов — как при любом выкате.

**Окно выката.** Пока прежний `worker` не остановлен, блокировка входа, обработанная им, пишется в `notifications_sent`: новый код сверяет NOT-03 и с этой таблицей, но прежний код журнала `notification` не знает, поэтому при гонке в окне в минуты NOT-03 может уйти дважды. Письма, записанные прежней версией до `0010`, перенесены в `notification` и дубля не дают.

**Файлы, смонтированные как файл** (`nginx.conf`, `clamd.conf`): выкат пересоздаёт контейнер, только если изменилась его конфигурация в Compose; правка одного файла контейнер не пересоздаёт (на выкате этапа 1 `nginx` до ручного пересоздания работал на прежнем `nginx.conf` — [проверка выката](verification-2026-11-13.md)). После правки любого из них: `sudo docker compose -f compose.yaml -f compose.azure.yaml up -d --force-recreate --no-deps <сервис>`. На этом выкате `nginx.conf` не менялся; `clamav` пересоздаётся самим выкатом.

### Проверки после выката этапа 2

Команды — на VM в `/home/imbc/imbc-platform` (`curl` для порта 9000 — на VM). Расхождение с ожидаемым выводом — выкат не принят: разобраться до приёмки.

1. Миграции и загрузка справочников. «Миграции применены» и строки «Справочники: …» — в журнале одноразового `migrate`; в базе 11 миграций:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml logs migrate </dev/null | grep -E 'Миграции применены|Справочники'
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -At -v ON_ERROR_STOP=1 -c "
     select count(*) from drizzle.__drizzle_migrations;" </dev/null
   ```

   Ожидается: «Миграции применены», пять строк «Справочники: …» (значения — в разделе «Что делает выкат этапа 2») и семь «Справочники (временные): …»; число `11`.

2. Двенадцать справочников и число действующих значений в каждом:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -At -v ON_ERROR_STOP=1 -c "
     select d.code, count(e.id) filter (where e.retired_at is null) as active
     from dictionary d left join dictionary_entry e on e.dictionary_id = d.id
     group by d.code order by d.code;" </dev/null
   ```

   Ожидается 12 строк `код|число`:

   ```text
   certificate_type|10
   commodity_group|5
   commodity_type|5
   contact_role|3
   document_type|4
   equipment_type|2
   kpved|2
   legal_form|3
   oked|4
   process|3
   region|9
   tn_ved|4
   ```

   Списки спецификации — `legal_form` 3, `commodity_group` 5, `contact_role` 3, `certificate_type` 10, `document_type` 4 — есть всегда; `region` 9, `oked` 4, `tn_ved` 4, `kpved` 2, `commodity_type` 5, `process` 3, `equipment_type` 2 — только на стенде с `seed` (без него в этих семи строках `0`).

3. Семнадцать правил писем:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -At -v ON_ERROR_STOP=1 -c "
     select count(*) from notification_rule;" </dev/null
   ```

   Ожидается `17`.

4. Перенос прежнего журнала: в `notification` есть каждое письмо, которое записала прежняя версия. Третье число — строки `notifications_sent` с кодом правила, которых нет в `notification` по `dedup_key`:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -At -v ON_ERROR_STOP=1 -c "
     select (select count(*) from notifications_sent) as legacy,
            (select count(*) from notification where rule_code = 'NOT-03') as journal_not03,
            (select count(*) from notifications_sent s
              where s.code in (select code from notification_rule)
                and not exists (select 1 from notification n
                  where n.dedup_key = s.code || E'\n' || s.dedupe_key || E'\n' || lower(s.recipient))) as not_moved;" </dev/null
   ```

   Ожидается `not_moved` = `0`. Прежняя версия писала в журнал только NOT-03, поэтому сразу после выката `legacy` = `journal_not03`; позже второе число растёт (новые письма пишутся только в `notification`).

5. Права роли приложения на новые таблицы:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -v ON_ERROR_STOP=1 \
     -c '\dp notification' -c '\dp notification_rule' -c '\dp dictionary' -c '\dp dictionary_entry' </dev/null
   ```

   В столбце прав у `imbc_app`: `notification` — `imbc_app=ar/imbc` (только `a` — INSERT и `r` — SELECT; букв `w` и `d` нет); `notification_rule` и `dictionary` — `imbc_app=r/imbc` (только чтение); `dictionary_entry` — `imbc_app=arwd/imbc` (значения ведёт администратор через API).

6. Очереди и расписание:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -At -v ON_ERROR_STOP=1 \
     -c "select name, policy, retry_limit from pgboss.queue where name in ('file-scan', 'file-scan-sweep', 'notify') order by name" \
     -c "select name, cron, timezone from pgboss.schedule where name = 'file-scan-sweep'" </dev/null
   sudo docker compose -f compose.yaml -f compose.azure.yaml logs worker </dev/null | grep 'очередей'
   ```

   Ожидается `file-scan|exclusive|5`, `file-scan-sweep|standard|5`, `notify|standard|10`, затем `file-scan-sweep|*/15 * * * *|Asia/Almaty` и строка журнала worker `очередей: 19, расписаний: 10 (Asia/Almaty)` (на одну очередь больше, чем у этапа 1: `file-scan`, `file-scan-sweep`, `notify` вместо `scan-file` и `send-notification`).

7. ClamAV здоров и работает с настройками платформы:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml ps clamav </dev/null
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T clamav clamconf </dev/null | grep -E 'AlertExceedsMax|MaxScanSize|MaxFileSize|StreamMaxLength'
   ```

   В `STATUS` — `healthy` (после пересоздания — через несколько минут). В выводе `clamconf`: `AlertExceedsMax` — `yes`, `MaxScanSize` — `1073741824`, `MaxFileSize` — `536870912`, `StreamMaxLength` — `104857600` (оформление строк зависит от `clamconf`, сверяются значения; на живом clamd с этим файлом значения подтверждены 13.11.2026 локально, на стенде — нет). `StreamMaxLength` не меньше 26 214 400 байт (25 МБ): меньше — проверка файла ответит «INSTREAM size limit exceeded» и версия не пройдёт скан.

8. Realm и тема писем:

   ```bash
   sudo sh -c 'grep -h "Updated realm settings" "$(ls -t /var/log/imbc-deploy/deploy-*.log | head -1)"'
   sudo docker compose -f compose.yaml -f compose.azure.yaml logs keycloak </dev/null | grep -c 'Failed to find EMAIL theme'
   ```

   Первая команда печатает строку со списком настроек, в нём есть `emailTheme`; вторая — `0` (нет строк «Failed to find EMAIL theme imbc»). Значение проверяется в консоли `/kc/admin/` (IP из `ADMIN_ALLOWED_IPS`): realm `imbc` → Realm settings → Themes → Email theme = `imbc`.

9. Хранилище файлов закрыто (NFR-09): порт S3 не опубликован, анонимный запрос бакета не проходит:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' --max-time 3 http://127.0.0.1:9000/
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T api node -e "fetch('http://rustfs:9000/imbc-files/').then((r) => console.log(r.status))" </dev/null
   ```

   Первая команда — `000` (нет соединения: порт 9000 не опубликован, в `compose.azure.yaml` у `rustfs` только `127.0.0.1:9001`); вторая — `403` (анонимный запрос к закрытому бакету; код для RustFS на стенде не проверялся — любой ответ, кроме `200`, означает, что бакет не открыт анонимно, а `200` — остановка выката).

10. Сервисы `api`, `worker`, `keycloak`, `postgres`, `valkey`, `clamav`, `mailpit` — `healthy`, в журналах `api` и `worker` нет ошибок и нет адресов Adata; `nginx` — `Up` (раздел «Проверка после выката», «Проверки этапа 1», шаг 5):

    ```bash
    sudo docker compose -f compose.yaml -f compose.azure.yaml ps </dev/null
    ```

### Приёмка этапа 2 на стенде

Только по команде владельца, после выката и проверок выше. Сценарий — план этапа 2, раздел «Приёмка», шаги 2–7: справочники (`admin@imbc.local`, `/references`), директор (`director@imbc.local`), образец оргструктуры (PDF, файл с тестовой строкой EICAR, 409 для файла на проверке), права на файл (оператор — 403 и запись `file.read` `denied`, производитель — текущий образец), уведомления (NOT-03 и NOT-02 в журнале, язык письма), NOT-01 на казахском и английском. Входы демо-ролей — код `000000`; новые адреса — `*.local`, письма — в Mailpit (`/dev-mail/`); реальные адреса не используются (квота отправителя Azure мала). Регистрации приёмки, дошедшие до установки пароля, запускают платное чтение Adata (предел на стенде — 25, шаг 7 раздела «Релиз contract (0006)»): решить, временно ли ставить `ADATA_MONTHLY_LIMIT=0`, до начала. Результат — `docs/deployment/verification-<дата>.md`.

### Откат этапа 2

Откатывается код, схема не откатывается и не нужна: прежняя версия не читает новые таблицы, а читаемые ею скелетные таблицы остаются. Порядок — как в разделе «Откат» после «Релиз contract (0006)» (ручной откат на версию v1.3 до contract): чистый checkout целевого коммита (этап 1 — `306b58e`, ветка стенда), `git status --short` пуст → удаление лишних файлов на VM («[Файлы, которых нет в выкатываемом коммите](#файлы-которых-нет-в-выкатываемом-коммите)», `TARGET=306b58e`: сборка этапа 1 подхватила бы оставшиеся модули этапа 2 и остановилась) → `./infrastructure/azure/deploy.sh redeploy` → `IMBC_DEPLOY_RESULT=ok`. Что остаётся после отката:

- **Данные этапа 2** (справочники, значения, 17 правил, `notification`, `file_object`, `file_version`, `org_chart_sample`, байты в бакетах) лежат нетронутыми; при повторном выкате этапа 2 они используются как есть (загрузка `release` и `seed` идемпотентны).
- **Очереди.** Прежний worker снова обслуживает `scan-file` и `send-notification`; очереди `file-scan` и `notify` остаются без обработчика, задания в них не выполняются. Перед откатом посмотреть, что в них ждёт: `select name, state, count(*) from pgboss.job where name in ('file-scan', 'notify') group by name, state;` — задание `notify` в `created`, `retry` или `active` — письмо не уйдёт.
- **Письма.** Письма, отправленные новой версией, прежняя не знает (журнал `notification`, она читает и пишет `notifications_sent`): при откате возможен повтор NOT-03 по событиям последних минут (прежний worker читает события Keycloak окном пять минут).
- **Keycloak.** Realm-настройка `emailTheme` = `imbc` остаётся; если образ Keycloak откатывается на прежний (без темы `imbc` в JAR), по исходникам Keycloak 26.4 он пишет «Failed to find … theme … using built-in themes» и берёт тему по умолчанию: письма идут, но с исходными текстами Keycloak (казахские — с буквальными `\n\n`). `sync-realm.py` прежней версии `emailTheme` не меняет; на стенде этот путь не проверялся.
- **ClamAV.** Прежняя конфигурация Compose не монтирует `clamd.conf`: контейнер пересоздаётся с настройками образа.
- После релиза contract (`0011`) возврат кодом невозможен — только восстановление копии.

### Обслуживание после этапа 2

- **Письма.** Задание `notify` в состоянии `failed` — письмо не ушло после 10 повторов (около 8,5 часа): письмо этого события не досылается. Строка `error` в журнале worker «письмо не будет отправлено, без повторов» или «задание отклонено без повторов» — постоянный отказ (нет правила, шаблона или подстановки, неготовая часть получателей): задание завершено `completed` и в pg-boss выглядит успешным, причина — только в журнале (код правила и причина, без адресов):

  ```bash
  sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -c "
    select state, count(*) from pgboss.job where name = 'notify' group by state;" </dev/null
  sudo docker compose -f compose.yaml -f compose.azure.yaml logs --since 24h worker </dev/null | grep -E 'notification NOT-[0-9]+:'
  ```

  Предупреждение «ящик IMBC не задан» — шаг 4 «До выката этапа 2».
- **Файлы.** Версии в `pending` дольше 15 минут — ClamAV недоступен или `worker` не работает (зачистка `file-scan-sweep` ставит их снова раз в 15 минут); отклонённые с сигнатурами `object_missing` и `checksum_mismatch` — признак проблемы хранилища, а не вируса (объекта нет в карантине или сумма не совпала спустя 15 минут повторов):

  ```bash
  sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -At -v ON_ERROR_STOP=1 \
    -c "select count(*) from file_version where scan_state = 'pending' and uploaded_at < now() - interval '15 minutes'" \
    -c "select at, diff->>'signature' from audit_entries where action = 'file.scan_rejected' order by at desc limit 20" </dev/null
  ```

  Первое число должно быть `0`. Сигнатура `Heuristics.Limits.Exceeded…` — файл превысил предел проверки `clamd.conf` (отклонён намеренно); имя файла и ключ объекта в журналах и аудите не пишутся. Отказы загрузки DOCX и XLSX (`415 file_structure_unsupported`) видны в журнале `api` строкой `File upload: ZIP structure not accepted` с причиной `reason` и без имени файла.
- **Бакет карантина.** Правило жизненного цикла для `imbc-quarantine` (удалять объекты без строк в `file_version`) не настроено: объект остаётся, если процесс упал между записью в хранилище и фиксацией транзакции. Если правило вводить, срок должен быть заметно больше возможного простоя ClamAV, иначе будет удалён объект версии, которая ещё ждёт скана. Консоль S3 — через туннель (раздел «Доступ и секреты»).
- **Справочники.** Временные значения `provisional` на стенде остаются после появления перечней IMBC: загрузка ничего не удаляет, администратор выводит их из оборота или удаляет на `/references`.

### Contract этапа 2 (следующим релизом)

Релиз `0011_stage2_contract` — первой задачей этапа 3, отдельным релизом, по образцу `0006`. Состав:

1. Повторный перенос `INSERT INTO notification … SELECT … FROM notifications_sent … ON CONFLICT (dedup_key) DO NOTHING` (письма, которые прежняя версия записала после `0010`) и проверка, что каждая строка `notifications_sent` с кодом правила есть в `notification` по `dedup_key`; иначе `RAISE EXCEPTION`.
2. Проверка, что `dictionaries`, `dictionary_entries`, `file_objects` и `file_versions` пусты (иначе `RAISE EXCEPTION`): ни одна версия этапа 2 их не заполняет.
3. Удаление `notifications_sent`, `dictionaries`, `dictionary_entries`, `file_objects`, `file_versions` и типа `scan_state` (скелет); переименование `file_scan_state` в `scan_state`.
4. `org_chart_sample.is_current` — умолчание `false` (сейчас `true`, как в DBML; от текущего образца без скана защищает то, что сервис вставляет `false`).
5. Из кода уходят два места сверки с `notifications_sent` (`JobHandlers.recordLockout` и `MailService.sentByPreviousVersion`, оба помечены «Убрать в contract») и схема `notificationsSent`; строки очередей `scan-file` и `send-notification` в `pgboss.queue` удаляются вручную.
6. Перечисления PostgreSQL `contact_role` и `commodity_group` релиз не трогает: первое уходит вместе с заменой `contacts` на DBML `contact` (этап 3), второе — вместе с проекцией `catalog_profile` (этап 5).

До выката — те же проверки данных, что внутри миграции (чтобы не ждать её отказа), и резервная копия с пробным восстановлением (шаги 5–6 релиза `0006`, файл `backup-before-0011.dump`):

```bash
sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -At -v ON_ERROR_STOP=1 -c "
  select 'dictionaries' as t, count(*) from dictionaries
  union all select 'dictionary_entries', count(*) from dictionary_entries
  union all select 'file_objects', count(*) from file_objects
  union all select 'file_versions', count(*) from file_versions
  union all select 'not_moved', count(*) from notifications_sent s
    where s.code in (select code from notification_rule)
      and not exists (select 1 from notification n
        where n.dedup_key = s.code || E'\n' || s.dedupe_key || E'\n' || lower(s.recipient));" </dev/null
```

Ожидается пять строк `имя|число`: первые четыре — `0` (иначе миграция остановится с ошибкой), `not_moved` может быть не нулевым — миграция перенесёт эти строки сама.

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

Не включайте на `worker` отладку запросов Node (`NODE_DEBUG=fetch`/`undici`, подписчик diagnostics-channel или трассировку исходящих HTTP-запросов): она выводит в журнал контейнера адрес Adata вместе с токеном (EXT-02, NFR-10).

Проверка публичного API из любой сети:

```bash
curl --fail --show-error https://imbc-dev-e1cde8dd.polandcentral.cloudapp.azure.com/api/health/ready
```

### Задание `identity-sync`

Блокировка, разблокировка и смена почты-логина действуют в БД сразу (сеансы BFF завершены в той же транзакции); Keycloak догоняет их заданием `identity-sync` worker: включён ли пользователь, почта из БД и выход из сеансов IdP. Задание несёт только id аккаунта и всегда приводит Keycloak к текущей строке БД, поэтому повтор безопасен. Состояние очереди:

```bash
sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -c "
  select state, count(*) from pgboss.job where name = 'identity-sync' group by state;" </dev/null
```

`failed` — пять повторов не прошли (обычно Keycloak недоступен или клиент `imbc-admin-api` без `manage-users`). Пользователь, удалённый в Keycloak (404), задание не валит: оно завершается, в журнале worker — `identity-sync: user not found in Keycloak` с `accountId`. Решение администратора от этого не меняется: вход проверяет состояние в БД. Если в журнале API есть `Failed to enqueue identity-sync` (очередь была недоступна сразу после смены почты), задания нет вовсе — возьмите `accountId` из этой строки. В обоих случаях после восстановления поставьте задание для аккаунта заново (команда печатает только id задания):

```bash
sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T worker node --input-type=module -e "
import { PgBoss } from 'pg-boss';
const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: process.env.PGBOSS_SCHEMA ?? 'pgboss', supervise: false, schedule: false });
await boss.start();
console.log(await boss.send('identity-sync', { accountId: '<id>', logout: true }));
await boss.stop();"
```

В `output` неудачного задания — операция и статус Keycloak (`Keycloak update user: 503`, `Keycloak logout user: …`) или сетевая ошибка; почты нет ни в задании, ни в тексте ошибки.

Консоль аккаунта Keycloak закрыта на Caddy: `curl -s -o /dev/null -w '%{http_code}' https://<стенд>/kc/realms/imbc/account/` — `404`, а `…/kc/realms/imbc/.well-known/openid-configuration` — `200`.

Почту-логин сам пользователь в Keycloak не меняет (MAN-05). Проверка после развёртывания: в журнале шага `realm-sync` — строка `User profile: …`; войдите демо-производителем и откройте `https://<стенд>/kc/realms/imbc/protocol/openid-connect/auth?client_id=imbc-bff&response_type=code&scope=openid&redirect_uri=https://<стенд>/api/auth/callback&kc_action=UPDATE_PROFILE` — на странице профиля только имя и фамилия (необязательные), поля почты нет, подставленное поле `email` игнорируется. Установка пароля по ссылке NOT-01 (регистрация или приглашение) заканчивается страницей «Всё готово» без шага «Данные учётной записи». Профиль realm: консоль `/kc/admin/` → realm `imbc` → Realm settings → User profile → у `email` и `username` «Who can edit» — только Admin, у `firstName` и `lastName` «Required field» выключено.

## Чтение Adata (IMBC-07, EXT-02)

Каждое чтение — настоящий платный запрос: одна единица квоты заказчика (3 000 БИН в месяц). На стенде чтение **закрыто по умолчанию**: `ADATA_MONTHLY_LIMIT` в `compose.azure.yaml` — `0`, попытки заканчиваются `quota_exhausted` без запроса. Владелец открывает его на одно чтение строкой в серверной `.env` и закрывает сразу после — порядок ниже обязателен. Токен `ADATA_API_TOKEN` получает только сервис `worker`, из серверной `.env`; без него попытки заканчиваются `not_configured`.

### Что запускает чтение

Аккаунт с ролью `manufacturer`, у организации есть БИН, профиль `source = 'manual'`, `status = 'draft'`, попытки `profile_created` ещё нет. Чтение ставится при любом входе такого аккаунта и по событию пароля, которое увидел `keycloak-events`. Попытку в `quota_exhausted` или `not_configured` любой следующий вход и событие пароля ставят снова. Первый запуск `keycloak-events` после старта читает события с `auth_sync_state.checked_at` минус пять минут; если строки курсора нет — за 30 дней назад. Регистрация и повтор письма чтение не запускают.

Стенд публичный: зарегистрироваться с любым БИН с верным контрольным разрядом и задать пароль может кто угодно. Пока предел больше нуля, единицу израсходует первый такой производитель, а не обязательно владелец; 4-го числа (Asia/Almaty) начинается новый период, и при открытом пределе единица снова доступна.

### Токен не печатать

Не выполняйте `docker compose config` без `-q`, `docker inspect` контейнера `worker`, `docker compose exec worker env` и `printenv`: все они выводят значение токена.

### Перед выкатом

В серверной `.env` не должно быть строки `ADATA_MONTHLY_LIMIT`, иначе «закрыто по умолчанию» не действует. С 12.11.2026 на стенде это исключение сделано сознательно: владелец открыл чтение (`ADATA_MONTHLY_LIMIT=25`), и проверка ниже сегодня вернёт `1` — перед выкатом этапа 1 см. шаг 7 «До выката» в разделе «[Релиз contract (0006)](#релиз-contract-0006)».

```bash
cd /home/imbc/imbc-platform
sudo grep -c '^ADATA_MONTHLY_LIMIT=' .env
```

Ожидается `0` (команда печатает только число строк).

### Порядок одного чтения

Все команды — на VM в `/home/imbc/imbc-platform` (`./infrastructure/azure/deploy.sh ssh`), в bash.

1. **Перед чтением** — непосредственно перед шагом 2. Проверить курсор событий и число производителей, которые займут единицу, как только чтение откроется:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -c "
     select checked_at from auth_sync_state where name = 'keycloak-events';"
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -c "
     select count(*) from user_accounts a
     join organizations o on o.id = a.organization_id
     join manufacturer_profiles p on p.organization_id = o.id
     where a.role = 'manufacturer' and o.bin is not null and p.source = 'manual' and p.status = 'draft'
       and not exists (
         select 1 from external_check c
         join external_check_attempt t on t.external_check_id = c.id
         where c.profile_id = p.id and c.connector = 'adata' and t.trigger = 'profile_created'
           and t.state not in ('quota_exhausted', 'not_configured', 'queued'));"
   ```

   Первый запрос показывает, с какого момента будут прочитаны события пароля (нет строки — 30 дней). Второй считает производителей с Draft-профилем без попытки или с попыткой `quota_exhausted`, `not_configured` или `queued` (такая ждёт повтора задания и возьмёт единицу сразу после открытия); каждый из них займёт единицу. Число должно быть **0** (аккаунт, который владелец зарегистрирует, ещё не существует). Если не 0 — не открывать, пока не решит владелец. Иначе можно только так: дождаться, чтобы с последнего события пароля этого производителя прошло больше шести минут (опрос `keycloak-events` перечитывает события на пять минут назад и сам поставил бы его попытку снова), и закрыть его попытку вручную. До выката этой версии таблиц `external_check` и `external_check_attempt` ещё нет, и второй запрос падает с «relation does not exist»: выполните его без части `and not exists (…)` — попыток ещё нет ни у одного профиля.

2. **Открыть.** Добавить в серверную `.env` строку `ADATA_MONTHLY_LIMIT=1` и пересоздать worker:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml up -d worker
   sudo docker compose -f compose.yaml -f compose.azure.yaml ps worker
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T worker node -e "console.log((process.env.ADATA_API_TOKEN ?? '').length)"
   ```

   `ps` должен показать `healthy`: неверное значение переменной останавливает worker при старте, а с ним отзыв сеансов при смене пароля и письма установки пароля. Последняя команда печатает только длину токена — она должна совпасть с известной владельцу; значение не выводится. Сразу после `ps` повторить второй запрос шага 1 — ожидается `0` — и без паузы перейти к шагу 3. Пересозданный с пределом 1 worker сам, без чьего-либо входа, перечитывает в `keycloak-events` события с `checked_at` минус пять минут и снова ставит каждую попытку в `quota_exhausted` / `not_configured`, чьё событие пароля попало в это окно.

3. **Чтение.** Владелец регистрируется с БИН, устанавливает пароль, входит и открывает `/profile`. Чтение длится до 2,5 минуты (Get Request, опрос до 120 секунд, последняя проверка). Пока состояние не конечное, не перезапускайте `worker` и не выкатывайте: рестарт во время первого запроса закрывает попытку как `unavailable` (`interrupted`), единица уже израсходована, а `unavailable` для профиля окончательно. Когда состояние конечное, до закрытия проверить журналы:

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml logs worker | grep 'adata attempt'
   t=$(sudo sed -n 's/^ADATA_API_TOKEN=//p' .env | tr -d '\r"'"'"' '); echo "длина ${#t}"; [ ${#t} -ge 20 ] && sudo docker compose -f compose.yaml -f compose.azure.yaml logs --no-color worker api | grep -cF -f <(printf '%s\n' "$t"); unset t
   ```

   Порядок важен: `docker compose logs` показывает только текущий контейнер, а шаг 4 пересоздаёт worker — после него обе проверки смотрели бы журнал контейнера, который к Adata не обращался, и были бы ложно чистыми. Ожидается строка `adata attempt <id>: received`. Вторая команда убирает из значения кавычки, `\r` и пробелы, печатает только длину (она должна совпасть с известной владельцу), при длине меньше 20 не запускается, а образец передаёт через дескриптор файла — его нет ни в списке процессов, ни в истории; ожидаемый результат — `0`. Форму токена в %-кодировке эта проверка не находит: её проверяет тест утечки задания (`apps/api/test/adata-prefill.integration.test.ts`). БИН, значения ответа и адрес Adata в журнал не пишутся.

4. **Закрыть.** После `received` (или любого конечного состояния) и проверок журнала удалить строку `ADATA_MONTHLY_LIMIT=1` из серверной `.env` — вернётся предел по умолчанию 0 — и снова выполнить `sudo docker compose -f compose.yaml -f compose.azure.yaml up -d worker` и `sudo docker compose -f compose.yaml -f compose.azure.yaml ps worker` (`healthy`). Иначе 4-го числа единица снова станет доступна и её израсходует следующий вошедший производитель с Draft-профилем без решения владельца.

5. **Проверки после чтения.**

   ```bash
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -c "
     select period_start, used from adata_allowance;"
   sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -c "
     select t.id, o.bin, t.state, t.failure, t.requested_at, t.request_sent_at, t.completed_at
     from external_check_attempt t
     join external_check c on c.id = t.external_check_id
     join organizations o on o.id = c.organization_id
     where t.request_sent_at is not null;"
   ```

   Ожидается: `used = 1`, одна попытка с `request_sent_at`, `state = received` и БИН владельца — видно, на чей БИН ушла единица.

### Предел и периоды

Период сбрасывается 4-го числа (Asia/Almaty). При пределе 0 ни один вход и ни одно событие ничего не расходуют. Больше одного чтения за раз — только решением владельца: строка `ADATA_MONTHLY_LIMIT=<n>` (не больше 3000) в серверной `.env` и `sudo docker compose -f compose.yaml -f compose.azure.yaml up -d worker`. Попытки в `quota_exhausted` и `not_configured` ставятся снова при следующем входе, поэтому открытый предел расходуют следующие вошедшие производители с Draft-профилем; после чтения предел закрывается, как в шаге 4.

### Повтор неудачного чтения

`unavailable` для профиля окончательно, а БИН на платформе уникален: повтор — второй платный запрос по тому же БИН, только по новому явному «да» владельца. Вернуть попытку:

```sql
UPDATE external_check_attempt
SET state = 'not_configured', request_sent_at = NULL, poll_token = NULL, failure = NULL, completed_at = now()
WHERE id = '<id>' AND state = 'unavailable';
```

Следующий вход владельца ставит её снова (`requeued`); задание берёт её только в `queued` с `request_sent_at IS NULL`. В текущем периоде единица уже израсходована: откройте предел на единицу больше `used` из `adata_allowance` (например `ADATA_MONTHLY_LIMIT=2` при `used = 1`) по шагам 1–5; шаг 1 покажет `1` — эту самую попытку, других быть не должно.

### Ручное восстановление попытки

Если pg-boss исчерпал повторы задания `adata-prefill` (четыре сбоя собственной БД подряд), попытка может остаться в `queued` или `polling`, и задания для неё больше нет; вход и событие пароля такую попытку не трогают. Найти:

```sql
SELECT id, state, request_sent_at, poll_token IS NOT NULL AS has_poll_token, requested_at
FROM external_check_attempt
WHERE trigger = 'profile_created' AND state IN ('queued', 'polling')
  AND requested_at < now() - interval '15 minutes';
```

- `queued`, `request_sent_at IS NULL` — запроса не было; следующий вход поставит попытку снова:

  ```sql
  UPDATE external_check_attempt SET state = 'not_configured', completed_at = now()
  WHERE id = '<id>' AND state = 'queued' AND request_sent_at IS NULL;
  ```

- `polling` без `poll_token` — ответа нет, единица израсходована:

  ```sql
  UPDATE external_check_attempt SET state = 'unavailable', failure = 'interrupted', completed_at = now()
  WHERE id = '<id>' AND state = 'polling' AND poll_token IS NULL;
  ```

- `polling` с `poll_token` — поставить задание заново: одна проверка по сохранённому токену, без Get Request. Команда печатает только id задания:

  ```bash
  sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T worker node --input-type=module -e "
  import { PgBoss } from 'pg-boss';
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: process.env.PGBOSS_SCHEMA ?? 'pgboss', supervise: false, schedule: false });
  await boss.start();
  console.log(await boss.send('adata-prefill', { attemptId: '<id>' }));
  await boss.stop();"
  ```

SQL выполняется через `sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -v ON_ERROR_STOP=1`.

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

Автоматические проверки ветки `feat/spec-v1.3-contracts` на 12.11.2026: 206 тестов API (из них 80 на отдельной PostgreSQL 18), 87 contracts и 185 web; подробности — README, раздел 14. Они не подтверждают прохождение браузерных сценариев конкретного развёртывания. Объём дальнейшей работы и критерии приёмки по ролям — в [development-roadmap.md](../development-roadmap.md).

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
| `observer@observer.local` | `observer` | `DEV_FIXED_OTP_ACCOUNTS` |
| `manufacturer@demo.local` | `manufacturer` | `DEV_FIXED_OTP_ACCOUNTS` |
| `test-admin@imbc.local` | `administrator` | совместимый `DEV_FIXED_OTP_USER_ID` |

Пароли остаются прежними и обязательными. Начальный пароль seed-аккаунтов хранится в `KEYCLOAK_DEV_USER_PASSWORD` серверной `.env`; пароль отдельного тестового администратора — в локальном файле владельца `~/.config/imbc/test-admin-access.md` (0600), вне Git. Права ролей, принятие ответственности, сроки сеанса, лимит пяти попыток, срок кода 10 минут и пауза повторного запроса 60 секунд сохраняются. Стартовая страница после входа: оператор, наблюдатель и директор — `/dashboard` (OPR-31), SME — `/reviews`, производитель — `/profile`, администраторы — `/admin/accounts` (стартовые страницы SME и администратора — решение для демо, спецификация их не задаёт). Каталог, dashboard и профиль производителя администраторам недоступны. Администратор на `/admin/accounts` видит организации и аккаунты и выполняет действия (этап 1): создаёт организацию оператора или наблюдателя и отмечает major operator, приглашает пользователя и повторяет приглашение, блокирует и разблокирует аккаунт, меняет роль сотрудника IMBC и почту-логин производителя, задаёт ящик IMBC (ADM-01, ADM-02, ADM-03, ADM-05, GEN-05).

Исключение включается явными серверными настройками. Формат примера ниже требует подстановки настоящих UUID из `user_accounts`; email вместо UUID не подходит:

```dotenv
DEPLOYMENT_ENV=development
DEV_FIXED_OTP_ENABLED=true
DEV_FIXED_OTP_ACCOUNTS='[{"id":"<UUID expert@imbc.local>","role":"expert"},{"id":"<UUID admin@imbc.local>","role":"administrator"},{"id":"<UUID director@imbc.local>","role":"director"},{"id":"<UUID operator@operator.local>","role":"operator"},{"id":"<UUID observer@observer.local>","role":"observer"},{"id":"<UUID manufacturer@demo.local>","role":"manufacturer"}]'
DEV_FIXED_OTP_USER_ID=<UUID test-admin@imbc.local>
```

Прежнее имя роли `"role":"spectator"` с релиза contract (`0006`) отклоняется при старте: перед его выкатом пару демо-наблюдателя переписывают на `"role":"observer"`, UUID не меняется (см. [релиз contract](#релиз-contract-0006)).

По умолчанию tier — `production`, флаг выключен, `DEV_FIXED_OTP_ACCOUNTS=[]`. Список содержит объекты строго с полями `id` и `role`. Неверный JSON, недопустимые UUID/роли, повтор UUID и совпадение UUID из списка с legacy-настройкой отклоняются при старте даже при выключенном флаге. Включённый флаг требует `development` и хотя бы одну запись в списке или legacy UUID. `DEV_FIXED_OTP_USER_ID` остаётся совместимым способом разрешить отдельного администратора и не даёт исключения другим ролям. `NODE_ENV=production` означает оптимизированную сборку и не заменяет явный deployment tier.

При выдаче и проверке OTP сервер требует точное совпадение UUID и текущей роли с разрешённой парой. Выбор не зависит от email, домена `.local` или самого наличия роли: остальные аккаунты, включая новых производителей, получают случайные коды по почте. Включение `SEED_DEMO` само по себе список не заполняет и фиксированный OTP не разрешает.

Для отключения всего исключения задайте `DEV_FIXED_OTP_ENABLED=false`. Для отдельного seed-аккаунта удалите его пару из `DEV_FIXED_OTP_ACCOUNTS`; для отдельного тестового администратора очистите `DEV_FIXED_OTP_USER_ID`. Если после удаления не осталось разрешённых аккаунтов, также выключите флаг. Примените окружение пересозданием API/worker с обоими Compose-файлами или через `redeploy`. Удаление разрешения, выключение флага либо несовпадение текущей и ожидаемой роли делает уже выданный фиксированный код недействительным.

Отключение фиксированного OTP не блокирует аккаунты и не отзывает уже созданные сеансы или доверенные устройства. Для полного прекращения доступа администратор блокирует аккаунт на `/admin/accounts` (ADM-02): блокировка завершает открытые сеансы и снимает доверие к устройствам аккаунта.
