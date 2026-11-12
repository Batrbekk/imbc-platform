// Запросы для генерального директора IMBC — только чтение (GEN-04): IMBC request операторов с перепиской и
// ответами SME (OPR-25, IMBC-17), operator request к производителям с ответом и статусом (OPR-27, OPR-29,
// IMBC-18). Ответить здесь нельзя. Вкладка и фильтры — в адресе.
import { Link } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useFormat } from "@/i18n/format";
import { ProtoPage, RequestThread, type ThreadEntry } from "@/prototype/components";
import { useDictionary } from "@/prototype/i18n";
import { useCommonTexts } from "@/prototype/labels";
import { accountName, organizationName, profileById } from "@/prototype/rules";
import { useProto } from "@/prototype/store";

import { activityTexts } from "./activity-texts";
import { FilterSelect } from "./filter-select";
import { ALL, dossierPath, pick, useAddress } from "./paths";

const TABS = ["imbc", "operator"] as const;
const STATUSES = [ALL, "open", "closed"] as const;
const FILTER_KEYS = ["org", "status"] as const;

export function RequestsScreen() {
  const t = useDictionary(activityTexts);
  const common = useCommonTexts();
  const format = useFormat();
  const state = useProto();
  const { params, set, clear } = useAddress();

  const operators = state.organizations.filter((o) => o.type === "operator");
  const tab = pick(TABS, params.get("tab"), "imbc");
  const org = pick([ALL, ...operators.map((o) => o.id)], params.get("org"), ALL);
  const status = pick(STATUSES, params.get("status"), ALL);
  const filtered = FILTER_KEYS.some((key) => params.has(key));
  const keep = (r: { operatorOrgId: string; status: string }) =>
    (org === ALL || r.operatorOrgId === org) && (status === ALL || r.status === status);

  const imbc = state.imbcRequests.filter(keep).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const asks = state.operatorRequests.filter(keep).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  /** Автор сообщения и его организация — по ключу демо-аккаунта. */
  const authorOrg = (accountId: string) =>
    organizationName(state, state.accounts.find((a) => a.id === accountId)?.organizationId ?? null);
  const manufacturer = (profileId: string | null) => {
    const profile = profileId ? profileById(state, profileId) : undefined;
    if (!profile) return <span>{t("noManufacturer")}</span>;
    return (
      <Link className="underline-offset-4 hover:underline" to={dossierPath(profile.id)}>
        {t("linkedManufacturer", { name: profile.nameRu })}
      </Link>
    );
  };
  const statusBadge = (value: "open" | "closed") => (
    <Badge variant={value === "open" ? "secondary" : "outline"}>{common(`request.${value}`)}</Badge>
  );
  const empty = (text: string) => (
    <Empty className="border">
      <EmptyHeader>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );

  const orgItems = [{ value: ALL, label: t("all") }, ...operators.map((o) => ({ value: o.id, label: o.name }))];
  const statusItems = STATUSES.map((value) => ({
    value,
    label: value === ALL ? t("all") : common(`request.${value}`),
  }));

  return (
    <ProtoPage hideReset title={t("requestsTitle")} description={t("requestsHint")}>
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label={t("operatorFilter")} value={org} items={orgItems} onChange={(v) => set("org", v)} />
        <FilterSelect label={t("statusFilter")} value={status} items={statusItems} onChange={(v) => set("status", v)} />
        {filtered && (
          <Button variant="ghost" onClick={() => clear(FILTER_KEYS)}>
            {t("clearFilters")}
          </Button>
        )}
      </div>

      <Tabs value={tab} onValueChange={(value) => set("tab", String(value), "imbc")}>
        <TabsList>
          {TABS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`tab.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="imbc" className="flex flex-col gap-3">
          {imbc.length === 0
            ? empty(t("imbcEmpty"))
            : imbc.map((r) => {
                const entries: ThreadEntry[] = r.messages.map((m) => ({
                  id: m.id,
                  author: accountName(state, m.authorId),
                  meta: authorOrg(m.authorId),
                  at: m.at,
                  text: m.text,
                }));
                return (
                  <Card key={r.id}>
                    <CardHeader>
                      <CardTitle className="flex flex-wrap items-center gap-2">
                        {r.subject} {statusBadge(r.status)}
                      </CardTitle>
                      <CardDescription className="flex flex-col gap-0.5">
                        <span>
                          {t("sentBy", {
                            name: accountName(state, r.senderId),
                            organization: organizationName(state, r.operatorOrgId),
                          })}{" "}
                          · {format.dateTime(r.createdAt)}
                        </span>
                        {manufacturer(r.profileId)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <RequestThread entries={entries} />
                    </CardContent>
                  </Card>
                );
              })}
        </TabsContent>

        <TabsContent value="operator" className="flex flex-col gap-3">
          {asks.length === 0
            ? empty(t("operatorEmpty"))
            : asks.map((r) => {
                const entries: ThreadEntry[] = [
                  {
                    id: `${r.id}-ask`,
                    author: accountName(state, r.senderId),
                    meta: organizationName(state, r.operatorOrgId),
                    at: r.createdAt,
                    text: r.text,
                  },
                  ...(r.reply
                    ? [
                        {
                          id: `${r.id}-reply`,
                          author: profileById(state, r.profileId)?.nameRu ?? accountName(state, r.reply.authorId),
                          meta: t("manufacturerReply"),
                          at: r.reply.at,
                          text: r.reply.text,
                        },
                      ]
                    : []),
                ];
                return (
                  <Card key={r.id}>
                    <CardHeader>
                      <CardTitle className="flex flex-wrap items-center gap-2">
                        {manufacturer(r.profileId)} {statusBadge(r.status)}
                      </CardTitle>
                      <CardDescription>
                        {r.section ? t("section", { section: common(`section.${r.section}`) }) : t("freeText")}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2">
                      <RequestThread entries={entries} />
                      {!r.reply && <p className="text-sm text-muted-foreground">{t("noReply")}</p>}
                    </CardContent>
                  </Card>
                );
              })}
        </TabsContent>
      </Tabs>
    </ProtoPage>
  );
}
