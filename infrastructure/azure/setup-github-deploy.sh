#!/usr/bin/env bash
# Настройка конвейера GitHub Actions → dev-VM Azure без долгоживущих секретов (OIDC).
#   ./infrastructure/azure/setup-github-deploy.sh plan           что есть, что и в каком порядке будет сделано (только чтение; по умолчанию)
#   ./infrastructure/azure/setup-github-deploy.sh apply --yes --subscription-name "<имя подписки>"
#       создать или исправить недостающее; повторный запуск безопасен
#   ./infrastructure/azure/setup-github-deploy.sh destroy --yes --subscription-name "<имя подписки>"
#       удалить всё, что создаёт apply
# Без --yes (или IMBC_SETUP_CONFIRM=yes) apply и destroy только показывают цель и останавливаются;
# без имени текущей подписки az (--subscription-name или IMBC_SETUP_SUBSCRIPTION_NAME) — тоже.
#
# apply: сначала окружение GitHub dev с единственной политикой ветки main (и проверка), затем
# управляемая идентичность imbc-dev-github-deploy в imbc-dev-rg, один federated credential,
# роль «IMBC dev deploy» (назначаемая только в imbc-dev-rg) из трёх действий и её назначение на
# VM imbc-dev, переменные окружения AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID
# (идентификаторы, не секреты); в конце состояние перечитывается и проверяется.
# Subject federated credential берётся из настроек OIDC репозитория (actions/oidc/customization/sub):
# <sub_claim_prefix>:environment:dev при use_immutable_subject, иначе repo:<владелец>/<репозиторий>:environment:dev.
# NSG, другие resource group и ресурсы подписки не меняются. Токены не выводятся.
#
# Нужны az (az login; Owner на imbc-dev-rg либо User Access Administrator вместе с Managed Identity
# Contributor) и gh (gh auth login; администратор репозитория). Параметры RG, VM, REPO, IDENTITY;
# любое отличие от значений по умолчанию — только с IMBC_SETUP_ALLOW_OTHER_TARGET=yes.
set -euo pipefail

EXPECTED_RG='imbc-dev-rg'
EXPECTED_VM='imbc-dev'
EXPECTED_REPO='Batrbekk/imbc-platform'
EXPECTED_IDENTITY='imbc-dev-github-deploy'
RG="${RG:-$EXPECTED_RG}"
VM="${VM:-$EXPECTED_VM}"
REPO="${REPO:-$EXPECTED_REPO}"
IDENTITY="${IDENTITY:-$EXPECTED_IDENTITY}"
GH_ENV='dev'
DEPLOY_BRANCH='main'
ROLE_NAME='IMBC dev deploy'
CREDENTIAL='github-environment-dev'
ISSUER='https://token.actions.githubusercontent.com'
AUDIENCE='api://AzureADTokenExchange'
ROLE_ACTIONS=(
  Microsoft.Compute/virtualMachines/read
  Microsoft.Compute/virtualMachines/instanceView/read
  Microsoft.Compute/virtualMachines/runCommand/action
)
SUBJECT=''
SUBJECT_SOURCE=''
LAST_ERROR=''
TMP_FILE=''
ERR_FILE="$(mktemp "${TMPDIR:-/tmp}/imbc-setup-err.XXXXXX")"

log() { printf '\n▶ %s\n' "$*"; }
die() { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }
item() { printf '  %s: %s\n' "$1" "$2"; }
cleanup() { rm -f "$ERR_FILE" ${TMP_FILE:+"$TMP_FILE"}; }
trap cleanup EXIT

