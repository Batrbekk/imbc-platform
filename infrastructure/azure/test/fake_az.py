"""Заглушка Azure CLI для setup-github-deploy.test.sh.

Состояние — JSON-файл $FAKE/state.json (account, vm, identities, fics, roles, assignments).
Результат каждого поддерживаемого --query вычисляется по правилам JMESPath из этих данных
(тот же тип значения, что дал бы настоящий az: скаляр, плоский список, список списков, null)
и печатается одной функцией tsv(), повторяющей формат `-o tsv` настоящего CLI (knack):
  null на верхнем уровне — пустой вывод; не список — оборачивается в список;
  каждый элемент верхнего списка — отдельная строка; если элемент — список или словарь,
  его значения через табуляцию; вложенный список в строке — его длина, словарь — пусто,
  null — «None», bool — «True»/«False».
Запросы, которых заглушка не знает, завершаются ошибкой: новый запрос в скрипте нужно
добавить сюда осознанно. Поддержаны и запросы версии 7140bab — чтобы регрессионный тест
показывал на ней именно ошибку чтения, а не «неизвестный запрос».
Записи (create/update/delete/rest) меняют состояние и пишутся в $FAKE/writes.log.
"""
import json
import os
import re
import sys

FAKE = os.environ['FAKE']
STATE_PATH = os.path.join(FAKE, 'state.json')


def tsv(value):
    if value is None:
        return ''
    rows = value if isinstance(value, list) else [value]
    lines = []
    for row in rows:
        if isinstance(row, (list, dict)):
            values = [v for _, v in sorted(row.items())] if isinstance(row, dict) else row
            lines.append('\t'.join(cell(v) for v in values))
        else:
            lines.append(cell(row))
    return ''.join(line + '\n' for line in lines)


def cell(value):
    if isinstance(value, list):
        return str(len(value))
    if isinstance(value, dict):
        return ''
    return value if isinstance(value, str) else str(value)


def first(items):
    return items[0] if items else None


def by_name(items, name):
    return [item for item in items if item.get('name') == name]


# (команда, регулярное выражение запроса) → функция(данные, совпадение) с типом результата JMESPath.
QUERIES = [
    ('account show', r'id', lambda d, m: d['id']),
    ('account show', r'tenantId', lambda d, m: d['tenantId']),
    ('account show', r'name', lambda d, m: d['name']),
    ('vm show', r'id', lambda d, m: d['id']),
    # [?name=='X'].[a, b] — список списков; [?name=='X'] | [0].[a, b] — плоский список или null.
    ('identity list', r"\[\?name=='([^']*)'\]\.\[clientId, principalId\]",
     lambda d, m: [[i['clientId'], i['principalId']] for i in by_name(d, m[1])]),
    ('identity list', r"\[\?name=='([^']*)'\] \| \[0\]\.\[clientId, principalId\]",
     lambda d, m: (lambda i: None if i is None else [i['clientId'], i['principalId']])(first(by_name(d, m[1])))),
    ('identity show', r'\[\[clientId, principalId\]\]', lambda d, m: [[d['clientId'], d['principalId']]]),
    ('identity show', r'\[clientId, principalId\]', lambda d, m: [d['clientId'], d['principalId']]),
    ('identity federated-credential list', r"\[\?name=='([^']*)'\]\.\[issuer, subject, join\(',', audiences\)\]",
     lambda d, m: [[f['issuer'], f['subject'], ','.join(f['audiences'])] for f in by_name(d, m[1])]),
    ('identity federated-credential list', r"\[\?name=='([^']*)'\] \| \[0\]\.\[issuer, subject, join\(',', audiences\)\]",
     lambda d, m: (lambda f: None if f is None else [f['issuer'], f['subject'], ','.join(f['audiences'])])(first(by_name(d, m[1])))),
    ('identity federated-credential list', r"\[\?name!='([^']*)'\]\.name", lambda d, m: [f['name'] for f in d if f['name'] != m[1]]),
    ('identity federated-credential list', r'\[\]\.name', lambda d, m: [f['name'] for f in d]),
    ('role definition list',
     r"\[\]\.\[id, roleType, join\(' ', sort\(permissions\[0\]\.actions\)\), join\(' ', assignableScopes\), "
     r"length\(permissions\), length\(permissions\[0\]\.notActions\), length\(permissions\[0\]\.dataActions\)\]",
     lambda d, m: [[r['id'], r['roleType'], ' '.join(sorted(r['permissions'][0]['actions'])), ' '.join(r['assignableScopes']),
                    len(r['permissions']), len(r['permissions'][0]['notActions']), len(r['permissions'][0]['dataActions'])] for r in d]),
    ('role definition list', r'\[0\]\.id', lambda d, m: first([r['id'] for r in d])),
    ('role assignment list', r'\[\]\.\[id, roleDefinitionId, scope, roleDefinitionName\]',
     lambda d, m: [[a['id'], a['roleDefinitionId'], a['scope'], a['roleDefinitionName']] for a in d]),
    ('role assignment list', r'length\(@\)', lambda d, m: len(d)),
]


