#!/usr/bin/env bash
# Пробный прогон vm-deploy.sh pipeline без Azure и Docker Compose.
#   bash infrastructure/azure/test/dry-run-github.sh [<sha>]     настоящий архив GitHub; по умолчанию origin/main
#   bash infrastructure/azure/test/dry-run-github.sh --local-head архив git archive HEAD этого клона
#                                                                 в формате GitHub (для ещё не отправленных коммитов)
# Одноразовый контейнер ubuntu:24.04 от root с путями как на VM (/home/imbc/imbc-platform,
# /var/log/imbc-deploy, runuser → imbc). Распаковка, проверка SHA и синхронизация настоящие;
# docker заменён заглушкой (Compose и Keycloak для настоящего sync-realm.py), проверка готовности
# https://<хост>/api/health/ready отвечает успехом. Серверная .env — фиктивная.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
INNER="$(mktemp)"
ARCHIVE="$(mktemp)"
trap 'rm -f "$INNER" "$ARCHIVE"' EXIT
if [[ "${1:-}" == --local-head ]]; then
  SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
  git -C "$REPO_ROOT" archive --format=tar.gz --prefix="Batrbekk-imbc-platform-${SHA:0:7}/" HEAD > "$ARCHIVE"
  echo "Пробный прогон для локального HEAD $SHA (архив git archive)"
else
  SHA="${1:-$(git -C "$REPO_ROOT" ls-remote https://github.com/Batrbekk/imbc-platform.git refs/heads/main | cut -f1)}"
  echo "Пробный прогон для $SHA (архив GitHub)"
fi
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'Не удалось определить SHA' >&2; exit 1; }

cat > "$INNER" <<'CONTAINER'
set -euo pipefail
apt-get update -qq >/dev/null && apt-get install -y -qq rsync python3 curl ca-certificates >/dev/null 2>&1
useradd -m imbc
HOST=imbc-dev.example.test
APP=/home/imbc/imbc-platform

cat > /usr/local/bin/docker <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> /var/tmp/docker.calls
case " $* " in
  *" ps -q keycloak "*) echo 0123456789ab ;;
  *"clientId=imbc-bff"*) echo '[{"id":"client-1","clientId":"imbc-bff"}]' ;;
  *" get clients/client-1 "*) echo '{"attributes":{"existing":"kept"}}' ;;
  *" get users/profile "*) echo '{"attributes":[{"name":"username","permissions":{"view":["admin","user"],"edit":["admin","user"]}},{"name":"email","permissions":{"view":["admin","user"],"edit":["admin","user"]}}]}' ;;
  *" --format "*) printf 'api running healthy\ncaddy running \n' ;;
