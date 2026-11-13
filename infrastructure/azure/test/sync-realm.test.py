#!/usr/bin/env python3
"""Profile step of sync-realm.py: email and username editable only by admin (MAN-05, ADM-05).

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


def attribute(name: str, edit: list[str]) -> dict:
    return {"name": name, "displayName": "${%s}" % name, "validations": {"length": {"max": 255}},
            "permissions": {"view": list(BOTH), "edit": edit}, "multivalued": False}


# Shape of Keycloak 26's default profile: every attribute editable by the user.
DEFAULT = {
    "attributes": [attribute(name, list(BOTH)) for name in ("username", "email", "firstName", "lastName")],
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


class RestrictLoginAttributes(unittest.TestCase):
    def test_default_profile_email_and_username_become_admin_only(self) -> None:
        updated, changed = sync_realm.restrict_login_attributes(DEFAULT)
        self.assertEqual(changed, ["email", "username"])
        attributes = by_name(updated)
        for name in ("email", "username"):
            self.assertEqual(attributes[name]["permissions"], {"view": BOTH, "edit": ["admin"]})
        # Everything else stays: first and last name editable by the user, groups, policy, validations.
        for name in ("firstName", "lastName"):
            self.assertEqual(attributes[name], by_name(DEFAULT)[name])
        self.assertEqual(updated["groups"], DEFAULT["groups"])
        self.assertEqual(updated["unmanagedAttributePolicy"], "ADMIN_EDIT")
        self.assertEqual(attributes["email"]["validations"], by_name(DEFAULT)["email"]["validations"])
        # The input is not modified in place.
        self.assertEqual(by_name(DEFAULT)["email"]["permissions"]["edit"], BOTH)

    def test_second_run_changes_nothing(self) -> None:
        once, _ = sync_realm.restrict_login_attributes(DEFAULT)
        twice, changed = sync_realm.restrict_login_attributes(once)
        self.assertEqual(changed, [])
        self.assertEqual(twice, once)

    def test_missing_viewer_is_added_back(self) -> None:
        profile = copy.deepcopy(DEFAULT)
        by_name(profile)["email"]["permissions"] = {"view": ["admin"], "edit": ["admin"]}
        updated, changed = sync_realm.restrict_login_attributes(profile)
        self.assertEqual(changed, ["email", "username"])
        self.assertEqual(by_name(updated)["email"]["permissions"], {"view": BOTH, "edit": ["admin"]})

    def test_invalid_profile_is_refused_without_values(self) -> None:
        for profile in (None, {}, {"attributes": "x"}, {"attributes": [attribute("firstName", BOTH)]},
                        {"attributes": [{"name": "email", "permissions": []}, attribute("username", BOTH)]}):
            with self.assertRaises(sync_realm.SyncError):
                sync_realm.restrict_login_attributes(profile)

    def test_desired_realm_profile_already_satisfies_the_sync_step(self) -> None:
        profile = desired_profile()
        _, changed = sync_realm.restrict_login_attributes(profile)
        self.assertEqual(changed, [])
        attributes = by_name(profile)
        self.assertEqual(list(attributes), ["username", "email", "firstName", "lastName"])
        for name in ("firstName", "lastName"):
            self.assertEqual(attributes[name]["permissions"], {"view": BOTH, "edit": BOTH})
            self.assertEqual(attributes[name]["required"], {"roles": ["user"]})
        self.assertEqual(attributes["email"]["required"], {"roles": ["user"]})
        self.assertEqual([g["name"] for g in profile["groups"]], ["user-metadata"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
