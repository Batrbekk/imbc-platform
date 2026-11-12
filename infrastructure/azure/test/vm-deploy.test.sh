#!/usr/bin/env bash
# Самопроверка infrastructure/azure/vm-deploy.sh без Azure, GitHub и Docker.
#   bash infrastructure/azure/test/vm-deploy.test.sh
# На Linux выполняется напрямую (нужны bash, rsync, python3 ≥ 3.12, git, flock, GNU coreutils),
# на других ОС — в одноразовом контейнере ubuntu:24.04.
#
# Заглушки: docker (все вызовы Compose записываются, сбой задаётся FAKE_FAIL=<слово>),
# curl (архив GitHub подменяется локальным git archive, /api/health/ready отвечает успехом,
# FAKE_FAIL=download — ответ 404, как для закрытого репозитория),
# infrastructure/azure/sync-realm.py внутри тестового коммита. Скрипт работает в режиме
# IMBC_DEPLOY_ROOT: без root, пути внутри временного каталога, пользователь приложения — текущий.
# Проверки передаются в eval строками в одинарных кавычках: раскрытие откладывается намеренно,
# поэтому SC2016 и SC2034 (переменные, читаемые только в этих строках) здесь ложные.
# shellcheck disable=SC2016,SC2034
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
SCRIPT="$REPO_ROOT/infrastructure/azure/vm-deploy.sh"

if [[ "$(uname -s)" != Linux ]]; then
  command -v docker >/dev/null || { echo 'Нужен Linux или Docker' >&2; exit 1; }
  exec docker run --rm -v "$REPO_ROOT:/src:ro" ubuntu:24.04 bash -c '
    set -e
    apt-get update -qq >/dev/null && apt-get install -y -qq rsync python3 git >/dev/null
    useradd -m tester
    exec runuser -u tester -- bash /src/infrastructure/azure/test/vm-deploy.test.sh'
