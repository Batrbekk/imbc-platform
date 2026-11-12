#!/usr/bin/env bash
# Шаги развёртывания IMBC на dev-VM — общая реализация для конвейера и deploy.sh.
# Выполняется от root: через `az vm run-command invoke` (GitHub Actions) или `sudo` (deploy.sh).
#
#   vm-deploy.sh pipeline <sha> <репозиторий> <хост>
#       скачать архив коммита <sha> публичного репозитория (анонимно) и синхронизировать
#       каталог приложения с удалением
#   vm-deploy.sh local <пользователь> <каталог загрузки> <хост> <sha> <SSH allowlist> <ADMIN_ALLOWED_IPS>
#       применить исходники, загруженные deploy.sh в <каталог загрузки>/src (без удаления)
#   vm-deploy.sh preview <sha> <репозиторий>
#       только показать, что синхронизация конвейера для <sha> удалит и изменит; без Compose,
#       журнала и изменений каталога приложения (deploy.sh preview <sha>)
#
# Далее одинаково: блокировка flock, проверка серверной .env, синхронизация, Compose build/up
# с compose.yaml + compose.azure.yaml, reload Caddy, sync-realm.py, готовность HTTPS/API,
# проверка закрытых маршрутов. Полный журнал — /var/log/imbc-deploy/ (только root, последние 20).
# Последняя строка вывода: IMBC_DEPLOY_RESULT=ok revision=<sha> | IMBC_DEPLOY_RESULT=failed step=<шаг>
# (в режиме preview — IMBC_PREVIEW_RESULT=…). .synced-revision — какой коммит синхронизирован;
# .deployed-revision (конвейер) или .deployed-source-commit (deploy.sh) пишутся только после успеха.
# Аргументы недоверенные: они проверяются до использования и никогда не выводятся.

# run-command может запустить скрипт через sh: переходим в bash до bash-синтаксиса.
if [ -z "${BASH_VERSION:-}" ]; then exec /bin/bash "$0" "$@"; fi

set -euo pipefail
umask 022
exec </dev/null

EXPECTED_REPOSITORY='Batrbekk/imbc-platform'
PIPELINE_APP_USER='imbc'
KEEP_LOGS=20
SAFE_PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
COMPOSE_FILES=(-f compose.yaml -f compose.azure.yaml)
# Единственное определение параметров и правил синхронизации: им пользуются sync и preview.
SYNC_OPTIONS=(-rlp --checksum)
# Те же правила, что у upload_code в deploy.sh: серверные .env*, секреты, данные и маркеры
# не передаются и при синхронизации с удалением не удаляются; .env.example передаются.
SYNC_FILTERS=(
  --include=.env.example
  --exclude=node_modules --exclude=.next --exclude=dist --exclude=dist_keycloak --exclude=.turbo
  --exclude=coverage --exclude=__pycache__ --exclude=.git --exclude='.env*'
  --exclude=.deployed-source-commit --exclude=.deployed-revision --exclude=.synced-revision
  --exclude='*.pem' --exclude='*.key' --exclude='*.log' --exclude='*.tsbuildinfo'
)

MODE=''
REVISION=''
REPOSITORY=''
HOST=''
APP_USER=''
STAGE=''
SSH_ALLOW=''
ADMIN_OVERRIDE=''
CLEAN_STAGE=false
CURRENT_STEP='arguments'
RESULT_PREFIX='IMBC_DEPLOY_RESULT'
FINISHED=false
LOG_FILE=''
SUMMARY_FD=''
TEST_ROOT="${IMBC_DEPLOY_ROOT:-}"

# Краткая сводка: в журнал и в возвращаемый вывод. Аргументы сюда не попадают.
say() {
  if [[ -n "$SUMMARY_FD" ]]; then printf '%s\n' "$*" >&3; fi
  printf '%s\n' "$*"
}
die() { say "Ошибка: $*"; exit 1; }

# Короткие команды с безопасными сообщениями: их вывод нужен и в сводке (последние 20 строк).
reported() {
  local output status=0
  output="$("$@" 2>&1)" || status=$?
  if [[ -n "$output" ]]; then
    printf '%s\n' "$output"
    [[ -z "$SUMMARY_FD" ]] || tail -n 20 <<< "$output" | sed 's/^/  /' >&3
  fi
  return "$status"
}

