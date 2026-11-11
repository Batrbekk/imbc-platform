#!/usr/bin/env bash
# Самопроверка infrastructure/azure/setup-github-deploy.sh без Azure и GitHub.
#   bash infrastructure/azure/test/setup-github-deploy.test.sh
# az и gh заменены заглушками в PATH: чтение отвечает из файлов состояния, каждая запись
# (create/update/delete/rest, gh api -X, gh variable set) только записывается в writes.log.
# Проверяется: ошибка az не выглядит как «ресурса нет», порядок apply и destroy, имя подписки,
# чужая роль, посторонние назначения, RoleAssignmentExists как успех.
# Проверки передаются в eval строками в одинарных кавычках: SC2016 и SC2034 здесь ложные.
# shellcheck disable=SC2016,SC2034
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/../setup-github-deploy.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/imbc-setup-test.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT
SUB='11111111-2222-3333-4444-555555555555'
VM_ID="/subscriptions/$SUB/resourceGroups/imbc-dev-rg/providers/Microsoft.Compute/virtualMachines/imbc-dev"
RG_ID="/subscriptions/$SUB/resourceGroups/imbc-dev-rg"
ROLE_ID="/subscriptions/$SUB/providers/Microsoft.Authorization/roleDefinitions/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
ACTIONS='Microsoft.Compute/virtualMachines/instanceView/read Microsoft.Compute/virtualMachines/read Microsoft.Compute/virtualMachines/runCommand/action'
SUBJECT='repo:Batrbekk@31662578/imbc-platform@1452122366:environment:dev'
NAME='Azure subscription 1'
PASSED=0
FAILED=0

pass() { PASSED=$((PASSED + 1)); printf 'ok   - %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf 'FAIL - %s\n' "$1"; }
check() { local name="$1"; shift; if "$@"; then pass "$name"; else fail "$name"; printf '%s\n' "$OUT" | tail -n 5 | sed 's/^/    /'; fi; }

mkdir -p "$WORK/bin"
cat > "$WORK/bin/az" <<'STUB'
#!/usr/bin/env bash
args="$*"
record() { printf 'az %s\n' "$args" >> "$FAKE/writes.log"; }
case "$args" in
  'account show --query id -o none') ;;
  'account show --query id -o tsv') echo "$FAKE_SUB" ;;
  'account show --query tenantId -o tsv') echo 'tenant-0' ;;
  'account show --query name -o tsv') echo 'Azure subscription 1' ;;
  'vm show '*) echo "/subscriptions/$FAKE_SUB/resourceGroups/imbc-dev-rg/providers/Microsoft.Compute/virtualMachines/imbc-dev" ;;
  'identity list '*)
    if [[ -n "${FAKE_IDENTITY_FAIL:-}" ]]; then echo 'ERROR: (AuthorizationFailed) The client does not have authorization' >&2; exit 1; fi
    if [[ -f "$FAKE/identity" ]]; then cat "$FAKE/identity"; fi ;;
  'identity show '*) cat "$FAKE/identity" ;;
  'identity federated-credential list '*"[?name=='github-environment-dev']"*) if [[ -f "$FAKE/fic" ]]; then cat "$FAKE/fic"; fi ;;
  'identity federated-credential list '*"[?name!="*) ;;
  'identity federated-credential list '*) if [[ -f "$FAKE/fic" ]]; then echo github-environment-dev; fi ;;
  'role definition list '*"[].["*) if [[ -f "$FAKE/role" ]]; then cat "$FAKE/role"; fi ;;
  'role definition list '*) if [[ -f "$FAKE/role" ]]; then cut -f1 "$FAKE/role"; fi ;;
  'role assignment list --role '*) echo 0 ;;
  'role assignment list --assignee '*) if [[ -f "$FAKE/assignments" ]]; then cat "$FAKE/assignments"; fi ;;
  'role assignment create '*)
    record
    printf '%s\t%s\t%s\t%s\n' "$VM_ID_FAKE/providers/Microsoft.Authorization/roleAssignments/x1" "$ROLE_ID_FAKE" "$VM_ID_FAKE" 'IMBC dev deploy' > "$FAKE/assignments"
    if [[ "${FAKE_ASSIGN:-ok}" == exists ]]; then echo 'ERROR: (RoleAssignmentExists) The role assignment already exists.' >&2; exit 1; fi ;;
  'identity create '*) record; printf 'client-1\tprincipal-1\n' > "$FAKE/identity" ;;
  'identity federated-credential create '*)
    record
    subject=''; prev=''
    for a in "$@"; do [[ "$prev" != --subject ]] || subject="$a"; prev="$a"; done
    printf '%s\t%s\t%s\n' 'https://token.actions.githubusercontent.com' "$subject" 'api://AzureADTokenExchange' > "$FAKE/fic" ;;
  'role definition create '*) record; printf '%s\t%s\t%s\t%s\t1\t0\t0\n' "$ROLE_ID_FAKE" CustomRole "$ACTIONS_FAKE" "$RG_ID_FAKE" > "$FAKE/role" ;;
  *' create '*|*' update '*|*' delete '*|'rest '*) record ;;
  *) echo "fake az: unexpected call: $args" >&2; exit 3 ;;