validate_target() {
  [[ "$RG" =~ ^[A-Za-z0-9._()-]{1,90}$ ]] || die 'Недопустимое имя resource group'
  [[ "$VM" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]] || die 'Недопустимое имя VM'
  [[ "$REPO" =~ ^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$ ]] || die 'REPO должен иметь вид владелец/репозиторий'
  [[ "$IDENTITY" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$ ]] || die 'Недопустимое имя идентичности'
  if [[ "$RG" != "$EXPECTED_RG" || "$VM" != "$EXPECTED_VM" || "$REPO" != "$EXPECTED_REPO" || "$IDENTITY" != "$EXPECTED_IDENTITY" ]]; then
    [[ "${IMBC_SETUP_ALLOW_OTHER_TARGET:-}" == yes ]] \
      || die "Скрипт настраивает только $EXPECTED_RG / $EXPECTED_VM / $EXPECTED_IDENTITY и $EXPECTED_REPO; для другой цели задайте IMBC_SETUP_ALLOW_OTHER_TARGET=yes"
    log "Внимание: нестандартная цель $RG / $VM / $IDENTITY / $REPO (IMBC_SETUP_ALLOW_OTHER_TARGET=yes)"
  fi
}

ensure_tools() {
  command -v az >/dev/null || die 'Azure CLI не найден'
  command -v gh >/dev/null || die 'GitHub CLI не найден'
  command -v python3 >/dev/null || die 'Python 3 не найден'
  az account show --query id -o none 2>/dev/null || die 'Сначала выполните az login'
  gh auth status >/dev/null 2>&1 || die 'Сначала выполните gh auth login'
}

expected_actions() { printf '%s\n' "${ROLE_ACTIONS[@]}" | LC_ALL=C sort | paste -sd ' ' -; }
lower() { tr '[:upper:]' '[:lower:]'; }

# GET с выражением jq. Пусто — только если ресурса нет (HTTP 404); любая другая ошибка
# (сеть, права) останавливает скрипт, чтобы plan не показал неверную картину.
gh_read() {
  local out status=0
  out="$(gh api "$1" --jq "$2" 2>"$ERR_FILE")" || status=$?
  if [[ $status -eq 0 ]]; then
    printf '%s\n' "$out"
  elif ! grep -q 'HTTP 404' "$ERR_FILE"; then
    die "GitHub API $1: $(tail -n 1 "$ERR_FILE")"
  fi
}

# Чтение через az с проверкой кода выхода: ошибка Azure CLI не выглядит как «ресурса нет».
# Вызывать как x="$(az_read …)" || exit 1.
az_read() {
  local out status=0
  out="$(az "$@" 2>"$ERR_FILE")" || status=$?
  [[ $status -eq 0 ]] || die "Azure CLI ($1 $2): $(tail -n 1 "$ERR_FILE")"
  printf '%s\n' "$out"
}

same_id() { [[ "$(lower <<< "$1")" == "$(lower <<< "$2")" ]]; }

# Subject токена OIDC, который GitHub действительно выдаёт заданию окружения dev. Не угадывается.
resolve_subject() {
  local settings use_default immutable prefix
  settings="$(gh_read "repos/$REPO/actions/oidc/customization/sub" \
    '[(.use_default | tostring), (.use_immutable_subject | tostring), (.sub_claim_prefix // "")] | join("\t")')"
  [[ -n "$settings" ]] || die "Не удалось прочитать настройки subject OIDC репозитория (actions/oidc/customization/sub); subject не угадывается"
  IFS=$'\t' read -r use_default immutable prefix <<< "$settings"
  [[ "$use_default" == true ]] \
    || die 'Репозиторий использует собственный шаблон subject OIDC (use_default=false): скрипт его не поддерживает'
  if [[ "$immutable" == true ]]; then
    [[ "$prefix" =~ ^repo:[A-Za-z0-9-]+@[0-9]+/[A-Za-z0-9._-]+@[0-9]+$ ]] \
      || die 'Неожиданный формат sub_claim_prefix в настройках OIDC репозитория'
    SUBJECT="$prefix:environment:$GH_ENV"
    SUBJECT_SOURCE='sub_claim_prefix репозитория (use_immutable_subject=true)'
  else
    SUBJECT="repo:$REPO:environment:$GH_ENV"
    SUBJECT_SOURCE='формат по умолчанию (use_immutable_subject не включён)'
  fi
}

