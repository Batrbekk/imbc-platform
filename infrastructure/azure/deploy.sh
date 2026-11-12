#!/usr/bin/env bash
# Dev-стенд IMBC в Azure — запускать на машине с `az login`.
#   ./infrastructure/azure/deploy.sh up        создать VM или обновить существующий HTTPS-стенд
#   ./infrastructure/azure/deploy.sh redeploy  загрузить текущий код, пересобрать и проверить стенд
#                                              (шаги на VM — vm-deploy.sh, общий с конвейером GitHub Actions)
#   ./infrastructure/azure/deploy.sh preview <sha>  показать, что конвейер для коммита <sha> удалит
#                                              и изменит в каталоге приложения; ничего не меняет
#   ./infrastructure/azure/deploy.sh info      показать адреса (без паролей)
#   ./infrastructure/azure/deploy.sh ssh       зайти на сервер
#   ./infrastructure/azure/deploy.sh down      удалить resource group после подтверждения
#
# Параметры: RG, VM, LOCATION, SIZE, ADMIN_USER, SSH_KEY, DNS_LABEL.
# ALLOW_FROM=<ваш IP>/32 — только SSH; по умолчанию текущий IP.
# HTTPS/443 открыт всем. ADMIN_ALLOWED_IPS — IP/CIDR для Mailpit и Keycloak admin;
# сначала берётся ALLOW_FROM, далее сохранённый список меняется только явно.
# PUBLIC_HOST — необязательный DNS-адрес, уже указывающий на VM, до первого запуска.
# HTTP/80 открыт для ACME и перенаправления на HTTPS; сервисы данных доступны только внутри Docker.
set -euo pipefail

RG="${RG:-imbc-dev-rg}"
VM="${VM:-imbc-dev}"
LOCATION="${LOCATION:-polandcentral}"
SIZE="${SIZE:-Standard_D4as_v5}"
ADMIN_USER="${ADMIN_USER:-imbc}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/imbc-dev-azure}"
DNS_LABEL="${DNS_LABEL:-imbc-dev-e1cde8dd}"
APP_DIR="/home/${ADMIN_USER}/imbc-platform"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SSH_OPTS=(-i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)
VM_IP=""
VM_HOST=""
CLOUD_INIT_FILE=""
SSH_ALLOW_FROM=""
ADMIN_ALLOW_OVERRIDE="${ADMIN_ALLOWED_IPS:-}"
NSG_NAME=""
STAGE=""
REMOTE_SCRIPT=""

log() { printf '\n▶ %s\n' "$*"; }
die() { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }
cleanup() {
  [[ -z "$CLOUD_INIT_FILE" ]] || rm -f "$CLOUD_INIT_FILE"
  # Временные файлы на VM после прерванной загрузки; пути созданы mktemp и проверены.
  local path
  for path in "$STAGE" "$REMOTE_SCRIPT"; do
    [[ -n "$path" && -n "$VM_IP" ]] || continue
    remote "rm -rf '$path'" 2>/dev/null || true
  done
}
trap cleanup EXIT

normalize_networks() {
  python3 - "$1" <<'PYNET'
import ipaddress
import sys
try:
    networks = list(dict.fromkeys(str(ipaddress.ip_network(value, strict=False)) for value in sys.argv[1].split()))
    if not networks or any(ipaddress.ip_network(value).prefixlen == 0 for value in networks):
        raise ValueError()
except ValueError:
    raise SystemExit('ALLOW_FROM/ADMIN_ALLOWED_IPS должны содержать конкретные IP/CIDR, не Internet или /0')
print(' '.join(networks))
PYNET
}

resolve_ssh_allowlist() {
  [[ -n "$SSH_ALLOW_FROM" ]] && return
  local supplied="${ALLOW_FROM:-}"
  if [[ -z "$supplied" ]]; then
    supplied="$(curl -fsS --max-time 20 https://api.ipify.org)" || die 'Не удалось определить IP — задайте ALLOW_FROM'
  fi
  SSH_ALLOW_FROM="$(normalize_networks "$supplied")" || die 'Некорректный ALLOW_FROM'
}

