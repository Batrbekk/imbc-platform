# IMBC: dev-среда в Azure

Конфигурация одного dev-сервера для Docker-стека IMBC. Здесь используются вымышленные демо-данные и Mailpit с Azure Communication Services SMTP relay: настоящие адреса получают письма, письма демо-адресам `.local` остаются в Mailpit. Для шести seed-аккаунтов и отдельного тестового администратора задан OTP `000000` без письма; исключение ограничено списком UUID и ожидаемых ролей. Общая авторизация использует собственные экраны IMBC на shadcn/ui; у ролей есть стартовые страницы и демо-экраны только для чтения, предметные кабинеты ещё разрабатываются. С 12.11.2026 стенд работает на спецификации v1.3 — см. [Переход на спецификацию v1.3](#переход-на-спецификацию-v13). Эта инструкция описывает конфигурацию и обслуживание, а результаты проверки конкретного развёртывания фиксируются отдельно.

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

Realm Keycloak импортируется только при первом создании. После каждого развёртывания `infrastructure/azure/sync-realm.py --theme imbc` обновляет разрешённый набор настроек темы, политик, событий, SMTP и клиента BFF из `imbc-realm.json` и серверной `.env`. Пользователи, client secrets и посторонние настройки сохраняются; исключение — переименование одного демо-пользователя при переходе на v1.3 (см. [ниже](#переход-на-спецификацию-v13)). Повторный импорт realm не выполняется. Изменения управляемых полей только в консоли будут заменены следующей синхронизацией.

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

Спецификация v1.3 (раздел 3.1, UPD-06) переименовала роль и тип организации `spectator` в `observer` и статус актуальности профиля `inactive` в `unresponsive`; профиль unresponsive остаётся видимым и сортируется ниже (UPD-04). Демо-наблюдатель `spectator@spectator.local` стал `observer@observer.local`. Переход идёт по правилу expand → перенос данных → contract (NFR-06): этот релиз добавляет новые значения и переносит данные, прежние значения удаляет следующий релиз contract (миграция `0006`, состав — `docs/handoff/2026-11-11-context.md`, §8). На dev-стенде переход выполнен 12.11.2026 первым выкатом ветки `feat/spec-v1.3-contracts` (`851660b`): в журнале `migrate` — строка формата «Перенос v1.3: organizations N, user_accounts N, manufacturer_profiles N, catalog_visible N» с organizations 1, user_accounts 1, manufacturer_profiles 0, catalog_visible 0.

### Что делает выкат

Шаги одинаковы для `./infrastructure/azure/deploy.sh redeploy` и для [конвейера](#конвейер-развёртывания): оба запускают на VM `infrastructure/azure/vm-deploy.sh`. Отдельной команды для перехода нет.

1. **Compose** (`up -d --build --wait`, шаг `compose-up`). Одноразовый сервис `migrate` выполняет `node dist/database/migrate.js`:
   - миграция `0003_spec_v13_expand` добавляет `observer` в типы `role` и `organization_type` и `unresponsive` в тип `update_status`; прежние значения остаются, поэтому прежняя версия приложения продолжает работать с базой;
   - миграция `0004_catalog_tier` добавляет в `catalog_visible` вычисляемую колонку `tier` (IMBC-19, IMBC-20);
   - после фиксации миграций — перенос данных `backfillSpecV13()` (`apps/api/src/database/backfill.ts`): `spectator → observer` в `organizations.type` и `user_accounts.role`, `inactive → unresponsive` в `manufacturer_profiles.update_status` и `catalog_visible.update_status`. Число изменённых строк печатается строкой «Перенос v1.3: …». Повторный запуск ничего не меняет.
2. Затем, при `SEED_DEMO=true`, `seed.js` переименовывает демо-аккаунт в `user_accounts`: `spectator@spectator.local` → `observer@observer.local`. Идентификатор аккаунта, `idp_subject`, принятая ответственность, доверенные устройства и пара в `DEV_FIXED_OTP_ACCOUNTS` сохраняются. Если новый адрес уже занят, оба аккаунта остаются как были.
3. `api` и `worker` новой версии стартуют только после успешного `migrate` (`service_completed_successfully`).
4. Шаг `realm-sync`: `sync-realm.py --theme imbc` переименовывает пользователя Keycloak `spectator@spectator.local` → `observer@observer.local` (username и email; id и пароль сохраняются). Если новый адрес уже занят другим пользователем, скрипт печатает `Legacy demo user kept: target already exists` и ничего не меняет.
5. Готовность HTTPS/API и отказ закрытых маршрутов, как при любом выкате.

**Известное ограничение.** Перенос данных идёт в `migrate`, пока прежний `api` ещё работает: до его замены запрос наблюдателя к прежней версии завершается ошибкой 500. Окно — секунды, до старта нового `api`. Повторный запуск `migrate` безопасен.

### Проверка после выката

Команды ниже приведены для проверки; на стенде 12.11 выполнены только проверки снаружи без входа (readiness, отказ закрытых маршрутов), SQL-запросы и вход наблюдателя не выполнялись.

```bash
./infrastructure/azure/deploy.sh ssh
cd /home/imbc/imbc-platform
sudo docker compose -f compose.yaml -f compose.azure.yaml logs migrate | grep 'Перенос v1.3'
sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -c "
  select 'organizations' as t, count(*) from organizations where type::text = 'spectator'
  union all select 'user_accounts', count(*) from user_accounts where role::text = 'spectator'
  union all select 'manufacturer_profiles', count(*) from manufacturer_profiles where update_status::text = 'inactive'
  union all select 'catalog_visible', count(*) from catalog_visible where update_status::text = 'inactive';"
sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -c "
  select email, role from user_accounts where lower(email) in ('spectator@spectator.local', 'observer@observer.local');"
```

Ожидается: во всех четырёх строках первого запроса `0`; второй запрос возвращает одну строку `observer@observer.local | observer`.

Ожидаемый вход: `observer@observer.local` с прежним паролем демо-аккаунтов (`KEYCLOAK_DEV_USER_PASSWORD`) и кодом `000000` открывает `/dashboard`; страница компании не показывает focal point. Вход `spectator@spectator.local` после выката больше не работает: пользователь Keycloak переименован.

### Откат

Откат между коммитами v1.3 — как обычно (раздел «Откат» конвейера). Откат на версию до v1.3 (последний такой коммит этой ветки — `d6ea422`; его код в `apps`, `packages`, `infrastructure` и `compose.yaml` совпадает с концом ветки `azure-dev-deployment`, `71a2df5`) делается только вручную: эти коммиты старше конвейера. Схема не откатывается: прежние значения `spectator` и `inactive` остаются в типах до релиза contract, поэтому прежняя версия работает с этой базой, если вернуть ей данные и адрес демо-наблюдателя. Откат на стенде не выполнялся; порядок ниже выведен из кода.

Почему порядок именно такой:

- Прежняя версия сама ничего не возвращает. Её `migrate.js` не содержит переноса данных, а `sync-realm.py` пользователей не трогает: в версии `d6ea422` нет ни `LEGACY_DEMO_USERS`, ни переименования, скрипт обновляет только настройки realm и клиента.
- Прежний seed выполняется внутри самого выката: сервис `migrate` запускает `migrate.js && seed.js` (`compose.yaml`). Он вставляет `spectator@spectator.local` с `onConflictDoNothing`. Если к этому моменту адрес не возвращён, появляется второй аккаунт (`invited`, без `idp_subject`), и обратный `UPDATE` адреса упадёт на уникальном индексе `user_accounts_email_uq` (`lower(email)`).
- Вход сверяет адрес: прежняя версия находит аккаунт по `idp_subject` и пускает, только если его email совпадает с email в Keycloak (`findAccountForLogin`). Поэтому адрес меняется и в `user_accounts`, и в Keycloak.
- Значения перечислений лучше вернуть до выката, остановив `api` и `worker` новой версии. Новая версия не знает `spectator` и `inactive`, прежняя — `observer` и `unresponsive`: роль читается из `user_accounts` при каждом запросе, и для неизвестной роли запрос завершается ошибкой 500. С остановленными `api` и `worker` до конца выката API не отвечает вовсе, зато ни одна версия не видит чужих значений.
- Ручной выкат дополняет каталог приложения и файлов не удаляет (раздел «Обновление приложения»). Сборка `api` прежней версии (`tsc` по всему `src`) подхватила бы оставшиеся новые модули (`modules/reviews`, `modules/admin` и другие). Они импортируют из `@imbc/contracts` то, чего в прежней версии нет, и сборка остановится. Поэтому файлы, добавленные после целевого коммита, удаляются до выката.

Шаги:

1. Остановить новую версию: `sudo docker compose -f compose.yaml -f compose.azure.yaml stop api worker` в `/home/imbc/imbc-platform`.
2. Вернуть данные одной транзакцией. Значения и колонки — как в схеме `d6ea422` (`organizations.type`, `user_accounts.role`, `manufacturer_profiles.update_status`, `catalog_visible.update_status`); в типах базы есть и прежние, и новые значения:

   ```sql
   BEGIN;
   UPDATE user_accounts SET email = 'spectator@spectator.local'
     WHERE lower(email) = 'observer@observer.local'
       AND NOT EXISTS (SELECT 1 FROM user_accounts WHERE lower(email) = 'spectator@spectator.local');
   UPDATE organizations SET type = 'spectator' WHERE type::text = 'observer';
   UPDATE user_accounts SET role = 'spectator' WHERE role::text = 'observer';
   UPDATE manufacturer_profiles SET update_status = 'inactive' WHERE update_status::text = 'unresponsive';
   UPDATE catalog_visible SET update_status = 'inactive' WHERE update_status::text = 'unresponsive';
   COMMIT;
   ```

   Выполнить через `sudo docker compose -f compose.yaml -f compose.azure.yaml exec -T postgres psql -U imbc -d imbc -v ON_ERROR_STOP=1`. Первый `UPDATE` должен изменить одну строку; если он изменил 0 строк, а аккаунт `spectator@spectator.local` уже есть, см. «Если второй аккаунт всё же появился».
3. Переименовать пользователя Keycloak обратно: консоль `/kc/admin/` (IP из `ADMIN_ALLOWED_IPS`), realm `imbc`, Users, `observer@observer.local`. Email заменить на `spectator@spectator.local`. В realm включено `registrationEmailAsUsername`, поэтому username должен смениться вместе с email; после сохранения проверьте оба поля. Это обратный вызов к тому, что делает новый `sync-realm.py`: `kcadm.sh update users/<id> -s username=… -s email=…`. id и пароль пользователя не меняются.
4. Серверная `.env`: если пара демо-наблюдателя в `DEV_FIXED_OTP_ACCOUNTS` уже переписана на `"role":"observer"`, вернуть `"role":"spectator"`. Прежняя версия не знает роли `observer`, и `api` с такой `.env` не запустится. UUID в паре менять не нужно.
5. Удалить на VM файлы, добавленные после целевого коммита. Список готовится локально по `git`, защищённые файлы (`.env*`, relay-секрет) в нём быть не могут: Git их не отслеживает.

   ```bash
   DEPLOYED=8fe0fd4   # развёрнутый коммит: /home/imbc/imbc-platform/.deployed-source-commit на VM
   git diff --name-only --no-renames --diff-filter=A d6ea422 "$DEPLOYED" > /tmp/imbc-added.txt
   ssh -i ~/.ssh/imbc-dev-azure imbc@20.215.209.224 'cd /home/imbc/imbc-platform && sudo xargs -d "\n" rm -f --' < /tmp/imbc-added.txt
   ```

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

После релиза contract такой откат невозможен: в типах не останется прежних значений.

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

## Чтение Adata (IMBC-07, EXT-02)

Каждое чтение — настоящий платный запрос: одна единица квоты заказчика (3 000 БИН в месяц). На стенде чтение **закрыто по умолчанию**: `ADATA_MONTHLY_LIMIT` в `compose.azure.yaml` — `0`, попытки заканчиваются `quota_exhausted` без запроса. Владелец открывает его на одно чтение строкой в серверной `.env` и закрывает сразу после — порядок ниже обязателен. Токен `ADATA_API_TOKEN` получает только сервис `worker`, из серверной `.env`; без него попытки заканчиваются `not_configured`.

### Что запускает чтение

Аккаунт с ролью `manufacturer`, у организации есть БИН, профиль `source = 'manual'`, `status = 'draft'`, попытки `profile_created` ещё нет. Чтение ставится при любом входе такого аккаунта и по событию пароля, которое увидел `keycloak-events`. Попытку в `quota_exhausted` или `not_configured` любой следующий вход и событие пароля ставят снова. Первый запуск `keycloak-events` после старта читает события с `auth_sync_state.checked_at` минус пять минут; если строки курсора нет — за 30 дней назад. Регистрация и повтор письма чтение не запускают.

Стенд публичный: зарегистрироваться с любым БИН с верным контрольным разрядом и задать пароль может кто угодно. Пока предел больше нуля, единицу израсходует первый такой производитель, а не обязательно владелец; 4-го числа (Asia/Almaty) начинается новый период, и при открытом пределе единица снова доступна.

### Токен не печатать

Не выполняйте `docker compose config` без `-q`, `docker inspect` контейнера `worker`, `docker compose exec worker env` и `printenv`: все они выводят значение токена.

### Перед выкатом

В серверной `.env` не должно быть строки `ADATA_MONTHLY_LIMIT`, иначе «закрыто по умолчанию» не действует:

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

Пароли остаются прежними и обязательными. Начальный пароль seed-аккаунтов хранится в `KEYCLOAK_DEV_USER_PASSWORD` серверной `.env`; пароль отдельного тестового администратора — в локальном файле владельца `~/.config/imbc/test-admin-access.md` (0600), вне Git. Права ролей, принятие ответственности, сроки сеанса, лимит пяти попыток, срок кода 10 минут и пауза повторного запроса 60 секунд сохраняются. Стартовая страница после входа: оператор, наблюдатель и директор — `/dashboard` (OPR-31), SME — `/reviews`, производитель — `/profile`, администраторы — `/admin/accounts` (стартовые страницы SME и администратора — решение для демо, спецификация их не задаёт). Каталог, dashboard и профиль производителя администраторам недоступны. Администратор видит список организаций и аккаунтов только для чтения; приглашения, блокировки и других действий с аккаунтами в интерфейсе пока нет.

Исключение включается явными серверными настройками. Формат примера ниже требует подстановки настоящих UUID из `user_accounts`; email вместо UUID не подходит:

```dotenv
DEPLOYMENT_ENV=development
DEV_FIXED_OTP_ENABLED=true
DEV_FIXED_OTP_ACCOUNTS='[{"id":"<UUID expert@imbc.local>","role":"expert"},{"id":"<UUID admin@imbc.local>","role":"administrator"},{"id":"<UUID director@imbc.local>","role":"director"},{"id":"<UUID operator@operator.local>","role":"operator"},{"id":"<UUID observer@observer.local>","role":"observer"},{"id":"<UUID manufacturer@demo.local>","role":"manufacturer"}]'
DEV_FIXED_OTP_USER_ID=<UUID test-admin@imbc.local>
```

До релиза contract (см. [переход](#переход-на-спецификацию-v13)) прежняя пара `"role":"spectator"` в серверной `.env` принимается как `"role":"observer"`: UUID демо-наблюдателя при переименовании не меняется, поэтому `.env` после выката v1.3 править не нужно. Заменить `spectator` на `observer` нужно до релиза contract: после него прежнее имя роли отклоняется при старте.

По умолчанию tier — `production`, флаг выключен, `DEV_FIXED_OTP_ACCOUNTS=[]`. Список содержит объекты строго с полями `id` и `role`. Неверный JSON, недопустимые UUID/роли, повтор UUID и совпадение UUID из списка с legacy-настройкой отклоняются при старте даже при выключенном флаге. Включённый флаг требует `development` и хотя бы одну запись в списке или legacy UUID. `DEV_FIXED_OTP_USER_ID` остаётся совместимым способом разрешить отдельного администратора и не даёт исключения другим ролям. `NODE_ENV=production` означает оптимизированную сборку и не заменяет явный deployment tier.

При выдаче и проверке OTP сервер требует точное совпадение UUID и текущей роли с разрешённой парой. Выбор не зависит от email, домена `.local` или самого наличия роли: остальные аккаунты, включая новых производителей, получают случайные коды по почте. Включение `SEED_DEMO` само по себе список не заполняет и фиксированный OTP не разрешает.

Для отключения всего исключения задайте `DEV_FIXED_OTP_ENABLED=false`. Для отдельного seed-аккаунта удалите его пару из `DEV_FIXED_OTP_ACCOUNTS`; для отдельного тестового администратора очистите `DEV_FIXED_OTP_USER_ID`. Если после удаления не осталось разрешённых аккаунтов, также выключите флаг. Примените окружение пересозданием API/worker с обоими Compose-файлами или через `redeploy`. Удаление разрешения, выключение флага либо несовпадение текущей и ожидаемой роли делает уже выданный фиксированный код недействительным.

Отключение фиксированного OTP не блокирует аккаунты и не отзывает уже созданные сеансы или доверенные устройства. Для полного прекращения доступа нужна отдельная операторская деактивация аккаунта и отзыв его сеансов и устройств; пользовательского интерфейса для этой операции пока нет.