# Только чтение: az … show/list и gh api GET.
collect() {
  local fic role identity assignments line id definition scope
  SUBSCRIPTION_ID="$(az_read account show --query id -o tsv)" || exit 1
  TENANT_ID="$(az_read account show --query tenantId -o tsv)" || exit 1
  SUBSCRIPTION_NAME="$(az_read account show --query name -o tsv)" || exit 1
  VM_ID="$(az vm show -g "$RG" -n "$VM" --query id -o tsv 2>"$ERR_FILE")" \
    || die "VM $VM не найдена в $RG текущей подписки «${SUBSCRIPTION_NAME}»: $(tail -n 1 "$ERR_FILE")"
  # Подписка берётся из ID найденной VM; он должен совпасть с текущим контекстом az, RG и VM.
  [[ "$VM_ID" =~ ^/subscriptions/([0-9a-fA-F-]{36})/resourceGroups/([^/]+)/providers/Microsoft\.Compute/virtualMachines/([^/]+)$ ]] \
    || die 'Неожиданный формат ID VM'
  VM_SUBSCRIPTION="${BASH_REMATCH[1]}"
  if ! { same_id "$VM_SUBSCRIPTION" "$SUBSCRIPTION_ID" && same_id "${BASH_REMATCH[2]}" "$RG" && same_id "${BASH_REMATCH[3]}" "$VM"; }; then
    die 'ID VM не соответствует текущей подписке, resource group или имени VM'
  fi
  RG_ID="/subscriptions/$VM_SUBSCRIPTION/resourceGroups/$RG"
  REPO_INFO="$(gh_read "repos/$REPO" '.full_name + " " + .visibility + " " + (.permissions.admin | tostring)')"
  [[ -n "$REPO_INFO" ]] || die "Репозиторий $REPO не найден"
  resolve_subject

  identity="$(az_read identity list -g "$RG" --query "[?name=='$IDENTITY'] | [0].[clientId, principalId]" -o tsv)" || exit 1
  IFS=$'\t' read -r CLIENT_ID PRINCIPAL_ID <<< "$identity"

  FIC_STATE='absent'; EXTRA_FICS=''
  if [[ -n "$PRINCIPAL_ID" ]]; then
    fic="$(az_read identity federated-credential list --identity-name "$IDENTITY" -g "$RG" \
      --query "[?name=='$CREDENTIAL'] | [0].[issuer, subject, join(',', audiences)]" -o tsv)" || exit 1
    if [[ -n "$fic" ]]; then
      FIC_STATE='differs'
      [[ "$fic" != "$ISSUER"$'\t'"$SUBJECT"$'\t'"$AUDIENCE" ]] || FIC_STATE='ok'
    fi
    EXTRA_FICS="$(az_read identity federated-credential list --identity-name "$IDENTITY" -g "$RG" \
      --query "[?name!='$CREDENTIAL'].name" -o tsv)" || exit 1
    EXTRA_FICS="$(paste -sd ' ' - <<< "$EXTRA_FICS")"
  fi

  # ROLE_OURS: собственная роль, назначаемая ровно в resource group этого стенда. Только такую
  # роль apply обновляет, а destroy удаляет; иначе — отказ с ID роли.
  ROLE_ID=''; ROLE_STATE='absent'; ROLE_OURS=false; ROLE_SCOPES=''
  role="$(az_read role definition list --name "$ROLE_NAME" --scope "$RG_ID" --custom-role-only true \
    --query "[].[id, roleType, join(' ', sort(permissions[0].actions)), join(' ', assignableScopes), length(permissions), length(permissions[0].notActions), length(permissions[0].dataActions)]" -o tsv)" || exit 1
  if [[ -n "$role" ]]; then
    [[ "$role" != *$'\n'* ]] || die "Найдено несколько ролей «${ROLE_NAME}»; ничего не изменено"
    local role_type actions permission_sets not_actions data_actions
    IFS=$'\t' read -r ROLE_ID role_type actions ROLE_SCOPES permission_sets not_actions data_actions <<< "$role"
    if [[ "$role_type" == CustomRole ]] && same_id "$ROLE_SCOPES" "$RG_ID"; then ROLE_OURS=true; fi
    if [[ "$ROLE_OURS" == true && "$actions" == "$(expected_actions)" \
        && "$permission_sets" == 1 && "$not_actions" == 0 && "$data_actions" == 0 ]]; then
      ROLE_STATE='ok'
    else
      ROLE_STATE='differs'
    fi
  fi

  # У идентичности должно быть ровно одно назначение — эта роль на VM; любые другие — проблема.
  ASSIGNMENT_ID=''; OTHER_ASSIGNMENTS=''
  if [[ -n "$PRINCIPAL_ID" ]]; then
    assignments="$(az_read role assignment list --assignee "$PRINCIPAL_ID" --all \
      --query '[].[id, roleDefinitionId, scope, roleDefinitionName]' -o tsv)" || exit 1
    while IFS= read -r line; do
      [[ -n "$line" ]] || continue
      IFS=$'\t' read -r id definition scope _ <<< "$line"
      if [[ -z "$ASSIGNMENT_ID" && -n "$ROLE_ID" ]] && same_id "${definition##*/}" "${ROLE_ID##*/}" && same_id "$scope" "$VM_ID"; then
        ASSIGNMENT_ID="$id"
      else
        OTHER_ASSIGNMENTS+="$(cut -f3- <<< "$line" | tr '\t' ' ')"$'\n'
      fi
    done <<< "$assignments"
    OTHER_ASSIGNMENTS="${OTHER_ASSIGNMENTS%$'\n'}"
  fi

  read_environment
}

