// Учётные данные pull API: ADM-07, OPR-36, OPR-38 — выдать и отозвать; ключ показывается один раз. Ключи ненастоящие.
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import { ConfirmAction, ProtoPage } from "@/prototype/components";
import type { ApiCredential } from "@/prototype/data";
import { localized, useDictionary } from "@/prototype/i18n";
import { accountName, organizationName } from "@/prototype/rules";
import { newId, nowIso, useProto, useProtoUpdate } from "@/prototype/store";

import { useAdminAccountId } from "./actor";
import { apiAccessTexts } from "./api-access-texts";
import { ChoiceField } from "./fields";
import { texts } from "./texts";

/** Заведомо ненастоящий ключ: тот же вид, что в демо-данных (`DEMO-NOT-A-SECRET-…`). */
function fakeKey(): string {
  const tail = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .toUpperCase()
    .padStart(4, "0");
  return `DEMO-NOT-A-SECRET-${tail}`;
}

export function ApiAccessScreen() {
  const t = useDictionary(apiAccessTexts);
  const admin = useDictionary(texts);
  const format = useFormat();
  const update = useProtoUpdate();
  const adminId = useAdminAccountId();
  const state = useProto();
  const operators = state.organizations.filter((o) => o.type === "operator");
  const credentials = [...state.apiCredentials].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  // Только что выданный ключ — состояние экрана: после ухода со страницы он не показывается (ADM-07).
  const [shown, setShown] = useState<{ org: string; clientId: string; key: string } | null>(null);

  const issue = (orgId: string) => {
    const id = newId("api");
    const key = fakeKey();
    const org = organizationName(state, orgId);
    const sequence = state.apiCredentials.filter((c) => c.operatorOrgId === orgId).length + 1;
    const clientId = `demo-client-${orgId.replace(/^org-/, "")}-${String(sequence).padStart(4, "0")}`;
    update(
      {
        action: "api_credential.issue",
        subject: { type: "api_credential", id, label: org },
        summary: localized(apiAccessTexts, "issuedAudit"),
      },
      (draft) => {
        draft.apiCredentials.push({
          id,
          operatorOrgId: orgId,
          clientId,
          secretSample: key,
          issuedAt: nowIso(),
          issuedBy: adminId,
          revokedAt: null,
          revokedBy: null,
        });
      },
    );
    setShown({ org, clientId, key });
  };

  const revoke = (credential: ApiCredential) =>
    update(
      {
        action: "api_credential.revoke",
        subject: {
          type: "api_credential",
          id: credential.id,
          label: organizationName(state, credential.operatorOrgId),
        },
        summary: localized(apiAccessTexts, "revokedAudit"),
      },
      (draft) => {
        const target = draft.apiCredentials.find((c) => c.id === credential.id)!;
        target.revokedAt = nowIso();
        target.revokedBy = adminId;
      },
    );

  return (
    <ProtoPage
      title={t("title")}
      description={t("description")}
      actions={<IssueCredentials operators={operators.map((o) => ({ value: o.id, label: o.name }))} onIssue={issue} />}
    >
      {shown && (
        <Alert>
          <AlertTitle>{t("keyTitle", { org: shown.org })}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{t("keyOnce")}</span>
            <span>
              {t("clientId")}: <code className="font-mono">{shown.clientId}</code>
            </span>
            <span>
              {t("key")}: <code className="font-mono break-all">{shown.key}</code> · {t("fake")}
            </span>
            <span>
              <Button size="sm" variant="outline" onClick={() => setShown(null)}>
                {t("dismiss")}
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}

      {credentials.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{t("empty")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("organization")}</TableHead>
              <TableHead>{t("clientId")}</TableHead>
              <TableHead>{t("issued")}</TableHead>
              <TableHead>{t("state")}</TableHead>
              <TableHead>{admin("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {credentials.map((credential) => (
              <TableRow key={credential.id}>
                <TableCell className="whitespace-normal">{organizationName(state, credential.operatorOrgId)}</TableCell>
                <TableCell className="font-mono text-xs">{credential.clientId}</TableCell>
                <TableCell>
                  {format.dateTime(credential.issuedAt)}
                  <span className="block text-xs text-muted-foreground">{accountName(state, credential.issuedBy)}</span>
                </TableCell>
                <TableCell>
                  {credential.revokedAt ? (
                    <Badge variant="outline">{t("revokedAt", { at: format.date(credential.revokedAt) })}</Badge>
                  ) : (
                    <Badge>{t("active")}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {!credential.revokedAt && (
                    <ConfirmAction
                      variant="destructive"
                      size="sm"
                      label={t("revoke")}
                      title={t("revokeTitle", { client: credential.clientId })}
                      description={t("revokeDescription")}
                      confirmLabel={t("revoke")}
                      onConfirm={() => revoke(credential)}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ProtoPage>
  );
}

function IssueCredentials({
  operators,
  onIssue,
}: {
  operators: { value: string; label: string }[];
  onIssue: (orgId: string) => void;
}) {
  const t = useDictionary(apiAccessTexts);
  const [org, setOrg] = useState<string | null>(null);
  return (
    <ConfirmAction
      label={t("issue")}
      title={t("issueTitle")}
      description={t("issueDescription")}
      confirmLabel={t("issueConfirm")}
      disabled={operators.length === 0}
      confirmDisabled={org === null}
      onConfirm={() => {
        if (org) onIssue(org);
        setOrg(null);
      }}
    >
      <ChoiceField label={t("organization")} value={org} options={operators} onChange={setOrg} />
    </ConfirmAction>
  );
}