esac
STUB
cat > "$WORK/bin/gh" <<'STUB'
#!/usr/bin/env bash
args="$*"
repo='repos/Batrbekk/imbc-platform'
record() { printf 'gh %s\n' "$args" >> "$FAKE/writes.log"; }
case "$args" in
  'auth status') ;;
  "api $repo --jq "*) echo 'Batrbekk/imbc-platform public true' ;;
  "api $repo/actions/oidc/customization/sub --jq "*) printf 'true\ttrue\trepo:Batrbekk@31662578/imbc-platform@1452122366\n' ;;
  "api $repo/environments/dev --jq "*) if [[ -f "$FAKE/env" ]]; then echo 'false true'; else echo 'gh: Not Found (HTTP 404)' >&2; exit 1; fi ;;
  "api $repo/environments/dev/deployment-branch-policies --jq "*) if [[ -f "$FAKE/env" ]]; then echo '7 branch main'; fi ;;
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
  : > "$FAKE/writes.log"
}
ours_role() { printf '%s\t%s\t%s\t%s\t1\t0\t0\n' "$ROLE_ID" CustomRole "$ACTIONS" "${1:-$RG_ID}" > "$FAKE/role"; }
existing_identity() {
  printf 'client-1\tprincipal-1\n' > "$FAKE/identity"
  printf '%s\t%s\t%s\n' 'https://token.actions.githubusercontent.com' "$SUBJECT" 'api://AzureADTokenExchange' > "$FAKE/fic"
}
run_setup() {
  set +e
  OUT="$(env -u IMBC_SETUP_CONFIRM -u IMBC_SETUP_SUBSCRIPTION_NAME PATH="$WORK/bin:$PATH" FAKE="$FAKE" FAKE_SUB="$SUB" \
    VM_ID_FAKE="$VM_ID" RG_ID_FAKE="$RG_ID" ROLE_ID_FAKE="$ROLE_ID" ACTIONS_FAKE="$ACTIONS" \
    FAKE_IDENTITY_FAIL="${FAKE_IDENTITY_FAIL:-}" FAKE_ASSIGN="${FAKE_ASSIGN:-ok}" bash "$SCRIPT" "$@" 2>&1)"
  RC=$?
  set -e
}
in_out() { grep -qF -- "$1" <<< "$OUT"; }
no_writes() { [[ ! -s "$FAKE/writes.log" ]]; }
nth_write() { sed -n "${1}p" "$FAKE/writes.log"; }

echo '# Ошибка az не выглядит как «ресурса нет»'
new_state
FAKE_IDENTITY_FAIL=1 run_setup plan
check 'сбой az identity list → отказ, а не «будет создана»' eval '[[ $RC -ne 0 ]] && in_out "Azure CLI (identity list)" && ! in_out "будет создана в" && no_writes'

echo '# Подтверждение и имя подписки'
new_state
run_setup plan
check 'plan: только чтение, подписка из ID VM, требование --subscription-name' eval '[[ $RC -eq 0 ]] && no_writes && in_out "«${NAME}» ($SUB — из ID VM)" && in_out "--subscription-name"'
run_setup apply
check 'apply без --yes → остановка без записей' eval '[[ $RC -ne 0 ]] && no_writes && in_out "Остановлено без изменений"'
run_setup apply --yes
check 'apply --yes без имени подписки → остановка без записей' eval '[[ $RC -ne 0 ]] && no_writes && in_out "укажите подписку"'
run_setup apply --yes --subscription-name 'Other subscription'
check 'apply с чужим именем подписки → остановка без записей' eval '[[ $RC -ne 0 ]] && no_writes && in_out "указана подписка «Other subscription»"'
run_setup destroy --yes
check 'destroy --yes без имени подписки → остановка без записей' eval '[[ $RC -ne 0 ]] && no_writes'