read_environment() {
  ENV_POLICY="$(gh_read "repos/$REPO/environments/$GH_ENV" \
    '[.deployment_branch_policy.protected_branches, .deployment_branch_policy.custom_branch_policies] | map(tostring) | join(" ")')"
  BRANCH_POLICIES=''; ENV_VARIABLES=''
  if [[ -n "$ENV_POLICY" ]]; then
    BRANCH_POLICIES="$(gh_read "repos/$REPO/environments/$GH_ENV/deployment-branch-policies" \
      '.branch_policies[] | "\(.id) \(.type // "branch") \(.name)"')"
    ENV_VARIABLES="$(gh_read "repos/$REPO/environments/$GH_ENV/variables" '.variables[] | "\(.name)=\(.value)"')"
  fi
}

# Ровно «custom branch policies» и единственная политика — ветка main.
environment_ok() {
  [[ "$ENV_POLICY" == 'false true' && "$BRANCH_POLICIES" =~ ^[0-9]+\ branch\ ${DEPLOY_BRANCH}$ ]]
}

variable_value() { sed -n "s/^$1=//p" <<< "$ENV_VARIABLES"; }

expected_variable() {
  case "$1" in
    AZURE_CLIENT_ID) printf '%s' "$CLIENT_ID" ;;
    AZURE_TENANT_ID) printf '%s' "$TENANT_ID" ;;
    AZURE_SUBSCRIPTION_ID) printf '%s' "$SUBSCRIPTION_ID" ;;
  esac
}

print_target() {
  log 'Цель'
  item 'Подписка' "«${SUBSCRIPTION_NAME}» ($VM_SUBSCRIPTION — из ID VM)"
  item 'Tenant' "$TENANT_ID"
  item 'Resource group' "$RG"
  item 'VM' "$VM_ID"
  item 'Репозиторий' "$REPO_INFO (видимость, права администратора)"
  item 'Subject OIDC' "$SUBJECT"
  item 'Источник subject' "$SUBJECT_SOURCE"
}

