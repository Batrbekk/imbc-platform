#!/usr/bin/env python3
"""Profile step of sync-realm.py: email and username editable only by admin (MAN-05, ADM-05),
first and last name optional (MAN-03, ADM-01: no name step after the password is set).

    python3 infrastructure/azure/test/sync-realm.test.py
No Keycloak, Docker or network: the pure function and the desired realm JSON only.
"""
from __future__ import annotations

import copy
import importlib.util
import json
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


if __name__ == "__main__":
    unittest.main(verbosity=2)
