#!/usr/bin/env bash
# Dev-стенд IMBC в Azure одной командой — запускать из корня репозитория на машине с `az login`.
#
#   ./infrastructure/azure/deploy.sh up        создать VM и развернуть стенд (повторный запуск = обновление)
#   ./infrastructure/azure/deploy.sh redeploy  залить текущий код и пересобрать приложение
#   ./infrastructure/azure/deploy.sh info      адреса и пароли
#   ./infrastructure/azure/deploy.sh ssh       зайти на сервер
#   ./infrastructure/azure/deploy.sh down      удалить всё (resource group целиком)
#
# Параметры через переменные окружения:
#   LOCATION=westeurope  SIZE=Standard_D4as_v5  RG=imbc-dev-rg  VM=imbc-dev
#   ALLOW_FROM=<ваш IP>/32  — откуда открыты порты стенда (по умолчанию только ваш текущий IP; "*" — всем)
set -euo pipefail

RG="${RG:-imbc-dev-rg}"
VM="${VM:-imbc-dev}"
LOCATION="${LOCATION:-westeurope}"
SIZE="${SIZE:-Standard_D4as_v5}"          # 4 vCPU / 16 ГБ: ClamAV + Keycloak + сборка образов
ADMIN_USER="${ADMIN_USER:-imbc}"
APP_DIR="/home/${ADMIN_USER}/imbc-platform"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)

log() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

VM_IP=""
ip_of_vm() {
  [[ -n "$VM_IP" ]] || VM_IP="$(az vm show -d -g "$RG" -n "$VM" --query publicIps -o tsv 2>/dev/null || true)"
  printf '%s' "$VM_IP"
}
remote() { ssh "${SSH_OPTS[@]}" "${ADMIN_USER}@$(ip_of_vm)" "$@"; }

ensure_login() {
  command -v az >/dev/null || die "Azure CLI не найден"
  az account show >/dev/null 2>&1 || az login >/dev/null
  log "Подписка: $(az account show --query '[name, id]' -o tsv | tr '\t' ' ')"
}

create_vm() {
  local allow="${ALLOW_FROM:-}"
  if [[ -z "$allow" ]]; then
    allow="$(curl -fsS https://api.ipify.org)/32" || die "Не удалось определить ваш IP — задайте ALLOW_FROM"
  fi

  log "Resource group $RG ($LOCATION)"
  az group create -n "$RG" -l "$LOCATION" -o none

  if [[ -z "$(ip_of_vm)" ]]; then
    log "VM $VM ($SIZE, Ubuntu 24.04, диск 128 ГБ) — 2–4 минуты"
    sed "s/\${ADMIN_USER}/${ADMIN_USER}/g" "$HERE/cloud-init.yaml" > /tmp/imbc-cloud-init.yaml
    az vm create -g "$RG" -n "$VM" \
      --image Ubuntu2404 --size "$SIZE" \
      --admin-username "$ADMIN_USER" --generate-ssh-keys \
      --public-ip-sku Standard --os-disk-size-gb 128 \
      --nsg-rule NONE \
      --custom-data /tmp/imbc-cloud-init.yaml \
      --tags project=imbc env=dev -o none
  else
    log "VM $VM уже есть — используем её"
  fi

  log "Сетевые правила: 22, 8080 (платформа), 8025 (почта Mailpit), 9001 (консоль S3) — только с $allow"
  local nsg="${VM}NSG" prio=1000
  for port in 22 8080 8025 9001; do
    az network nsg rule create -g "$RG" --nsg-name "$nsg" -n "imbc-$port" --priority $prio \
      --access Allow --protocol Tcp --direction Inbound \
      --source-address-prefixes "$allow" --destination-port-ranges "$port" -o none
    prio=$((prio + 10))
  done
}

wait_for_docker() {
  log "Ожидание cloud-init и Docker"
  for _ in $(seq 1 60); do
    remote true 2>/dev/null && break
    sleep 5
  done
  remote 'cloud-init status --wait >/dev/null; sudo docker version --format "Docker {{.Server.Version}}"'
}

upload_code() {
  log "Загрузка кода на сервер"
  remote "mkdir -p '$APP_DIR'"
  # Без node_modules, сборок и локальных .env; на сервере свой .env.
  COPYFILE_DISABLE=1 tar -C "$ROOT" \
    --exclude=node_modules --exclude=.next --exclude=dist --exclude=.turbo \
    --exclude=.git --exclude=.env --exclude='*.tsbuildinfo' \
    -czf - . | remote "tar -xzf - -C '$APP_DIR'"
}