print_plan() {
  local expected value name
  print_target

  log "GitHub: окружение $GH_ENV"
  if [[ -z "$ENV_POLICY" ]]; then
    item "Окружение $GH_ENV" "нет → будет создано, развёртывание только из ветки $DEPLOY_BRANCH"
  elif environment_ok; then
    item "Окружение $GH_ENV" "есть, развёртывание только из ветки $DEPLOY_BRANCH"
  else
    item "Окружение $GH_ENV" "есть, политика веток отличается → только $DEPLOY_BRANCH"
  fi
  for name in AZURE_CLIENT_ID AZURE_TENANT_ID AZURE_SUBSCRIPTION_ID; do
    expected="$(expected_variable "$name")"
    expected="${expected:-<clientId новой идентичности>}"
    value="$(variable_value "$name")"
    if [[ -n "$value" && "$value" == "$expected" ]]; then item "Переменная $name" 'есть, совпадает'
    elif [[ -n "$value" ]]; then item "Переменная $name" "отличается → $expected"
    else item "Переменная $name" "нет → $expected"; fi
  done

  log 'Azure'
  if [[ -n "$PRINCIPAL_ID" ]]; then item "Идентичность $IDENTITY" "есть (clientId $CLIENT_ID)"
  else item "Идентичность $IDENTITY" "нет → будет создана в $RG"; fi
  case "$FIC_STATE" in
    ok) item 'Federated credential' "есть, subject совпадает" ;;
    differs) item 'Federated credential' 'subject отличается → будет заменён вычисленным' ;;
    *) item 'Federated credential' 'нет → будет создан с вычисленным subject' ;;
  esac
  [[ -z "$EXTRA_FICS" ]] || item 'Лишние federated credentials' "$EXTRA_FICS → будут удалены"
  case "$ROLE_STATE" in
    ok) item "Роль «${ROLE_NAME}»" 'есть, действия и область совпадают' ;;
    differs)
      if [[ "$ROLE_OURS" == true ]]; then
        item "Роль «${ROLE_NAME}»" "действия отличаются → будут обновлены: $(expected_actions)"
      else
        item "Роль «${ROLE_NAME}»" "ПРОБЛЕМА: $ROLE_ID — не собственная роль этого стенда (область: ${ROLE_SCOPES:-?}); apply и destroy её не тронут и остановятся"
      fi ;;
    *) item "Роль «${ROLE_NAME}»" "нет → будет создана: $(expected_actions); область $RG_ID" ;;
  esac
  if [[ -n "$ASSIGNMENT_ID" ]]; then item 'Назначение роли' "есть на VM $VM"
  else item 'Назначение роли' "нет → будет назначена на VM $VM"; fi
  [[ -z "$OTHER_ASSIGNMENTS" ]] || { item 'Другие назначения идентичности' 'ПРОБЛЕМА: допустимо только назначение роли на VM; apply остановится, удалите их вручную:'; printf '      %s\n' "${OTHER_ASSIGNMENTS//$'\n'/$'\n'      }"; }
}

print_order() {
  log 'Порядок apply'
  echo "  1. GitHub: окружение $GH_ENV, custom branch policies, единственная политика — ветка $DEPLOY_BRANCH; проверка"
  echo "  2. Azure: идентичность $IDENTITY в $RG"
  echo "  3. Azure: federated credential $CREDENTIAL с subject выше; удаление остальных"
  echo "  4. Azure: роль «${ROLE_NAME}» (назначаемая только в $RG)"
  echo "  5. Azure: назначение роли на VM $VM"
  echo "  6. GitHub: переменные AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_SUBSCRIPTION_ID окружения $GH_ENV"
  echo '  7. Повторное чтение состояния; отказ, если окружение, subject, роль или единственное назначение не совпадают'
  log 'Порядок destroy'
  echo "  1. Назначение роли на VM → 2. federated credentials и идентичность → 3. роль (по ID) → 4. окружение GitHub $GH_ENV"
}

require_confirmation() {
  if [[ "$CONFIRMED" != true ]]; then
    printf '\nОстановлено без изменений. Проверьте цель выше и запустите: %s %s --yes --subscription-name "<имя подписки>"\n' "$0" "$1"
    exit 1
  fi
  # Имя подписки называет оператор: защита от работы не в той подписке текущего az login.
  if [[ -z "$EXPECTED_SUBSCRIPTION_NAME" ]]; then
    printf '\nОстановлено без изменений: укажите подписку, в которой собираетесь работать: --subscription-name "<имя>" или IMBC_SETUP_SUBSCRIPTION_NAME (az сейчас в «%s»)\n' "$SUBSCRIPTION_NAME"
    exit 1
  fi
  if [[ "$EXPECTED_SUBSCRIPTION_NAME" != "$SUBSCRIPTION_NAME" ]]; then
    printf '\nОстановлено без изменений: указана подписка «%s», а az сейчас в «%s»\n' "$EXPECTED_SUBSCRIPTION_NAME" "$SUBSCRIPTION_NAME"
    exit 1
  fi
}