echo '# apply с нуля: порядок и итоговая проверка'
new_state
run_setup apply --yes --subscription-name "$NAME"
check 'apply завершён' eval '[[ $RC -eq 0 ]] && in_out "Готово: конвейер настроен."'
check 'первая запись — окружение GitHub, до доверия Azure' eval '[[ "$(nth_write 1)" == "gh api -X PUT repos/Batrbekk/imbc-platform/environments/dev"* && "$(nth_write 2)" == "az identity create"* ]]'
check 'далее federated credential, роль, назначение, переменные' eval '[[ "$(nth_write 3)" == "az identity federated-credential create"* && "$(nth_write 4)" == "az role definition create"* && "$(nth_write 5)" == "az role assignment create"* && "$(nth_write 6)" == "gh variable set AZURE_CLIENT_ID"* ]]'
check 'federated credential с вычисленным subject' eval '[[ "$(cut -f2 "$FAKE/fic")" == "$SUBJECT" ]]'

echo '# Чужая роль с тем же именем'
new_state
ours_role "/subscriptions/$SUB"
run_setup plan
check 'plan показывает проблему с ID роли' eval '[[ $RC -eq 0 ]] && in_out "ПРОБЛЕМА: $ROLE_ID"'
run_setup apply --yes --subscription-name "$NAME"
check 'apply → отказ до любых записей, с ID роли' eval '[[ $RC -ne 0 ]] && no_writes && in_out "$ROLE_ID"'
existing_identity
run_setup destroy --yes --subscription-name "$NAME"
check 'destroy → отказ до любых записей, с ID роли' eval '[[ $RC -ne 0 ]] && no_writes && in_out "$ROLE_ID"'

echo '# Посторонние назначения идентичности'
new_state
ours_role
existing_identity
printf '%s\t%s\t%s\t%s\n' "$VM_ID/providers/Microsoft.Authorization/roleAssignments/x1" "$ROLE_ID" "$VM_ID" 'IMBC dev deploy' > "$FAKE/assignments"
printf '%s\t%s\t%s\t%s\n' "/subscriptions/$SUB/providers/Microsoft.Authorization/roleAssignments/x2" "/subscriptions/$SUB/providers/Microsoft.Authorization/roleDefinitions/owner" "/subscriptions/$SUB" 'Owner' >> "$FAKE/assignments"
run_setup plan
check 'plan показывает постороннее назначение как проблему' eval '[[ $RC -eq 0 ]] && in_out "ПРОБЛЕМА: допустимо только назначение роли на VM" && in_out "Owner"'
run_setup apply --yes --subscription-name "$NAME"
check 'apply → отказ до любых записей' eval '[[ $RC -ne 0 ]] && no_writes && in_out "назначения кроме роли на VM"'

echo '# RoleAssignmentExists — успех'
new_state
ours_role
existing_identity
FAKE_ASSIGN=exists run_setup apply --yes --subscription-name "$NAME"
check 'назначение «уже существует» → без повторов, apply завершён' eval '[[ $RC -eq 0 ]] && ! in_out "повтор через" && ! in_out "Не удалось назначить" && in_out "Готово: конвейер настроен."'

echo '# destroy: обратный порядок'
new_state
ours_role
existing_identity
touch "$FAKE/env"
printf '%s\t%s\t%s\t%s\n' "$VM_ID/providers/Microsoft.Authorization/roleAssignments/x1" "$ROLE_ID" "$VM_ID" 'IMBC dev deploy' > "$FAKE/assignments"
run_setup destroy --yes --subscription-name "$NAME"
check 'destroy: назначение → federated credential → идентичность → роль по ID → окружение' eval '[[ $RC -eq 0 && "$(nth_write 1)" == "az role assignment delete"* && "$(nth_write 2)" == "az identity federated-credential delete"* && "$(nth_write 3)" == "az identity delete"* && "$(nth_write 4)" == "az rest --method delete --url https://management.azure.com$ROLE_ID?"* && "$(nth_write 5)" == "gh api -X DELETE repos/Batrbekk/imbc-platform/environments/dev" ]]'

printf '\n%d passed, %d failed\n' "$PASSED" "$FAILED"
[[ "$FAILED" -eq 0 ]]
