# Azure: фактическое окружение и границы поставки, 16 ноября 2026

## Решение владельца

Владелец разрешил собирать архитектуру на существующем Azure-сервере, затем уточнил: **сейчас только существующая dev VM; новые платные ресурсы не создавать. Нормальные серверы будут предоставлены позже.** GitLab пока нет. Это разрешает подготовку переносимой поставки и согласованный переход dev-стенда на Kubernetes, но не подтверждает production-приёмку на одном сервере.

Azure provision, изменение NSG, остановка/выкат приложений, вызовы Adata и отправка писем не выполнялись. После Astra-одобрения и успешной закрытой предустановочной копии установлен только bare K3s на существующей VM; см. [проверенный runtime-результат](../deployment/verification-2026-11-16-k3s.md). После разрешения координатора выполнен узкий Azure RunCommand для чтения загрузки/портов; он обновляет штатное состояние extension, но не меняет приложения и данные. Значения секретов и серверных `.env` не читались и не публиковались. Изменения runtime координируются отдельно после проверки манифестов. Compose остаётся действующим до проверенного перехода.

## Источники

- [Текущая спецификация v1.4](../analyst/2026-11-13/specification-v1.4.md): §11.1, NFR-03–15, ACC-01–07, §13. Источник остаётся draft for sign-off; поля подписи пусты.
- [Ответы 13 ноября, вопрос 25](../analyst/2026-11-13/2026-11-13-replies.md): Kubernetes, GitLab CI/CD, Argo CD, Vault/OpenBao, мониторинг; кластер, топология и эксплуатант ещё не определены. Наличие GitHub не отменяет GitLab.
- [Полный roadmap](../development-roadmap.md): этапы 0–10, отдельный LPS 6б, оба релиза принимаются как одна фаза; §7 содержит внешние вводные.
- [Бриф архитектуры 11 ноября](../analyst/2026-11-11/v0.5-architecture-update-brief.md): применим там, где текущие v1.4/DBML не заменяют исторические правила.
- Архитектура v0.4, оригинальный PDF из `AZhunis/imbc-prototype` на `8c0f2a6065d409bbc73f9f2fdd7f86214bdb50e6`, `docs/architecture/IMBC-Architecture-v0.4.pdf`; проверены полные страницы 42–44 с §15, ADR-10/13/15/16 и таблица вопросов. 63 страницы, SHA-256 `960423dee6204326dc6348a48cdf9fb051b558c88474d01c2d8823e73a2b1ea3`. Функциональные правила этого PDF относятся к v1.2 и заменяются текущей v1.4.
- [Проверка этапа 2 на Azure](../deployment/verification-2026-11-14.md) и [локальная приёмка 3а](2026-11-16-codex-continuation.md).

## Проверенное состояние Azure

Read-only Azure CLI: `az account show`, `az resource list`, `az vm show/get-instance-view`, `az network public-ip/nsg/vnet`, `az disk list`, `az aks list`, `az vm list-usage`, `az provider show`.

| Объект | Факт |
|---|---|
| Подписка | `Azure subscription 1`, Enabled, текущая default-подписка |
| Resource group | `imbc-dev-rg`, Poland Central |
| VM | `imbc-dev`, Running, `Standard_D4as_v5` — 4 vCPU / 16 GiB |
| ОС | Canonical Ubuntu 24.04 LTS, exact image `24.04.202610250` |
| Диск | Один OS disk 128 GB `StandardSSD_LRS`; data disks отсутствуют |
| Public IP | Standard, static; `imbc-dev-e1cde8dd.polandcentral.cloudapp.azure.com` |
| NSG | 80/443 доступны из Internet; 22 ограничен адресом владельца |
| VNet | `imbc-devVNET`, `10.0.0.0/16`; `imbc-devSubnet`, `10.0.0.0/24` |
| Kubernetes | AKS в текущей подписке отсутствует; `Microsoft.ContainerService` — NotRegistered |
| Дополнительные ресурсы IMBC | Azure Email Service, Communication Service и managed identity GitHub deploy |
| GitLab / ACR / backup Storage Account | В `imbc-dev-rg` отсутствуют |
| Regional quota | Total Regional vCPUs: 32/65; DASv5 family: 4/65. Общий счётчик включает другие проекты подписки |

Фактические markers: `.deployed-source-commit` = `335ef02ba5ce1436a3e184c8f20729a08a9f3707`, полный `.synced-revision` = `335ef02ba5ce1436a3e184c8f20729a08a9f3707 local`. Git HEAD старого checkout отдельно проверен как `71a2df5609f5db4620f43d19c77dc2319e0abe0d`; он не обозначает служащий релиз. Публичный Compose остаётся на релизе 335ef02; приложение не переключалось при установке K3s.