configure_env() {
  local ip; ip="$(ip_of_vm)"
  log "Конфигурация .env (PUBLIC_URL=http://$ip:8080)"
  remote "cd '$APP_DIR' && if [ ! -f .env ]; then
      cp .env.example .env
      make -s secrets
      sed -i \"s|^KEYCLOAK_DEV_USER_PASSWORD=.*|KEYCLOAK_DEV_USER_PASSWORD=Imbc-\$(openssl rand -hex 6)|\" .env
    fi
    sed -i 's|^PUBLIC_URL=.*|PUBLIC_URL=http://$ip:8080|; s|^KEYCLOAK_SSL_REQUIRED=.*|KEYCLOAK_SSL_REQUIRED=none|' .env"
}

compose_up() {
  log "Сборка образов и запуск стенда (первый раз 5–10 минут)"
  remote "cd '$APP_DIR' && sudo docker compose up -d --build --remove-orphans"
  log "Ожидание готовности API и Keycloak"
  for _ in $(seq 1 90); do
    if remote "cd '$APP_DIR' && sudo docker compose ps --format '{{.Service}} {{.Health}}' | grep -q '^api healthy'"; then
      return 0
    fi
    sleep 10
  done
  remote "cd '$APP_DIR' && sudo docker compose ps"
  die "API не стал healthy — смотрите: $0 ssh, затем: cd imbc-platform && sudo docker compose logs api keycloak"
}

# Стенд работает по http на публичном IP: консоли Keycloak (realm master) разрешаем вход без HTTPS.
keycloak_dev_http() {
  local env user pass
  env="$(remote "cat '$APP_DIR/.env'")"
  user="$(printf '%s\n' "$env" | sed -n 's/^KEYCLOAK_ADMIN_USER=//p')"
  pass="$(printf '%s\n' "$env" | sed -n 's/^KEYCLOAK_ADMIN_PASSWORD=//p')"
  if remote "cd '$APP_DIR' && sudo docker compose exec -T keycloak /opt/keycloak/bin/kcadm.sh config credentials \
        --server http://localhost:8080/kc --realm master --user '$user' --password '$pass' >/dev/null &&
      sudo docker compose exec -T keycloak /opt/keycloak/bin/kcadm.sh update realms/master -s sslRequired=NONE"; then
    echo "Keycloak: консоль администратора доступна по http"
  else
    echo "Keycloak: консоль только через ssh-туннель (ssh -L 8180:localhost:8080 …) — realm master требует HTTPS"
  fi
}

info() {
  local ip; ip="$(ip_of_vm)"
  [[ -n "$ip" ]] || die "VM $VM не найдена в $RG"
  local env; env="$(remote "cat '$APP_DIR/.env'")"
  get() { printf '%s\n' "$env" | sed -n "s/^$1=//p"; }
  cat <<INFO

  ┌─ IMBC dev-стенд ───────────────────────────────────────────────
  │ Платформа        http://$ip:8080
  │ OpenAPI          http://$ip:8080/api/docs
  │ Почта (Mailpit)  http://$ip:8025   ← коды входа и письма здесь
  │ Консоль S3       http://$ip:9001   ($(get S3_ACCESS_KEY) / $(get S3_SECRET_KEY))
  │ Keycloak admin   http://$ip:8080/kc/admin   ($(get KEYCLOAK_ADMIN_USER) / $(get KEYCLOAK_ADMIN_PASSWORD))
  │
  │ Демо-пользователи, пароль: $(get KEYCLOAK_DEV_USER_PASSWORD)
  │   operator@operator.local · expert@imbc.local · admin@imbc.local
  │   director@imbc.local · spectator@spectator.local · manufacturer@demo.local
  │
  │ SSH: ssh ${ADMIN_USER}@$ip      Удалить всё: $0 down
  └────────────────────────────────────────────────────────────────
INFO
}

case "${1:-up}" in
  up)
    ensure_login; create_vm; wait_for_docker; upload_code; configure_env; compose_up; keycloak_dev_http; info ;;
  redeploy)
    ensure_login; upload_code; configure_env
    remote "cd '$APP_DIR' && sudo docker compose up -d --build migrate api worker web"; info ;;
  info) ensure_login; info ;;
  ssh) ensure_login; remote ;;
  down)
    ensure_login
    read -r -p "Удалить resource group $RG со всеми ресурсами? [y/N] " ok
    [[ "$ok" == "y" ]] && az group delete -n "$RG" --yes --no-wait && echo "Удаление запущено" ;;
  *) sed -n '2,13p' "$0"; exit 1 ;;
esac
