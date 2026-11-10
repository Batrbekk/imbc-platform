#!/usr/bin/env bash
# Dev-стенд IMBC в Azure — запускать на машине с `az login`.
#   ./infrastructure/azure/deploy.sh up        создать VM или обновить существующий HTTPS-стенд
#   ./infrastructure/azure/deploy.sh redeploy  загрузить текущий код, пересобрать и проверить стенд
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
COMPOSE='sudo docker compose -f compose.yaml -f compose.azure.yaml'

log() { printf '\n▶ %s\n' "$*"; }
die() { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }
cleanup() { [[ -z "$CLOUD_INIT_FILE" ]] || rm -f "$CLOUD_INIT_FILE"; }
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

upload_code() {
  log 'Загрузка исходного кода'
  remote "mkdir -p '$APP_DIR'"
  # Серверные .env, Git и данные сохраняются; локальные секреты не отправляются.
  COPYFILE_DISABLE=1 tar --no-xattrs -C "$ROOT" \
    --exclude=node_modules --exclude=.next --exclude=dist --exclude=dist_keycloak --exclude=.turbo --exclude=coverage --exclude=__pycache__ \
    --exclude=.git --exclude='.env*' --exclude=.deployed-source-commit \
    --exclude='*.pem' --exclude='*.key' --exclude='*.log' --exclude='*.tsbuildinfo' \
    -czf - . | remote "tar -xzf - -C '$APP_DIR'"
  # Шаблоны передаём отдельно: glob .env* исключает любой локальный файл секретов.
  git -C "$ROOT" ls-files -z -- .env.example '*/.env.example' |
    COPYFILE_DISABLE=1 tar --no-xattrs -C "$ROOT" --null -T - -czf - | remote "tar -xzf - -C '$APP_DIR'"
  git -C "$ROOT" rev-parse HEAD | remote "cat > '$APP_DIR/.deployed-source-commit'"
}

configure_env() {
  [[ -n "$VM_HOST" ]] || die 'Не удалось определить DNS-имя VM'
  resolve_ssh_allowlist
  log 'Проверка HTTPS-конфигурации и серверных секретов'
  # Генерация и проверка происходят на сервере; значения секретов не выводятся.
  remote "python3 - '$APP_DIR' '$VM_HOST' '$SSH_ALLOW_FROM' '$ADMIN_ALLOW_OVERRIDE'" <<'PY'
import ipaddress
import os
import re
import secrets
import sys
import tempfile
from pathlib import Path

root, host = Path(sys.argv[1]), sys.argv[2]
ssh_allow, admin_override = sys.argv[3:5]

def admin_networks(value):
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
        value = value[1:-1]
    try:
        networks = list(dict.fromkeys(str(ipaddress.ip_network(item, strict=False)) for item in value.split()))
        if not networks or any(ipaddress.ip_network(item).prefixlen == 0 for item in networks):
            raise ValueError()
    except ValueError:
        raise SystemExit('ADMIN_ALLOWED_IPS должен содержать конкретные IP/CIDR; .env не изменён')
    return ' '.join(networks)

if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]*', host):
    raise SystemExit('Некорректное DNS-имя')
env_path = root / '.env'
if env_path.exists():
    raw = env_path.read_text()
    values = dict(line.split('=', 1) for line in raw.splitlines() if line and not line.startswith('#') and '=' in line)
    required = {
        'PUBLIC_URL': 'https://' + host,
        'PUBLIC_HOST': host,
        'COOKIE_SECURE': 'true',
        'SESSION_COOKIE_NAME': '__Host-imbc-session',
        'DEVICE_COOKIE_NAME': '__Host-imbc-device',
        'KEYCLOAK_SSL_REQUIRED': 'external',
    }
    invalid = [key for key, expected in required.items() if values.get(key) != expected]
    if invalid:
        raise SystemExit('Существующая .env требует ручной миграции HTTPS/hostname: ' + ', '.join(invalid) + '. Keycloak импортирует realm только один раз; файл не изменён.')
    if not values.get('MAILPIT_UI_AUTH'):
        raise SystemExit('MAILPIT_UI_AUTH должен защищать почту с кодами входа; .env не изменён.')
    existing_admin = values.get('ADMIN_ALLOWED_IPS', '')
    admin = admin_networks(admin_override or existing_admin or ssh_allow + ' 127.0.0.1/32 ::1/128')
    if admin_override or not existing_admin:
        if re.search(r'^ADMIN_ALLOWED_IPS=.*$', raw, flags=re.M):
            raw = re.sub(r'^ADMIN_ALLOWED_IPS=.*$', 'ADMIN_ALLOWED_IPS=' + admin, raw, flags=re.M)
        else:
            raw = raw.rstrip('\n') + '\nADMIN_ALLOWED_IPS=' + admin + '\n'
        fd, temporary = tempfile.mkstemp(prefix='.env.', dir=root)
        try:
            with os.fdopen(fd, 'w') as output:
                output.write(raw)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, env_path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    os.chmod(env_path, 0o600)
    print('HTTPS-конфигурация и секреты сохранены; IP-доступ администратора проверен')
