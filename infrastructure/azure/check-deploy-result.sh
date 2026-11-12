#!/usr/bin/env bash
# Проверка вывода run-command в deploy-dev.yml: успех только если ПОСЛЕДНЯЯ строка
# IMBC_DEPLOY_RESULT во выводе — ровно «IMBC_DEPLOY_RESULT=ok revision=<ожидаемый SHA>».
#   check-deploy-result.sh <файл вывода> <sha>
# Печатает вывод (краткую сводку vm-deploy.sh) и итог; код 0 — успех, 1 — нет.
set -euo pipefail

[[ $# -eq 2 && -f "$1" && "$2" =~ ^[0-9a-f]{40}$ ]] || { echo 'Использование: check-deploy-result.sh <файл вывода> <sha>' >&2; exit 2; }
output="$1"
sha="$2"

# Вывод VM печатается с отключёнными командами workflow (::…::), затем они включаются снова.
# run-command может вернуть строки с CR.
stop="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
echo "::stop-commands::$stop"
sed 's/\r$//' "$output"
echo "::$stop::"
result="$(sed 's/\r$//' "$output" | grep -E '^IMBC_DEPLOY_RESULT=' | tail -n 1 || true)"
if [[ "$result" == "IMBC_DEPLOY_RESULT=ok revision=$sha" ]]; then
  echo "Развёртывание $sha подтверждено скриптом на VM"
  exit 0
fi
echo "::error::Развёртывание на VM не подтверждено: ${result:-нет строки результата}. Полный журнал — /var/log/imbc-deploy/ на VM"
exit 1