def parse(argv):
    words, options, i = [], {}, 0
    while i < len(argv) and not argv[i].startswith('-'):
        words.append(argv[i])
        i += 1
    while i < len(argv):
        key = argv[i]
        if i + 1 < len(argv) and not argv[i + 1].startswith('--'):
            options[key] = argv[i + 1]
            i += 2
        else:
            options[key] = True
            i += 1
    return ' '.join(words), options


def fail(message, code=1):
    sys.stderr.write(message + '\n')
    sys.exit(code)


def guid_tail(value):
    return str(value).rsplit('/', 1)[-1].lower()


def main():
    argv = sys.argv[1:]
    command, opt = parse(argv)
    with open(STATE_PATH) as handle:
        state = json.load(handle)

    if os.environ.get('FAKE_FAIL_COMMAND') == command:
        fail('ERROR: (AuthorizationFailed) The client does not have authorization to perform this action')

    write_commands = ('identity create', 'identity delete', 'identity federated-credential create',
                      'identity federated-credential delete', 'role definition create', 'role definition update',
                      'role assignment create', 'role assignment delete', 'rest')
    if command in write_commands:
        with open(os.path.join(FAKE, 'writes.log'), 'a') as log:
            log.write('az ' + ' '.join(argv) + '\n')
        status = write(state, command, opt)
        with open(STATE_PATH, 'w') as handle:
            json.dump(state, handle, indent=2)
        sys.exit(status)

    if command == 'account show':
        data = state['account']
    elif command == 'vm show':
        data = state['vm']
    elif command == 'identity list':
        data = state['identities']
    elif command == 'identity show':
        found = by_name(state['identities'], opt.get('-n'))
        if not found:
            fail('ERROR: (ResourceNotFound) identity not found', 3)
        data = found[0]
    elif command == 'identity federated-credential list':
        data = state['fics'] if by_name(state['identities'], opt.get('--identity-name')) else fail('ERROR: (ResourceNotFound)', 3)
    elif command == 'role definition list':
        data = [r for r in state['roles'] if r['roleName'] == opt.get('--name')]
    elif command == 'role assignment list':
        data = state['assignments']
        if '--assignee' in opt:
            data = [a for a in data if a['principalId'] == opt['--assignee']]
        if '--role' in opt:
            data = [a for a in data if guid_tail(a['roleDefinitionId']) == guid_tail(opt['--role'])]
    else:
        fail('fake az: неизвестная команда: ' + ' '.join(argv), 3)

    query = opt.get('--query')
    if query is None:
        return
    for name, pattern, evaluate in QUERIES:
        match = re.fullmatch(pattern, query) if name == command else None
        if match:
            if opt.get('-o') == 'tsv':
                sys.stdout.write(tsv(evaluate(data, match)))
            return
    fail(f'fake az: неподдержанный запрос для «{command}»: {query}', 3)


def write(state, command, opt):
    sub = state['account']['id']
    if command == 'identity create':
        state['identities'].append({'name': opt['-n'], 'clientId': 'c1c1c1c1-0000-0000-0000-000000000001',
                                    'principalId': 'b2b2b2b2-0000-0000-0000-000000000002'})
    elif command == 'identity delete':
        state['identities'] = [i for i in state['identities'] if i['name'] != opt['-n']]
        state['fics'] = []
    elif command == 'identity federated-credential create':
        state['fics'] = [f for f in state['fics'] if f['name'] != opt['-n']]
        state['fics'].append({'name': opt['-n'], 'issuer': opt['--issuer'], 'subject': opt['--subject'],
                              'audiences': [opt['--audiences']]})
    elif command == 'identity federated-credential delete':
        state['fics'] = [f for f in state['fics'] if f['name'] != opt['-n']]
    elif command in ('role definition create', 'role definition update'):
        with open(opt['--role-definition']) as handle:
            source = json.load(handle)
        role = {'id': f'/subscriptions/{sub}/providers/Microsoft.Authorization/roleDefinitions/a0a0a0a0-0000-0000-0000-00000000000a',
                'roleName': source['Name'], 'roleType': 'CustomRole', 'assignableScopes': source['AssignableScopes'],
                'permissions': [{'actions': source['Actions'], 'notActions': source['NotActions'], 'dataActions': source['DataActions']}]}
        state['roles'] = [r for r in state['roles'] if r['roleName'] != source['Name']] + [role]
    elif command == 'role assignment create':
        role = [r for r in state['roles'] if guid_tail(r['id']) == guid_tail(opt['--role'])]
        state['assignments'].append({'id': opt['--scope'] + '/providers/Microsoft.Authorization/roleAssignments/d4d4d4d4-0000-0000-0000-000000000004',
                                     'principalId': opt['--assignee-object-id'], 'roleDefinitionId': opt['--role'],
                                     'scope': opt['--scope'], 'roleDefinitionName': role[0]['roleName'] if role else '?'})
        if os.environ.get('FAKE_ASSIGN') == 'exists':
            sys.stderr.write('ERROR: (RoleAssignmentExists) The role assignment already exists.\n')
            return 1
    elif command == 'role assignment delete':
        state['assignments'] = [a for a in state['assignments'] if a['id'] != opt['--ids']]
    elif command == 'rest':
        url = opt['--url']
        state['roles'] = [r for r in state['roles'] if guid_tail(r['id']) != guid_tail(url.split('?')[0])]
    return 0


main()