esac
[[ " $* " != *" exec "* ]] || cat >/dev/null
exit 0
STUB
cat > /usr/local/bin/curl <<'STUB'
#!/usr/bin/env bash
case "${!#}" in
  https://*/api/health/ready) exit 0 ;;
  https://api.github.com/repos/*/tarball/*)
    if [[ -s /opt/archive.tar.gz ]]; then
      args=("$@")
      for ((i = 0; i < ${#args[@]}; i++)); do [[ "${args[i]}" != -o ]] || cp /opt/archive.tar.gz "${args[i + 1]}"; done
      exit 0
    fi ;;
esac
exec /usr/bin/curl "$@"
STUB
chmod 0755 /usr/local/bin/docker /usr/local/bin/curl

# Каталог приложения с серверными файлами, которых нет в репозитории.
runuser -u imbc -- mkdir -p "$APP/infrastructure/mailpit" "$APP/obsolete-dir"
runuser -u imbc -- bash -c "umask 077; cat > '$APP/.env'" <<ENV
PUBLIC_URL=https://$HOST
PUBLIC_HOST=$HOST
COOKIE_SECURE=true
SESSION_COOKIE_NAME=__Host-imbc-session
DEVICE_COOKIE_NAME=__Host-imbc-device
KEYCLOAK_SSL_REQUIRED=external
MAILPIT_UI_AUTH=imbc:dry-run-only
ADMIN_ALLOWED_IPS=203.0.113.7/32
KEYCLOAK_ADMIN_USER=admin
KEYCLOAK_ADMIN_PASSWORD=dry-run-only
KEYCLOAK_ADMIN_CLIENT_SECRET=dry-run-only
KEYCLOAK_DEV_USER_PASSWORD=dry-run-only
OIDC_CLIENT_SECRET=dry-run-only
KEYCLOAK_SMTP_HOST=mailpit
KEYCLOAK_SMTP_PORT=1025
KEYCLOAK_SMTP_FROM=no-reply@imbc.local
KEYCLOAK_SMTP_REPLY_TO=no-reply@imbc.local
KEYCLOAK_SMTP_AUTH=false
KEYCLOAK_SMTP_SSL=false
KEYCLOAK_SMTP_STARTTLS=false
KEYCLOAK_SMTP_USER=dry-run
KEYCLOAK_SMTP_PASSWORD=dry-run-only
ENV
runuser -u imbc -- bash -c "umask 077; echo 'password: dry-run-only' > '$APP/infrastructure/mailpit/.env.smtp-relay.yaml'"
runuser -u imbc -- bash -c "echo stale > '$APP/obsolete-file.txt'; echo stale > '$APP/obsolete-dir/x'"
before_env="$(sha256sum < "$APP/.env")"
before_relay="$(sha256sum < "$APP/infrastructure/mailpit/.env.smtp-relay.yaml")"

# Предпросмотр (deploy.sh preview): показывает удаления и изменения, ничего не меняет.
snapshot() { (cd "$APP" && find . -printf '%p %m %U\n' | sort && find . -type f -exec sha256sum {} + | sort); }
before_preview="$(snapshot)"
cp /opt/vm-deploy.sh /var/tmp/preview.sh
set +e
sh /var/tmp/preview.sh preview "$SHA" Batrbekk/imbc-platform > /var/tmp/preview.txt
preview_rc=$?
set -e
echo "--- предпросмотр (код выхода $preview_rc), начало и итог ---"
head -n 12 /var/tmp/preview.txt; echo '  …'; tail -n 2 /var/tmp/preview.txt
preview_ok=true
grep -Eq '^  \*deleting +obsolete-file.txt$' /var/tmp/preview.txt || preview_ok=false
[[ "$(snapshot)" == "$before_preview" && ! -e /var/log/imbc-deploy ]] || preview_ok=false
[[ "$(tail -n 1 /var/tmp/preview.txt)" == "IMBC_PREVIEW_RESULT=ok revision=$SHA" ]] || preview_ok=false

set +e
cp /opt/vm-deploy.sh /var/tmp/script.sh
sh /var/tmp/script.sh pipeline "$SHA" Batrbekk/imbc-platform "$HOST" > /var/tmp/out.txt
rc=$?
set -e
echo "--- сводка (код выхода $rc) ---"; cat /var/tmp/out.txt
echo '--- проверки ---'
check() { if eval "$2"; then echo "ok   - $1"; else echo "FAIL - $1"; fails=1; fi; }
fails=0
check 'предпросмотр перечислил удаление и ничего не изменил' '[[ "$preview_ok" == true ]]'
if grep -q 'IMBC_DEPLOY_RESULT=ok' /var/tmp/out.txt; then
  check 'последняя строка ok с SHA' '[[ "$(tail -n1 /var/tmp/out.txt)" == "IMBC_DEPLOY_RESULT=ok revision=$SHA" ]]'
  check '.deployed-revision = SHA' '[[ "$(cat $APP/.deployed-revision)" == "$SHA" ]]'
  check 'устаревшие файлы удалены' '[[ ! -e $APP/obsolete-file.txt && ! -e $APP/obsolete-dir ]]'
  check 'файлы принадлежат imbc' '[[ -z "$(find $APP ! -user imbc | head -n1)" ]]'
  check 'дерево совпадает с архивом коммита (кроме серверных файлов)' 'mkdir -p /var/tmp/ref && { if [[ -s /opt/archive.tar.gz ]]; then cat /opt/archive.tar.gz; else /usr/bin/curl -fsSL "https://api.github.com/repos/Batrbekk/imbc-platform/tarball/$SHA"; fi; } | tar -xz -C /var/tmp/ref --strip-components=1 && diff -rq -x .env -x .env.smtp-relay.yaml -x .deployed-revision -x .synced-revision /var/tmp/ref "$APP" | grep -v "^Only in $APP/infrastructure: mailpit$" >/var/tmp/diff.txt; cat /var/tmp/diff.txt; [[ ! -s /var/tmp/diff.txt ]]'
else
  # Коммит, отклонённый до синхронизации, не должен менять каталог приложения.
  check 'каталог приложения не изменён' '[[ -f $APP/obsolete-file.txt && -f $APP/obsolete-dir/x && ! -e $APP/.deployed-revision && "$(ls -A $APP | sort | tr "\n" " ")" == ".env infrastructure obsolete-dir obsolete-file.txt " ]]'
  rc=0
fi
check '.env и relay-секрет не изменены' '[[ "$(sha256sum < $APP/.env)" == "$before_env" && "$(sha256sum < $APP/infrastructure/mailpit/.env.smtp-relay.yaml)" == "$before_relay" && "$(stat -c %a $APP/.env)" == 600 ]]'
check 'журнал 0600 в каталоге 0700 root' '[[ "$(stat -c %a:%U /var/log/imbc-deploy)" == 700:root && "$(stat -c %a:%U /var/log/imbc-deploy/*.log)" == 600:root ]]'
check 'временные каталоги удалены' '! compgen -G "/home/imbc/.imbc-stage.*" >/dev/null'
echo '--- вызовы docker (заглушка) ---'; cut -c1-110 /var/tmp/docker.calls
exit $(( rc != 0 || fails != 0 ))
CONTAINER
docker run --rm -e SHA="$SHA" -v "$REPO_ROOT/infrastructure/azure/vm-deploy.sh:/opt/vm-deploy.sh:ro" \
  -v "$INNER:/opt/dry-run.sh:ro" -v "$ARCHIVE:/opt/archive.tar.gz:ro" ubuntu:24.04 bash /opt/dry-run.sh
