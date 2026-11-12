// Профили в работе SME — прототип очереди на общих демо-данных (REV-01, REV-02, REV-03, REV-04).
// SME видит все профили, в том числе невидимые операторам (раздел 4: «all profiles»), и берёт профиль себе.
import { PROFILE_STATUSES } from "@imbc/contracts";
import { Link, useSearchParams } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Select, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/i18n/format";
import { DueDiligenceBadge, ProfileStatusBadge, ProtoPage } from "@/prototype/components";
import type { ProtoProfile } from "@/prototype/data";
import { localized, useDictionary } from "@/prototype/i18n";
import { useCommonTexts } from "@/prototype/labels";
import { accountName, ddResult, isVisible } from "@/prototype/rules";
import { useProto, useProtoUpdate } from "@/prototype/store";
import { FilterSelectContent } from "@/routes/app/filter-select";

import { useExpertId } from "./actor";
import { dossierPath } from "./paths";
import { inQueue, receivedAt } from "./review";
import { texts } from "./texts";

const ALL = "all";
const SCOPES = ["queue", "all"] as const;
const STATUS_FILTERS = [ALL, ...PROFILE_STATUSES, "pending_changes"] as const;
const ASSIGNEE_FILTERS = [ALL, "me", "unassigned", "others"] as const;

const pick = <T extends string>(values: readonly T[], value: string | null, fallback: T): T =>
  (values as readonly (string | null)[]).includes(value) ? (value as T) : fallback;

export function ProfilesScreen() {
  const t = useDictionary(texts);
  const common = useCommonTexts();
  const format = useFormat();
  const me = useExpertId();
  const update = useProtoUpdate();
  const state = useProto();
  const [params, setParams] = useSearchParams();

  // Фильтры — в адресе: это выбор ведущего, не данные (в журнал не пишутся).
  const scope = pick(SCOPES, params.get("scope"), "queue");
  const status = pick(STATUS_FILTERS, params.get("status"), ALL);
  const assignee = pick(ASSIGNEE_FILTERS, params.get("assignee"), ALL);
  const query = params.get("q") ?? "";
  const from = params.get("from") ?? "";
  const set = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null || value === "" || value === ALL) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const rows = state.profiles
    .filter((p) => scope === "all" || inQueue(p))
    .filter((p) => (status === ALL ? true : status === "pending_changes" ? p.pendingChanges : p.status === status))
    .filter((p) =>
      assignee === "me"
        ? p.assignedExpertId === me
        : assignee === "unassigned"
          ? p.assignedExpertId === null
          : assignee === "others"
            ? p.assignedExpertId !== null && p.assignedExpertId !== me
            : true,
    )
    .filter((p) => {
      const q = query.trim().toLowerCase();
      return !q || p.nameRu.toLowerCase().includes(q) || p.nameEn.toLowerCase().includes(q) || p.bin.includes(q);
    })
    .filter((p) => !from || receivedAt(p).slice(0, 10) >= from)
    .sort((a, b) => receivedAt(a).localeCompare(receivedAt(b)));

  const take = (p: ProtoProfile) =>
    update(
      {
        action: "profile.take",
        subject: { type: "profile", id: p.id, label: p.nameRu },
        summary: localized(texts, "auditTake"),
      },
      (draft) => {
        draft.profiles.find((x) => x.id === p.id)!.assignedExpertId = me;
      },
    );

  const scopeItems = SCOPES.map((value) => ({ value, label: t(`scope.${value}`) }));
  const statusItems = STATUS_FILTERS.map((value) => ({
    value,
    label:
      value === ALL
        ? t("filterAll")
        : value === "pending_changes"
          ? common("pendingChanges")
          : common(`profileStatus.${value}`),
  }));
  const assigneeItems = ASSIGNEE_FILTERS.map((value) => ({
    value,
    label: value === ALL ? t("filterAll") : t(`assignee.${value}`),
  }));

  return (
    <ProtoPage title={t("profilesTitle")} description={t("profilesHint")}>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={scopeItems}
          value={scope}
          onValueChange={(v) => v !== null && set("scope", v === "queue" ? null : v)}
        >
          <SelectTrigger className="w-auto" aria-label={t("scopeFilter")}>
            <span className="text-muted-foreground">{t("scopeFilter")}:</span>
            <SelectValue />
          </SelectTrigger>
          <FilterSelectContent>
            {scopeItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </FilterSelectContent>
        </Select>
        <Select items={statusItems} value={status} onValueChange={(v) => v !== null && set("status", v)}>
          <SelectTrigger className="w-auto" aria-label={t("statusFilter")}>
            <span className="text-muted-foreground">{t("statusFilter")}:</span>
            <SelectValue />
          </SelectTrigger>
          <FilterSelectContent>
            {statusItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </FilterSelectContent>
        </Select>
        <Select items={assigneeItems} value={assignee} onValueChange={(v) => v !== null && set("assignee", v)}>
          <SelectTrigger className="w-auto" aria-label={t("assigneeFilter")}>
            <span className="text-muted-foreground">{t("assigneeFilter")}:</span>
            <SelectValue />
          </SelectTrigger>
          <FilterSelectContent>
            {assigneeItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </FilterSelectContent>
        </Select>
        <Input
          className="w-full sm:w-64"
          aria-label={t("manufacturerFilter")}
          placeholder={t("manufacturerFilter")}
          value={query}
          onChange={(e) => set("q", e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("receivedFrom")}
          <Input className="w-auto" type="date" value={from} onChange={(e) => set("from", e.target.value)} />
        </label>
      </div>

      <div className="text-sm text-muted-foreground">{t("found", { count: format.number(rows.length) })}</div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("manufacturer")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead>{t("assignedSme")}</TableHead>
              <TableHead>{t("received")}</TableHead>
              <TableHead>{t("dueDiligence")}</TableHead>
              <TableHead>{t("visibleToOperators")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => {
              const dd = ddResult(state, p.id);
              const canTake = p.assignedExpertId === null && inQueue(p);
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link className="font-medium underline-offset-4 hover:underline" to={dossierPath(p.id)}>
                      {p.nameRu}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">{p.bin}</div>
                  </TableCell>
                  <TableCell>
                    <ProfileStatusBadge status={p.status} pendingChanges={p.pendingChanges} />
                  </TableCell>
                  <TableCell className={p.assignedExpertId ? undefined : "text-muted-foreground"}>
                    {p.assignedExpertId ? accountName(state, p.assignedExpertId) : t("unassigned")}
                  </TableCell>
                  <TableCell className="text-xs">{format.date(receivedAt(p))}</TableCell>
                  <TableCell>{dd && <DueDiligenceBadge result={dd} />}</TableCell>
                  <TableCell>
                    {isVisible(state, p) ? (
                      <Badge variant="secondary">{t("yes")}</Badge>
                    ) : (
                      <Badge variant="outline">{t("no")}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {canTake && (
                      <Button size="sm" aria-label={t("takeNamed", { name: p.nameRu })} onClick={() => take(p)}>
                        {t("take")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {rows.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyDescription>{scope === "queue" ? t("queueEmpty") : t("filterEmpty")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </ProtoPage>
  );
}