# До любых изменений: роль с этим именем, но не наша, не обновляется и не удаляется;
# apply не начинается, если у идентичности есть посторонние назначения.
require_role_ours() {
  [[ -z "$ROLE_ID" || "$ROLE_OURS" == true ]] \
    || die "Роль «${ROLE_NAME}» $ROLE_ID — не собственная роль этого стенда (назначаемая область: ${ROLE_SCOPES:-?}); ничего не изменено"
  [[ -z "$OTHER_ASSIGNMENTS" || "$MODE" == destroy ]] \
    || die "У идентичности $IDENTITY есть назначения кроме роли на VM; удалите их вручную, ничего не изменено"
}

write_role_definition() {
  TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/imbc-role.XXXXXX")"
  python3 - "$TMP_FILE" "$ROLE_NAME" "$RG_ID" "${ROLE_ACTIONS[@]}" <<'PY'
import json
import sys

path, name, scope, *actions = sys.argv[1:]
with open(path, 'w') as output:
    json.dump({
        'Name': name,
        'IsCustom': True,
        'Description': 'GitHub Actions deployment of the IMBC dev stand: read the VM and run the deployment script (run-command).',
        'Actions': actions,
        'NotActions': [],
        'DataActions': [],
        'NotDataActions': [],
        'AssignableScopes': [scope],
    }, output, indent=2)
PY
}

retry() {
  local attempt
  for attempt in $(seq 1 12); do
    if "$@"; then return 0; fi
    printf '  повтор через 10 с (%s/12): репликация Entra ID и Azure RBAC\n' "$attempt"
    sleep 10
  done
  return 1
}

assign_role() {
  if LAST_ERROR="$(az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
      --role "$ROLE_ID" --scope "$VM_ID" -o none 2>&1)"; then
    return 0
  fi
  # Назначение уже создано (например, прошлым запуском), но ещё не видно в списке — это успех.
  [[ "$LAST_ERROR" == *RoleAssignmentExists* || "$LAST_ERROR" == *'role assignment already exists'* ]]
}

role_visible() {
  ROLE_ID="$(az role definition list --name "$ROLE_NAME" --scope "$RG_ID" --custom-role-only true --query '[0].id' -o tsv 2>"$ERR_FILE")" \
    || { LAST_ERROR="$(tail -n 3 "$ERR_FILE")"; return 1; }
  [[ -n "$ROLE_ID" ]]
}