on_exit() {
  local rc=$? result
  set +e
  cleanup_stage
  if [[ $rc -eq 0 && "$FINISHED" == true ]]; then
    say "Завершено; журнал на VM: ${LOG_FILE:-не ведётся}"
    result="$RESULT_PREFIX=ok revision=$REVISION"
  else
    [[ $rc -ne 0 ]] || rc=1
    say "Остановлено на шаге $CURRENT_STEP; журнал на VM: ${LOG_FILE:-не ведётся}"
    result="$RESULT_PREFIX=failed step=$CURRENT_STEP"
  fi
  prune_logs
  say "$result"
  exit "$rc"
}
trap on_exit EXIT

is_root() { [[ "$(id -u)" -eq 0 ]]; }

# Файлы приложения пишет пользователь приложения, как раньше при загрузке по SSH.
as_app() {
  if is_root; then
    runuser -u "$APP_USER" -- "$@"
  else
    "$@"
  fi
}

valid_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }
valid_host() { [[ ${#1} -le 253 && "$1" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*$ ]]; }
valid_networks() { [[ "$1" =~ ^[0-9A-Fa-f:./]+(\ [0-9A-Fa-f:./]+)*$ ]]; }

parse_args() {
  MODE="${1:-}"
  case "$MODE" in
    pipeline)
      # Только публичный репозиторий: токенов скрипт не принимает, архив скачивается анонимно.
      [[ $# -eq 4 ]] || die 'Ожидаются аргументы: pipeline <sha> <репозиторий> <хост>'
      valid_sha "$2" || die 'Некорректный SHA коммита: нужны 40 шестнадцатеричных символов'
      [[ "$3" == "$EXPECTED_REPOSITORY" ]] || die "Разрешён только репозиторий $EXPECTED_REPOSITORY"
      valid_host "$4" || die 'Некорректное DNS-имя стенда'
      REVISION="$2"; REPOSITORY="$3"; HOST="$4"
      APP_USER="$PIPELINE_APP_USER" ;;
    preview)
      RESULT_PREFIX='IMBC_PREVIEW_RESULT'
      [[ $# -eq 3 ]] || die 'Ожидаются аргументы: preview <sha> <репозиторий>'
      valid_sha "$2" || die 'Некорректный SHA коммита: нужны 40 шестнадцатеричных символов'
      [[ "$3" == "$EXPECTED_REPOSITORY" ]] || die "Разрешён только репозиторий $EXPECTED_REPOSITORY"
      REVISION="$2"; REPOSITORY="$3"
      APP_USER="$PIPELINE_APP_USER" ;;
    local)
      [[ $# -eq 7 ]] || die 'Ожидаются аргументы: local <пользователь> <каталог> <хост> <sha> <SSH allowlist> <ADMIN_ALLOWED_IPS>'
      [[ "$2" =~ ^[a-z_][a-z0-9_-]{0,31}$ && "$2" != root ]] || die 'Недопустимый пользователь приложения'
      valid_host "$4" || die 'Некорректное DNS-имя стенда'
      valid_sha "$5" || die 'Некорректный SHA исходного коммита'
      valid_networks "$6" || die 'Некорректный SSH allowlist'
      [[ -z "$7" ]] || valid_networks "$7" || die 'Некорректный ADMIN_ALLOWED_IPS'
      APP_USER="$2"; STAGE="$3"; HOST="$4"; REVISION="$5"; SSH_ALLOW="$6"; ADMIN_OVERRIDE="$7" ;;
    *) die 'Режим: pipeline, local или preview' ;;
  esac
}

init_paths() {
  if [[ -n "$TEST_ROOT" ]]; then
    # Самопроверка без root: пути внутри временного каталога, заглушки — в $IMBC_DEPLOY_ROOT/bin.
    ! is_root || die 'IMBC_DEPLOY_ROOT допускается только в самопроверке без root'
    [[ "$TEST_ROOT" == /* && -d "$TEST_ROOT" ]] || die 'IMBC_DEPLOY_ROOT должен быть существующим абсолютным путём'
    PIPELINE_APP_USER="$(id -un)"
    PATH="$TEST_ROOT/bin:$SAFE_PATH"
  else
    is_root || die 'Скрипт выполняется от root: через sudo или az vm run-command'
    PATH="$SAFE_PATH"
    : "${HOME:=/root}"
    export HOME
  fi
  export PATH
}

set_paths() {
  APP_HOME="$TEST_ROOT/home/$APP_USER"
  APP_DIR="$APP_HOME/imbc-platform"
  LOG_DIR="$TEST_ROOT/var/log/imbc-deploy"
  LOCK_FILE="$TEST_ROOT/run/imbc-deploy.lock"
  if [[ -n "$TEST_ROOT" ]]; then
    [[ "$APP_USER" == "$(id -un)" ]] || die 'В самопроверке пользователь приложения — текущий пользователь'
  fi
}

open_log() {
  if is_root; then
    [[ ! -L "$LOG_DIR" ]] || die "$LOG_DIR не должен быть ссылкой"
    install -d -m 0700 -o root -g root "$LOG_DIR"
  else
    mkdir -p "$LOG_DIR"
    chmod 0700 "$LOG_DIR"
  fi
  LOG_FILE="$LOG_DIR/deploy-$(date -u +%Y%m%dT%H%M%SZ)-$MODE-${REVISION:0:12}-$$.log"
  (umask 077; set -o noclobber; : > "$LOG_FILE")
  if [[ "$MODE" == pipeline ]]; then
    # run-command возвращает только хвост вывода: подробности — в журнал, наружу — сводка.
    exec 3>&1 >>"$LOG_FILE" 2>&1
    SUMMARY_FD=3
  else
    exec > >(tee -a "$LOG_FILE") 2>&1
  fi
  say "IMBC: развёртывание ($MODE), коммит $REVISION, журнал $LOG_FILE"
}

prune_logs() {
  [[ -n "$LOG_FILE" && -d "$LOG_DIR" ]] || return 0
  find "$LOG_DIR" -maxdepth 1 -type f -name 'deploy-*.log' | sort -r | tail -n +$((KEEP_LOGS + 1)) | xargs -r rm -f --
}

step() {
  CURRENT_STEP="$1"; shift
  local started=$SECONDS
  say "▶ $CURRENT_STEP"
  "$@"
  say "  готово за $((SECONDS - started)) с"
}

acquire_lock() {
  exec 9>>"$LOCK_FILE"
  is_root && chmod 0600 "$LOCK_FILE"
  flock -n 9 || die 'На VM уже выполняется другое развёртывание'
}

preflight() {
  local command
  local -a commands=(rsync python3 curl flock tar find)
  [[ "$MODE" == preview ]] || commands+=(docker)
  for command in "${commands[@]}"; do
    command -v "$command" >/dev/null || die "На VM не найдена команда $command"
  done
  if is_root; then
    command -v runuser >/dev/null || die 'На VM не найдена команда runuser'
    id -u "$APP_USER" >/dev/null 2>&1 || die "Пользователь $APP_USER не существует"
  fi
  [[ "$MODE" == preview ]] || docker compose version >/dev/null || die 'Docker Compose недоступен'
  # Архив распаковывают только pipeline и preview.
  if [[ "$MODE" != local ]]; then
    python3 -c 'import sys, tarfile; sys.exit(0 if hasattr(tarfile, "data_filter") else 1)' \
      || die 'Python 3 на VM не поддерживает безопасную распаковку tarfile (data_filter)'
  fi
  [[ -d "$APP_HOME" && ! -L "$APP_HOME" ]] || die "Нет домашнего каталога $APP_HOME"
  if [[ "$MODE" != local ]]; then
    [[ -d "$APP_DIR" ]] || die "Нет $APP_DIR: первое развёртывание выполняется ./infrastructure/azure/deploy.sh up"
  else
    as_app mkdir -p "$APP_DIR"
  fi
  [[ ! -L "$APP_DIR" && "$(stat -c %U "$APP_DIR")" == "$APP_USER" ]] || die "$APP_DIR должен быть каталогом пользователя $APP_USER"
}

cleanup_stage() {
  if [[ "$CLEAN_STAGE" == true && -n "$STAGE" ]]; then
    as_app rm -rf -- "$STAGE" || true
    CLEAN_STAGE=false
  fi
}

fetch_source() {
  local archive url
  local -a curl_args
  STAGE="$(as_app mktemp -d "$APP_HOME/.imbc-stage.XXXXXXXX")"
  CLEAN_STAGE=true
  as_app mkdir -m 0755 "$STAGE/src"
  archive="$STAGE/source.tar.gz"
  url="https://api.github.com/repos/$REPOSITORY/tarball/$REVISION"
  curl_args=(--fail --silent --show-error --location --proto '=https' --proto-redir '=https'
    --connect-timeout 20 --max-time 600 --retry 3 --retry-delay 5
    -H 'Accept: application/vnd.github+json' -o "$archive")
  say "  архив коммита $REVISION из $REPOSITORY (анонимно)"
  # Для закрытого репозитория GitHub отвечает 404: конвейер поддерживает только публичный.
  reported as_app curl "${curl_args[@]}" "$url" \
    || die 'Архив коммита недоступен анонимно: коммит не отправлен в GitHub или репозиторий закрыт'
  # Архив GitHub содержит SHA коммита в pax-заголовке (как git archive): сверяем его.
  reported as_app python3 - "$archive" "$STAGE/src" "$REVISION" <<'PY'
import sys
import tarfile

archive, destination, revision = sys.argv[1:4]
with tarfile.open(archive, 'r:gz') as source:
    members = source.getmembers()
    if source.pax_headers.get('comment') != revision:
        raise SystemExit('Архив не относится к запрошенному коммиту')
    selected, top = [], None
    for member in members:
        head, _, rest = member.name.partition('/')
        if top is None:
            top = head
        if not head or head != top or head in ('.', '..'):
            raise SystemExit('Неожиданная структура архива')
        if not rest.strip('/'):
            continue
        if not (member.isfile() or member.isdir() or member.issym()):
            raise SystemExit('Архив содержит недопустимый элемент')
        member.name = rest
        selected.append(member)
    if not selected:
        raise SystemExit('Архив пуст')
    source.extractall(destination, members=selected, filter='data')
print(f'Распаковано элементов: {len(selected)}')
PY
  as_app rm -f -- "$archive"
  verify_tree
}

# Коммит без файлов, нужных следующим шагам (например, более старый), не синхронизируется:
# иначе синхронизация с удалением убрала бы с сервера текущую конфигурацию до отказа Compose.
# Наличие самого vm-deploy.sh в коммите проверяет workflow перед run-command.
verify_tree() {
  local path
  for path in compose.yaml compose.azure.yaml .env.example infrastructure/azure/Caddyfile \
      infrastructure/azure/sync-realm.py; do
    [[ -f "$STAGE/src/$path" && ! -L "$STAGE/src/$path" ]] \
      || die "В исходниках нет $path: коммит не подходит для этого стенда; каталог приложения не изменён"
  done
}

check_staging() {
  local suffix="${STAGE#"$APP_HOME/.imbc-stage."}"
  [[ "$STAGE" == "$APP_HOME/.imbc-stage."* && "$suffix" =~ ^[A-Za-z0-9]{8}$ ]] || die 'Недопустимый каталог загрузки'
  [[ -d "$STAGE" && ! -L "$STAGE" && -d "$STAGE/src" && ! -L "$STAGE/src" ]] || die 'Каталог загрузки не найден'
  [[ "$(stat -c %U "$STAGE")" == "$APP_USER" ]] || die 'Каталог загрузки принадлежит другому пользователю'
  CLEAN_STAGE=true
  verify_tree
}

# Тот же код, что configure_env в deploy.sh до выделения общего скрипта; добавлены только
# понятные отказы, когда нужен IP разработчика, которого у конвейера нет.
check_env() {
  reported as_app python3 - "$APP_DIR" "$HOST" "$SSH_ALLOW" "$ADMIN_OVERRIDE" "$STAGE/src/.env.example" <<'PY'
import ipaddress
import os
import re
import secrets
import sys
import tempfile
from pathlib import Path

root, host = Path(sys.argv[1]), sys.argv[2]
ssh_allow, admin_override = sys.argv[3:5]
template = Path(sys.argv[5])

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
    if not (admin_override or existing_admin or ssh_allow):
        raise SystemExit('В серверной .env нет ADMIN_ALLOWED_IPS, а IP разработчика конвейеру неизвестен: выполните ./infrastructure/azure/deploy.sh redeploy; .env не изменён.')
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
    if not (admin_override or ssh_allow):
        raise SystemExit('Серверной .env нет: первое развёртывание выполняется ./infrastructure/azure/deploy.sh up с машины разработчика.')
    raw = template.read_text()
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

write_marker() {
  local name="$1"
  printf '%s\n' "$2" | as_app tee "$APP_DIR/$name.tmp" >/dev/null
  as_app mv -f -- "$APP_DIR/$name.tmp" "$APP_DIR/$name"
}

sync_tree() {
  local -a options=("${SYNC_OPTIONS[@]}")
  # Конвейер приводит каталог к коммиту; deploy.sh, как и прежде, только дополняет файлы.
  [[ "$MODE" != pipeline ]] || options+=(--delete)
  as_app chmod 0755 "$STAGE/src"
  as_app rsync "${options[@]}" "${SYNC_FILTERS[@]}" "$STAGE/src/" "$APP_DIR/"
  # Синхронизирован — ещё не значит запущен: маркер развёртывания пишет шаг marker.
  write_marker .synced-revision "$REVISION $MODE"
  say "  исходники синхронизированы с $APP_DIR"
}

# Только после успешной проверки состояния: маркер называет то, что действительно запущено.
deployed_marker() {
  if [[ "$MODE" == pipeline ]]; then
    write_marker .deployed-revision "$REVISION"
    as_app rm -f -- "$APP_DIR/.deployed-source-commit"
  else
    # Рабочее дерево разработчика может отличаться от коммита: пишется его исходный коммит.
    write_marker .deployed-source-commit "$REVISION"
    as_app rm -f -- "$APP_DIR/.deployed-revision"
  fi
}

# Предпросмотр: те же параметры и правила, что у sync_tree в конвейере, плюс -n (ничего не пишет).
preview_sync() {
  local output line deletions=0 changes=0
  as_app chmod 0755 "$STAGE/src"
  output="$(as_app rsync -n -i --delete "${SYNC_OPTIONS[@]}" "${SYNC_FILTERS[@]}" "$STAGE/src/" "$APP_DIR/")"
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    if [[ "$line" == '*deleting '* ]]; then deletions=$((deletions + 1))
    elif [[ "$line" =~ ^[\<\>ch.][fdLDS] ]]; then changes=$((changes + 1)); fi
  done <<< "$output"
  say "  будет удалено: $deletions; будет создано или изменено: $changes"
  say "  (*deleting — удаление; >f+++ — новый файл; >fc — другое содержимое; .f...p — права;"
  say "   «cannot delete non-empty directory» — каталог останется: в нём есть защищённые серверные файлы)"
  while IFS= read -r line; do
    [[ -z "$line" ]] || say "  $line"
  done <<< "$output"
}

compose() { (cd "$APP_DIR" && docker compose "${COMPOSE_FILES[@]}" "$@"); }

compose_config() { compose config --quiet; }
compose_start() { compose up -d --build --remove-orphans --wait --wait-timeout 600; }
caddy_reload() { compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; }
realm_sync() { (cd "$APP_DIR" && reported as_app python3 infrastructure/azure/sync-realm.py --theme imbc); }

readiness() {
  local attempt
  for attempt in $(seq 1 30); do
    if as_app curl --fail --silent --show-error --connect-timeout 5 --max-time 10 --resolve "$HOST:443:127.0.0.1" "https://$HOST/api/health/ready" >/dev/null 2>&1; then
      say "  API готов (попытка $attempt)"
      return 0
    fi
    sleep 5
  done
  die 'HTTPS/API не готовы; проверьте Caddy, DNS и сертификат'
}

route_check() {
  reported compose exec -T api node - <<'JS'
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
}

status() {
  compose ps
  if [[ "$MODE" == pipeline ]]; then
    local line
    while IFS= read -r line; do say "  $line"; done < <(compose ps --format '{{.Service}} {{.State}} {{.Health}}')
  fi
}

init_paths
parse_args "$@"
set_paths
if [[ "$MODE" == preview ]]; then
  # Без журнала и блокировки: временный каталог загрузки удаляется при выходе.
  say "IMBC: предпросмотр синхронизации конвейера для коммита $REVISION; каталог приложения не меняется"
  step preflight preflight
  step source fetch_source
  step preview preview_sync
  FINISHED=true
  exit 0
fi
CURRENT_STEP='log'
open_log
step lock acquire_lock
step preflight preflight
if [[ "$MODE" == pipeline ]]; then
  step source fetch_source
else
  step source check_staging
fi
step env check_env
step sync sync_tree
# Миграции применяет сервис migrate стека Compose (expand → migrate → contract, NFR-06).
step compose-config compose_config
step compose-up compose_start
step caddy-reload caddy_reload
step realm-sync realm_sync
step readiness readiness
step route-check route_check
step status status
step marker deployed_marker
FINISHED=true
