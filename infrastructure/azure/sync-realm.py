#!/usr/bin/env python3
"""Apply managed settings to an existing IMBC realm and rename listed legacy demo users, without importing users or secrets.

Run from the repository on the VM after Keycloak is healthy:
    python3 infrastructure/azure/sync-realm.py --theme imbc
Only the explicitly allowlisted fields below are sent to the admin API. A legacy demo user
from LEGACY_DEMO_USERS is renamed in place, so its id (token subject) and password are kept.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

REALM_FIELDS = frozenset({
    "loginTheme", "sslRequired", "resetPasswordAllowed", "verifyEmail", "passwordPolicy",
    "bruteForceProtected", "permanentLockout", "failureFactor", "waitIncrementSeconds",
    "maxFailureWaitSeconds", "minimumQuickLoginWaitSeconds", "quickLoginCheckMilliSeconds",
    "maxDeltaTimeSeconds", "ssoSessionIdleTimeout", "ssoSessionMaxLifespan",
    "ssoSessionIdleTimeoutRememberMe", "ssoSessionMaxLifespanRememberMe",
    "clientSessionIdleTimeout", "clientSessionMaxLifespan", "offlineSessionIdleTimeout",
    "offlineSessionMaxLifespanEnabled", "offlineSessionMaxLifespan", "accessTokenLifespan",
    "accessTokenLifespanForImplicitFlow", "accessCodeLifespan", "accessCodeLifespanUserAction",
    "accessCodeLifespanLogin", "actionTokenGeneratedByAdminLifespan",
    "actionTokenGeneratedByUserLifespan", "eventsEnabled", "eventsExpiration",
    "enabledEventTypes", "smtpServer",
})
CLIENT_FIELDS = frozenset({"rootUrl", "baseUrl", "redirectUris", "webOrigins", "attributes", "frontchannelLogout"})
PLACEHOLDER = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")
# The realm file is imported only once, so renamed demo users are renamed here (GEN-06, v1.3 section 3.1).
LEGACY_DEMO_USERS = {"spectator@spectator.local": "observer@observer.local"}


class SyncError(Exception):
    """A safe, operation-only error, never command output or credentials."""


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for number, source in enumerate(path.read_text().splitlines(), 1):
        line = source.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if not separator or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise SyncError(f"Invalid .env syntax at line {number}")
        if value.startswith(("'", '"')):
            quote = value[0]
            # Compose .env allows quoted strings and trailing comments.
            match = re.fullmatch(r"'((?:[^']|\\')*)'\s*(?:#.*)?", value) if quote == "'" else re.fullmatch(r'"((?:[^"\\]|\\.)*)"\s*(?:#.*)?', value)
            if match is None:
                raise SyncError(f"Unsupported quoted .env value at line {number}")
            value = match[1]
            if quote == "'":
                value = value.replace("\\'", "'")
            else:
                value = re.sub(r'\\([nrt\\"])', lambda m: {"n": "\n", "r": "\r", "t": "\t", "\\": "\\", '"': '"'}[m[1]], value)
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].rstrip()
        values[key] = value
    return values


def substitute(value: Any, env: dict[str, str]) -> Any:
    if isinstance(value, str):
        def replacement(match: re.Match[str]) -> str:
            if match[1] not in env:
                raise SyncError(f"Missing required environment variable: {match[1]}")
            return env[match[1]]
        return PLACEHOLDER.sub(replacement, value)
    if isinstance(value, list):
        return [substitute(item, env) for item in value]
    if isinstance(value, dict):
        return {key: substitute(item, env) for key, item in value.items()}
    return value


def desired_settings(source: dict[str, Any], env: dict[str, str], theme: str) -> tuple[str, dict[str, Any], dict[str, Any]]:
    realm = source.get("realm")
    if not isinstance(realm, str) or not re.fullmatch(r"[A-Za-z0-9._-]+", realm):
        raise SyncError("Invalid desired realm name")
    clients = [client for client in source.get("clients", []) if client.get("clientId") == "imbc-bff"]
    if len(clients) != 1:
        raise SyncError("Desired configuration must contain exactly one imbc-bff client")
    effective_env = {**env, "KEYCLOAK_LOGIN_THEME": theme}
    realm_patch = substitute({key: value for key, value in source.items() if key in REALM_FIELDS}, effective_env)
    client_patch = substitute({key: value for key, value in clients[0].items() if key in CLIENT_FIELDS}, effective_env)
    realm_patch["loginTheme"] = theme
    client_patch.setdefault("attributes", {})["login_theme"] = theme
    return realm, realm_patch, client_patch


def legacy_user_renames(source: dict[str, Any]) -> dict[str, str]:
    """Pairs whose new username is a desired realm user and whose old username no longer is."""
    usernames = {str(user.get("username", "")).lower() for user in source.get("users", []) if isinstance(user, dict)}
    return {old: new for old, new in LEGACY_DEMO_USERS.items() if new in usernames and old not in usernames}


def run(command: list[str], *, operation: str, root: Path, data: str | None = None) -> str:
    try:
        result = subprocess.run(command, cwd=root, input=data, text=True, capture_output=True, timeout=90, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise SyncError(f"{operation} failed to execute or timed out") from None
    if result.returncode:
        # Admin command stderr can echo configuration; never include it in logs.
        raise SyncError(f"{operation} failed (exit {result.returncode})")
    return result.stdout


def parse_result(raw: str, operation: str) -> Any:
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        raise SyncError(f"{operation} returned invalid JSON") from None


def find_user_id(cli: list[str], config_path: str, realm: str, field: str, value: str, root: Path) -> str | None:
    """Id of the user whose username or email is exactly value, or None. Anything unexpected is an error, not "absent"."""
    users = parse_result(run(cli + ["get", "users", "--config", config_path, "-r", realm, "-q", f"{field}={value}", "-q", "exact=true", "--fields", f"id,{field}"], operation="Find demo user", root=root), "Find demo user")
    if not isinstance(users, list) or not all(isinstance(user, dict) for user in users):
        raise SyncError("Unexpected demo user lookup result")
    matches = [user for user in users if str(user.get(field, "")).lower() == value.lower()]
    if not matches:
        return None
    if len(matches) != 1 or not re.fullmatch(r"[A-Za-z0-9-]+", str(matches[0].get("id", ""))):
        raise SyncError("Unexpected demo user lookup result")
    return str(matches[0]["id"])


def synchronize(root: Path, theme: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9._-]+", theme):
        raise SyncError("Invalid theme name")
    env = read_env(root / ".env")
    for key in ("KEYCLOAK_ADMIN_USER", "KEYCLOAK_ADMIN_PASSWORD"):
        if not env.get(key):
            raise SyncError(f"Missing required environment variable: {key}")
    source = parse_result((root / "infrastructure/keycloak/imbc-realm.json").read_text(), "Desired realm configuration")
    realm, realm_patch, client_patch = desired_settings(source, env, theme)
    renames = legacy_user_renames(source)
    container_ids = run(["docker", "compose", "-f", "compose.yaml", "-f", "compose.azure.yaml", "ps", "-q", "keycloak"], operation="Find Keycloak container", root=root).split()
    if len(container_ids) != 1 or not re.fullmatch(r"[a-fA-F0-9]{12,64}", container_ids[0]):
        raise SyncError("Expected one running Keycloak container")
    container = container_ids[0]
    temporary_dir = f"/tmp/imbc-realm-sync-{uuid.uuid4().hex}"
    config_path = f"{temporary_dir}/kcadm.config"
    prefix = ["docker", "exec", "-i", container]
    cli = prefix + ["/opt/keycloak/bin/kcadm.sh"]
    created = False
    original_error: BaseException | None = None
    try:
        run(prefix + ["mkdir", "-m", "700", temporary_dir], operation="Create temporary admin configuration directory", root=root)
        created = True
        run(cli + ["config", "credentials", "--config", config_path, "--server", "http://localhost:8080/kc", "--realm", "master", "--user", env["KEYCLOAK_ADMIN_USER"], "--password", env["KEYCLOAK_ADMIN_PASSWORD"]], operation="Authenticate realm administrator", root=root)
        clients = parse_result(run(cli + ["get", "clients", "--config", config_path, "-r", realm, "-q", "clientId=imbc-bff", "--fields", "id,clientId"], operation="Find imbc-bff client", root=root), "Find imbc-bff client")
        matches = [client for client in clients if client.get("clientId") == "imbc-bff"] if isinstance(clients, list) else []
        if len(matches) != 1 or not re.fullmatch(r"[A-Za-z0-9._-]+", str(matches[0].get("id", ""))):
            raise SyncError("Expected one existing imbc-bff client")
        client_path = f"clients/{matches[0]['id']}"
        # kcadm --fields attributes prunes arbitrary map keys to {}; read the full
        # response only into captured memory, then retain attributes for the merge.
        current = parse_result(run(cli + ["get", client_path, "--config", config_path, "-r", realm], operation="Read current client attributes", root=root), "Read current client attributes")
        if not isinstance(current, dict) or not isinstance(current.get("attributes", {}), dict):
            raise SyncError("Current client attributes are invalid")
        client_patch["attributes"] = {**current.get("attributes", {}), **client_patch["attributes"]}
        # kcadm accepts '-f -' for JSON on stdin. No desired users or client secrets are submitted.
        run(cli + ["update", f"realms/{realm}", "--config", config_path, "-f", "-"], operation="Update managed realm settings", root=root, data=json.dumps(realm_patch))
        run(cli + ["update", client_path, "--config", config_path, "-r", realm, "-f", "-"], operation="Update managed client settings", root=root, data=json.dumps(client_patch))
        for old, new in renames.items():
            legacy_id = find_user_id(cli, config_path, realm, "username", old, root)
            if legacy_id is None:
                continue
            # The new address may already belong to another user as username or as email.
            if any(find_user_id(cli, config_path, realm, field, new, root) is not None for field in ("username", "email")):
                print("Legacy demo user kept: target already exists")
                continue
            # Only username and email change; credentials and the id stay with the user.
            run(cli + ["update", f"users/{legacy_id}", "--config", config_path, "-r", realm, "-s", f"username={new}", "-s", f"email={new}"], operation="Rename legacy demo user", root=root)
            print("Renamed legacy demo user")
    except BaseException as error:
        original_error = error
        raise
    finally:
        if created:
            try:
                # Unique directory created above, never a caller-supplied path.
                run(prefix + ["rm", "-rf", "--", temporary_dir], operation="Remove temporary admin configuration", root=root)
            except SyncError:
                if original_error is None:
                    raise
                print("ERROR: Temporary admin configuration cleanup also failed", file=sys.stderr)
    print("Updated realm settings: " + ", ".join(sorted(realm_patch)))
    print("Updated imbc-bff settings: " + ", ".join(sorted(client_patch)))
    print("Realm synchronization complete; legacy demo users renamed where present, other users, client secrets and unrelated settings preserved")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--theme", default="imbc")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()
    try:
        synchronize(args.root.resolve(), args.theme)
    except SyncError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    except (OSError, ValueError, TypeError, KeyError):
        # Parse/filesystem errors may contain configuration values; keep output value-free.
        print("ERROR: Unable to read or validate realm synchronization inputs", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
