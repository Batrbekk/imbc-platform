// Операторы и производители для генерального директора IMBC — только чтение (GEN-04): кто с кем работает и
// отметки works-with с решением IMBC (IMBC-16, OPR-19, OPR-20), отметки визитов (IMBC-04, OPR-21), заметки всех
// организаций операторов (OPR-22: директор их видит, ограничение GEN-12 — для операторов). Фильтры — в адресе.
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFormat } from "@/i18n/format";
import { MarkStateBadge, ProtoPage } from "@/prototype/components";
import type { ProtoState } from "@/prototype/data";
import { useDictionary } from "@/prototype/i18n";
import { useCommonTexts } from "@/prototype/labels";
import { accountName, organizationName, profileById, worksWithCount } from "@/prototype/rules";
import { useProto } from "@/prototype/store";

import { activityTexts } from "./activity-texts";
import { FilterSelect } from "./filter-select";
import { ALL, dossierPath, pick, useAddress } from "./paths";

const TABS = ["marks", "visits", "notes"] as const;
const MARK_STATES = [ALL, "waiting", "validated", "rejected"] as const;
const FILTER_KEYS = ["org", "q", "state"] as const;

/** Последняя подтверждённая отметка организации по профилю (IMBC-16): true, false или нет отметки. */
function latestValidated(state: ProtoState, orgId: string, profileId: string): boolean | null {
  const marks = state.worksWithMarks
    .filter((m) => m.operatorOrgId === orgId && m.profileId === profileId && m.state === "validated")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return marks.at(-1)?.value ?? null;
}