validate_settings() {
  command -v python3 >/dev/null || die 'Python 3 не найден'
  if [[ -n "$ADMIN_ALLOW_OVERRIDE" ]]; then
    ADMIN_ALLOW_OVERRIDE="$(normalize_networks "$ADMIN_ALLOW_OVERRIDE")" || die 'Некорректный ADMIN_ALLOWED_IPS'
  fi
  [[ "$ADMIN_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || die 'Недопустимый ADMIN_USER'
  [[ "$VM" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]] || die 'Недопустимое имя VM'
  [[ "$DNS_LABEL" =~ ^[a-z0-9][a-z0-9-]*[a-z0-9]$ ]] || die 'Недопустимый DNS_LABEL'
  if [[ -n "${PUBLIC_HOST:-}" ]]; then
    [[ "$PUBLIC_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || die 'PUBLIC_HOST должен быть DNS-именем без схемы и пути'
  fi
}

ensure_login() {
  command -v az >/dev/null || die 'Azure CLI не найден'
  az account show >/dev/null 2>&1 || die 'Сначала выполните az login'
  log "Подписка: $(az account show --query name -o tsv)"
}

load_vm() {
  VM_IP="$(az vm show -d -g "$RG" -n "$VM" --query publicIps -o tsv)"
  [[ -n "$VM_IP" && "$VM_IP" != *,* ]] || die "У VM $VM должен быть один публичный IP"
  VM_HOST="${PUBLIC_HOST:-$(az vm show -d -g "$RG" -n "$VM" --query fqdns -o tsv)}"
  [[ -z "$VM_HOST" || "$VM_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || die 'У VM должно быть одно корректное DNS-имя'
}

remote() {
  [[ -n "$VM_IP" ]] || die 'Адрес VM ещё не получен'
  # Команда собирается локально из проверенных значений и намеренно раскрывается до ssh.
  # shellcheck disable=SC2029
  ssh "${SSH_OPTS[@]}" "${ADMIN_USER}@${VM_IP}" "$@"
}

create_vm() {
  local exists nsg_id
  local -a ssh_ranges
  resolve_ssh_allowlist
  read -r -a ssh_ranges <<< "$SSH_ALLOW_FROM"

  if [[ ! -f "$SSH_KEY" ]]; then
    [[ ! -e "${SSH_KEY}.pub" ]] || die 'Публичный SSH-ключ есть, но закрытый ключ отсутствует'
    mkdir -p "$(dirname "$SSH_KEY")"
    ssh-keygen -q -t ed25519 -f "$SSH_KEY" -C imbc-dev-azure -N ''
  fi
  [[ -f "${SSH_KEY}.pub" ]] || die "Не найден публичный ключ ${SSH_KEY}.pub"

  log "Resource group $RG ($LOCATION)"
  az group create -n "$RG" -l "$LOCATION" --tags project=imbc env=dev -o none
  exists="$(az vm list -g "$RG" --query "[?name=='$VM'].name | [0]" -o tsv)"
  if [[ -z "$exists" ]]; then
    log "Создание $VM: $SIZE, Ubuntu 24.04, Standard SSD 128 ГБ"
    CLOUD_INIT_FILE="$(mktemp "${TMPDIR:-/tmp}/imbc-cloud-init.XXXXXX")"
    sed "s/\${ADMIN_USER}/${ADMIN_USER}/g" "$HERE/cloud-init.yaml" > "$CLOUD_INIT_FILE"
    az vm create -g "$RG" -n "$VM" --location "$LOCATION" \
      --image Ubuntu2404 --size "$SIZE" \
      --admin-username "$ADMIN_USER" --authentication-type ssh --ssh-key-values "${SSH_KEY}.pub" \
      --security-type TrustedLaunch --enable-secure-boot true --enable-vtpm true \
      --public-ip-sku Standard --public-ip-address-allocation static \
      --public-ip-address-dns-name "$DNS_LABEL" \
      --os-disk-size-gb 128 --storage-sku StandardSSD_LRS --nsg-rule NONE \
      --custom-data "$CLOUD_INIT_FILE" --tags project=imbc env=dev -o none
  else
    log "Используется существующая VM $VM"
  fi
  load_vm
  [[ -n "$VM_HOST" ]] || die 'У публичного IP отсутствует DNS-имя; задайте DNS_LABEL при создании VM или PUBLIC_HOST'

  # NSG берём с NIC этой VM, а не предполагаем его имя.
  local nic_id
  nic_id="$(az vm show -g "$RG" -n "$VM" --query 'networkProfile.networkInterfaces[0].id' -o tsv)"
  nsg_id="$(az network nic show --ids "$nic_id" --query networkSecurityGroup.id -o tsv)"
  [[ -n "$nsg_id" ]] || die 'У NIC отсутствует NSG; сначала настройте ограничения сети'
  NSG_NAME="${nsg_id##*/}"
  log "SSH/22 доступен с $SSH_ALLOW_FROM; HTTP/80 — ACME и перенаправление"
  az network nsg rule create -g "$RG" --nsg-name "$NSG_NAME" -n imbc-ssh --priority 1000 \
    --access Allow --protocol Tcp --direction Inbound --source-address-prefixes "${ssh_ranges[@]}" \
    --destination-port-ranges 22 -o none
  az network nsg rule create -g "$RG" --nsg-name "$NSG_NAME" -n imbc-acme-http --priority 1020 \
    --access Allow --protocol Tcp --direction Inbound --source-address-prefixes Internet \
    --destination-port-ranges 80 -o none
}

publish_https() {
  [[ -n "$NSG_NAME" ]] || die 'NSG не определён'
  log 'Caddy проверен: открытие HTTPS/443 для всех пользователей'
  az network nsg rule create -g "$RG" --nsg-name "$NSG_NAME" -n imbc-https --priority 1010 \
    --access Allow --protocol Tcp --direction Inbound --source-address-prefixes Internet \
    --destination-port-ranges 443 -o none
}

wait_for_docker() {
  log 'Ожидание SSH, cloud-init и Docker'
  local connected=false
  for _ in $(seq 1 60); do
    if remote true 2>/dev/null; then connected=true; break; fi
    sleep 5
  done
  [[ "$connected" == true ]] || die 'SSH не стал доступен; проверьте ALLOW_FROM и SSH_KEY'
  remote 'sudo cloud-init status --wait >/dev/null && sudo docker version --format "Docker {{.Server.Version}}" && sudo docker compose version' \
    || die 'cloud-init или установка Docker завершились ошибкой; проверьте /var/log/cloud-init-output.log на VM'
}

# Исходники загружаются во временный каталог на VM; каталог приложения меняет только
# vm-deploy.sh под блокировкой — тот же скрипт, что выполняет конвейер GitHub Actions.
upload_code() {
  log 'Загрузка исходного кода'
  STAGE="$(remote "mktemp -d '/home/$ADMIN_USER/.imbc-stage.XXXXXXXX'")"
  [[ "$STAGE" =~ ^/home/${ADMIN_USER}/\.imbc-stage\.[A-Za-z0-9]{8}$ ]] || die 'Не удалось создать каталог загрузки на VM'
  remote "mkdir -m 0755 '$STAGE/src'"
  # Серверные .env, Git и данные сохраняются; локальные секреты не отправляются.
  COPYFILE_DISABLE=1 tar --no-xattrs -C "$ROOT" \
    --exclude=node_modules --exclude=.next --exclude=dist --exclude=dist_keycloak --exclude=.turbo --exclude=coverage --exclude=__pycache__ \
    --exclude=.git --exclude='.env*' --exclude=.deployed-source-commit --exclude=.deployed-revision --exclude=.synced-revision \
    --exclude='*.pem' --exclude='*.key' --exclude='*.log' --exclude='*.tsbuildinfo' \
    -czf - . | remote "tar -xzf - -C '$STAGE/src'"
  # Шаблоны передаём отдельно: glob .env* исключает любой локальный файл секретов.
  git -C "$ROOT" ls-files -z -- .env.example '*/.env.example' |
    COPYFILE_DISABLE=1 tar --no-xattrs -C "$ROOT" --null -T - -czf - | remote "tar -xzf - -C '$STAGE/src'"
}

# Проверка .env, синхронизация, Compose, realm, готовность и закрытые маршруты — на VM,
# одной командой под flock. Полный журнал остаётся в /var/log/imbc-deploy/ на VM.
deploy_on_vm() {
  [[ -n "$VM_HOST" ]] || die 'Не удалось определить DNS-имя VM'
  [[ -n "$STAGE" ]] || die 'Исходники ещё не загружены'
  resolve_ssh_allowlist
  local commit
  commit="$(git -C "$ROOT" rev-parse HEAD)"
  REMOTE_SCRIPT="$(remote "mktemp '/home/$ADMIN_USER/.imbc-vm-deploy.XXXXXXXX'")"
  [[ "$REMOTE_SCRIPT" =~ ^/home/${ADMIN_USER}/\.imbc-vm-deploy\.[A-Za-z0-9]{8}$ ]] || die 'Не удалось передать скрипт развёртывания'
  remote "cat > '$REMOTE_SCRIPT'" < "$HERE/vm-deploy.sh"
  log 'Развёртывание на VM: .env, синхронизация, Compose, realm, HTTPS и маршруты'
  remote "sudo bash '$REMOTE_SCRIPT' local '$ADMIN_USER' '$STAGE' '$VM_HOST' '$commit' '$SSH_ALLOW_FROM' '$ADMIN_ALLOW_OVERRIDE'" \
    || die 'Развёртывание на VM не завершено; журнал — sudo ls -t /var/log/imbc-deploy/ на VM'
  STAGE=""
  remote "rm -f '$REMOTE_SCRIPT'"
  REMOTE_SCRIPT=""
}

# Предпросмотр синхронизации конвейера (архив коммита из GitHub, rsync -n с правилами
# vm-deploy.sh из того же коммита). Каталог приложения, Compose и журналы на VM не меняются.
preview_on_vm() {
  local sha="$1"
  local script="infrastructure/azure/vm-deploy.sh"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die 'Нужен полный SHA отправленного коммита, например вывод git rev-parse origin/main'
  git -C "$ROOT" cat-file -e "${sha}^{commit}" 2>/dev/null \
    || die "Коммита $sha нет в локальном репозитории: выполните git fetch"
  git -C "$ROOT" cat-file -e "${sha}:${script}" 2>/dev/null \
    || die "В коммите $sha нет $script: предпросмотр для него невозможен"
  local content
  content="$(git -C "$ROOT" show "${sha}:${script}")"
  grep -q '^    preview)' <<< "$content" || die "vm-deploy.sh коммита $sha не поддерживает режим preview"
  REMOTE_SCRIPT="$(remote "mktemp '/home/$ADMIN_USER/.imbc-vm-deploy.XXXXXXXX'")"
  [[ "$REMOTE_SCRIPT" =~ ^/home/${ADMIN_USER}/\.imbc-vm-deploy\.[A-Za-z0-9]{8}$ ]] || die 'Не удалось передать скрипт предпросмотра'
  # Правила синхронизации — из самого коммита, а не из рабочего дерева оператора.
  printf '%s\n' "$content" | remote "cat > '$REMOTE_SCRIPT'"
  log "Предпросмотр синхронизации конвейера для $sha"
  remote "sudo bash '$REMOTE_SCRIPT' preview '$sha' 'Batrbekk/imbc-platform'" || die 'Предпросмотр не выполнен'
  remote "rm -f '$REMOTE_SCRIPT'"
  REMOTE_SCRIPT=""
}

info() {
  local host
  host="$(remote "sed -n 's/^PUBLIC_HOST=//p' '$APP_DIR/.env'")"
  [[ "$host" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || die 'В .env отсутствует корректный PUBLIC_HOST'
  cat <<INFO

Платформа:       https://$host
OpenAPI:         https://$host/api/docs
Почта Mailpit:   https://$host/dev-mail/ (IP администратора и пароль)
Keycloak admin:  https://$host/kc/admin/ (IP администратора)
SSH:            ssh -i "$SSH_KEY" ${ADMIN_USER}@${VM_IP}
Консоль S3:     ssh -i "$SSH_KEY" -L 9001:127.0.0.1:9001 ${ADMIN_USER}@${VM_IP}
                затем http://127.0.0.1:9001
Секреты:        $APP_DIR/.env на сервере (0600; в вывод не включены)
Обновление:     ./infrastructure/azure/deploy.sh redeploy
INFO
}

validate_settings
case "${1:-up}" in
  up)
    ensure_login; create_vm; wait_for_docker; upload_code; deploy_on_vm; publish_https; info ;;
  redeploy)
    ensure_login; load_vm; upload_code; deploy_on_vm; info ;;
  preview) ensure_login; load_vm; preview_on_vm "${2:-}" ;;
  info) ensure_login; load_vm; info ;;
  ssh) ensure_login; load_vm; remote ;;
  down)
    ensure_login
    read -r -p "Удалить resource group $RG со всеми ресурсами? [y/N] " ok
    if [[ "$ok" == y ]]; then
      az group delete -n "$RG" --yes --no-wait
      echo 'Удаление запущено'
    fi ;;
  *) sed -n '2,14p' "$0"; exit 1 ;;
esac
