#!/usr/bin/env python3
"""Apply managed settings to an existing IMBC realm without importing users or secrets.

Run from the repository on the VM after Keycloak is healthy:
    python3 infrastructure/azure/sync-realm.py --theme imbc [--email-theme imbc]
`--theme` is the login theme, `--email-theme` the email theme (both default to `imbc`: the theme JAR carries both,
and the email theme is what sends NOT-01 in the recipient's language, NOT-19).
Only the explicitly allowlisted fields below are sent to the admin API.
"""
from __future__ import annotations

import argparse
import copy
import json
import re
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

REALM_FIELDS = frozenset({
    "loginTheme", "emailTheme", "sslRequired", "resetPasswordAllowed", "verifyEmail", "passwordPolicy",
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
DEFAULT_THEME = "imbc"
THEME_NAME = re.compile(r"[A-Za-z0-9._-]+")
PLACEHOLDER = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")
# The login email is changed only by an IMBC administrator (MAN-05, ADM-05); with
# registrationEmailAsUsername the username follows it. Everyone keeps seeing both.
ADMIN_EDIT_ONLY = ("email", "username")
VIEWERS = ("admin", "user")
# The platform keeps the person's name itself (user_accounts.full_name); registration and the
# invitation ask nothing else (MAN-01, MAN-03, ADM-01), so Keycloak must not demand a name step.
OPTIONAL_NAMES = ("firstName", "lastName")


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


def desired_settings(source: dict[str, Any], env: dict[str, str], theme: str, email_theme: str = DEFAULT_THEME) -> tuple[str, dict[str, Any], dict[str, Any]]:
    realm = source.get("realm")
    if not isinstance(realm, str) or not re.fullmatch(r"[A-Za-z0-9._-]+", realm):
        raise SyncError("Invalid desired realm name")
    clients = [client for client in source.get("clients", []) if client.get("clientId") == "imbc-bff"]
    if len(clients) != 1:
        raise SyncError("Desired configuration must contain exactly one imbc-bff client")
    effective_env = {**env, "KEYCLOAK_LOGIN_THEME": theme, "KEYCLOAK_EMAIL_THEME": email_theme}
    realm_patch = substitute({key: value for key, value in source.items() if key in REALM_FIELDS}, effective_env)
    client_patch = substitute({key: value for key, value in clients[0].items() if key in CLIENT_FIELDS}, effective_env)
    realm_patch["loginTheme"] = theme
    realm_patch["emailTheme"] = email_theme
    client_patch.setdefault("attributes", {})["login_theme"] = theme
    return realm, realm_patch, client_patch


def managed_user_profile(profile: Any) -> tuple[dict[str, Any], list[str], list[str]]:
    """Return the user profile as the platform needs it and what changed.

    Email and username become editable only by admin (both still viewable by admin and user);
    `required` is removed from firstName and lastName when present. Nothing else changes —
    validations, other attributes, groups and every other key are kept — so a second run changes
    nothing. Returns (profile, attributes made admin-only, names made optional).
    """
    if not isinstance(profile, dict) or not isinstance(profile.get("attributes"), list):
        raise SyncError("Current user profile is invalid")
    updated = copy.deepcopy(profile)
    found: set[str] = set()
    changed: list[str] = []
    optional: list[str] = []
    for attribute in updated["attributes"]:
        if not isinstance(attribute, dict):
            continue
        if attribute.get("name") in OPTIONAL_NAMES and "required" in attribute:
            del attribute["required"]
            optional.append(attribute["name"])
        if attribute.get("name") not in ADMIN_EDIT_ONLY:
            continue
        name = attribute["name"]
        found.add(name)
        permissions = attribute.setdefault("permissions", {})
        if not isinstance(permissions, dict):
            raise SyncError("Current user profile permissions are invalid")
        view = permissions.get("view") if isinstance(permissions.get("view"), list) else []
        missing_viewers = [role for role in VIEWERS if role not in view]
        if permissions.get("edit") != ["admin"] or missing_viewers:
            permissions["edit"] = ["admin"]
            permissions["view"] = view + missing_viewers
            changed.append(name)
    if found != set(ADMIN_EDIT_ONLY):
        raise SyncError("Current user profile lacks the email or username attribute")
    return updated, sorted(changed), sorted(optional)


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


def synchronize(root: Path, theme: str, email_theme: str = DEFAULT_THEME) -> None:
    if not THEME_NAME.fullmatch(theme):
        raise SyncError("Invalid theme name")
    if not THEME_NAME.fullmatch(email_theme):
        raise SyncError("Invalid email theme name")
    env = read_env(root / ".env")
    for key in ("KEYCLOAK_ADMIN_USER", "KEYCLOAK_ADMIN_PASSWORD"):
        if not env.get(key):
            raise SyncError(f"Missing required environment variable: {key}")
    source = parse_result((root / "infrastructure/keycloak/imbc-realm.json").read_text(), "Desired realm configuration")
    realm, realm_patch, client_patch = desired_settings(source, env, theme, email_theme)
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
        # Declarative user profile: read it whole, change only the managed keys, write it back only if needed.
        profile = parse_result(run(cli + ["get", "users/profile", "--config", config_path, "-r", realm], operation="Read user profile", root=root), "Read user profile")
        managed, admin_only, made_optional = managed_user_profile(profile)
        if admin_only or made_optional:
            run(cli + ["update", "users/profile", "--config", config_path, "-r", realm, "-f", "-"], operation="Update user profile", root=root, data=json.dumps(managed))
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
    profile_changes = "; ".join(part for part in (
        "updated: " + ", ".join(admin_only) if admin_only else "",
        "optional: " + ", ".join(made_optional) if made_optional else "",
    ) if part) or "already set"
    print(f"User profile: email and username editable by admin only, first and last name optional ({profile_changes})")
    print("Realm synchronization complete; existing users, client secrets and unrelated settings preserved")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--theme", default=DEFAULT_THEME, help="login theme name (default: imbc)")
    parser.add_argument("--email-theme", default=DEFAULT_THEME, help="email theme name (default: imbc)")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    return parser.parse_args(argv)


def main() -> int:
    args = parse_args()
    try:
        synchronize(args.root.resolve(), args.theme, args.email_theme)
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