else:
    raw = (root / '.env.example').read_text()
    values = {
        'PUBLIC_URL': 'https://' + host,
        'PUBLIC_HOST': host,
        'COOKIE_SECURE': 'true',
        'SESSION_COOKIE_NAME': '__Host-imbc-session',
        'DEVICE_COOKIE_NAME': '__Host-imbc-device',
        'KEYCLOAK_SSL_REQUIRED': 'external',
        'KEYCLOAK_DEV_USER_PASSWORD': 'Imbc-' + secrets.token_hex(16),
        'S3_ACCESS_KEY': 'imbc-dev',
        'MAILPIT_UI_AUTH': 'imbc:' + secrets.token_hex(24),
        'ADMIN_ALLOWED_IPS': admin_networks(admin_override or ssh_allow + ' 127.0.0.1/32 ::1/128'),
    }
    for key in ['SESSION_SECRET', 'DB_OWNER_PASSWORD', 'DB_APP_PASSWORD', 'KEYCLOAK_DB_PASSWORD', 'S3_SECRET_KEY', 'KEYCLOAK_ADMIN_PASSWORD', 'OIDC_CLIENT_SECRET', 'KEYCLOAK_ADMIN_CLIENT_SECRET']:
        values[key] = secrets.token_hex(32)
    for key, value in values.items():
        pattern = rf'^{re.escape(key)}=.*$'
        if re.search(pattern, raw, flags=re.M):
            raw = re.sub(pattern, key + '=' + value, raw, flags=re.M)
        else:
            raw += '\n' + key + '=' + value + '\n'
    if 'change-me' in '\n'.join(line for line in raw.splitlines() if line and not line.startswith('#')):
        raise SystemExit('В шаблоне остались значения change-me; файл не создан')
    fd = os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as output:
        output.write(raw)
    print('Создана серверная .env с правами 0600')
PY
}

compose_up() {
  log 'Проверка Compose, сборка и запуск'
  remote "cd '$APP_DIR' && $COMPOSE config --quiet && $COMPOSE up -d --build --remove-orphans --wait --wait-timeout 600"
  log 'Применение конфигурации HTTPS без прерывания соединений'
  remote "cd '$APP_DIR' && $COMPOSE exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile"
  log 'Синхронизация настроек входа и почты без повторного импорта пользователей'
  remote "cd '$APP_DIR' && python3 infrastructure/azure/sync-realm.py --theme imbc"
  log 'Проверка HTTPS и готовности API'
  local ready=false
  for _ in $(seq 1 30); do
    if remote "curl --fail --silent --show-error --connect-timeout 5 --max-time 10 --resolve '$VM_HOST:443:127.0.0.1' 'https://$VM_HOST/api/health/ready'" >/dev/null 2>&1; then
      ready=true; break
    fi
    sleep 5
  done
  [[ "$ready" == true ]] || die 'HTTPS/API не готовы; проверьте Caddy, DNS и сертификат'
  log 'Проверка закрытых служебных маршрутов с недоверенного адреса Docker'
  remote "cd '$APP_DIR' && $COMPOSE exec -T api node -" <<'JS'
const https = require('node:https');
const host = new URL(process.env.PUBLIC_URL).hostname;
function status(path) {
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: 'caddy', port: 443, servername: host, path,
      headers: { Host: host, 'X-Forwarded-For': '127.0.0.1' },
      timeout: 8000,
    }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.end();
  });
}
(async () => {
  for (const path of ['/dev-mail', '/dev-mail/', '/DEV-MAIL/api/v1/messages', '/dev-mail%2Fapi/v1/messages', '/kc/admin', '/KC/ADMIN/', '/kc/admin/realms', '/kc/%61dmin/', '/kc/admin;test/', '/kc/./admin/', '/kc//admin/', '/kc/realms/master/.well-known/openid-configuration']) {
    if (![403, 404].includes(await status(path))) throw new Error('private route exposed');
  }
  for (const path of ['/api/health/ready', '/register', '/kc/realms/imbc/.well-known/openid-configuration']) {
    if (await status(path) !== 200) throw new Error('public route unavailable');
  }
  console.log('Private routes denied; public product routes available; forwarded headers grant no access');
})().catch(() => { console.error('Caddy access policy verification failed; public HTTPS was not enabled'); process.exitCode = 1; });
JS
  remote "cd '$APP_DIR' && $COMPOSE ps"
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
    ensure_login; create_vm; wait_for_docker; upload_code; configure_env; compose_up; publish_https; info ;;
  redeploy)
    ensure_login; load_vm; configure_env; upload_code; compose_up; info ;;
  info) ensure_login; load_vm; info ;;
  ssh) ensure_login; load_vm; remote ;;
  down)
    ensure_login
    read -r -p "Удалить resource group $RG со всеми ресурсами? [y/N] " ok
    if [[ "$ok" == y ]]; then
      az group delete -n "$RG" --yes --no-wait
      echo 'Удаление запущено'
    fi ;;
  *) sed -n '2,12p' "$0"; exit 1 ;;
esac