ensure_environment() {
  local id kind branch
  log "GitHub: окружение $GH_ENV, развёртывание только из $DEPLOY_BRANCH"
  gh api -X PUT "repos/$REPO/environments/$GH_ENV" --input - >/dev/null <<'JSON'
{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
JSON
  read_environment
  while read -r id kind branch; do
    [[ -n "$id" ]] || continue
    if [[ "$kind" != branch || "$branch" != "$DEPLOY_BRANCH" ]]; then
      [[ "$id" =~ ^[0-9]+$ ]] || die 'Неожиданный идентификатор политики веток'
      gh api -X DELETE "repos/$REPO/environments/$GH_ENV/deployment-branch-policies/$id" >/dev/null
    fi
  done <<< "$BRANCH_POLICIES"
  if ! grep -Eq "^[0-9]+ branch ${DEPLOY_BRANCH}$" <<< "$BRANCH_POLICIES"; then
    gh api -X POST "repos/$REPO/environments/$GH_ENV/deployment-branch-policies" -f name="$DEPLOY_BRANCH" -f type=branch >/dev/null
  fi
  read_environment
  environment_ok || die "Окружение $GH_ENV не приведено к «только ${DEPLOY_BRANCH}»; доверие Azure не создавалось"
  echo "  проверено: custom branch policies, единственная политика — ветка $DEPLOY_BRANCH"
}

apply() {
  local name value identity
  require_role_ours
  ensure_environment

  if [[ -z "$PRINCIPAL_ID" ]]; then
    log "Azure: идентичность $IDENTITY"
    az identity create -g "$RG" -n "$IDENTITY" --tags project=imbc env=dev purpose=github-deploy -o none
    identity="$(az_read identity show -g "$RG" -n "$IDENTITY" --query '[clientId, principalId]' -o tsv)" || exit 1
    IFS=$'\t' read -r CLIENT_ID PRINCIPAL_ID <<< "$identity"
    [[ -n "$PRINCIPAL_ID" ]] || die "Идентичность создана, но её principalId не прочитан"
  fi
  if [[ "$FIC_STATE" != ok ]]; then
    log "Azure: federated credential $CREDENTIAL"
    az identity federated-credential create --identity-name "$IDENTITY" -g "$RG" -n "$CREDENTIAL" \
      --issuer "$ISSUER" --subject "$SUBJECT" --audiences "$AUDIENCE" -o none
  fi
  for name in $EXTRA_FICS; do
    log "Azure: удаление лишнего federated credential $name"
    az identity federated-credential delete --identity-name "$IDENTITY" -g "$RG" -n "$name" --yes
  done
  if [[ "$ROLE_STATE" != ok ]]; then
    write_role_definition
    if [[ "$ROLE_STATE" == absent ]]; then
      log "Azure: роль «${ROLE_NAME}» с областью $RG_ID"
      az role definition create --role-definition "$TMP_FILE" -o none
    else
      [[ "$ROLE_OURS" == true ]] || die "Роль $ROLE_ID не принадлежит этому стенду; не обновлена"
      log "Azure: обновление роли «${ROLE_NAME}» ($ROLE_ID)"
      az role definition update --role-definition "$TMP_FILE" -o none
    fi
    retry role_visible || die "Роль не появилась в течение двух минут; повторите apply. ${LAST_ERROR}"
  fi
  if [[ -z "$ASSIGNMENT_ID" ]]; then
    log "Azure: назначение роли на VM $VM"
    retry assign_role || die "Не удалось назначить роль: $(tail -n 3 <<< "$LAST_ERROR")"
  fi

  log "GitHub: переменные окружения $GH_ENV"
  for name in AZURE_CLIENT_ID AZURE_TENANT_ID AZURE_SUBSCRIPTION_ID; do
    value="$(expected_variable "$name")"
    [[ -n "$value" ]] || die "Пустое значение $name"
    gh variable set "$name" --env "$GH_ENV" --repo "$REPO" --body "$value" >/dev/null
  done

  log 'Проверка итогового состояния'
  collect
  print_plan
  environment_ok || die "Окружение $GH_ENV не ограничено веткой $DEPLOY_BRANCH"
  [[ "$FIC_STATE" == ok && -z "$EXTRA_FICS" ]] || die 'Federated credential не совпадает с вычисленным subject или есть лишние'
  [[ "$ROLE_STATE" == ok && -n "$ASSIGNMENT_ID" ]] || die 'Роль или её назначение на VM не совпадают с ожидаемыми'
  [[ -z "$OTHER_ASSIGNMENTS" ]] || die "У идентичности $IDENTITY есть назначения кроме роли на VM"
  for name in AZURE_CLIENT_ID AZURE_TENANT_ID AZURE_SUBSCRIPTION_ID; do
    [[ "$(variable_value "$name")" == "$(expected_variable "$name")" ]] || die "Переменная $name не совпадает"
  done
  echo 'Готово: конвейер настроен.'
}

# Обратный порядок: сначала доверие Azure, затем окружение GitHub.
destroy() {
  local others name
  require_role_ours
  if [[ -n "$ASSIGNMENT_ID" ]]; then
    log "Azure: удаление назначения роли на VM $VM"
    az role assignment delete --ids "$ASSIGNMENT_ID" -o none
  fi
  if [[ -n "$PRINCIPAL_ID" ]]; then
    for name in $CREDENTIAL_NAMES; do
      log "Azure: удаление federated credential $name"
      az identity federated-credential delete --identity-name "$IDENTITY" -g "$RG" -n "$name" --yes
    done
    log "Azure: удаление идентичности $IDENTITY"
    az identity delete -g "$RG" -n "$IDENTITY" -o none
  fi
  if [[ -n "$ROLE_ID" ]]; then
    others="$(az_read role assignment list --role "$ROLE_ID" --all --query 'length(@)' -o tsv)" || exit 1
    if [[ "$others" == 0 ]]; then
      [[ "$ROLE_ID" =~ ^/subscriptions/[0-9a-fA-F-]{36}(/resourceGroups/[^/]+)?/providers/Microsoft\.Authorization/roleDefinitions/[0-9a-fA-F-]{36}$ ]] \
        || die 'Неожиданный ID роли; роль не удалена'
      log "Azure: удаление роли «${ROLE_NAME}» по ID $ROLE_ID"
      az rest --method delete --url "https://management.azure.com${ROLE_ID}?api-version=2022-04-01" -o none
    else
      log "Роль «${ROLE_NAME}» назначена ещё $others раз: не удалена, проверьте назначения вручную"
    fi
  fi
  if [[ -n "$ENV_POLICY" ]]; then
    log "GitHub: удаление окружения $GH_ENV и его переменных"
    gh api -X DELETE "repos/$REPO/environments/$GH_ENV" >/dev/null
  fi
  echo 'Удалено. Конвейер deploy-dev.yml не сможет войти в Azure до повторного apply.'
}

MODE="${1:-plan}"
[[ $# -eq 0 ]] || shift
CONFIRMED=false
EXPECTED_SUBSCRIPTION_NAME="${IMBC_SETUP_SUBSCRIPTION_NAME:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) CONFIRMED=true; shift ;;
    --subscription-name)
      [[ $# -ge 2 && -n "$2" ]] || die '--subscription-name требует имя подписки'
      EXPECTED_SUBSCRIPTION_NAME="$2"; shift 2 ;;
    *) die 'Неизвестный аргумент: допустимы --yes и --subscription-name "<имя>"' ;;
  esac
done
[[ "${IMBC_SETUP_CONFIRM:-}" != yes ]] || CONFIRMED=true

validate_target
case "$MODE" in
  plan)
    ensure_tools; collect; print_plan; print_order
    printf '\nИзменения не вносились. Подписка az сейчас: «%s».\n' "$SUBSCRIPTION_NAME"
    printf 'apply и destroy потребуют --yes и --subscription-name "<имя подписки>" (или IMBC_SETUP_SUBSCRIPTION_NAME), совпадающее с ним:\n'
    printf '  %s apply --yes --subscription-name "<имя подписки>"\n' "$0" ;;
  apply)
    ensure_tools; collect; print_plan; print_order; require_confirmation apply; apply ;;
  destroy)
    ensure_tools; collect
    CREDENTIAL_NAMES=''
    if [[ -n "$PRINCIPAL_ID" ]]; then
      CREDENTIAL_NAMES="$(az_read identity federated-credential list --identity-name "$IDENTITY" -g "$RG" --query '[].name' -o tsv)" || exit 1
      CREDENTIAL_NAMES="$(paste -sd ' ' - <<< "$CREDENTIAL_NAMES")"
    fi
    print_plan
    log 'Будет удалено (в этом порядке)'
    item 'Назначение роли' "${ASSIGNMENT_ID:-нет}"
    item 'Federated credentials' "${CREDENTIAL_NAMES:-нет}"
    item 'Идентичность' "$([[ -n "$PRINCIPAL_ID" ]] && echo "$IDENTITY" || echo нет)"
    item 'Роль' "${ROLE_ID:-нет}"
    item "Окружение GitHub $GH_ENV" "$([[ -n "$ENV_POLICY" ]] && echo есть || echo нет)"
    require_confirmation destroy
    destroy ;;
  *) sed -n '2,24p' "$0"; exit 1 ;;
esac
