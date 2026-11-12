// Назначение проверок администратором: REV-01 (название, статус, SME), REV-02, REV-03, REV-04, NOT-27, ADM-06.
import { useState } from "react";
import { useSearchParams } from "react-router";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFormat } from "@/i18n/format";
import { ConfirmAction, ProfileStatusBadge, ProtoPage } from "@/prototype/components";
import type { ProtoProfile, ProtoState } from "@/prototype/data";
import { localized, useDictionary } from "@/prototype/i18n";
import { accountName, organizationName } from "@/prototype/rules";
import { useProto, useProtoUpdate } from "@/prototype/store";

import { assignmentsTexts } from "./assignments-texts";
import { ChoiceField } from "./fields";
import { texts } from "./texts";

/**
 * Строка очереди для администратора — только название организации, статус и SME (REV-01, ADM-06).
 * Остальные поля профиля сюда не попадают, и экран их не читает.
 */
interface QueueRow {
  profileId: string;
  name: string;
  status: ProtoProfile["status"];
  pendingChanges: boolean;
  smeId: string | null;
}

/** Очередь проверки (REV-04): Submitted, Under review и ожидающие изменения Verified. */
function queueOf(state: ProtoState): QueueRow[] {
  return state.profiles
    .filter(
      (p) => p.status === "submitted" || p.status === "under_review" || (p.status === "verified" && p.pendingChanges),
    )
    .map((p) => ({
      profileId: p.id,
      name: organizationName(state, p.organizationId),
      status: p.status,
      pendingChanges: p.pendingChanges,
      smeId: p.assignedExpertId,
    }));
}

const FILTERS = ["all", "unassigned"] as const;

export function AssignmentsScreen() {
  const t = useDictionary(assignmentsTexts);
  const admin = useDictionary(texts);
  const format = useFormat();
  const [params, setParams] = useSearchParams();
  const filter = FILTERS.find((f) => f === params.get("show")) ?? "all";
  const state = useProto();
  const queue = queueOf(state);
  const rows = filter === "unassigned" ? queue.filter((r) => r.smeId === null) : queue;
  const smes = state.accounts.filter((a) => a.role === "expert" && a.state === "active");

  return (
    <ProtoPage title={t("title")} description={t("description")}>
      <Tabs
        value={filter}
        onValueChange={(value) => {
          if (value === "unassigned") setParams({ show: value }, { replace: true });
          else setParams({}, { replace: true });
        }}
      >
        <TabsList aria-label={t("filter")}>
          {FILTERS.map((f) => (
            <TabsTrigger key={f} value={f}>
              {t(f)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {rows.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{queue.length === 0 ? t("empty") : t("emptyFiltered")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("manufacturer")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead>{t("sme")}</TableHead>
              <TableHead>{admin("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.profileId}>
                <TableCell className="whitespace-normal">{row.name}</TableCell>
                <TableCell>
                  <ProfileStatusBadge status={row.status} pendingChanges={row.pendingChanges} />
                </TableCell>
                <TableCell className={row.smeId ? undefined : "text-muted-foreground"}>
                  {row.smeId ? accountName(state, row.smeId) : admin("notAssigned")}
                </TableCell>
                <TableCell>
                  <AssignAction row={row} smes={smes.map((s) => ({ value: s.id, label: s.fullName }))} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("workload")}</CardTitle>
        </CardHeader>
        <CardContent>
          {smes.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noSme")}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {smes.map((sme) => (
                <li key={sme.id} className="flex flex-wrap justify-between gap-2">
                  <span>{sme.fullName}</span>
                  <span className="text-muted-foreground">
                    {t("workloadCount", { count: format.number(queue.filter((r) => r.smeId === sme.id).length) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </ProtoPage>
  );
}

function AssignAction({ row, smes }: { row: QueueRow; smes: { value: string; label: string }[] }) {
  const t = useDictionary(assignmentsTexts);
  const update = useProtoUpdate();
  const names = useProto((s) => (id: string | null) => accountName(s, id));
  const [sme, setSme] = useState<string | null>(row.smeId);
  const choices = smes.filter((s) => s.value !== row.smeId);

  const assign = () => {
    if (!sme) return;
    const to = names(sme);
    update(
      {
        action: row.smeId ? "profile.reassign" : "profile.assign",
        subject: { type: "profile", id: row.profileId, label: row.name },
        summary: row.smeId
          ? localized(assignmentsTexts, "reassigned", { from: names(row.smeId), sme: to })
          : localized(assignmentsTexts, "assigned", { sme: to }),
      },
      (draft) => {
        draft.profiles.find((p) => p.id === row.profileId)!.assignedExpertId = sme;
      },
    );
  };

  return (
    <ConfirmAction
      variant="outline"
      size="sm"
      label={row.smeId ? t("reassign") : t("assign")}
      title={t("assignTitle", { name: row.name })}
      description={t("assignDescription")}
      confirmLabel={row.smeId ? t("reassign") : t("assign")}
      disabled={choices.length === 0}
      confirmDisabled={!sme || sme === row.smeId}
      onConfirm={assign}
    >
      <ChoiceField label={t("chooseSme")} value={sme === row.smeId ? null : sme} options={choices} onChange={setSme} />
    </ConfirmAction>
  );
}