После bare K3s отдельно установлен [fresh isolated stage 3b stack](../deployment/verification-2026-11-16-stage3b-k3s.md) из `8d48bbd197a95abd9501584a3c64be177bc3e6b9`, с миграциями 0000–0019: девять active pods Ready, два Jobs Complete, private health/storage/role/SMTP gates прошли. Старые 11 контейнеров, source/markers и HTTPS200 сохранены; old-data transfer и edge cutover не выполнялись. GitLab/addons/GitOps/restore и полный browser/corpus acceptance ещё не закрыты. Последнее idle observation: 10,030 MiB available RAM / 93,937 MiB free disk.

### Узкая runtime-инвентаризация

Во время первоначального read-only audit SSH по runbook завершился timeout; NSG не расширялся. Тот аудит ограничивал RunCommand командами `uname`, `uptime`, `free`, `df`, `ss` и форматированными `docker ps/stats`, без env/config/logs. Последующие отдельно разрешённые bare-installation и fresh-stack действия описаны в соответствующих proof; приведённые ниже цифры относятся к первичной инвентаризации до установки.

- RAM: 15,933 MiB total, 3,173 MiB used, 12,760 MiB available; swap отсутствует. Load average 0.10 / 0.15 / 0.17.
- `/dev/root`: 123 GiB, 22 GiB used, 101 GiB free, 18% used.
- Действуют 11 Compose-контейнеров. ClamAV ~959 MiB, Keycloak ~731 MiB; API ~81, worker ~72, RustFS ~86, PostgreSQL ~85 MiB. Остальные меньше 14 MiB.
- Caddy занимает 80/443; nginx — loopback 8080, Mailpit — loopback 8025, RustFS console — loopback 9001. Listener k3s 6443/10250 не обнаружен.

Начальная coexist-конфигурация: k3s без Traefik/ServiceLB, отдельные CIDR, прямые NodePort Web/API/Keycloak 30080/30081/30082 за сохраняемым Caddy; GitLab CE capped 4 GiB / 1.5 CPU; kubelet reserves ~8 GiB для ОС/старого Compose/GitLab плюс ~1 GiB Kubernetes. Проверенная после установки allocatable memory — 6,354,752 KiB (~6.06 GiB), allocatable CPU — 3; полноразмерные параллельные CI и одновременное включение всех add-ons не допускаются по умолчанию. Monitoring и CI вводятся поэтапно, после проверки фактического потребления. Это оценка по idle inventory, не нагрузочный тест.

## CI: причина отказа и путь к GitLab

