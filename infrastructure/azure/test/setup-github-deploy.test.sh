#!/usr/bin/env bash
# Самопроверка infrastructure/azure/setup-github-deploy.sh без Azure и GitHub.
#   bash infrastructure/azure/test/setup-github-deploy.test.sh
#   SETUP_SCRIPT=<путь к другой версии> bash …   — прогнать те же проверки на другой версии скрипта
# az — заглушка fake_az.py: состояние в JSON, результат каждого запроса того же типа JMESPath,
# что у настоящего CLI, и вывод по правилам -o tsv настоящего CLI (плоский список — значение
# на строку, список списков — строки через табуляцию, null — пусто). gh — заглушка с ответами
# в формате настоящего gh api --jq (сверено с GitHub в отчёте). Записи только журналируются.
# Проверки передаются в eval строками в одинарных кавычках: SC2016 и SC2034 здесь ложные.
# shellcheck disable=SC2016,SC2034
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="${SETUP_SCRIPT:-$HERE/../setup-github-deploy.sh}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/imbc-setup-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
export SUB='11111111-2222-3333-4444-555555555555'
export TEN='99999999-8888-7777-6666-555555555555'
export VM_ID="/subscriptions/$SUB/resourceGroups/imbc-dev-rg/providers/Microsoft.Compute/virtualMachines/imbc-dev"
export RG_ID="/subscriptions/$SUB/resourceGroups/imbc-dev-rg"
export ROLE_ID="/subscriptions/$SUB/providers/Microsoft.Authorization/roleDefinitions/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
export CID='c0ffee00-0000-0000-0000-0000000000c1'
export PID='decade00-0000-0000-0000-0000000000b2'
NEW_CID='c1c1c1c1-0000-0000-0000-000000000001'
NEW_PID='b2b2b2b2-0000-0000-0000-000000000002'
SUBJECT='repo:Batrbekk@31662578/imbc-platform@1452122366:environment:dev'
NAME='Azure subscription 1'
PASSED=0
FAILED=0

pass() { PASSED=$((PASSED + 1)); printf 'ok   - %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf 'FAIL - %s\n' "$1"; printf '%s\n' "$OUT" | tail -n 4 | sed 's/^/    /'; }
check() { local name="$1"; shift; if "$@"; then pass "$name"; else fail "$name"; fi; }

mkdir -p "$WORK/bin"
printf '#!/usr/bin/env bash\nexec python3 %q "$@"\n' "$HERE/fake_az.py" > "$WORK/bin/az"
cat > "$WORK/bin/gh" <<'STUB'
#!/usr/bin/env bash
args="$*"
repo='repos/Batrbekk/imbc-platform'
record() { printf 'gh %s\n' "$args" >> "$FAKE/writes.log"; }
case "$args" in
  'auth status') ;;
  "api $repo --jq "*) echo 'Batrbekk/imbc-platform public true' ;;
  "api $repo/actions/oidc/customization/sub --jq "*) printf 'true\ttrue\trepo:Batrbekk@31662578/imbc-platform@1452122366\n' ;;
  "api $repo/environments/dev --jq "*)
    if [[ -f "$FAKE/env" ]]; then echo 'false true'
    else echo '{"message":"Not Found","status":"404"}'; echo 'gh: Not Found (HTTP 404)' >&2; exit 1; fi ;;
  "api $repo/environments/dev/deployment-branch-policies --jq "*) if [[ -f "$FAKE/env" ]]; then echo '66364063 branch main'; fi ;;
  "api $repo/environments/dev/variables --jq "*) if [[ -f "$FAKE/vars" ]]; then cat "$FAKE/vars"; fi ;;
  "api -X PUT $repo/environments/dev "*) record; cat >/dev/null; touch "$FAKE/env" ;;
  "api -X DELETE $repo/environments/dev") record; rm -f "$FAKE/env" "$FAKE/vars" ;;
  'api -X '*) record ;;
  'variable set '*) record; printf '%s=%s\n' "$3" "${!#}" >> "$FAKE/vars" ;;
  *) echo "fake gh: unexpected call: $args" >&2; exit 3 ;;
