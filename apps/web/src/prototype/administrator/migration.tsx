// Приглашение перенесённых производителей: ADM-04, NOT-25, MIG-15, GEN-01; ADM-06 — только название и почта компании.
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import { ConfirmAction, ProtoPage } from "@/prototype/components";
import type { MigrationInvite, ProtoState } from "@/prototype/data";
import { localized, useDictionary } from "@/prototype/i18n";
import { organizationName } from "@/prototype/rules";
import { nowIso, useProto, useProtoUpdate } from "@/prototype/store";

import { TextField } from "./fields";
import { migrationTexts } from "./migration-texts";
import { isEmail, texts } from "./texts";

type InviteState = "invited" | "ready" | "no_email" | "invalid_email";

function inviteState(invite: MigrationInvite): InviteState {
  if (invite.invitedAt) return "invited";
  if (!invite.email) return "no_email";
  return isEmail(invite.email) ? "ready" : "invalid_email";
}

const RUN_ACTION = "account.invite_migrated";

export function MigrationScreen() {
  const t = useDictionary(migrationTexts);
  const format = useFormat();
  const update = useProtoUpdate();
  const state = useProto();
  const invites = state.migrationInvites;
  const ready = invites.filter((i) => inviteState(i) === "ready");
  const unusable = invites.filter((i) => {
    const s = inviteState(i);
    return s === "no_email" || s === "invalid_email";
  });
  const lastRun = state.audit.filter((e) => e.action === RUN_ACTION).at(-1);

  const run = () => {
    const at = nowIso();
    update(
      {
        action: RUN_ACTION,
        subject: { type: "account", id: "migration", label: String(ready.length) },
        summary: localized(migrationTexts, "ran", { invited: String(ready.length), skipped: String(unusable.length) }),
      },
      (draft) => inviteAll(draft, at),
    );
  };

  return (
    <ProtoPage
      title={t("title")}
      description={
        <>
          {t("description")} {lastRun ? t("lastRun", { at: format.dateTime(lastRun.at) }) : t("neverRun")}
        </>
      }
      actions={
        <ConfirmAction
          label={t("run")}
          title={t("runTitle")}
          description={t("runDescription")}
          confirmLabel={t("runConfirm")}
          disabled={ready.length === 0}
          onConfirm={run}
        />
      }
    >
      {ready.length === 0 && <p className="text-sm text-muted-foreground">{t("nothingToRun")}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("organization")}</TableHead>
            <TableHead>{t("email")}</TableHead>
            <TableHead>{t("state")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invites.map((invite) => (
            <TableRow key={invite.id}>
              <TableCell className="whitespace-normal">{organizationName(state, invite.organizationId)}</TableCell>
              <TableCell className="break-all whitespace-normal">{invite.email ?? "—"}</TableCell>
              <TableCell>
                <InviteBadge invite={invite} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Card>
        <CardHeader>
          <CardTitle>{t("report")}</CardTitle>
          <CardDescription>{t("reportHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {unusable.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("reportEmpty")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {unusable.map((invite) => (
                <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <span className="text-sm">
                    {organizationName(state, invite.organizationId)} —{" "}
                    {inviteState(invite) === "no_email" ? t("noEmail") : t("invalidEmail")}
                  </span>
                  <FixEmail invite={invite} name={organizationName(state, invite.organizationId)} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </ProtoPage>
  );
}

/** Приглашение: время у записи переноса и аккаунт производителя в состоянии invited (GEN-01, ADM-04). */
function inviteAll(draft: ProtoState, at: string) {
  for (const invite of draft.migrationInvites) {
    if (inviteState(invite) !== "ready") continue;
    invite.invitedAt = at;
    const account = draft.accounts.find((a) => a.organizationId === invite.organizationId && a.role === "manufacturer");
    if (account) continue;
    draft.accounts.push({
      id: `acc-${invite.organizationId}`,
      organizationId: invite.organizationId,
      email: invite.email!,
      fullName: draft.organizations.find((o) => o.id === invite.organizationId)?.name ?? invite.email!,
      role: "manufacturer",
      state: "invited",
      lastSignInAt: null,
      invitedAt: at,
    });
  }
}

function InviteBadge({ invite }: { invite: MigrationInvite }) {
  const t = useDictionary(migrationTexts);
  const format = useFormat();
  const state = inviteState(invite);
  if (state === "invited")
    return <Badge variant="secondary">{t("invitedAt", { at: format.date(invite.invitedAt) })}</Badge>;
  if (state === "ready") return <Badge variant="outline">{t("notInvited")}</Badge>;
  return <Badge variant="destructive">{state === "no_email" ? t("noEmail") : t("invalidEmail")}</Badge>;
}

function FixEmail({ invite, name }: { invite: MigrationInvite; name: string }) {
  const t = useDictionary(migrationTexts);
  const admin = useDictionary(texts);
  const update = useProtoUpdate();
  const taken = useProto((s) => s.accounts.map((a) => a.email.toLowerCase()));
  const [email, setEmail] = useState("");
  const error = !isEmail(email)
    ? admin("emailInvalid")
    : taken.includes(email.trim().toLowerCase())
      ? admin("emailTaken")
      : null;
  return (
    <ConfirmAction
      variant="outline"
      size="sm"
      label={t("fix")}
      title={t("fixTitle", { name })}
      description={t("fixDescription")}
      confirmLabel={t("fix")}
      confirmDisabled={error !== null}
      onConfirm={() => {
        update(
          {
            action: "organization.migration_email",
            subject: { type: "organization", id: invite.organizationId, label: name },
            summary: localized(migrationTexts, "fixed", { name }),
          },
          (draft) => {
            draft.migrationInvites.find((i) => i.id === invite.id)!.email = email.trim();
          },
        );
        setEmail("");
      }}
    >
      <TextField label={t("newEmail")} type="email" value={email} onChange={setEmail} error={error} />
    </ConfirmAction>
  );
}