[CI run 43509681020](https://github.com/Batrbekk/imbc-platform/actions/runs/43509681020), SHA `d9b71be928efaf050e32031f8ba0dbf22564142c`, завершён failure 13 ноября. Оба job имеют **0 steps**. Check-run annotation: **“The job was not started because your account is locked due to a billing issue.”** Это отказ запуска, не результат проверки кода. Успешного remote CI текущего 3а не подтверждено.

Существующий `.github/workflows/ci.yml` содержит полезную переносимую проверку: frozen install, требования, typecheck/lint/test/build, PostgreSQL 18 integration suites и явный отказ при skipped/todo/failed либо нуле выполненных integration tests. Её нужно сохранить в GitLab CI. Простое повторение GitHub workflow не закрывает billing block. Локальные результаты продолжают фиксироваться отдельно от CI.

GitLab SaaS потребует аккаунта владельца. Альтернатива в разрешённом текущем окружении — GitLab CE на существующей VM, с ограниченной памятью, отключёнными ненужными встроенными сервисами и последовательным CI. Сначала измеряется нагрузка действующего стенда; совместное размещение всех старых Compose-сервисов, нового Kubernetes и GitLab не предполагается автоматически допустимым на 16 GiB. Регистрация, исходящая почта GitLab и публичное открытие новых интерфейсов до настройки не включаются.

## Что уже пригодно для переноса

- API и worker — один backend image с отдельными process roles; API работает под `node`, web — unprivileged nginx. Есть graceful shutdown и OpenAPI 3.1 generation.
- Readiness API проверяет PostgreSQL и private S3; отказ кеша не снимает готовность. Есть worker health endpoint и ограниченная конкурентность uploads.
- Настроены Keycloak/OIDC, private bucket, проверка файлов, редактирование логов и отказ fixed OTP вне development tier.
- Есть expand/migrate/contract и локальная проверка R1 на новой схеме; это основа rolling migrations, а не доказательство отсутствия простоя на Azure.
- Перед этапом 2 на Azure сделан PostgreSQL dump и полное пробное восстановление в отдельную БД; совпали 8 accounts / 12 profiles / 18 organizations / 158 audit rows. Это подтверждённая разовая копия БД, не регулярный полный disaster recovery.

## Переносимая поставка на существующей VM

Цель текущего окружения — **development Kubernetes**, без обещания резервирования и production SLA. Подготовить base-манифесты приложения и separate dev/production values, GitLab CI, Argo CD application, OpenBao/External Secrets, мониторинг и процедуры backup/restore.

Порядок перехода:

1. Локально отрендерить и проверить декларативную поставку, secret references, migration ordering, probes, resource requests/limits и приватность файлов. Независимое Astra-ревью до runtime изменений.
2. Через SSH читать только текущую загрузку, доступный диск, имена/версии сервисов и порты. Не читать `docker inspect` целиком, `.env`, process environments или конфигурации с секретами.
3. Подготовить проверенный комплект PostgreSQL, S3, конфигурации IdP и восстановления; сохранить фактические image/source IDs. На этой VM нет отдельного backup-диска: копия на её OS disk не является копией вне площадки.
4. Установить k3s с отдельно выбранными портами и CIDR; действующий Caddy/Compose не занимать новыми listener до проверки. Не менять NSG, SKU или Azure-ресурсы.
5. Поднять новый стек с ограниченными dev resources и отдельными данными, выполнить smoke и восстановление копии; никаких live Adata-запросов и внешних писем из автоматических проверок.
6. После проверки и координации остановить старые workload, выполнить финальный согласованный перенос и переключить прокси. Хранить проверенный rollback. Один сервер может требовать окно недоступности; это явно dev migration.
7. GitLab CE и CI запускать в рамках измеренного memory budget; последовательные jobs, ограниченный runner. При недостатке ресурсов очередность сервисов важнее одновременного запуска. Production manifests готовить отдельно от этих лимитов.

## Production acceptance остаётся отдельным результатом

| Требование | Что требуется до production |
|---|---|
| NFR-03–05 | Резервирование, synthetic checks критических операций, эксплуатант и показ полного восстановления в acceptance environment |
| §11.1 / §13 / NFR-10 | Kubernetes, GitLab CI/CD, Argo CD, Vault/OpenBao, Prometheus/Grafana/Loki/Alloy/OTel и передаваемые runbooks |
| NFR-06 | Rolling release, migration job, expand/migrate/contract, compatibility и rollback на будущей topology |
| NFR-07 / ACC-04 | k6 на acceptance environment: 2,000 manufacturers / 200 concurrent; p95 sign-in 2 s, search 1 s, company 1.5 s, 25 MB upload 30 s |
| NFR-11–14 | ASVS 5.0 Level 2 checklist, allowed/refused role tests, browser coverage Chrome/Edge/Firefox/Safari; проверенный настоящий Office/PDF corpus |
| ACC-01/02/06 | Каждое из 288 requirements проверено; UAT шести ролей; LPS CRUD/read/refused roles/counts отдельно |
| ACC-03/07 | 100% source-row accounting, manufacturer sample ≥200 с <5% field differences; все 57 LPS rows и approved reconciliation |
| §13 / LANG-03 | Approved data dictionary до миграции, полный OpenAPI включая pull API, guides шести ролей, IMBC ru/kk proofreading, UAT records |

Оригинальная архитектура §15 рекомендует три application-узла по 8 vCPU / 32 GiB и отдельный домен отказа stateful-служб. Схема 5 включает PostgreSQL primary+replica/PITR, S3 на трёх узлах или СХД IT, Keycloak с двумя репликами/своей БД, OpenBao и monitoring вне application-домена. Одноузловой k3s не подтверждает эту topology.

Архитектурные **рекомендации**, а не утверждённые contractual RPO/RTO: WAL continuously + daily base backup, RPO 15 min; S3 versioning и копия вне здания/ЦОД, Keycloak/Vault комплект; RTO 4 h, 35 days backup retention, quarterly restore drill. AUD-01–04 требуют сохранение истории пять лет; retention рабочих данных не заменяется 35-дневным retention резервных копий. S3 production-продукт выбирается с IMBC IT: versioning/object lock/поддержка, MinIO Community исключён; RustFS dev не означает автоматически approved production storage.

## Источники данных уже доступны

Read-only GitHub tree `AZhunis/imbc-prototype@8c0f2a6065d409bbc73f9f2fdd7f86214bdb50e6` подтверждает:

- `docs/initial-data/IMBC_Manufacturers_Database.xlsx`;
- `docs/initial-data/LC LPS table for Platform.xlsx`;
- `docs/initial-data/demand_forecast_detailed_under_NDA.xlsx`;
- `docs/initial-data/Consolidated_Actualized_data(Random 100_rows).xlsx` — название указывает на sample; не подменять им полный forecast;
- `docs/initial-data/goods_specification/kpo/` — PDF en/kk/ru, `.../tco/` — PDF technical requirements;
- `docs/architecture/IMBC-Architecture-v0.4.pdf`, `docs/initial-data/IMBC Platform_Phase1_Scope_of_Work.pdf`, `docs/adata/absent-checks.pdf`.

Эти файлы отсутствуют в active checkout snapshots, но их доступность снимает необходимость ждать владельца для начала анализа и trial migration. Actual sheet/row counts, completeness/horizon и бизнес-сопоставления нужно прочитать, а не выводить из filename. Remote tree не содержит ~320 survey PDFs. Остаются SharePoint read access, daily e-Ondiris ingestion access, approved aliases/reconciliation/product-to-STR mapping, legal/NDA текст, prod IMBC mailbox, Adata enabled modules/rates/related billing и языковая вычитка. Токен и server dev quota существуют по исторической проверке; это не подтверждает все модули и условия provider contract.

## Оценка цены будущей площадки — сейчас не создавать

Azure Retail Prices API, USD pay-as-you-go, Linux, Poland Central, расчёт 730 h/month; это публичная оценка, не фактический invoice и не reservation/credit/tax quote. Запросы `priceType eq 'Consumption'`, `armRegionName eq 'polandcentral'` и соответствующий `armSkuName`/service/meter. URL: `https://prices.azure.com/api/retail/prices`.

| Позиция | Проверенный retail meter | Месяц |
|---|---|---:|
| D4as_v5 | Virtual Machines Dasv5 Series, $0.208/h | $151.84 |
| D2as_v5 | Virtual Machines Dasv5 Series, $0.104/h | $75.92 |
| D8as_v5 | Предварительная оценка 2×D4; отдельный Retail request получил 429 | ~$303.68 |
| AKS Standard | Standard Uptime SLA, $0.10/h; не LTS/Automatic | $73.00 |
| E10 LRS 128 GB | Standard SSD Managed Disks, disk meter | $9.60 |
| P10 LRS 128 GB | Premium SSD Managed Disks, disk meter | $21.68 |
| E20 LRS 512 GB | Standard SSD Managed Disks, disk meter | $38.40 |
| Standard static IPv4 | $0.005/h | $3.65 |
| ACR Basic | Basic Registry Unit, $0.1666/day | ~$5.07 |

Disk mount/operation meters, storage operations, egress, external email, taxes и support в этих строках не включены. Current VM+E10+public IP — около **$165.09/month**, без mail/traffic/operation расходов. Сейчас эта оценка не означает новый spend.

Планирование будущей Azure acceptance-площадки:

| Позиция | Пример capacity | Месяц |
|---|---|---:|
| Application nodes | 3×D8as_v5 | ~$911.04 |
| AKS control plane | Standard | $73.00 |
| Application OS disks | 3×E10 | $28.80 |
| PostgreSQL volumes | 3×P10 | $65.04 |
| S3 initial raw capacity | 3×E20; usable capacity зависит от выбранного продукта | $115.20 |
| Monitoring volumes | 2×E10 | $19.20 |
| GitLab CE | D4as_v5 + E10 | $161.44 |
| Отдельный runner | D2as_v5 + E10, полный месяц как upper bound | $85.52 |
| Two public IP + ACR | Retail estimate | ~$12.37 |
| Standard load balancer | Planning allowance; meter отдельно не подтверждён | ~$18.25 |
| Backup/object capacity | Planning allowance; объём ещё не измерен | ~$30.00 |
| **Общий application+shared-stateful baseline** | Stateful в том же AKS — требует отдельного решения по архитектуре | **~$1,519.86** |
| Dedicated data pool | 3×D4as_v5 + 3×E10; PV выше уже учтены | +$484.32 |
| **С отдельным data pool** | Предлагаемый отдельный домен отказа, не validated performance | **~$2,004.18** |

Ориентир shared-stateful **$1,500–1,700/month**, отдельный data pool **$2,000–2,200/month**, включая запас на небольшие операции/логи; billed egress и текущая dev VM отдельно. Без actual traffic нельзя утверждать верхнюю границу расходов на передачу. Рекомендуется отдельно ограничить initial storage и autoscaling и показывать Azure estimate до provision.

Три D4 вместо D8 снижают baseline примерно на $455.52/month, но не соответствуют capacity-рекомендации §15 и не доказывают NFR-07. k3s на тех же трёх VM снимает AKS fee ~$73/month и переносит обслуживание control plane/etcd/upgrades на эксплуатанта. AKS здесь — рекомендация для будущих серверов, не разрешённое текущее действие.

На текущей региональной квоте old usage 32 + application 24 + data 12 + GitLab 4 + runner 2 = 74 > 65 vCPU. До такой provision нужно увеличение quota либо новая согласованная площадка. Владельцем сейчас выбран существующий dev VM: **никакие перечисленные новые SKU/RG/AKS/ACR/Storage ресурсы не создавались и не планируются к apply без нового решения.**
