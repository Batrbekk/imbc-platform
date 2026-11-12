// Журнал аудита администратора: AUD-01, AUD-02, AUD-03 — только события аккаунтов (`isAccountEvent`).
import { useSearchParams } from "react-router";

import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFormat } from "@/i18n/format";
import type { AuditSubjectType } from "@/prototype/data";
import { ProtoPage } from "@/prototype/components";
import { ACCOUNT_EVENT_SUBJECTS, isAccountEvent } from "@/prototype/data/audit";
import { useDictionary, useProtoLocale } from "@/prototype/i18n";
import { useCommonTexts } from "@/prototype/labels";
import { accountName, organizationName } from "@/prototype/rules";
import { useProto } from "@/prototype/store";

import { auditTexts } from "./audit-texts";
import { MIGRATION_SUBJECT } from "./migration-model";
import { migrationTexts } from "./migration-texts";

/** Виды объектов событий аккаунтов — те же, что отбирает `isAccountEvent`. */
const SUBJECTS = ["account", "organization", "api_credential"] as const satisfies readonly AuditSubjectType[];
const FILTERS = ["all", ...SUBJECTS.filter((s) => ACCOUNT_EVENT_SUBJECTS.includes(s))] as const;

export function AuditScreen() {
  const t = useDictionary(auditTexts);
  const migration = useDictionary(migrationTexts);
  const common = useCommonTexts();
  const format = useFormat();
  const locale = useProtoLocale();
  const state = useProto();
  const [params, setParams] = useSearchParams();
  const filter = FILTERS.find((f) => f === params.get("object")) ?? "all";
  // События других видов не показываются и не считаются (AUD-03).
  const events = state.audit.filter(isAccountEvent).reverse();
  const shown = filter === "all" ? events : events.filter((e) => e.subject.type === filter);

  return (
    <ProtoPage title={t("title")} description={t("description")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs
          value={filter}
          onValueChange={(value) => {
            if (typeof value === "string" && value !== "all") setParams({ object: value }, { replace: true });
            else setParams({}, { replace: true });
          }}
        >
          <TabsList aria-label={t("filter")} className="h-auto flex-wrap">
            {FILTERS.map((f) => (
              <TabsTrigger key={f} value={f}>
                {f === "all" ? t("all") : t(`subject.${f}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="text-sm text-muted-foreground">{t("count", { count: format.number(shown.length) })}</span>
      </div>

      {shown.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyDescription>{events.length === 0 ? t("empty") : t("emptyFiltered")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("at")}</TableHead>
              <TableHead>{t("who")}</TableHead>
              <TableHead>{t("organization")}</TableHead>
              <TableHead>{t("what")}</TableHead>
              <TableHead>{t("object")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((event) => (
              <TableRow key={event.id}>
                <TableCell>{format.dateTime(event.at)}</TableCell>
                {/* Автор — по ключу демо-аккаунта; почта и имя сеанса из события не показываются. */}
                <TableCell>
                  {event.actor.accountId
                    ? accountName(state, event.actor.accountId)
                    : common(`role.${event.actor.role}`)}
                </TableCell>
                <TableCell>{organizationName(state, event.actor.organizationId)}</TableCell>
                <TableCell className="min-w-56 whitespace-normal">{event.summary[locale]}</TableCell>
                <TableCell className="break-all whitespace-normal">
                  {event.subject.id === MIGRATION_SUBJECT ? migration("subjectLabel") : event.subject.label}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ProtoPage>
  );
}