esac
STUB
chmod 0755 "$WORK/bin/az" "$WORK/bin/gh"

new_state() {
  FAKE="$(mktemp -d "$WORK/state.XXXXXX")"
  export FAKE
  : > "$FAKE/writes.log"
  python3 - "$FAKE/state.json" <<'PY'
import json, os, sys
json.dump({'account': {'id': os.environ['SUB'], 'tenantId': os.environ['TEN'], 'name': 'Azure subscription 1'},
           'vm': {'id': os.environ['VM_ID']}, 'identities': [], 'fics': [], 'roles': [], 'assignments': []},
          open(sys.argv[1], 'w'), indent=2)
PY
}
# Изменение состояния: Python-код над словарём s; константы — из окружения.
mutate() {
  python3 - "$FAKE/state.json" "$1" <<'PY'
import json, os, sys
path, code = sys.argv[1:3]
s = json.load(open(path))
exec(code, {'s': s, 'env': os.environ})
json.dump(s, open(path, 'w'), indent=2)
PY
}
add_identity() { mutate "s['identities'].append({'name': 'imbc-dev-github-deploy', 'clientId': env['CID'], 'principalId': env['PID']})"; }
add_fic() { SUBJ="$1" mutate "s['fics'].append({'name': 'github-environment-dev', 'issuer': 'https://token.actions.githubusercontent.com', 'subject': env['SUBJ'], 'audiences': ['api://AzureADTokenExchange']})"; }
add_role() {
  SCOPE="${1:-$RG_ID}" mutate "s['roles'].append({'id': env['ROLE_ID'], 'roleName': 'IMBC dev deploy', 'roleType': 'CustomRole', 'assignableScopes': [env['SCOPE']], 'permissions': [{'actions': ['Microsoft.Compute/virtualMachines/read', 'Microsoft.Compute/virtualMachines/instanceView/read', 'Microsoft.Compute/virtualMachines/runCommand/action'], 'notActions': [], 'dataActions': []}]})"
}
add_assignment() {
  ROLE="$1" SCOPE="$2" RNAME="$3" mutate "s['assignments'].append({'id': env['SCOPE'] + '/providers/Microsoft.Authorization/roleAssignments/' + str(len(s['assignments'])), 'principalId': env['PID'], 'roleDefinitionId': env['ROLE'], 'scope': env['SCOPE'], 'roleDefinitionName': env['RNAME']})"
}
run_setup() {
  set +e
  OUT="$(env -u IMBC_SETUP_CONFIRM -u IMBC_SETUP_SUBSCRIPTION_NAME PATH="$WORK/bin:$PATH" \
    FAKE_FAIL_COMMAND="${FAKE_FAIL_COMMAND:-}" FAKE_ASSIGN="${FAKE_ASSIGN:-ok}" bash "$SCRIPT" "$@" 2>&1)"
  RC=$?
  set -e
}
in_out() { grep -qF -- "$1" <<< "$OUT"; }
no_writes() { [[ ! -s "$FAKE/writes.log" ]]; }
nth_write() { sed -n "${1}p" "$FAKE/writes.log"; }
writes_count() { grep -c '' "$FAKE/writes.log" || true; }
wrote() { grep -qF -- "$1" "$FAKE/writes.log"; }
fic_subject() { python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['fics'][0]['subject'])" "$FAKE/state.json"; }

echo '# Ошибка az не выглядит как «ресурса нет»'
new_state
FAKE_FAIL_COMMAND='identity list' run_setup plan
check 'сбой az identity list → отказ, а не «будет создана»' eval '[[ $RC -ne 0 ]] && in_out "Azure CLI (identity list)" && ! in_out "будет создана в" && no_writes'

