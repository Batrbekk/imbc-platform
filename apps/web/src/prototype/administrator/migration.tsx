// Приглашение перенесённых производителей: ADM-04, NOT-25, MIG-15, GEN-01; ADM-06 — только название и почта компании.
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import { ConfirmAction, ProtoPage } from "@/prototype/components";
import type { MigrationInvite, ProtoState } from "@/prototype/data";
import { localized, translate, useDictionary } from "@/prototype/i18n";
import { organizationName } from "@/prototype/rules";
import { getProtoState, nowIso, useProto } from "@/prototype/store";

import { useGuardedUpdate } from "./actor";
import { TextField } from "./fields";
import { MIGRATION_SUBJECT, RUN_ACTION } from "./migration-model";
import { migrationTexts } from "./migration-texts";
import { isEmail, texts } from "./texts";

type InviteState = "invited" | "ready" | "no_email" | "invalid_email";

function inviteState(invite: MigrationInvite): InviteState {
  if (invite.invitedAt) return "invited";
  if (!invite.email) return "no_email";
  return isEmail(invite.email) ? "ready" : "invalid_email";
}

export function MigrationScreen() {
  const t = useDictionary(migrationTexts);
  const format = useFormat();
  const update = useGuardedUpdate();
  const state = useProto();
  const invites = state.migrationInvites;
  const ready = invites.filter((i) => inviteState(i) === "ready");
  const unusable = invites.filter((i) => {
    const s = inviteState(i);
    return s === "no_email" || s === "invalid_email";
  });
  // Последнее отправленное приглашение: запуск из журнала или время у записи переноса (их может
  // быть только во втором случае — исходные данные).
  const lastSent = [
    ...state.audit.filter((e) => e.action === RUN_ACTION).map((e) => e.at),
    ...invites.flatMap((i) => (i.invitedAt ? [i.invitedAt] : [])),
  ]
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
    .at(-1);

  const run = () => {
    const at = nowIso();
    // Счёт — по текущему состоянию: другая вкладка могла сбросить или изменить данные.
    const current = getProtoState().migrationInvites;
    const invited = String(current.filter((i) => inviteState(i) === "ready").length);
    const skipped = String(current.filter((i) => ["no_email", "invalid_email"].includes(inviteState(i))).length);
    update(
      {
        action: RUN_ACTION,
        subject: { type: "account", id: MIGRATION_SUBJECT, label: translate(migrationTexts, "en", "subjectLabel") },
        summary: localized(migrationTexts, "ran", { invited, skipped }),
      },
      (draft) => inviteAll(draft, at) > 0,
    );
  };

  return (
    <ProtoPage
      title={t("title")}
      description={
        <>
          {t("description")} {lastSent ? t("lastRun", { at: format.dateTime(lastSent) }) : t("neverRun")}
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
function inviteAll(draft: ProtoState, at: string): number {
  let invited = 0;
  for (const invite of draft.migrationInvites) {
    const email = invite.email;
    if (inviteState(invite) !== "ready" || !email) continue;
    invite.invitedAt = at;
    invited += 1;
    const account = draft.accounts.find((a) => a.organizationId === invite.organizationId && a.role === "manufacturer");
    if (account) continue;
    draft.accounts.push({
      id: `acc-${invite.organizationId}`,
      organizationId: invite.organizationId,
      email,
      fullName: draft.organizations.find((o) => o.id === invite.organizationId)?.name ?? email,
      role: "manufacturer",
      state: "invited",
      lastSignInAt: null,
      invitedAt: at,
    });
  }
  return invited;
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
  const update = useGuardedUpdate();
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
            const target = draft.migrationInvites.find((i) => i.id === invite.id);
            if (!target) return false;
            target.email = email.trim();
            return true;
          },
        );
        setEmail("");
      }}
    >
      <TextField label={t("newEmail")} type="email" value={email} onChange={setEmail} error={error} />
    </ConfirmAction>
  );
}
