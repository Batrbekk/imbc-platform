#!/usr/bin/env python3
"""Managed settings of sync-realm.py: email and username editable only by admin (MAN-05, ADM-05),
first and last name optional (MAN-03, ADM-01: no name step after the password is set), and the Keycloak
email theme `imbc` that sends NOT-01 in the recipient's language (NOT-19, NOT-20).

    python3 infrastructure/azure/test/sync-realm.test.py
No Keycloak, Docker or network: the pure function and the desired realm JSON only.
"""
from __future__ import annotations

import copy
import importlib.util
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("sync_realm", ROOT / "infrastructure/azure/sync-realm.py")
sync_realm = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(sync_realm)

BOTH = ["admin", "user"]


def attribute(name: str, edit: list[str], required: bool = False) -> dict:
    result = {"name": name, "displayName": "${%s}" % name, "validations": {"length": {"max": 255}}}
    if required:
        result["required"] = {"roles": ["user"]}
    return {**result, "permissions": {"view": list(BOTH), "edit": edit}, "multivalued": False}


# Shape of Keycloak 26's default profile: every attribute editable by the user, all but username required.
DEFAULT = {
    "attributes": [attribute(name, list(BOTH), required=name != "username")
                   for name in ("username", "email", "firstName", "lastName")],
    "groups": [{"name": "user-metadata", "displayHeader": "User metadata"}],
    "unmanagedAttributePolicy": "ADMIN_EDIT",
}


def desired_profile() -> dict:
    source = json.loads((ROOT / "infrastructure/keycloak/imbc-realm.json").read_text())
    entries = source["components"]["org.keycloak.userprofile.UserProfileProvider"]
    assert len(entries) == 1 and entries[0]["providerId"] == "declarative-user-profile"
    return json.loads(entries[0]["config"]["kc.user.profile.config"][0])


def by_name(profile: dict) -> dict:
    return {a["name"]: a for a in profile["attributes"]}


def managed(profile):
    return sync_realm.managed_user_profile(profile)


class ManagedUserProfile(unittest.TestCase):
    def test_default_profile_email_and_username_admin_only_names_optional(self) -> None:
        updated, admin_only, optional = managed(DEFAULT)
        self.assertEqual(admin_only, ["email", "username"])
        self.assertEqual(optional, ["firstName", "lastName"])
        attributes = by_name(updated)
        for name in ("email", "username"):
            self.assertEqual(attributes[name]["permissions"], {"view": BOTH, "edit": ["admin"]})
        # The email stays required; only the two names lose `required`.
        self.assertEqual(attributes["email"]["required"], {"roles": ["user"]})
        for name in ("firstName", "lastName"):
            expected = {key: value for key, value in by_name(DEFAULT)[name].items() if key != "required"}
            self.assertEqual(attributes[name], expected)
        # Everything else stays: groups, policy, validations.
        self.assertEqual(updated["groups"], DEFAULT["groups"])
        self.assertEqual(updated["unmanagedAttributePolicy"], "ADMIN_EDIT")
        self.assertEqual(attributes["email"]["validations"], by_name(DEFAULT)["email"]["validations"])
        # The input is not modified in place.
        self.assertEqual(by_name(DEFAULT)["email"]["permissions"]["edit"], BOTH)

    def test_second_run_changes_nothing(self) -> None:
        once, _, _ = managed(DEFAULT)
        twice, admin_only, optional = managed(once)
        self.assertEqual((admin_only, optional), ([], []))
        self.assertEqual(twice, once)

    def test_names_absent_are_not_an_error(self) -> None:
        profile = {"attributes": [attribute("username", BOTH), attribute("email", BOTH, required=True)]}
        updated, admin_only, optional = managed(profile)
        self.assertEqual((admin_only, optional), (["email", "username"], []))
        self.assertEqual([a["name"] for a in updated["attributes"]], ["username", "email"])

    def test_only_names_required_reports_only_names(self) -> None:
        once, _, _ = managed(DEFAULT)
        profile = copy.deepcopy(once)
        by_name(profile)["lastName"]["required"] = {"roles": ["user"]}
        _, admin_only, optional = managed(profile)
        self.assertEqual((admin_only, optional), ([], ["lastName"]))

    def test_missing_viewer_is_added_back(self) -> None:
        profile = copy.deepcopy(DEFAULT)
        by_name(profile)["email"]["permissions"] = {"view": ["admin"], "edit": ["admin"]}
        updated, admin_only, _ = managed(profile)
        self.assertEqual(admin_only, ["email", "username"])
        self.assertEqual(by_name(updated)["email"]["permissions"], {"view": BOTH, "edit": ["admin"]})

    def test_invalid_profile_is_refused_without_values(self) -> None:
        for profile in (None, {}, {"attributes": "x"}, {"attributes": [attribute("firstName", BOTH)]},
                        {"attributes": [{"name": "email", "permissions": []}, attribute("username", BOTH)]}):
            with self.assertRaises(sync_realm.SyncError):
                managed(profile)

    def test_desired_realm_profile_already_satisfies_the_sync_step(self) -> None:
        profile = desired_profile()
        _, admin_only, optional = managed(profile)
        self.assertEqual((admin_only, optional), ([], []))
        attributes = by_name(profile)
        self.assertEqual(list(attributes), ["username", "email", "firstName", "lastName"])
        for name in ("firstName", "lastName"):
            self.assertEqual(attributes[name]["permissions"], {"view": BOTH, "edit": BOTH})
            self.assertNotIn("required", attributes[name])
        self.assertEqual(attributes["email"]["required"], {"roles": ["user"]})
        self.assertEqual([g["name"] for g in profile["groups"]], ["user-metadata"])