echo '# Подтверждение и имя подписки'
new_state
run_setup plan
check 'plan: только чтение, подписка из ID VM, требование --subscription-name' eval '[[ $RC -eq 0 ]] && no_writes && in_out "«${NAME}» (${SUB} — из ID VM)" && in_out "--subscription-name"'
run_setup apply
check 'apply без --yes → остановка без записей' eval '[[ $RC -ne 0 ]] && no_writes && in_out "Остановлено без изменений"'
run_setup apply --yes
check 'apply --yes без имени подписки → остановка без записей' eval '[[ $RC -ne 0 ]] && no_writes && in_out "укажите подписку"'
run_setup apply --yes --subscription-name 'Other subscription'
check 'apply с чужим именем подписки → остановка без записей' eval '[[ $RC -ne 0 ]] && no_writes && in_out "указана подписка «Other subscription»"'
run_setup destroy --yes
check 'destroy --yes без имени подписки → остановка без записей' eval '[[ $RC -ne 0 ]] && no_writes'

echo '# Идентичность есть (оба id) — регрессия чтения tsv'
new_state
add_identity
run_setup plan
check 'plan: идентичность показана как существующая' eval '[[ $RC -eq 0 ]] && in_out "Идентичность imbc-dev-github-deploy: есть (clientId ${CID})" && ! in_out "будет создана в"'
touch "$FAKE/env"
run_setup apply --yes --subscription-name "$NAME"
check 'apply не создаёт идентичность повторно и назначает роль её principalId' eval '[[ $RC -eq 0 ]] && ! wrote "az identity create" && wrote "--assignee-object-id ${PID}" && grep -qx "AZURE_CLIENT_ID=${CID}" "$FAKE/vars"'

echo '# apply с нуля: порядок, оба id новой идентичности, итоговая проверка'
new_state
run_setup apply --yes --subscription-name "$NAME"
check 'apply завершён' eval '[[ $RC -eq 0 ]] && in_out "Готово: конвейер настроен."'
check 'первая запись — окружение GitHub, до доверия Azure' eval '[[ "$(nth_write 1)" == "gh api -X PUT repos/Batrbekk/imbc-platform/environments/dev"* && "$(nth_write 2)" == "az identity create"* ]]'
check 'далее federated credential, роль, назначение, переменные' eval '[[ "$(nth_write 3)" == "az identity federated-credential create"* && "$(nth_write 4)" == "az role definition create"* && "$(nth_write 5)" == "az role assignment create"* && "$(nth_write 6)" == "gh variable set AZURE_CLIENT_ID"* ]]'
check 'созданная идентичность: прочитаны clientId и principalId' eval 'wrote "--assignee-object-id ${NEW_PID}" && grep -qx "AZURE_CLIENT_ID=${NEW_CID}" "$FAKE/vars"'
check 'federated credential с вычисленным subject' eval '[[ "$(fic_subject)" == "$SUBJECT" ]]'

echo '# Federated credential: совпадает / другой subject'
new_state
add_identity
add_fic "$SUBJECT"
run_setup plan
check 'plan: subject совпадает → состояние ok' eval '[[ $RC -eq 0 ]] && in_out "Federated credential: есть, subject совпадает"'
touch "$FAKE/env"
run_setup apply --yes --subscription-name "$NAME"
check 'apply не пересоздаёт совпадающий federated credential' eval '[[ $RC -eq 0 ]] && ! wrote "federated-credential create"'
new_state
add_identity
add_fic 'repo:Batrbekk/imbc-platform:environment:dev'
run_setup plan
check 'plan: другой subject → состояние differs' eval '[[ $RC -eq 0 ]] && in_out "subject отличается"'
touch "$FAKE/env"
run_setup apply --yes --subscription-name "$NAME"
check 'apply заменяет subject вычисленным' eval '[[ $RC -eq 0 ]] && wrote "federated-credential create" && [[ "$(fic_subject)" == "$SUBJECT" ]]'