fi
[[ "$(id -u)" -ne 0 ]] || { echo 'Самопроверка запускается без root' >&2; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ME="$(id -un)"
HOST='dev.example.test'
TOKEN='ghs_SelfTestToken0123456789abcdef'
CHECKER="$REPO_ROOT/infrastructure/azure/check-deploy-result.sh"
PASSED=0
FAILED=0

pass() { PASSED=$((PASSED + 1)); printf 'ok   - %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf 'FAIL - %s\n' "$1"; }
check() { local name="$1"; shift; if "$@"; then pass "$name"; else fail "$name"; fi; }

# --- тестовый коммит и архив в формате GitHub (git archive с SHA в pax-заголовке) ---
make_repo() {
  local repo="$WORK/repo"
  mkdir -p "$repo/apps/api" "$repo/infrastructure/azure" "$repo/config" "$repo/bin"
  cat > "$repo/.env.example" <<'ENV'
PUBLIC_URL=http://localhost:3000
PUBLIC_HOST=localhost
SESSION_SECRET=change-me
DB_OWNER_PASSWORD=change-me
DB_APP_PASSWORD=change-me
KEYCLOAK_DB_PASSWORD=change-me
S3_SECRET_KEY=change-me
KEYCLOAK_ADMIN_PASSWORD=change-me
OIDC_CLIENT_SECRET=change-me
KEYCLOAK_ADMIN_CLIENT_SECRET=change-me
ENV
  echo 'API_EXAMPLE=1' > "$repo/apps/api/.env.example"
  echo 'NEW_README' > "$repo/README.md"
  echo 'new' > "$repo/new-file.txt"
  echo 'services: {}' > "$repo/compose.yaml"
  echo 'services: {}' > "$repo/compose.azure.yaml"
  printf 'print("realm stub ok")\n' > "$repo/infrastructure/azure/sync-realm.py"
  : > "$repo/infrastructure/azure/Caddyfile"
  : > "$repo/infrastructure/azure/vm-deploy.sh"
  printf '#!/bin/sh\necho tool\n' > "$repo/bin/tool.sh"
  chmod 0755 "$repo/bin/tool.sh"
  ln -s README.md "$repo/link"
  # Отслеживаемые, но исключаемые правилами upload_code файлы.
  echo 'tracked-secret' > "$repo/.env.production"
  echo 'log' > "$repo/debug.log"
  echo 'key' > "$repo/config/dev.key"
  git -C "$repo" init -q
  git -C "$repo" add -A
  git -C "$repo" -c user.name=selftest -c user.email=selftest@example.invalid commit -q -m test
  SHA="$(git -C "$repo" rev-parse HEAD)"
  ARCHIVE="$WORK/archive.tar.gz"
  git -C "$repo" archive --format=tar.gz --prefix="Batrbekk-imbc-platform-${SHA:0:7}/" HEAD > "$ARCHIVE"
}

make_stubs() {
  local bin="$1/bin"
  mkdir -p "$bin"
  cat > "$bin/docker" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$IMBC_DEPLOY_ROOT/docker.calls"
if [[ -n "${FAKE_FAIL:-}" && " $* " == *" $FAKE_FAIL "* ]]; then echo "stub: $FAKE_FAIL failed" >&2; exit 1; fi
[[ " $* " != *" exec "* ]] || cat >/dev/null
[[ " $* " != *" --format "* ]] || echo 'api running healthy'
exit 0
STUB
  cat > "$bin/curl" <<'STUB'
#!/usr/bin/env bash
args=("$@"); url="${args[-1]}"; out=''
for ((i = 0; i < ${#args[@]}; i++)); do
  [[ "${args[i]}" != -o ]] || out="${args[i + 1]}"
  [[ "${args[i]}" != -H || "${args[i + 1]}" != *uthorization* ]] || echo yes > "$IMBC_DEPLOY_ROOT/auth-header"
done
printf '%s\n' "$url" >> "$IMBC_DEPLOY_ROOT/curl.calls"
case "$url" in
  https://api.github.com/repos/Batrbekk/imbc-platform/tarball/*)
    if [[ "${FAKE_FAIL:-}" == download ]]; then echo 'curl: (22) The requested URL returned error: 404' >&2; exit 22; fi
    cp "$FAKE_ARCHIVE" "$out" ;;
  https://*/api/health/ready) [[ "${FAKE_FAIL:-}" != ready ]] ;;
  *) exit 6 ;;
esac
STUB
  chmod 0755 "$bin/docker" "$bin/curl"
}

valid_env() {
  cat <<ENV
PUBLIC_URL=https://$HOST
PUBLIC_HOST=$HOST
COOKIE_SECURE=true
SESSION_COOKIE_NAME=__Host-imbc-session
DEVICE_COOKIE_NAME=__Host-imbc-device
KEYCLOAK_SSL_REQUIRED=external
MAILPIT_UI_AUTH=imbc:server-only-mailpit
ADMIN_ALLOWED_IPS=203.0.113.7/32
SESSION_SECRET=server-only-session-secret
ENV
}

# Новый корень: каталог приложения с серверными файлами, которых нет в репозитории.
new_root() {
  R="$(mktemp -d "$WORK/root.XXXXXX")"
  APP_HOME="$R/home/$ME"
  APP="$APP_HOME/imbc-platform"
  mkdir -p "$APP/infrastructure/mailpit" "$APP/old-dir" "$R/run" "$R/var/log"
  make_stubs "$R"
  valid_env > "$APP/.env"
  echo 'relay-password: server-only-relay' > "$APP/infrastructure/mailpit/.env.smtp-relay.yaml"
  chmod 0600 "$APP/.env" "$APP/infrastructure/mailpit/.env.smtp-relay.yaml"
  echo 'OLD_README' > "$APP/README.md"
  echo 'stale' > "$APP/stale.txt"
  echo 'stale' > "$APP/old-dir/file"
  echo 'previous-local-upload' > "$APP/.deployed-source-commit"
}

run_deploy() {
  set +e
  OUT="$(env IMBC_DEPLOY_ROOT="$R" FAKE_ARCHIVE="$ARCHIVE" FAKE_FAIL="${FAKE_FAIL:-}" bash "$SCRIPT" "$@" 2>&1)"
  RC=$?
  set -e
}

last_line() { tail -n 1 <<< "$OUT"; }
result_is() { [[ "$(last_line)" == "$1" ]]; }
no_ok_line() { ! grep -Eq 'IMBC_(DEPLOY|PREVIEW)_RESULT=ok' <<< "$OUT"; }
untouched() { [[ -f "$APP/stale.txt" && ! -e "$R/docker.calls" && ! -e "$R/curl.calls" && ! -e "$R/PWNED" && ! -e "$WORK/PWNED" ]]; }
file_is() { [[ -f "$1" && "$(cat "$1")" == "$2" ]]; }
mode_is() { [[ "$(stat -c %a "$1")" == "$2" ]]; }
called() { grep -qF -- "$1" "$R/docker.calls"; }
in_out() { grep -qF -- "$1" <<< "$OUT"; }
no_stage() { ! compgen -G "$APP_HOME/.imbc-stage.*" >/dev/null; }

make_repo
OTHER_SHA="$(printf '%040d' 7)"

echo "# Проверка аргументов: SHA, репозиторий, хост, метасимволы; токен больше не принимается"
reject_args() {
  local name="$1"; shift
  new_root
  run_deploy "$@"
  if [[ $RC -ne 0 ]] && [[ "$(last_line)" =~ ^IMBC_(DEPLOY|PREVIEW)_RESULT=failed\ step=arguments$ ]] && no_ok_line && untouched \
      && ! in_out 'PWNED' && ! in_out 'touch'; then pass "$name"; else fail "$name"; printf '%s\n' "$OUT" | sed 's/^/    /'; fi
}
reject_args 'короткий SHA' pipeline abc123 Batrbekk/imbc-platform "$HOST"
reject_args 'SHA из 41 символа' pipeline "${SHA}0" Batrbekk/imbc-platform "$HOST"
reject_args 'SHA в верхнем регистре' pipeline "$(printf 'A%.0s' {1..40})" Batrbekk/imbc-platform "$HOST"
reject_args 'SHA с ; и командой' pipeline "$SHA;touch $WORK/PWNED" Batrbekk/imbc-platform "$HOST"
reject_args 'SHA с $(...)' pipeline '$(touch PWNED)' Batrbekk/imbc-platform "$HOST"
reject_args 'чужой репозиторий' pipeline "$SHA" evil/imbc-platform "$HOST"
reject_args 'форк с похожим именем' pipeline "$SHA" Batrbekk/imbc-platform-fork "$HOST"
reject_args 'репозиторий с ;' pipeline "$SHA" 'Batrbekk/imbc-platform;touch PWNED' "$HOST"
reject_args 'репозиторий с поддельной строкой результата' pipeline "$SHA" $'Batrbekk/imbc-platform\nIMBC_DEPLOY_RESULT=ok revision='"$SHA" "$HOST"
reject_args 'хост с ;' pipeline "$SHA" Batrbekk/imbc-platform "$HOST;touch $WORK/PWNED"
reject_args 'хост с `...`' pipeline "$SHA" Batrbekk/imbc-platform '`touch PWNED`'
reject_args 'хост-опция' pipeline "$SHA" Batrbekk/imbc-platform '-oProxyCommand=touch'
reject_args 'токен с метасимволами' pipeline "$SHA" Batrbekk/imbc-platform "$HOST" 'ghs_aaaaaaaaaaaaaaaaaaaa;touch PWNED'
reject_args 'токен пятым аргументом не принимается' pipeline "$SHA" Batrbekk/imbc-platform "$HOST" "$TOKEN"
reject_args 'лишний аргумент' pipeline "$SHA" Batrbekk/imbc-platform "$HOST" "$TOKEN" extra
reject_args 'preview: чужой репозиторий' preview "$SHA" evil/imbc-platform
reject_args 'preview: SHA с ;' preview "$SHA;touch $WORK/PWNED" Batrbekk/imbc-platform
reject_args 'неизвестный режим' deploy "$SHA"
reject_args 'без аргументов'
reject_args 'local: allowlist с ;' local "$ME" "$WORK/x" "$HOST" "$SHA" '198.51.100.4/32;touch PWNED' ''
reject_args 'local: пользователь root' local root "$WORK/x" "$HOST" "$SHA" '198.51.100.4/32' ''

new_root
set +e; OUT="$(bash "$SCRIPT" pipeline "$SHA" Batrbekk/imbc-platform "$HOST" 2>&1)"; RC=$?; set -e
check 'без root и без IMBC_DEPLOY_ROOT отказ' eval '[[ $RC -ne 0 ]] && result_is "IMBC_DEPLOY_RESULT=failed step=arguments"'

echo "# Конвейер: синхронизация с удалением, серверные файлы сохраняются"
new_root
ENV_SUM="$(sha256sum < "$APP/.env")"
RELAY_SUM="$(sha256sum < "$APP/infrastructure/mailpit/.env.smtp-relay.yaml")"
mkdir -p "$R/var/log/imbc-deploy"
for i in $(seq -w 1 25); do : > "$R/var/log/imbc-deploy/deploy-20000101T0000${i}Z-old.log"; done
run_deploy pipeline "$SHA" Batrbekk/imbc-platform "$HOST"
check 'результат ok с ожидаемым SHA' eval '[[ $RC -eq 0 ]] && result_is "IMBC_DEPLOY_RESULT=ok revision=$SHA"'
check 'серверная .env не изменена (0600)' eval '[[ "$(sha256sum < "$APP/.env")" == "$ENV_SUM" ]] && mode_is "$APP/.env" 600'
check 'relay-секрет Mailpit сохранён' eval '[[ "$(sha256sum < "$APP/infrastructure/mailpit/.env.smtp-relay.yaml")" == "$RELAY_SUM" ]]'
check 'удалённые из репозитория файлы удалены' eval '[[ ! -e "$APP/stale.txt" && ! -e "$APP/old-dir" ]]'
check 'файлы коммита на месте' eval 'file_is "$APP/README.md" NEW_README && file_is "$APP/new-file.txt" new && file_is "$APP/apps/api/.env.example" API_EXAMPLE=1'
check 'исполняемый бит и ссылка сохранены' eval '[[ -x "$APP/bin/tool.sh" && -L "$APP/link" ]]'
check 'исключённые файлы (.env.*, *.log, *.key) не переданы' eval '[[ ! -e "$APP/.env.production" && ! -e "$APP/debug.log" && ! -e "$APP/config/dev.key" ]]'
check '.deployed-revision = SHA после успеха, старый маркер удалён' eval 'file_is "$APP/.deployed-revision" "$SHA" && [[ ! -e "$APP/.deployed-source-commit" ]] && file_is "$APP/.synced-revision" "$SHA pipeline"'
check 'шаги Compose как в deploy.sh' eval 'called "compose -f compose.yaml -f compose.azure.yaml config --quiet" && called "up -d --build --remove-orphans --wait --wait-timeout 600" && called "exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile" && called "exec -T api node -" && called "compose -f compose.yaml -f compose.azure.yaml ps"'
check 'sync-realm.py выполнен' eval 'in_out "realm stub ok"'
check 'архив скачан анонимно (без заголовка Authorization)' eval '[[ ! -e "$R/auth-header" ]]'
check 'каталог журналов 0700, журнал 0600' eval 'mode_is "$R/var/log/imbc-deploy" 700 && mode_is "$(ls -t "$R"/var/log/imbc-deploy/*-pipeline-*.log | head -n1)" 600'
check 'хранятся последние 20 журналов' eval '[[ $(find "$R/var/log/imbc-deploy" -name "deploy-*.log" | wc -l) -eq 20 ]] && compgen -G "$R/var/log/imbc-deploy/*-pipeline-*.log" >/dev/null'
check 'сводка короче 4 КБ' eval '[[ ${#OUT} -lt 4096 ]]'
check 'временный каталог удалён' no_stage
echo '# Сводка, которую получает GitHub Actions:'
while IFS= read -r line; do printf '    | %s\n' "$line"; done <<< "$OUT"

echo "# Сбой шага даёт failed с именем шага"
new_root
echo 'previous-deployed' > "$APP/.deployed-revision"
FAKE_FAIL=up run_deploy pipeline "$SHA" Batrbekk/imbc-platform "$HOST"
check 'сбой compose up → failed step=compose-up' eval '[[ $RC -ne 0 ]] && result_is "IMBC_DEPLOY_RESULT=failed step=compose-up" && no_ok_line'
check 'после сбоя .deployed-revision не переписан, .synced-revision = SHA' eval 'file_is "$APP/.deployed-revision" previous-deployed && file_is "$APP/.synced-revision" "$SHA pipeline"'
check 'после сбоя временный каталог удалён' no_stage

new_root
FAKE_FAIL=download run_deploy pipeline "$SHA" Batrbekk/imbc-platform "$HOST"
check 'архив недоступен анонимно (закрытый репозиторий) → failed step=source' eval '[[ $RC -ne 0 ]] && result_is "IMBC_DEPLOY_RESULT=failed step=source" && in_out "недоступен анонимно" && [[ -f "$APP/stale.txt" ]]'

new_root
run_deploy pipeline "$OTHER_SHA" Batrbekk/imbc-platform "$HOST"
check 'архив другого коммита → failed step=source, файлы не тронуты' eval '[[ $RC -ne 0 ]] && result_is "IMBC_DEPLOY_RESULT=failed step=source" && [[ -f "$APP/stale.txt" ]] && in_out "не относится"'

# Коммит без файлов конвейера (как origin/main до него): отказ до синхронизации.
OLD_REPO="$WORK/old-repo"
mkdir -p "$OLD_REPO" && echo old > "$OLD_REPO/README.md"
git -C "$OLD_REPO" init -q && git -C "$OLD_REPO" add -A
git -C "$OLD_REPO" -c user.name=selftest -c user.email=selftest@example.invalid commit -q -m old
OLD_SHA="$(git -C "$OLD_REPO" rev-parse HEAD)"
new_root
set +e
OUT="$(git -C "$OLD_REPO" archive --format=tar.gz --prefix=old/ HEAD > "$WORK/old.tar.gz" \
  && env IMBC_DEPLOY_ROOT="$R" FAKE_ARCHIVE="$WORK/old.tar.gz" bash "$SCRIPT" pipeline "$OLD_SHA" Batrbekk/imbc-platform "$HOST" 2>&1)"
RC=$?
set -e
check 'коммит без compose.azure.yaml и т.п. → failed step=source, ничего не удалено' eval '[[ $RC -ne 0 ]] && result_is "IMBC_DEPLOY_RESULT=failed step=source" && [[ -f "$APP/stale.txt" ]] && file_is "$APP/README.md" OLD_README'

new_root
rm -f "$APP/.env"
run_deploy pipeline "$SHA" Batrbekk/imbc-platform "$HOST"
check 'нет серверной .env → failed step=env, без синхронизации' eval '[[ $RC -ne 0 ]] && result_is "IMBC_DEPLOY_RESULT=failed step=env" && [[ -f "$APP/stale.txt" && ! -e "$APP/.env" ]] && in_out "deploy.sh up"'

new_root
grep -v '^ADMIN_ALLOWED_IPS=' "$APP/.env" > "$WORK/env" && cat "$WORK/env" > "$APP/.env"
ENV_SUM="$(sha256sum < "$APP/.env")"
run_deploy pipeline "$SHA" Batrbekk/imbc-platform "$HOST"
check 'нет ADMIN_ALLOWED_IPS → failed step=env, .env не изменена' eval '[[ $RC -ne 0 ]] && result_is "IMBC_DEPLOY_RESULT=failed step=env" && [[ "$(sha256sum < "$APP/.env")" == "$ENV_SUM" ]] && in_out "ADMIN_ALLOWED_IPS"'

new_root
sed -i 's/^PUBLIC_HOST=.*/PUBLIC_HOST=other.example.test/' "$APP/.env"
run_deploy pipeline "$SHA" Batrbekk/imbc-platform "$HOST"
check 'хост не совпадает с .env → failed step=env' eval '[[ $RC -ne 0 ]] && result_is "IMBC_DEPLOY_RESULT=failed step=env" && in_out "PUBLIC_HOST"'

new_root
# Блокировку держит сам тест через отдельный дескриптор, как параллельный запуск.
exec 8>>"$R/run/imbc-deploy.lock"
flock 8
run_deploy pipeline "$SHA" Batrbekk/imbc-platform "$HOST"
exec 8>&-
check 'параллельное развёртывание → failed step=lock' eval '[[ $RC -ne 0 ]] && result_is "IMBC_DEPLOY_RESULT=failed step=lock" && [[ -f "$APP/stale.txt" ]]'

echo "# Враждебные элементы архива: отказ до синхронизации"
HOSTILE_SHA="$(printf 'b%.0s' {1..40})"
hostile_archive() {
  python3 - "$WORK/hostile.tar.gz" "$HOSTILE_SHA" "$1" <<'PY'
import io
import sys
import tarfile

path, revision, kind = sys.argv[1:4]
top = 'Batrbekk-imbc-platform-bbbbbbb'
def regular(name, data=b'x'):
    info = tarfile.TarInfo(name)
    info.size = len(data)
    return info, io.BytesIO(data)
with tarfile.open(path, 'w:gz', format=tarfile.PAX_FORMAT, pax_headers={'comment': revision}) as archive:
    directory = tarfile.TarInfo(top)
    directory.type = tarfile.DIRTYPE
    directory.mode = 0o755
    archive.addfile(directory)
    for name in ('compose.yaml', 'compose.azure.yaml', '.env.example', 'infrastructure/azure/Caddyfile',
                 'infrastructure/azure/sync-realm.py', 'infrastructure/azure/vm-deploy.sh'):
        archive.addfile(*regular(f'{top}/{name}'))
    if kind == 'dotdot':
        archive.addfile(*regular(f'{top}/../../../escape.txt'))
    elif kind == 'absolute':
        archive.addfile(*regular('/tmp/imbc-selftest-escape.txt'))
    elif kind == 'symlink':
        link = tarfile.TarInfo(f'{top}/outside')
        link.type = tarfile.SYMTYPE
        link.linkname = '../../../../../../etc/passwd'
        archive.addfile(link)
    elif kind == 'hardlink':
        # Цель — уже распакованный файл внутри дерева (имена без префикса, как после разбора):
        # фильтр data такую ссылку пропустил бы, остановить её может только явный запрет типа.
        link = tarfile.TarInfo(f'{top}/hard')
        link.type = tarfile.LNKTYPE
        link.linkname = 'compose.yaml'
        archive.addfile(link)
    elif kind == 'device':
        device = tarfile.TarInfo(f'{top}/null')
        device.type = tarfile.CHRTYPE
        device.devmajor, device.devminor = 1, 3
        archive.addfile(device)
PY
}
for kind in dotdot absolute symlink hardlink device; do
  new_root
  hostile_archive "$kind"
  set +e
  OUT="$(env IMBC_DEPLOY_ROOT="$R" FAKE_ARCHIVE="$WORK/hostile.tar.gz" bash "$SCRIPT" pipeline "$HOSTILE_SHA" Batrbekk/imbc-platform "$HOST" 2>&1)"
  RC=$?
  set -e
  check "архив с элементом $kind → failed step=source, ничего не синхронизировано" eval '[[ $RC -ne 0 ]] && result_is "IMBC_DEPLOY_RESULT=failed step=source" && [[ -f "$APP/stale.txt" && ! -e "$APP/.synced-revision" ]] && file_is "$APP/README.md" OLD_README && [[ -z "$(find "$WORK" -name escape.txt)" && ! -e /tmp/imbc-selftest-escape.txt ]] && no_stage'
done

echo "# Предпросмотр синхронизации (deploy.sh preview): показывает, ничего не меняет"
new_root
SNAPSHOT_BEFORE="$(cd "$APP" && find . -printf '%p %m %s\n' | sort && find . -type f -exec sha256sum {} + | sort)"
run_deploy preview "$SHA" Batrbekk/imbc-platform
SNAPSHOT_AFTER="$(cd "$APP" && find . -printf '%p %m %s\n' | sort && find . -type f -exec sha256sum {} + | sort)"
check 'preview: результат IMBC_PREVIEW_RESULT=ok' eval '[[ $RC -eq 0 ]] && result_is "IMBC_PREVIEW_RESULT=ok revision=$SHA"'
check 'preview: перечислены удаляемые только серверные файлы' eval 'grep -Eq "^  \*deleting +stale.txt$" <<< "$OUT" && grep -Eq "^  \*deleting +old-dir/$" <<< "$OUT" && ! in_out "deleting   .deployed-source-commit"'
check 'preview: счётчики удалений и изменений' eval 'in_out "будет удалено: 3; будет создано или изменено: 16"'
check 'preview: перечислены новые и изменённые файлы' eval 'grep -Eq ">f\+{9,} new-file.txt" <<< "$OUT" && grep -Eq ">fc[^ ]* README.md" <<< "$OUT"'
check 'preview: серверные .env и relay-секрет не упомянуты' eval '! in_out ".env.smtp-relay.yaml" && ! grep -Eq " \.env$" <<< "$OUT"'
check 'preview: каталог приложения не изменился' eval '[[ "$SNAPSHOT_BEFORE" == "$SNAPSHOT_AFTER" ]]'
check 'preview: без Compose, журнала и временных каталогов' eval '! grep -q " up \| config " "$R/docker.calls" 2>/dev/null && [[ ! -e "$R/var/log/imbc-deploy" ]] && no_stage'
echo '# Вывод предпросмотра:'
while IFS= read -r line; do printf '    | %s\n' "$line"; done <<< "$OUT"

echo "# Разбор строки результата в workflow (check-deploy-result.sh)"
checker() { printf '%b' "$1" > "$WORK/result.txt"; set +e; CHECK_OUT="$(bash "$CHECKER" "$WORK/result.txt" "$SHA" 2>&1)"; CHECK_RC=$?; set -e; }
checker "[stdout]\nсводка\nIMBC_DEPLOY_RESULT=ok revision=$SHA\n[stderr]\n"
check 'checker: ok с ожидаемым SHA → успех' eval '[[ $CHECK_RC -eq 0 ]]'
checker "[stdout]\nIMBC_DEPLOY_RESULT=ok revision=$SHA\r\n"
check 'checker: CRLF допускается' eval '[[ $CHECK_RC -eq 0 ]]'
checker "IMBC_DEPLOY_RESULT=failed step=compose-up\n"
check 'checker: failed → отказ' eval '[[ $CHECK_RC -ne 0 ]] && grep -q "failed step=compose-up" <<< "$CHECK_OUT"'
checker "IMBC_DEPLOY_RESULT=ok revision=$OTHER_SHA\n"
check 'checker: ok с другим SHA → отказ' eval '[[ $CHECK_RC -ne 0 ]]'
checker "IMBC_DEPLOY_RESULT=ok revision=$SHA\nIMBC_DEPLOY_RESULT=failed step=status\n"
check 'checker: решает последняя строка результата' eval '[[ $CHECK_RC -ne 0 ]]'
checker "  IMBC_DEPLOY_RESULT=ok revision=$SHA\nsome output\n"
check 'checker: строка не с начала или её нет → отказ' eval '[[ $CHECK_RC -ne 0 ]] && grep -q "нет строки результата" <<< "$CHECK_OUT"'
checker "::error::подделка\nIMBC_DEPLOY_RESULT=ok revision=$SHA\n"
check 'checker: команды workflow в выводе VM отключены' eval '[[ $CHECK_RC -eq 0 ]] && [[ "$(head -n 1 <<< "$CHECK_OUT")" == ::stop-commands::* ]]'

echo "# Режим deploy.sh (local): дополнение без удаления, IP разработчика"
make_stage() {
  STAGE="$(mktemp -d "$APP_HOME/.imbc-stage.XXXXXXXX")"
  mkdir -m 0755 "$STAGE/src"
  tar -xzf "$ARCHIVE" -C "$STAGE/src" --strip-components=1
  rm -f "$STAGE/src/.env.production" "$STAGE/src/debug.log" "$STAGE/src/config/dev.key"
}
new_root
echo "$SHA" > "$APP/.deployed-revision"
rm -f "$APP/.deployed-source-commit"
grep -v '^ADMIN_ALLOWED_IPS=' "$APP/.env" > "$WORK/env" && cat "$WORK/env" > "$APP/.env"
make_stage
run_deploy local "$ME" "$STAGE" "$HOST" "$SHA" '198.51.100.4/32' ''
check 'local: результат ok' eval '[[ $RC -eq 0 ]] && result_is "IMBC_DEPLOY_RESULT=ok revision=$SHA"'
check 'local: файлы вне загрузки не удаляются (как прежде)' eval '[[ -f "$APP/stale.txt" ]] && file_is "$APP/README.md" NEW_README'
check 'local: .deployed-source-commit, без .deployed-revision' eval 'file_is "$APP/.deployed-source-commit" "$SHA" && [[ ! -e "$APP/.deployed-revision" ]] && file_is "$APP/.synced-revision" "$SHA local"'
check 'local: ADMIN_ALLOWED_IPS из IP разработчика' eval 'grep -qx "ADMIN_ALLOWED_IPS=198.51.100.4/32 127.0.0.1/32 ::1/128" "$APP/.env" && mode_is "$APP/.env" 600'
check 'local: каталог загрузки удалён' no_stage

new_root
rm -f "$APP/.env"
make_stage
run_deploy local "$ME" "$STAGE" "$HOST" "$SHA" '198.51.100.4/32' ''
check 'local: новая .env из шаблона, 0600, без change-me' eval '[[ $RC -eq 0 ]] && mode_is "$APP/.env" 600 && grep -qx "PUBLIC_HOST=$HOST" "$APP/.env" && ! grep -q change-me "$APP/.env"'

new_root
make_stage
FAKE_FAIL=up run_deploy local "$ME" "$STAGE" "$HOST" "$SHA" '198.51.100.4/32' ''
check 'local: при сбое .deployed-source-commit не пишется' eval '[[ $RC -ne 0 ]] && result_is "IMBC_DEPLOY_RESULT=failed step=compose-up" && file_is "$APP/.deployed-source-commit" previous-local-upload'

new_root
run_deploy local "$ME" /etc "$HOST" "$SHA" '198.51.100.4/32' ''
check 'local: каталог загрузки вне домашнего → failed step=source' eval '[[ $RC -ne 0 ]] && result_is "IMBC_DEPLOY_RESULT=failed step=source" && [[ -f "$APP/stale.txt" && ! -e "$APP/.deployed-source-commit.tmp" ]] && ! grep -q " up " "$R/docker.calls"'
make_stage
run_deploy local "$ME" "$STAGE/../imbc-platform" "$HOST" "$SHA" '198.51.100.4/32' ''
check 'local: путь с .. → failed step=source' eval '[[ $RC -ne 0 ]] && result_is "IMBC_DEPLOY_RESULT=failed step=source" && [[ -f "$APP/stale.txt" ]]'

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[[ "$FAILED" -eq 0 ]]