export function OperatorsScreen() {
  const t = useDictionary(activityTexts);
  const common = useCommonTexts();
  const format = useFormat();
  const state = useProto();
  const { params, set, clear } = useAddress();

  const operators = state.organizations.filter((o) => o.type === "operator");
  const majors = state.organizations.filter((o) => o.majorOperator).length;
  const org = pick([ALL, ...operators.map((o) => o.id)], params.get("org"), ALL);
  const tab = pick(TABS, params.get("tab"), "marks");
  const markState = pick(MARK_STATES, params.get("state"), ALL);
  const query = params.get("q") ?? "";
  const filtered = FILTER_KEYS.some((key) => params.has(key));

  const byOrg = (orgId: string) => org === ALL || orgId === org;
  const byName = (profileId: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const p = profileById(state, profileId);
    return !!p && (p.nameRu.toLowerCase().includes(q) || p.nameEn.toLowerCase().includes(q) || p.bin.includes(q));
  };
  const name = (profileId: string) => profileById(state, profileId)?.nameRu ?? profileId;
  const profileLink = (profileId: string) =>
    profileById(state, profileId) ? (
      <Link className="font-medium underline-offset-4 hover:underline" to={dossierPath(profileId, "operators")}>
        {name(profileId)}
      </Link>
    ) : (
      <span>{profileId}</span>
    );

  const columns = operators.filter((o) => byOrg(o.id));
  const matrixProfiles = state.profiles.filter(
    (p) => byName(p.id) && state.worksWithMarks.some((m) => m.profileId === p.id && byOrg(m.operatorOrgId)),
  );
  const marks = state.worksWithMarks
    .filter((m) => byOrg(m.operatorOrgId) && byName(m.profileId) && (markState === ALL || m.state === markState))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const visits = state.visitMarks
    .filter((v) => byOrg(v.operatorOrgId) && byName(v.profileId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const notes = state.operatorNotes
    .filter((n) => byOrg(n.operatorOrgId) && byName(n.profileId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const orgItems = [{ value: ALL, label: t("all") }, ...operators.map((o) => ({ value: o.id, label: o.name }))];
  const stateItems = MARK_STATES.map((value) => ({
    value,
    label: value === ALL ? t("all") : common(`markState.${value}`),
  }));
  const decided = (by: string | null, at: string | null) =>
    by ? t("decidedBy", { name: accountName(state, by), date: format.dateTime(at) }) : t("notDecided");
  const empty = (text: string) => (
    <Empty className="border">
      <EmptyHeader>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );

  return (
    <ProtoPage hideReset title={t("operatorsTitle")} description={t("operatorsHint")}>
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label={t("operatorFilter")} value={org} items={orgItems} onChange={(v) => set("org", v)} />
        <Input
          className="w-full sm:w-64"
          aria-label={t("manufacturerSearch")}
          placeholder={t("manufacturerSearch")}
          value={query}
          onChange={(e) => set("q", e.target.value)}
        />
        {filtered && (
          <Button variant="ghost" onClick={() => clear(FILTER_KEYS)}>
            {t("clearFilters")}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("matrixTitle")}</CardTitle>
          <CardDescription>{t("matrixHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          {matrixProfiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("matrixEmpty")}</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("manufacturer")}</TableHead>
                    {columns.map((o) => (
                      <TableHead key={o.id}>{o.name}</TableHead>
                    ))}
                    <TableHead>{t("majors")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matrixProfiles.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-normal">{profileLink(p.id)}</TableCell>
                      {columns.map((o) => {
                        const value = latestValidated(state, o.id, p.id);
                        const waiting = state.worksWithMarks
                          .filter((m) => m.operatorOrgId === o.id && m.profileId === p.id && m.state === "waiting")
                          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                          .at(-1);
                        return (
                          <TableCell key={o.id}>
                            <span className="inline-flex flex-wrap gap-1">
                              {value ? <Badge variant="secondary">{t("worksWith")}</Badge> : t("notWorking")}
                              {waiting && (
                                <Badge variant="outline">{waiting.value ? t("waitingSet") : t("waitingRemove")}</Badge>
                              )}
                            </span>
                          </TableCell>
                        );
                      })}
                      <TableCell>
                        {t("ofMajors", {
                          count: format.number(worksWithCount(state, p.id)),
                          total: format.number(majors),
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(value) => set("tab", String(value), "marks")}>
        <div className="max-w-full overflow-x-auto pb-1">
          <TabsList>
            {TABS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {t(`tab.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="marks" className="flex flex-col gap-3">
          <div>
            <FilterSelect
              label={t("stateFilter")}
              value={markState}
              items={stateItems}
              onChange={(v) => set("state", v)}
            />
          </div>
          {marks.length === 0 ? (
            empty(t("marksEmpty"))
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("manufacturer")}</TableHead>
                    <TableHead>{t("operator")}</TableHead>
                    <TableHead>{t("change")}</TableHead>
                    <TableHead>{t("created")}</TableHead>
                    <TableHead>{t("state")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {marks.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-normal">{profileLink(m.profileId)}</TableCell>
                      <TableCell className="whitespace-normal">{organizationName(state, m.operatorOrgId)}</TableCell>
                      <TableCell>{m.value ? t("changeSet") : t("changeRemoved")}</TableCell>
                      <TableCell className="whitespace-normal">
                        {accountName(state, m.createdBy)}
                        <div className="text-xs text-muted-foreground">{format.dateTime(m.createdAt)}</div>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <MarkStateBadge state={m.state} />
                        <div className="text-xs text-muted-foreground">{decided(m.decidedBy, m.decidedAt)}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="visits">
          {visits.length === 0 ? (
            empty(t("visitsEmpty"))
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("manufacturer")}</TableHead>
                    <TableHead>{t("operator")}</TableHead>
                    <TableHead>{t("visitDate")}</TableHead>
                    <TableHead>{t("visitFile")}</TableHead>
                    <TableHead>{t("state")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visits.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="whitespace-normal">{profileLink(v.profileId)}</TableCell>
                      <TableCell className="whitespace-normal">
                        {organizationName(state, v.operatorOrgId)}
                        <div className="text-xs text-muted-foreground">{accountName(state, v.createdBy)}</div>
                      </TableCell>
                      <TableCell>{format.date(v.visitedOn)}</TableCell>
                      <TableCell className="break-all whitespace-normal">{v.file?.name ?? t("noFile")}</TableCell>
                      <TableCell className="whitespace-normal">
                        <Badge variant={v.decision === "rejected" ? "destructive" : "outline"}>
                          {t(`visit.${v.decision}`)}
                        </Badge>
                        <div className="text-xs text-muted-foreground">{decided(v.decidedBy, v.decidedAt)}</div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="notes">
          {notes.length === 0 ? (
            empty(t("notesEmpty"))
          ) : (
            <ul className="flex flex-col gap-3">
              {notes.map((n) => (
                <li key={n.id} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    {profileLink(n.profileId)}
                    <span className="text-xs text-muted-foreground">{format.dateTime(n.createdAt)}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {organizationName(state, n.operatorOrgId)} · {accountName(state, n.authorId)}
                  </span>
                  <p className="whitespace-pre-wrap">{n.text}</p>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </ProtoPage>
  );
}