echo '# Сходимость из реального частичного состояния: окружение и идентичность есть, остального нет'
new_state
touch "$FAKE/env"
add_identity
run_setup apply --yes --subscription-name "$NAME"
check 'apply: federated credential → роль → назначение → переменные, итоговая проверка пройдена' eval '[[ $RC -eq 0 && $(writes_count) -eq 6 && "$(nth_write 1)" == "az identity federated-credential create"* && "$(nth_write 2)" == "az role definition create"* && "$(nth_write 3)" == "az role assignment create"* && "$(nth_write 4)" == "gh variable set AZURE_CLIENT_ID"* && "$(nth_write 5)" == "gh variable set AZURE_TENANT_ID"* && "$(nth_write 6)" == "gh variable set AZURE_SUBSCRIPTION_ID"* ]] && in_out "Готово: конвейер настроен."'
run_setup plan
check 'после apply plan: всё есть, без проблем' eval '[[ $RC -eq 0 ]] && ! in_out "ПРОБЛЕМА" && ! in_out "нет →" && in_out "Назначение роли: есть на VM imbc-dev"'

echo '# Чужая роль с тем же именем'
new_state
add_role "/subscriptions/$SUB"
run_setup plan
check 'plan показывает проблему с ID роли' eval '[[ $RC -eq 0 ]] && in_out "ПРОБЛЕМА: ${ROLE_ID}"'
run_setup apply --yes --subscription-name "$NAME"
check 'apply → отказ до любых записей, с ID роли' eval '[[ $RC -ne 0 ]] && no_writes && in_out "$ROLE_ID"'
add_identity
add_fic "$SUBJECT"
run_setup destroy --yes --subscription-name "$NAME"
check 'destroy → отказ до любых записей, с ID роли' eval '[[ $RC -ne 0 ]] && no_writes && in_out "$ROLE_ID"'

echo '# Посторонние назначения идентичности'
new_state
add_role
add_identity
add_fic "$SUBJECT"
add_assignment "$ROLE_ID" "$VM_ID" 'IMBC dev deploy'
add_assignment "/subscriptions/$SUB/providers/Microsoft.Authorization/roleDefinitions/8e3af657-a8ff-443c-a75c-2fe8c4bcb635" "/subscriptions/$SUB" 'Owner'
run_setup plan
check 'plan показывает постороннее назначение как проблему' eval '[[ $RC -eq 0 ]] && in_out "ПРОБЛЕМА: допустимо только назначение роли на VM" && in_out "Owner"'
run_setup apply --yes --subscription-name "$NAME"
check 'apply → отказ до любых записей' eval '[[ $RC -ne 0 ]] && no_writes && in_out "назначения кроме роли на VM"'

echo '# RoleAssignmentExists — успех'
new_state
add_role
add_identity
add_fic "$SUBJECT"
touch "$FAKE/env"
FAKE_ASSIGN=exists run_setup apply --yes --subscription-name "$NAME"
check 'назначение «уже существует» → без повторов, apply завершён' eval '[[ $RC -eq 0 ]] && ! in_out "повтор через" && ! in_out "Не удалось назначить" && in_out "Готово: конвейер настроен."'

echo '# destroy: обратный порядок'
new_state
add_role
add_identity
add_fic "$SUBJECT"
touch "$FAKE/env"
add_assignment "$ROLE_ID" "$VM_ID" 'IMBC dev deploy'
run_setup destroy --yes --subscription-name "$NAME"
check 'destroy: назначение → federated credential → идентичность → роль по ID → окружение' eval '[[ $RC -eq 0 && "$(nth_write 1)" == "az role assignment delete"* && "$(nth_write 2)" == "az identity federated-credential delete"* && "$(nth_write 3)" == "az identity delete"* && "$(nth_write 4)" == "az rest --method delete --url https://management.azure.com${ROLE_ID}?"* && "$(nth_write 5)" == "gh api -X DELETE repos/Batrbekk/imbc-platform/environments/dev" ]]'

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[[ "$FAILED" -eq 0 ]]