def realm_source() -> dict:
    return json.loads((ROOT / "infrastructure/keycloak/imbc-realm.json").read_text())


def realm_env() -> dict[str, str]:
    """Every ${NAME} of the realm file with a dummy value, as the server .env would supply them."""
    names = set(sync_realm.PLACEHOLDER.findall((ROOT / "infrastructure/keycloak/imbc-realm.json").read_text()))
    return {name: "value" for name in names}


class EmailTheme(unittest.TestCase):
    """emailTheme is synchronised from --email-theme (default imbc): the stock Keycloak email theme has no
    Kazakh text that is usable, so the existing realm must switch to the IMBC email theme on every rollout."""

    def desired(self, *args: str) -> dict:
        _, realm_patch, _ = sync_realm.desired_settings(realm_source(), realm_env(), "imbc", *args)
        return realm_patch

    def test_email_theme_is_a_managed_field_and_the_realm_file_takes_it_from_the_environment(self) -> None:
        self.assertIn("emailTheme", sync_realm.REALM_FIELDS)
        self.assertEqual(realm_source()["emailTheme"], "${KEYCLOAK_EMAIL_THEME}")
        self.assertEqual(realm_source()["loginTheme"], "${KEYCLOAK_LOGIN_THEME}")

    def test_email_theme_defaults_to_imbc_and_follows_the_argument(self) -> None:
        self.assertEqual(self.desired()["emailTheme"], "imbc")
        self.assertEqual(self.desired("keycloak")["emailTheme"], "keycloak")
        # Not taken from the server .env: the value is the rollout's argument, like loginTheme.
        env = {**realm_env(), "KEYCLOAK_EMAIL_THEME": "from-env"}
        _, realm_patch, _ = sync_realm.desired_settings(realm_source(), env, "imbc")
        self.assertEqual(realm_patch["emailTheme"], "imbc")
        self.assertEqual(realm_patch["loginTheme"], "imbc")

    def test_command_line_argument_default_and_override(self) -> None:
        self.assertEqual(sync_realm.parse_args([]).email_theme, "imbc")
        self.assertEqual(sync_realm.parse_args([]).theme, "imbc")
        self.assertEqual(sync_realm.parse_args(["--email-theme", "keycloak"]).email_theme, "keycloak")
        self.assertEqual(sync_realm.parse_args(["--theme", "other"]).email_theme, "imbc")

    def test_invalid_theme_names_are_refused_before_anything_is_read(self) -> None:
        for email_theme in ("", "a b", "../x", "imbc;rm", "а"):
            with self.assertRaises(sync_realm.SyncError):
                sync_realm.synchronize(ROOT / "does-not-exist", "imbc", email_theme)
        self.assertTrue(re.fullmatch(r"[A-Za-z0-9._-]+", sync_realm.parse_args([]).email_theme))

    def test_the_other_managed_realm_fields_are_unchanged(self) -> None:
        patch = self.desired()
        self.assertEqual(patch["loginTheme"], "imbc")
        self.assertEqual(patch["sslRequired"], "value")
        self.assertEqual(patch["actionTokenGeneratedByUserLifespan"], 259200)
        self.assertEqual(patch["actionTokenGeneratedByAdminLifespan"], 259200)
        self.assertNotIn("internationalizationEnabled", patch)


if __name__ == "__main__":
    unittest.main(verbosity=2)
